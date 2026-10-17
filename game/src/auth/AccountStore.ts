/**
 * Local player accounts (name, username, password).
 *
 * There is no game server, so accounts live on this device only (localStorage). Passwords are never stored: only a random salt and a
 * PBKDF2-SHA256 hash (a plain iterated SHA-256 where the browser has no WebCrypto, e.g. an http:// LAN address while developing).
 * That keeps a casual person from signing in as someone else on a shared device; it is NOT server-grade security.
 *
 * Each account owns one save slot (accountSlot) in SaveManager.
 */

import { isReservedName } from './owner';

const KEY = 'intl_life_accounts_v1';
const SESSION_KEY = 'intl_life_session_v1';

interface AccountRecord {
  username: string;
  name: string;
  salt: string; // hex
  hash: string; // hex
  iters: number;
  createdAt: number;
}

export interface Account {
  username: string;
  name: string;
  /** Firebase user id (cloud accounts only; local accounts have none) */
  uid?: string;
}

export type AuthField = 'name' | 'username' | 'password' | 'email';
export type AuthResult =
  | { ok: true; account: Account; isNew: boolean }
  | { ok: false; field: AuthField; message: string };

const NAME_RE = /^[\p{L}][\p{L}\s'.-]*$/u;
const USER_RE = /^[a-z0-9_]+$/;

export const normalizeUsername = (u: string): string => u.trim().toLowerCase();
export const accountSlot = (username: string): string => `acct_${normalizeUsername(username)}`;

/** field checks shared by the form (live hints) and signIn (final gate); '' = valid */
export function checkName(name: string): string {
  const n = name.trim();
  if (n.length < 2 || n.length > 60 || !NAME_RE.test(n)) return 'Use 2 to 60 letters (spaces, - and \' allowed)';
  return '';
}
export function checkUsername(username: string): string {
  const u = normalizeUsername(username);
  if (u.length < 3 || u.length > 20 || !USER_RE.test(u)) return 'Use 3 to 20 letters, numbers or underscores';
  return '';
}
/** the email is optional: '' = fine (none given) or a valid-looking address */
export function checkEmail(email: string): string {
  const e = email.trim();
  if (!e) return '';
  if (e.length > 100 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return 'Enter a valid email, or leave it empty';
  return '';
}
export function checkPassword(password: string): string {
  if (password.length < 6) return 'Use at least 6 characters';
  if (password.length > 64) return 'Use at most 64 characters';
  return '';
}

function readAll(): AccountRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as AccountRecord[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAll(list: AccountRecord[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    console.error('Could not save accounts', e);
    return false;
  }
}

export function accountExists(username: string): boolean {
  const u = normalizeUsername(username);
  return !!u && readAll().some((a) => a.username === u);
}

// ------------------------------------------------------------------ hashing

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string): Uint8Array => Uint8Array.from(h.match(/.{2}/g) ?? [], (x) => parseInt(x, 16));

/** compact SHA-256 for the no-WebCrypto fallback */
function sha256(data: Uint8Array): Uint8Array {
  const K = new Uint32Array(64);
  for (let n = 2, c = 0; c < 64; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (prime) K[c++] = Math.floor((Math.cbrt(n) % 1) * 4294967296);
  }
  const H = new Uint32Array(8);
  for (let n = 2, c = 0; c < 8; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (prime) H[c++] = Math.floor((Math.sqrt(n) % 1) * 4294967296);
  }
  const len = data.length;
  const total = (((len + 9 + 63) >> 6) << 6);
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor((len * 8) / 4294967296));
  dv.setUint32(total - 4, (len * 8) >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
  return out;
}

async function derive(password: string, salt: Uint8Array, iters: number): Promise<string> {
  const enc = new TextEncoder().encode(password);
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (subtle) {
    const key = await subtle.importKey('raw', enc, 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iters }, key, 256);
    return toHex(new Uint8Array(bits));
  }
  let cur: Uint8Array = new Uint8Array([...salt, ...enc]);
  const rounds = Math.min(iters, 3000); // the JS fallback is slow: fewer rounds
  for (let i = 0; i < rounds; i++) cur = sha256(i === 0 ? cur : new Uint8Array([...cur, ...salt]));
  return toHex(cur);
}

const ITERS = 100000;

/** Signs in to an existing account, or creates the account when the username is new. */
export async function signInOrRegister(input: { name: string; username: string; password: string }): Promise<AuthResult> {
  const nameErr = checkName(input.name);
  if (nameErr) return { ok: false, field: 'name', message: nameErr };
  const userErr = checkUsername(input.username);
  if (userErr) return { ok: false, field: 'username', message: userErr };
  const passErr = checkPassword(input.password);
  if (passErr) return { ok: false, field: 'password', message: passErr };

  const username = normalizeUsername(input.username);
  const list = readAll();
  const found = list.find((a) => a.username === username);

  if (found) {
    const hash = await derive(input.password, fromHex(found.salt), found.iters);
    if (hash !== found.hash) return { ok: false, field: 'password', message: 'Wrong password for this username' };
    return { ok: true, account: { username, name: found.name }, isNew: false };
  }

  // a new account: the owner's name and username are not for anybody else
  if (isReservedName(input.name) || isReservedName(username)) return { ok: false, field: isReservedName(input.name) ? 'name' : 'username', message: 'That name is reserved' };

  const salt = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(salt);
  else for (let i = 0; i < salt.length; i++) salt[i] = Math.floor(Math.random() * 256);
  const name = input.name.trim().replace(/\s+/g, ' ');
  const record: AccountRecord = { username, name, salt: toHex(salt), hash: await derive(input.password, salt, ITERS), iters: ITERS, createdAt: Date.now() };
  if (!writeAll([...list, record])) return { ok: false, field: 'username', message: 'This device cannot store accounts (storage is blocked)' };
  return { ok: true, account: { username, name }, isNew: true };
}

// ------------------------------------------------------------------ remembered sign-in

/**
 * After a successful sign-in the device remembers who it was, so the next launch goes straight on without the sign-in screen
 * (no name, no username, no password). Only the username is kept; it is cleared by signing out. Same limits as the accounts:
 * this is a convenience on this device, not server security.
 */
export function rememberAccount(account: Account): void {
  try {
    localStorage.setItem(SESSION_KEY, account.username);
  } catch {
    /* storage blocked: the player simply signs in again next time */
  }
}

export function forgetAccount(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** the account that signed in last on this device, or null (never signed in, signed out, or the account no longer exists) */
export function getRememberedAccount(): Account | null {
  try {
    const u = localStorage.getItem(SESSION_KEY);
    if (!u) return null;
    const rec = readAll().find((a) => a.username === u);
    return rec ? { username: rec.username, name: rec.name } : null;
  } catch {
    return null;
  }
}
