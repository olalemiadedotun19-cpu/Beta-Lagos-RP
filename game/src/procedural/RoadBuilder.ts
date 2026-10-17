import * as THREE from 'three';
import { RoadSegment } from '../types/game';
import { addSidewalkCorner, addSidewalkRect, clearSidewalks } from '../world/SidewalkHeight';
import { getGlbRoadTextures, GLB_ASPHALT_ROUGHNESS, GLB_ASPHALT_TINT, GLB_SIDEWALK_ROUGHNESS } from './GlbRoadTextures';
import { onTextureLevel, TEXTURE_SCALE, type TextureLevel } from '../graphics/GraphicsSettings';
import { averageColor, copiesOf, releaseUnused, scaledTexture } from '../graphics/TextureDetail';
import {
  getPaintTexture,
  getPaintBumpTexture,
  getDecalAtlas,
  getGravelTexture,
  decalUV,
  DECAL_CELL,
  DECAL_WHITE_UV,
  RoadSurface,
} from './RoadTextures';

/**
 * RoadBuilder - realistic yet lightweight road network.
 *
 * The whole network is baked into FIVE merged meshes (asphalt, pavements, painted markings,
 * weathering decals, grass/debris) using small tiled textures + a decal atlas.
 *
 *  - Road classes (main / secondary / residential / resurfaced) drive tone, wear, dust, paint fade
 *    and which markings exist, deterministically from the road id.
 *  - Asphalt: aggregate texture x macro tone variation (value noise on a coarse grid).
 *  - Junctions: pavements cut at crossings, rounded kerb corners, corner fill, crosswalks, stop lines,
 *    turn arrows on main-road approaches, catch-basin drains placed before every crosswalk.
 *  - Paint: worn paint texture, faded colours, broken lines, tyre grime over zebras.
 *  - Edges: kerb grime -> kerb -> pavement (dirt gradient, stains) -> open drain -> dust -> debris/weeds -> grass.
 */

const SIDEWALK_WIDTH = 2.4;
const SIDEWALK_HEIGHT = 0.16;
const CORNER_RADIUS = 2.0;
const MARKING_CLEARANCE = 5.2;
const ASPHALT_Y = 0.01;
const DECAL_Y = 0.013;
const MARK_Y = 0.017;
const UV_ASPHALT = 7;
const UV_PAVER = 2.4;
const UV_PAINT = 2.5;

type RGBA = [number, number, number, number];
const tmpColor = new THREE.Color();
function rgba(hex: string | number, a = 1): RGBA {
  tmpColor.set(hex as THREE.ColorRepresentation);
  return [tmpColor.r, tmpColor.g, tmpColor.b, a];
}
function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Smooth value noise in [0,1] */
function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

// ---------------------------------------------------------------------------------------------
// Merged-mesh builder
// ---------------------------------------------------------------------------------------------

class MeshBuilder {
  private p: number[] = [];
  private n: number[] = [];
  private u: number[] = [];
  private c: number[] = [];
  private idx: number[] = [];
  private count = 0;

