/**
 * Cloud accounts (Firebase Authentication, email + password).
 *
 * The game asks for a name (public, shown above the player), a username + password (private, for signing in) and an optional email. The username becomes a private pseudo-email
 * (`<username>@players.internallife.game`), which is what Firebase uses as the account id: Firebase itself guarantees
 * that a username can only exist once. There is no inbox behind it, so Firebase cannot send a reset mail; a real email, if given, is stored at users/<uid>/email.
 *
 * Same behaviour as the old local accounts: a new username creates the account, an existing one checks the password.
 * When Firebase is not configured yet, every function here falls back to the local accounts (auth/AccountStore.ts),
 * so the game still runs on one device exactly as before.
 *
 * The signed-in session is kept by Firebase on the device (IndexedDB), so the next launch skips the sign-in screen.
 */
import { ref, set } from 'firebase/database';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  checkEmail,
  checkName,
  checkPassword,
  checkUsername,
  normalizeUsername,
  signInOrRegister as localSignInOrRegister,
  getRememberedAccount as localGetRemembered,
  forgetAccount as localForget,
  rememberAccount as localRemember,
  type Account,
  type AuthResult,
} from '../auth/AccountStore';
import { isReservedName } from '../auth/owner';
import { globalSaveManager, LocalStorageSaveProvider } from '../save/SaveManager';
import { CloudSaveProvider } from './CloudSaveProvider';
import { getFirebase, isFirebaseConfigured } from './firebase';

export const USERNAME_DOMAIN = 'players.internallife.game';
const toEmail = (username: string): string => `${normalizeUsername(username)}@${USERNAME_DOMAIN}`;

/** the cloud account behind a Firebase user (username comes from the pseudo-email, name from the display name) */
function accountOf(user: User): Account {
  const username = (user.email ?? '').split('@')[0] || 'player';
  return { username, name: user.displayName || username, uid: user.uid };
}

/** Points the game's save system at this account's cloud save. Called after every sign-in. */
function useCloudSaves(account: Account): void {
  if (account.uid) globalSaveManager.setProvider(new CloudSaveProvider(account.uid));
}

function errorCode(e: unknown): string {
  return typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
}

function friendly(code: string): string {
  switch (code) {
    case 'auth/network-request-failed':
      return 'No connection. Check your internet and try again';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute and try again';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is not switched on in the Firebase console (Authentication > Sign-in method)';
    case 'auth/weak-password':
      return 'Use at least 6 characters';
    case 'auth/api-key-not-valid':
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
      return 'The Firebase API key in src/net/firebaseConfig.ts is not valid';
    case 'auth/configuration-not-found':
      return 'Authentication is not set up yet: Firebase console > Build > Authentication > Get started, then enable Email/Password';
    case 'auth/unauthorized-domain':
      return 'This website address is not allowed: Firebase console > Authentication > Settings > Authorized domains > add it';
    case 'auth/admin-restricted-operation':
      return 'Creating accounts is switched off: Firebase console > Authentication > Settings > User actions > allow sign-up';
    case 'auth/user-disabled':
      return 'This account has been disabled';
    case 'auth/invalid-email':
      return 'That username cannot be used. Try letters and numbers only';
    default:
      return `Something went wrong (${code || 'unknown error'}). Please try again`;
  }
}

/** keeps the optional email in the player's private record (users/<uid>/email); failures never block signing in */
async function saveContactEmail(uid: string, email: string): Promise<void> {
  try {
    await set(ref(getFirebase().db, `users/${uid}/email`), email);
  } catch (e) {
    console.warn('Could not save the email (database rules not published yet?)', e);
  }
}

/**
 * Signs in to an existing account, or creates the account when the username is new.
 * The name is what other players see; the username is only used to sign in and is never shared. The email is optional.
 */
export async function signInOrRegister(input: { name: string; username: string; password: string; email?: string }): Promise<AuthResult> {
  try {
    return await doSignInOrRegister(input);
  } catch (e) {
    console.error('Sign-in failed', e);
    const code = errorCode(e);
    const detail = code || (e instanceof Error ? e.message : String(e));
    return { ok: false, field: 'password', message: code ? friendly(code) : `Something went wrong (${detail.slice(0, 120)})` };
  }
}

