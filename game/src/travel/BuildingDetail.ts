import type { Kit } from './BuildingKit';
import type { GeoBatch } from './Geo';
import { BAY, FABRIC_TILE, FLOOR, GRILLE_ROW, GRILLE_ROWS, ROOF_TILE, WIN, SHOP_TILE_W } from './TravelMaterials';

/**
 * BuildingDetail - the small real-world parts that turn the kit's boxes into buildings: window sills and lintels, balconies with
 * railings, hip roofs of ribbed sheet with eaves, gutters and downpipes, parapets, rooftop plant, entrances, compound walls and
 * gates, shopfronts, awnings, containers.
 *
 * Frame: the kit's building-local frame (street at x = 0, the facade plane at x = side * face, the building extends away from the
 * street, z runs along it). Every helper that takes `side, face` places things relative to that plane; "out" means towards the street.
 * Nothing here consumes the layout rng (kit.rng); the layout stays exactly what the footprint planner dry-ran. Parts only the near LOD
 * needs are guarded by kit.near; the few cheap ones that shape the silhouette (roofs, parapets, plinths) are in both LODs.
 */

type Rng = () => number;
type P3 = [number, number, number];

/** box with its BOTTOM at y0 */
export function bx(b: GeoBatch, w: number, h: number, d: number, x: number, y0: number, z: number, color: string, o?: { rotX?: number; rotY?: number; rotZ?: number }): void {
  b.box(w, h, d, x, y0 + h / 2, z, color, o);
}

/** a colour a little darker / lighter (hex in, hex out) */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `#${((c((n >> 16) & 255) << 16) | (c((n >> 8) & 255) << 8) | c(n & 255)).toString(16).padStart(6, '0')}`;
}

export const TRIM = ['#f2efe6', '#e6e2d6', '#d8d4c8', '#cfd2d4', '#f5f5f2'];
export const IRON = ['#1d2023', '#2a2d31', '#3a2c26', '#1f3d2f'];
export const TANK = ['#1f2937', '#1f2937', '#273449', '#2f4f3a'];

// ------------------------------------------------------------------------------------------------
// vertical panels from the railing / gate / louvre / mesh atlas (alpha-tested, double sided)
// ------------------------------------------------------------------------------------------------

/** a vertical atlas panel from horizontal point a to b (x, z), from y0 up h metres; the pattern repeats every metre along it */
export function grillePanel(kit: Kit, row: number, ax: number, az: number, bx_: number, bz: number, y0: number, h: number, color: string): void {
  const len = Math.hypot(bx_ - ax, bz - az);
  if (len < 0.05) return;
  const v0 = row / GRILLE_ROWS;
  const v1 = (row + 1) / GRILLE_ROWS;
  kit.fac.grille.poly(
    [[ax, y0, az], [bx_, y0, bz], [bx_, y0 + h, bz], [ax, y0 + h, az]],
    color,
    [[0, v0 + 0.004], [len, v0 + 0.004], [len, v1 - 0.004], [0, v1 - 0.004]]
  );
}

// ------------------------------------------------------------------------------------------------
// roofs
// ------------------------------------------------------------------------------------------------

export interface HipSpec {
  /** wall footprint centre and size: cx (x), zc (z), d = size along x, w = size along z */
  cx: number;
  zc: number;
  d: number;
  w: number;
  /** height of the wall top (the eave line sits just under it) */
  yTop: number;
  rise: number;
  overhang: number;
  /** sheet colour (tints the ribbed sheet texture) */
  color: string;
  /** fascia / gutter colour */
  trim: string;
}

