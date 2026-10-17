import * as THREE from 'three';
import { buildPaintMaps, type PaintMaps } from './PaintDetail';
import { buildConcretePaving } from './ConcretePaving';
import { bakedCanvas } from '../cache/BakeCache';

/**
 * Small, tileable canvas textures shared by the district roads and the travel corridor
 * (generated once, cached):
 *   - asphalt   1024px (7 m tile) fine aggregate + soft weathering, + a 25 cm micro-grain layer (cracks/patches/stains are DECALS, so they
 *                      can be applied per road class instead of being baked into every road)
 *   - paver     1024px cast-concrete sidewalk slabs with saw-cut joints, cracks, stains + a bump map (ConcretePaving.ts)
 *   - paint     128px  worn road paint (chips, scuffs) multiplied over marking colours
 *   - decals    512px  atlas: cracks | oil/dirt blot | repaired patch | tyre grime  (+ a white texel)
 */

let asphaltTex: THREE.CanvasTexture | null = null;
let paverTex: THREE.CanvasTexture | null = null;
let paintTex: THREE.DataTexture | null = null;
let decalTex: THREE.CanvasTexture | null = null;

export function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draws a shape at (x,y) plus its wrapped copies so the texture tiles seamlessly. */
function wrapped(size: number, x: number, y: number, r: number, draw: (px: number, py: number) => void): void {
  const xs = [x];
  const ys = [y];
  if (x < r) xs.push(x + size);
  if (x > size - r) xs.push(x - size);
  if (y < r) ys.push(y + size);
  if (y > size - r) ys.push(y - size);
  for (const px of xs) for (const py of ys) draw(px, py);
}

function finish(tex: THREE.CanvasTexture, repeat = true): THREE.CanvasTexture {
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** tileable value noise 0..1: `cells` x `cells` lattice, smooth interpolation, wraps at the border */
function tileNoise(S: number, cells: number, rnd: () => number): Float32Array {
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
      const dd = g[y1 + x1];
      out[y * S + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + dd) * sx * sy;
    }
  }
  return out;
}

let asphaltBumpTex: THREE.CanvasTexture | null = null;
/** SOFT height map for the asphalt (big rounded stones + gentle swells). The colour map is no longer used as its own bump: its per-pixel grit made shiny dust. */
export function getAsphaltBumpTexture(): THREE.CanvasTexture {
  if (asphaltBumpTex) return asphaltBumpTex;
  const S = 512;
  const canvas = bakedCanvas('asphalt-bump', S, S, (ctx) => {
    const r = rngFrom(4242);
    ctx.fillStyle = 'rgb(128,128,128)';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 1100; i++) {
      const rad = 3 + r() * 4.5;
      const hi = r() < 0.7;
      wrapped(S, r() * S, r() * S, rad, (px, py) => {
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, hi ? 'rgba(190,190,190,0.5)' : 'rgba(60,60,60,0.45)');
        g.addColorStop(1, 'rgba(128,128,128,0)');
        ctx.fillStyle = g;
        ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      });
    }
  });
  asphaltBumpTex = new THREE.CanvasTexture(canvas);
  asphaltBumpTex.wrapS = asphaltBumpTex.wrapT = THREE.RepeatWrapping;
  asphaltBumpTex.anisotropy = 8; // height map: raw values
  return asphaltBumpTex;
}

