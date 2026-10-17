import * as THREE from 'three';
import { onTextureLevel } from '../graphics/GraphicsSettings';
import { buildDirtDetail, buildGrassDetail, buildRockDetail, type DetailMap } from './GroundDetail';

/**
 * Ground + water look ported from the "Terrain Road" prototype.
 *
 *   - grass / rock / dirt  tileable NEUTRAL detail maps with albedo + height (GroundDetail.ts); the hue comes from the shader / splat weights
 *   - applyTerrainShader   world-space dual-scale grass, triplanar rock, dirt, per-pixel bump lighting, natural colour patches
 *   - createGroundMaterial flat ground under the city (grass only)
 *   - createTerrainMaterial hills of the curved-road chunks (grass / rock / dirt blended by the `splat` attribute)
 *   - createWaterMaterial  animated ripple normals, sky reflection, sun glints, depth colour, shoreline foam
 *
 * WorldRenderer drives `waterUniforms` (time, sun, daylight, sky colour) every frame.
 */

/** shared uniform objects: written by WorldRenderer, read by every water material */
export const waterUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.55, 0.75, 0.35).normalize() },
  /** 1 = full day .. 0 = full night */
  uLight: { value: 1 },
  /** current sky colour in display (sRGB) space */
  uSky: { value: new THREE.Vector3(0.53, 0.81, 0.92) },
  /** water detail from the Textures setting: 0 = three big waves, plain foam (Low) .. 1 = + one fine wave (Medium) .. 2 = everything (High / Ultra) */
  uQ: { value: 2 },
};

// ---------------------------------------------------------------------------------------------
// detail textures (RGBA: R albedo multiplier, G height for bump lighting, B grass dry-blade mask; built in GroundDetail.ts)
// ---------------------------------------------------------------------------------------------