/** hip roof of ribbed sheet: four sloping planes, soffit, fascia, ridge cap, gutters (near) */
export function hipRoof(kit: Kit, s: HipSpec): void {
  const o = s.overhang;
  const x0 = s.cx - s.d / 2 - o;
  const x1 = s.cx + s.d / 2 + o;
  const z0 = s.zc - s.w / 2 - o;
  const z1 = s.zc + s.w / 2 + o;
  const ye = s.yTop - 0.12;
  const yr = ye + s.rise;
  const xm = (x0 + x1) / 2;
  const hdx = (x1 - x0) / 2;
  const hdz = (z1 - z0) / 2;
  const alongZ = hdz >= hdx;
  const inset = alongZ ? hdx : hdz;
  // ridge end points
  const xa = alongZ ? xm : x0 + inset;
  const xb = alongZ ? xm : x1 - inset;
  const za = alongZ ? z0 + inset : (z0 + z1) / 2;
  const zb = alongZ ? z1 - inset : (z0 + z1) / 2;
  const R = kit.fac.roof;
  const T = ROOF_TILE;
  const slopeX = Math.hypot(hdx, s.rise) / T;
  const slopeZ = Math.hypot(hdz, s.rise) / T;
  if (alongZ) {
    // planes toward -x and +x, hips at both ends
    const L = (z1 - z0) / T;
    R.poly([[x0, ye, z0], [x0, ye, z1], [xm, yr, zb], [xm, yr, za]], s.color, [[0, 0], [L, 0], [(zb - z0) / T, slopeX], [(za - z0) / T, slopeX]]);
    R.poly([[x1, ye, z0], [xm, yr, za], [xm, yr, zb], [x1, ye, z1]], s.color, [[0, 0], [(za - z0) / T, slopeX], [(zb - z0) / T, slopeX], [L, 0]]);
    const W2 = (x1 - x0) / T;
    R.poly([[x0, ye, z0], [xm, yr, za], [x1, ye, z0]], s.color, [[0, 0], [W2 / 2, slopeZ], [W2, 0]]);
    R.poly([[x0, ye, z1], [x1, ye, z1], [xm, yr, zb]], s.color, [[0, 0], [W2, 0], [W2 / 2, slopeZ]]);
  } else {
    // ridge along x: planes toward -z and +z, hips at both ends
    const L = (x1 - x0) / T;
    const zm = (z0 + z1) / 2;
    R.poly([[x0, ye, z0], [xa, yr, zm], [xb, yr, zm], [x1, ye, z0]], s.color, [[0, 0], [(xa - x0) / T, slopeZ], [(xb - x0) / T, slopeZ], [L, 0]]);
    R.poly([[x0, ye, z1], [x1, ye, z1], [xb, yr, zm], [xa, yr, zm]], s.color, [[0, 0], [L, 0], [(xb - x0) / T, slopeZ], [(xa - x0) / T, slopeZ]]);
    const W2 = (z1 - z0) / T;
    R.poly([[x0, ye, z0], [x0, ye, z1], [xa, yr, zm]], s.color, [[0, 0], [W2, 0], [W2 / 2, slopeX]]);
    R.poly([[x1, ye, z0], [xb, yr, zm], [x1, ye, z1]], s.color, [[0, 0], [W2 / 2, slopeX], [W2, 0]]);
  }
  // soffit (looking up under the overhang)
  kit.solid.poly([[x0, ye - 0.02, z0], [x1, ye - 0.02, z0], [x1, ye - 0.02, z1], [x0, ye - 0.02, z1]], '#8a8478');
  if (!kit.near) return;
  const ft = s.trim;
  // fascia boards round the eave
  bx(kit.solid, x1 - x0 + 0.1, 0.2, 0.06, xm, ye - 0.14, z0, ft);
  bx(kit.solid, x1 - x0 + 0.1, 0.2, 0.06, xm, ye - 0.14, z1, ft);
  bx(kit.solid, 0.06, 0.2, z1 - z0, x0, ye - 0.14, s.zc, ft);
  bx(kit.solid, 0.06, 0.2, z1 - z0, x1, ye - 0.14, s.zc, ft);
  // gutters on the two long eaves
  if (alongZ) {
    bx(kit.solid, 0.11, 0.1, z1 - z0 - 0.2, x0 - 0.06, ye - 0.04, s.zc, '#5b616a');
    bx(kit.solid, 0.11, 0.1, z1 - z0 - 0.2, x1 + 0.06, ye - 0.04, s.zc, '#5b616a');
  } else {
    bx(kit.solid, x1 - x0 - 0.2, 0.1, 0.11, xm, ye - 0.04, z0 - 0.06, '#5b616a');
    bx(kit.solid, x1 - x0 - 0.2, 0.1, 0.11, xm, ye - 0.04, z1 + 0.06, '#5b616a');
  }
  // ridge cap + hip caps
  const cap = shade(s.color, 0.72);
  if (alongZ) bx(kit.solid, 0.2, 0.1, zb - za + 0.2, xm, yr - 0.02, s.zc + (za + zb) / 2 - s.zc, cap);
  else bx(kit.solid, xb - xa + 0.2, 0.1, 0.2, (xa + xb) / 2, yr - 0.02, (z0 + z1) / 2, cap);
}

/** flat roof edge: parapet on all four sides with a coping; `near` adds the coping, scuppers and a roof-edge safety line */
export function parapet(kit: Kit, side: 1 | -1, face: number, zc: number, w: number, d: number, topY: number, h: number, color: string, coping = '#d8d4c8'): void {
  const t = 0.22;
  const cx = side * (face + d / 2);
  const xf = side * (face + t / 2 - 0.05);
  const xb = side * (face + d - t / 2 + 0.05);
  bx(kit.solid, t, h, w, xf, topY, zc, color);
  bx(kit.solid, t, h, w, xb, topY, zc, color);
  bx(kit.solid, d - 2 * t + 0.1, h, t, cx, topY, zc - w / 2 + t / 2 - 0.02, color);
  bx(kit.solid, d - 2 * t + 0.1, h, t, cx, topY, zc + w / 2 - t / 2 + 0.02, color);
  if (!kit.near) return;
  const c = 0.07;
  bx(kit.solid, t + 0.1, c, w + 0.1, xf, topY + h, zc, coping);
  bx(kit.solid, t + 0.1, c, w + 0.1, xb, topY + h, zc, coping);
  bx(kit.solid, d - 2 * t, c, t + 0.1, cx, topY + h, zc - w / 2 + t / 2 - 0.02, coping);
  bx(kit.solid, d - 2 * t, c, t + 0.1, cx, topY + h, zc + w / 2 - t / 2 + 0.02, coping);
}

