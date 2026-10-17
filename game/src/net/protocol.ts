/**
 * What the players tell each other. Shared by the sender (MultiplayerSession) and the receiver (RemotePlayers) and mirrored by
 * database.rules.json: if you add or rename a field here, add it to the rules too (the rules reject unknown fields).
 *
 * Database layout (Firebase Realtime Database):
 *   users/<uid>/save    the player's save, private to its owner                                  (CloudSaveProvider)
 *   online/<uid>        who is in the world: display name, clothes (never the username). Removed when they leave.   ONLINE_PATH
 *   state/<uid>         where they are right now (10x a second while moving). Removed on leave.   STATE_PATH
 *
 * Keys are one or two letters on purpose: this is sent ten times a second to everybody.
 */
import type { Outfit } from '../wardrobe/Wardrobe';

export const ONLINE_PATH = 'online';
export const STATE_PATH = 'state';
export const CHAT_PATH = 'chat';

/** how often the position is sent while something changes (s), and how often when nothing does (a heartbeat so others know we are alive) */
export const SEND_INTERVAL = 0.1;
export const HEARTBEAT_INTERVAL = 2.5;
/** a player we heard nothing from for this long (s) is treated as gone (crash, lost signal) */
export const STALE_AFTER = 12;
/** others are drawn this far behind real time (s): the buffer that makes 10 updates a second look smooth */
export const INTERP_DELAY = 0.15;
/** avatars are only built for players closer than this (m); they are dropped again beyond DROP_RADIUS */
export const SHOW_RADIUS = 220;
export const DROP_RADIUS = 280;
/** at most this many avatars are drawn at once (the nearest ones) */
export const MAX_AVATARS = 12;
/** two updates further apart than this (m) are a teleport, not a walk: no sliding between them */
export const TELEPORT_DISTANCE = 40;

/** what is shown about a player (written once when they join) */
export interface NetOnline {
  /** display name (the username is private and never sent) */
  n: string;
  /** clothes (wardrobe ids); a missing key = nothing worn */
  o?: Partial<Record<keyof Outfit, string>>;
}

/** the player's car (absent when it is not out) */
export interface NetCar {
  x: number;
  y: number;
  z: number;
  /** heading (rad) */
  r: number;
  /** pitch (rad, nose up) */
  p: number;
  /** roll (rad, left side up) */
  l: number;
  /** front wheel steering angle (rad, + = left) */
  s: number;
  /** left / right door open (0 or 1) */
  dl: number;
  dr: number;
}

/** car clip the character is in: 0 none (walking), 1 getting in, 2 driving, 3 getting out */
export type NetCarClip = 0 | 1 | 2 | 3;

export interface NetState {
  x: number;
  y: number;
  z: number;
  /** body yaw (rad) */
  r: number;
  /** on the ground (1) or in the air (0) */
  g: number;
  /** inside a building (1): the world is not where they are, so nobody outside sees them */
  i: number;
  /** car clip, see NetCarClip */
  k: number;
  /** car clip time (s) */
  kt: number;
  /** mirrored: 1 when they use the right-hand door (passenger side) */
  km: number;
  /** uid of the player whose car they are riding in (absent when they are not a passenger in somebody else's car) */
  h?: string;
  /** health 0..100 (whole numbers: it changes slowly, so it hardly ever costs a message); absent from older clients */
  hp?: number;
  c?: NetCar;
  /** server time of the write (filled in by Firebase) */
  t?: number;
}

export const r2 = (v: number): number => Math.round(v * 100) / 100;
export const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** wrap an angle difference into -PI..PI */
export function angleDelta(from: number, to: number): number {
  const d = to - from;
  return d - Math.PI * 2 * Math.round(d / (Math.PI * 2));
}

/**
 * The two updates around the moment `t` (local seconds) and how far through them it is (0 = the first, 1 = the second).
 * `buf` is in arrival order. Before the first update it stays on the first, after the last it stays on the last (no guessing ahead).
 */
export function bracket<T extends { at: number }>(buf: T[], t: number): { a: T; c: T; f: number } {
  let i = buf.length - 1;
  while (i > 0 && buf[i].at > t) i--;
  const a = buf[i];
  const c = buf[Math.min(i + 1, buf.length - 1)];
  const f = c === a ? 0 : Math.min(1, Math.max(0, (t - a.at) / (c.at - a.at)));
  return { a, c, f };
}

