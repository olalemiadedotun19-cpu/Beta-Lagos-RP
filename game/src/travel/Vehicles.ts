import * as THREE from 'three';
import { GeoBatch, getGlowMaterial, getSolidMaterial, getUnitGeometries } from './Geo';
import { TransportMode } from './TransportModes';

type Tag = 'body' | 'glass' | 'wheel' | 'door' | 'interior' | 'glow' | 'frame';

interface Spec {
  shape: 'box' | 'cyl';
  /** box: w,h,d  |  cyl: radius,height,_ */
  size: [number, number, number];
  pos: [number, number, number];
  color: string;
  tag?: Tag;
  rot?: [number, number, number];
  /** Hidden when the camera sits inside the vehicle (interior view) */
  hideInside?: boolean;
}

export type VehicleKind = TransportMode | 'traffic_sedan' | 'traffic_danfo' | 'traffic_keke' | 'traffic_okada' | 'traffic_suv';

interface Blueprint {
  specs: Spec[];
  width: number;
  length: number;
  wheelRadius: number;
  wheels: [number, number, number][];
  door?: { pivot: [number, number, number]; openAngle: number };
  /** Outside point where the passenger stands to board / alight (vehicle local) */
  standPoint: [number, number];
  /** Where the passenger vanishes to (vehicle local) */
  insidePoint: [number, number];
  /** Visible seated passenger (keke / okada) */
  seat?: { x: number; y: number; z: number };
}

const GLASS = '#1b2a3a';
const BLACK = '#15151a';
const TYRE = '#101012';
const HEAD = '#fff3b8';
const TAIL = '#ff2a2a';

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, tag: Tag = 'body', hideInside = false): Spec {
  return { shape: 'box', size: [w, h, d], pos: [x, y, z], color, tag, hideInside };
}

function sedan(color: string, opts: { taxi?: boolean; ride?: boolean; suv?: boolean } = {}): Blueprint {
  const suv = !!opts.suv;
  const bodyH = suv ? 0.8 : 0.55;
  const bodyY = suv ? 0.82 : 0.62;
  const cabH = suv ? 0.7 : 0.5;
  const cabY = suv ? 1.5 : 1.15;
  const len = suv ? 4.7 : 4.5;
  const wid = suv ? 1.95 : 1.8;
  const cabLen = suv ? 3.0 : 2.3;
  const cabZ = suv ? 0.55 : 0.25;
  const wr = suv ? 0.4 : 0.33;
  const specs: Spec[] = [
    box(wid, bodyH, len, 0, bodyY, 0, color),
    box(wid - 0.25, cabH, cabLen, 0, cabY, cabZ, color),
    box(wid + 0.02, 0.2, len + 0.02, 0, 0.3, 0, BLACK),
    box(0.02, cabH * 0.7, cabLen - 0.5, wid / 2 - 0.1, cabY + 0.02, cabZ, GLASS, 'glass', true),
    box(0.02, cabH * 0.7, cabLen - 0.5, -(wid / 2 - 0.1), cabY + 0.02, cabZ, GLASS, 'glass'),
    box(wid - 0.35, cabH * 0.7, 0.03, 0, cabY + 0.02, cabZ - cabLen / 2 - 0.01, GLASS, 'glass'),
    box(wid - 0.35, cabH * 0.7, 0.03, 0, cabY + 0.02, cabZ + cabLen / 2 + 0.01, GLASS, 'glass'),
    // lights
    box(0.35, 0.14, 0.05, 0.6, bodyY + 0.05, -len / 2 - 0.02, HEAD, 'glow'),
    box(0.35, 0.14, 0.05, -0.6, bodyY + 0.05, -len / 2 - 0.02, HEAD, 'glow'),
    box(0.35, 0.14, 0.05, 0.6, bodyY + 0.05, len / 2 + 0.02, TAIL, 'glow'),
    box(0.35, 0.14, 0.05, -0.6, bodyY + 0.05, len / 2 + 0.02, TAIL, 'glow'),
  ];
  if (opts.taxi) {
    specs.push(box(wid + 0.03, 0.07, len * 0.9, 0, bodyY + 0.12, 0, '#111111'));
    specs.push(box(0.55, 0.2, 0.28, 0, cabY + cabH / 2 + 0.12, cabZ, '#fffbe6', 'glow'));
  }
  if (opts.ride) {
    specs.push(box(0.3, 0.1, 0.18, 0, cabY + cabH / 2 + 0.06, cabZ, '#7c3aed', 'glow'));
  }
  // right side door (curb side)
  const doorLen = suv ? 1.2 : 1.05;
  const doorZ = cabZ + 0.1;
  specs.push(box(0.05, bodyH, doorLen, wid / 2 + 0.01, bodyY, doorZ, color, 'door'));
  specs.push(box(0.05, cabH * 0.7, doorLen - 0.1, wid / 2 - 0.08, cabY + 0.02, doorZ, GLASS, 'door'));
  const hingeZ = doorZ - doorLen / 2;
  const track = wid / 2 - 0.08;
  return {
    specs,
    width: wid,
    length: len,
    wheelRadius: wr,
    wheels: [
      [track, wr, -len * 0.31],
      [-track, wr, -len * 0.31],
      [track, wr, len * 0.31],
      [-track, wr, len * 0.31],
    ],
    door: { pivot: [wid / 2 + 0.01, bodyY, hingeZ], openAngle: 1.05 },
    standPoint: [wid / 2 + 1.1, doorZ + 0.2],
    insidePoint: [0.35, doorZ + 0.1],
  };
}

