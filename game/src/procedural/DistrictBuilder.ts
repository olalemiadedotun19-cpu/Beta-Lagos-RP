import * as THREE from 'three';
import { GeoBatch, hashString, makeRng } from '../travel/Geo';
import { Kit, setKitTransform, clearKitTransform } from '../travel/BuildingKit';
import { FLOOR, TILE_H, TILE_W, FacadeKind } from '../travel/TravelMaterials';
import { cafeSet } from '../travel/BuildingDetail';
import { BoundingBox2D } from '../world/SpatialGrid';
import { DBuilding, DPolyline, District, LANE_HW, V2, distPointToObb, inDistrict, rotatedColliders } from '../world/CityDistricts';
import { makePondGeometry } from './TerrainTextures';
import { POND_LEVEL } from '../world/CurvedRoads';
import type { OakSpec, TuftSpec } from './TerrainTrees';
import type { CurvedLamp } from './CurvedRoadBuilder';

/**
 * DistrictBuilder - turns one `District` (pure data, world/CityDistricts.ts) into geometry for the streamed cell that owns it.
 *
 * Everything is added to the cell's existing batches (kit.solid / kit.fac.* with the kit's group transform for the rotated
 * buildings, the lawn batch, the pond list, oaks / tufts, colliders, streetlights) plus one merged "ribbon" geometry for
 * the curved lanes, pavements, paths and turning circles. Far cells (near = false) skip the small props.
 */

export interface DistrictCtx {
  kit: Kit;
  lawn: GeoBatch;
  ponds: THREE.BufferGeometry[];
  oaks: OakSpec[];
  tufts: TuftSpec[];
  colliders: BoundingBox2D[];
  lamps: CurvedLamp[];
  /** merged flat geometry (lanes, pavements, paths); pushed by the cell with the vertex-coloured solid material */
  flat: THREE.BufferGeometry[];
  near: boolean;
}

const GLASS = '#1f3347';
const FRAME = '#2a2d31';
const SLAB = '#ecebe6';
const ASPHALT = '#34373c';
const KERB = '#cfcbc0';
const PAVER = '#bdb7aa';
const GREEN = '#6b9a55';

// ---------------------------------------------------------------------------------------------
// flat ribbons (lanes, pavements, paths)
// ---------------------------------------------------------------------------------------------

class FlatBatch {
  private pos: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private n = 0;
  private c = new THREE.Color();

