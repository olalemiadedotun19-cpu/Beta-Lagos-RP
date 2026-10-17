import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import bmwUrl from './assets/bmw_i8.glb?url';
import { onTextureLevel } from '../../graphics/GraphicsSettings';
import {
  MODEL_SCALE,
  TIRE_BOTTOM_Y,
  AXLE_MID_Z,
  SEAT_X,
  SEAT_Z,
  SEAT_HIPS_Y,
  SEAT_RECLINE,
  CABIN_FLOOR_Y,
  WHEEL_POS,
  rawX,
  rawY,
  rawZ,
  type Side,
} from '../carGeometry';

/**
 * The BMW i8 from the viewer (bmw_i8_viewer.html), as a static parked car.
 * Model: "BMW I8" by iSteven (https://sketchfab.com/3d-models/bmw-i8-4b143b95aec045bf8912d99662f8d580), CC BY-NC 4.0.
 *
 * Frame of the returned group: origin on the ground under the middle of the wheelbase, nose towards +z, +x is the car's left
 * (the driver's side), +y up. Same numbers as the viewer, so the car has its real size (4.689 m long).
 */

/** how strongly the soft studio reflections light the paint (the game scene has no environment map of its own) */
const ENV_INTENSITY = 0.8;

export { BMW_WHEELBASE, BMW_TRACK, BMW_HALF_WIDTH } from '../carGeometry';

/**
 * The simple cabin the viewer puts behind the dark glass: floor, tunnel, dash, four seats, steering wheel (raw model units).
 * The front seats and the wheel are placed around the seated character (carGeometry.ts SEAT_*, WHEEL_POS): low seat, pelvis 0.5 m
 * above the ground, hands on the wheel.
 */
function buildCabin(): THREE.Group {
  const seat = new THREE.MeshStandardMaterial({ color: 0x1c1e23, roughness: 0.5, metalness: 0 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.75, metalness: 0 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x1f4fd8, roughness: 0.5, metalness: 0 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x0d0e11, roughness: 1, metalness: 0 });
  const cabin = new THREE.Group();

  const box = (w: number, h: number, d: number, radius: number, mat: THREE.Material, x: number, y: number, z: number, rotX = 0) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, radius), mat);
    m.position.set(x, y, z);
    m.rotation.x = rotX;
    cabin.add(m);
    return m;
  };

  const floorTop = rawY(CABIN_FLOOR_Y + 0.04); // a few cm above the road so it never fights with the ground
  const floorY = floorTop - 0.015;
  box(1.56, 0.03, 2.3, 0.01, floorMat, 0, floorY, 0.05); // floor
  const tunnelTop = -0.1;
  box(0.26, tunnelTop - floorTop, 1.9, 0.05, trim, 0, (tunnelTop + floorTop) / 2, 0.1); // centre tunnel
  box(1.5, 0.15, 0.42, 0.05, trim, 0, 0.09, 0.93); // dashboard
  box(0.46, 0.12, 0.2, 0.04, trim, 0.36, 0.2, 0.8); // instrument hood
  box(1.3, 0.012, 0.012, 0.004, accent, 0, 0.17, 0.72); // blue dash strip

  // front seats: the cushion top sits 10 cm under the pelvis, the pelvis point is SEAT_Z, the back follows the driver's lean
  const cushionTop = rawY(SEAT_HIPS_Y - 0.105);
  const cushionY = cushionTop - 0.05;
  const cushionZ = rawZ(SEAT_Z) + 0.15;
  const sinT = Math.sin(SEAT_RECLINE);
  const cosT = Math.cos(SEAT_RECLINE);
  // a point `along` metres up the driver's back and `behind` metres behind it, as raw (z, y)
  const onBack = (along: number, behind: number): [number, number] => [
    rawZ(SEAT_Z - along * sinT - behind * cosT),
    rawY(SEAT_HIPS_Y + along * cosT - behind * sinT),
  ];
  for (const sx of [1, -1]) {
    const x = rawX(SEAT_X) * sx;
    box(0.2, cushionY - 0.05 - floorTop, 0.4, 0.03, trim, x, (cushionY - 0.05 + floorTop) / 2, cushionZ - 0.05); // seat base
    box(0.42, 0.1, 0.52, 0.04, seat, x, cushionY, cushionZ); // front seat
    const [bz, by] = onBack(0.3, 0.13);
    box(0.42, 0.56, 0.11, 0.05, seat, x, by, bz, -SEAT_RECLINE); // front seat back
    const [hz, hy] = onBack(0.66, 0.1);
    box(0.2, 0.16, 0.08, 0.04, seat, x, hy, hz, -SEAT_RECLINE); // headrest
  }
  for (const x of [0.36, -0.36]) {
    box(0.2, -0.22 - 0.05 - floorTop, 0.3, 0.03, trim, x, (-0.27 + floorTop) / 2, -0.74); // rear seat base
    box(0.38, 0.09, 0.36, 0.04, seat, x, -0.22, -0.74); // rear seat
    box(0.38, 0.38, 0.09, 0.04, seat, x, 0, -0.95, -0.18); // rear seat back
  }

  const wheel = new THREE.Group(); // steering wheel, driver's side (+x), at the hands of the seated driver
  wheel.position.set(rawX(WHEEL_POS.x), rawY(WHEEL_POS.y), rawZ(WHEEL_POS.z));
  wheel.rotation.x = -0.35;
  const spin = new THREE.Group(); // turned about the wheel's own axis when steering (userData.steeringWheel)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.019, 12, 40), trim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 20), seat);
  hub.rotation.x = Math.PI / 2;
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.025, 0.012), trim);
  spin.add(rim, hub, spoke);
  wheel.add(spin);
  cabin.add(wheel);
  cabin.userData.steeringWheel = spin;

  cabin.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = false;
  });
  return cabin;
}

