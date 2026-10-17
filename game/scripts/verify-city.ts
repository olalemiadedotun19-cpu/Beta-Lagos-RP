/**
 * Headless checks of the curved city network (no browser / WebGL needed):  npx tsx scripts/verify-city.ts
 *  - every crossing of two roads is grade separated with real clearance (flyover / underpass), junction ends excepted
 *  - unrelated roads keep a minimum gap, radii and grades are sane
 *  - the walking height (groundHeightAt) matches the road surface along every road
 *  - the kerbed ring round every dead-end turning circle can be stood on (it used to be drawn 16 cm high but walked on at terrain height)
 *  - the terrain meets the corner chunks at height 0
 */
import { getCurvedNetwork, groundHeightAt, baseHeight, terrainHeight, CHUNK_Z_BORDER, PAVEMENT_H, TURN_APRON, TURN_PAVING, type CurvedRoad } from '../src/world/CurvedRoads';
import { circumRadius } from '../src/world/RoadMath';

declare const process: { exit(code: number): never };
const net = getCurvedNetwork();
let fails = 0;
let warns = 0;
const fail = (m: string) => { fails++; console.log('FAIL ', m); };
const warn = (m: string) => { warns++; console.log('warn ', m); };

const len = (r: CurvedRoad) => r.pts[r.pts.length - 1].s;
const cities = net.roads.filter((r) => r.id.startsWith('cy_') || r.id.startsWith('cg_'));
console.log(`${net.roads.length} roads (${cities.length} city), ${(net.roads.reduce((a, r) => a + len(r), 0) / 1000).toFixed(1)} km, ${net.bridges.length} decks, ${net.junctions.length} junctions`);

// ---- per road: radius, grade, bounds ----
const MINR: Record<string, number> = { freeway: 60, main: 28, secondary: 14, residential: 10, rural: 9, mountain: 7 };
for (const r of cities) {
  let minR = Infinity;
  let at = '';
  for (let i = 2; i < r.pts.length - 2; i += 2) {
    const a = r.pts[i - 2], p = r.pts[i], c = r.pts[i + 2];
    const R = circumRadius(a.x, a.z, p.x, p.z, c.x, c.z);
    if (R < minR) { minR = R; at = `${p.x.toFixed(0)},${p.z.toFixed(0)}`; }
  }
  const need = r.tag === 'hill' ? 8 : MINR[r.cls]; // a hillside road may use tight bends like the chunk's mountain road
  if (minR < need * 0.9) fail(`${r.id} (${r.cls}) min radius ${minR.toFixed(1)} m at ${at} (< ${need})`);
  let g = 0;
  for (let i = 1; i < r.pts.length; i++) g = Math.max(g, Math.abs(r.pts[i].y - r.pts[i - 1].y) / (r.pts[i].s - r.pts[i - 1].s));
  if (g > r.maxGrade + 0.012) fail(`${r.id} grade ${(g * 100).toFixed(1)} % > ${(r.maxGrade * 100).toFixed(0)} %`);
  for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) if (Math.abs(p.x) > 905 || Math.abs(p.z) > 905) fail(`${r.id} leaves the world`);
}

