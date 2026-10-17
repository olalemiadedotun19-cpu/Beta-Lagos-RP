import * as THREE from 'three';

/** Deterministic RNG (mulberry32) so the same route always looks the same. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Shared unit primitives - cloned + transformed per piece, merged per batch.
let unitBox: THREE.BufferGeometry | null = null;
let unitCyl: THREE.BufferGeometry | null = null;
let unitSphere: THREE.BufferGeometry | null = null;
let unitCone: THREE.BufferGeometry | null = null;
let unitPyramid: THREE.BufferGeometry | null = null;

export function getUnitGeometries() {
  return units();
}

function units() {
  if (!unitBox) {
    unitBox = new THREE.BoxGeometry(1, 1, 1);
    unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10);
    unitSphere = new THREE.SphereGeometry(1, 8, 6);
    unitCone = new THREE.ConeGeometry(1, 1, 8);
    unitPyramid = new THREE.ConeGeometry(1, 1, 4);
  }
  return { box: unitBox!, cyl: unitCyl!, sphere: unitSphere!, cone: unitCone!, pyramid: unitPyramid! };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _n = new THREE.Matrix3();

export interface PieceOptions {
  rotY?: number;
  rotX?: number;
  rotZ?: number;
  /** use the vertex colours already stored in the base geometry (merged prop geometries) */
  ownColors?: boolean;
  /** Axis-aligned boxes only: tile a facade texture (tile width/height in metres, bottom of box = v 0) */
  tile?: [number, number];
  /** shift the tiled texture by this many metres (u, v): a whole number of bays / floors keeps the windows where the trim expects them */
  tileOff?: [number, number];
}

/**
 * GeoBatch collects many coloured primitives and writes them straight into ONE merged geometry
 * with vertex colours - the key to keeping the travel corridor cheap on mobile GPUs. Vertices are
 * transformed directly into growing typed arrays (no per-piece geometry clones), so rebuilding a
 * recycled chunk costs well under a millisecond or two.
 */
export class GeoBatch {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private uvs: number[] = [];
  private groupM: THREE.Matrix4 | null = null;
  private groupN: THREE.Matrix3 | null = null;
  private indices: number[] = [];
  private vertexCount = 0;

  private push(
    base: THREE.BufferGeometry,
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
    color: number | string,
    opts?: PieceOptions
  ): void {
    _e.set(opts?.rotX ?? 0, opts?.rotY ?? 0, opts?.rotZ ?? 0);
    _q.setFromEuler(_e);
    _pos.set(x, y, z);
    _scl.set(sx, sy, sz);
    _m.compose(_pos, _q, _scl);
    _n.getNormalMatrix(_m);
    _c.set(color as THREE.ColorRepresentation);

    const pa = base.attributes.position.array as ArrayLike<number>;
    const na = base.attributes.normal.array as ArrayLike<number>;
    const count = base.attributes.position.count;
    const me = _m.elements;
    const ne = _n.elements;

    const G = this.groupM;
    const GN = this.groupN;
    const ge = G ? G.elements : null;
    const gne = GN ? GN.elements : null;
    const own = opts?.ownColors ? (base.attributes.color.array as ArrayLike<number>) : null;

    for (let i = 0; i < count; i++) {
      const px = pa[i * 3];
      const py = pa[i * 3 + 1];
      const pz = pa[i * 3 + 2];
      // local (pre-group) position & normal
      const lx = me[0] * px + me[4] * py + me[8] * pz + me[12];
      const ly = me[1] * px + me[5] * py + me[9] * pz + me[13];
      const lz = me[2] * px + me[6] * py + me[10] * pz + me[14];
      const nx = na[i * 3];
      const ny = na[i * 3 + 1];
      const nz = na[i * 3 + 2];
      let tx = ne[0] * nx + ne[3] * ny + ne[6] * nz;
      let ty = ne[1] * nx + ne[4] * ny + ne[7] * nz;
      let tz = ne[2] * nx + ne[5] * ny + ne[8] * nz;
      const len = Math.hypot(tx, ty, tz) || 1;
      tx /= len;
      ty /= len;
      tz /= len;

      // facade UVs are computed in LOCAL space so a group transform (rotation/translation) never changes them
      if (opts?.tile) {
        const ou = (opts.tileOff?.[0] ?? 0) / opts.tile[0];
        const ov = (opts.tileOff?.[1] ?? 0) / opts.tile[1];
        if (Math.abs(ty) > 0.5) {
          this.uvs.push(0.012, 0.012);
        } else if (Math.abs(tz) > Math.abs(tx)) {
          this.uvs.push((lx - x + sx / 2) / opts.tile[0] + ou, (ly - (y - sy / 2)) / opts.tile[1] + ov);
        } else {
          this.uvs.push((lz - z + sz / 2) / opts.tile[0] + ou, (ly - (y - sy / 2)) / opts.tile[1] + ov);
        }
      } else {
        this.uvs.push(0.012, 0.012);
      }

      if (ge && gne) {
        this.positions.push(
          ge[0] * lx + ge[4] * ly + ge[8] * lz + ge[12],
          ge[1] * lx + ge[5] * ly + ge[9] * lz + ge[13],
          ge[2] * lx + ge[6] * ly + ge[10] * lz + ge[14]
        );
        const gx = gne[0] * tx + gne[3] * ty + gne[6] * tz;
        const gy = gne[1] * tx + gne[4] * ty + gne[7] * tz;
        const gz = gne[2] * tx + gne[5] * ty + gne[8] * tz;
        this.normals.push(gx, gy, gz);
      } else {
        this.positions.push(lx, ly, lz);
        this.normals.push(tx, ty, tz);
      }
      if (own) this.colors.push(own[i * 3], own[i * 3 + 1], own[i * 3 + 2]);
      else this.colors.push(_c.r, _c.g, _c.b);
    }

    const idx = base.index!.array as ArrayLike<number>;
    for (let i = 0; i < idx.length; i++) this.indices.push(idx[i] + this.vertexCount);
    this.vertexCount += count;
  }

