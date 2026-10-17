import * as THREE from 'three';
import { rngFrom } from '../procedural/RoadTextures';
import { onTextureLevel, TEXTURE_SCALE, textureLevel, type TextureLevel } from '../graphics/GraphicsSettings';
import { copiesOf, releaseUnused, scaledTexture } from '../graphics/TextureDetail';

/**
 * Procedural facade / roof / railing / sign textures for every building of the city (cached, generated once).
 *
 * Each facade texture is a tile of 4 bays x 2 floors (12.8 m x 6.4 m) painted at FACADE_PPM pixels per metre, with
 *  - a colour map      (white wall + painted windows: the vertex colour of the box tints the wall),
 *  - a normal map      (frames, reveals, sills, mouldings, plaster grain, ribs: baked from a height map so the flat boxes catch the light like real masonry),
 *  - an emissive mask  (the lit windows at night, half resolution).
 * The bottom-left corner is kept plain wall so roofs and un-tiled pieces can sample (0.012, 0.012) safely.
 *
 * Window positions are part of the contract with BuildingKit / BuildingDetail (sills, lintels, balconies are modelled where
 * the texture paints the windows): see WIN below.
 */

export type FacadeKind = 'res' | 'com' | 'office' | 'shop' | 'roof' | 'grille' | 'fabric';

export const BAY = 3.2;
export const FLOOR = 3.2;
export const TILE_W = 12.8;
export const TILE_H = 6.4;
export const SHOP_TILE_W = 6.4;
export const SHOP_TILE_H = 3.2;
/** roof sheet texture: one tile = ROOF_TILE x ROOF_TILE metres (u across the slope, v up it) */
export const ROOF_TILE = 3.2;
/** canvas / parasol fabric texture: one tile = FABRIC_TILE x FABRIC_TILE metres */
export const FABRIC_TILE = 0.5;

/** where the painted windows sit inside a floor (metres above the floor line), for modelling sills / lintels / balconies on them */
export const WIN = {
  res: { w: 1.4, y0: 0.9, y1: 2.45 },
  com: { y0: 0.85, y1: 2.6 },
  shop: { y0: 0.4, y1: 2.25 },
} as const;

/** rows of the railing atlas (each row is one metre tall, one metre wide, tiles horizontally) */
export const GRILLE_ROW = { rail: 0, gate: 1, louvre: 2, mesh: 3 } as const;
export const GRILLE_ROWS = 4;

export const SIGN_TEXTS = [
  ['MAMA PUT & GRILL', '#b45309'],
  ['FRESH BAKERY', '#be185d'],
  ['CITY PHARMACY', '#15803d'],
  ['SUPERMART', '#1d4ed8'],
  ['GSM & ACCESSORIES', '#7c3aed'],
  ['FIRST UNITY BANK', '#0f4c81'],
  ['ELITE BARBERS', '#111827'],
  ['TASTY BITES', '#c2410c'],
] as const;

interface Tex {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture | null;
  /** relief map: only built (lazily, see normalOf) when the texture level is High or Ultra, so low settings never pay for it */
  normal: THREE.CanvasTexture | null;
  normalLazy: (() => THREE.CanvasTexture) | null;
}

function normalOf(t: Tex): THREE.CanvasTexture | null {
  if (!t.normal && t.normalLazy) t.normal = t.normalLazy();
  return t.normal;
}

/** pixels per metre of the facade textures (80 -> a 1024 x 512 tile) */
export const FACADE_PPM = 80;

const cache: Partial<Record<FacadeKind, Tex>> = {};
let signPair: { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } | null = null;
const mats: Partial<Record<FacadeKind | 'sign', THREE.MeshLambertMaterial>> = {};

function mkCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function tex(c: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------------------------------------
// painting toolkit: everything is drawn in metres (x from the left, y UP from the bottom of the tile)
// ------------------------------------------------------------------------------------------------

interface Layers {
  /** colour */
  m: CanvasRenderingContext2D;
  /** emissive (half resolution; the context is pre-scaled so it is drawn in the same pixel units as the others) */
  e: CanvasRenderingContext2D;
  /** height: 128 = the wall surface, lower = recessed, higher = proud */
  h: CanvasRenderingContext2D;
  mc: HTMLCanvasElement;
  ec: HTMLCanvasElement;
  hc: HTMLCanvasElement;
  S: number;
  W: number;
  H: number;
}

function layers(wM: number, hM: number, S: number): Layers {
  const W = Math.round(wM * S);
  const H = Math.round(hM * S);
  const [mc, m] = mkCanvas(W, H);
  const [ec, e] = mkCanvas(W >> 1, H >> 1);
  const [hc, h] = mkCanvas(W, H);
  e.scale(0.5, 0.5);
  m.fillStyle = '#ffffff';
  m.fillRect(0, 0, W, H);
  e.fillStyle = '#000000';
  e.fillRect(0, 0, W, H);
  h.fillStyle = 'rgb(128,128,128)';
  h.fillRect(0, 0, W, H);
  return { m, e, h, mc, ec, hc, S, W, H };
}

/** fill a rectangle given in metres (x, y = its bottom-left corner, y up) */
function fr(L: Layers, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, style: string | CanvasGradient): void {
  ctx.fillStyle = style;
  ctx.fillRect(x * L.S, L.H - (y + h) * L.S, w * L.S, h * L.S);
}
const grey = (v: number): string => `rgb(${v | 0},${v | 0},${v | 0})`;
/** raise / sink a rectangle in the height map */
function hr(L: Layers, x: number, y: number, w: number, h: number, v: number): void {
  fr(L, L.h, x, y, w, h, grey(v));
}
/** vertical gradient between two y values in metres (y0 bottom colour c0, y1 top colour c1) */
function vgrad(L: Layers, ctx: CanvasRenderingContext2D, y0: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(0, L.H - y0 * L.S, 0, L.H - y1 * L.S);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

/** plaster / render: fine mottling + broad soft stains + grain in the height map */
function plaster(L: Layers, r: () => number, amount: number): void {
  const { m, h, W, H } = L;
  const n = Math.round((W * H) / 330);
  for (let i = 0; i < n; i++) {
    const v = 140 + ((r() * 90) | 0);
    m.fillStyle = `rgba(${v},${v - 6},${v - 14},${amount})`;
    m.fillRect(r() * W, r() * H, 1 + r() * 4, 1 + r() * 3);
  }
  for (let i = 0; i < 38; i++) {
    const x = r() * W;
    const y = r() * H;
    const rad = 30 + r() * 80;
    const g = m.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.6;
    g.addColorStop(0, dark ? 'rgba(90,80,65,0.09)' : 'rgba(255,255,250,0.10)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    m.fillStyle = g;
    m.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const hn = Math.round((W * H) / 260);
  for (let i = 0; i < hn; i++) {
    const v = 122 + ((r() * 12) | 0);
    h.fillStyle = grey(v);
    h.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
  }
}

/** a vertical rain / run-off streak hanging from (x, yTop) */
function streak(L: Layers, r: () => number, x: number, yTop: number, len: number, wM: number, a: number): void {
  const g = vgrad(L, L.m, yTop, yTop - len, [[0, `rgba(70,62,52,${a})`], [0.6, `rgba(70,62,52,${a * 0.5})`], [1, 'rgba(70,62,52,0)']]);
  fr(L, L.m, x, yTop - len, wM, len, g);
}

/** warm lit window mask (emissive) */
const WARM = ['#ffd98a', '#ffe7b0', '#ffcf70', '#fff1cc'];

/** normal map from the height canvas (wraps at the edges so the tile is seamless) */
function normalMap(L: Layers, strength: number): HTMLCanvasElement {
  const { W, H } = L;
  const src = L.h.getImageData(0, 0, W, H).data;
  const hgt = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) hgt[i] = src[i * 4];
  // one pass of 3x3 blur so the 1 px steps become short bevels
  const bl = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = ((y - 1 + H) % H) * W;
    const y1 = y * W;
    const y2 = ((y + 1) % H) * W;
    for (let x = 0; x < W; x++) {
      const xl = (x - 1 + W) % W;
      const xr = (x + 1) % W;
      bl[y1 + x] = (hgt[y0 + xl] + hgt[y0 + x] + hgt[y0 + xr] + hgt[y1 + xl] + 2 * hgt[y1 + x] + hgt[y1 + xr] + hgt[y2 + xl] + hgt[y2 + x] + hgt[y2 + xr]) / 10;
    }
  }
  const [nc, nx] = mkCanvas(W, H);
  const out = nx.createImageData(W, H);
  const o = out.data;
  const k = strength * 0.045;
  for (let y = 0; y < H; y++) {
    const ya = ((y - 1 + H) % H) * W;
    const yb = ((y + 1) % H) * W;
    const yc = y * W;
    for (let x = 0; x < W; x++) {
      const xl = (x - 1 + W) % W;
      const xr = (x + 1) % W;
      const dx = (bl[yc + xr] - bl[yc + xl]) * k;
      const dy = (bl[yb + x] - bl[ya + x]) * k; // canvas y runs down = v runs up the other way, so +dy is already "up"
      const il = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (yc + x) * 4;
      o[i] = ((-dx * il) * 0.5 + 0.5) * 255;
      o[i + 1] = (dy * il * 0.5 + 0.5) * 255;
      o[i + 2] = (il * 0.5 + 0.5) * 255;
      o[i + 3] = 255;
    }
  }
  nx.putImageData(out, 0, 0);
  return nc;
}

/** keep the bottom-left 0.3 m square plain (roofs / un-tiled pieces sample (0.012, 0.012) of the tile) */
function plainCorner(L: Layers): void {
  fr(L, L.m, 0, 0, 0.3, 0.3, '#ffffff');
  fr(L, L.e, 0, 0, 0.3, 0.3, '#000000');
  hr(L, 0, 0, 0.3, 0.3, 128);
}

function finish(L: Layers, strength: number, withNormal = true): Tex {
  plainCorner(L);
  return { map: tex(L.mc), emissive: tex(L.ec), normal: null, normalLazy: withNormal ? () => tex(normalMap(L, strength), true, false) : null };
}

// ------------------------------------------------------------------------------------------------
// glass
// ------------------------------------------------------------------------------------------------

/** daylight glass: sky reflected high up, dark room below, with a diagonal glint */
function glassPane(L: Layers, r: () => number, x: number, y: number, w: number, h: number, tone = 0.5): void {
  const { m } = L;
  const t = tone;
  const g = vgrad(L, m, y, y + h, [
    [0, `rgb(${22 + t * 24},${34 + t * 30},${46 + t * 36})`],
    [0.55, `rgb(${40 + t * 36},${64 + t * 40},${88 + t * 46})`],
    [1, `rgb(${120 + t * 30},${158 + t * 28},${190 + t * 24})`],
  ]);
  fr(L, m, x, y, w, h, g);
  // glint: a soft diagonal band
  m.save();
  m.beginPath();
  m.rect(x * L.S, L.H - (y + h) * L.S, w * L.S, h * L.S);
  m.clip();
  const gx = (x + w * (0.15 + r() * 0.5)) * L.S;
  const gy = L.H - (y + h) * L.S;
  m.fillStyle = 'rgba(255,255,255,0.10)';
  m.beginPath();
  m.moveTo(gx, gy);
  m.lineTo(gx + w * L.S * 0.28, gy);
  m.lineTo(gx - w * L.S * 0.2, gy + h * L.S);
  m.lineTo(gx - w * L.S * 0.48, gy + h * L.S);
  m.closePath();
  m.fill();
  m.restore();
}

/** a lit room seen through the pane at night (emissive) with a ceiling light spill */
function litRoom(L: Layers, r: () => number, x: number, y: number, w: number, h: number): void {
  const { e } = L;
  fr(L, e, x, y, w, h, WARM[(r() * 4) | 0]);
  const g = vgrad(L, e, y, y + h, [[0, 'rgba(0,0,0,0.35)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(255,255,255,0.25)']]);
  fr(L, e, x, y, w, h, g);
}

function curtain(L: Layers, r: () => number, x: number, y: number, w: number, h: number, pull: number): void {
  const { m, e } = L;
  const col = ['#e9d8a6', '#d9a5b3', '#a8c5da', '#c9b8e0', '#cfd8b0', '#e8c9a0'][(r() * 6) | 0];
  m.globalAlpha = 0.9;
  fr(L, m, x, y, w * pull, h, col);
  fr(L, m, x + w * (1 - pull), y, w * pull, h, col);
  // folds
  m.fillStyle = 'rgba(0,0,0,0.12)';
  for (let k = 0; k < 6; k++) {
    m.fillRect((x + (k / 6) * w * pull) * L.S, L.H - (y + h) * L.S, 2, h * L.S);
    m.fillRect((x + w * (1 - pull) + (k / 6) * w * pull) * L.S, L.H - (y + h) * L.S, 2, h * L.S);
  }
  m.globalAlpha = 1;
  e.globalAlpha = 0.55;
  fr(L, e, x, y, w * pull, h, 'rgba(0,0,0,0.5)');
  fr(L, e, x + w * (1 - pull), y, w * pull, h, 'rgba(0,0,0,0.5)');
  e.globalAlpha = 1;
}

function blinds(L: Layers, x: number, y: number, w: number, h: number, drop: number): void {
  const { m, h: hh } = L;
  const hd = h * drop;
  fr(L, m, x, y + h - hd, w, hd, 'rgba(236,234,226,0.92)');
  for (let yy = y + h - 0.045; yy > y + h - hd; yy -= 0.045) {
    fr(L, m, x, yy, w, 0.008, 'rgba(120,118,110,0.55)');
    fr(L, hh, x, yy, w, 0.008, grey(120));
  }
}

/** iron burglar-proof grille: frame, bars, a scroll motif (the very common local window guard) */
function grille(L: Layers, x: number, y: number, w: number, h: number, col = '#202327'): void {
  const { m, h: hh } = L;
  const t = 0.022;
  const bars = Math.round(w / 0.11);
  for (let i = 0; i <= bars; i++) {
    const bx = x + (i / bars) * (w - t);
    fr(L, m, bx, y, t, h, col);
    fr(L, hh, bx, y, t, h, grey(172));
  }
  for (const f of [0.04, 0.5, 0.96]) {
    const by = y + f * (h - t);
    fr(L, m, x, by, w, t * 1.3, col);
    fr(L, hh, x, by, w, t * 1.3, grey(176));
  }
  // scroll ring in the middle
  m.strokeStyle = col;
  m.lineWidth = Math.max(2, t * L.S);
  m.beginPath();
  m.arc((x + w / 2) * L.S, L.H - (y + h / 2) * L.S, Math.min(w, h) * 0.2 * L.S, 0, Math.PI * 2);
  m.stroke();
  hh.strokeStyle = grey(172);
  hh.lineWidth = Math.max(2, t * L.S);
  hh.beginPath();
  hh.arc((x + w / 2) * L.S, L.H - (y + h / 2) * L.S, Math.min(w, h) * 0.2 * L.S, 0, Math.PI * 2);
  hh.stroke();
}

/** louvre ("jalousie") window: stacked glass slats */
function jalousie(L: Layers, x: number, y: number, w: number, h: number): void {
  const { m, h: hh } = L;
  for (let yy = y; yy < y + h - 0.02; yy += 0.095) {
    fr(L, m, x, yy, w, 0.06, 'rgba(170,200,215,0.85)');
    fr(L, m, x, yy + 0.06, w, 0.012, 'rgba(25,40,52,0.8)');
    fr(L, hh, x, yy, w, 0.07, grey(118));
    fr(L, hh, x, yy + 0.06, w, 0.012, grey(100));
  }
}

// ------------------------------------------------------------------------------------------------
// residential: plaster walls with painted, recessed windows
// ------------------------------------------------------------------------------------------------

function paintRes(L: Layers, r: () => number): void {
  const { m, e, h } = L;
  plaster(L, r, 0.075);
  for (let fl = 0; fl < 2; fl++) {
    const base = fl * FLOOR;
    for (let b = 0; b < 4; b++) {
      const cx = b * BAY + BAY / 2;
      const x0 = cx - WIN.res.w / 2;
      const y0 = base + WIN.res.y0;
      const w = WIN.res.w;
      const hh = WIN.res.y1 - WIN.res.y0;
      // run-off streaks under the sill (painted first so the sill covers their start)
      for (let k = 0; k < 3; k++) streak(L, r, x0 + 0.1 + r() * (w - 0.3), y0 - 0.06, 0.7 + r() * 0.9, 0.025 + r() * 0.05, 0.14 + r() * 0.1);
      // opening: dark reveal ring, recessed
      hr(L, x0 - 0.05, y0 - 0.05, w + 0.1, hh + 0.1, 88);
      fr(L, m, x0 - 0.05, y0 - 0.05, w + 0.1, hh + 0.1, 'rgba(36,32,28,0.55)');
      // frame
      fr(L, m, x0, y0, w, hh, '#f3f3ef');
      hr(L, x0, y0, w, hh, 112);
      const style = r();
      const gx = x0 + 0.06;
      const gy = y0 + 0.06;
      const gw = w - 0.12;
      const gh = hh - 0.12;
      if (style < 0.22) {
        // jalousie
        fr(L, m, gx, gy, gw, gh, '#1d2a35');
        jalousie(L, gx, gy, gw, gh);
        hr(L, gx, gy, gw, gh, 106);
      } else {
        glassPane(L, r, gx, gy, gw, gh, r());
        hr(L, gx, gy, gw, gh, 100);
        const c = r();
        if (c < 0.3) curtain(L, r, gx, gy, gw, gh, 0.28 + r() * 0.5);
        else if (c < 0.46) blinds(L, gx, gy, gw, gh, 0.25 + r() * 0.6);
        // mullion / transom
        fr(L, m, cx - 0.025, y0, 0.05, hh, '#f3f3ef');
        hr(L, cx - 0.025, y0, 0.05, hh, 118);
        if (r() < 0.5) {
          fr(L, m, x0, y0 + hh * 0.72, w, 0.045, '#f3f3ef');
          hr(L, x0, y0 + hh * 0.72, w, 0.045, 118);
        }
      }
      // inner shadow under the lintel and down the left jamb (the sun is high and a little to the left)
      fr(L, m, gx, gy + gh - 0.1, gw, 0.1, vgrad(L, m, gy + gh - 0.1, gy + gh, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.30)']]));
      fr(L, m, gx, gy, 0.06, gh, 'rgba(0,0,0,0.16)');
      // burglar bars
      const kind = r();
      if (kind < 0.34) grille(L, x0 - 0.02, y0 - 0.02, w + 0.04, hh + 0.04);
      else if (kind < 0.46) {
        // wooden shutters, folded open
        for (const sx of [-1, 1]) {
          const px = sx < 0 ? x0 - 0.46 : x0 + w + 0.03;
          fr(L, m, px, y0 - 0.03, 0.43, hh + 0.06, '#7a5636');
          hr(L, px, y0 - 0.03, 0.43, hh + 0.06, 138);
          for (let yy = y0; yy < y0 + hh; yy += 0.07) {
            fr(L, m, px + 0.04, yy, 0.35, 0.012, 'rgba(0,0,0,0.35)');
            fr(L, h, px + 0.04, yy, 0.35, 0.012, grey(120));
          }
        }
      }
      // lintel band + sill
      fr(L, m, x0 - 0.12, y0 + hh + 0.05, w + 0.24, 0.1, '#e9e8e2');
      hr(L, x0 - 0.12, y0 + hh + 0.05, w + 0.24, 0.1, 140);
      fr(L, m, x0 - 0.12, y0 - 0.14, w + 0.24, 0.09, '#ecebe5');
      hr(L, x0 - 0.12, y0 - 0.14, w + 0.24, 0.09, 142);
      fr(L, m, x0 - 0.12, y0 - 0.19, w + 0.24, 0.05, 'rgba(0,0,0,0.25)');
      // night
      if (r() < 0.45) litRoom(L, r, gx, gy, gw, gh);
    }
    // slab line: a shallow groove
    fr(L, m, 0, base, L.W / L.S, 0.035, 'rgba(70,64,56,0.4)');
    hr(L, 0, base, L.W / L.S, 0.035, 104);
    fr(L, m, 0, base + 0.035, L.W / L.S, 0.03, 'rgba(255,255,255,0.18)');
  }
  void e;
}

// ------------------------------------------------------------------------------------------------
// commercial: continuous ribbon glazing between spandrel panels
// ------------------------------------------------------------------------------------------------

function paintCom(L: Layers, r: () => number): void {
  const { m, h } = L;
  plaster(L, r, 0.04);
  const cells = 8;
  const cw = TILE_W / cells; // 1.6 m
  for (let fl = 0; fl < 2; fl++) {
    const base = fl * FLOOR;
    // spandrel panel: light cladding with panel joints
    fr(L, m, 0, base, TILE_W, FLOOR, '#dcdfe2');
    for (let k = 0; k < cells; k++) {
      const px = k * cw;
      fr(L, m, px + 0.02, base + 0.04, cw - 0.04, WIN.com.y0 - 0.1, 'rgba(255,255,255,0.18)');
      fr(L, m, px + 0.02, base + WIN.com.y1 + 0.08, cw - 0.04, FLOOR - WIN.com.y1 - 0.12, 'rgba(255,255,255,0.12)');
      hr(L, px + 0.02, base + 0.04, cw - 0.04, WIN.com.y0 - 0.1, 132);
      hr(L, px + 0.02, base + WIN.com.y1 + 0.08, cw - 0.04, FLOOR - WIN.com.y1 - 0.12, 132);
    }
    // glazed ribbon, recessed
    const gy = base + WIN.com.y0;
    const gh = WIN.com.y1 - WIN.com.y0;
    hr(L, 0, gy - 0.05, TILE_W, gh + 0.1, 92);
    fr(L, m, 0, gy - 0.05, TILE_W, gh + 0.1, 'rgba(30,34,40,0.5)');
    fr(L, m, 0, gy, TILE_W, gh, '#eef0f2');
    hr(L, 0, gy, TILE_W, gh, 112);
    for (let k = 0; k < cells; k++) {
      const px = k * cw;
      glassPane(L, r, px + 0.05, gy + 0.05, cw - 0.1, gh - 0.1, r());
      hr(L, px + 0.05, gy + 0.05, cw - 0.1, gh - 0.1, 100);
      const c = r();
      if (c < 0.22) blinds(L, px + 0.05, gy + 0.05, cw - 0.1, gh - 0.1, 0.2 + r() * 0.6);
      else if (c < 0.3) curtain(L, r, px + 0.05, gy + 0.05, cw - 0.1, gh - 0.1, 0.3);
      // fanlight transom
      fr(L, m, px, gy + gh * 0.78, cw, 0.04, '#eef0f2');
      hr(L, px, gy + gh * 0.78, cw, 0.04, 120);
      // mullion
      fr(L, m, px - 0.03, gy, 0.06, gh, '#eef0f2');
      hr(L, px - 0.03, gy, 0.06, gh, 122);
      fr(L, m, px - 0.03, gy, 0.06, gh, 'rgba(0,0,0,0.0)');
      if (r() < 0.42) litRoom(L, r, px + 0.05, gy + 0.05, cw - 0.1, gh - 0.1);
    }
    // shadow lines: sill and head of the ribbon, slab edge groove
    fr(L, m, 0, gy + gh, TILE_W, 0.12, vgrad(L, m, gy + gh, gy + gh + 0.12, [[0, 'rgba(0,0,0,0.30)'], [1, 'rgba(0,0,0,0)']]));
    fr(L, m, 0, gy - 0.1, TILE_W, 0.05, 'rgba(0,0,0,0.25)');
    fr(L, m, 0, base, TILE_W, 0.04, 'rgba(0,0,0,0.30)');
    hr(L, 0, base, TILE_W, 0.04, 100);
    // run-off from the sill
    for (let k = 0; k < 10; k++) streak(L, r, r() * TILE_W, gy - 0.08, 0.5 + r() * 0.5, 0.03 + r() * 0.05, 0.12);
  }
  void h;
}

// ------------------------------------------------------------------------------------------------
// office: curtain wall with spandrel bands and varied glass
// ------------------------------------------------------------------------------------------------

function paintOffice(L: Layers, r: () => number): void {
  const { m, h } = L;
  const cell = 1.6;
  const cols = Math.round(TILE_W / cell);
  const rows = Math.round(TILE_H / cell);
  const tones: [string, string, string][] = [
    ['#1f3a52', '#3c6585', '#8fb4cf'],
    ['#1b3b47', '#34647a', '#86b4c2'],
    ['#26364a', '#475f80', '#9db1cc'],
    ['#243a40', '#3f6568', '#93b7b5'],
  ];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = cx * cell;
      const y = cy * cell;
      const t = tones[(r() * tones.length) | 0];
      const g = vgrad(L, m, y, y + cell, [[0, t[0]], [0.55, t[1]], [1, t[2]]]);
      fr(L, m, x, y, cell, cell, g);
      // faint reflection of a neighbouring building
      if (r() < 0.25) fr(L, m, x + r() * cell * 0.5, y + 0.1, cell * (0.2 + r() * 0.3), cell * (0.3 + r() * 0.5), 'rgba(255,255,255,0.07)');
      if (r() < 0.12) blinds(L, x + 0.03, y + 0.03, cell - 0.06, cell - 0.06, 0.3 + r() * 0.6);
      hr(L, x, y, cell, cell, 106);
      if (r() < 0.38) {
        litRoom(L, r, x + 0.04, y + 0.04, cell - 0.08, cell - 0.08);
        // ceiling light strip
        fr(L, L.e, x + 0.2, y + cell - 0.2, cell - 0.4, 0.06, 'rgba(255,255,255,0.8)');
      }
      // spandrel: opaque band on the lower part of each floor
      if (cy % 2 === 0) {
        fr(L, m, x, y, cell, 0.55, '#475463');
        fr(L, m, x, y + 0.55, cell, 0.05, 'rgba(0,0,0,0.45)');
        fr(L, L.e, x, y, cell, 0.58, '#000000');
        hr(L, x, y, cell, 0.55, 118);
      }
    }
  }
  // mullions + transoms: raised, a little lighter than the glass
  for (let cx = 0; cx <= cols; cx++) {
    fr(L, m, cx * cell - 0.03, 0, 0.06, TILE_H, '#c3cbd3');
    hr(L, cx * cell - 0.03, 0, 0.06, TILE_H, 150);
    fr(L, m, cx * cell + 0.03, 0, 0.012, TILE_H, 'rgba(0,0,0,0.3)');
  }
  for (let cy = 0; cy <= rows; cy++) {
    fr(L, m, 0, cy * cell - 0.03, TILE_W, 0.06, '#c3cbd3');
    hr(L, 0, cy * cell - 0.03, TILE_W, 0.06, 150);
  }
  // floor-slab edge line
  for (let fl = 0; fl < 2; fl++) {
    fr(L, m, 0, fl * FLOOR - 0.04, TILE_W, 0.08, '#aeb6bd');
    hr(L, 0, fl * FLOOR - 0.04, TILE_W, 0.08, 154);
  }
  void h;
}

// ------------------------------------------------------------------------------------------------
// shop: storefront, 2 bays x 1 floor
// ------------------------------------------------------------------------------------------------

function paintShop(L: Layers, r: () => number): void {
  const { m, h } = L;
  plaster(L, r, 0.06);
  // sign band stays clean (near white so the vertex colour tints it) with a cornice under it
  fr(L, m, 0, 2.55, SHOP_TILE_W, 0.65, '#f6f6f6');
  fr(L, m, 0, 2.5, SHOP_TILE_W, 0.05, 'rgba(0,0,0,0.3)');
  hr(L, 0, 2.5, SHOP_TILE_W, 0.06, 150);
  hr(L, 0, 2.55, SHOP_TILE_W, 0.65, 134);
  // stallboard: tiled plinth
  fr(L, m, 0, 0, SHOP_TILE_W, 0.4, '#b9b3a6');
  for (let x = 0; x < SHOP_TILE_W; x += 0.4) {
    fr(L, m, x, 0, 0.012, 0.4, 'rgba(0,0,0,0.35)');
    hr(L, x, 0, 0.012, 0.4, 112);
  }
  fr(L, m, 0, 0.18, SHOP_TILE_W, 0.012, 'rgba(0,0,0,0.3)');
  fr(L, m, 0, 0.4, SHOP_TILE_W, 0.025, 'rgba(0,0,0,0.4)');
  // two glazed windows and the door
  const wins: [number, number][] = [[0.25, 2.4], [3.75, 2.4]];
  const shutterSide = r() > 0.5 ? 1 : 0;
  wins.forEach(([x, w], i) => {
    const y = WIN.shop.y0 + 0.05;
    const hh = WIN.shop.y1 - WIN.shop.y0 - 0.05;
    hr(L, x - 0.05, y - 0.05, w + 0.1, hh + 0.1, 92);
    fr(L, m, x - 0.05, y - 0.05, w + 0.1, hh + 0.1, 'rgba(30,30,30,0.5)');
    fr(L, m, x, y, w, hh, '#3a3f46');
    hr(L, x, y, w, hh, 112);
    if (i === shutterSide) {
      // roller shutter pulled down: slats
      fr(L, m, x + 0.04, y + 0.04, w - 0.08, hh - 0.08, '#8a9096');
      for (let yy = y + 0.05; yy < y + hh - 0.05; yy += 0.065) {
        fr(L, m, x + 0.04, yy, w - 0.08, 0.012, 'rgba(0,0,0,0.38)');
        fr(L, h, x + 0.04, yy, w - 0.08, 0.02, grey(106));
        fr(L, m, x + 0.04, yy + 0.02, w - 0.08, 0.008, 'rgba(255,255,255,0.18)');
      }
      for (let k = 0; k < 4; k++) streak(L, r, x + r() * w, y + hh, 0.4 + r() * 0.5, 0.03, 0.2);
      fr(L, m, x + w * 0.45, y + 0.08, 0.16, 0.05, '#2a2c30');
    } else {
      glassPane(L, r, x + 0.05, y + 0.05, w - 0.1, hh - 0.1, 0.4 + r() * 0.3);
      hr(L, x + 0.05, y + 0.05, w - 0.1, hh - 0.1, 100);
      // goods / posters seen through the glass
      for (let k = 0; k < 4; k++) {
        const px = x + 0.15 + r() * (w - 0.7);
        const col = ['#d94f4f', '#e8b43c', '#4f8fd9', '#58b368', '#c05fd0'][(r() * 5) | 0];
        fr(L, m, px, y + 0.08 + r() * 0.8, 0.28 + r() * 0.3, 0.2 + r() * 0.35, col);
      }
      // mullions
      const panes = Math.round(w / 0.8);
      for (let k = 1; k < panes; k++) {
        const mx = x + (k / panes) * w;
        fr(L, m, mx - 0.03, y, 0.06, hh, '#2e3238');
        hr(L, mx - 0.03, y, 0.06, hh, 140);
      }
      fr(L, m, x, y + hh - 0.05, w, 0.05, 'rgba(0,0,0,0.28)');
      litRoom(L, r, x + 0.06, y + 0.06, w - 0.12, hh - 0.12);
    }
    // metal frame
    fr(L, m, x - 0.02, y + hh, w + 0.04, 0.04, '#d9d9d9');
    hr(L, x - 0.02, y + hh, w + 0.04, 0.04, 144);
  });
  // door
  fr(L, m, 2.76, 0, 0.98, 2.3, '#2d3137');
  hr(L, 2.76, 0, 0.98, 2.3, 112);
  glassPane(L, r, 2.84, 0.5, 0.82, 1.7, 0.45);
  hr(L, 2.84, 0.5, 0.82, 1.7, 102);
  fr(L, m, 3.5, 1.0, 0.04, 0.4, '#c9ced3');
  hr(L, 3.5, 1.0, 0.04, 0.4, 160);
  fr(L, m, 2.84, 0.04, 0.82, 0.44, '#41464d');
  litRoom(L, r, 2.86, 0.52, 0.78, 1.66);
  // little "OPEN" board beside the door
  fr(L, m, 3.86, 1.45, 0.34, 0.2, '#cc2f2f');
  fr(L, L.e, 3.86, 1.45, 0.34, 0.2, 'rgba(255,120,120,0.9)');
  void h;
}

// ------------------------------------------------------------------------------------------------
// roofing: long-span trapezoid-rib sheet (stone grey, tinted by the vertex colour)
// ------------------------------------------------------------------------------------------------

function paintRoof(S: number): Tex {
  const L = layers(ROOF_TILE, ROOF_TILE, S);
  const r = rngFrom(4242);
  const { m, h, W, H } = L;
  const rib = 0.25; // rib pitch (m)
  const nrib = Math.round(ROOF_TILE / rib);
  fr(L, m, 0, 0, ROOF_TILE, ROOF_TILE, '#cfcfcc');
  for (let k = 0; k < nrib; k++) {
    const x = k * rib;
    // flat pan (low), sloping flanks, raised flat top
    hr(L, x, 0, rib, ROOF_TILE, 104);
    hr(L, x + rib * 0.2, 0, rib * 0.6, ROOF_TILE, 152);
    fr(L, m, x + rib * 0.2, 0, rib * 0.6, ROOF_TILE, 'rgba(255,255,255,0.14)');
    fr(L, m, x, 0, rib * 0.14, ROOF_TILE, 'rgba(0,0,0,0.22)');
    fr(L, m, x + rib * 0.86, 0, rib * 0.14, ROOF_TILE, 'rgba(0,0,0,0.12)');
  }
  // weathering: vertical streaks and dirt in the pans
  for (let i = 0; i < 120; i++) {
    const x = r() * ROOF_TILE;
    fr(L, m, x, r() * ROOF_TILE, 0.02 + r() * 0.05, 0.3 + r() * 1.2, `rgba(${r() < 0.5 ? '70,60,50' : '255,255,250'},${0.05 + r() * 0.08})`);
  }
  // fasteners on the rib tops, a lap line across the sheet
  m.fillStyle = 'rgba(40,40,40,0.65)';
  for (let k = 0; k < nrib; k++) for (let y = 0.2; y < ROOF_TILE; y += 0.8) m.fillRect((k * rib + rib / 2) * S - 2, H - y * S - 2, 4, 4);
  fr(L, m, 0, 0.012, ROOF_TILE, 0.02, 'rgba(0,0,0,0.3)');
  hr(L, 0, 0, ROOF_TILE, 0.025, 160);
  void h;
  void W;
  return { map: tex(L.mc), emissive: null, normal: null, normalLazy: () => tex(normalMap(L, 1.1), true, false) };
}

// ------------------------------------------------------------------------------------------------
// railing / gate / louvre atlas: white shapes on transparent, alpha-tested, tinted by the vertex colour
// ------------------------------------------------------------------------------------------------

function paintGrille(): Tex {
  const S = 128; // px per metre
  const [c, g] = mkCanvas(S, S * GRILLE_ROWS);
  g.clearRect(0, 0, S, S * GRILLE_ROWS);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  // canvas row i (from the top); texture v = 1 - (i + 1) / ROWS .. 1 - i / ROWS (flipY)
  const rowTop = (row: number) => (GRILLE_ROWS - 1 - row) * S;
  const bar = (row: number, x: number, y: number, w: number, h: number) => g.fillRect(x * S, rowTop(row) + (1 - y - h) * S, w * S, h * S);

  // 0: balcony railing (1 m tall): top and bottom rails, balusters every 0.125 m, a ring every 0.5 m
  {
    const row = GRILLE_ROW.rail;
    bar(row, 0, 0.94, 1, 0.06);
    bar(row, 0, 0.0, 1, 0.07);
    bar(row, 0, 0.3, 1, 0.04);
    for (let k = 0; k < 8; k++) bar(row, k * 0.125 + 0.045, 0.06, 0.04, 0.88); // 5 px wide so they survive mip-mapping and the alpha test
    g.lineWidth = 3;
    for (const cx of [0.25, 0.75]) {
      g.beginPath();
      g.arc(cx * S, rowTop(row) + 0.62 * S, 0.1 * S, 0, Math.PI * 2);
      g.stroke();
    }
  }
  // 1: gate: tall bars with rails and spear tips
  {
    const row = GRILLE_ROW.gate;
    for (const y of [0.06, 0.5, 0.86]) bar(row, 0, y, 1, 0.045);
    for (let k = 0; k < 10; k++) {
      const x = k * 0.1 + 0.04;
      bar(row, x, 0.0, 0.04, 0.94);
      g.beginPath();
      g.moveTo((x - 0.02) * S, rowTop(row) + 0.07 * S);
      g.lineTo((x + 0.013) * S, rowTop(row));
      g.lineTo((x + 0.046) * S, rowTop(row) + 0.07 * S);
      g.closePath();
      g.fill();
    }
  }
  // 2: louvres: opaque slats with dark gaps (nothing behind them, so no transparency)
  {
    const row = GRILLE_ROW.louvre;
    g.fillStyle = '#9a9a9a';
    g.fillRect(0, rowTop(row), S, S);
    g.fillStyle = '#ffffff';
    for (let k = 0; k < 10; k++) {
      const y = k * 0.1;
      g.fillRect(0, rowTop(row) + (1 - y - 0.075) * S, S, 0.075 * S);
    }
    g.fillStyle = '#5a5a5a';
    for (let k = 0; k < 10; k++) g.fillRect(0, rowTop(row) + (1 - k * 0.1 - 0.1) * S, S, 0.012 * S);
    g.fillStyle = '#ffffff';
  }
  // 3: wire mesh / diamond lattice
  {
    const row = GRILLE_ROW.mesh;
    g.lineWidth = 2;
    for (let k = -8; k <= 16; k++) {
      g.beginPath();
      g.moveTo(k * 0.125 * S, rowTop(row));
      g.lineTo((k + 8) * 0.125 * S, rowTop(row) + S);
      g.moveTo((k + 8) * 0.125 * S, rowTop(row));
      g.lineTo(k * 0.125 * S, rowTop(row) + S);
      g.stroke();
    }
    bar(row, 0, 0.97, 1, 0.03);
    bar(row, 0, 0, 1, 0.03);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { map: t, emissive: null, normal: null, normalLazy: null };
}


// ------------------------------------------------------------------------------------------------
// canvas fabric (parasols, awnings): woven threads + slub + tiny mottling, light grey so the vertex colour sets the dye
// ------------------------------------------------------------------------------------------------

function paintFabric(): Tex {
  const S = 256;
  const L = layers(FABRIC_TILE, FABRIC_TILE, S);
  const r = rngFrom(777);
  const { m, h, W, H } = L;
  const cell = 2; // px per thread (about 0.8 cm)
  for (let y = 0; y < H; y += cell) {
    for (let x = 0; x < W; x += cell) {
      const over = ((x / cell) + (y / cell)) & 1; // plain weave: warp over / weft over, checkerboard
      const v = 236 + ((r() - 0.5) * 10 | 0) + (over ? 4 : -4);
      m.fillStyle = `rgb(${v},${v},${v})`;
      m.fillRect(x, y, cell, cell);
      // thread highlights (the long float of each thread) and the dark gap between threads
      h.fillStyle = over ? 'rgb(138,138,138)' : 'rgb(118,118,118)';
      h.fillRect(x, y, cell, cell);
      m.fillStyle = 'rgba(0,0,0,0.05)';
      m.fillRect(x, y, cell, 1);
    }
  }
  // slubs: a few thicker threads running along one direction
  for (let i = 0; i < 14; i++) {
    const y = ((r() * H) / cell | 0) * cell;
    m.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '90,80,70'},${0.06 + r() * 0.06})`;
    m.fillRect(0, y, W, cell);
    h.fillStyle = 'rgba(170,170,170,0.5)';
    h.fillRect(0, y, W, cell);
  }
  void m;
  return { map: tex(L.mc), emissive: null, normal: null, normalLazy: () => tex(normalMap(L, 0.7), true, false) };
}

// ------------------------------------------------------------------------------------------------

function build(kind: FacadeKind): Tex {
  if (kind === 'fabric') return paintFabric();
  if (kind === 'roof') return paintRoof(64);
  if (kind === 'grille') return paintGrille();
  const r = rngFrom(kind.length * 7919 + kind.charCodeAt(0));
  const S = FACADE_PPM;
  if (kind === 'shop') {
    const L = layers(SHOP_TILE_W, SHOP_TILE_H, S);
    paintShop(L, r);
    return finish(L, 1.0);
  }
  const L = layers(TILE_W, TILE_H, S);
  if (kind === 'res') paintRes(L, r);
  else if (kind === 'com') paintCom(L, r);
  else paintOffice(L, r);
  return finish(L, kind === 'office' ? 0.9 : 1.0);
}

export function getFacade(kind: FacadeKind): Tex {
  if (!cache[kind]) cache[kind] = build(kind);
  return cache[kind]!;
}

export function getSignAtlas(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  if (signPair) return signPair;
  const W = 512;
  const rowH = 64;
  const [mc, m] = mkCanvas(W, rowH * SIGN_TEXTS.length);
  const [ec, e] = mkCanvas(W, rowH * SIGN_TEXTS.length);
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, rowH * SIGN_TEXTS.length);
  SIGN_TEXTS.forEach(([text, bg], i) => {
    const y = i * rowH;
    m.fillStyle = bg;
    m.fillRect(0, y, W, rowH);
    m.strokeStyle = 'rgba(255,255,255,0.85)';
    m.lineWidth = 3;
    m.strokeRect(4, y + 4, W - 8, rowH - 8);
    m.fillStyle = '#ffffff';
    m.textAlign = 'center';
    m.textBaseline = 'middle';
    let size = 34;
    m.font = `bold ${size}px sans-serif`;
    while (m.measureText(text).width > W - 40 && size > 14) {
      size -= 2;
      m.font = `bold ${size}px sans-serif`;
    }
    m.fillText(text, W / 2, y + rowH / 2 + 2);
    e.fillStyle = 'rgba(255,255,255,0.9)';
    e.fillRect(8, y + 8, W - 16, rowH - 16);
  });
  signPair = { map: tex(mc, false), emissive: tex(ec, false) };
  return signPair;
}

/** UV rect for sign `i` in the atlas */
export function signUV(i: number): { v0: number; v1: number } {
  const n = SIGN_TEXTS.length;
  return { v0: 1 - (i + 1) / n, v1: 1 - i / n };
}

export function getFacadeMaterial(kind: FacadeKind | 'sign'): THREE.MeshLambertMaterial {
  if (!mats[kind]) {
    if (kind === 'sign') {
      const pair = getSignAtlas();
      mats[kind] = new THREE.MeshLambertMaterial({ map: pair.map, emissiveMap: pair.emissive, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0 });
    } else if (kind === 'roof') {
      const t = getFacade('roof');
      mats[kind] = new THREE.MeshLambertMaterial({ map: t.map, normalScale: new THREE.Vector2(1, 1), vertexColors: true });
    } else if (kind === 'fabric') {
      const t = getFacade('fabric');
      mats[kind] = new THREE.MeshLambertMaterial({ map: t.map, normalScale: new THREE.Vector2(0.6, 0.6), vertexColors: true, side: THREE.DoubleSide });
    } else if (kind === 'grille') {
      const t = getFacade('grille');
      mats[kind] = new THREE.MeshLambertMaterial({ map: t.map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
    } else {
      const t = getFacade(kind);
      mats[kind] = new THREE.MeshLambertMaterial({
        map: t.map,
        normalScale: new THREE.Vector2(1, 1),
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0,
        vertexColors: true,
      });
    }
    hookTextureLevel();
    applyKindLevel(kind, textureLevel());
  }
  return mats[kind]!;
}

// ------------------------------------------------------------------------------------------------
// texture quality: what each level puts on the facade materials (see TextureLevel in GraphicsSettings.ts)
//   Low    colour image at quarter size, nothing else (no relief, no lit windows)
//   Medium colour at half size + lit night windows, no relief
//   High / Ultra  everything at full size
// ------------------------------------------------------------------------------------------------
let facadeLevel: TextureLevel = 3;
let facadeNight = 0;
let hooked = false;

function hookTextureLevel(): void {
  if (hooked) return;
  hooked = true;
  onTextureLevel((lv) => applyFacadeLevel(lv));
}

function applyKindLevel(kind: FacadeKind | 'sign', lv: TextureLevel): void {
  const mat = mats[kind];
  if (!mat) return;
  if (kind === 'sign') return; // the sign atlas is small and its glow is the point of it: same at every level
  const t = getFacade(kind);
  const scale = TEXTURE_SCALE[lv];
  const alphaKind = kind === 'grille'; // alpha-tested bars: keep enough pixels for thin shapes
  const tiny = kind === 'fabric' || kind === 'roof'; // small repeating tiles: a quarter-size copy is already plenty
  mat.map = scaledTexture(t.map, alphaKind ? Math.max(scale, 0.5) : tiny ? Math.min(scale, 0.5) : scale);
  mat.normalMap = lv >= 2 ? normalOf(t) : null;
  mat.emissiveMap = lv >= 1 && t.emissive ? scaledTexture(t.emissive, 1) : null;
  mat.needsUpdate = true; // maps came or went: the shader is rebuilt once
}

function applyFacadeLevel(lv: TextureLevel): void {
  facadeLevel = lv;
  for (const k of Object.keys(mats) as (FacadeKind | 'sign')[]) applyKindLevel(k, lv);
  // free the GPU copy of everything no material uses now (full-size maps on Low, relief maps below High, ...)
  const used = new Set<THREE.Texture>();
  for (const k of Object.keys(mats) as (FacadeKind | 'sign')[]) {
    const m = mats[k]!;
    for (const x of [m.map, m.normalMap, m.emissiveMap]) if (x) used.add(x);
  }
  const all: THREE.Texture[] = [];
  for (const k of Object.keys(cache) as FacadeKind[]) {
    const t = cache[k]!;
    all.push(t.map, ...copiesOf(t.map));
    if (t.emissive) all.push(t.emissive);
    if (t.normal) all.push(t.normal);
  }
  releaseUnused(all, used);
  setFacadeNight(facadeNight);
}

/** 0 = day .. 1 = night: lights the windows and signs */
export function setFacadeNight(n: number): void {
  facadeNight = n;
  for (const k of Object.keys(mats) as (FacadeKind | 'sign')[]) {
    if (k === 'roof' || k === 'grille' || k === 'fabric') continue;
    // without its emissive map a facade would glow white all over, so the lit windows are off on Low
    const lit = k === 'sign' || facadeLevel >= 1;
    mats[k]!.emissiveIntensity = lit ? n * (k === 'sign' ? 0.9 : 0.85) : 0;
  }
}
