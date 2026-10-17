import * as THREE from 'three';
import { GeoBatch, getGlowMaterial, getSolidMaterial, hashString, makeRng } from '../travel/Geo';
import { Kit, makeSignBatch, placeBuilding, setKitTransform, clearKitTransform } from '../travel/BuildingKit';
import { FacadeKind, getFacadeMaterial } from '../travel/TravelMaterials';
import { RoadBuilder } from '../procedural/RoadBuilder';
import { streetlightBody, poleBody } from '../procedural/StreetFurniture';
import { WorldLayout } from './WorldLayout';
import { BoundingBox2D } from './SpatialGrid';
import { RoadSegment } from '../types/game';
import { rectInChunk, setPondSource } from './CurvedRoads';
import { buildCurvedCell, CurvedLamp } from '../procedural/CurvedRoadBuilder';
import { getCityBuildings } from './CityBuildings';
import { allDistricts, rotatedColliders } from './CityDistricts';

// the park ponds are real bowls in the terrain: CurvedRoads needs to know where they are
setPondSource(() => allDistricts().flatMap((d) => d.ponds));
import { buildDistrict } from '../procedural/DistrictBuilder';
import { buildOaks, buildTufts, OakSpec, TuftSpec } from '../procedural/TerrainTrees';
import { createWaterMaterial, getLawnMaterial } from '../procedural/TerrainTextures';

/**
 * CellBuilder - builds one streamed world cell as a time-sliced generator.
 * Each `yield` is a safe point for the streamer to hand the frame back to the game.
 *
 *  roads (clipped RoadBuilder)  ->  frontage buildings (BuildingKit stamped along every road)
 *  ->  block interiors / parks  ->  trees, streetlights, utility poles + cables  ->  merged meshes
 *
 * Everything is deterministic from the layout + road ids, so rebuilding a cell (LOD swap) never changes it.
 */

export interface CellRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CellResult {
  group: THREE.Group;
  colliders: BoundingBox2D[];
  lampHeads: THREE.Vector3[];
  dispose(): void;
}

let lampSpecs: ReturnType<typeof streetlightBody>[] | null = null;
let poleSpecs: THREE.BufferGeometry[] | null = null;

function getLampSpecs() {
  if (!lampSpecs) lampSpecs = [streetlightBody(0), streetlightBody(1)];
  return lampSpecs;
}
function getPoleSpecs() {
  if (!poleSpecs) poleSpecs = [poleBody(0), poleBody(1)];
  return poleSpecs;
}

/** Shared lamp-glow material (white vertex colours tinted by uniform) + additive ground pool material */
let lampGlowMat: THREE.MeshBasicMaterial | null = null;
let poolMat: THREE.MeshBasicMaterial | null = null;
export function getLampGlowMaterial(): THREE.MeshBasicMaterial {
  if (!lampGlowMat) lampGlowMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x8c929a });
  return lampGlowMat;
}
export function getLampPoolMaterial(): THREE.MeshBasicMaterial {
  if (!poolMat) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    poolMat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(c),
      color: 0xffc977,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    poolMat.visible = false;
  }
  return poolMat;
}