  /**
   * Everything added after this call is placed through a rigid transform (rotY about the origin,
   * then translated to tx,tz). Lets one local-space building kit be stamped along any road.
   */
  setGroupTransform(rotY: number, tx: number, tz: number): void {
    const m = new THREE.Matrix4().makeRotationY(rotY);
    m.setPosition(tx, 0, tz);
    this.groupM = m;
    this.groupN = new THREE.Matrix3().getNormalMatrix(m);
  }

  clearGroupTransform(): void {
    this.groupM = null;
    this.groupN = null;
  }

  /** where a local (x, z) lands through the current group transform (unchanged when none is set) */
  worldPoint(x: number, z: number): [number, number] {
    if (!this.groupM) return [x, z];
    const v = new THREE.Vector3(x, 0, z).applyMatrix4(this.groupM);
    return [v.x, v.z];
  }

  /** rotation about Y that the current group transform adds */
  worldRotY(): number {
    if (!this.groupM) return 0;
    return Math.atan2(-this.groupM.elements[2], this.groupM.elements[0]);
  }

  /** Append a pre-built merged geometry (with its own vertex colours) at x,z facing rotY */
  addGeometry(base: THREE.BufferGeometry, x: number, y: number, z: number, rotY: number, scaleY = 1): void {
    this.push(base, 1, scaleY, 1, x, y, z, '#ffffff', { rotY, ownColors: true });
  }

