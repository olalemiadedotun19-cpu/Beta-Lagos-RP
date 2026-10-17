/**
 * CityPlan - the layout of the curved city (pure data + deterministic generation, no THREE).
 *
 * Replaces the old straight grid outside the hand-built downtown (|x|, |z| <= 105). Hierarchy:
 *
 *   gate rows      four roads across the north band that link the two corner chunks
 *   Beltway        the outer ring road: the east chunk's bypass -> south -> the west chunk's bypass (crosses the river twice)
 *   Expressway     an ELEVATED freeway on a viaduct sweeping W -> E south of downtown, with diamond ramps that land on Allen Avenue
 *   arms           the 12 downtown grid roads continue outward as curved radials; the inner ring joins them
 *   flyovers       Marina Flyover (a main road hops OVER the inner ring) and Oregun Flyover (a road hops over Awolowo Way)
 *   river bridges  Allen Avenue, the two bridge roads and the beltway cross the river on raised decks
 *   grown streets  collectors, residential streets and cul-de-sacs sprout from the backbone and T-join the neighbours
 *
 * Everything is T-junctions (an aligned pair on opposite sides is a 4-way). Coordinates: x east, z south.
 */
import { hashString, makeRng } from '../travel/Geo';
import { isReserved } from '../buildings/lots';
import type { Ctrl, V2 } from './RoadMath';
import { circumRadius, segDist } from './RoadMath';
import type { CurvedClass, CurvedRoad, GrowApi, Hill, Lift, RoadDef, StreamDef } from './RoadTypes';
import type { DistrictPlot, DistrictStyle } from './CityDistricts';

// ------------------------------------------------------------------------------------------------
// terrain features
// ------------------------------------------------------------------------------------------------

export const CITY_HILLS: Hill[] = [
  { x: -520, z: 190, r: 105, h: 24 }, // Omole Heights (west)
  { x: 560, z: 180, r: 100, h: 20 }, // Oregun Ridge (east)
];
export const HILL_NAMES = ['Omole Heights', 'Oregun Ridge'];

/** the city river: west edge -> east edge south of downtown. 28 m wide, 3.2 m below the plain */
export const CITY_STREAMS: StreamDef[] = [
  {
    half: 14,
    depth: 3.2,
    ctrl: [
      [-940, 570], [-820, 598], [-700, 612], [-580, 650], [-440, 650], [-300, 610], [-150, 606], [0, 650], [150, 700], [300, 690],
      [450, 652], [580, 640], [700, 606], [820, 566], [940, 548],
    ],
  },
];

// ------------------------------------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------------------------------------

const DEG = Math.PI / 180;
/** inner ring radius at polar angle th (degrees, from +x towards +z) */
const ringR = (th: number): number => 320 + 25 * Math.sin(2 * th * DEG + 1.2);
const ringXY = (th: number): V2 => [Math.round(ringR(th) * Math.cos(th * DEG)), Math.round(ringR(th) * Math.sin(th * DEG))];
const ringPts = (a: number, b: number, step = 15): V2[] => {
  const out: V2[] = [];
  for (let t = a + step; t < b - 1e-6; t += step) out.push(ringXY(t));
  return out;
};

/** a raised deck centred on (cx, cz) heading (dx, dz): ground -> h over `ramp` m, flat for +-`plateau` m, back to ground */
function arch(cx: number, cz: number, dx: number, dz: number, h: number, plateau: number, ramp: number): Lift[] {
  const l = Math.hypot(dx, dz) || 1;
  const ux = dx / l;
  const uz = dz / l;
  const at = (k: number): V2 => [Math.round(cx + ux * k), Math.round(cz + uz * k)];
  return [
    { at: at(-(plateau + ramp)), h: 0 },
    { at: at(-plateau), h },
    { at: at(plateau), h },
    { at: at(plateau + ramp), h: 0 },
  ];
}

const row = (id: string, name: string, cls: CurvedClass, zE: number, zW: number, mid: Ctrl[]): RoadDef => ({
  id, name, cls, kerb: true,
  entry: { lineId: '', axis: 'h', x: 450, z: zE, dx: -1, dz: 0 },
  exit: { lineId: '', axis: 'h' },
  ctrl: [...mid, [-432, zW, -1, 0], [-450, zW, -1, 0]],
});

// ------------------------------------------------------------------------------------------------
// the backbone (order matters: a road may only join / start from roads listed before it)
// ------------------------------------------------------------------------------------------------

const EXP_Y = 8; // expressway deck height above the plain (m)

