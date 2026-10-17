/**
 * CurvedRoads - pure data for the curved road network (no THREE, no DOM, deterministic).
 *
 * The whole map outside the hand-built downtown grid (|x|, |z| <= GRID_EDGE) is "curved world": rolling terrain, hills,
 * a river, curved roads with elevation profiles, bridges, viaducts and ramps.
 *
 *   chunk 1 = north-east corner (x  450.. 900, z -900..-450): a mountain with switchbacks, a stream, 2 bridges
 *   chunk 2 = north-west corner (x -900..-450, z -900..-450): wooded heights with a spiral road, a river, 2 bridges
 *   the city (CityPlan.ts): backbone roads (arms, rings, beltway, expressway, flyovers, river bridges) + grown streets
 *
 *  - baseHeight / terrainHeight : hills, river valleys, road beds and embankments
 *  - getCurvedNetwork()         : roads sampled into dense centrelines with elevation profiles, bridges over water,
 *                                 viaducts / flyovers (decks standing clear of the ground), T-junctions and ramp merges
 *  - groundHeightAt()           : what the player / camera / beacon stand on (terrain, road surface, pavement, deck)
 *
 * Roads enter a chunk through the cut grid roads; each curved road starts exactly on the old road's centreline at the
 * old width and runs straight for a short lead. A road may also END on a border (`exit`).
 */
import { sidewalkHeightAt } from './SidewalkHeight';
import { Ctrl, V2, clamp, densePath, segDist, sstep, vnoise } from './RoadMath';
import type { Bridge, BuiltRoad, CurvedClass, CurvedRoad, GrowApi, Hill, Junction, NearestRoad, RoadDef, RoadSample, StreamDef } from './RoadTypes';
import { CITY_DEFS, CITY_HILLS, CITY_STREAMS, growCity } from './CityPlan';

import { farGroundAt } from './barracks/BarracksLayout';
export type { V2 } from './RoadMath';
export type { Bridge, CurvedClass, CurvedRoad, Junction, RoadSample } from './RoadTypes';

export interface ChunkRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export const CHUNK_1: ChunkRect = { minX: 450, maxX: 900, minZ: -900, maxZ: -450 };
export const CHUNK_2: ChunkRect = { minX: -900, maxX: -450, minZ: -900, maxZ: -450 };
export const CHUNKS: readonly ChunkRect[] = [CHUNK_1, CHUNK_2];
/** z of the south border shared by the two corner chunks */
export const CHUNK_Z_BORDER = -450;
/** the old flat ground plane extends 20 m past the +-900 m world edge; the terrain covers the same margin */
export const WORLD_EDGE = 920;
/** the hand-built downtown grid (core + its short arms) fills |x|, |z| <= GRID_EDGE; everything else is curved world */
export const GRID_EDGE = 105;

/** inside one of the two corner chunks */
export const inCorner = (x: number, z: number): boolean => z < CHUNK_Z_BORDER && (x >= CHUNK_1.minX || x < CHUNK_2.maxX);
/** curved world = everywhere except the downtown grid square */
export const inChunk = (x: number, z: number): boolean => Math.abs(x) > GRID_EDGE || Math.abs(z) > GRID_EDGE;
/** does a streamed cell (150 m rect) have any curved-world ground? (every cell does: the grid square is smaller than 2 cells) */
export const rectInChunk = (r: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean =>
  r.maxX > GRID_EDGE || r.minX < -GRID_EDGE || r.maxZ > GRID_EDGE || r.minZ < -GRID_EDGE;

export const SHOULDER = 1.4; // gravel shoulder beyond the asphalt (and beyond the kerbed pavement)
/** the gravel verge's outer edge sits this far above the terrain bed (so the two meshes never z-fight); the walking height uses the same number */
export const GRAVEL_LIP = 0.01;
export const PAVEMENT_W = 2.4;
export const PAVEMENT_H = 0.16;
/** dead-end turning circle (CurvedRoadBuilder draws it, groundHeightAt lets you stand on it): asphalt disc of radius hw + TURN_APRON,
 *  then a kerbed paving ring TURN_PAVING wide at PAVEMENT_H, then a gravel apron TURN_GRAVEL wide sloping down to -0.04 */
export const TURN_APRON = 2.0;
export const TURN_PAVING = 2.0;
export const TURN_GRAVEL = 1.4;
/** a deck counts as a viaduct / flyover once the road surface stands this far above the terrain */
export const VIADUCT_MIN = 1.0;
const STEP = 2.5; // centreline sample spacing (m)
const LEAD = 18; // straight run at every border entry and junction mouth (m)

/** radius of the rounded kerb corners at a T-junction */
export const filletRadius = (host: CurvedClass): number => (host === 'main' || host === 'freeway' ? 8 : 6);

// ------------------------------------------------------------------------------------------------
// Base terrain (no roads, no stream): exactly 0 on the corner chunks' inner borders, hills inside
// ------------------------------------------------------------------------------------------------

const HILLS_1: Hill[] = [
  { x: 835, z: -850, r: 150, h: 52 }, // the mountain (north-east corner)
  { x: 620, z: -835, r: 115, h: 21 },
  { x: 845, z: -560, r: 105, h: 17 },
  { x: 520, z: -700, r: 80, h: 9 },
];

const HILLS_2: Hill[] = [
  { x: -790, z: -790, r: 118, h: 40 }, // Western Heights (north-west corner), wooded, climbed by a spiral road
  { x: -560, z: -860, r: 95, h: 16 }, // the knoll north of the Heights Road
  { x: -885, z: -575, r: 95, h: 18 }, // south-west ridge
  { x: -560, z: -600, r: 70, h: 8 }, // low swell in the pocket behind the bypass
];


export const CHUNK_HILLS: readonly { rect: ChunkRect; hills: readonly Hill[] }[] = [
  { rect: CHUNK_1, hills: HILLS_1 },
  { rect: CHUNK_2, hills: HILLS_2 },
];

/** read-only: the hills the minimap shades, per chunk (+ the city hills) */
export const CITY_HILL_LIST: readonly Hill[] = CITY_HILLS;

function cityBase(x: number, z: number): number {
  let h = 0;
  let warp = 0;
  for (const b of CITY_HILLS) {
    if (Math.abs(x - b.x) > b.r * 1.2 || Math.abs(z - b.z) > b.r * 1.2) continue; // far from every hill: flat plain, no noise needed
    if (!warp) warp = 1 + 0.28 * (vnoise(x / 70, z / 70, 13) - 0.5);
    const t = (Math.hypot(x - b.x, z - b.z) * warp) / b.r;
    if (t < 1) h += b.h * (1 - t * t) * (1 - t * t);
  }
  if (h > 0) h += (vnoise(x / 60, z / 60, 7) - 0.5) * 1.6 * sstep(0, 6, h);
  return h;
}

export function baseHeight(x: number, z: number): number {
  if (!inChunk(x, z)) return 0;
  if (!inCorner(x, z)) return cityBase(x, z);
  const east = x >= CHUNK_1.minX;
  const hills = east ? HILLS_1 : HILLS_2;
  // distance to the nearest border with the flat grid (inner side border / south border): height fades to exactly 0 there
  const f = sstep(0, 90, Math.min(east ? x - CHUNK_1.minX : CHUNK_2.maxX - x, CHUNK_Z_BORDER - z));
  if (f <= 0) return 0;
  const warp = 1 + 0.28 * (vnoise(x / 70, z / 70, east ? 11 : 12) - 0.5);
  let h = 0;
  for (const b of hills) {
    const t = (Math.hypot(x - b.x, z - b.z) * warp) / b.r;
    if (t < 1) h += b.h * (1 - t * t) * (1 - t * t);
  }
  h += (vnoise(x / 95, z / 95, east ? 3 : 5) - 0.5) * 6 + (vnoise(x / 38, z / 38, east ? 4 : 6) - 0.5) * 2;
  return h * f;
}

// ------------------------------------------------------------------------------------------------
// Streams (chunk streams + the city river)
// ------------------------------------------------------------------------------------------------

export interface StreamData {
  pts: V2[];
  /** river-bed height (before the -0.05 ground-plane offset) */
  bed: number[];
  /** water surface height */
  water: number[];
  halfWidth: number;
  depth: number;
}

/** water courses, listed upstream -> downstream (the bed only ever falls along the list) */
const STREAM_DEFS: StreamDef[] = [
  // chunk 1: a stream from the north edge round the foot of the mountain and out through the east edge
  {
    half: 5.5,
    ctrl: [
      [566, -926], [574, -890], [582, -860], [612, -826], [660, -806], [705, -782], [735, -748],
      [752, -705], [786, -668], [840, -654], [900, -668], [928, -676],
    ],
  },
  // chunk 2: a wider river from the north edge down the valley between the Heights and the knoll, then west
  // along the south foot of the Heights and out through the west edge
  {
    half: 7,
    ctrl: [
      [-612, -926], [-610, -880], [-615, -840], [-630, -800], [-655, -760], [-682, -715], [-732, -672],
      [-790, -655], [-850, -660], [-900, -676], [-930, -684],
    ],
  },
];
const STREAM_STEP = 4;
const ALL_STREAMS: StreamDef[] = [...STREAM_DEFS, ...CITY_STREAMS];

function buildStream(def: StreamDef): StreamData {
  const depth = def.depth ?? 1.7;
  const pts = densePath(def.ctrl, STREAM_STEP);
  const raw = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / l;
    const nz = (b[0] - a[0]) / l;
    let m = Infinity;
    for (const o of [-12, -6, 0, 6, 12]) m = Math.min(m, baseHeight(p[0] + nx * o, p[1] + nz * o));
    return m - depth;
  });
  // smooth, then only ever flow downhill
  const sm = raw.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let k = -6; k <= 6; k++) {
      const j = clamp(i + k, 0, raw.length - 1);
      s += raw[j];
      c++;
    }
    return s / c;
  });
  const bed: number[] = [];
  let lo = Infinity;
  for (const v of sm) {
    lo = Math.min(lo, v);
    bed.push(lo);
  }
  return { pts, bed, water: bed.map((b) => b + depth - 1.15), halfWidth: def.half, depth };
}

