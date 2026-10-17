/**
 * CityDistricts - pure data for chunk 3, "the city itself" (no THREE, no DOM, deterministic).
 *
 * The middle ring of the grid city (blocks whose centre lies within RING of the origin, outside the hand-built
 * core, not a park, not touching a hand-modelled lot) is redesigned block by block. The straight grid roads,
 * the core and the landmarks stay exactly as they were; the INSIDE of each chosen block becomes one of four
 * modern styles, each laid out in a local frame (u across the block, v inward from the street it faces):
 *
 *   crescent  curved cul-de-sac lane with cantilevered flat-roof villas (cube / wing / terrace)
 *   glass     paved plaza with a fountain, stepped glass towers fanned round it and a canopy cafe
 *   park      "sky garden" park: looping path, two ponds, pavilion, playground, dense oak groves
 *   mews      terraced 3-storey townhouses with colour-blocked fronts either side of a lane + turning circle
 *
 * Everything is validated while it is generated (inside the block, no overlaps, clear of lanes / ponds / lots), so
 * the builder can draw whatever this module returns. Buildings face local +z; `rot` is the rotation about Y.
 */
import { WorldLayout, CORE_HALF } from './WorldLayout';
import { hashString, makeRng } from '../travel/Geo';
import { reservedOverlaps } from '../buildings/lots';
import { getCityBuildings } from './CityBuildings';

export type V2 = [number, number];
export type DistrictStyle = 'crescent' | 'glass' | 'park' | 'mews';
export type BType = 'villaCube' | 'villaWing' | 'villaTerrace' | 'tower' | 'townhouse' | 'cafe' | 'pavilion' | 'playground';

export interface DBuilding {
  id: string;
  type: BType;
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
  floors: number;
  c1: string;
  c2: string;
  c3: string;
  seed: number;
}
export interface DPatch { kind: 'paver' | 'lawn' | 'bed'; x: number; z: number; w: number; d: number; rot: number; color: string }
export interface DPond { x: number; z: number; r: number }
export interface DDisc { x: number; z: number; r: number }
export interface DPolyline { pts: V2[]; width: number; closed: boolean }
export interface DLamp { x: number; z: number; rot: number }
export interface DTree { x: number; z: number; s: number }

export interface District {
  i: number;
  j: number;
  style: DistrictStyle;
  name: string;
  seed: number;
  cx: number;
  cz: number;
  /** world bounding box of the plot (coarse tests only: the plot itself is an oriented rectangle, see W / D / rot) */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** the plot is an oriented rectangle: W across the street, D deep; (ivx, ivz) = unit vector from the street into the plot */
  W: number;
  D: number;
  ivx: number;
  ivz: number;
  /** yaw of the rectangle in the OBB convention of obbCorners (local x = across, local z = inward) */
  rot: number;
  buildings: DBuilding[];
  lanes: DPolyline[];
  discs: DDisc[];
  paths: DPolyline[];
  patches: DPatch[];
  ponds: DPond[];
  trees: DTree[];
  lamps: DLamp[];
}

export const RING = 310;
export const LANE_HW = 3.2;
const SW = 2.4;
const STYLES: DistrictStyle[] = ['crescent', 'glass', 'park', 'mews'];
export const STYLE_NAMES: Record<DistrictStyle, string> = {
  crescent: 'Crescent Villas',
  glass: 'Glass Quarter',
  park: 'Sky Garden Park',
  mews: 'The Mews',
};

// ---------------------------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------------------------