/** projecting cornice / roof slab with a dentil-ish second step under it */
export function cornice(kit: Kit, side: 1 | -1, face: number, zc: number, w: number, y: number, color: string): void {
  bx(kit.solid, 0.3, 0.12, w + 0.3, side * (face - 0.13), y, zc, color);
  if (kit.near) bx(kit.solid, 0.18, 0.1, w + 0.18, side * (face - 0.07), y - 0.1, zc, shade(color, 0.92));
}

/** a plain base course round the front of a building (both LODs: one box) */
export function plinth(kit: Kit, side: 1 | -1, face: number, zc: number, w: number, color: string, h = 0.55): void {
  bx(kit.solid, 0.12, h, w + 0.08, side * (face - 0.05), 0, zc, color);
}

// ------------------------------------------------------------------------------------------------
// windows
// ------------------------------------------------------------------------------------------------

export interface TrimSpec {
  side: 1 | -1;
  face: number;
  zc: number;
  /** number of bays (w = bays * BAY) */
  bays: number;
  floors: number;
  /** y of the ground line of the facade box */
  y0: number;
  /** sill / lintel colour */
  color: string;
  /** probability of a window air conditioner (0..1) */
  ac?: number;
  /** projecting hood over the window instead of a flat lintel (probability) */
  hood?: number;
  /** floors to skip (e.g. a balcony floor) */
  skip?: (floor: number, bay: number) => boolean;
}

/** sills, lintels / hoods and air-conditioners on the painted windows of a 'res' facade (windows are where the texture paints them) */
export function resWindowTrim(kit: Kit, dr: Rng, s: TrimSpec): void {
  if (!kit.near) return;
  const w0 = s.zc - (s.bays * BAY) / 2;
  const ww = WIN.res.w;
  const hh = WIN.res.y1 - WIN.res.y0;
  for (let fl = 0; fl < s.floors; fl++) {
    for (let b = 0; b < s.bays; b++) {
      if (s.skip?.(fl, b)) continue;
      const z = w0 + (b + 0.5) * BAY;
      const base = s.y0 + fl * FLOOR;
      const yw = base + WIN.res.y0;
      // sill: a stone slab that sticks out and a lip under it
      bx(kit.solid, 0.2, 0.09, ww + 0.34, s.side * (s.face - 0.1), yw - 0.17, z, s.color);
      // a projecting hood on some windows (the others keep the lintel painted in the texture): 2 boxes per window at most
      if (dr() < (s.hood ?? 0.25) + 0.2) bx(kit.solid, 0.3, 0.08, ww + 0.4, s.side * (s.face - 0.15), yw + hh + 0.08, z, s.color);
      if (dr() < (s.ac ?? 0.16)) acUnit(kit, s.side, s.face, z + (dr() < 0.5 ? -1 : 1) * (ww / 2 + 0.55), yw - 0.05);
    }
  }
}

/** split air-conditioner condenser on brackets */
export function acUnit(kit: Kit, side: 1 | -1, face: number, z: number, y0: number): void {
  bx(kit.solid, 0.34, 0.62, 0.86, side * (face - 0.17 - 0.06), y0, z, '#d9dcdf');
  bx(kit.solid, 0.04, 0.5, 0.62, side * (face - 0.36), y0 + 0.06, z, '#3b4047'); // fan grille
}

/** ribbon-window trim for the 'com' facade: a continuous sill and a sun-shade lintel on every floor */
export function ribbonTrim(kit: Kit, side: 1 | -1, face: number, zc: number, w: number, floors: number, y0: number, sill: string, shadeCol: string, depth = 0.34): void {
  for (let fl = 0; fl < floors; fl++) {
    const base = y0 + fl * FLOOR;
    bx(kit.solid, 0.16, 0.09, w + 0.04, side * (face - 0.08), base + WIN.com.y0 - 0.15, zc, sill);
    bx(kit.solid, depth, 0.09, w + 0.1, side * (face - depth / 2), base + WIN.com.y1 + 0.06, zc, shadeCol);
  }
}

/** horizontal slab-edge band at each floor line */
export function slabBands(kit: Kit, side: 1 | -1, face: number, zc: number, w: number, d: number, floors: number, y0: number, color: string, from = 1): void {
  for (let fl = from; fl < floors; fl++) {
    bx(kit.solid, 0.12, 0.2, w + 0.06, side * (face - 0.05), y0 + fl * FLOOR - 0.1, zc, color);
  }
  void d;
}

// ------------------------------------------------------------------------------------------------
// balconies
// ------------------------------------------------------------------------------------------------

/** slab + three-sided railing (atlas panel) + corner posts, in front of the facade at floor level y */
export function balcony(kit: Kit, side: 1 | -1, face: number, z: number, width: number, y: number, depth: number, slab: string, rail: string): void {
  bx(kit.solid, depth, 0.16, width, side * (face - depth / 2), y - 0.16, z, slab);
  if (!kit.near) return;
  const xf = side * (face - depth + 0.04);
  const xw = side * face;
  grillePanel(kit, GRILLE_ROW.rail, xf, z - width / 2 + 0.04, xf, z + width / 2 - 0.04, y, 1.0, rail);
  grillePanel(kit, GRILLE_ROW.rail, xw, z - width / 2 + 0.04, xf, z - width / 2 + 0.04, y, 1.0, rail);
  grillePanel(kit, GRILLE_ROW.rail, xw, z + width / 2 - 0.04, xf, z + width / 2 - 0.04, y, 1.0, rail);
  for (const sz of [-1, 1]) bx(kit.solid, 0.07, 1.02, 0.07, xf, y, z + (sz * (width - 0.1)) / 2, rail);
}