function danfo(): Blueprint {
  const Y = '#f2c200';
  const specs: Spec[] = [
    box(2.0, 1.0, 4.9, 0, 0.8, 0, Y),
    box(2.03, 0.2, 4.92, 0, 1.3, 0, BLACK),
    box(2.04, 0.08, 4.94, 0, 0.62, 0, BLACK),
    // upper cabin built from frames so the right side can open up in interior view
    box(0.06, 0.95, 4.5, -0.95, 1.78, 0.15, Y),
    box(1.95, 0.95, 0.06, 0, 1.78, -2.1, Y),
    box(1.95, 0.95, 0.06, 0, 1.78, 2.4, Y),
    box(1.95, 0.08, 4.56, 0, 2.28, 0.15, Y),
    box(0.02, 0.55, 3.7, -0.99, 1.85, 0.15, GLASS, 'glass'),
    box(0.02, 0.6, 3.7, 0.99, 1.85, 0.15, GLASS, 'glass', true),
    box(1.7, 0.7, 0.02, 0, 1.8, -2.14, GLASS, 'glass'),
    // frames on the right side (stay visible from inside)
    box(0.08, 0.95, 0.1, 0.96, 1.78, -1.9, Y, 'frame'),
    box(0.08, 0.95, 0.1, 0.96, 1.78, -0.7, Y, 'frame'),
    box(0.08, 0.95, 0.1, 0.96, 1.78, 0.5, Y, 'frame'),
    box(0.08, 0.95, 0.1, 0.96, 1.78, 1.7, Y, 'frame'),
    box(0.08, 0.95, 0.1, 0.96, 1.78, 2.35, Y, 'frame'),
    // lights & bumpers
    box(0.3, 0.2, 0.05, 0.7, 0.85, -2.47, HEAD, 'glow'),
    box(0.3, 0.2, 0.05, -0.7, 0.85, -2.47, HEAD, 'glow'),
    box(0.3, 0.2, 0.05, 0.7, 0.85, 2.47, TAIL, 'glow'),
    box(0.3, 0.2, 0.05, -0.7, 0.85, 2.47, TAIL, 'glow'),
    box(2.05, 0.18, 0.12, 0, 0.42, -2.5, '#222'),
    box(2.05, 0.18, 0.12, 0, 0.42, 2.5, '#222'),
    // door
    box(0.05, 1.55, 1.1, 1.02, 1.3, 0.9, Y, 'door'),
    box(0.05, 0.6, 0.9, 1.0, 1.75, 0.9, GLASS, 'door'),
    // interior (visible only from inside view)
    box(1.9, 0.06, 4.3, 0, 0.52, 0.1, '#3d3d44', 'interior'),
    box(1.6, 0.4, 0.5, 0, 0.85, -0.6, '#5a3b2e', 'interior'),
    box(1.6, 0.55, 0.1, 0, 1.25, -0.82, '#5a3b2e', 'interior'),
    box(1.6, 0.4, 0.5, 0, 0.85, 0.6, '#5a3b2e', 'interior'),
    box(1.6, 0.55, 0.1, 0, 1.25, 0.38, '#5a3b2e', 'interior'),
    box(1.6, 0.4, 0.5, 0, 0.85, 1.7, '#5a3b2e', 'interior'),
    box(1.6, 0.55, 0.1, 0, 1.25, 1.48, '#5a3b2e', 'interior'),
    box(0.04, 0.5, 0.04, -0.3, 2.0, -1.0, '#c9c9c9', 'interior'),
  ];
  return {
    specs,
    width: 2.04,
    length: 5.0,
    wheelRadius: 0.4,
    wheels: [
      [1.0, 0.4, -1.6],
      [-1.0, 0.4, -1.6],
      [1.0, 0.4, 1.6],
      [-1.0, 0.4, 1.6],
    ],
    door: { pivot: [1.02, 1.3, 0.35], openAngle: 1.3 },
    standPoint: [2.35, 0.9],
    insidePoint: [0.35, 0.9],
  };
}