// ---- wheels --------------------------------------------------------------------------------------------------------------------
// The model holds the wheels as a few meshes: the front-left and front-right wheel each have their own node, but the two rear wheels
// share one (their geometry is mirrored inside it), and the front pair is baked turned by 17 degrees (a showroom pose). This cuts every
// wheel mesh into four corners by triangle, undoes the baked steer about the front wheels' own pivots, and rebuilds each corner as
//   steer pivot (at the wheel centre; turned about the vertical when steering)
//     +- spin group (turned about the axle when rolling): tyre, rim, brake disc ...
//     +- brake caliper (steers with the wheel but does not spin)

const WHEEL_PART = /^(wheel|Vert)/;
const isWheelPart = (mesh: THREE.Mesh): boolean => WHEEL_PART.test(mesh.name) || (!!mesh.parent && WHEEL_PART.test(mesh.parent.name));

/** how far the front wheels are turned in the raw model (rad, about the vertical axis; measured on the GLB: tyre width 0.278 only at +17 deg) */
const FRONT_BAKED_STEER = (17 * Math.PI) / 180;

export interface BmwWheel {
  front: boolean;
  steer: THREE.Group;
  spin: THREE.Group;
  /** rolling radius in metres */
  radius: number;
}

interface WheelPartGeo {
  geo: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  name: string;
  caliper: boolean;
  tire: boolean;
}
interface WheelCorner {
  front: boolean;
  parts: WheelPartGeo[];
  /** the wheel node's own origin (the front wheels' baked steer turns about it) */
  pivot: THREE.Vector3 | null;
}

// ---- tyre surface --------------------------------------------------------------------------------------------------------------
// The model's tyre is one flat near-black material: turning it changes nothing on screen, so the wheels looked like they were not
// rolling (worst in reverse, where the rims alone are slow and easy to miss). The tyre gets a tread / sidewall texture that is mapped
// round the axle (u = angle round the wheel, v = across the tyre), so the surface visibly runs under the car in both directions.

