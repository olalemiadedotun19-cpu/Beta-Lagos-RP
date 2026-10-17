import type * as THREE from 'three';
import {
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onDisconnect,
  limitToLast,
  onValue,
  push,
  query,
  ref,
  remove,
  serverTimestamp,
  set,
  type DatabaseReference,
  type DataSnapshot,
} from 'firebase/database';
import { notificationService } from '../services/NotificationService';
import { chatStore } from './chatStore';
import type { Outfit } from '../wardrobe/Wardrobe';
import { getFirebase } from './firebase';
import { RemotePlayers } from './RemotePlayers';
import {
  CHAT_FRESH_MS,
  CHAT_KEEP_MS,
  CHAT_PATH,
  CHAT_STALE_MS,
  HEARTBEAT_INTERVAL,
  ONLINE_PATH,
  SEND_INTERVAL,
  STATE_PATH,
  isChatRecord,
  isSendable,
  isWithinHearing,
  roundState,
  sameState,
  type NetChat,
  type NetOnline,
  type NetState,
} from './protocol';

/** what the engine gives the network layer */
export interface NetSource {
  scene: THREE.Scene;
  gl: THREE.WebGLRenderer;
  /** the local player right now, ready to send (no `t`) */
  readLocal(): Omit<NetState, 't'>;
  /** where the local player stands in the world, and whether they are inside a building */
  localPosition(): { x: number; z: number; inside: boolean };
  /** the local player's own car as it stands right now (null when it is not out): other players can ride in it */
  localCar?(): { x: number; y: number; z: number; yaw: number } | null;
}

export interface NetIdentity {
  uid: string;
  username: string;
  name: string;
  outfit: Outfit;
}

/**
 * The multiplayer connection of one signed-in player.
 *
 *  - announces them in `online/<uid>` (display name and clothes; never the username) and keeps `state/<uid>` up to date (position, car, animation flags)
 *  - both are removed by the server the moment the connection drops (onDisconnect), so nobody is left standing as a ghost
 *  - listens to everyone else's `online` and `state` and hands them to RemotePlayers to be drawn
 *  - the position is sent at most 10x a second and only when something changed (plus a heartbeat every few seconds)
 *  - when the tab is hidden (phone locked, app switched) the player leaves the world and comes back when the tab is shown again
 */
export class MultiplayerSession {
  private readonly remote: RemotePlayers;
  private readonly unsubs: Array<() => void> = [];
  private readonly stateRef: DatabaseReference;
  private readonly onlineRef: DatabaseReference;
  private connected = false;
  private active = true;
  private forceSend = true;
  private sinceSend = 0;
  private last: Omit<NetState, 't'> | null = null;
  private offset = 0;
  private quietUntil = 0;
  private failed = false;
  private stopped = false;

  constructor(
    private readonly me: NetIdentity,
    private readonly src: NetSource
  ) {
    const { db } = getFirebase();
    this.stateRef = ref(db, `${STATE_PATH}/${me.uid}`);
    this.onlineRef = ref(db, `${ONLINE_PATH}/${me.uid}`);
    this.remote = new RemotePlayers(src.scene, src.gl);
    this.remote.localUid = me.uid;
    this.remote.localCar = () => {
      const c = src.localCar?.();
      return c ? { ...c, speed: 0, driverSide: null } : null;
    };
    this.remote.onJoin = (name) => {
      if (performance.now() > this.quietUntil) notificationService.post({ title: 'Player online', body: `${name} entered the city.`, type: 'social' });
    };
    this.remote.onLeave = (name) => {
      if (performance.now() > this.quietUntil) notificationService.post({ title: 'Player left', body: `${name} left the city.`, type: 'social' });
    };
  }

  /** people in the world right now, not counting the local player */
  get onlineCount(): number {
    return this.remote.count;
  }

  /** other players' cars, for getting into them (see CarRider) */
  get cars(): RemotePlayers {
    return this.remote;
  }

