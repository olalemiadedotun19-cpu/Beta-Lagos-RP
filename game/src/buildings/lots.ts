/**
 * lots.ts - where the hand-modelled buildings stand in the big map (pure data + math, no three.js import,
 * so CellBuilder can use it cheaply).
 *
 * To add a building: 1) port it to src/buildings/<name>.ts (local frame: origin = centre, +z = front, metres)
 *                    2) add a LotDef below  3) register its builder in CustomBuildings.ts.
 * Procedural frontage buildings and yard houses automatically keep out of every lot (see isReserved).
 *
 * Placement rules used: the lot must sit fully inside a block (road edge + 2.4 m pavement) and its front
 * faces the nearest street. rotY is a multiple of PI/2 so colliders stay axis-aligned.
 */

export interface LotDef {
  id: string;
  name: string;
  /** world position the pivot is pinned to */
  x: number;
  z: number;
  /** local point (before scale) that sits on (x, z) */
  pivot: [number, number];
  rotY: number;
  scale: number;
  /** local rectangle kept clear of procedural buildings: minX, maxX, minZ, maxZ (before scale) */
  reserve: [number, number, number, number];
  /** local collision boxes: centreX, centreZ, width, depth (before scale) */
  colliders: [number, number, number, number][];
  /** build when the player is within this distance, hide beyond it + 40 m */
  showRadius: number;
  castShadow: boolean;
}

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const LOTS: LotDef[] = [
  {
    // Residential block i6/j10 (GRA-style), front faces Allen-side street z = 150 (world -z)
    id: 'lot_french_manor',
    name: 'French Country Manor',
    x: -198, z: 180, pivot: [0, -1.5], rotY: Math.PI, scale: 1,
    reserve: [-20, 20, -20, 17],
    colliders: [[0, 0, 13.4, 9.8]],
    showRadius: 260, castShadow: true,
  },
  {
    // East of the core, block i10/j9, front faces East Link Road x = 50 (world -x)
    id: 'lot_historic_hotel',
    name: 'Historic Hotel',
    x: 74, z: 100, pivot: [0, 0], rotY: -Math.PI / 2, scale: 1,
    reserve: [-16.5, 16.5, -12.5, 13],
    colliders: [[0, 0, 22, 16]],
    showRadius: 330, castShadow: true,
  },
  {
    // Commercial block i11/j6 (96 x 88 m). Original complex is ~205 m long, no block is that wide,
    // so it is scaled to fit. Front faces Commercial Avenue z = -50.
    id: 'lot_tower_complex',
    name: 'Mixed-use Tower Complex',
    x: 209, z: -90, pivot: [18.75, 4.5], rotY: 0, scale: 0.44,
    reserve: [-86, 122, -39, 48],
    colliders: [
      [4, 25, 176, 38],      // retail podium
      [-60, -10, 29, 39],    // tall tower + plinth
      [-4, -12, 33, 29],     // A
      [24, -24, 27, 27],     // B
      [42, -6, 21, 25],      // C
      [64, 0, 25, 27],       // D
      [88, -4, 27, 29],      // E
      [110, 8, 23, 23],      // F
    ],
    showRadius: 1200, castShadow: false,
  },
];

export function localToWorld(l: LotDef, lx: number, lz: number): [number, number] {
  const c = Math.cos(l.rotY);
  const s = Math.sin(l.rotY);
  const dx = (lx - l.pivot[0]) * l.scale;
  const dz = (lz - l.pivot[1]) * l.scale;
  return [l.x + dx * c + dz * s, l.z - dx * s + dz * c];
}

export function localRectToWorld(l: LotDef, minX: number, maxX: number, minZ: number, maxZ: number): Rect {
  const pts = [localToWorld(l, minX, minZ), localToWorld(l, maxX, minZ), localToWorld(l, minX, maxZ), localToWorld(l, maxX, maxZ)];
  return {
    minX: Math.min(...pts.map((p) => p[0])),
    maxX: Math.max(...pts.map((p) => p[0])),
    minZ: Math.min(...pts.map((p) => p[1])),
    maxZ: Math.max(...pts.map((p) => p[1])),
  };
}

const RESERVED: Rect[] = LOTS.map((l) => localRectToWorld(l, ...l.reserve));

/** is the point inside any lot (grown by margin)? Used by CellBuilder to skip procedural buildings. */
export function isReserved(x: number, z: number, margin = 0): boolean {
  for (const r of RESERVED) {
    if (x > r.minX - margin && x < r.maxX + margin && z > r.minZ - margin && z < r.maxZ + margin) return true;
  }
  return false;
}

export function getLotColliders(l: LotDef): { id: string; rect: Rect }[] {
  return l.colliders.map((c, i) => ({
    id: `custom_${l.id}_${i}`,
    rect: localRectToWorld(l, c[0] - c[2] / 2, c[0] + c[2] / 2, c[1] - c[3] / 2, c[1] + c[3] / 2),
  }));
}

/** does any lot's reserved land touch this rectangle (grown by margin)? Used by CityDistricts to leave landmark blocks alone. */
export function reservedOverlaps(minX: number, maxX: number, minZ: number, maxZ: number, margin = 0): boolean {
  for (const r of RESERVED) {
    if (maxX > r.minX - margin && minX < r.maxX + margin && maxZ > r.minZ - margin && minZ < r.maxZ + margin) return true;
  }
  return false;
}