function makeTyreTexture(): THREE.CanvasTexture {
  const W = 1024; // the whole way round the tyre
  const H = 256; // across it: sidewall | tread | sidewall
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#18181b';
  g.fillRect(0, 0, W, H);

  const side = H * 0.17;
  // sidewalls (top and bottom rows): fine radial ribs, plus pale marker blocks (like the lettering / reflective marks of a real tyre)
  for (const y0 of [0, H - side]) {
    for (let i = 0; i < 128; i++) {
      g.fillStyle = i % 2 ? '#202024' : '#141416';
      g.fillRect(i * (W / 128), y0, W / 128, side);
    }
    for (let i = 0; i < 8; i++) {
      g.fillStyle = '#8d8d95';
      g.fillRect(i * (W / 8) + 20, y0 + side * 0.12, 26, side * 0.76);
      g.fillStyle = '#5a5a61';
      g.fillRect(i * (W / 8) + 56, y0 + side * 0.12, 8, side * 0.76);
    }
  }
  // tread: chevron blocks with dark grooves
  const t0 = side;
  const t1 = H - side;
  const mid = (t0 + t1) / 2;
  const N = 64;
  const bw = W / N;
  g.fillStyle = '#0a0a0c';
  g.fillRect(0, t0, W, t1 - t0);
  for (let i = 0; i < N; i++) {
    const x = i * bw;
    g.fillStyle = i % 2 ? '#2c2c31' : '#26262a';
    g.beginPath(); // upper half leans one way, lower half the other: a V that points the way the tyre is meant to run
    g.moveTo(x + 2, t0 + 3);
    g.lineTo(x + bw - 3, t0 + 3);
    g.lineTo(x + bw + 5, mid - 3);
    g.lineTo(x + 2, mid - 3);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(x + 2, mid + 3);
    g.lineTo(x + bw + 5, mid + 3);
    g.lineTo(x + bw - 3, t1 - 3);
    g.lineTo(x + 2, t1 - 3);
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Gives a tyre geometry (centred on its wheel centre, axle along x) UVs: u = angle round the axle, v = position across the tyre.
 * The geometry is made non-indexed so a triangle that crosses the seam of the angle can carry u values beyond 0..1 (the texture
 * repeats) instead of smearing the whole texture over it.
 */
function tyreUVs(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const width = Math.max(bb.max.x - bb.min.x, 1e-6);
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const a = [0, 0, 0];
  for (let t = 0; t + 2 < pos.count; t += 3) {
    for (let k = 0; k < 3; k++) a[k] = Math.atan2(pos.getZ(t + k), pos.getY(t + k)) / (Math.PI * 2);
    for (let k = 1; k < 3; k++) {
      while (a[k] - a[0] > 0.5) a[k] -= 1;
      while (a[k] - a[0] < -0.5) a[k] += 1;
    }
    for (let k = 0; k < 3; k++) {
      uv[(t + k) * 2] = a[k];
      uv[(t + k) * 2 + 1] = pos.getX(t + k) / width + 0.5;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (g !== geo) geo.dispose();
  return g;
}

function splitWheels(scene: THREE.Object3D, model: THREE.Group): BmwWheel[] {
  scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && isWheelPart(m)) meshes.push(m);
  });

  const corners = new Map<string, WheelCorner>();
  for (const mesh of meshes) {
    const baked = mesh.geometry.clone();
    baked.applyMatrix4(mesh.matrixWorld);
    if (!baked.index) {
      const n = baked.attributes.position.count;
      const seq = new Uint32Array(n);
      for (let i = 0; i < n; i++) seq[i] = i;
      baked.setIndex(new THREE.BufferAttribute(seq, 1));
    }
    const pos = baked.attributes.position;
    const idx = baked.index!.array;
    const byCorner = new Map<string, number[]>();
    for (let t = 0; t < idx.length / 3; t++) {
      const a = idx[t * 3];
      const b = idx[t * 3 + 1];
      const c = idx[t * 3 + 2];
      const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
      const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
      const key = (cz > 0 ? 'F' : 'R') + (cx > 0 ? 'L' : 'R');
      let list = byCorner.get(key);
      if (!list) byCorner.set(key, (list = []));
      list.push(t);
    }
    const caliper = mesh.name.startsWith('Vert') || (!!mesh.parent && mesh.parent.name.startsWith('Vert'));
    const material = mesh.material as THREE.Material;
    const tire = !caliper && (material.name === 'tire' || /tire/i.test(mesh.name));
    for (const [key, tris] of byCorner) {
      let corner = corners.get(key);
      if (!corner) corners.set(key, (corner = { front: key[0] === 'F', parts: [], pivot: null }));
      corner.parts.push({ geo: subGeometry(baked, tris), material: mesh.material, name: mesh.name, caliper, tire });
      if (tire && corner.front && mesh.parent && WHEEL_PART.test(mesh.parent.name)) {
        corner.pivot = new THREE.Vector3().setFromMatrixPosition(mesh.parent.matrixWorld);
      }
    }
    baked.dispose();
    mesh.geometry.dispose();
    mesh.parent?.remove(mesh);
  }

  const wheels: BmwWheel[] = [];
  const box = new THREE.Box3();
  const centre = new THREE.Vector3();
  let tyreMaterial: THREE.MeshStandardMaterial | null = null; // one tread material shared by the four tyres
  for (const corner of corners.values()) {
    const tire = corner.parts.find((p) => p.tire);
    if (!tire) {
      // no tyre found for this corner (should not happen): keep its parts as a fixed piece instead of losing them
      for (const p of corner.parts) model.add(new THREE.Mesh(p.geo, p.material));
      continue;
    }
    if (corner.front) {
      // undo the baked steer about the wheel node's origin (falls back to the tyre's own centre)
      let pivot = corner.pivot;
      if (!pivot) {
        tire.geo.computeBoundingBox();
        pivot = tire.geo.boundingBox!.getCenter(new THREE.Vector3());
      }
      const unsteer = new THREE.Matrix4()
        .makeTranslation(pivot.x, pivot.y, pivot.z)
        .multiply(new THREE.Matrix4().makeRotationY(FRONT_BAKED_STEER))
        .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
      for (const p of corner.parts) p.geo.applyMatrix4(unsteer);
    }
    // the wheel centre = the middle of the (now straight) tyre; every part is re-centred on it
    tire.geo.computeBoundingBox();
    box.copy(tire.geo.boundingBox!);
    box.getCenter(centre);
    const radius = ((box.max.y - box.min.y) / 2) * MODEL_SCALE;
    const steer = new THREE.Group();
    steer.position.copy(centre);
    const spin = new THREE.Group();
    steer.add(spin);
    for (const p of corner.parts) {
      p.geo.translate(-centre.x, -centre.y, -centre.z);
      if (p.tire) {
        p.geo = tyreUVs(p.geo);
        tyreMaterial ??= new THREE.MeshStandardMaterial({ map: makeTyreTexture(), color: 0xffffff, roughness: 0.68, metalness: 0, side: THREE.DoubleSide });
        p.material = tyreMaterial;
      }
      const m = new THREE.Mesh(p.geo, p.material);
      m.name = p.name;
      (p.caliper ? steer : spin).add(m);
    }
    model.add(steer);
    wheels.push({ front: corner.front, steer, spin, radius });
  }
  return wheels;
}

/** Turns the two front wheels: `angle` is the front wheel angle in rad (+ = left, the same as the driving physics). */
export function steerBmwWheels(car: THREE.Object3D, angle: number): void {
  const wheels = car.userData.wheels as BmwWheel[] | undefined;
  if (!wheels) return;
  for (const w of wheels) if (w.front) w.steer.rotation.y = angle;
}

/** Rolls the wheels for `dt` seconds at `forwardSpeed` m/s (negative = reversing). The handbrake locks the rear wheels. */
export function rollBmwWheels(car: THREE.Object3D, forwardSpeed: number, dt: number, handbrake: boolean): void {
  const wheels = car.userData.wheels as BmwWheel[] | undefined;
  if (!wheels) return;
  // A wheel turned by more than about half a spoke gap per frame seems to stand still or run backwards (the wagon-wheel effect): at
  // 100 km/h the real rate is 2 rad per frame. The shown spin is capped so it always reads as rolling the right way, forwards or in reverse.
  const limit = Math.min(MAX_VISUAL_SPIN * dt, MAX_VISUAL_STEP);
  for (const w of wheels) {
    if (handbrake && !w.front) continue;
    const step = Math.max(-limit, Math.min(limit, (forwardSpeed / w.radius) * dt));
    w.spin.rotation.x = (w.spin.rotation.x + step) % (Math.PI * 2);
  }
}
/** the fastest a wheel is SHOWN turning: rad/s, and rad per frame */
const MAX_VISUAL_SPIN = 24;
const MAX_VISUAL_STEP = 0.42;

// ---- doors: the viewer's rig ---------------------------------------------------------------------------------------------------
// The model is one fixed shell: bmw_i8_viewer.html cuts each body mesh into body / left door / right door by triangle (the door
// profile below, seen from the side as (z, y) in raw model units; the mirrors count as door), hangs the two doors on a slanted
// hinge at the front of the A-pillar and swings them one radian: the i8's butterfly doors. This is that code, unchanged in its numbers.

/** door outline seen from the side: (z, y) points in raw model units */
const DOOR_PROFILE: [number, number][] = [
  [-0.7, 0.64], [-0.7, 0.194], [-0.692, 0.154], [-0.669, 0.102], [-0.629, 0.034], [-0.591, -0.016], [-0.538, -0.068], [-0.357, -0.152],
  [-0.132, -0.224], [0.164, -0.261], [0.336, -0.274], [0.9, -0.312], [0.946, -0.209], [0.999, -0.091], [1.044, 0.027], [1.069, 0.104],
  [1.076, 0.126], [1.07, 0.157], [0.92, 0.2], [0.42, 0.64],
];
/** hinge of the left door (the right one mirrors x): position and the axis it turns about, raw units */
const DOOR_HINGE = { pos: [0.86, 0.17, 0.98], axis: [-0.5, 0.5, -0.6] };
const DOOR_OPEN_ANGLE = 1; // radians
/** seconds a door takes to open or close */
export const DOOR_SECONDS = 0.9;

export interface BmwDoor {
  pivot: THREE.Group;
  axis: THREE.Vector3;
  /** +1 / -1: which way round the axis moves the door outwards */
  dir: number;
  /** 0 closed .. 1 open (the eased angle is derived from it) */
  open: number;
  target: number;
}
export type BmwDoors = Record<Side, BmwDoor>;

function insideProfile(z: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = DOOR_PROFILE.length - 1; i < DOOR_PROFILE.length; j = i++) {
    const [zi, yi] = DOOR_PROFILE[i];
    const [zj, yj] = DOOR_PROFILE[j];
    if (yi > y !== yj > y && z < ((zj - zi) * (y - yi)) / (yj - yi) + zi) inside = !inside;
  }
  return inside;
}

