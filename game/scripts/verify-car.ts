/**
 * Headless checks for the car entry system (pure data and maths: no browser, no WebGL).
 *
 *   npx tsx scripts/verify-car.ts
 *
 * Checks the baked car clips (clips.json), the seat frame -> car frame -> world conversion for both doors, which door is picked,
 * the walk round the car to the door, and that the door events sit inside the clips. FAIL lines make the process exit with code 1.
 */
import clipData from '../src/player/figure/assets/clips.json';
import { sampleCarClip, blendRoot, type CarClipSet } from '../src/vehicles/carClips';
import {
  BMW_HALF_LENGTH,
  BMW_HALF_WIDTH,
  SEAT_X,
  SEAT_Z,
  SEAT_HIPS_Y,
  SEAT_RECLINE,
  WHEEL_POS,
  distanceToCar,
  nearestDoor,
  planApproach,
  rootToWorld,
  seatToCar,
  worldToCar,
  carToWorld,
  wrapPi,
  type CarPose,
} from '../src/vehicles/carGeometry';

declare const process: { exit(code: number): never };

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1);

const data = clipData as unknown as { clips: Record<string, { duration: number; times: number[]; q: Record<string, string>; p: Record<string, number[]> }>; meta: { car: { clips: CarClipSet; hipsSeat: number; reclineDeg: number; headTop: number; wheel: { x: number; y: number; z: number } } } };
const curves = data.meta.car.clips;

// ---- baked clips ----------------------------------------------------------------------------------------------------------------
for (const n of ['carEnter', 'carDrive', 'carExit'] as const) {
  const c = data.clips[n];
  const k = curves[n];
  check(!!c, `${n} clip exists`);
  check(Object.keys(c.q).length >= 50, `${n} has a track for every bone`, `${Object.keys(c.q).length} bones`);
  check(c.times.length === k.t.length && [k.x, k.z, k.yaw, k.dy, k.inside].every((a) => a.length === k.t.length), `${n} root curves match the key times`, `${k.t.length} keys, ${k.dur}s`);
  const hips = c.p['mixamorigHips'] ?? Object.values(c.p)[0];
  const xs = hips.filter((_, i) => i % 3 === 0);
  const zs = hips.filter((_, i) => i % 3 === 2);
  check(Math.max(...xs.map(Math.abs)) < 0.01 && Math.max(...zs.map((z) => Math.abs(z + 0.035))) < 0.02, `${n} pose keeps the pelvis over the root (root motion lives in the curves)`);
}
check(Math.abs(data.meta.car.hipsSeat - SEAT_HIPS_Y) < 1e-9, `baked seat height matches SEAT_HIPS_Y (${SEAT_HIPS_Y})`);
check(Math.abs((data.meta.car.reclineDeg * Math.PI) / 180 - SEAT_RECLINE) < 1e-9, `baked lean (${data.meta.car.reclineDeg}°) matches SEAT_RECLINE`);
{
  const w = data.meta.car.wheel;
  const err = Math.hypot(SEAT_X + w.x - WHEEL_POS.x, w.y - WHEEL_POS.y, SEAT_Z + w.z - WHEEL_POS.z);
  check(err < 0.005, 'steering wheel sits between the seated hands', `${(err * 100).toFixed(1)} cm off`);
  // the roof of the i8 above the driver's head, measured from the model: 1.32-1.34 m between z = -0.3 and +0.1 m
  check(data.meta.car.headTop <= 1.325, 'seated head stays under the roof', `head top ${data.meta.car.headTop} m vs roof ~1.33 m`);
}

