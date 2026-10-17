import { getWorldLayout, WORLD_HALF, GridLine } from '../world/WorldLayout';
import { IKEJA_DISTRICT_DATA } from '../data/worldData';
import { getLocationDefinition } from '../data/locationCatalog';
import { LOTS, getLotColliders, localToWorld } from '../buildings/lots';
import { hashString, makeRng } from '../travel/Geo';
import { allDistricts } from '../world/CityDistricts';
import { CurvedClass, GRID_EDGE, getCurvedNetwork, inCorner } from '../world/CurvedRoads';
import { cityNoGo } from '../world/CityPlan';
import { MapBarracks, getBarracksMapData } from '../world/barracks/BarracksMapData';

/**
 * NavMap - the single source of truth for BOTH the minimap and the full-screen map.
 *
 * Coordinates: the 3D world's own metres. Map x = world x (east, right), map y = world z (down on screen),
 * so north-up is -z. Nothing is stored twice: roads/zones/parks come from WorldLayout, core buildings and POIs
 * from IKEJA_DISTRICT_DATA, landmarks from buildings/lots.ts, ponds are re-derived with the same seeded RNG
 * CellBuilder uses for park blocks.
 */

export interface Pt { x: number; z: number }
export interface MapRect { minX: number; maxX: number; minZ: number; maxZ: number }

export interface Route {
  /** player -> road snap -> intersections -> road snap -> target */
  points: Pt[];
  /** points[roadFrom..roadTo] follow real roads; anything outside that range is an off-road walking leg */
  roadFrom: number;
  roadTo: number;
  /** metres along the whole route (road + off-road legs) */
  length: number;
  /** name of the road the first road leg follows */
  roadName: string | null;
}

/** Live state the minimap and the world map both read every frame (filled by GameEngine.getNavSnapshot) */
export interface NavSnapshot {
  x: number;
  z: number;
  /** heading the character faces, radians, 0 = +z (world) */
  face: number;
  /** heading the camera looks along, same convention */
  view: number;
  interior: boolean;
  /** horizontal ground speed in m/s, derived from real position change (works for walking, sprinting and any future vehicle) */
  speed: number;
  target: Pt | null;
  targetName: string;
  route: Route | null;
}

export interface MapBlock { x0: number; z0: number; x1: number; z1: number; zone: 0 | 1 | 2 | 3 } // 3 = park
export interface MapPoi { id: string; name: string; type: string; x: number; z: number; entrance: Pt }
export interface MapLandmark { id: string; name: string; x: number; z: number; /** street-side edge of the lot (front = local +z), reachable on foot */ entrance: Pt; rects: MapRect[] }
export interface MapBuilding { name: string; x0: number; z0: number; x1: number; z1: number }
export interface MapData {
  half: number;
  vLines: GridLine[];
  hLines: GridLine[];
  blocks: MapBlock[];
  ponds: { x: number; z: number; r: number }[];
  buildings: MapBuilding[];
  landmarks: MapLandmark[];
  pois: MapPoi[];
  districts: { name: string; x: number; z: number }[];
  /** curved roads of the reworked chunk (same centrelines the 3D world is built from) */
  curved: MapCurvedRoad[];
  /** water courses of the reworked chunks, with the half width of the channel */
  streams: { pts: Pt[]; halfWidth: number }[];
  /** chunk 3: the redesigned city blocks (lanes, paths, turning circles) */
  cityDistricts: MapCityDistrict[];
  /** the Independence Barracks island south of the map + the causeway bridge that leads to it */
  barracks: MapBarracks;
}
export interface MapCityDistrict {
  name: string;
  style: string;
  /** the plot is an oriented rectangle: centre, size across / deep, yaw in the obbCorners convention */
  cx: number;
  cz: number;
  W: number;
  D: number;
  rot: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  lanes: { pts: Pt[]; width: number }[];
  paths: { pts: Pt[]; width: number; closed: boolean }[];
  discs: { x: number; z: number; r: number }[];
}
export interface MapCurvedRoad { id: string; name: string; cls: CurvedClass; width: number; pts: Pt[]; /** [from, to] indices into pts */ bridges: [number, number][] }

/** stretch of a grid road that still exists: only the downtown grid is left (the curved city continues from its ends) */
export function roadExtent(_l: { pos: number }, _vert: boolean): [number, number] {
  return [-GRID_EDGE, GRID_EDGE];
}

export const ROAD_END = GRID_EDGE;

let data: MapData | null = null;