  start(): void {
    const { db } = getFirebase();
    const mine = this.me.uid;
    this.quietUntil = performance.now() + 4000; // the burst of "already here" players when joining is not announced

    this.unsubs.push(
      onValue(ref(db, '.info/connected'), (snap) => {
        if (snap.val() === true) this.onConnected();
        else this.connected = false;
      }),
      onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
        this.offset = typeof snap.val() === 'number' ? (snap.val() as number) : 0;
      })
    );

    // who is here
    const online = ref(db, ONLINE_PATH);
    const setOnline = (snap: DataSnapshot): void => {
      if (snap.key && snap.key !== mine) this.remote.setOnline(snap.key, snap.val() as NetOnline | null);
    };
    this.unsubs.push(
      onChildAdded(online, setOnline, this.failAt('read online')),
      onChildChanged(online, setOnline, this.failAt('read online')),
      onChildRemoved(online, (snap) => {
        if (snap.key && snap.key !== mine) this.remote.setOnline(snap.key, null);
      }, this.failAt('read online'))
    );

    // where they are
    const states = ref(db, STATE_PATH);
    const setState = (snap: DataSnapshot, first: boolean): void => {
      if (!snap.key || snap.key === mine) return;
      const v = snap.val() as NetState | null;
      // a state that was left behind by a crashed client (older than half a minute on the server's clock) is not a player
      if (first && v && typeof v.t === 'number' && Date.now() + this.offset - v.t > 30000) return;
      this.remote.setState(snap.key, v, performance.now() / 1000);
    };
    this.unsubs.push(
      onChildAdded(states, (s) => setState(s, true), this.failAt('read state')),
      onChildChanged(states, (s) => setState(s, false), this.failAt('read state')),
      onChildRemoved(states, (snap) => {
        if (snap.key && snap.key !== mine) this.remote.setState(snap.key, null, performance.now() / 1000);
      }, this.failAt('read state'))
    );

    // what they say: only the last few are asked for when joining, and a line is only shown if it is fresh and was said within hearing distance
    this.unsubs.push(
      onChildAdded(query(ref(db, CHAT_PATH), limitToLast(30)), (snap) => this.onChat(snap), this.failAt('read chat'))
    );

    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
  }

  /** a line arrived in chat/: shown (list + above their head) only when it is fresh and the speaker was within hearing distance of where we stand now */
  private onChat(snap: DataSnapshot): void {
    const v = snap.val() as unknown;
    if (!snap.key || !isChatRecord(v)) return;
    if (v.u === this.me.uid) return; // our own lines were shown the moment we sent them
    const age = typeof v.t === 'number' ? Date.now() + this.offset - v.t : 0;
    if (age > CHAT_STALE_MS) {
      remove(snap.ref).catch(() => {}); // left behind by a crashed client (the rules allow anyone to clear these)
      return;
    }
    if (age > CHAT_FRESH_MS) return; // old news (the lines that were already there when we joined)
    const me = this.src.readLocal();
    if (!isWithinHearing(v.x, v.z, v.i, me.x, me.z, me.i)) return;
    chatStore.add({ id: snap.key, uid: v.u, name: v.n, text: v.m, mine: false });
    this.remote.say(v.u, v.m);
  }

  /** says something: written to chat/ with where we stand, so that everybody can work out whether they are close enough to hear it */
  sendChat(text: string): void {
    if (this.stopped || !this.connected) return;
    const me = this.src.readLocal();
    const line: Omit<NetChat, 't'> & { t: object } = {
      u: this.me.uid,
      n: this.me.name,
      m: text,
      x: me.x,
      z: me.z,
      i: me.i,
      t: serverTimestamp(),
    };
    const r = push(ref(getFirebase().db, CHAT_PATH), line);
    r.catch(this.failAt('write chat'));
    // it only has to live long enough to be delivered
    window.setTimeout(() => remove(r).catch(() => {}), CHAT_KEEP_MS);
  }

  /** (re)announces this player; runs on the first connection and after every reconnect, because onDisconnect handlers are one-shot */
  private onConnected(): void {
    if (this.stopped) return;
    this.connected = true;
    this.forceSend = true;
    const info: NetOnline = { n: this.me.name };
    const o: NonNullable<NetOnline['o']> = {};
    for (const [k, v] of Object.entries(this.me.outfit)) if (v) o[k as keyof Outfit] = v;
    if (Object.keys(o).length) info.o = o;
    Promise.all([onDisconnect(this.stateRef).remove(), onDisconnect(this.onlineRef).remove()])
      .then(() => (this.stopped ? undefined : set(this.onlineRef, info)))
      .catch(this.failAt('write online'));
  }

  /** the engine calls this every frame */
  update(dt: number): void {
    if (this.stopped) return;
    const p = this.src.localPosition();
    this.remote.update(dt, performance.now() / 1000, p.x, p.z, p.inside);

    this.sinceSend += dt;
    if (!this.connected || !this.active || this.sinceSend < SEND_INTERVAL) return;
    const raw = this.src.readLocal();
    if (!isSendable(raw)) return;
    const s = roundState(raw);
    if (!this.forceSend && this.last && sameState(s, this.last) && this.sinceSend < HEARTBEAT_INTERVAL) return;
    this.forceSend = false;
    this.sinceSend = 0;
    this.last = s;
    const payload: Record<string, unknown> = { ...s, t: serverTimestamp() };
    if (!s.c) delete payload.c;
    set(this.stateRef, payload).catch(this.failAt('write state'));
  }

  private readonly onVisibility = (): void => {
    if (this.stopped) return;
    if (document.visibilityState === 'hidden') {
      // the screen is off / another app is in front: the game is not running, so the player steps out of the world
      this.active = false;
      remove(this.stateRef).catch(this.failAt('remove state'));
    } else {
      this.active = true;
      this.forceSend = true;
    }
  };

  private readonly onPageHide = (): void => {
    remove(this.stateRef).catch(() => {});
  };

  /** an error handler that remembers which part of the database it belongs to, so the message can say exactly where the server said no */
  private failAt(where: string): (e: unknown) => void {
    return (e: unknown): void => {
      console.error(`Multiplayer error (${where})`, e);
      if (this.failed) return;
      this.failed = true;
      const text = typeof e === 'object' && e ? `${(e as { code?: unknown }).code ?? ''} ${(e as { message?: unknown }).message ?? ''}` : String(e);
      const denied = text.toLowerCase().includes('permission');
      notificationService.post({
        title: 'Multiplayer',
        body: denied
          ? `The server refused: ${where}. Publish database.rules.json in the Firebase console (Realtime Database > Rules) on the database ${this.dbHost()}, then reload.`
          : `Could not reach the multiplayer server (${where}). You are playing alone for now.`,
        type: 'system',
      });
    };
  }

  /** which database this build talks to (the rules must be published on THIS one) */
  private dbHost(): string {
    try {
      return new URL(getFirebase().db.app.options.databaseURL ?? '').host;
    } catch {
      return '';
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    // leave the world right away (the server would do the same when the connection times out)
    remove(this.stateRef).catch(() => {});
    remove(this.onlineRef).catch(() => {});
    onDisconnect(this.stateRef).cancel().catch(() => {});
    onDisconnect(this.onlineRef).cancel().catch(() => {});
    this.remote.dispose();
  }
}
