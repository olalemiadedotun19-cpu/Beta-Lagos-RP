#!/usr/bin/env node
/**
 * npm run apk  ->  apk/International-Life-debug.apk
 * Needs: JDK 21 + Android SDK (Android Studio installs both). On GitHub the workflow in .github/workflows does it for you.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const sh = (cmd, a, cwd = root) => {
  const r = spawnSync(cmd, a, { cwd, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`\n✗ "${cmd} ${a.join(' ')}" failed`);
    process.exit(r.status ?? 1);
  }
};

const cfg = JSON.parse(readFileSync(join(root, 'update.config.json'), 'utf8'));
// The hosting link can come from update.config.json or from the UPDATE_URL environment variable (used by Codemagic).
const updateUrl = (process.env.UPDATE_URL || cfg.updateUrl || '').trim();
if (!/^https:\/\//.test(updateUrl) || /YOUR/i.test(updateUrl)) {
  console.error('\n✗ Set "updateUrl" in update.config.json (or the UPDATE_URL variable) to your hosting link first (https://<project>.pages.dev).\n');
  process.exit(1);
}
process.env.UPDATE_URL = updateUrl; // vite.config.ts bakes this into the launcher
const appId = /appId:\s*'([^']+)'/.exec(readFileSync(join(root, 'capacitor.config.ts'), 'utf8'))?.[1];
if (!appId) throw new Error('appId not found in capacitor.config.ts');

console.log('▶ Building the launcher');
sh('npx', ['vite', 'build']);

const android = join(root, 'android');
if (!existsSync(android)) {
  console.log('▶ Creating the Android project');
  sh('npx', ['cap', 'add', 'android']);
}

// full-screen window + landscape + more memory for the 3D game
const javaDir = join(android, 'app/src/main/java', ...appId.split('.'));
mkdirSync(javaDir, { recursive: true });
writeFileSync(join(javaDir, 'MainActivity.java'), readFileSync(join(root, 'android-overrides/MainActivity.java'), 'utf8').replace('__APP_ID__', appId));
const manifestPath = join(android, 'app/src/main/AndroidManifest.xml');
let xml = readFileSync(manifestPath, 'utf8');
if (!xml.includes('screenOrientation')) xml = xml.replace('<activity', '<activity\n            android:screenOrientation="sensorLandscape"');
if (!xml.includes('largeHeap')) xml = xml.replace('<application', '<application\n        android:largeHeap="true"');
writeFileSync(manifestPath, xml);

// app icon (Beta Lagos RP logo): adaptive + legacy launcher icons from android-overrides/res
const resSrc = join(root, 'android-overrides/res');
if (existsSync(resSrc)) {
  console.log('▶ Installing the app icon');
  cpSync(resSrc, join(android, 'app/src/main/res'), { recursive: true, force: true });
}

// make sure Gradle can find the Android SDK (Codemagic / GitHub set one of these)
const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
const localProps = join(android, 'local.properties');
if (sdk && !existsSync(localProps)) writeFileSync(localProps, `sdk.dir=${sdk.replace(/\\/g, '/')}\n`);

console.log('▶ Syncing');
sh('npx', ['cap', 'sync', 'android']);

console.log('▶ Building the APK');
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
sh(gradlew, ['assembleDebug'], android);

mkdirSync(join(root, 'apk'), { recursive: true });
const from = join(android, 'app/build/outputs/apk/debug/app-debug.apk');
const to = join(root, 'apk/International-Life-debug.apk');
copyFileSync(from, to);
console.log(`\n✓ APK ready: ${to}\n  Copy it to the phone and install it. You only rebuild the APK if you change the launcher.`);
