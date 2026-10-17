import * as THREE from 'three';
import { DistrictData, PropData } from '../types/game';
import { BoundingBox2D } from '../world/SpatialGrid';
import { GeoBatch, hashString, makeRng } from '../travel/Geo';

/**
 * StreetFurniture - instanced, low-cost street props for the district:
 *   Streetlight_A / Streetlight_B   (InstancedMesh, deterministic variant + slight scale/rotation jitter)
 *   UtilityPole_A / UtilityPole_B   (InstancedMesh) joined by sagging overhead cables (one LineSegments)
 *   bus stops, roadside kiosks, guard rails (merged static meshes)
 *
 * Lighting: NO point light per pole. A tiny pool of real PointLights follows the player to the nearest
 * poles; every other pole gets a cheap fake (glowing head + additive ground pool, instanced).
 */

export interface FurnitureHandle {
  group: THREE.Group;
  lights: THREE.PointLight[];
  colliders: BoundingBox2D[];
  /** 0 = day, 1 = full night: drives lamp heads + fake ground glow */
  setNight(n: number): void;
  /** moves the pooled real lights to the poles nearest the player */
  update(px: number, pz: number): void;
}

interface Placement {
  x: number;
  z: number;
  rotY: number;
  scale: number;
  variant: number;
  /** local lamp-head offset (for the glow + pooled light) */
  headX: number;
  headZ: number;
  headY: number;
}

const POOL_LIGHTS = 3;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

function setInstance(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number): void {
  _e.set(0, rotY, 0);
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  mesh.setMatrixAt(i, _m);
}

// ---------------------------------------------------------------------------------------------
// Variant geometries (local space: pole at origin, arm towards +Z)
// ---------------------------------------------------------------------------------------------

export function streetlightBody(variant: number): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry; headZ: number; headY: number } {
  const b = new GeoBatch();
  const g = new GeoBatch();
  if (variant === 0) {
    // A: classic single-arm 6.5m
    b.cyl(0.22, 0.3, 0, 0.15, 0, '#6b7078');
    b.cyl(0.1, 6.5, 0, 3.25, 0, '#4a4f57');
    b.box(0.09, 0.09, 1.9, 0, 6.42, 0.9, '#4a4f57');
    b.box(0.5, 0.13, 0.95, 0, 6.38, 1.75, '#3b3f45');
    g.box(0.38, 0.05, 0.75, 0, 6.3, 1.75, '#ffffff');
    return { body: b.build()!, glow: g.build()!, headZ: 1.75, headY: 6.2 };
  }
  // B: taller 8.5m with a second, shorter pedestrian head on the opposite side
  b.cyl(0.26, 0.34, 0, 0.17, 0, '#6b7078');
  b.cyl(0.12, 8.5, 0, 4.25, 0, '#555a62');
  b.box(0.11, 0.11, 2.5, 0, 8.4, 1.2, '#555a62');
  b.box(0.55, 0.14, 1.05, 0, 8.35, 2.3, '#34383e');
  b.box(0.08, 0.08, 1.0, 0, 5.2, -0.5, '#555a62');
  b.sphere(0.24, 0.17, 0.24, 0, 5.12, -1.0, '#34383e');
  g.box(0.42, 0.05, 0.85, 0, 8.26, 2.3, '#ffffff');
  g.sphere(0.2, 0.12, 0.2, 0, 5.04, -1.0, '#ffffff');
  return { body: b.build()!, glow: g.build()!, headZ: 2.3, headY: 8.1 };
}