async function doSignInOrRegister(input: { name: string; username: string; password: string; email?: string }): Promise<AuthResult> {
  const email = (input.email ?? '').trim();
  if (!isFirebaseConfigured) return localSignInOrRegister(input);

  const nameErr = checkName(input.name);
  if (nameErr) return { ok: false, field: 'name', message: nameErr };
  const emailErr = checkEmail(email);
  if (emailErr) return { ok: false, field: 'email', message: emailErr };
  const userErr = checkUsername(input.username);
  if (userErr) return { ok: false, field: 'username', message: userErr };
  const passErr = checkPassword(input.password);
  if (passErr) return { ok: false, field: 'password', message: passErr };

  const { auth } = getFirebase();
  const loginId = toEmail(input.username);
  const name = input.name.trim().replace(/\s+/g, ' ');

  try {
    const cred = await signInWithEmailAndPassword(auth, loginId, input.password);
    const account = accountOf(cred.user);
    useCloudSaves(account);
    if (email) void saveContactEmail(cred.user.uid, email);
    return { ok: true, account, isNew: false };
  } catch (e) {
    const code = errorCode(e);
    // With Firebase's "email enumeration protection" (on by default) a wrong password and an unknown username give the SAME error,
    // so the only reliable test is: try to create the account. If the username is taken, the password was simply wrong.
    const unknownOrWrong = code === 'auth/user-not-found' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials' || code === 'auth/wrong-password';
    if (!unknownOrWrong) return { ok: false, field: 'password', message: friendly(code) };
  }

  // a new account: the owner's name and username are not for anybody else (the existing owner signed in above and never gets here)
  if (isReservedName(name)) return { ok: false, field: 'name', message: 'That name is reserved' };
  if (isReservedName(input.username)) return { ok: false, field: 'username', message: 'That username is reserved' };

  try {
    const cred = await createUserWithEmailAndPassword(auth, loginId, input.password);
    await updateProfile(cred.user, { displayName: name });
    const account: Account = { username: normalizeUsername(input.username), name, uid: cred.user.uid };
    useCloudSaves(account);
    if (email) void saveContactEmail(cred.user.uid, email);
    return { ok: true, account, isNew: true };
  } catch (e) {
    const code = errorCode(e);
    if (code === 'auth/email-already-in-use') return { ok: false, field: 'password', message: 'Wrong password for this username' };
    return { ok: false, field: code === 'auth/weak-password' ? 'password' : 'username', message: friendly(code) };
  }
}

/** The account that is still signed in on this device (or null). Waits for Firebase to restore the session. */
export async function getRememberedAccount(): Promise<Account | null> {
  if (!isFirebaseConfigured) return localGetRemembered();
  const { auth } = getFirebase();
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) return null;
  const account = accountOf(user);
  useCloudSaves(account);
  return account;
}

/** Signing in leaves nothing to remember by hand: Firebase keeps the session. (Local mode still stores the username.) */
export function rememberAccount(account: Account): void {
  if (!isFirebaseConfigured) localRemember(account);
}

export async function signOutAccount(): Promise<void> {
  if (!isFirebaseConfigured) {
    localForget();
    return;
  }
  try {
    await globalSaveManager.flush();
  } catch {
    /* offline: the local copy is kept */
  }
  await fbSignOut(getFirebase().auth);
  globalSaveManager.setProvider(new LocalStorageSaveProvider());
}

/** The signed-in cloud account right now (null in local mode or when signed out). */
export function currentCloudAccount(): Account | null {
  if (!isFirebaseConfigured) return null;
  const user = getFirebase().auth.currentUser;
  return user ? accountOf(user) : null;
}

/** Calls back whenever the cloud sign-in changes (used to stop multiplayer when the session ends). */
export function onCloudAuthChange(cb: (account: Account | null) => void): () => void {
  if (!isFirebaseConfigured) return () => {};
  return onAuthStateChanged(getFirebase().auth, (user) => cb(user ? accountOf(user) : null));
}
