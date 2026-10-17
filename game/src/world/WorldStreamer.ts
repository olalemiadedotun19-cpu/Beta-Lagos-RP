import * as THREE from 'three';
import { RoadBuilder } from '../procedural/RoadBuilder';
import { SpatialGrid } from './SpatialGrid';
import { WorldLayout, WORLD_HALF } from './WorldLayout';
import { buildCell, CellRect, CellResult, getLampGlowMaterial, getLampPoolMaterial } from './CellBuilder';
import { setFacadeNight } from '../travel/TravelMaterials';
import { CustomBuildings } from '../buildings/CustomBuildings';
import { BarracksIsland } from './barracks/BarracksIsland';
import { graphics, loadRadiusFor, textureLevel } from '../graphics/GraphicsSettings';

/**
 * WorldStreamer - keeps only the cells around the player alive (the map is 1.8 km x 1.8 km).
 *
 *  - cells are 150 m squares built by a time-sliced generator (a few ms per frame, never a long hitch)
 *  - NEAR cells (< ~170 m) get full detail, FAR cells use simplified roads/buildings (no decals, no small props)
 *    The Textures setting scales this: Low builds EVERY cell with the simple (far) geometry, Medium halves the full-detail radius,
 *    High / Ultra keep it as is. Changing the setting re-builds the affected cells in the background (no hitch, no pop to empty).
 *  - cells that drift beyond the unload radius are disposed and their colliders removed
 *  - a tiny pool of real point lights follows the player to the nearest streetlights at night
 */

export const CELL_SIZE = 150;
const LOAD_RADIUS = 250;
const UNLOAD_MARGIN = 50; // a cell is unloaded this far (m) beyond the load radius: hysteresis, so cells at the edge do not flicker in and out
const NEAR_FRACTION = 0.75; // cells closer than this fraction of the load radius get full detail ...
const NEAR_HYSTERESIS = 40; // ... and keep it until they are this much (m) further away
const POOL_LIGHTS = 2;

interface Cell {
  key: string;
  ci: number;
  cj: number;
  rect: CellRect;
  near: boolean;
  result: CellResult | null;
  job: Generator<void, CellResult, void> | null;
  jobNear: boolean;
}

export class WorldStreamer {
  public group = new THREE.Group();
  public lights: THREE.PointLight[] = [];

  private cells = new Map<string, Cell>();
  private prepared: ReturnType<typeof RoadBuilder.prepare>;
  private nightLevel = 0;
  private lightTimer = 0;
  // the "which cells do I need" scan (allocates, sorts) only runs when something could have changed
  private scanX = 1e9;
  private scanZ = 1e9;
  private scanR = -1;
  private scanLv = -1;
  private jobsPending = true;
  private custom: CustomBuildings;
  private island: BarracksIsland;