function brt(): Blueprint {
  const BLUE = '#1d4ed8';
  const WHITE = '#e8eef7';
  const specs: Spec[] = [
    box(2.55, 1.0, 11.5, 0, 0.9, 0, BLUE),
    box(2.57, 0.12, 11.52, 0, 1.45, 0, '#facc15'),
    box(0.06, 1.5, 11.4, -1.25, 2.2, 0, WHITE),
    box(2.5, 1.5, 0.06, 0, 2.2, -5.7, BLUE),
    box(2.5, 1.5, 0.06, 0, 2.2, 5.7, BLUE),
    box(2.5, 0.1, 11.5, 0, 3.0, 0, WHITE),
    box(0.02, 1.0, 10.6, -1.29, 2.3, 0, GLASS, 'glass'),
    box(0.02, 1.1, 10.6, 1.29, 2.3, 0, GLASS, 'glass', true),
    box(2.2, 1.1, 0.02, 0, 2.3, -5.74, GLASS, 'glass'),
    // pillars on the right wall
    ...[-4.6, -2.3, 0, 2.3, 4.6].map((z) => box(0.1, 1.5, 0.14, 1.25, 2.2, z, WHITE, 'frame')),
    // lights
    box(0.4, 0.2, 0.05, 0.9, 0.9, -5.77, HEAD, 'glow'),
    box(0.4, 0.2, 0.05, -0.9, 0.9, -5.77, HEAD, 'glow'),
    box(0.4, 0.2, 0.05, 0.9, 0.9, 5.77, TAIL, 'glow'),
    box(0.4, 0.2, 0.05, -0.9, 0.9, 5.77, TAIL, 'glow'),
    box(0.9, 0.22, 0.04, 0, 3.02, -5.74, '#ffb020', 'glow'),
    // door (front doorway)
    box(0.05, 2.0, 1.3, 1.29, 1.7, -2.2, '#cbd5e1', 'door'),
    // interior
    box(2.3, 0.06, 11.0, 0, 0.5, 0, '#4b5563', 'interior'),
    ...[-3.5, -1.5, 0.5, 2.5, 4.5].map((z) => box(0.5, 0.4, 1.5, -0.95, 0.85, z, '#2563eb', 'interior')),
    ...[-3.5, -1.5, 0.5, 2.5, 4.5].map((z) => box(0.12, 0.5, 1.5, -1.15, 1.25, z, '#2563eb', 'interior')),
    ...[-3.0, -0.5, 2.0].map((z) => ({
      shape: 'cyl' as const,
      size: [0.03, 1.9, 0] as [number, number, number],
      pos: [0.2, 1.5, z] as [number, number, number],
      color: '#d1d5db',
      tag: 'interior' as Tag,
    })),
  ];
  return {
    specs,
    width: 2.55,
    length: 11.6,
    wheelRadius: 0.5,
    wheels: [
      [1.2, 0.5, -3.8],
      [-1.2, 0.5, -3.8],
      [1.2, 0.5, 3.4],
      [-1.2, 0.5, 3.4],
      [1.2, 0.5, 4.3],
      [-1.2, 0.5, 4.3],
    ],
    door: { pivot: [1.29, 1.7, -2.85], openAngle: 1.45 },
    standPoint: [3.0, -2.1],
    insidePoint: [0.4, -2.2],
  };
}

