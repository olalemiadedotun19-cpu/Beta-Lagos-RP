/**
 * Headless checks for the arcade car physics (src/vehicles/CarDriving.ts).   npx tsx scripts/verify-driving.ts
 */
import { DRIVE, newDriveState, stepDrive, forwardSpeed, slipSpeed, groundSpeed, type DriveInput, type DriveWorld } from '../src/vehicles/CarDriving';

declare const process: { exit(code: number): never };
let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const idle: DriveInput = { throttle: 0, brake: 0, steer: 0, drift: false };
const run = (s: ReturnType<typeof newDriveState>, inp: DriveInput | ((t: number) => DriveInput), seconds: number, world: DriveWorld = {}, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) stepDrive(s, typeof inp === 'function' ? inp(t) : inp, dt, world);
};

// standing still stays still
{
  const s = newDriveState(5, 5, 1);
  run(s, idle, 3);
  check(groundSpeed(s) === 0 && s.x === 5 && s.z === 5, 'parked car does not creep');
}
// gas: accelerates along the heading, saturates below top speed
{
  const s = newDriveState(0, 0, 0);
  run(s, { ...idle, throttle: 1 }, 5);
  check(forwardSpeed(s) > 22 && forwardSpeed(s) < DRIVE.maxSpeed, '5 s of gas gets to a good speed', `${forwardSpeed(s).toFixed(1)} m/s = ${(forwardSpeed(s) * 3.6).toFixed(0)} km/h`);
  check(s.z > 60 && Math.abs(s.x) < 1e-6, 'and goes straight ahead along +z', `z=${s.z.toFixed(1)}`);
  run(s, { ...idle, throttle: 1 }, 30);
  check(forwardSpeed(s) <= DRIVE.maxSpeed && forwardSpeed(s) > 27, 'top speed is capped (about 110 km/h)', `${forwardSpeed(s).toFixed(1)} m/s`);
  const v = forwardSpeed(s);
  run(s, idle, 4);
  check(forwardSpeed(s) < v && forwardSpeed(s) > 0, 'lifting off slows it only gently');
  run(s, { ...idle, brake: 1 }, 4);
  check(Math.abs(forwardSpeed(s)) < 0.5 || forwardSpeed(s) < 0, 'brake stops it');
}
// braking distance from 100 km/h
{
  const s = newDriveState(0, 0, 0);
  s.vz = 27.8;
  const z0 = s.z;
  let t = 0;
  while (forwardSpeed(s) > 0.3 && t < 10) {
    stepDrive(s, { ...idle, brake: 1 }, 1 / 60);
    t += 1 / 60;
  }
  check(s.z - z0 > 20 && s.z - z0 < 45 && t < 2.5, 'full brake from 100 km/h stops in a believable distance', `${(s.z - z0).toFixed(0)} m in ${t.toFixed(1)} s`);
}
// reverse from standstill, limited
{
  const s = newDriveState(0, 0, 0);
  run(s, { ...idle, brake: 1 }, 6);
  check(forwardSpeed(s) < -4 && forwardSpeed(s) >= -DRIVE.maxReverse, 'holding brake from a standstill reverses', `${forwardSpeed(s).toFixed(1)} m/s`);
}
// steering: + = left = the heading increases; no turning on the spot; radius is sane
{
  const s = newDriveState(0, 0, 0);
  run(s, { ...idle, steer: 1 }, 2);
  check(s.yaw === 0, 'steering while parked does not turn the car');
  const l = newDriveState(0, 0, 0);
  l.vz = 10;
  run(l, { ...idle, throttle: 0.25, steer: 1 }, 3);
  check(l.yaw > 0.8, 'steer left turns the heading anticlockwise (x goes positive: the car\'s left)', `yaw ${l.yaw.toFixed(2)}, x ${l.x.toFixed(1)}`);
  const r = newDriveState(0, 0, 0);
  r.vz = 10;
  run(r, { ...idle, throttle: 0.25, steer: -1 }, 3);
  check(r.yaw < -0.8 && r.x < 0, 'steer right turns it clockwise', `yaw ${r.yaw.toFixed(2)}`);
  const v = newDriveState(0, 0, 0);
  v.vz = 10;
  run(v, { ...idle, throttle: 0.3, steer: 1 }, 6);
  const radius = groundSpeed(v) / Math.abs(v.yawRate);
  check(radius > 4 && radius < 16, 'turning circle at ~10 m/s is a normal car\'s', `${radius.toFixed(1)} m`);
  const fast = newDriveState(0, 0, 0);
  fast.vz = 30;
  run(fast, { ...idle, throttle: 0.6, steer: 1 }, 2);
  check(Math.abs(fast.yawRate) < 0.9 * 0.8 + 0.3, 'at 108 km/h the same steering turns much less (no flipping the car)', `${fast.yawRate.toFixed(2)} rad/s`);
}
// grip vs drift: the handbrake makes the car slide
{
  const maneuver = (drift: boolean) => {
    const s = newDriveState(0, 0, 0);
    s.vz = 22;
    let maxSlip = 0;
    const dt = 1 / 60;
    for (let t = 0; t < 1.6; t += dt) {
      stepDrive(s, { throttle: 0.5, brake: 0, steer: t < 0.2 ? 0 : 0.8, drift: drift && t > 0.4 }, dt);
      maxSlip = Math.max(maxSlip, Math.abs(slipSpeed(s)));
    }
    return { s, maxSlip };
  };
  const g = maneuver(false);
  const d = maneuver(true);
  check(d.maxSlip > 5 && d.maxSlip > g.maxSlip * 2, 'handbrake in a turn makes the car slide sideways', `peak slip ${d.maxSlip.toFixed(1)} m/s vs ${g.maxSlip.toFixed(1)} m/s with grip`);
  run(d.s, { ...idle, throttle: 0.5 }, 4);
  check(Math.abs(slipSpeed(d.s)) < 1.5, 'and it grips up again once the handbrake is released', `${Math.abs(slipSpeed(d.s)).toFixed(2)} m/s`);
}
// numerical stability at slow and fast frame rates
{
  for (const dt of [1 / 144, 1 / 60, 1 / 30, 1 / 15]) {
    const s = newDriveState(0, 0, 0);
    run(s, (t) => ({ throttle: 1, brake: 0, steer: Math.sin(t * 2), drift: t > 3 && t < 5 }), 12, {}, dt);
    check(Number.isFinite(s.x + s.z + s.yaw) && groundSpeed(s) < DRIVE.maxSpeed * 1.2, `stable at ${(1 / dt).toFixed(0)} fps`, `speed ${groundSpeed(s).toFixed(1)}`);
  }
}
// collisions: a wall at z = 50 (the car is pushed back out of it and loses speed); water blocks and bounces
{
  const wall: DriveWorld = { collide: (x, z) => (z > 50 ? { x, z: 50 } : null) };
  const s = newDriveState(0, 0, 0);
  s.vz = 30;
  let hit = 0;
  for (let i = 0; i < 300; i++) hit = Math.max(hit, stepDrive(s, { ...idle, throttle: 1 }, 1 / 60, wall).impact);
  check(s.z <= 50.0001 && hit > 20, 'a wall stops the car and reports the impact', `z=${s.z.toFixed(2)} impact ${hit.toFixed(0)} m/s`);
  check(forwardSpeed(s) < 6, 'and kills its speed (it does not keep pushing into it)', `${forwardSpeed(s).toFixed(1)} m/s`);
  const lake: DriveWorld = { blocked: (_x, z) => z > 80 };
  const b = newDriveState(0, 0, 0);
  b.vz = 30;
  run(b, { ...idle, throttle: 1 }, 6, lake);
  check(b.z <= 80, 'water is never entered', `z=${b.z.toFixed(1)}`);
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
if (failed) process.exit(1);