export function getAsphaltTexture(): THREE.CanvasTexture {
  if (asphaltTex) return asphaltTex;
  // Terrain Road recipe, made tileable: 1024px for a 7 m tile (~0.7 cm/px) of very fine aggregate, lighter grit,
  // cool/warm patchiness and faint wheel-polish. Cracks / patches / oil stay DECALS (see below). Fine grain comes from the
  // per-pixel pass (ImageData: fast, and tiles by construction); the close-up micro grain is a second layer (getRoadGrainTexture).
  const S = 1024;
  const canvas = bakedCanvas('asphalt-real', S, S, (ctx) => {
  const r = rngFrom(1337);

  // ---- 1. base: soft aggregate (LOW contrast, no bright single-pixel grit: that read as shiny dust) x large-scale mottling ----
  const n1 = tileNoise(S, 5, r);
  const n2 = tileNoise(S, 14, r);
  const n3 = tileNoise(S, 40, r);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let i = 0; i < S * S; i++) {
    const m = 0.74 + 0.5 * (n1[i] * 0.5 + n2[i] * 0.32 + n3[i] * 0.18);
    let v = (62 + (r() - 0.5) * 13 + (r() - 0.5) * 6) * m;
    const k = r();
    if (k < 0.012) v += 6 + r() * 8; // very faint lighter chip
    else if (k > 0.985) v -= 6 + r() * 8; // faint dark pit
    const o = i * 4;
    d[o] = v + 1.5;
    d[o + 1] = v;
    d[o + 2] = v + 2.5;
    d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // ---- 2. larger stones standing proud of the binder (soft, 3-6 px: ~2-4 cm) ----
  for (let i = 0; i < 1500; i++) {
    const v = 78 + Math.floor(r() * 36);
    const sz = 2.2 + r() * 2.6;
    wrapped(S, r() * S, r() * S, 6, (px, py) => {
      ctx.fillStyle = `rgba(${v},${v - 1},${v - 3},${0.16 + r() * 0.16})`;
      ctx.beginPath();
      ctx.ellipse(px, py, sz, sz * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ---- 3. cool / warm patchiness ----
  for (let i = 0; i < 40; i++) {
    const rad = 90 + r() * 260;
    const warm = r() < 0.5;
    wrapped(S, r() * S, r() * S, rad, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, warm ? 'rgba(84,72,58,0.2)' : 'rgba(26,30,36,0.2)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    });
  }

  // ---- 4. stains: oil drips, dark tyre-rubber smears, rust runs, dried puddle rings, bleached sun patches ----
  for (let i = 0; i < 26; i++) {
    const rad = 14 + r() * 60;
    wrapped(S, r() * S, r() * S, rad, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, `rgba(10,8,6,${0.35 + r() * 0.25})`);
      g.addColorStop(0.55, 'rgba(18,14,10,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    });
  }
  for (let i = 0; i < 14; i++) {
    const rad = 18 + r() * 40;
    wrapped(S, r() * S, r() * S, rad * 2, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, 'rgba(96,52,30,0.22)');
      g.addColorStop(1, 'rgba(96,52,30,0)');
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(0.45, 1.8); // run-off streaks
      ctx.translate(-px, -py);
      ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      ctx.restore();
    });
  }
  for (let i = 0; i < 10; i++) {
    const rad = 30 + r() * 70;
    wrapped(S, r() * S, r() * S, rad + 6, (px, py) => {
      ctx.strokeStyle = 'rgba(120,114,104,0.2)';
      ctx.lineWidth = 2 + r() * 3;
      ctx.beginPath();
      ctx.ellipse(px, py, rad, rad * (0.55 + r() * 0.4), r() * 3, 0, Math.PI * 2);
      ctx.stroke();
    });
  }
  for (let i = 0; i < 12; i++) {
    const rad = 70 + r() * 150;
    wrapped(S, r() * S, r() * S, rad, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, 'rgba(120,118,112,0.14)');
      g.addColorStop(1, 'rgba(120,118,112,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    });
  }

  // ---- 5. repaired patches: darker (fresh) or paler (old) rectangles with a sealed tar edge ----
  for (let i = 0; i < 7; i++) {
    const w = 90 + r() * 200;
    const h = 60 + r() * 140;
    const x = r() * (S - w - 10) + 5;
    const y = r() * (S - h - 10) + 5;
    const fresh = r() < 0.55;
    ctx.fillStyle = fresh ? 'rgba(28,29,32,0.6)' : 'rgba(92,92,94,0.3)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(8,8,10,0.75)';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.strokeStyle = 'rgba(130,126,118,0.22)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
  }

  // ---- 6. tar seams (periodic wobble so they tile) + crack networks ----
  const seam = (horizontal: boolean) => {
    const c = 100 + r() * (S - 200);
    const k1 = 1 + Math.floor(r() * 3);
    const k2 = 3 + Math.floor(r() * 4);
    const a1 = 6 + r() * 14;
    const a2 = 2 + r() * 4;
    const ph = r() * 6.28;
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? 'rgba(120,114,104,0.2)' : 'rgba(6,6,8,0.78)';
      ctx.lineWidth = pass === 0 ? 7 : 3.4;
      ctx.beginPath();
      for (let t = 0; t <= S; t += 8) {
        const o = c + Math.sin((t / S) * Math.PI * 2 * k1 + ph) * a1 + Math.sin((t / S) * Math.PI * 2 * k2) * a2;
        if (horizontal) t === 0 ? ctx.moveTo(t, o) : ctx.lineTo(t, o);
        else t === 0 ? ctx.moveTo(o, t) : ctx.lineTo(o, t);
      }
      ctx.stroke();
    }
  };
  seam(true);
  seam(false);

  const crack = (x: number, y: number, ang: number, len: number, w: number, depth: number) => {
    let cx = x;
    let cy = y;
    const pts: [number, number][] = [[cx, cy]];
    const segs = 7 + Math.floor(r() * 6);
    for (let i = 0; i < segs; i++) {
      ang += (r() - 0.5) * 1.0;
      cx += Math.cos(ang) * (len / segs);
      cy += Math.sin(ang) * (len / segs);
      cx = Math.min(S - 14, Math.max(14, cx));
      cy = Math.min(S - 14, Math.max(14, cy));
      pts.push([cx, cy]);
      if (depth < 2 && r() > 0.55) crack(cx, cy, ang + (r() > 0.5 ? 1 : -1) * (0.6 + r() * 0.7), len * 0.5, Math.max(1.2, w * 0.65), depth + 1);
    }
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? 'rgba(128,122,112,0.22)' : `rgba(5,5,7,${0.85 - depth * 0.12})`;
      ctx.lineWidth = pass === 0 ? w + 2.4 : w;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.stroke();
    }
  };
  for (let i = 0; i < 9; i++) crack(40 + r() * (S - 80), 40 + r() * (S - 80), r() * 6.28, 160 + r() * 260, 2.6 + r() * 2.2, 0);

  // alligator cracking: small polygon webs where the base has failed
  for (let k = 0; k < 4; k++) {
    const cx0 = 120 + r() * (S - 240);
    const cy0 = 120 + r() * (S - 240);
    const rad = 55 + r() * 70;
    const pts: [number, number][] = [];
    for (let i = 0; i < 26; i++) {
      const a = r() * 6.28;
      const rr = Math.sqrt(r()) * rad;
      pts.push([cx0 + Math.cos(a) * rr, cy0 + Math.sin(a) * rr * 0.8]);
    }
    ctx.strokeStyle = 'rgba(6,6,8,0.7)';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    for (const [px, py] of pts) {
      const near = pts.map(([qx, qy]) => ({ qx, qy, dd: Math.hypot(qx - px, qy - py) })).filter((q) => q.dd > 1).sort((a, b2) => a.dd - b2.dd).slice(0, 2);
      for (const q of near) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo((px + q.qx) / 2 + (r() - 0.5) * 6, (py + q.qy) / 2 + (r() - 0.5) * 6);
        ctx.lineTo(q.qx, q.qy);
        ctx.stroke();
      }
    }
  }

  });
  asphaltTex = finish(new THREE.CanvasTexture(canvas));
  asphaltTex.anisotropy = 8;
  return asphaltTex;
}

let grainTex: THREE.CanvasTexture | null = null;
/**
 * Micro grain (Terrain Road "makeGrain"): neutral grey multiplier (average 1.0 after x2) tiled every ~25 cm over the road,
 * so up close the surface still reads as real asphalt instead of a blurry photo.
 */
export function getRoadGrainTexture(): THREE.CanvasTexture {
  if (grainTex) return grainTex;
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const r = rngFrom(5150);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let i = 0; i < S * S; i++) {
    // low-contrast multiplier (+-8%): the old +-25% pixel noise tiled every 25 cm shimmered like glitter
    const v = 128 + (r() - 0.5) * 20 + (r() - 0.5) * 8;
    const o = i * 4;
    d[o] = d[o + 1] = d[o + 2] = v;
    d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  grainTex = new THREE.CanvasTexture(canvas);
  grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping;
  grainTex.anisotropy = 8; // raw multiplier: NoColorSpace on purpose
  return grainTex;
}

/**
 * Adds the Terrain Road micro grain on top of a material's map. `uvPerMetre` is how many UV units one metre covers
 * (asphalt 1/7, pavers 1/2.4), so the grain always repeats about every 25 cm.
 */
export function applyRoadGrain(mat: THREE.MeshStandardMaterial, uvPerMetre: number): void {
  mat.customProgramCacheKey = () => `il-roadgrain-${uvPerMetre.toFixed(4)}`;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tGrain = { value: getRoadGrainTexture() };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tGrain;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
#ifdef USE_MAP
diffuseColor.rgb *= texture2D(tGrain, vMapUv * ${(1 / (uvPerMetre * 0.25)).toFixed(3)}).rgb * 2.0;
#endif`,
      );
  };
}

