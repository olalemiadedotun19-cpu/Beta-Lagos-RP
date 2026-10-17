/**
 * Where a citizen can start. DESIGN ONLY for now: the picker (ui/entry/SpawnPicker.tsx) shows these and the choice is saved in
 * PlayerData.spawnPoint, but nothing in the game moves the character to it yet. When the spawn points are built, read
 * `data.spawnPoint` where the engine places the player and turn `available` on for the new ones.
 */
export type SpawnPointId = 'home' | 'random' | 'bus_station' | 'last';

export interface SpawnPointDef {
  id: SpawnPointId;
  label: string;
  description: string;
  /** false = shown in the picker but locked ("Coming soon") */
  available: boolean;
}

export const SPAWN_POINTS: SpawnPointDef[] = [
  { id: 'home', label: 'Home', description: 'Start where you live', available: false },
  { id: 'random', label: 'Random location', description: 'Start somewhere in the city', available: false },
  { id: 'bus_station', label: 'Bus station', description: 'Start at the city bus station', available: true },
  /** only offered to citizens who have played before (SpawnPicker hides it otherwise); the engine puts them where they logged out */
  { id: 'last', label: 'Where you left off', description: 'Continue from your last location', available: true },
];

export const DEFAULT_SPAWN_POINT: SpawnPointId = 'bus_station';

export const isSpawnAvailable = (id: SpawnPointId | undefined): id is SpawnPointId =>
  !!id && SPAWN_POINTS.some((s) => s.id === id && s.available);