function keke(): Blueprint {
  const YEL = '#f4c20d';
  const GRN = '#15803d';
  const specs: Spec[] = [
    box(1.35, 0.55, 1.7, 0, 0.62, 0.3, YEL),
    box(0.8, 0.6, 0.55, 0, 0.62, -0.85, YEL),
    box(1.6, 0.08, 2.1, 0, 1.78, 0.2, GRN),
    box(1.6, 0.04, 0.5, 0, 1.2, 1.05, GRN),
    box(0.06, 1.0, 0.06, 0.7, 1.28, -0.7, '#2a2a2a'),
    box(0.06, 1.0, 0.06, -0.7, 1.28, -0.7, '#2a2a2a'),
    box(0.06, 1.0, 0.06, 0.7, 1.28, 1.15, '#2a2a2a'),
    box(0.06, 1.0, 0.06, -0.7, 1.28, 1.15, '#2a2a2a'),
    box(1.3, 0.55, 0.03, 0, 1.4, -0.72, GLASS, 'glass'),
    // bench + driver
    box(1.1, 0.2, 0.55, 0, 0.9, 0.7, '#3a2a22'),
    box(1.1, 0.4, 0.1, 0, 1.15, 1.0, '#3a2a22'),
    box(0.4, 0.5, 0.3, 0, 1.15, -0.2, '#ea580c'),
    { shape: 'cyl', size: [0.14, 0.2, 0], pos: [0, 1.5, -0.2], color: '#8d5a3b', tag: 'body' },
    box(0.6, 0.05, 0.05, 0, 1.05, -0.55, '#222'),
    box(0.25, 0.14, 0.05, 0, 0.78, -1.14, HEAD, 'glow'),
    box(0.15, 0.1, 0.05, 0.5, 0.75, 1.16, TAIL, 'glow'),
    box(0.15, 0.1, 0.05, -0.5, 0.75, 1.16, TAIL, 'glow'),
  ];
  return {
    specs,
    width: 1.5,
    length: 2.9,
    wheelRadius: 0.28,
    wheels: [
      [0.7, 0.28, 0.95],
      [-0.7, 0.28, 0.95],
      [0, 0.27, -1.2],
    ],
    standPoint: [1.7, 0.7],
    insidePoint: [0, 0.7],
    seat: { x: 0, y: 0.13, z: 0.7 },
  };
}

