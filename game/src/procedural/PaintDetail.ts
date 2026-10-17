import { bakedData } from '../cache/BakeCache';
/**
 * Road-paint detail maps for crosswalks, lane lines, stop lines and arrows (pure typed-array code, no THREE / DOM).
 *
 *   colour  RGBA8  RGB = paint tone multiplier (~0.8..1.0, thin / worn paint darker, hairline cracks darker),
 *                  A   = coverage: 0 where the paint has chipped clean off, so the ASPHALT shows through the hole
 *   height  RGBA8  R   = paint thickness (0 in chips, bevelled round them, tiny aggregate bumps) - used as a bump map
 *
 * The old paint map was a flat light-grey with painted-on dark specks: there was no relief, no holes and no thickness, so crosswalks looked
 * like flat white rectangles. Real thermoplastic paint is a thick layer that wears off in patches (worst where tyres run), chips along its
 * edges, cracks, and picks up grit - that is what this reproduces. The map tiles every 2.5 m (UV_PAINT in RoadBuilder).
 */

export interface PaintMaps {
  size: number;
  colour: Uint8Array;
  height: Uint8Array;
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

function buildPaintMapsRaw(S = 512, seed = 777): PaintMaps {
  const rnd = mulberry(seed);
  const R = (a: number, b: number) => a + rnd() * (b - a);

  const tone = fbm(S, 4, 3, rnd); // slow tonal drift (dirt, uneven coverage)
  const zone = fbm(S, 5, 3, rnd); // where the paint is worn: big soft zones
  const chipN = fbm(S, 26, 4, rnd); // shape of the chips inside a worn zone
  const grit = fbm(S, 110, 2, rnd);

  const tn = new Float32Array(S * S); // tone
  const cov = new Float32Array(S * S); // coverage 0..1
  const hgt = new Float32Array(S * S);

  for (let i = 0; i < S * S; i++) {
    const wear = sstep(0.4, 0.72, zone[i]); // 0 fresh .. 1 badly worn
    const v = chipN[i] + 0.14 * (grit[i] - 0.5);
    const thr = 0.76 - 0.17 * wear; // chip threshold: lower = more paint gone
    const gone = sstep(thr, thr + 0.025, v); // 1 = bare asphalt
    const thin = sstep(thr - 0.075, thr, v); // paint wearing thin before it goes
    cov[i] = 1 - gone;
    // base tone: bright, slow drift, grey speckle of dirt / aggregate
    let t = 0.88 + 0.11 * tone[i] + 0.05 * (grit[i] - 0.5);
    t *= 1 - 0.38 * thin; // thin paint lets the dark asphalt show through
    tn[i] = t;
    hgt[i] = (0.62 + 0.2 * grit[i]) * (1 - 0.55 * thin) * (1 - gone);
  }

  // aggregate: little grey stones poking through / dirt grains
  const nSpeck = Math.round(S * S * 0.045);
  for (let n = 0; n < nSpeck; n++) {
    const x = Math.floor(R(0, S));
    const y = Math.floor(R(0, S));
    const i = y * S + x;
    const dark = rnd() < 0.75;
    tn[i] *= dark ? R(0.55, 0.82) : R(1.03, 1.1);
    if (dark && rnd() < 0.5) hgt[i] += 0.12;
  }

  // hairline cracks: drunk-walk lines that darken the paint a little and cut a groove into it
  for (let n = 0; n < 34; n++) {
    let x = R(0, S);
    let y = R(0, S);
    let a = R(0, 6.2832);
    const len = Math.floor(R(30, 110));
    for (let s = 0; s < len; s++) {
      a += R(-0.5, 0.5);
      x += Math.cos(a);
      y += Math.sin(a);
      const i = wrapI(Math.round(y), S) * S + wrapI(Math.round(x), S);
      tn[i] *= 0.62;
      hgt[i] *= 0.45;
    }
  }

  // bevel the chip edges (3x3 box blur of the thickness, wrapped) so the bump map has soft walls, not cliffs
  const blur = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let acc = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = wrapI(y + dy, S) * S;
        for (let dx = -1; dx <= 1; dx++) acc += hgt[yy + wrapI(x + dx, S)];
      }
      blur[y * S + x] = acc / 9;
    }
  }

  const colour = new Uint8Array(S * S * 4);
  const height = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const t = Math.min(1, Math.max(0, tn[i]));
    colour[i * 4] = Math.round(t * 255);
    colour[i * 4 + 1] = Math.round(t * 0.99 * 255);
    colour[i * 4 + 2] = Math.round(t * 0.955 * 255); // paint yellows / dirties a touch toward the blue end
    colour[i * 4 + 3] = Math.round(cov[i] * 255);
    const h = Math.min(1, Math.max(0, blur[i]));
    height[i * 4] = Math.round(h * 255);
    height[i * 4 + 1] = height[i * 4];
    height[i * 4 + 2] = height[i * 4];
    height[i * 4 + 3] = 255;
  }
  return { size: S, colour, height };
}

/** cached on the device after the first build (see cache/BakeCache.ts) */
export function buildPaintMaps(S = 512, seed = 777): PaintMaps {
  return bakedData(`paint:${S}:${seed}`, () => buildPaintMapsRaw(S, seed));
}
