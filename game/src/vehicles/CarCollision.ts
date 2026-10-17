/**
 * Collision of the car's real footprint (an oriented rectangle, the way the body is shaped) against the world's axis-aligned boxes
 * (buildings, walls, obstacles). Pure maths, no three.js: tested from node (scripts/verify-carcollision.ts).
 *
 * The old collision was three circles along the car. A circle row leaves the corners and the stretches between the circles outside the
 * collision, so the body visibly sank 20-30 cm into walls there. This uses the rectangle itself (separating axis test), so what you see
 * is what hits.
 */

export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Pushes the car rectangle (centre x, z; heading yaw: the nose points along (sin yaw, cos yaw); half width, half length) out of every
 * box it overlaps, along the way out that needs the least movement. Returns the new centre, or null when nothing was touching.
 */
export function pushCarOutOfBoxes(
  x: number,
  z: number,
  yaw: number,
  halfWidth: number,
  halfLength: number,
  boxes: readonly AABB[]
): { x: number; z: number } | null {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // right-hand axis of the car
  const rx = fz;
  const rz = -fx;
  let cx = x;
  let cz = z;
  let hit = false;

  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const b of boxes) {
      const bx = (b.minX + b.maxX) / 2;
      const bz = (b.minZ + b.maxZ) / 2;
      const ex = (b.maxX - b.minX) / 2;
      const ez = (b.maxZ - b.minZ) / 2;
      const dx = cx - bx;
      const dz = cz - bz;

      // the four axes that matter for a rectangle against an axis-aligned box: world x, world z, the car's nose, the car's right side
      let best = Infinity;
      let bestAx = 0;
      let bestAz = 0;
      let separated = false;
      for (let k = 0; k < 4; k++) {
        const ax = k === 0 ? 1 : k === 1 ? 0 : k === 2 ? fx : rx;
        const az = k === 0 ? 0 : k === 1 ? 1 : k === 2 ? fz : rz;
        const carR = halfLength * Math.abs(fx * ax + fz * az) + halfWidth * Math.abs(rx * ax + rz * az);
        const boxR = ex * Math.abs(ax) + ez * Math.abs(az);
        const d = dx * ax + dz * az;
        const overlap = carR + boxR - Math.abs(d);
        if (overlap <= 0) {
          separated = true;
          break;
        }
        if (overlap < best) {
          best = overlap;
          const s = d < 0 ? -1 : 1;
          bestAx = ax * s;
          bestAz = az * s;
        }
      }
      if (separated) continue;
      // out along the cheapest axis, plus a 1 cm skin so the next test starts clear of the wall
      cx += bestAx * (best + 0.01);
      cz += bestAz * (best + 0.01);
      moved = true;
      hit = true;
    }
    if (!moved) break;
  }
  return hit ? { x: cx, z: cz } : null;
}
