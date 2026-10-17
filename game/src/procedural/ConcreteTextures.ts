import * as THREE from 'three';
import { onTextureLevel, TEXTURE_SCALE } from '../graphics/GraphicsSettings';
import { averageColor, copiesOf, releaseUnused, scaledTexture } from '../graphics/TextureDetail';
import { RoadSurface, rngFrom } from './RoadTextures';
import { bakedData } from '../cache/BakeCache';

/**
 * Real-looking concrete for every bridge, viaduct and flyover (parapets / jersey barriers, deck edges, undersides, piers).
 * One place to change: CurvedRoadBuilder only asks for getConcreteMaterial('wall' | 'top') + getJointMaterial(), so editing a
 * texture here changes every bridge in the world at the same time.
 *
 *   'wall'  vertical faces + undersides: air pockets (blow-holes), exposed sand and aggregate, hairline cracks, rain streaks,
 *           the odd rust run, soft cloudy tone changes.            1024 px per 2 m  (~2 mm per pixel)
 *   'top'   upward faces (barrier cap, deck edge strip): same concrete but dustier and grittier, no streaks, tyre-dust blotches.
 *                                                                  512 px per 2 m
 * Each texture comes with a matching normal map made from the same height field (pores and aggregate catch the light), and the
 * material adds two very fine grain layers (16 cm + 43 cm) so even at arm's length the surface still has detail and never turns
 * into a blurry photo. Everything is tileable and generated once.
 */

/** metres covered by one repeat of the concrete textures (UVs in CurvedRoadBuilder are metres / CONCRETE_TILE) */
export const CONCRETE_TILE = 2.0;

type Kind = 'wall' | 'top';

interface Built {
  map: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
}

const cache: Partial<Record<Kind, Built>> = {};
const mats: Partial<Record<Kind, THREE.MeshStandardMaterial>> = {};
let grainTex: THREE.CanvasTexture | null = null;
let jointMat: THREE.MeshLambertMaterial | null = null;

