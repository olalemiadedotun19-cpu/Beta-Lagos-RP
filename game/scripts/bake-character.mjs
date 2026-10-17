/* NOTE: the locomotion pack (idle / walk / run / strafes / turns / jump) is baked on top of this by scripts/locomotion/bake_locomotion.py: run that AFTER this script.
 *
 * Bakes the player character assets from scripts/character-src into src/player/figure/assets.
 *   node scripts/bake-character.mjs
 * - figure.glb : the Mixamo-rigged body + leather jacket, with the jacket texture wired in properly
 * - clips.json : walk / run / offensive idle retargeted to the figure's skeleton (hips drift removed), the procedural relaxed idle,
 *                a jump / fall pose and a seated pose, plus the measured ground speed (m/s) of walk and run
 * The retarget is the same one the character viewer (index.html) does at load time, done once here instead of on every launch. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
globalThis.self = globalThis;
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'scripts/character-src');
const OUT = path.join(ROOT, 'src/player/figure/assets');
fs.mkdirSync(OUT, { recursive: true });
const toAB = (f) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

/* ---------------- 1. figure.glb: wire the jacket JPEG in as a real texture, drop nothing else ---------------- */
{
  const b = fs.readFileSync(path.join(SRC, 'figure-full.glb'));
  const jl = b.readUInt32LE(12);
  const g = JSON.parse(b.subarray(20, 20 + jl).toString().trim());
  if (!g.images) {
    const binStart = 20 + jl + 8;
    const g2 = JSON.parse(JSON.stringify(g));
    g2.images = [{ bufferView: 12, mimeType: 'image/jpeg' }];
    g2.textures = [{ source: 0, sampler: 0 }];
    g2.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    g2.materials[1].pbrMetallicRoughness.baseColorTexture = { index: 0 };
    const bin = b.subarray(binStart, binStart + g.buffers[0].byteLength);
    const js = Buffer.from(JSON.stringify(g2));
    const jp = (4 - (js.length % 4)) % 4;
    const jsonChunk = Buffer.concat([js, Buffer.alloc(jp, 0x20)]);
    const binPad = (4 - (bin.length % 4)) % 4;
    const binChunk = Buffer.concat([bin, Buffer.alloc(binPad)]);
    const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
    const head = Buffer.alloc(12 + 8);
    head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
    head.writeUInt32LE(jsonChunk.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
    const binHead = Buffer.alloc(8);
    binHead.writeUInt32LE(binChunk.length, 0); binHead.writeUInt32LE(0x004e4942, 4);
    fs.writeFileSync(path.join(OUT, 'figure.glb'), Buffer.concat([head, jsonChunk, binHead, binChunk]));
  }
  console.log('figure.glb', fs.statSync(path.join(OUT, 'figure.glb')).size, 'bytes');
}

/* ---------------- 2. retarget helpers (same maths as the viewer) ---------------- */
const norm = (s) => String(s || '').replace(/[^a-zA-Z0-9]/g, '').replace(/^mixamorig\d*/i, '').toLowerCase();
function boneMap(root) { const m = new Map(); root.traverse((o) => { if (o.name) { const k = norm(o.name); if (!m.has(k)) m.set(k, o); } }); return m; }
const legSum = (m) => { let e = 0; for (const k of ['upleg', 'leg', 'foot']) { const n = m.get(k); if (n) e += n.position.length(); } return e; };

const gltf = await new Promise((res, rej) => new GLTFLoader().parse(toAB(path.join(OUT, 'figure.glb')), '', res, rej));
const figure = gltf.scene;
figure.updateMatrixWorld(true);
const targetBones = boneMap(figure);
const hipsBone = targetBones.get('hips');
const hipsBind = hipsBone.position.clone();
/* rest pose of every bone (the figure's A-pose), needed by the procedural clips */
const REST = new Map(); figure.traverse((o) => { if (o.isBone) REST.set(o, { p: o.position.clone(), q: o.quaternion.clone() }); });
const resetPose = () => REST.forEach((v, b) => { b.position.copy(v.p); b.quaternion.copy(v.q); });

function retarget(clip, fbx) {
  fbx.updateMatrixWorld(true);
  const src = boneMap(fbx), dst = targetBones;
  const a = src.get('hips'), o = dst.get('hips');
  if (!a || !o) throw new Error('no Hips');
  const l = new THREE.Quaternion(); if (a.parent) a.parent.getWorldQuaternion(l);
  const c = a.position.clone();
  let u = c.y > 1e-6 ? hipsBind.y / c.y : 0;
  const h = legSum(src) > 1e-6 ? legSum(dst) / legSum(src) : 0;
  if (!(u > 0) || (h > 0 && Math.abs(u / h - 1) > 0.4)) u = h || 1;
  const tracks = []; const v = new THREE.Quaternion(), g = new THREE.Vector3();
  for (const t of clip.tracks) {
    const dot = t.name.lastIndexOf('.'); if (dot < 0) continue;
    const key = norm(t.name.slice(0, dot)), prop = t.name.slice(dot + 1), b = dst.get(key);
    if (!b || !b.isBone) continue;
    if (prop === 'quaternion') {
      const R = Float32Array.from(t.values);
      if (key === 'hips') for (let x = 0; x < R.length; x += 4) { v.fromArray(R, x).premultiply(l); v.toArray(R, x); }
      tracks.push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', Float32Array.from(t.times), R));
    } else if (prop === 'position' && key === 'hips') {
      const R = new Float32Array(t.values.length);
      for (let x = 0; x < R.length; x += 3) { g.fromArray(t.values, x).sub(c).applyQuaternion(l).multiplyScalar(u).add(hipsBind); g.toArray(R, x); }
      tracks.push(new THREE.VectorKeyframeTrack(b.name + '.position', Float32Array.from(t.times), R));
    }
  }
  return new THREE.AnimationClip(clip.name || 'anim', clip.duration, tracks);
}
/* remove the forward drift of the hips (the game moves the character), keep bob and sway */
function prep(clip) {
  const tr = clip.tracks.find((t) => t.name === hipsBone.name + '.position');
  if (tr) {
    const v = tr.values, n = v.length / 3, T = clip.duration || 1;
    const dx = v[(n - 1) * 3] - v[0], dz = v[(n - 1) * 3 + 2] - v[2];
    for (let i = 0; i < n; i++) { const f = tr.times[i] / T; v[i * 3] -= dx * f; v[i * 3 + 2] -= dz * f; }
  }
  return clip;
}
async function fromFbx(file) {
  const fbx = new FBXLoader().parse(toAB(path.join(SRC, file)), '');
  const src = fbx.animations.slice().sort((x, y) => y.tracks.length - x.tracks.length)[0];
  return prep(retarget(src, fbx));
}

/* ---------------- 3. measure the natural ground speed of a gait from the planted foot ---------------- */
const FOOT = ['leftfoot', 'rightfoot'].map((k) => targetBones.get(k));
function applyClipAt(clip, t) {
  resetPose();
  const mixerFree = (track) => {
    const dot = track.name.lastIndexOf('.'); const name = track.name.slice(0, dot), prop = track.name.slice(dot + 1);
    let bone = null; figure.traverse((o) => { if (o.name === name) bone = o; });
    return { bone, prop };
  };
  for (const tr of clip.tracks) {
    const { bone, prop } = mixerFree(tr); if (!bone) continue;
    const it = tr.createInterpolant(); const out = it.evaluate(t);
    if (prop === 'quaternion') bone.quaternion.fromArray(out); else bone.position.fromArray(out);
  }
  figure.updateMatrixWorld(true);
}
function stanceSpeed(clip) {
  const N = Math.max(60, Math.round(clip.duration * 120)), dt = clip.duration / N; const rows = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= N; i++) { applyClipAt(clip, i * dt); rows.push(FOOT.map((f) => { f.getWorldPosition(p); return { y: p.y, z: p.z }; })); }
  const sp = [];
  for (let i = 1; i <= N; i++) {
    const lo = rows[i][0].y < rows[i][1].y ? 0 : 1; // the lower foot is the planted one
    if (Math.min(rows[i][lo].y, rows[i - 1][lo].y) > 0.16) continue; // both feet in the air: no information
    sp.push(-(rows[i][lo].z - rows[i - 1][lo].z) / dt);
  }
  sp.sort((a, b) => a - b);
  return { median: sp[Math.floor(sp.length / 2)], mean: sp.reduce((a, b) => a + b, 0) / sp.length, n: sp.length };
}