function classifyTriangle(x: number, y: number, z: number): 'body' | 'doorL' | 'doorR' {
  if (Math.abs(x) < (y > 0.22 ? 0.57 : 0.5) || !insideProfile(z, y)) return 'body';
  return x > 0 ? 'doorL' : 'doorR';
}

function makeDoor(side: Side): BmwDoor {
  const e = side === 'L' ? 1 : -1;
  const pivot = new THREE.Group();
  pivot.position.set(DOOR_HINGE.pos[0] * e, DOOR_HINGE.pos[1], DOOR_HINGE.pos[2]);
  const axis = new THREE.Vector3(DOOR_HINGE.axis[0] * e, DOOR_HINGE.axis[1], DOOR_HINGE.axis[2]).normalize();
  // which way round the axis moves a point at the door's outer edge outwards
  const edge = new THREE.Vector3(0.9 * e, -0.1, -0.5).sub(pivot.position);
  const dir = edge.clone().applyAxisAngle(axis, 0.2).x * e > edge.x * e ? 1 : -1;
  return { pivot, axis, dir, open: 0, target: 0 };
}

/** a copy of `src` holding only the given triangles (position, normal, uv), re-indexed */
function subGeometry(src: THREE.BufferGeometry, tris: number[]): THREE.BufferGeometry {
  const index = src.index!.array;
  const remap = new Map<number, number>();
  const used: number[] = [];
  const out: number[] = [];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const v = index[t * 3 + k];
      let n = remap.get(v);
      if (n === undefined) {
        n = used.length;
        used.push(v);
        remap.set(v, n);
      }
      out.push(n);
    }
  }
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = src.attributes[name];
    if (!a) continue;
    const arr = new Float32Array(used.length * a.itemSize);
    for (let i = 0; i < used.length; i++) {
      arr[i * a.itemSize] = a.getX(used[i]);
      arr[i * a.itemSize + 1] = a.getY(used[i]);
      if (a.itemSize > 2) arr[i * a.itemSize + 2] = a.getZ(used[i]);
    }
    g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  g.setIndex(out);
  return g;
}

