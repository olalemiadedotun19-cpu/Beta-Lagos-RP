/**
 * Headless sanity checks for the curved-road chunks (pure data: no browser, no WebGL).
 *
 *   npx tsx scripts/verify-curved-roads.ts
 *
 * Checks every curved road of every chunk: grade limits, curve radii, road-vs-road and road-vs-water crossings,
 * border entries / exits (on the old grid centreline, y = 0), the bridge list, world bounds, cut / fill depth.
 * FAIL lines make the process exit with code 1; WARN lines are things worth a look.
 */
import { getCurvedNetwork, baseHeight, terrainHeight, groundHeightAt, inChunk, CHUNKS, CHUNK_Z_BORDER, type CurvedRoad } from '../src/world/CurvedRoads';
import { getWorldLayout } from '../src/world/WorldLayout';

declare const process: { exit(code: number): never };

const net = getCurvedNetwork();
// this script checks the two corner chunks (their roads are the 'cr_' ones); the city is checked by verify-city.ts
const CHUNK_ROADS = net.roads.filter((r) => r.id.startsWith('cr_'));
const CHUNK_JUNCTIONS = net.junctions.filter((j) => j.roadId.startsWith('cr_') && j.hostId.startsWith('cr_'));
const CHUNK_BRIDGES = net.bridges.filter((b) => b.roadId.startsWith('cr_'));
const layout = getWorldLayout();
let fails = 0;
let warns = 0;
const fail = (m: string) => { fails++; console.log(`  FAIL  ${m}`); };
const warn = (m: string) => { warns++; console.log(`  warn  ${m}`); };

/** smallest sensible centreline radius per class (m); the mountain road has real hairpins */
const MIN_RADIUS: Record<string, number> = { main: 18, secondary: 10, residential: 9, rural: 9, mountain: 5.5 };
const LIMIT = 895; // grid roads are laid out to +-895

const circ = (a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }): number => {
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
  return area2 < 1e-9 ? Infinity : (ab * bc * ca) / (2 * area2);
};

const segDist = (p: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }): number => {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
};

const gridLine = (id: string) => [...layout.vLines, ...layout.hLines].find((l) => l.id === id);

console.log(`${CHUNK_ROADS.length} curved roads, ${CHUNK_BRIDGES.length} bridges, ${CHUNK_JUNCTIONS.length} junctions, ${net.streams.length} water courses`);

for (const r of CHUNK_ROADS) {
  const chunk = r.pts[0].x > 0 || (r.entry && r.entry.x > 0) ? 'NE' : 'NW';
  console.log(`\n${r.id} ${r.name} [${r.cls}, ${r.width} m, ${chunk}]`);
  const n = r.pts.length;
  const len = r.pts[n - 1].s;

  // NaN / bounds
  if (r.pts.some((p) => !Number.isFinite(p.x + p.z + p.y))) fail('NaN in the centreline');
  if (r.pts.some((p) => Math.abs(p.x) > LIMIT || p.z < -LIMIT)) fail('leaves the +-895 m world');

  // grade
  let worst = 0;
  for (let i = 1; i < n; i++) worst = Math.max(worst, Math.abs(r.pts[i].y - r.pts[i - 1].y) / (r.pts[i].s - r.pts[i - 1].s));
  if (worst > r.maxGrade + 0.002) fail(`grade ${(worst * 100).toFixed(1)} % > ${(r.maxGrade * 100).toFixed(0)} %`);

  // radius (points 2 samples apart = 5 m chords)
  let rmin = Infinity;
  for (let i = 2; i < n - 2; i++) rmin = Math.min(rmin, circ(r.pts[i - 2], r.pts[i], r.pts[i + 2]));
  if (rmin < MIN_RADIUS[r.cls]) fail(`min radius ${rmin.toFixed(1)} m < ${MIN_RADIUS[r.cls]} m`);

  // cut / fill: how far the road surface is from the undisturbed terrain
  let cut = 0;
  let fill = 0;
  for (const p of r.pts) {
    if (p.bridge) continue;
    const d = p.y - baseHeight(p.x, p.z);
    fill = Math.max(fill, d);
    cut = Math.max(cut, -d);
  }
  if (Math.max(cut, fill) > 9) warn(`earthworks: cut ${cut.toFixed(1)} m / fill ${fill.toFixed(1)} m`);

  // water: any non-bridge sample inside a water course?
  for (const S of net.streams) {
    let bad = 0;
    r.pts.forEach((p, i) => {
      if (p.bridge) return;
      let d = Infinity;
      for (let k = 0; k < S.pts.length - 1; k++) d = Math.min(d, segDist(p, { x: S.pts[k][0], z: S.pts[k][1] }, { x: S.pts[k + 1][0], z: S.pts[k + 1][1] }));
      if (d < S.halfWidth + 1.2) bad++;
    });
    if (bad) fail(`${bad} samples in / beside the water without a bridge deck`);
  }

  // border entry / exit
  const checkEnd = (kind: string, e: { lineId: string; axis: 'h' | 'v'; x: number; z: number }, p: { x: number; z: number; y: number }) => {
    const line = gridLine(e.lineId);
    // the straight grid outside the downtown is gone: a corner entry now continues as a city road that starts on the same point
    if (!line) {
      if (Math.abs(p.y) > 1e-6) fail(`${kind}: y = ${p.y.toFixed(3)} (must be 0 at the border)`);
      const mate = net.roads.some((o) => !o.id.startsWith('cr_') && [o.pts[0], o.pts[o.pts.length - 1]].some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1.5));
      if (!mate) console.log(`  note  ${kind} at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) has no city road yet`);
      return;
    }
    const off = e.axis === 'h' ? Math.abs(p.z - line.pos) : Math.abs(p.x - line.pos);
    if (off > 0.1) fail(`${kind}: ${off.toFixed(2)} m off the ${line.name} centreline`);
    if (Math.abs(p.y) > 1e-6) fail(`${kind}: y = ${p.y.toFixed(3)} (must be 0 at the border)`);
    if (line.width !== r.width) warn(`${kind}: ${r.width} m road continues a ${line.width} m grid road`);
    const onBorder = e.axis === 'h' ? CHUNKS.some((c) => Math.abs(p.x - c.minX) < 0.01 || Math.abs(p.x - c.maxX) < 0.01) : Math.abs(p.z - CHUNK_Z_BORDER) < 0.01;
    if (!onBorder) fail(`${kind}: not on a chunk border`);
  };
  if (r.entry) checkEnd('entry', r.entry, r.pts[0]);
  if (r.exit) checkEnd('exit', r.exit, r.pts[n - 1]);

  console.log(`  ${len.toFixed(0)} m, y ${Math.min(...r.pts.map((p) => p.y)).toFixed(1)}..${Math.max(...r.pts.map((p) => p.y)).toFixed(1)}, max grade ${(worst * 100).toFixed(1)} %, min radius ${rmin.toFixed(0)} m, cut ${cut.toFixed(1)} / fill ${fill.toFixed(1)} m`);
}