// ------------------------------------------------------------------------------------------------
// rooftop plant
// ------------------------------------------------------------------------------------------------

/** black plastic water tank on a steel stand */
export function waterTank(kit: Kit, x: number, y0: number, z: number, big = false): void {
  const r = big ? 1.0 : 0.78;
  const h = big ? 1.7 : 1.25;
  const col = TANK[(Math.abs(Math.round(x * 7 + z * 13)) | 0) % TANK.length];
  bx(kit.solid, r * 1.5, 0.7, r * 1.5, x, y0, z, '#59606a'); // stand
  bx(kit.solid, r * 2 - 0.1, 0.1, r * 2 - 0.1, x, y0 + 0.7, z, '#59606a');
  kit.solid.cyl(r, h, x, y0 + 0.8 + h / 2, z, col);
  kit.solid.cyl(r * 0.95, 0.07, x, y0 + 0.8 + h + 0.03, z, shade(col, 1.4)); // lid
}

/** solar water heater: tilted collector + horizontal drum */
export function solarHeater(kit: Kit, x: number, y0: number, z: number): void {
  bx(kit.solid, 0.1, 0.5, 1.0, x - 0.5, y0, z, '#59606a');
  kit.solid.box(1.5, 0.08, 1.1, x, y0 + 0.55, z, '#1c2c46', { rotZ: 0.45 });
  kit.solid.cyl(0.24, 1.2, x + 0.1, y0 + 1.05, z, '#cfd3d7', { rotX: Math.PI / 2 });
}

export function satelliteDish(kit: Kit, x: number, y0: number, z: number, rot = 0.6): void {
  kit.solid.cyl(0.04, 0.9, x, y0 + 0.45, z, '#4b5563');
  kit.solid.cyl(0.42, 0.06, x, y0 + 0.95, z, '#e4e6e8', { rotZ: rot });
  bx(kit.solid, 0.04, 0.04, 0.04, x - Math.sin(rot) * 0.3, y0 + 1.05, z, '#2b2e33');
}

export function antenna(kit: Kit, x: number, y0: number, z: number, h = 3.2): void {
  kit.solid.cyl(0.035, h, x, y0 + h / 2, z, '#4b5563');
  for (const [k, w] of [[0.62, 1.1], [0.78, 0.9], [0.92, 0.6]] as const) bx(kit.solid, 0.03, 0.03, w, x, y0 + h * k, z, '#4b5563');
}

/** the stair-head / lift-motor-room box with a door and louvres */
export function stairHead(kit: Kit, side: 1 | -1, x: number, y0: number, z: number, w: number, d: number, h: number, color: string): void {
  bx(kit.solid, d, h, w, x, y0, z, color);
  bx(kit.solid, d + 0.3, 0.12, w + 0.3, x, y0 + h, z, '#8d8d88');
  bx(kit.solid, 0.06, 2.0, 0.9, x - side * (d / 2 + 0.02), y0, z - w * 0.25, '#2f3e46');
  grillePanel(kit, GRILLE_ROW.louvre, x - side * (d / 2 + 0.01), z + w * 0.05, x - side * (d / 2 + 0.01), z + w * 0.42, y0 + 1.2, 0.9, '#c9c3b4');
}

/** a random handful of roof-deck items on a flat roof (centre cx, zc; footprint d x w; deck level y) */
export function roofDeck(kit: Kit, dr: Rng, side: 1 | -1, cx: number, zc: number, d: number, w: number, y: number, opts?: { tanks?: number; heavy?: boolean }): void {
  if (!kit.near) return;
  const slot = (a: number, b: number): [number, number] => [cx + (a - 0.5) * (d - 3.2), zc + (b - 0.5) * (w - 3.2)];
  const n = opts?.tanks ?? (dr() < 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const [x, z] = slot(0.25 + dr() * 0.5, (i + 0.5) / n + (dr() - 0.5) * 0.12);
    waterTank(kit, x, y, z, !!opts?.heavy);
  }
  if (dr() < 0.5) {
    const [x, z] = slot(0.2 + dr() * 0.6, 0.1 + dr() * 0.8);
    solarHeater(kit, x, y, z);
  }
  const acs = dr() < 0.6 ? 1 + ((dr() * 3) | 0) : 0;
  for (let i = 0; i < acs; i++) {
    const [x, z] = slot(0.15 + dr() * 0.7, 0.1 + dr() * 0.8);
    bx(kit.solid, 0.8, 0.8, 1.0, x, y, z, '#cdd1d5');
    bx(kit.solid, 0.04, 0.6, 0.7, x - side * 0.4, y + 0.1, z, '#3b4047');
  }
  if (dr() < 0.5) {
    const [x, z] = slot(0.1 + dr() * 0.8, 0.1 + dr() * 0.8);
    satelliteDish(kit, x, y, z, 0.4 + dr() * 0.5);
  }
  if (dr() < 0.4) {
    const [x, z] = slot(0.5, 0.5);
    antenna(kit, x, y, z, 2.6 + dr() * 2);
  }
  // vent stacks
  const vents = (dr() * 3) | 0;
  for (let i = 0; i < vents; i++) {
    const [x, z] = slot(dr(), dr());
    kit.solid.cyl(0.09, 0.8, x, y + 0.4, z, '#7a828c');
  }
}

