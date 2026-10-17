/**
 * Dev tool: shaded-relief picture of the real terrain function (hills, river, road beds, embankments) + deck heights.
 *   npx tsx scripts/relief-render.ts out.png [cx cz half px]
 */
import { createRequire } from 'node:module';
import { getCurvedNetwork, terrainInfo } from '../src/world/CurvedRoads';
declare const process: { argv: string[] };
const require = createRequire(import.meta.url);
const sharp = require('/home/claude/.npm-global/lib/node_modules/sharp');
const out = process.argv[2] ?? 'relief.png';
const cx = Number(process.argv[3] ?? 0), cz = Number(process.argv[4] ?? 0), half = Number(process.argv[5] ?? 930), px = Number(process.argv[6] ?? 900);
const k = (half * 2) / px;
const H = new Float32Array(px * px), W = new Float32Array(px * px), R = new Float32Array(px * px);
for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
  const t = terrainInfo(cx - half + i * k, cz - half + j * k);
  H[j * px + i] = t.h; W[j * px + i] = t.wet; R[j * px + i] = t.road;
}
const rgb = Buffer.alloc(px * px * 3);
for (let j = 1; j < px - 1; j++) for (let i = 1; i < px - 1; i++) {
  const dx = (H[j * px + i + 1] - H[j * px + i - 1]) / (2 * k), dz = (H[(j + 1) * px + i] - H[(j - 1) * px + i]) / (2 * k);
  const shade = Math.max(0.25, Math.min(1.4, 0.8 + (-dx * 0.7 - dz * 0.7) * 2.4));
  const h = H[j * px + i];
  let r = 70 + h * 4, g = 120 + h * 2.2, b = 60 + h * 1.2;
  if (h < -0.3) { r = 40; g = 90 + h * 8; b = 140; }
  if (R[j * px + i] > 0.4) { r = 120; g = 112; b = 96; }
  const o = (j * px + i) * 3;
  rgb[o] = Math.min(255, r * shade); rgb[o + 1] = Math.min(255, g * shade); rgb[o + 2] = Math.min(255, b * shade);
}
// decks: colour by height above ground
const net = getCurvedNetwork();
for (const r of net.roads) for (const p of r.pts) {
  if (!p.bridge) continue;
  const i = Math.round((p.x - (cx - half)) / k), j = Math.round((p.z - (cz - half)) / k);
  if (i < 0 || j < 0 || i >= px || j >= px) continue;
  const o = (j * px + i) * 3;
  const t = Math.min(1, Math.max(0, p.lift / 9));
  rgb[o] = 255; rgb[o + 1] = 230 - 160 * t; rgb[o + 2] = 40;
}
sharp(rgb, { raw: { width: px, height: px, channels: 3 } }).png().toFile(out).then(() => console.log('wrote', out));