export const CITY_DEFS: RoadDef[] = [
  // ---- the north band: four roads between the corner chunks (they continue the chunks' entry roads) ----
  row('cy_n671', 'North Bypass', 'main', -671, -670.978, [[330, -684], [200, -660], [60, -678], [-80, -664], [-210, -683], [-330, -662]]),
  row('cy_n567', 'Alausa Link', 'secondary', -566.9, -566.921, [[330, -556], [210, -575], [70, -560], [-70, -574], [-200, -557], [-330, -571]]),
  row('cy_n472', 'Ikosi Road', 'residential', -472.2, -472.238, [[330, -480], [200, -466], [60, -478], [-80, -468], [-210, -480], [-330, -467]]),
  row('cy_n782', 'Ojodu Berger Road', 'residential', -782.3, -782.309, [[330, -770], [200, -792], [60, -776], [-80, -790], [-210, -772], [-330, -788]]),

  // ---- the Beltway: east chunk bypass -> east side -> river bridge -> south arc -> river bridge -> west side -> west chunk bypass ----
  {
    id: 'cy_belt', name: 'Beltway', cls: 'main', kerb: true,
    entry: { lineId: '', axis: 'v', x: 679.264, z: -450, dx: 0, dz: 1 },
    exit: { lineId: '', axis: 'v' },
    ctrl: [
      [690, -360], [712, -260], [735, -150], [745, -20], [742, 110], [730, 240], [712, 360], [690, 470], [668, 560], [648, 618], [610, 690], [545, 750],
      [460, 795], [340, 825], [200, 842], [60, 846], [-80, 842], [-220, 834], [-350, 818], [-460, 790], [-550, 745], [-628, 690], [-662, 628],
      [-696, 540], [-722, 430], [-738, 310], [-745, 180], [-735, 40], [-720, -100], [-698, -230], [-682, -350], [-668, -432, 0, -1], [-665.232, -450, 0, -1],
    ],
    lift: [...arch(655, 614, -0.45, 0.89, 3.4, 36, 60), ...arch(-655, 640, -0.2, -0.98, 3.4, 36, 60)],
  },

  // ---- the Expressway: elevated freeway from the east Beltway to the west Beltway ----
  {
    id: 'cy_expw', name: 'Ikeja Expressway', cls: 'freeway', tag: 'freeway',
    from: { host: 'cy_belt', hint: [704, 402] },
    join: { host: 'cy_belt', hint: [-722, 418] },
    ctrl: [[600, 392], [520, 414], [440, 444], [340, 460], [240, 450], [160, 428], [20, 410], [-120, 418], [-260, 440], [-400, 462], [-500, 454], [-590, 430], [-650, 414]],
    lift: [
      { at: [672, 398], h: 0 }, { at: [545, 404], h: EXP_Y }, { at: [-540, 446], h: EXP_Y }, { at: [-700, 416], h: 0 },
    ],
  },

  // ---- the four main arms: Allen Avenue N / S and Awolowo Way E / W ----
  {
    id: 'cy_allen_n', name: 'Allen Avenue', cls: 'main', kerb: true,
    entry: { lineId: 'road_allen_avenue', axis: 'v', x: 0, z: -105, dx: 0, dz: -1 },
    ctrl: [[3, -200], [2, -297], [-4, -380], [-12, -430]],
    join: { host: 'cy_n472', hint: [-14, -472] },
  },
  {
    id: 'cy_allen_s', name: 'Allen Avenue South', cls: 'main', kerb: true,
    entry: { lineId: 'road_allen_avenue', axis: 'v', x: 0, z: 105, dx: 0, dz: 1 },
    ctrl: [[3, 200], [0, 297], [8, 400], [-6, 470], [-14, 560], [-12, 640], [10, 725], [26, 790]],
    join: { host: 'cy_belt', hint: [32, 845] },
    lift: arch(-12, 636, 0.0, 1, 3.4, 36, 60),
  },
  {
    id: 'cy_awo_e', name: 'Awolowo Way', cls: 'main', kerb: true,
    entry: { lineId: 'road_awolowo_way', axis: 'h', x: 105, z: 0, dx: 1, dz: 0 },
    ctrl: [[200, 3], [343, 0], [440, -18], [560, -6], [660, 10]],
    join: { host: 'cy_belt', hint: [745, -15] },
  },
  {
    id: 'cy_awo_w', name: 'Awolowo Way West', cls: 'main', kerb: true,
    entry: { lineId: 'road_awolowo_way', axis: 'h', x: -105, z: 0, dx: -1, dz: 0 },
    ctrl: [[-200, -4], [-343, 0], [-450, -10], [-570, -4], [-660, 6]],
    join: { host: 'cy_belt', hint: [-742, 0] },
  },

  // ---- the corner chunks' remaining roads at z = -450: they run south and join the Beltway / Awolowo Way ----
  { id: 'cy_g789', name: 'Brookside Road', cls: 'residential', kerb: true, entry: { lineId: '', axis: 'v', x: 789, z: -450, dx: 0, dz: 1 }, ctrl: [[788, -380], [780, -310], [764, -240]], join: { host: 'cy_belt', hint: [738, -190] } },
  { id: 'cy_gw756', name: 'Ridge Lane', cls: 'residential', kerb: true, entry: { lineId: '', axis: 'v', x: -756.093, z: -450, dx: 0, dz: 1 }, ctrl: [[-758, -390], [-754, -330], [-734, -285]], join: { host: 'cy_belt', hint: [-692, -280] } },
  { id: 'cy_gw864', name: 'Heights Road South', cls: 'secondary', kerb: true, entry: { lineId: '', axis: 'v', x: -863.829, z: -450, dx: 0, dz: 1 }, ctrl: [[-864, -370], [-858, -290], [-836, -210], [-800, -150], [-766, -112]], join: { host: 'cy_belt', hint: [-722, -100] } },
  { id: 'cy_gw459', name: 'Kemta Link', cls: 'residential', kerb: true, entry: { lineId: '', axis: 'v', x: -459.238, z: -450, dx: 0, dz: 1 }, ctrl: [[-461, -370], [-470, -280], [-462, -190], [-456, -100], [-452, -50]], join: { host: 'cy_awo_w', hint: [-455, -8] } },
  { id: 'cy_gw564', name: 'Omole Link', cls: 'secondary', kerb: true, entry: { lineId: '', axis: 'v', x: -563.531, z: -450, dx: 0, dz: 1 }, ctrl: [[-566, -370], [-572, -280], [-568, -190], [-563, -100], [-566, -50]], join: { host: 'cy_awo_w', hint: [-570, -4] } },

  // ---- the inner ring: four arcs, each T-joining two main arms ----
  { id: 'cy_ring_ne', name: 'Inner Ring', cls: 'main', kerb: true, from: { host: 'cy_allen_n', hint: [0, -297] }, join: { host: 'cy_awo_e', hint: [343, 0] }, ctrl: ringPts(270, 360) },
  { id: 'cy_ring_se', name: 'Inner Ring', cls: 'main', kerb: true, from: { host: 'cy_awo_e', hint: [343, 0] }, join: { host: 'cy_allen_s', hint: [0, 297] }, ctrl: ringPts(0, 90) },
  { id: 'cy_ring_sw', name: 'Inner Ring', cls: 'main', kerb: true, from: { host: 'cy_allen_s', hint: [0, 297] }, join: { host: 'cy_awo_w', hint: [-343, 0] }, ctrl: ringPts(90, 180) },
  { id: 'cy_ring_nw', name: 'Inner Ring', cls: 'main', kerb: true, from: { host: 'cy_awo_w', hint: [-343, 0] }, join: { host: 'cy_allen_n', hint: [0, -297] }, ctrl: ringPts(180, 270) },

  // ---- secondary arms: the downtown side streets continue outward and meet the inner ring ----
  // (Kodesoh E runs dead straight to x = 295: the Tower Complex faces it; East Link S is straight to z = 150: the Historic Hotel faces it)
  { id: 'cy_kod_e', name: 'Kodesoh Street', cls: 'secondary', kerb: true, entry: { lineId: 'road_kodesoh_st', axis: 'h', x: 105, z: -50, dx: 1, dz: 0 }, ctrl: [[190, -50], [270, -50]], join: { host: 'cy_ring_ne', hint: ringXY(-8.5) } },
  { id: 'cy_com_e', name: 'Commercial Avenue', cls: 'secondary', kerb: true, entry: { lineId: 'road_commercial_ave', axis: 'h', x: 105, z: 50, dx: 1, dz: 0 }, ctrl: [[190, 54], [270, 64]], join: { host: 'cy_ring_se', hint: ringXY(10) } },
  { id: 'cy_kod_w', name: 'Kodesoh Street West', cls: 'secondary', kerb: true, entry: { lineId: 'road_kodesoh_st', axis: 'h', x: -105, z: -50, dx: -1, dz: 0 }, ctrl: [[-190, -50], [-270, -48]], join: { host: 'cy_ring_nw', hint: ringXY(188.5) } },
  { id: 'cy_com_w', name: 'Commercial Avenue West', cls: 'secondary', kerb: true, entry: { lineId: 'road_commercial_ave', axis: 'h', x: -105, z: 50, dx: -1, dz: 0 }, ctrl: [[-190, 54], [-270, 62]], join: { host: 'cy_ring_sw', hint: ringXY(170) } },
  { id: 'cy_east_n', name: 'East Link Road', cls: 'residential', kerb: true, entry: { lineId: 'road_east_link', axis: 'v', x: 50, z: -105, dx: 0, dz: -1 }, ctrl: [[51, -190]], join: { host: 'cy_ring_ne', hint: ringXY(-80) } },
  { id: 'cy_east_s', name: 'East Link Road South', cls: 'residential', kerb: true, entry: { lineId: 'road_east_link', axis: 'v', x: 50, z: 105, dx: 0, dz: 1 }, ctrl: [[50, 150], [52, 205]], join: { host: 'cy_ring_se', hint: ringXY(80) } },
  { id: 'cy_west_n', name: 'West Link Road', cls: 'residential', kerb: true, entry: { lineId: 'road_west_link', axis: 'v', x: -50, z: -105, dx: 0, dz: -1 }, ctrl: [[-50, -190]], join: { host: 'cy_ring_nw', hint: ringXY(260) } },
  { id: 'cy_west_s', name: 'West Link Road South', cls: 'residential', kerb: true, entry: { lineId: 'road_west_link', axis: 'v', x: -50, z: 105, dx: 0, dz: 1 }, ctrl: [[-50, 150], [-51, 205]], join: { host: 'cy_ring_sw', hint: ringXY(100) } },
  // the French Manor faces this street (z = 150)
  { id: 'cy_manor', name: 'Manor Road', cls: 'secondary', kerb: true, from: { host: 'cy_west_s', hint: [-52, 150] }, ctrl: [[-110, 150], [-170, 150], [-230, 150]], join: { host: 'cy_ring_sw', hint: ringXY(150) } },

  // ---- Allen Interchange: four ramps peel off the viaduct and land on Allen Avenue South ----
  // (the expressway runs east -> west, so side +1 = north)
  { id: 'cy_ramp_ne', name: 'Allen Interchange NE', cls: 'secondary', tag: 'ramp', merge: { host: 'cy_expw', hint: [150, 427], side: 1, dir: 1 }, ctrl: [[100, 392], [72, 360], [54, 336]], join: { host: 'cy_allen_s', hint: [8, 330] }, lift: [{ at: [150, 413], h: EXP_Y }, { at: [54, 336], h: 0 }] },
  { id: 'cy_ramp_nw', name: 'Allen Interchange NW', cls: 'secondary', tag: 'ramp', merge: { host: 'cy_expw', hint: [-150, 428], side: 1, dir: -1 }, ctrl: [[-100, 394], [-74, 362], [-56, 336]], join: { host: 'cy_allen_s', hint: [8, 330] }, lift: [{ at: [-150, 414], h: EXP_Y }, { at: [-56, 336], h: 0 }] },
  { id: 'cy_ramp_se', name: 'Allen Interchange SE', cls: 'secondary', tag: 'ramp', merge: { host: 'cy_expw', hint: [150, 427], side: -1, dir: 1 }, ctrl: [[100, 455], [72, 486], [54, 512]], join: { host: 'cy_allen_s', hint: [-5, 512] }, lift: [{ at: [150, 441], h: EXP_Y }, { at: [54, 512], h: 0 }] },
  { id: 'cy_ramp_sw', name: 'Allen Interchange SW', cls: 'secondary', tag: 'ramp', merge: { host: 'cy_expw', hint: [-150, 428], side: -1, dir: -1 }, ctrl: [[-100, 457], [-78, 484], [-60, 508]], join: { host: 'cy_allen_s', hint: [-5, 512] }, lift: [{ at: [-150, 442], h: EXP_Y }, { at: [-60, 508], h: 0 }] },

  // ---- flyovers ----
  // Marina Flyover: leaves Awolowo Way West at ground level, climbs, hops OVER the inner ring and lands on Ikosi Road
  {
    id: 'cy_marina', name: 'Marina Flyover', cls: 'main', kerb: true, tag: 'flyover',
    from: { host: 'cy_kod_w', hint: [-215, -50] },
    ctrl: [[-219, -110], [-225, -180], [-229, -255], [-226, -330], [-216, -410]],
    join: { host: 'cy_n472', hint: [-205, -472] },
    lift: arch(-232, -235, -0.05, -1, 6.8, 48, 100),
  },
  // Oregun Flyover: leaves the inner ring, hops OVER Awolowo Way and runs on to the Beltway
  {
    id: 'cy_oregun', name: 'Oregun Flyover', cls: 'secondary', kerb: true, tag: 'flyover',
    from: { host: 'cy_ring_ne', hint: ringXY(330) },
    ctrl: [[350, -160], [402, -108], [446, -50], [480, 2], [522, 44], [580, 62], [660, 66]],
    join: { host: 'cy_belt', hint: [742, 68] },
    lift: arch(459, -18, 0.55, 0.83, 6.8, 40, 95),
  },

  // ---- two more river bridges: ring -> river -> Beltway south arc (they pass UNDER the expressway) ----
  {
    id: 'cy_ikorodu', name: 'Ikorodu Bridge Road', cls: 'secondary', kerb: true,
    from: { host: 'cy_ring_sw', hint: ringXY(125) },
    ctrl: [[-195, 330], [-225, 400], [-262, 470], [-285, 550], [-292, 625], [-285, 690], [-262, 770]],
    join: { host: 'cy_belt', hint: [-250, 832] },
    lift: arch(-291, 606, -0.05, 1, 3.4, 36, 60),
  },
  {
    id: 'cy_mile12', name: 'Mile 12 Bridge Road', cls: 'secondary', kerb: true,
    from: { host: 'cy_ring_se', hint: ringXY(55) },
    ctrl: [[215, 340], [255, 430], [292, 530], [310, 620], [316, 700], [302, 752]],
    join: { host: 'cy_belt', hint: [296, 836] },
    lift: arch(313, 690, 0.03, 1, 3.4, 36, 60),
  },
];