// ------------------------------------------------------------------------------------------------
// Roads
// ------------------------------------------------------------------------------------------------

export interface CurvedNetwork {
  roads: CurvedRoad[];
  byId: Map<string, CurvedRoad>;
  /** every water course (chunk streams + the city river) */
  streams: StreamData[];
  bridges: Bridge[];
  junctions: Junction[];
}

const CLASS_INFO: Record<CurvedClass, { width: number; lanes: number; grade: number }> = {
  freeway: { width: 20, lanes: 6, grade: 0.06 },
  main: { width: 14, lanes: 4, grade: 0.07 },
  secondary: { width: 9, lanes: 2, grade: 0.09 },
  residential: { width: 8, lanes: 2, grade: 0.1 },
  rural: { width: 7, lanes: 2, grade: 0.11 },
  mountain: { width: 6.5, lanes: 2, grade: 0.12 },
};
export const CLASS_WIDTH: Record<CurvedClass, number> = { freeway: 20, main: 14, secondary: 9, residential: 8, rural: 7, mountain: 6.5 };

/** the mountain road: legs stacked up the south-west flank joined by 9 m-radius hairpins */
function switchbacks(): Ctrl[] {
  const out: Ctrl[] = [];
  const R = 9;
  // each leg runs at a fixed z; the hairpin at its end is centred R further north
  const legs: { z: number; from: number; to: number }[] = [
    { z: -814, from: 815, to: 756 }, // west
    { z: -832, from: 752, to: 842 }, // east
    { z: -850, from: 842, to: 764 }, // west
    { z: -868, from: 764, to: 826 }, // east, ends at the lookout
  ];
  legs.forEach((leg, k) => {
    const dir = Math.sign(leg.to - leg.from);
    const len = Math.abs(leg.to - leg.from);
    const n = Math.max(1, Math.round(len / 26));
    for (let i = k === 0 ? 0 : 1; i <= n; i++) out.push([leg.from + (dir * len * i) / n, leg.z]);
    if (k < legs.length - 1) {
      // semicircle bulging beyond the end of the leg
      const cz = leg.z - R;
      for (const th of [Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) out.push([leg.to + dir * R * Math.sin(th), cz + R * Math.cos(th)]);
    }
  });
  return out;
}

/** the Heights Road's spiral round Western Heights (counter-clockwise on the map): from the south-east foot (r = 95 m) 1.33 turns up to r = 26 m */
const HEIGHTS = { x: -790, z: -790 } as const;
function heightsSpiral(): Ctrl[] {
  const out: Ctrl[] = [];
  const a0 = 60;
  const a1 = -420;
  const r0 = 95;
  const r1 = 26;
  for (let a = a0; a >= a1; a -= 20) {
    const r = r0 + ((r1 - r0) * (a0 - a)) / (a0 - a1);
    const th = (a * Math.PI) / 180;
    out.push([Math.round((HEIGHTS.x + r * Math.cos(th)) * 10) / 10, Math.round((HEIGHTS.z + r * Math.sin(th)) * 10) / 10]);
  }
  return out;
}

const DEFS: RoadDef[] = [
  // ---- the main bypass: west main entry -> sweeping bend -> south main entry (14 m, the "highway") ----
  {
    id: 'cr_r1', name: 'Bypass Highway', cls: 'main',
    entry: { lineId: 'road_ghn6', axis: 'h', x: 450, z: -671, dx: 1, dz: 0 },
    exit: { lineId: 'road_gvp6', axis: 'v' },
    ctrl: [[540, -682], [606, -672], [660, -640], [697, -590], [706, -535], [692, -490], [679.264, -468], [679.264, -450, 0, 1]],
  },
  // ---- secondary road crossing the stream on the big bridge and running along the foot of the mountain ----
  {
    id: 'cr_r2', name: 'Valley Road', cls: 'secondary',
    from: { host: 'cr_r1', hint: [655, -648] },
    ctrl: [[690, -704], [716, -728], [738, -752], [765, -772], [812, -768], [860, -760]],
  },
  // ---- winding mountain road with hairpins up to the lookout ----
  {
    id: 'cr_r3', name: 'Crest Road', cls: 'mountain',
    from: { host: 'cr_r2', hint: [815, -770] },
    ctrl: switchbacks(),
  },
  // ---- secondary entry roads (west + south) ----
  {
    id: 'cr_r4a', name: 'Ridge Link', cls: 'secondary',
    entry: { lineId: 'road_ghn5', axis: 'h', x: 450, z: -566.9, dx: 1, dz: 0 },
    ctrl: [[520, -580], [572, -558], [622, -572], [668, -568]],
    join: { host: 'cr_r1', hint: [704, -568] },
  },
  {
    id: 'cr_r4b', name: 'Orchard Road', cls: 'secondary',
    entry: { lineId: 'road_gvp5', axis: 'v', x: 568.9, z: -450, dx: 0, dz: -1 },
    ctrl: [[574, -505], [584, -535]],
    join: { host: 'cr_r4a', hint: [592, -562] },
  },
  // ---- residential hill streets ----
  {
    id: 'cr_r5a', name: 'Hillcrest Avenue', cls: 'residential',
    entry: { lineId: 'road_gvp4', axis: 'v', x: 478.5, z: -450, dx: 0, dz: -1 },
    ctrl: [[478.5, -492], [488, -520], [503, -546]],
    join: { host: 'cr_r4a', hint: [514, -574] },
  },
  {
    id: 'cr_r5b', name: 'Hillcrest Link', cls: 'residential',
    entry: { lineId: 'road_ghn4', axis: 'h', x: 450, z: -472.2, dx: 1, dz: 0 },
    ctrl: [],
    join: { host: 'cr_r5a', hint: [478.5, -472.2] },
  },
  {
    id: 'cr_r6', name: 'Brookside Lane', cls: 'rural',
    entry: { lineId: 'road_ghn7', axis: 'h', x: 450, z: -782.3, dx: 1, dz: 0 },
    ctrl: [[520, -774], [566, -758], [610, -772], [640, -800], [676, -826], [712, -826]],
  },
  {
    id: 'cr_r7', name: 'Quarry Road', cls: 'rural',
    entry: { lineId: 'road_gvp7', axis: 'v', x: 789, z: -450, dx: 0, dz: -1 },
    ctrl: [[790, -505], [775, -548], [748, -582], [724, -598]],
    join: { host: 'cr_r1', hint: [700, -602] },
  },

  // =================================== chunk 2: north-west corner ===================================
  // ---- the western bypass: east main entry -> sweeping bend round the pocket -> south main entry (14 m) ----
  {
    id: 'cr_w1', name: 'Western Bypass', cls: 'main',
    entry: { lineId: 'road_ghn6', axis: 'h', x: -450, z: -670.978, dx: -1, dz: 0 },
    exit: { lineId: 'road_gvn6', axis: 'v' },
    ctrl: [[-520, -676], [-580, -668], [-630, -650], [-662, -615], [-675, -570], [-672, -520], [-665.232, -468], [-665.232, -450, 0, 1]],
  },
  // ---- the pocket between the bypass and the border: a small hill-side neighbourhood ----
  {
    id: 'cr_w2', name: 'Omole Link', cls: 'secondary',
    entry: { lineId: 'road_ghn5', axis: 'h', x: -450, z: -566.921, dx: -1, dz: 0 },
    ctrl: [[-520, -580], [-580, -560], [-630, -575]],
    join: { host: 'cr_w1', hint: [-675, -575] },
  },
  {
    id: 'cr_w3', name: 'Kemta Avenue', cls: 'residential',
    entry: { lineId: 'road_gvn4', axis: 'v', x: -459.238, z: -450, dx: 0, dz: -1 },
    ctrl: [[-462, -505], [-492, -527]],
    join: { host: 'cr_w2', hint: [-505, -572] },
  },
  {
    id: 'cr_w4', name: 'Kemta Link', cls: 'residential',
    entry: { lineId: 'road_ghn4', axis: 'h', x: -450, z: -472.238, dx: -1, dz: 0, lead: 0 },
    ctrl: [],
    join: { host: 'cr_w3', hint: [-459.238, -472.238] },
  },
  {
    id: 'cr_w5', name: 'Magodo Close', cls: 'secondary',
    entry: { lineId: 'road_gvn5', axis: 'v', x: -563.531, z: -450, dx: 0, dz: -1 },
    ctrl: [[-566, -515]],
    join: { host: 'cr_w2', hint: [-568, -568] },
  },
  {
    id: 'cr_w6', name: 'Alapere Lane', cls: 'residential',
    entry: { lineId: 'road_gvn7', axis: 'v', x: -756.093, z: -450, dx: 0, dz: -1 },
    ctrl: [[-745, -495], [-715, -515]],
    join: { host: 'cr_w1', hint: [-672, -520] },
  },
  // ---- the Heights Road: south-west entry, north past the ridge, over the river, then a spiral up Western Heights ----
  {
    id: 'cr_w7', name: 'Heights Road', cls: 'secondary',
    entry: { lineId: 'road_gvn8', axis: 'v', x: -863.829, z: -450, dx: 0, dz: -1 },
    ctrl: [[-855, -500], [-830, -545], [-815, -600], [-806, -640], [-800, -680], [-770, -700], ...heightsSpiral()],
  },
  // ---- Knoll Road: the north-east entry, over the river on a bridge, joins the Heights Road where its spiral is still low ----
  {
    id: 'cr_w8', name: 'Knoll Road', cls: 'residential',
    entry: { lineId: 'road_ghn7', axis: 'h', x: -450, z: -782.309, dx: -1, dz: 0 },
    ctrl: [[-520, -776], [-565, -770], [-605, -772], [-640, -778], [-675, -776]],
    join: { host: 'cr_w7', hint: [-701, -774] },
  },
];

// ------------------------------------------------------------------------------------------------
// Spatial index (segments of every committed road) + junction flares
// ------------------------------------------------------------------------------------------------

const CELL = 24;
interface Seg {
  r: CurvedRoad;
  i: number; // segment between pts[i] and pts[i + 1]
}
const grid = new Map<number, Seg[]>();
const gkey = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);