export function poleBody(variant: number): THREE.BufferGeometry {
  const b = new GeoBatch();
  if (variant === 0) {
    // A: concrete pole, double crossarm
    b.cyl(0.17, 9.2, 0, 4.6, 0, '#9a9a94');
    b.cyl(0.12, 0.4, 0, 9.2, 0, '#8d8d88');
    b.box(2.3, 0.12, 0.12, 0, 8.6, 0, '#5b4a37');
    b.box(1.7, 0.12, 0.12, 0, 7.85, 0, '#5b4a37');
    for (const x of [-0.95, 0, 0.95]) b.cyl(0.045, 0.18, x, 8.72, 0, '#d9d4c7');
    for (const x of [-0.7, 0.7]) b.cyl(0.045, 0.18, x, 7.97, 0, '#d9d4c7');
    b.box(0.35, 0.35, 0.18, 0.4, 5.2, 0.2, '#6e7479'); // service box
  } else {
    // B: wooden pole with a pole-mounted transformer
    b.cyl(0.14, 8.4, 0, 4.2, 0, '#6c5a46');
    b.box(2.0, 0.11, 0.11, 0, 8.0, 0, '#4f4030');
    for (const x of [-0.85, 0, 0.85]) b.cyl(0.04, 0.16, x, 8.12, 0, '#cfc9bb');
    b.cyl(0.38, 0.95, 0.5, 6.7, 0, '#59616a');
    b.cyl(0.08, 0.2, 0.5, 7.25, 0.0, '#3a3f45');
    b.box(0.2, 0.5, 0.14, -0.35, 6.3, 0.15, '#7b838b');
  }
  return b.build()!;
}

// ---------------------------------------------------------------------------------------------

export class StreetFurniture {
  public static build(data: DistrictData, lampProps: PropData[]): FurnitureHandle {
    const group = new THREE.Group();
    group.name = 'street_furniture';
    const colliders: BoundingBox2D[] = [];
    const disposables: { dispose(): void }[] = [];
    void disposables;

    // ---------------- streetlights ----------------
    const lamps: Placement[] = [];
    for (const p of lampProps) {
      const h = hashString(p.id);
      const rng = makeRng(h);
      const variant = h % 3 === 0 ? 1 : 0;
      const scale = 0.97 + rng() * 0.08;
      const spec = streetlightBody(variant);
      lamps.push({
        x: p.position.x,
        z: p.position.z,
        rotY: p.rotationY + (rng() - 0.5) * 0.06,
        scale,
        variant,
        headX: 0,
        headZ: spec.headZ,
        headY: spec.headY,
      });
    }

    const lampMats = {
      body: new THREE.MeshLambertMaterial({ vertexColors: true }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x9aa0a8 }),
    };
    const glowMeshes: THREE.InstancedMesh[] = [];
    for (const variant of [0, 1]) {
      const these = lamps.filter((l) => l.variant === variant);
      if (these.length === 0) continue;
      const spec = streetlightBody(variant);
      const body = new THREE.InstancedMesh(spec.body, lampMats.body, these.length);
      const glow = new THREE.InstancedMesh(spec.glow, lampMats.glow, these.length);
      body.castShadow = true;
      body.name = `Streetlight_${variant === 0 ? 'A' : 'B'}`;
      glow.name = `Streetlight_${variant === 0 ? 'A' : 'B'}_glow`;
      these.forEach((l, i) => {
        setInstance(body, i, l.x, 0, l.z, l.rotY, 1, l.scale, 1);
        setInstance(glow, i, l.x, 0, l.z, l.rotY, 1, l.scale, 1);
      });
      body.instanceMatrix.needsUpdate = true;
      glow.instanceMatrix.needsUpdate = true;
      group.add(body, glow);
      glowMeshes.push(glow);
    }