// ------------------------------------------------------------------------------------------------
// where nothing may be built / grown (shared by the street growth and the building placement)
// ------------------------------------------------------------------------------------------------

/** district plots (oriented rectangles reserved along the backbone roads before the streets grow) */
const PLOTS: DistrictPlot[] = [];
export const getCityPlots = (): readonly DistrictPlot[] => PLOTS;

export const CORE_KEEP = 112; // |x|, |z| below this belong to the hand-built downtown

/** the city proper: inside the Beltway (a closed polygon through its control points, closed along the north band) */
let beltPoly: V2[] | null = null;
function beltPolygon(): V2[] {
  if (beltPoly) return beltPoly;
  const belt = CITY_DEFS.find((d) => d.id === 'cy_belt')!;
  const pts: V2[] = [[belt.entry!.x, belt.entry!.z]];
  for (const c of belt.ctrl) pts.push([c[0], c[1]]);
  pts.push([-665.232, -900], [679.264, -900]);
  return (beltPoly = pts);
}
function beltDistanceExact(x: number, z: number): number {
  const P = beltPolygon();
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i];
    const [xj, zj] = P[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    best = Math.min(best, segDist(x, z, xi, zi, xj, zj).d);
  }
  return inside ? -best : best;
}
// the polygon test is hot (called per road sample): cache it on a 12 m grid
const BG = 24;
const BN = 80;
let beltGrid: Float32Array | null = null;
function beltDistance(x: number, z: number): number {
  if (!beltGrid) {
    beltGrid = new Float32Array(BN * BN);
    for (let i = 0; i < BN; i++) for (let j = 0; j < BN; j++) beltGrid[i * BN + j] = beltDistanceExact(-960 + i * BG, -960 + j * BG);
  }
  const i = Math.min(BN - 1, Math.max(0, Math.round((x + 960) / BG)));
  const j = Math.min(BN - 1, Math.max(0, Math.round((z + 960) / BG)));
  return beltGrid[i * BN + j];
}

