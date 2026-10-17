/**
 * CityBuildings - where every building of the curved city stands (pure data, deterministic, no THREE).
 *
 *  1. district plots   oriented rectangles along the main / secondary streets, filled by CityDistricts.ts
 *                      (Crescent Villas, Glass Quarter, Sky Garden Park, The Mews)
 *  2. frontage         a row of kit buildings along every kerbed street, both sides, facing the street, following its curve
 *  3. second row       houses in the open land behind the frontage, turned to face the nearest street
 *
 * Every footprint is an oriented rectangle that is tested against every road edge, the river, the hills, the downtown core,
 * the hand-built landmark lots, the district plots and all other footprints, so nothing overlaps a road or another building.
 * The building geometry itself comes from the same BuildingKit as before (placeBuilding): the planner only dry-runs it to
 * learn the footprint, the cell builder replays it with the same seed.
 */
import { hashString, makeRng } from '../travel/Geo';
import { placeBuilding, type Kit, type Zone } from '../travel/BuildingKit';
import { isReserved, reservedOverlaps } from '../buildings/lots';
import { PAVEMENT_W, SHOULDER, baseHeight, getCurvedNetwork, inPavementCut, roadEdgeDistance, roadFootAt, waterGap, type CurvedRoad } from './CurvedRoads';
import { cityNoGo, getCityPlots } from './CityPlan';
import { getWorldLayout } from './WorldLayout';
import { District, DistrictPlot, makeDistrictAt, obbOverlap } from './CityDistricts';
import { BX, BR_Z0 } from './barracks/BarracksLayout';

/** no building may stand within this half-width of the bridge's centre line (x = BX), from this z southwards (the barracks causeway approach) */
const BRIDGE_KEEP_HALF_W = 30;
const BRIDGE_KEEP_Z0 = BR_Z0 - 60;

/** the kit's building face plane sits at local x = +-FACE (see BuildingKit) */
export const KIT_FACE = 12.8;

export interface PlannedBuilding {
  id: string;
  /** footprint centre */
  x: number;
  z: number;
  /** kit transform: yaw + translation (the building is built with zc = 0) */
  rot: number;
  tx: number;
  tz: number;
  side: 1 | -1;
  slot: number;
  zone: Zone;
  seed: number;
  /** footprint: w along the street, d across it (incl. the compound wall) */
  w: number;
  d: number;
}

export interface CityBuildingsData {
  buildings: PlannedBuilding[];
  plots: DistrictPlot[];
  districts: District[];
  /** buildings whose centre lies in the rectangle (half-open): every building belongs to exactly one streamed cell */
  inRect(minX: number, maxX: number, minZ: number, maxZ: number): PlannedBuilding[];
  /** is (x, z) within r of a planned footprint, a district plot or a landmark lot? (trees, props) */
  occupied(x: number, z: number, r: number): boolean;
}

// ------------------------------------------------------------------------------------------------
// dry-running the kit
// ------------------------------------------------------------------------------------------------

const nullFn = (): undefined => undefined;
const nullBatch = new Proxy({}, { get: () => nullFn });
const nullFac = new Proxy({}, { get: () => nullBatch });
function dryKit(seed: number): Kit {
  return {
    solid: nullBatch, glow: nullBatch, fac: nullFac, signs: nullBatch, near: false, night: false,
    rng: makeRng(seed), nrng: makeRng(seed ^ 0x5bd1e995), trees: [],
  } as unknown as Kit;
}

/** footprint of the kit building that `seed` produces in a slot: lateral depth (d), width along the street (w), setback */
function footprint(seed: number, side: 1 | -1, slot: number, zone: Zone): { w: number; d: number; setback: number } {
  return placeBuilding(dryKit(seed), side, 0, slot, zone);
}

// ------------------------------------------------------------------------------------------------
// the planner
// ------------------------------------------------------------------------------------------------

interface OBB { x: number; z: number; hw: number; hd: number; rot: number }

const CELL = 24;
const FRONT = PAVEMENT_W + SHOULDER + 2.2; // facade line, beyond the road's half width

let cached: CityBuildingsData | null = null;
export const CB_STATS: Record<string, number> = {};
const st = (k: string): false => { CB_STATS[k] = (CB_STATS[k] ?? 0) + 1; return false; };