// ------------------------------------------------------------------------------------------------
// entrances, gates, walls
// ------------------------------------------------------------------------------------------------

/** a door with a frame, a fanlight, two steps, a little canopy, a wall lamp and a house number */
export function entrance(kit: Kit, dr: Rng, side: 1 | -1, face: number, z: number, y0: number, color: string, opts?: { canopy?: boolean; glass?: boolean; wide?: number }): void {
  if (!kit.near) return;
  const dw = opts?.wide ?? 1.1;
  const doorCol = opts?.glass ? '#1d2c3a' : ['#4a2f1f', '#2f3e46', '#5b2c2c', '#3d3a36'][(dr() * 4) | 0];
  // reveal + frame
  bx(kit.solid, 0.1, 2.28, dw + 0.3, side * (face - 0.05), y0, z, color);
  bx(kit.solid, 0.07, 2.12, dw, side * (face - 0.1), y0, z, doorCol);
  if (opts?.glass) {
    bx(kit.solid, 0.04, 1.9, dw * 0.46, side * (face - 0.14), y0 + 0.1, z - dw * 0.24, '#8fb4cf');
    bx(kit.solid, 0.04, 1.9, dw * 0.46, side * (face - 0.14), y0 + 0.1, z + dw * 0.24, '#8fb4cf');
    bx(kit.solid, 0.06, 0.05, dw, side * (face - 0.14), y0 + 1.1, z, '#c9ced3');
  } else {
    for (const k of [-1, 1]) bx(kit.solid, 0.03, 0.8, dw * 0.38, side * (face - 0.13), y0 + 0.9, z + (k * dw) / 4, shade(doorCol, 1.25));
    bx(kit.solid, 0.05, 0.05, 0.16, side * (face - 0.14), y0 + 1.0, z + dw * 0.38, '#c9b25a'); // handle
  }
  // steps
  bx(kit.solid, 0.7, 0.13, dw + 0.6, side * (face - 0.35), 0, z, '#bdb8ad');
  bx(kit.solid, 0.4, 0.13, dw + 0.4, side * (face - 0.7), 0, z, '#b3aea3');
  if (opts?.canopy) {
    bx(kit.solid, 0.9, 0.1, dw + 1.0, side * (face - 0.45), y0 + 2.4, z, color);
    bx(kit.solid, 0.92, 0.04, dw + 1.04, side * (face - 0.45), y0 + 2.5, z, shade(color, 0.85));
  }
  // number plate + lamp
  bx(kit.solid, 0.03, 0.18, 0.3, side * (face - 0.03), y0 + 2.2, z - dw * 0.8, '#1f3d6b');
  kit.glow.box(0.12, 0.14, 0.12, side * (face - 0.1), y0 + 2.1, z + dw * 0.85, '#ffe9b0');
  bx(kit.solid, 0.08, 0.04, 0.08, side * (face - 0.08), y0 + 2.26, z + dw * 0.85, '#3a3d42');
}

function pier(kit: Kit, x: number, z: number, h: number, col: string, lamp: boolean, size = 0.5): void {
  bx(kit.solid, size, h, size, x, 0, z, col);
  bx(kit.solid, size + 0.12, 0.1, size + 0.12, x, h, z, shade(col, 0.92));
  if (lamp) kit.glow.box(size - 0.16, 0.3, size - 0.16, x, h + 0.3, z, '#fef3c7');
}

/**
 * Compound wall along the lot front: rendered wall with a dark base band, piers every ~3 m, coping, an optional wire screen on top,
 * and a sliding steel gate between two gate piers (barred, with a solid lower panel).
 */