export function getMapData(): MapData {
  if (data) return data;
  const layout = getWorldLayout();
  const V = layout.vLines;
  const H = layout.hLines;

  // zone tint: a coarse 60 m raster of the city's zones (the grid blocks are gone)
  const blocks: MapBlock[] = [];
  const ponds: MapData['ponds'] = [];
  for (let x = -900; x < 900; x += 60) {
    for (let z = -900; z < 900; z += 60) {
      const cx = x + 30;
      const cz = z + 30;
      if (inCorner(cx, cz) || cityNoGo(cx, cz, 0) && Math.abs(cx) > 120) continue;
      if (Math.abs(cx) < GRID_EDGE && Math.abs(cz) < GRID_EDGE) continue;
      blocks.push({ x0: x, x1: x + 60, z0: z, z1: z + 60, zone: layout.zoneAt(cx, cz) });
    }
  }

  const buildings: MapBuilding[] = IKEJA_DISTRICT_DATA.buildings.map((b) => ({
    name: b.name,
    x0: b.position.x - b.size.width / 2,
    x1: b.position.x + b.size.width / 2,
    z0: b.position.z - b.size.depth / 2,
    z1: b.position.z + b.size.depth / 2,
  }));

  const landmarks: MapLandmark[] = LOTS.map((l) => ({
    id: l.id,
    name: l.name,
    x: l.x,
    z: l.z,
    entrance: (([ex, ez]) => ({ x: ex, z: ez }))(localToWorld(l, (l.reserve[0] + l.reserve[1]) / 2, l.reserve[3] + 1.5)),
    rects: getLotColliders(l).map((c) => c.rect),
  }));

  const pois: MapPoi[] = IKEJA_DISTRICT_DATA.pois.map((p) => {
    const def = getLocationDefinition(p.id);
    const e = def?.arrivalPoints.mainEntrance ?? p.position;
    return { id: p.id, name: p.name, type: p.type, x: p.position.x, z: p.position.z, entrance: { x: e.x, z: e.z } };
  });

  // one label per 300 m region, named by the game's own districtNameAt()
  const districts: MapData['districts'] = [];
  for (let c = -750; c <= 750; c += 300) {
    for (let r = -750; r <= 750; r += 300) districts.push({ name: layout.districtNameAt(c, r), x: c, z: r });
  }

  const net = getCurvedNetwork();
  const curved: MapCurvedRoad[] = net.roads.map((r) => {
    const keep: number[] = [];
    r.pts.forEach((p, i) => { if (i % 4 === 0 || i === r.pts.length - 1) keep.push(i); });
    const at = new Map(keep.map((k, n) => [k, n]));
    const bridges: [number, number][] = net.bridges
      .filter((b) => b.roadId === r.id)
      .map((b) => [at.get(keep.find((k) => k >= b.i0)!) ?? 0, at.get([...keep].reverse().find((k) => k <= b.i1)!) ?? 0] as [number, number]);
    return { id: r.id, name: r.name, cls: r.cls, width: r.width, pts: keep.map((k) => ({ x: r.pts[k].x, z: r.pts[k].z })), bridges };
  });
  const cityDistricts: MapCityDistrict[] = allDistricts(layout).map((c) => {
    for (const p of c.ponds) ponds.push({ x: p.x, z: p.z, r: p.r });
    const toPts = (pts: [number, number][]) => pts.map((p) => ({ x: p[0], z: p[1] }));
    return {
      name: c.name, style: c.style, x0: c.x0, z0: c.z0, x1: c.x1, z1: c.z1, cx: c.cx, cz: c.cz, W: c.W, D: c.D, rot: c.rot,
      lanes: c.lanes.map((l) => ({ pts: toPts(l.pts), width: l.width })),
      paths: c.paths.map((l) => ({ pts: toPts(l.pts), width: l.width, closed: l.closed })),
      discs: c.discs.map((dc) => ({ x: dc.x, z: dc.z, r: dc.r })),
    };
  });
  const streams = net.streams.map((s) => ({ pts: s.pts.map((p) => ({ x: p[0], z: p[1] })), halfWidth: s.halfWidth }));
  data = { half: WORLD_HALF, vLines: V, hLines: H, blocks, ponds, buildings, landmarks, pois, districts, curved, streams, cityDistricts, barracks: getBarracksMapData() };
  return data;
}

// ------------------------------------------------------------------------------------------------
// Routing: Dijkstra over the real roads (downtown grid + curved network).
// The start and the end are ALWAYS snapped onto the NEAREST road (true perpendicular foot point, no distance limit);
// the walk from/to that road is returned as off-road legs (roadFrom/roadTo) so the UI can draw them dashed.
// A straight line is never reported as a road route.
// ------------------------------------------------------------------------------------------------

