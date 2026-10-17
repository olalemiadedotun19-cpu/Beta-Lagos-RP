/**
 * CurvedRoadBuilder - turns the pure data in world/CurvedRoads.ts into meshes, one streamed cell at a time.
 *
 * Per cell (each chunk is 3 x 3 cells; chunks: north-east and north-west corners): hilly terrain (own grid, normals
 * from a padded grid so cell borders stay seamless), road ribbons (asphalt, kerbed pavement near the old grid roads,
 * gravel shoulders, paint), bridge decks with parapets + piers + colliders, the water, flared T-junction corners,
 * roadside trees and streetlights.
 * Everything is partitioned by segment midpoint, so a road crossing a cell border is built exactly once.
 */
import { createTerrainMaterial, createWaterMaterial } from './TerrainTextures';
import { CONCRETE_TILE, getConcreteMaterial, getJointMaterial } from './ConcreteTextures';
import { PAVING_TILE_METRES } from './ConcretePaving';
import { buildOaks, buildTufts, OakSpec, TuftSpec } from './TerrainTrees';
import * as THREE from 'three';
import { hashString, makeRng } from '../travel/Geo';
import { RoadBuilder } from './RoadBuilder';
import { BoundingBox2D } from '../world/SpatialGrid';
import { CurvedRoad, PAVEMENT_H, PAVEMENT_W, SHOULDER, GRAVEL_LIP, TURN_APRON, TURN_GRAVEL, TURN_PAVING, WORLD_EDGE, bedDepth, filletRadius, getCurvedNetwork, groundRoadEdge, inCorner, inPavementCut, roadEdgeDistance, pondsNear, terrainHeight, terrainInfo } from '../world/CurvedRoads';
import { cityWild } from '../world/CityPlan';
import { getCityBuildings } from '../world/CityBuildings';

interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CurvedLamp {
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
  variant: number;
}

export interface CurvedCellResult {
  group: THREE.Group;
  disposables: { dispose(): void }[];
  colliders: BoundingBox2D[];
  lamps: CurvedLamp[];
}

let terrainMat: THREE.MeshLambertMaterial | null = null;

const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type P3 = [number, number, number];
type C3 = [number, number, number];

/** non-indexed-ish triangle soup with flat normals; quads flip themselves to face `toward` (default: up) */
class Buf {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  private vert(p: P3, n: P3, u: number, v: number, c: C3): number {
    const i = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    return i;
  }

  poly(pts: P3[], c: C3, uvs: (p: P3) => [number, number], toward?: P3): void {
    const A = pts[0];
    // Newell-ish normal from the first non-degenerate triangle
    let n: P3 = [0, 0, 0];
    for (let k = 1; k < pts.length - 1 && n[0] === 0 && n[1] === 0 && n[2] === 0; k++) {
      const B = pts[k];
      const C = pts[k + 1];
      const ux = B[0] - A[0];
      const uy = B[1] - A[1];
      const uz = B[2] - A[2];
      const vx = C[0] - A[0];
      const vy = C[1] - A[1];
      const vz = C[2] - A[2];
      const cx = uy * vz - uz * vy;
      const cy = uz * vx - ux * vz;
      const cz = ux * vy - uy * vx;
      if (cx * cx + cy * cy + cz * cz > 1e-10) n = [cx, cy, cz];
    }
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-8) return;
    n = [n[0] / l, n[1] / l, n[2] / l];
    const hint: P3 = toward ?? [A[0], A[1] + 1, A[2]];
    const flip = n[0] * (hint[0] - A[0]) + n[1] * (hint[1] - A[1]) + n[2] * (hint[2] - A[2]) < 0;
    if (flip) n = [-n[0], -n[1], -n[2]];
    const ids = pts.map((p) => {
      const [u, v] = uvs(p);
      return this.vert(p, n, u, v, c);
    });
    for (let k = 1; k < ids.length - 1; k++) {
      if (flip) this.idx.push(ids[0], ids[k + 1], ids[k]);
      else this.idx.push(ids[0], ids[k], ids[k + 1]);
    }
  }

  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

// ------------------------------------------------------------------------------------------------
// per-road frames + junction tilt (cached; pure functions of the network)
// ------------------------------------------------------------------------------------------------

interface Frame {
  tx: Float64Array;
  tz: Float64Array;
  nx: Float64Array;
  nz: Float64Array;
  /** extra height per metre of lateral offset: tilts the last metres of a side road so its mouth matches the host */
  tilt: Float64Array;
  /** arc length of the junction end (start or end of the road) and the host */
  joinS: number;
  hostId: string | null;
}
const frames = new Map<string, Frame>();
const STEP = 2.5;

function hostYAlong(host: CurvedRoad, k: number, along: number): number {
  const f = Math.min(host.pts.length - 1.001, Math.max(0, k + along / STEP));
  const i = Math.floor(f);
  const t = f - i;
  return host.pts[i].y + (host.pts[i + 1].y - host.pts[i].y) * t;
}

function frameOf(r: CurvedRoad): Frame {
  let f = frames.get(r.id);
  if (f) return f;
  const n = r.pts.length;
  f = { tx: new Float64Array(n), tz: new Float64Array(n), nx: new Float64Array(n), nz: new Float64Array(n), tilt: new Float64Array(n), joinS: -1, hostId: null };
  for (let i = 0; i < n; i++) {
    const a = r.pts[Math.max(0, i - 1)];
    const b = r.pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    f.tx[i] = (b.x - a.x) / l;
    f.tz[i] = (b.z - a.z) / l;
    f.nx[i] = -f.tz[i];
    f.nz[i] = f.tx[i];
  }
  const net = getCurvedNetwork();
  const j = net.junctions.find((q) => q.roadId === r.id);
  if (j) {
    const host = net.byId.get(j.hostId)!;
    const hp = host.pts[j.hostIdx];
    const first = r.pts[0];
    const last = r.pts[n - 1];
    const atStart = Math.hypot(first.x - hp.x, first.z - hp.z) < Math.hypot(last.x - hp.x, last.z - hp.z);
    f.joinS = atStart ? 0 : last.s;
    f.hostId = host.id;
    const hf = frameOf(host);
    const g = (hostYAlong(host, j.hostIdx, 2.5) - hostYAlong(host, j.hostIdx, -2.5)) / 5;
    for (let i = 0; i < n; i++) {
      const dist = Math.abs(r.pts[i].s - f.joinS);
      const taper = 1 - sstep(2, 14, dist);
      f.tilt[i] = g * (f.nx[i] * hf.tx[j.hostIdx] + f.nz[i] * hf.tz[j.hostIdx]) * taper;
    }
  }
  frames.set(r.id, f);
  return f;
}

// ------------------------------------------------------------------------------------------------
// road style
// ------------------------------------------------------------------------------------------------

