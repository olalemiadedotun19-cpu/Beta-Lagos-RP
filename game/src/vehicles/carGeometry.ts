/**
 * Car geometry shared by the BMW model, the cabin, the door logic and the enter / exit sequence. No three.js in here, so it can be
 * tested from node (scripts/verify-car.ts).
 *
 * CAR FRAME (metres): origin on the ground under the middle of the wheelbase, +z towards the nose, +x towards the car's left (the
 * driver's side), +y up. The player's character is placed in this frame through the SEAT FRAME the car clips were baked in
 * (scripts/locomotion/bake_car_clips.py): origin on the pelvis of the seated driver, +z the way the car faces, +x towards the door,
 * heading 0 = facing the nose. The passenger seat is the same thing mirrored in x.
 */

/** the raw model is 5.001 units long, the real i8 is 4.689 m */
export const MODEL_SCALE = 4.689 / 5.001;
/** lowest point of the tyres and the middle of the axles, in raw model units */
export const TIRE_BOTTOM_Y = -0.7312;
export const AXLE_MID_Z = (1.5765 + -1.4908) / 2;

/** metres between the front and rear axle, and between the left and right wheel centres */
export const BMW_WHEELBASE = (1.5765 + 1.4908) * MODEL_SCALE;
export const BMW_TRACK = 1.72 * MODEL_SCALE;
/** half the width of the car over its mirrors, in metres */
export const BMW_HALF_WIDTH = 1.15 * MODEL_SCALE;
export const BMW_HALF_LENGTH = 4.689 / 2;

/** car frame metres -> raw model units (the cabin is built in raw units inside the scaled model group) */
export const rawX = (m: number): number => m / MODEL_SCALE;
export const rawY = (metresAboveGround: number): number => metresAboveGround / MODEL_SCALE + TIRE_BOTTOM_Y;
export const rawZ = (m: number): number => m / MODEL_SCALE + AXLE_MID_Z;

// ---- seats ---------------------------------------------------------------------------------------------------------------------
/** pelvis of the seated character, in the car frame. The Mixamo seat is a truck seat: the cabin is built around these numbers. */
export const SEAT_X = 0.34;
/** forward enough that the leaned-back driver's hands meet the wheel just behind the dashboard, and the head sits under the high part of the roof */
export const SEAT_Z = 0.43;
/** pelvis height above the ground when seated (must equal meta.car.hipsSeat baked into clips.json) */
export const SEAT_HIPS_Y = 0.47;
/** how far the seated driver leans back (rad): baked into the clips (meta.car.reclineDeg), the seat back follows it */
export const SEAT_RECLINE = (30 * Math.PI) / 180;
/** top of the floor the feet rest on (the clips' feet end ~0.05 m above it) */
export const CABIN_FLOOR_Y = 0.02;
/** steering wheel centre = between the seated hands of the Driving clip (meta.car.wheel in clips.json, checked by verify-car) */
export const WHEEL_POS = { x: SEAT_X - 0.005, y: 0.758, z: SEAT_Z + 0.092 };

export type Side = 'L' | 'R';
/** the door the character uses = the seat the character takes: left = driver, right = passenger */
export const sideSign = (side: Side): number => (side === 'L' ? 1 : -1);

/** seat frame -> car frame */
export function seatToCar(side: Side, sx: number, sz: number): { x: number; z: number } {
  return { x: sideSign(side) * (SEAT_X + sx), z: SEAT_Z + sz };
}
/** heading in the seat frame -> heading in the car frame (mirrored on the right-hand side) */
export const seatHeadingToCar = (side: Side, yaw: number): number => sideSign(side) * yaw;

// ---- placing the car in the world ----------------------------------------------------------------------------------------------
export interface CarPose {
  x: number;
  z: number;
  /** heading: the car's nose points along (sin yaw, cos yaw) */
  yaw: number;
}

export function carToWorld(car: CarPose, lx: number, lz: number): { x: number; z: number } {
  const s = Math.sin(car.yaw);
  const c = Math.cos(car.yaw);
  return { x: car.x + lx * c + lz * s, z: car.z - lx * s + lz * c };
}

