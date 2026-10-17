import * as THREE from 'three';
import { FigureCharacter } from '../player/figure/FigureCharacter';
import { sanitizeOutfit, type Outfit } from '../wardrobe/Wardrobe';
import { ChatBubble, REMOTE_BUBBLE_HEIGHT } from './ChatBubble';
import { NameTag } from './NameTag';
import { RemoteCar } from './RemoteCar';
import clipData from '../player/figure/assets/clips.json';
import { sampleCarClip, type CarClipSet } from '../vehicles/carClips';
import { rootToWorld, type Side } from '../vehicles/carGeometry';
import {
  CHAT_RADIUS,
  INTERP_DELAY,
  SHOW_RADIUS,
  DROP_RADIUS,
  STALE_AFTER,
  TELEPORT_DISTANCE,
  angleDelta,
  bracket,
  type NetCar,
  type NetOnline,
  type NetState,
} from './protocol';

/** names are only drawn this close (m) */
const NAME_RADIUS = 45;
/** height of the name above the feet (m) */
const NAME_HEIGHT = 2.15;
/** the seated (Driving) pose in the seat frame: where a passenger's pelvis sits relative to the car */
const SEATED = sampleCarClip((clipData as unknown as { meta: { car: { clips: CarClipSet } } }).meta.car.clips.carDrive, 0);
/** the clip names of the car sequence, by NetState.k */
const CAR_CLIPS = [null, 'carEnter', 'carDrive', 'carExit'] as const;
/** how long the enter / exit clips are, to stop the local clock from running past the end (s): they are re-synced by every update */
const CLIP_MAX = 8;

/** a car as drawn right now: where it is, how fast it moves, which side its driver sits on (null: nobody is driving it) */
export interface CarView {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  driverSide: Side | null;
}

interface Snap {
  /** local time (s) the update arrived */
  at: number;
  s: NetState;
}

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;

/** the outfit stored on the network (missing key = nothing worn) as the game's Outfit */
function toOutfit(o: NetOnline['o']): Outfit {
  return sanitizeOutfit({
    head: o?.head ?? null,
    shirts: o?.shirts ?? null,
    trousers: o?.trousers ?? null,
    accessories: o?.accessories ?? null,
  });
}

/**
 * Another player in the world: their character (the same figure, animated from how they move), their name, and their car.
 *
 * Updates arrive ~10 times a second. They are kept in a short buffer and played back INTERP_DELAY seconds late, blending between the two
 * updates around that moment, so movement is smooth instead of stepping. The walk / run / strafe animation is not sent: the figure
 * works it out from how fast the interpolated position moves (the same way it does for the local player). Jumps, getting into a car,
 * driving and getting out are sent as small flags (see protocol.ts) and played with the same clips.
 *
 * The expensive parts (the figure, the car) only exist while the player is within SHOW_RADIUS of the viewer.
 */
export class RemoteAvatar {
  private readonly buf: Snap[] = [];
  private figure: FigureCharacter | null = null;
  private tag: NameTag | null = null;
  /** what they just said, drawn above the name; `pendingSay` is waiting for the figure to exist */
  private bubble: ChatBubble | null = null;
  private pendingSay: string | null = null;
  private car: RemoteCar | null = null;
  private readonly root = new THREE.Group();
  /** seconds (local clock) of the last update heard from this player */
  lastHeard = 0;
  private lastGrounded = true;
  private lastY = 0;
  private lastK = 0;
  private clipClock = 0;
  private clipBase = 0;
  private clipBaseAt = 0;
  private disposed = false;
  /** the car as drawn in the latest update (null when it is not out) */
  private carNow: NetCar | null = null;
  private carSpeed = 0;
  private prevCar: { x: number; z: number } | null = null;
  /** doors the local player is working on this car (see RemoteCar.setDoorOverride) */
  private readonly doors: { L: boolean | null; R: boolean | null } = { L: null, R: null };

  constructor(
    readonly uid: string,
    private info: NetOnline,
    private readonly scene: THREE.Scene,
    private readonly gl: THREE.WebGLRenderer
  ) {
    this.root.name = `remote_player_${uid}`;
    scene.add(this.root);
  }

  get name(): string {
    return this.info.n;
  }

  setInfo(info: NetOnline): void {
    const nameChanged = info.n !== this.info.n;
    this.info = info;
    this.figure?.setOutfit(toOutfit(info.o));
    if (nameChanged && this.tag) {
      this.tag.dispose();
      this.tag = null; // rebuilt on the next update
    }
  }

  /** they said something close enough to be heard: it appears above their head (replacing the last one) */
  say(text: string): void {
    this.pendingSay = text;
  }

