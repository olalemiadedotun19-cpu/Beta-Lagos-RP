/**
 * Walkable height of the city-grid sidewalks.
 *
 * RoadBuilder draws the pavements as raised slabs (SIDEWALK_HEIGHT above the asphalt) but the player's ground height
 * used to be 0 everywhere in the grid, so characters walked at street level INSIDE the slab (legs buried in it).
 * RoadBuilder.prepare() registers the exact same rectangles / rounded corners it builds the meshes from; groundHeightAt()
 * (CurvedRoads.ts) then asks sidewalkHeightAt() so the player steps up onto the pavement and back down at the kerb.
 *
 * No imports on purpose: both RoadBuilder and CurvedRoads depend on this file.
 */

const CELL = 24;

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
/** quarter disc centred on (px,pz) covering the quadrant that points to (-sx,-sz) */
interface Corner {
  px: number;
  pz: number;
  sx: number;
  sz: number;
  r: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

let height = 0;
const rects = new Map<number, Rect[]>();
const corners = new Map<number, Corner[]>();

const key = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);

function insert<T extends Rect>(map: Map<number, T[]>, item: T): void {
  const i0 = Math.floor(item.x0 / CELL);
  const i1 = Math.floor(item.x1 / CELL);
  const j0 = Math.floor(item.z0 / CELL);
  const j1 = Math.floor(item.z1 / CELL);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      const list = map.get(k);
      if (list) list.push(item);
      else map.set(k, [item]);
    }
  }
}

export function clearSidewalks(sidewalkHeight: number): void {
  height = sidewalkHeight;
  rects.clear();
  corners.clear();
}

export function addSidewalkRect(xa: number, za: number, xb: number, zb: number): void {
  insert(rects, { x0: Math.min(xa, xb), z0: Math.min(za, zb), x1: Math.max(xa, xb), z1: Math.max(za, zb) });
}

export function addSidewalkCorner(px: number, pz: number, sx: number, sz: number, r: number): void {
  insert(corners, {
    px,
    pz,
    sx,
    sz,
    r,
    x0: px - r,
    x1: px + r,
    z0: pz - r,
    z1: pz + r,
  });
}

/** top of the sidewalk at (x, z), or 0 when that point is not on a sidewalk */
export function sidewalkHeightAt(x: number, z: number): number {
  const k = key(Math.floor(x / CELL), Math.floor(z / CELL));
  const rs = rects.get(k);
  if (rs) {
    for (const r of rs) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return height;
  }
  const cs = corners.get(k);
  if (cs) {
    for (const c of cs) {
      const dx = x - c.px;
      const dz = z - c.pz;
      if (dx * -c.sx >= 0 && dz * -c.sz >= 0 && dx * dx + dz * dz <= c.r * c.r) return height;
    }
  }
  return 0;
}