/** hand-built downtown, the two corner chunks, the map edge, the outskirts beyond the Beltway and the hills' footprint (+ margin m) */
export function cityNoGo(x: number, z: number, margin = 0): boolean {
  if (beltDistance(x, z) > 62 - margin) return true;
  if (Math.abs(x) < CORE_KEEP + margin && Math.abs(z) < CORE_KEEP + margin) return true;
  if (z < -450 + margin && (x >= 450 - margin || x < -450 + margin)) return true;
  if (Math.abs(x) > 880 - margin || Math.abs(z) > 880 - margin) return true;
  for (const h of CITY_HILLS) if (Math.hypot(x - h.x, z - h.z) < h.r * 0.95 + margin) return true;
  for (const p of PLOTS) {
    const dx = x - p.cx;
    const dz = z - p.cz;
    // 6 m of verge around every plot belongs to it
    if (Math.abs(dx * p.ivz - dz * p.ivx) < p.W / 2 + 6 + margin && Math.abs(dx * p.ivx + dz * p.ivz) < p.D / 2 + 6 + margin) return true;
  }
  return false;
}

/** 0..1 how wild (woods, no street trees) the ground is: hills and their surroundings */
export function cityWild(x: number, z: number): number {
  let w = 0;
  for (const h of CITY_HILLS) w = Math.max(w, 1 - Math.min(1, Math.max(0, (Math.hypot(x - h.x, z - h.z) - h.r * 0.8) / 70)));
  return w;
}

// ------------------------------------------------------------------------------------------------
// street growth
// ------------------------------------------------------------------------------------------------

const STREET_NAMES = [
  'Adeniyi Jones Avenue', 'Toyin Street', 'Isaac John Street', 'Mobolaji Bank Anthony Way', 'Lateef Jakande Road', 'Ogba Road', 'Agidingbi Road',
  'Alausa Close', 'Maryland Crescent', 'Kudirat Abiola Way', 'Oregun Road', 'Sobo Arobiodu Street', 'Salvation Road', 'Acme Road', 'Ajao Estate Road',
  'Wempco Road', 'Obafemi Street', 'Lagos Road', 'Shonibare Estate Road', 'Adeola Odeku Street', 'Bolade Street', 'Ladipo Street', 'Mende Road',
  'Opebi Road', 'Oba Akran Avenue', 'Ikosi Close', 'Anthony Village Road', 'Magodo Crescent', 'Omole Drive', 'Ojota Lane', 'Oshodi Link', 'Gbagada Road',
];
const SUFFIX: Record<string, string[]> = { secondary: ['Road', 'Avenue', 'Way'], residential: ['Street', 'Close', 'Crescent', 'Lane', 'Drive'] };
const streetName = (id: string, cls: string): string => {
  const h = hashString(id);
  const base = STREET_NAMES[h % STREET_NAMES.length];
  if (cls === 'secondary' || cls === 'residential') {
    const stem = base.replace(/ (Avenue|Street|Road|Way|Close|Crescent|Lane|Drive)$/, '');
    return `${stem} ${SUFFIX[cls][(h >>> 8) % SUFFIX[cls].length]}`;
  }
  return base;
};

const MIN_R: Record<string, number> = { secondary: 15, residential: 11 };
const rotate = (v: V2, a: number): V2 => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];

