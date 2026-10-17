/**
 * Auto-fullscreen.
 *
 * Browsers only allow fullscreen from a real user gesture, so a page can never go fullscreen the instant it loads.
 * What this does instead: the very first tap / click / key press anywhere in the game switches the page to fullscreen
 * (which hides the address bar and browser UI). If the player leaves fullscreen (swipe down, Esc), the next tap goes
 * back in. Nothing happens when the game is already running as an installed app (manifest display: fullscreen).
 *
 * Landscape: once fullscreen is on, the screen is also locked to landscape (Android Chrome / Edge only allow the lock
 * while fullscreen or when installed). The lock is released automatically when fullscreen ends.
 *
 * iPhone Safari has no Fullscreen API and no orientation lock at all - there the only way is "Share > Add to Home Screen" (see index.html /
 * manifest.webmanifest), which then launches without the address bar (landscape follows the manifest on Android only).
 */

/** set to false if you only want ONE automatic switch per launch (no re-entering after the player exits) */
const REENTER_AFTER_EXIT = true;

type FsDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsEl = HTMLElement & {
  webkitRequestFullscreen?: (opts?: FullscreenOptions) => Promise<void> | void;
};

const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'] as const;

export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

function isInstalledApp(): boolean {
  return (
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function fullscreenSupported(): boolean {
  const el = document.documentElement as FsEl;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

export async function enterFullscreen(): Promise<boolean> {
  if (isFullscreen()) return true;
  const el = document.documentElement as FsEl;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return false;
    return true;
  } catch {
    return false; // not allowed right now (no gesture, blocked by iframe policy, ...): try again on the next tap
  }
}

type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };

/** Locks the screen to landscape. Resolves false when the browser refuses (iOS, desktop, not fullscreen yet). */
export async function lockLandscape(): Promise<boolean> {
  const o = (typeof screen !== 'undefined' ? screen.orientation : undefined) as LockableOrientation | undefined;
  if (!o || !o.lock) return false;
  try {
    await o.lock('landscape');
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  const d = document as FsDoc;
  try {
    if (d.exitFullscreen) await d.exitFullscreen();
    else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
  } catch {
    /* ignore */
  }
}

export function installAutoFullscreen(): void {
  if (typeof window === 'undefined') return;
  if (isInstalledApp()) {
    // already without browser UI: only the landscape lock is left to do (the manifest asks for it too)
    void lockLandscape();
    return;
  }
  if (!fullscreenSupported()) return;

  let armed = false;

  const onGesture = (e: Event): void => {
    if (e instanceof KeyboardEvent && e.key === 'Escape') return; // Esc is how people leave fullscreen
    void enterFullscreen().then((ok) => {
      if (!ok) return;
      disarm();
      void lockLandscape();
    });
  };

  const arm = (): void => {
    if (armed) return;
    armed = true;
    for (const g of GESTURES) window.addEventListener(g, onGesture, { capture: true, passive: true });
  };

  const disarm = (): void => {
    if (!armed) return;
    armed = false;
    for (const g of GESTURES) window.removeEventListener(g, onGesture, { capture: true });
  };

  const onChange = (): void => {
    if (isFullscreen()) disarm();
    else if (REENTER_AFTER_EXIT) arm();
  };
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);

  arm();
}