  /** a new update from the network */
  push(state: NetState, nowSeconds: number): void {
    const s: NetState = {
      x: state.x,
      y: state.y,
      z: state.z,
      r: state.r,
      g: state.g ?? 1,
      i: state.i ?? 0,
      k: state.k ?? 0,
      kt: state.kt ?? 0,
      km: state.km ?? 0,
      h: typeof state.h === 'string' && state.h ? state.h : undefined,
      hp: typeof state.hp === 'number' && Number.isFinite(state.hp) ? state.hp : undefined,
      c: state.c
        ? {
            x: state.c.x,
            y: state.c.y,
            z: state.c.z,
            r: state.c.r,
            p: state.c.p ?? 0,
            l: state.c.l ?? 0,
            s: state.c.s ?? 0,
            dl: state.c.dl ?? 0,
            dr: state.c.dr ?? 0,
          }
        : undefined,
    };
    this.buf.push({ at: nowSeconds, s });
    if (this.buf.length > 40) this.buf.shift();
    this.lastHeard = nowSeconds;
  }

  /** latest known ground position, for range checks */
  get latest(): { x: number; z: number } | null {
    const l = this.buf[this.buf.length - 1];
    return l ? { x: l.s.x, z: l.s.z } : null;
  }

  /** latest known position of their car, if it is out */
  get latestCar(): { x: number; z: number } | null {
    const c = this.buf[this.buf.length - 1]?.s.c;
    return c ? { x: c.x, z: c.z } : null;
  }

  /** the car as drawn right now, for somebody who wants to get into it (null: no car out, or this player has not been heard from lately) */
  carView(nowSeconds: number): CarView | null {
    const c = this.carNow;
    const last = this.buf[this.buf.length - 1];
    if (!c || !last || nowSeconds - this.lastHeard > STALE_AFTER) return null;
    const driving = last.s.k === 2 && !last.s.h;
    return { x: c.x, y: c.y, z: c.z, yaw: c.r, speed: this.carSpeed, driverSide: driving ? (last.s.km === 1 ? 'R' : 'L') : null };
  }

  /** true while this player sits in somebody else's car: they are drawn from that car, so they update after it */
  get isRider(): boolean {
    const last = this.buf[this.buf.length - 1];
    return !!last && last.s.k === 2 && !!last.s.h;
  }

  /** the car this player rides in / the seat they take, for "is that seat free?" (only while getting in or sitting) */
  get seat(): { host: string | null; side: Side } | null {
    const s = this.buf[this.buf.length - 1]?.s;
    if (!s || (s.k !== 1 && s.k !== 2)) return null;
    return { host: s.h ?? null, side: s.km === 1 ? 'R' : 'L' };
  }

  /** opens / closes a door of this player's car for the local player; `null` gives it back to the owner's updates */
  setCarDoor(side: Side, open: boolean | null): void {
    this.doors[side] = open;
    this.car?.setDoorOverride(side, open);
  }

  /**
   * Draws the player at the moment `nowSeconds - INTERP_DELAY`.
   * `allowed`: the viewer is outside and this player is among the nearest MAX_AVATARS; `px, pz`: where the viewer stands.
   */
  update(dt: number, nowSeconds: number, allowed: boolean, px: number, pz: number, hostCar?: (uid: string) => CarView | null): void {
    if (this.disposed) return;
    const last = this.buf[this.buf.length - 1];
    if (!last) return;
    const renderT = nowSeconds - INTERP_DELAY;

    // drop what is too old to be needed (always keep two updates to blend between)
    while (this.buf.length > 2 && this.buf[1].at < renderT - 0.5) this.buf.shift();

    // which two updates surround the moment being drawn
    const br = bracket(this.buf, renderT);
    const a = br.a;
    const c = br.c;
    let f = br.f;
    const jump = Math.hypot(c.s.x - a.s.x, c.s.z - a.s.z) > TELEPORT_DISTANCE;
    if (jump) f = renderT >= c.at ? 1 : 0;
    const A = a.s;
    const C = c.s;
    let x = lerp(A.x, C.x, f);
    let y = lerp(A.y, C.y, f);
    let z = lerp(A.z, C.z, f);
    let yaw = A.r + angleDelta(A.r, C.r) * f;
    const car = interpolateCar(A.c, C.c, f, jump);

    // how fast the car moves (for somebody who wants to get in or out of it)
    if (car && this.prevCar && dt > 0 && !jump) {
      const v = Math.hypot(car.x - this.prevCar.x, car.z - this.prevCar.z) / dt;
      this.carSpeed += (Math.min(v, 80) - this.carSpeed) * Math.min(1, 8 * dt);
    } else this.carSpeed = 0;
    this.prevCar = car ? { x: car.x, z: car.z } : null;
    this.carNow = car;

    // a passenger sits in the host's car as the viewer sees that car (their own updates arrive a little off from the car's, so they are not used)
    if (A.k === 2 && A.h && hostCar) {
      const hc = hostCar(A.h);
      if (hc) {
        const w = rootToWorld({ x: hc.x, z: hc.z, yaw: hc.yaw }, A.km === 1 ? 'R' : 'L', SEATED);
        x = w.x;
        z = w.z;
        y = hc.y + SEATED.dy;
        yaw = w.yaw;
      }
    }

    const dChar = Math.hypot(x - px, z - pz);
    const showFigure = allowed && A.i === 0 && dChar < (this.figure ? DROP_RADIUS : SHOW_RADIUS);
    const dCar = car ? Math.hypot(car.x - px, car.z - pz) : Infinity;
    const showCar = allowed && !!car && dCar < (this.car ? DROP_RADIUS : SHOW_RADIUS);

    this.updateFigure(showFigure, dt, renderT, a, x, y, z, yaw, dChar);
    this.updateCar(showCar, car, dt);
  }