/** true when two states are close enough that sending the new one would tell nobody anything */
export function sameState(a: Omit<NetState, 't'>, b: Omit<NetState, 't'>): boolean {
  if (a.g !== b.g || a.i !== b.i || a.k !== b.k || a.km !== b.km || a.h !== b.h || a.hp !== b.hp) return false;
  if (a.k === 1 || a.k === 3) return false; // the car clip is playing: its time moves every frame
  if (Math.abs(a.x - b.x) > 0.02 || Math.abs(a.y - b.y) > 0.02 || Math.abs(a.z - b.z) > 0.02) return false;
  if (Math.abs(angleDelta(a.r, b.r)) > 0.02) return false;
  if (!!a.c !== !!b.c) return false;
  if (a.c && b.c) {
    const p = a.c;
    const q = b.c;
    if (Math.abs(p.x - q.x) > 0.02 || Math.abs(p.y - q.y) > 0.02 || Math.abs(p.z - q.z) > 0.02) return false;
    if (Math.abs(angleDelta(p.r, q.r)) > 0.01 || Math.abs(p.p - q.p) > 0.01 || Math.abs(p.l - q.l) > 0.01 || Math.abs(p.s - q.s) > 0.01) return false;
    if (p.dl !== q.dl || p.dr !== q.dr) return false;
  }
  return true;
}

/** a state is only sent when every number in it is a real number (Firebase refuses NaN / Infinity) */
export function isSendable(s: Omit<NetState, 't'>): boolean {
  const ok = (v: number): boolean => Number.isFinite(v);
  if (!ok(s.x) || !ok(s.y) || !ok(s.z) || !ok(s.r) || !ok(s.kt) || (s.hp !== undefined && !ok(s.hp))) return false;
  const c = s.c;
  return !c || (ok(c.x) && ok(c.y) && ok(c.z) && ok(c.r) && ok(c.p) && ok(c.l) && ok(c.s));
}

/** rounds the numbers (centimetres, milliradians): smaller messages, and no change is sent for noise */
export function roundState(s: Omit<NetState, 't'>): Omit<NetState, 't'> {
  const out: Omit<NetState, 't'> = {
    x: r2(s.x),
    y: r2(s.y),
    z: r2(s.z),
    r: r3(angleDelta(0, s.r)),
    g: s.g,
    i: s.i,
    k: s.k,
    kt: r2(s.kt),
    km: s.km,
  };
  if (s.h) out.h = s.h;
  if (s.hp !== undefined) out.hp = Math.max(0, Math.min(100, Math.round(s.hp)));
  if (s.c) {
    out.c = { x: r2(s.c.x), y: r2(s.c.y), z: r2(s.c.z), r: r3(angleDelta(0, s.c.r)), p: r3(s.c.p), l: r3(s.c.l), s: r3(s.c.s), dl: s.c.dl, dr: s.c.dr };
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- proximity chat

/** a message is only heard by players closer than this (m) to where it was said. Further away it is never shown, in the list or above the head. */
export const CHAT_RADIUS = 30;
/** longest message (characters); the database rules enforce the same limit */
export const CHAT_MAX_LEN = 120;
/** the chat list keeps this many lines; the box shows CHAT_VISIBLE_LINES of them and the rest is reached by scrolling up */
export const CHAT_HISTORY = 100;
export const CHAT_VISIBLE_LINES = 5;
/** least time between two messages from one player (s) */
export const CHAT_MIN_GAP = 0.7;
/** a message the server still has after this long (ms, server clock) is left over from a crashed client: not shown, and removed */
export const CHAT_FRESH_MS = 15000;
export const CHAT_STALE_MS = 120000;
/** the sender removes their own message from the database after this long (ms): it only has to live long enough to be delivered */
export const CHAT_KEEP_MS = 30000;

/** one spoken line in the database: chat/<pushId> (written once, never changed) */
export interface NetChat {
  /** who said it (the auth uid; the rules make sure it is the writer) */
  u: string;
  /** their display name (the rules make sure it is the name in online/<uid>) */
  n: string;
  /** what was said */
  m: string;
  /** where they stood (a player inside a building stands at its door, like in NetState) */
  x: number;
  z: number;
  /** inside a building (1) or outside (0): people inside and outside do not hear each other */
  i: number;
  /** server time of the write (filled in by Firebase) */
  t?: number;
}

/** what the player typed, made safe to send and to draw: control characters gone, runs of spaces folded, trimmed, cut to CHAT_MAX_LEN. '' = nothing to say. */
export function cleanChatText(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const t = String(raw ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > CHAT_MAX_LEN ? t.slice(0, CHAT_MAX_LEN).trimEnd() : t;
}

/** true when somebody who said something at (sx, sz) is heard by somebody standing at (lx, lz): same side of the door and within CHAT_RADIUS */
export function isWithinHearing(sx: number, sz: number, sInside: number, lx: number, lz: number, lInside: number): boolean {
  if ((sInside ? 1 : 0) !== (lInside ? 1 : 0)) return false;
  return Math.hypot(sx - lx, sz - lz) <= CHAT_RADIUS;
}

/** a database chat record is only used when every field is what it should be (anyone signed in can write to the database, so the reader checks too) */
export function isChatRecord(v: unknown): v is NetChat {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.u === 'string' &&
    typeof c.n === 'string' &&
    c.n.length > 0 &&
    typeof c.m === 'string' &&
    c.m.length > 0 &&
    c.m.length <= CHAT_MAX_LEN &&
    Number.isFinite(c.x) &&
    Number.isFinite(c.z) &&
    (c.i === 0 || c.i === 1)
  );
}
