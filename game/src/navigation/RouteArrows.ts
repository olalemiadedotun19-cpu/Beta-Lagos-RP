import * as THREE from 'three';
import { groundHeightAt } from '../world/CurvedRoads';
import type { Route } from './NavMap';

/**
 * Gold chevrons lying flat on the road, showing the way to the waypoint while the player is DRIVING.
 *
 * - They are anchored to the route measured from its END (every SPACING metres), so they stay put on the ground while the car moves
 *   and only the ones ahead of the car are shown. Once the car reaches one it shrinks away ("erases"); the ones further ahead appear.
 * - Each chevron points along the route at its spot, so it turns with every bend and junction.
 * - Each chevron sits on the real ground (roads, slopes, bridge decks): its height is sampled at 5 points, it is tilted to the surface and
 *   lifted just enough that no corner dips into the ground, then raised LIFT (a few cm) so it never floats.
 * Uses one InstancedMesh (one draw call) and no per-frame allocations.
 */

const SPACING = 7; // metres between arrows
const LOOK_AHEAD = 84; // how far ahead of the car arrows are shown
const HIDE_UNDER = 1.2; // closer than this to the player (under the car): hidden
const FULL_AT = 7; // from this distance ahead the arrow is full size; between HIDE_UNDER and this it shrinks away
const MAX_ARROWS = Math.ceil(LOOK_AHEAD / SPACING) + 2;
const LIFT = 0.07; // metres above the surface (just clear of the asphalt / paint, nowhere near floating)
const HALF_L = 1.5; // half the arrow length, used to sample the slope
const HALF_W = 1.35; // half the arrow width

const GOLD = new THREE.Color(0xffc21a);
const GOLD_DEEP = new THREE.Color(0xd99a00);

/** two chevrons one behind the other, flat in the XZ plane, pointing +Z */
function buildGeometry(): THREE.BufferGeometry {
  const chevron = (zOff: number): THREE.Shape => {
    const s = new THREE.Shape();
    // (x, y) here becomes (x, z) after rotateX
    s.moveTo(0, 1.0 + zOff);
    s.lineTo(1.35, -0.25 + zOff);
    s.lineTo(1.35, -0.95 + zOff);
    s.lineTo(0, 0.28 + zOff);
    s.lineTo(-1.35, -0.95 + zOff);
    s.lineTo(-1.35, -0.25 + zOff);
    s.closePath();
    return s;
  };
  const g = new THREE.ShapeGeometry([chevron(0.55), chevron(-0.65)]);
  g.rotateX(Math.PI / 2); // lie flat, forward = +Z
  return g;
}

interface Anchor {
  x: number;
  z: number;
  y: number;
  /** unit forward direction (XZ) */
  fx: number;
  fz: number;
  /** slope of the surface along the nose and toward the left edge (rise per metre) */
  sF: number;
  sL: number;
}

export class RouteArrows {
  private mesh: THREE.InstancedMesh;
  private geo: THREE.BufferGeometry;
  private mat: THREE.MeshBasicMaterial;
  private cache = new Map<number, Anchor>();
  private lastRoute: Route | null = null;
  private lastEndKey = '';
  /** remaining distance from route.points[i] to the end of the driven part of the route */
  private rem: number[] = [];
  private endIdx = 0;
  private time = 0;

  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private basisX = new THREE.Vector3();
  private basisY = new THREE.Vector3();
  private basisZ = new THREE.Vector3();
  private col = new THREE.Color();
  private tmp = { x: 0, z: 0 };
  private tmp2 = { x: 0, z: 0 };
  private tmp3 = { x: 0, z: 0 };

  constructor(private scene: THREE.Scene) {
    this.geo = buildGeometry();
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, // the gold comes from the per-instance colour
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, MAX_ARROWS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    this.mesh.visible = false;
    // instance colours must exist before the first draw
    for (let i = 0; i < MAX_ARROWS; i++) this.mesh.setColorAt(i, GOLD);
    this.scene.add(this.mesh);
  }