// road vs road: centrelines must not come closer than the road halves + a gap, except at a junction
console.log('\nroad vs road');
const nearJunction = (a: CurvedRoad, ia: number, b: CurvedRoad): boolean =>
  CHUNK_JUNCTIONS.some((j) => {
    const side = j.roadId === a.id ? a : j.roadId === b.id ? b : null;
    const host = j.hostId === a.id ? a : j.hostId === b.id ? b : null;
    if (!side || !host || side === host) return false;
    const hp = host.pts[j.hostIdx];
    const pa = a.pts[ia];
    return Math.hypot(pa.x - hp.x, pa.z - hp.z) < 40;
  });
for (let ai = 0; ai < CHUNK_ROADS.length; ai++) {
  for (let bi = ai + 1; bi < CHUNK_ROADS.length; bi++) {
    const a = CHUNK_ROADS[ai];
    const b = CHUNK_ROADS[bi];
    let min = Infinity;
    let at = '';
    for (let i = 0; i < a.pts.length; i++) {
      if (nearJunction(a, i, b)) continue;
      for (let k = 0; k < b.pts.length - 1; k++) {
        const d = segDist(a.pts[i], b.pts[k], b.pts[k + 1]);
        if (d < min) { min = d; at = `(${a.pts[i].x.toFixed(0)}, ${a.pts[i].z.toFixed(0)})`; }
      }
    }
    // roads that merely run side by side on a bridge-free stretch need the full gap; 3 m of air between the asphalt edges
    const need = a.hw + b.hw + 3;
    if (min < need) fail(`${a.id} / ${b.id} come within ${min.toFixed(1)} m of each other at ${at} (need ${need.toFixed(1)} m)`);
  }
}

// junctions: the side road ends on the host's edge
console.log('\njunctions');
for (const j of CHUNK_JUNCTIONS) {
  const side = net.byId.get(j.roadId)!;
  const host = net.byId.get(j.hostId)!;
  const hp = host.pts[j.hostIdx];
  const e0 = side.pts[0];
  const e1 = side.pts[side.pts.length - 1];
  const end = Math.hypot(e0.x - hp.x, e0.z - hp.z) < Math.hypot(e1.x - hp.x, e1.z - hp.z) ? e0 : e1;
  const gap = Math.hypot(end.x - hp.x, end.z - hp.z) - host.hw;
  if (Math.abs(gap) > 0.2) fail(`${side.id} -> ${host.id}: ends ${gap.toFixed(2)} m from the host's edge`);
  if (Math.abs(end.y - hp.y) > 0.5) warn(`${side.id} -> ${host.id}: ${Math.abs(end.y - hp.y).toFixed(2)} m height step at the mouth`);
}
console.log(`  ${CHUNK_JUNCTIONS.length} T-junctions checked`);

// ground height sanity: every road sample is walkable at its own height
console.log('\nground height');
let bad = 0;
for (const r of CHUNK_ROADS) {
  for (const p of r.pts) {
    if (!inChunk(p.x, p.z)) continue;
    const g = groundHeightAt(p.x, p.z, p.y);
    if (Math.abs(g - (p.y + 0.01)) > 0.25 && !p.bridge && g < p.y - 0.25) bad++;
  }
}
if (bad) fail(`${bad} road samples sit above where a walker would stand`);
else console.log('  all road samples are walkable');
void terrainHeight;

console.log(`\n${fails} failures, ${warns} warnings`);
process.exit(fails ? 1 : 0);
