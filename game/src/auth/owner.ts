/**
 * The owner's account (DOTCON).
 *
 *  - Nobody else may use the name: it is refused when a new account is made (auth/AccountStore.ts, net/cloudAuth.ts) and the database
 *    rules refuse it in online/<uid>/n for everyone except this account (database.rules.json: keep the username there in step with this one).
 *  - The owner's character gets a one-time grant of OWNER_GRANT naira in cash (finances.ownerGrant marks that it was paid, so it is not paid again
 *    every time the game opens).
 *
 * Client-side like the rest of the game's saves: it keeps honest players out, it is not server-grade protection.
 */
import type { PlayerData } from '../types/game';

/** the sign-in username of the owner's account (lowercase) */
export const OWNER_USERNAME = 'dotcon';
/** names (and usernames) nobody else can take */
const RESERVED = ['dotcon'];
/** 90 trillion naira */
export const OWNER_GRANT = 90_000_000_000_000;

/** look-alike letters from other alphabets that are folded to the Latin letter they imitate */
const LOOKALIKE: Record<string, string> = { '\u043e': 'o', '\u03bf': 'o', '\u0441': 'c', '\u0501': 'd', '\u0585': 'o', '\u0578': 'n' };

/** does this name contain a reserved one? Case, spaces, dots, dashes, accents, 0-for-o and look-alike letters do not get around it. */
export function isReservedName(name: string): boolean {
  const folded = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u043e\u03bf\u0441\u0501\u0585\u0578]/g, (c) => LOOKALIKE[c] ?? c)
    .replace(/0/g, 'o')
    .replace(/[^a-z]/g, '');
  return RESERVED.some((r) => folded.includes(r));
}

export const isOwnerUsername = (username: string): boolean => username.trim().toLowerCase() === OWNER_USERNAME;

/** the owner's character with the grant paid (once); everybody else's data comes back untouched */
export function withOwnerGrant(account: { username: string }, data: PlayerData): PlayerData {
  if (!isOwnerUsername(account.username) || data.finances.ownerGrant) return data;
  return { ...data, finances: { ...data.finances, cash: data.finances.cash + OWNER_GRANT, ownerGrant: OWNER_GRANT } };
}