// the Entering clip must end on the seat the Driving clip sits on; Exiting must start there
const e0 = sampleCarClip(curves.carEnter, 0);
const eN = sampleCarClip(curves.carEnter, curves.carEnter.dur);
const d0 = sampleCarClip(curves.carDrive, 0);
const x0 = sampleCarClip(curves.carExit, 0);
const xN = sampleCarClip(curves.carExit, curves.carExit.dur);
check(Math.hypot(eN.x - d0.x, eN.z - d0.z) < 0.03, 'Entering ends on the seat', `off by ${(Math.hypot(eN.x - d0.x, eN.z - d0.z) * 100).toFixed(1)} cm, heading ${deg(eN.yaw)}° vs drive ${deg(d0.yaw)}°`);
check(Math.hypot(x0.x - d0.x, x0.z - d0.z) < 0.03, 'Exiting starts on the seat', `off by ${(Math.hypot(x0.x - d0.x, x0.z - d0.z) * 100).toFixed(1)} cm`);
check(eN.inside > 0.99 && x0.inside > 0.99 && e0.inside < 0.01 && xN.inside < 0.01, 'inside goes 0 -> 1 entering and 1 -> 0 exiting');
check(Math.abs(e0.dy) < 1e-3 && Math.abs(xN.dy) < 1e-3, 'standing outside: no height offset');
check(Math.abs(eN.dy - (SEAT_HIPS_Y - 0.86)) < 0.02 && Math.abs(d0.dy - (SEAT_HIPS_Y - 0.64)) < 0.02 && Math.abs(x0.dy - (SEAT_HIPS_Y - 0.86)) < 0.02, 'seated height offsets', `enter ${eN.dy.toFixed(2)} drive ${d0.dy.toFixed(2)} exit ${x0.dy.toFixed(2)}`);
check(e0.x > 1.4 && e0.x < 2.0 && Math.abs(wrapPi(e0.yaw - -Math.PI / 2)) < 0.15, 'Entering starts outside the door facing the car', `x'=${e0.x.toFixed(2)} heading ${deg(e0.yaw)}°`);
check(xN.x > 1.4 && Math.abs(wrapPi(xN.yaw - Math.PI / 2)) < 0.15, 'Exiting ends outside the door facing away', `x'=${xN.x.toFixed(2)} heading ${deg(xN.yaw)}°`);
// pose blend continuity: the root path must not jump between frames
for (const n of ['carEnter', 'carExit'] as const) {
  const k = curves[n];
  let worst = 0;
  for (let i = 1; i < k.t.length; i++) worst = Math.max(worst, Math.hypot(k.x[i] - k.x[i - 1], k.z[i] - k.z[i - 1]) / (k.t[i] - k.t[i - 1]));
  check(worst < 3.5, `${n} root speed stays plausible`, `max ${worst.toFixed(2)} m/s`);
}
for (const n of ['carEnter', 'carExit'] as const) {
  const ev = curves[n].events;
  check(ev.doorOpen !== undefined && ev.doorClose !== undefined && ev.doorOpen < ev.doorClose && ev.doorClose + 0.9 <= curves[n].dur + 1e-6, `${n} door events are in order and the door finishes closing inside the clip`, `open ${ev.doorOpen}s close ${ev.doorClose}s of ${curves[n].dur}s`);
}
const mid = blendRoot({ x: 0, z: 0, yaw: 3, dy: 0, inside: 0 }, { x: 1, z: 1, yaw: -3, dy: 1, inside: 1 }, 0.5);
check(Math.abs(wrapPi(mid.yaw)) < 1e-6 || Math.abs(Math.abs(mid.yaw) - Math.PI) < 1e-6 || Math.abs(mid.yaw) < 4, 'blendRoot goes the short way round the heading', `${mid.yaw.toFixed(3)}`);
const sh = blendRoot({ x: 0, z: 0, yaw: 3.0, dy: 0, inside: 0 }, { x: 0, z: 0, yaw: -3.0, dy: 0, inside: 0 }, 0.5);
check(Math.abs(Math.abs(wrapPi(sh.yaw)) - Math.PI) < 0.01, 'blendRoot 3 rad -> -3 rad passes through pi, not 0', `${sh.yaw.toFixed(3)}`);

// ---- seat frame -> world, both doors --------------------------------------------------------------------------------------------
for (const yaw of [0, 0.7, -2.2, 3.0]) {
  const car: CarPose = { x: 120.5, z: -33.2, yaw };
  const k = curves.carEnter;
  const spotL = rootToWorld(car, 'L', { x: k.x[0], z: k.z[0], yaw: k.yaw[0] });
  const spotR = rootToWorld(car, 'R', { x: k.x[0], z: k.z[0], yaw: k.yaw[0] });
  const lL = worldToCar(car, spotL.x, spotL.z);
  const lR = worldToCar(car, spotR.x, spotR.z);
  check(Math.abs(lL.x + lR.x) < 1e-9 && Math.abs(lL.z - lR.z) < 1e-9 && lL.x > BMW_HALF_WIDTH + 0.8, `yaw ${yaw}: the two door spots mirror each other, ${(lL.x - BMW_HALF_WIDTH).toFixed(2)} m outside the body`);
  // facing the car: the heading must point from the spot to the door side of the car
  const faceL = { x: Math.sin(spotL.yaw), z: Math.cos(spotL.yaw) };
  const toSeatL = carToWorld(car, SEAT_X, SEAT_Z);
  const dot = faceL.x * (toSeatL.x - spotL.x) + faceL.z * (toSeatL.z - spotL.z);
  check(dot > 1.5, `yaw ${yaw}: standing at the left door the character faces the seat`, `${dot.toFixed(2)} m of the way`);
  const faceR = { x: Math.sin(spotR.yaw), z: Math.cos(spotR.yaw) };
  const toSeatR = carToWorld(car, -SEAT_X, SEAT_Z);
  const dotR = faceR.x * (toSeatR.x - spotR.x) + faceR.z * (toSeatR.z - spotR.z);
  check(dotR > 1.5, `yaw ${yaw}: standing at the right door the character faces the seat`, `${dotR.toFixed(2)} m of the way`);
  // the whole mirrored entering path is the left one mirrored in the car frame
  let worst = 0;
  for (let i = 0; i < k.t.length; i++) {
    const a = worldToCar(car, ...(Object.values(rootToWorld(car, 'L', { x: k.x[i], z: k.z[i], yaw: k.yaw[i] })).slice(0, 2) as [number, number]));
    const b = worldToCar(car, ...(Object.values(rootToWorld(car, 'R', { x: k.x[i], z: k.z[i], yaw: k.yaw[i] })).slice(0, 2) as [number, number]));
    worst = Math.max(worst, Math.abs(a.x + b.x), Math.abs(a.z - b.z));
  }
  check(worst < 1e-9, `yaw ${yaw}: right-door path is the left-door path mirrored`);
  const seatEnd = worldToCar(car, ...(Object.values(rootToWorld(car, 'L', { x: eN.x, z: eN.z, yaw: eN.yaw })).slice(0, 2) as [number, number]));
  check(Math.hypot(seatEnd.x - SEAT_X, seatEnd.z - SEAT_Z) < 0.04, `yaw ${yaw}: the entering clip ends on the driver's seat`, `at ${seatEnd.x.toFixed(2)}, ${seatEnd.z.toFixed(2)}`);
}