function indexRoad(r: CurvedRoad): void {
  for (let i = 0; i < r.pts.length - 1; i++) {
    const a = r.pts[i];
    const b = r.pts[i + 1];
    const c0x = Math.floor(Math.min(a.x, b.x) / CELL);
    const c1x = Math.floor(Math.max(a.x, b.x) / CELL);
    const c0z = Math.floor(Math.min(a.z, b.z) / CELL);
    const c1z = Math.floor(Math.max(a.z, b.z) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const k = gkey(cx, cz);
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push({ r, i });
      }
    }
  }
}

/** the walkable corner pieces of a T-junction: asphalt flare + kerbed pavement fillet (same geometry the mesh uses) */
interface Flare {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  vx: number;
  vz: number;
  rF: number;
  y: number;
  kerb: boolean;
}
const flareGrid = new Map<number, Flare[]>();

/** a dead-end turning circle (same radii the mesh uses) */
interface CulEnd {
  x: number;
  z: number;
  y: number;
  /** radius of the asphalt disc */
  R: number;
}
const culGrid = new Map<number, CulEnd[]>();

function indexCulEnd(r: CurvedRoad): void {
  const e = r.pts[r.pts.length - 1];
  const R = r.hw + TURN_APRON;
  const reach = R + TURN_PAVING + TURN_GRAVEL;
  const ce: CulEnd = { x: e.x, z: e.z, y: e.y, R };
  for (let cx = Math.floor((e.x - reach) / CELL); cx <= Math.floor((e.x + reach) / CELL); cx++) {
    for (let cz = Math.floor((e.z - reach) / CELL); cz <= Math.floor((e.z + reach) / CELL); cz++) {
      const k = gkey(cx, cz);
      const l = culGrid.get(k);
      if (l) l.push(ce);
      else culGrid.set(k, [ce]);
    }
  }
}

/** unit tangent / left normal of a road at sample k */
export function roadFrameAt(r: CurvedRoad, k: number): { tx: number; tz: number; nx: number; nz: number } {
  const a = r.pts[Math.max(0, k - 1)];
  const b = r.pts[Math.min(r.pts.length - 1, k + 1)];
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const tx = (b.x - a.x) / l;
  const tz = (b.z - a.z) / l;
  return { tx, tz, nx: -tz, nz: tx };
}