/**
 * Replaces every body mesh of the loaded model by a body part and two door parts (the tyres and wheels stay as they are).
 * Returns the doors, parented to `model`; the new body meshes go into `bodyGroup`. Everything is baked into the model's own
 * raw units, so `model`'s scale and offset still apply.
 */
function splitDoors(scene: THREE.Object3D, model: THREE.Group): BmwDoors {
  scene.updateMatrixWorld(true);
  const doors: BmwDoors = { L: makeDoor('L'), R: makeDoor('R') };
  model.add(doors.L.pivot, doors.R.pivot);
  const bodyGroup = new THREE.Group();
  model.add(bodyGroup);

  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    if (isWheelPart(mesh)) continue;
    const baked = mesh.geometry.clone();
    baked.applyMatrix4(mesh.matrixWorld);
    if (!baked.index) {
      const n = baked.attributes.position.count;
      const seq = new Uint32Array(n);
      for (let i = 0; i < n; i++) seq[i] = i;
      baked.setIndex(new THREE.BufferAttribute(seq, 1));
    }
    const pos = baked.attributes.position;
    const idx = baked.index!.array;
    const groups: Record<'body' | 'doorL' | 'doorR', number[]> = { body: [], doorL: [], doorR: [] };
    for (let t = 0; t < idx.length / 3; t++) {
      const a = idx[t * 3];
      const b = idx[t * 3 + 1];
      const c = idx[t * 3 + 2];
      const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
      const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
      const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
      groups[classifyTriangle(cx, cy, cz)].push(t);
    }
    const material = mesh.material;
    if (groups.body.length) {
      const m = new THREE.Mesh(subGeometry(baked, groups.body), material);
      m.name = mesh.name;
      bodyGroup.add(m);
    }
    for (const side of ['L', 'R'] as Side[]) {
      const tris = groups[side === 'L' ? 'doorL' : 'doorR'];
      if (!tris.length) continue;
      const g = subGeometry(baked, tris);
      const p = doors[side].pivot.position;
      g.translate(-p.x, -p.y, -p.z);
      const m = new THREE.Mesh(g, material);
      m.name = mesh.name + '_door' + side;
      doors[side].pivot.add(m);
    }
    baked.dispose();
    mesh.geometry.dispose();
    mesh.parent?.remove(mesh);
  }
  return doors;
}

