import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CharacterAppearance } from '../../types/game';
import figureUrl from './assets/figure.glb?url';
import clipData from './assets/clips.json';
import { applySkinShader, createInnerWearMaterial, SkinShader, InnerWearUniforms } from './FigureMaterials';
import { ITEM_KNIT_TOP, ITEM_LEATHER_JACKET, sanitizeOutfit, type Outfit } from '../../wardrobe/Wardrobe';

/**
 * The player character: the Mixamo-rigged figure from the character viewer (index.html) - 20k-vertex body with the procedural skin
 * shader, leather jacket, knit inner wear - driven by the baked Mixamo walk / run / offensive-idle clips plus a relaxed idle,
 * a jump / fall pose and a seated pose (see scripts/bake-character.mjs).
 *
 * Same surface the engine, the controller and the creation preview already use: group, ready, whenReady, updateAnimation,
 * setPreviewPose, resetForReuse, applyAppearance, setSeatedPose, dispose. The model loads asynchronously; until `ready` the group is empty.
 */

/* The clips are the Mixamo locomotion pack (scripts/character-src/locomotion, baked by scripts/locomotion/bake_locomotion.py):
 * idle, walking, running, strafe + strafe walking (left / right), turn 90 / turn 180 (left / right) and jump. Everything below that
 * depends on how far a clip travels or when its feet land comes from the measurements stored with the clips (`meta`). */
const META = (clipData as any).meta as {
  cycleM: Record<string, number>;
  phase: Record<string, number>;
  turn: Record<string, { yaw: number[]; total: number }>;
  jump: { start: number; takeoff: number; land: number; end: number };
};
/** Metres of ground covered per full cycle (left + right step) of each clip: what keeps the feet from sliding. */
export const GAIT = {
  walkCycleM: META.cycleM.walk,
  runCycleM: META.cycleM.run,
  strafeWalkCycleM: (META.cycleM.strafeWalkL + META.cycleM.strafeWalkR) / 2,
  strafeRunCycleM: (META.cycleM.strafeRunL + META.cycleM.strafeRunR) / 2,
};
/** Ground speed (m/s) of a full-stick walk. The walk clip travels 1.62 m/s as captured; a touch faster plays it ~10% quicker, which still reads as a walk */
export const WALK_FULL_SPEED = 1.8;
/** Ground speed (m/s) of the run (Sprint). The run clip travels 4.26 m/s as captured */
export const RUN_SPEED = 4.4;
/** walk -> run blend window, in m/s of ground speed */
const GAIT_BLEND_FROM = 2.2;
const GAIT_BLEND_TO = 3.6;
/** playback speed limit of the run (1 = the clip as captured): beyond it the feet slide a little rather than the legs looking comical */
const MAX_CYCLE_RATE_RUN = 1.3 / ((clipData as any).clips.run.duration as number);
/** step rate at the slowest walk, as a fraction of the full-walk step rate: slow walkers take shorter steps, only a little slower ones */
const MIN_CADENCE = 0.65;
/** standing still for this long switches to the Mixamo "offensive idle" stance (0 = never) */
export const OFFENSIVE_IDLE_AFTER = 20;

/** turn in place: smaller angles are just walked into, bigger ones play the 90 (up to 135 deg) or 180 clip */
export const TURN_MIN_ANGLE = 1.05; // 60 deg
const TURN_180_FROM = 2.36; // 135 deg
/** share of the turn's angle done before the character may start walking away / before the turn clip lets go */
export const TURN_MOVE_GATE = 0.5;
const TURN_RELEASE = 0.8;
/** the turn clips play a little faster than captured so a turn on the spot never feels sluggish in a game (90: 0.93 s -> 0.75 s, 180: 1.63 s -> 1.17 s) */
const TURN_RATE_90 = 1.25;
const TURN_RATE_180 = 1.4;
/** the walk <-> strafe blend by the angle between the way the body faces and the way it travels */
const STRAFE_FROM = 0.35; // 20 deg: below this the legs are pure forward gait
const STRAFE_TO = 1.35; // 77 deg: above this they are pure side-stepping

