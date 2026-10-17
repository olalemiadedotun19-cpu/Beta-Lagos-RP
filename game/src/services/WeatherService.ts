/**
 * WeatherService - Location-Based Meteorological Architecture
 * Provides real-time weather simulation and forecast interfaces for in-game locations.
 */

export type WeatherCondition = 'sunny' | 'partly_cloudy' | 'tropical_rain' | 'harmattan';

export interface WeatherData {
  condition: WeatherCondition;
  temperatureCelsius: number;
  humidityPercent: number;
  windSpeedKmh: number;
  conditionDescription: string;
  locationName: string;
}

export class WeatherService {
  private static instance: WeatherService;

  public static getInstance(): WeatherService {
    if (!WeatherService.instance) {
      WeatherService.instance = new WeatherService();
    }
    return WeatherService.instance;
  }

  /**
   * Generates location-accurate weather data for Ikeja, Lagos State, Nigeria
   */
  public getCurrentWeather(isNight: boolean = false): WeatherData {
    // Lagos tropical maritime climate
    return {
      condition: isNight ? 'partly_cloudy' : 'sunny',
      temperatureCelsius: isNight ? 26 : 31,
      humidityPercent: 78,
      windSpeedKmh: 12,
      conditionDescription: isNight ? 'Warm Clear Night' : 'Sunny & Tropical',
      locationName: 'Ikeja, Lagos, Nigeria',
    };
  }
}

export const weatherService = WeatherService.getInstance();