// ---- crossings + proximity between unrelated roads ----
const C = 20;
const cell = new Map<string, { r: CurvedRoad; i: number }[]>();
for (const r of net.roads) for (let i = 0; i < r.pts.length - 1; i++) {
  const a = r.pts[i], b = r.pts[i + 1];
  for (let cx = Math.floor(Math.min(a.x, b.x) / C); cx <= Math.floor(Math.max(a.x, b.x) / C); cx++)
    for (let cz = Math.floor(Math.min(a.z, b.z) / C); cz <= Math.floor(Math.max(a.z, b.z) / C); cz++) {
      const k = `${cx},${cz}`; const l = cell.get(k); if (l) l.push({ r, i }); else cell.set(k, [{ r, i }]);
    }
}
const related = new Set<string>();
for (const j of net.junctions) { related.add(`${j.roadId}|${j.hostId}`); related.add(`${j.hostId}|${j.roadId}`); }
const endTouch0 = (a: CurvedRoad, b: CurvedRoad): boolean => {
  for (const p of [a.pts[0], a.pts[a.pts.length - 1]]) for (const q of [b.pts[0], b.pts[b.pts.length - 1]]) if (Math.hypot(p.x - q.x, p.z - q.z) < 3) return true;
  return false;
};
const endTouch = (a: CurvedRoad, b: CurvedRoad): boolean => {
  if (endTouch0(a, b)) return true;
  // chained through a short stub road (the corner chunks' 9 m link stubs)
  return net.roads.some((m) => m !== a && m !== b && m.pts[m.pts.length - 1].s < 30 && (related.has(`${m.id}|${a.id}`) || endTouch0(m, a)) && (related.has(`${m.id}|${b.id}`) || endTouch0(m, b)));
};
const checked = new Set<string>();
const near = new Map<string, number>();
const cross = new Map<string, number>();
for (const list of cell.values()) {
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    const A = list[a], B = list[b];
    if (A.r === B.r) continue;
    const key = A.r.id < B.r.id ? `${A.r.id}|${B.r.id}` : `${B.r.id}|${A.r.id}`;
    const pa = A.r.pts[A.i], pb = A.r.pts[A.i + 1], qa = B.r.pts[B.i], qb = B.r.pts[B.i + 1];
    const k2 = `${key}#${A.r.id < B.r.id ? A.i : B.i}#${A.r.id < B.r.id ? B.i : A.i}`;
    if (checked.has(k2)) continue; checked.add(k2);
    // segment-segment distance (planar) + crossing test
    const d1x = pb.x - pa.x, d1z = pb.z - pa.z, d2x = qb.x - qa.x, d2z = qb.z - qa.z;
    const den = d1x * d2z - d1z * d2x;
    let crossing = false;
    if (Math.abs(den) > 1e-9) {
      const t = ((qa.x - pa.x) * d2z - (qa.z - pa.z) * d2x) / den;
      const u = ((qa.x - pa.x) * d1z - (qa.z - pa.z) * d1x) / den;
      crossing = t >= 0 && t <= 1 && u >= 0 && u <= 1;
      if (crossing) {
        const yA = pa.y + (pb.y - pa.y) * t, yB = qa.y + (qb.y - qa.y) * u;
        const dy = Math.abs(yA - yB);
        const prev = cross.get(key);
        if (prev === undefined || dy < prev) cross.set(key, dy);
      }
    }
    // distance between the closest points of the two segments
    const dd = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
      const dx = bx - ax, dz = bz - az; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(px - ax - dx * t, pz - az - dz * t);
    };
    const dist = Math.min(dd(pa.x, pa.z, qa.x, qa.z, qb.x, qb.z), dd(pb.x, pb.z, qa.x, qa.z, qb.x, qb.z), dd(qa.x, qa.z, pa.x, pa.z, pb.x, pb.z), dd(qb.x, qb.z, pa.x, pa.z, pb.x, pb.z));
    if (!crossing && dist < A.r.hw + B.r.hw + 5) {
      const dy = Math.abs((pa.y + pb.y) / 2 - (qa.y + qb.y) / 2);
      if (related.has(key) || endTouch(A.r, B.r)) continue;
      if (dy > 4.5) continue; // one passes well over the other
      const prev = near.get(key);
      if (prev === undefined || dist < prev) near.set(key, dist);
    }
  }
}
for (const [key, dy] of cross) {
  const [a, b] = key.split('|').map((id) => net.byId.get(id)!);
  if (endTouch(a, b) && dy < 1) continue;
  if (related.has(key) && dy < 1) continue;
  // flyover / underpass: the upper deck's underside (deck drop 0.8) must clear the lower road by >= 4.4 m
  if (dy < 5.2) fail(`${key} cross at only ${dy.toFixed(2)} m vertical separation`);
}
for (const [key, d] of near) fail(`${key} run ${d.toFixed(1)} m apart (road edges would touch)`);
console.log(`${cross.size} road pairs cross (all grade-separated or joined)`);

// ---- walking height along every city road ----
let walkBad = 0;
for (const r of cities) {
  for (let i = 2; i < r.pts.length - 2; i += 3) {
    const p = r.pts[i];
    const g = groundHeightAt(p.x, p.z, p.y + 1.7);
    if (Math.abs(g - (p.y + 0.01)) > 0.3) { walkBad++; if (walkBad <= 8) warn(`${r.id} @${p.x.toFixed(0)},${p.z.toFixed(0)}: walking height ${g.toFixed(2)} vs road ${(p.y + 0.01).toFixed(2)}`); }
  }
}
if (walkBad) fail(`${walkBad} road samples are not walkable at road height`);

// ---- dead-end turning circles: the kerbed paving ring is walkable at kerb height ----
let ringBad = 0;
let ringN = 0;
for (const r of net.roads.filter((q) => q.cul)) {
  const e = r.pts[r.pts.length - 1];
  const d = r.hw + TURN_APRON + TURN_PAVING / 2;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    ringN++;
    if (groundHeightAt(e.x + Math.cos(a) * d, e.z + Math.sin(a) * d) < e.y + PAVEMENT_H - 0.011) ringBad++;
  }
}
if (ringBad) fail(`${ringBad} of ${ringN} turning-circle ring samples are below the kerb top`);

// ---- terrain meets the corner chunks at height 0 ----
for (let t = 0; t <= 450; t += 15) {
  for (const [x, z] of [[450 - 0.01, -450 - t], [-450 + 0.01, -450 - t], [450 + t, CHUNK_Z_BORDER + 0.01], [-450 - t, CHUNK_Z_BORDER + 0.01]]) {
    const h = baseHeight(x, z);
    if (Math.abs(h) > 0.05) fail(`base terrain at the corner border (${x.toFixed(0)}, ${z.toFixed(0)}) = ${h.toFixed(2)} (must be 0)`);
  }
}
// ---- flat plain: the downtown edge must be at 0 ----
for (let a = -105; a <= 105; a += 21) for (const [x, z] of [[a, 106], [a, -106], [106, a], [-106, a]]) if (Math.abs(terrainHeight(x, z)) > 0.4) warn(`terrain next to the downtown at (${x},${z}) = ${terrainHeight(x, z).toFixed(2)}`);

console.log(`\n${fails} failures, ${warns} warnings`);
process.exit(fails ? 1 : 0);