export function compoundWallNear(kit: Kit, side: 1 | -1, zc: number, w: number, x: number, col: string): void {
  const r = kit.nrng;
  const gateAt = (r() - 0.5) * (w * 0.5);
  const gateW = 3.4;
  const wallH = 2.1 + r() * 0.5;
  const base = shade(col, 0.78);
  const seg = (z0: number, z1: number) => {
    const len = z1 - z0;
    if (len < 0.2) return;
    const zm = (z0 + z1) / 2;
    bx(kit.solid, 0.3, wallH, len, x, 0, zm, col);
    bx(kit.solid, 0.34, 0.5, len, x, 0, zm, base); // painted base band
    bx(kit.solid, 0.42, 0.12, len, x, wallH, zm, '#8d8577'); // coping
    // piers every ~3 m
    const n = Math.max(0, Math.floor(len / 3.0));
    for (let i = 1; i <= n; i++) {
      const pz = z0 + (i * len) / (n + 1);
      bx(kit.solid, 0.46, wallH + 0.1, 0.4, x, 0, pz, shade(col, 1.05));
    }
    // wire screen above the coping on the longer runs (razor-wire look)
    if (len > 1.6 && r() < 0.5) grillePanel(kit, GRILLE_ROW.mesh, x, z0 + 0.1, x, z1 - 0.1, wallH + 0.17, 0.42, '#2b2d31');
  };
  seg(zc - w / 2, zc + gateAt - gateW / 2);
  seg(zc + gateAt + gateW / 2, zc + w / 2);
  // gate piers (taller, with lamps)
  const lamp = r() > 0.35;
  pier(kit, x, zc + gateAt - gateW / 2, wallH + 0.45, shade(col, 1.04), lamp, 0.56);
  pier(kit, x, zc + gateAt + gateW / 2, wallH + 0.45, shade(col, 1.04), lamp, 0.56);
  // gate leaf: frame, barred panel, solid kick plate, little name plate
  const gc = r() > 0.5 ? '#2f3e46' : '#5b2c2c';
  const gz = zc + gateAt;
  const gh = wallH - 0.3;
  const gx = x - side * 0.04;
  bx(kit.solid, 0.1, 0.12, gateW - 0.45, x, 0.12, gz, gc);
  bx(kit.solid, 0.1, 0.12, gateW - 0.45, x, 0.12 + gh - 0.12, gz, gc);
  bx(kit.solid, 0.1, gh, 0.1, x, 0.12, gz - (gateW - 0.45) / 2 + 0.05, gc);
  bx(kit.solid, 0.1, gh, 0.1, x, 0.12, gz + (gateW - 0.45) / 2 - 0.05, gc);
  bx(kit.solid, 0.08, 0.7, gateW - 0.5, x, 0.12, gz, gc);
  grillePanel(kit, GRILLE_ROW.gate, gx, gz - (gateW - 0.65) / 2, gx, gz + (gateW - 0.65) / 2, 0.84, gh - 0.88, gc);
  bx(kit.solid, 0.04, 0.2, 0.34, x - side * 0.1, 1.2, gz - gateW / 2 + 0.55, '#d9d4c0');
  // wheel track
  bx(kit.solid, 0.06, 0.04, gateW + 1.2, x - side * 0.02, 0, gz, '#6b7280');
}

// ------------------------------------------------------------------------------------------------
// shopfront parts
// ------------------------------------------------------------------------------------------------


/**
 * fabric polygon: UVs are projected from the dominant axis of the face normal (metres / FABRIC_TILE), the winding is flipped
 * if needed so the normal faces `toward` (a direction vector); the fabric material is double sided, so the back is lit too
 */
export function fpoly(kit: Kit, pts: P3[], color: string, toward: P3): void {
  const ax = pts[1][0] - pts[0][0], ay = pts[1][1] - pts[0][1], az = pts[1][2] - pts[0][2];
  const bx2 = pts[2][0] - pts[0][0], by = pts[2][1] - pts[0][1], bz = pts[2][2] - pts[0][2];
  const nx = ay * bz - az * by, ny = az * bx2 - ax * bz, nz = ax * by - ay * bx2;
  const flip = nx * toward[0] + ny * toward[1] + nz * toward[2] < 0;
  const p = flip ? pts.slice().reverse() : pts;
  const anx = Math.abs(nx), any = Math.abs(ny), anz = Math.abs(nz);
  const T = FABRIC_TILE;
  const uvs = p.map((q): [number, number] => (any >= anx && any >= anz ? [q[0] / T, q[2] / T] : anx >= anz ? [q[2] / T, q[1] / T] : [q[0] / T, q[1] / T]));
  kit.fac.fabric.poly(p, color, uvs);
}

/** striped, sloping awning with a scalloped valance (fabric polygons: a handful of triangles per metre) */
export function stripedAwning(kit: Kit, side: 1 | -1, z0: number, w: number, y: number, depth: number, c1: string, c2: string): void {
  const stripes = Math.max(2, Math.round(w / 0.8));
  const sw = w / stripes;
  const xin = side * 12.8;
  const xout = side * (12.8 - depth);
  const yi = y + 0.16;
  const yo = y - 0.17;
  const zA = z0 - w / 2;
  const up: P3 = [0, 1, 0];
  const out: P3 = [-side, 0, 0];
  for (let i = 0; i < stripes; i++) {
    const za = zA + i * sw;
    const zb = za + sw;
    const c = i % 2 ? c2 : c1;
    fpoly(kit, [[xin, yi, za], [xout, yo, za], [xout, yo, zb], [xin, yi, zb]], c, up);
    // valance hanging from the front edge, facing the street: a scallop per stripe in near, a straight strip in far
    if (kit.near) fpoly(kit, [[xout, yo, za], [xout, yo, zb], [xout, yo - 0.2, (za + zb) / 2]], c, out);
    else fpoly(kit, [[xout, yo - 0.2, za], [xout, yo - 0.2, zb], [xout, yo, zb], [xout, yo, za]], c, out);
  }
  if (kit.near) {
    // one underside for the whole awning, a front bar
    kit.solid.poly(side > 0 ? [[xin, yi - 0.03, zA + w], [xout, yo - 0.03, zA + w], [xout, yo - 0.03, zA], [xin, yi - 0.03, zA]] : [[xin, yi - 0.03, zA], [xout, yo - 0.03, zA], [xout, yo - 0.03, zA + w], [xin, yi - 0.03, zA + w]], shade(c1, 0.55));
    bx(kit.solid, 0.06, 0.05, w + 0.06, xout, yo - 0.24, z0, '#2f343a');
  }
}