function indexFlares(host: CurvedRoad, side: CurvedRoad, j: Junction): void {
  const f = roadFrameAt(host, j.hostIdx);
  const hc = host.pts[j.hostIdx];
  const rF = filletRadius(host.cls);
  const awx = f.nx * j.side;
  const awz = f.nz * j.side;
  const Ex = hc.x + awx * host.hw;
  const Ez = hc.z + awz * host.hw;
  for (const kk of [-1, 1]) {
    const fl: Flare = {
      cx: Ex + kk * side.hw * f.tx, cz: Ez + kk * side.hw * f.tz, ux: kk * f.tx, uz: kk * f.tz, vx: awx, vz: awz, rF, y: hc.y, kerb: host.kerb,
    };
    const xs = [fl.cx, fl.cx + fl.ux * rF, fl.cx + fl.vx * rF, fl.cx + (fl.ux + fl.vx) * rF];
    const zs = [fl.cz, fl.cz + fl.uz * rF, fl.cz + fl.vz * rF, fl.cz + (fl.uz + fl.vz) * rF];
    for (let cx = Math.floor(Math.min(...xs) / CELL); cx <= Math.floor(Math.max(...xs) / CELL); cx++) {
      for (let cz = Math.floor(Math.min(...zs) / CELL); cz <= Math.floor(Math.max(...zs) / CELL); cz++) {
        const k = gkey(cx, cz);
        const l = flareGrid.get(k);
        if (l) l.push(fl);
        else flareGrid.set(k, [fl]);
      }
    }
  }
}

/** is arc length s of road r (on `side` of it) inside a junction mouth, where the kerbed pavement is cut? */
export function inPavementCut(r: CurvedRoad, s: number, side: 1 | -1): boolean {
  for (const j of r.hostJoins) if (j.side === side && Math.abs(s - j.s) < j.hw + j.rF) return true;
  for (const m of r.mouths) if (s >= m.s0 && s <= m.s1) return true;
  return false;
}

// ------------------------------------------------------------------------------------------------
// Elevation profile
// ------------------------------------------------------------------------------------------------

function profile(r: CurvedRoad, pinStart: number | null, pinEnd: number | null, endFlat: number, lifts: number[] | null): void {
  const n = r.pts.length;
  const y = r.pts.map((p, i) => baseHeight(p.x, p.z) + (lifts ? lifts[i] : 0));
  const pinned = new Array<number | null>(n).fill(null);
  // the end pin goes first so that on a very short road the start pin (the border, y = 0) wins
  if (pinEnd !== null) for (let i = n - 1; i >= 0 && r.pts[n - 1].s - r.pts[i].s <= endFlat; i--) pinned[i] = pinEnd;
  if (pinStart !== null) for (let i = 0; i < n && r.pts[i].s <= 12; i++) pinned[i] = pinStart;
  const applyPins = () => pinned.forEach((v, i) => { if (v !== null) y[i] = v; });
  // a stream-bridge deck is straight between its abutments
  const spans: [number, number][] = [];
  for (let i = 0; i < n; ) {
    if (!r.pts[i].bridge) { i++; continue; }
    let j = i;
    while (j + 1 < n && r.pts[j + 1].bridge) j++;
    spans.push([i, j]);
    i = j + 1;
  }
  const deck = () => {
    if (lifts) return; // lifted roads follow their own lift profile
    for (const [a, b] of spans) {
      const ya = y[Math.max(0, a - 1)];
      const yb = y[Math.min(n - 1, b + 1)];
      for (let i = a; i <= b; i++) y[i] = ya + ((yb - ya) * (i - (a - 1))) / (b + 1 - (a - 1));
    }
  };
  applyPins();
  deck();
  // nothing to shape on dead-flat ground (city streets on the plain): skip the smoothing and grade limiting
  const y0 = y[0];
  if (!lifts && !spans.length && y.every((v) => Math.abs(v - y0) < 1e-9)) {
    r.pts.forEach((p, i) => (p.y = y[i]));
    return;
  }
  const W = lifts ? 3 : 7;
  const passes = lifts ? 4 : 10;
  const pad = new Float64Array(n + 2 * W);
  const acc = new Float64Array(n + 2 * W + 1);
  for (let pass = 0; pass < passes; pass++) {
    // moving average over +-W samples (edges replicated), via prefix sums
    for (let i = 0; i < n + 2 * W; i++) pad[i] = y[i < W ? 0 : i >= n + W ? n - 1 : i - W];
    for (let i = 0; i < n + 2 * W; i++) acc[i + 1] = acc[i] + pad[i];
    for (let i = 0; i < n; i++) y[i] = (acc[i + 2 * W + 1] - acc[i]) / (2 * W + 1);
    applyPins();
    deck();
  }
  // limit the grade in both directions; pins are re-applied inside the sweeps so they spread outwards
  for (let pass = 0; pass < 12; pass++) {
    for (let i = 1; i < n; i++) {
      const d = r.maxGrade * (r.pts[i].s - r.pts[i - 1].s);
      y[i] = clamp(y[i], y[i - 1] - d, y[i - 1] + d);
      if (pinned[i] !== null) y[i] = pinned[i]!;
    }
    for (let i = n - 2; i >= 0; i--) {
      const d = r.maxGrade * (r.pts[i + 1].s - r.pts[i].s);
      y[i] = clamp(y[i], y[i + 1] - d, y[i + 1] + d);
      if (pinned[i] !== null) y[i] = pinned[i]!;
    }
  }
  deck();
  r.pts.forEach((p, i) => (p.y = y[i]));
}