export function worldToCar(car: CarPose, wx: number, wz: number): { x: number; z: number } {
  const s = Math.sin(car.yaw);
  const c = Math.cos(car.yaw);
  const dx = wx - car.x;
  const dz = wz - car.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

/** a seat-frame root (position + heading) of a car clip -> world position and heading, for the given door side and car */
export function rootToWorld(car: CarPose, side: Side, r: { x: number; z: number; yaw: number }): { x: number; z: number; yaw: number } {
  const c = seatToCar(side, r.x, r.z);
  const w = carToWorld(car, c.x, c.z);
  return { x: w.x, z: w.z, yaw: car.yaw + seatHeadingToCar(side, r.yaw) };
}

export const wrapPi = (a: number): number => {
  const t = (a + Math.PI) % (Math.PI * 2);
  return (t < 0 ? t + Math.PI * 2 : t) - Math.PI;
};

/** distance from a world point to the car's footprint (0 when under it) */
export function distanceToCar(car: CarPose, wx: number, wz: number): number {
  const p = worldToCar(car, wx, wz);
  const dx = Math.max(Math.abs(p.x) - BMW_HALF_WIDTH, 0);
  const dz = Math.max(Math.abs(p.z) - BMW_HALF_LENGTH, 0);
  return Math.hypot(dx, dz);
}

/** The door the character is nearest to: compares the character's distance to the standing spot at each door. */
export function nearestDoor(car: CarPose, wx: number, wz: number, spotX: number, spotZ: number): Side {
  const p = worldToCar(car, wx, wz);
  const dl = Math.hypot(p.x - spotX, p.z - spotZ);
  const dr = Math.hypot(p.x + spotX, p.z - spotZ);
  return dl <= dr ? 'L' : 'R';
}

// ---- walking round the car to the door -----------------------------------------------------------------------------------------
/** go round the car at this distance (m) from the body; a straight leg that gets within EDGE of the body counts as "through the car" */
const ROUTE_MARGIN = 0.75;
const EDGE_MARGIN = 0.15;

/** does the segment a-b cross the inside of the box |x| < hx, |z| < hz (car frame)? Liang-Barsky. */
function segmentHitsBox(ax: number, az: number, bx: number, bz: number, hx: number, hz: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q > 0; // parallel: inside the slab only if q > 0
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, ax + hx) && clip(dx, hx - ax) && clip(-dz, az + hz) && clip(dz, hz - az) && t1 - t0 > 1e-6;
}

/**
 * Waypoints (world xz, not including `from`, ending with `to`) for walking from `from` to `to` without cutting through the car:
 * the shortest path over a small visibility graph made of the two ends and the corners of the car's footprint plus a margin.
 */
export function planApproach(
  car: CarPose,
  from: { x: number; z: number },
  to: { x: number; z: number }
): { x: number; z: number }[] {
  const a = worldToCar(car, from.x, from.z);
  const b = worldToCar(car, to.x, to.z);
  const hx = BMW_HALF_WIDTH + EDGE_MARGIN;
  const hz = BMW_HALF_LENGTH + EDGE_MARGIN;
  const cx = BMW_HALF_WIDTH + ROUTE_MARGIN;
  const cz = BMW_HALF_LENGTH + ROUTE_MARGIN;
  const nodes = [a, { x: cx, z: cz }, { x: cx, z: -cz }, { x: -cx, z: -cz }, { x: -cx, z: cz }, b];
  const blocked = (i: number, j: number) => segmentHitsBox(nodes[i].x, nodes[i].z, nodes[j].x, nodes[j].z, hx, hz);
  const n = nodes.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (done[v] || v === u || blocked(u, v)) continue;
      const d = dist[u] + Math.hypot(nodes[u].x - nodes[v].x, nodes[u].z - nodes[v].z);
      if (d < dist[v]) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  const path: number[] = [];
  if (prev[n - 1] < 0) path.push(n - 1); // no way found (should not happen): walk straight
  else for (let i = n - 1; i > 0; i = prev[i]) path.unshift(i);
  return path.map((i) => carToWorld(car, nodes[i].x, nodes[i].z));
}