let gravelTex: THREE.CanvasTexture | null = null;
/** Gravel / dirt shoulder (Terrain Road "makeShoulder" colours, tileable): the strip between the kerb or asphalt and the grass */
export function getGravelTexture(): THREE.CanvasTexture {
  if (gravelTex) return gravelTex;
  const S = 256;
  const canvas = bakedCanvas('gravel', S, S, (ctx) => {
  const r = rngFrom(8128);
  ctx.fillStyle = '#7d745f';
  ctx.fillRect(0, 0, S, S);
  const cols = ['#8d8470', '#6d6451', '#9a917b', '#5c5444', '#a39a84'];
  for (let i = 0; i < 14000; i++) {
    ctx.globalAlpha = 0.4 + r() * 0.5;
    ctx.fillStyle = cols[Math.floor(r() * cols.length)];
    const w = 1 + r() * 2.5;
    const h = 1 + r() * 2.5;
    wrapped(S, r() * S, r() * S, 4, (px, py) => ctx.fillRect(px, py, w, h));
  }
  for (let i = 0; i < 40; i++) {
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#4f5a2c';
    const rad = 6 + r() * 20;
    wrapped(S, r() * S, r() * S, rad, (px, py) => {
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.globalAlpha = 1;
  });
  gravelTex = finish(new THREE.CanvasTexture(canvas));
  return gravelTex;
}

/**
 * Sidewalk slabs (ConcretePaving.ts): cast concrete with saw-cut joints, 1024 px = 2.4 m (the UV_PAVER of every pavement).
 * This one texture is shared by the downtown grid AND the curved city, so changing it re-textures every sidewalk at once.
 */
let pavingBump: THREE.CanvasTexture | null = null;
function buildPavingTextures(): void {
  const px = buildConcretePaving(1024, 90210);
  const makeCanvas = (data: Uint8ClampedArray, size: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), size, size), 0, 0);
    return canvas;
  };
  paverTex = finish(new THREE.CanvasTexture(makeCanvas(px.color, px.size)));
  paverTex.anisotropy = 8;
  pavingBump = new THREE.CanvasTexture(makeCanvas(px.bump, px.bumpSize));
  pavingBump.wrapS = pavingBump.wrapT = THREE.RepeatWrapping;
  pavingBump.anisotropy = 8; // a height map: raw values, no colour space
}