function nearestIdx(r: CurvedRoad, x: number, z: number): number {
  let best = 0;
  let bd = Infinity;
  r.pts.forEach((p, i) => {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

/** where a side road meets the host's asphalt edge: E = point on the edge, n = host's left normal, side = which side */
function junctionFrame(host: CurvedRoad, k: number, from: V2): { E: V2; n: V2; side: 1 | -1 } {
  const a = host.pts[Math.max(0, k - 1)];
  const b = host.pts[Math.min(host.pts.length - 1, k + 1)];
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const n: V2 = [-(b.z - a.z) / l, (b.x - a.x) / l];
  const c = host.pts[k];
  const side: 1 | -1 = (from[0] - c.x) * n[0] + (from[1] - c.z) * n[1] >= 0 ? 1 : -1;
  return { E: [c.x + n[0] * side * host.hw, c.z + n[1] * side * host.hw], n, side };
}

// ------------------------------------------------------------------------------------------------
// The network builder (also the API the city growth works through)
// ------------------------------------------------------------------------------------------------

class NetBuilder implements GrowApi {
  roads: CurvedRoad[] = [];
  byId = new Map<string, CurvedRoad>();
  bridges: Bridge[] = [];
  junctions: Junction[] = [];
  streams: StreamData[];

  constructor() {
    grid.clear();
    flareGrid.clear();
    culGrid.clear();
    this.streams = ALL_STREAMS.map(buildStream);
    this.indexRivers();
  }

  base(x: number, z: number): number {
    return baseHeight(x, z);
  }

  private riverCells = new Map<number, { a: V2; b: V2; half: number }[]>();

  private indexRivers(): void {
    const C = 48;
    for (const stream of this.streams) {
      for (let i = 0; i < stream.pts.length - 1; i++) {
        const a = stream.pts[i];
        const b = stream.pts[i + 1];
        const seg = { a, b, half: stream.halfWidth };
        for (let cx = Math.floor((Math.min(a[0], b[0]) - 80) / C); cx <= Math.floor((Math.max(a[0], b[0]) + 80) / C); cx++) {
          for (let cz = Math.floor((Math.min(a[1], b[1]) - 80) / C); cz <= Math.floor((Math.max(a[1], b[1]) + 80) / C); cz++) {
            const k = gkey(cx, cz);
            const l = this.riverCells.get(k);
            if (l) l.push(seg);
            else this.riverCells.set(k, [seg]);
          }
        }
      }
    }
  }

  /** distance from (x, z) to the nearest bank (negative = in the water); Infinity beyond 80 m of any water course */
  riverGap(x: number, z: number): number {
    let best = Infinity;
    const list = this.riverCells.get(gkey(Math.floor(x / 48), Math.floor(z / 48)));
    if (!list) return best;
    for (const sg of list) {
      const a = sg.a;
      const b = sg.b;
      if (x < Math.min(a[0], b[0]) - 80 || x > Math.max(a[0], b[0]) + 80 || z < Math.min(a[1], b[1]) - 80 || z > Math.max(a[1], b[1]) + 80) continue;
      best = Math.min(best, segDist(x, z, a[0], a[1], b[0], b[1]).d - sg.half);
    }
    return best;
  }

  nearest(x: number, z: number, maxD: number, skip?: (r: CurvedRoad) => boolean): NearestRoad | null {
    let best: NearestRoad | null = null;
    const c0x = Math.floor((x - maxD) / CELL);
    const c1x = Math.floor((x + maxD) / CELL);
    const c0z = Math.floor((z - maxD) / CELL);
    const c1z = Math.floor((z + maxD) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const list = grid.get(gkey(cx, cz));
        if (!list) continue;
        for (const sg of list) {
          if (skip && skip(sg.r)) continue;
          const a = sg.r.pts[sg.i];
          const b = sg.r.pts[sg.i + 1];
          const q = segDist(x, z, a.x, a.z, b.x, b.z);
          if (q.d <= maxD && (!best || q.d < best.d)) best = { road: sg.r, i: sg.i, t: q.t, d: q.d, x: a.x + (b.x - a.x) * q.t, z: a.z + (b.z - a.z) * q.t };
        }
      }
    }
    return best;
  }

  tryBuild(def: RoadDef): BuiltRoad | null {
    const info = CLASS_INFO[def.cls];
    const hwSelf = info.width / 2;
    const ctrl: Ctrl[] = [];
    let pinStart: number | null = null;
    let pinEnd: number | null = null;
    let endFlat = 0;
    const junctions: Junction[] = [];
    const mouths: { s0: number; s1: number }[] = [];
    let startMouth = 0;
    let endMouth = 0;

    if (def.entry) {
      const e = def.entry;
      ctrl.push([e.x, e.z, e.dx, e.dz]);
      const lead = e.lead ?? LEAD;
      if (lead > 0) ctrl.push([e.x + e.dx * lead, e.z + e.dz * lead, e.dx, e.dz]);
      pinStart = 0;
    }
    if (def.from) {
      // built outward from the host's edge: the host is already in `byId`
      const host = this.byId.get(def.from.host);
      if (!host || !def.ctrl.length) return null;
      const k = nearestIdx(host, def.from.hint[0], def.from.hint[1]);
      const { E, n, side } = junctionFrame(host, k, def.ctrl[0] as V2);
      ctrl.push([E[0], E[1], n[0] * side, n[1] * side]);
      ctrl.push([E[0] + n[0] * side * LEAD, E[1] + n[1] * side * LEAD, n[0] * side, n[1] * side]);
      pinStart = host.pts[k].y;
      junctions.push({ roadId: def.id, hostId: host.id, hostIdx: k, side, kind: 'tee' });
      startMouth = filletRadius(host.cls);
    }
    if (def.merge) {
      // a ramp peeling off the host's edge: parallel to the host for a short lead, overlapping its asphalt by ~1 m
      const host = this.byId.get(def.merge.host);
      if (!host) return null;
      const k = nearestIdx(host, def.merge.hint[0], def.merge.hint[1]);
      const f = roadFrameAt(host, k);
      const c = host.pts[k];
      const off = def.merge.side * (host.hw + hwSelf - 1.0);
      const px = c.x + f.nx * off;
      const pz = c.z + f.nz * off;
      const dx = f.tx * def.merge.dir;
      const dz = f.tz * def.merge.dir;
      ctrl.push([px, pz, dx, dz]);
      ctrl.push([px + dx * LEAD, pz + dz * LEAD, dx, dz]);
      pinStart = c.y;
      junctions.push({ roadId: def.id, hostId: host.id, hostIdx: k, side: def.merge.side, kind: 'merge' });
    }
    let user = def.ctrl;
    const thin = (anchor: V2, minD: number) => { user = user.filter((c) => Math.hypot(c[0] - anchor[0], c[1] - anchor[1]) >= minD); };
    if (def.entry) thin([def.entry.x, def.entry.z], def.entry.lead === 0 ? 8 : 36);
    if (def.from) { const h = this.byId.get(def.from.host)!; const k0 = nearestIdx(h, def.from.hint[0], def.from.hint[1]); thin([h.pts[k0].x, h.pts[k0].z], 36); }
    if (def.merge) { const c0 = ctrl[0]; thin([c0[0], c0[1]], 30); }
    if (def.join) {
      const h = this.byId.get(def.join.host);
      if (!h) return null;
      const k0 = nearestIdx(h, def.join.hint[0], def.join.hint[1]);
      thin([h.pts[k0].x, h.pts[k0].z], 36);
    }
    ctrl.push(...user);
    if (def.join) {
      const host = this.byId.get(def.join.host)!;
      const k = nearestIdx(host, def.join.hint[0], def.join.hint[1]);
      const prev = ctrl[ctrl.length - 1] as V2;
      const { E, n, side } = junctionFrame(host, k, prev);
      const A: V2 = [E[0] + n[0] * side * LEAD, E[1] + n[1] * side * LEAD];
      const last = ctrl[ctrl.length - 1];
      const ahead = (A[0] - last[0]) * (E[0] - last[0]) + (A[1] - last[1]) * (E[1] - last[1]);
      // skip the straight approach point when the road is already that close to the junction (e.g. the short link)
      if (ahead > 0 && Math.hypot(A[0] - last[0], A[1] - last[1]) > 6) ctrl.push([A[0], A[1], -n[0] * side, -n[1] * side]);
      ctrl.push([E[0], E[1], -n[0] * side, -n[1] * side]);
      pinEnd = host.pts[k].y;
      endFlat = 12;
      junctions.push({ roadId: def.id, hostId: host.id, hostIdx: k, side, kind: 'tee' });
      endMouth = filletRadius(host.cls);
    }
    if (ctrl.length < 2) return null;

    const path = densePath(ctrl, STEP);
    const kerb = !!def.kerb;
    const road: CurvedRoad = {
      id: def.id, name: def.name, cls: def.cls, width: info.width, lanes: info.lanes, hw: hwSelf,
      maxGrade: info.grade, pts: [], entry: def.entry ? { lineId: def.entry.lineId, axis: def.entry.axis, x: def.entry.x, z: def.entry.z } : null,
      exit: null, kerb, cul: !!def.cul, tag: def.tag ?? '', bbox: { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
      hostJoins: [], mouths,
    };
    let s = 0;
    path.forEach((p, i) => {
      if (i > 0) s += Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]);
      const curb = kerb ? 1 : def.entry ? 1 - sstep(16, 28, s) : 0;
      road.pts.push({ x: p[0], z: p[1], y: 0, s, curb, bridge: false, dip: 0, viaduct: false, lift: 0 });
      road.bbox.minX = Math.min(road.bbox.minX, p[0]);
      road.bbox.maxX = Math.max(road.bbox.maxX, p[0]);
      road.bbox.minZ = Math.min(road.bbox.minZ, p[1]);
      road.bbox.maxZ = Math.max(road.bbox.maxZ, p[1]);
    });
    const total = s;
    if (startMouth > 0) mouths.push({ s0: 0, s1: startMouth });
    if (endMouth > 0) mouths.push({ s0: total - endMouth, s1: total });

    if (def.exit) {
      const end = road.pts[road.pts.length - 1];
      road.exit = { lineId: def.exit.lineId, axis: def.exit.axis, x: end.x, z: end.z };
      pinEnd = 0; // the flat grid road continues from here
      endFlat = 12;
    }

    // bridges over water: wherever the road would run through a stream valley (+ abutment margin)
    const n = road.pts.length;
    const inStream = road.pts.map((p) => this.riverGap(p.x, p.z) < 3);
    const margin = 2;
    for (let i = 0; i < n; i++) {
      if (!inStream[i]) continue;
      for (let k = -margin; k <= margin; k++) road.pts[clamp(i + k, 0, n - 1)].bridge = true;
    }

    // surface height above the terrain (viaducts, flyovers, raised river bridges)
    let lifts: number[] | null = null;
    if (def.lift && def.lift.length) {
      const kf = def.lift.map((l) => ({ i: nearestIdx(road, l.at[0], l.at[1]), h: l.h })).sort((a, b) => a.i - b.i);
      lifts = road.pts.map((p, i) => {
        if (i <= kf[0].i) return kf[0].h;
        if (i >= kf[kf.length - 1].i) return kf[kf.length - 1].h;
        let q = 0;
        while (q + 1 < kf.length && kf[q + 1].i < i) q++;
        const a = kf[q];
        const b = kf[q + 1];
        const t = (i - a.i) / Math.max(1, b.i - a.i);
        return a.h + (b.h - a.h) * t;
      });
    }

    profile(road, pinStart, pinEnd, endFlat, lifts);

    // decks standing clear of the ground become viaducts (one sample of abutment margin each side)
    // (only roads that were given a lift profile: a road that merely follows rough terrain is never a viaduct)
    const hi = road.pts.map((p) => {
      p.lift = p.y - baseHeight(p.x, p.z);
      return lifts !== null && p.lift > VIADUCT_MIN;
    });
    for (let i = 0; i < n; i++) {
      if (!hi[i]) continue;
      for (let k = -1; k <= 1; k++) {
        const p = road.pts[clamp(i + k, 0, n - 1)];
        p.viaduct = true;
        p.bridge = true;
      }
    }
    const bridges: Bridge[] = [];
    for (let i = 0; i < n; ) {
      if (!road.pts[i].bridge) { i++; continue; }
      let j = i;
      let via = false;
      while (j + 1 < n && road.pts[j + 1].bridge) j++;
      for (let k = i; k <= j; k++) if (road.pts[k].viaduct) via = true;
      bridges.push({ roadId: road.id, i0: i, i1: j, kind: via ? 'viaduct' : 'span' });
      i = j + 1;
    }
    return { road, junctions, bridges };
  }

  commit(b: BuiltRoad): CurvedRoad {
    const r = b.road;
    this.roads.push(r);
    this.byId.set(r.id, r);
    this.bridges.push(...b.bridges);
    const dipAround = (rr: CurvedRoad, s0: number, r0: number, r1: number, amt: number) => {
      for (const p of rr.pts) p.dip = Math.max(p.dip, amt * (1 - sstep(r0, r1, Math.abs(p.s - s0))));
    };
    for (const j of b.junctions) {
      this.junctions.push(j);
      if (j.kind !== 'tee') continue;
      const host = this.byId.get(j.hostId)!;
      const hp = host.pts[j.hostIdx];
      const first = r.pts[0];
      const last = r.pts[r.pts.length - 1];
      const atStart = Math.hypot(first.x - hp.x, first.z - hp.z) < Math.hypot(last.x - hp.x, last.z - hp.z);
      host.hostJoins.push({ s: hp.s, side: j.side, hw: r.hw, rF: filletRadius(host.cls), roadId: r.id });
      dipAround(r, atStart ? 0 : last.s, 4, 18, 0.6);
      dipAround(host, hp.s, 6, 20, 0.6);
      indexFlares(host, r, j);
    }
    for (const br of b.bridges) {
      if (br.kind !== 'span') continue;
      dipAround(r, r.pts[br.i0].s, 0, 12, 0.3);
      dipAround(r, r.pts[br.i1].s, 0, 12, 0.3);
    }
    indexRoad(r);
    if (r.cul) indexCulEnd(r);
    return r;
  }
}

let network: CurvedNetwork | null = null;

export function getCurvedNetwork(): CurvedNetwork {
  if (network) return network;
  const nb = new NetBuilder();
  const add = (def: RoadDef) => {
    const built = nb.tryBuild(def);
    if (!built) throw new Error(`CurvedRoads: cannot build ${def.id} (missing host?)`);
    nb.commit(built);
  };
  for (const def of DEFS) add(def);
  for (const def of CITY_DEFS) add(def);
  growCity(nb);
  network = { roads: nb.roads, byId: nb.byId, streams: nb.streams, bridges: nb.bridges, junctions: nb.junctions };
  return network;
}

// ------------------------------------------------------------------------------------------------
// Terrain height + walking height
// ------------------------------------------------------------------------------------------------

function streamAt(net: CurvedNetwork, x: number, z: number): { d: number; bed: number; half: number; water: number } {
  let best = Infinity;
  let bed = 0;
  let half = 5.5;
  let water = 0;
  for (const S of net.streams) {
    for (let i = 0; i < S.pts.length - 1; i++) {
      const a = S.pts[i];
      const b = S.pts[i + 1];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      if (x < Math.min(a[0], b[0]) - 45 || x > Math.max(a[0], b[0]) + 45 || z < Math.min(a[1], b[1]) - 45 || z > Math.max(a[1], b[1]) + 45) continue;
      const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1);
      const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
      if (d < best) {
        best = d;
        bed = S.bed[i] + (S.bed[i + 1] - S.bed[i]) * t;
        water = S.water[i] + (S.water[i + 1] - S.water[i]) * t;
        half = S.halfWidth;
      }
    }
  }
  return { d: best, bed, half, water };
}

