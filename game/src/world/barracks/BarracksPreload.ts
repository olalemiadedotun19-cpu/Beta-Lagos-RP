import { createBarracks } from './BarracksScene';

/**
 * Loading-screen step "prepare the barracks".
 *
 * The barracks island used to be built (and all of its textures painted) the moment the player came within 900 m of it, which
 * froze phones for a few seconds. Now the whole cantonment is built here, during the loading screen, one slice per frame:
 *  - first launch: every texture is painted once and saved on the device (cache/BakeCache.ts)
 *  - later launches: the textures are read back from the device, so this step is fast
 * BarracksIsland then just takes the finished scene and shows it - nothing is generated when the player gets there.
 */

type Barracks = ReturnType<typeof createBarracks>;

let ready: Barracks | null = null;

/** The scene prepared by the loading screen, or null if the game was started without it (dev `?nolaunch` skips nothing, but be safe). */
export function getPreloadedBarracks(): Barracks | null {
  return ready;
}

export async function preloadBarracks(onProgress: (fraction: number) => void, nextFrame: () => Promise<void>): Promise<void> {
  if (ready) {
    onProgress(1);
    return;
  }
  await nextFrame();
  const b = createBarracks(); // shared materials + the big base textures
  const steps = b.steps;
  onProgress(1 / (steps + 1));
  const job = b.buildSteps();
  for (let i = 1; ; i++) {
    await nextFrame();
    if (job.next().done) break;
    onProgress(Math.min(i + 1, steps) / (steps + 1));
  }
  ready = b;
  onProgress(1);
}
