import * as THREE from 'three';
import { waterUniforms } from './TerrainTextures';

/**
 * Trees + grass tufts ported 1:1 from the "Terrain Road" prototype.
 *
 *   - makeOak           the bulky procedural oak (trunk, buttress roots, limbs, leaf-card canopy), 4 variants built once
 *   - bark / leaf       procedural bark + leaf-cluster textures, wind sway in the vertex shader (leaves also flutter)
 *   - buildOaks         near cells: full oaks (InstancedMesh per variant); far cells: the cheap round proxy
 *   - buildTufts        short wind-swaying grass tufts (InstancedMesh)
 *
 * Wind time is the same uniform object WorldRenderer already drives for the water, so nothing else needs wiring.
 */

export interface OakSpec {
  x: number;
  y: number;
  z: number;
  /** final scale (1 = the 12 m forest oak of the prototype; street trees use ~0.5 - 0.8) */
  s: number;
  rot: number;
  /** 0..1 deterministic pick: variant + leaf colour + brightness */
  tint: number;
}

export interface TuftSpec {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
  /** 0..1 colour pick */
  tint: number;
}

export interface Built {
  group: THREE.Group;
  disposables: { dispose(): void }[];
}

const uTime = waterUniforms.uTime;

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const perpTo = (t: THREE.Vector3): THREE.Vector3 => new THREE.Vector3().crossVectors(t, Math.abs(t.y) < 0.98 ? UP : V(1, 0, 0)).normalize();

function wrapDraw(w: number, h: number, x: number, y: number, fn: (px: number, py: number) => void): void {
  for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) fn(x + dx, y + dy);
}

// ---------------------------------------------------------------------------------------------
// wind
// ---------------------------------------------------------------------------------------------

function addGrassWind(mat: THREE.Material): void {
  mat.customProgramCacheKey = () => 'il-grasswind';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <project_vertex>',
      `
        float gs = 1.0;
        #ifdef USE_INSTANCING
          gs = 1.0 - smoothstep(70.0, 115.0, -(modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0)).z);
        #endif
        vec4 mvPosition = vec4(transformed * gs, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        float ph = uTime * 1.7 + mvPosition.x * 0.12 + mvPosition.z * 0.1;
        float amp = 0.4 * position.y * position.y;
        mvPosition.x += (sin(ph) + 0.4 * sin(ph * 2.3)) * amp;
        mvPosition.z += cos(ph * 0.8) * amp * 0.5;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
      `,
    );
  };
}

function addTreeWind(mat: THREE.Material, flutter: boolean): void {
  mat.customProgramCacheKey = () => 'il-treewind' + (flutter ? 'L' : 'B');
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <project_vertex>',
      `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        float hh = max(position.y, 0.0);
        float ph = uTime * 1.2 + mvPosition.x * 0.05 + mvPosition.z * 0.04;
        float amp = 0.0035 * hh * hh;
        mvPosition.x += (sin(ph) + 0.4 * sin(ph * 2.3)) * amp;
        mvPosition.z += cos(ph * 0.9) * amp * 0.6;
        ${flutter ? 'mvPosition.xyz += vec3(sin(uTime * 3.5 + mvPosition.x * 2.0 + mvPosition.y), sin(uTime * 3.0 + mvPosition.z * 2.0), cos(uTime * 3.3 + mvPosition.y * 2.0)) * 0.05;' : ''}
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
      `,
    );
  };
}

// ---------------------------------------------------------------------------------------------
// textures
// ---------------------------------------------------------------------------------------------

