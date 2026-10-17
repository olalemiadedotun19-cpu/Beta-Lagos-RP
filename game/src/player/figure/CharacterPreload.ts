import type { Object3D } from 'three';
import { FigureCharacter } from './FigureCharacter';

/**
 * Loading-screen step "prepare the character".
 *
 * Downloading / decoding the figure (body, jacket, baked animations) and building its skin materials takes a moment, and it used
 * to start only after the game opened. Now it runs on the loading screen, in the background next to the barracks and the
 * textures, and the loading bar follows it. The finished character is handed over to whoever needs one first: the character
 * creation preview, or the game engine. The preview hands it back when it closes, so the engine does not have to build a second one.
 */

let spare: FigureCharacter | null = null;

/** What the character loader reports, as a rough position on the bar (download -> build meshes and materials -> animations -> done). */
function stageFraction(msg: string, current: number): number {
  if (msg.startsWith('Loading character')) return 0.1;
  if (msg.startsWith('Building character')) return 0.5;
  if (msg.startsWith('Tailoring')) return Math.max(current, 0.8);
  if (msg.startsWith('Styling')) return Math.max(current, 0.95);
  return current;
}

/** Takes the prepared character (null if it is not ready yet / was already taken: the caller then builds its own). */
export function takePreloadedCharacter(): FigureCharacter | null {
  const c = spare;
  spare = null;
  return c;
}

/** Gives a character back (the creation preview closing) so the next user does not have to wait. */
export function releaseCharacter(c: FigureCharacter, scene?: Object3D): void {
  scene?.remove(c.group);
  if (spare || !c.ready) {
    c.dispose();
    return;
  }
  c.resetForReuse();
  spare = c;
}

export async function preloadCharacter(onProgress: (fraction: number, label: string) => void): Promise<void> {
  if (spare) {
    onProgress(1, 'Character ready');
    return;
  }
  let frac = 0;
  let live = true; // after loading, the builder's later messages (clothes / hair changes) must not touch the loading bar
  onProgress(0, 'Preparing character');
  try {
    const c = new FigureCharacter(undefined, (msg) => {
      if (!live) return;
      frac = stageFraction(msg, frac);
      if (msg) onProgress(frac, msg.replace('…', ''));
    });
    await c.whenReady;
    live = false;
    if (c.ready) spare = c;
    else c.dispose(); // it failed to load: the game will try again itself
  } catch (e) {
    live = false;
    console.error('Character preload failed', e);
  }
  onProgress(1, 'Character ready');
}
