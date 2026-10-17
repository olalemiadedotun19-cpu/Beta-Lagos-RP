/**
 * PASTE YOUR FIREBASE WEB CONFIG HERE.
 *
 * Firebase console > Project settings (gear icon) > General > "Your apps" > Web app (</>) > SDK setup and configuration > Config.
 * Copy the values of the firebaseConfig object into the fields below. These values are NOT secrets (every web app ships them);
 * what protects your data is database.rules.json.
 *
 * `databaseURL` only shows up in that config after you create the Realtime Database. If it is missing, open
 * Build > Realtime Database in the console and copy the URL shown at the top of the data tab
 * (looks like https://YOUR-PROJECT-default-rtdb.firebaseio.com, or ...europe-west1.firebasedatabase.app).
 *
 * Optional: instead of editing this file you can set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_DATABASE_URL,
 * VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID in a .env.local file; they win over the values here.
 */
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyDEJ-EYh9MoowFXSVseAtJnCm0XBrWbymQ',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'beta-lagos-rp.firebaseapp.com',
  databaseURL: env.VITE_FIREBASE_DATABASE_URL || 'https://beta-lagos-rp-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'beta-lagos-rp',
  appId: env.VITE_FIREBASE_APP_ID || '1:334685149825:web:6e0b1c23e90d07b51a4b80',
};

/** true once real values have been pasted in (until then the game runs in local single-player mode, exactly as before) */
export const isFirebaseConfigured: boolean =
  !Object.values(firebaseConfig).some((v) => !v || v.startsWith('PASTE_'));