function makeBark(): THREE.CanvasTexture {
  const W = 256;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5d4c3c';
  g.fillRect(0, 0, W, H);
  const cols = ['#2a1f17', '#3a2c20', '#4b3a2a', '#6b573f', '#7f6c52'];
  g.lineCap = 'round';
  for (let n = 0; n < 380; n++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const len = 70 + Math.random() * 190;
    const wd = 2 + Math.random() * 7;
    const col = cols[(Math.random() * cols.length) | 0];
    const a = 0.35 + Math.random() * 0.55;
    const ph = Math.random() * 6;
    const amp = 1 + Math.random() * 4;
    wrapDraw(W, H, x, y, (px0, py0) => {
      g.beginPath();
      g.strokeStyle = col;
      g.globalAlpha = a;
      g.lineWidth = wd;
      for (let s = 0; s <= 12; s++) {
        const t = s / 12;
        const px = px0 + Math.sin(ph + t * 5) * amp;
        const py = py0 + t * len;
        if (s) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.stroke();
    });
  }
  for (let n = 0; n < 240; n++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const len = 40 + Math.random() * 150;
    const ph = Math.random() * 6;
    const amp = 1 + Math.random() * 3;
    wrapDraw(W, H, x, y, (px0, py0) => {
      g.beginPath();
      g.strokeStyle = '#150e09';
      g.globalAlpha = 0.7;
      g.lineWidth = 1 + Math.random() * 2;
      for (let s = 0; s <= 10; s++) {
        const t = s / 10;
        const px = px0 + Math.sin(ph + t * 6) * amp;
        const py = py0 + t * len;
        if (s) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.stroke();
    });
  }
  for (let n = 0; n < 160; n++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const l = 6 + Math.random() * 18;
    wrapDraw(W, H, x, y, (px, py) => {
      g.beginPath();
      g.strokeStyle = '#1c130d';
      g.globalAlpha = 0.5;
      g.lineWidth = 1.2;
      g.moveTo(px, py);
      g.lineTo(px + l, py + (Math.random() - 0.5) * 4);
      g.stroke();
    });
  }
  for (let n = 0; n < 160; n++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const len = 30 + Math.random() * 100;
    wrapDraw(W, H, x, y, (px, py) => {
      g.beginPath();
      g.strokeStyle = '#9a8666';
      g.globalAlpha = 0.22;
      g.lineWidth = 1.5;
      g.moveTo(px, py);
      g.lineTo(px + (Math.random() - 0.5) * 4, py + len);
      g.stroke();
    });
  }
  for (let n = 0; n < 28; n++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = 6 + Math.random() * 20;
    wrapDraw(W, H, x, y, (px, py) => {
      g.beginPath();
      g.fillStyle = '#6f7d4a';
      g.globalAlpha = 0.13;
      g.arc(px, py, r, 0, 6.283);
      g.fill();
    });
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function makeLeaf(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 18; i++) {
    const a0 = Math.random() * 6.283;
    const rr = Math.random() * 52;
    const l = { x: 128 + Math.cos(a0 + 1.3) * rr, y: 128 + Math.sin(a0 + 1.3) * rr, ang: Math.random() * 6.283, L: 56 + Math.random() * 34, W: 15 + Math.random() * 10, v: 140 + Math.random() * 115 };
    g.save();
    g.translate(l.x, l.y);
    g.rotate(l.ang);
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(l.W, -l.L * 0.5, 0, -l.L);
    g.quadraticCurveTo(-l.W, -l.L * 0.5, 0, 0);
    const gr = g.createLinearGradient(0, 0, 0, -l.L);
    const a = Math.round(l.v * 0.72);
    const b = Math.round(Math.min(255, l.v * 1.05));
    gr.addColorStop(0, `rgb(${a},${a},${a})`);
    gr.addColorStop(1, `rgb(${b},${b},${b})`);
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = 1;
    g.stroke();
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -l.L * 0.88);
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.lineWidth = 1.4;
    g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------------------------------------
// the oak generator (verbatim logic of the prototype)
// ---------------------------------------------------------------------------------------------

interface OakDepth {
  R: number;
  step: number;
  bend: number;
  up: number;
  taper: number;
  wob: number;
  kids?: [number, number];
}

const OAK_DEPTH: OakDepth[] = [
  { R: 8, step: 0.55, bend: 0.03, up: 0.02, taper: 0.72, wob: 0.05 },
  { R: 5, step: 0.95, bend: 0.1, up: 0.06, taper: 0.42, wob: 0.03, kids: [2, 3] },
  { R: 4, step: 0.85, bend: 0.2, up: 0.05, taper: 0.25, wob: 0, kids: [0, 0] },
];

interface OakGeo {
  bark: THREE.BufferGeometry;
  leaf: THREE.BufferGeometry;
}

function makeOak(seed: number): OakGeo {
  const rng = mulberry32(seed);
  const rand = (a: number, b: number): number => a + (b - a) * rng();
  const randUnit = (): THREE.Vector3 => V(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
  const P: number[] = [];
  const U: number[] = [];
  const I: number[] = [];
  const rings: [number, number][] = [];
  const leafPts: number[][] = [];

  function tube(pts: THREE.Vector3[], radii: number[], R: number, uRep: number, wob: number, flare: number): void {
    const n0 = pts.length;
    const last = pts[n0 - 1];
    const rl = radii[n0 - 1];
    const dl = last.clone().sub(pts[n0 - 2]).normalize();
    const PP = pts.slice();
    const RR = radii.slice();
    (rl < 0.2
      ? [
          [0.8, 0.3],
          [1.1, 0.02],
        ]
      : [
          [0.5, 0.75],
          [0.9, 0.35],
          [1.15, 0.02],
        ]
    ).forEach((a) => {
      PP.push(last.clone().addScaledVector(dl, a[0] * rl));
      RR.push(Math.max(rl * a[1], 0.003));
    });
    const n = PP.length;
    const base = P.length / 3;
    const ph = rng() * 6.283;
    const ph2 = rng() * 6.283;
    const r0 = Math.max(radii[0], 0.03);
    const vStep = 1 / ((2 * 6.283 * r0) / uRep);
    let prevN: THREE.Vector3 | null = null;
    let vAcc = 0;
    for (let i = 0; i < n; i++) {
      const a = PP[Math.max(i - 1, 0)];
      const b = PP[Math.min(i + 1, n - 1)];
      const t = b.clone().sub(a).normalize();
      const nn: THREE.Vector3 = prevN ? prevN.clone().addScaledVector(t, -prevN.dot(t)).normalize() : perpTo(t);
      prevN = nn;
      const bb = new THREE.Vector3().crossVectors(t, nn);
      if (i > 0) vAcc += PP[i].distanceTo(PP[i - 1]) * vStep;
      rings.push([base + i * (R + 1), R]);
      const hy = Math.max(PP[i].y, 0);
      for (let k = 0; k <= R; k++) {
        const th = (k / R) * 6.283185307;
        let r = RR[i];
        if (wob) r *= 1 + wob * (0.6 * Math.sin(3 * th + ph + PP[i].y * 0.8) + 0.4 * Math.sin(5 * th + ph2 - PP[i].y * 1.3));
        if (flare) r *= 1 + flare * Math.exp(-hy * 1.5) * (0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.cos(5 * th + ph), 1.5));
        const cx = Math.cos(th);
        const sx = Math.sin(th);
        P.push(PP[i].x + (nn.x * cx + bb.x * sx) * r, PP[i].y + (nn.y * cx + bb.y * sx) * r, PP[i].z + (nn.z * cx + bb.z * sx) * r);
        U.push((k / R) * uRep, vAcc);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < R; k++) {
        const a = base + i * (R + 1) + k;
        const b = a + 1;
        const c = a + R + 1;
        const d = c + 1;
        I.push(a, b, c, b, d, c);
      }
    }
  }

  function grow(start: THREE.Vector3, dir: THREE.Vector3, len: number, r0In: number, depth: number): { pts: THREE.Vector3[]; radii: number[] } {
    const r0 = Math.max(r0In, 0.02);
    const cfg = OAK_DEPTH[depth];
    const steps = Math.max(3, Math.round(len / cfg.step));
    const pts = [start.clone()];
    const radii = [r0];
    const d = dir.clone().normalize();
    const p = start.clone();
    for (let i = 1; i <= steps; i++) {
      d.addScaledVector(randUnit(), cfg.bend).addScaledVector(UP, cfg.up).normalize();
      p.addScaledVector(d, len / steps);
      pts.push(p.clone());
      radii.push(r0 * (1 - (1 - cfg.taper) * (i / steps)));
    }
    tube(pts, radii, cfg.R, Math.max(1, Math.round(r0 * 3)), cfg.wob, depth === 0 ? 1.3 : 0);
    if (depth === 2) {
      for (let i = 1; i <= steps; i++) leafPts.push([pts[i].x + rand(-0.25, 0.25), pts[i].y + rand(-0.25, 0.25), pts[i].z + rand(-0.25, 0.25)]);
    } else if (depth === 1) {
      for (let i = Math.ceil(steps * 0.6); i <= steps; i++) if (rng() < 0.6) leafPts.push([pts[i].x, pts[i].y, pts[i].z]);
    }
    if (cfg.kids && cfg.kids[1] > 0) {
      const nk = cfg.kids[0] + Math.floor(rng() * (cfg.kids[1] - cfg.kids[0] + 1));
      const az0 = rng() * 6.283;
      for (let k = 0; k < nk; k++) {
        const idx = Math.min(steps - 1, Math.floor(rand(0.3, 1.0) * steps));
        const dl = pts[idx + 1].clone().sub(pts[idx]).normalize();
        const axis = perpTo(dl).applyAxisAngle(dl, az0 + k * 2.4 + rand(-0.4, 0.4));
        const nd = dl.clone().applyAxisAngle(axis, rand(0.5, 1.0)).addScaledVector(UP, 0.15);
        grow(pts[idx].clone(), nd, len * rand(0.55, 0.78), radii[idx] * rand(0.5, 0.7), depth + 1);
      }
    }
    return { pts, radii };
  }

  // trunk, central leader, crown limbs, heavy low limbs, buttress roots
  const lean = V(rand(-0.1, 0.1), 1, rand(-0.1, 0.1)).normalize();
  const trunk = grow(V(0, -0.4, 0), lean, 4.2, 1.2, 0);
  const tp = trunk.pts;
  const tr = trunk.radii;
  const ts = tp.length - 1;
  const at = (t: number): { p: THREE.Vector3; r: number } => {
    const i = Math.min(ts - 1, Math.floor(t * ts));
    return { p: tp[i], r: tr[i] };
  };
  grow(tp[ts - 1].clone(), V(rand(-0.15, 0.15), 1, rand(-0.15, 0.15)), rand(4.2, 5.2), tr[ts - 1] * 0.72, 1);
  const az0 = rng() * 6.283;
  for (let k = 0; k < 4; k++) {
    const az = az0 + (k / 4) * 6.283 + rand(-0.3, 0.3);
    const el = rand(0.7, 1.1);
    const a = at(rand(0.88, 1));
    grow(a.p.clone(), V(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)), rand(4, 5.2), a.r * rand(0.58, 0.68), 1);
  }
  for (let k = 0; k < 2; k++) {
    const az = az0 + 0.9 + k * 3.1 + rand(-0.3, 0.3);
    const el = rand(0.25, 0.55);
    const a = at(rand(0.5, 0.78));
    grow(a.p.clone(), V(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)), rand(4.6, 5.6), a.r * rand(0.45, 0.55), 1);
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * 6.283 + rand(-0.3, 0.3);
    const L = rand(2.4, 3.2);
    const rs = 0.45 * rand(0.9, 1.2);
    const rp: THREE.Vector3[] = [];
    const rr: number[] = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const dist = 0.5 + L * t;
      rp.push(V(Math.cos(a) * dist, 0.7 - 1.0 * Math.pow(t, 0.8), Math.sin(a) * dist));
      rr.push(rs * (1 - 0.85 * t));
    }
    tube(rp, rr, 5, 2, 0, 0);
  }

  // bark geometry
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(I), 1));
  g.computeVertexNormals();
  const nA = g.attributes.normal.array as Float32Array;
  for (const ring of rings) {
    const s = ring[0];
    const R = ring[1];
    const a = s * 3;
    const b = (s + R) * 3;
    let x = nA[a] + nA[b];
    let y = nA[a + 1] + nA[b + 1];
    let z = nA[a + 2] + nA[b + 2];
    const l = Math.hypot(x, y, z) || 1;
    x /= l;
    y /= l;
    z /= l;
    nA[a] = nA[b] = x;
    nA[a + 1] = nA[b + 1] = y;
    nA[a + 2] = nA[b + 2] = z;
  }

  // leaf geometry: clumps of cards with baked orientation, normals pushed outward for a soft round canopy
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let maxY = 1;
  leafPts.forEach((p) => {
    cx += p[0];
    cy += p[1];
    cz += p[2];
    maxY = Math.max(maxY, p[1]);
  });
  const nl = Math.max(1, leafPts.length);
  cx /= nl;
  cy /= nl;
  cz /= nl;
  const lp: number[] = [];
  const ln: number[] = [];
  const lu: number[] = [];
  const lc: number[] = [];
  const li: number[] = [];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  leafPts.forEach((pt) => {
    for (let c = 0; c < 4; c++) {
      const pos = V(pt[0], pt[1], pt[2]).addScaledVector(randUnit(), 0.8);
      e.set(rng() * 6.283, rng() * 6.283, rng() * 6.283);
      q.setFromEuler(e);
      const size = rand(2.4, 3.4);
      const n0 = V(0, 0, 1).applyQuaternion(q);
      const rad = pos.clone().sub(V(cx, cy, cz)).normalize();
      if (n0.dot(rad) < 0) n0.negate();
      const nrm = rad.multiplyScalar(0.7).addScaledVector(n0, 0.3).normalize();
      const shade = rand(0.75, 1.1) + 0.15 * (pos.y / maxY);
      const base = lp.length / 3;
      corners.forEach((cn) => {
        const v = V(cn[0] * size, cn[1] * size, 0).applyQuaternion(q).add(pos);
        lp.push(v.x, v.y, v.z);
        ln.push(nrm.x, nrm.y, nrm.z);
        lu.push(cn[0] + 0.5, cn[1] + 0.5);
        lc.push(shade, shade, shade);
      });
      li.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  });
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  lg.setAttribute('normal', new THREE.Float32BufferAttribute(ln, 3));
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(lu, 2));
  lg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
  lg.setIndex(new THREE.BufferAttribute(new Uint32Array(li), 1));
  return { bark: g, leaf: lg };
}