  /** Box centred at x,y,z (y = vertical centre) */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number | string, opts?: PieceOptions): void {
    this.push(units().box, w, h, d, x, y, z, color, opts);
  }

  /** Vertical cylinder (radius r, height h) centred at x,y,z */
  cyl(r: number, h: number, x: number, y: number, z: number, color: number | string, opts?: PieceOptions): void {
    this.push(units().cyl, r, h, r, x, y, z, color, opts);
  }

  sphere(rx: number, ry: number, rz: number, x: number, y: number, z: number, color: number | string): void {
    this.push(units().sphere, rx, ry, rz, x, y, z, color);
  }

  cone(r: number, h: number, x: number, y: number, z: number, color: number | string): void {
    this.push(units().cone, r, h, r, x, y, z, color);
  }

  /** Square-based hip roof / pyramid: footprint w x d, height h, centred at x,z (y = vertical centre) */
  pyramid(w: number, h: number, d: number, x: number, y: number, z: number, color: number | string): void {
    this.push(units().pyramid, w / Math.SQRT2, h, d / Math.SQRT2, x, y, z, color, { rotY: Math.PI / 4 });
  }

  /**
   * Flat polygon (3 or more points, counter-clockwise seen from the front) with optional explicit UVs. The normal comes from the
   * winding; the group transform is applied like every other piece. Used for sloped roof planes, soffits and railing panels.
   */
  poly(pts: ReadonlyArray<readonly [number, number, number]>, color: number | string, uvs?: ReadonlyArray<readonly [number, number]>): void {
    const n = pts.length;
    if (n < 3) return;
    const ax = pts[1][0] - pts[0][0];
    const ay = pts[1][1] - pts[0][1];
    const az = pts[1][2] - pts[0][2];
    const bx = pts[2][0] - pts[0][0];
    const by = pts[2][1] - pts[0][1];
    const bz = pts[2][2] - pts[0][2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    _c.set(color as THREE.ColorRepresentation);
    const G = this.groupM;
    const GN = this.groupN;
    let gnx = nx;
    let gny = ny;
    let gnz = nz;
    if (GN) {
      const e = GN.elements;
      gnx = e[0] * nx + e[3] * ny + e[6] * nz;
      gny = e[1] * nx + e[4] * ny + e[7] * nz;
      gnz = e[2] * nx + e[5] * ny + e[8] * nz;
    }
    for (let i = 0; i < n; i++) {
      let [px, py, pz] = pts[i];
      if (G) {
        const e = G.elements;
        const X = e[0] * px + e[4] * py + e[8] * pz + e[12];
        const Y = e[1] * px + e[5] * py + e[9] * pz + e[13];
        const Z = e[2] * px + e[6] * py + e[10] * pz + e[14];
        px = X;
        py = Y;
        pz = Z;
      }
      this.positions.push(px, py, pz);
      this.normals.push(gnx, gny, gnz);
      this.colors.push(_c.r, _c.g, _c.b);
      if (uvs) this.uvs.push(uvs[i][0], uvs[i][1]);
      else this.uvs.push(0.012, 0.012);
    }
    for (let i = 1; i < n - 1; i++) this.indices.push(this.vertexCount, this.vertexCount + i, this.vertexCount + i + 1);
    this.vertexCount += n;
  }

  get isEmpty(): boolean {
    return this.vertexCount === 0;
  }

  build(): THREE.BufferGeometry | null {
    if (this.vertexCount === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.positions), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.normals), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.colors), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uvs), 2));
    const IndexArray = this.vertexCount > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new THREE.BufferAttribute(new IndexArray(this.indices), 1));
    g.computeBoundingSphere();
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.uvs = [];
    this.indices = [];
    this.vertexCount = 0;
    return g;
  }
}

/** Shared materials (vertex coloured) - created once */
let solidMat: THREE.MeshLambertMaterial | null = null;
let glowMat: THREE.MeshBasicMaterial | null = null;
let windowMat: THREE.MeshLambertMaterial | null = null;

export function getSolidMaterial(): THREE.MeshLambertMaterial {
  if (!solidMat) solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  return solidMat;
}

/** Self-lit parts: lamp heads, tail lights, signal lights */
export function getGlowMaterial(): THREE.MeshBasicMaterial {
  if (!glowMat) glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  return glowMat;
}

/** Windows: dark glass by day, warm light at night (intensity toggled by setNightMode) */
export function getWindowMaterial(): THREE.MeshLambertMaterial {
  if (!windowMat) {
    windowMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      emissive: new THREE.Color(0xffd27a),
      emissiveIntensity: 0.0,
    });
  }
  return windowMat;
}

export function setNightMode(isNight: boolean): void {
  getWindowMaterial().emissiveIntensity = isNight ? 0.85 : 0.0;
}

export function disposeSharedMaterials(): void {
  solidMat?.dispose();
  glowMat?.dispose();
  windowMat?.dispose();
  solidMat = null;
  glowMat = null;
  windowMat = null;
}

export function makeBatchMesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.matrixAutoUpdate = true;
  return mesh;
}

/** Canvas-drawn sign (destination facade, gantry signs) */
export function makeSignTexture(
  text: string,
  sub: string | undefined,
  bg: string,
  fg: string,
  width = 512,
  height = 128
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, width - 12, height - 12);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = sub ? 52 : 62;
  ctx.font = `bold ${size}px sans-serif`;
  while (ctx.measureText(text).width > width - 40 && size > 20) {
    size -= 4;
    ctx.font = `bold ${size}px sans-serif`;
  }
  ctx.fillText(text, width / 2, sub ? height * 0.38 : height / 2);
  if (sub) {
    ctx.font = '600 28px sans-serif';
    ctx.globalAlpha = 0.85;
    ctx.fillText(sub, width / 2, height * 0.78);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