interface Snap {
  pt: Pt;
  line: GridLine;
  /** the two intersection node ids at the ends of the road edge the point lies on */
  a: number;
  b: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z);

/** foot of the perpendicular from p onto grid line k (clamped to the road network), plus the road edge it lies on */
function snapOnLine(axis: 'v' | 'h', k: number, p: Pt): Snap {
  const { vLines: V, hLines: H } = getMapData();
  const NV = V.length;
  if (axis === 'v') {
    const z = clamp(p.z, H[0].pos, H[H.length - 1].pos);
    let j = 0;
    while (j < H.length - 2 && z > H[j + 1].pos) j++;
    return { pt: { x: V[k].pos, z }, line: V[k], a: j * NV + k, b: (j + 1) * NV + k };
  }
  const x = clamp(p.x, V[0].pos, V[V.length - 1].pos);
  let i = 0;
  while (i < V.length - 2 && x > V[i + 1].pos) i++;
  return { pt: { x, z: H[k].pos }, line: H[k], a: k * NV + i, b: k * NV + i + 1 };
}

/** A direct walk player -> target (no road at all) is only allowed up to this length. It is NOT used for snapping: the road snap has no distance limit. */
const MAX_DIRECT_M = 60;

function nodePt(id: number): Pt {
  const { vLines: V, hLines: H } = getMapData();
  return { x: V[id % V.length].pos, z: H[Math.floor(id / V.length)].pos };
}

// ---- curved-road graph (the chunk): nodes every ~5 m along each centreline, joined at T-junctions --------------
interface CGraph {
  pts: Pt[];
  adj: [number, number][][];
  names: string[];
  /** road id of every node (a name is not unique) */
  ids: string[];
  /** the real road pieces (consecutive nodes of one road), used to find the nearest point on a road */
  segs: [number, number][];
  entries: { node: number; axis: 'h' | 'v'; lineId: string }[];
  buckets?: Map<string, number[]>;
}
let cgraph: CGraph | null = null;
function curvedGraph(): CGraph {
  if (cgraph) return cgraph;
  const net = getCurvedNetwork();
  const g: CGraph = { pts: [], adj: [], names: [], ids: [], segs: [], entries: [] };
  const must = new Map<string, Set<number>>();
  for (const j of net.junctions) {
    if (!must.has(j.hostId)) must.set(j.hostId, new Set());
    must.get(j.hostId)!.add(j.hostIdx);
  }
  const nodeAt = new Map<string, number>(); // `${roadId}:${sampleIdx}`
  const add = (a: number, b: number, c: number) => { g.adj[a].push([b, c]); g.adj[b].push([a, c]); };
  for (const r of net.roads) {
    const keep: number[] = [];
    r.pts.forEach((_, i) => { if (i % 3 === 0 || i === r.pts.length - 1 || must.get(r.id)?.has(i)) keep.push(i); });
    let prev = -1;
    let prevS = 0;
    for (const i of keep) {
      const id = g.pts.length;
      g.pts.push({ x: r.pts[i].x, z: r.pts[i].z });
      g.adj.push([]);
      g.names.push(r.name);
      g.ids.push(r.id);
      nodeAt.set(`${r.id}:${i}`, id);
      if (prev >= 0) { add(prev, id, r.pts[i].s - prevS); g.segs.push([prev, id]); }
      prev = id;
      prevS = r.pts[i].s;
    }
    if (r.entry) g.entries.push({ node: nodeAt.get(`${r.id}:0`)!, axis: r.entry.axis, lineId: r.entry.lineId });
    // a road that ENDS on a border (e.g. a bypass looping back to the grid) joins the grid there as well
    if (r.exit) g.entries.push({ node: nodeAt.get(`${r.id}:${r.pts.length - 1}`)!, axis: r.exit.axis, lineId: r.exit.lineId });
  }
  for (const j of net.junctions) {
    const side = net.byId.get(j.roadId)!;
    const host = net.byId.get(j.hostId)!;
    const hn = nodeAt.get(`${host.id}:${j.hostIdx}`)!;
    const hp = host.pts[j.hostIdx];
    const first = side.pts[0];
    const atStart = Math.hypot(first.x - hp.x, first.z - hp.z) < Math.hypot(side.pts[side.pts.length - 1].x - hp.x, side.pts[side.pts.length - 1].z - hp.z);
    const sn = nodeAt.get(`${side.id}:${atStart ? 0 : side.pts.length - 1}`)!;
    add(sn, hn, host.hw);
  }
  // roads that start / end exactly on another road's end (the corner chunks' entry roads) are one road
  const ends: { node: number; p: Pt }[] = [];
  for (const r of net.roads) for (const i of [0, r.pts.length - 1]) ends.push({ node: nodeAt.get(`${r.id}:${i}`)!, p: g.pts[nodeAt.get(`${r.id}:${i}`)!] });
  for (let a = 0; a < ends.length; a++) for (let b = a + 1; b < ends.length; b++) if (dist(ends[a].p, ends[b].p) < 1.5) add(ends[a].node, ends[b].node, 0.5);
  // spatial buckets for snapping
  g.buckets = new Map();
  g.pts.forEach((p, i) => {
    const k = `${Math.floor(p.x / 60)}:${Math.floor(p.z / 60)}`;
    const l = g.buckets!.get(k);
    if (l) l.push(i);
    else g.buckets!.set(k, [i]);
  });
  cgraph = g;
  return g;
}