const dist2 = (a: V2, b: V2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** uniform Catmull-Rom through ctrl, resampled to even arc length */
export function smoothPath(ctrl: V2[], step: number, closed = false): V2[] {
  const n = ctrl.length;
  const get = (k: number): V2 => (closed ? ctrl[((k % n) + n) % n] : ctrl[Math.min(n - 1, Math.max(0, k))]);
  const fine: V2[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const N = Math.max(4, Math.ceil(dist2(p1, p2) / 0.5));
    for (let k = 0; k < N; k++) {
      const t = k / N;
      const t2 = t * t;
      const t3 = t2 * t;
      fine.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  fine.push(closed ? fine[0] : ctrl[n - 1]);
  const out: V2[] = [fine[0]];
  let carry = 0;
  for (let i = 1; i < fine.length; i++) {
    const a = fine[i - 1];
    const b = fine[i];
    const seg = dist2(a, b);
    if (seg === 0) continue;
    let at = step - carry;
    while (at <= seg) {
      const t = at / seg;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      at += step;
    }
    carry = seg - (at - step);
  }
  const last = fine[fine.length - 1];
  if (!closed) {
    if (dist2(out[out.length - 1], last) > step * 0.35) out.push(last);
    else out[out.length - 1] = last;
  } else if (dist2(out[out.length - 1], out[0]) < step * 0.5 && out.length > 3) out.pop();
  return out;
}

interface OBB { x: number; z: number; hw: number; hd: number; rot: number }

export function obbCorners(o: OBB): V2[] {
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  const out: V2[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const lx = sx * o.hw;
    const lz = sz * o.hd;
    out.push([o.x + lx * c + lz * s, o.z - lx * s + lz * c]);
  }
  return out;
}

/** separating-axis test; pad = extra gap that must remain between the two (can be 0) */
export function obbOverlap(a: OBB, b: OBB, pad = 0): boolean {
  const axes: V2[] = [
    [Math.cos(a.rot), -Math.sin(a.rot)], [Math.sin(a.rot), Math.cos(a.rot)],
    [Math.cos(b.rot), -Math.sin(b.rot)], [Math.sin(b.rot), Math.cos(b.rot)],
  ];
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  for (const ax of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of ca) { const d = p[0] * ax[0] + p[1] * ax[1]; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const p of cb) { const d = p[0] * ax[0] + p[1] * ax[1]; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 + pad <= b0 || b1 + pad <= a0) return false;
  }
  return true;
}

export function distPointToObb(px: number, pz: number, o: OBB): number {
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  const lx = c * (px - o.x) - s * (pz - o.z);
  const lz = s * (px - o.x) + c * (pz - o.z);
  return Math.hypot(Math.max(Math.abs(lx) - o.hw, 0), Math.max(Math.abs(lz) - o.hd, 0));
}

/** world-space axis-aligned boxes approximating a rotated rectangle (exact AABB of each slice along the long side) */
export function rotatedColliders(x: number, z: number, w: number, d: number, rot: number): { minX: number; maxX: number; minZ: number; maxZ: number }[] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  if (Math.abs(s * c) < 1e-3) {
    const hx = (Math.abs(c) > 0.5 ? w : d) / 2;
    const hz = (Math.abs(c) > 0.5 ? d : w) / 2;
    return [{ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz }];
  }
  const alongX = w >= d; // long side along local x
  const L = Math.max(w, d);
  const S = Math.min(w, d);
  const n = Math.min(10, Math.max(1, Math.ceil(L / Math.max(2.5, S * 0.6))));
  const out: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  for (let k = 0; k < n; k++) {
    const t = -L / 2 + ((k + 0.5) * L) / n;
    const lx = alongX ? t : 0;
    const lz = alongX ? 0 : t;
    const wx = x + lx * c + lz * s;
    const wz = z - lx * s + lz * c;
    const a = L / n / 2;
    const b = S / 2;
    // half extents of the slice (a along the long axis, b along the short one) in world space
    const hx = alongX ? a * Math.abs(c) + b * Math.abs(s) : b * Math.abs(c) + a * Math.abs(s);
    const hz = alongX ? a * Math.abs(s) + b * Math.abs(c) : b * Math.abs(s) + a * Math.abs(c);
    out.push({ minX: wx - hx, maxX: wx + hx, minZ: wz - hz, maxZ: wz + hz });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// local frame: u across the block (centred), v inward from the street the district faces
// ---------------------------------------------------------------------------------------------

class Frame {
  readonly cx: number;
  readonly cz: number;
  /** unit vector from the street into the plot, and the across-street unit vector */
  readonly ivx: number;
  readonly ivz: number;
  readonly uvx: number;
  readonly uvz: number;
  readonly rot: number;
  constructor(cx: number, cz: number, ivx: number, ivz: number, readonly W: number, readonly D: number) {
    this.cx = cx;
    this.cz = cz;
    this.ivx = ivx;
    this.ivz = ivz;
    this.uvx = ivz;
    this.uvz = -ivx;
    this.rot = Math.atan2(ivx, ivz);
  }
  /** local (u across, v inward from the street edge) -> world */
  pt(u: number, v: number): V2 {
    const mx = this.cx - this.ivx * (this.D / 2);
    const mz = this.cz - this.ivz * (this.D / 2);
    return [mx + this.uvx * u + this.ivx * v, mz + this.uvz * u + this.ivz * v];
  }
  dir(du: number, dv: number): V2 {
    return [this.uvx * du + this.ivx * dv, this.uvz * du + this.ivz * dv];
  }
  /** rotation about Y that makes a building's front (+z) face the local direction (du, dv) */
  facing(du: number, dv: number): number {
    const d = this.dir(du, dv);
    return Math.atan2(d[0], d[1]);
  }
  /** is the world point inside the plot, m inside its edge? */
  inside(x: number, z: number, m = 0): boolean {
    const dx = x - this.cx;
    const dz = z - this.cz;
    const u = dx * this.uvx + dz * this.uvz;
    const v = dx * this.ivx + dz * this.ivz;
    return Math.abs(u) <= this.W / 2 - m && Math.abs(v) <= this.D / 2 - m;
  }
  /** a uniformly random point of the plot, edgeInset m from its edge */
  random(rng: () => number, edgeInset: number): V2 {
    return this.pt((rng() - 0.5) * (this.W - 2 * edgeInset), edgeInset + rng() * (this.D - 2 * edgeInset));
  }
}

// ---------------------------------------------------------------------------------------------
// palettes
// ---------------------------------------------------------------------------------------------

const WHITES = ['#f4f2ee', '#ebe8e1', '#f0ede6', '#e4e1da'];
const DARKS = ['#3b3f45', '#2f3438', '#474b52', '#40454a'];
const WOODS = ['#9b6b43', '#a77a50', '#8a5d3a', '#b08a5e'];
const ACCENTS = ['#c4684a', '#2f7f86', '#d9a441', '#6a8f5d', '#7a8ea8', '#b4575f'];
const SANDS = ['#d8c7a8', '#cdbb9a', '#dccfb6'];
const GLASS_TINTS = ['#ffffff', '#dcecf6', '#e6f0e8', '#f2e9da', '#d8e4f0'];
const pick = <T,>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length)];

// ---------------------------------------------------------------------------------------------
// builder state
// ---------------------------------------------------------------------------------------------

class Builder {
  readonly d: District;
  private obbs: { o: OBB; pad: number }[] = [];
  private laneSamples: V2[] = [];
  constructor(d: District, readonly F: Frame, readonly rng: () => number) { this.d = d; }

  addLane(local: V2[], width = LANE_HW * 2): V2[] {
    const pts = local.map((p) => this.F.pt(p[0], p[1]));
    this.d.lanes.push({ pts, width, closed: false });
    this.laneSamples.push(...pts);
    return pts;
  }
  addDisc(u: number, v: number, r: number): void {
    const p = this.F.pt(u, v);
    this.d.discs.push({ x: p[0], z: p[1], r });
    for (let a = 0; a < 8; a++) this.laneSamples.push([p[0] + Math.cos((a * Math.PI) / 4) * r * 0.7, p[1] + Math.sin((a * Math.PI) / 4) * r * 0.7]);
  }
  addPond(u: number, v: number, r: number): void {
    const p = this.F.pt(u, v);
    this.d.ponds.push({ x: p[0], z: p[1], r });
  }
  addPath(local: V2[], width: number, closed: boolean): void {
    this.d.paths.push({ pts: local.map((p) => this.F.pt(p[0], p[1])), width, closed });
  }

  /** place a building (local centre u, v) facing local (fu, fv) if it fits; returns it or null */
  add(type: BType, u: number, v: number, w: number, dep: number, fu: number, fv: number, o: Partial<DBuilding> = {}, pad = 1.6): DBuilding | null {
    const p = this.F.pt(u, v);
    const rot = this.F.facing(fu, fv);
    const obb: OBB = { x: p[0], z: p[1], hw: w / 2, hd: dep / 2, rot };
    const m = 0.4;
    for (const c of obbCorners(obb)) {
      if (!this.F.inside(c[0], c[1], m)) return null;
    }
    for (const q of this.obbs) if (obbOverlap(obb, q.o, Math.max(pad, q.pad))) return null;
    for (const s of this.laneSamples) if (distPointToObb(s[0], s[1], obb) < LANE_HW + 1.4) return null;
    for (const pd of this.d.ponds) if (distPointToObb(pd.x, pd.z, obb) < pd.r + 2) return null;
    if (reservedOverlaps(p[0] - w, p[0] + w, p[1] - dep, p[1] + dep, 4)) return null;
    const idx = this.d.buildings.length;
    const b: DBuilding = {
      id: `dist_${this.d.i}_${this.d.j}_${idx}`, type, x: p[0], z: p[1], w, d: dep, rot, floors: 2,
      c1: WHITES[0], c2: DARKS[0], c3: WOODS[0], seed: hashString(`${this.d.seed}:${idx}`), ...o,
    };
    this.d.buildings.push(b);
    this.obbs.push({ o: obb, pad });
    return b;
  }

  clearOfAll(x: number, z: number, margin: number): boolean {
    for (const q of this.obbs) if (distPointToObb(x, z, q.o) < margin) return false;
    for (const s of this.laneSamples) if (dist2([x, z], s) < LANE_HW + margin) return false;
    for (const pd of this.d.ponds) if (dist2([x, z], [pd.x, pd.z]) < pd.r + margin) return false;
    for (const dc of this.d.discs) if (dist2([x, z], [dc.x, dc.z]) < dc.r + margin) return false;
    for (const pa of this.d.paths) for (const s of pa.pts) if (dist2([x, z], s) < pa.width / 2 + margin) return false;
    for (const pt of this.d.patches) if (pt.kind === 'paver' && Math.abs(pt.w - this.F.W) > 1 && distPointToObb(x, z, { x: pt.x, z: pt.z, hw: pt.w / 2, hd: pt.d / 2, rot: pt.rot }) < 0.5) return false;
    return true;
  }

  scatterTrees(count: number, s0: number, s1: number, margin = 2.4, edgeInset = 2): void {
    const d = this.d;
    for (let n = 0, tries = 0; n < count && tries < count * 14; tries++) {
      const [x, z] = this.F.random(this.rng, edgeInset);
      const s = s0 + this.rng() * (s1 - s0);
      if (!this.clearOfAll(x, z, margin)) continue;
      if (d.trees.some((t) => dist2([x, z], [t.x, t.z]) < 4.2)) continue;
      d.trees.push({ x, z, s });
      n++;
    }
  }

  lampsAlong(pts: V2[], every: number): void {
    let acc = every * 0.5;
    let side = 1;
    for (let k = 1; k < pts.length - 1; k++) {
      acc += dist2(pts[k], pts[k - 1]);
      if (acc < every) continue;
      acc = 0;
      const tx = pts[k + 1][0] - pts[k - 1][0];
      const tz = pts[k + 1][1] - pts[k - 1][1];
      const l = Math.hypot(tx, tz) || 1;
      const nx = (-tz / l) * side;
      const nz = (tx / l) * side;
      side = -side;
      const off = LANE_HW + 0.9;
      const x = pts[k][0] + nx * off;
      const z = pts[k][1] + nz * off;
      if (!this.F.inside(x, z, 1)) continue;
      if (this.obbs.some((q) => distPointToObb(x, z, q.o) < 1.2)) continue;
      this.d.lamps.push({ x, z, rot: Math.atan2(-nx, -nz) });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// the four styles
// ---------------------------------------------------------------------------------------------

function villaColors(r: () => number): Pick<DBuilding, 'c1' | 'c2' | 'c3'> {
  const dark = r() < 0.4;
  return { c1: dark ? pick(r, DARKS) : r() < 0.7 ? pick(r, WHITES) : pick(r, SANDS), c2: dark ? pick(r, WHITES) : r() < 0.5 ? pick(r, DARKS) : pick(r, WOODS), c3: r() < 0.55 ? pick(r, WOODS) : pick(r, ACCENTS) };
}

function layoutCrescent(B: Builder): void {
  const { F, rng, d } = B;
  const W = F.W;
  const Dp = F.D;
  const a = 0.25 * W;
  const lane = smoothPath(
    [[-a, -3], [-a, 0.1 * Dp], [-a * 1.02, 0.36 * Dp], [-a * 0.55, 0.58 * Dp], [0, 0.64 * Dp], [a * 0.55, 0.58 * Dp], [a * 1.02, 0.36 * Dp], [a, 0.1 * Dp], [a, -3]],
    2.2
  );
  const world = B.addLane(lane);
  B.lampsAlong(world, 26);
  // villas on the outer side of the crescent, facing the lane
  const centroid: V2 = [0, 0.3 * Dp];
  let acc = 0;
  let next = 9 + rng() * 4;
  let idx = 0;
  const types: BType[] = ['villaCube', 'villaWing', 'villaTerrace'];
  for (let k = 1; k < lane.length - 1; k++) {
    acc += dist2(lane[k], lane[k - 1]);
    if (acc < next) continue;
    acc = 0;
    next = 15 + rng() * 4;
    const tx = lane[k + 1][0] - lane[k - 1][0];
    const tv = lane[k + 1][1] - lane[k - 1][1];
    const l = Math.hypot(tx, tv) || 1;
    let nu = -tv / l;
    let nv = tx / l;
    if ((lane[k][0] - centroid[0]) * nu + (lane[k][1] - centroid[1]) * nv < 0) { nu = -nu; nv = -nv; }
    if (lane[k][1] < 0.04 * Dp) continue; // the mouths: corner villas below handle those
    const w = 12 + rng() * 3;
    const dep = 10 + rng() * 2;
    const off = LANE_HW + SW + 1.6 + dep / 2;
    const type = types[(idx + Math.floor(rng() * 3)) % 3];
    B.add(type, lane[k][0] + nu * off, lane[k][1] + nv * off, w, dep, -nu, -nv, { ...villaColors(rng), floors: type === 'villaTerrace' ? 3 : 2 });
    idx++;
  }
  // island villa + two corner villas that face the street
  B.add('villaTerrace', 0, 0.3 * Dp, 15, 11, 0, -1, { ...villaColors(rng), floors: 3 });
  for (const s of [-1, 1]) B.add(types[Math.floor(rng() * 3)], s * (a + LANE_HW + SW + 8.5), 9, 11.5, 10, 0, -1, { ...villaColors(rng), floors: 2 });
  d.patches.push({ kind: 'lawn', x: F.cx, z: F.cz, w: F.W, d: F.D, rot: F.rot, color: '#ffffff' });
  B.scatterTrees(12, 0.85, 1.25);
}

function layoutGlass(B: Builder): void {
  const { F, rng, d } = B;
  const W = F.W;
  const Dp = F.D;
  d.patches.push({ kind: 'paver', x: F.cx, z: F.cz, w: F.W, d: F.D, rot: F.rot, color: '#cfcabd' });
  B.addPond(0, 0.4 * Dp, Math.min(7, W * 0.09));
  const towers: [number, number, number, number, number, number][] = [
    // u, v (fractions), w, d, floors lo, hi
    [-0.27, 0.74, 20, 17, 20, 30],
    [0.26, 0.74, 18, 16, 15, 24],
    [-0.3, 0.3, 16, 14, 8, 13],
  ];
  let k = 0;
  for (const [fu, fv, w, dep, lo, hi] of towers) {
    const u = fu * W;
    const v = fv * Dp;
    const fx = 0 - u;
    const fz = 0.4 * Dp - v;
    const snap = Math.round(Math.atan2(fx, fz) / 0.15) * 0.15; // face the plaza, snapped so the fan looks deliberate
    const ang = Math.atan2(fx, fz);
    void snap;
    B.add('tower', u, v, w, dep, Math.sin(ang), Math.cos(ang), { floors: lo + Math.floor(rng() * (hi - lo + 1)), c1: pick(rng, GLASS_TINTS), c2: pick(rng, DARKS), c3: pick(rng, ['#9aa7b4', '#b8c0c8', '#8e99a6']) }, 2.5);
    k++;
  }
  B.add('cafe', 0.28 * W, 0.2 * Dp, 15, 9, 0, 1, { floors: 1, c1: pick(rng, WHITES), c2: pick(rng, WOODS), c3: pick(rng, ACCENTS) }, 2.5);
  // lawn strips + planting beds along the street edge
  d.patches.push({ kind: 'lawn', x: F.pt(-0.3 * W, 0.05 * Dp)[0], z: F.pt(-0.3 * W, 0.05 * Dp)[1], w: 0.2 * W, d: 6, rot: F.rot, color: '#ffffff' });
  for (const [u, v] of [[-0.12, 0.62], [0.12, 0.2], [-0.05, 0.02]] as const) {
    const p = F.pt(u * W, v * Dp);
    d.patches.push({ kind: 'bed', x: p[0], z: p[1], w: 9, d: 3, rot: F.rot, color: pick(rng, ['#5f9a4a', '#6aa557', '#4f8a43']) });
  }
  B.scatterTrees(9, 0.6, 0.85, 2.2);
}

function layoutPark(B: Builder): void {
  const { F, rng, d } = B;
  const W = F.W;
  const Dp = F.D;
  d.patches.push({ kind: 'lawn', x: F.cx, z: F.cz, w: F.W, d: F.D, rot: F.rot, color: '#ffffff' });
  const loop: V2[] = [];
  for (let n = 0; n < 14; n++) {
    const th = (n / 14) * Math.PI * 2;
    const wob = 1 + 0.13 * Math.sin(th * 3 + 0.8);
    loop.push([Math.cos(th) * 0.35 * W * wob, 0.52 * Dp + Math.sin(th) * 0.33 * Dp * wob]);
  }
  B.addPond(-0.09 * W, 0.46 * Dp, Math.min(8.5, 0.11 * Dp));
  B.addPond(0.14 * W, 0.62 * Dp, Math.min(5.5, 0.07 * Dp));
  B.add('pavilion', 0.24 * W, 0.2 * Dp, 11, 7, 0, 1, { floors: 1, c1: pick(rng, WOODS), c2: pick(rng, WHITES), c3: pick(rng, ACCENTS) }, 3);
  B.add('playground', -0.25 * W, 0.2 * Dp, 15, 11, 0, 1, { floors: 1, c1: pick(rng, ACCENTS), c2: pick(rng, ACCENTS), c3: pick(rng, ACCENTS) }, 3);
  B.add('cafe', 0.2 * W, 0.84 * Dp, 11, 7, 0, -1, { floors: 1, c1: pick(rng, WHITES), c2: pick(rng, WOODS), c3: pick(rng, ACCENTS) }, 3);
  B.addPath(loop, 2.6, true);
  B.addPath([[0, -3], [0, 0.18 * Dp]], 2.8, false);
  B.scatterTrees(30, 0.95, 1.45, 2.2, 3);
}

function layoutMews(B: Builder): void {
  const { F, rng, d } = B;
  const W = F.W;
  const Dp = F.D;
  const end = 0.8 * Dp;
  const lane = smoothPath([[0, -3], [0, end]], 2.2);
  const world = B.addLane(lane);
  B.addDisc(0, end + 2, 6.5);
  B.lampsAlong(world, 22);
  d.patches.push({ kind: 'lawn', x: F.cx, z: F.cz, w: F.W, d: F.D, rot: F.rot, color: '#ffffff' });
  const dep = 10.5;
  const uw = 5.4;
  const front = LANE_HW + 2.2 + dep / 2;
  const n = Math.floor((end - 8) / uw);
  const palette = [pick(rng, WHITES), pick(rng, DARKS), pick(rng, SANDS), pick(rng, WHITES)];
  for (const side of [-1, 1]) {
    for (let k = 0; k < n; k++) {
      const v = 5 + uw * (k + 0.5);
      const floors = (k + (side > 0 ? 1 : 0)) % 4 === 3 ? 2 : 3;
      B.add('townhouse', side * front, v, uw - 0.15, dep, -side, 0, {
        floors,
        c1: palette[(k + (side > 0 ? 2 : 0)) % palette.length],
        c2: k % 3 === 0 ? pick(rng, ACCENTS) : k % 3 === 1 ? pick(rng, WOODS) : pick(rng, DARKS),
        c3: pick(rng, WOODS),
      }, 0);
    }
  }
  B.scatterTrees(14, 0.8, 1.1, 2.2, 3);
}

// ---------------------------------------------------------------------------------------------
// plots: oriented rectangles along the curved streets (chosen by CityBuildings.ts)
// ---------------------------------------------------------------------------------------------

export interface DistrictPlot {
  index: number;
  style: DistrictStyle;
  seed: number;
  cx: number;
  cz: number;
  /** unit vector from the street into the plot */
  ivx: number;
  ivz: number;
  W: number;
  D: number;
}

/** build one district's content (pure + deterministic) on an oriented plot */
export function makeDistrictAt(p: DistrictPlot): District {
  const F = new Frame(p.cx, p.cz, p.ivx, p.ivz, p.W, p.D);
  // world bounding box of the rectangle
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [u, v] of [[-p.W / 2, 0], [p.W / 2, 0], [-p.W / 2, p.D], [p.W / 2, p.D]] as const) {
    const q = F.pt(u, v);
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]);
  }
  const d: District = {
    i: p.index, j: 0, style: p.style, name: STYLE_NAMES[p.style], seed: p.seed, cx: p.cx, cz: p.cz, x0, x1, z0, z1,
    W: p.W, D: p.D, ivx: p.ivx, ivz: p.ivz, rot: F.rot,
    buildings: [], lanes: [], discs: [], paths: [], patches: [], ponds: [], trees: [], lamps: [],
  };
  const B = new Builder(d, F, makeRng(p.seed ^ 0x9e3779b9));
  if (p.style === 'crescent') layoutCrescent(B);
  else if (p.style === 'glass') layoutGlass(B);
  else if (p.style === 'park') layoutPark(B);
  else layoutMews(B);
  return d;
}

/** is (x, z) inside the district's plot, m outside its edge? */
export function inDistrict(d: District, x: number, z: number, m = 0): boolean {
  const dx = x - d.cx;
  const dz = z - d.cz;
  return Math.abs(dx * d.ivz - dz * d.ivx) <= d.W / 2 + m && Math.abs(dx * d.ivx + dz * d.ivz) <= d.D / 2 + m;
}

/** every district of the city */
export function allDistricts(_layout?: WorldLayout): District[] {
  return getCityBuildings().districts;
}

/** the district at the block that owns grid cell (i, j): the grid is gone outside the downtown, so there never is one */
export function districtAtBlock(_layout: WorldLayout, _i: number, _j: number): District | null {
  return null;
}

/** the district name at a world point (for the HUD), or null outside every district plot */
export function districtNameAt(_layout: WorldLayout, x: number, z: number): string | null {
  for (const d of getCityBuildings().districts) if (inDistrict(d, x, z, 8)) return d.name;
  return null;
}

/** HUD / map name for a world point: the district when inside one, else the layout's zone name */
export function areaNameAt(layout: WorldLayout, x: number, z: number): string {
  return districtNameAt(layout, x, z) ?? layout.districtNameAt(x, z);
}
