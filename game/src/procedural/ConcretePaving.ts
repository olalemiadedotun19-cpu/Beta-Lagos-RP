import { bakedData } from '../cache/BakeCache';
/**
 * Cast-concrete sidewalk slabs - pure pixel maths (no DOM, no three) so the same code runs in the game and in a headless preview.
 *
 * ONE tile = 2.4 m x 2.4 m (the UV_PAVER of every pavement in the game) = 2 x 2 slabs of 1.2 m with saw-cut control joints,
 * so editing this file re-textures EVERY sidewalk (downtown grid + the curved city) at once.
 *
 * What is baked in (all tileable - everything wraps at the tile border):
 *   - per-slab tone (each slab is poured on its own day), cloudy mottling, fine sand grain, aggregate flecks, air-void pits
 *   - a broom finish: faint ridges across the walking direction
 *   - control joints: a dark core, a soft shadow and a slightly lighter chamfered arris, dust + grime collected along them
 *   - hairline cracks (with a branch), damp / algae-green patches, dark oil and gum spots, rain-streak darkening
 *   - a matching height map (joints, pits, cracks, broom ridges) used as a bump map
 */

export const PAVING_TILE_METRES = 2.4;

export interface PavingPixels {
  size: number;
  /** RGBA, size x size */
  color: Uint8ClampedArray;
  bumpSize: number;
  /** RGBA greyscale height, bumpSize x bumpSize */
  bump: Uint8ClampedArray;
}

