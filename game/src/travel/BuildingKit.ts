import type { OakSpec } from '../procedural/TerrainTrees';
import * as THREE from 'three';
import { GeoBatch, makeRng } from './Geo';
import { BAY, FLOOR, TILE_W, TILE_H, SHOP_TILE_W, SHOP_TILE_H, FacadeKind, SIGN_TEXTS, signUV, GRILLE_ROW } from './TravelMaterials';
import {
  TRIM, IRON, bx, shade, hipRoof, parapet, cornice, plinth, resWindowTrim, ribbonTrim, slabBands, balcony, roofDeck, stairHead, entrance,
  compoundWallNear, vendorStall, stripedAwning, shutterBox, containerBox, stoneBase, grillePanel, acUnit, waterTank, antenna,
} from './BuildingDetail';

/**
 * BuildingKit - exterior-only procedural building variants for the whole city.
 * Residential A-D, Commercial A-C, Office A-C, Shops A-E, all deterministic from the supplied rng.
 * Facades are tiled textures with baked relief (windows come from the texture; BuildingDetail models the sills, lintels, balconies,
 * railings, roofs, plant and gates on top of them); `near` adds the small parts (balconies, railings, AC units, tanks, signs,
 * compound walls and gates) that are skipped for far LOD chunks.
 *
 * Layout rule: kit.rng (the layout rng) is drawn in EXACTLY the same order as it always was, because the footprint planner
 * (world/CityBuildings.ts) dry-runs this code to learn every footprint. All new, purely cosmetic choices come from a detail rng
 * seeded by kit.seed, so a building looks the same in the near and far LOD and its footprint never moves.
 */

export interface SignBatch {
  setTransform(rotY: number, tx: number, tz: number): void;
  clearTransform(): void;
  push(x: number, y: number, z: number, w: number, h: number, rotY: number, signIndex: number): void;
  build(): THREE.BufferGeometry | null;
}

export function makeSignBatch(): SignBatch {
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  let n = 0;
  let gRot = 0;
  let gx = 0;
  let gz = 0;
  return {
    setTransform(rotY: number, tx: number, tz: number) {
      gRot = rotY;
      gx = tx;
      gz = tz;
    },
    clearTransform() {
      gRot = 0;
      gx = 0;
      gz = 0;
    },
    push(lx, y, lz, w, h, lrot, i) {
      // local -> group transform (rotation about Y then translation)
      const cg = Math.cos(gRot);
      const sg = Math.sin(gRot);
      const x = lx * cg + lz * sg + gx;
      const z = -lx * sg + lz * cg + gz;
      const rotY = lrot + gRot;
      const c = Math.cos(rotY);
      const s = Math.sin(rotY);
      const { v0, v1 } = signUV(i);
      const hx = (w / 2) * c;
      const hz = -(w / 2) * s;
      const nx = s;
      const nz = c;
      const pts: [number, number, number, number, number][] = [
        [x - hx, y - h / 2, z - hz, 0, v0],
        [x + hx, y - h / 2, z + hz, 1, v0],
        [x + hx, y + h / 2, z + hz, 1, v1],
        [x - hx, y + h / 2, z - hz, 0, v1],
      ];
      for (const p of pts) {
        pos.push(p[0], p[1], p[2]);
        nor.push(nx, 0, nz);
        uv.push(p[3], p[4]);
      }
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
      n += 4;
    },
    build() {
      if (n === 0) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
      g.setIndex(idx);
      g.computeBoundingSphere();
      return g;
    },
  };
}


export interface Kit {
  solid: GeoBatch;
  glow: GeoBatch;
  fac: Record<FacadeKind, GeoBatch>;
  signs: SignBatch;
  near: boolean;
  night: boolean;
  /** layout rng: identical for near/far builds so LOD swaps never change the building */
  rng: () => number;
  /** near-only detail rng */
  nrng: () => number;
  /** terrain-style oaks planted by the kit (world space); the cell builder instances them */
  trees: OakSpec[];
  /** seed of the building being built: drives the cosmetic detail rng (same in the near and far LOD) */
  seed?: number;
}

export type Zone = 0 | 1 | 2;

const WALL_RES = ['#f4e8d0', '#ecd0b0', '#d8e6d4', '#f6d9d0', '#d6deee', '#efe6c6', '#ffffff', '#e8d6b8'];
const WALL_COM = ['#d8e0ea', '#bccbdc', '#e8e8e4', '#cdd7e0', '#eadcc4', '#c4d2e2'];
const WALL_MKT = ['#e0bd96', '#d3a982', '#c9b498', '#dccaa8', '#c99464'];
const ROOF = ['#9a4b32', '#6b7280', '#a35a40', '#52606d', '#7c3f2c'];
const BRIGHT = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6'];
const COMPOUND = ['#efe9dc', '#d9cdb4', '#b8a88a', '#e7c9b0', '#c7d1c0', '#f2f2ee'];

const pick = <T,>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
const FACE = 12.8;

type Rng = () => number;
/** sheet colour: the ribbed roof texture is light grey, so the tint is lifted a little */
const sheet = (c: string): string => shade(c, 1.28);
/** a whole number of bays / floors: keeps the windows where the trim expects them but changes which windows the tile shows */
const tileOff = (dr: Rng): [number, number] => [BAY * ((dr() * 4) | 0), dr() < 0.5 ? 0 : FLOOR];

/** facade box: depth along x, width along z, bottom at y=0 */
function facadeBox(kit: Kit, kind: FacadeKind, w: number, h: number, d: number, cx: number, zc: number, color: string, y0 = 0, off?: [number, number]): void {
  const tile: [number, number] = kind === 'shop' ? [SHOP_TILE_W, SHOP_TILE_H] : [TILE_W, TILE_H];
  kit.fac[kind].box(d, h, w, cx, y0 + h / 2, zc, color, { tile, tileOff: off });
}

/** downpipe from a roof edge to the ground (near) */
function downpipe(kit: Kit, side: 1 | -1, face: number, z: number, h: number): void {
  if (!kit.near) return;
  kit.solid.cyl(0.045, h, side * (face - 0.09), h / 2, z, '#6b7078');
  bx(kit.solid, 0.1, 0.06, 0.1, side * (face - 0.09), 0.9, z, '#4b5058');
}

function compoundWall(kit: Kit, side: 1 | -1, zc: number, w: number, setback: number, col: string): void {
  compoundWallNear(kit, side, zc, w, side * (FACE + setback - 0.4), col);
}

function yardTree(kit: Kit, x: number, z: number): void {
  const r = kit.nrng;
  const [wx, wz] = kit.solid.worldPoint(x, z);
  kit.trees.push({ x: wx, y: 0, z: wz, s: 0.45 + r() * 0.2, rot: r() * 6.283, tint: r() });
}

/** striped sloping awning; ONE layout-rng draw (the colour), exactly like the flat awning it replaces */
function awning(kit: Kit, side: number, z0: number, w: number, y: number, depth: number): void {
  const col = pick(kit.rng, BRIGHT);
  stripedAwning(kit, side as 1 | -1, z0, w, y, depth, col, '#f4f1ea');
}

