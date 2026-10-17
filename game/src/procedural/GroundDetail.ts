import { bakedData } from '../cache/BakeCache';
/**
 * Tileable ground detail maps (pure typed-array code, no THREE / DOM, so it can also run headless).
 *
 * Every map is RGBA8:
 *   R  albedo multiplier, average ~0.5   (the shader doubles it, so 0.5 = "no change")
 *   G  height 0..1                       (the shader turns it into per-pixel bump lighting)
 *   B  grass: per-blade "dry / yellow" mask,  rock + dirt: unused (0.5)
 *   A  255
 *
 * Why this replaces the old canvas strokes: the old maps were a flat grey with a few hundred thin lines, no height at all, so
 * the sun could not light the micro-relief and the ground read as a flat painted colour (the "cartoon" look). These maps are
 * built the way a real lawn / rubble field is built: layered, overlapping, each layer shadowing the one below it.
 */

export interface DetailMap {
  size: number;
  data: Uint8Array;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const wrapI = (v: number, S: number): number => ((v % S) + S) % S;

/** tileable value noise, `cells` lattice cells across the map, smooth interpolation, 0..1 */
function valueNoise(S: number, cells: number, rnd: () => number): Float32Array {
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    const fy = (y / S) * cells;
    const iy = Math.floor(fy);
    let ty = fy - iy;
    ty = ty * ty * (3 - 2 * ty);
    const y0 = (iy % cells) * cells;
    const y1 = ((iy + 1) % cells) * cells;
    for (let x = 0; x < S; x++) {
      const fx = (x / S) * cells;
      const ix = Math.floor(fx);
      let tx = fx - ix;
      tx = tx * tx * (3 - 2 * tx);
      const x0 = ix % cells;
      const x1 = (ix + 1) % cells;
      const a = lat[y0 + x0] + (lat[y0 + x1] - lat[y0 + x0]) * tx;
      const b = lat[y1 + x0] + (lat[y1 + x1] - lat[y1 + x0]) * tx;
      out[y * S + x] = a + (b - a) * ty;
    }
  }
  return out;
}

/** fractal sum of tileable value noise, normalised to 0..1 */
function fbm(S: number, baseCells: number, octaves: number, rnd: () => number): Float32Array {
  const out = new Float32Array(S * S);
  let amp = 1;
  let tot = 0;
  let cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(S, cells, rnd);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    tot += amp;
    amp *= 0.5;
    cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

function pack(S: number, alb: Float32Array, hgt: Float32Array, third: Float32Array | null): DetailMap {
  // albedo: re-centre on 0.5 so that (tex * 2) averages 1
  let mean = 0;
  for (let i = 0; i < alb.length; i++) mean += alb[i];
  mean /= alb.length;
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let i = 0; i < hgt.length; i++) {
    if (hgt[i] < hMin) hMin = hgt[i];
    if (hgt[i] > hMax) hMax = hgt[i];
  }
  const hs = 1 / Math.max(1e-6, hMax - hMin);
  const data = new Uint8Array(S * S * 4);
  const k = 0.5 / Math.max(1e-6, mean);
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = Math.round(Math.min(1, Math.max(0, alb[i] * k)) * 255);
    data[i * 4 + 1] = Math.round((hgt[i] - hMin) * hs * 255);
    data[i * 4 + 2] = third ? Math.round(Math.min(1, Math.max(0, third[i])) * 255) : 128;
    data[i * 4 + 3] = 255;
  }
  return { size: S, data };
}

// ---------------------------------------------------------------------------------------------
// grass: three layers of curved, tapering blades (undergrowth / mid / tips), each one occluding the last
// ---------------------------------------------------------------------------------------------