// ---------------------------------------------------------------------------------------------
// shared assets (built once, on first use)
// ---------------------------------------------------------------------------------------------

const LEAF_COLS = ['#4a8a2e', '#3f7d2a', '#5a9a34', '#6aa83a', '#3a7426'].map((c) => new THREE.Color(c));

interface Assets {
  oaks: OakGeo[];
  barkMat: THREE.MeshLambertMaterial;
  leafMat: THREE.MeshLambertMaterial;
  leafDepth: THREE.MeshDepthMaterial;
  canopyG: THREE.BufferGeometry;
  trunkG: THREE.BufferGeometry;
  proxyLeafMat: THREE.MeshLambertMaterial;
  proxyBarkMat: THREE.MeshLambertMaterial;
  tuftG: THREE.BufferGeometry;
  grassMat: THREE.MeshLambertMaterial;
}

let assets: Assets | null = null;

function getAssets(): Assets {
  if (assets) return assets;
  const barkTex = makeBark();
  const leafTex = makeLeaf();
  const barkMat = new THREE.MeshLambertMaterial({ map: barkTex });
  const leafMat = new THREE.MeshLambertMaterial({ map: leafTex, alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true });
  const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTex, alphaTest: 0.42 });
  addTreeWind(barkMat, false);
  addTreeWind(leafMat, true);

  const oaks = [1, 2, 3, 4].map((k) => makeOak((0x5eed1a7 ^ (k * 0x45d9f3b)) | 0));

  // far-away proxy: a few round blobs + a stump
  const blobs = [
    [4.6, 0, 7.4, 0, 1, 0.9, 1],
    [3.2, 3.2, 6.2, 0.8, 1, 1, 1],
    [3.2, -2.8, 6.0, -1.4, 1, 1, 1],
    [2.8, 0.6, 9.6, -1.8, 1, 1, 1],
  ];
  const cArr: number[] = [];
  const nArr: number[] = [];
  const pcArr: number[] = [];
  blobs.forEach((b) => {
    const g = new THREE.IcosahedronGeometry(b[0], 1);
    g.scale(b[4], b[5], b[6]);
    g.translate(b[1], b[2], b[3]);
    const a = g.attributes.position.array as Float32Array;
    for (let i = 0; i < a.length; i += 3) {
      const nx = a[i] - b[1];
      const ny = a[i + 1] - b[2];
      const nz = a[i + 2] - b[3];
      const l = Math.hypot(nx, ny, nz) || 1;
      const sh = 0.7 + 0.4 * Math.min(1, Math.max(0, (a[i + 1] - 3) / 8));
      cArr.push(a[i], a[i + 1], a[i + 2]);
      nArr.push(nx / l, ny / l, nz / l);
      pcArr.push(sh, sh, sh);
    }
    g.dispose();
  });
  const canopyG = new THREE.BufferGeometry();
  canopyG.setAttribute('position', new THREE.Float32BufferAttribute(cArr, 3));
  canopyG.setAttribute('normal', new THREE.Float32BufferAttribute(nArr, 3));
  canopyG.setAttribute('color', new THREE.Float32BufferAttribute(pcArr, 3));
  const trunkG = new THREE.CylinderGeometry(0.8, 1.4, 6, 5, 1);
  trunkG.translate(0, 2.6, 0);

  // grass tuft: two crossed blades, darker at the root
  const pos: number[] = [];
  const col: number[] = [];
  for (let b = 0; b < 2; b++) {
    const a = (b * Math.PI) / 2 + 0.4;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const w = 0.13;
    const bend = 0.07;
    pos.push(-c * w, 0, -sn * w, c * w, 0, sn * w, sn * bend, 0.5, -c * bend);
    col.push(0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 1, 1, 1);
  }
  const tuftG = new THREE.BufferGeometry();
  tuftG.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tuftG.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  tuftG.computeVertexNormals();
  const grassMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  addGrassWind(grassMat);

  assets = {
    oaks,
    barkMat,
    leafMat,
    leafDepth,
    canopyG,
    trunkG,
    proxyLeafMat: new THREE.MeshLambertMaterial({ vertexColors: true }),
    proxyBarkMat: new THREE.MeshLambertMaterial({ color: 0x5a4330 }),
    tuftG,
    grassMat,
  };
  return assets;
}