const _doorQuat = new THREE.Quaternion();

/** Steps both doors towards their targets (0.9 s, eased, like the viewer). Call every frame the car is in the scene. */
export function stepBmwDoors(car: THREE.Object3D, dt: number): void {
  const doors = car.userData.doors as BmwDoors | undefined;
  if (!doors) return;
  for (const side of ['L', 'R'] as Side[]) {
    const d = doors[side];
    const diff = d.target - d.open;
    if (Math.abs(diff) > 5e-4) d.open += Math.sign(diff) * Math.min(Math.abs(diff), dt / DOOR_SECONDS);
    else d.open = d.target;
    const eased = d.open < 0.5 ? 2 * d.open * d.open : 1 - Math.pow(-2 * d.open + 2, 2) / 2;
    _doorQuat.setFromAxisAngle(d.axis, DOOR_OPEN_ANGLE * eased * d.dir);
    d.pivot.quaternion.copy(_doorQuat);
  }
}

export function setBmwDoor(car: THREE.Object3D, side: Side, open: boolean): void {
  const doors = car.userData.doors as BmwDoors | undefined;
  if (doors) doors[side].target = open ? 1 : 0;
}

/** 0 (closed) .. 1 (fully open) */
export function bmwDoorOpenness(car: THREE.Object3D, side: Side): number {
  const doors = car.userData.doors as BmwDoors | undefined;
  return doors ? doors[side].open : 0;
}

