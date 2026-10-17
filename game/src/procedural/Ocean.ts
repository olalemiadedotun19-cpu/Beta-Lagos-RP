import * as THREE from 'three';
import { SEA_LEVEL, WORLD_EDGE, seabedFrom, terrainHeight } from '../world/CurvedRoads';
import { createWaterMaterial } from './TerrainTextures';

/**
 * The sea around the map.
 *
 * The streamed ground ends at +-WORLD_EDGE. Beyond it the old build showed nothing; now a ring of beach, sloping sea floor and
 * animated water fills that space out to ~2.8 km (the fog hides the rest) and the walker can wade / swim out to SEA_HALF.
 *
 * Two meshes, one shared vertex ring (so the water's depth values always match the floor it sits over):
 *   - sea floor : sand colour near the shoreline, darker and bluer with depth; its inner edge uses the terrain's own height at the
 *                 edge, so it joins the land meshes without a crack (seabedHeight() in CurvedRoads is what the walker stands on)
 *   - water     : the shared river / pond water material; `aDepth` = water level - sea floor, so the shader draws foam at the
 *                 shore, fades to transparent over shallows and goes deep blue further out
 * Only the ring is built: the land square in the middle is left empty so the sea never covers rivers, ponds or the beach.
 */

const OUT = [0, 5, 10, 16, 24, 34, 46, 60, 80, 105, 140, 190, 260, 380, 560, 850, 1300, 1900];
const INNER_STEP = 8; // vertex spacing along the shoreline

export function buildOcean(): THREE.Group {
  const E = WORLD_EDGE;
  const lines: number[] = [];
  for (let k = OUT.length - 1; k >= 1; k--) lines.push(-(E + OUT[k]));
  for (let v = -E; v < E - 1e-6; v += INNER_STEP) lines.push(v);
  for (let k = 0; k < OUT.length; k++) lines.push(E + OUT[k]);
  const n = lines.length;
  const isLand = (a: number, b: number): boolean => lines[a] >= -E - 1e-6 && lines[a + 1] <= E + 1e-6 && lines[b] >= -E - 1e-6 && lines[b + 1] <= E + 1e-6;

  const vid = new Map<number, number>();
  const pos: number[] = [];
  const wpos: number[] = [];
  const dep: number[] = [];
  const col: number[] = [];
  const edgeH = new Map<number, number>();
  const idxOf = (i: number, j: number): number => {
    const key = i * n + j;
    let id = vid.get(key);
    if (id !== undefined) return id;
    const x = lines[i];
    const z = lines[j];
    // the land height at the shore point nearest to this vertex (cached: whole rows / columns share it)
    const cx = Math.max(-E, Math.min(E, x));
    const cz = Math.max(-E, Math.min(E, z));
    const ek = Math.round(cx) * 100003 + Math.round(cz);
    let he = edgeH.get(ek);
    if (he === undefined) {
      he = terrainHeight(cx, cz);
      edgeH.set(ek, he);
    }
    const h = seabedFrom(x, z, he);
    id = pos.length / 3;
    vid.set(key, id);
    pos.push(x, h - 0.05, z);
    wpos.push(x, SEA_LEVEL - 0.05, z);
    const depth = SEA_LEVEL - h;
    dep.push(Math.max(depth, -0.1));
    // sand -> wet sand -> deep teal -> dark blue
    const t = Math.min(1, Math.max(0, depth / 9));
    const dry = depth < 0 ? 1 : 0;
    const r = dry ? 0.8 : 0.72 - 0.5 * t;
    const g = dry ? 0.74 : 0.66 - 0.28 * t;
    const b = dry ? 0.56 : 0.5 - 0.06 * t;
    col.push(r, g, b);
    return id;
  };

  const idx: number[] = [];
  for (let a = 0; a < n - 1; a++) {
    for (let b = 0; b < n - 1; b++) {
      if (isLand(a, b)) continue;
      const v00 = idxOf(a, b);
      const v10 = idxOf(a + 1, b);
      const v01 = idxOf(a, b + 1);
      const v11 = idxOf(a + 1, b + 1);
      idx.push(v00, v01, v10, v10, v01, v11);
    }
  }

  const group = new THREE.Group();
  group.name = 'ocean';

  const floor = new THREE.BufferGeometry();
  floor.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  floor.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  floor.setIndex(idx);
  floor.computeVertexNormals();
  const floorMesh = new THREE.Mesh(floor, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  const water = new THREE.BufferGeometry();
  water.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
  water.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
  water.setIndex(idx);
  const waterMesh = new THREE.Mesh(water, createWaterMaterial());
  waterMesh.renderOrder = 1;
  waterMesh.frustumCulled = false;
  group.add(waterMesh);
  floorMesh.frustumCulled = false;
  return group;
}