    // fake ground illumination pools (additive, instanced)
    const poolGeo = new THREE.CircleGeometry(1, 20);
    poolGeo.rotateX(-Math.PI / 2);
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 128;
    const gctx = glowCanvas.getContext('2d')!;
    const grad = gctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 128, 128);
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const poolMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      color: 0xffc977,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, Math.max(1, lamps.length));
    pools.name = 'lamp_ground_glow';
    lamps.forEach((l, i) => {
      const hx = l.x + Math.sin(l.rotY) * l.headZ;
      const hz = l.z + Math.cos(l.rotY) * l.headZ;
      setInstance(pools, i, hx, 0.045, hz, 0, 7.5 * l.scale, 1, 7.5 * l.scale);
    });
    pools.instanceMatrix.needsUpdate = true;
    pools.frustumCulled = false;
    group.add(pools);

    // pooled real lights
    const lights: THREE.PointLight[] = [];
    for (let i = 0; i < POOL_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffdf80, 0, 22, 1.7);
      l.castShadow = false;
      group.add(l);
      lights.push(l);
    }
    const headWorld = lamps.map((l) => new THREE.Vector3(l.x + Math.sin(l.rotY) * l.headZ, l.headY * l.scale - 0.2, l.z + Math.cos(l.rotY) * l.headZ));

    // ---------------- utility poles + overhead cables ----------------
    const poleGroupInfo = this.buildPoles(data, group, colliders);

    // ---------------- bus stops, kiosks, guard rails ----------------
    this.buildStatics(data, group, colliders);

    // ---------------- handle ----------------
    const glowColorDay = new THREE.Color(0x8c929a);
    const glowColorNight = new THREE.Color(0xfff0c0);
    let nightLevel = 0;
    const order: number[] = headWorld.map((_, i) => i);
    let sortX = 1e9;
    let sortZ = 1e9;
    void poleGroupInfo;

    return {
      group,
      lights,
      colliders,
      setNight(n: number) {
        nightLevel = n;
        for (const g of glowMeshes) (g.material as THREE.MeshBasicMaterial).color.copy(glowColorDay).lerp(glowColorNight, n);
        poolMat.opacity = 0.55 * n;
        poolMat.visible = n > 0.02;
      },
      update(px: number, pz: number) {
        if (nightLevel < 0.02 || headWorld.length === 0) return;
        // the nearest lamps only change when the player has walked / driven a few metres: no need to sort every lamp every frame
        if (Math.abs(px - sortX) + Math.abs(pz - sortZ) < 3) return;
        sortX = px;
        sortZ = pz;
        order.sort((a, b) => headWorld[a].distanceToSquared(_p.set(px, headWorld[a].y, pz)) - headWorld[b].distanceToSquared(_p.set(px, headWorld[b].y, pz)));
        for (let i = 0; i < lights.length; i++) {
          const h = headWorld[order[i]];
          if (h) lights[i].position.copy(h);
        }
      },
    };
  }

  // -------------------------------------------------------------------------------------------

  private static buildPoles(data: DistrictData, group: THREE.Group, colliders: BoundingBox2D[]): void {
    interface Pole { x: number; z: number; rotY: number; variant: number }
    const SW = 2.4;
    const poles: Pole[] = [];
    const wires: number[] = [];

    for (const road of data.roads) {
      const horiz = Math.abs(road.end.z - road.start.z) < 1e-6;
      const lo = Math.max(-100, horiz ? Math.min(road.start.x, road.end.x) : Math.min(road.start.z, road.end.z));
      const hi = Math.min(100, horiz ? Math.max(road.start.x, road.end.x) : Math.max(road.start.z, road.end.z));
      const c = horiz ? road.start.z : road.start.x;
      if (Math.abs(c) > 100) continue; // far roads are handled by the streamed cells
      const hw = road.width / 2;
      const rng = makeRng(hashString(road.id) ^ 0xb01e);
      // one side per road: main roads on the 'far' side from the streetlights, others alternate
      const side = rng() > 0.5 ? 1 : -1;
      const perp = side * (hw + SW + 1.5);

      // crossing roads -> keep poles >= 9m from their edge
      const crossings = data.roads
        .filter((o) => (Math.abs(o.end.z - o.start.z) < 1e-6) !== horiz)
        .map((o) => ({ c: horiz ? o.start.x : o.start.z, hw: o.width / 2 }));

      const placed: Pole[] = [];
      let a = lo + 14 + rng() * 10;
      while (a < hi - 12) {
        const ok = crossings.every((o) => Math.abs(a - o.c) > o.hw + 9);
        if (ok) {
          const x = horiz ? a : c + perp;
          const z = horiz ? c + perp : a;
          const blocked = data.buildings.some(
            (b) => Math.abs(x - b.position.x) < b.size.width / 2 + 1.2 && Math.abs(z - b.position.z) < b.size.depth / 2 + 1.2
          ) || data.props.some((p) => p.type !== 'bench' && Math.hypot(p.position.x - x, p.position.z - z) < 3.2);
          if (!blocked) {
            const pole: Pole = { x, z, rotY: horiz ? Math.PI / 2 : 0, variant: rng() > 0.55 ? 1 : 0 };
            placed.push(pole);
            colliders.push({ id: `pole_${poles.length + placed.length}`, minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25, userData: { type: 'prop', id: 'utility_pole' } });
          }
        }
        a += 30 + rng() * 14;
      }

      // cables between consecutive poles on this road/side
      for (let i = 0; i < placed.length - 1; i++) {
        const p0 = placed[i];
        const p1 = placed[i + 1];
        const span = Math.hypot(p1.x - p0.x, p1.z - p0.z);
        if (span > 60) continue;
        for (const off of [-0.95, 0, 0.95]) {
          const ox = horiz ? 0 : off;
          const oz = horiz ? off : 0;
          const segs = 7;
          let prev: THREE.Vector3 | null = null;
          for (let s = 0; s <= segs; s++) {
            const t = s / segs;
            const sag = Math.sin(t * Math.PI) * (0.35 + span * 0.012);
            const pnt = new THREE.Vector3(
              p0.x + (p1.x - p0.x) * t + ox,
              8.6 - sag,
              p0.z + (p1.z - p0.z) * t + oz
            );
            if (prev) wires.push(prev.x, prev.y, prev.z, pnt.x, pnt.y, pnt.z);
            prev = pnt;
          }
        }
      }
      poles.push(...placed);
    }

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const variant of [0, 1]) {
      const these = poles.filter((p) => p.variant === variant);
      if (these.length === 0) continue;
      const mesh = new THREE.InstancedMesh(poleBody(variant), mat, these.length);
      mesh.name = `UtilityPole_${variant === 0 ? 'A' : 'B'}`;
      mesh.castShadow = true;
      const rng = makeRng(variant + 99);
      these.forEach((p, i) => setInstance(mesh, i, p.x, 0, p.z, p.rotY + (rng() - 0.5) * 0.08, 1, 0.96 + rng() * 0.1, 1));
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }
    if (wires.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wires), 3));
      const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1b1b1d }));
      lines.name = 'overhead_cables';
      group.add(lines);
    }
  }

  // -------------------------------------------------------------------------------------------

  private static buildStatics(data: DistrictData, group: THREE.Group, colliders: BoundingBox2D[]): void {
    const solid = new GeoBatch();
    const glow = new GeoBatch();
    const SW = 2.4;

    // --- bus stop shelter at (x,z) facing the road (rotY: local +Z towards the road) ---
    const busStop = (x: number, z: number, rotY: number) => {
      const cs = Math.cos(rotY);
      const sn = Math.sin(rotY);
      // local -> world helper (local x right, z toward road)
      const W = (lx: number, lz: number): [number, number] => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
      const box = (w: number, h: number, d: number, lx: number, y: number, lz: number, col: string) => {
        const [wx, wz] = W(lx, lz);
        solid.box(w, h, d, wx, y, wz, col, { rotY });
      };
      box(3.6, 0.1, 1.7, 0, 2.55, 0, '#2d6a4f'); // roof
      box(0.1, 2.5, 0.1, -1.7, 1.25, 0.7, '#4a4f57');
      box(0.1, 2.5, 0.1, 1.7, 1.25, 0.7, '#4a4f57');
      box(3.5, 1.9, 0.07, 0, 1.45, -0.78, '#8fbfd6'); // back glass
      box(3.5, 0.5, 0.09, 0, 2.2, -0.8, '#2d6a4f');
      box(2.4, 0.07, 0.5, 0, 0.5, -0.4, '#6b4a2f'); // bench
      box(0.08, 0.5, 0.4, -1.1, 0.25, -0.4, '#333');
      box(0.08, 0.5, 0.4, 1.1, 0.25, -0.4, '#333');
      box(0.08, 3.0, 0.08, 2.4, 1.5, 0.9, '#4a4f57'); // sign pole
      box(0.55, 0.55, 0.05, 2.4, 3.0, 0.9, '#1d4ed8');
      const [gx, gz] = W(0, -0.74);
      glow.box(1.1, 1.4, 0.04, gx - 0.0, 1.45, gz, '#bfe3ff', { rotY }); // lit advert panel
      box(0.35, 0.7, 0.35, -2.2, 0.35, 0.3, '#3b5e3a'); // bin
      colliders.push({ id: `busstop_${x}_${z}`, minX: x - 1.8, maxX: x + 1.8, minZ: z - 0.9, maxZ: z + 0.9, userData: { type: 'prop', id: 'bus_stop' } });
    };

    // Allen Avenue pavements (x = +-(7 + ~1.5))
    busStop(8.4, 21, -Math.PI / 2);
    busStop(-8.4, -21, Math.PI / 2);

    // --- roadside kiosks on the verge beyond the drain ---
    const kiosk = (x: number, z: number, rotY: number, awning: string, sign: string) => {
      const cs = Math.cos(rotY);
      const sn = Math.sin(rotY);
      const W = (lx: number, lz: number): [number, number] => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
      const box = (w: number, h: number, d: number, lx: number, y: number, lz: number, col: string, tilt = 0) => {
        const [wx, wz] = W(lx, lz);
        solid.box(w, h, d, wx, y, wz, col, { rotY, rotX: tilt });
      };
      box(2.2, 2.2, 1.9, 0, 1.1, 0, '#d9d2c1');
      box(2.3, 0.1, 2.0, 0, 2.25, 0, '#6b7280');
      box(2.4, 0.08, 1.0, 0, 2.0, 1.35, awning, 0.3);
      box(2.2, 0.55, 0.08, 0, 2.55, 0.97, sign);
      box(1.2, 0.9, 0.06, -0.3, 1.2, 0.97, '#2b2f36'); // serving window
      box(1.4, 0.07, 0.4, -0.3, 0.9, 1.15, '#8a6a46'); // counter
      box(0.35, 0.3, 0.35, 1.5, 0.15, 1.1, '#2563eb'); // stool
      box(0.35, 0.3, 0.35, 1.9, 0.15, 1.4, '#dc2626');
      colliders.push({ id: `kiosk_${x}_${z}`, minX: x - 1.4, maxX: x + 1.4, minZ: z - 1.4, maxZ: z + 1.4, userData: { type: 'prop', id: 'kiosk' } });
    };
    kiosk(-40, -11.8, 0, '#e11d48', '#f59e0b');
    kiosk(35.5, 11.8, Math.PI, '#0ea5e9', '#16a34a');
    kiosk(-11.8, -40, Math.PI / 2, '#f59e0b', '#7c3aed');

    // --- guard rails along the verge of Allen Avenue (north) ---
    const rail = (x: number, z0: number, z1: number) => {
      for (let z = z0; z <= z1; z += 3) solid.box(0.12, 0.8, 0.12, x, 0.4, z, '#6b7280');
      solid.box(0.06, 0.18, z1 - z0, x, 0.62, (z0 + z1) / 2, '#d8d8d2');
      solid.box(0.06, 0.18, z1 - z0, x, 0.32, (z0 + z1) / 2, '#d8d8d2');
    };
    rail(-(7 + SW + 0.2), -82, -70);
    rail(7 + SW + 0.2, -82, -70);
    void data;

    const sg = solid.build();
    if (sg) {
      const m = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.castShadow = true;
      m.name = 'street_statics';
      group.add(m);
    }
    const gg = glow.build();
    if (gg) group.add(new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ vertexColors: true })));
  }
}
