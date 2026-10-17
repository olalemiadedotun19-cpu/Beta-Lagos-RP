import { WorldCoordinate, LocationAction, InventoryItem } from '../types/game';
import { TransportMode } from '../travel/TransportModes';

export type LocationCategory =
  | 'residential'
  | 'restaurant'
  | 'hospital'
  | 'bank'
  | 'office'
  | 'commercial'
  | 'university'
  | 'nightclub'
  | 'police_station'
  | 'hotel'
  | 'airport'
  | 'civic'
  | 'market';

export interface LocationOpeningHours {
  openHour: number; // 0-23
  closeHour: number; // 0-23
  openDays: number[]; // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  is24Hours?: boolean;
}

export interface ArrivalPoints {
  mainEntrance: WorldCoordinate;
  pedestrianEntrance?: WorldCoordinate;
  rideDropoff: WorldCoordinate;
  parkingEntrance?: WorldCoordinate;
  ambulanceEntrance?: WorldCoordinate;
  /** Where the player stands when they leave the interior (outside the entrance) */
  exitPoint?: WorldCoordinate;
  interiorSpawn: WorldCoordinate;
}

export interface LocationLightingConfig {
  ambientColor: string;
  ambientIntensity: number;
  mainLightColor: string;
  mainLightIntensity: number;
  accentLights?: {
    color: string;
    intensity: number;
    position: WorldCoordinate;
    distance?: number;
  }[];
}

export interface LocationInteractionPoint {
  id: string;
  name: string;
  label: string;
  category: 'counter' | 'seat' | 'desk' | 'atm' | 'bed' | 'equipment' | 'door' | 'kiosk';
  position: WorldCoordinate;
  interactionRadius: number;
  prompt: string;
  actionId?: string;
  teleportTo?: 'interior' | 'exterior';
}

export interface LocationDefinition {
  locationId: string;
  name: string;
  shortName: string;
  tagline: string;
  continentId: string;
  countryId: string;
  stateId: string;
  cityId: string;
  districtId: string;
  category: LocationCategory;
  coordinates: WorldCoordinate;
  openingHours: LocationOpeningHours;
  arrivalPoints: ArrivalPoints;
  exteriorSceneId: string;
  interiorSceneId: string;
  interiorAvailable: boolean;
  activities: string[];
  services: string[];
  availableJobs: string[];
  transportOptions: TransportMode[];
  priceRange: 'budget' | 'moderate' | 'upscale' | 'luxury';
  ownership: {
    type: 'public' | 'private' | 'player_owned' | 'corporate';
    ownerName?: string;
  };
  lighting: {
    exterior: LocationLightingConfig;
    interior: LocationLightingConfig;
  };
  actions: LocationAction[];
  interiorInteractions?: LocationInteractionPoint[];
}