function shopSign(kit: Kit, side: number, z: number, w: number, y: number, face: number): void {
  if (!kit.near) {
    kit.solid.box(0.15, 0.9, w, side * (face - 0.1), y, z, BRIGHT[(Math.floor(z * 7) & 0xffff) % BRIGHT.length]);
    return;
  }
  const i = Math.floor(kit.nrng() * SIGN_TEXTS.length);
  const sw = Math.min(w, 5.2);
  // sign faces the road: normal points toward the road (-side in x); a frame and two brackets hold it
  kit.signs.push(side * (face - 0.12), y, z, sw, 0.9, side > 0 ? -Math.PI / 2 : Math.PI / 2, i);
  bx(kit.solid, 0.1, 0.06, sw + 0.12, side * (face - 0.07), y + 0.45, z, '#2b2e33');
  bx(kit.solid, 0.1, 0.06, sw + 0.12, side * (face - 0.07), y - 0.51, z, '#2b2e33');
}

// ---------------------------------------------------------------------------------------------
// Residential
// ---------------------------------------------------------------------------------------------

function resA(kit: Kit, side: 1 | -1, zc: number, slot: number, setback: number, dr: Rng): { w: number; d: number } {
  const r = kit.rng;
  const n = Math.max(3, Math.min(4, Math.floor(slot / BAY)));
  const w = n * BAY;
  const d = 9 + r() * 2;
  const face = FACE + setback;
  const cx = side * (face + d / 2);
  const wall = pick(r, WALL_RES);
  facadeBox(kit, 'res', w, FLOOR, d, cx, zc, wall, 0, tileOff(dr));
  const roof = pick(r, ROOF);
  const trim = TRIM[(dr() * TRIM.length) | 0];
  hipRoof(kit, { cx, zc, d, w, yTop: FLOOR, rise: 2.6, overhang: 0.45, color: sheet(roof), trim });
  if (kit.near) {
    resWindowTrim(kit, dr, { side, face, zc, bays: n, floors: 1, y0: 0, color: trim, hood: 0.4 });
    // porch roof on two square piers (the door and steps sit behind the compound wall)
    const pw = w * 0.5;
    bx(kit.solid, 2.4, 0.14, pw, side * (face - 1.2), FLOOR - 0.5, zc, trim);
    bx(kit.solid, 2.46, 0.05, pw + 0.06, side * (face - 1.2), FLOOR - 0.36, zc, shade(trim, 0.85));
    for (const k of [-1, 1]) {
      bx(kit.solid, 0.26, FLOOR - 0.62, 0.26, side * (face - 2.2), 0.12, zc + k * pw * 0.44, trim);
      bx(kit.solid, 0.38, 0.1, 0.38, side * (face - 2.2), 0.12, zc + k * pw * 0.44, shade(trim, 0.9));
      bx(kit.solid, 0.38, 0.1, 0.38, side * (face - 2.2), FLOOR - 0.6, zc + k * pw * 0.44, shade(trim, 0.9));
    }
    downpipe(kit, side, face + 0.0, zc - w / 2 + 0.05, FLOOR - 0.15);
    downpipe(kit, side, face + 0.0, zc + w / 2 - 0.05, FLOOR - 0.15);
    if (dr() < 0.4) bx(kit.solid, 0.5, 1.1, 0.5, side * (face + d * 0.6), FLOOR + 0.5, zc + (dr() - 0.5) * w * 0.3, '#c9c3b4'); // chimney-like vent stack
    if (dr() < 0.35) bx(kit.solid, 0.06, 0.06, 0.06, cx, FLOOR + 2.6, zc, '#444');
  }
  return { w, d };
}

function resB(kit: Kit, side: 1 | -1, zc: number, slot: number, setback: number, dr: Rng): { w: number; d: number } {
  const r = kit.rng;
  const n = Math.max(3, Math.min(5, Math.floor(slot / BAY)));
  const w = n * BAY;
  const d = 10 + r() * 3;
  const face = FACE + setback;
  const cx = side * (face + d / 2);
  const wall = pick(r, WALL_RES);
  facadeBox(kit, 'res', w, FLOOR * 2, d, cx, zc, wall, 0, tileOff(dr));
  kit.solid.box(d + 0.3, 0.4, w + 0.3, cx, FLOOR * 2 + 0.2, zc, '#9a9a94');
  const trim = TRIM[(dr() * TRIM.length) | 0];
  parapet(kit, side, face, zc, w, d, FLOOR * 2 + 0.4, 0.75, wall, trim);
  if (kit.near) {
    const bw = w * 0.55;
    const rail = IRON[(dr() * IRON.length) | 0];
    balcony(kit, side, face, zc, bw, FLOOR + 0.05, 1.6, '#d9d6cc', rail);
    resWindowTrim(kit, dr, { side, face, zc, bays: n, floors: 2, y0: 0, color: trim, hood: 0.3, skip: (fl, b) => fl === 1 && Math.abs(zc - w / 2 + (b + 0.5) * BAY - zc) < bw / 2 });
    slabBands(kit, side, face, zc, w, d, 2, 0, trim);
    cornice(kit, side, face, zc, w, FLOOR * 2 + 0.3, '#b9b8b0');
    downpipe(kit, side, face, zc - w / 2 + 0.05, FLOOR * 2);
    downpipe(kit, side, face, zc + w / 2 - 0.05, FLOOR * 2);
    roofDeck(kit, dr, side, cx, zc, d, w, FLOOR * 2 + 0.4);
  }
  return { w, d };
}