function okada(): Blueprint {
  const specs: Spec[] = [
    box(0.26, 0.26, 0.55, 0, 0.84, -0.2, '#b91c1c'),
    box(0.3, 0.1, 0.8, 0, 0.82, 0.38, '#111111'),
    box(0.3, 0.32, 0.45, 0, 0.5, 0.0, '#4b5563'),
    box(0.1, 0.1, 0.9, 0.16, 0.38, 0.35, '#9ca3af'),
    { shape: 'cyl', size: [0.03, 0.75, 0], pos: [0, 0.66, -0.62], color: '#9ca3af', tag: 'body', rot: [-0.3, 0, 0] },
    box(0.72, 0.04, 0.04, 0, 1.03, -0.7, '#111'),
    box(0.22, 0.16, 0.05, 0, 0.93, -0.82, HEAD, 'glow'),
    box(0.16, 0.08, 0.04, 0, 0.88, 1.05, TAIL, 'glow'),
    box(0.4, 0.04, 0.4, 0, 0.95, 0.95, '#6b7280'),
    // the rider (driver)
    box(0.38, 0.55, 0.26, 0, 1.28, -0.05, '#ea580c'),
    { shape: 'cyl', size: [0.14, 0.22, 0], pos: [0, 1.7, -0.08], color: '#8d5a3b', tag: 'body' },
    box(0.3, 0.14, 0.3, 0, 1.82, -0.08, '#1f2937'),
  ];
  return {
    specs,
    width: 0.8,
    length: 2.0,
    wheelRadius: 0.33,
    wheels: [
      [0, 0.33, -0.7],
      [0, 0.33, 0.78],
    ],
    standPoint: [1.2, 0.55],
    insidePoint: [0, 0.55],
    seat: { x: 0, y: -0.02, z: 0.55 },
  };
}

function blueprintFor(kind: VehicleKind, color?: string): Blueprint {
  switch (kind) {
    case 'danfo':
    case 'traffic_danfo':
      return danfo();
    case 'brt':
      return brt();
    case 'keke':
    case 'traffic_keke':
      return keke();
    case 'okada':
    case 'traffic_okada':
      return okada();
    case 'taxi':
      return sedan('#f5c518', { taxi: true });
    case 'ride':
      return sedan(color || '#e5e7eb', { ride: true });
    case 'private':
      return sedan(color || '#4b5563');
    case 'traffic_suv':
      return sedan(color || '#374151', { suv: true });
    case 'traffic_sedan':
    default:
      return sedan(color || '#9ca3af');
  }
}

// ---------------------------------------------------------------------------------------------
// Detailed rig: used for the player's own vehicle (door, wheel spin, interior view)
// ---------------------------------------------------------------------------------------------

export interface VehicleRig {
  group: THREE.Group;
  kind: VehicleKind;
  width: number;
  length: number;
  hasDoor: boolean;
  seat?: { x: number; y: number; z: number };
  standPoint: THREE.Vector2;
  insidePoint: THREE.Vector2;
  /** 0 = closed, 1 = fully open */
  setDoorOpen(amount: number): void;
  spinWheels(distance: number): void;
  setInteriorView(on: boolean): void;
  dispose(): void;
}

const matCache = new Map<string, THREE.Material>();
function partMaterial(color: string, tag: Tag | undefined): THREE.Material {
  const key = `${tag === 'glow' ? 'g' : tag === 'glass' ? 'x' : 's'}:${color}`;
  let m = matCache.get(key);
  if (!m) {
    if (tag === 'glow') {
      m = new THREE.MeshBasicMaterial({ color });
    } else if (tag === 'glass') {
      m = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.82 });
    } else {
      m = new THREE.MeshLambertMaterial({ color });
    }
    matCache.set(key, m);
  }
  return m;
}

export function disposeVehicleMaterials(): void {
  matCache.forEach((m) => m.dispose());
  matCache.clear();
}

