/**
 * TimeService - Authoritative World Clock & Timezone Architecture
 * Implements:
 * - Server UTC reference timestamp
 * - Location-based IANA Timezones (e.g. Africa/Lagos UTC+1, Europe/London UTC+0)
 * - Persistent online progression: calculates elapsed time between sessions
 * - Sunrise, sunset, and daylight illumination factors
 */

import { GameDate } from '../types/game';

export interface WorldClockState {
  utcTimestamp: number;
  localDate: GameDate;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  weekdayName: string;
  formattedTime: string;
  formattedDate: string;
  isNight: boolean;
  daylightFactor: number; // 0.0 (deep night) to 1.0 (noon sun)
  timezone: string;
  timezoneOffsetMinutes: number;
}

export class TimeService {
  private static instance: TimeService;

  // Base simulation reference (Simulation begins in Jan 2027 in Ikeja, Lagos)
  private serverUtcTimestamp: number;
  private timezone: string = 'Africa/Lagos';
  private timezoneOffsetMinutes: number = 60; // UTC+1 for West Africa Time (WAT)

  // Simulation speed multiplier (1x normal, can be adjusted for gameplay)
  private simulationSpeedMultiplier: number = 1.0;

  // Weekdays lookup
  private readonly weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  private readonly months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  constructor() {
    // Default starting point: January 15, 2027 08:00:00 UTC (09:00:00 Lagos Time)
    this.serverUtcTimestamp = Date.UTC(2027, 0, 15, 8, 0, 0);
  }

  public static getInstance(): TimeService {
    if (!TimeService.instance) {
      TimeService.instance = new TimeService();
    }
    return TimeService.instance;
  }

  /**
   * Initializes the clock from persistent player metadata and applies offline catch-up
   */
  public initializeFromPersistence(lastSavedTimestamp?: number, lastGameDate?: GameDate): { elapsedMinutes: number } {
    if (lastGameDate) {
      // Reconstitute UTC from saved local game date
      this.serverUtcTimestamp = Date.UTC(
        lastGameDate.year,
        lastGameDate.month - 1,
        lastGameDate.day,
        lastGameDate.hour - Math.floor(this.timezoneOffsetMinutes / 60),
        lastGameDate.minute
      );
    }

    if (lastSavedTimestamp && lastSavedTimestamp > 0) {
      const nowReal = Date.now();
      const elapsedRealMs = Math.max(0, nowReal - lastSavedTimestamp);
      // Real-time minutes elapsed while player was away
      const elapsedRealMinutes = Math.min(1440 * 7, Math.floor(elapsedRealMs / 60000)); // Cap at 7 days

      if (elapsedRealMinutes > 0) {
        // Advance world clock by elapsed time
        this.advanceMinutes(elapsedRealMinutes);
        return { elapsedMinutes: elapsedRealMinutes };
      }
    }

    return { elapsedMinutes: 0 };
  }

  public advanceMinutes(minutes: number): void {
    this.serverUtcTimestamp += minutes * 60 * 1000;
  }

  public update(deltaSeconds: number): void {
    // In real-time simulation: 1 real second = 1 game second * multiplier
    this.serverUtcTimestamp += deltaSeconds * 1000 * this.simulationSpeedMultiplier;
  }

  public setTimezone(timezone: string, offsetMinutes: number): void {
    this.timezone = timezone;
    this.timezoneOffsetMinutes = offsetMinutes;
  }

  public getState(): WorldClockState {
    // Compute local date based on UTC + timezone offset
    const localTimestamp = this.serverUtcTimestamp + this.timezoneOffsetMinutes * 60 * 1000;
    const d = new Date(localTimestamp);

    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const hour = d.getUTCHours();
    const minute = d.getUTCMinutes();
    const dayOfWeek = d.getUTCDay();

    const localDate: GameDate = { year, month, day, hour, minute };

    // Format local time
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    const padMin = minute.toString().padStart(2, '0');
    const formattedTime = `${displayHour}:${padMin} ${ampm}`;

    // Format local date
    const weekdayName = this.weekdays[dayOfWeek];
    const monthName = this.months[month - 1];
    const formattedDate = `${weekdayName}, ${monthName} ${day}, ${year}`;

    // Solar calculation (Lagos tropical sunrise: ~06:30, sunset: ~18:45)
    const isNight = hour < 6 || hour >= 19;
    let daylightFactor = 0.0;

    if (hour >= 6 && hour < 19) {
      // Day curve peaking around 12:30 (noon)
      const dayProgress = (hour - 6 + minute / 60) / 13; // 0 to 1
      daylightFactor = Math.sin(dayProgress * Math.PI);
    }

    return {
      utcTimestamp: this.serverUtcTimestamp,
      localDate,
      dayOfWeek,
      weekdayName,
      formattedTime,
      formattedDate,
      isNight,
      daylightFactor: Math.max(0, Math.min(1, daylightFactor)),
      timezone: this.timezone,
      timezoneOffsetMinutes: this.timezoneOffsetMinutes,
    };
  }
}

export const timeService = TimeService.getInstance();
