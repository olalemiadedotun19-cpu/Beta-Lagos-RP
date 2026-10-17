/**
 * TransportModes - single source of truth for every way the player can travel.
 *
 * Travel is a pure player mechanic: DESTINATION + TRANSPORT METHOD -> cinematic journey.
 * Nothing in here needs another player, an NPC driver, or a network connection.
 */

import { PlayerData } from '../types/game';

export type TransportMode =
  | 'walk'
  | 'danfo'
  | 'brt'
  | 'keke'
  | 'okada'
  | 'taxi'
  | 'ride'
  | 'private';

export const ALL_TRANSPORT_MODES: TransportMode[] = [
  'walk',
  'danfo',
  'brt',
  'keke',
  'okada',
  'taxi',
  'ride',
  'private',
];

export type TravelCameraStyle = 'none' | 'chase' | 'interior';

export interface TransportDefinition {
  mode: TransportMode;
  label: string;
  provider: string;
  tagline: string;
  /** Tailwind-friendly accent colour (hex) used by UI */
  accent: string;
  /** Cruise speed of the visual journey in m/s (only affects how fast the world streams past) */
  cruiseSpeed: number;
  /** Camera used while travelling */
  camera: TravelCameraStyle;
  /** Fare model */
  baseFare: number;
  farePer100m: number;
  /** metres per real in-game minute (used for the ETA) */
  metresPerMinute: number;
  waitMinutes: number;
  /** Stat cost model */
  energyCost: number;
  hungerCost: number;
  /** Local opening hours (24h clock) - undefined means always available */
  runsFromHour?: number;
  runsUntilHour?: number;
  /** Minimum trip distance for the mode to make sense */
  minDistance?: number;
}

export const TRANSPORT_DEFINITIONS: Record<TransportMode, TransportDefinition> = {
  walk: {
    mode: 'walk',
    label: 'Walk',
    provider: 'On foot',
    tagline: 'Free · you set off on your own two feet',
    accent: '#34d399',
    cruiseSpeed: 0,
    camera: 'none',
    baseFare: 0,
    farePer100m: 0,
    metresPerMinute: 80,
    waitMinutes: 0,
    energyCost: 0,
    hungerCost: 0,
  },
  danfo: {
    mode: 'danfo',
    label: 'Danfo',
    provider: 'Danfo Transit Lagos',
    tagline: 'Yellow-and-black bus · cheap, crowded, classic',
    accent: '#facc15',
    cruiseSpeed: 15,
    camera: 'interior',
    baseFare: 200,
    farePer100m: 10,
    metresPerMinute: 250,
    waitMinutes: 4,
    energyCost: 3,
    hungerCost: 3,
    runsFromHour: 5,
    runsUntilHour: 22,
  },
  brt: {
    mode: 'brt',
    label: 'BRT',
    provider: 'Lagos BRT',
    tagline: 'Dedicated lane · smooth, cheap, on a schedule',
    accent: '#38bdf8',
    cruiseSpeed: 19,
    camera: 'interior',
    baseFare: 150,
    farePer100m: 6,
    metresPerMinute: 330,
    waitMinutes: 5,
    energyCost: 2,
    hungerCost: 2,
    runsFromHour: 6,
    runsUntilHour: 21,
    minDistance: 60,
  },
  keke: {
    mode: 'keke',
    label: 'Keke',
    provider: 'Ikeja Keke Union',
    tagline: 'Tricycle · quick neighbourhood hops',
    accent: '#fbbf24',
    cruiseSpeed: 12,
    camera: 'chase',
    baseFare: 150,
    farePer100m: 15,
    metresPerMinute: 220,
    waitMinutes: 2,
    energyCost: 2,
    hungerCost: 2,
    runsFromHour: 5,
    runsUntilHour: 22,
  },
  okada: {
    mode: 'okada',
    label: 'Okada',
    provider: 'Okada Rider',
    tagline: 'Motorbike · fastest through traffic, a bit wild',
    accent: '#fb923c',
    cruiseSpeed: 17,
    camera: 'chase',
    baseFare: 100,
    farePer100m: 12,
    metresPerMinute: 380,
    waitMinutes: 1,
    energyCost: 3,
    hungerCost: 2,
    runsFromHour: 5,
    runsUntilHour: 21,
  },
  taxi: {
    mode: 'taxi',
    label: 'Taxi',
    provider: 'City Cab',
    tagline: 'Street taxi · comfortable, 24 hours',
    accent: '#f59e0b',
    cruiseSpeed: 18,
    camera: 'chase',
    baseFare: 600,
    farePer100m: 35,
    metresPerMinute: 320,
    waitMinutes: 3,
    energyCost: 1,
    hungerCost: 1,
  },
  ride: {
    mode: 'ride',
    label: 'Ride',
    provider: 'App Ride',
    tagline: 'App-booked car · premium, rush-hour pricing',
    accent: '#a78bfa',
    cruiseSpeed: 19,
    camera: 'chase',
    baseFare: 800,
    farePer100m: 45,
    metresPerMinute: 330,
    waitMinutes: 3,
    energyCost: 1,
    hungerCost: 1,
  },
  private: {
    mode: 'private',
    label: 'Private Vehicle',
    provider: 'Your Vehicle',
    tagline: 'Your own car · fuel only',
    accent: '#94a3b8',
    cruiseSpeed: 20,
    camera: 'chase',
    baseFare: 50,
    farePer100m: 6,
    metresPerMinute: 360,
    waitMinutes: 0,
    energyCost: 1,
    hungerCost: 1,
  },
};

