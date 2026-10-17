/**
 * Dev tool: renders a top-down plan of the road network to a PNG (no browser, no WebGL).
 *   npx tsx scripts/plan-render.ts out.png [cx cz halfSize px]
 * Roads are coloured by class; elevated decks (bridges / flyovers) are drawn with a white casing and a height label,
 * streams are blue, hand-built lots grey. Used to eyeball the layout while designing the city.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { getCurvedNetwork } from '../src/world/CurvedRoads';
import { getWorldLayout } from '../src/world/WorldLayout';
import { LOTS, getLotColliders } from '../src/buildings/lots';
import { getCityBuildings } from '../src/world/CityBuildings';


declare const process: { argv: string[]; exit(code: number): never };
const require = createRequire(import.meta.url);
const sharp = require('/home/claude/.npm-global/lib/node_modules/sharp');

const out = process.argv[2] ?? 'plan.png';
const cx = Number(process.argv[3] ?? 0);
const cz = Number(process.argv[4] ?? 0);
const half = Number(process.argv[5] ?? 930);
const px = Number(process.argv[6] ?? 1800);
const k = px / (half * 2);
const X = (x: number) => ((x - cx + half) * k).toFixed(1);
const Z = (z: number) => ((z - cz + half) * k).toFixed(1);

const net = getCurvedNetwork();
const layout = getWorldLayout();
const COL: Record<string, string> = { freeway: '#e11d48', main: '#f8fafc', secondary: '#cbd5e1', residential: '#94a3b8', rural: '#a3a38a', mountain: '#a3a38a' };
const W: Record<string, number> = { freeway: 20, main: 14, secondary: 9, residential: 8, rural: 7, mountain: 6.5 };

const parts: string[] = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}"><rect width="100%" height="100%" fill="#16321f"/>`);
// world frame
parts.push(`<rect x="${X(-900)}" y="${Z(-900)}" width="${1800 * k}" height="${1800 * k}" fill="none" stroke="#ffffff" stroke-opacity=".25" stroke-width="1"/>`);
// 150 m cell grid
for (let g = -900; g <= 900; g += 150) {
  parts.push(`<line x1="${X(g)}" y1="${Z(-900)}" x2="${X(g)}" y2="${Z(900)}" stroke="#fff" stroke-opacity=".07"/>`);
  parts.push(`<line x1="${X(-900)}" y1="${Z(g)}" x2="${X(900)}" y2="${Z(g)}" stroke="#fff" stroke-opacity=".07"/>`);
}
// streams
for (const s of net.streams) parts.push(`<polyline fill="none" stroke="#2f7fb5" stroke-linecap="round" stroke-linejoin="round" stroke-width="${(s.halfWidth * 2 * k).toFixed(1)}" points="${s.pts.map((p) => `${X(p[0])},${Z(p[1])}`).join(' ')}"/>`);
// grid roads that still exist
const grid = (l: { pos: number; width: number; cls: string }, vert: boolean) => {
  const [a, b] = [-105, 105];
  const c = COL[l.cls] ?? '#fff';
  parts.push(vert
    ? `<line x1="${X(l.pos)}" y1="${Z(a)}" x2="${X(l.pos)}" y2="${Z(b)}" stroke="${c}" stroke-width="${(l.width * k).toFixed(1)}"/>`
    : `<line x1="${X(a)}" y1="${Z(l.pos)}" x2="${X(b)}" y2="${Z(l.pos)}" stroke="${c}" stroke-width="${(l.width * k).toFixed(1)}"/>`);
};
for (const l of layout.vLines) if (Math.abs(l.pos) <= 60) grid({ ...l }, true);
for (const l of layout.hLines) if (Math.abs(l.pos) <= 60) grid({ ...l }, false);
// curved roads
const order = ['mountain', 'rural', 'residential', 'secondary', 'main', 'freeway'];
for (const cls of order) {
  for (const r of net.roads) {
    if (r.cls !== cls) continue;
    const w = ((W[cls] ?? 8) * k).toFixed(1);
    parts.push(`<polyline fill="none" stroke="${COL[cls] ?? '#fff'}" stroke-linejoin="round" stroke-width="${w}" points="${r.pts.map((p) => `${X(p.x)},${Z(p.z)}`).join(' ')}"/>`);
    // elevated stretches
    let i = 0;
    while (i < r.pts.length) {
      if (!r.pts[i].bridge) { i++; continue; }
      let j = i;
      while (j + 1 < r.pts.length && r.pts[j + 1].bridge) j++;
      parts.push(`<polyline fill="none" stroke="#fbbf24" stroke-opacity=".9" stroke-width="${Math.max(2, (W[cls] ?? 8) * k * 0.5).toFixed(1)}" points="${r.pts.slice(i, j + 1).map((p) => `${X(p.x)},${Z(p.z)}`).join(' ')}"/>`);
      i = j + 1;
    }
  }
}
for (const r of net.roads) {
  const m = r.pts[Math.floor(r.pts.length / 2)];
  parts.push(`<text x="${X(m.x)}" y="${Z(m.z)}" font-size="${Math.max(7, 9 * k * 1.6)}" fill="#fde68a" stroke="#000" stroke-width="0.4" font-family="monospace">${r.id.replace('cr_', '')}</text>`);
}
// buildings + district plots
if (process.argv.includes('--bld')) {
  const cb = getCityBuildings();
  const ZC = ['#f59e0b', '#38bdf8', '#f472b6'];
  for (const b of cb.buildings) {
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const hw = b.d / 2, hd = b.w / 2;
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => `${X(b.x + sx * hw * c + sz * hd * s)},${Z(b.z - sx * hw * s + sz * hd * c)}`).join(' ');
    parts.push(`<polygon points="${pts}" fill="${ZC[b.zone]}" fill-opacity=".85" stroke="#000" stroke-width=".4"/>`);
  }
  for (const d of cb.districts) {
    const c = Math.cos(d.rot), s = Math.sin(d.rot);
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => `${X(d.cx + sx * d.W / 2 * c + sz * d.D / 2 * s)},${Z(d.cz - sx * d.W / 2 * s + sz * d.D / 2 * c)}`).join(' ');
    parts.push(`<polygon points="${pts}" fill="#22c55e" fill-opacity=".35" stroke="#bbf7d0" stroke-width="1.2"/>`);
    for (const b of d.buildings) {
      const c2 = Math.cos(b.rot), s2 = Math.sin(b.rot);
      const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => `${X(b.x + sx * b.w / 2 * c2 + sz * b.d / 2 * s2)},${Z(b.z - sx * b.w / 2 * s2 + sz * b.d / 2 * c2)}`).join(' ');
      parts.push(`<polygon points="${q}" fill="#fef9c3" stroke="#000" stroke-width=".3"/>`);
    }
  }
}
// lots
for (const l of LOTS) for (const c of getLotColliders(l)) parts.push(`<rect x="${X(c.rect.minX)}" y="${Z(c.rect.minZ)}" width="${((c.rect.maxX - c.rect.minX) * k).toFixed(1)}" height="${((c.rect.maxZ - c.rect.minZ) * k).toFixed(1)}" fill="#a78bfa"/>`);
// core
parts.push(`<rect x="${X(-105)}" y="${Z(-105)}" width="${(210 * k).toFixed(1)}" height="${(210 * k).toFixed(1)}" fill="none" stroke="#f472b6" stroke-dasharray="6 4"/>`);
parts.push('</svg>');
sharp(Buffer.from(parts.join('\n'))).png().toFile(out).then(() => console.log('wrote', out));
