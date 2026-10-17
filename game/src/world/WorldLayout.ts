import { GRID_EDGE } from './CurvedRoads';
import { RoadSegment } from '../types/game';
import { hashString, makeRng } from '../travel/Geo';

/**
 * WorldLayout - the big-map blueprint (data only, deterministic, cheap).
 *
 * The original hand-built Ikeja core (|x|,|z| < ~100) stays exactly as it was. Around it the map grows to
 * 1.8 km x 1.8 km: arterial / collector / residential grid lines, zones (residential, commercial/office,
 * market), parks and named districts. Geometry is produced lazily by WorldStreamer cell by cell.
 */

export const WORLD_HALF = 900;
export const CORE_HALF = 105;

export interface GridLine {
  id: string;
  name: string;
  pos: number;
  width: number;
  lanes: number;
  cls: 'main' | 'secondary' | 'residential';
}

const STREET_NAMES = [
  'Awolowo Way', 'Allen Avenue', 'Opebi Road', 'Obafemi Awolowo Rd', 'Oba Akran Avenue', 'Kodesoh Street',
  'Adeniyi Jones Ave', 'Toyin Street', 'Isaac John Street', 'Ikorodu Road', 'Mobolaji Bank Anthony Way', 'Lateef Jakande Rd',
  'Ogba Road', 'Agidingbi Road', 'Ojodu Berger Rd', 'Alausa Link', 'Maryland Crescent', 'Ikosi Road', 'Kudirat Abiola Way',
  'Oregun Road', 'Sobo Arobiodu St', 'Salvation Road', 'Acme Road', 'Ajao Estate Rd', 'Wempco Road', 'Obafemi St',
  'Lagos Road', 'Shonibare Estate Rd', 'Adeola Odeku St', 'Bolade Street', 'Ladipo Street', 'Mende Road',
];

const REGION_NAMES = {
  0: ['GRA Ikeja', 'Ogba Estate', 'Ojodu Berger', 'Agidingbi', 'Alausa', 'Ikosi Housing', 'Anthony Village', 'Magodo Phase 1', 'Omole Estate'],
  1: ['Allen Avenue District', 'Opebi Business Park', 'Maryland Commercial', 'Ikeja Central', 'Oregun Corporate Hub', 'Toyin Plaza Strip'],
  2: ['Computer Village Market', 'Ojota Market', 'Oshodi Market', 'Ladipo Auto Market', 'Mile 12 Market'],
} as const;

function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const h = (a: number, b: number) => {
    let v = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(seed, 2147483647);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = h(ix, iz);
  const b = h(ix + 1, iz);
  const c = h(ix, iz + 1);
  const d = h(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

export class WorldLayout {
  public readonly vLines: GridLine[] = []; // roads running along z at x = pos
  public readonly hLines: GridLine[] = []; // roads running along x at z = pos
  public readonly roads: RoadSegment[] = [];

  constructor(seed = 20260) {
    // ---- core lines (kept from the original map, now extended across the whole world) ----
    const core = {
      v: [
        { pos: -50, id: 'road_west_link', name: 'West Link Road', width: 8, lanes: 2, cls: 'residential' as const },
        { pos: 0, id: 'road_allen_avenue', name: 'Allen Avenue', width: 14, lanes: 4, cls: 'main' as const },
        { pos: 50, id: 'road_east_link', name: 'East Link Road', width: 8, lanes: 2, cls: 'residential' as const },
      ],
      h: [
        { pos: -50, id: 'road_kodesoh_st', name: 'Kodesoh Street', width: 9, lanes: 2, cls: 'secondary' as const },
        { pos: 0, id: 'road_awolowo_way', name: 'Awolowo Way', width: 14, lanes: 4, cls: 'main' as const },
        { pos: 50, id: 'road_commercial_ave', name: 'Commercial Avenue', width: 9, lanes: 2, cls: 'secondary' as const },
      ],
    };
    void seed;
    // Outside the downtown the grid is gone: the curved city (CityPlan.ts / CurvedRoads.ts) takes over at GRID_EDGE, where each of
    // these six roads continues as a curved arm. Only the hand-built downtown keeps its straight roads.
    this.vLines = core.v.slice();
    this.hLines = core.h.slice();
    for (const l of this.vLines) this.roads.push({ id: l.id, start: { x: l.pos, z: -GRID_EDGE }, end: { x: l.pos, z: GRID_EDGE }, width: l.width, lanes: l.lanes, hasSidewalk: true, name: l.name });
    for (const l of this.hLines) this.roads.push({ id: l.id, start: { x: -GRID_EDGE, z: l.pos }, end: { x: GRID_EDGE, z: l.pos }, width: l.width, lanes: l.lanes, hasSidewalk: true, name: l.name });
  }

  /** 0 residential, 1 commercial/office, 2 market */
  public zoneAt(x: number, z: number): 0 | 1 | 2 {
    const d = Math.hypot(x, z);
    if (d < 260) return 1;
    const n = noise(x / 280, z / 280, 17);
    if (n < 0.26) return 2;
    if (n > 0.78) return 1;
    return 0;
  }

  public districtNameAt(x: number, z: number): string {
    if (Math.abs(x) < CORE_HALF && Math.abs(z) < CORE_HALF) return 'Ikeja Core';
    const zone = this.zoneAt(x, z);
    const list = REGION_NAMES[zone];
    const rx = Math.floor(x / 300);
    const rz = Math.floor(z / 300);
    return list[hashString(`${zone}:${rx}:${rz}`) % list.length];
  }

  /** a block (between neighbouring grid lines) is a park? deterministic */
  public isParkBlock(_i: number, _j: number): boolean {
    return false; // parks are district plots now (CityPlan / CityDistricts)
  }

  /** Lines that matter to a cell rectangle (with margin) */
  public linesIn(minX: number, maxX: number, minZ: number, maxZ: number, margin = 0): { v: GridLine[]; h: GridLine[] } {
    return {
      v: this.vLines.filter((l) => l.pos >= minX - margin && l.pos <= maxX + margin),
      h: this.hLines.filter((l) => l.pos >= minZ - margin && l.pos <= maxZ + margin),
    };
  }
}

let shared: WorldLayout | null = null;
export function getWorldLayout(): WorldLayout {
  if (!shared) shared = new WorldLayout();
  return shared;
}
