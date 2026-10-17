import type * as THREE from 'three';
import { RemoteAvatar, type CarView } from './RemoteAvatar';
import { distanceToCar, type Side } from '../vehicles/carGeometry';
import { MAX_AVATARS, STALE_AFTER, type NetOnline, type NetState } from './protocol';

/** how often the "nearest MAX_AVATARS" ranking is redone (s) */
const RANK_EVERY = 0.5;

/**
 * Everybody else in the world. Network updates go in through setOnline / setState; update() draws them.
 * A player appears once both who they are (online/<uid>) and where they are (state/<uid>) are known, and goes when either is removed.
 */
export class RemotePlayers {
  private readonly avatars = new Map<string, RemoteAvatar>();
  private readonly online = new Map<string, NetOnline>();
  private readonly states = new Map<string, NetState>();
  private readonly allowed = new Set<string>();
  private rankClock = RANK_EVERY;

  /** the local player's uid and car: other players can ride in it, so their avatars are drawn from it (set by MultiplayerSession) */
  localUid: string | null = null;
  localCar: (() => CarView | null) | null = null;

  /** called when somebody new appears / disappears (the notification toasts) */
  onJoin: ((name: string) => void) | null = null;
  onLeave: ((name: string) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly gl: THREE.WebGLRenderer
  ) {}

  /** people currently in the world (not counting the local player) */
  get count(): number {
    return this.online.size;
  }

  setOnline(uid: string, info: NetOnline | null): void {
    if (!info || typeof info.n !== 'string' || !info.n) {
      const old = this.online.get(uid);
      this.online.delete(uid);
      this.states.delete(uid);
      this.drop(uid);
      if (old) this.onLeave?.(old.n);
      return;
    }
    const isNew = !this.online.has(uid);
    const clean: NetOnline = { n: info.n, o: info.o };
    this.online.set(uid, clean);
    this.avatars.get(uid)?.setInfo(clean);
    if (isNew) this.onJoin?.(clean.n);
    this.ensure(uid);
  }

  setState(uid: string, state: NetState | null, nowSeconds: number): void {
    if (!state || typeof state.x !== 'number' || typeof state.z !== 'number') {
      this.states.delete(uid);
      this.drop(uid);
      return;
    }
    this.states.set(uid, state);
    this.ensure(uid);
    this.avatars.get(uid)?.push(state, nowSeconds);
  }

  /** somebody within hearing distance said something: it is drawn above their head (when they are drawn at all) */
  say(uid: string, text: string): void {
    this.avatars.get(uid)?.say(text);
  }

  private ensure(uid: string): void {
    if (this.avatars.has(uid)) return;
    const info = this.online.get(uid);
    const state = this.states.get(uid);
    if (!info || !state) return;
    const avatar = new RemoteAvatar(uid, info, this.scene, this.gl);
    avatar.push(state, performance.now() / 1000);
    this.avatars.set(uid, avatar);
  }

  private drop(uid: string): void {
    const a = this.avatars.get(uid);
    if (!a) return;
    a.dispose();
    this.avatars.delete(uid);
    this.allowed.delete(uid);
  }

  // ---------------------------------------------------------------- riding in other players' cars

  /** the nearest other player's car within `maxDistance` (m, to its footprint) of (px, pz) */
  nearestCar(px: number, pz: number, maxDistance: number, nowSeconds: number): { uid: string; name: string; distance: number } | null {
    let best: { uid: string; name: string; distance: number } | null = null;
    for (const [uid, a] of this.avatars) {
      const v = a.carView(nowSeconds);
      if (!v) continue;
      const d = distanceToCar({ x: v.x, z: v.z, yaw: v.yaw }, px, pz);
      if (d <= maxDistance && (!best || d < best.distance)) best = { uid, name: a.name, distance: d };
    }
    return best;
  }

  carView(uid: string, nowSeconds: number): CarView | null {
    return this.avatars.get(uid)?.carView(nowSeconds) ?? null;
  }

  /** is somebody already in (or getting into) that seat of this player's car? The owner counts when they sit in it. */
  seatTaken(hostUid: string, side: Side): boolean {
    for (const [uid, a] of this.avatars) {
      const s = a.seat;
      if (s && s.side === side && (s.host === hostUid || (uid === hostUid && s.host === null))) return true;
    }
    return false;
  }

  setCarDoor(uid: string, side: Side, open: boolean | null): void {
    this.avatars.get(uid)?.setCarDoor(side, open);
  }

  /** Draws everybody. `inside`: the viewer is in a building, where nobody from the street is visible. */
  update(dt: number, nowSeconds: number, px: number, pz: number, inside: boolean): void {
    // the nearest few are drawn, the rest are skipped
    this.rankClock += dt;
    if (this.rankClock >= RANK_EVERY) {
      this.rankClock = 0;
      const ranked: { uid: string; d: number }[] = [];
      for (const [uid, a] of this.avatars) {
        if (nowSeconds - a.lastHeard > STALE_AFTER) continue; // not heard from for a while: gone from view
        const p = a.latest;
        const q = a.latestCar;
        const d = Math.min(p ? Math.hypot(p.x - px, p.z - pz) : Infinity, q ? Math.hypot(q.x - px, q.z - pz) : Infinity);
        ranked.push({ uid, d });
      }
      ranked.sort((u, v) => u.d - v.d);
      this.allowed.clear();
      for (let i = 0; i < Math.min(MAX_AVATARS, ranked.length); i++) this.allowed.add(ranked[i].uid);
    }
    // passengers last: they are drawn from the car they sit in, which has to be in its place for this frame first
    const hostCar = (uid: string): CarView | null =>
      uid === this.localUid ? (this.localCar?.() ?? null) : (this.avatars.get(uid)?.carView(nowSeconds) ?? null);
    for (const [uid, a] of this.avatars) if (!a.isRider) a.update(dt, nowSeconds, !inside && this.allowed.has(uid), px, pz, hostCar);
    for (const [uid, a] of this.avatars) if (a.isRider) a.update(dt, nowSeconds, !inside && this.allowed.has(uid), px, pz, hostCar);
  }

  dispose(): void {
    for (const a of this.avatars.values()) a.dispose();
    this.avatars.clear();
    this.online.clear();
    this.states.clear();
    this.allowed.clear();
  }
}