type ClipName =
  | 'idle' | 'walk' | 'run'
  | 'strafeWalkL' | 'strafeWalkR' | 'strafeRunL' | 'strafeRunR'
  | 'turn90L' | 'turn90R' | 'turn180L' | 'turn180R'
  | 'jump' | 'off' | 'air' | 'sit'
  | 'carEnter' | 'carDrive' | 'carExit';
const CLIP_NAMES: ClipName[] = [
  'idle', 'walk', 'run', 'strafeWalkL', 'strafeWalkR', 'strafeRunL', 'strafeRunR',
  'turn90L', 'turn90R', 'turn180L', 'turn180R', 'jump', 'off', 'air', 'sit',
  'carEnter', 'carDrive', 'carExit',
];
/** clips whose time is set by hand every frame (gait phase, turn progress, jump progress) instead of playing on their own */
const MANUAL: ClipName[] = ['walk', 'run', 'strafeWalkL', 'strafeWalkR', 'strafeRunL', 'strafeRunR', 'turn90L', 'turn90R', 'turn180L', 'turn180R', 'jump', 'carEnter', 'carDrive', 'carExit'];

interface PackedClip {
  duration: number;
  times: number[];
  q: Record<string, string>;
  p: Record<string, number[]>;
}

function decodeClip(name: string, c: PackedClip): THREE.AnimationClip {
  const times = Float32Array.from(c.times);
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [bone, b64] of Object.entries(c.q)) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const s = new Int16Array(bytes.buffer);
    const v = new Float32Array(s.length);
    for (let i = 0; i < s.length; i += 4) {
      const l = Math.hypot(s[i], s[i + 1], s[i + 2], s[i + 3]) || 1;
      v[i] = s[i] / l;
      v[i + 1] = s[i + 1] / l;
      v[i + 2] = s[i + 2] / l;
      v[i + 3] = s[i + 3] / l;
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, v));
  }
  for (const [bone, vals] of Object.entries(c.p)) tracks.push(new THREE.VectorKeyframeTrack(`${bone}.position`, times, Float32Array.from(vals)));
  return new THREE.AnimationClip(name, c.duration, tracks);
}

const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
const wrapPi = (a: number): number => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const zeroWeights = (idle = 0): Record<ClipName, number> => {
  const w = {} as Record<ClipName, number>;
  for (const n of CLIP_NAMES) w[n] = 0;
  w.idle = idle;
  return w;
};
interface TurnState {
  name: ClipName;
  t: number;
  dur: number;
  startYaw: number;
  scale: number;
  rate: number;
  yaw: number[];
  total: number;
  progress: number;
}

export class FigureCharacter {
  public group = new THREE.Group();
  public ready = false;
  public readonly whenReady: Promise<void>;

  private onProgress?: (msg: string) => void;
  private root: THREE.Object3D | null = null;
  private body: THREE.SkinnedMesh | null = null;
  private jacket: THREE.SkinnedMesh | null = null;
  private inner: THREE.SkinnedMesh | null = null;
  private skin: SkinShader | null = null;
  private innerU: InnerWearUniforms | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<ClipName, THREE.AnimationAction>();
  private clips = new Map<ClipName, THREE.AnimationClip>();
  /** current blend weight of every action (smoothed towards the target each frame) */
  private weight: Record<ClipName, number> = zeroWeights(1);

  // locomotion state
  private t = 0;
  private prevYaw = 0;
  private om = 0;
  private speed = 0;
  private lastPos = new THREE.Vector3();
  private havePos = false;
  private airT = 0;
  private wasGrounded = true;
  private seated = false;
  private gaitPhase = 0; // 0..1 through one full stride, shared by every gait clip so switching never pops a foot
  private theta = 0; // angle between the way the body faces and the way it travels, + = to the character's left
  private turn: TurnState | null = null;
  /** car clip being played (the sequence in vehicles/CarRider.ts sets it and its time; the root motion is applied by the rider) */
  private carClip: 'carEnter' | 'carDrive' | 'carExit' | null = null;
  private carTime = 0;
  private jump: 'none' | 'air' | 'land' = 'none';
  private jumpAir = 0;
  private jumpPred = 0.7;
  private jumpLand = 0;
  private jumpClipT = 0;
  private idleT = 0;
  private lastPreviewT = -1;
  private outfit: Outfit = sanitizeOutfit(null);