function makeMesh(spec: Spec, offset: [number, number, number] = [0, 0, 0]): THREE.Mesh {
  const { box: ub, cyl: uc } = getUnitGeometries();
  const mesh = new THREE.Mesh(spec.shape === 'box' ? ub : uc, partMaterial(spec.color, spec.tag));
  if (spec.shape === 'box') {
    mesh.scale.set(spec.size[0], spec.size[1], spec.size[2]);
  } else {
    mesh.scale.set(spec.size[0], spec.size[1], spec.size[0]);
  }
  mesh.position.set(spec.pos[0] - offset[0], spec.pos[1] - offset[1], spec.pos[2] - offset[2]);
  if (spec.rot) mesh.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
  if (spec.tag !== 'glow' && spec.tag !== 'glass') mesh.castShadow = true;
  return mesh;
}

export function createVehicleRig(kind: VehicleKind, color?: string): VehicleRig {
  const bp = blueprintFor(kind, color);
  const group = new THREE.Group();
  group.name = `vehicle_${kind}`;

  const hideInside: THREE.Object3D[] = [];
  const interior = new THREE.Group();
  interior.visible = false;
  group.add(interior);

  let doorPivot: THREE.Group | null = null;
  if (bp.door) {
    doorPivot = new THREE.Group();
    doorPivot.position.set(...bp.door.pivot);
    group.add(doorPivot);
  }

  for (const spec of bp.specs) {
    if (spec.tag === 'door' && doorPivot) {
      doorPivot.add(makeMesh(spec, bp.door!.pivot));
      continue;
    }
    const mesh = makeMesh(spec);
    if (spec.tag === 'interior') {
      interior.add(mesh);
    } else {
      group.add(mesh);
      if (spec.hideInside) hideInside.push(mesh);
    }
  }
  if (doorPivot) hideInside.push(doorPivot);

  const wheelGroups: THREE.Group[] = [];
  const { cyl } = getUnitGeometries();
  const wheelMat = partMaterial(TYRE, 'body');
  for (const w of bp.wheels) {
    const wg = new THREE.Group();
    wg.position.set(w[0], w[1], w[2]);
    const tyre = new THREE.Mesh(cyl, wheelMat);
    const width = kind === 'okada' ? 0.12 : bp.wheelRadius > 0.45 ? 0.32 : 0.24;
    tyre.scale.set(bp.wheelRadius, width, bp.wheelRadius);
    tyre.rotation.z = Math.PI / 2;
    tyre.castShadow = true;
    wg.add(tyre);
    // hub to make the spin readable
    const hub = new THREE.Mesh(getUnitGeometries().box, partMaterial('#9ca3af', 'body'));
    hub.scale.set(width + 0.02, bp.wheelRadius * 0.9, 0.06);
    wg.add(hub);
    group.add(wg);
    wheelGroups.push(wg);
  }

  const rig: VehicleRig = {
    group,
    kind,
    width: bp.width,
    length: bp.length,
    hasDoor: !!bp.door,
    seat: bp.seat,
    standPoint: new THREE.Vector2(bp.standPoint[0], bp.standPoint[1]),
    insidePoint: new THREE.Vector2(bp.insidePoint[0], bp.insidePoint[1]),
    setDoorOpen(amount: number) {
      if (doorPivot && bp.door) doorPivot.rotation.y = bp.door.openAngle * amount;
    },
    spinWheels(distance: number) {
      const ang = distance / bp.wheelRadius;
      for (const wg of wheelGroups) wg.rotation.x = -ang;
    },
    setInteriorView(on: boolean) {
      interior.visible = on;
      for (const o of hideInside) o.visible = !on;
    },
    dispose() {
      /* geometries are shared units, materials cached globally */
    },
  };
  return rig;
}

// ---------------------------------------------------------------------------------------------
// Cheap merged vehicles for ambient traffic
// ---------------------------------------------------------------------------------------------

export interface TrafficVehicle {
  group: THREE.Group;
  length: number;
  dispose(): void;
}