// ---------------------------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------------------------

const _o = new THREE.Object3D();
const _c = new THREE.Color();

function leafColour(tint: number): THREE.Color {
  const idx = Math.floor((tint * 4 - Math.floor(tint * 4)) * LEAF_COLS.length) % LEAF_COLS.length;
  const k = 1.4 * (0.9 + 0.2 * ((tint * 977) % 1));
  return _c.copy(LEAF_COLS[idx]).multiplyScalar(k);
}

/**
 * Oaks for one streamed cell. `near` cells get the full tree (bark + leaf cards, casts shadows);
 * far cells get the cheap round proxy so the horizon stays full without the triangle cost.
 */
/** Fraction of trees that survive (0.4% => 95% of the previous 8%, i.e. 99.6% of all planted trees, removed). Deterministic per position so near/far cells agree. */
export const TREE_KEEP_FRACTION = 0.004;
function keepTree(s: OakSpec): boolean {
  let h = Math.imul(Math.round(s.x * 10) | 0, 73856093) ^ Math.imul(Math.round(s.z * 10) | 0, 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) % 10000) / 10000 < TREE_KEEP_FRACTION;
}

export function buildOaks(allSpecs: OakSpec[], near: boolean): Built | null {
  const specs = allSpecs.filter(keepTree);
  if (!specs.length) return null;
  const A = getAssets();
  const group = new THREE.Group();
  group.name = near ? 'oaks' : 'oaks_far';
  const disposables: { dispose(): void }[] = [];

  const place = (s: OakSpec): THREE.Matrix4 => {
    _o.position.set(s.x, s.y, s.z);
    _o.rotation.set(0, s.rot, 0);
    const ys = 0.95 + 0.15 * ((s.tint * 313) % 1);
    _o.scale.set(s.s, s.s * ys, s.s);
    _o.updateMatrix();
    return _o.matrix;
  };

  if (!near) {
    const cm = new THREE.InstancedMesh(A.canopyG, A.proxyLeafMat, specs.length);
    const tm = new THREE.InstancedMesh(A.trunkG, A.proxyBarkMat, specs.length);
    specs.forEach((s, i) => {
      const m = place(s);
      cm.setMatrixAt(i, m);
      tm.setMatrixAt(i, m);
      cm.setColorAt(i, leafColour(s.tint));
    });
    [cm, tm].forEach((m) => {
      m.computeBoundingSphere();
      group.add(m);
      disposables.push(m);
    });
    return { group, disposables };
  }

  const slots: OakSpec[][] = [[], [], [], []];
  specs.forEach((s) => slots[Math.floor(s.tint * 4) % 4].push(s));
  slots.forEach((list, v) => {
    if (!list.length) return;
    const bm = new THREE.InstancedMesh(A.oaks[v].bark, A.barkMat, list.length);
    const lm = new THREE.InstancedMesh(A.oaks[v].leaf, A.leafMat, list.length);
    lm.customDepthMaterial = A.leafDepth;
    list.forEach((s, i) => {
      const m = place(s);
      bm.setMatrixAt(i, m);
      lm.setMatrixAt(i, m);
      lm.setColorAt(i, leafColour(s.tint));
    });
    [bm, lm].forEach((m) => {
      m.castShadow = true;
      m.receiveShadow = true;
      m.computeBoundingSphere();
      group.add(m);
      disposables.push(m);
    });
  });
  return { group, disposables };
}

const GRASS_LO = new THREE.Color('#506629');
const GRASS_HI = new THREE.Color('#718239');

/** Short grass tufts that sway in the wind (fade out by scale beyond ~110 m, like the prototype) */
export function buildTufts(specs: TuftSpec[]): Built | null {
  if (!specs.length) return null;
  const A = getAssets();
  const mesh = new THREE.InstancedMesh(A.tuftG, A.grassMat, specs.length);
  mesh.name = 'grass_tufts';
  specs.forEach((s, i) => {
    _o.position.set(s.x, s.y - 0.03, s.z);
    _o.rotation.set(0, s.rot, 0);
    _o.scale.set(s.s, s.s * (0.8 + 0.4 * ((s.tint * 211) % 1)), s.s);
    _o.updateMatrix();
    mesh.setMatrixAt(i, _o.matrix);
    _c.copy(GRASS_LO).lerp(GRASS_HI, s.tint).multiplyScalar(0.9 + 0.25 * ((s.tint * 733) % 1));
    mesh.setColorAt(i, _c);
  });
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  const group = new THREE.Group();
  group.add(mesh);
  return { group, disposables: [mesh] };
}