  constructor(appearance?: CharacterAppearance, onProgress?: (msg: string) => void) {
    this.group.name = 'player_character_root';
    this.onProgress = onProgress;
    this.whenReady = this.load().catch((e) => {
      console.error('Character failed to load', e);
      this.ready = false;
    });
    void appearance;
  }

  // ---------------------------------------------------------------- loading

  private async load(): Promise<void> {
    this.onProgress?.('Loading character…');
    const res = await fetch(figureUrl);
    if (!res.ok) throw new Error(`figure.glb ${res.status}`);
    const buf = await res.arrayBuffer();
    this.onProgress?.('Building character…');
    const gltf: any = await new Promise((resolve, reject) => new GLTFLoader().parse(buf, '', resolve, reject));
    const scene: THREE.Group = gltf.scene;

    scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.frustumCulled = false; // the bind-pose bounds are wrong once he moves
      m.castShadow = false;
      m.receiveShadow = false;
      if (m.name === 'Jacket') this.jacket = m;
      else this.body = m;
    });
    if (!this.body || !this.jacket) throw new Error('figure.glb is missing the Body / Jacket meshes');

    // skin: procedural pores / flush / veins shader on the body, same as the viewer
    const skinMat = new THREE.MeshStandardMaterial({ roughness: 0.58, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.5 });
    this.skin = applySkinShader(skinMat);
    this.body.material = skinMat;
    // leather jacket keeps the glTF material (base-colour texture from the JPEG inside figure.glb)
    const jm = this.jacket.material as THREE.MeshStandardMaterial;
    jm.envMapIntensity = 0.9;
    if (jm.map) jm.map.anisotropy = 4;

    // knit inner wear under the open jacket (same skeleton as the body)
    const innerMat = createInnerWearMaterial();
    this.innerU = innerMat.uniforms;
    const inner = this.body.clone();
    inner.name = 'InnerWear';
    inner.frustumCulled = false;
    inner.material = innerMat.material;
    this.body.parent!.add(inner);
    this.inner = inner;

    this.root = scene;
    this.group.add(scene);

    this.onProgress?.('Tailoring…');
    this.buildAnimations(scene);
    this.setOutfit(this.outfit); // an outfit chosen while the model was still loading
    this.ready = true;
    this.onProgress?.('Styling…');
  }

  private buildAnimations(scene: THREE.Object3D): void {
    const mixer = new THREE.AnimationMixer(scene);
    this.mixer = mixer;
    for (const name of CLIP_NAMES) {
      const clip = decodeClip(name, (clipData as any).clips[name] as PackedClip);
      this.clips.set(name, clip);
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.enabled = false;
      this.actions.set(name, a);
    }
    // gait, turn and jump clips are driven by hand (see advanceGait / the turn and jump state): their time is set every frame
    for (const n of MANUAL) this.actions.get(n)!.timeScale = 0;
    this.weight = zeroWeights(1);
    this.applyWeights(0);
    mixer.update(0); // first frame is already the relaxed idle, never the A-pose
  }

  // ---------------------------------------------------------------- wardrobe

  /** 'leather' (default) or 'none'. The bomber jacket from the viewer is not shipped in the game build. */
  public setTop(top: 'leather' | 'none'): void {
    if (this.jacket) this.jacket.visible = top === 'leather';
    if (this.innerU) this.innerU.uFull.value = top === 'leather' ? 0 : 1;
  }

  /**
   * Puts on a wardrobe outfit (ids from wardrobe/Wardrobe.ts). Unknown ids are ignored, a missing shirt falls back to the default.
   * Only the garments that have a model in the game exist here: the leather jacket (over the knit top) and the knit top alone.
   * Head / trousers / accessories have no models yet, so there is nothing to show or hide for them.
   */
  public setOutfit(outfit: Outfit | null | undefined): void {
    const o = sanitizeOutfit(outfit);
    this.outfit = o;
    const jacket = o.shirts === ITEM_LEATHER_JACKET;
    this.setTop(jacket ? 'leather' : 'none');
    if (this.inner) this.inner.visible = jacket || o.shirts === ITEM_KNIT_TOP;
  }

  public getOutfit(): Outfit {
    return { ...this.outfit };
  }

  /** shadows from the character: on in the showroom (desktop), always off in the game, as before */
  public setCastShadow(on: boolean): void {
    for (const m of [this.body, this.jacket, this.inner]) if (m) m.castShadow = on;
  }

  public setSkinTone(hex: string, freckleIndex = 2): void {
    this.skin?.setTone(hex, freckleIndex);
  }

  public setInnerColor(base: string, trim: string): void {
    if (!this.innerU) return;
    this.innerU.uBase.value = hexToLinear(base);
    this.innerU.uTrim.value = hexToLinear(trim);
  }

  // ---------------------------------------------------------------- engine-facing API

  /** Called when a finished character is reused somewhere else (preview -> game): forget the old position, speed and stride. */
  public resetForReuse(): void {
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.prevYaw = 0;
    this.havePos = false;
    this.speed = 0;
    this.om = 0;
    this.airT = 0;
    this.wasGrounded = true;
    this.seated = false;
    this.gaitPhase = 0;
    this.theta = 0;
    this.turn = null;
    this.carClip = null;
    this.jump = 'none';
    this.idleT = 0;
    this.lastPreviewT = -1;
    if (this.mixer) {
      this.weight = zeroWeights(1);
      this.applyWeights(0);
      this.mixer.update(0);
    }
  }

  public applyAppearance(_a: CharacterAppearance): void {
    /* every player is this figure (the creation flow no longer offers hair / skin / clothes) */
  }

  public getProfile(): null {
    return null;
  }

  public setSeatedPose(_armsForward = false): void {
    this.seated = true;
  }

  /** turntable pose for the creation screen: relaxed standing idle (the preview rotates the group itself) */
  public setPreviewPose(time: number): void {
    if (!this.ready || !this.mixer) return;
    const dt = this.lastPreviewT < 0 ? 1 / 60 : Math.min(0.1, Math.max(1e-4, time - this.lastPreviewT));
    this.lastPreviewT = time;
    this.setTargets({ idle: 1 });
    this.stepWeights(dt);
    this.mixer.update(dt);
  }

  // ---------------------------------------------------------------- jump / turn in place (driven by the controller)

  /** The controller calls this the moment it launches a jump; `airSeconds` = how long the physics will keep the character airborne. */
  public triggerJump(airSeconds = 0.7): void {
    if (!this.ready) return;
    this.jump = 'air';
    this.jumpAir = 0;
    this.jumpLand = 0;
    this.jumpPred = Math.max(0.3, airSeconds);
    this.jumpClipT = META.jump.start;
    this.turn = null;
  }

  /** true while a turn-in-place clip is rotating the character (the controller must not turn it as well) */
  public get isTurning(): boolean {
    return this.turn !== null;
  }

  /** 0..1: how much of the turn's angle is done (1 when not turning) */
  public get turnProgress(): number {
    return this.turn ? this.turn.progress : 1;
  }

  /**
   * Starts a turn on the spot towards `diff` radians away from where the body faces (+ = to the left). Angles under TURN_MIN_ANGLE are
   * not turned this way (returns false: just walk into them). The clip's own yaw is applied to the group while it plays.
   */
  public startTurn(diff: number): boolean {
    if (!this.ready || this.turn || this.jump !== 'none' || this.seated) return false;
    const a = Math.abs(diff);
    if (a < TURN_MIN_ANGLE) return false;
    const big = a > TURN_180_FROM;
    const name = ((big ? 'turn180' : 'turn90') + (diff > 0 ? 'L' : 'R')) as ClipName;
    const m = META.turn[name];
    const ref = Math.abs(m.total);
    const scale = big ? clamp(a / ref, 0.8, 1.3) : clamp(a / ref, 0.67, 1.45);
    this.turn = { name, t: 0, dur: this.clips.get(name)!.duration, startYaw: this.group.rotation.y, scale, rate: big ? TURN_RATE_180 : TURN_RATE_90, yaw: m.yaw, total: m.total * scale, progress: 0 };
    return true;
  }

  /**
   * Plays one of the car clips at clip time `time` (enter / exit: the rider steps the time; drive: it loops on its own length) and
   * hands the whole pose to it. `null` gives the character back to the normal gait / idle logic. The clips carry no root motion:
   * the rider moves and turns the group (see vehicles/CarRider.ts).
   */
  public setCarClip(name: 'carEnter' | 'carDrive' | 'carExit' | null, time = 0): void {
    if (name === null && this.carClip !== null) this.havePos = false; // the first normal frame must not read the rider's moves as speed
    this.carClip = name;
    this.carTime = time;
    if (name) {
      this.turn = null;
      this.jump = 'none';
    }
  }

  /** 0..1: how far the pose has faded into the current car clip (the rider blends the root motion with the same number) */
  public get carBlend(): number {
    return this.carClip ? clamp01(this.weight[this.carClip]) : 1;
  }

  public get isInCarPose(): boolean {
    return this.carClip !== null;
  }

  public cancelTurn(): void {
    this.turn = null;
  }

  // ---------------------------------------------------------------- per-frame animation

  /** `speedRatio` = ground speed / walkSpeed (WALK_FULL_SPEED) as the controller reports it */
  public updateAnimation(dt: number, speedRatio: number, isGrounded: boolean): void {
    if (!this.ready || !this.mixer) return;
    dt = Math.max(dt, 1e-4);
    this.t += dt;
    if (this.carClip) {
      this.updateCarAnimation(dt);
      return;
    }
    const g = this.group;

    // turn in place: the clip's yaw curve rotates the character (the clip itself carries no yaw, see bake_locomotion.py)
    const turn = this.turn;
    if (turn) {
      turn.t += dt * turn.rate;
      const n = turn.yaw.length - 1;
      const f = clamp01(turn.t / turn.dur) * n;
      const i = Math.min(n - 1, Math.floor(f));
      const delta = (turn.yaw[i] + (turn.yaw[i + 1] - turn.yaw[i]) * (f - i)) * turn.scale;
      g.rotation.y = turn.startYaw + delta;
      turn.progress = clamp01(Math.abs(delta) / Math.max(1e-3, Math.abs(turn.total)));
      if (turn.progress >= TURN_RELEASE || turn.t >= turn.dur) this.turn = null;
    }

    // measured ground speed (also right for scripted walks, wading, slopes) and the direction of travel relative to the body
    let v = speedRatio * WALK_FULL_SPEED;
    let heading: number | null = null;
    if (this.havePos) {
      const dx = g.position.x - this.lastPos.x;
      const dz = g.position.z - this.lastPos.z;
      const measured = Math.hypot(dx, dz) / dt;
      if (measured < 30) v = measured;
      if (measured > 0.4 && measured < 30) heading = Math.atan2(dx, dz);
    }
    this.lastPos.copy(g.position);
    this.havePos = true;
    this.speed += (v - this.speed) * Math.min(1, dt * 14);
    let dy = g.rotation.y - this.prevYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.prevYaw = g.rotation.y;
    this.om += (dy / dt - this.om) * Math.min(1, dt * 10);
    // + = the character is travelling towards its own left (feet cross-step), - = right; it settles back to 0 when the body catches up
    const rel = heading === null ? 0 : wrapPi(heading - g.rotation.y);
    this.theta += (rel - this.theta) * Math.min(1, dt * (heading === null ? 6 : 12));

    // jump: time in the clip follows how far through its airtime the character is; the landing plays on from touch-down
    const J = META.jump;
    const touch = J.land - 0.05;
    let jumpW = 0;
    if (this.jump === 'air') {
      if (!isGrounded) {
        this.jumpAir += dt;
        const goal = J.start + (touch - J.start) * clamp01(this.jumpAir / this.jumpPred);
        this.jumpClipT += clamp(goal - this.jumpClipT, 0, dt * 6); // follows the airtime, catches up quickly, never runs backwards
      } else if (this.jumpAir > 0.08) {
        this.jump = 'land';
        this.jumpLand = 0;
      } else {
        this.jump = 'none';
      }
    }
    if (this.jump === 'land') {
      this.jumpLand += dt;
      this.jumpClipT += dt * (this.jumpClipT < touch ? 8 : 1);
      if (this.jumpClipT >= J.end || !isGrounded) this.jump = 'none';
    }
    if (this.jump === 'air') jumpW = 1;
    else if (this.jump === 'land') {
      // standing: let the whole recovery play out; running: hand over to the gait as soon as the feet are down
      const standing = this.speed < 0.8;
      jumpW = standing ? clamp01((J.end - this.jumpClipT) / 0.3) : clamp01(1 - (this.jumpLand - 0.1) / 0.18);
    }
    const jumping = this.jump !== 'none';

    // airborne without a jump (stepped off a ledge): the fall pose; just landed
    let air = 0;
    if (!isGrounded) {
      this.airT += dt;
      air = jumping ? 0 : 1;
    } else if (!this.wasGrounded) {
      this.airT = 0;
    }
    this.wasGrounded = isGrounded;

    // ground gait weights from the real speed
    const v0 = this.speed;
    const moving = v0 > 0.35;
    const sit = this.seated ? 1 : 0;
    const blend = clamp01((v0 - GAIT_BLEND_FROM) / (GAIT_BLEND_TO - GAIT_BLEND_FROM));
    const runW = moving ? blend : 0;
    const walkW = moving ? 1 - blend : 0;
    // forward gait <-> side-stepping by the angle between where the body faces and where it travels
    const a = Math.abs(this.theta);
    const sideK = moving ? smooth01((a - STRAFE_FROM) / (STRAFE_TO - STRAFE_FROM)) : 0;
    const left = this.theta > 0;
    // short fade between standing and walking so a stop never snaps: below 0.8 m/s the gait fades into the idle
    const gaitFade = moving ? clamp01((v0 - 0.35) / 0.5) : 0;
    // below a full walk the legs swing less: the walk clip is blended with the idle by the stride fraction
    const { cadence, amp } = walkStride(v0);
    const gait = gaitFade * amp;

    if (moving || air || sit || jumping || this.turn) {
      this.idleT = 0;
    } else {
      this.idleT += dt;
    }
    const wantOff = OFFENSIVE_IDLE_AFTER > 0 && this.idleT >= OFFENSIVE_IDLE_AFTER && !air && !sit && !moving ? 1 : 0;

    // a turn clip owns the legs until the character is allowed to walk off, then hands over to the gait
    const turnW = this.turn ? clamp01(1 - (this.turn.progress - TURN_MOVE_GATE) / (TURN_RELEASE - TURN_MOVE_GATE)) : 0;
    const ground = (1 - air) * (1 - sit) * (1 - jumpW);
    const base = ground * (1 - turnW);
    const fwd = gait * (1 - sideK);
    const side = gait * sideK;
    const T: Partial<Record<ClipName, number>> = {
      idle: base * (1 - gait) * (1 - wantOff),
      walk: base * fwd * walkW,
      run: base * fwd * runW,
      off: base * (1 - gait) * wantOff,
      air: air * (1 - sit),
      sit,
      jump: jumpW * (1 - sit),
    };
    T[left ? 'strafeWalkL' : 'strafeWalkR'] = base * side * walkW;
    T[left ? 'strafeRunL' : 'strafeRunR'] = base * side * runW;
    if (this.turn) T[this.turn.name] = ground * turnW;
    this.setTargets(T);

    this.advanceGait(dt, v0, blend, cadence, sideK);
    this.driveManualClips();
    this.stepWeights(dt, air > 0 || jumping ? 18 : 9);
    this.mixer.update(dt);
  }

  /** car clip frame: the whole pose is the clip at the time the rider gave */
  private updateCarAnimation(dt: number): void {
    const name = this.carClip!;
    this.setTargets({ [name]: 1 });
    const a = this.actions.get(name);
    if (a) {
      const dur = this.clips.get(name)!.duration;
      a.time = name === 'carDrive' ? this.carTime % dur : Math.min(Math.max(this.carTime, 0), dur);
    }
    this.stepWeights(dt, 9);
    this.mixer!.update(dt);
  }

  public dispose(): void {
    this.mixer?.stopAllAction();
    this.mixer = null;
    const mats = new Set<THREE.Material>();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const ms = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      ms.forEach((x) => mats.add(x));
    });
    mats.forEach((m) => {
      const mm = m as THREE.MeshStandardMaterial;
      mm.map?.dispose?.();
      m.dispose();
    });
    this.group.clear();
    this.ready = false;
  }

  // ---------------------------------------------------------------- blending internals

  private target: Record<ClipName, number> = zeroWeights(1);

  private setTargets(t: Partial<Record<ClipName, number>>): void {
    const next = zeroWeights(0);
    for (const n of CLIP_NAMES) next[n] = t[n] ?? 0;
    this.target = next;
  }

  /** One shared stride phase: every gait clip is time-locked to it (by its measured foot offset), so a foot never jumps when the blend changes. */
  private advanceGait(dt: number, speed: number, runBlend: number, cadence: number, sideK: number): void {
    // cycles per second that keep the planted foot still on the ground. At or above a full walk this is speed / cycle length;
    // below it the step rate eases down gently (`cadence`) and the stride shortens instead, so a light push is not slow motion
    const walkCycle = GAIT.walkCycleM + (GAIT.strafeWalkCycleM - GAIT.walkCycleM) * sideK;
    const runCycle = GAIT.runCycleM + (GAIT.strafeRunCycleM - GAIT.runCycleM) * sideK;
    const walkRate = (speed >= WALK_FULL_SPEED ? speed : cadence * WALK_FULL_SPEED) / walkCycle;
    const runRate = Math.min(speed / runCycle, MAX_CYCLE_RATE_RUN);
    const rate = walkRate * (1 - runBlend) + runRate * runBlend;
    this.gaitPhase = (this.gaitPhase + rate * dt) % 1;
  }

  /** sets the time of every hand-driven clip: gait clips from the shared phase, turn from its progress, jump from the jump state */
  private driveManualClips(): void {
    for (const n of ['walk', 'run', 'strafeWalkL', 'strafeWalkR', 'strafeRunL', 'strafeRunR'] as ClipName[]) {
      const a = this.actions.get(n);
      if (a) a.time = ((this.gaitPhase + (META.phase[n] ?? 0)) % 1) * this.clips.get(n)!.duration;
    }
    if (this.turn) {
      const a = this.actions.get(this.turn.name);
      if (a) a.time = Math.min(this.turn.t, this.turn.dur);
    }
    if (this.jump !== 'none') {
      const a = this.actions.get('jump');
      if (a) a.time = Math.min(this.jumpClipT, this.clips.get('jump')!.duration);
    }
  }

  private stepWeights(dt: number, rate = 9): void {
    let sum = 0;
    for (const n of CLIP_NAMES) {
      // the offensive stance eases in and out of the idle over ~0.6 s; everything else uses `rate`
      const slow = (n === 'off' || n === 'idle') && this.target.off > 0;
      const k = damp(slow ? 4 : rate, dt);
      this.weight[n] += (this.target[n] - this.weight[n]) * k;
      if (this.weight[n] < 0.001 && this.target[n] === 0) this.weight[n] = 0;
      sum += this.weight[n];
    }
    if (sum < 1e-3) this.weight.idle = 1;
    this.applyWeights(dt);
  }

  private applyWeights(dt: number): void {
    for (const n of CLIP_NAMES) {
      const a = this.actions.get(n);
      if (!a) continue;
      const w = this.weight[n];
      if (w <= 0) {
        if (a.enabled) a.enabled = false;
        continue;
      }
      if (!a.enabled) {
        a.enabled = true;
        a.play();
        if (n === 'off' || n === 'air') a.time = 0;
      }
      a.setEffectiveWeight(w);
      a.paused = false;
    }
    void dt;
  }
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const smooth01 = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * Walk stride for a ground speed. Full walk and faster: the clip as captured (amp 1). Slower: the step rate drops only a little
 * (cadence MIN_CADENCE..1) and the rest of the speed drop comes out of the stride length, which is the leg swing (amp < 1).
 * stride = speed / cadence, so amp * cadence * WALK_FULL_SPEED = speed and the feet keep matching the ground.
 */
function walkStride(speed: number): { cadence: number; amp: number } {
  if (speed >= WALK_FULL_SPEED) return { cadence: speed / WALK_FULL_SPEED, amp: 1 };
  const f = clamp01(speed / WALK_FULL_SPEED);
  const cadence = MIN_CADENCE + (1 - MIN_CADENCE) * f;
  return { cadence, amp: clamp01(f / cadence) };
}

function hexToLinear(h: string): number[] {
  const c = new THREE.Color(h); // three converts the sRGB hex to linear for us
  return [c.r, c.g, c.b];
}