// ------------------------------------------------------------------------------------------------
// market parasols and vendor stalls
// ------------------------------------------------------------------------------------------------

export const FABRIC_COL = ['#e0342b', '#f08a1c', '#2f7fd6', '#1f9d55', '#d63b8f', '#f2c21b', '#7a4bc0', '#14a3a3'];
const CREAM = '#f3efe4';

/**
 * a big market parasol: eight panels in two rings (domed), scalloped valance, finial, pole and a tyre-and-concrete foot.
 * `striped`: panels alternate colour / cream, otherwise a single colour with a cream valance. Rim height `hRim`.
 */
export function parasol(kit: Kit, dr: Rng, x: number, z: number, col: string, R: number, hRim: number, striped: boolean, withFoot = true): void {
  const N = 8;
  const rot = dr() * Math.PI;
  const apexY = hRim + 0.62;
  const midY = hRim + 0.3;
  const ang = (i: number) => rot + (i * Math.PI * 2) / N;
  const ring = (rr: number, yy: number, i: number): P3 => [x + Math.cos(ang(i)) * rr, yy, z + Math.sin(ang(i)) * rr];
  const apex: P3 = [x, apexY, z];
  const up: P3 = [0, 1, 0];
  const dark = shade(col, 0.82);
  for (let i = 0; i < N; i++) {
    const c = striped && i % 2 ? CREAM : col;
    const j = i + 1;
    fpoly(kit, [apex, ring(R * 0.5, midY, i), ring(R * 0.5, midY, j)], c, up);
    fpoly(kit, [ring(R * 0.5, midY, i), ring(R, hRim, i), ring(R, hRim, j), ring(R * 0.5, midY, j)], c, up);
    const mid = (i + 0.5) * ((Math.PI * 2) / N) + rot;
    const rad: P3 = [Math.cos(mid), 0, Math.sin(mid)];
    const vc = striped ? c : i % 2 ? CREAM : dark;
    if (kit.near) fpoly(kit, [ring(R, hRim, i), ring(R, hRim, j), [x + Math.cos(mid) * R * 0.995, hRim - 0.2, z + Math.sin(mid) * R * 0.995]], vc, rad);
  }
  // pole, finial, foot
  bx(kit.solid, 0.05, apexY + 0.08, 0.05, x, 0, z, '#cfd2d6');
  if (!kit.near) return;
  kit.solid.cone(0.06, 0.14, x, apexY + 0.1, z, '#34383d');
  bx(kit.solid, 0.08, 0.1, 0.08, x, 1.3, z, '#2b2e33'); // collar
  if (withFoot) {
    kit.solid.cyl(0.3, 0.2, x, 0.1, z, '#1c1d1f'); // old tyre
    kit.solid.cyl(0.18, 0.012, x, 0.205, z, '#9b9a94'); // concrete fill
  }
}

