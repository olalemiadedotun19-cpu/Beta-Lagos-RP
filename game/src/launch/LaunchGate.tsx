import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { showBuildBanner } from '../utils/buildBanner';
import { precacheGameFiles, registerServiceWorker } from '../cache/AppCache';
import { registerLoadingScreen } from './loadingScreen';

/**
 * Launch sequence gate.
 *
 * Boot order:  DOTCON intro -> game logo -> "Welcome to Lagos" (tap) -> REAL loading bar -> the game opens.
 *
 * The launch sequence is the Beta Lagos RP launch page (public/launch/launch.html), shown full-screen in an iframe so
 * its styles / audio / animation never touch the game's own CSS. It talks to this component through `window.__BL_HOST`:
 *   - load(report, label)  the loading bar. Everything it reports is real work:
 *        0 - 50 %   download the game files that are not on the device yet (streamed bytes; nothing when already saved)
 *       50 - 60 %   start the game engine code
 *       60 - 100 %  build / restore the big textures from the device (cache/warmup.ts), saving new ones for next time
 *   - ready()              the bar hit 100%: mount the game underneath. The loading screen stays on top until the game itself
 *                          hides it (App calls loadingScreen.hide() once the character creation is showing, or - for a returning
 *                          player - once the world around the player is built).
 *
 * The loading page is NOT thrown away after the first load: it is hidden and kept alive, and the game brings the very same screen back
 * after character creation (see loadingScreen.ts) while the character and the map load in the background.
 *
 * The words on the bar are deliberately plain: Preparing game / Preparing files / Loading assets / Packaging.
 *
 * Add `?nolaunch` to the URL to skip the sequence while developing.
 */

type AppModule = typeof import('../App');
type HostApi = {
  load: (report: (f: number) => void, label: (text: string) => void) => Promise<void>;
  ready: () => void;
};
type LoadingPageApi = {
  show: (label: string) => void;
  set: (fraction: number, label?: string) => void;
  label: (label: string) => void;
};
declare global {
  interface Window {
    __BL_HOST?: HostApi;
  }
}

const SKIP = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('nolaunch');
const FADE_MS = 800;
const SAFETY_HIDE_MS = 45000; // if the game never hides the loading screen (something went wrong), do not trap the player behind it

let appPromise: Promise<AppModule> | null = null;
function getApp(): Promise<AppModule> {
  if (!appPromise) {
    appPromise = import('../App');
    appPromise.catch(() => {
      appPromise = null; // allow "TRY AGAIN" on the loading screen to re-download
    });
  }
  return appPromise;
}

async function warm(report: (f: number, text: string) => void): Promise<void> {
  const { warmTextures } = await import('../cache/warmup');
  await warmTextures(report);
}

/** resolves after the browser has painted what was just changed */
const paint = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export default function LaunchGate() {
  const [AppComp, setAppComp] = useState<ComponentType | null>(null);
  const [visible, setVisible] = useState(!SKIP); // the loading page is on screen
  const [fading, setFading] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const timers = useRef<number[]>([]);

  const page = useCallback((): LoadingPageApi | undefined => {
    const w = frameRef.current?.contentWindow as (Window & { BL_LOADING?: LoadingPageApi }) | null | undefined;
    return w?.BL_LOADING;
  }, []);

  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);

  const hide = useCallback(async (): Promise<void> => {
    clearTimers();
    setFading(true);
    await wait(FADE_MS + 100);
    setVisible(false); // hidden, not removed: the same screen comes back after character creation
  }, [clearTimers]);

  const show = useCallback(
    async (text: string): Promise<void> => {
      clearTimers();
      setFading(false);
      setVisible(true);
      await paint(); // the page is on screen again
      page()?.show(text);
      await paint(); // the fresh bar is painted, heavy work can start behind it
    },
    [clearTimers, page],
  );

  // the game (App) controls the screen through this
  useEffect(() => {
    if (SKIP) return;
    registerLoadingScreen({
      show,
      set: (fraction, text) => page()?.set(fraction, text),
      hide,
    });
    return () => registerLoadingScreen(null);
  }, [show, hide, page]);

  useEffect(() => {
    registerServiceWorker();

    if (SKIP) {
      void Promise.all([getApp(), warm(() => undefined)]).then(([m]) => setAppComp(() => m.default));
      return;
    }

    window.__BL_HOST = {
      load: async (report, label) => {
        label('Preparing game');
        report(0.01);
        await precacheGameFiles((done, total, downloading) => {
          report(0.01 + 0.49 * (total ? done / total : 1));
          label(downloading ? 'Preparing files' : 'Preparing game');
        });
        label('Loading assets');
        report(0.52);
        await getApp();
        report(0.6);
        await warm((f, text) => {
          report(0.6 + 0.4 * f);
          label(text);
        });
        report(1);
      },
      ready: () => {
        void getApp().then((m) => {
          setAppComp(() => m.default);
          showBuildBanner('New graphics build loaded (terrain oaks, grass, water, roads)');
          // the game hides the loading screen itself when it is ready; this is only the safety net
          timers.current.push(window.setTimeout(() => void hide(), SAFETY_HIDE_MS));
        });
      },
    };

    return () => {
      delete window.__BL_HOST;
      clearTimers();
    };
  }, [hide, clearTimers]);

  return (
    <>
      {AppComp && <AppComp />}
      {!SKIP && (
        <iframe
          ref={frameRef}
          title="Beta Lagos RP launch sequence"
          src={`${import.meta.env.BASE_URL}launch/launch.html`}
          allow="autoplay; fullscreen"
          style={{
            position: 'fixed',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 0,
            background: '#000',
            zIndex: 100000,
            display: visible ? 'block' : 'none',
            opacity: fading ? 0 : 1,
            transition: fading ? `opacity ${FADE_MS}ms ease` : 'none', // fades out slowly, appears instantly
            pointerEvents: fading ? 'none' : 'auto',
          }}
        />
      )}
    </>
  );
}