/**
 * Where p joins the road network: for every road the closest point on its centreline (perpendicular foot, clamped to the
 * road's ends), nearest first. NO distance limit - standing in the middle of a field still snaps to the nearest road,
 * never to a far-away one. `limit` = how many distinct roads to return (1 = just the nearest).
 */
interface Access {
  pt: Pt;
  d: number;
  roadId: string;
  name: string;
  /** on a straight downtown road: the intersections at the ends of the road edge the point lies on */
  grid?: Snap;
  /** on a curved road: the two graph nodes of the piece the point lies on */
  curved?: [number, number];
}

function accessCandidates(p: Pt, limit: number): Access[] {
  const { vLines: V, hLines: H } = getMapData();
  const best = new Map<string, Access>();
  const offer = (a: Access) => {
    const o = best.get(a.roadId);
    if (!o || a.d < o.d) best.set(a.roadId, a);
  };
  // straight downtown roads: they exist for |coordinate| <= GRID_EDGE only
  for (let k = 0; k < V.length; k++) {
    const sn = snapOnLine('v', k, p);
    sn.pt = { x: V[k].pos, z: clamp(p.z, -GRID_EDGE, GRID_EDGE) };
    offer({ pt: sn.pt, d: dist(p, sn.pt), roadId: V[k].id, name: V[k].name, grid: sn });
  }
  for (let k = 0; k < H.length; k++) {
    const sn = snapOnLine('h', k, p);
    sn.pt = { x: clamp(p.x, -GRID_EDGE, GRID_EDGE), z: H[k].pos };
    offer({ pt: sn.pt, d: dist(p, sn.pt), roadId: H[k].id, name: H[k].name, grid: sn });
  }
  // curved roads: project p onto every piece of every centreline
  const g = curvedGraph();
  for (const seg of g.segs) {
    const a = g.pts[seg[0]];
    const b = g.pts[seg[1]];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2, 0, 1) : 0;
    const fx = a.x + t * dx;
    const fz = a.z + t * dz;
    const d = Math.hypot(p.x - fx, p.z - fz);
    const id = g.ids[seg[0]];
    const o = best.get(id);
    if (!o || d < o.d) best.set(id, { pt: { x: fx, z: fz }, d, roadId: id, name: g.names[seg[0]], curved: seg });
  }
  return [...best.values()].sort((a, b) => a.d - b.d).slice(0, limit);
}

/**
 * Shortest walking route from -> to over the real roads: the straight downtown grid plus the curved-road network, which
 * joins the grid at the border.
 * The route ALWAYS starts by walking from `from` to the NEAREST road and ends by walking from the NEAREST road to `to`
 * (dashed legs in the UI). Only if the nearest roads cannot be connected at all, the few nearest roads are tried instead.
 * A short hop (<= MAX_DIRECT_M) straight to the target is used when that is shorter than going via a road (roadName = null).
 */
export function computeRoute(from: Pt, to: Pt): Route {
  const r = solveRoute(from, to, accessCandidates(from, 1), accessCandidates(to, 1))
    ?? solveRoute(from, to, accessCandidates(from, 6), accessCandidates(to, 6));
  if (r) return r;
  const direct = dist(from, to);
  return { points: [{ x: from.x, z: from.z }, { x: to.x, z: to.z }], roadFrom: 0, roadTo: 0, length: direct, roadName: null };
}