/** tileable value noise: `cells` x `cells` random lattice, smooth-interpolated, wraps at the texture border */
function latticeNoise(S: number, cells: number, rnd: () => number): Float32Array {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(S * S);
  const k = cells / S;
  for (let y = 0; y < S; y++) {
    const fy = y * k;
    const iy = Math.floor(fy);
    const ty = fy - iy;
    const sy = ty * ty * (3 - 2 * ty);
    const y0 = (iy % cells) * cells;
    const y1 = ((iy + 1) % cells) * cells;
    for (let x = 0; x < S; x++) {
      const fx = x * k;
      const ix = Math.floor(fx);
      const tx = fx - ix;
      const sx = tx * tx * (3 - 2 * tx);
      const x0 = ix % cells;
      const x1 = (ix + 1) % cells;
      const a = g[y0 + x0];
      const b = g[y0 + x1];
      const c = g[y1 + x0];
      const d = g[y1 + x1];
      out[y * S + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function buildPixels(kind: Kind): { S: number; col: Uint8ClampedArray; nrm: Uint8ClampedArray } {
  const wall = kind === 'wall';
  const S = wall ? 1024 : 512;
  const N = S * S;
  const M = S - 1; // S is a power of two: (n & M) wraps any integer, negatives included
  const r = rngFrom(wall ? 90210 : 31337);
  const gauss = (): number => (r() + r() + r() - 1.5) * 2;
  const scale = S / 1024; // feature sizes below are written for 1024 px

  const R = new Float32Array(N);
  const G = new Float32Array(N);
  const B = new Float32Array(N);
  const H = new Float32Array(N);

  // ---- 1. cloudy tone changes + warm / cool patches (several octaves of tileable noise) -----------------------
  const n1 = latticeNoise(S, 3, r);
  const n2 = latticeNoise(S, 6, r);
  const n3 = latticeNoise(S, 12, r);
  const n4 = latticeNoise(S, 24, r);
  const n5 = latticeNoise(S, 48, r);
  const n6 = latticeNoise(S, 96, r);
  const base = wall ? 182 : 172;
  for (let i = 0; i < N; i++) {
    const m = (n1[i] - 0.5) * 30 + (n2[i] - 0.5) * 20 + (n3[i] - 0.5) * 13 + (n4[i] - 0.5) * 9 + (n5[i] - 0.5) * 6;
    const lum = base + m + gauss() * 6.5; // + fine sand grain
    const t = (n3[i] - 0.5) * 0.05 + (n1[i] - 0.5) * 0.03; // warm <-> cool
    R[i] = lum * (1.0 + t) + gauss() * 1.5;
    G[i] = lum * 0.99;
    B[i] = lum * (0.955 - t) + gauss() * 1.5;
    H[i] = (n4[i] - 0.5) * 0.12 + (n5[i] - 0.5) * 0.1 + (n6[i] - 0.5) * 0.07 + gauss() * 0.05;
  }

  const at = (x: number, y: number): number => (y & M) * S + (x & M);

  /** round pit / bump with soft edge, wraps around the tile */
  const disc = (cx: number, cy: number, rad: number, depth: number, dark: number, tint = 0, ax = 1, ay = 1): void => {
    const r2 = rad * rad;
    const reach = rad * Math.max(ax, ay);
    const x0 = Math.floor(cx - reach) - 1;
    const x1 = Math.ceil(cx + reach) + 1;
    const y0 = Math.floor(cy - reach) - 1;
    const y1 = Math.ceil(cy + reach) + 1;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = (xx + 0.5 - cx) / ax;
        const dy = (yy + 0.5 - cy) / ay;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const f = 1 - d2 / r2;
        const j = at(xx, yy);
        H[j] -= depth * f;
        const m = 1 - dark * f * f; // dark core, soft edge
        R[j] *= m * (1 + tint);
        G[j] *= m;
        B[j] *= m * (1 - tint);
      }
    }
  };

  /** exposed sand / aggregate: tiny lighter or darker grain that stands a little proud of the surface */
  const fleck = (cx: number, cy: number, rad: number, mult: number, warm: number): void => {
    const r2 = rad * rad;
    for (let yy = Math.floor(cy - rad); yy <= Math.ceil(cy + rad); yy++) {
      for (let xx = Math.floor(cx - rad); xx <= Math.ceil(cx + rad); xx++) {
        const dx = xx + 0.5 - cx;
        const dy = yy + 0.5 - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const f = 1 - d2 / r2;
        const j = at(xx, yy);
        const m = 1 + (mult - 1) * Math.min(1, f * 1.8);
        R[j] *= m * (1 + warm);
        G[j] *= m;
        B[j] *= m * (1 - warm);
        H[j] += 0.18 * f;
      }
    }
  };

  // ---- 2. exposed aggregate -------------------------------------------------------------------------------------
  const flecks = Math.round(8000 * scale * scale);
  for (let i = 0; i < flecks; i++) {
    const rad = 0.8 + r() * r() * 2.2;
    const light = r() < 0.5;
    const mult = light ? 1.07 + r() * 0.12 : 0.8 + r() * 0.1;
    const warm = (r() - 0.5) * 0.09;
    fleck(r() * S, r() * S, rad, mult, warm);
  }

  // ---- 3. blow-holes (air pockets): mostly pin-pricks, a few up to ~1 cm ----------------------------------------
  const pores = Math.round((wall ? 3000 : 2800) * scale * scale);
  for (let i = 0; i < pores; i++) {
    const rad = 0.6 + Math.pow(r(), 4) * (wall ? 3.4 : 2.2);
    const sq = 1 + r() * 0.7; // pits are rarely round
    const horiz = r() < 0.5;
    disc(r() * S, r() * S, rad, 0.5 + rad * 0.4, 0.2 + r() * 0.3, 0, horiz ? sq : 1, horiz ? 1 : sq);
  }

  // ---- 4. dirt: dark grit specks (more on the top faces) ----------------------------------------------------------
  const grit = Math.round((wall ? 30000 : 60000) * scale * scale);
  for (let i = 0; i < grit; i++) {
    const j = at(Math.floor(r() * S), Math.floor(r() * S));
    const m = 0.7 + r() * 0.15;
    R[j] *= m;
    G[j] *= m;
    B[j] *= m;
  }

  // ---- 5. hairline cracks ----------------------------------------------------------------------------------------
  // a hairline is a few mm wide and only a little darker than the face around it; it wanders slowly and rarely forks
  const crack = (x: number, y: number, ang: number, len: number, width: number, depth: number, branch: boolean): void => {
    const heading = ang;
    let wander = 0; // bounded wobble around the heading: the crack never curls back on itself
    for (let s = 0; s < len; s++) {
      wander += (r() - 0.5) * 0.12 - wander * 0.06;
      ang = heading + wander;
      x += Math.cos(ang) * 0.9;
      y += Math.sin(ang) * 0.9;
      const fade = Math.min(1, s / 25, (len - s) / 25); // tapers to nothing at both ends
      disc(x, y, width * (0.55 + 0.45 * fade), depth * fade, 0.3 * fade, 0);
      if (branch && r() < 0.004 && len - s > 40) crack(x, y, ang + (r() < 0.5 ? 1 : -1) * (0.4 + r() * 0.5), (len - s) * 0.4, width * 0.8, depth * 0.8, false);
    }
  };
  const cracks = wall ? 5 : 8;
  for (let i = 0; i < cracks; i++) {
    const vertical = wall && r() < 0.5;
    const ang = vertical ? (r() < 0.5 ? 1 : -1) * Math.PI * 0.5 + (r() - 0.5) * 0.5 : r() * Math.PI * 2;
    crack(r() * S, r() * S, ang, (90 + r() * 260) * (S / 1024), 0.7 + r() * 0.3, 0.7, true);
  }

  // ---- 6. rain streaks + the odd rust run (wall faces only; they run down the face) ------------------------------
  if (wall) {
    for (let k = 0; k < 80; k++) {
      const x = r() * S;
      const w = 1.2 + r() * r() * 7;
      const len = S * (0.2 + r() * 0.8);
      const y0 = r() * S;
      const strength = 0.035 + r() * 0.12;
      const roll = r();
      const rust = roll < 0.06;
      const light = !rust && roll > 0.92; // pale lime run
      const ph = r() * 6.28;
      for (let t = 0; t < len; t++) {
        const fade = Math.pow(1 - t / len, 0.7) * Math.min(1, t / 12);
        const wob = 0.6 + 0.4 * Math.sin(t * 0.07 + ph);
        const cx = x + Math.sin(t * 0.02 + ph) * 1.5;
        const reach = Math.ceil(w * 2);
        for (let dx = -reach; dx <= reach; dx++) {
          const wgt = Math.exp(-(dx / w) * (dx / w));
          const f = strength * fade * wob * wgt;
          const j = at(Math.floor(cx + dx), Math.floor(y0 + t));
          if (rust) {
            R[j] *= 1 - f * 0.25;
            G[j] *= 1 - f * 0.75;
            B[j] *= 1 - f * 1.3;
          } else if (light) {
            const m = 1 + f * 0.45;
            R[j] *= m;
            G[j] *= m;
            B[j] *= m;
          } else {
            const m = 1 - f;
            R[j] *= m;
            G[j] *= m;
            B[j] *= m * 0.985;
          }
        }
      }
    }
  } else {
    // tyre dust / oil: big soft darker blotches
    for (let k = 0; k < 16; k++) disc(r() * S, r() * S, (20 + r() * 40) * (S / 512), 0, 0.04 + r() * 0.05);
  }

  // ---- 7. write colour + normal map (height field -> tangent-space normals, +Y = up in the image) ------------
  const col = new Uint8ClampedArray(N * 4);
  const nrm = new Uint8ClampedArray(N * 4);
  const K = wall ? 0.5 : 0.42;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const j = y * S + x;
      const o = j * 4;
      col[o] = R[j];
      col[o + 1] = G[j];
      col[o + 2] = B[j];
      col[o + 3] = 255;
      const hx = H[at(x + 1, y)] - H[at(x - 1, y)];
      const hy = H[at(x, y + 1)] - H[at(x, y - 1)];
      const nx = -hx * K;
      const ny = hy * K;
      const l = Math.hypot(nx, ny, 1);
      nrm[o] = (nx / l * 0.5 + 0.5) * 255;
      nrm[o + 1] = (ny / l * 0.5 + 0.5) * 255;
      nrm[o + 2] = (1 / l * 0.5 + 0.5) * 255;
      nrm[o + 3] = 255;
    }
  }

  return { S, col, nrm };
}