  // ---------------------------------------------------------------- the character

  private updateFigure(show: boolean, dt: number, renderT: number, a: Snap, x: number, y: number, z: number, yaw: number, dist: number): void {
    if (!show) {
      if (this.figure) {
        this.figure.group.removeFromParent();
        this.figure.dispose();
        this.figure = null;
      }
      if (this.tag) {
        this.tag.dispose();
        this.tag = null;
      }
      this.dropBubble();
      this.pendingSay = null;
      return;
    }
    if (!this.figure) {
      const fig = new FigureCharacter();
      fig.setCastShadow(false);
      fig.setOutfit(toOutfit(this.info.o));
      this.root.add(fig.group);
      this.figure = fig;
      this.lastY = y;
      this.lastGrounded = true;
    }
    const fig = this.figure;
    const g = fig.group;
    g.position.set(x, y, z);
    g.rotation.y = yaw;

    const S = a.s;
    const clip = CAR_CLIPS[S.k] ?? null;
    if (clip === null) {
      if (this.lastK !== 0) {
        fig.setCarClip(null);
        g.scale.x = 1;
      }
      const grounded = S.g === 1;
      if (this.lastGrounded && !grounded && y > this.lastY + 0.002) fig.triggerJump(0.7);
      fig.updateAnimation(dt, 0, grounded);
      this.lastGrounded = grounded;
    } else {
      // the car clips: enter / exit are re-synced to the sender's clip time with every update, driving loops on its own
      if (this.lastK !== S.k) {
        this.clipBase = S.kt;
        this.clipBaseAt = a.at;
      }
      this.clipClock = clip === 'carDrive' ? this.clipClock + dt : Math.min(CLIP_MAX, this.clipBase + Math.max(0, renderT - this.clipBaseAt));
      g.scale.x = S.km === 1 ? -1 : 1;
      fig.setCarClip(clip, this.clipClock);
      fig.updateAnimation(dt, 0, true);
      this.lastGrounded = true;
    }
    this.lastK = S.k;
    this.lastY = y;

    // name
    if (dist < NAME_RADIUS) {
      if (!this.tag) {
        this.tag = new NameTag(this.info.n, S.hp);
        this.root.add(this.tag.sprite);
      }
      this.tag.setHealth(S.hp);
      this.tag.sprite.visible = true;
      this.tag.sprite.position.set(x, y + NAME_HEIGHT - NameTag.DROP, z);
    } else if (this.tag) {
      this.tag.sprite.visible = false;
    }

    // what they said: above the name, only while they are within hearing distance
    if (this.pendingSay) {
      this.dropBubble();
      this.bubble = new ChatBubble(this.pendingSay);
      this.root.add(this.bubble.sprite);
      this.pendingSay = null;
    }
    if (this.bubble) {
      if (!this.bubble.update(dt)) this.dropBubble();
      else {
        this.bubble.sprite.visible = dist < CHAT_RADIUS;
        this.bubble.sprite.position.set(x, y + REMOTE_BUBBLE_HEIGHT, z);
      }
    }
  }

  private dropBubble(): void {
    this.bubble?.dispose();
    this.bubble = null;
  }

  // ---------------------------------------------------------------- the car

  private updateCar(show: boolean, car: NetCar | null, dt: number): void {
    if (!show || !car) {
      if (this.car) {
        if (!car) {
          this.car.dispose();
          this.car = null;
        } else this.car.apply(car, dt, false);
      }
      return;
    }
    if (!this.car) this.car = new RemoteCar(this.scene, this.gl);
    this.car.setDoorOverride('L', this.doors.L);
    this.car.setDoorOverride('R', this.doors.R);
    this.car.apply(car, dt, true);
  }

  dispose(): void {
    this.disposed = true;
    if (this.figure) {
      this.figure.group.removeFromParent();
      this.figure.dispose();
      this.figure = null;
    }
    this.tag?.dispose();
    this.tag = null;
    this.dropBubble();
    this.car?.dispose();
    this.car = null;
    this.scene.remove(this.root);
  }
}

function interpolateCar(a: NetCar | undefined, c: NetCar | undefined, f: number, jump: boolean): NetCar | null {
  if (!a && !c) return null;
  if (!a || !c) return (a ?? c)!;
  if (jump) return f >= 1 ? c : a;
  return {
    x: lerp(a.x, c.x, f),
    y: lerp(a.y, c.y, f),
    z: lerp(a.z, c.z, f),
    r: a.r + angleDelta(a.r, c.r) * f,
    p: lerp(a.p, c.p, f),
    l: lerp(a.l, c.l, f),
    s: lerp(a.s, c.s, f),
    dl: f < 0.5 ? a.dl : c.dl,
    dr: f < 0.5 ? a.dr : c.dr,
  };
}