  private quad(a: V2, b: V2, c: V2, d: V2, y: number): void {
    const base = this.n;
    for (const p of [a, b, c, d]) {
      this.pos.push(p[0], y, p[1]);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
    // winding: make sure the triangle normals point up
    const cr = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    if (cr >= 0) this.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    else this.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    this.n += 4;
  }

  /** strip along pts, centre offset `off` to the left, half width `hw` */
  strip(pts: V2[], off: number, hw: number, y: number, color: string, closed = false): void {
    this.c.set(color);
    const m = pts.length;
    const edge = (i: number): [V2, V2] => {
      const p = pts[i];
      const a = pts[closed ? (i - 1 + m) % m : Math.max(0, i - 1)];
      const b = pts[closed ? (i + 1) % m : Math.min(m - 1, i + 1)];
      const tx = b[0] - a[0];
      const tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      const nx = -tz / l;
      const nz = tx / l;
      const cx = p[0] + nx * off;
      const cz = p[1] + nz * off;
      return [[cx + nx * hw, cz + nz * hw], [cx - nx * hw, cz - nz * hw]];
    };
    const last = closed ? m : m - 1;
    for (let i = 0; i < last; i++) {
      const [l0, r0] = edge(i);
      const [l1, r1] = edge((i + 1) % m);
      this.quad(l0, r0, l1, r1, y);
    }
  }

  disc(x: number, z: number, r: number, y: number, color: string): void {
    this.c.set(color);
    const SEG = 24;
    const base = this.n;
    this.pos.push(x, y, z);
    this.col.push(this.c.r, this.c.g, this.c.b);
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      this.pos.push(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
    for (let k = 0; k < SEG; k++) this.idx.push(base, base + 1 + ((k + 1) % SEG), base + 1 + k);
    this.n += SEG + 1;
  }

  build(): THREE.BufferGeometry | null {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    const nor = new Float32Array(this.n * 3);
    for (let i = 0; i < this.n; i++) nor[i * 3 + 1] = 1;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.n * 2).fill(0.012), 2));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

function circle(x: number, z: number, r: number, n = 24): V2[] {
  const out: V2[] = [];
  for (let k = 0; k < n; k++) out.push([x + Math.cos((k / n) * Math.PI * 2) * r, z + Math.sin((k / n) * Math.PI * 2) * r]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// building drawing (local frame: x = width, z = depth, +z = front, y up; the kit transform places it)
// ---------------------------------------------------------------------------------------------

class Local {
  constructor(private kit: Kit, private near: boolean) {}
  /** box with its BOTTOM at y0 */
  box(w: number, h: number, d: number, x: number, y0: number, z: number, color: string, o?: { rotX?: number; rotY?: number; rotZ?: number }): void {
    this.kit.solid.box(w, h, d, x, y0 + h / 2, z, color, o);
  }
  fac(kind: FacadeKind, w: number, h: number, d: number, x: number, y0: number, z: number, color: string): void {
    this.kit.fac[kind].box(w, h, d, x, y0 + h / 2, z, color, { tile: [TILE_W, TILE_H] });
  }
  cyl(r: number, h: number, x: number, y0: number, z: number, color: string): void {
    this.kit.solid.cyl(r, h, x, y0 + h / 2, z, color);
  }
  cafeSet(x: number, z: number, color: string): void {
    let h = (Math.imul(Math.round(x * 100), 73856093) ^ Math.imul(Math.round(z * 100), 19349663)) >>> 0;
    const dr = (): number => ((h = (Math.imul(h, 1664525) + 1013904223) >>> 0) / 4294967296);
    cafeSet(this.kit, dr, x, z, color);
  }
  get isNear(): boolean {
    return this.near;
  }
  glow(w: number, h: number, d: number, x: number, y0: number, z: number, color: string): void {
    this.kit.glow.box(w, h, d, x, y0 + h / 2, z, color);
  }
  sphereGlow(r: number, x: number, y: number, z: number, color: string): void {
    this.kit.glow.sphere(r, r, r, x, y, z, color);
  }
}

function drawVillaCube(L: Local, b: DBuilding): void {
  const { w, d, c1, c2, c3 } = b;
  const h1 = 3.4;
  const h2 = 3.1;
  const gz = -d * 0.04;
  L.box(w, h1, d * 0.92, 0, 0, gz, c1); // ground floor
  const uw = w * 0.84;
  const ud = d * 0.74;
  const uz = d / 2 - ud / 2;
  const ux = w * 0.06;
  L.box(uw, h2, ud, ux, h1, uz, c2); // cantilevered upper volume
  L.box(uw + 0.5, 0.28, ud + 0.5, ux, h1 + h2, uz, SLAB); // roof slab
  L.box(w + 0.4, 0.24, d * 0.92 - ud + 0.4, 0, h1, gz - d * 0.46 + (d * 0.92 - ud) / 2 + 0.0, SLAB); // lower roof (terrace behind the upper volume)
  // glazing
  L.box(w * 0.62, 2.5, 0.12, -w * 0.12, 0.5, gz + d * 0.46 + 0.03, GLASS);
  L.box(uw * 0.7, 1.9, 0.12, ux, h1 + 0.6, uz + ud / 2 + 0.03, GLASS);
  L.box(w * 0.1, 2.6, 0.14, w * 0.3, 0, gz + d * 0.46 + 0.05, c3); // timber door panel
  if (L.isNear) {
    for (let k = 0; k < 4; k++) L.box(0.12, h2 - 0.2, 0.45, ux - uw * 0.35 + k * (uw * 0.7) / 3, h1, uz + ud / 2 + 0.2, c3); // timber fins
    L.box(w * 0.45, 0.05, d * 0.28, w * 0.05, h1 + h2 + 0.28, uz - ud * 0.2, '#1b2a44', { rotX: -0.3 }); // solar panels
    L.box(w * 0.32, 0.9, 0.12, -w * 0.2, 0, d / 2 + 2.2, SLAB); // gate wall
    L.box(w * 0.4, 0.08, 2.4, -w * 0.12, 0, d / 2 + 1.2, '#8b8b86'); // driveway
  }
}

function drawVillaWing(L: Local, b: DBuilding): void {
  const { w, d, c1, c2, c3 } = b;
  // two-storey wing at the back, single-storey timber wing in front, roof terrace on the front wing
  const bw = w * 0.62;
  const bd = d * 0.6;
  L.box(bw, 6.5, bd, -w * 0.19, 0, -d * 0.2, c1);
  L.box(bw + 0.5, 0.28, bd + 0.5, -w * 0.19, 6.5, -d * 0.2, SLAB);
  const fw = w * 0.62;
  const fd = d * 0.56;
  L.box(fw, 3.3, fd, w * 0.17, 0, d * 0.22, c3); // timber-clad front wing
  L.box(fw + 0.5, 0.25, fd + 0.5, w * 0.17, 3.3, d * 0.22, SLAB);
  L.box(fw * 0.76, 2.5, 0.12, w * 0.17, 0.4, d * 0.22 + fd / 2 + 0.03, GLASS);
  L.box(bw * 0.7, 2.6, 0.12, -w * 0.19, 0.6, -d * 0.2 + bd / 2 + 0.03, GLASS);
  L.box(bw * 0.7, 2.2, 0.12, -w * 0.19, 3.6, -d * 0.2 + bd / 2 + 0.03, GLASS);
  L.box(w * 0.22, 3.0, bd * 0.7, -w * 0.41, 6.5, -d * 0.2, c2); // rooftop volume
  if (L.isNear) {
    L.box(fw * 0.8, 0.9, 0.06, w * 0.17, 3.55, d * 0.22 + fd / 2 - 0.2, '#9fc3d6'); // glass balustrade
    L.box(5.2, 0.12, 3.0, -w * 0.38, 0, d * 0.34, '#59b4d6'); // pool
    L.box(5.8, 0.06, 3.6, -w * 0.38, 0, d * 0.34, '#d9d3c6');
  }
}

function drawVillaTerrace(L: Local, b: DBuilding): void {
  const { w, d, c1, c2, c3 } = b;
  const f = 3.3;
  L.box(w, f, d, 0, 0, 0, c1);
  L.box(w + 0.4, 0.22, d + 0.4, 0, f, 0, SLAB);
  L.box(w * 0.86, f, d * 0.78, -w * 0.07, f + 0.22, -d * 0.11, c2);
  L.box(w * 0.86 + 0.4, 0.22, d * 0.78 + 0.4, -w * 0.07, 2 * f + 0.22, -d * 0.11, SLAB);
  L.box(w * 0.58, f * 0.95, d * 0.55, -w * 0.2, 2 * f + 0.44, -d * 0.2, c1);
  L.box(w * 0.58 + 0.4, 0.22, d * 0.55 + 0.4, -w * 0.2, 3 * f + 0.2, -d * 0.2, SLAB);
  // big glazing on each level of the front
  L.box(w * 0.7, 2.4, 0.12, 0, 0.5, d / 2 + 0.03, GLASS);
  L.box(w * 0.6, 2.2, 0.12, -w * 0.07, f + 0.55, d * 0.28 + 0.03, GLASS);
  L.box(w * 0.4, 2.0, 0.12, -w * 0.2, 2 * f + 0.8, d * 0.075 + 0.03, GLASS);
  L.box(w * 0.14, 2.5, 0.16, w * 0.36, 0, d / 2 + 0.05, c3);
  if (L.isNear) {
    // planted terraces + glass railings
    L.box(w * 0.7, 0.35, 1.4, w * 0.05, f + 0.22, d / 2 - 0.7, GREEN);
    L.box(w * 0.7, 0.9, 0.05, w * 0.05, f + 0.57, d / 2 - 0.05, '#9fc3d6');
    L.box(w * 0.5, 0.35, 1.2, -w * 0.07, 2 * f + 0.44, d * 0.28 - 0.1 + 0.4, GREEN);
    L.box(w * 0.5, 0.9, 0.05, -w * 0.07, 2 * f + 0.8, d * 0.28 + 0.5, '#9fc3d6');
  }
}

function drawTower(L: Local, b: DBuilding): void {
  const { w, d, floors, c1, c2, c3 } = b;
  const pod = FLOOR * 2;
  L.fac('com', w, pod, d, 0, 0, 0, '#ffffff'); // podium
  L.box(w + 0.5, 0.5, d + 0.5, 0, pod, 0, c3);
  L.box(w * 0.7, 0.3, 4.5, 0, 2.8, d / 2 + 2.2, c2); // entrance canopy
  const sw = w * 0.8;
  const sd = d * 0.8;
  const shaft = FLOOR * floors;
  L.fac('office', sw, shaft, sd, 0, pod + 0.5, -d * 0.04, c1);
  let top = pod + 0.5 + shaft;
  if (floors > 17) {
    // stepped upper block
    const uh = FLOOR * 5;
    L.fac('office', sw * 0.72, uh, sd * 0.72, -sw * 0.06, top, -d * 0.04, c1);
    top += uh;
    L.box(sw * 0.72 + 0.4, 0.5, sd * 0.72 + 0.4, -sw * 0.06, top, -d * 0.04, c3);
    top += 0.5;
  } else {
    L.box(sw + 0.4, 0.6, sd + 0.4, 0, top, -d * 0.04, c3);
    top += 0.6;
  }
  L.box(sw * 0.35, 2.6, sd * 0.35, 0, top, -d * 0.04, '#aab1b8'); // plant room
  // vertical fins on the front corners
  L.box(0.4, shaft, 0.7, -sw / 2 + 0.2, pod + 0.5, -d * 0.04 + sd / 2 + 0.2, c2);
  L.box(0.4, shaft, 0.7, sw / 2 - 0.2, pod + 0.5, -d * 0.04 + sd / 2 + 0.2, c2);
  if (L.isNear) {
    L.cyl(0.1, 9, 0, top + 2.6, -d * 0.04, '#6b7280');
    L.sphereGlow(0.22, 0, top + 11.8, -d * 0.04, '#ff3030');
    L.glow(w * 0.6, 0.25, 0.08, 0, pod - 0.6, d / 2 + 0.3, '#9fd8ff'); // podium light band
  }
}

function drawTownhouse(L: Local, b: DBuilding): void {
  const { w, d, floors, c1, c2, c3 } = b;
  const h = FLOOR * floors;
  L.fac('res', w, h, d, 0, 0, 0, c1);
  L.box(w + 0.1, 0.3, d + 0.5, 0, h, 0.05, SLAB);
  L.box(w * 0.78, 0.45, d * 0.6, 0, h + 0.3, -d * 0.12, GREEN); // roof garden
  // colour-blocked front panel + door
  L.box(w * 0.46, h * 0.62, 0.3, -w * 0.2, h * 0.06, d / 2 + 0.12, c2);
  L.box(w * 0.2, 2.4, 0.16, w * 0.26, 0, d / 2 + 0.06, c3);
  L.box(w * 0.38, 0.2, 1.3, w * 0.18, FLOOR + 0.1, d / 2 + 0.55, SLAB); // balcony
  if (L.isNear) {
    L.box(w * 0.36, 0.9, 0.05, w * 0.18, FLOOR + 0.3, d / 2 + 1.15, '#9fc3d6');
    L.box(0.9, 0.5, 0.9, w * 0.3, 0, d / 2 + 1.4, GREEN); // planter
    L.glow(0.35, 0.18, 0.1, w * 0.26, 2.5, d / 2 + 0.16, '#ffe9b0');
  }
}

function drawCafe(L: Local, b: DBuilding): void {
  const { w, d, c1, c2, c3 } = b;
  L.box(w * 0.7, 3.6, d * 0.8, -w * 0.12, 0, -d * 0.1, c1);
  L.box(w * 0.7, 2.6, 0.12, -w * 0.12, 0.3, d * 0.3 + 0.03, GLASS);
  L.box(w + 0.6, 0.28, d + 0.6, 0, 3.7, 0, c2); // big flat canopy roof
  for (const s of [-1, 1]) L.box(0.22, 3.6, 0.22, s * (w / 2 - 0.4), 0, d / 2 - 0.4, '#d4d4d0');
  L.box(w * 0.5, 0.5, 0.2, -w * 0.12, 3.8, d / 2 + 0.2, c3); // fascia sign
  if (L.isNear) {
    for (const s of [-0.28, 0.12, 0.36]) {
      L.cafeSet(s * w, d * 0.36, pickCol(b, s)); // parasol + round table + stools
    }
  }
}

function pickCol(b: DBuilding, s: number): string {
  return [b.c3, '#d9a441', '#c4684a'][Math.abs(Math.round(s * 10)) % 3];
}

function drawPavilion(L: Local, b: DBuilding): void {
  const { w, d, c1, c2 } = b;
  L.box(w, 0.15, d, 0, 0, 0, '#d9d3c6');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.box(0.25, 3.6, 0.25, sx * (w / 2 - 0.5), 0.15, sz * (d / 2 - 0.5), c2);
  L.box(w + 1.4, 0.3, d + 1.4, 0, 3.75, 0, c1, { rotX: 0.06 }); // slightly tilted timber roof
  if (L.isNear) {
    L.box(w * 0.6, 0.45, 0.5, 0, 0.15, -d * 0.3, '#6b4a2f');
    L.box(w * 0.6, 0.9, 0.12, 0, 0.5, -d * 0.45, '#6b4a2f');
  }
}

function drawPlayground(L: Local, b: DBuilding): void {
  const { w, d, c1, c2, c3 } = b;
  L.box(w, 0.1, d, 0, 0, 0, '#b5573f'); // rubber surface
  L.box(1.6, 2.4, 1.6, -w * 0.3, 0.1, -d * 0.25, c1); // tower
  L.box(0.9, 0.12, 3.4, -w * 0.3, 1.5, -d * 0.25 + 2.4, c2, { rotX: -0.55 }); // slide
  for (const s of [-1, 1]) L.box(0.12, 2.6, 0.12, w * 0.15 + s * 1.4, 0.1, d * 0.1, '#6b7280');
  L.box(3.2, 0.12, 0.12, w * 0.15, 2.7, d * 0.1, '#6b7280'); // swing beam
  L.box(0.5, 0.06, 0.3, w * 0.15 - 0.7, 0.9, d * 0.1, c3);
  L.box(0.5, 0.06, 0.3, w * 0.15 + 0.7, 0.9, d * 0.1, c3);
  L.box(w * 0.3, 1.2, 0.12, w * 0.28, 0.1, -d * 0.35, c3); // climbing wall
}

const DRAW: Record<string, (L: Local, b: DBuilding) => void> = {
  villaCube: drawVillaCube,
  villaWing: drawVillaWing,
  villaTerrace: drawVillaTerrace,
  tower: drawTower,
  townhouse: drawTownhouse,
  cafe: drawCafe,
  pavilion: drawPavilion,
  playground: drawPlayground,
};

// ---------------------------------------------------------------------------------------------
// the district
// ---------------------------------------------------------------------------------------------

const hash01 = (x: number, z: number, k: number): number => {
  const v = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

function polyDist(p: V2, pl: DPolyline): number {
  let best = Infinity;
  for (const q of pl.pts) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
  return best;
}

/**
 * A flat slab (w x d, centre x/z, rotated rotY about its centre) minus the pond discs: sliced along its local x into 0.9 m strips,
 * each strip split where a pond chord crosses it. Rotation convention = three.js rotation.y (local x -> world (cos, -sin)).
 */
function slabAroundPonds(
  dist: District, w: number, h: number, dd: number, x: number, y: number, z: number, rot: number,
  emit: (w: number, h: number, d: number, x: number, y: number, z: number) => void
): void {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const rel: { lx: number; lz: number; r: number }[] = [];
  for (const p of dist.ponds) {
    const ox = p.x - x;
    const oz = p.z - z;
    const lx = ox * c - oz * s;
    const lz = ox * s + oz * c;
    if (Math.abs(lx) < w / 2 + p.r && Math.abs(lz) < dd / 2 + p.r) rel.push({ lx, lz, r: p.r });
  }
  if (!rel.length) {
    emit(w, h, dd, x, y, z);
    return;
  }
  const n = Math.max(1, Math.ceil(w / 0.9));
  const sw = w / n;
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + (i + 0.5) * sw;
    const cuts: [number, number][] = [];
    for (const q of rel) {
      const dx = Math.max(0, Math.abs(cx - q.lx) - sw / 2);
      if (dx >= q.r) continue;
      const half = Math.sqrt(q.r * q.r - dx * dx);
      cuts.push([q.lz - half, q.lz + half]);
    }
    cuts.sort((a, b) => a[0] - b[0]);
    let cur = -dd / 2;
    const put = (a: number, b: number) => {
      const lo = Math.max(a, -dd / 2);
      const hi = Math.min(b, dd / 2);
      if (hi - lo < 0.05) return;
      const mid = (lo + hi) / 2;
      emit(sw + 0.02, h, hi - lo, x + cx * c + mid * s, y, z - cx * s + mid * c);
    };
    for (const [a, b] of cuts) {
      if (a > cur) put(cur, a);
      cur = Math.max(cur, b);
    }
    put(cur, dd / 2);
  }
}

export function buildDistrict(d: District, ctx: DistrictCtx): void {
  const { kit, lawn, near } = ctx;
  const hasPaver = d.patches.some((p) => p.kind === 'paver');
  const flat = new FlatBatch();

  // ---- ground: lawns, plaza pavers, planting beds -------------------------------------------------
  // (slabs are cut around the ponds: the pond is a real bowl in the terrain, a slab over it would hide it)
  for (const p of d.patches) {
    const o = p.rot ? { rotY: p.rot } : undefined;
    if (p.kind === 'lawn') slabAroundPonds(d, p.w, 0.05, p.d, p.x, hasPaver ? 0.07 : 0.02, p.z, p.rot ?? 0, (w, h, dd, x, y, z) => lawn.box(w, h, dd, x, y, z, p.color, o));
    else if (p.kind === 'paver') slabAroundPonds(d, p.w, 0.08, p.d, p.x, 0.04, p.z, p.rot ?? 0, (w, h, dd, x, y, z) => kit.solid.box(w, h, dd, x, y, z, p.color, o));
    else slabAroundPonds(d, p.w, 0.22, p.d, p.x, 0.11, p.z, p.rot ?? 0, (w, h, dd, x, y, z) => kit.solid.box(w, h, dd, x, y, z, p.color, o));
  }

  // ---- lanes: asphalt + kerbs + pavements, turning circles ------------------------------------------
  for (const lane of d.lanes) {
    flat.strip(lane.pts, 0, LANE_HW, 0.08, ASPHALT);
    for (const s of [-1, 1]) {
      flat.strip(lane.pts, s * (LANE_HW + 0.18), 0.18, 0.14, KERB);
      flat.strip(lane.pts, s * (LANE_HW + 0.36 + 1.1), 1.1, 0.12, PAVER);
    }
    // apron where the lane meets the street pavement, at both ends
    for (const e of [lane.pts[0], lane.pts[lane.pts.length - 1]]) flat.disc(e[0], e[1], LANE_HW + 0.2, 0.1, '#8b8b86');
  }
  for (const dc of d.discs) {
    flat.disc(dc.x, dc.z, dc.r, 0.08, ASPHALT);
    flat.strip(circle(dc.x, dc.z, dc.r + 0.18, 28), 0, 0.18, 0.14, KERB, true);
    flat.disc(dc.x, dc.z, dc.r * 0.28, 0.11, GREEN); // planted island in the turning circle
  }
  for (const pa of d.paths) {
    flat.strip(pa.pts, 0, pa.width / 2, 0.075, '#d8cfb8', pa.closed);
    flat.strip(pa.pts, 0, pa.width / 2 + 0.3, 0.07, '#b9b19b', pa.closed);
  }
  const fg = flat.build();
  if (fg) ctx.flat.push(fg);

  // ---- water ----------------------------------------------------------------------------------------
  for (const p of d.ponds) {
    // low stone coping ring round the bowl (a ring of slabs: the middle stays open so you can wade in)
    const seg = Math.max(16, Math.round(p.r * 3.4));
    const rr = p.r + 0.5;
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      kit.solid.box((2 * Math.PI * rr) / seg + 0.14, 0.1, 1.0, p.x + Math.cos(a) * rr, 0.0, p.z + Math.sin(a) * rr, hasPaver ? '#e4dfd3' : '#a8a08c', { rotY: Math.atan2(-Math.cos(a), -Math.sin(a)) });
    }
    ctx.ponds.push(makePondGeometry(p.x, POND_LEVEL, p.z, p.r));
  }

  // ---- buildings --------------------------------------------------------------------------------------
  for (const b of d.buildings) {
    const draw = DRAW[b.type];
    if (!draw) continue;
    // yard lawn under the villas and townhouses (plazas / parks already have their own ground)
    if (!hasPaver && (b.type.startsWith('villa') || b.type === 'townhouse')) {
      lawn.box(b.w + 5, 0.05, b.d + 6, b.x, 0.025, b.z, '#ffffff', { rotY: b.rot });
    }
    setKitTransform(kit, b.rot, b.x, b.z);
    draw(new Local(kit, near), b);
    clearKitTransform(kit);
    if (b.type === 'playground' || b.type === 'pavilion') continue;
    rotatedColliders(b.x, b.z, b.w, b.d, b.rot).forEach((r, k) => {
      ctx.colliders.push({ id: `${b.id}_${k}`, minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, userData: { type: 'building', id: b.id, name: d.name } });
    });
  }

  // ---- trees, lamps, grass --------------------------------------------------------------------------
  for (const t of d.trees) ctx.oaks.push({ x: t.x, y: 0, z: t.z, s: t.s * 0.55, rot: hash01(t.x, t.z, 1) * 6.283, tint: hash01(t.x, t.z, 2) });
  for (const l of d.lamps) ctx.lamps.push({ x: l.x, y: 0, z: l.z, rotY: l.rot, scale: 1, variant: 0 });

  if (near && d.style === 'park') {
    const rng = makeRng(hashString(`tufts:${d.i}:${d.j}`));
    const obbs = d.buildings.map((b) => ({ x: b.x, z: b.z, hw: b.w / 2 + 1, hd: b.d / 2 + 1, rot: b.rot }));
    const count = Math.min(520, Math.floor(((d.x1 - d.x0) * (d.z1 - d.z0)) / 12));
    for (let n = 0; n < count; n++) {
      const x = d.x0 + 1 + rng() * (d.x1 - d.x0 - 2);
      const z = d.z0 + 1 + rng() * (d.z1 - d.z0 - 2);
      const s = 0.6 + rng() * 0.6;
      const rot = rng() * 6.283;
      const tint = rng();
      if (!inDistrict(d, x, z, -1.5)) continue;
      if (d.ponds.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 1.6)) continue;
      if (d.paths.some((p) => polyDist([x, z], p) < p.width / 2 + 0.9)) continue;
      if (obbs.some((o) => distPointToObb(x, z, o) < 0.5)) continue;
      ctx.tufts.push({ x, y: 0.045, z, s, rot, tint });
    }
  }
  if (near) {
    // benches along the paths of the park, bollards + planters on the plaza edge, bike racks on the mews
    const rng = makeRng(hashString(`props:${d.i}:${d.j}`));
    if (d.style === 'park') {
      for (const pa of d.paths.filter((p) => p.closed)) {
        for (let k = 0; k < pa.pts.length; k += 5) {
          const p = pa.pts[k];
          const q = pa.pts[(k + 1) % pa.pts.length];
          const ang = -Math.atan2(q[1] - p[1], q[0] - p[0]);
          const nx = (q[1] - p[1]) / (Math.hypot(q[0] - p[0], q[1] - p[1]) || 1);
          const nz = -(q[0] - p[0]) / (Math.hypot(q[0] - p[0], q[1] - p[1]) || 1);
          const bx = p[0] + nx * 2.2;
          const bz = p[1] + nz * 2.2;
          if (d.ponds.some((o) => Math.hypot(bx - o.x, bz - o.z) < o.r + 1.6)) continue;
          kit.solid.box(1.9, 0.45, 0.5, bx, 0.25, bz, '#6b4a2f', { rotY: ang });
        }
      }
    } else if (d.style === 'glass') {
      for (let k = 0; k < 10; k++) {
        const x = d.x0 + 2 + rng() * (d.x1 - d.x0 - 4);
        const z = d.z0 + 2 + rng() * (d.z1 - d.z0 - 4);
        if (!inDistrict(d, x, z, -2.5)) continue;
        if (d.buildings.some((b) => distPointToObb(x, z, { x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, rot: b.rot }) < 2.5)) continue;
        if (d.ponds.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 2)) continue;
        kit.solid.box(1.6, 0.55, 1.6, x, 0.36, z, '#c9c5bb'); // seating cube
        kit.solid.box(1.2, 0.4, 1.2, x, 0.83, z, '#5f9a4a'); // planted top
      }
    }
  }
}