/* ---------------- 4. procedural poses (relaxed idle, jump, seated) built from the figure's rest pose ---------------- */
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const Rq = (ax, a) => new THREE.Quaternion().setFromAxisAngle(ax, a);
const worldQ = (b) => { const q = new THREE.Quaternion(); b.getWorldQuaternion(q); return q; };
const B = (n) => targetBones.get(n);

/** A track that rotates bone `b` by world-space rotations `fn(t)` = [[axis, angle], ...] applied on top of its rest orientation. */
function poseTrack(b, times, fn, parentQ = worldQ(b.parent)) {
  const pInv = parentQ.clone().invert(), rest = REST.get(b).q.clone(), v = new Float32Array(times.length * 4);
  times.forEach((t, i) => {
    const W = new THREE.Quaternion(); fn(t).forEach((d) => W.premultiply(Rq(d[0], d[1])));
    const loc = pInv.clone().multiply(W).multiply(parentQ); loc.multiply(rest); loc.toArray(v, i * 4);
  });
  return new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, v);
}
/** world-orientation helper for chains: rotate a bone by `rots` in world space and tell its children what their parent's world quaternion is now */
function buildRelaxedIdle() {
  resetPose(); figure.updateMatrixWorld(true);
  const T = 4, N = 24, times = Float32Array.from({ length: N + 1 }, (_, i) => (T * i) / N), tracks = [];
  const ph = (2 * Math.PI) / T, s = (t, o = 0) => Math.sin(t * ph + o);
  const side = (pre, sgn) => {
    const sh = B(pre + 'shoulder'), ar = B(pre + 'arm'), fa = B(pre + 'forearm'), ha = B(pre + 'hand'); if (!ar || !fa) return;
    const v = fa.getWorldPosition(new THREE.Vector3()).sub(ar.getWorldPosition(new THREE.Vector3()));
    const phi = Math.atan2(Math.abs(v.x), -v.y), low = Math.max(0, phi - 0.17), lowAng = -sgn * low;
    if (sh) tracks.push(poseTrack(sh, times, (t) => [[AZ, -sgn * 0.05 + -sgn * 0.006 * s(t, 0.4)]]));
    tracks.push(poseTrack(ar, times, (t) => [[AZ, lowAng + -sgn * 0.012 * s(t, 0.8)], [AX, -0.04]]));
    const Wa = Rq(AX, -0.04).multiply(Rq(AZ, lowAng)), arNew = Wa.clone().multiply(worldQ(ar));
    tracks.push(poseTrack(fa, times, (t) => [[AX, -0.22 + 0.012 * s(t, 1.1)]], arNew));
    const faNew = Rq(AX, -0.22).multiply(Wa).multiply(worldQ(fa));
    if (ha) tracks.push(poseTrack(ha, times, (t) => [[AX, -0.1], [AZ, sgn * 0.03 * s(t, 1.7)]], faNew));
  };
  side('left', 1); side('right', -1);
  const hips = B('hips'), sp = B('spine'), s1 = B('spine1'), s2 = B('spine2'), nk = B('neck'), hd = B('head');
  if (hips) tracks.push(poseTrack(hips, times, (t) => [[AY, 0.018 * s(t, 0)], [AZ, 0.01 * s(t, 1.2)]]));
  if (sp) tracks.push(poseTrack(sp, times, (t) => [[AX, 0.008 * s(t, 0.2)], [AY, -0.012 * s(t, 0)]]));
  if (s1) tracks.push(poseTrack(s1, times, (t) => [[AX, -0.012 * s(t, 0.3)]]));
  if (s2) tracks.push(poseTrack(s2, times, (t) => [[AX, -0.018 * s(t, 0.5)], [AY, -0.01 * s(t, 0)]]));
  if (nk) tracks.push(poseTrack(nk, times, (t) => [[AX, 0.01 * s(t, 0.9)]]));
  if (hd) tracks.push(poseTrack(hd, times, (t) => [[AY, 0.05 * s(t, 0)], [AX, 0.006 * s(t, 1.4)]]));
  return new THREE.AnimationClip('idle', T, tracks);
}