export interface TerrainInfo {
  h: number;
  /** 0..1 how much the road bed / embankment shapes this point (used to colour cut slopes) */
  road: number;
  /** 0..1 stream channel */
  wet: number;
}
const _info: TerrainInfo = { h: 0, road: 0, wet: 0 };

/** the bed sits a little below the asphalt so the road ribbon never z-fights with the terrain */
export function bedDepth(s: number): number {
  return 0.2 * Math.min(1, s / 12);
}

/** final ground height (terrain incl. valley, road beds, embankments). Pure + deterministic: cells share borders exactly. */
export function terrainInfo(x: number, z: number, out: TerrainInfo = _info): TerrainInfo {
  if (!inChunk(x, z)) { out.h = 0; out.road = 0; out.wet = 0; return out; }
  const net = getCurvedNetwork();
  const base = baseHeight(x, z);
  const st = streamAt(net, x, z);
  // 1. wide, soft valley around the stream so the channel is not a canyon
  let h = base;
  if (st.d < 42) h -= Math.max(0, base - (st.bed + 1.4)) * 0.5 * (1 - sstep(0, 42, st.d));
  // 2. road beds + embankments
  let wBest = 0;
  let yBest = 0;
  let dBest = Infinity;
  const cx0 = Math.floor((x - 40) / CELL);
  const cx1 = Math.floor((x + 40) / CELL);
  const cz0 = Math.floor((z - 40) / CELL);
  const cz1 = Math.floor((z + 40) / CELL);
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cz = cz0; cz <= cz1; cz++) {
      const list = grid.get(gkey(cx, cz));
      if (!list) continue;
      for (const sg of list) {
        const a = sg.r.pts[sg.i];
        const b = sg.r.pts[sg.i + 1];
        if (a.bridge && b.bridge) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
        const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
        const cu = a.curb + (b.curb - a.curb) * t;
        const band = sg.r.hw + PAVEMENT_W * cu + SHOULDER + 1.8;
        if (d > band + 22) continue;
        const ry = a.y + (b.y - a.y) * t;
        const bank = clamp(Math.abs(ry - h) * 2.4, 5, 22);
        const w = 1 - sstep(band, band + bank, d);
        // strongest pull wins; where several roads pull equally (inside their beds) the nearest one decides
        if (w > wBest + 1e-6 || (w > 0 && w >= wBest - 1e-6 && d < dBest)) {
          wBest = Math.max(w, wBest);
          dBest = d;
          yBest = ry - bedDepth(a.s + (b.s - a.s) * t) - (a.dip + (b.dip - a.dip) * t);
        }
      }
    }
  }
  if (wBest > 0) h += (yBest - h) * wBest;
  // 3. the channel itself
  const wk = st.half / 5.5; // channel profile scales with the water course's width
  const wn = 1 - sstep(2.2 * wk, 10 * wk, st.d);
  if (wn > 0 && h > st.bed) h -= (h - st.bed) * wn;
  // 4. park ponds are real bowls now (the water mesh sits at POND_LEVEL, the walker wades in)
  const dip = pondDip(x, z);
  if (dip > 0) {
    h -= dip;
    out.wet = Math.max(wn, Math.min(1, dip / POND_DEPTH) * 0.9);
  } else out.wet = wn;
  out.h = h;
  out.road = wBest;
  return out;
}