function resC(kit: Kit, side: 1 | -1, zc: number, slot: number, setback: number, dr: Rng): { w: number; d: number } {
  const r = kit.rng;
  const n = Math.max(4, Math.min(6, Math.floor(slot / BAY)));
  const w = n * BAY;
  const d = 11 + r() * 3;
  const floors = 3 + Math.floor(r() * 2);
  const face = FACE + setback;
  const cx = side * (face + d / 2);
  const wall = pick(r, WALL_RES);
  facadeBox(kit, 'res', w, FLOOR * floors, d, cx, zc, wall, 0, tileOff(dr));
  kit.solid.box(d + 0.3, 0.4, w + 0.3, cx, FLOOR * floors + 0.2, zc, '#8d8d88');
  // stair tower
  kit.solid.box(3.2, FLOOR * floors + 1.6, 3.4, side * (face + d - 1.2), (FLOOR * floors + 1.6) / 2, zc + w / 2 - 1.8, '#c9c3b4');
  const trim = TRIM[(dr() * TRIM.length) | 0];
  parapet(kit, side, face, zc, w, d, FLOOR * floors + 0.4, 0.8, wall, trim);
  if (kit.near) {
    const rail = IRON[(dr() * IRON.length) | 0];
    const bw = BAY - 0.5;
    const balc = (fl: number, b: number): boolean => fl >= 1 && (b + fl) % 2 === 0;
    for (let fl = 1; fl < floors; fl++) {
      for (let b = 0; b < n; b++) {
        if (!balc(fl, b)) continue;
        balcony(kit, side, face, zc - w / 2 + (b + 0.5) * BAY, bw, fl * FLOOR + 0.05, 1.25, '#d9d6cc', rail);
      }
    }
    resWindowTrim(kit, dr, { side, face, zc, bays: n, floors, y0: 0, color: trim, hood: 0.3, ac: 0.14, skip: (fl, b) => balc(fl, b) });
    slabBands(kit, side, face, zc, w, d, floors, 0, trim);
    cornice(kit, side, face, zc, w, FLOOR * floors + 0.3, '#b3b2aa');
    for (const sz of [-1, 1]) downpipe(kit, side, face, zc + (sz * w) / 2 - sz * 0.05, FLOOR * floors);
    // stair-tower louvres + water tanks on the roof
    const tx = side * (face + d - 1.2);
    grillePanel(kit, GRILLE_ROW.louvre, tx - side * 1.62, zc + w / 2 - 2.8, tx - side * 1.62, zc + w / 2 - 0.9, FLOOR * floors - 1.6, 1.2, '#b8b2a2');
    roofDeck(kit, dr, side, cx, zc - 1.2, d, w - 3.4, FLOOR * floors + 0.4, { tanks: 2, heavy: true });
  }
  return { w, d };
}

function resD(kit: Kit, side: 1 | -1, zc: number, slot: number, setback: number, dr: Rng): { w: number; d: number } {
  const r = kit.rng;
  const n = Math.max(3, Math.min(4, Math.floor(slot / BAY)));
  const w = n * BAY;
  const d = 10;
  const face = FACE + setback;
  const cx = side * (face + d / 2);
  const wall = pick(r, WALL_RES);
  facadeBox(kit, 'res', w, FLOOR * 2, d, cx, zc, wall, 0, tileOff(dr));
  const roof = pick(r, ROOF);
  const trim = TRIM[(dr() * TRIM.length) | 0];
  hipRoof(kit, { cx, zc, d, w, yTop: FLOOR * 2, rise: 2.8, overhang: 0.5, color: sheet(roof), trim });
  facadeBox(kit, 'res', 3.2, FLOOR, 5, side * (face - 2.5), zc - w / 2 + 1.6, wall, 0, tileOff(dr)); // annex
  kit.solid.box(5.4, 0.2, 3.6, side * (face - 2.5), FLOOR + 0.1, zc - w / 2 + 1.6, '#7c3f2c');
  if (kit.near) {
    // annex: a tiny parapet and a garage-style door
    parapet(kit, side, face - 5, zc - w / 2 + 1.6, 3.4, 5.2, FLOOR + 0.2, 0.45, wall, trim);
    resWindowTrim(kit, dr, { side, face, zc, bays: n, floors: 2, y0: 0, color: trim, hood: 0.5, skip: (fl, b) => fl === 0 && b === 0 });
    grillePanel(kit, GRILLE_ROW.gate, side * (face - 5.02), zc - w / 2 + 0.1, side * (face - 5.02), zc - w / 2 + 3.1, 0.2, 2.1, '#3a2c26');
    bx(kit.solid, 0.14, 0.14, 3.4, side * (face - 5.04), 2.45, zc - w / 2 + 1.6, trim);
    slabBands(kit, side, face, zc, w, d, 2, 0, trim);
    downpipe(kit, side, face, zc + w / 2 - 0.05, FLOOR * 2 - 0.2);
  }
  return { w, d };
}

// ---------------------------------------------------------------------------------------------
// Commercial / office
// ---------------------------------------------------------------------------------------------

function comA(kit: Kit, side: 1 | -1, zc: number, slot: number, dr: Rng): { w: number; d: number } {
  const r = kit.rng;
  const n = Math.max(3, Math.min(5, Math.floor(slot / BAY)));
  const w = n * BAY;
  const d = 12 + r() * 4;
  const floors = 5 + Math.floor(r() * 4);
  const cx = side * (FACE + d / 2);
  const wall = pick(r, WALL_COM);
  facadeBox(kit, 'com', w, FLOOR * floors, d, cx, zc, wall, 0, tileOff(dr));
  kit.solid.box(d + 0.3, 0.5, w + 0.3, cx, FLOOR * floors + 0.25, zc, '#6b7280');
  stoneBase(kit, side, FACE, zc, w, 1.0, '#5f6670');
  parapet(kit, side, FACE, zc, w, d, FLOOR * floors + 0.5, 0.7, shade(wall, 0.9), '#cfd3d7');
  if (kit.near) {
    const trim = '#f1f2f3';
    ribbonTrim(kit, side, FACE, zc, w, floors, 0, trim, shade(wall, 0.82), 0.3);
    // ground floor: glazed lobby with a canopy, columns and a pair of doors
    bx(kit.solid, 1.8, 0.16, Math.min(w, 8), side * (FACE - 0.9), FLOOR - 0.05, zc, '#3c434b');
    for (const k of [-1, 1]) bx(kit.solid, 0.3, FLOOR - 0.2, 0.3, side * (FACE - 1.6), 0, zc + k * Math.min(w, 8) * 0.46, '#c9ced3');
    entrance(kit, dr, side, FACE, zc, 0, '#c9ced3', { glass: true, wide: 2.0, canopy: false });
    // fins at every second bay give the elevation rhythm
    if (dr() < 0.6) for (let b = 0; b <= n; b += 2) bx(kit.solid, 0.24, FLOOR * (floors - 1), 0.1, side * (FACE - 0.12), FLOOR, zc - w / 2 + b * BAY, '#dfe3e6');
    roofDeck(kit, dr, side, cx, zc, d, w, FLOOR * floors + 0.5, { tanks: 1 });
    shopSign(kit, side, zc, w, FLOOR * floors + 1.2, FACE);
    kit.solid.box(0.16, 1.3, w * 0.8, side * (FACE - 0.1), FLOOR * floors + 1.15, zc, '#1f2937');
  }
  return { w, d };
}