export function* buildCell(layout: WorldLayout, prepared: ReturnType<typeof RoadBuilder.prepare>, rect: CellRect, near: boolean): Generator<void, CellResult, void> {
  const group = new THREE.Group();
  group.name = `cell_${rect.minX}_${rect.minZ}`;
  const disposables: { dispose(): void }[] = [];
  const colliders: BoundingBox2D[] = [];
  const lampHeads: THREE.Vector3[] = [];

  // ---- 1. roads -------------------------------------------------------------------------------
  const roadGroup = RoadBuilder.build(layout.roads, rect, prepared, !near);
  roadGroup.children.forEach((m) => disposables.push((m as THREE.Mesh).geometry));
  group.add(roadGroup);
  yield;

  let curvedLamps: CurvedLamp[] = [];
  // ---- 1b. curved-road chunks (north-east and north-west corners): hilly terrain, curved roads, bridges, water, trees ----
  if (rectInChunk(rect)) {
    const cr = yield* buildCurvedCell(rect, near);
    group.add(cr.group);
    disposables.push(...cr.disposables);
    colliders.push(...cr.colliders);
    curvedLamps = cr.lamps;
    yield;
  }

  // ---- batches ---------------------------------------------------------------------------------
  const kit: Kit = {
    solid: new GeoBatch(),
    glow: new GeoBatch(),
    fac: { res: new GeoBatch(), com: new GeoBatch(), office: new GeoBatch(), shop: new GeoBatch(), roof: new GeoBatch(), grille: new GeoBatch(), fabric: new GeoBatch() },
    signs: makeSignBatch(),
    near,
    night: false,
    rng: makeRng(1),
    nrng: makeRng(2),
    trees: [],
  };
  // terrain-style oaks (street trees, park trees, yard trees), lawns, ponds and wind-swayed grass tufts
  const oaks: OakSpec[] = kit.trees;
  const lawn = new GeoBatch();
  const ponds: THREE.BufferGeometry[] = [];
  const tufts: TuftSpec[] = [];
  const districtFlat: THREE.BufferGeometry[] = []; // lanes / pavements / paths of the districts
  const lampBody = new GeoBatch(); // street furniture bodies (own colours)
  const lampGlow = new GeoBatch();
  const cables: number[] = [];
  const pools: number[] = [];
  const poolIdx: number[] = [];

  // ---- 2. the planned buildings of the curved city (world/CityBuildings.ts): frontage rows along every street + second-row houses ----
  // (the footprints were validated against roads, river, lots and each other; replaying the kit with the same seed rebuilds exactly them)
  const plan = getCityBuildings();
  let built = 0;
  for (const b of plan.inRect(rect.minX, rect.maxX, rect.minZ, rect.maxZ)) {
    kit.rng = makeRng(b.seed);
    kit.nrng = makeRng(b.seed ^ 0x5bd1e995);
    kit.seed = b.seed;
    setKitTransform(kit, b.rot, b.tx, b.tz);
    placeBuilding(kit, b.side, 0, b.slot, b.zone);
    clearKitTransform(kit);
    // collider: the oriented footprint as slices of axis-aligned boxes (b.d = across the street, b.w = along it)
    rotatedColliders(b.x, b.z, b.d, b.w, b.rot).forEach((c, k) => {
      colliders.push({ id: `${b.id}_${k}`, minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ, userData: { type: 'building', id: b.id, name: 'Building' } });
    });
    if (++built % 14 === 0) yield;
  }
  yield;

  // ---- 3. district plots (Crescent Villas, Glass Quarter, Sky Garden Park, The Mews) ----
  for (const d of plan.districts) {
    if (d.cx < rect.minX || d.cx >= rect.maxX || d.cz < rect.minZ || d.cz >= rect.maxZ) continue;
    buildDistrict(d, { kit, lawn, ponds, oaks, tufts, colliders, lamps: curvedLamps, flat: districtFlat, near });
    yield;
  }
  yield;

  // ---- 4. streetlights ---------------------------------------------------------------------------
  const lampSp = getLampSpecs();

  // streetlights placed by the curved-road chunk (same bodies, glow, pooled lights and light pools as the grid roads)
  for (const L of curvedLamps) {
    const sp = lampSp[L.variant];
    lampBody.addGeometry(sp.body, L.x, L.y, L.z, L.rotY, L.scale);
    lampGlow.addGeometry(sp.glow, L.x, L.y, L.z, L.rotY, L.scale);
    const hx = L.x + Math.sin(L.rotY) * sp.headZ;
    const hz = L.z + Math.cos(L.rotY) * sp.headZ;
    lampHeads.push(new THREE.Vector3(hx, L.y + sp.headY * L.scale - 0.2, hz));
    if (near) {
      const s = 7.0;
      const b = poolIdx.length;
      pools.push(hx - s, L.y + 0.06, hz - s, hx + s, L.y + 0.06, hz - s, hx + s, L.y + 0.06, hz + s, hx - s, L.y + 0.06, hz + s);
      poolIdx.push(b);
    }
  }

  // ---- 5. merge ----------------------------------------------------------------------------------
  const push = (geo: THREE.BufferGeometry | null, mat: THREE.Material, shadow = false, receive = false, order = 0) => {
    if (!geo) return;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    m.receiveShadow = receive;
    m.renderOrder = order;
    group.add(m);
    disposables.push(geo);
  };
  push(kit.solid.build(), getSolidMaterial());
  districtFlat.forEach((g) => push(g, getSolidMaterial(), false, true));
  push(lawn.build(), getLawnMaterial(), false, true);
  ponds.forEach((g) => push(g, createWaterMaterial(), false, false, 1));
  for (const built of [buildOaks(oaks, near), buildTufts(tufts)]) {
    if (!built) continue;
    group.add(built.group);
    disposables.push(...built.disposables);
  }
  push(kit.glow.build(), getGlowMaterial());
  (Object.keys(kit.fac) as FacadeKind[]).forEach((k) => push(kit.fac[k].build(), getFacadeMaterial(k)));
  push(kit.signs.build(), getFacadeMaterial('sign'));
  push(lampBody.build(), getSolidMaterial());
  push(lampGlow.build(), getLampGlowMaterial());
  yield;

  if (cables.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(cables, 3));
    const lines2 = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1b1b1d }));
    lines2.frustumCulled = true;
    group.add(lines2);
    disposables.push(g, lines2.material as THREE.Material);
  }
  if (pools.length) {
    const g = new THREE.BufferGeometry();
    const uv: number[] = [];
    const idx: number[] = [];
    const nor: number[] = [];
    poolIdx.forEach((b, n) => {
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      for (let q = 0; q < 4; q++) nor.push(0, 1, 0);
      const o = n * 4;
      idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
      void b;
    });
    g.setAttribute('position', new THREE.Float32BufferAttribute(pools, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, getLampPoolMaterial());
    m.renderOrder = 2;
    group.add(m);
    disposables.push(g);
  }

  return {
    group,
    colliders,
    lampHeads,
    dispose() {
      disposables.forEach((d) => d.dispose());
      group.clear();
    },
  };
}
export type { RoadSegment };