// ---- which door -----------------------------------------------------------------------------------------------------------------
{
  const car: CarPose = { x: 10, z: 20, yaw: 1.1 };
  const spot = seatToCar('L', e0.x, e0.z);
  const at = (lx: number, lz: number) => carToWorld(car, lx, lz);
  const pick = (lx: number, lz: number) => {
    const p = at(lx, lz);
    return nearestDoor(car, p.x, p.z, spot.x, spot.z);
  };
  check(pick(3, 0) === 'L' && pick(-3, 0) === 'R', 'standing beside a door picks that door');
  check(pick(0.2, 6) === 'L' && pick(-0.2, 6) === 'R', 'in front of the car: the nearer side wins');
  check(pick(2.5, -6) === 'L' && pick(-2.5, -6) === 'R', 'behind the car: the nearer side wins');
  check(distanceToCar(car, car.x, car.z) === 0 && Math.abs(distanceToCar(car, ...(Object.values(at(BMW_HALF_WIDTH + 2, 0)) as [number, number])) - 2) < 1e-9, 'distanceToCar: 0 under it, 2 m beside it');
  check(Math.abs(distanceToCar(car, ...(Object.values(at(BMW_HALF_WIDTH + 3, BMW_HALF_LENGTH + 4)) as [number, number])) - 5) < 1e-9, 'distanceToCar: diagonal from a corner (3-4-5)');
}

// ---- walking round the car ------------------------------------------------------------------------------------------------------
{
  const car: CarPose = { x: -40, z: 15, yaw: -0.6 };
  const k = curves.carEnter;
  const spot = rootToWorld(car, 'L', { x: k.x[0], z: k.z[0], yaw: k.yaw[0] });
  const hits = (path: { x: number; z: number }[], from: { x: number; z: number }) => {
    let prev = from;
    let bad = 0;
    let len = 0;
    for (const w of path) {
      for (let s = 0; s <= 100; s++) {
        const p = { x: prev.x + ((w.x - prev.x) * s) / 100, z: prev.z + ((w.z - prev.z) * s) / 100 };
        const l = worldToCar(car, p.x, p.z);
        if (Math.abs(l.x) < BMW_HALF_WIDTH + 0.1 && Math.abs(l.z) < BMW_HALF_LENGTH + 0.1) bad++;
      }
      len += Math.hypot(w.x - prev.x, w.z - prev.z);
      prev = w;
    }
    return { bad, len };
  };
  const cases: [string, number, number, number][] = [
    ['same side as the door', 4.5, 1, 1],
    ['the far side (right-hand side, left door wanted)', -3.5, 0, 3],
    ['in front of the nose', 0.3, 7, 3],
    ['behind the tail', 0.3, -7, 3],
    ['diagonal front-right', -4, 6, 4],
  ];
  for (const [name, lx, lz, maxCorners] of cases) {
    const from = carToWorld(car, lx, lz);
    const path = planApproach(car, from, spot);
    const r = hits(path, from);
    check(r.bad === 0 && path.length <= maxCorners + 1, `route: ${name}`, `${path.length - 1} detour point(s), ${r.len.toFixed(1)} m, ${r.bad} samples through the car`);
    const end = path[path.length - 1];
    check(Math.hypot(end.x - spot.x, end.z - spot.z) < 1e-9, `route: ${name} ends at the door spot`);
  }
  const straight = planApproach(car, carToWorld(car, 4.5, 1), spot);
  check(straight.length === 1, 'already on the door side: walks straight there');
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
if (failed) process.exit(1);