export function getCityBuildings(): CityBuildingsData {
  if (cached) return cached;
  const net = getCurvedNetwork();
  const layout = getWorldLayout();

  const hash = new Map<number, { o: OBB; r: number; pad: number }[]>();
  const hkey = (cx: number, cz: number) => (cx + 1024) * 4096 + (cz + 1024);
  const addObb = (o: OBB, pad: number) => {
    const r = Math.hypot(o.hw, o.hd);
    for (let cx = Math.floor((o.x - r) / CELL); cx <= Math.floor((o.x + r) / CELL); cx++) {
      for (let cz = Math.floor((o.z - r) / CELL); cz <= Math.floor((o.z + r) / CELL); cz++) {
        const k = hkey(cx, cz);
        const l = hash.get(k);
        const item = { o, r, pad };
        if (l) l.push(item);
        else hash.set(k, [item]);
      }
    }
  };
  const overlapsAny = (o: OBB, pad: number): boolean => {
    const r = Math.hypot(o.hw, o.hd) + pad + 2;
    for (let cx = Math.floor((o.x - r) / CELL); cx <= Math.floor((o.x + r) / CELL); cx++) {
      for (let cz = Math.floor((o.z - r) / CELL); cz <= Math.floor((o.z + r) / CELL); cz++) {
        const l = hash.get(hkey(cx, cz));
        if (!l) continue;
        for (const q of l) if (obbOverlap(o, q.o, Math.max(pad, q.pad))) return true;
      }
    }
    return false;
  };

  /** the kit footprint as an OBB in the OBB convention (local x = across the street = the road's right normal, local z = along it) */
  const obbOf = (px: number, pz: number, tx: number, tz: number, side: 1 | -1, setback: number, w: number, d: number): { o: OBB; cx: number; cz: number } => {
    const rx = tz;
    const rz = -tx;
    const lat = FRONT + setback - 0.6; // include the compound wall
    return { o: { x: 0, z: 0, hw: 0, hd: 0, rot: 0 }, cx: px + side * rx * lat, cz: pz + side * rz * lat, ...{} } as never;
  };
  void obbOf;

  // water clearance on a 12 m raster (a footprint corner is within 8.5 m of its cell centre): waterGap itself walks every stream segment
  const WG = 12;
  const WN = 156;
  const waterOk = new Uint8Array(WN * WN);
  for (let i = 0; i < WN; i++) for (let j = 0; j < WN; j++) waterOk[i * WN + j] = waterGap(-936 + i * WG, -936 + j * WG) - 8.5 > 34 ? 1 : 0;
  const nearWater = (x: number, z: number): boolean => {
    const i = Math.round((x + 936) / WG);
    const j = Math.round((z + 936) / WG);
    return i < 0 || j < 0 || i >= WN || j >= WN ? false : waterOk[i * WN + j] === 0;
  };

  /** everything that has to be true for a footprint to stand there (cheap tests first) */
  const fits = (o: OBB, front: [number, number][]): boolean => {
    if (overlapsAny(o, 1.3)) return st('f_overlap');
    // keep the foot of the barracks causeway clear: nothing may stand on the bridge approach (x = BX, from the Beltway junction out to the sea)
    {
      const r = Math.hypot(o.hw, o.hd);
      const dx = Math.max(Math.abs(o.x - BX) - BRIDGE_KEEP_HALF_W, 0);
      const dz = Math.max(BRIDGE_KEEP_Z0 - o.z, 0);
      if (Math.hypot(dx, dz) < r) return st('f_bridge');
    }
    const c = Math.cos(o.rot);
    const s = Math.sin(o.rot);
    // corners (local x = (c, -s), local z = (s, c)) + centre
    const pts: [number, number][] = [];
    for (const [sx, sz] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const lx = sx * o.hw;
      const lz = sz * o.hd;
      pts.push([o.x + lx * c + lz * s, o.z - lx * s + lz * c]);
    }
    for (const p of pts) {
      if (cityNoGo(p[0], p[1], -1)) return st('f_nogo');
      if (nearWater(p[0], p[1])) return st('f_water');
      if (baseHeight(p[0], p[1]) !== 0) return st('f_base');
    }
    for (const p of pts) {
      if (isReserved(p[0], p[1], 3)) return st('f_lot');
      if (roadEdgeDistance(p[0], p[1]) < 2.2) return st('f_road');
    }
    for (const p of front) if (roadEdgeDistance(p[0], p[1]) < 3.2) return st('f_front');
    return true;
  };

  // ---- 1. district plots (reserved along the backbone by CityPlan before the streets grew) ----------
  const plots: DistrictPlot[] = getCityPlots().slice();
  const districts: District[] = [];
  const plotObbs: OBB[] = [];
  for (const p of plots) {
    districts.push(makeDistrictAt(p));
    // the plot's rotation in the OBB convention (local x = across, local z = inward)
    const o: OBB = { x: p.cx, z: p.cz, hw: p.W / 2, hd: p.D / 2, rot: Math.atan2(p.ivx, p.ivz) };
    plotObbs.push(o);
    addObb(o, 3);
  }

  // ---- 2. frontage ----------------------------------------------------------------------------
  const buildings: PlannedBuilding[] = [];
  const place = (b: PlannedBuilding, o: OBB) => {
    buildings.push(b);
    addObb(o, 0);
  };

  const zoneOf = (x: number, z: number): Zone => layout.zoneAt(x, z);

  for (const r of net.roads.slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!r.kerb || r.cls === 'freeway' || r.tag === 'ramp') continue;
    const total = r.pts[r.pts.length - 1].s;
    for (const side of [1, -1] as const) {
      const rng = makeRng(hashString(`front:${r.id}:${side}`));
      let s = 8 + rng() * 6;
      let n = 0;
      while (s < total - 12) {
        const slot = 10 + rng() * 8;
        const k0 = Math.min(r.pts.length - 2, Math.max(1, Math.round((s + slot / 2) / 2.5)));
        const adv = () => { s += 5; };
        const zone = zoneOf(r.pts[k0].x, r.pts[k0].z);
        const seed = hashString(`b:${r.id}:${side}:${n}`);
        const fp = footprint(seed, side, slot, zone);
        n++;
        // centre the building on its own width so neighbours never overlap
        const sc = s + fp.w / 2;
        const k = Math.min(r.pts.length - 2, Math.max(1, Math.round(sc / 2.5)));
        const p = r.pts[k];
        // not on decks, ramps or flyover approaches, not in junction mouths
        let blocked = false;
        for (let q = -4; q <= 4; q += 2) {
          const pq = r.pts[Math.min(r.pts.length - 1, Math.max(0, k + q))];
          if (pq.bridge || pq.lift > 0.05) blocked = true;
        }
        if (blocked || inPavementCut(r, sc, (-side) as 1 | -1) || inPavementCut(r, s, (-side) as 1 | -1) || inPavementCut(r, s + fp.w, (-side) as 1 | -1)) { adv(); continue; }
        // suburbs thin out
        const rad = Math.hypot(p.x, p.z);
        if (r.cls === 'residential' && rad > 640 && rng() < 0.3) { s += slot; continue; }
        const a = r.pts[Math.max(0, k - 1)];
        const b = r.pts[Math.min(r.pts.length - 1, k + 1)];
        const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const tx = (b.x - a.x) / tl;
        const tz = (b.z - a.z) / tl;
        const L0 = r.hw + FRONT;
        const rx = tz;
        const rz = -tx;
        const latC = L0 + fp.setback - 0.6 + (fp.d + 0.6) / 2;
        const o: OBB = { x: p.x + side * rx * latC, z: p.z + side * rz * latC, hw: (fp.d + 0.6) / 2, hd: fp.w / 2, rot: Math.atan2(tx, tz) };
        const front: [number, number][] = [];
        for (let u = -fp.w / 2; u <= fp.w / 2 + 0.01; u += fp.w / 2) {
          front.push([p.x + side * rx * (L0 + fp.setback) + tx * u, p.z + side * rz * (L0 + fp.setback) + tz * u]);
        }
        if (overlapsPlot(o) || !fits(o, front)) { adv(); continue; }
        const delta = L0 - KIT_FACE;
        place({
          id: `cb_${buildings.length}`, x: o.x, z: o.z, rot: o.rot, tx: p.x + side * rx * delta, tz: p.z + side * rz * delta,
          side, slot, zone, seed, w: fp.w, d: fp.d + 0.6,
        }, o);
        s += fp.w + 0.8 + rng() * 1.5;
      }
    }
  }
  function overlapsPlot(o: OBB): boolean {
    return plotObbs.some((q) => obbOverlap(o, q, 3));
  }

  // ---- 3. second row: houses in the land behind the frontage ----------------------------------
  {
    const cells: { x: number; z: number; k: number }[] = [];
    for (let x = -870; x <= 870; x += 15) for (let z = -870; z <= 870; z += 15) {
      const h = hashString(`i:${x}:${z}`);
      cells.push({ x: x + ((h & 255) / 255 - 0.5) * 9, z: z + (((h >>> 8) & 255) / 255 - 0.5) * 9, k: h >>> 16 });
    }
    cells.sort((a, b) => a.k - b.k);
    let id = 0;
    for (const c of cells) {
      if (cityNoGo(c.x, c.z, 4) || nearWater(c.x, c.z) || baseHeight(c.x, c.z) !== 0) continue;
      const rad = Math.hypot(c.x, c.z);
      if ((c.k & 1023) / 1023 > Math.max(0.35, 1.05 - rad / 950)) continue;
      const foot = roadFootAt(c.x, c.z, 78, (r) => r.kerb && r.cls !== 'freeway' && r.tag !== 'ramp');
      if (!foot) continue;
      const r = foot.road;
      const fk = Math.min(r.pts.length - 1, Math.round(foot.s / 2.5));
      if (r.pts[fk].bridge || r.pts[fk].lift > 0.05) continue;
      const rx = foot.tz;
      const rz = -foot.tx;
      const side: 1 | -1 = (c.x - foot.x) * rx + (c.z - foot.z) * rz >= 0 ? 1 : -1;
      const slot = 11 + (c.k % 7);
      const zone = zoneOf(c.x, c.z);
      const seed = hashString(`h:${id}:${Math.round(c.x)}:${Math.round(c.z)}`);
      const fp = footprint(seed, side, slot, zone);
      // front plane so that the footprint's centre lands on (c.x, c.z)
      const L0 = foot.d - fp.setback - (fp.d + 0.6) / 2 + 0.6 - 0.0;
      if (L0 < r.hw + FRONT) continue;
      const latC = L0 + fp.setback - 0.6 + (fp.d + 0.6) / 2;
      const o: OBB = { x: foot.x + side * rx * latC, z: foot.z + side * rz * latC, hw: (fp.d + 0.6) / 2, hd: fp.w / 2, rot: Math.atan2(foot.tx, foot.tz) };
      const front: [number, number][] = [[foot.x + side * rx * (L0 + fp.setback), foot.z + side * rz * (L0 + fp.setback)]];
      if (overlapsPlot(o) || !fits(o, front)) continue;
      id++;
      place({
        id: `ci_${buildings.length}`, x: o.x, z: o.z, rot: o.rot, tx: foot.x + side * rx * (L0 - KIT_FACE), tz: foot.z + side * rz * (L0 - KIT_FACE),
        side, slot, zone, seed, w: fp.w, d: fp.d + 0.6,
      }, o);
    }
  }

  // ---- lookup ---------------------------------------------------------------------------------
  const byCell = new Map<number, PlannedBuilding[]>();
  for (const b of buildings) {
    const k = hkey(Math.floor(b.x / CELL), Math.floor(b.z / CELL));
    const l = byCell.get(k);
    if (l) l.push(b);
    else byCell.set(k, [b]);
  }
  cached = {
    buildings, plots, districts,
    inRect(minX, maxX, minZ, maxZ) {
      const out: PlannedBuilding[] = [];
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
        for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
          const l = byCell.get(hkey(cx, cz));
          if (!l) continue;
          for (const b of l) if (b.x >= minX && b.x < maxX && b.z >= minZ && b.z < maxZ) out.push(b);
        }
      }
      return out;
    },
    occupied(x, z, r) {
      for (let cx = Math.floor((x - r - 24) / CELL); cx <= Math.floor((x + r + 24) / CELL); cx++) {
        for (let cz = Math.floor((z - r - 24) / CELL); cz <= Math.floor((z + r + 24) / CELL); cz++) {
          const l = hash.get(hkey(cx, cz));
          if (!l) continue;
          for (const q of l) {
            const c = Math.cos(q.o.rot);
            const s = Math.sin(q.o.rot);
            const lx = c * (x - q.o.x) - s * (z - q.o.z);
            const lz = s * (x - q.o.x) + c * (z - q.o.z);
            if (Math.hypot(Math.max(Math.abs(lx) - q.o.hw, 0), Math.max(Math.abs(lz) - q.o.hd, 0)) < r) return true;
          }
        }
      }
      return isReserved(x, z, r);
    },
  };
  return cached;
}