/** Downloads and builds the car. `gl` is the game's renderer (needed once, to bake the soft reflections the paint uses). */
export async function buildBmwI8(gl: THREE.WebGLRenderer): Promise<THREE.Group> {
  const gltf = await new GLTFLoader().loadAsync(bmwUrl);

  const pmrem = new THREE.PMREMGenerator(gl);
  const roomEnv = new RoomEnvironment();
  const env = pmrem.fromScene(roomEnv, 0.03).texture;
  pmrem.dispose();
  roomEnv.dispose();

  // the model, scaled to its real size and sat on the ground with the wheelbase centred on the origin
  const model = new THREE.Group();
  model.scale.setScalar(MODEL_SCALE);
  model.position.set(0, -TIRE_BOTTOM_Y * MODEL_SCALE, -AXLE_MID_Z * MODEL_SCALE);
  model.add(gltf.scene);
  const doors = splitDoors(gltf.scene, model);
  const wheels = splitWheels(gltf.scene, model);
  const cabin = buildCabin();
  model.add(cabin);

  const paintMeshes: THREE.Mesh[] = [];
  const paintMats = new Set<THREE.MeshPhysicalMaterial>();
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.envMap = env;
    mat.envMapIntensity = ENV_INTENSITY;
    if (mat.transparent) mat.depthWrite = false; // glass: no holes in what is behind it
    if (mat.name === 'paint') {
      const paint = mat as THREE.MeshPhysicalMaterial;
      paint.side = THREE.FrontSide;
      paint.metalness = 0.55;
      paint.roughness = 0.34;
      paint.clearcoat = 1;
      paint.clearcoatRoughness = 0.03;
      paintMeshes.push(mesh);
      paintMats.add(paint);
    }
  });
  // the inside of the body shell is dark, not see-through
  const innerShell = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.7, metalness: 0.1, side: THREE.BackSide });
  innerShell.envMap = env;
  innerShell.envMapIntensity = ENV_INTENSITY;
  for (const m of paintMeshes) {
    const inner = new THREE.Mesh(m.geometry, innerShell);
    inner.castShadow = false;
    m.add(inner);
  }

  // The clear-coat layer is a second full lighting pass on every pixel of the body (the car fills a big part of the screen while
  // driving). It is kept for High / Ultra textures and dropped for Low / Medium (same colour, slightly less gloss): much cheaper at 100% resolution.
  const stopLevel = onTextureLevel((lv) => {
    const coat = lv >= 2 ? 1 : 0;
    for (const p of paintMats) {
      if (p.clearcoat === coat) continue;
      p.clearcoat = coat;
      p.needsUpdate = true;
    }
  });

  const car = new THREE.Group();
  car.name = 'bmw_i8';
  car.userData.stopGfx = stopLevel;
  car.userData.env = env;
  car.userData.doors = doors;
  car.userData.wheels = wheels;
  car.userData.steeringWheel = cabin.userData.steeringWheel;
  car.add(model);
  return car;
}

/** Frees the car's geometry, materials, textures and reflections. */
export function disposeBmwI8(car: THREE.Group): void {
  (car.userData.stopGfx as (() => void) | undefined)?.();
  car.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      for (const v of Object.values(mat)) {
        if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
      }
      mat.dispose();
    }
  });
  (car.userData.env as THREE.Texture | undefined)?.dispose();
}