interface Pass {
  cls: CurvedClass;
  hosts: CurvedClass[];
  spacing: [number, number];
  minLen: number;
  maxLen: number;
  /** minimum centreline spacing to every other road along the new street (m) */
  sep: number;
}
const PASSES: Pass[] = [
  { cls: 'secondary', hosts: ['main'], spacing: [140, 200], minLen: 80, maxLen: 560, sep: 46 },
  { cls: 'residential', hosts: ['main', 'secondary'], spacing: [90, 130], minLen: 62, maxLen: 330, sep: 40 },
  { cls: 'residential', hosts: ['residential', 'secondary'], spacing: [72, 100], minLen: 56, maxLen: 230, sep: 38 },
];
/** street spacing the hole filler aims for: no buildable spot may be further than this from a road */
const HOLE_R = 64;

export const CITY_STATS: Record<string, number> = {};
let statTag = '';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stat = (k: string): any => {
  const kk = statTag + k;
  CITY_STATS[kk] = (CITY_STATS[kk] ?? 0) + 1;
  return false;
};

export function growCity(api: GrowApi): void {
  let counter = 0;
  const nextId = (p: string) => `${p}${(counter++).toString(36)}`;

  const flat = (r: CurvedRoad, i: number): boolean => !r.pts[i].bridge && r.pts[i].lift < 0.3;
  const buildable = (x: number, z: number): boolean => !cityNoGo(x, z, 14) && api.riverGap(x, z) > 28 && !isReserved(x, z, 6);

  type Built = NonNullable<ReturnType<GrowApi['tryBuild']>>;

  /** every sample of a candidate must keep clear of the world's no-go areas, the river and the other roads */
  const valid = (def: RoadDef, sep: number, joins: Set<string>, mode: 'tee' | 'cul'): Built | null => {
    const built = api.tryBuild(def);
    if (!built) return stat('v_nobuild');
    const r = built.road;
    if (built.bridges.length) return stat('v_bridge');
    const total = r.pts[r.pts.length - 1].s;
    if (total < 40) return stat('v_short');
    const minR = MIN_R[r.cls] ?? 11;
    // a road that starts exactly where another one ends (the chunk roads at z = -450) continues it: not an obstacle
    const f0 = r.pts[0];
    const l0 = r.pts[r.pts.length - 1];
    const continues = (o: CurvedRoad): boolean => {
      const a = o.pts[0];
      const b = o.pts[o.pts.length - 1];
      return [a, b].some((q) => Math.hypot(q.x - f0.x, q.z - f0.z) < 3 || Math.hypot(q.x - l0.x, q.z - l0.z) < 3);
    };
    const skip = (o: CurvedRoad) => o.id === r.id || joins.has(o.id) || continues(o);
    for (let i = 0; i < r.pts.length; i++) {
      const p = r.pts[i];
      if (i % 3 === 0 && p.s > 20 && p.s < total - 20) {
        if (cityNoGo(p.x, p.z, 6)) return stat('v_nogo');
        if (api.riverGap(p.x, p.z) < 22) return stat('v_river');
        if (isReserved(p.x, p.z, 8)) return stat('v_lot');
        // keep clear of every road except the ones this street joins (met at right angles) - but a street MAY pass under the
        // elevated expressway where the deck stands well clear
        let near = api.nearest(p.x, p.z, sep, skip);
        if (near && near.road.cls === 'freeway' && near.road.pts[near.i].lift >= 5.2) near = api.nearest(p.x, p.z, sep, (o) => skip(o) || o.cls === 'freeway');
        if (near) return stat('v_near');
      }
      if (i >= 2 && i < r.pts.length - 2 && i % 2 === 0) {
        const a = r.pts[i - 2];
        const c = r.pts[i + 2];
        if (circumRadius(a.x, a.z, p.x, p.z, c.x, c.z) < minR) return stat('v_radius');
      }
    }
    if (mode === 'cul') {
      const e = r.pts[r.pts.length - 1];
      if (cityNoGo(e.x, e.z, 14) || api.riverGap(e.x, e.z) < 26) return stat('v_culend');
      if (api.nearest(e.x, e.z, 36, (o) => o.id === r.id)) return stat('v_culnear');
    }
    return built;
  };

  /** junction spacing on a road at arc length s on `side` (same side >= 56 m apart; opposite side staggered >= 24 m or aligned within 4 m) */
  const junctionFree = (road: CurvedRoad, s: number, side: 1 | -1): boolean => {
    for (const j of road.hostJoins) {
      const d = Math.abs(j.s - s);
      if (j.side === side ? d < 56 : d > 4 && d < 24) return false;
    }
    return true;
  };

  /** a road may END on another road here: ground level, away from its ends, an ordinary street */
  const targetOk = (t: CurvedRoad, i: number): boolean => {
    const total = t.pts[t.pts.length - 1].s;
    const s = t.pts[i].s;
    return s > 34 && s < total - 34 && flat(t, i) && t.cls !== 'freeway' && t.tag !== 'ramp' && !t.cul;
  };

  const hostFrame = (host: CurvedRoad, k: number, side: 1 | -1) => {
    const hp = host.pts[k];
    const a = host.pts[Math.max(0, k - 1)];
    const b = host.pts[Math.min(host.pts.length - 1, k + 1)];
    const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nO: V2 = [(-(b.z - a.z) / tl) * side, ((b.x - a.x) / tl) * side];
    return { hp, nO, E: [hp.x + nO[0] * host.hw, hp.z + nO[1] * host.hw] as V2 };
  };

  const sproutOk = (host: CurvedRoad, k: number, side: 1 | -1): boolean => {
    const hp = host.pts[k];
    const total = host.pts[host.pts.length - 1].s;
    if (hp.s < 40 || hp.s > total - 40) return false;
    if (!flat(host, k) || !flat(host, Math.min(host.pts.length - 1, k + 8)) || !flat(host, Math.max(0, k - 8))) return false;
    if (cityNoGo(hp.x, hp.z, 10)) return false;
    return junctionFree(host, hp.s, side);
  };

  /** a street from the host's edge to the first road ahead (inside a +-35 degree cone) */
  const tryConnect = (host: CurvedRoad, k: number, side: 1 | -1, cls: CurvedClass, minLen: number, maxLen: number, sep: number, rng: () => number): boolean => {
    const { hp, nO, E } = hostFrame(host, k, side);
    const cands: { road: CurvedRoad; i: number; L: number; dev: number }[] = [];
    for (const r of api.roads) {
      const bb = r.bbox;
      if (E[0] + maxLen < bb.minX || E[0] - maxLen > bb.maxX || E[1] + maxLen < bb.minZ || E[1] - maxLen > bb.maxZ) continue;
      for (let i = 0; i < r.pts.length; i += 2) {
        const p = r.pts[i];
        const dx = p.x - E[0];
        const dz = p.z - E[1];
        const L = Math.hypot(dx, dz);
        if (L < minLen || L > maxLen) continue;
        const cos = (dx * nO[0] + dz * nO[1]) / L;
        if (cos < 0.82) continue;
        if (r === host && Math.abs(p.s - hp.s) < 160) continue;
        if (!targetOk(r, i)) continue;
        cands.push({ road: r, i, L, dev: Math.acos(Math.min(1, cos)) });
      }
    }
    if (!cands.length) return stat('no_cands');
    cands.sort((p, q) => p.L * (1 + p.dev) - q.L * (1 + q.dev));
    const seen = new Set<string>();
    let tried = 0;
    for (const c of cands) {
      if (seen.has(c.road.id)) continue;
      seen.add(c.road.id);
      if (++tried > 5) break;
      const t = c.road;
      const tp = t.pts[c.i];
      const ta = t.pts[Math.max(0, c.i - 1)];
      const tb = t.pts[Math.min(t.pts.length - 1, c.i + 1)];
      const ttl = Math.hypot(tb.x - ta.x, tb.z - ta.z) || 1;
      const tn: V2 = [-(tb.z - ta.z) / ttl, (tb.x - ta.x) / ttl];
      const tside: 1 | -1 = (E[0] - tp.x) * tn[0] + (E[1] - tp.z) * tn[1] >= 0 ? 1 : -1;
      if (!junctionFree(t, tp.s, tside)) { stat('t_junction'); continue; }
      const Et: V2 = [tp.x + tn[0] * tside * t.hw, tp.z + tn[1] * tside * t.hw];
      const dx = Et[0] - E[0];
      const dz = Et[1] - E[1];
      const L = Math.hypot(dx, dz);
      if (L < minLen) continue;
      const perp: V2 = [-dz / L, dx / L];
      // one gentle bend (a C-curve), sometimes a very slight S
      const amp = Math.min(10, L * (0.02 + rng() * 0.045)) * (rng() < 0.5 ? -1 : 1);
      const sCurve = rng() < 0.3;
      const m1: V2 = [E[0] + dx * 0.38 + perp[0] * amp, E[1] + dz * 0.38 + perp[1] * amp];
      const m2: V2 = [E[0] + dx * 0.66 + perp[0] * amp * (sCurve ? -0.6 : 0.8), E[1] + dz * 0.66 + perp[1] * amp * (sCurve ? -0.6 : 0.8)];
      const id = nextId(`cg_${cls[0]}`);
      const def: RoadDef = {
        id, name: streetName(id, cls), cls, kerb: true,
        from: { host: host.id, hint: [hp.x, hp.z] }, join: { host: t.id, hint: [tp.x, tp.z] }, ctrl: [m1, m2],
      };
      const built = valid(def, sep, new Set([host.id, t.id]), 'tee');
      if (built) {
        stat('connected');
        api.commit(built);
        return true;
      }
    }
    return stat('connect_failed');
  };

  /** a dead-end street with a turning circle, `len` m long from the host's edge */
  const tryCul = (host: CurvedRoad, k: number, side: 1 | -1, len: number, rng: () => number): boolean => {
    const { hp, nO, E } = hostFrame(host, k, side);
    for (const bendScale of [1, -1, 0]) {
      const bend = bendScale * (0.12 + rng() * 0.3);
      const d1 = rotate(nO, bend * 0.5);
      const d2 = rotate(nO, bend);
      const mid: V2 = [E[0] + nO[0] * 24 + d1[0] * (len * 0.4 - 24), E[1] + nO[1] * 24 + d1[1] * (len * 0.4 - 24)];
      const end: V2 = [mid[0] + d2[0] * len * 0.6, mid[1] + d2[1] * len * 0.6];
      const id = nextId('cg_c');
      const def: RoadDef = {
        id, name: streetName(id, 'residential'), cls: 'residential', kerb: true, cul: true,
        from: { host: host.id, hint: [hp.x, hp.z] }, ctrl: [mid, [end[0], end[1], d2[0], d2[1]]],
      };
      const built = valid(def, 40, new Set([host.id]), 'cul');
      if (built) {
        stat('cul');
        api.commit(built);
        return true;
      }
    }
    return false;
  };

  const sorted = () => api.roads.slice().sort((p, q) => (p.id < q.id ? -1 : 1));


  // 0. district plots along the backbone (the streets that grow later keep clear of them)
  {
    const PW = 2.4;
    const edge = (x: number, z: number): number => {
      const n = api.nearest(x, z, 40);
      return n ? n.d - n.road.hw - (n.road.kerb ? PW : 0) : 99;
    };
    const STYLES: DistrictStyle[] = ['glass', 'crescent', 'park', 'mews'];
    const DIMS: Record<DistrictStyle, [number, number]> = { crescent: [100, 92], glass: [112, 100], park: [112, 104], mews: [104, 88] };
    const roads = sorted().filter((r) => (r.cls === 'main' || r.cls === 'secondary') && r.tag !== 'ramp' && r.tag !== 'flyover' && r.kerb && r.id !== 'cy_belt');
    const fit = (cx: number, cz: number, ivx: number, ivz: number, W: number, D: number): boolean => {
      const c = { cx, cz, ivx, ivz };
      const at = (u: number, v: number): V2 => [c.cx + (c.ivz * u) + c.ivx * v, c.cz + (-c.ivx * u) + c.ivz * v];
      // v measured from the plot centre: -D/2 = the street edge
      for (let u = -W / 2; u <= W / 2 + 0.01; u += 10) {
        for (const v of [-D / 2, D / 2]) {
          const [x, z] = at(u, v);
          if (cityNoGo(x, z, -1) || isReserved(x, z, 8) || api.riverGap(x, z) < 36 || api.base(x, z) !== 0 || edge(x, z) < 2.2) return false;
        }
      }
      for (let v = -D / 2; v <= D / 2 + 0.01; v += 10) {
        for (const u of [-W / 2, W / 2]) {
          const [x, z] = at(u, v);
          if (cityNoGo(x, z, -1) || isReserved(x, z, 8) || api.riverGap(x, z) < 36 || api.base(x, z) !== 0 || edge(x, z) < 2.2) return false;
        }
      }
      for (let u = -W / 2 + 10; u < W / 2; u += 20) {
        for (let v = -D / 2 + 10; v < D / 2; v += 20) {
          const [x, z] = at(u, v);
          if (edge(x, z) < 3.5 || api.riverGap(x, z) < 36) return false;
        }
      }
      return true;
    };
    for (let pass = 0; pass < 3 && PLOTS.length < 24; pass++) {
      for (const r of roads) {
        if (PLOTS.length >= 24) break;
        const total = r.pts[r.pts.length - 1].s;
        const rng = makeRng(hashString(`plot:${r.id}:${pass}`));
        for (let s = 60 + rng() * 30; s < total - 70; s += 34) {
          for (const side of [1, -1] as const) {
            if (PLOTS.length >= 24) break;
            const k = Math.min(r.pts.length - 2, Math.round(s / 2.5));
            const p = r.pts[k];
            const rad = Math.hypot(p.x, p.z);
            if (rad > [560, 700, 820][pass] || rad < 165) continue;
            let ok = true;
            for (let q = -26; q <= 26; q += 4) {
              const pq = r.pts[Math.min(r.pts.length - 1, Math.max(0, k + q))];
              if (pq.bridge || pq.lift > 0.05) ok = false;
            }
            if (!ok || PLOTS.some((q) => Math.hypot(q.cx - p.x, q.cz - p.z) < 118)) continue;
            const style = STYLES[PLOTS.length % 4];
            const [W, D] = DIMS[style];
            const a = r.pts[Math.max(0, k - 2)];
            const b = r.pts[Math.min(r.pts.length - 1, k + 2)];
            const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
            const tx = (b.x - a.x) / tl;
            const tz = (b.z - a.z) / tl;
            // inward unit vector: away from the street, on `side` (side +1 = the road's right-hand normal (tz, -tx))
            const ivx = tz * side;
            const ivz = -tx * side;
            const dist = r.hw + PW + 3 + D / 2;
            const cx = p.x + ivx * dist;
            const cz = p.z + ivz * dist;
            // the plot's street edge has to be straight enough for the road: skip strongly curved stretches
            const kk = Math.min(r.pts.length - 1, k + 16);
            const kb = Math.max(0, k - 16);
            if (circumRadius(r.pts[kb].x, r.pts[kb].z, p.x, p.z, r.pts[kk].x, r.pts[kk].z) < 160) continue;
            if (!fit(cx, cz, ivx, ivz, W, D)) continue;
            PLOTS.push({ index: PLOTS.length, style, seed: hashString(`district:${PLOTS.length}:${r.id}`), cx, cz, ivx, ivz, W, D });
          }
        }
      }
    }
    CITY_STATS.plots = PLOTS.length;
  }

  // 1. the roads that leave the corner chunks southwards (z = -450) have to meet the city
  const gates: { x: number; cls: CurvedClass }[] = [
    { x: 478.5, cls: 'residential' }, { x: 568.9, cls: 'secondary' },
  ];
  statTag = 'gate:';
  for (const g of gates) {
    const start: V2 = [g.x, -450];
    let done = false;
    for (const maxL of [260, 420, 640]) {
      const cands: { road: CurvedRoad; i: number; L: number }[] = [];
      for (const r of api.roads) {
        if (r.cls === 'freeway' || r.bbox.minX > g.x + maxL || r.bbox.maxX < g.x - maxL || r.bbox.minZ > -450 + maxL || r.bbox.maxZ < -450 - 10) continue;
        for (let i = 0; i < r.pts.length; i += 3) {
          const p = r.pts[i];
          const L = Math.hypot(p.x - start[0], p.z - start[1]);
          if (L < 110 || L > maxL || p.z < -420 || (p.z - start[1]) / L < 0.3) continue;
          if (!targetOk(r, i)) continue;
          cands.push({ road: r, i, L });
        }
      }
      cands.sort((p, q) => p.L - q.L);
      const seen = new Set<string>();
      let tries = 0;
      for (const c of cands) {
        if (seen.has(c.road.id)) continue;
        seen.add(c.road.id);
        if (++tries > 5) break;
        const t = c.road;
        const tp = t.pts[c.i];
        if (!junctionFree(t, tp.s, 1) && !junctionFree(t, tp.s, -1)) continue;
        const dx = tp.x - start[0];
        const dz = tp.z - start[1];
        const L = Math.hypot(dx, dz);
        const perp: V2 = [-dz / L, dx / L];
        const id = nextId('cg_g');
        const rng = makeRng(hashString(id + g.x));
        const amp = Math.min(14, L * 0.05) * (rng() < 0.5 ? -1 : 1);
        const def: RoadDef = {
          id, name: streetName(id, g.cls), cls: g.cls, kerb: true,
          entry: { lineId: '', axis: 'v', x: g.x, z: -450, dx: 0, dz: 1 },
          join: { host: t.id, hint: [tp.x, tp.z] },
          ctrl: [[start[0] + dx * 0.4 + perp[0] * amp, start[1] + dz * 0.4 + perp[1] * amp], [start[0] + dx * 0.72 - perp[0] * amp * 0.5, start[1] + dz * 0.72 - perp[1] * amp * 0.5]],
        };
        stat('gate_try');
        const built = valid(def, 36, new Set([t.id]), 'tee');
        if (built) {
          stat('gate_ok');
          api.commit(built);
          done = true;
          break;
        }
      }
      if (done) break;
    }
  }
  statTag = '';

  // 2. connectors, from the big roads down to the small ones
  for (let pi = 0; pi < PASSES.length; pi++) {
    const pass = PASSES[pi];
    for (const host of sorted()) {
      if (!pass.hosts.includes(host.cls) || host.tag === 'ramp' || host.cul) continue;
      const rng = makeRng(hashString(`${host.id}:${pi}`));
      const total = host.pts[host.pts.length - 1].s;
      for (const side of [1, -1] as const) {
        let s = 55 + rng() * (pass.spacing[1] - pass.spacing[0]);
        while (s < total - 55) {
          const k = Math.min(host.pts.length - 2, Math.round(s / 2.5));
          if (sproutOk(host, k, side)) tryConnect(host, k, side, pass.cls, pass.minLen, pass.maxLen, pass.sep, rng);
          s += pass.spacing[0] + rng() * (pass.spacing[1] - pass.spacing[0]);
        }
      }
    }
  }

  // 3. holes: keep finding the emptiest buildable spot and push a street into it (connecting through to the far side if possible)
  const GX = 24;
  const gn = Math.floor(1760 / GX) + 1;
  const gx0 = -880;
  const mask = new Uint8Array(gn * gn);
  const dist = new Float32Array(gn * gn);
  for (let i = 0; i < gn; i++) for (let j = 0; j < gn; j++) mask[i * gn + j] = buildable(gx0 + i * GX, gx0 + j * GX) ? 1 : 0;
  dist.fill(130);
  // distance field by splatting road samples (every 5 m) onto the grid: much cheaper than a nearest-road query per grid point
  const splat = (r: CurvedRoad) => {
    const rad = Math.ceil(130 / GX);
    for (let k = 0; k < r.pts.length; k += 2) {
      const p = r.pts[k];
      const ci = Math.round((p.x - gx0) / GX);
      const cj = Math.round((p.z - gx0) / GX);
      for (let i = Math.max(0, ci - rad); i <= Math.min(gn - 1, ci + rad); i++) {
        for (let j = Math.max(0, cj - rad); j <= Math.min(gn - 1, cj + rad); j++) {
          const d = Math.hypot(gx0 + i * GX - p.x, gx0 + j * GX - p.z);
          if (d < dist[i * gn + j]) dist[i * gn + j] = d;
        }
      }
    }
  };
  for (const r of api.roads) splat(r);
  const dead: V2[] = [];
  let committedBefore = api.roads.length;
  statTag = 'hole:';
  for (let iter = 0; iter < 260; iter++) {
    let bi = -1;
    let bd = HOLE_R;
    for (let i = 0; i < gn; i++) {
      for (let j = 0; j < gn; j++) {
        const idx = i * gn + j;
        if (!mask[idx] || dist[idx] <= bd) continue;
        const x = gx0 + i * GX;
        const z = gx0 + j * GX;
        if (dead.some((q) => Math.hypot(q[0] - x, q[1] - z) < 50)) continue;
        bd = dist[idx];
        bi = idx;
      }
    }
    if (bi < 0) break;
    const hx = gx0 + Math.floor(bi / gn) * GX;
    const hz = gx0 + (bi % gn) * GX;
    const near = api.nearest(hx, hz, 135, (r) => r.cls === 'freeway' || r.tag === 'ramp' || r.cul);
    let ok = false;
    if (near) {
      const host = near.road;
      const k = Math.min(host.pts.length - 2, Math.max(1, Math.round(near.i + near.t)));
      const hp = host.pts[k];
      const f = hostFrame(host, k, 1);
      const side: 1 | -1 = (hx - hp.x) * f.nO[0] + (hz - hp.z) * f.nO[1] >= 0 ? 1 : -1;
      const rng = makeRng(hashString(`hole${iter}`));
      // try a few neighbouring foot points so a junction-spacing clash does not kill the attempt
      for (const dk of [0, 8, -8, 16, -16, 26, -26]) {
        const kk = Math.min(host.pts.length - 2, Math.max(1, k + dk));
        if (!sproutOk(host, kk, side)) continue;
        const cls: CurvedClass = host.cls === 'main' ? 'secondary' : 'residential';
        if (tryConnect(host, kk, side, cls, 56, host.cls === 'residential' ? 260 : 520, 38, rng)) { ok = true; break; }
        if (tryCul(host, kk, side, Math.min(210, Math.max(80, bd + 22)), rng)) { ok = true; break; }
      }
    }
    if (ok) {
      splat(api.roads[api.roads.length - 1]);
    } else {
      dead.push([hx, hz]);
    }
  }
  statTag = '';

  // 4. a winding road up each hill: from the nearest street, 1.25 turns up the flank to a lookout circle on the summit
  CITY_HILLS.forEach((h, hi) => {
    const foot = api.nearest(h.x, h.z, h.r + 190, (r) => r.cls === 'freeway' || r.tag === 'ramp' || r.cul || r.cls === 'main');
    if (!foot) { CITY_STATS[`hill${hi}_nofoot`] = 1; return; }
    const host = foot.road;
    const k = Math.min(host.pts.length - 2, Math.max(1, Math.round(foot.i + foot.t)));
    if (!flat(host, k)) { CITY_STATS[`hill${hi}_notflat`] = 1; return; }
    const ang0 = Math.atan2(foot.z - h.z, foot.x - h.x);
    const dir = hi % 2 === 0 ? 1 : -1;
    const N = 26;
    const user: Ctrl[] = [];
    for (let q = 0; q <= N; q++) {
      const a = ang0 + dir * q * (Math.PI * 2.5 / N);
      const r = h.r * (0.9 - 0.66 * (q / N));
      user.push([Math.round(h.x + Math.cos(a) * r), Math.round(h.z + Math.sin(a) * r)]);
    }
    for (const side of [1, -1] as const) {
      void side;
      const def: RoadDef = {
        id: `cy_hill${hi}`, name: `${HILL_NAMES[hi]} Drive`, cls: 'secondary', kerb: false, cul: true, tag: 'hill',
        from: { host: host.id, hint: [host.pts[k].x, host.pts[k].z] }, ctrl: user,
      };
      const built = api.tryBuild(def);
      if (built) { let mx = 0, at = 0; built.road.pts.forEach((p, i) => { if (Math.abs(p.lift) > mx) { mx = Math.abs(p.lift); at = i; } }); CITY_STATS[`hill${hi}_maxlift_${mx.toFixed(1)}_at${at}_of${built.road.pts.length}_br${built.bridges.map((b) => b.kind + b.i0 + '-' + b.i1).join('+')}`] = 1; }
      if (built && !built.bridges.length) { api.commit(built); CITY_STATS[`hill${hi}`] = 1; break; }
    }
  });
  CITY_STATS.hole_roads = api.roads.length - committedBefore;
  committedBefore = 0;
}
