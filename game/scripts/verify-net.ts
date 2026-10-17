/**
 * Headless checks for the multiplayer layer (no browser, no Firebase, no WebGL):  npx tsx scripts/verify-net.ts
 *  - every message the game can send passes database.rules.json (a small evaluator runs the real rule strings against the real payloads)
 *  - messages that should be refused are refused (someone else's uid, a fake username, out-of-range numbers, unknown fields)
 *  - the "did anything change" test, the angle wrapping and the interpolation buffer behave
 */
import { readFileSync } from 'node:fs';
import {
  bracket,
  angleDelta,
  roundState,
  sameState,
  isSendable,
  cleanChatText,
  isChatRecord,
  isWithinHearing,
  CHAT_MAX_LEN,
  CHAT_RADIUS,
  type NetState,
  type NetOnline,
} from '../src/net/protocol';

const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules;

// ---- a tiny evaluator for the subset of the rules language used here -------------------------------------------------
// the rules language has String.matches(/regex/); plain JS does not
(String.prototype as unknown as { matches: (re: RegExp) => boolean }).matches = function (this: string, re: RegExp) { return re.test(this); };

type Rule = Record<string, unknown>;
function mock(value: unknown) {
  const isObj = typeof value === 'object' && value !== null;
  return {
    val: () => value,
    isNumber: () => typeof value === 'number',
    isString: () => typeof value === 'string',
    hasChildren: (keys: string[]) => isObj && keys.every((k) => k in (value as object)),
    exists: () => value !== null && value !== undefined,
    child: (k: string) => mock(isObj ? (value as Record<string, unknown>)[k] : undefined),
  };
}
/** what the rules language calls `now` (server time, ms) and `root` (the whole database) in these checks */
const NOW = 1.7e12;
const ROOT = mock({ online: { abc123: { n: 'Tunde K' } } });
function evalRule(expr: unknown, newData: unknown, auth: unknown, vars: Record<string, string>): boolean {
  if (typeof expr === 'boolean') return expr;
  const names = Object.keys(vars);
  // rules use `String.length`; JS does too
  return !!new Function('newData', 'auth', 'now', 'root', 'data', ...names, `return (${expr as string});`)(mock(newData), auth, NOW, ROOT, mock(null), ...names.map((n) => vars[n]));
}
function validate(rule: Rule, value: unknown, auth: unknown, vars: Record<string, string>, path: string, errors: string[]): void {
  if ('.validate' in rule && !evalRule(rule['.validate'], value, auth, vars)) errors.push(`${path}: .validate failed`);
  if (typeof value !== 'object' || value === null) return;
  for (const [k, v] of Object.entries(value)) {
    const named = rule[k] as Rule | undefined;
    const wild = Object.keys(rule).find((r) => r.startsWith('$'));
    const child = named ?? (wild ? (rule[wild] as Rule) : undefined);
    if (!child) continue; // no rule = no restriction
    validate(child, v, auth, wild && !named ? { ...vars, [wild]: k } : vars, `${path}/${k}`, errors);
  }
}
/** would Firebase accept `value` written at `path` by `auth`? */
function accepts(path: string, value: unknown, auth: { uid: string; token: { email: string } } | null): string[] {
  const parts = path.split('/');
  const errors: string[] = [];
  let rule: Rule = rules;
  const vars: Record<string, string> = {};
  let canWrite = false;
  for (const part of parts) {
    const wild = Object.keys(rule).find((r) => r.startsWith('$'));
    const next = (rule[part] as Rule | undefined) ?? (wild ? (rule[wild] as Rule) : undefined);
    if (!next) return ['no rule for ' + path];
    if (!rule[part] && wild) vars[wild] = part;
    rule = next;
    if ('.write' in rule && evalRule(rule['.write'], value, auth, vars)) canWrite = true;
  }
  if (!canWrite) return ['write not allowed'];
  validate(rule, value, auth, vars, path, errors);
  return errors;
}