export function getPaverTexture(): THREE.CanvasTexture {
  if (!paverTex) buildPavingTextures();
  return paverTex!;
}

/** height map matching getPaverTexture (joints, pits, cracks, broom ridges): use as the pavement material's bumpMap */
export function getPaverBumpTexture(): THREE.CanvasTexture {
  if (!pavingBump) buildPavingTextures();
  return pavingBump!;
}

let paintMaps: PaintMaps | null = null;
function getPaintMaps(): PaintMaps {
  if (!paintMaps) paintMaps = buildPaintMaps(512, 777);
  return paintMaps;
}
function paintDataTexture(data: Uint8Array, size: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/**
 * Worn road paint (PaintDetail.ts): RGB = paint tone, ALPHA = coverage (0 where the paint has chipped off, so the asphalt below shows through;
 * the marking material uses alphaTest). Multiplied with the marking colour from the vertex colours. Tiles every 2.5 m (UV_PAINT).
 */
export function getPaintTexture(): THREE.DataTexture {
  if (paintTex) return paintTex;
  const m = getPaintMaps();
  paintTex = paintDataTexture(m.colour, m.size, true);
  return paintTex;
}

let paintBumpTex: THREE.DataTexture | null = null;
/** thickness of the paint layer (red channel) - bump map for the marking material: chip edges, grit, cracks catch the light */
export function getPaintBumpTexture(): THREE.DataTexture {
  if (paintBumpTex) return paintBumpTex;
  const m = getPaintMaps();
  paintBumpTex = paintDataTexture(m.height, m.size, false);
  return paintBumpTex;
}

/**
 * Decal atlas (RGBA, transparent background): 2x2 blocks of 256px, content in the inner 240px.
 *   (0,0) crack web   (1,0) oil / dirt blot   (0,1) repaired patch   (1,1) tyre grime streak
 * The bottom-right 16px of block (1,1) stays solid white so untextured decals can sample "white".
 * Returns the texture plus UV helpers.
 */
export const DECAL_CELL = { crack: 0, blot: 1, patch: 2, grime: 3 } as const;
export const DECAL_WHITE_UV: [number, number] = [0.995, 0.005];

export function decalUV(cell: number): { u0: number; v0: number; u1: number; v1: number } {
  const cx = cell % 2;
  const cy = Math.floor(cell / 2);
  const pad = 8 / 512;
  // canvas y grows downward, texture v grows upward -> flip
  const u0 = (cx * 256) / 512 + pad;
  const u1 = ((cx + 1) * 256) / 512 - pad;
  const vTop = 1 - (cy * 256) / 512 - pad;
  const vBot = 1 - ((cy + 1) * 256) / 512 + pad;
  return { u0, u1, v0: vBot, v1: vTop };
}

export function getDecalAtlas(): THREE.CanvasTexture {
  if (decalTex) return decalTex;
  const S = 512;
  const canvas = bakedCanvas('decals', S, S, (ctx) => {
  const r = rngFrom(9001);

  // --- (0,0) crack web ---
  ctx.save();
  ctx.translate(0, 0);
  ctx.lineCap = 'round';
  const branch = (x: number, y: number, ang: number, len: number, w: number, depth: number) => {
    ctx.strokeStyle = `rgba(6,6,8,${0.5 - depth * 0.08})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 4 + Math.floor(r() * 3);
    let cx = x;
    let cy = y;
    for (let i = 0; i < segs; i++) {
      ang += (r() - 0.5) * 0.9;
      cx += Math.cos(ang) * (len / segs);
      cy += Math.sin(ang) * (len / segs);
      cx = Math.min(244, Math.max(12, cx));
      cy = Math.min(244, Math.max(12, cy));
      ctx.lineTo(cx, cy);
      if (depth < 2 && r() > 0.65) {
        ctx.stroke();
        branch(cx, cy, ang + (r() > 0.5 ? 1 : -1) * (0.6 + r() * 0.6), len * 0.5, Math.max(0.6, w * 0.6), depth + 1);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
      }
    }
    ctx.stroke();
  };
  branch(20, 128, 0.1, 210, 1.4, 0);
  branch(128, 40, 1.5, 150, 1.0, 1);
  ctx.restore();

  // --- (1,0) oil / dirt blot ---
  ctx.save();
  ctx.translate(256, 0);
  for (let i = 0; i < 9; i++) {
    const x = 128 + (r() - 0.5) * 90;
    const y = 128 + (r() - 0.5) * 70;
    const rad = 28 + r() * 45;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(10,8,6,${0.22 + r() * 0.15})`);
    g.addColorStop(0.6, 'rgba(14,12,10,0.1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  ctx.restore();

  // --- (0,1) repaired patch: darker fill, irregular edge, thin bright seam ---
  ctx.save();
  ctx.translate(0, 256);
  ctx.beginPath();
  const pts: [number, number][] = [];
  const w = 100;
  const h = 70;
  for (let i = 0; i < 22; i++) {
    const t = (i / 22) * Math.PI * 2;
    const ex = Math.cos(t);
    const ey = Math.sin(t);
    const sq = 1 / Math.max(Math.abs(ex), Math.abs(ey)); // square-ish
    const rr = 0.92 + r() * 0.12;
    pts.push([128 + ex * w * sq * rr * 0.98, 128 + ey * h * sq * rr * 0.98]);
  }
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
  ctx.closePath();
  ctx.fillStyle = 'rgba(4,4,6,0.42)';
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = 'rgba(120,122,128,0.28)';
  ctx.stroke();
  for (let i = 0; i < 700; i++) {
    const v = 20 + Math.floor(r() * 50);
    ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
    ctx.fillRect(128 + (r() - 0.5) * 190, 128 + (r() - 0.5) * 130, 1, 1);
  }
  ctx.restore();

  // --- (1,1) tyre grime streak (long axis = v) ---
  ctx.save();
  ctx.translate(256, 256);
  const g2 = ctx.createLinearGradient(0, 0, 256, 0);
  g2.addColorStop(0, 'rgba(0,0,0,0)');
  g2.addColorStop(0.28, 'rgba(8,8,8,0.55)');
  g2.addColorStop(0.5, 'rgba(8,8,8,0.7)');
  g2.addColorStop(0.72, 'rgba(8,8,8,0.55)');
  g2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 12, 256, 232);
  // fade along length
  ctx.globalCompositeOperation = 'destination-in';
  const g3 = ctx.createLinearGradient(0, 0, 0, 256);
  g3.addColorStop(0, 'rgba(0,0,0,0)');
  g3.addColorStop(0.2, 'rgba(0,0,0,1)');
  g3.addColorStop(0.8, 'rgba(0,0,0,1)');
  g3.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g3;
  ctx.fillRect(0, 0, 256, 256);
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(0,0,0,${r() * 0.25})`;
    ctx.fillRect(70 + r() * 120, 20 + r() * 216, 1, 2);
  }
  // solid white texel block used by untextured decals
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(256 - 16, 256 - 16, 16, 16);
  ctx.restore();

  });
  decalTex = finish(new THREE.CanvasTexture(canvas), false);
  decalTex.wrapS = decalTex.wrapT = THREE.ClampToEdgeWrapping;
  return decalTex;
}

/**
 * Weather-ready road surface parameters. Materials created by RoadBuilder register here so a future
 * weather system only has to call setWetness(0..1) (or setWeather) to darken + gloss every road.
 */
export class RoadSurface {
  private static mats: { mat: THREE.MeshStandardMaterial; baseColor: THREE.Color; baseRough: number }[] = [];
  private static wetness = 0;

  static register(mat: THREE.MeshStandardMaterial): void {
    this.mats.push({ mat, baseColor: mat.color.clone(), baseRough: mat.roughness });
    this.apply();
  }

  /** change the dry colour of a registered material (the texture level swaps images for flat colours) */
  static setBase(mat: THREE.MeshStandardMaterial, color: THREE.Color): void {
    const e = this.mats.find((m) => m.mat === mat);
    if (e) e.baseColor.copy(color);
    this.apply();
  }

  static setWetness(w: number): void {
    this.wetness = Math.min(1, Math.max(0, w));
    this.apply();
  }

  static getWetness(): number {
    return this.wetness;
  }

  private static apply(): void {
    for (const m of this.mats) {
      const darken = 1 - 0.38 * this.wetness;
      m.mat.color.copy(m.baseColor).multiplyScalar(darken);
      m.mat.roughness = THREE.MathUtils.lerp(m.baseRough, 0.22, this.wetness);
      m.mat.envMapIntensity = 0.2 + this.wetness * 1.1;
    }
  }
}