function build(kind: Kind): Built {
  // the pixel work is the slow part: saved on the device after the first build (see cache/BakeCache.ts)
  const { S, col, nrm } = bakedData(`concrete:${kind}`, () => buildPixels(kind), false);
  const toTexture = (data: Uint8ClampedArray, srgb: boolean): THREE.CanvasTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(S, S);
    img.data.set(data);
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: toTexture(col, true), normal: toTexture(nrm, false) };
}


export function getConcreteTextures(kind: Kind): Built {
  return (cache[kind] ??= build(kind));
}

/** neutral multiplier (mean 1.0 after x2) tiled every ~16 cm and ~43 cm: the fine sandy grain you only see up close */
function getConcreteGrain(): THREE.CanvasTexture {
  if (grainTex) return grainTex;
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const r = rngFrom(7771);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let i = 0; i < S * S; i++) {
    let v = 128 + ((r() + r() + r() - 1.5) * 2) * 20;
    const q = r();
    if (q < 0.05) v -= 38 + r() * 22; // a pore
    else if (q > 0.96) v += 26 + r() * 18; // a bright grain
    const o = i * 4;
    d[o] = d[o + 1] = d[o + 2] = Math.max(0, Math.min(255, v));
    d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  grainTex = new THREE.CanvasTexture(canvas);
  grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping;
  grainTex.anisotropy = 8; // raw multiplier: NoColorSpace on purpose
  return grainTex;
}