function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** periodic value noise: px x py lattice cells across the tile, smooth-stepped bilinear */
function makeNoise(px: number, py: number, rnd: () => number): (u: number, v: number) => number {
  const g = new Float32Array(px * py);
  for (let i = 0; i < g.length; i++) g[i] = rnd() * 2 - 1;
  return (u: number, v: number): number => {
    const x = u * px;
    const y = v * py;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    let fx = x - x0;
    let fy = y - y0;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const xa = ((x0 % px) + px) % px;
    const ya = ((y0 % py) + py) % py;
    const xb = (xa + 1) % px;
    const yb = (ya + 1) % py;
    const a = g[ya * px + xa];
    const b = g[ya * px + xb];
    const c = g[yb * px + xa];
    const d = g[yb * px + xb];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

function buildConcretePavingRaw(S = 1024, seed = 90210): PavingPixels {
  const rnd = rngFrom(seed);
  const SLAB = S / 2;
  const R = new Float32Array(S * S);
  const G = new Float32Array(S * S);
  const B = new Float32Array(S * S);
  const H = new Float32Array(S * S);

  // ---- per-slab character ------------------------------------------------------------------------
  const slabTone: number[] = [];
  const slabWarm: number[] = [];
  const slabTilt: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    slabTone.push((rnd() - 0.5) * 20); // +-10 levels
    slabWarm.push((rnd() - 0.5) * 6);
    slabTilt.push([(rnd() - 0.5) * 8, (rnd() - 0.5) * 8]);
  }

  const nCloud = makeNoise(5, 5, rnd);
  const nMid = makeNoise(22, 22, rnd);
  const nFine = makeNoise(90, 90, rnd);
  const nBroom = makeNoise(150, 4, rnd); // ridges across the walking direction (x = along the road, so they vary along x, are constant along y)
  const nBroomB = makeNoise(60, 3, rnd);
  const nRain = makeNoise(3, 46, rnd); // long vertical rain streaks

  const JOINT_CORE = 1.8; // px (2.34 mm per px at 1024): ~ 8 mm wide dark core
  const JOINT_FALL = 7;

  for (let y = 0; y < S; y++) {
    const v = y / S;
    const my = y % SLAB;
    const dy = Math.min(my, SLAB - my);
    const sy = y < SLAB ? 0 : 1;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const mx = x % SLAB;
      const dx = Math.min(mx, SLAB - mx);
      const sx = x < SLAB ? 0 : 1;
      const slab = sy * 2 + sx;
      const o = y * S + x;
      // distance (px) to the nearest control joint; a blend at the crossing so the four joints meet cleanly
      const dj = dx < dy ? dx : dy;

      // ---- albedo --------------------------------------------------------------------------------
      let t = 188 + slabTone[slab];
      t += slabTilt[slab][0] * ((mx / SLAB) - 0.5) + slabTilt[slab][1] * ((my / SLAB) - 0.5);
      t += nCloud(u, v) * 7 + nMid(u, v) * 4.5 + nFine(u, v) * 3.5;
      const sandy = (rnd() + rnd() - 1) * 9; // fine grain
      t += sandy;
      const roll = rnd();
      let fleck = 0;
      if (roll < 0.014) fleck = 14 + rnd() * 22; // pale aggregate / quartz sand
      else if (roll < 0.022) fleck = -(12 + rnd() * 20); // dark aggregate
      t += fleck;
      // broom finish: very faint ridges
      const broom = nBroom(u, v) * 3.2 + nBroomB(u, v) * 2.0;
      t += broom;
      // vertical rain streaks (darker, slightly warmer)
      const rain = Math.max(0, nRain(u, v)) * 6;
      t -= rain;

      let r = t + 3 + slabWarm[slab];
      let g = t + 0.5;
      let b = t - 5 - slabWarm[slab] * 0.4;
      let h = 150 + sandy * 1.6 + broom * 2.0 + nFine(u, v) * 6 + (fleck > 0 ? 6 : -6 * (fleck < 0 ? 1 : 0));

      // air voids: tiny dark pits
      if (roll > 0.9965) {
        r -= 46;
        g -= 46;
        b -= 44;
        h -= 55;
      }

      // ---- control joint ---------------------------------------------------------------------------
      if (dj < JOINT_CORE) {
        const k = 1 - dj / JOINT_CORE * 0.25;
        r = r * (1 - 0.62 * k) + 56 * 0.62 * k;
        g = g * (1 - 0.62 * k) + 52 * 0.62 * k;
        b = b * (1 - 0.62 * k) + 46 * 0.62 * k;
        h = 40 + rnd() * 14;
      } else if (dj < JOINT_FALL) {
        const k = 1 - (dj - JOINT_CORE) / (JOINT_FALL - JOINT_CORE); // 1 at the core -> 0 outside
        const shade = 26 * k * k;
        r -= shade;
        g -= shade;
        b -= shade * 0.95;
        h -= 70 * k * k;
        // chamfered arris: a thin lighter line just outside the shadow
        if (dj > JOINT_CORE + 1 && dj < JOINT_CORE + 3.5) {
          r += 7;
          g += 7;
          b += 6;
          h += 12;
        }
      }
      // dust and grime collect near every joint and along the edges
      if (dj < 26) {
        const k = (1 - dj / 26) * (0.55 + nMid(u * 1.7 + 0.3, v * 1.7 + 0.6) * 0.45);
        r -= 15 * k;
        g -= 16 * k;
        b -= 19 * k;
      }

      R[o] = r;
      G[o] = g;
      B[o] = b;
      H[o] = h;
    }
  }

  // ---- wrapped stamp helpers ---------------------------------------------------------------------
  const wrapIdx = (x: number, y: number): number => (((y % S) + S) % S) * S + (((x % S) + S) % S);
  const darkenAt = (x: number, y: number, rr: number, gg: number, bb: number, hh: number): void => {
    const o = wrapIdx(x, y);
    R[o] += rr;
    G[o] += gg;
    B[o] += bb;
    H[o] += hh;
  };
  /** soft elliptical blob (stain, damp patch, grime) */
  const blob = (cx: number, cy: number, rx: number, ry: number, rot: number, dR: number, dG: number, dB: number, dH: number, rough: number): void => {
    const ext = Math.ceil(Math.max(rx, ry) * 1.25);
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    for (let oy = -ext; oy <= ext; oy++) {
      for (let ox = -ext; ox <= ext; ox++) {
        const lx = (ox * cs + oy * sn) / rx;
        const ly = (-ox * sn + oy * cs) / ry;
        // wobbly edge so the stain is never a clean ellipse
        const wob = 1 + nMid(((cx + ox) / S + 8) % 1, ((cy + oy) / S + 8) % 1) * rough;
        const d2 = (lx * lx + ly * ly) * wob;
        if (d2 >= 1) continue;
        const a = (1 - d2) * (1 - d2);
        darkenAt(cx + ox, cy + oy, dR * a, dG * a, dB * a, dH * a);
      }
    }
  };

  // damp / algae patches (humid Lagos shade) + dirty water stains
  for (let i = 0; i < 7; i++) {
    const cx = Math.floor(rnd() * S);
    const cy = Math.floor(rnd() * S);
    const rr = 50 + rnd() * 120;
    blob(cx, cy, rr, rr * (0.5 + rnd() * 0.6), rnd() * Math.PI, -10, -7, -12, -5, 0.55);
  }
  for (let i = 0; i < 4; i++) {
    const cx = Math.floor(rnd() * S);
    const cy = Math.floor(rnd() * S);
    const rr = 70 + rnd() * 110;
    blob(cx, cy, rr, rr * (0.6 + rnd() * 0.5), rnd() * Math.PI, -16, -15, -19, 0, 0.7);
  }
  // pale dust drifts
  for (let i = 0; i < 4; i++) {
    const cx = Math.floor(rnd() * S);
    const cy = Math.floor(rnd() * S);
    const rr = 60 + rnd() * 120;
    blob(cx, cy, rr, rr * (0.5 + rnd() * 0.7), rnd() * Math.PI, 8, 7, 4, 0, 0.6);
  }
  // oil / gum / tyre spots
  for (let i = 0; i < 26; i++) {
    const cx = Math.floor(rnd() * S);
    const cy = Math.floor(rnd() * S);
    const rr = 2 + rnd() * 6;
    blob(cx, cy, rr, rr * (0.7 + rnd() * 0.5), rnd() * Math.PI, -26, -26, -28, -6, 0.25);
  }
  // a couple of rust-brown run-off marks
  for (let i = 0; i < 2; i++) {
    const cx = Math.floor(rnd() * S);
    const cy = Math.floor(rnd() * S);
    blob(cx, cy, 14 + rnd() * 20, 50 + rnd() * 80, Math.PI / 2 + (rnd() - 0.5) * 0.2, -6, -16, -26, 0, 0.5);
  }

  // ---- hairline cracks --------------------------------------------------------------------------------
  const crack = (sx0: number, sy0: number, ang0: number, len: number, depth: number, branch: boolean): void => {
    let x = sx0;
    let y = sy0;
    let ang = ang0;
    let wander = 0;
    for (let s = 0; s < len; s++) {
      // a crack keeps its heading and only kinks a little (no loops): the wander is mean-reverting
      wander = wander * 0.9 + (rnd() - 0.5) * 0.16;
      ang = ang0 + wander * 2.2 + Math.sin(s * 0.05 + ang0 * 7) * 0.12;
      x += Math.cos(ang);
      y += Math.sin(ang);
      const fade = Math.min(1, s / 14, (len - s) / 26);
      const wide = rnd() < 0.12;
      const px = Math.round(x);
      const py = Math.round(y);
      darkenAt(px, py, -62 * fade * depth, -62 * fade * depth, -60 * fade * depth, -64 * fade * depth);
      if (wide) darkenAt(px + 1, py, -40 * fade * depth, -40 * fade * depth, -38 * fade * depth, -40 * fade * depth);
      darkenAt(px - 1, py, -12 * fade * depth, -12 * fade * depth, -12 * fade * depth, -6 * fade * depth);
      darkenAt(px + 1, py + 1, -10 * fade * depth, -10 * fade * depth, -10 * fade * depth, -5 * fade * depth);
      if (branch && s > 40 && s < len - 60 && rnd() < 0.012) crack(x, y, ang0 + (rnd() < 0.5 ? 0.75 : -0.75), 40 + Math.floor(rnd() * 80), depth * 0.8, false);
    }
  };
  // one long crack in slab 0, a shorter one in slab 3; a hairline corner crack at a joint crossing
  crack(70 + rnd() * 120, 70 + rnd() * 100, 0.6 + rnd() * 0.5, 230, 1, true);
  crack(SLAB + 80 + rnd() * 140, SLAB + 120 + rnd() * 100, -0.3 + rnd() * 0.6, 150, 0.9, true);
  crack(SLAB - 4, SLAB + 12, Math.PI * 0.18, 70, 0.9, false);

  // ---- soften the joint-crossing and output ------------------------------------------------------------
  const color = new Uint8ClampedArray(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const o = i * 4;
    color[o] = clamp255(R[i]);
    color[o + 1] = clamp255(G[i]);
    color[o + 2] = clamp255(B[i]);
    color[o + 3] = 255;
  }
  const BS = S / 2;
  const bump = new Uint8ClampedArray(BS * BS * 4);
  for (let y = 0; y < BS; y++) {
    for (let x = 0; x < BS; x++) {
      const a = (y * 2) * S + x * 2;
      const hv = (H[a] + H[a + 1] + H[a + S] + H[a + S + 1]) / 4;
      const o = (y * BS + x) * 4;
      const c = clamp255(hv);
      bump[o] = bump[o + 1] = bump[o + 2] = c;
      bump[o + 3] = 255;
    }
  }
  return { size: S, color, bumpSize: BS, bump };
}

/** cached on the device after the first build (see cache/BakeCache.ts) */
export function buildConcretePaving(S = 1024, seed = 90210): PavingPixels {
  return bakedData(`paving:${S}:${seed}`, () => buildConcretePavingRaw(S, seed));
}