let failed = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  ' + detail}`);
  if (!ok) failed++;
};
const expectOk = (name: string, errs: string[]): void => check(name, errs.length === 0, errs.join('; '));
const expectRefused = (name: string, errs: string[]): void => check(name, errs.length > 0, 'was accepted');

const me = { uid: 'abc123', token: { email: 'tunde_k@players.internallife.game' } };

// ---- messages the game sends ---------------------------------------------------------------------------------------------
const walking = roundState({ x: 31.5123, y: 2.4, z: 1570.9876, r: 9.5, g: 1, i: 0, k: 0, kt: 0, km: 0 });
expectOk('walking state', accepts('state/abc123', { ...walking, t: 1.7e12 }, me));

const driving = roundState({
  x: 120.5, y: 0.4, z: -33.2, r: -12.8, g: 1, i: 0, k: 2, kt: 0, km: 0,
  c: { x: 120.5, y: 0.2, z: -33.2, r: -12.8, p: 0.12, l: -0.05, s: 0.3, dl: 0, dr: 1 },
});
expectOk('driving state with car', accepts('state/abc123', { ...driving, t: 1.7e12 }, me));
check('yaw is wrapped small', Math.abs(driving.r) <= Math.PI && Math.abs(driving.c!.r) <= Math.PI, String(driving.r));

const inside = roundState({ x: 10, y: 0, z: 20, r: 1, g: 1, i: 1, k: 0, kt: 0, km: 0 });
expectOk('inside a building', accepts('state/abc123', { ...inside, t: 1 }, me));

const info: NetOnline = { n: 'Tunde Kareem', o: { shirts: 'leather_jacket' } };
expectOk('online info', accepts('online/abc123', info, me));
expectOk('online info, no clothes', accepts('online/abc123', { n: 'Tunde' }, me));
expectOk('optional email', accepts('users/abc123/email', 'tunde@example.com', me));
expectRefused('email that is a number', accepts('users/abc123/email', 12345, me));
expectOk('cloud save', accepts('users/abc123/save', { v: 1, updatedAt: 1.7e12, data: '{"identity":{}}' }, me));

// ---- messages that must be refused ---------------------------------------------------------------------------------------
expectRefused('writing another player\'s state', accepts('state/zzz999', { ...walking, t: 1 }, me));
expectRefused('not signed in', accepts('state/abc123', { ...walking, t: 1 }, null));
expectRefused('username is never published', accepts('online/abc123', { u: 'tunde_k', n: 'Tunde' }, me));
expectRefused('writing another player\'s online entry', accepts('online/zzz999', { n: 'Tunde' }, me));
expectRefused('position out of range', accepts('state/abc123', { ...walking, x: 99999, t: 1 }, me));
expectRefused('unknown field in state', accepts('state/abc123', { ...walking, cheat: 1, t: 1 }, me));
expectRefused('unknown field in car', accepts('state/abc123', { ...driving, c: { ...driving.c, boost: 9 }, t: 1 }, me));
expectRefused('car missing a field', accepts('state/abc123', { ...driving, c: { x: 1, y: 1, z: 1, r: 1 }, t: 1 }, me));
expectRefused('flag that is not 0 or 1', accepts('state/abc123', { ...walking, g: 5, t: 1 }, me));
expectRefused('reading/writing someone else\'s save', accepts('users/zzz999/save', { v: 1, updatedAt: 1, data: 'x' }, me));
expectRefused('save that is too big', accepts('users/abc123/save', { v: 1, updatedAt: 1, data: 'x'.repeat(100001) }, me));
expectRefused('unknown top-level path', accepts('admin/flag', true, me));

// ---- protocol helpers ----------------------------------------------------------------------------------------------------
const base: Omit<NetState, 't'> = roundState({ x: 1, y: 0, z: 1, r: 0.5, g: 1, i: 0, k: 0, kt: 0, km: 0 });
check('same state: nothing moved', sameState(base, roundState({ ...base })));
check('same state: moved 5 cm', !sameState(base, { ...base, x: 1.05 }));
check('same state: turned', !sameState(base, { ...base, r: 0.6 }));
check('same state: jumped', !sameState(base, { ...base, g: 0 }));
check('same state: getting into a car always differs', !sameState({ ...base, k: 1 }, { ...base, k: 1 }));
check('same state: car appeared', !sameState(base, { ...base, c: driving.c }));
check('NaN is not sendable', !isSendable({ ...base, x: NaN }));
check('angleDelta wraps', Math.abs(angleDelta(3.0, -3.0) - (2 * Math.PI - 6.0)) < 1e-9);
check('angleDelta huge input', Math.abs(angleDelta(0, 1e6)) <= Math.PI + 1e-9);

