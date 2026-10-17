import { BMW_WHEELBASE, wrapPi } from './carGeometry';

/**
 * Arcade driving for the player's car. Pure maths (no three.js), so it is tested from node (scripts/verify-car.ts).
 *
 * The car keeps a WORLD velocity and a heading. Each step the velocity is split along the heading into forward speed and sideways
 * slip; the slip is bled off by tyre grip. Turning the heading while the velocity carries on is what makes the car slide, and the
 * handbrake ("drift") drops the grip so it slides a lot: turn in, hold drift, steer into the slide, let go to grip up again.
 */

export interface DriveInput {
  /** 0..1 gas */
  throttle: number;
  /** 0..1 brake; from a standstill (or when held) it reverses */
  brake: number;
  /** -1 (right) .. +1 (left): the same way the heading turns, + = anticlockwise from above */
  steer: number;
  /** handbrake: the rear lets go, the car slides */
  drift: boolean;
}

export interface DriveState {
  x: number;
  z: number;
  /** heading: the nose points along (sin yaw, cos yaw) */
  yaw: number;
  /** world velocity (m/s) */
  vx: number;
  vz: number;
  /** front wheel angle (rad, + = left) */
  steerAngle: number;
  /** yaw rate (rad/s) */
  yawRate: number;
}

export const DRIVE = {
  /** top speed forward / in reverse (m/s) */
  maxSpeed: 40,
  maxReverse: 9,
  /** m/s^2 at a standstill, tapering to 0 at top speed */
  accel: 12,
  brake: 16,
  reverseAccel: 6,
  /** coasting: constant rolling resistance + air drag */
  rolling: 1.2,
  airDrag: 0.0015,
  /** how fast sideways slip is killed (1/s): normal tyres / handbrake sliding */
  grip: 11,
  gripDrift: 1.35,
  /** front wheel angle limit (rad) at a crawl and the speed at which it has halved */
  maxSteer: 0.62,
  steerHalfSpeed: 9,
  steerRate: 7,
  steerReturn: 9,
  maxYawRate: 2.2,
  wheelbase: BMW_WHEELBASE,
} as const;

export function newDriveState(x: number, z: number, yaw: number): DriveState {
  return { x, z, yaw, vx: 0, vz: 0, steerAngle: 0, yawRate: 0 };
}

/** speed along the nose (negative = reversing) */
export const forwardSpeed = (s: DriveState): number => s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw);
/** speed sideways (+ = towards the car's left) */
export const slipSpeed = (s: DriveState): number => s.vx * Math.cos(s.yaw) - s.vz * Math.sin(s.yaw);
export const groundSpeed = (s: DriveState): number => Math.hypot(s.vx, s.vz);

export interface DriveWorld {
  /**
   * Called with the car's next position and heading. Return the position pushed out of whatever it hit, or null if it is free to be there.
   * `blocked` positions (water, the edge of the map) make the car stop and bounce back instead.
   */
  collide?(x: number, z: number, yaw: number): { x: number; z: number } | null;
  blocked?(x: number, z: number, yaw: number): boolean;
}

export interface DriveStepResult {
  /** hit something this step: how hard (m/s of speed lost into the obstacle) */
  impact: number;
}

/** Advances the car by dt seconds (call with small steps: the game's frame time, capped). */
export function stepDrive(s: DriveState, input: DriveInput, dt: number, world: DriveWorld = {}): DriveStepResult {
  const sinY = Math.sin(s.yaw);
  const cosY = Math.cos(s.yaw);
  let vf = s.vx * sinY + s.vz * cosY;
  let vl = s.vx * cosY - s.vz * sinY;

  // ---- along the nose
  const throttle = clamp01(input.throttle);
  const brake = clamp01(input.brake);
  let a = 0;
  if (throttle > 0) a += DRIVE.accel * throttle * Math.max(0, 1 - Math.max(vf, 0) / DRIVE.maxSpeed);
  if (brake > 0) {
    if (vf > 0.6) a -= DRIVE.brake * brake;
    else if (throttle === 0) a -= DRIVE.reverseAccel * brake * Math.max(0, 1 - Math.max(-vf, 0) / DRIVE.maxReverse);
  }
  if (throttle > 0 && vf < -0.3) a += DRIVE.brake * throttle * 0.8; // gas while rolling backwards brakes first
  const resist = DRIVE.rolling + DRIVE.airDrag * vf * vf;
  if (Math.abs(vf) > 0.05) a -= Math.sign(vf) * Math.min(resist, Math.abs(vf) / dt); // never overshoots to the other side
  if (input.drift && Math.abs(vf) > 0.05) a -= Math.sign(vf) * 3.2; // the handbrake scrubs a little speed
  vf += a * dt;
  if (throttle === 0 && brake === 0 && Math.abs(vf) < 0.12) vf = 0;

  // ---- sideways slip: tyre grip
  vl *= Math.exp(-(input.drift ? DRIVE.gripDrift : DRIVE.grip) * dt);

  // ---- steering: the wheel angle follows the input, and has less lock the faster the car goes (more in a drift: counter-steering)
  const lockSpeed = input.drift ? DRIVE.steerHalfSpeed * 2.2 : DRIVE.steerHalfSpeed;
  const lock = DRIVE.maxSteer / (1 + Math.pow(Math.abs(vf) / lockSpeed, 2));
  const want = clamp(input.steer, -1, 1) * lock;
  const rate = Math.abs(want) < Math.abs(s.steerAngle) || want * s.steerAngle < 0 ? DRIVE.steerReturn : DRIVE.steerRate;
  s.steerAngle += clamp(want - s.steerAngle, -rate * dt, rate * dt);
  if (Math.abs(vf) < 0.4 && Math.abs(vl) < 0.4) {
    s.yawRate = 0; // no turning on the spot
  } else {
    let yr = (vf / DRIVE.wheelbase) * Math.tan(s.steerAngle);
    if (input.drift) yr *= 1.3; // the tail swings out
    s.yawRate += (clamp(yr, -DRIVE.maxYawRate, DRIVE.maxYawRate) - s.yawRate) * Math.min(1, 14 * dt);
  }
  s.yaw = wrapPi(s.yaw + s.yawRate * dt);

  // ---- back to a world velocity along the new heading, then move
  // the velocity stays put in the world while the heading turns (that is the slip); only what we changed above is rebuilt
  s.vx = vf * sinY + vl * cosY;
  s.vz = vf * cosY - vl * sinY;

  let nx = s.x + s.vx * dt;
  let nz = s.z + s.vz * dt;
  let impact = 0;
  if (world.blocked?.(nx, nz, s.yaw)) {
    impact = Math.hypot(s.vx, s.vz);
    s.vx *= -0.25;
    s.vz *= -0.25;
    s.yawRate = 0;
    return { impact };
  }
  const pushed = world.collide?.(nx, nz, s.yaw);
  if (pushed) {
    const px = pushed.x - nx;
    const pz = pushed.z - nz;
    const pl = Math.hypot(px, pz);
    if (pl > 1e-6) {
      // kill the part of the velocity that drives into the obstacle, keep a little bounce, and slide along it
      const ux = px / pl;
      const uz = pz / pl;
      const into = s.vx * ux + s.vz * uz;
      if (into < 0) {
        impact = -into;
        s.vx -= (1.25 * into) * ux;
        s.vz -= (1.25 * into) * uz;
        s.yawRate *= 0.6;
      }
    }
    nx = pushed.x;
    nz = pushed.z;
  }
  s.x = nx;
  s.z = nz;
  return { impact };
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
