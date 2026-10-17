/**
 * LocationService - Authoritative Location Architecture
 * Manages the global hierarchy: EARTH -> CONTINENT -> COUNTRY -> STATE -> CITY -> DISTRICT -> LOCATION
 * Provides timezone, coordinate mapping, distance calculations, and opening hours evaluation.
 */

import { IKEJA_DISTRICT_DATA } from '../data/worldData';
import { DistrictData, POILocation, WorldCoordinate } from '../types/game';


export interface LocationOpeningHours {
  openHour: number; // 0-23
  closeHour: number; // 0-23
  openDays: number[]; // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  is24Hours?: boolean;
}

export class LocationService {
  private static instance: LocationService;

  // Current authoritative location hierarchy
  private currentContinentId: string = 'continent_africa';
  private currentCountryId: string = 'country_nigeria';
  private currentStateId: string = 'state_lagos';
  private currentCityId: string = 'city_lagos';
  private currentDistrictId: string = 'district_ikeja';

  // District data cache
  private districtData: DistrictData = IKEJA_DISTRICT_DATA;

  // Default opening hours by category
  private openingHoursCatalog: Record<string, LocationOpeningHours> = {
    residential: { openHour: 0, closeHour: 24, openDays: [0, 1, 2, 3, 4, 5, 6], is24Hours: true },
    hospital: { openHour: 0, closeHour: 24, openDays: [0, 1, 2, 3, 4, 5, 6], is24Hours: true },
    restaurant: { openHour: 8, closeHour: 22, openDays: [1, 2, 3, 4, 5, 6, 0] },
    office: { openHour: 8, closeHour: 18, openDays: [1, 2, 3, 4, 5] },
    commercial: { openHour: 9, closeHour: 21, openDays: [1, 2, 3, 4, 5, 6, 0] },
    market: { openHour: 7, closeHour: 19, openDays: [1, 2, 3, 4, 5, 6] },
  };

  public static getInstance(): LocationService {
    if (!LocationService.instance) {
      LocationService.instance = new LocationService();
    }
    return LocationService.instance;
  }

  public getDistrict(): DistrictData {
    return this.districtData;
  }

  public getLocations(): POILocation[] {
    return this.districtData.pois;
  }

  public getLocationById(id: string): POILocation | undefined {
    return this.districtData.pois.find((p) => p.id === id);
  }

  public getNearestLocation(x: number, z: number): { poi: POILocation; distance: number } | null {
    let nearest: POILocation | null = null;
    let minDistance = Infinity;

    for (const poi of this.districtData.pois) {
      const dist = this.calculateDistanceMeters({ x, y: 0, z }, poi.position);
      if (dist < minDistance) {
        minDistance = dist;
        nearest = poi;
      }
    }

    return nearest ? { poi: nearest, distance: Math.round(minDistance) } : null;
  }

  public calculateDistanceMeters(p1: WorldCoordinate, p2: WorldCoordinate): number {
    const dx = p1.x - p2.x;
    const dz = p1.z - p2.z;
    // 1 unit in our world = 1 meter
    return Math.round(Math.sqrt(dx * dx + dz * dz));
  }

  /**
   * Checks whether a location is currently open based on current local hour and day
   */
  public isLocationOpen(
    poi: POILocation,
    currentHour: number,
    dayOfWeek: number = 1 // 0-6
  ): { isOpen: boolean; openingHoursText: string } {
    const schedule = this.openingHoursCatalog[poi.type] || {
      openHour: 8,
      closeHour: 20,
      openDays: [1, 2, 3, 4, 5, 6],
    };

    if (schedule.is24Hours) {
      return { isOpen: true, openingHoursText: 'Open 24/7' };
    }

    const isOpenToday = schedule.openDays.includes(dayOfWeek);
    const isWithinHours = currentHour >= schedule.openHour && currentHour < schedule.closeHour;
    const isOpen = isOpenToday && isWithinHours;

    const formatHour = (h: number) => {
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${h12}:00 ${ampm}`;
    };

    const openingHoursText = `${formatHour(schedule.openHour)} - ${formatHour(schedule.closeHour)}`;
    return { isOpen, openingHoursText };
  }

  public getTimezone(): string {
    return 'Africa/Lagos'; // UTC+1
  }

  public getCurrency(): { code: string; symbol: string; name: string } {
    return { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' };
  }
}

export const locationService = LocationService.getInstance();