  /** fixedUV: every vertex uses this UV (decals that should sample the atlas' white texel) */
  constructor(
    private readonly alpha: boolean,
    private readonly uvScale: number,
    private readonly fixedUV: [number, number] | null = null
  ) {}

  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, col: RGBA): number {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    if (this.fixedUV) this.u.push(this.fixedUV[0], this.fixedUV[1]);
    else this.u.push(u, v);
    if (this.alpha) this.c.push(col[0], col[1], col[2], col[3]);
    else this.c.push(col[0], col[1], col[2]);
    return this.count++;
  }

  private topTri(
    a: [number, number],
    b: [number, number],
    c: [number, number],
    y: number,
    ca: RGBA,
    cb: RGBA = ca,
    cc: RGBA = ca,
    uvs?: [[number, number], [number, number], [number, number]]
  ): void {
    const cross = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    const swap = cross < 0;
    const q = swap ? c : b;
    const r = swap ? b : c;
    const cq = swap ? cc : cb;
    const cr = swap ? cb : cc;
    const s = this.uvScale;
    const ua = uvs ? uvs[0] : [a[0] / s, a[1] / s];
    const uq = uvs ? (swap ? uvs[2] : uvs[1]) : [q[0] / s, q[1] / s];
    const ur = uvs ? (swap ? uvs[1] : uvs[2]) : [r[0] / s, r[1] / s];
    const i0 = this.vert(a[0], y, a[1], 0, 1, 0, ua[0], ua[1], ca);
    const i1 = this.vert(q[0], y, q[1], 0, 1, 0, uq[0], uq[1], cq);
    const i2 = this.vert(r[0], y, r[1], 0, 1, 0, ur[0], ur[1], cr);
    this.idx.push(i0, i1, i2);
  }

  public fan(pts: [number, number][], y: number, col: RGBA): void {
    for (let i = 1; i < pts.length - 1; i++) this.topTri(pts[0], pts[i], pts[i + 1], y, col);
  }

  public quad(x0: number, z0: number, x1: number, z1: number, y: number, col: RGBA): void {
    this.fan(
      [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ],
      y,
      col
    );
  }

  /** Quad with a colour per corner (gradients). Corners in order a,b,c,d around the quad. */
  public gradQuad(a: [number, number], b: [number, number], c: [number, number], d: [number, number], y: number, ca: RGBA, cb: RGBA, cc: RGBA, cd: RGBA): void {
    this.topTri(a, b, c, y, ca, cb, cc);
    this.topTri(a, c, d, y, ca, cc, cd);
  }

  /** Oriented textured decal (atlas cell), centre + direction + half extents */
  public decal(cx: number, cz: number, dx: number, dz: number, halfL: number, halfW: number, y: number, col: RGBA, cell: number): void {
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const px = -uz;
    const pz = ux;
    const A: [number, number] = [cx - ux * halfL - px * halfW, cz - uz * halfL - pz * halfW];
    const B: [number, number] = [cx + ux * halfL - px * halfW, cz + uz * halfL - pz * halfW];
    const C: [number, number] = [cx + ux * halfL + px * halfW, cz + uz * halfL + pz * halfW];
    const D: [number, number] = [cx - ux * halfL + px * halfW, cz - uz * halfL + pz * halfW];
    const { u0, u1, v0, v1 } = decalUV(cell);
    // along length -> v, across width -> u
    this.topTri(A, B, C, y, col, col, col, [
      [u0, v0],
      [u0, v1],
      [u1, v1],
    ]);
    this.topTri(A, C, D, y, col, col, col, [
      [u0, v0],
      [u1, v1],
      [u1, v0],
    ]);
  }

  /** Subdivided rectangle, vertex colours supplied by fn (smooth macro variation) */
  public grid(x0: number, z0: number, x1: number, z1: number, y: number, cell: number, colorAt: (x: number, z: number) => RGBA): void {
    const nx = Math.max(1, Math.ceil((x1 - x0) / cell));
    const nz = Math.max(1, Math.ceil((z1 - z0) / cell));
    const s = this.uvScale;
    const base = this.count;
    for (let iz = 0; iz <= nz; iz++) {
      for (let ix = 0; ix <= nx; ix++) {
        const x = x0 + ((x1 - x0) * ix) / nx;
        const z = z0 + ((z1 - z0) * iz) / nz;
        this.vert(x, y, z, 0, 1, 0, x / s, z / s, colorAt(x, z));
      }
    }
    const row = nx + 1;
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const a = base + iz * row + ix;
        const b = a + 1;
        const c = a + row + 1;
        const d = a + row;
        // (x,z) grid with +x right, +z down: a,d,c / a,c,b faces up
        this.idx.push(a, d, c, a, c, b);
      }
    }
  }

  public wall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, nx: number, nz: number, col: RGBA): void {
    const s = this.uvScale;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const a = this.vert(x0, y0, z0, nx, 0, nz, 0, y0 / s, col);
    const b = this.vert(x1, y0, z1, nx, 0, nz, len / s, y0 / s, col);
    const c = this.vert(x1, y1, z1, nx, 0, nz, len / s, y1 / s, col);
    const d = this.vert(x0, y1, z0, nx, 0, nz, 0, y1 / s, col);
    const ex = x1 - x0;
    const ez = z1 - z0;
    const dot = -ez * nx + ex * nz;
    if (dot >= 0) this.idx.push(a, b, c, a, c, d);
    else this.idx.push(a, c, b, a, d, c);
  }

  /** Double-sided grass blade (triangle) standing at x,z */
  public blade(x: number, z: number, h: number, w: number, rot: number, lean: number, base: RGBA, tip: RGBA): void {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const lx = c * lean;
    const lz = s * lean;
    const i0 = this.vert(x - c * w, 0.0, z - s * w, 0, 1, 0, 0, 0, base);
    const i1 = this.vert(x + c * w, 0.0, z + s * w, 0, 1, 0, 0, 0, base);
    const i2 = this.vert(x + lx, h, z + lz, 0, 1, 0, 0, 0, tip);
    this.idx.push(i0, i1, i2);
  }

  public build(): THREE.BufferGeometry | null {
    if (this.count === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.u), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), this.alpha ? 4 : 3));
    const Arr = this.count > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new THREE.BufferAttribute(new Arr(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Far-LOD sink: accepts decal/plant writes and discards them */
class NullBuilder extends MeshBuilder {
  public readonly isNull = true;
  public override fan(): void {}
  public override quad(): void {}
  public override gradQuad(): void {}
  public override decal(): void {}
  public override blade(): void {}
}

// ---------------------------------------------------------------------------------------------
// Road model + styles
// ---------------------------------------------------------------------------------------------

type RoadClass = 'main' | 'secondary' | 'residential';

interface RoadStyle {
  cls: RoadClass;
  resurfaced: boolean;
  tone: number; // asphalt brightness multiplier
  wear: number; // tyre tracks / grime strength
  patches: number; // patches per 100 m
  cracks: number; // crack decals per 100 m
  stains: number; // oil stains per 100 m
  dust: number; // kerb-side dust alpha
  fade: number; // paint fade 0..1
  potholes: number; // per 100 m
  edgeLines: boolean;
  zebra: boolean;
  arrows: boolean;
  drainChannel: boolean;
}

interface AxisRoad {
  road: RoadSegment;
  horiz: boolean;
  c: number;
  lo: number;
  hi: number;
  hw: number;
  sw: boolean;
  lanes: number;
  hash: number;
  style: RoadStyle;
}

interface Intersection {
  h: AxisRoad;
  v: AxisRoad;
}

/** World-space rectangle for streamed cells: geometry is only emitted inside it (intersections: centre inside). */
export interface RoadClip {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function inClip(clip: RoadClip | undefined, x: number, z: number): boolean {
  return !clip || (x >= clip.minX && x < clip.maxX && z >= clip.minZ && z < clip.maxZ);
}

/** along-axis range of road r inside the clip (null = road misses the clip) */
function alongRange(r: AxisRoad, clip?: RoadClip): [number, number] | null {
  if (!clip) return [r.lo, r.hi];
  const margin = r.hw + SIDEWALK_WIDTH + 3;
  const [perpMin, perpMax, aMin, aMax] = r.horiz ? [clip.minZ, clip.maxZ, clip.minX, clip.maxX] : [clip.minX, clip.maxX, clip.minZ, clip.maxZ];
  if (r.c + margin < perpMin || r.c - margin > perpMax) return null;
  const lo = Math.max(r.lo, aMin);
  const hi = Math.min(r.hi, aMax);
  return hi - lo > 0.01 ? [lo, hi] : null;
}

/** clip a piece to [lo,hi]; reports whether it was cut (so end treatments are skipped there) */
function clipPiece<T extends { a: number; b: number }>(p: T, range: [number, number]): (T & { cutLo: boolean; cutHi: boolean }) | null {
  const a = Math.max(p.a, range[0]);
  const b = Math.min(p.b, range[1]);
  if (b - a < 0.05) return null;
  return { ...p, a, b, cutLo: a > p.a + 1e-6, cutHi: b < p.b - 1e-6 };
}

interface Cut {
  a: number;
  b: number;
  other: AxisRoad;
}

/** realism pass: every road gets a lot more cracks, stains, patches and potholes than the first version had */
function styleFor(road: RoadSegment, hash: number): RoadStyle {
  const b = baseStyleFor(road, hash);
  const worn = b.resurfaced ? 0.6 : 1;
  return {
    ...b,
    patches: Math.max(b.patches * 2.4, b.resurfaced ? 0.6 : 3.2) * worn,
    cracks: Math.max(b.cracks * 3.2, b.resurfaced ? 1.2 : 6) * worn,
    stains: Math.max(b.stains * 3, 3.2),
    potholes: b.potholes > 0 ? b.potholes * 2 : b.cls === 'main' ? 0.3 : 0,
    wear: Math.min(1.6, b.wear * 1.5),
  };
}

function baseStyleFor(road: RoadSegment, hash: number): RoadStyle {
  const cls: RoadClass = road.width >= 12 || road.lanes >= 4 ? 'main' : road.width >= 9 ? 'secondary' : 'residential';
  const resurfaced = cls !== 'main' && hash % 3 === 1; // some side roads were recently resurfaced
  if (cls === 'main') {
    return { cls, resurfaced: false, tone: 0.9, wear: 0.7, patches: 1.2, cracks: 0.8, stains: 1.2, dust: 0.22, fade: 0.1, potholes: 0, edgeLines: true, zebra: true, arrows: true, drainChannel: false };
  }
  if (resurfaced) {
    return { cls, resurfaced, tone: 0.82, wear: 0.3, patches: 0, cracks: 0, stains: 0.3, dust: 0.1, fade: 0.0, potholes: 0, edgeLines: true, zebra: cls === 'secondary', arrows: false, drainChannel: true };
  }
  if (cls === 'secondary') {
    return { cls, resurfaced, tone: 1.0, wear: 0.8, patches: 2.2, cracks: 2.2, stains: 1.6, dust: 0.38, fade: 0.28, potholes: 0.5, edgeLines: true, zebra: true, arrows: false, drainChannel: true };
  }
  return { cls, resurfaced, tone: 1.08, wear: 0.9, patches: 2.6, cracks: 3.0, stains: 1.2, dust: 0.62, fade: 0.42, potholes: 1.0, edgeLines: false, zebra: false, arrows: false, drainChannel: true };
}

function toAxis(road: RoadSegment): AxisRoad | null {
  const dx = Math.abs(road.end.x - road.start.x);
  const dz = Math.abs(road.end.z - road.start.z);
  const horiz = dz < 1e-6 && dx > 0;
  const vert = dx < 1e-6 && dz > 0;
  if (!horiz && !vert) return null;
  const hash = hashString(road.id);
  return {
    road,
    horiz,
    c: horiz ? road.start.z : road.start.x,
    lo: horiz ? Math.min(road.start.x, road.end.x) : Math.min(road.start.z, road.end.z),
    hi: horiz ? Math.max(road.start.x, road.end.x) : Math.max(road.start.z, road.end.z),
    hw: road.width / 2,
    sw: road.hasSidewalk,
    lanes: road.lanes,
    hash,
    style: styleFor(road, hash),
  };
}

function pt(r: AxisRoad, along: number, perp: number): [number, number] {
  return r.horiz ? [along, r.c + perp] : [r.c + perp, along];
}

function cutsFor(r: AxisRoad, roads: AxisRoad[], widen = 0): Cut[] {
  const cuts: Cut[] = [];
  for (const o of roads) {
    if (o.horiz === r.horiz) continue;
    if (o.c < r.lo - 1e-6 || o.c > r.hi + 1e-6) continue;
    if (r.c < o.lo - 1e-6 || r.c > o.hi + 1e-6) continue;
    cuts.push({ a: o.c - o.hw - widen, b: o.c + o.hw + widen, other: o });
  }
  cuts.sort((x, y) => x.a - y.a);
  return cuts;
}

interface Piece {
  a: number;
  b: number;
  loCut: AxisRoad | null;
  hiCut: AxisRoad | null;
}

function piecesBetweenCuts(r: AxisRoad, cuts: Cut[]): Piece[] {
  const out: Piece[] = [];
  let cursor = r.lo;
  let prev: AxisRoad | null = null;
  for (const c of cuts) {
    if (c.a > cursor + 0.01) out.push({ a: cursor, b: Math.min(c.a, r.hi), loCut: prev, hiCut: c.other });
    cursor = Math.max(cursor, c.b);
    prev = c.other;
  }
  if (r.hi > cursor + 0.01) out.push({ a: cursor, b: r.hi, loCut: prev, hiCut: null });
  return out;
}

function cornerExists(h: AxisRoad, v: AxisRoad, sx: number, sz: number): boolean {
  if (!h.sw || !v.sw) return false;
  const hOk = sx > 0 ? h.hi >= v.c + v.hw + CORNER_RADIUS + 0.01 : h.lo <= v.c - v.hw - CORNER_RADIUS - 0.01;
  const vOk = sz > 0 ? v.hi >= h.c + h.hw + CORNER_RADIUS + 0.01 : v.lo <= h.c - h.hw - CORNER_RADIUS - 0.01;
  return hOk && vOk;
}

/** Strip pieces for one pavement side, with ends retracted where a rounded corner will sit */
function pavementPieces(r: AxisRoad, axis: AxisRoad[], side: number, range: [number, number]): { a: number; b: number; flushLo: boolean; flushHi: boolean }[] {
  const out: { a: number; b: number; flushLo: boolean; flushHi: boolean }[] = [];
  for (const p of piecesBetweenCuts(r, cutsFor(r, axis))) {
    let a = p.a;
    let b = p.b;
    let flushLo = false;
    let flushHi = false;
    if (p.loCut) {
      const o = p.loCut;
      const h = r.horiz ? r : o;
      const v = r.horiz ? o : r;
      if (cornerExists(h, v, r.horiz ? 1 : side, r.horiz ? side : 1)) a += CORNER_RADIUS;
      else flushLo = true;
    }
    if (p.hiCut) {
      const o = p.hiCut;
      const h = r.horiz ? r : o;
      const v = r.horiz ? o : r;
      if (cornerExists(h, v, r.horiz ? -1 : side, r.horiz ? side : -1)) b -= CORNER_RADIUS;
      else flushHi = true;
    }
    if (a < range[0]) {
      a = range[0];
      flushLo = false;
    }
    if (b > range[1]) {
      b = range[1];
      flushHi = false;
    }
    if (b - a >= 0.05) out.push({ a, b, flushLo, flushHi });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------------------------

interface Builders {
  clip?: RoadClip;
  seedMix: number;
  asphalt: MeshBuilder;
  paving: MeshBuilder;
  marks: MeshBuilder;
  decals: MeshBuilder; // flat (white texel) + atlas decals share one mesh/material
  small: MeshBuilder; // opaque grass blades
}

export class RoadBuilder {
  public static build(roads: RoadSegment[], clip?: RoadClip, prepared?: { axis: AxisRoad[]; inters: Intersection[] }, far = false): THREE.Group {
    const group = new THREE.Group();
    group.name = 'roads_network';

    const B: Builders = {
      clip,
      seedMix: clip ? Math.imul(Math.floor(clip.minX), 73856093) ^ Math.imul(Math.floor(clip.minZ), 19349663) : 0,
      asphalt: new MeshBuilder(false, UV_ASPHALT),
      paving: new MeshBuilder(false, UV_PAVER),
      marks: new MeshBuilder(false, UV_PAINT),
      decals: far ? new NullBuilder(true, 1, null) : new MeshBuilder(true, 1, null),
      small: far ? new NullBuilder(false, 1) : new MeshBuilder(false, 1),
    };
    // decals: flat quads use the white texel through explicit UV (see flat()), atlas quads use their cell.

    const prep = prepared ?? RoadBuilder.prepare(roads);
    const axis = prep.axis;
    const intersections = prep.inters.filter((i) => inClip(clip, i.v.c, i.h.c));
    const freeform: RoadSegment[] = clip ? [] : roads.filter((r) => !toAxis(r));

    this.buildAsphalt(B, axis, intersections);
    this.buildPavements(B, axis, intersections);
    this.buildMarkings(B, axis, intersections);
    if (!far) this.buildWear(B, axis, intersections);
    freeform.forEach((r) => this.buildFreeform(B, r));

    const { asphaltMat, pavingMat, marksMat, decalMat, smallMat } = RoadBuilder.materials();

    const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material, name: string, shadow: boolean) => {
      if (!geo) return;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = name;
      mesh.receiveShadow = shadow;
      group.add(mesh);
    };
    add(B.asphalt.build(), asphaltMat, 'road_asphalt', true);
    add(B.paving.build(), pavingMat, 'road_pavements', true);
    add(B.decals.build(), decalMat, 'road_decals', true);
    add(B.marks.build(), marksMat, 'road_markings', false);
    add(B.small.build(), smallMat, 'road_verge_plants', true);

    return group;
  }

  /** Pre-compute the (shared) axis-road model once; streamed cells reuse it. */
  public static prepare(roads: RoadSegment[]): { axis: AxisRoad[]; inters: Intersection[] } {
    const axis: AxisRoad[] = [];
    for (const r of roads) {
      const a = toAxis(r);
      if (a) axis.push(a);
    }
    const inters: Intersection[] = [];
    for (const h of axis.filter((r) => r.horiz)) {
      for (const v of axis.filter((r) => !r.horiz)) {
        if (v.c >= h.lo && v.c <= h.hi && h.c >= v.lo && h.c <= v.hi) inters.push({ h, v });
      }
    }
    RoadBuilder.registerWalkableSidewalks(axis, inters);
    return { axis, inters };
  }

  /**
   * Tells the player's ground-height query where the raised pavements are. Uses the same pieces, widths and rounded
   * corners as buildPavements(), so what you see is exactly what you can step onto.
   */
  private static registerWalkableSidewalks(axis: AxisRoad[], inters: Intersection[]): void {
    clearSidewalks(SIDEWALK_HEIGHT);
    for (const r of axis) {
      if (!r.sw) continue;
      for (const side of [-1, 1]) {
        for (const p of pavementPieces(r, axis, side, [r.lo, r.hi])) {
          const [x0, z0] = pt(r, p.a, side * r.hw);
          const [x1, z1] = pt(r, p.b, side * (r.hw + SIDEWALK_WIDTH));
          addSidewalkRect(x0, z0, x1, z1);
        }
      }
    }
    for (const { h, v } of inters) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          if (!cornerExists(h, v, sx, sz)) continue;
          addSidewalkCorner(v.c + sx * v.hw + sx * CORNER_RADIUS, h.c + sz * h.hw + sz * CORNER_RADIUS, sx, sz, CORNER_RADIUS);
        }
      }
    }
  }

  private static mats: {
    asphaltMat: THREE.MeshStandardMaterial;
    pavingMat: THREE.MeshStandardMaterial;
    gravelMat: THREE.MeshStandardMaterial;
    marksMat: THREE.MeshStandardMaterial;
    decalMat: THREE.MeshLambertMaterial;
    smallMat: THREE.MeshLambertMaterial;
  } | null = null;

  public static materials() {
    if (!this.mats) {
      // asphalt + pavement use the textures of the free city road layout model (colour + normal map each); see GlbRoadTextures.ts
      const glb = getGlbRoadTextures();
      const asphaltMat = new THREE.MeshStandardMaterial({
        map: glb.asphalt.map,
        normalMap: glb.asphalt.normal,
        color: new THREE.Color(GLB_ASPHALT_TINT, GLB_ASPHALT_TINT, GLB_ASPHALT_TINT),
        vertexColors: true,
        roughness: GLB_ASPHALT_ROUGHNESS,
        metalness: 0,
      });
      RoadSurface.register(asphaltMat);
      const pavingMat = new THREE.MeshStandardMaterial({ map: glb.sidewalk.map, normalMap: glb.sidewalk.normal, vertexColors: true, roughness: GLB_SIDEWALK_ROUGHNESS, metalness: 0 });
      RoadSurface.register(pavingMat);
      const gravelMat = new THREE.MeshStandardMaterial({ map: getGravelTexture(), vertexColors: true, roughness: 1, metalness: 0 });
      RoadSurface.register(gravelMat);
      // Worn thermoplastic paint: a thick layer (bump map) with chips that go clean through to the asphalt (alpha test), a little sheen
      // from the glass beads (standard material, so wet weather glosses it like the road), registered with RoadSurface like the asphalt
      const marksMat = new THREE.MeshStandardMaterial({
        map: getPaintTexture(),
        bumpMap: getPaintBumpTexture(),
        bumpScale: 0.9,
        alphaTest: 0.5,
        vertexColors: true,
        roughness: 0.72,
        metalness: 0,
        emissive: new THREE.Color(0x121212),
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      RoadSurface.register(marksMat);
      const decalMat = new THREE.MeshLambertMaterial({
        map: getDecalAtlas(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      const smallMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      this.mats = { asphaltMat, pavingMat, gravelMat, marksMat, decalMat, smallMat };
      onTextureLevel((lv) => this.applyLevel(lv)); // runs now, and again whenever the Textures setting changes
    }
    return this.mats;
  }

  /**
   * Texture quality for the road network (see TextureLevel in GraphicsSettings.ts):
   *   Low    asphalt, pavement and gravel are SMOOTH FLAT COLOUR (their average colour): no image, no relief, no paint chips, no wear decals
   *   Medium colour images at half size, no relief maps, no wear decals
   *   High / Ultra  everything (full-size images, relief maps, paint bump, decals)
   */
  private static applyLevel(lv: TextureLevel): void {
    const m = this.mats;
    if (!m) return;
    const glb = getGlbRoadTextures();
    const scale = TEXTURE_SCALE[lv];
    const flat = lv === 0;
    const asphaltBase = flat ? averageColor(glb.asphalt.map, 0x585858).multiplyScalar(GLB_ASPHALT_TINT) : new THREE.Color(GLB_ASPHALT_TINT, GLB_ASPHALT_TINT, GLB_ASPHALT_TINT);
    m.asphaltMat.map = flat ? null : scaledTexture(glb.asphalt.map, scale);
    m.asphaltMat.normalMap = lv >= 2 ? glb.asphalt.normal : null;
    RoadSurface.setBase(m.asphaltMat, asphaltBase);
    m.pavingMat.map = flat ? null : scaledTexture(glb.sidewalk.map, scale);
    m.pavingMat.normalMap = lv >= 2 ? glb.sidewalk.normal : null;
    RoadSurface.setBase(m.pavingMat, flat ? averageColor(glb.sidewalk.map, 0x9a9a96) : new THREE.Color(1, 1, 1));
    const gravel = getGravelTexture();
    m.gravelMat.map = flat ? null : scaledTexture(gravel, scale);
    RoadSurface.setBase(m.gravelMat, flat ? averageColor(gravel, 0x7a7468) : new THREE.Color(1, 1, 1));
    m.marksMat.bumpMap = lv >= 2 ? getPaintBumpTexture() : null;
    m.marksMat.map = flat ? null : getPaintTexture();
    m.decalMat.visible = lv >= 2;
    for (const mat of [m.asphaltMat, m.pavingMat, m.gravelMat, m.marksMat]) mat.needsUpdate = true;
    // free the GPU copy of every image no road material uses now
    const used = new Set<THREE.Texture>();
    for (const mat of [m.asphaltMat, m.pavingMat, m.gravelMat, m.marksMat]) for (const t of [mat.map, mat.normalMap, mat.bumpMap]) if (t) used.add(t);
    releaseUnused([glb.asphalt.map, glb.asphalt.normal, glb.sidewalk.map, glb.sidewalk.normal, gravel, ...copiesOf(glb.asphalt.map), ...copiesOf(glb.sidewalk.map), ...copiesOf(gravel)], used);
  }

  // ---- helpers writing decals ---------------------------------------------------------------

  /** flat tinted quad on the white texel of the decal atlas */
  private static flat(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, y: number, col: RGBA): void {
    // explicit UVs through decal()-like path: use a degenerate cell by reusing quad with white uv
    this.flatPoly(b, [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ], y, col);
  }

  private static flatPoly(b: MeshBuilder, pts: [number, number][], y: number, col: RGBA): void {
    // The decals builder has no fixed UV (atlas decals need real UVs), so flat quads are routed through
    // gradQuad/fan with the white-texel UV baked via the second builder state.
    (b as unknown as { fanWhite: (p: [number, number][], y: number, c: RGBA) => void }).fanWhite(pts, y, col);
  }

  // -------------------------------------------------------------------------------------------
  // Asphalt (+ rounded-corner fill)
  // -------------------------------------------------------------------------------------------

  private static buildAsphalt(B: Builders, axis: AxisRoad[], inters: Intersection[]): void {
    const b = B.asphalt;
    for (const r of axis) {
      const range = alongRange(r, B.clip);
      if (!range) continue;
      const raw = r.horiz ? [{ a: r.lo, b: r.hi }] : piecesBetweenCuts(r, cutsFor(r, axis));
      const pieces = raw.map((p) => clipPiece(p, range)).filter((p): p is NonNullable<typeof p> => !!p);
      const seed = r.hash & 0xffff;
      const baseTone = r.style.tone;
      for (const p of pieces) {
        const [x0, z0] = pt(r, p.a, -r.hw);
        const [x1, z1] = pt(r, p.b, r.hw);
        b.grid(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), ASPHALT_Y, 4.5, (x, z) => {
          // macro variation: big soft patches + mid-scale mottling, plus a slightly lighter tone nearest the kerbs
          const macro = valueNoise(x / 22, z / 22, seed) * 0.6 + valueNoise(x / 7, z / 7, seed + 7) * 0.4;
          const t = baseTone * (0.94 + macro * 0.12);
          return [t, t, t * 1.01, 1];
        });
      }
    }

    // rounded kerb corner fill
    for (const { h, v } of inters) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          if (!cornerExists(h, v, sx, sz)) continue;
          const cx = v.c + sx * v.hw;
          const cz = h.c + sz * h.hw;
          const px = cx + sx * CORNER_RADIUS;
          const pz = cz + sz * CORNER_RADIUS;
          const pts: [number, number][] = [[cx, cz]];
          for (let i = 0; i <= 8; i++) {
            const t = (i / 8) * (Math.PI / 2);
            pts.push([px - sx * CORNER_RADIUS * Math.cos(t), pz - sz * CORNER_RADIUS * Math.sin(t)]);
          }
          const t = h.style.tone;
          b.fan(pts, ASPHALT_Y, [t, t, t, 1]);
        }
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Pavements, kerbs, edge transitions, open drains, weeds, debris
  // -------------------------------------------------------------------------------------------

  private static buildPavements(B: Builders, axis: AxisRoad[], inters: Intersection[]): void {
    const b = B.paving;
    const top: RGBA = [1, 1, 1, 1];
    const kerb: RGBA = rgba('#e4e2dc');
    const edge: RGBA = rgba('#9b9a94');
    const dust = rgba('#8b7a5e', 0);
    const dustOn = (a: number): RGBA => rgba('#8b7a5e', a);
    const dirtOn = (a: number): RGBA => rgba('#6a5638', a);
    const grime = (a: number): RGBA => rgba('#0b0b0d', a);
    void dust;

    for (const r of axis) {
      if (!r.sw) continue;
      const range = alongRange(r, B.clip);
      if (!range) continue;
      const rng = makeRng(r.hash ^ 0x51ed ^ B.seedMix);
      const st = r.style;
      for (const side of [-1, 1]) {
        for (const p of pavementPieces(r, axis, side, range)) {
          const { a, b: bb } = p;
          const inner = side * r.hw;
          const outer = side * (r.hw + SIDEWALK_WIDTH);
          const [x0, z0] = pt(r, a, inner);
          const [x1, z1] = pt(r, bb, outer);
          b.quad(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), SIDEWALK_HEIGHT, top);

          // kerb face + outer edge
          const [ka0x, ka0z] = pt(r, a, inner);
          const [ka1x, ka1z] = pt(r, bb, inner);
          const nIn = r.horiz ? [0, -side] : [-side, 0];
          b.wall(ka0x, ka0z, ka1x, ka1z, 0, SIDEWALK_HEIGHT, nIn[0], nIn[1], kerb);
          const [oa0x, oa0z] = pt(r, a, outer);
          const [oa1x, oa1z] = pt(r, bb, outer);
          b.wall(oa0x, oa0z, oa1x, oa1z, 0, SIDEWALK_HEIGHT, -nIn[0], -nIn[1], edge);

          const endWall = (along: number, towardsLow: boolean) => {
            const [sx0, sz0] = pt(r, along, inner);
            const [sx1, sz1] = pt(r, along, outer);
            const n = r.horiz ? [towardsLow ? -1 : 1, 0] : [0, towardsLow ? -1 : 1];
            b.wall(sx0, sz0, sx1, sz1, 0, SIDEWALK_HEIGHT, n[0], n[1], kerb);
          };
          if (p.flushLo) endWall(a, true);
          if (p.flushHi) endWall(bb, false);

          const len = bb - a;
          const dec = B.decals;

          // kerb-side grime on the asphalt (dark gradient hugging the kerb) + wind-blown dust
          this.gradStrip(dec, r, a, bb, side * (r.hw - 0.45), side * r.hw, DECAL_Y, grime(0), grime(0.34 * st.wear));
          this.gradStrip(dec, r, a, bb, side * (r.hw - 1.0), side * r.hw, DECAL_Y + 0.0002, dustOn(0), dustOn(st.dust * 0.55));

          // dirt gradient on the pavement near its outer edge
          this.gradStrip(dec, r, a, bb, side * (r.hw + SIDEWALK_WIDTH - 0.8), outer, SIDEWALK_HEIGHT + 0.001, dirtOn(0), dirtOn(0.3 + st.dust * 0.25));

          // verge: dust/dirt fading into the grass (two layers for an irregular edge)
          this.gradStrip(dec, r, a, bb, outer, side * (r.hw + SIDEWALK_WIDTH + 0.9), 0.004, dirtOn(0.88), dirtOn(0.0));
          this.gradStrip(dec, r, a, bb, side * (r.hw + SIDEWALK_WIDTH + 0.5), side * (r.hw + SIDEWALK_WIDTH + 1.7), 0.0035, dirtOn(0.38), dirtOn(0.0));

          // open concrete drain with slab covers (sections of the verge; not on main roads)
          if (st.drainChannel) this.openDrain(B, r, side, a, bb, rng);

          // pavement stains (spills, gum, wet patches)
          const stains = Math.floor(len / 14);
          for (let i = 0; i < stains; i++) {
            const along = a + rng() * len;
            const perp = side * (r.hw + 0.3 + rng() * (SIDEWALK_WIDTH - 0.6));
            const [sx, sz] = pt(r, along, perp);
            const sz2 = 0.5 + rng() * 1.1;
            dec.decal(sx, sz, rng() - 0.5, rng() - 0.5, sz2, sz2 * (0.6 + rng() * 0.5), SIDEWALK_HEIGHT + 0.001, rgba('#2a2620', 0.22 + rng() * 0.22), DECAL_CELL.blot);
          }

          // weeds + tufts along the verge, flat debris along kerb gutter and verge
          for (let along = a + 1 + rng() * 2; along < bb - 0.5; along += 1.8 + rng() * 2.6) {
            const perp = side * (r.hw + SIDEWALK_WIDTH + 0.25 + rng() * 1.1);
            const [wx, wz] = pt(r, along, perp);
            const blades = 2 + Math.floor(rng() * 3);
            for (let k = 0; k < blades; k++) {
              const h = 0.16 + rng() * (rng() > 0.85 ? 0.55 : 0.28);
              B.small.blade(
                wx + (rng() - 0.5) * 0.3,
                wz + (rng() - 0.5) * 0.3,
                h,
                0.035 + rng() * 0.03,
                rng() * Math.PI,
                (rng() - 0.5) * 0.2,
                rgba(rng() > 0.5 ? '#3f5b2a' : '#4d6b30'),
                rgba(rng() > 0.4 ? '#8a9a4a' : '#6f8a3a')
              );
            }
          }
          for (let along = a + rng() * 3; along < bb; along += 2.5 + rng() * 3.5) {
            const gutter = rng() > 0.55;
            const perp = gutter ? side * (r.hw - 0.12 - rng() * 0.25) : side * (r.hw + SIDEWALK_WIDTH + 0.2 + rng() * 0.9);
            const [dx, dz] = pt(r, along, perp);
            const kind = rng();
            const y = gutter ? DECAL_Y + 0.0004 : 0.0045;
            if (kind < 0.3) {
              const s = 0.05 + rng() * 0.04;
              this.flat(dec, dx - s, dz - s, dx + s, dz + s, y, rgba(['#d8d8d2', '#c0392b', '#2e86c1', '#d4ac0d'][Math.floor(rng() * 4)], 0.9));
            } else if (kind < 0.6) {
              const w = 0.1 + rng() * 0.18;
              this.flat(dec, dx, dz, dx + w, dz + w * 0.7, y, rgba(rng() > 0.5 ? '#e8e6df' : '#9fb4c6', 0.8));
            } else {
              const w = 0.12 + rng() * 0.12;
              this.flat(dec, dx, dz, dx + w, dz + w * 0.5, y, rgba(rng() > 0.5 ? '#5a4a2a' : '#3d5a2a', 0.85));
            }
          }
        }
      }
    }

    // rounded pavement corners
    for (const { h, v } of inters) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          if (!cornerExists(h, v, sx, sz)) continue;
          const cx = v.c + sx * v.hw;
          const cz = h.c + sz * h.hw;
          const px = cx + sx * CORNER_RADIUS;
          const pz = cz + sz * CORNER_RADIUS;
          const arc: [number, number][] = [];
          for (let i = 0; i <= 8; i++) {
            const t = (i / 8) * (Math.PI / 2);
            arc.push([px - sx * CORNER_RADIUS * Math.cos(t), pz - sz * CORNER_RADIUS * Math.sin(t)]);
          }
          b.fan([[px, pz], ...arc], SIDEWALK_HEIGHT, top);
          for (let i = 0; i < arc.length - 1; i++) {
            const mx = (arc[i][0] + arc[i + 1][0]) / 2 - px;
            const mz = (arc[i][1] + arc[i + 1][1]) / 2 - pz;
            const len = Math.hypot(mx, mz) || 1;
            b.wall(arc[i][0], arc[i][1], arc[i + 1][0], arc[i + 1][1], 0, SIDEWALK_HEIGHT, mx / len, mz / len, kerb);
          }
        }
      }
    }
  }

  /** gradient strip between two perp offsets over [a,b] along r */
  private static gradStrip(dec: MeshBuilder, r: AxisRoad, a: number, b: number, perp0: number, perp1: number, y: number, c0: RGBA, c1: RGBA): void {
    if (b - a < 0.02) return;
    const A = pt(r, a, perp0);
    const Bp = pt(r, b, perp0);
    const C = pt(r, b, perp1);
    const D = pt(r, a, perp1);
    (dec as unknown as { gradQuadWhite: (...args: unknown[]) => void }).gradQuadWhite(A, Bp, C, D, y, c0, c0, c1, c1);
  }

  /** Concrete open drain beside the pavement: lips, dark channel, slab covers with joints */
  private static openDrain(B: Builders, r: AxisRoad, side: number, a: number, b: number, rng: () => number): void {
    const dec = B.decals;
    const base = r.hw + SIDEWALK_WIDTH + 0.55;
    const perpC = side * (base + 0.0);
    const lipCol = rgba('#aaa89f', 0.95);
    const darkCol = rgba('#121416', 0.95);
    const slabCol = rgba('#8f8d85', 1);
    const jointCol = rgba('#5c5b56', 0.9);
    let pos = a + 2.5;
    const end = b - 2.5;
    const slab = 2.4;
    while (pos + slab < end) {
      // driveway / gate crossing: fully slabbed with a ramp tone; or open section; or normal slab
      const roll = rng();
      const yy = 0.006;
      // lips
      this.lineStrip(dec, r, pos, pos + slab, perpC - side * 0.28, 0.1, yy, lipCol);
      this.lineStrip(dec, r, pos, pos + slab, perpC + side * 0.28, 0.1, yy, lipCol);
      if (roll < 0.22) {
        // open section: dark channel visible, a bit of litter
        this.lineStrip(dec, r, pos, pos + slab, perpC, 0.46, yy, darkCol);
      } else {
        this.lineStrip(dec, r, pos + 0.02, pos + slab - 0.02, perpC, 0.5, yy + 0.0006, roll > 0.8 ? rgba('#7f7d76', 1) : slabCol);
        this.lineStrip(dec, r, pos, pos + 0.04, perpC, 0.5, yy + 0.0009, jointCol);
      }
      pos += slab;
    }
  }

  private static lineStrip(dec: MeshBuilder, r: AxisRoad, a: number, b: number, perp: number, width: number, y: number, col: RGBA): void {
    const [x0, z0] = pt(r, a, perp - width / 2);
    const [x1, z1] = pt(r, b, perp + width / 2);
    this.flat(dec, Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), y, col);
  }

  // -------------------------------------------------------------------------------------------
  // Markings
  // -------------------------------------------------------------------------------------------

  private static paint(base: string, fade: number, rng: () => number): RGBA {
    const dirty = rgba('#8d8e8a');
    const c = mix(rgba(base), dirty, fade * (0.3 + rng() * 0.7));
    const j = 0.92 + rng() * 0.08;
    return [c[0] * j, c[1] * j, c[2] * j, 1];
  }

  private static lineAlong(b: MeshBuilder, r: AxisRoad, a: number, bb: number, perp: number, width: number, col: RGBA, y = MARK_Y): void {
    if (bb - a < 0.02) return;
    const [x0, z0] = pt(r, a, perp - width / 2);
    const [x1, z1] = pt(r, bb, perp + width / 2);
    b.quad(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), y, col);
  }

  /** Solid line built from several segments with the occasional worn gap */
  private static lineBroken(b: MeshBuilder, r: AxisRoad, a: number, bb: number, perp: number, width: number, base: string, rng: () => number): void {
    const fade = r.style.fade;
    let pos = a;
    while (pos < bb - 0.1) {
      const seg = 5 + rng() * 9;
      const end = Math.min(bb, pos + seg);
      this.lineAlong(b, r, pos, end, perp, width, this.paint(base, fade, rng));
      pos = end;
      if (rng() < 0.05 + fade * 0.25) pos += 0.35 + rng() * 0.9;
    }
  }

  private static dashed(b: MeshBuilder, r: AxisRoad, a: number, bb: number, perp: number, width: number, base: string, rng: () => number, dash = 3, gap = 5): void {
    // phase anchored to absolute road coordinates => seamless across streamed cell borders
    const period = dash + gap;
    let k = Math.ceil((a - 0.01) / period);
    for (let pos = k * period; pos + dash <= bb + 0.01; pos = ++k * period) {
      if (pos < a) continue;
      // deterministic per-dash wear (hash of road + index) so every cell agrees
      const h = (Math.imul(k, 2654435761) ^ r.hash) >>> 0;
      const u = (h & 0xffff) / 65535;
      const u2 = ((h >>> 16) & 0xffff) / 65535;
      if (u > r.style.fade * 0.12) {
        const s0 = pos + (u2 - 0.5) * 0.25;
        this.lineAlong(b, r, s0, s0 + dash - u * 0.3, perp, width, this.paint(base, r.style.fade, () => (u + u2) / 2), MARK_Y);
      }
    }
    void rng;
  }

  private static arrow(b: MeshBuilder, r: AxisRoad, edgeAlong: number, side: number, perpC: number, kind: 'straight' | 'left', col: RGBA): void {
    // Traffic approaches the junction from `side`, moving in direction dir along the road axis.
    const dir = -side;
    const rightPerp = r.horiz ? dir : -dir;
    const tail = edgeAlong + side * 13.5; // far from stop line
    const toW = (f: number, l: number): [number, number] => pt(r, tail + dir * f, perpC + rightPerp * l);
    const poly = (pts: [number, number][]) => b.fan(pts.map((p) => toW(p[0], p[1])), MARK_Y + 0.0005, col);
    if (kind === 'straight') {
      poly([[0, -0.09], [0, 0.09], [2.3, 0.09], [2.3, -0.09]]);
      poly([[2.3, -0.38], [2.3, 0.38], [3.3, 0]]);
    } else {
      // left turn: stem then a leftwards arm with a head
      poly([[0, -0.09], [0, 0.09], [1.5, 0.09], [1.5, -0.09]]);
      poly([[1.5 - 0.09, -0.09], [1.5 - 0.09, 0.09], [1.5 + 0.09, 0.09], [1.5 + 0.09, -0.09], [1.5 + 0.09, -0.9], [1.5 - 0.09, -0.9]]);
      poly([[1.5 + 0.38, -0.9], [1.5 - 0.38, -0.9], [1.5, -1.65]].map((p) => [p[0], p[1]] as [number, number]));
    }
  }

  private static buildMarkings(B: Builders, axis: AxisRoad[], inters: Intersection[]): void {
    const b = B.marks;
    for (const r of axis) {
      const range = alongRange(r, B.clip);
      if (!range) continue;
      const rng = makeRng(r.hash ^ 0xa11ce ^ B.seedMix);
      const st = r.style;
      const pieces = piecesBetweenCuts(r, cutsFor(r, axis, MARKING_CLEARANCE))
        .map((p) => clipPiece(p, range))
        .filter((p): p is NonNullable<typeof p> => !!p);
      for (const p of pieces) {
        const a = p.a + (p.loCut || p.cutLo ? 0 : 1.0);
        const bb = p.b - (p.hiCut || p.cutHi ? 0 : 1.0);
        if (bb - a < 2) continue;

        if (st.edgeLines) {
          this.lineBroken(b, r, a, bb, r.hw - 0.4, 0.14, '#ececE6', rng);
          this.lineBroken(b, r, a, bb, -(r.hw - 0.4), 0.14, '#ececE6', rng);
        }

        if (r.lanes >= 4) {
          this.lineBroken(b, r, a, bb, -0.14, 0.11, '#e8b323', rng);
          this.lineBroken(b, r, a, bb, 0.14, 0.11, '#e8b323', rng);
          this.dashed(b, r, a, bb, r.hw / 2, 0.13, '#ececE6', rng);
          this.dashed(b, r, a, bb, -r.hw / 2, 0.13, '#ececE6', rng);
        } else if (st.cls === 'secondary') {
          this.dashed(b, r, a, bb, 0, 0.13, '#e8b323', rng, 3, 6);
        } else {
          // residential: just a faint broken centre dash
          this.dashed(b, r, a, bb, 0, 0.11, '#e0e0da', rng, 2, 7);
        }
      }
    }

    for (const { h, v } of inters) {
      for (const { r, other } of [
        { r: h, other: v },
        { r: v, other: h },
      ]) {
        const rng = makeRng(r.hash ^ other.hash ^ 0x2ebe ^ B.seedMix);
        for (const side of [-1, 1]) {
          const edgeAlong = other.c + side * other.hw;
          const reach = side > 0 ? r.hi - edgeAlong : edgeAlong - r.lo;
          if (reach < 8) continue;

          const white = '#ececE6';
          const dir = -side;
          const perpSign = r.horiz ? dir : -dir;

          if (r.style.zebra) {
            const z0 = edgeAlong + side * 1.0;
            const z1 = edgeAlong + side * 3.6;
            const lo = Math.min(z0, z1);
            const hi = Math.max(z0, z1);
            for (let pp = -r.hw + 0.55; pp < r.hw - 0.5; pp += 1.1) {
              this.lineAlong(b, r, lo, hi, pp + 0.275, 0.55, this.paint(white, r.style.fade * 0.9, rng));
            }
            // tyre grime across the zebra, in each driving lane's wheel paths
            const laneW = (r.hw * 2) / r.lanes;
            for (let l = 0; l < r.lanes; l++) {
              const centre = -r.hw + (l + 0.5) * laneW;
              for (const off of [-0.85, 0.85]) {
                const [gx, gz] = pt(r, (lo + hi) / 2, centre + off);
                const along = r.horiz ? [1, 0] : [0, 1];
                B.decals.decal(gx, gz, along[0], along[1], (hi - lo) / 2 + 0.3, 0.38, MARK_Y + 0.0015, rgba('#000000', 0.38 * r.style.wear), DECAL_CELL.grime);
              }
            }
          }

          // stop line for approaching traffic
          const s0 = edgeAlong + side * 4.2;
          const s1 = edgeAlong + side * (r.style.cls === 'residential' ? 4.45 : 4.7);
          const p0 = perpSign * 0.3;
          const p1 = perpSign * (r.hw - 0.45);
          const [xa, za] = pt(r, Math.min(s0, s1), Math.min(p0, p1));
          const [xb, zb] = pt(r, Math.max(s0, s1), Math.max(p0, p1));
          b.quad(Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb), MARK_Y, this.paint(white, r.style.fade, rng));

          // lane guidance arrows on main roads
          if (r.style.arrows && reach > 22) {
            this.arrow(b, r, edgeAlong, side, perpSign * (r.hw * 0.25), 'left', this.paint(white, r.style.fade, rng));
            this.arrow(b, r, edgeAlong, side, perpSign * (r.hw * 0.75), 'straight', this.paint(white, r.style.fade, rng));
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Wear, grime, drains, manholes, speed bumps
  // -------------------------------------------------------------------------------------------

  private static disc(b: MeshBuilder, x: number, z: number, rx: number, rz: number, y: number, col: RGBA, rot = 0, segs = 12): void {
    const pts: [number, number][] = [[x, z]];
    for (let i = 0; i <= segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      const ex = Math.cos(t) * rx;
      const ez = Math.sin(t) * rz;
      pts.push([x + ex * Math.cos(rot) - ez * Math.sin(rot), z + ex * Math.sin(rot) + ez * Math.cos(rot)]);
    }
    b.fan(pts, y, col);
  }

  private static discWhite(b: MeshBuilder, x: number, z: number, rx: number, rz: number, y: number, col: RGBA, rot = 0, segs = 12): void {
    const pts: [number, number][] = [[x, z]];
    for (let i = 0; i <= segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      const ex = Math.cos(t) * rx;
      const ez = Math.sin(t) * rz;
      pts.push([x + ex * Math.cos(rot) - ez * Math.sin(rot), z + ex * Math.sin(rot) + ez * Math.cos(rot)]);
    }
    this.flatPoly(b, pts, y, col);
  }

  private static buildWear(B: Builders, axis: AxisRoad[], inters: Intersection[]): void {
    const dec = B.decals;
    const marks = B.marks;

    for (const r of axis) {
      const range = alongRange(r, B.clip);
      if (!range) continue;
      const rng = makeRng(r.hash ^ B.seedMix);
      const st = r.style;
      const laneW = (r.hw * 2) / r.lanes;
      const along = r.horiz ? [1, 0] : [0, 1];
      const lanePerps: number[] = [];
      for (let l = 0; l < r.lanes; l++) lanePerps.push(-r.hw + (l + 0.5) * laneW);
      // keep decals away from painted line positions
      const linePerps = r.lanes >= 4 ? [-r.hw / 2, 0, r.hw / 2, r.hw - 0.4, -(r.hw - 0.4)] : [0];
      const awayFromLines = (p: number, margin: number) => {
        for (const lp of linePerps) if (Math.abs(p - lp) < margin) return p + (p >= lp ? 1 : -1) * (margin - Math.abs(p - lp));
        return p;
      };

      const cuts = cutsFor(r, axis, 1.5);
      const clipped = (ps: Piece[]) => ps.map((p) => clipPiece(p, range)).filter((p): p is NonNullable<typeof p> => !!p);
      // tyre wear tracks: soft grime streaks along each wheel path
      for (const p of clipped(piecesBetweenCuts(r, cuts))) {
        for (const centre of lanePerps) {
          for (const off of [-0.8, 0.8]) {
            const [x0, z0] = pt(r, p.a + 0.5, centre + off - 0.28);
            const [x1, z1] = pt(r, p.b - 0.5, centre + off + 0.28);
            this.flat(dec, Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), DECAL_Y, rgba('#050506', 0.16 * st.wear));
          }
        }
      }

      const pieces = clipped(piecesBetweenCuts(r, cutsFor(r, axis, MARKING_CLEARANCE)));
      for (const p of pieces) {
        const len = p.b - p.a;
        if (len < 14) continue;
        const per100 = len / 100;

        // repaired patches
        const patches = Math.round(st.patches * per100 + rng() * 0.6);
        for (let i = 0; i < patches; i++) {
          const al = p.a + 6 + rng() * (len - 12);
          const perp = awayFromLines(lanePerps[Math.floor(rng() * r.lanes)] + (rng() - 0.5) * 1.1, 0.7);
          const [x, z] = pt(r, al, perp);
          const L = 2.2 + rng() * 3.4;
          const W = 1.1 + rng() * 1.6;
          dec.decal(x, z, along[0], along[1], L / 2, W / 2, DECAL_Y + 0.0006, rgba('#ffffff', 0.62 + rng() * 0.28), DECAL_CELL.patch);
        }

        // cracks
        const cracks = Math.round(st.cracks * per100 + rng() * 0.5);
        for (let i = 0; i < cracks; i++) {
          const al = p.a + 4 + rng() * (len - 8);
          const perp = awayFromLines((rng() - 0.5) * (r.hw * 1.6), 0.5);
          const [x, z] = pt(r, al, perp);
          const ang = rng() * Math.PI;
          const s = 1.8 + rng() * 2.4;
          dec.decal(x, z, Math.cos(ang), Math.sin(ang), s, s, DECAL_Y + 0.0004, rgba('#ffffff', 0.75 + rng() * 0.25), DECAL_CELL.crack);
        }

        // long tar-filled seams down the road (patchy, slightly wandering) and transverse joint cuts every 12-30 m
        const seams = st.resurfaced ? 0 : r.hw > 5 ? 2 : 1;
        for (let sIdx = 0; sIdx < seams; sIdx++) {
          let perp = awayFromLines((rng() - 0.5) * (r.hw * 1.5), 0.5);
          for (let al = p.a + 2; al < p.b - 3; ) {
            const step = 2 + rng() * 3.5;
            perp += (rng() - 0.5) * 0.06;
            if (rng() > 0.22) {
              const hwid = 0.025 + rng() * 0.03;
              const [x0, z0] = pt(r, al, perp - hwid);
              const [x1, z1] = pt(r, Math.min(al + step, p.b - 2), perp + hwid);
              this.flat(dec, Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), DECAL_Y + 0.0003, rgba('#040405', 0.62));
            }
            al += step + 0.15;
          }
        }
        for (let al = p.a + 8 + rng() * 10; al < p.b - 8; al += 12 + rng() * 18) {
          if (st.resurfaced && rng() > 0.4) continue;
          let q = -r.hw + 0.3;
          while (q < r.hw - 0.3) {
            const seg = 0.7 + rng() * 2.2;
            if (rng() > 0.2) {
              const [x0, z0] = pt(r, al - 0.03, q);
              const [x1, z1] = pt(r, al + 0.03, Math.min(q + seg, r.hw - 0.3));
              this.flat(dec, Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), DECAL_Y + 0.0003, rgba('#040405', 0.55));
            }
            q += seg + 0.1;
          }
        }

        // oil stains in lane centres (where cars idle) - more near junction approaches
        const stains = Math.round(st.stains * per100 + rng() * 0.5);
        for (let i = 0; i < stains; i++) {
          const al = p.a + 5 + rng() * (len - 10);
          const perp = awayFromLines(lanePerps[Math.floor(rng() * r.lanes)] + (rng() - 0.5) * 0.7, 0.5);
          const [x, z] = pt(r, al, perp);
          const s = 1.0 + rng() * 1.5;
          dec.decal(x, z, rng() - 0.5, rng() - 0.5, s, s * 0.7, DECAL_Y + 0.0002, rgba('#ffffff', 0.6 + rng() * 0.2), DECAL_CELL.blot);
        }

        // potholes (small; only on poorer streets)
        const holes = Math.round(st.potholes * per100 + (st.potholes > 0 ? rng() * 0.4 : 0));
        for (let i = 0; i < holes; i++) {
          const al = p.a + 6 + rng() * (len - 12);
          const perp = awayFromLines((rng() - 0.5) * (r.hw * 1.4), 0.5);
          const [x, z] = pt(r, al, perp);
          const rad = 0.22 + rng() * 0.22;
          this.discWhite(dec, x, z, rad * 1.8, rad * 1.5, DECAL_Y + 0.001, rgba('#0a0a0b', 0.2), rng() * 3, 10);
          this.discWhite(dec, x, z, rad, rad * 0.85, DECAL_Y + 0.002, rgba('#060607', 0.8), rng() * 3, 10);
        }

        // manholes (lane centres, spacing along the road)
        for (let a = p.a + 14 + rng() * 10; a < p.b - 8; a += 38 + rng() * 16) {
          const perp = (rng() > 0.5 ? 1 : -1) * (laneW * (0.45 + rng() * 0.7));
          const [x, z] = pt(r, a, perp);
          this.disc(marks, x, z, 0.5, 0.5, MARK_Y, rgba('#5a5f65'), 0, 14);
          this.disc(marks, x, z, 0.38, 0.38, MARK_Y + 0.0005, rgba('#2b2e33'), 0, 14);
        }

        // speed bump on residential streets (painted rumble stripes)
        if (st.cls === 'residential' && len > 40) {
          const a = p.a + len / 2 + (rng() - 0.5) * 6;
          const stripes = Math.ceil((r.hw * 2 - 1.2) / 0.5);
          for (let k = 0; k < stripes; k++) {
            const pp0 = -r.hw + 0.6 + k * 0.5;
            const col = k % 2 === 0 ? this.paint('#e8b323', st.fade, rng) : rgba('#1b1c1f');
            this.lineAlong(marks, r, a, a + 1.1, pp0 + 0.25, 0.5, col, MARK_Y + 0.001);
          }
        }
      }

      // storm drains: catch basins before each crosswalk (upstream of the junction) + regular kerb spacing
      const drainSpots: { a: number; side: number }[] = [];
      for (const c of cutsFor(r, axis, 0)) {
        for (const side of [-1, 1]) {
          drainSpots.push({ a: c.a - 7.3, side });
          drainSpots.push({ a: c.b + 7.3, side });
        }
      }
      for (const p of pieces) {
        for (let a = p.a + 12 + rng() * 8; a < p.b - 10; a += 46 + rng() * 12) drainSpots.push({ a, side: rng() > 0.5 ? 1 : -1 });
      }
      for (const d of drainSpots) {
        if (d.a < r.lo + 3 || d.a > r.hi - 3 || d.a < range[0] || d.a > range[1]) continue;
        const perp = d.side * (r.hw - 0.3);
        this.lineAlong(marks, r, d.a, d.a + 0.95, perp, 0.5, rgba('#0f1113'));
        for (let k = 0; k < 4; k++) {
          this.lineAlong(marks, r, d.a + 0.12 + k * 0.23, d.a + 0.2 + k * 0.23, perp, 0.5, rgba('#4a4f55'), MARK_Y + 0.0005);
        }
        // staining running down towards the grate
        const [sx, sz] = pt(r, d.a - 1.2, perp);
        dec.decal(sx, sz, along[0], along[1], 1.4, 0.35, DECAL_Y + 0.0003, rgba('#ffffff', 0.35), DECAL_CELL.grime);
      }
    }

    // junction centres: heavy tyre grime on turning arcs
    for (const { h, v } of inters) {
      const rng = makeRng(h.hash ^ v.hash ^ B.seedMix);
      for (let i = 0; i < 6; i++) {
        const x = v.c + (rng() - 0.5) * v.hw * 1.5;
        const z = h.c + (rng() - 0.5) * h.hw * 1.5;
        dec.decal(x, z, rng() - 0.5, rng() - 0.5, 1.2 + rng() * 0.8, 0.35 + rng() * 0.2, DECAL_Y + 0.0002, rgba('#ffffff', 0.16), DECAL_CELL.grime);
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Fallback for roads that are not axis aligned
  // -------------------------------------------------------------------------------------------

  private static buildFreeform(B: Builders, road: RoadSegment): void {
    const dx = road.end.x - road.start.x;
    const dz = road.end.z - road.start.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) return;
    const ux = dx / len;
    const uz = dz / len;
    const px = -uz;
    const pz = ux;
    const hw = road.width / 2;
    const corner = (a: number, p: number): [number, number] => [road.start.x + ux * a + px * p, road.start.z + uz * a + pz * p];

    B.asphalt.fan([corner(0, -hw), corner(len, -hw), corner(len, hw), corner(0, hw)], ASPHALT_Y, [0.95, 0.95, 0.95, 1]);
    if (road.hasSidewalk) {
      for (const s of [-1, 1]) {
        B.paving.fan(
          [corner(0, s * hw), corner(len, s * hw), corner(len, s * (hw + SIDEWALK_WIDTH)), corner(0, s * (hw + SIDEWALK_WIDTH))],
          SIDEWALK_HEIGHT,
          [1, 1, 1, 1]
        );
        const a = corner(0, s * hw);
        const b = corner(len, s * hw);
        B.paving.wall(a[0], a[1], b[0], b[1], 0, SIDEWALK_HEIGHT, px * -s, pz * -s, rgba('#e4e2dc'));
      }
    }
    const white = rgba('#dededa');
    for (let a = 2; a + 3 < len - 2; a += 8) {
      B.marks.fan([corner(a, -0.07), corner(a + 3, -0.07), corner(a + 3, 0.07), corner(a, 0.07)], MARK_Y, white);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// White-texel helpers on MeshBuilder (flat decals sample the atlas' solid white block)
// ---------------------------------------------------------------------------------------------

type Internals = {
  topTri: (a: [number, number], b: [number, number], c: [number, number], y: number, ca: RGBA, cb?: RGBA, cc?: RGBA, uvs?: [[number, number], [number, number], [number, number]]) => void;
};

(MeshBuilder.prototype as unknown as Record<string, unknown>).fanWhite = function (this: Internals & { isNull?: boolean }, pts: [number, number][], y: number, col: RGBA): void {
  if (this.isNull) return;
  const w = DECAL_WHITE_UV;
  for (let i = 1; i < pts.length - 1; i++) this.topTri(pts[0], pts[i], pts[i + 1], y, col, col, col, [w, w, w]);
};

(MeshBuilder.prototype as unknown as Record<string, unknown>).gradQuadWhite = function (
  this: Internals & { isNull?: boolean },
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
  y: number,
  ca: RGBA,
  cb: RGBA,
  cc: RGBA,
  cd: RGBA
): void {
  if (this.isNull) return;
  const w = DECAL_WHITE_UV;
  this.topTri(a, b, c, y, ca, cb, cc, [w, w, w]);
  this.topTri(a, c, d, y, ca, cc, cd, [w, w, w]);
};