/** One Dijkstra over: every grid intersection + the player + the target + the road access points + the curved-road nodes. null = no way through. */
function solveRoute(from: Pt, to: Pt, starts: Access[], ends: Access[]): Route | null {
  const { vLines: V, hLines: H } = getMapData();
  const NV = V.length;
  const N0 = NV * H.length;
  const idP = N0;
  const idQ = N0 + 1;
  const CG = curvedGraph();
  const NB = N0 + 2 + starts.length + ends.length; // first curved node id
  const total = NB + CG.pts.length;

  const vpt = new Map<number, Pt>([[idP, from], [idQ, to]]);
  const vacc = new Map<number, Access>();
  const extra = new Map<number, [number, number][]>();
  const link = (u: number, w: number, d: number) => {
    if (!extra.has(u)) extra.set(u, []);
    if (!extra.has(w)) extra.set(w, []);
    extra.get(u)!.push([w, d]);
    extra.get(w)!.push([u, d]);
  };
  const ptOf = (n: number): Pt => (n < N0 ? nodePt(n) : n >= NB ? CG.pts[n - NB] : vpt.get(n)!);
  /** join an access point (a node of its own) to the road graph */
  const wire = (id: number, ac: Access) => {
    vpt.set(id, ac.pt);
    vacc.set(id, ac);
    if (ac.grid) {
      const sn = ac.grid;
      link(id, sn.a, dist(ac.pt, nodePt(sn.a)));
      link(id, sn.b, dist(ac.pt, nodePt(sn.b)));
      // out on an arm beyond the last intersection: the curved road that continues this line starts right there
      const vert = V.includes(sn.line);
      const along = vert ? ac.pt.z : ac.pt.x;
      const last = vert ? H[H.length - 1].pos : V[V.length - 1].pos;
      const first = vert ? H[0].pos : V[0].pos;
      if (along > last || along < first) {
        for (const e of CG.entries) {
          if (e.lineId !== sn.line.id) continue;
          const ep = CG.pts[e.node];
          if ((vert ? ep.z : ep.x) * along > 0) link(id, NB + e.node, dist(ac.pt, ep));
        }
      }
    } else if (ac.curved) {
      for (const cn of ac.curved) link(id, NB + cn, dist(ac.pt, CG.pts[cn]));
    }
  };
  const sameEdge = (a: Access, b: Access) =>
    (a.grid && b.grid && a.grid.line === b.grid.line && a.grid.a === b.grid.a && a.grid.b === b.grid.b) ||
    (a.curved && b.curved && a.curved[0] === b.curved[0] && a.curved[1] === b.curved[1]);
  starts.forEach((ac, i) => { wire(N0 + 2 + i, ac); link(idP, N0 + 2 + i, ac.d); });
  ends.forEach((ac, i) => { wire(N0 + 2 + starts.length + i, ac); link(N0 + 2 + starts.length + i, idQ, ac.d); });
  // start and end on the same piece of road: drive straight along it
  starts.forEach((a, i) => ends.forEach((b, j) => {
    if (sameEdge(a, b)) link(N0 + 2 + i, N0 + 2 + starts.length + j, dist(a.pt, b.pt));
  }));
  // curved roads join the old grid roads at the chunk border
  for (const e of CG.entries) {
    const k = (e.axis === 'h' ? H : V).findIndex((l) => l.id === e.lineId);
    if (k < 0) continue;
    const sn = snapOnLine(e.axis, k, CG.pts[e.node]);
    for (const gn of [sn.a, sn.b]) link(NB + e.node, gn, dist(CG.pts[e.node], nodePt(gn)));
  }
  const direct = dist(from, to);
  if (direct <= MAX_DIRECT_M) link(idP, idQ, direct + 0.5); // +0.5 m: a road route wins ties

  const d = new Float64Array(total).fill(Infinity);
  const prev = new Int32Array(total).fill(-1);
  const done = new Uint8Array(total);
  d[idP] = 0;
  // binary min-heap of [distance, node]
  const hk: number[] = [];
  const hn: number[] = [];
  const hpush = (k: number, n: number) => {
    let i = hk.length;
    hk.push(k);
    hn.push(n);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= k) break;
      hk[i] = hk[p];
      hn[i] = hn[p];
      i = p;
    }
    hk[i] = k;
    hn[i] = n;
  };
  const hpop = (): number => {
    const top = hn[0];
    const k = hk.pop()!;
    const n = hn.pop()!;
    const len = hk.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= len) break;
        if (c + 1 < len && hk[c + 1] < hk[c]) c++;
        if (hk[c] >= k) break;
        hk[i] = hk[c];
        hn[i] = hn[c];
        i = c;
      }
      hk[i] = k;
      hn[i] = n;
    }
    return top;
  };
  const relax = (u: number, w: number, c: number) => {
    if (d[u] + c < d[w]) { d[w] = d[u] + c; prev[w] = u; hpush(d[w], w); }
  };
  hpush(0, idP);
  while (hk.length) {
    const u = hpop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === idQ) break;
    if (u < N0) {
      const i = u % NV;
      const j = Math.floor(u / NV);
      if (i > 0) relax(u, u - 1, V[i].pos - V[i - 1].pos);
      if (i < NV - 1) relax(u, u + 1, V[i + 1].pos - V[i].pos);
      if (j > 0) relax(u, u - NV, H[j].pos - H[j - 1].pos);
      if (j < H.length - 1) relax(u, u + NV, H[j + 1].pos - H[j].pos);
    } else if (u >= NB) {
      for (const [w, c] of CG.adj[u - NB]) relax(u, NB + w, c);
    }
    const ex = extra.get(u);
    if (ex) for (const [w, c] of ex) relax(u, w, c);
  }
  if (!isFinite(d[idQ])) return null;

  const chain: number[] = [];
  for (let n = idQ; n !== -1; n = prev[n]) chain.push(n);
  chain.reverse();

  // straight across: no road section, the whole leg is drawn as an off-road walk
  if (chain.length <= 2) {
    return { points: [{ x: from.x, z: from.z }, { x: to.x, z: to.z }], roadFrom: 0, roadTo: 0, length: direct, roadName: null };
  }

  const pts: Pt[] = [{ x: from.x, z: from.z }];
  const push = (p: Pt) => {
    if (dist(pts[pts.length - 1], p) > 0.25) { pts.push({ x: p.x, z: p.z }); return true; }
    return false;
  };
  const first = chain[1];
  let roadFrom = 0;
  if (push(ptOf(first))) roadFrom = pts.length - 1;
  for (const n of chain.slice(2, -2)) push(ptOf(n));
  push(ptOf(chain[chain.length - 2]));
  const roadTo = pts.length - 1;
  push(to);

  let length = 0;
  for (let i = 1; i < pts.length; i++) length += dist(pts[i - 1], pts[i]);
  return { points: pts, roadFrom, roadTo, length, roadName: vacc.get(first)?.name ?? (first >= NB ? CG.names[first - NB] : null) };
}