const TONE: Record<string, number> = { freeway: 0.78, main: 0.85, secondary: 0.9, residential: 1.0, rural: 1.08, mountain: 1.08 };
const WHITE: C3 = [0.93, 0.93, 0.9];
const YELLOW: C3 = [0.95, 0.78, 0.26];
const GRAVEL: C3 = [1, 1, 1]; // the gravel texture carries its own colour now
const PAVER: C3 = [0.9, 0.89, 0.86];
// the concrete textures carry their own grey (see ConcreteTextures.ts): these only tint them
const CONCRETE: C3 = [0.9, 0.9, 0.88];
const CONCRETE_DARK: C3 = [0.56, 0.56, 0.55];
const RAIL: C3 = [0.98, 0.98, 0.96];
const JOINT: C3 = [0.2, 0.2, 0.19];
const DECK_DROP = 0.8;
const PARAPET_H = 0.95;

// ------------------------------------------------------------------------------------------------
// the cell builder
// ------------------------------------------------------------------------------------------------

export function* buildCurvedCell(rect: Rect, near: boolean): Generator<void, CurvedCellResult, void> {
  const net = getCurvedNetwork();
  const group = new THREE.Group();
  group.name = `curved_${rect.minX}_${rect.minZ}`;
  const disposables: { dispose(): void }[] = [];
  const colliders: BoundingBox2D[] = [];
  const lamps: CurvedLamp[] = [];
  const inRect = (x: number, z: number) => x >= rect.minX && x < rect.maxX && z >= rect.minZ && z < rect.maxZ;
  const addMesh = (geo: THREE.BufferGeometry | null, mat: THREE.Material, shadow = false, recv = false, order = 0): void => {
    if (!geo) return;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    m.receiveShadow = recv;
    m.renderOrder = order;
    group.add(m);
    disposables.push(geo);
  };

  // ---- 1. terrain ---------------------------------------------------------------------------------
  {
    // cells with a park pond are meshed at ~1 m so the pond bowl matches the height the walker stands at
    const N = pondsNear(rect.minX, rect.maxX, rect.minZ, rect.maxZ) ? 150 : 40;
    const step = (rect.maxX - rect.minX) / N;
    const xs: number[] = [];
    // cells on the world's west / east edge reach out to the edge of the old ground plane (WORLD_EDGE)
    if (rect.minX <= -899.9) for (let k = 0; k < 5; k++) xs.push(-WORLD_EDGE + (k * (WORLD_EDGE + rect.minX)) / 5);
    for (let k = 0; k <= N; k++) xs.push(rect.minX + k * step);
    if (rect.maxX >= 899.9) for (let k = 1; k <= 5; k++) xs.push(rect.maxX + (k * (WORLD_EDGE - rect.maxX)) / 5);
    const zs: number[] = [];
    if (rect.minZ <= -899.9) for (let k = 0; k < 5; k++) zs.push(-WORLD_EDGE + (k * (WORLD_EDGE + rect.minZ)) / 5);
    for (let k = 0; k <= N; k++) zs.push(rect.minZ + k * step);
    if (rect.maxZ >= 899.9) for (let k = 1; k <= 5; k++) zs.push(rect.maxZ + (k * (WORLD_EDGE - rect.maxZ)) / 5);
    const nx = xs.length;
    const nz = zs.length;
    const px = [xs[0] - step, ...xs, xs[nx - 1] + step];
    const pz = [zs[0] - step, ...zs, zs[nz - 1] + step];
    const W = nx + 2;
    const H = new Float32Array(W * (nz + 2));
    const ROAD = new Float32Array(W * (nz + 2));
    const WET = new Float32Array(W * (nz + 2));
    for (let j = 0; j < nz + 2; j++) {
      for (let i = 0; i < W; i++) {
        const t = terrainInfo(px[i], pz[j]);
        H[j * W + i] = t.h;
        ROAD[j * W + i] = t.road;
        WET[j * W + i] = t.wet;
      }
      if (j % 10 === 9) yield;
    }
    const pos = new Float32Array(nx * nz * 3);
    const nor = new Float32Array(nx * nz * 3);
    const uv = new Float32Array(nx * nz * 2);
    const col = new Float32Array(nx * nz * 3);
    const spl = new Float32Array(nx * nz * 4);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const gi = (j + 1) * W + (i + 1);
        const h = H[gi];
        const dhx = (H[gi + 1] - H[gi - 1]) / (px[i + 2] - px[i]);
        const dhz = (H[gi + W] - H[gi - W]) / (pz[j + 2] - pz[j]);
        const l = Math.hypot(dhx, 1, dhz);
        const o = j * nx + i;
        pos.set([xs[i], h - 0.05, zs[j]], o * 3);
        nor.set([-dhx / l, 1 / l, -dhz / l], o * 3);
        uv.set([(xs[i] + WORLD_EDGE) / 28, (WORLD_EDGE - zs[j]) / 28], o * 2);
        // splat weights for the Terrain Road shader: grass -> rock on steep / high ground, dirt on cut + fill slopes + damp banks.
        // The hue now comes from the shader; the vertex colour only keeps the soft brightness patches and the wet darkening.
        const slope = Math.hypot(dhx, dhz);
        const rock = Math.max(sstep(0.5, 0.95, slope), sstep(34, 50, h) * 0.8);
        const rw = ROAD[gi];
        const earth = 4 * rw * (1 - rw) * (slope > 0.12 ? 1 : 0.35);
        const wet = WET[gi];
        const patch = 1 + 0.07 * Math.sin(xs[i] * 0.071 + zs[j] * 0.043) * Math.sin(zs[j] * 0.059 - xs[i] * 0.037);
        const wR = Math.min(1, rock);
        const base = 1 - wR;
        const wD = base * Math.min(1, earth * 0.85 + wet * 0.5);
        spl.set([base - wD, wR, 0, wD], o * 4);
        const dark = 1 - 0.22 * wet;
        col.set([patch * dark, patch * dark, patch * dark], o * 3);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = j * nx + i + 1;
        const c = (j + 1) * nx + i;
        const d = (j + 1) * nx + i + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('splat', new THREE.BufferAttribute(spl, 4));
    g.setIndex(idx);
    if (!terrainMat) terrainMat = createTerrainMaterial();
    addMesh(g, terrainMat, false, true);
  }
  yield;

  // ---- 2. stream / river water (Terrain Road shader: ripples, reflection, glints, depth colour, shore foam) -------
  // The ribbon is wider than the channel and every vertex gets its REAL depth (water level - terrain height), exactly
  // like the lake of the prototype: the shader fades the water out and draws foam wherever the bank meets the surface,
  // so the shoreline follows the actual terrain instead of a straight synthetic edge.
  for (const S of net.streams) {
    const COLS = 12;
    const SPREAD = 1.7;
    const DEPTH_K = 5; // streams are shallow: scale the depth so the colour ramp reads like the prototype's lake
    const pos: number[] = [];
    const dep: number[] = [];
    const idx: number[] = [];
    const row = (k: number): void => {
      const p = S.pts[Math.max(0, k - 1)];
      const q = S.pts[Math.min(S.pts.length - 1, k + 1)];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const nx = -(q[1] - p[1]) / l;
      const nz = (q[0] - p[0]) / l;
      for (let c = 0; c <= COLS; c++) {
        const t = (c / COLS) * 2 - 1;
        const x = S.pts[k][0] + nx * t * S.halfWidth * SPREAD;
        const z = S.pts[k][1] + nz * t * S.halfWidth * SPREAD;
        pos.push(x, S.water[k] - 0.05, z);
        dep.push(Math.max(S.water[k] - terrainHeight(x, z), -0.1) * DEPTH_K);
      }
    };
    let rows = 0;
    for (let i = 0; i < S.pts.length - 1; i++) {
      const a = S.pts[i];
      const c = S.pts[i + 1];
      if (!inRect((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)) continue;
      row(i);
      row(i + 1);
      const base = rows * (COLS + 1);
      rows += 2;
      for (let k = 0; k < COLS; k++) {
        const v0 = base + k;
        const v1 = base + k + 1;
        const v2 = base + COLS + 1 + k;
        const v3 = v2 + 1;
        idx.push(v0, v2, v1, v1, v2, v3);
      }
    }
    if (rows > 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(dep), 1));
      g.setIndex(idx);
      addMesh(g, createWaterMaterial(), false, false, 1);
    }
  }

  // ---- 3. roads ------------------------------------------------------------------------------------
  const mats = RoadBuilder.materials();
  const asphalt = new Buf();
  const paving = new Buf();
  const gravel = new Buf();
  const marks = new Buf();
  const conc = new Buf(); // concrete walls / undersides (vertical faces)
  const concTop = new Buf(); // concrete upward faces (barrier cap, deck edge strip)
  const joints = new Buf(); // expansion joints between barrier panels
  const uvG = (p: P3): [number, number] => [p[0] / 3, p[2] / 3];
  const uvA = (p: P3): [number, number] => [p[0] / 7, p[2] / 7];
  const uvP = (p: P3): [number, number] => [p[0] / 2.4, p[2] / 2.4];
  const uvM = (p: P3): [number, number] => [p[0] / 2.5, p[2] / 2.5];
  const uvC = (): [number, number] => [0, 0];
  const plan = getCityBuildings();
  const lerp3 = (a: P3, b: P3, t: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const nearRect = (r: CurvedRoad, m: number) => r.bbox.maxX >= rect.minX - m && r.bbox.minX <= rect.maxX + m && r.bbox.maxZ >= rect.minZ - m && r.bbox.minZ <= rect.maxZ + m;

  for (const r of net.roads) {
    if (!nearRect(r, 20)) continue;
    const f = frameOf(r);
    const hw = r.hw;
    const tone = TONE[r.cls] ?? 1;
    const asph: C3 = [tone, tone, tone];
    const freeway = r.cls === 'freeway';
    const E = (i: number, off: number, dy: number): P3 => {
      const p = r.pts[i];
      return [p.x + f.nx[i] * off, p.y + dy + f.tilt[i] * off, p.z + f.nz[i] * off];
    };
    const Et = (i: number, t: number, off: number, dy: number): P3 => lerp3(E(i, off, dy), E(i + 1, off, dy), t);
    // concrete UVs in metres / CONCRETE_TILE, taken from the road sample a vertex belongs to (the nearer end of its segment), so the
    // texture runs on without a seam from one 2.5 m segment to the next; every road and every side gets its own phase
    const cseed = ((hashString(`cc:${r.id}`) % 1009) / 1009) * 40;
    const nearK = (p: P3, i: number): number => {
      const a0 = r.pts[i];
      const b0 = r.pts[i + 1];
      return (p[0] - a0.x) ** 2 + (p[2] - a0.z) ** 2 <= (p[0] - b0.x) ** 2 + (p[2] - b0.z) ** 2 ? i : i + 1;
    };
    const latOf = (p: P3, k: number): number => (p[0] - r.pts[k].x) * f.nx[k] + (p[2] - r.pts[k].z) * f.nz[k];
    /** vertical faces running along the road: u = distance along the road, v = height */
    const uvWall = (i: number, side: number) => (p: P3): [number, number] => [r.pts[nearK(p, i)].s / CONCRETE_TILE + cseed + side * 17.3, p[1] / CONCRETE_TILE];
    /** horizontal faces: u = distance along the road, v = sideways offset */
    const uvTop = (i: number, side: number) => (p: P3): [number, number] => {
      const k = nearK(p, i);
      return [r.pts[k].s / CONCRETE_TILE + cseed + side * 17.3, latOf(p, k) / CONCRETE_TILE + side * 3.1];
    };
    /** vertical faces across the road (barrier ends, deck end caps): u = sideways offset, v = height */
    const uvEnd = (i: number, side: number) => (p: P3): [number, number] => [latOf(p, nearK(p, i)) / CONCRETE_TILE + cseed + side * 5.7, p[1] / CONCRETE_TILE];
    /** where p sits on segment i: fraction along it, the nearer sample, arc length s */
    const onSeg = (p: P3, i: number): { t: number; k: number; s: number } => {
      const a0 = r.pts[i];
      const b0 = r.pts[i + 1];
      const dx = b0.x - a0.x;
      const dz = b0.z - a0.z;
      const t = Math.min(1, Math.max(0, ((p[0] - a0.x) * dx + (p[2] - a0.z) * dz) / (dx * dx + dz * dz || 1)));
      return { t, k: t < 0.5 ? i : i + 1, s: a0.s + (b0.s - a0.s) * t };
    };
    /** sidewalk slabs run WITH the street: u = distance along it, v = distance out from the kerb (one tile = 2.4 m), so the joints stay
     *  square to the kerb however the street curves (a world-aligned grid made them cut across the pavement at any angle) */
    const uvPave = (i: number, sg: number) => (p: P3): [number, number] => {
      const q = onSeg(p, i);
      return [q.s / PAVING_TILE_METRES + cseed, (sg * latOf(p, q.k) - hw) / PAVING_TILE_METRES];
    };
    /** the vertical kerb face: u along the street, v = height above the road / 2.4 (the same concrete, so the kerb is not a stretched smear) */
    const uvKerb = (i: number, sg: number) => (p: P3): [number, number] => {
      const q = onSeg(p, i);
      return [q.s / PAVING_TILE_METRES + cseed, (p[1] - (r.pts[i].y + (r.pts[i + 1].y - r.pts[i].y) * q.t)) / PAVING_TILE_METRES + sg * 0.37];
    };
    const total = r.pts[r.pts.length - 1].s;
    // pavement cuts at junction mouths (shared with the walking-height code): [s0, s1] per side (+1 = left normal)
    const cuts: Record<string, [number, number][]> = { '1': [], '-1': [] };
    for (const j of r.hostJoins) cuts[String(j.side)].push([j.s - j.hw - j.rF, j.s + j.hw + j.rF]);
    for (const m of r.mouths) {
      cuts['1'].push([m.s0, m.s1]);
      cuts['-1'].push([m.s0, m.s1]);
    }
    /** parts of the segment [sa, sb] (as fractions) that are NOT inside a junction mouth on this side */
    const uncut = (sg: number, sa: number, sb: number): [number, number][] => {
      let ranges: [number, number][] = [[sa, sb]];
      for (const c of cuts[String(sg)]) {
        if (c[1] <= sa || c[0] >= sb) continue;
        const next: [number, number][] = [];
        for (const rg of ranges) {
          if (c[1] <= rg[0] || c[0] >= rg[1]) { next.push(rg); continue; }
          if (c[0] > rg[0]) next.push([rg[0], c[0]]);
          if (c[1] < rg[1]) next.push([c[1], rg[1]]);
        }
        ranges = next;
      }
      return ranges.filter((rg) => rg[1] - rg[0] > 0.05).map((rg) => [(rg[0] - sa) / (sb - sa), (rg[1] - sa) / (sb - sa)] as [number, number]);
    };

    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i];
      const b = r.pts[i + 1];
      if (!inRect((a.x + b.x) / 2, (a.z + b.z) / 2)) continue;
      const bridge = a.bridge && b.bridge;
      const viaduct = a.viaduct && b.viaduct;
      const drop = viaduct ? (freeway ? 1.7 : 1.15) : DECK_DROP;
      const parH = freeway ? 1.05 : PARAPET_H;
      // asphalt
      asphalt.poly([E(i, -hw, 0.01), E(i, hw, 0.01), E(i + 1, hw, 0.01), E(i + 1, -hw, 0.01)], asph, uvA);
      if (bridge) {
        const W = hw + (freeway ? 0.6 : 0.45);
        const bw = freeway ? 0.55 : 0.35; // barrier width
        const Wi = W - bw;
        // barrier cross-section like a New Jersey / bridge parapet: a short upright foot, a flared slope, then an almost upright face.
        // [inset from the inner foot (m), height (m)]
        const prof: [number, number][] = [[0, 0.01], [0, 0.14], [bw * 0.3, 0.5], [bw * 0.38, parH]];
        const IN = (k: number): number => Wi + prof[k][0];
        const panel = i >> 1; // 5 m panels: each is cast on its own day, so each has its own slight tone
        const jointHere = (i & 1) === 0 && r.pts[i - 1]?.bridge === true;
        for (const sg of [-1, 1]) {
          const tone = 1 + (((hashString(`bp:${r.id}:${panel}:${sg}`) % 100) - 50) / 50) * 0.04;
          const rail: C3 = [RAIL[0] * tone, RAIL[1] * tone, RAIL[2] * tone];
          const foot: C3 = [rail[0] * 0.78, rail[1] * 0.78, rail[2] * 0.76]; // road grime and tyre splash on the lowest part
          const wallUV = uvWall(i, sg);
          const topUV = uvTop(i, sg);
          const endUV = uvEnd(i, sg);
          const P = (ii: number, off: number, h: number): P3 => E(ii, sg * off, h);
          const outside = E(i, sg * (W + 1), 0.5);
          // deck edge strip beside the asphalt, slab fascia (+ a dark drip band along its lower edge)
          concTop.poly([P(i, hw, 0.01), P(i + 1, hw, 0.01), P(i + 1, W, 0.01), P(i, W, 0.01)], CONCRETE, topUV);
          conc.poly([P(i, W, 0.01), P(i + 1, W, 0.01), P(i + 1, W, -drop + 0.07), P(i, W, -drop + 0.07)], CONCRETE, wallUV, outside);
          conc.poly([P(i, W, -drop + 0.07), P(i + 1, W, -drop + 0.07), P(i + 1, W, -drop), P(i, W, -drop)], CONCRETE_DARK, wallUV, outside);
          // barrier: inner face (foot, flared slope, upright face), cap, outer face
          for (let k = 0; k < prof.length - 1; k++) {
            conc.poly([P(i, IN(k), prof[k][1]), P(i + 1, IN(k), prof[k][1]), P(i + 1, IN(k + 1), prof[k + 1][1]), P(i, IN(k + 1), prof[k + 1][1])], k === 0 ? foot : rail, wallUV, E(i, 0, 0.5));
          }
          concTop.poly([P(i, IN(3), parH), P(i + 1, IN(3), parH), P(i + 1, W, parH), P(i, W, parH)], rail, topUV);
          conc.poly([P(i, W, 0.01), P(i + 1, W, 0.01), P(i + 1, W, parH), P(i, W, parH)], rail, wallUV, outside);
          // the barrier's ends (the flared foot makes the section non-convex: two convex pieces)
          const cap = (ii: number, back: P3): void => {
            conc.poly([P(ii, IN(0), 0.01), P(ii, W, 0.01), P(ii, W, prof[2][1]), P(ii, IN(2), prof[2][1]), P(ii, IN(1), prof[1][1])], rail, endUV, back);
            conc.poly([P(ii, IN(2), prof[2][1]), P(ii, W, prof[2][1]), P(ii, W, parH), P(ii, IN(3), parH)], rail, endUV, back);
          };
          if (!r.pts[i - 1]?.bridge) cap(i, [a.x - f.tx[i] * 2, a.y + 0.5, a.z - f.tz[i] * 2]);
          if (r.pts[i + 2]?.bridge !== true) cap(i + 1, [b.x + f.tx[i + 1] * 2, b.y + 0.5, b.z + f.tz[i + 1] * 2]);
          // expansion joint at the start of every 5 m panel: a thin dark strip over the inner face, the cap, the outer face and the deck edge
          if (jointHere) {
            const t1 = 0.016;
            const Q = (t: number, off: number, h: number): P3 => Et(i, t, sg * off, h);
            for (let k = 0; k < prof.length - 1; k++) {
              joints.poly([Q(0, IN(k), prof[k][1]), Q(t1, IN(k), prof[k][1]), Q(t1, IN(k + 1), prof[k + 1][1]), Q(0, IN(k + 1), prof[k + 1][1])], JOINT, uvC, E(i, 0, 0.5));
            }
            joints.poly([Q(0, IN(3), parH), Q(t1, IN(3), parH), Q(t1, W, parH), Q(0, W, parH)], JOINT, uvC);
            joints.poly([Q(0, W, -drop), Q(t1, W, -drop), Q(t1, W, parH), Q(0, W, parH)], JOINT, uvC, outside);
            joints.poly([Q(0, hw, 0.01), Q(t1, hw, 0.01), Q(t1, Wi, 0.01), Q(0, Wi, 0.01)], JOINT, uvC);
          }
          // parapet colliders (axis-aligned boxes every ~1.25 m: no gaps on diagonals). Tall + level-aware: they never block the
          // road UNDER a flyover, and nobody hops over them.
          for (const t of [0, 0.5]) {
            const x = a.x + (b.x - a.x) * t + f.nx[i] * sg * (W - 0.17);
            const z = a.z + (b.z - a.z) * t + f.nz[i] * sg * (W - 0.17);
            const y = a.y + (b.y - a.y) * t;
            colliders.push({ id: `cbr_${r.id}_${i}_${sg}_${t}`, minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.5, maxZ: z + 0.5, y0: y - 0.4, y1: y + 3, userData: { type: 'prop', id: 'bridge_rail' } });
          }
        }
        // underside of the deck + its end caps (flyovers are walked UNDER: the deck must be seen from below)
        const lo = (k: number, off: number): P3 => E(k, off, -drop);
        conc.poly([lo(i, -(hw + 0.45)), lo(i + 1, -(hw + 0.45)), lo(i + 1, hw + 0.45), lo(i, hw + 0.45)], CONCRETE_DARK, uvTop(i, 2), E(i, 0, -drop - 3));
        if (viaduct && !r.pts[i - 1]?.bridge) {
          const back: P3 = [a.x - f.tx[i] * 2, a.y - 0.4, a.z - f.tz[i] * 2];
          conc.poly([E(i, -(hw + 0.45), 0.01), E(i, hw + 0.45, 0.01), E(i, hw + 0.45, -drop), E(i, -(hw + 0.45), -drop)], CONCRETE, uvEnd(i, 2), back);
        }
        if (viaduct && r.pts[i + 2]?.bridge !== true) {
          const fwd: P3 = [b.x + f.tx[i + 1] * 2, b.y - 0.4, b.z + f.tz[i + 1] * 2];
          conc.poly([E(i + 1, -(hw + 0.45), 0.01), E(i + 1, hw + 0.45, 0.01), E(i + 1, hw + 0.45, -drop), E(i + 1, -(hw + 0.45), -drop)], CONCRETE, uvEnd(i, 2), fwd);
        }
      } else {
        for (const sg of [-1, 1]) {
          const pw0 = PAVEMENT_W * a.curb;
          const pw1 = PAVEMENT_W * b.curb;
          const ph0 = PAVEMENT_H * a.curb;
          const ph1 = PAVEMENT_H * b.curb;
          const kerbed = a.curb > 0.004 || b.curb > 0.004;
          const spans = kerbed || r.kerb ? uncut(sg, a.s, b.s) : [[0, 1] as [number, number]];
          for (const [t0, t1] of spans) {
            const pwA = pw0 + (pw1 - pw0) * t0;
            const pwB = pw0 + (pw1 - pw0) * t1;
            const phA = ph0 + (ph1 - ph0) * t0;
            const phB = ph0 + (ph1 - ph0) * t1;
            if (kerbed) {
              // every ~2.4 m panel is poured on its own day: a little tone change per panel keeps long pavements from looking printed
              const pt = 1 + (((hashString(`pv:${r.id}:${i >> 1}:${sg}`) % 100) - 50) / 50) * 0.05;
              const pav: C3 = [PAVER[0] * pt, PAVER[1] * pt, PAVER[2] * pt];
              if (phA > 0.012 || phB > 0.012) paving.poly([Et(i, t0, sg * hw, 0.01), Et(i, t1, sg * hw, 0.01), Et(i, t1, sg * hw, phB), Et(i, t0, sg * hw, phA)], [pav[0] * 0.9, pav[1] * 0.9, pav[2] * 0.9], uvKerb(i, sg), Et(i, t0, sg * (hw - 1), 0.5));
              paving.poly([Et(i, t0, sg * hw, phA), Et(i, t1, sg * hw, phB), Et(i, t1, sg * (hw + pwB), phB), Et(i, t0, sg * (hw + pwA), phA)], pav, uvPave(i, sg));
            }
            // the gravel verge is the ramp from the pavement (or the asphalt edge) down to the terrain bed, which sits bedDepth below the
            // road: it ends exactly on the bed so there is no lip, and groundHeightAt() walks the very same slope (legs no longer sink in it)
            const bedAt = (k: number, off: number): number => GRAVEL_LIP - bedDepth(r.pts[k].s) - r.pts[k].dip - f.tilt[k] * off; // cancels the junction tilt: the verge ends ON the bed
            const Eb = (t: number, off: number): P3 => lerp3(E(i, off, bedAt(i, off)), E(i + 1, off, bedAt(i + 1, off)), t);
            const outA = Eb(t0, sg * (hw + pwA + SHOULDER));
            const outB = Eb(t1, sg * (hw + pwB + SHOULDER));
            gravel.poly([Et(i, t0, sg * (hw + pwA), phA), Et(i, t1, sg * (hw + pwB), phB), outB, outA], GRAVEL, uvG);
          }
        }
      }
      // freeway median barrier (concrete, 0.7 m wide, 0.95 m high) - on the ground and on the deck
      if (freeway) {
        const mw = 0.35;
        concTop.poly([E(i, -mw, 0.95), E(i + 1, -mw, 0.95), E(i + 1, mw, 0.95), E(i, mw, 0.95)], RAIL, uvTop(i, 3));
        for (const sg of [-1, 1]) conc.poly([E(i, sg * mw, 0.01), E(i + 1, sg * mw, 0.01), E(i + 1, sg * mw, 0.95), E(i, sg * mw, 0.95)], RAIL, uvWall(i, sg + 5), E(i, sg * (mw + 1), 0.5));
        for (const t of [0, 0.5]) {
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          const y = a.y + (b.y - a.y) * t;
          colliders.push({ id: `cmed_${r.id}_${i}_${t}`, minX: x - 0.65, maxX: x + 0.65, minZ: z - 0.65, maxZ: z + 0.65, y0: y - 0.4, y1: y + 3, userData: { type: 'prop', id: 'median_barrier' } });
        }
      }
      // paint
      const strip = (o0: number, o1: number, c: C3): void => {
        marks.poly([E(i, o0, 0.017), E(i, o1, 0.017), E(i + 1, o1, 0.017), E(i + 1, o0, 0.017)], c, uvM);
      };
      const dash = i % 3 === 0;
      const mouth = r.mouths.some((m) => a.s >= m.s0 - 6 && a.s <= m.s1 + 6) || r.hostJoins.some((j) => Math.abs(a.s - j.s) < j.hw + 1);
      const edgeLines = r.cls === 'main' || r.cls === 'secondary' || r.cls === 'mountain' || freeway;
      if (edgeLines) for (const sg of [-1, 1]) strip(sg * (hw - 0.5) - 0.07, sg * (hw - 0.5) + 0.07, WHITE);
      if (!mouth && a.s > 1 && a.s < total - 1) {
        if (freeway) {
          if (dash) for (const sg of [-1, 1]) for (const lane of [3.4, 6.7]) strip(sg * lane - 0.07, sg * lane + 0.07, WHITE);
        } else if (r.cls === 'main') {
          strip(-0.3, -0.17, YELLOW);
          strip(0.17, 0.3, YELLOW);
          if (dash) for (const sg of [-1, 1]) strip(sg * 3.5 - 0.06, sg * 3.5 + 0.06, WHITE);
        } else if (r.cls === 'mountain') strip(-0.08, 0.08, YELLOW);
        else if (dash) strip(-0.07, 0.07, WHITE);
      }
    }
    // dead-end streets finish in a turning circle: asphalt disc + kerbed pavement ring + gravel ring
    if (r.cul) {
      const n = r.pts.length;
      const e = r.pts[n - 1];
      if (inRect(e.x, e.z)) {
        const R = hw + TURN_APRON;
        const M = 22;
        const ring = (r0: number, r1: number, y0: number, y1: number, buf: Buf, c: C3, uv: (p: P3) => [number, number]): void => {
          for (let m = 0; m < M; m++) {
            const a0 = (m / M) * Math.PI * 2;
            const a1 = ((m + 1) / M) * Math.PI * 2;
            const q = (rad: number, ang: number, y: number): P3 => [e.x + Math.cos(ang) * rad, e.y + y, e.z + Math.sin(ang) * rad];
            buf.poly([q(r0, a0, y0), q(r1, a0, y1), q(r1, a1, y1), q(r0, a1, y0)], c, uv);
          }
        };
        const tn = TONE[r.cls] ?? 1;
        for (let m = 0; m < M; m++) {
          const a0 = (m / M) * Math.PI * 2;
          const a1 = ((m + 1) / M) * Math.PI * 2;
          asphalt.poly([[e.x, e.y + 0.01, e.z], [e.x + Math.cos(a0) * R, e.y + 0.01, e.z + Math.sin(a0) * R], [e.x + Math.cos(a1) * R, e.y + 0.01, e.z + Math.sin(a1) * R]], [tn, tn, tn], uvA);
          const q = (rad: number, ang: number, y: number): P3 => [e.x + Math.cos(ang) * rad, e.y + y, e.z + Math.sin(ang) * rad];
          asphalt.poly([q(R, a0, 0.01), q(R, a1, 0.01), q(R, a1, PAVEMENT_H), q(R, a0, PAVEMENT_H)], PAVER, uvP, q(R - 1, (a0 + a1) / 2, 0.5));
        }
        ring(R, R + TURN_PAVING, PAVEMENT_H, PAVEMENT_H, paving, PAVER, uvP);
        ring(R + TURN_PAVING, R + TURN_PAVING + TURN_GRAVEL, PAVEMENT_H, -0.04, gravel, GRAVEL, uvG);
      }
    }
    yield;
  }

  // ---- piers under the bridges and viaducts ------------------------------------------------------
  /** textured concrete box (rotY like THREE: local z runs along the road); sides + optional underside, no top (it is always hidden) */
  const concBox = (w: number, h: number, d: number, cx: number, cy: number, cz: number, rotY: number, col: C3, underside = false): void => {
    const c = Math.cos(rotY);
    const sn = Math.sin(rotY);
    const wx = (lx: number, lz: number): number => cx + lx * c + lz * sn;
    const wz = (lx: number, lz: number): number => cz - lx * sn + lz * c;
    const y0 = cy - h / 2;
    const y1 = cy + h / 2;
    const hx = w / 2;
    const hd = d / 2;
    const seed = (cx * 0.37 + cz * 0.71) % 40;
    const sides: [number, number, number, number][] = [[-hx, -hd, hx, -hd], [hx, -hd, hx, hd], [hx, hd, -hx, hd], [-hx, hd, -hx, -hd]];
    for (const [ax, az, bx, bz] of sides) {
      const A0: P3 = [wx(ax, az), y0, wz(ax, az)];
      const B0: P3 = [wx(bx, bz), y0, wz(bx, bz)];
      const B1: P3 = [B0[0], y1, B0[2]];
      const A1: P3 = [A0[0], y1, A0[2]];
      const L = Math.hypot(B0[0] - A0[0], B0[2] - A0[2]) || 1;
      const ex = (B0[0] - A0[0]) / L;
      const ez = (B0[2] - A0[2]) / L;
      conc.poly([A0, B0, B1, A1], col, (p) => [(p[0] * ex + p[2] * ez) / CONCRETE_TILE + seed, p[1] / CONCRETE_TILE], [wx(ax + bx, az + bz), cy, wz(ax + bx, az + bz)]);
    }
    if (underside) {
      const q = (lx: number, lz: number): P3 => [wx(lx, lz), y0, wz(lx, lz)];
      const dark: C3 = [col[0] * 0.62, col[1] * 0.62, col[2] * 0.62];
      conc.poly([q(-hx, -hd), q(hx, -hd), q(hx, hd), q(-hx, hd)], dark, (p) => [p[0] / CONCRETE_TILE + seed, p[2] / CONCRETE_TILE], [cx, y0 - 3, cz]);
    }
  };
  // Columns stand where no road passes beneath the deck: every candidate position is moved a few samples along the deck
  // until the ground below is clear (a street may run under the freeway), otherwise that span is simply longer.
  for (const br of net.bridges) {
    const r = net.byId.get(br.roadId)!;
    if (!nearRect(r, 30)) continue;
    const f = frameOf(r);
    const freeway = r.cls === 'freeway';
    const W = r.hw + (freeway ? 0.6 : 0.45);
    const viaduct = br.kind === 'viaduct';
    const spacing = Math.round((freeway ? 30 : viaduct ? 24 : 13) / STEP);
    const colW = freeway ? 2.4 : viaduct ? 1.7 : 1.5;
    let last = br.i0;
    for (let target = br.i0 + spacing; target < br.i1 - 1; target += spacing) {
      let pick = -1;
      for (const d of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) {
        const ii = target + d;
        if (ii <= last + 4 || ii >= br.i1 - 1) continue;
        const p = r.pts[ii];
        if (viaduct && groundRoadEdge(p.x, p.z, r) < colW / 2 + 2.4) continue;
        pick = ii;
        break;
      }
      if (pick < 0) continue;
      last = pick;
      const i = pick;
      const p = r.pts[i];
      if (!inRect(p.x, p.z)) continue;
      const base = terrainHeight(p.x, p.z) - 0.6;
      const drop = viaduct ? (freeway ? 1.7 : 1.15) : DECK_DROP;
      const top = p.y - drop;
      if (top - base < 1.2) continue;
      const rotY = Math.atan2(f.tx[i], f.tz[i]);
      if (viaduct) {
        // column + cap beam under the deck
        const capH = freeway ? 1.3 : 0.9;
        concBox(2 * W - 0.8, capH, colW + 0.6, p.x, top - capH / 2, p.z, rotY, [0.88, 0.87, 0.85], true);
        concBox(colW, top - capH - base, colW, p.x, (top - capH + base) / 2, p.z, rotY, [0.97, 0.97, 0.95]);
        const c = Math.abs(Math.cos(rotY));
        const s = Math.abs(Math.sin(rotY));
        const hx = (colW / 2) * (c + s);
        colliders.push({ id: `cpier_${r.id}_${i}`, minX: p.x - hx, maxX: p.x + hx, minZ: p.z - hx, maxZ: p.z + hx, y0: base, y1: top, userData: { type: 'prop', id: 'bridge_pier' } });
      } else {
        concBox(2 * W - 1, top - base, 1.5, p.x, (top + base) / 2, p.z, rotY, [0.97, 0.97, 0.95]);
      }
    }
  }

  // ---- 4. junction corners + crossings ---------------------------------------------------------------
  for (const j of net.junctions) {
    if (j.kind !== 'tee') continue;
    const side = net.byId.get(j.roadId)!;
    const host = net.byId.get(j.hostId)!;
    const sf = frameOf(side);
    const hf = frameOf(host);
    const k = j.hostIdx;
    const hc = host.pts[k];
    const th: [number, number] = [hf.tx[k], hf.tz[k]];
    const nh: [number, number] = [hf.nx[k], hf.nz[k]];
    const Ex = hc.x + nh[0] * j.side * host.hw;
    const Ez = hc.z + nh[1] * j.side * host.hw;
    if (!inRect(Ex, Ez)) continue;
    const away: [number, number] = [nh[0] * j.side, nh[1] * j.side];
    const rF = filletRadius(host.cls);
    const hy = hostYAlong(host, k, 0);
    const tone = TONE[side.cls] ?? 1;
    const yAt = (x: number, z: number): number => {
      const along = (x - hc.x) * th[0] + (z - hc.z) * th[1];
      const dist = (x - Ex) * away[0] + (z - Ez) * away[1];
      const wt = sstep(2, 14, dist);
      return hostYAlong(host, k, along) * (1 - wt) + hy * wt + 0.01;
    };
    for (const kk of [-1, 1]) {
      const Cx = Ex + kk * side.hw * th[0];
      const Cz = Ez + kk * side.hw * th[1];
      const Ox = Cx + away[0] * rF + kk * th[0] * rF;
      const Oz = Cz + away[1] * rF + kk * th[1] * rF;
      const ux = -kk * th[0];
      const uz = -kk * th[1];
      const wx = -away[0];
      const wz = -away[1];
      const arc = (rad: number, ph: number): [number, number] => [Ox + rad * (ux * Math.cos(ph) + wx * Math.sin(ph)), Oz + rad * (uz * Math.cos(ph) + wz * Math.sin(ph))];
      const pts: P3[] = [[Cx, yAt(Cx, Cz), Cz]];
      const M = 6;
      for (let m = 0; m <= M; m++) {
        const [x, z] = arc(rF, (m / M) * (Math.PI / 2));
        pts.push([x, yAt(x, z), z]);
      }
      asphalt.poly(pts, [tone, tone, tone], uvA);
      if (host.kerb) {
        // the rounded kerb + pavement that joins the host's pavement to the side road's
        for (let m = 0; m < M; m++) {
          const [x0, z0] = arc(rF, (m / M) * (Math.PI / 2));
          const [x1, z1] = arc(rF, ((m + 1) / M) * (Math.PI / 2));
          const [bx0, bz0] = arc(rF - PAVEMENT_W, (m / M) * (Math.PI / 2));
          const [bx1, bz1] = arc(rF - PAVEMENT_W, ((m + 1) / M) * (Math.PI / 2));
          const y0 = yAt(x0, z0);
          const y1 = yAt(x1, z1);
          const yb0 = yAt(bx0, bz0) - 0.01 + PAVEMENT_H;
          const yb1 = yAt(bx1, bz1) - 0.01 + PAVEMENT_H;
          paving.poly([[bx0, yb0, bz0], [bx1, yb1, bz1], [x1, y1 - 0.01 + PAVEMENT_H, z1], [x0, y0 - 0.01 + PAVEMENT_H, z0]], PAVER, uvP);
          asphalt.poly([[x0, y0, z0], [x1, y1, z1], [x1, y1 - 0.01 + PAVEMENT_H, z1], [x0, y0 - 0.01 + PAVEMENT_H, z0]], PAVER, uvP, [2 * x0 - bx0, y0 + 0.5, 2 * z0 - bz0]); // the kerb face looks at the road: away from the pavement
        }
      }
    }
    // zebra crossing across the side road, just outside the kerb returns
    if (side.kerb && !side.cul && side.cls !== 'freeway') {
      const n = side.pts.length;
      const atStart = Math.hypot(side.pts[0].x - Ex, side.pts[0].z - Ez) < Math.hypot(side.pts[n - 1].x - Ex, side.pts[n - 1].z - Ez);
      const sAt = atStart ? rF + 1.2 : side.pts[n - 1].s - (rF + 1.2);
      const i = Math.max(0, Math.min(n - 2, Math.round(sAt / STEP)));
      const SE = (off: number, dy: number, ii: number): P3 => {
        const p = side.pts[ii];
        return [p.x + sf.nx[ii] * off, p.y + dy, p.z + sf.nz[ii] * off];
      };
      if (!side.pts[i].bridge && inRect(side.pts[i].x, side.pts[i].z)) {
        const len = 3.0;
        const j2 = Math.max(0, Math.min(n - 1, i + (atStart ? 1 : -1)));
        const stripes = Math.floor((2 * side.hw - 1) / 1.0);
        for (let m = 0; m < stripes; m++) {
          const o0 = -side.hw + 0.7 + m * ((2 * side.hw - 1.4) / stripes);
          const o1 = o0 + 0.5;
          // the crossing is len metres wide along the road: use the straight run of the side road
          const a0 = SE(o0, 0.019, i);
          const a1 = SE(o1, 0.019, i);
          const dxz: [number, number] = [sf.tx[i] * (atStart ? 1 : -1) * len, sf.tz[i] * (atStart ? 1 : -1) * len];
          // every bar has its own age: slightly different white, so a crossing never looks like one fresh stencil
          const jh = (((Math.imul(m + 1, 2654435761) ^ Math.imul(i + 7, 40503)) >>> 0) % 1000) / 1000;
          const bar: C3 = [WHITE[0] * (0.86 + 0.12 * jh), WHITE[1] * (0.86 + 0.12 * jh), WHITE[2] * (0.86 + 0.12 * jh)];
          marks.poly([a0, a1, [a1[0] + dxz[0], a1[1], a1[2] + dxz[1]], [a0[0] + dxz[0], a0[1], a0[2] + dxz[1]]], bar, uvM);
        }
        void j2;
      }
    }
  }
  yield;

  // ---- 5. merge road meshes -----------------------------------------------------------------------
  addMesh(asphalt.geometry(), mats.asphaltMat, false, true);
  addMesh(paving.geometry(), mats.pavingMat, false, true);
  addMesh(gravel.geometry(), mats.gravelMat, false, true);
  addMesh(marks.geometry(), mats.marksMat, false, false, 1);
  addMesh(conc.geometry(), getConcreteMaterial('wall'), true, true);
  addMesh(concTop.geometry(), getConcreteMaterial('top'), true, true);
  addMesh(joints.geometry(), getJointMaterial(), false, true, 1);

  // ---- 6. streetlights ---------------------------------------------------------------------------------
  for (const r of net.roads) {
    if (r.cls === 'rural' || r.cls === 'mountain' || !nearRect(r, 20)) continue;
    const f = frameOf(r);
    const freeway = r.cls === 'freeway';
    const spacing = freeway ? 42 : r.cls === 'main' ? 36 : r.cls === 'secondary' ? 42 : 46;
    const total = r.pts[r.pts.length - 1].s;
    for (let k = 1; k * spacing < total - 20; k++) {
      const s = k * spacing + ((hashString(`cl:${r.id}:${k}`) % 100) - 50) * 0.04;
      const i = Math.min(r.pts.length - 2, Math.round(s / STEP));
      const p = r.pts[i];
      if (p.bridge !== r.pts[i + 1].bridge) continue;
      if (r.mouths.some((m) => p.s >= m.s0 - 24 && p.s <= m.s1 + 24)) continue;
      if (r.hostJoins.some((j) => Math.abs(p.s - j.s) < j.hw + 14)) continue;
      if (r.cul && total - p.s < 20) continue;
      if (freeway) {
        // two heads back to back on the median barrier: one over each carriageway
        for (const sg of [-1, 1]) {
          const x = p.x;
          const z = p.z;
          if (!inRect(x, z)) continue;
          lamps.push({ x, y: p.y + 0.95, z, rotY: Math.atan2(f.nx[i] * sg, f.nz[i] * sg), scale: 1.25, variant: 1 });
        }
        continue;
      }
      const sg = k % 2 === 0 ? 1 : -1;
      const deck = p.bridge;
      const out = p.curb > 0.5 ? PAVEMENT_W * 0.5 : 1.0; // metres out from the asphalt edge
      const off = sg * (deck ? r.hw + 0.1 : r.hw + out);
      const x = p.x + f.nx[i] * off;
      const z = p.z + f.nz[i] * off;
      if (!inRect(x, z)) continue;
      const variant = r.cls === 'main' ? 1 : 0;
      // the post stands on the pavement, or on the gravel verge ramp (which falls to the terrain bed: same formula as groundHeightAt)
      const padPw = PAVEMENT_W * p.curb;
      const padTop = PAVEMENT_H * p.curb;
      const vu = Math.min(1, Math.max(0, (out - padPw) / SHOULDER));
      const lampY = deck ? 0.02 : out <= padPw ? padTop : padTop + (GRAVEL_LIP - bedDepth(p.s) - p.dip - padTop) * vu;
      lamps.push({ x, y: p.y + lampY, z, rotY: Math.atan2(-f.nx[i] * sg, -f.nz[i] * sg), scale: 1, variant });
    }
  }

  // ---- 7. trees (the Terrain Road oak: near cells get the full tree, far cells the round proxy) + grass tufts -----
  {
    const oaks: OakSpec[] = [];
    const tufts: TuftSpec[] = [];
    const rng = makeRng(hashString(`ctrees:${rect.minX}:${rect.minZ}`));
    // street trees: along the verge of the kerbed streets, clear of junction mouths, buildings and district plots
    for (const r of net.roads) {
      if (!r.kerb || r.cls === 'freeway' || !nearRect(r, 10)) continue;
      const total = r.pts[r.pts.length - 1].s;
      const gap = r.cls === 'residential' ? 19 : 25;
      for (let s = 9 + (hashString(`st:${r.id}`) % 7); s < total - 9; s += gap + (hashString(`sg:${r.id}:${Math.round(s)}`) % 7)) {
        const i = Math.min(r.pts.length - 2, Math.round(s / STEP));
        const p = r.pts[i];
        if (p.bridge || p.lift > 0.05) continue;
        const sgn = (hashString(`ss:${r.id}:${Math.round(s)}`) & 1) === 0 ? 1 : -1;
        if (inPavementCut(r, p.s, sgn as 1 | -1)) continue;
        const x = p.x + f2(r, i).nx * sgn * (r.hw + PAVEMENT_W + 0.9);
        const z = p.z + f2(r, i).nz * sgn * (r.hw + PAVEMENT_W + 0.9);
        if (!inRect(x, z)) continue;
        if (plan.occupied(x, z, 1.4) || cityWild(x, z) > 0.5) continue;
        if (roadEdgeDistance(x, z) < 0.2) continue;
        oaks.push({ x, y: p.y - 0.05, z, s: 0.5 + (hashString(`sz:${r.id}:${Math.round(s)}`) % 20) / 100, rot: ((hashString(`sr:${r.id}:${Math.round(s)}`) % 628) / 100), tint: rng() });
      }
    }
    const tries = near ? 520 : 200;
    const cap = oaks.length + (near ? 70 : 60);
    for (let t = 0; t < tries && oaks.length < cap; t++) {
      const x = rect.minX + rng() * (rect.maxX - rect.minX);
      const z = rect.minZ + rng() * (rect.maxZ - rect.minZ);
      const q = rng();
      const info = terrainInfo(x, z);
      const h0 = info.h;
      if (info.wet > 0.05 || info.road > 0.3) continue;
      if (q > 1 - sstep(30, 48, h0)) continue;
      // clustered: a soft noise mask makes woods and clearings; inside the city only hills / parkland are wooded, the plain gets garden trees
      const wood = 0.5 + 0.5 * Math.sin(x * 0.021 + 1.3) * Math.sin(z * 0.017 - 0.4);
      const dens = inCorner(x, z) ? 1 : 0.1 + 0.9 * cityWild(x, z);
      if (rng() > (0.25 + wood * 0.9) * dens) continue;
      if (roadEdgeDistance(x, z) < 5) continue;
      if (!inCorner(x, z) && plan.occupied(x, z, 3.5)) continue;
      const sl = Math.hypot(terrainHeight(x + 2, z) - terrainHeight(x - 2, z), terrainHeight(x, z + 2) - terrainHeight(x, z - 2)) / 4;
      if (sl > 0.5) continue;
      const sc = (0.8 + rng() * 0.7) * 0.72;
      const rot = rng() * 6.283;
      const tint = rng();
      // crowns must not pile up inside each other
      if (oaks.some((o) => Math.hypot(o.x - x, o.z - z) < 5.5 * Math.max(o.s, sc) + 1)) continue;
      oaks.push({ x, y: h0 - 0.05, z, s: sc, rot, tint });
    }
    if (near) {
      // short grass: denser at the roadsides, thin on the hills, none on rock, water or tarmac
      for (let t = 0; t < 1300 && tufts.length < 900; t++) {
        const x = rect.minX + rng() * (rect.maxX - rect.minX);
        const z = rect.minZ + rng() * (rect.maxZ - rect.minZ);
        const ts = 0.6 + rng() * 0.6;
        const rot = rng() * 6.283;
        const tint = rng();
        const keep = rng();
        const info = terrainInfo(x, z);
        const h0 = info.h;
        if (info.wet > 0.02 || info.road > 0.15 || h0 > 34) continue;
        if (keep < sstep(22, 34, h0)) continue;
        const edge = roadEdgeDistance(x, z);
        if (edge < 1.2) continue;
        if (edge > 14 && keep > 0.45) continue;
        if (!inCorner(x, z) && plan.occupied(x, z, 0.8)) continue;
        const sl = Math.hypot(terrainHeight(x + 1, z) - terrainHeight(x - 1, z), terrainHeight(x, z + 1) - terrainHeight(x, z - 1)) / 2;
        if (sl > 0.45) continue;
        tufts.push({ x, y: h0 - 0.05, z, s: edge < 8 ? ts * 0.6 : ts, rot, tint });
      }
    }
    for (const built of [buildOaks(oaks, near), buildTufts(tufts)]) {
      if (!built) continue;
      group.add(built.group);
      disposables.push(...built.disposables);
    }
  }

  return { group, disposables, colliders, lamps };
}

/** cached road frame (normals) for the tree pass */
function f2(r: CurvedRoad, i: number): { nx: number; nz: number } {
  const f = frameOf(r);
  return { nx: f.nx[i], nz: f.nz[i] };
}
