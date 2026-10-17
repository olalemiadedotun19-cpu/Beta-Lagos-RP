/**
 * Headless checks of the district plots and the planned buildings:  npx tsx scripts/verify-districts.ts
 *  - every district building / lane / pond lies inside its oriented plot, and none overlap
 *  - no plot touches a road, the river, a landmark lot or another plot
 *  - no planned building overlaps a road edge, the river, a lot, a plot or another building
 */
import { getCityBuildings } from '../src/world/CityBuildings';
import { roadEdgeDistance, waterGap } from '../src/world/CurvedRoads';
import { inDistrict, obbCorners, obbOverlap } from '../src/world/CityDistricts';
import { cityNoGo } from '../src/world/CityPlan';
import { isReserved } from '../src/buildings/lots';

declare const process: { exit(code: number): never };
const cb = getCityBuildings();
let fails = 0;
const fail = (m: string) => { fails++; console.log('FAIL ', m); };
console.log(`${cb.buildings.length} planned buildings, ${cb.districts.length} districts:`, cb.districts.map((d) => d.style).join(', '));

for (const d of cb.districts) {
  const tag = `${d.name} #${d.i}`;
  d.buildings.forEach((b, k) => {
    for (const c of obbCorners({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, rot: b.rot })) if (!inDistrict(d, c[0], c[1], 0.5)) { fail(`${tag}: building ${k} sticks out of its plot`); break; }
    for (let m = k + 1; m < d.buildings.length; m++) {
      const o = d.buildings[m];
      if (obbOverlap({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, rot: b.rot }, { x: o.x, z: o.z, hw: o.w / 2, hd: o.d / 2, rot: o.rot }, 0)) fail(`${tag}: buildings ${k} and ${m} overlap`);
    }
  });
  // plot clearance: sample the perimeter
  const c = Math.cos(d.rot), s = Math.sin(d.rot);
  for (let u = -d.W / 2; u <= d.W / 2; u += 8) for (const v of [-d.D / 2, d.D / 2]) {
    const x = d.cx + u * c + v * s, z = d.cz - u * s + v * c;
    if (roadEdgeDistance(x, z) < 1.8) fail(`${tag}: plot edge touches a road at (${x.toFixed(0)}, ${z.toFixed(0)})`);
    if (waterGap(x, z) < 20) fail(`${tag}: plot edge in the river`);
    if (isReserved(x, z, 0)) fail(`${tag}: plot edge inside a landmark lot`);
  }
  for (const o of cb.districts) if (o !== d && Math.hypot(o.cx - d.cx, o.cz - d.cz) < (d.W + o.W) / 2 * 0.9 && obbOverlap({ x: d.cx, z: d.cz, hw: d.W / 2, hd: d.D / 2, rot: d.rot }, { x: o.cx, z: o.cz, hw: o.W / 2, hd: o.D / 2, rot: o.rot }, 0)) fail(`${tag} overlaps ${o.name} #${o.i}`);
}

// planned buildings
const plots = cb.districts.map((d) => ({ x: d.cx, z: d.cz, hw: d.W / 2, hd: d.D / 2, rot: d.rot }));
let roadTouch = 0, overlap = 0, water = 0, lot = 0, inPlot = 0, nogo = 0;
const obbs = cb.buildings.map((b) => ({ x: b.x, z: b.z, hw: b.d / 2, hd: b.w / 2, rot: b.rot }));
obbs.forEach((o, i) => {
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]] as const) {
    const x = o.x + sx * o.hw * c + sz * o.hd * s, z = o.z - sx * o.hw * s + sz * o.hd * c;
    if (roadEdgeDistance(x, z) < 1.5) { roadTouch++; break; }
    if (waterGap(x, z) < 10) { water++; break; }
    if (isReserved(x, z, 0)) { lot++; break; }
    if (cityNoGo(x, z, -3)) { nogo++; break; }
  }
  for (const p of plots) if (Math.hypot(p.x - o.x, p.z - o.z) < 100 && obbOverlap(o, p, 0)) { inPlot++; break; }
  for (let j = i + 1; j < obbs.length; j++) {
    const q = obbs[j];
    if (Math.abs(q.x - o.x) > 30 || Math.abs(q.z - o.z) > 30) continue;
    if (obbOverlap(o, q, 0)) { overlap++; break; }
  }
});
console.log(`buildings: ${roadTouch} touch a road, ${overlap} overlap another, ${water} in/near water, ${lot} in a lot, ${nogo} in no-go ground, ${inPlot} inside a district plot`);
fails += roadTouch + overlap + water + lot + nogo + inPlot;
console.log(`\n${fails} failures`);
process.exit(fails ? 1 : 0);