/* ---- pose clips from absolute world rotations: W[boneKey] = rotation applied on top of that bone's REST world orientation; unlisted bones follow their parent ---- */
function solvePose(W) {
  const newWorld = new Map(), local = new Map();
  resetPose(); figure.updateMatrixWorld(true);
  const restWorld = new Map(); figure.traverse((o) => { if (o.isBone) restWorld.set(o, worldQ(o)); });
  const visit = (b, parentNew) => {
    const key = norm(b.name), rest = REST.get(b).q;
    let nw;
    if (W[key]) nw = W[key].clone().multiply(restWorld.get(b));
    else nw = parentNew.clone().multiply(rest);
    local.set(b, parentNew.clone().invert().multiply(nw)); newWorld.set(b, nw);
    b.children.forEach((c) => { if (c.isBone) visit(c, nw); });
  };
  visit(hipsBone, worldQ(hipsBone.parent));
  return local;
}
function poseClip(name, times, fn, hipsFn) {
  const perT = times.map((t) => solvePose(fn(t)));
  const keys = new Set(); const first = fn(times[0]); Object.keys(first).forEach((k) => keys.add(k));
  const tracks = [];
  keys.forEach((k) => {
    const b = B(k); const v = new Float32Array(times.length * 4);
    perT.forEach((loc, i) => loc.get(b).toArray(v, i * 4));
    tracks.push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', Float32Array.from(times), v));
  });
  if (hipsFn) { const v = new Float32Array(times.length * 3); times.forEach((t, i) => hipsFn(t).toArray(v, i * 3)); tracks.push(new THREE.VectorKeyframeTrack(hipsBone.name + '.position', Float32Array.from(times), v)); }
  return new THREE.AnimationClip(name, times[times.length - 1], tracks);
}
const wq = (...rots) => { const q = new THREE.Quaternion(); rots.forEach((r) => q.premultiply(Rq(r[0], r[1]))); return q; };
/** arms-relaxed world rotation (shared by the air and seated poses): arms hang a little away from the body */
const armsDown = (sgn, extraX = 0, extraZ = 0) => {
  const ar = B('leftarm'), fa = B('leftforearm');
  const v = fa.getWorldPosition(new THREE.Vector3()).sub(ar.getWorldPosition(new THREE.Vector3()));
  const phi = Math.atan2(Math.abs(v.x), -v.y), low = Math.max(0, phi - 0.17);
  return -sgn * low + extraZ + 0 * extraX;
};