function buildGrassDetailRaw(S = 512, seed = 20261013): DetailMap {
  const rnd = mulberry(seed);
  const R = (a: number, b: number) => a + rnd() * (b - a);
  const alb = new Float32Array(S * S);
  const hgt = new Float32Array(S * S);
  const dry = new Float32Array(S * S);

  // thatch / soil underlayer (what you see between the blades): dark, mottled
  const under = fbm(S, 8, 4, rnd);
  const clump = fbm(S, 9, 3, rnd); // tuft height: some patches of lawn stand taller than others
  for (let i = 0; i < S * S; i++) {
    alb[i] = 0.1 + 0.16 * under[i];
    hgt[i] = 0.03 * under[i];
  }

  const splat = (px: number, py: number, rad: number, br: number, h: number, dr: number): void => {
    const r = Math.ceil(rad);
    const cx = Math.round(px);
    const cy = Math.round(py);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const fx = cx + dx - px;
        const fy = cy + dy - py;
        const d2 = (fx * fx + fy * fy) / (rad * rad);
        if (d2 > 1) continue;
        const idx = wrapI(cy + dy, S) * S + wrapI(cx + dx, S);
        const hh = h * (1 - 0.38 * d2); // round cross-section: edges of a blade sit lower than its spine
        if (hh < hgt[idx] - 0.015) continue; // hidden under a taller blade
        const w = 1 - d2 * 0.55;
        alb[idx] += (br - alb[idx]) * w;
        dry[idx] += (dr - dry[idx]) * w;
        if (hh > hgt[idx]) hgt[idx] = hh;
      }
    }
  };

  const layers = [
    { n: 6500, len: [5, 11], v: [0.2, 0.46], h: 0.16, w: [0.9, 1.3] }, // undergrowth, in shadow
    { n: 9500, len: [7, 15], v: [0.42, 0.8], h: 0.4, w: [0.8, 1.25] }, // body of the lawn
    { n: 7500, len: [9, 20], v: [0.72, 1.25], h: 0.68, w: [0.7, 1.1] }, // sunlit blade tips on top
  ];
  for (const L of layers) {
    for (let b = 0; b < L.n; b++) {
      const x = R(0, S);
      const y = R(0, S);
      const len = R(L.len[0], L.len[1]);
      let a = R(0, 6.2832);
      const curl = R(-0.1, 0.1);
      const w0 = R(L.w[0], L.w[1]);
      const v0 = R(L.v[0], L.v[1]);
      const isDry = rnd() < 0.11;
      const dr = isDry ? R(0.55, 1) : R(0, 0.12);
      const ci = wrapI(Math.round(y), S) * S + wrapI(Math.round(x), S);
      const hb = L.h * (0.62 + clump[ci] * 0.8);
      const steps = Math.ceil(len * 1.4);
      let px = x;
      let py = y;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const rad = Math.max(0.55, w0 * (1 - t * 0.8));
        const br = v0 * (0.7 + 0.55 * t) * (isDry ? 1.08 : 1);
        splat(px, py, rad, br, hb + t * 0.22, dr);
        a += curl;
        px += Math.cos(a) / 1.4;
        py += Math.sin(a) / 1.4;
      }
    }
  }
  return pack(S, alb, hgt, dry);
}

// ---------------------------------------------------------------------------------------------
// rock: warped Voronoi stones with dark cracks, domed height, fine grain and faint strata
// ---------------------------------------------------------------------------------------------

function buildRockDetailRaw(S = 256, seed = 77001): DetailMap {
  const rnd = mulberry(seed);
  const CELLS = 6;
  const pts = new Float32Array(CELLS * CELLS * 2);
  const stoneV = new Float32Array(CELLS * CELLS);
  const stoneH = new Float32Array(CELLS * CELLS);
  for (let i = 0; i < CELLS * CELLS; i++) {
    pts[i * 2] = 0.12 + rnd() * 0.76;
    pts[i * 2 + 1] = 0.12 + rnd() * 0.76;
    stoneV[i] = 0.5 + rnd() * 0.5;
    stoneH[i] = 0.45 + rnd() * 0.55;
  }
  const warpX = fbm(S, 4, 3, rnd);
  const warpY = fbm(S, 4, 3, rnd);
  const grain = fbm(S, 40, 4, rnd);
  const medium = fbm(S, 10, 3, rnd);
  const alb = new Float32Array(S * S);
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const u = (x / S) * CELLS + (warpX[i] - 0.5) * 2.1 + (grain[i] - 0.5) * 0.35;
      const v = (y / S) * CELLS + (warpY[i] - 0.5) * 2.1 + (grain[i] - 0.5) * 0.35;
      const cx = Math.floor(u);
      const cy = Math.floor(v);
      let f1 = 9;
      let f2 = 9;
      let id = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          const gy = cy + oy;
          const cid = wrapI(gy, CELLS) * CELLS + wrapI(gx, CELLS);
          const dx = gx + pts[cid * 2] - u;
          const dy = gy + pts[cid * 2 + 1] - v;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < f1) {
            f2 = f1;
            f1 = d;
            id = cid;
          } else if (d < f2) f2 = d;
        }
      }
      const edge = f2 - f1;
      const crack = (1 - sstep(0.01, 0.13, edge)) * (0.35 + 0.65 * medium[i]);
      const dome = 1 - Math.min(1, f1 * f1 * 0.7);
      const strata = 0.5 + 0.5 * Math.sin(y * 0.19 + medium[i] * 7);
      alb[i] = (0.62 + 0.38 * stoneV[id]) * (1 - 0.6 * crack) * (0.7 + 0.6 * grain[i]) * (0.92 + 0.16 * strata) * (0.82 + 0.36 * medium[i]);
      hgt[i] = stoneH[id] * (0.6 + 0.4 * dome) * (1 - 0.45 * crack) + 0.16 * grain[i] + 0.08 * medium[i];
    }
  }
  return pack(S, alb, hgt, null);
}