function toTexture(m: DetailMap): THREE.DataTexture {
  const t = new THREE.DataTexture(m.data, m.size, m.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t; // NoColorSpace on purpose: raw multipliers / heights, not colours
}

let detail: { grass: THREE.DataTexture; rock: THREE.DataTexture; dirt: THREE.DataTexture } | null = null;
function getDetail() {
  if (!detail) {
    detail = {
      grass: toTexture(buildGrassDetail(GRASS_TEX)),
      rock: toTexture(buildRockDetail(ROCK_TEX)),
      dirt: toTexture(buildDirtDetail(DIRT_TEX)),
    };
  }
  return detail;
}

// ---------------------------------------------------------------------------------------------
// ground / terrain shader (patches a MeshLambertMaterial so lights, shadows and fog keep working)
//
// What makes it read as real ground instead of a flat painted colour:
//   1. albedo detail from real blade / stone / soil maps (two scales, the big one rotated so no grid is ever visible)
//   2. per-pixel BUMP: the height channel tilts the normal, so the sun and sky light pick out individual tufts and stones
//   3. natural colour: desaturated, patchy (dry straw, dark damp, lush), with per-blade yellow / green variation
//   4. metre-scale mottling that stays on at a distance, so the ground never fades to a flat colour
// ---------------------------------------------------------------------------------------------

const GRASS_TEX = 512;
const ROCK_TEX = 256;
const DIRT_TEX = 256;

const GRASS_A = new THREE.Color('#4b5f2a');
const GRASS_B = new THREE.Color('#6a7b38');
const GRASS_DRY = new THREE.Color('#948f57');
const GRASS_DARK = new THREE.Color('#33431f');
const ROCK_A = new THREE.Color('#5d5a54');
const ROCK_B = new THREE.Color('#8a857b');
const DIRT = new THREE.Color('#6b5a40');

/**
 * Texture quality for the ground: 1 = the detailed grass / rock / soil shader, 0 (Low) = smooth plain colour per ground type
 * (no noise, no detail images, no bump: the pixel shader is a fraction of the cost). A uniform shared by every ground material,
 * so switching the setting is instant and recompiles nothing.
 */
export const terrainDetailQ = { value: 1 };
onTextureLevel((lv) => {
  terrainDetailQ.value = lv >= 1 ? 1 : 0;
  waterUniforms.uQ.value = lv >= 2 ? 2 : lv;
});

function applyTerrainShader(mat: THREE.MeshLambertMaterial, withSplat: boolean): void {
  mat.defines = { ...(mat.defines ?? {}) };
  if (withSplat) mat.defines.USE_SPLAT = 1;
  mat.customProgramCacheKey = () => (withSplat ? 'il-terrain-splat-v2' : 'il-terrain-flat-v2');
  mat.onBeforeCompile = (sh) => {
    const d = getDetail();
    sh.uniforms.tGrass = { value: d.grass };
    sh.uniforms.tRock = { value: d.rock };
    sh.uniforms.tDirt = { value: d.dirt };
    sh.uniforms.uGA = { value: GRASS_A };
    sh.uniforms.uGB = { value: GRASS_B };
    sh.uniforms.uGDry = { value: GRASS_DRY };
    sh.uniforms.uGDark = { value: GRASS_DARK };
    sh.uniforms.uRA = { value: ROCK_A };
    sh.uniforms.uRB = { value: ROCK_B };
    sh.uniforms.uDirt = { value: DIRT };
    sh.uniforms.uDetailQ = terrainDetailQ;

    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
#ifdef USE_SPLAT
attribute vec4 splat;
varying vec4 vSplat;
#endif
varying vec3 vWPos;
varying vec3 vWNrm;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_SPLAT
vSplat = splat;
#endif
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D tGrass;
uniform sampler2D tRock;
uniform sampler2D tDirt;
uniform vec3 uGA; uniform vec3 uGB; uniform vec3 uGDry; uniform vec3 uGDark;
uniform vec3 uRA; uniform vec3 uRB; uniform vec3 uDirt;
uniform float uDetailQ;
#ifdef USE_SPLAT
varying vec4 vSplat;
#endif
varying vec3 vWPos;
varying vec3 vWNrm;
// world-space bump (x, z slope offsets) written by the ground code, applied to the shading normal below
vec3 gBumpW = vec3(0.0);
float tHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tNoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
const mat2 T_ROT = mat2(0.8, -0.6, 0.6, 0.8);`,
      )
      .replace(
        '#include <map_fragment>',
        `
vec3 wp = vWPos;
vec2 xz = wp.xz;
vec2 dX = dFdx(xz);
vec2 dY = dFdy(xz);
#ifdef USE_SPLAT
vec3 dXw = dFdx(wp);   // derivatives are taken here, outside every branch (they are undefined inside one)
vec3 dYw = dFdy(wp);
vec4 sp = vSplat;
#else
vec4 sp = vec4(1.0, 0.0, 0.0, 0.0);
#endif
float ws = sp.x + sp.y + sp.w + 0.0001;
float camD = length(cameraPosition - wp);
float fadeD = smoothstep(35.0, 200.0, camD);        // fine detail averages out with distance
float nearK = 1.0 - smoothstep(4.0, 38.0, camD);   // bump lighting only where it can be seen

vec3 baseC;
if (uDetailQ > 0.5) {
// ---- base colour: patchy meadow, desaturated, never one flat tone
float gn = tNoise(xz * 0.02) * 0.5 + tNoise(xz * 0.07) * 0.3 + tNoise(xz * 0.23) * 0.2;
float pn = tNoise(xz * 0.004 + 5.0);
vec3 gcol = mix(uGA, uGB, gn);
gcol = mix(gcol, uGDry, smoothstep(0.45, 0.8, pn) * 0.7);
gcol = mix(gcol, uGDark, smoothstep(0.55, 0.85, 1.0 - pn) * 0.5);
// metre-scale mottling stays on at any distance: this is what stops the ground reading as a flat fill
float mot = tNoise(xz * 0.9 + 11.0) * 0.6 + tNoise(xz * 2.6 + 3.0) * 0.4;
gcol *= 0.84 + 0.32 * mot;
vec3 rcol = mix(uRA, uRB, tNoise(xz * 0.08) * 0.7 + tNoise(xz * 0.5) * 0.3);
vec3 dcol = uDirt * (0.85 + 0.3 * mot);
baseC = (gcol * sp.x + rcol * sp.y + dcol * sp.w) / ws;
} else {
  // Low textures: one smooth plain colour per ground type
  baseC = (mix(uGA, uGB, 0.5) * sp.x + mix(uRA, uRB, 0.5) * sp.y + uDirt * sp.w) / ws;
}

// ---- detail albedo + bump
vec3 det = vec3(1.0);
vec3 tint = vec3(1.0);
if (uDetailQ > 0.5 && fadeD < 0.995) {
  vec3 acc = vec3(0.0);
  vec3 tnt = vec3(0.0);
  vec2 bump = vec2(0.0);   // slope offset in world x / z

  if (sp.x > 0.02) {
    vec2 uv1 = xz * 0.16;
    vec2 uv2 = T_ROT * xz * 0.03 + vec2(0.37, 0.11);
    vec4 g1 = textureGrad(tGrass, uv1, dX * 0.16, dY * 0.16);
    vec4 g2 = textureGrad(tGrass, uv2, T_ROT * dX * 0.03, T_ROT * dY * 0.03);
    acc += vec3(g1.r * g2.r * 4.0) * sp.x;
    float dry = smoothstep(0.3, 0.9, g1.b);
    tnt += mix(vec3(0.94, 1.05, 0.88), vec3(1.45, 1.15, 0.6), dry * 0.75) * sp.x;
    if (nearK > 0.01) {
      const float E = 1.0 / 512.0;
      float hx = textureGrad(tGrass, uv1 + vec2(E, 0.0), dX * 0.16, dY * 0.16).g;
      float hz = textureGrad(tGrass, uv1 + vec2(0.0, E), dX * 0.16, dY * 0.16).g;
      bump += (vec2(hx, hz) - g1.g) * (-512.0 * 0.16 * 0.012) * sp.x;
    }
  }
#ifdef USE_SPLAT
  if (sp.w > 0.02) {
    vec2 uv1 = xz * 0.22;
    vec2 uv2 = T_ROT * xz * 0.06 + vec2(0.21, 0.53);
    vec4 t1 = textureGrad(tDirt, uv1, dX * 0.22, dY * 0.22);
    vec4 t2 = textureGrad(tDirt, uv2, T_ROT * dX * 0.06, T_ROT * dY * 0.06);
    acc += vec3(t1.r * t2.r * 4.0) * sp.w;
    tnt += vec3(1.0) * sp.w;
    if (nearK > 0.01) {
      const float E = 1.0 / 256.0;
      float hx = textureGrad(tDirt, uv1 + vec2(E, 0.0), dX * 0.22, dY * 0.22).g;
      float hz = textureGrad(tDirt, uv1 + vec2(0.0, E), dX * 0.22, dY * 0.22).g;
      bump += (vec2(hx, hz) - t1.g) * (-256.0 * 0.22 * 0.011) * sp.w;
    }
  }
  if (sp.y > 0.02) {
    vec3 tn = pow(abs(normalize(vWNrm)), vec3(4.0)); tn /= (tn.x + tn.y + tn.z);
    bool sideX = tn.x > tn.z;
    vec2 sUV = sideX ? wp.zy : wp.xy;
    vec2 sDX = sideX ? dXw.zy : dXw.xy;
    vec2 sDY = sideX ? dYw.zy : dYw.xy;
    vec4 rTop = textureGrad(tRock, xz * 0.06, dX * 0.06, dY * 0.06);
    vec4 rSide = textureGrad(tRock, sUV * 0.06, sDX * 0.06, sDY * 0.06);
    float rBig = textureGrad(tRock, xz * 0.021 + vec2(0.4, 0.7), dX * 0.021, dY * 0.021).g;
    vec3 rk = vec3(rTop.r * tn.y + rSide.r * (1.0 - tn.y)) * 2.0;
    rk *= 0.7 + 0.6 * rBig;
    acc += rk * sp.y;
    tnt += vec3(1.0) * sp.y;
    if (nearK > 0.01) {
      const float E = 1.0 / 256.0;
      float hx = textureGrad(tRock, xz * 0.06 + vec2(E, 0.0), dX * 0.06, dY * 0.06).g;
      float hz = textureGrad(tRock, xz * 0.06 + vec2(0.0, E), dX * 0.06, dY * 0.06).g;
      bump += (vec2(hx, hz) - rTop.g) * (-256.0 * 0.06 * 0.06) * tn.y * sp.y;
    }
  }
#endif
  float fineK = 1.0 - fadeD;
  det = mix(vec3(1.0), acc / ws, fineK);
  tint = mix(vec3(1.0), tnt / ws, fineK);
  bump = bump / ws;
  float bl = length(bump);
  bump *= min(1.0, 1.6 / max(bl, 1e-4)) * nearK;   // cap the slope so no pixel flips to a wall
  gBumpW = vec3(bump.x, 0.0, bump.y);
}
diffuseColor.rgb *= baseC * det * tint;
`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
if (dot(gBumpW, gBumpW) > 1e-8) normal = normalize(normal + (viewMatrix * vec4(gBumpW, 0.0)).xyz);`,
      );
  };
}

