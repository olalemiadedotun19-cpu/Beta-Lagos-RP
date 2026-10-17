/** The root motion of the baked car clips (scripts/locomotion/bake_car_clips.py), in the seat frame. No three.js: testable from node. */

export type CarClipName = 'carEnter' | 'carDrive' | 'carExit';

export interface CarClipCurves {
  dur: number;
  /** key times (s) the arrays below are sampled at */
  t: number[];
  /** root position in the seat frame (m): +x towards the door, +z the way the car faces */
  x: number[];
  z: number[];
  /** heading (rad, unwrapped); 0 = facing the nose, + towards the door side */
  yaw: number[];
  /** extra vertical offset (m) that lowers the character onto the low BMW seat */
  dy: number[];
  /** 0 = standing on the ground outside, 1 = in the car */
  inside: number[];
  /** clip times at which the car door starts to open / close */
  events: { doorOpen?: number; doorClose?: number };
}

export interface RootSample {
  x: number;
  z: number;
  yaw: number;
  dy: number;
  inside: number;
}

export type CarClipSet = Record<CarClipName, CarClipCurves>;

function lerpAt(times: number[], values: number[], t: number): number {
  const n = times.length;
  if (t <= times[0]) return values[0];
  if (t >= times[n - 1]) return values[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const k = (t - times[lo]) / (times[hi] - times[lo]);
  return values[lo] + (values[hi] - values[lo]) * k;
}

export function sampleCarClip(c: CarClipCurves, t: number): RootSample {
  return {
    x: lerpAt(c.t, c.x, t),
    z: lerpAt(c.t, c.z, t),
    yaw: lerpAt(c.t, c.yaw, t),
    dy: lerpAt(c.t, c.dy, t),
    inside: lerpAt(c.t, c.inside, t),
  };
}

/** Blend two root samples (w = 0 -> a, 1 -> b); the heading goes the short way round. */
export function blendRoot(a: RootSample, b: RootSample, w: number): RootSample {
  let dyaw = b.yaw - a.yaw;
  dyaw -= Math.round(dyaw / (Math.PI * 2)) * Math.PI * 2;
  return {
    x: a.x + (b.x - a.x) * w,
    z: a.z + (b.z - a.z) * w,
    yaw: a.yaw + dyaw * w,
    dy: a.dy + (b.dy - a.dy) * w,
    inside: a.inside + (b.inside - a.inside) * w,
  };
}
