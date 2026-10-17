/**
 * RoadMath - small pure helpers shared by CurvedRoads (the network builder) and CityPlan (the city layout).
 * No THREE, no DOM.
 */
export type V2 = [number, number];

/** control point, optionally with a forced travel direction (dx, dz) */
export type Ctrl = [number, number] | [number, number, number, number];

export const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const h = (a: number, b: number) => {
    let v = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(seed, 2147483647);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = h(ix, iz);
  const b = h(ix + 1, iz);
  const c = h(ix, iz + 1);
  const d = h(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/** C1 Hermite path through the control points, resampled to even arc-length spacing */
export function densePath(ctrl: Ctrl[], step: number): V2[] {
  const n = ctrl.length;
  const P = ctrl.map((c) => [c[0], c[1]] as V2);
  const dir: V2[] = P.map((p, i) => {
    const c = ctrl[i];
    if (c.length === 4) {
      const l = Math.hypot(c[2], c[3]) || 1;
      return [c[2] / l, c[3] / l] as V2;
    }
    const a = i > 0 ? P[i - 1] : null;
    const b = i < n - 1 ? P[i + 1] : null;
    let dx = 0;
    let dz = 0;
    if (a) {
      const l = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1;
      dx += (p[0] - a[0]) / l;
      dz += (p[1] - a[1]) / l;
    }
    if (b) {
      const l = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
      dx += (b[0] - p[0]) / l;
      dz += (b[1] - p[1]) / l;
    }
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l] as V2;
  });
  const fine: V2[] = [P[0]];
  for (let i = 0; i < n - 1; i++) {
    const L = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
    const m0: V2 = [dir[i][0] * L, dir[i][1] * L];
    const m1: V2 = [dir[i + 1][0] * L, dir[i + 1][1] * L];
    const N = Math.max(2, Math.ceil(L / 1.2));
    for (let k = 1; k <= N; k++) {
      const t = k / N;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      fine.push([
        h00 * P[i][0] + h10 * m0[0] + h01 * P[i + 1][0] + h11 * m1[0],
        h00 * P[i][1] + h10 * m0[1] + h01 * P[i + 1][1] + h11 * m1[1],
      ]);
    }
  }
  // resample at even arc length (last point kept exactly)
  const out: V2[] = [fine[0]];
  let carry = 0;
  for (let i = 1; i < fine.length; i++) {
    const a = fine[i - 1];
    const b = fine[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let at = step - carry;
    while (at <= seg) {
      const t = at / seg;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      at += step;
    }
    carry = seg - (at - step);
  }
  const last = fine[fine.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.35) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

/** distance from (px, pz) to the segment a-b, plus the parameter t of the nearest point */
export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 < 1e-12 ? 0 : clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  return { d: Math.hypot(px - ax - dx * t, pz - az - dz * t), t };
}

/** circumradius of three points (Infinity when collinear) */
export function circumRadius(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  const ab = Math.hypot(bx - ax, bz - az);
  const bc = Math.hypot(cx - bx, cz - bz);
  const ca = Math.hypot(ax - cx, az - cz);
  const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
  return area2 < 1e-9 ? Infinity : (ab * bc * ca) / (2 * area2);
}
