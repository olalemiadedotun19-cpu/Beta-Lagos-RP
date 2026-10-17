import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem, type ProgressStatus } from '@capacitor/filesystem';
import { encodePath, planUpdate, validateManifest, type Installed, type Manifest, type Plan } from './plan.ts';

export const UPDATE_URL = __UPDATE_URL__;
const GAME_DIR = 'game'; // where the downloaded game lives (app-private storage, survives app restarts)
const STATE_FILE = 'installed.json';
const PARALLEL = 4;

const WebView = registerPlugin<{ setServerBasePath(o: { path: string }): Promise<void> }>('WebView');
const fs = (path: string) => ({ path, directory: Directory.Data });

export async function fetchManifest(): Promise<Manifest> {
  // CapacitorHttp = native request, so the server needs no CORS headers for this call
  const r = await CapacitorHttp.get({
    url: `${UPDATE_URL}/manifest.json?t=${Date.now()}`,
    headers: { 'Cache-Control': 'no-cache' },
    responseType: 'json',
    connectTimeout: 8000,
    readTimeout: 8000,
  });
  if (r.status !== 200) throw new Error(`Update server answered ${r.status}`);
  return validateManifest(typeof r.data === 'string' ? JSON.parse(r.data) : r.data);
}

export async function readInstalled(): Promise<Installed | null> {
  try {
    const r = await Filesystem.readFile({ ...fs(STATE_FILE), encoding: Encoding.UTF8 });
    const s = JSON.parse(r.data as string) as Installed;
    return s && s.files ? s : null;
  } catch {
    return null;
  }
}

async function writeInstalled(s: Installed): Promise<void> {
  await Filesystem.writeFile({ ...fs(STATE_FILE), data: JSON.stringify(s), encoding: Encoding.UTF8, recursive: true });
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  let failed: unknown = null;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (!failed && i < items.length) {
        const x = items[i++];
        try {
          await fn(x);
        } catch (e) {
          failed = e;
        }
      }
    }),
  );
  if (failed) throw failed;
}

export interface Progress { doneBytes: number; totalBytes: number; doneFiles: number; totalFiles: number }

/** Downloads the changed files, then marks the install as ready. Safe to call again after a failure: finished files are kept. */
export async function applyUpdate(m: Manifest, inst: Installed | null, plan: Plan, onProgress: (p: Progress) => void): Promise<void> {
  const state: Installed = {
    version: inst?.version ?? '',
    status: 'updating',
    target: m.version,
    files: { ...(inst?.files ?? {}) },
  };
  await writeInstalled(state); // from now on the game is "mixed" until we finish, so the app refuses to launch it

  const live = new Map<string, number>(); // url -> bytes of the file that is downloading right now
  let finishedBytes = 0;
  let doneFiles = 0;
  const emit = () => {
    let cur = 0;
    live.forEach((b) => (cur += b));
    onProgress({ doneBytes: Math.min(finishedBytes + cur, plan.bytes), totalBytes: plan.bytes, doneFiles, totalFiles: plan.todo.length });
  };
  const handle = await Filesystem.addListener('progress', (e: ProgressStatus) => {
    if (live.has(e.url)) {
      live.set(e.url, e.bytes);
      emit();
    }
  });

  let saving: Promise<void> = Promise.resolve();
  try {
    emit();
    await pool(plan.todo, PARALLEL, async (f) => {
      const url = `${UPDATE_URL}/${encodePath(f.path)}?v=${f.hash.slice(0, 16)}`; // ?v= defeats stale CDN copies of un-hashed files
      const part = `${GAME_DIR}/${f.path}.part`;
      const final = `${GAME_DIR}/${f.path}`;
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        live.set(url, 0);
        try {
          await Filesystem.downloadFile({ url, ...fs(part), recursive: true, progress: true });
          const st = await Filesystem.stat(fs(part));
          if (st.size !== f.size) throw new Error(`${f.path}: got ${st.size} bytes, expected ${f.size}`);
          await Filesystem.deleteFile(fs(final)).catch(() => undefined);
          await Filesystem.rename({ from: part, to: final, directory: Directory.Data, toDirectory: Directory.Data });
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 600 * attempt));
        } finally {
          live.delete(url);
        }
      }
      if (lastErr) throw lastErr;
      finishedBytes += f.size;
      doneFiles++;
      state.files[f.path] = { hash: f.hash, size: f.size };
      saving = saving.then(() => writeInstalled(state)); // remember progress so a retry resumes
      emit();
    });
    await saving;

    for (const p of plan.stale) {
      await Filesystem.deleteFile(fs(`${GAME_DIR}/${p}`)).catch(() => undefined);
      delete state.files[p];
    }
    state.version = m.version;
    state.status = 'ready';
    delete state.target;
    await writeInstalled(state);
  } finally {
    await handle.remove();
  }
}

/** Switches this WebView over to the downloaded game (it keeps the same origin, so saves / login stay). */
export async function launchGame(): Promise<void> {
  const { uri } = await Filesystem.getUri(fs(GAME_DIR));
  await WebView.setServerBasePath({ path: uri.replace(/^file:\/\//, '') });
}

export const isNative = (): boolean => Capacitor.isNativePlatform();
export { planUpdate };
