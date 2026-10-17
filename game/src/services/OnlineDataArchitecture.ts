/**
 * OnlineDataArchitecture - Foundation for Multiplayer & Firebase Synchronization
 *
 * Separates data into strict architectural layers:
 * 1. GlobalWorldData: Countries, Cities, Districts, Roads, Buildings (Static & Shared, zero per-player duplication)
 * 2. PlayerData: Authenticated citizen document (Identity, Appearance, Stats, Finances, Inventory, Career)
 * 3. SessionData: Real-time ephemeral state (Online status, current scene, live position, socket ID)
 * 4. ServiceRegistry: Central access point for all authoritative subsystem services
 */

import { DistrictData, PlayerData, WorldCoordinate } from '../types/game';
import { locationService } from './LocationService';
import { timeService } from './TimeService';
import { weatherService } from './WeatherService';
import { bankService } from './BankService';
import { jobService } from './JobService';
import { messagingService } from './MessagingService';
import { notificationService } from './NotificationService';

export interface GlobalWorldReference {
  continentId: string;
  countryId: string;
  stateId: string;
  cityId: string;
  districtId: string;
  timezone: string;
}

export interface PlayerSessionState {
  playerId: string;
  isOnline: boolean;
  currentScene: string;
  worldPosition: WorldCoordinate;
  lastHeartbeat: number;
}

export class ServiceRegistry {
  public static readonly location = locationService;
  public static readonly time = timeService;
  public static readonly weather = weatherService;
  public static readonly bank = bankService;
  public static readonly job = jobService;
  public static readonly messaging = messagingService;
  public static readonly notification = notificationService;
}
