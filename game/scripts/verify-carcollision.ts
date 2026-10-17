/** Headless checks for the car footprint collision (src/vehicles/CarCollision.ts).   npx tsx scripts/verify-carcollision.ts */
import { pushCarOutOfBoxes } from '../src/vehicles/CarCollision';

declare const process: { exit(code: number): never };
let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const wall = { minX: 10, maxX: 20, minZ: -50, maxZ: 50 }; // a wall whose face is x = 10
const HW = 1.04;
const HL = 2.34;

// free car: nothing happens
check(pushCarOutOfBoxes(0, 0, 0, HW, HL, [wall]) === null, 'a car away from the wall is not touched');

// driving into the wall sideways (heading +x): the nose may only reach the face, not go in
{
  const yaw = Math.PI / 2; // nose along +x
  const p = pushCarOutOfBoxes(8.5, 0, yaw, HW, HL, [wall])!; // nose at 10.84 = 0.84 inside
  check(p !== null && Math.abs(p.x + HL - 10) < 0.03, 'nose against the wall stops at the face', `nose x = ${(p.x + HL).toFixed(3)}`);
}
// side of the car (heading +z) next to the wall: the side stops at the face
{
  const p = pushCarOutOfBoxes(9.4, 0, 0, HW, HL, [wall])!; // right-hand side at 9.4 + 1.04 = 10.44
  check(p !== null && Math.abs(p.x + HW - 10) < 0.03, 'side against the wall stops at the face', `side x = ${(p.x + HW).toFixed(3)}`);
}
// a diagonal car: the FRONT CORNER (which the old three circles missed) must not sink in
{
  const yaw = Math.PI / 4;
  let maxIn = 0;
  for (let cx = 4; cx < 12; cx += 0.05) {
    const p = pushCarOutOfBoxes(cx, 0, yaw, HW, HL, [wall]);
    const x = p ? p.x : cx;
    // the furthest point of the body towards +x
    const reach = x + HL * Math.abs(Math.sin(yaw)) + HW * Math.abs(Math.cos(yaw));
    maxIn = Math.max(maxIn, reach - 10);
  }
  check(maxIn < 0.03, 'a diagonal car never gets more than 3 cm into the wall', `deepest ${(maxIn * 100).toFixed(1)} cm`);
}
// in a corner between two walls it ends up outside both
{
  const a = { minX: 10, maxX: 20, minZ: -50, maxZ: 50 };
  const b = { minX: -50, maxX: 50, minZ: 10, maxZ: 20 };
  const p = pushCarOutOfBoxes(8, 8, Math.PI / 4, HW, HL, [a, b])!;
  const reachX = p.x + HL * Math.abs(Math.sin(Math.PI / 4)) + HW * Math.abs(Math.cos(Math.PI / 4));
  const reachZ = p.z + HL * Math.abs(Math.cos(Math.PI / 4)) + HW * Math.abs(Math.sin(Math.PI / 4));
  check(reachX < 10.05 && reachZ < 10.05, 'in a corner the car is outside both walls', `${reachX.toFixed(2)} / ${reachZ.toFixed(2)}`);
}
// speed: one big step into a thin fence must not pass through it
{
  const fence = { minX: 10, maxX: 10.3, minZ: -50, maxZ: 50 };
  const p = pushCarOutOfBoxes(8.7, 0, Math.PI / 2, HW, HL, [fence])!; // nose 0.74 past the fence's front face
  check(p !== null && p.x < 10, 'a thin fence pushes the car back, not through', `x = ${p.x.toFixed(2)}`);
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
if (failed) process.exit(1);