// ---- proximity chat --------------------------------------------------------------------------------------------------------
const said = { u: 'abc123', n: 'Tunde K', m: 'hello there', x: 31.5, z: 1570.98, i: 0, t: NOW };
expectOk('chat line', accepts('chat/-Nabc', said, me));
expectRefused('chat: in somebody else\'s name (uid)', accepts('chat/-Nabc', { ...said, u: 'zzz999' }, me));
expectRefused('chat: with somebody else\'s display name', accepts('chat/-Nabc', { ...said, n: 'Admin' }, me));
expectRefused('chat: empty text', accepts('chat/-Nabc', { ...said, m: '' }, me));
expectRefused('chat: too long', accepts('chat/-Nabc', { ...said, m: 'x'.repeat(CHAT_MAX_LEN + 1) }, me));
expectOk('chat: exactly the longest allowed', accepts('chat/-Nabc', { ...said, m: 'x'.repeat(CHAT_MAX_LEN) }, me));
expectRefused('chat: a made-up time', accepts('chat/-Nabc', { ...said, t: 5 }, me));
expectRefused('chat: out-of-range position', accepts('chat/-Nabc', { ...said, x: 99999 }, me));
expectRefused('chat: unknown field', accepts('chat/-Nabc', { ...said, admin: 1 }, me));
expectRefused('chat: missing field', accepts('chat/-Nabc', { u: 'abc123', n: 'Tunde K', m: 'hi' }, me));
expectRefused('chat: signed out', accepts('chat/-Nabc', said, null));

check('chat text is trimmed and folded', cleanChatText('   hi   there \n you ') === 'hi there you');
check('chat text: control characters removed', cleanChatText('a\u0000b\u202ec') === 'a b c');
check('chat text: empty stays empty', cleanChatText('  \n ') === '');
check('chat text is cut to the limit', cleanChatText('y'.repeat(500)).length === CHAT_MAX_LEN);
check('chat record accepted', isChatRecord(said));
check('chat record: junk refused', !isChatRecord({ ...said, i: 5 }) && !isChatRecord(null) && !isChatRecord({ ...said, m: 7 }));

check('hearing: close, outside', isWithinHearing(0, 0, 0, 10, 10, 0));
check('hearing: just inside the radius', isWithinHearing(0, 0, 0, CHAT_RADIUS - 0.1, 0, 0));
check('hearing: just beyond the radius', !isWithinHearing(0, 0, 0, CHAT_RADIUS + 0.1, 0, 0));
check('hearing: far away', !isWithinHearing(0, 0, 0, 500, 500, 0));
check('hearing: close but one is inside a building', !isWithinHearing(0, 0, 1, 1, 1, 0) && !isWithinHearing(0, 0, 0, 1, 1, 1));
check('hearing: both inside the same building', isWithinHearing(5, 5, 1, 5, 5, 1));

// ---- interpolation buffer ------------------------------------------------------------------------------------------------
const buf = [{ at: 10.0 }, { at: 10.1 }, { at: 10.2 }];
let b = bracket(buf, 10.15);
check('bracket middle', b.a === buf[1] && b.c === buf[2] && Math.abs(b.f - 0.5) < 1e-9, JSON.stringify(b));
b = bracket(buf, 9.0);
check('bracket before first holds the first', b.a === buf[0] && b.f === 0);
b = bracket(buf, 11.0);
check('bracket after last holds the last (no guessing ahead)', b.a === buf[2] && b.c === buf[2] && b.f === 0);

console.log(failed === 0 ? '\nall checks passed' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