function comB(kit: Kit, side: 1 | -1, zc: number, slot: number, dr: Rng): { w: number; d: number } {
  const r = kit.rng;
  const n = Math.max(4, Math.min(6, Math.floor(slot / BAY)));
  const w = n * BAY;
  const d = 12;
  const setback = 4.5;
  const face = FACE + setback;
  const cx = side * (face + d / 2);
  const upper = 3 + Math.floor(r() * 2);
  facadeBox(kit, 'shop', w, FLOOR, d, cx, zc, '#ffffff');
  const wall = pick(r, WALL_COM);
  facadeBox(kit, 'com', w, FLOOR * upper, d, cx, zc, wall, FLOOR, tileOff(dr));
  kit.solid.box(d + 0.3, 0.5, w + 0.3, cx, FLOOR * (upper + 1) + 0.25, zc, '#6b7280');
  const canopyCol = pick(r, BRIGHT);
  kit.solid.box(3.5, 0.15, w, side * (face - 1.5), FLOOR - 0.2, zc, canopyCol); // canopy over the forecourt
  // forecourt: parking bays + a couple of cars (near only), painted bays always
  kit.solid.box(setback, 0.05, w, side * (FACE + setback / 2), 0.03, zc, '#5a5d63');
  parapet(kit, side, face, zc, w, d, FLOOR * (upper + 1) + 0.5, 0.7, shade(wall, 0.9), '#cfd3d7');
  if (kit.near) {
    for (let i = 0; i < n + 1; i++) kit.solid.box(setback - 0.6, 0.02, 0.1, side * (FACE + setback / 2), 0.06, zc - w / 2 + i * (w / n), '#e9e9e4');
    shopSign(kit, side, zc, w, FLOOR * 1 + 0.9, face);
    // canopy: fascia upstand + slim columns
    bx(kit.solid, 0.14, 0.34, w, side * (face - 3.28), FLOOR - 0.3, zc, canopyCol);
    for (let i = 0; i <= Math.floor(w / 4.8); i++) {
      const cz = zc - w / 2 + 0.4 + (i * (w - 0.8)) / Math.max(1, Math.floor(w / 4.8));
      kit.solid.cyl(0.11, FLOOR - 0.15, side * (face - 3.1), (FLOOR - 0.15) / 2, cz, '#e5e7eb');
      bx(kit.solid, 0.4, 0.14, 0.4, side * (face - 3.1), 0, cz, '#9ca3af');
    }
    for (let k = 0; k < 2; k++) shutterBox(kit, side, zc - w / 2 + 1.6 + k * (w - 3.2), FLOOR - 0.5, FLOOR - 0.5);
    ribbonTrim(kit, side, face, zc, w, upper, FLOOR, '#f1f2f3', shade(wall, 0.82), 0.3);
    stoneBase(kit, side, face, zc, w, 0.45, '#5f6670');
    roofDeck(kit, dr, side, cx, zc, d, w, FLOOR * (upper + 1) + 0.5, { tanks: 1 });
  }
  return { w, d };
}

function comC(kit: Kit, side: 1 | -1, zc: number, slot: number, dr: Rng): { w: number; d: number } {
  const r = kit.rng;
  const n = Math.max(5, Math.min(7, Math.floor(slot / BAY)));
  const w = n * BAY;
  const d = 15;
  const face = FACE + 2;
  const cx = side * (face + d / 2);
  const wall = pick(r, WALL_COM);
  facadeBox(kit, 'com', w, FLOOR * 2, d, cx, zc, wall, 0, tileOff(dr));
  kit.solid.box(d + 0.3, 0.5, w + 0.3, cx, FLOOR * 2 + 0.25, zc, '#4b5563');
  // entrance canopy + signage tower
  const cc = pick(r, BRIGHT);
  kit.solid.box(4, 0.2, 8, side * (face - 2), FLOOR + 0.6, zc, cc);
  for (const k of [-1, 1]) kit.solid.cyl(0.15, FLOOR + 0.5, side * (face - 3.7), (FLOOR + 0.5) / 2, zc + k * 3.6, '#e5e7eb');
  kit.solid.box(2.4, 9, 2.4, side * (face + 1.2), 4.5, zc + w / 2 - 2, '#cbd5e1');
  glowSign(kit, side, face, zc + w / 2 - 2);
  parapet(kit, side, face, zc, w, d, FLOOR * 2 + 0.5, 0.65, shade(wall, 0.9), '#cfd3d7');
  stoneBase(kit, side, face, zc, w, 0.9, '#5f6670');
  if (kit.near) {
    shopSign(kit, side, zc - w * 0.15, w * 0.6, FLOOR * 2 - 0.5, face);
    ribbonTrim(kit, side, face, zc, w, 2, 0, '#f1f2f3', shade(wall, 0.82), 0.3);
    // canopy edge, base plates and a glazed entrance behind it
    bx(kit.solid, 0.12, 0.3, 8, side * (face - 4.0), FLOOR + 0.6, zc, cc);
    for (const k of [-1, 1]) bx(kit.solid, 0.4, 0.1, 0.4, side * (face - 3.7), 0, zc + k * 3.6, '#9ca3af');
    entrance(kit, dr, side, face, zc, 0, '#c9ced3', { glass: true, wide: 2.2 });
    // tower: vertical fins + a louvred plant band
    for (const k of [-1, 1]) bx(kit.solid, 0.16, 8.6, 0.12, side * (face - 0.1), 0.2, zc + w / 2 - 2 + k * 1.1, '#aab4c2');
    grillePanel(kit, GRILLE_ROW.louvre, side * (face + 1.2 - 1.22), zc + w / 2 - 3, side * (face + 1.2 - 1.22), zc + w / 2 - 1, 7.4, 1.0, '#9aa5b4');
    roofDeck(kit, dr, side, cx, zc, d, w, FLOOR * 2 + 0.5, { tanks: 1 });
  }
  return { w, d: d + 2 };
}

function glowSign(kit: Kit, side: number, face: number, z: number): void {
  kit.glow.box(0.12, 2.6, 1.4, side * (face - 0.05), 8.5, z, pick(kit.rng, BRIGHT));
}

/** crown for the glass towers: plant enclosure with louvres + chillers, a parapet, mast and beacon */
function towerCrown(kit: Kit, dr: Rng, side: 1 | -1, face: number, cx: number, zc: number, d: number, w: number, top: number): void {
  parapet(kit, side, face, zc, w, d, top, 0.9, '#aeb6bf', '#dfe3e6');
  if (!kit.near) return;
  const pw = (w - 2.2) * 0.55;
  const pd = (d - 2.2) * 0.5;
  bx(kit.solid, pd, 2.6, pw, cx, top, zc - w * 0.12, '#9aa7b4');
  bx(kit.solid, pd + 0.3, 0.14, pw + 0.3, cx, top + 2.6, zc - w * 0.12, '#cfd5db');
  grillePanel(kit, GRILLE_ROW.louvre, cx - side * (pd / 2 + 0.02), zc - w * 0.12 - pw * 0.4, cx - side * (pd / 2 + 0.02), zc - w * 0.12 + pw * 0.4, top + 0.5, 1.6, '#c7ced6');
  for (let i = 0; i < 3; i++) {
    const z = zc + w * 0.28 + (i - 1) * 0.1;
    bx(kit.solid, 1.4, 1.1, 1.6, cx + side * (d * 0.12), top, z + (i - 1) * 1.7, '#cdd1d5');
  }
  void dr;
}

