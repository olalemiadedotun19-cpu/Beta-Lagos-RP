import * as THREE from 'three';
import { SpatialGrid, BoundingBox2D } from '../SpatialGrid';
import { createBarracks } from './BarracksScene';
import { getPreloadedBarracks } from './BarracksPreload';
import { CONCRETE_TILE, getConcreteMaterial, getJointMaterial } from '../../procedural/ConcreteTextures';
import { BX, BZ, PLAT_Y, BR_Z0, BR_RAMP, BR_HW, BR_Z1, ISL_HX, ISL_Z0, ISL_Z1, deckHeightAt } from './BarracksLayout';

/**
 * The barracks island: sea wall + causeway bridge (built up front, cheap) and the cantonment itself (built the first time the
 * player gets within SHOW_RADIUS, hidden again when far away).
 */
type P3 = [number, number, number];
type C3 = [number, number, number];
/** tiny polygon batcher (same idea as the city's road builder): flat-shaded convex polys, winding fixed to face `toward` */
class PolyBuf {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = [];
  poly(pts: P3[], c: C3, uvs: (p: P3) => [number, number], toward?: P3): void {
    const A = pts[0];
    let n: P3 = [0, 0, 0];
    for (let k = 1; k < pts.length - 1 && !n[0] && !n[1] && !n[2]; k++) {
      const B = pts[k], C = pts[k + 1];
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx * cx + cy * cy + cz * cz > 1e-10) n = [cx, cy, cz];
    }
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-8) return;
    n = [n[0] / l, n[1] / l, n[2] / l];
    const h = toward ?? [A[0], A[1] + 1, A[2]];
    const flip = n[0] * (h[0] - A[0]) + n[1] * (h[1] - A[1]) + n[2] * (h[2] - A[2]) < 0;
    if (flip) n = [-n[0], -n[1], -n[2]];
    const base = this.pos.length / 3;
    for (const q of pts) {
      const [u, v] = uvs(q);
      this.pos.push(q[0], q[1], q[2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(u, v); this.col.push(c[0], c[1], c[2]);
    }
    for (let k = 1; k < pts.length - 1; k++) {
      if (flip) this.idx.push(base, base + k + 1, base + k); else this.idx.push(base, base + k, base + k + 1);
    }
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

const SHOW_RADIUS = 900;
const SEA_BED = -18;

export class BarracksIsland {
  public group = new THREE.Group();
  private barracks: ReturnType<typeof createBarracks> | null = null;
  private root = new THREE.Group();
  private colliders: BoundingBox2D[] = [];
  private lampMat = new THREE.MeshStandardMaterial({ color: 0xfff2cf, emissive: 0xffd9a0, emissiveIntensity: 0.1, roughness: 0.5 });
  private night = 0;
  /** causeway road surface: plain grey until the barracks' own asphalt textures exist, then the very same texture as its entrance road */
  private bridgeAsphalt = new THREE.MeshStandardMaterial({ color: 0x62646a, roughness: 0.92 });
  private roadTexApplied = false;
  private camPos = new THREE.Vector3();

  constructor(private grid: SpatialGrid) {
    this.group.name = 'barracks_island';
    this.applyRoadTexture(getPreloadedBarracks());
    this.group.add(this.buildSeaWallAndBridge());
    // the cantonment sits on the island, facing north (rotated by PI: local +z = toward the city)
    this.root.position.set(BX, PLAT_Y, BZ);
    this.root.rotation.y = Math.PI;
    this.root.visible = false;
    this.group.add(this.root);
    this.addEdgeColliders();
  }

  private box(id: string, minX: number, maxX: number, minZ: number, maxZ: number, y0?: number, y1?: number): void {
    const b: BoundingBox2D = { id, minX, maxX, minZ, maxZ, y0, y1, userData: { type: 'barracks' } };
    this.colliders.push(b);
    this.grid.insert(b);
  }

  private addEdgeColliders(): void {
    const t = 3;
    const x0 = BX - ISL_HX, x1 = BX + ISL_HX;
    // quay rail all round the island (open where the bridge lands)
    this.box('isl_s', x0, x1, ISL_Z1, ISL_Z1 + t);
    this.box('isl_w', x0 - t, x0, ISL_Z0 - 2, ISL_Z1 + t);
    this.box('isl_e', x1, x1 + t, ISL_Z0 - 2, ISL_Z1 + t);
    this.box('isl_nw', x0, BX - BR_HW - 0.2, ISL_Z0 - t, ISL_Z0);
    this.box('isl_ne', BX + BR_HW + 0.2, x1, ISL_Z0 - t, ISL_Z0);
    // bridge parapets (only block a walker standing on the deck)
    this.box('br_w', BX - BR_HW - 0.5, BX - BR_HW + 0.5, BR_Z0, BR_Z1, -0.6, 4);
    this.box('br_e', BX + BR_HW - 0.5, BX + BR_HW + 0.5, BR_Z0, BR_Z1, -0.6, 4);
  }

  private applyRoadTexture(b: any): void {
    if (this.roadTexApplied || !b?.roadTextures) return;
    this.roadTexApplied = true;
    const t = b.roadTextures();
    const m = this.bridgeAsphalt;
    m.map = t.fine;
    m.color.set(0xffffff);
    m.roughness = 0.84;
    m.customProgramCacheKey = () => 'il-barracks-bridge-asphalt';
    // same recipe as the barracks ground shader (textures are sRGB-tagged: already linear in the shader): fine asphalt (2.2 m tile) x wear / patch multiplier (16 m tile)
    m.onBeforeCompile = (sh) => {
      sh.uniforms.tAMac = { value: t.macro };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tAMac;')
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
  vec3 af = texture2D(map, vMapUv).rgb;
  vec3 am = texture2D(tAMac, vMapUv * ${(2.2 / 16).toFixed(5)}).rgb * 2.0;
  diffuseColor.rgb = af * am * 1.25;
#endif`,
        );
    };
    m.needsUpdate = true;
  }

  private buildSeaWallAndBridge(): THREE.Group {
    const g = new THREE.Group();
    const conc = new THREE.MeshStandardMaterial({ color: 0x9a9a94, roughness: 0.95 });
    const concDark = new THREE.MeshStandardMaterial({ color: 0x6f6f6b, roughness: 0.95 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8d949a, roughness: 0.5, metalness: 0.6 });

    // ---- sea wall: a concrete box from the sea bed up to the island top, plus a rock apron and a coping ----
    const cx = BX, w = ISL_HX * 2, d = ISL_Z1 - ISL_Z0, cz = (ISL_Z0 + ISL_Z1) / 2, hgt = PLAT_Y - SEA_BED;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), conc);
    wall.position.set(cx, SEA_BED + hgt / 2 - 0.02, cz);
    wall.receiveShadow = true;
    g.add(wall);
    const cop = new THREE.Mesh(new THREE.BoxGeometry(w + 3, 0.5, d + 3), concDark);
    cop.position.set(cx, PLAT_Y - 0.26, cz);
    g.add(cop);
    // low quay kerb with bollards
    const kerbs: [number, number, number, number][] = [
      [cx, ISL_Z1 + 0.6, w + 1.2, 0.5], [cx - ISL_HX - 0.6, cz, 0.5, d + 1.2], [cx + ISL_HX + 0.6, cz, 0.5, d + 1.2],
    ];
    for (const [x, z, kw, kd] of kerbs) {
      const k = new THREE.Mesh(new THREE.BoxGeometry(kw, 0.9, kd), concDark);
      k.position.set(x, PLAT_Y + 0.45, z);
      g.add(k);
    }
    for (const side of [-1, 1]) {
      const wl = (ISL_HX - BR_HW - 0.2) ;
      const k = new THREE.Mesh(new THREE.BoxGeometry(wl, 0.9, 0.5), concDark);
      k.position.set(cx + side * (BR_HW + 0.2 + wl / 2), PLAT_Y + 0.45, ISL_Z0 - 0.6);
      g.add(k);
    }

    // ---- bridge deck + barriers, built in 2.5 m segments exactly like the city's bridges: the same New Jersey style parapet,
    //      the same concrete (grain + normal map), expansion joints every 5 m, and the barracks' own road surface on top ----
    const SPAN = 24;
    const W = BR_HW; // outer edge of the deck; the barrier fills its outer 0.5 m, flush with the slab fascia (no gap to see the water through)
    const bw = 0.5, Wi = W - bw, hwA = Wi, parH = 0.95;
    const prof: [number, number][] = [[0, 0.01], [0, 0.14], [bw * 0.3, 0.5], [bw * 0.38, parH]];
    const IN = (k: number): number => Wi + prof[k][0];
    const CONCRETE: C3 = [0.9, 0.9, 0.88], CONCRETE_DARK: C3 = [0.56, 0.56, 0.55], RAIL: C3 = [0.98, 0.98, 0.96], JOINT: C3 = [0.2, 0.2, 0.19];
    const WHITE: C3 = [0.91, 0.91, 0.89], YELLOW: C3 = [0.85, 0.74, 0.24];
    const asphaltB = new PolyBuf(), wallB = new PolyBuf(), topB = new PolyBuf(), jointB = new PolyBuf(), whiteB = new PolyBuf(), yellowB = new PolyBuf();
    const zs: number[] = [];
    for (let z = BR_Z0; z < BR_Z1 - 0.01; z += 2.5) zs.push(z);
    zs.push(BR_Z1);
    const E = (z: number, off: number, h: number): P3 => [BX + off, deckHeightAt(z) + h, z];
    const uvA = (p: P3): [number, number] => [p[0] / 2.2, p[2] / 2.2];
    const uv0 = (): [number, number] => [0, 0];
    for (let i = 0; i < zs.length - 1; i++) {
      const za = zs[i], zb = zs[i + 1], ya = deckHeightAt(za), yb = deckHeightAt(zb);
      // over land the ramp is a solid embankment (skirt reaches the ground), over water it is a slab on piers
      const da = za < 930 ? Math.max(1.1, ya + 0.3) : 1.1, db = zb < 930 ? Math.max(1.1, yb + 0.3) : 1.1;
      asphaltB.poly([E(za, -hwA, 0.01), E(za, hwA, 0.01), E(zb, hwA, 0.01), E(zb, -hwA, 0.01)], [1, 1, 1], uvA);
      // underside of the slab
      wallB.poly([E(za, -W, -1.1), E(zb, -W, -1.1), E(zb, W, -1.1), E(za, W, -1.1)], CONCRETE_DARK, (p) => [p[2] / CONCRETE_TILE, (p[0] - BX) / CONCRETE_TILE], E(za, 0, -4));
      // painted lines: yellow centre dashes, white edge lines
      if ((i >> 1) % 3 === 0 && i % 2 === 0) yellowB.poly([E(za, -0.08, 0.025), E(za, 0.08, 0.025), E(zb, 0.08, 0.025), E(zb, -0.08, 0.025)], YELLOW, uv0);
      for (const sx of [-(hwA - 0.45), hwA - 0.45]) whiteB.poly([E(za, sx - 0.07, 0.025), E(za, sx + 0.07, 0.025), E(zb, sx + 0.07, 0.025), E(zb, sx - 0.07, 0.025)], WHITE, uv0);

      const panel = i >> 1; // 5 m panels, each cast on its own day: a slight tone change per panel
      const jointHere = i > 0 && (i & 1) === 0;
      for (const sg of [-1, 1]) {
        const tone = 1 + ((((panel * 37 + (sg > 0 ? 11 : 0)) * 2654435761) >>> 0) % 100 - 50) / 50 * 0.04;
        const rail: C3 = [RAIL[0] * tone, RAIL[1] * tone, RAIL[2] * tone];
        const foot: C3 = [rail[0] * 0.78, rail[1] * 0.78, rail[2] * 0.76]; // road grime / tyre splash on the lowest part
        const seed = sg * 17.3;
        const wallUV = (p: P3): [number, number] => [p[2] / CONCRETE_TILE + seed, p[1] / CONCRETE_TILE];
        const topUV = (p: P3): [number, number] => [p[2] / CONCRETE_TILE + seed, sg * (p[0] - BX) / CONCRETE_TILE + sg * 3.1];
        const endUV = (p: P3): [number, number] => [(p[0] - BX) / CONCRETE_TILE + sg * 5.7, p[1] / CONCRETE_TILE];
        const P = (z: number, off: number, h: number): P3 => E(z, sg * off, h);
        const outside = E(za, sg * (W + 1), 0.5);
        const inside = E(za, 0, 0.5);
        // slab fascia (+ a dark drip band on its lower edge), flush under the barrier's outer face
        wallB.poly([P(za, W, 0.01), P(zb, W, 0.01), P(zb, W, -db + 0.07), P(za, W, -da + 0.07)], CONCRETE, wallUV, outside);
        wallB.poly([P(za, W, -da + 0.07), P(zb, W, -db + 0.07), P(zb, W, -db), P(za, W, -da)], CONCRETE_DARK, wallUV, outside);
        // barrier: inner face (foot, flared slope, upright face), cap, outer face
        for (let k = 0; k < prof.length - 1; k++) {
          wallB.poly([P(za, IN(k), prof[k][1]), P(zb, IN(k), prof[k][1]), P(zb, IN(k + 1), prof[k + 1][1]), P(za, IN(k + 1), prof[k + 1][1])], k === 0 ? foot : rail, wallUV, inside);
        }
        topB.poly([P(za, IN(3), parH), P(zb, IN(3), parH), P(zb, W, parH), P(za, W, parH)], rail, topUV);
        wallB.poly([P(za, W, 0.01), P(zb, W, 0.01), P(zb, W, parH), P(za, W, parH)], rail, wallUV, outside);
        // barrier ends
        const cap = (z: number, back: P3): void => {
          wallB.poly([P(z, IN(0), 0.01), P(z, W, 0.01), P(z, W, prof[2][1]), P(z, IN(2), prof[2][1]), P(z, IN(1), prof[1][1])], rail, endUV, back);
          wallB.poly([P(z, IN(2), prof[2][1]), P(z, W, prof[2][1]), P(z, W, parH), P(z, IN(3), parH)], rail, endUV, back);
        };
        if (i === 0) cap(za, E(za - 2, sg * (W - 0.2), 0.5));
        if (i === zs.length - 2) cap(zb, E(zb + 2, sg * (W - 0.2), 0.5));
        // expansion joint at the start of every 5 m panel
        if (jointHere) {
          const t1 = 0.016, Z1 = za + (zb - za) * t1;
          for (let k = 0; k < prof.length - 1; k++) {
            jointB.poly([P(za, IN(k), prof[k][1]), P(Z1, IN(k), prof[k][1]), P(Z1, IN(k + 1), prof[k + 1][1]), P(za, IN(k + 1), prof[k + 1][1])], JOINT, uv0, inside);
          }
          jointB.poly([P(za, IN(3), parH), P(Z1, IN(3), parH), P(Z1, W, parH), P(za, W, parH)], JOINT, uv0);
          jointB.poly([P(za, W, -da), P(Z1, W, -da), P(Z1, W, parH), P(za, W, parH)], JOINT, uv0, outside);
          jointB.poly([P(za, hwA, 0.02), P(Z1, hwA, 0.02), P(Z1, Wi, 0.02), P(za, Wi, 0.02)], JOINT, uv0);
        }
      }
    }
    const paintMat = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, vertexColors: true });
    const addBuf = (buf: PolyBuf, mat: THREE.Material, shadow: boolean): void => {
      const geo = buf.geometry();
      if (!geo) return;
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = shadow;
      g.add(m);
    };
    addBuf(asphaltB, this.bridgeAsphalt, true);
    addBuf(wallB, getConcreteMaterial('wall'), true);
    addBuf(topB, getConcreteMaterial('top'), true);
    addBuf(jointB, getJointMaterial(), false);
    addBuf(whiteB, paintMat(0xffffff), false);
    addBuf(yellowB, paintMat(0xffffff), false);

    // ---- piers every span: two round columns on a cap beam, down to the sea bed ----
    const nPier = Math.floor((BR_Z1 - BR_Z0 - BR_RAMP * 0.4) / SPAN);
    const colGeo = new THREE.CylinderGeometry(0.9, 1.1, 1, 12);
    const capGeo = new THREE.BoxGeometry(BR_HW * 2 + 1.2, 0.8, 1.6);
    const pierCols = new THREE.InstancedMesh(colGeo, conc, nPier * 2);
    const caps = new THREE.InstancedMesh(capGeo, concDark, nPier);
    const m4 = new THREE.Matrix4();
    let ci = 0;
    for (let i = 0; i < nPier; i++) {
      const z = BR_Z0 + BR_RAMP * 0.4 + (i + 0.5) * SPAN;
      const y = deckHeightAt(z) - 1.5;
      m4.makeTranslation(BX, y - 0.1, z); caps.setMatrixAt(i, m4);
      for (const sx of [-3.2, 3.2]) {
        const top = y - 0.5, hh = top - SEA_BED;
        m4.compose(new THREE.Vector3(BX + sx, SEA_BED + hh / 2, z), new THREE.Quaternion(), new THREE.Vector3(1, hh, 1));
        pierCols.setMatrixAt(ci++, m4);
      }
    }
    pierCols.count = ci;
    for (const m of [pierCols, caps]) { m.frustumCulled = false; g.add(m); }

    // ---- lamp posts every 36 m on alternating sides ----
    const lampGeo = new THREE.CylinderGeometry(0.07, 0.09, 8, 6);
    const headGeo = new THREE.BoxGeometry(1.1, 0.16, 0.45);
    for (let z = BR_Z0 + 40, k = 0; z < BR_Z1 - 10; z += 36, k++) {
      const side = k % 2 ? 1 : -1, y = deckHeightAt(z), x = BX + side * (BR_HW - 0.25);
      const pole = new THREE.Mesh(lampGeo, steel);
      pole.position.set(x, y + 4, z);
      const head = new THREE.Mesh(headGeo, this.lampMat);
      head.position.set(x - side * 0.5, y + 7.9, z);
      g.add(pole, head);
    }
    return g;
  }

  private build(): void {
    const t0 = performance.now();
    // normally the loading screen already built it (textures included); this is only the fallback
    this.barracks = getPreloadedBarracks();
    if (!this.barracks) {
      this.barracks = createBarracks();
      this.barracks.build();
    }
    this.applyRoadTexture(this.barracks);
    (globalThis as any).__barracksBuildMs = performance.now() - t0;
    this.root.add(this.barracks.group);
    this.barracks.setNight(this.night);
    // register the compound's colliders in world space (rotation PI about the origin (BX, BZ))
    this.barracks.colliders.forEach((c: number[], i: number) => {
      this.box(`barracks_${i}`, BX - c[2], BX - c[0], BZ - c[3], BZ - c[1]);
    });
  }

  public update(px: number, pz: number, dt: number, camera?: THREE.Camera): void {
    const d = Math.hypot(px - BX, pz - BZ);
    if (!this.barracks && d < SHOW_RADIUS) this.build();
    if (this.barracks) {
      const vis = d < SHOW_RADIUS + 60;
      this.root.visible = vis;
      if (vis && camera) {
        camera.getWorldPosition(this.camPos);
        this.barracks.update(camera, dt);
      }
    }
  }

  public setNight(n: number): void {
    this.night = n;
    this.lampMat.emissiveIntensity = 0.1 + 2.4 * n;
    this.barracks?.setNight(n);
  }

  public dispose(): void {
    this.colliders.forEach((c) => this.grid.remove(c));
    this.colliders = [];
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((mat: any) => {
        Object.values(mat).forEach((v: any) => v?.isTexture && v.dispose());
        mat.dispose?.();
      });
    });
    this.group.clear();
  }
}