function buildAirPose() {
  /* airborne: knees tucked a little, one leg leading, arms lifted out and forward */
  resetPose(); figure.updateMatrixWorld(true);
  const T = 0.6, times = [0, 0.15, 0.3, 0.45, 0.6];
  const lowL = armsDown(1), lowR = armsDown(-1);
  return poseClip('air', times, (t) => {
    const k = Math.sin((t / T) * Math.PI * 2) * 0.5; // slow cycle of -0.5..0.5 so the pose breathes while airborne
    const W = {};
    const fL = -0.62 + k * 0.08, fR = -0.28 - k * 0.08; // thighs: left leads
    W.leftupleg = wq([AX, fL]); W.rightupleg = wq([AX, fR]);
    W.leftleg = wq([AX, fL + 1.15]); W.rightleg = wq([AX, fR + 0.85]); // knees bend (lower leg swings back relative to the thigh)
    W.leftfoot = wq([AX, 0.2]); W.rightfoot = wq([AX, 0.1]);
    W.leftarm = wq([AX, -0.5], [AZ, lowL * 0.5 + 0.9]); W.rightarm = wq([AX, -0.35], [AZ, lowR * 0.5 - 0.9]);
    W.leftforearm = wq([AX, -0.9], [AZ, lowL * 0.3 + 0.5]); W.rightforearm = wq([AX, -0.8], [AZ, lowR * 0.3 - 0.5]);
    W.spine1 = wq([AX, 0.06]); W.head = wq([AX, -0.04]);
    return W;
  });
}
function buildSeatedPose() {
  resetPose(); figure.updateMatrixWorld(true);
  const times = [0, 1, 2, 3, 4];
  const lowL = armsDown(1), lowR = armsDown(-1);
  const poseW = (t) => {
    const br = Math.sin((t / 4) * Math.PI * 2) * 0.01;
    const W = {};
    W.leftupleg = wq([AX, -1.5], [AZ, 0.06]); W.rightupleg = wq([AX, -1.5], [AZ, -0.06]); // thighs forward (horizontal)
    W.leftleg = wq([AX, 0.05]); W.rightleg = wq([AX, 0.05]); // shins hang down
    W.leftfoot = wq([AX, 0]); W.rightfoot = wq([AX, 0]);
    W.leftarm = wq([AX, -0.35], [AZ, lowL * 0.9]); W.rightarm = wq([AX, -0.35], [AZ, lowR * 0.9]);
    W.leftforearm = wq([AX, -0.9]); W.rightforearm = wq([AX, -0.9]);
    W.spine = wq([AX, 0.03 + br]); W.head = wq([AX, -0.02]);
    return W;
  };
  /* drop the hips until the planted heels are back at their rest height */
  const probe = poseClip('seated', times, poseW, () => hipsBind.clone());
  applyClipAt(probe, 0);
  const rest = FOOT.map((f) => { resetPose(); figure.updateMatrixWorld(true); const p = new THREE.Vector3(); f.getWorldPosition(p); return p; });
  applyClipAt(probe, 0);
  const cur = FOOT.map((f) => { const p = new THREE.Vector3(); f.getWorldPosition(p); return p; });
  const dy = rest[0].y - cur[0].y; // how far the feet must be raised/lowered
  const dz = 0; void dz;
  const hipsY = hipsBind.y + dy;
  return { clip: poseClip('seated', times, poseW, () => new THREE.Vector3(hipsBind.x, hipsY, hipsBind.z)), hipsY };
}