/** shared by every bridge: one material per face kind. Joins the road weather system, so rain darkens it like the asphalt. */
export function getConcreteMaterial(kind: Kind): THREE.MeshStandardMaterial {
  const have = mats[kind];
  if (have) return have;
  const t = getConcreteTextures(kind);
  const m = new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normal,
    normalScale: new THREE.Vector2(0.9, 0.9),
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
  });
  const fine = CONCRETE_TILE / 0.16;
  const medium = CONCRETE_TILE / 0.43;
  m.customProgramCacheKey = () => 'il-concrete-detail';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tGrain = { value: getConcreteGrain() };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tGrain;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
#ifdef USE_MAP
{
  vec3 g1 = texture2D(tGrain, vMapUv * ${fine.toFixed(3)}).rgb * 2.0;
  vec3 g2 = texture2D(tGrain, vMapUv * ${medium.toFixed(3)} + vec2(0.37, 0.11)).rgb * 2.0;
  diffuseColor.rgb *= mix(vec3(1.0), g1 * g2, 0.85);
}
#endif`,
      );
  };
  RoadSurface.register(m);
  mats[kind] = m;
  // texture quality: Low = smooth flat concrete colour (no image, no relief, so the grain shader above is skipped too),
  // Medium = half-size image without relief, High / Ultra = everything
  onTextureLevel((lv) => {
    m.map = lv === 0 ? null : scaledTexture(t.map, TEXTURE_SCALE[lv]);
    m.normalMap = lv >= 2 ? t.normal : null;
    RoadSurface.setBase(m, lv === 0 ? averageColor(t.map, 0x8d8b86) : new THREE.Color(1, 1, 1));
    m.needsUpdate = true;
    const used = new Set<THREE.Texture>();
    for (const x of [m.map, m.normalMap]) if (x) used.add(x);
    releaseUnused([t.map, t.normal, ...copiesOf(t.map)], used);
  });
  return m;
}

/** expansion joints between barrier panels: thin dark strips, pushed toward the camera so they never z-fight with the concrete */
export function getJointMaterial(): THREE.MeshLambertMaterial {
  if (!jointMat) {
    jointMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }
  return jointMat;
}
