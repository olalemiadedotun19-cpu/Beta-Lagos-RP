import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';
import { firebaseConfig, isFirebaseConfigured } from './firebaseConfig';

export { isFirebaseConfigured };

export interface Firebase {
  app: FirebaseApp;
  auth: Auth;
  db: Database;
}

let instance: Firebase | null = null;

/** The one Firebase app (created on first use). Only call when isFirebaseConfigured is true. */
export function getFirebase(): Firebase {
  if (instance) return instance;
  if (!isFirebaseConfigured) throw new Error('Firebase is not configured (src/net/firebaseConfig.ts)');
  const app = getApps()[0] ?? initializeApp(firebaseConfig);
  instance = { app, auth: getAuth(app), db: getDatabase(app) };
  return instance;
}