/* ---------------- 5. run it ---------------- */
const q5 = (n) => Math.round(n * 1e5) / 1e5;
const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');
/* Compact clip format (decoded in FigureCharacter.ts):
 *   times : keyframe times shared by every track of the clip (all baked tracks use the same ones)
 *   q     : bone rotations, base64 Int16 x4 per key (unit quaternion * 32767)
 *   p     : the hips position track, plain numbers x3 per key */
/** puts every track of a clip on the key times of its densest track (Mixamo files sometimes key a few bones on other frames) */
function resample(clip) {
  const dense = clip.tracks.reduce((a, t) => (t.times.length > a.times.length ? t : a));
  const times = dense.times;
  const tracks = clip.tracks.map((t) => {
    if (t.times.length === times.length && t.times.every((x, i) => Math.abs(x - times[i]) < 1e-6)) return t;
    const it = t.createInterpolant(), sz = t.getValueSize(), v = new Float32Array(times.length * sz);
    for (let i = 0; i < times.length; i++) { const r = it.evaluate(Math.min(times[i], t.times[t.times.length - 1])); for (let k = 0; k < sz; k++) v[i * sz + k] = r[k]; }
    return new (t.constructor)(t.name, Float32Array.from(times), v);
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
const pack = (clip0) => {
  const clip = resample(clip0);
  const times = Array.from(clip.tracks[0].times);
  const q = {}, p = {};
  for (const t of clip.tracks) {
    if (t.name.endsWith('.quaternion')) {
      const a = new Int16Array(t.values.length);
      for (let i = 0; i < t.values.length; i += 4) {
        const l = Math.hypot(t.values[i], t.values[i + 1], t.values[i + 2], t.values[i + 3]) || 1;
        for (let k = 0; k < 4; k++) a[i + k] = Math.round((t.values[i + k] / l) * 32767);
      }
      q[t.name.slice(0, -'.quaternion'.length)] = b64(a);
    } else p[t.name.slice(0, -'.position'.length)] = Array.from(t.values, (x) => Math.round(x * 1e4) / 1e4);
  }
  return { duration: q5(clip.duration), times: times.map(q5), q, p };
};
const walk = await fromFbx('walk.fbx'); walk.name = 'walk';
const run = await fromFbx('run.fbx'); run.name = 'run';
const off = await fromFbx('offensive-idle.fbx'); off.name = 'off';
const sw = stanceSpeed(walk), sr = stanceSpeed(run);
console.log('walk', walk.duration.toFixed(3) + 's', 'stance-foot speed median', sw.median.toFixed(3), 'mean', sw.mean.toFixed(3), 'samples', sw.n);
console.log('run ', run.duration.toFixed(3) + 's', 'stance-foot speed median', sr.median.toFixed(3), 'mean', sr.mean.toFixed(3), 'samples', sr.n);
const idle = buildRelaxedIdle();
const air = buildAirPose();
const seat = buildSeatedPose();
console.log('seated hips y', seat.hipsY.toFixed(3), '(standing', hipsBind.y.toFixed(3) + ')');
const out = {
  measured: { walk: { median: q5(sw.median), mean: q5(sw.mean) }, run: { median: q5(sr.median), mean: q5(sr.mean) } },
  clips: { idle: pack(idle), walk: pack(walk), run: pack(run), off: pack(off), air: pack(air), sit: pack(seat.clip) },
};
fs.writeFileSync(path.join(OUT, 'clips.json'), JSON.stringify(out));
console.log('clips.json', fs.statSync(path.join(OUT, 'clips.json')).size, 'bytes');
for (const [k, c] of Object.entries(out.clips)) console.log(' ', k, c.duration + 's', c.times.length, 'keys', Object.keys(c.q).length, 'rotation tracks');