  /**
   * Call every frame. `route` = null (or `active` false) hides everything: no waypoint, not driving, or inside a building.
   * (px, pz, py) = where the player is (while driving: sitting in the car).
   */
  update(dt: number, active: boolean, route: Route | null, px: number, pz: number, py: number): void {
    if (!active || !route || route.points.length < 2) {
      this.mesh.visible = false;
      this.mesh.count = 0;
      this.lastRoute = null;
      if (!route) this.cache.clear();
      return;
    }
    this.time += dt;
    if (route !== this.lastRoute) this.prepare(route);
    const pts = route.points;
    const rem = this.rem;
    const last = this.endIdx;
    if (last < 1) {
      this.mesh.visible = false;
      return;
    }

    // where the car is along the route (as remaining distance): the nearest of the first few segments
    let bestD = Infinity;
    let dCar = rem[0];
    const limit = Math.min(last - 1, 60);
    for (let i = 0; i <= limit; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 1e-6 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / len2)) : 0;
      const d = Math.hypot(px - a.x - dx * t, pz - a.z - dz * t);
      if (d < bestD) {
        bestD = d;
        dCar = rem[i] - t * Math.sqrt(len2);
      }
    }

    // anchors k * SPACING from the END that lie between the car and LOOK_AHEAD in front of it
    const kMin = Math.max(1, Math.ceil((dCar - LOOK_AHEAD) / SPACING));
    const kMax = Math.floor((dCar - HIDE_UNDER) / SPACING);
    let n = 0;
    let refY = groundHeightAt(px, pz, py + 0.6);
    // nearest first (k from kMax down to kMin): each arrow reads its ground height with the previous arrow's height as reference,
    // so a bridge deck is followed up the ramp and a road passing UNDER a flyover is not lifted onto it
    for (let k = kMax; k >= kMin && n < MAX_ARROWS; k--) {
      const a = this.anchor(route, k, refY);
      if (!a) continue;
      refY = a.y;
      const ahead = dCar - k * SPACING; // metres in front of the car
      // erase as the car arrives, slightly smaller far away
      const near = Math.max(0, Math.min(1, (ahead - HIDE_UNDER) / (FULL_AT - HIDE_UNDER)));
      const far = 1 - 0.35 * Math.min(1, ahead / LOOK_AHEAD);
      const sc = near * near * (3 - 2 * near) * far;
      if (sc < 0.02) continue;

      this.compose(a, sc);
      this.mesh.setMatrixAt(n, this.m);
      // a soft brightness wave runs forward along the arrows
      const w = 0.78 + 0.22 * Math.sin(this.time * 5 - k * 0.9);
      this.col.copy(GOLD_DEEP).lerp(GOLD, w);
      this.mesh.setColorAt(n, this.col);
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** builds the remaining-distance table for a new route object; clears the cached anchors when the destination changed */
  private prepare(route: Route): void {
    this.lastRoute = route;
    const pts = route.points;
    // only the driven part: the player -> road -> end of the road part. The final off-road walking leg to the door is left to the beacon.
    this.endIdx = route.roadTo > route.roadFrom ? route.roadTo : pts.length - 1;
    const end = pts[this.endIdx];
    const key = `${Math.round(end.x)}_${Math.round(end.z)}_${this.endIdx > 0 ? 1 : 0}`;
    if (key !== this.lastEndKey) {
      this.cache.clear();
      this.lastEndKey = key;
    }
    this.rem.length = 0;
    this.rem.length = this.endIdx + 1;
    this.rem[this.endIdx] = 0;
    for (let i = this.endIdx - 1; i >= 0; i--) {
      this.rem[i] = this.rem[i + 1] + Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
    }
  }

  /** position on the route at remaining distance d (clamped to the route) */
  private pointAt(route: Route, d: number, out: { x: number; z: number }): void {
    const pts = route.points;
    const rem = this.rem;
    const last = this.endIdx;
    if (d <= 0) {
      out.x = pts[last].x;
      out.z = pts[last].z;
      return;
    }
    if (d >= rem[0]) {
      out.x = pts[0].x;
      out.z = pts[0].z;
      return;
    }
    // rem is decreasing: find i with rem[i] >= d > rem[i+1]
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (rem[mid] >= d) lo = mid;
      else hi = mid;
    }
    const seg = rem[lo] - rem[lo + 1];
    const t = seg > 1e-6 ? (rem[lo] - d) / seg : 0;
    out.x = pts[lo].x + (pts[lo + 1].x - pts[lo].x) * t;
    out.z = pts[lo].z + (pts[lo + 1].z - pts[lo].z) * t;
  }

  /** the (cached) world placement of anchor k: position, heading and the height of the surface under it */
  private anchor(route: Route, k: number, refY: number): Anchor | null {
    const d = k * SPACING;
    if (d >= this.rem[0] || d <= 0) return null;
    const c = this.tmp;
    this.pointAt(route, d, c);
    const cached = this.cache.get(k);
    if (cached && Math.abs(cached.x - c.x) < 0.4 && Math.abs(cached.z - c.z) < 0.4) return cached;

    // heading: toward the end of the route (decreasing remaining distance), smoothed over a few metres so corners turn gradually
    const back = this.tmp2;
    const fwd = this.tmp3;
    this.pointAt(route, d + 1.6, back);
    this.pointAt(route, Math.max(0, d - 1.6), fwd);
    let fx = fwd.x - back.x;
    let fz = fwd.z - back.z;
    const fl = Math.hypot(fx, fz);
    if (fl < 1e-4) return null;
    fx /= fl;
    fz /= fl;

    // surface height at the centre, nose, tail, left and right edge (so slopes, banking and kerbs are all covered)
    const lx = -fz; // left = perpendicular
    const lz = fx;
    const hC = groundHeightAt(c.x, c.z, refY + 0.6);
    const hF = groundHeightAt(c.x + fx * HALF_L, c.z + fz * HALF_L, hC + 0.6);
    const hB = groundHeightAt(c.x - fx * HALF_L, c.z - fz * HALF_L, hC + 0.6);
    const hL = groundHeightAt(c.x + lx * HALF_W, c.z + lz * HALF_W, hC + 0.6);
    const hR = groundHeightAt(c.x - lx * HALF_W, c.z - lz * HALF_W, hC + 0.6);

    const a: Anchor = cached ?? { x: 0, z: 0, y: 0, fx: 0, fz: 1, sF: 0, sL: 0 };
    a.x = c.x;
    a.z = c.z;
    a.fx = fx;
    a.fz = fz;
    // plane through the average height; lift so the highest sample is still under the arrow (never dips into the ground)
    const avg = (hF + hB + hL + hR) / 4;
    const slopeF = (hF - hB) / (2 * HALF_L);
    const slopeL = (hL - hR) / (2 * HALF_W);
    const planeAt = (df: number, dl: number): number => avg + slopeF * df + slopeL * dl;
    let lift = 0;
    lift = Math.max(lift, hC - planeAt(0, 0));
    lift = Math.max(lift, hF - planeAt(HALF_L, 0));
    lift = Math.max(lift, hB - planeAt(-HALF_L, 0));
    lift = Math.max(lift, hL - planeAt(0, HALF_W));
    lift = Math.max(lift, hR - planeAt(0, -HALF_W));
    a.y = avg + lift + LIFT;
    a.sF = slopeF;
    a.sL = slopeL;
    this.cache.set(k, a);
    return a;
  }

  /** matrix of one arrow: lies on the plane of the surface, nose along the route */
  private compose(a: Anchor, scale: number): void {
    const { sF, sL } = a;
    const fx = a.fx;
    const fz = a.fz;
    // surface normal from the two slopes (height = avg + sF * df + sL * dl)
    // forward axis f = (fx, sF, fz) , left axis l = (-fz, sL, fx); up = f x l (normalised)
    this.basisZ.set(fx, sF, fz).normalize(); // local +Z = forward (nose)
    const left = this.basisX.set(-fz, sL, fx).normalize();
    this.basisY.crossVectors(this.basisZ, left).normalize();
    if (this.basisY.y < 0) this.basisY.negate();
    // local +X must be the right-hand side of a right-handed frame (X x Y = Z)
    this.basisX.crossVectors(this.basisY, this.basisZ).normalize();
    this.m.makeBasis(this.basisX, this.basisY, this.basisZ);
    this.q.setFromRotationMatrix(this.m);
    this.p.set(a.x, a.y, a.z);
    this.s.set(scale, 1, scale);
    this.m.compose(this.p, this.q, this.s);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.geo.dispose();
    this.mat.dispose();
    this.cache.clear();
  }
}
