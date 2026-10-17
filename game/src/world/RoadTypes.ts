/**
 * RoadTypes - the shared data model of the curved road network (types only, erased at build time).
 */
import type { Ctrl, V2 } from './RoadMath';

export type CurvedClass = 'freeway' | 'main' | 'secondary' | 'residential' | 'rural' | 'mountain';

export interface RoadSample {
  x: number;
  z: number;
  /** road surface height before the +0.01 asphalt offset */
  y: number;
  /** arc length from the start of the road */
  s: number;
  /** kerbed-pavement strength 0..1 */
  curb: number;
  /** a deck structure (stream bridge or viaduct): no terrain bed, parapets, piers */
  bridge: boolean;
  /** extra bed depth (m): under junction mouths and bridge ends, where the road surface tilts */
  dip: number;
  /** the deck stands clear of the ground (viaduct / flyover): the surface is > VIADUCT_MIN above the terrain */
  viaduct: boolean;
  /** height of the surface above the base terrain (m) */
  lift: number;
}

export interface CurvedRoad {
  id: string;
  name: string;
  cls: CurvedClass;
  width: number;
  lanes: number;
  hw: number;
  maxGrade: number;
  pts: RoadSample[];
  /** the grid road this one continues, if it starts at the chunk border */
  entry: { lineId: string; axis: 'h' | 'v'; x: number; z: number } | null;
  /** the grid road this one runs into, if it ENDS at the chunk border (x, z = its last point) */
  exit: { lineId: string; axis: 'h' | 'v'; x: number; z: number } | null;
  /** kerbed pavements along the whole road */
  kerb: boolean;
  /** dead end with a turning circle */
  cul: boolean;
  /** street-lighting / furniture family */
  tag: string;
  bbox: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** junctions where side roads meet THIS road: arc length along it, side, side road half width */
  hostJoins: { s: number; side: 1 | -1; hw: number; rF: number; roadId: string }[];
  /** stretches next to the junction mouths of THIS road where the kerbed pavement is cut (both sides) */
  mouths: { s0: number; s1: number }[];
}

export interface Bridge {
  roadId: string;
  i0: number;
  i1: number;
  kind: 'span' | 'viaduct';
}

export interface Junction {
  /** the road that ends here (T-junction onto the host) */
  roadId: string;
  hostId: string;
  hostIdx: number;
  /** +1 / -1: which side of the host (along its left normal) the side road is on */
  side: 1 | -1;
  /** 'tee' = side road meets the host at right angles; 'merge' = a ramp that peels off the host tangentially */
  kind: 'tee' | 'merge';
}

export interface Lift {
  /** where along the road (nearest centreline sample) */
  at: V2;
  /** surface height above the terrain (m) */
  h: number;
}

export interface RoadDef {
  id: string;
  name: string;
  cls: CurvedClass;
  /** border entry on a cut grid road: start point + inward direction; `lead` = straight run (m) before the path may bend (default LEAD) */
  entry?: { lineId: string; axis: 'h' | 'v'; x: number; z: number; dx: number; dz: number; lead?: number };
  /** the road's last control point lies on a cut grid road (the nav graph links it there) */
  exit?: { lineId: string; axis: 'h' | 'v' };
  /** control points after the entry lead (or from the start for roads that start on a host) */
  ctrl: Ctrl[];
  /** ends in a T-junction onto another road, near this hint point */
  join?: { host: string; hint: V2 };
  /** starts as a T-junction off another road (road is built from the junction outward) */
  from?: { host: string; hint: V2 };
  /** starts as a ramp peeling off another road: leaves the host's edge tangentially in direction `dir` along the host */
  merge?: { host: string; hint: V2; side: 1 | -1; dir: 1 | -1 };
  /** surface height above the terrain (viaducts / flyovers / river bridges) */
  lift?: Lift[];
  /** kerbed pavements along the whole road (city streets) */
  kerb?: boolean;
  /** dead end: finishes in a turning circle */
  cul?: boolean;
  tag?: string;
}

/** a road that was built but not yet added to the network (used by the city growth to test candidates) */
export interface BuiltRoad {
  readonly road: CurvedRoad;
  readonly junctions: Junction[];
  readonly bridges: Bridge[];
}

export interface NearestRoad {
  road: CurvedRoad;
  i: number;
  t: number;
  /** distance from the road CENTRELINE */
  d: number;
  x: number;
  z: number;
}

/** what the city growth (CityPlan.growCity) may ask of the network while it lays out streets */
export interface GrowApi {
  roads: CurvedRoad[];
  byId: Map<string, CurvedRoad>;
  /** build a def without adding it (null when the def is malformed or a host is missing) */
  tryBuild(def: RoadDef): BuiltRoad | null;
  commit(b: BuiltRoad): CurvedRoad;
  nearest(x: number, z: number, maxD: number, skip?: (r: CurvedRoad) => boolean): NearestRoad | null;
  /** distance to the nearest river bank (negative = in the water) */
  riverGap(x: number, z: number): number;
  base(x: number, z: number): number;
}

export interface Hill {
  x: number;
  z: number;
  r: number;
  h: number;
}

/** a river / stream: centreline control points listed upstream -> downstream */
export interface StreamDef {
  ctrl: Ctrl[];
  /** half width of the channel (m) */
  half: number;
  /** depth of the bed below the surrounding terrain (m, default 1.7) */
  depth?: number;
}