export function terrainHeight(x: number, z: number): number {
  return terrainInfo(x, z, _info).h;
}

/**
 * What a character stands on at (x, z): terrain, or the road surface (asphalt / raised pavement / bridge deck).
 * `refY` = the walker's current height: a deck only counts when the walker is up on it, so walking on the road UNDER a
 * flyover (or wading through the river under a bridge) does not teleport anyone onto the deck.
 */
const _gr: (CurvedRoad | null)[] = [];
const _gd: number[] = [];
const _gy: number[] = [];
const _gc: number[] = [];
const _gb: boolean[] = [];
const _gs: number[] = [];
const _gside: number[] = [];
const _gdip: number[] = [];
export function groundHeightAt(x: number, z: number, refY = Infinity): number {
  // the barracks island and its causeway bridge, out in the sea south of the map
  if (z > 840) {
    const far = farGroundAt(x, z, refY);
    if (far !== null) return far;
  }
  // beyond the land: beach and sea floor
  if (Math.abs(x) > WORLD_EDGE || Math.abs(z) > WORLD_EDGE) return seabedHeight(x, z);
  // raised pavements of the downtown grid roads (0 anywhere else)
  const walk = sidewalkHeightAt(x, z);
  if (!inChunk(x, z)) return walk;
  getCurvedNetwork();
  let best = -Infinity;
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  // per road, only the NEAREST segment counts (taking the highest of all segments within half a road width would lift the
  // walker by hw * grade on every slope)
  let n = 0;
  for (let i = cx - 1; i <= cx + 1; i++) {
    for (let j = cz - 1; j <= cz + 1; j++) {
      const list = grid.get(gkey(i, j));
      if (!list) continue;
      for (const sg of list) {
        const a = sg.r.pts[sg.i];
        const b = sg.r.pts[sg.i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
        const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
        const bridge = a.bridge && b.bridge;
        const reach = sg.r.hw + (bridge ? 0.3 : PAVEMENT_W * (a.curb + (b.curb - a.curb) * t) + SHOULDER); // pavement + the gravel verge beyond it
        if (d > reach) continue;
        let m = 0;
        while (m < n && _gr[m] !== sg.r) m++;
        if (m < n && _gd[m] <= d) continue;
        if (m === n) n++;
        _gr[m] = sg.r;
        _gd[m] = d;
        _gy[m] = a.y + (b.y - a.y) * t;
        _gc[m] = a.curb + (b.curb - a.curb) * t;
        _gb[m] = bridge;
        _gs[m] = a.s + (b.s - a.s) * t;
        _gside[m] = (x - a.x) * -dz + (z - a.z) * dx >= 0 ? 1 : -1;
        _gdip[m] = a.dip + (b.dip - a.dip) * t;
      }
    }
  }
  for (let m = 0; m < n; m++) {
    const r = _gr[m]!;
    const ry = _gy[m];
    if (_gb[m]) {
      if (_gd[m] <= r.hw + 0.3 && refY >= ry - 1.2) best = Math.max(best, ry + 0.01);
    } else if (_gd[m] <= r.hw) best = Math.max(best, ry + 0.01);
    else {
      const cu = _gc[m];
      // no pavement and no verge inside a junction mouth of a kerbed street (CurvedRoadBuilder cuts both there)
      if ((cu > 0.004 || r.kerb) && inPavementCut(r, _gs[m], _gside[m] as 1 | -1)) continue;
      const pw = PAVEMENT_W * cu;
      const top = ry + PAVEMENT_H * cu;
      if (cu > 0.02 && _gd[m] <= r.hw + pw) best = Math.max(best, top);
      else if (_gd[m] <= r.hw + pw + SHOULDER) {
        // the gravel verge: a ramp from the pavement edge down to the terrain bed. It is drawn above the bed (CurvedRoadBuilder), but
        // the walker used to stand on the bed, so legs sank up to ~35 cm into it along every street.
        const u = Math.max(0, (_gd[m] - r.hw - pw) / SHOULDER);
        const bed = ry - bedDepth(_gs[m]) - _gdip[m] + GRAVEL_LIP;
        best = Math.max(best, top + (bed - top) * u);
      }
    }
  }
  // junction corners: asphalt flare + kerbed pavement fillet
  const fl = flareGrid.get(gkey(cx, cz));
  if (fl) {
    for (const f of fl) {
      const px = x - f.cx;
      const pz = z - f.cz;
      const u = px * f.ux + pz * f.uz;
      const v = px * f.vx + pz * f.vz;
      if (u < 0 || v < 0 || u > f.rF || v > f.rF) continue;
      const dO = Math.hypot(f.rF - u, f.rF - v);
      if (dO >= f.rF) best = Math.max(best, f.y + 0.01);
      else if (f.kerb && dO >= f.rF - PAVEMENT_W) best = Math.max(best, f.y + PAVEMENT_H);
    }
  }
  // dead-end turning circles: asphalt disc, kerbed paving ring (the "stone" ring round the end of a street), sloping gravel apron.
  // Without this the ring was drawn 16 cm high but walked on at terrain height, so legs sank into it.
  const ce = culGrid.get(gkey(cx, cz));
  if (ce) {
    for (const c of ce) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d <= c.R) best = Math.max(best, c.y + 0.01);
      else if (d <= c.R + TURN_PAVING) best = Math.max(best, c.y + PAVEMENT_H);
      else if (d <= c.R + TURN_PAVING + TURN_GRAVEL) {
        const t = (d - c.R - TURN_PAVING) / TURN_GRAVEL;
        best = Math.max(best, c.y + PAVEMENT_H + (-0.04 - PAVEMENT_H) * t);
      }
    }
  }
  const th = terrainHeight(x, z);
  // `walk` is 0 away from the downtown pavements: only a real pavement may lift the walker, otherwise it would floor the
  // ground at y = 0 and the character would walk on top of rivers and ponds instead of in them
  return Math.max(best, th, walk > 1e-4 ? walk : -Infinity);
}