function offA(kit: Kit, side: 1 | -1, zc: number, slot: number, dr: Rng): { w: number; d: number } {
  const r = kit.rng;
  const n = Math.max(4, Math.min(6, Math.floor(slot / BAY)));
  const w = n * BAY;
  const d = 13 + r() * 4;
  const floors = 10 + Math.floor(r() * 7);
  const cx = side * (FACE + d / 2);
  facadeBox(kit, 'office', w, FLOOR * floors, d, cx, zc, '#ffffff', 0, tileOff(dr));
  kit.solid.box(d - 1.5, 2.4, w - 1.5, cx, FLOOR * floors + 1.2, zc, '#9aa7b4'); // crown
  stoneBase(kit, side, FACE, zc, w, 1.3, '#4d5560');
  if (kit.near) {
    // lobby: stone surround, glazed doors and a flat canopy
    entrance(kit, dr, side, FACE, zc, 0, '#3b434d', { glass: true, wide: 2.4, canopy: false });
    bx(kit.solid, 2.2, 0.18, Math.min(w, 7.5), side * (FACE - 1.1), FLOOR - 0.15, zc, '#2f363e');
    bx(kit.solid, 2.24, 0.06, Math.min(w, 7.5) + 0.04, side * (FACE - 1.1), FLOOR + 0.03, zc, '#c5ccd3');
    for (const k of [-1, 1]) {
      kit.solid.cyl(0.12, FLOOR - 0.3, side * (FACE - 2.0), (FLOOR - 0.3) / 2, zc + k * Math.min(w, 7.5) * 0.46, '#c5ccd3');
    }
    // vertical fins at the bay lines on the street face: every bay or every second one
    const step = dr() < 0.5 ? 1 : 2;
    for (let b = 0; b <= n; b += step) bx(kit.solid, 0.22, FLOOR * (floors - 1) - 0.4, 0.09, side * (FACE - 0.1), FLOOR + 0.2, zc - w / 2 + b * BAY, '#cdd3d9');
    // floor-slab edge accents every 4th floor
    for (let f = 4; f < floors; f += 4) bx(kit.solid, 0.14, 0.24, w + 0.1, side * (FACE - 0.06), f * FLOOR - 0.12, zc, '#aab3bc');
    kit.solid.cyl(0.08, 7, cx, FLOOR * floors + 5.5, zc, '#6b7280');
    kit.glow.sphere(0.2, 0.2, 0.2, cx, FLOOR * floors + 9, zc, '#ff3030');
  }
  towerCrown(kit, dr, side, FACE, cx, zc, d, w, FLOOR * floors + 2.4);
  return { w, d };
}

function offB(kit: Kit, side: 1 | -1, zc: number, slot: number, dr: Rng): { w: number; d: number } {
  const r = kit.rng;
  const n = Math.max(4, Math.min(6, Math.floor(slot / BAY)));
  const w = n * BAY;
  const d = 14;
  const cx = side * (FACE + d / 2);
  facadeBox(kit, 'office', w, FLOOR * 4, d, cx, zc, '#ffffff', 0, tileOff(dr));
  kit.solid.box(d + 0.4, 0.6, w + 0.4, cx, FLOOR * 4 + 0.3, zc, '#6b7280');
  const tw = (n - 2) * BAY;
  const floors = 8 + Math.floor(r() * 5);
  facadeBox(kit, 'office', tw, FLOOR * floors, d - 4, side * (FACE + 4 + (d - 4) / 2), zc, '#ffffff', FLOOR * 4 + 0.6, tileOff(dr));
  kit.solid.box(d - 5, 1.6, tw - 1, side * (FACE + 4 + (d - 4) / 2), FLOOR * (floors + 4) + 1.4, zc, '#9aa7b4');
  stoneBase(kit, side, FACE, zc, w, 1.2, '#4d5560');
  // podium roof terrace edge
  parapet(kit, side, FACE, zc, w, 4, FLOOR * 4 + 0.6, 0.55, '#aeb6bf', '#dfe3e6');
  if (kit.near) {
    entrance(kit, dr, side, FACE, zc, 0, '#3b434d', { glass: true, wide: 2.4 });
    bx(kit.solid, 2.2, 0.18, Math.min(w, 7.0), side * (FACE - 1.1), FLOOR - 0.15, zc, '#2f363e');
    for (const k of [-1, 1]) kit.solid.cyl(0.12, FLOOR - 0.3, side * (FACE - 2.0), (FLOOR - 0.3) / 2, zc + k * Math.min(w, 7.0) * 0.46, '#c5ccd3');
    // podium terrace railing along the front edge + planters
    grillePanel(kit, GRILLE_ROW.rail, side * (FACE + 0.15), zc - w / 2 + 0.3, side * (FACE + 0.15), zc + w / 2 - 0.3, FLOOR * 4 + 1.15, 1.0, '#2b2f35');
    for (let b = 0; b < n; b++) bx(kit.solid, 0.7, 0.55, BAY - 0.8, side * (FACE + 1.1), FLOOR * 4 + 0.6, zc - w / 2 + (b + 0.5) * BAY, '#7a6a55');
    for (let b = 0; b < n; b += 2) bx(kit.solid, 0.2, FLOOR * 3 - 0.3, 0.09, side * (FACE - 0.1), FLOOR + 0.2, zc - w / 2 + b * BAY, '#cdd3d9');
  }
  // tower crown
  const tcx = side * (FACE + 4 + (d - 4) / 2);
  towerCrown(kit, dr, side, FACE + 4, tcx, zc, d - 4, tw, FLOOR * (floors + 4) + 2.2);
  return { w, d };
}

function offC(kit: Kit, side: 1 | -1, zc: number, slot: number, dr: Rng): { w: number; d: number } {
  const r = kit.rng;
  const n = Math.max(4, Math.min(6, Math.floor(slot / BAY)));
  const w = n * BAY;
  const d = 12;
  const floors = 8 + Math.floor(r() * 5);
  const cx = side * (FACE + d / 2);
  const wall = pick(r, WALL_COM);
  facadeBox(kit, 'com', w, FLOOR * floors, d, cx, zc, wall, 0, tileOff(dr));
  // concrete brise-soleil: vertical fins at every 1.6 m (every 3.2 m in the far LOD) in front of the glazing, so the windows stay visible
  const finStep = kit.near ? 1.6 : 3.2;
  for (let fz = -w / 2; fz <= w / 2 + 0.01; fz += finStep) bx(kit.solid, 0.5, FLOOR * floors, kit.near ? 0.28 : 0.45, side * (FACE - 0.1), 0, zc + fz, '#c9ced4');
  kit.solid.box(3.0, FLOOR * floors + 1.5, 3.0, side * (FACE + d + 0.5), (FLOOR * floors + 1.5) / 2, zc + w / 2 - 1.5, '#aab1b8'); // core
  kit.solid.box(d + 0.3, 0.5, w + 0.3, cx, FLOOR * floors + 0.25, zc, '#5b6470');
  parapet(kit, side, FACE, zc, w, d, FLOOR * floors + 0.5, 0.7, '#9aa4ae', '#d3d7db');
  stoneBase(kit, side, FACE - 0.35, zc, w, 1.1, '#59616b');
  if (kit.near) {
    // a sun-shade fin over the ribbon window on every floor, a deep slab edge on the others
    for (let f = 0; f < floors; f++) bx(kit.solid, 0.8, 0.1, w + 0.05, side * (FACE - 0.75), f * FLOOR + WIN_Y1 + 0.05, zc, '#d4d8dc');
    for (let f = 1; f < floors; f++) bx(kit.solid, 0.7, 0.16, w + 0.05, side * (FACE - 0.7), f * FLOOR - 0.1, zc, '#b6bcc2');
    entrance(kit, dr, side, FACE - 0.35, zc, 0, '#59616b', { glass: true, wide: 2.0, canopy: true });
    grillePanel(kit, GRILLE_ROW.louvre, side * (FACE + d + 0.5 - 1.52), zc + w / 2 - 2.4, side * (FACE + d + 0.5 - 1.52), zc + w / 2 - 0.6, FLOOR * floors - 1.2, 1.1, '#9ca4ad');
    roofDeck(kit, dr, side, cx, zc - 1, d, w - 3, FLOOR * floors + 0.5, { tanks: 1, heavy: true });
  }
  return { w, d };
}
const WIN_Y1 = 2.6;