/** The point a walking-direction arrow should aim at: next route point that is not already underfoot */
export function nextRoutePoint(route: Route, from: Pt, minDist = 8): Pt {
  for (let i = 1; i < route.points.length; i++) {
    if (dist(route.points[i], from) > minDist) return route.points[i];
  }
  return route.points[route.points.length - 1];
}

// ------------------------------------------------------------------------------------------------
// View transform shared by minimap and full map
// ------------------------------------------------------------------------------------------------

export interface MapView {
  /** world point shown at the centre of the canvas */
  cx: number;
  cz: number;
  /** pixels per metre */
  scale: number;
  /** clockwise screen rotation in radians. 0 = north (-z) up. Heading-up for camera heading h is h - PI */
  rot: number;
  /** canvas CSS size */
  w: number;
  h: number;
  /** screen position of the (cx, cz) world point; defaults to the canvas centre. The tilted minimap parks the player below centre to show more road ahead. */
  ax?: number;
  ay?: number;
}

export function worldToScreen(v: MapView, x: number, z: number): [number, number] {
  const dx = (x - v.cx) * v.scale;
  const dz = (z - v.cz) * v.scale;
  const c = Math.cos(v.rot);
  const s = Math.sin(v.rot);
  return [(v.ax ?? v.w / 2) + dx * c - dz * s, (v.ay ?? v.h / 2) + dx * s + dz * c];
}

export function screenToWorld(v: MapView, sx: number, sy: number): Pt {
  const dx = sx - (v.ax ?? v.w / 2);
  const dy = sy - (v.ay ?? v.h / 2);
  const c = Math.cos(v.rot);
  const s = Math.sin(v.rot);
  return { x: v.cx + (dx * c + dy * s) / v.scale, z: v.cz + (-dx * s + dy * c) / v.scale };
}

/** screen-space rotation (clockwise) of an arrow that points along world heading `h` (0 = +z) */
export function headingToScreenAngle(v: MapView, h: number): number {
  return Math.PI - h + v.rot;
}
