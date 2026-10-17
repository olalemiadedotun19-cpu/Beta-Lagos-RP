import * as THREE from 'three';
import { SpatialGrid, BoundingBox2D } from '../world/SpatialGrid';
import { LOTS, LotDef, getLotColliders } from './lots';
import { buildManor } from './manor';
import { buildHotel } from './hotel';
import { buildTowerComplex } from './towers';

/**
 * CustomBuildings - instantiates the hand-modelled buildings listed in lots.ts.
 * Models are built lazily the first time the player gets within showRadius (WorldStreamer.warmup triggers
 * the nearby ones at spawn), hidden again when far away, and register collision boxes with the shared grid.
 */

interface BuiltModel {
  group: THREE.Group;
  setNight?: (n: number) => void;
}

const BUILDERS: Record<string, () => BuiltModel> = {
  lot_french_manor: buildManor,
  lot_historic_hotel: buildHotel,
  lot_tower_complex: buildTowerComplex,
};

interface Slot {
  lot: LotDef;
  root: THREE.Group;
  model: BuiltModel | null;
}

export class CustomBuildings {
  public group = new THREE.Group();
  private slots: Slot[] = [];
  private colliders: BoundingBox2D[] = [];
  private night = 0;

  constructor(private grid: SpatialGrid) {
    this.group.name = 'custom_buildings';
    const up = new THREE.Vector3(0, 1, 0);
    for (const lot of LOTS) {
      if (!BUILDERS[lot.id]) continue;
      const root = new THREE.Group();
      root.name = lot.id;
      root.scale.setScalar(lot.scale);
      root.rotation.y = lot.rotY;
      // pin the pivot to (x, z):  position = target - R * (pivot * scale)
      const off = new THREE.Vector3(lot.pivot[0] * lot.scale, 0, lot.pivot[1] * lot.scale).applyAxisAngle(up, lot.rotY);
      root.position.set(lot.x - off.x, 0, lot.z - off.z);
      root.visible = false;
      this.group.add(root);
      this.slots.push({ lot, root, model: null });

      for (const c of getLotColliders(lot)) {
        const box: BoundingBox2D = {
          id: c.id,
          minX: c.rect.minX, maxX: c.rect.maxX, minZ: c.rect.minZ, maxZ: c.rect.maxZ,
          userData: { type: 'building', id: lot.id, name: lot.name },
        };
        this.colliders.push(box);
        this.grid.insert(box);
      }
    }
  }

  public update(px: number, pz: number): void {
    for (const s of this.slots) {
      const d = Math.hypot(px - s.lot.x, pz - s.lot.z);
      if (!s.model && d < s.lot.showRadius) this.build(s);
      if (s.model) s.root.visible = d < s.lot.showRadius + 40;
    }
  }

  private build(s: Slot): void {
    const model = BUILDERS[s.lot.id]();
    if (!s.lot.castShadow) model.group.traverse((o) => ((o as THREE.Mesh).castShadow = false));
    s.root.add(model.group);
    s.model = model;
    model.setNight?.(this.night);
  }

  /** 0 = day .. 1 = night (drives lit windows) */
  public setNight(n: number): void {
    this.night = n;
    for (const s of this.slots) s.model?.setNight?.(n);
  }

  public dispose(): void {
    this.colliders.forEach((c) => this.grid.remove(c));
    this.colliders = [];
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((mat: any) => {
        Object.values(mat).forEach((v: any) => v?.isTexture && v.dispose());
        mat.dispose?.();
      });
    });
    this.group.clear();
    this.slots = [];
  }
}
