/**
 * Where the Independence Barracks stands: on its own reclaimed island out in the sea south of the map, joined to the end of
 * Allen Avenue South by a long causeway bridge. Pure data + height maths (no three.js) so CurvedRoads can use it for walking.
 *
 * The barracks' local frame is rotated by PI about Y: local +z (its main gate / approach road) faces north, toward the city.
 *   world x = BX - localX      world z = BZ - localZ
 */
export const BX = 31.5; // Allen Avenue South runs out here (x of its dead end)
export const PLAT_Y = 2.4; // island + deck height above the map's ground level (the sea is at -1.15)

// bridge (the deck runs along z at x = BX)
export const BR_Z0 = 852; // just past Allen Avenue South's turning circle
export const BR_RAMP = 70; // the deck climbs from ground level to PLAT_Y over this length
export const BR_HW = 6; // half width of the deck (parapets stand on the edge)

// island: the barracks local rectangle x -215..215, z -250..170 (compound fence is x +-175, z -210..140)
export const BZ = 1670; // world z of the barracks origin
export const ISL_HX = 215;
export const ISL_Z0 = BZ - 170; // north edge (the bridge lands here)
export const ISL_Z1 = BZ + 250; // south edge
export const BR_Z1 = ISL_Z0;

/** the walkers may go this far south (invisible wall) */
export const BARRACKS_MAX_Z = ISL_Z1 + 40;

export function deckHeightAt(z: number): number {
  if (z >= BR_Z0 + BR_RAMP) return PLAT_Y;
  if (z <= BR_Z0) return 0;
  const t = (z - BR_Z0) / BR_RAMP;
  return PLAT_Y * t * t * (3 - 2 * t);
}

/** ground the walker stands on over the island / bridge, or null when the point is not on them (refY: only counts when up on the deck) */
export function farGroundAt(x: number, z: number, refY: number): number | null {
  if (z < BR_Z0 - 1) return null;
  if (Math.abs(x - BX) <= ISL_HX && z >= ISL_Z0 && z <= ISL_Z1) return PLAT_Y;
  if (Math.abs(x - BX) <= BR_HW && z >= BR_Z0 && z < BR_Z1) {
    const h = deckHeightAt(z);
    if (refY >= h - 1.2) return h + 0.01;
  }
  return null;
}

/**
 * Where the player starts: on the approach avenue just inside the main gate (local x 0, z 100), 34 m in, with the parade
 * ground and headquarters straight ahead (world +z).
 */
export const BARRACKS_SPAWN = { x: BX, y: PLAT_Y, z: BZ - 100 };
/** camera yaw that looks into the compound (the camera sits north of the player, over their shoulder) */
export const BARRACKS_SPAWN_YAW = Math.PI;
/** every new / loaded game starts at the barracks. Set to false to resume at the saved position again. */
export const ALWAYS_SPAWN_AT_BARRACKS = true;
