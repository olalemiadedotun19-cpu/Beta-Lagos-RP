import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { formatBytes, planUpdate, type Installed, type Manifest, type Plan } from './plan.ts';
import { UPDATE_URL, applyUpdate, fetchManifest, isNative, launchGame, readInstalled } from './updater.ts';

/*
 * This file has no screen of its own. The page is the game's launch sequence (DOTCON -> logo -> welcome -> loading screen),
 * and launcher/launch-bridge.js calls this API from that loading screen: check -> (ask) -> download -> launch.
 */

const SKIP_INTRO_KEY = 'bl_skip_intro'; // tells the game's copy of the launch page that the intro was already shown

let pending: { m: Manifest; inst: Installed | null; plan: Plan } | null = null;

const api: LauncherApi = {
  async check() {
    pending = null;
    const installed = await readInstalled();
    let manifest: Manifest;
    try {
      manifest = await fetchManifest();
    } catch (e) {
      console.error(e);
      if (installed?.version && installed.status === 'ready') return { kind: 'play' }; // offline: play what is on the phone
      throw new Error('Failed to fetch'); // nothing playable and no connection: the loading screen shows "check your connection" + TRY AGAIN
    }

    const plan = planUpdate(manifest, installed);
    if (!plan.todo.length) {
      if (installed?.status !== 'ready') await applyUpdate(manifest, installed, plan, () => undefined); // only the final bookkeeping is left
      return { kind: 'play' };
    }

    let cellular = false;
    try {
      cellular = (await Network.getStatus()).connectionType === 'cellular';
    } catch {
      /* unknown connection: no warning */
    }
    pending = { m: manifest, inst: installed, plan };
    return {
      kind: 'update',
      what: plan.first ? 'First-time download' : installed?.status === 'updating' ? 'Finish update' : 'Update available',
      size: formatBytes(plan.bytes),
      files: plan.todo.length,
      version: manifest.version,
      notes: manifest.notes,
      cellular,
      first: plan.first,
      canSkip: !plan.mustUpdate,
    };
  },

  async download(onProgress) {
    if (!pending) throw new Error('Nothing to download');
    const { m, inst, plan } = pending;
    let last = 0;
    await applyUpdate(m, inst, plan, (p) => {
      const now = performance.now();
      if (now - last < 100 && p.doneBytes < p.totalBytes) return;
      last = now;
      onProgress(p);
    });
    pending = null;
  },

  async launch() {
    try {
      localStorage.setItem(SKIP_INTRO_KEY, '1');
    } catch {
      /* storage unavailable: the game just plays the intro again */
    }
    try {
      await launchGame();
    } catch (e) {
      try {
        localStorage.removeItem(SKIP_INTRO_KEY);
      } catch {
        /* ignore */
      }
      throw e;
    }
  },

  fmt: formatBytes,
};

if (!isNative()) {
  location.href = `${UPDATE_URL}/index.html`; // opened in a normal browser: just play the web version
} else {
  try {
    localStorage.removeItem(SKIP_INTRO_KEY); // a flag left over from an earlier run must not skip this run's intro
  } catch {
    /* ignore */
  }
  window.__LAUNCHER = api;
  App.addListener('backButton', () => void App.exitApp());
}
