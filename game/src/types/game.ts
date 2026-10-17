/**
 * Core type definitions for International Life
 */
import type { Outfit } from '../wardrobe/Wardrobe';
import type { SpawnPointId } from '../spawn/SpawnPoints';

export interface GameDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
}

export type SexType = 'male' | 'female' | 'non-binary';

export type HairStyleType =
  | 'short'
  | 'afro'
  | 'fade'
  | 'braids'
  | 'buzz'
  | 'long'
  | 'dreads'
  | 'bald';

export type FacialHairType =
  | 'none'
  | 'stubble'
  | 'beard'
  | 'mustache'
  | 'goatee';

export type GlassesType = 'none' | 'reading' | 'sunglasses';

export type BodyBuildType = 'slim' | 'average' | 'athletic';

export type OrientationMode = 'auto' | 'portrait' | 'landscape';

export interface CharacterAppearance {
  gender: 'male' | 'female' | 'non-binary';
  skinTone: string; // Hex color
  hairStyle: HairStyleType;
  hairColor: string; // Hex color
  facialHair: FacialHairType;
  facialHairColor: string;
  glasses: GlassesType;
  shirtColor: string; // Hex color
  pantsColor: string; // Hex color
  shoesColor: string; // Hex color
  heightScale: number; // 0.9 to 1.1
  bodyBuild: BodyBuildType;
}

export interface PlayerStats {
  health: number; // 0-100
  energy: number; // 0-100
  hunger: number; // 0-100 (100 is full, 0 is starving)
  happiness: number; // 0-100
  hygiene: number; // 0-100
  stress: number; // 0-100 (0 is relaxed, 100 is maximum stress)
}

export interface PlayerFinances {
  cash: number;
  bankBalance: number;
  currencyCode: string; // 'NGN', 'USD', etc.
  currencySymbol: string; // '₦', '$', etc.
  /** the owner's one-time grant (auth/owner.ts): set once it has been paid */
  ownerGrant?: number;
}

export interface PlayerCareer {
  jobTitle: string;
  employer: string;
  hourlyWage: number;
  experienceYears: number;
  isEmployed: boolean;
}

export interface PlayerEducation {
  level: 'None' | 'Secondary School' | 'Undergraduate' | 'Postgraduate';
  schoolName: string;
  fieldOfStudy?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  category: 'food' | 'beverage' | 'medicine' | 'gadget' | 'misc';
  quantity: number;
  effects?: {
    hunger?: number;
    energy?: number;
    health?: number;
    happiness?: number;
    stress?: number;
  };
}

export interface WorldCoordinate {
  x: number;
  y: number;
  z: number;
}

export interface PlayerIdentity {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  dateOfBirth: GameDate;
  sex: SexType;
  nationality: string;
}

export interface PlayerLocation {
  continentId: string;
  countryId: string;
  stateId: string;
  cityId: string;
  districtId: string;
  position: WorldCoordinate;
  rotationY: number;
}

export interface OwnedVehicle {
  name: string;
  kind: 'car' | 'suv';
  color: string; // hex colour, e.g. '#4b5563'
}

export interface PlayerData {
  identity: PlayerIdentity;
  appearance: CharacterAppearance;
  /** clothes picked in the showroom (ids from wardrobe/Wardrobe.ts); missing in older saves = the default outfit */
  outfit?: Outfit;
  /** where the player chose to start (spawn/SpawnPoints.ts). Saved for later: the game does not place the player by it yet */
  spawnPoint?: SpawnPointId;
  /** true once the citizen has been in the world (so `location` is a real last position, not just the default start) */
  hasPlayed?: boolean;
  stats: PlayerStats;
  finances: PlayerFinances;
  career: PlayerCareer;
  education: PlayerEducation;
  location: PlayerLocation;
  inventory: InventoryItem[];
  /** Optional personal vehicle used by the "Private Vehicle" transport option */
  ownedVehicle?: OwnedVehicle;
  createdAt: number;
  lastSavedAt: number;
}

// World Hierarchy Types
export interface LocationAction {
  id: string;
  label: string;
  description: string;
  durationMinutes: number;
  cost?: number;
  earnings?: number;
  requirements?: {
    minEnergy?: number;
    minCash?: number;
  };
  effects: {
    energy?: number;
    hunger?: number;
    health?: number;
    happiness?: number;
    hygiene?: number;
    stress?: number;
    cash?: number;
  };
  rewardItem?: InventoryItem;
}

export interface POILocation {
  id: string;
  name: string;
  type: 'residential' | 'commercial' | 'hospital' | 'restaurant' | 'office' | 'park' | 'market';
  description: string;
  position: WorldCoordinate;
  bounds: {
    width: number;
    depth: number;
    height: number;
  };
  interactionRadius: number;
  actions: LocationAction[];
  interiorAvailable?: boolean;
}

export interface RoadSegment {
  id: string;
  start: { x: number; z: number };
  end: { x: number; z: number };
  width: number;
  lanes: number;
  hasSidewalk: boolean;
  name?: string;
}

export interface BuildingData {
  id: string;
  name: string;
  category: 'residential' | 'commercial' | 'hospital' | 'restaurant' | 'office' | 'civic';
  position: { x: number; z: number };
  size: { width: number; height: number; depth: number };
  colorScheme: {
    wall: string;
    roof: string;
    trim: string;
  };
  stories: number;
  poiId?: string;
  signText?: string;
}

export interface PropData {
  id: string;
  type: 'tree_palm' | 'tree_shade' | 'streetlight' | 'bench' | 'keke_tricycle' | 'danfo_bus' | 'car' | 'trash_bin';
  position: { x: number; z: number };
  rotationY: number;
  scale?: number;
}

export interface DistrictData {
  id: string;
  name: string;
  description: string;
  countryId: string;
  cityId: string;
  currencyCode: string;
  currencySymbol: string;
  worldBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  roads: RoadSegment[];
  buildings: BuildingData[];
  props: PropData[];
  pois: POILocation[];
  spawnPoint: WorldCoordinate;
}

export interface CityData {
  id: string;
  name: string;
  stateId: string;
  countryId: string;
  districts: DistrictData[];
}

export interface StateData {
  id: string;
  name: string;
  countryId: string;
  cities: CityData[];
}

export interface CountryData {
  id: string;
  name: string;
  continentId: string;
  code: string;
  currencyCode: string;
  currencySymbol: string;
  states: StateData[];
}

export interface ContinentData {
  id: string;
  name: string;
  countries: CountryData[];
}

export interface SaveMetadata {
  id: string;
  playerName: string;
  username: string;
  age: number;
  locationName: string;
  currentDate: GameDate;
  lastSavedAt: number;
}