/** distance from (x, z) to the nearest road edge (asphalt + kerbed pavement), Infinity when no road is close */
export function roadEdgeDistance(x: number, z: number): number {
  if (!inChunk(x, z)) return Infinity;
  getCurvedNetwork();
  let best = Infinity;
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  for (let i = cx - 1; i <= cx + 1; i++) {
    for (let j = cz - 1; j <= cz + 1; j++) {
      const list = grid.get(gkey(i, j));
      if (!list) continue;
      for (const sg of list) {
        const a = sg.r.pts[sg.i];
        const b = sg.r.pts[sg.i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
        const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
        best = Math.min(best, d - sg.r.hw - PAVEMENT_W * (a.curb + (b.curb - a.curb) * t));
      }
    }
  }
  return best;
}

// ------------------------------------------------------------------------------------------------
// the sea around the map + ponds + what the walker is standing in
// ------------------------------------------------------------------------------------------------

/** sea surface: matches the city river's water level (3.2 m deep bed, water = bed + depth - 1.15), so the river runs out into the sea */
export const SEA_LEVEL = -1.15;
/** the walker can wade / swim out to this distance from the centre of the map (invisible wall beyond) */
export const SEA_HALF = 1500;
const SEA_FLOOR = -16;
export const POND_LEVEL = -0.1;
export const POND_DEPTH = 0.95;

export interface PondDef { x: number; z: number; r: number }
let pondSource: (() => PondDef[]) | null = null;
let pondList: PondDef[] | null = null;
let pondBusy = false;
const NO_PONDS: PondDef[] = [];
const pondGrid = new Map<number, PondDef[]>();
const PG = 32;

/** registered by CellBuilder (the district list lives in a module that imports this one) */
export function setPondSource(fn: () => PondDef[]): void {
  pondSource = fn;
  pondList = null;
  pondGrid.clear();
}

function ponds(): PondDef[] {
  if (pondList) return pondList;
  if (!network || pondBusy || !pondSource) return NO_PONDS;
  pondBusy = true;
  try {
    const list = pondSource();
    pondGrid.clear();
    for (const p of list) {
      for (let i = Math.floor((p.x - p.r) / PG); i <= Math.floor((p.x + p.r) / PG); i++) {
        for (let j = Math.floor((p.z - p.r) / PG); j <= Math.floor((p.z + p.r) / PG); j++) {
          const k = gkey(i, j);
          const l = pondGrid.get(k);
          if (l) l.push(p);
          else pondGrid.set(k, [p]);
        }
      }
    }
    pondList = list;
  } finally {
    pondBusy = false;
  }
  return pondList ?? NO_PONDS;
}

/** how far the pond bowl lowers the ground at (x, z) (0 outside every pond) */
export function pondDip(x: number, z: number): number {
  ponds();
  const l = pondGrid.get(gkey(Math.floor(x / PG), Math.floor(z / PG)));
  if (!l) return 0;
  let dip = 0;
  for (const p of l) {
    const t = Math.hypot(x - p.x, z - p.z) / p.r;
    if (t >= 1) continue;
    const u = 1 - t * t;
    dip = Math.max(dip, POND_DEPTH * u * u);
  }
  return dip;
}

/** is any pond within `pad` of the rectangle? (the terrain mesh gets denser there so the bowl matches the walking height) */
export function pondsNear(minX: number, maxX: number, minZ: number, maxZ: number, pad = 20): boolean {
  for (const p of ponds()) if (p.x + p.r + pad > minX && p.x - p.r - pad < maxX && p.z + p.r + pad > minZ && p.z - p.r - pad < maxZ) return true;
  return false;
}

/** beach + sea floor beyond the map's ground edge: starts at the edge's own terrain height, slopes to ~7 m down, then deeper */
export function seabedHeight(x: number, z: number): number {
  const cx = clamp(x, -WORLD_EDGE, WORLD_EDGE);
  const cz = clamp(z, -WORLD_EDGE, WORLD_EDGE);
  return seabedFrom(x, z, terrainHeight(cx, cz));
}

/** seabedHeight when the land height `he` at the nearest shore point is already known (the ocean mesh caches it per shore point) */
export function seabedFrom(x: number, z: number, he: number): number {
  const cx = clamp(x, -WORLD_EDGE, WORLD_EDGE);
  const cz = clamp(z, -WORLD_EDGE, WORLD_EDGE);
  const d = Math.hypot(x - cx, z - cz);
  const run = 55 + 2.5 * Math.max(he, 0);
  const u = clamp(d / run, 0, 1);
  const s = u * u * (3 - 2 * u);
  return he + (-7 - he) * s + (SEA_FLOOR + 7) * sstep(run, 800, d);
}

/** water surface height at (x, z): the sea, a pond or a stream; -Infinity on dry land */
export function waterSurfaceAt(x: number, z: number): number {
  if (Math.abs(x) > WORLD_EDGE || Math.abs(z) > WORLD_EDGE) return SEA_LEVEL;
  if (!inChunk(x, z)) return -Infinity;
  if (pondDip(x, z) > 0.04) return POND_LEVEL;
  const st = streamAt(getCurvedNetwork(), x, z);
  if (st.d < st.half + 2) return st.water;
  return -Infinity;
}

/** distance from (x, z) to the nearest bank of any water course (negative = in the water); Infinity far from water */
export function waterGap(x: number, z: number): number {
  const st = streamAt(getCurvedNetwork(), x, z);
  return st.d - st.half;
}

export interface RoadFoot {
  road: CurvedRoad;
  /** index of the segment the foot lies on */
  i: number;
  /** arc length of the foot along the road */
  s: number;
  x: number;
  z: number;
  /** unit tangent of the road at the foot */
  tx: number;
  tz: number;
  /** distance from (x, z) to the road CENTRELINE */
  d: number;
}

/** nearest road centreline point (within maxD) that passes `accept`, or null */
export function roadFootAt(x: number, z: number, maxD: number, accept?: (r: CurvedRoad) => boolean): RoadFoot | null {
  getCurvedNetwork();
  let best: RoadFoot | null = null;
  for (let cx = Math.floor((x - maxD) / CELL); cx <= Math.floor((x + maxD) / CELL); cx++) {
    for (let cz = Math.floor((z - maxD) / CELL); cz <= Math.floor((z + maxD) / CELL); cz++) {
      const list = grid.get(gkey(cx, cz));
      if (!list) continue;
      for (const sg of list) {
        if (accept && !accept(sg.r)) continue;
        const a = sg.r.pts[sg.i];
        const b = sg.r.pts[sg.i + 1];
        const q = segDist(x, z, a.x, a.z, b.x, b.z);
        if (q.d > maxD || (best && q.d >= best.d)) continue;
        const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        best = { road: sg.r, i: sg.i, s: a.s + (b.s - a.s) * q.t, x: a.x + (b.x - a.x) * q.t, z: a.z + (b.z - a.z) * q.t, tx: (b.x - a.x) / l, tz: (b.z - a.z) / l, d: q.d };
      }
    }
  }
  return best;
}

/** like roadEdgeDistance, but only for roads at ground level (decks and viaducts are ignored) and not for `skip` itself */
export function groundRoadEdge(x: number, z: number, skip: CurvedRoad | null): number {
  getCurvedNetwork();
  let best = Infinity;
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  for (let i = cx - 1; i <= cx + 1; i++) {
    for (let j = cz - 1; j <= cz + 1; j++) {
      const list = grid.get(gkey(i, j));
      if (!list) continue;
      for (const sg of list) {
        if (sg.r === skip) continue;
        const a = sg.r.pts[sg.i];
        const b = sg.r.pts[sg.i + 1];
        if (a.bridge && b.bridge) continue;
        const q = segDist(x, z, a.x, a.z, b.x, b.z);
        best = Math.min(best, q.d - sg.r.hw - PAVEMENT_W * (a.curb + (b.curb - a.curb) * q.t));
      }
    }
  }
  return best;
}