// ---------------------------------------------------------------------------------------------
// Shops
// ---------------------------------------------------------------------------------------------

function shopA(kit: Kit, side: 1 | -1, zc: number, slot: number, dr: Rng): { w: number; d: number } {
  const r = kit.rng;
  const bays = Math.max(2, Math.min(3, Math.floor(slot / SHOP_TILE_W)));
  const w = bays * SHOP_TILE_W;
  const d = 8;
  const cx = side * (FACE + d / 2);
  const wall = pick(r, WALL_MKT);
  facadeBox(kit, 'shop', w, FLOOR, d, cx, zc, wall);
  kit.solid.box(d + 0.4, 0.3, w + 0.4, cx, FLOOR + 0.15, zc, '#7b7f85');
  parapet(kit, side, FACE, zc, w, d, FLOOR + 0.3, 0.45, shade(wall, 0.95), '#cfd3d7');
  for (let i = 0; i < bays; i++) {
    const z = zc - w / 2 + (i + 0.5) * SHOP_TILE_W;
    awning(kit, side, z, SHOP_TILE_W - 0.4, FLOOR - 0.55, 1.5);
    shopSign(kit, side, z, SHOP_TILE_W - 0.6, FLOOR - 0.15, FACE);
    if (kit.near && kit.nrng() > 0.5) {
      // vendor stall under a market parasol
      vendorStall(kit, dr, side, side * (FACE - 2.6), z + 1.2, pick(r, BRIGHT));
    }
    if (kit.near) shopStock(kit, dr, side, z);
  }
  if (kit.near) {
    stoneBase(kit, side, FACE, zc, w, 0.12, '#7b7f85');
    roofDeck(kit, dr, side, cx, zc, d, w, FLOOR + 0.3, { tanks: 1 });
    for (const sz of [-1, 1]) downpipe(kit, side, FACE, zc + (sz * w) / 2 - sz * 0.05, FLOOR);
  }
  return { w, d };
}

/** goods on the pavement in front of a shop: crates, a drinks cooler, sacks, a gas cylinder */
function shopStock(kit: Kit, dr: Rng, side: 1 | -1, z: number): void {
  const x = side * (FACE - 0.55);
  const pickc = (a: string[]) => a[(dr() * a.length) | 0];
  if (dr() < 0.5) {
    // stacked crates
    const n = 2 + ((dr() * 2) | 0);
    for (let i = 0; i < n; i++) bx(kit.solid, 0.5, 0.3, 0.7, x, i * 0.3, z - 2.1 + (dr() - 0.5) * 0.15, pickc(['#d94f4f', '#2f6fd6', '#e8b43c', '#3f9a5a']));
  }
  if (dr() < 0.35) {
    // drinks cooler
    bx(kit.solid, 0.7, 1.7, 0.8, x, 0, z + 2.0, '#e8eaec');
    bx(kit.solid, 0.04, 1.3, 0.6, x - side * 0.36, 0.2, z + 2.0, '#8fb4cf');
  }
  if (dr() < 0.25) kit.solid.cyl(0.18, 0.6, x - side * 0.3, 0.3, z - 0.9, '#c24a2a'); // gas cylinder
  if (dr() < 0.3) bx(kit.solid, 0.6, 0.5, 0.45, x - side * 0.2, 0, z + 0.8, '#b79a6a'); // sack
}