export function createTrafficVehicle(kind: VehicleKind, color?: string): TrafficVehicle {
  const bp = blueprintFor(kind, color);
  const solid = new GeoBatch();
  const glow = new GeoBatch();

  for (const s of bp.specs) {
    if (s.tag === 'interior') continue;
    const target = s.tag === 'glow' ? glow : solid;
    if (s.shape === 'box') {
      target.box(s.size[0], s.size[1], s.size[2], s.pos[0], s.pos[1], s.pos[2], s.color, {
        rotX: s.rot?.[0],
        rotY: s.rot?.[1],
        rotZ: s.rot?.[2],
      });
    } else {
      target.cyl(s.size[0], s.size[1], s.pos[0], s.pos[1], s.pos[2], s.color, {
        rotX: s.rot?.[0],
        rotY: s.rot?.[1],
        rotZ: s.rot?.[2],
      });
    }
  }
  for (const w of bp.wheels) {
    solid.cyl(bp.wheelRadius, kind === 'traffic_okada' ? 0.12 : 0.24, w[0], w[1], w[2], TYRE, { rotZ: Math.PI / 2 });
  }

  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const sg = solid.build();
  if (sg) {
    geos.push(sg);
    group.add(new THREE.Mesh(sg, getSolidMaterial()));
  }
  const gg = glow.build();
  if (gg) {
    geos.push(gg);
    group.add(new THREE.Mesh(gg, getGlowMaterial()));
  }
  return {
    group,
    length: bp.length,
    dispose() {
      geos.forEach((g) => g.dispose());
    },
  };
}


/**
 * Emits a (static) vehicle into existing GeoBatches (parked cars baked into a chunk).
 * `rotY` rotates the vehicle about its own origin; headlights/tail lights go to the glow batch.
 */
export function emitVehicle(solid: GeoBatch, glow: GeoBatch, kind: VehicleKind, color: string | undefined, x: number, z: number, rotY: number, brakeLights = false): void {
  const bp = blueprintFor(kind, color);
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  for (const sp of bp.specs) {
    if (sp.tag === 'interior') continue;
    const [lx, ly, lz] = sp.pos;
    const wx = x + lx * c + lz * s;
    const wz = z - lx * s + lz * c;
    const target = sp.tag === 'glow' ? glow : solid;
    const col = sp.tag === 'glow' && !brakeLights && sp.color === TAIL ? '#7a1010' : sp.color;
    if (sp.shape === 'box') {
      target.box(sp.size[0], sp.size[1], sp.size[2], wx, ly, wz, col, { rotY, rotX: sp.rot?.[0], rotZ: sp.rot?.[2] });
    } else {
      target.cyl(sp.size[0], sp.size[1], wx, ly, wz, col, { rotY, rotX: sp.rot?.[0], rotZ: sp.rot?.[2] });
    }
  }
  for (const w of bp.wheels) {
    const wx = x + w[0] * c + w[2] * s;
    const wz = z - w[0] * s + w[2] * c;
    solid.cyl(bp.wheelRadius, 0.24, wx, w[1], wz, TYRE, { rotY, rotZ: Math.PI / 2 });
  }
}

/** Very cheap far-distance version of a vehicle (body + cabin boxes only) */
export function createLowVehicle(kind: VehicleKind, color?: string): TrafficVehicle {
  const bp = blueprintFor(kind, color);
  const solid = new GeoBatch();
  // keep the 2-3 biggest body specs
  const bodies = bp.specs.filter((sp) => sp.shape === 'box' && (sp.tag === undefined || sp.tag === 'body')).sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2]).slice(0, 3);
  for (const sp of bodies) solid.box(sp.size[0], sp.size[1], sp.size[2], sp.pos[0], sp.pos[1], sp.pos[2], sp.color);
  const group = new THREE.Group();
  const g = solid.build();
  if (g) group.add(new THREE.Mesh(g, getSolidMaterial()));
  return { group, length: bp.length, dispose: () => g?.dispose() };
}