  constructor(private layout: WorldLayout, private grid: SpatialGrid) {
    this.group.name = 'world_streamer';
    this.custom = new CustomBuildings(grid);
    this.group.add(this.custom.group);
    this.island = new BarracksIsland(grid);
    this.group.add(this.island.group);
    this.prepared = RoadBuilder.prepare(layout.roads);
    for (let i = 0; i < POOL_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffdf80, 0, 24, 1.7);
      l.castShadow = false;
      this.group.add(l);
      this.lights.push(l);
    }
  }

  private rectOf(ci: number, cj: number): CellRect {
    return {
      minX: -WORLD_HALF + ci * CELL_SIZE,
      maxX: -WORLD_HALF + (ci + 1) * CELL_SIZE,
      minZ: -WORLD_HALF + cj * CELL_SIZE,
      maxZ: -WORLD_HALF + (cj + 1) * CELL_SIZE,
    };
  }

  private distTo(rect: CellRect, px: number, pz: number): number {
    const dx = Math.max(rect.minX - px, 0, px - rect.maxX);
    const dz = Math.max(rect.minZ - pz, 0, pz - rect.maxZ);
    return Math.hypot(dx, dz);
  }

  /** Build everything near the player right now (used at spawn so there is no pop-in) */
  public warmup(px: number, pz: number, radius = loadRadiusFor(graphics.get().drawDistance)): void {
    this.update(px, pz, 0, 1e9, radius);
  }

  public update(px: number, pz: number, dt: number, budgetMs = 5, loadRadius = LOAD_RADIUS, camera?: THREE.Camera): void {
    this.custom.update(px, pz);
    this.island.update(px, pz, dt, camera);
    // a frame that is already running long hands the street builder less time (it is only catching up on cells further out)
    if (dt > 0.021 && budgetMs < 1000) budgetMs = Math.min(budgetMs, 2);
    const lvNow = textureLevel();
    const still = dt > 0 && budgetMs < 1000 && !this.jobsPending && loadRadius === this.scanR && lvNow === this.scanLv && Math.abs(px - this.scanX) + Math.abs(pz - this.scanZ) < 6;
    if (!still) this.scanAndBuild(px, pz, budgetMs, loadRadius);

    // pooled lights follow the nearest streetlights (night only)
    this.lightTimer += dt;
    if (this.lightTimer > 0.25 || dt === 0) {
      this.lightTimer = 0;
      this.updateLights(px, pz);
    }
  }

  private scanAndBuild(px: number, pz: number, budgetMs: number, loadRadius: number): void {
    this.scanX = px;
    this.scanZ = pz;
    this.scanR = loadRadius;
    this.scanLv = textureLevel();
    const n = Math.ceil(WORLD_HALF * 2 / CELL_SIZE);
    const ci0 = Math.floor((px + WORLD_HALF) / CELL_SIZE);
    const cj0 = Math.floor((pz + WORLD_HALF) / CELL_SIZE);
    const span = Math.ceil(loadRadius / CELL_SIZE) + 1;

    // request needed cells
    const wanted: { cell: Cell; d: number }[] = [];
    for (let ci = ci0 - span; ci <= ci0 + span; ci++) {
      for (let cj = cj0 - span; cj <= cj0 + span; cj++) {
        if (ci < 0 || cj < 0 || ci >= n || cj >= n) continue;
        const rect = this.rectOf(ci, cj);
        const d = this.distTo(rect, px, pz);
        if (d > loadRadius) continue;
        const key = `${ci}:${cj}`;
        let cell = this.cells.get(key);
        if (!cell) {
          cell = { key, ci, cj, rect, near: false, result: null, job: null, jobNear: false };
          this.cells.set(key, cell);
        }
        wanted.push({ cell, d });
      }
    }
    wanted.sort((a, b) => a.d - b.d);

    // schedule builds / LOD swaps (the near radius follows the draw distance: a short draw distance only needs full detail up close)
    const lv = textureLevel();
    const nearR = lv === 0 ? 0 : Math.min(150, loadRadius * NEAR_FRACTION) * (lv === 1 ? 0.5 : 1);
    const farR = nearR + NEAR_HYSTERESIS;
    for (const { cell, d } of wanted) {
      if (cell.job) continue;
      const wantNear = nearR <= 0 ? false : cell.result ? (cell.near ? d < farR : d < nearR) : d < nearR;
      if (!cell.result || wantNear !== cell.near) {
        cell.jobNear = wantNear;
        cell.job = buildCell(this.layout, this.prepared, cell.rect, wantNear);
      }
    }

    // run jobs (closest first) within the time budget
    const start = performance.now();
    for (const { cell } of wanted) {
      if (!cell.job) continue;
      while (cell.job) {
        const r = cell.job.next();
        if (r.done) {
          this.install(cell, r.value);
          cell.job = null;
        }
        if (performance.now() - start > budgetMs) break;
      }
      if (performance.now() - start > budgetMs) break;
    }

    // unload far cells
    for (const [key, cell] of this.cells) {
      if (this.distTo(cell.rect, px, pz) > loadRadius + UNLOAD_MARGIN) {
        this.removeResult(cell);
        this.cells.delete(key);
      }
    }

    this.jobsPending = false;
    for (const { cell } of wanted) {
      if (cell.job) { this.jobsPending = true; break; }
    }
  }

  private install(cell: Cell, res: CellResult): void {
    const old = cell.result;
    cell.result = res;
    cell.near = cell.jobNear;
    this.group.add(res.group);
    res.colliders.forEach((c) => this.grid.insert(c));
    if (old) this.removeResultObj(old);
  }

  private removeResult(cell: Cell): void {
    if (cell.result) this.removeResultObj(cell.result);
    cell.result = null;
    cell.job = null;
  }

  private removeResultObj(res: CellResult): void {
    this.group.remove(res.group);
    res.colliders.forEach((c) => this.grid.remove(c));
    res.dispose();
  }

  private updateLights(px: number, pz: number): void {
    if (this.nightLevel < 0.02) return;
    const heads: THREE.Vector3[] = [];
    for (const cell of this.cells.values()) {
      if (!cell.result) continue;
      for (const h of cell.result.lampHeads) heads.push(h);
    }
    heads.sort((a, b) => (a.x - px) ** 2 + (a.z - pz) ** 2 - ((b.x - px) ** 2 + (b.z - pz) ** 2));
    for (let i = 0; i < this.lights.length; i++) {
      if (heads[i]) this.lights[i].position.copy(heads[i]);
    }
  }

  /** 0 = day .. 1 = night */
  public setNight(n: number): void {
    this.nightLevel = n;
    getLampGlowMaterial().color.setRGB(0.55, 0.57, 0.6).lerp(new THREE.Color(1, 0.94, 0.75), n);
    const pm = getLampPoolMaterial();
    pm.opacity = 0.5 * n;
    pm.visible = n > 0.02;
    setFacadeNight(n);
    this.custom.setNight(n);
    this.island.setNight(n);
  }

  public getLoadedCellCount(): number {
    let c = 0;
    this.cells.forEach((cell) => cell.result && c++);
    return c;
  }

  public getPendingJobs(): number {
    let c = 0;
    this.cells.forEach((cell) => cell.job && c++);
    return c;
  }

  public dispose(): void {
    for (const cell of this.cells.values()) this.removeResult(cell);
    this.cells.clear();
    this.custom.dispose();
    this.island.dispose();
    this.group.clear();
  }
}