function shopB(kit: Kit, side: 1 | -1, zc: number, slot: number, dr: Rng): { w: number; d: number } {
  const r = kit.rng;
  const w = Math.min(slot, 12);
  const d = 6;
  const containers = Math.max(2, Math.floor(w / 3.6));
  for (let i = 0; i < containers; i++) {
    const z = zc - w / 2 + (i + 0.5) * (w / containers);
    const col = pick(r, ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#475569']);
    const cw = w / containers - 0.3;
    containerBox(kit, side, side * (FACE + 1.5 + d / 2), z, d, 2.6, cw, col, kit.near);
    kit.solid.box(0.1, 1.6, 1.8, side * (FACE + 1.5 - 0.05), 1.2, z, '#1f2937'); // opening
    awning(kit, side, z, w / containers - 0.5, 2.3, 1.3);
    shopSign(kit, side, z, w / containers - 0.5, 2.85, FACE + 1.5);
    if (kit.near) {
      kit.solid.box(0.6, 0.6, 0.6, side * (FACE + 0.6), 0.3, z + 0.9, '#7c3aed'); // crate/stool
      // roller shutter slats inside the opening, a step, a counter, a hanging bulb lamp
      grillePanel(kit, GRILLE_ROW.louvre, side * (FACE + 1.42), z - 0.85, side * (FACE + 1.42), z + 0.85, 0.5, 1.2, '#7c828a');
      bx(kit.solid, 0.6, 0.15, 1.9, side * (FACE + 1.15), 0, z, '#8a8a84');
      bx(kit.solid, 0.5, 0.9, 1.6, side * (FACE + 0.85), 0.15, z - 0.2, '#8a6a46');
      kit.glow.sphere(0.07, 0.07, 0.07, side * (FACE + 1.2), 2.2, z - 0.7, '#ffe9b0');
      if (dr() < 0.5) kit.solid.cyl(0.16, 0.55, side * (FACE + 0.55), 0.275, z - 0.9, '#c24a2a');
    }
  }
  return { w, d: d + 1.5 };
}

function shopC(kit: Kit, side: 1 | -1, zc: number, slot: number, dr: Rng): { w: number; d: number } {
  const r = kit.rng;
  const bays = Math.max(2, Math.min(3, Math.floor(slot / SHOP_TILE_W)));
  const w = bays * SHOP_TILE_W;
  const d = 9;
  const cx = side * (FACE + d / 2);
  const wallL = pick(r, WALL_MKT);
  facadeBox(kit, 'shop', w, FLOOR, d, cx, zc, wallL);
  const wallU = pick(r, WALL_RES);
  facadeBox(kit, 'res', w, FLOOR, d, cx, zc, wallU, FLOOR, tileOff(dr));
  kit.solid.box(d + 0.3, 0.4, w + 0.3, cx, FLOOR * 2 + 0.2, zc, '#8d8d88');
  kit.solid.box(1.5, 0.16, w * 0.9, side * (FACE - 0.75), FLOOR, zc, '#d9d6cc'); // balcony slab over the shopfront
  parapet(kit, side, FACE, zc, w, d, FLOOR * 2 + 0.4, 0.6, wallU, '#e3e0d6');
  if (kit.near) {
    const trim = TRIM[(dr() * TRIM.length) | 0];
    grillePanel(kit, GRILLE_ROW.rail, side * (FACE - 1.46), zc - w * 0.45 + 0.05, side * (FACE - 1.46), zc + w * 0.45 - 0.05, FLOOR + 0.08, 1.0, IRON[(dr() * IRON.length) | 0]);
    for (const sz of [-1, 1]) grillePanel(kit, GRILLE_ROW.rail, side * FACE, zc + sz * (w * 0.45 - 0.05), side * (FACE - 1.46), zc + sz * (w * 0.45 - 0.05), FLOOR + 0.08, 1.0, '#2a2d31');
    for (const sz of [-1, 1]) bx(kit.solid, 0.07, 1.04, 0.07, side * (FACE - 1.46), FLOOR + 0.08, zc + sz * (w * 0.45 - 0.05), '#2a2d31');
    bx(kit.solid, 0.07, 0.07, w * 0.9, side * (FACE - 1.46), FLOOR + 1.08, zc, '#2a2d31');
    resWindowTrim(kit, dr, { side, face: FACE, zc, bays: Math.round(w / BAY), floors: 1, y0: FLOOR, color: trim, hood: 0.2 });
    cornice(kit, side, FACE, zc, w, FLOOR * 2 + 0.2, '#b9b8b0');
    roofDeck(kit, dr, side, cx, zc, d, w, FLOOR * 2 + 0.4);
    for (let i = 0; i < bays; i++) shopStock(kit, dr, side, zc - w / 2 + (i + 0.5) * SHOP_TILE_W);
    for (const sz of [-1, 1]) downpipe(kit, side, FACE, zc + (sz * w) / 2 - sz * 0.05, FLOOR * 2);
  }
  for (let i = 0; i < bays; i++) shopSign(kit, side, zc - w / 2 + (i + 0.5) * SHOP_TILE_W, SHOP_TILE_W - 0.6, FLOOR - 0.2, FACE);
  return { w, d };
}

function shopD(kit: Kit, side: 1 | -1, zc: number, slot: number, dr: Rng): { w: number; d: number } {
  const r = kit.rng;
  const bays = Math.max(2, Math.min(3, Math.floor(slot / SHOP_TILE_W)));
  const w = bays * SHOP_TILE_W;
  const d = 10;
  const cx = side * (FACE + d / 2);
  facadeBox(kit, 'shop', w, FLOOR, d, cx, zc, '#ffffff');
  const wall = pick(r, WALL_COM);
  facadeBox(kit, 'com', w, FLOOR, d, cx, zc, wall, FLOOR, tileOff(dr));
  kit.solid.box(d + 0.3, 0.4, w + 0.3, cx, FLOOR * 2 + 0.2, zc, '#6b7280');
  const cc = pick(r, BRIGHT);
  kit.solid.box(2.2, 0.2, w, side * (FACE - 1.1), FLOOR + 0.3, zc, cc); // canopy
  for (const k of [-1, 1]) kit.solid.cyl(0.1, FLOOR, side * (FACE - 2.1), FLOOR / 2, zc + k * (w / 2 - 0.4), '#e5e7eb');
  shopSign(kit, side, zc, w - 0.5, FLOOR * 2 - 0.55, FACE);
  parapet(kit, side, FACE, zc, w, d, FLOOR * 2 + 0.4, 0.6, shade(wall, 0.9), '#cfd3d7');
  if (kit.near) {
    bx(kit.solid, 0.12, 0.3, w, side * (FACE - 2.2), FLOOR + 0.3, zc, cc);
    for (const k of [-1, 1]) bx(kit.solid, 0.36, 0.1, 0.36, side * (FACE - 2.1), 0, zc + k * (w / 2 - 0.4), '#9ca3af');
    ribbonTrim(kit, side, FACE, zc, w, 1, FLOOR, '#f1f2f3', shade(wall, 0.82), 0.3);
    shutterBox(kit, side, zc, 2.4, FLOOR - 0.5);
    roofDeck(kit, dr, side, cx, zc, d, w, FLOOR * 2 + 0.4);
    for (let i = 0; i < bays; i++) shopStock(kit, dr, side, zc - w / 2 + (i + 0.5) * SHOP_TILE_W);
  }
  return { w, d };
}

function shopE(kit: Kit, side: 1 | -1, zc: number, slot: number, dr: Rng): { w: number; d: number } {
  const r = kit.rng;
  const w = Math.min(slot, 14);
  const d = 8;
  const cx = side * (FACE + 1 + d / 2);
  // open market shed: pillars + corrugated sloping roof, stalls underneath
  const x0 = cx - (d + 1) / 2;
  const x1 = cx + (d + 1) / 2;
  const yIn = 3.4 + 0.5; // high edge (back), the original tilt is side * 0.1 rad over d + 1
  const yOut = 3.4 - 0.5;
  const yBackLow = side > 0 ? yOut : yIn;
  void yBackLow;
  // sheet roof: sloping plane high at the back (away from the road)
  const xa = side > 0 ? x0 : x1; // street end
  const xb = side > 0 ? x1 : x0; // back end
  const ya = 3.1;
  const yb = 3.7;
  const slope = Math.hypot(Math.abs(xb - xa), yb - ya) / 3.2;
  const roofCol = sheet(['#8a97a6', '#9aa5b4', '#a3a8ae', '#7c8795'][(dr() * 4) | 0]);
  const z0 = zc - w / 2 - 0.2;
  const z1 = zc + w / 2 + 0.2;
  if (side > 0) kit.fac.roof.poly([[xa, ya, z0], [xb, yb, z0], [xb, yb, z1], [xa, ya, z1]], roofCol, [[0, 0], [slope, 0], [slope, (z1 - z0) / 3.2], [0, (z1 - z0) / 3.2]]);
  else kit.fac.roof.poly([[xa, ya, z1], [xb, yb, z1], [xb, yb, z0], [xa, ya, z0]], roofCol, [[0, (z1 - z0) / 3.2], [slope, (z1 - z0) / 3.2], [slope, 0], [0, 0]]);
  kit.solid.poly([[xa, ya - 0.04, z0], [xa, ya - 0.04, z1], [xb, yb - 0.04, z1], [xb, yb - 0.04, z0]], '#6b7280');
  if (side < 0) {
    // keep the underside winding right for the mirrored side
    kit.solid.poly([[xa, ya - 0.05, z1], [xa, ya - 0.05, z0], [xb, yb - 0.05, z0], [xb, yb - 0.05, z1]], '#6b7280');
  }
  for (const dx of [0, d - 0.4]) for (const dz of [-w / 2 + 0.3, 0, w / 2 - 0.3]) kit.solid.box(0.2, 3.4, 0.2, side * (FACE + 1.3 + dx), 1.7, zc + dz, '#6b7280');
  const stalls = Math.max(2, Math.floor(w / 3.2));
  for (let i = 0; i < stalls; i++) {
    const z = zc - w / 2 + (i + 0.5) * (w / stalls);
    kit.solid.box(1.6, 0.9, 2.2, side * (FACE + 2.2), 0.45, z, '#8a6a46');
    if (kit.near) {
      for (let k = 0; k < 4; k++) kit.solid.box(0.4, 0.3, 0.4, side * (FACE + 2.2), 1.05, z - 0.8 + k * 0.55, pick(kit.nrng, BRIGHT));
      // table-top produce piles, a cloth drape, a hanging row of goods and a bulb
      bx(kit.solid, 1.7, 0.06, 2.3, side * (FACE + 2.2), 0.9, z, '#c9b48a');
      for (let k = 0; k < 5; k++) kit.solid.cone(0.2, 0.3, side * (FACE + 1.9), 1.2, z - 0.9 + k * 0.45, ['#d94f4f', '#e8b43c', '#3f9a5a', '#e07b2a'][(dr() * 4) | 0]);
      bx(kit.solid, 0.05, 0.6, 2.0, side * (FACE + 1.3), 1.7, z, ['#d94f4f', '#2f6fd6', '#e8b43c'][(dr() * 3) | 0]);
      kit.glow.sphere(0.07, 0.07, 0.07, side * (FACE + 2.6), 3.0, z + 0.4, '#ffe9b0');
      bx(kit.solid, 0.04, 0.06, 2.0, side * (FACE + 2.6), 3.05, z, '#444');
    }
  }
  kit.solid.box(0.15, 3.0, w, side * (FACE + 1 + d), 1.5, zc, '#a3a8ae'); // back wall
  if (kit.near) {
    // purlins under the sheet
    for (let k = 0; k < 4; k++) {
      const t = (k + 0.5) / 4;
      bx(kit.solid, 0.1, 0.14, w, xa + (xb - xa) * t, ya + (yb - ya) * t - 0.2, zc, '#4b5563');
    }
  }
  void r;
  return { w, d: d + 1 };
}

// ---------------------------------------------------------------------------------------------

export function placeBuilding(kit: Kit, side: 1 | -1, zc: number, slot: number, zone: Zone): { w: number; d: number; setback: number } {
  const r = kit.rng;
  // cosmetic choices (trim colours, which windows show, plant) come from their own rng: the layout rng below stays untouched
  const dr = makeRng(((kit.seed ?? 0x2545f491) ^ 0x7f4a7c15) >>> 0);
  const roll = r();
  let setback = 0;
  let res: { w: number; d: number };
  let compound = false;

  if (zone === 0) {
    if (roll < 0.78) {
      const v = Math.floor(r() * 4);
      setback = 3 + r() * 3;
      compound = true;
      res = [resA, resB, resC, resD][v](kit, side, zc, slot, setback, dr);
    } else {
      res = (roll < 0.9 ? shopA : shopC)(kit, side, zc, slot, dr);
    }
  } else if (zone === 1) {
    if (roll < 0.28) res = comA(kit, side, zc, slot, dr);
    else if (roll < 0.42) res = comB(kit, side, zc, slot, dr);
    else if (roll < 0.52) res = comC(kit, side, zc, slot, dr);
    else if (roll < 0.66) res = offA(kit, side, zc, slot, dr);
    else if (roll < 0.78) res = offB(kit, side, zc, slot, dr);
    else if (roll < 0.9) res = offC(kit, side, zc, slot, dr);
    else res = shopD(kit, side, zc, slot, dr);
  } else {
    const v = Math.floor(r() * 6);
    if (v === 0) res = shopA(kit, side, zc, slot, dr);
    else if (v === 1) res = shopB(kit, side, zc, slot, dr);
    else if (v === 2) res = shopC(kit, side, zc, slot, dr);
    else if (v === 3) res = shopD(kit, side, zc, slot, dr);
    else if (v === 4) res = shopE(kit, side, zc, slot, dr);
    else {
      setback = 2.5;
      compound = true;
      res = resC(kit, side, zc, slot, setback, dr);
    }
  }

  const wallCol = pick(r, COMPOUND);
  const treeOn = r() > 0.35;
  const treeZ = (r() - 0.5) * res.w * 0.6;
  if (compound && kit.near) {
    compoundWall(kit, side, zc, res.w, setback, wallCol);
    if (treeOn) yardTree(kit, side * (FACE + setback * 0.45), zc + treeZ);
  } else if (compound) {
    kit.solid.box(0.3, 2.2, res.w, side * (FACE + setback - 0.4), 1.1, zc, wallCol);
  }
  return { w: res.w, d: res.d, setback };
}


/** Landmark building for an origin/destination facade: face at x = +12.8, entrance near z = zc + 2 */
export function placeFacadeBuilding(kit: Kit, category: string, zc: number, slot: number): void {
  const dr = makeRng(((kit.seed ?? 0x51ed270b) ^ Math.floor(zc * 131)) >>> 0);
  switch (category) {
    case 'hospital':
      offC(kit, 1, zc, slot, dr);
      break;
    case 'office':
    case 'bank':
    case 'hotel':
      offA(kit, 1, zc, slot, dr);
      break;
    case 'university':
      offB(kit, 1, zc, slot, dr);
      break;
    case 'commercial':
    case 'market':
    case 'airport':
      comA(kit, 1, zc, slot, dr);
      break;
    case 'residential':
      shopC(kit, 1, zc, slot, dr);
      break;
    default:
      shopD(kit, 1, zc, slot, dr);
  }
}


/** Place every batch of a kit through the same rigid transform (stamp a local building onto any road) */
export function setKitTransform(kit: Kit, rotY: number, tx: number, tz: number): void {
  kit.solid.setGroupTransform(rotY, tx, tz);
  kit.glow.setGroupTransform(rotY, tx, tz);
  (Object.keys(kit.fac) as FacadeKind[]).forEach((k) => kit.fac[k].setGroupTransform(rotY, tx, tz));
  kit.signs.setTransform(rotY, tx, tz);
}

export function clearKitTransform(kit: Kit): void {
  kit.solid.clearGroupTransform();
  kit.glow.clearGroupTransform();
  (Object.keys(kit.fac) as FacadeKind[]).forEach((k) => kit.fac[k].clearGroupTransform());
  kit.signs.clearTransform();
}