export function isTransportMode(value: string): value is TransportMode {
  return (ALL_TRANSPORT_MODES as string[]).includes(value);
}

export interface TravelEstimate {
  mode: TransportMode;
  label: string;
  provider: string;
  tagline: string;
  accent: string;
  distanceMeters: number;
  durationMinutes: number;
  fareCost: number;
  energyCost: number;
  hungerCost: number;
  available: boolean;
  /** Why the option can't be used right now */
  unavailableReason?: string;
  /** Short availability note shown in the UI ("Rush hour fare x1.4") */
  note?: string;
}

function formatHour(h: number): string {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
}

/** Evening and morning rush hours in Lagos */
export function isRushHour(hour: number): boolean {
  return (hour >= 6 && hour < 9) || (hour >= 16 && hour < 20);
}

/**
 * Builds the estimate (time, fare, availability) for ONE transport mode.
 */
export function estimateTransport(
  mode: TransportMode,
  distanceMeters: number,
  hour: number,
  playerData: PlayerData | null
): TravelEstimate {
  const def = TRANSPORT_DEFINITIONS[mode];
  const rush = isRushHour(hour);

  let duration = Math.max(1, Math.round(distanceMeters / def.metresPerMinute) + def.waitMinutes);
  let fare = Math.round(def.baseFare + (distanceMeters / 100) * def.farePer100m);
  let energy = def.energyCost;
  let hunger = def.hungerCost;
  let note: string | undefined;

  // Traffic & pricing realism
  if (mode !== 'walk' && mode !== 'okada' && rush) {
    duration = Math.round(duration * 1.35);
    note = 'Rush hour traffic';
  }
  if (mode === 'ride' && rush) {
    fare = Math.round(fare * 1.4);
    note = 'Rush hour fare x1.4';
  }
  if (mode === 'taxi' && (hour >= 22 || hour < 5)) {
    fare = Math.round(fare * 1.25);
    note = 'Night fare x1.25';
  }

  if (mode === 'walk') {
    energy = Math.min(30, Math.round(duration * 0.8));
    hunger = Math.min(25, Math.round(duration * 0.5));
    note = 'Free · burns energy';
  }

  let available = true;
  let unavailableReason: string | undefined;

  if (def.runsFromHour !== undefined && def.runsUntilHour !== undefined) {
    if (hour < def.runsFromHour || hour >= def.runsUntilHour) {
      available = false;
      unavailableReason = `${def.label} runs ${formatHour(def.runsFromHour)} – ${formatHour(def.runsUntilHour)}`;
    }
  }

  if (available && def.minDistance !== undefined && distanceMeters < def.minDistance) {
    available = false;
    unavailableReason = `Too close for ${def.label} – walk or take a keke`;
  }

  if (available && mode === 'private') {
    if (!playerData || !playerData.ownedVehicle) {
      available = false;
      unavailableReason = "You don't own a vehicle yet";
    }
  }

  if (available && fare > 0 && playerData && playerData.finances.cash < fare) {
    available = false;
    unavailableReason = `Need ₦${fare.toLocaleString()} cash (you have ₦${Math.round(
      playerData.finances.cash
    ).toLocaleString()})`;
  }

  return {
    mode,
    label: def.label,
    provider: def.provider,
    tagline: def.tagline,
    accent: def.accent,
    distanceMeters,
    durationMinutes: duration,
    fareCost: fare,
    energyCost: energy,
    hungerCost: hunger,
    available,
    unavailableReason,
    note,
  };
}

export function estimateAllTransport(
  distanceMeters: number,
  hour: number,
  playerData: PlayerData | null,
  allowed?: TransportMode[]
): TravelEstimate[] {
  const modes = allowed && allowed.length > 0 ? allowed : ALL_TRANSPORT_MODES;
  return ALL_TRANSPORT_MODES.filter((m) => modes.includes(m)).map((m) =>
    estimateTransport(m, distanceMeters, hour, playerData)
  );
}