// ---------------------------------------------------------------------------------------------
// dirt: lumpy soil, scattered pebbles with contact shadows, fine crumb grain
// ---------------------------------------------------------------------------------------------

function buildDirtDetailRaw(S = 256, seed = 31337): DetailMap {
  const rnd = mulberry(seed);
  const CELLS = 26;
  const pts = new Float32Array(CELLS * CELLS * 2);
  const pebV = new Float32Array(CELLS * CELLS);
  const pebR = new Float32Array(CELLS * CELLS);
  for (let i = 0; i < CELLS * CELLS; i++) {
    pts[i * 2] = 0.2 + rnd() * 0.6;
    pts[i * 2 + 1] = 0.2 + rnd() * 0.6;
    pebV[i] = 0.6 + rnd() * 0.5;
    pebR[i] = rnd() < 0.2 ? 0.1 + rnd() * 0.16 : 0; // only a third of the cells hold a pebble
  }
  const lump = fbm(S, 6, 4, rnd);
  const crumb = fbm(S, 48, 4, rnd);
  const alb = new Float32Array(S * S);
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const u = (x / S) * CELLS;
      const v = (y / S) * CELLS;
      const cx = Math.floor(u);
      const cy = Math.floor(v);
      let peb = 0;
      let shade = 1;
      let pv = 1;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          const gy = cy + oy;
          const cid = wrapI(gy, CELLS) * CELLS + wrapI(gx, CELLS);
          const r = pebR[cid];
          if (r === 0) continue;
          const dx = gx + pts[cid * 2] - u;
          const dy = gy + pts[cid * 2 + 1] - v;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < r) {
            const dome = Math.sqrt(1 - (d / r) * (d / r));
            if (dome > peb) {
              peb = dome;
              pv = pebV[cid];
            }
          } else if (d < r * 1.7) {
            shade = Math.min(shade, 0.7 + 0.3 * sstep(r, r * 1.7, d)); // contact shadow ring
          }
        }
      }
      const soil = (0.3 + 0.4 * lump[i]) * (0.66 + 0.68 * crumb[i]);
      alb[i] = peb > 0 ? soil * (0.8 + 0.5 * pv) * (0.8 + 0.25 * peb) : soil * shade;
      hgt[i] = 0.1 + 0.34 * lump[i] + 0.2 * crumb[i] + peb * 0.4;
    }
  }
  return pack(S, alb, hgt, null);
}

/** cached on the device after the first build (see cache/BakeCache.ts) */
export function buildGrassDetail(S = 512, seed = 20261013): DetailMap {
  return bakedData(`grass:${S}:${seed}`, () => buildGrassDetailRaw(S, seed));
}

/** cached on the device after the first build (see cache/BakeCache.ts) */
export function buildRockDetail(S = 256, seed = 77001): DetailMap {
  return bakedData(`rock:${S}:${seed}`, () => buildRockDetailRaw(S, seed));
}

/** cached on the device after the first build (see cache/BakeCache.ts) */
export function buildDirtDetail(S = 256, seed = 31337): DetailMap {
  return bakedData(`dirt:${S}:${seed}`, () => buildDirtDetailRaw(S, seed));
}