/** flat ground under the city / district roads (grass only) */
export function createGroundMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  applyTerrainShader(mat, false);
  return mat;
}

let lawnMat: THREE.MeshLambertMaterial | null = null;

/** shared grass material for lawns, pitches and meadows built as separate meshes (same world-space shader as the ground) */
export function getLawnMaterial(): THREE.MeshLambertMaterial {
  if (!lawnMat) lawnMat = createGroundMaterial();
  return lawnMat;
}

/**
 * Round pond for the water shader: rings out from the centre, `aDepth` 0 at the rim (shore foam, fades to
 * nothing) and `depth` in the middle, exactly like the lake of the Terrain Road prototype.
 */
export function makePondGeometry(cx: number, y: number, cz: number, r: number, depth = 3.4): THREE.BufferGeometry {
  const RINGS = 5;
  const SEGS = 32;
  const pos: number[] = [cx, y, cz];
  const dep: number[] = [depth];
  const idx: number[] = [];
  for (let k = 1; k <= RINGS; k++) {
    const t = k / RINGS;
    for (let i = 0; i < SEGS; i++) {
      const a = (i / SEGS) * Math.PI * 2;
      pos.push(cx + Math.cos(a) * r * t, y, cz + Math.sin(a) * r * t);
      dep.push(depth * (1 - t * t));
    }
  }
  for (let i = 0; i < SEGS; i++) idx.push(0, 1 + ((i + 1) % SEGS), 1 + i);
  for (let k = 1; k < RINGS; k++) {
    const a0 = 1 + (k - 1) * SEGS;
    const b0 = 1 + k * SEGS;
    for (let i = 0; i < SEGS; i++) {
      const i1 = (i + 1) % SEGS;
      idx.push(a0 + i, a0 + i1, b0 + i, a0 + i1, b0 + i1, b0 + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
  g.setIndex(idx);
  return g;
}

/** hills of the curved-road chunks: needs a vec4 `splat` attribute (grass, rock, unused, dirt) + vertex colours */
export function createTerrainMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  applyTerrainShader(mat, true);
  return mat;
}

// ---------------------------------------------------------------------------------------------
// water
// ---------------------------------------------------------------------------------------------

const WATER_VERT = /* glsl */ `
attribute float aDepth;
varying float vDepth;
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vDepth = aDepth;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform float uLight;
uniform vec3 uSky;
uniform float uQ;
varying float vDepth;
varying vec3 vW;
#include <fog_pars_fragment>
vec2 wv(vec2 p, vec2 d, float f, float a, float s) { return d * cos(dot(p, d) * f + uTime * s) * a; }
void main() {
  vec2 p = vW.xz;
  float dist = length(cameraPosition - vW);
  float far = 1.0 - smoothstep(80.0, 320.0, dist);
  vec2 g = wv(p, vec2(0.8, 0.6), 0.35, 0.05, 0.8) + wv(p, vec2(-0.5, 0.87), 0.62, 0.045, 1.1) + wv(p, vec2(0.97, -0.25), 1.1, 0.04, 1.5);
  if (uQ > 1.5) g += (wv(p, vec2(-0.9, -0.44), 2.3, 0.035, 2.2) + wv(p, vec2(0.3, 0.95), 4.1, 0.03, 2.9) + wv(p, vec2(-0.7, 0.71), 7.3, 0.025, 3.6)) * far;
  else if (uQ > 0.5) g += wv(p, vec2(-0.9, -0.44), 2.3, 0.035, 2.2) * far;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vW);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 r = reflect(-V, n);
  vec3 horizon = mix(vec3(0.80, 0.87, 0.91), uSky, 0.55);
  vec3 zenith = mix(vec3(0.31, 0.56, 0.86), uSky * 0.8, 0.4);
  vec3 sky = mix(horizon, zenith, smoothstep(0.0, 0.7, r.y));
  float d = max(vDepth, 0.0);
  vec3 body = mix(vec3(0.24, 0.58, 0.56), vec3(0.03, 0.17, 0.30), smoothstep(0.0, 7.0, d));
  vec3 L = normalize(uSunDir);
  float rl = max(dot(reflect(-L, n), V), 0.0);
  float spec = pow(rl, 220.0) * 1.6 + pow(rl, 30.0) * 0.12;
  vec3 col = mix(body, sky, clamp(fres + 0.08, 0.0, 1.0));
  float band = 1.0 - smoothstep(0.15, 1.1, vDepth);
  float foam = band * 0.5;
  if (uQ > 0.5) {
    float nz = sin(p.x * 1.7 + uTime * 0.6) * sin(p.y * 1.9 - uTime * 0.5) * 0.5 + 0.5;
    foam = band * smoothstep(0.35, 0.75, nz * 0.6 + 0.5 + 0.35 * sin(vDepth * 14.0 - uTime * 1.8));
  }
  foam = max(foam * 0.85, (1.0 - smoothstep(0.0, 0.25, vDepth)) * 0.6);
  col = mix(col, vec3(0.96, 0.98, 1.0), foam);
  float lk = mix(0.14, 1.0, uLight);
  col = col * lk + vec3(1.0, 0.95, 0.8) * spec * mix(0.25, 1.0, uLight);
  float alpha = mix(0.4, 0.95, smoothstep(0.0, 3.0, d));
  alpha = max(max(alpha, fres), foam * 0.9) * smoothstep(-0.05, 0.25, vDepth);
  gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(2.2)), alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

let waterMat: THREE.ShaderMaterial | null = null;

/** one shared material for every stream / river ribbon (needs an `aDepth` attribute: 0 at the shore, bigger mid-channel) */
export function createWaterMaterial(): THREE.ShaderMaterial {
  if (waterMat) return waterMat;
  waterMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    // spread (not UniformsUtils.merge) so the {value} objects stay shared with WorldRenderer
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...waterUniforms },
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
  });
  return waterMat;
}