/** a street vendor's stall under a parasol: trestle table, cloth, goods, crate, stool. Table faces the street (-side). */
export function vendorStall(kit: Kit, dr: Rng, side: 1 | -1, vx: number, z: number, col: string): void {
  const striped = dr() < 0.55;
  const R = 1.3 + dr() * 0.3;
  parasol(kit, dr, vx, z, col, R, 1.95 + dr() * 0.12, striped);
  const tx = vx - side * 0.65; // table centre
  const wood = '#8a6a46';
  const cloth = FABRIC_COL[(dr() * FABRIC_COL.length) | 0];
  // trestle table: top, two end boards, shelf
  bx(kit.solid, 0.85, 0.05, 1.5, tx, 0.74, z, wood);
  bx(kit.solid, 0.7, 0.72, 0.05, tx, 0.02, z - 0.68, shade(wood, 0.8));
  bx(kit.solid, 0.7, 0.72, 0.05, tx, 0.02, z + 0.68, shade(wood, 0.8));
  bx(kit.solid, 0.7, 0.03, 1.3, tx, 0.28, z, shade(wood, 0.7));
  const topY = 0.795;
  const hx = 0.46; // half depth of the cloth
  const hz = 0.8;
  fpoly(kit, [[tx - hx, topY + 0.004, z - hz], [tx + hx, topY + 0.004, z - hz], [tx + hx, topY + 0.004, z + hz], [tx - hx, topY + 0.004, z + hz]], cloth, [0, 1, 0]);
  const fx = tx - side * hx;
  fpoly(kit, [[fx, topY, z - hz], [fx, topY, z + hz], [fx, topY - 0.36, z + hz * 0.96], [fx, topY - 0.36, z - hz * 0.96]], shade(cloth, 0.88), [-side, 0, 0]);
  if (!kit.near) return;
  const gy = topY + 0.006;
  const kind = (dr() * 3) | 0;
  if (kind === 0) {
    // fruit baskets
    const fr = ['#f08a24', '#5aa832', '#d6342a', '#f2c21b'];
    for (let i = 0; i < 3; i++) {
      const zz = z - 0.48 + i * 0.48;
      kit.solid.cyl(0.2, 0.13, tx, gy + 0.065, zz, '#a67c52');
      kit.solid.sphere(0.2, 0.11, 0.2, tx, gy + 0.13, zz, fr[(dr() * fr.length) | 0]);
    }
  } else if (kind === 1) {
    // tinned provisions and cartons
    const tin = ['#d6342a', '#2f6fd6', '#f2c21b', '#3f9a5a', '#e8eaec'];
    for (let i = 0; i < 4; i++) for (let k = 0; k < 2; k++) bx(kit.solid, 0.14, 0.11, 0.11, tx + (k - 0.5) * 0.2, gy, z - 0.55 + i * 0.37, tin[(dr() * tin.length) | 0]);
    bx(kit.solid, 0.3, 0.22, 0.4, tx, gy + 0.11, z + 0.15, '#b79a6a');
  } else {
    // folded cloth and fabric stacks
    for (let i = 0; i < 3; i++) {
      const n = 2 + ((dr() * 3) | 0);
      for (let k = 0; k < n; k++) bx(kit.solid, 0.36, 0.06, 0.42, tx, gy + k * 0.06, z - 0.5 + i * 0.5, FABRIC_COL[(dr() * FABRIC_COL.length) | 0]);
    }
  }
  // under the table: a crate and a jerry can; beside it: a plastic stool; a sack behind
  bx(kit.solid, 0.4, 0.28, 0.5, tx, 0.31, z + 0.2, '#d9a441');
  kit.solid.cyl(0.14, 0.38, tx, 0.19, z - 0.4, '#e8e4d0');
  const sc = FABRIC_COL[(dr() * FABRIC_COL.length) | 0];
  kit.solid.cyl(0.18, 0.04, vx + side * 0.55, 0.42, z + 0.7, sc);
  kit.solid.cyl(0.13, 0.4, vx + side * 0.55, 0.2, z + 0.7, shade(sc, 0.85));
  if (dr() < 0.5) bx(kit.solid, 0.5, 0.4, 0.4, vx + side * 0.8, 0, z - 0.7, '#b79a6a');
}

/** a cafe parasol on a round table with two stools (district cafes); `x,z` are in the kit's local frame */
export function cafeSet(kit: Kit, dr: Rng, x: number, z: number, col: string): void {
  parasol(kit, dr, x, z, col, 1.3, 2.1, dr() < 0.4, false);
  kit.solid.cyl(0.42, 0.05, x, 0.74, z, '#d9d3c6');
  kit.solid.cyl(0.05, 0.72, x, 0.36, z, '#6b7280');
  kit.solid.cyl(0.26, 0.04, x, 0.02, z, '#5b6068');
  for (const a of [0.6, 2.7, 4.6]) {
    const sx = x + Math.cos(a) * 0.75;
    const sz = z + Math.sin(a) * 0.75;
    kit.solid.cyl(0.17, 0.05, sx, 0.45, sz, '#3b3f45');
    kit.solid.cyl(0.03, 0.42, sx, 0.21, sz, '#6b7280');
  }
}

/** a roller-shutter box over an opening (near) */
export function shutterBox(kit: Kit, side: 1 | -1, z: number, w: number, y: number): void {
  if (!kit.near) return;
  bx(kit.solid, 0.3, 0.26, w, side * (12.8 - 0.15), y, z, '#7a8087');
  bx(kit.solid, 0.32, 0.03, w + 0.04, side * (12.8 - 0.16), y + 0.26, z, '#5b6068');
}

/** corrugated steel shipping-container style box: body, ribs on the long faces, door frame and handles */
export function containerBox(kit: Kit, side: 1 | -1, xc: number, z: number, d: number, h: number, wz: number, col: string, near: boolean): void {
  bx(kit.solid, d, h, wz, xc, 0.15, z, col);
  bx(kit.solid, d + 0.02, 0.12, wz + 0.02, xc, 0.03, z, shade(col, 0.6)); // base rails
  bx(kit.solid, d + 0.02, 0.1, wz + 0.02, xc, 0.15 + h, z, shade(col, 0.7));
  if (!near) return;
  const nr = Math.max(2, Math.floor(wz / 0.6));
  for (let i = 0; i < nr; i++) {
    const rz = z - wz / 2 + 0.13 + i * (wz / nr);
    bx(kit.solid, d + 0.05, h - 0.2, 0.05, xc, 0.25, rz, shade(col, 0.88));
  }
  void side;
}

export const SHOP_BAY = SHOP_TILE_W;

/** dark base band for tall buildings (stone / tile plinth, both LODs) */
export function stoneBase(kit: Kit, side: 1 | -1, face: number, zc: number, w: number, h: number, color: string): void {
  bx(kit.solid, 0.16, h, w + 0.1, side * (face - 0.07), 0, zc, color);
  if (kit.near) bx(kit.solid, 0.22, 0.08, w + 0.14, side * (face - 0.1), h, zc, shade(color, 1.2));
}
