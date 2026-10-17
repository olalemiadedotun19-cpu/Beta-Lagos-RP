import { bakeStats, bakedData, flushBaked, loadBaked, requestPersistentStorage } from './BakeCache';
import { preloadBarracks } from '../world/barracks/BarracksPreload';
import { preloadCharacter } from '../player/figure/CharacterPreload';
import { getDecalAtlas, getGravelTexture, getPaintBumpTexture, getPaintTexture } from '../procedural/RoadTextures';
import { getGlbRoadTextures, glbRoadTexturesReady } from '../procedural/GlbRoadTextures';
import { getConcreteTextures } from '../procedural/ConcreteTextures';
import { buildDirtDetail, buildGrassDetail, buildRockDetail } from '../procedural/GroundDetail';

/**
 * Loading-screen step "prepare textures".
 *
 * Builds (first launch) or restores from the device (every later launch) the big road / pavement / ground / bridge
 * textures BEFORE the game starts, one at a time, so the loading bar shows real work and the game never stalls on them
 * mid-play. Anything built for the first time is written to the device (see BakeCache.ts).
 *
 * The rest of the bar is the other work that used to happen after the game opened, now running in the background together:
 *  - the barracks island (BarracksPreload.ts): all of its textures are painted and saved on the first launch, restored from the
 *    device on later ones, so nothing is generated when the player drives up to the barracks
 *  - the player's character (CharacterPreload.ts): loaded and built here, then handed to the creation preview / the game engine
 * The bar is the weighted progress of ALL of them, and only reaches 100 % when every one is finished.
 *
 * The ground detail sizes below must match GRASS_TEX / ROCK_TEX / DIRT_TEX in TerrainTextures.ts (they are cached by size + seed).
 */

interface Task {
  name: string;
  run: () => void;
}

const TASKS: Task[] = [
  // asphalt + sidewalk now come from image files (GlbRoadTextures.ts): this only starts the download, the wait is below
  { name: 'road surface', run: () => void getGlbRoadTextures() },
  { name: 'gravel', run: () => void getGravelTexture() },
  { name: 'road paint', run: () => (void getPaintTexture(), void getPaintBumpTexture()) },
  { name: 'road decals', run: () => void getDecalAtlas() },
  { name: 'grass', run: () => void buildGrassDetail(512) },
  { name: 'rock', run: () => void buildRockDetail(256) },
  { name: 'dirt', run: () => void buildDirtDetail(256) },
  { name: 'bridge concrete', run: () => (void getConcreteTextures('wall'), void getConcreteTextures('top')) },
];

/** lets the browser paint the progress bar between two heavy tasks */
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** how the bar is shared: road / ground textures, then the barracks and the character loading side by side */
const ROAD_SHARE = 0.2;
const BARRACKS_SHARE = 0.4;
const CHARACTER_SHARE = 0.4;
const WORK_END = 0.95; // 95-100 %: writing new textures to the device

export async function warmTextures(onProgress: (fraction: number, label: string) => void): Promise<void> {
  requestPersistentStorage();
  onProgress(0, 'Loading assets');
  await loadBaked();
  const n = TASKS.length;
  const span = WORK_END;
  for (let i = 0; i < n; i++) {
    onProgress((span * ROAD_SHARE * i) / n, 'Loading assets');
    await nextFrame();
    TASKS[i].run();
  }
  await glbRoadTexturesReady(); // the asphalt / sidewalk images are decoded before the game opens

  // barracks + character, together in the background; the bar follows both
  let barracks = 0;
  let character = 0;
  const report = (): void => {
    const f = ROAD_SHARE + BARRACKS_SHARE * barracks + CHARACTER_SHARE * character;
    onProgress(span * f, 'Loading assets');
  };
  report();
  let barracksOk = true;
  await Promise.all([
    preloadBarracks((f) => {
      barracks = f;
      report();
    }, nextFrame).catch((e) => {
      barracksOk = false;
      console.error('Barracks preload failed (it will be built when you get there)', e);
    }),
    preloadCharacter((f) => {
      character = f;
      report();
    }).catch((e) => console.error('Character preload failed (the game will build it)', e)),
  ]);
  barracks = character = 1;
  report();
  if (barracksOk) bakedData('bar|ready', () => new Uint8Array(1)); // marks "the barracks textures are on this device"

  const before = bakeStats();
  if (before.built > 0) {
    onProgress(0.97, 'Packaging');
    await flushBaked();
  }
  onProgress(1, 'Packaging');
}
