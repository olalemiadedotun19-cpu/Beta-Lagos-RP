import { GameDate } from '../types/game';
import { EventBus } from './EventBus';

export type SimulationSpeed = 0 | 1 | 5 | 20;

export class TimeSystem {
  private currentDate: GameDate;
  private speed: SimulationSpeed = 1;
  private minuteAccumulator: number = 0;
  // Real seconds per in-game minute at 1x speed (e.g., 1 real second = 1 game minute)
  private readonly secondsPerMinute: number = 1.0;
  private eventBus: EventBus;

  constructor(eventBus: EventBus, initialDate?: GameDate) {
    this.eventBus = eventBus;
    this.currentDate = initialDate || {
      year: 2027,
      month: 1,
      day: 15,
      hour: 9,
      minute: 0,
    };
  }

  getDate(): GameDate {
    return { ...this.currentDate };
  }

  setDate(date: GameDate): void {
    this.currentDate = { ...date };
    this.eventBus.emit('time:changed', this.getDate());
  }

  getSpeed(): SimulationSpeed {
    return this.speed;
  }

  setSpeed(speed: SimulationSpeed): void {
    this.speed = speed;
    this.eventBus.emit('time:speed_changed', speed);
  }

  /**
   * Advances simulation time based on delta time in seconds
   */
  update(deltaSeconds: number): void {
    if (this.speed === 0) return;

    this.minuteAccumulator += deltaSeconds * this.speed;
    const threshold = this.secondsPerMinute;

    if (this.minuteAccumulator >= threshold) {
      const minutesToAdd = Math.floor(this.minuteAccumulator / threshold);
      this.minuteAccumulator -= minutesToAdd * threshold;
      this.advanceMinutes(minutesToAdd);
    }
  }

  /**
   * Fast-forward clock by specified minutes (e.g., for sleeping, working)
   */
  advanceMinutes(minutes: number): void {
    let currentMin = this.currentDate.minute + minutes;
    const addedHours = Math.floor(currentMin / 60);
    this.currentDate.minute = currentMin % 60;

    let hourTick = false;
    let dayTick = false;

    if (addedHours > 0) {
      hourTick = true;
      let currentHour = this.currentDate.hour + addedHours;
      const addedDays = Math.floor(currentHour / 24);
      this.currentDate.hour = currentHour % 24;

      if (addedDays > 0) {
        dayTick = true;
        this.advanceDays(addedDays);
      }
    }

    this.eventBus.emit('time:minute_tick', { date: this.getDate(), minutesAdded: minutes });
    if (hourTick) {
      this.eventBus.emit('time:hour_tick', { date: this.getDate(), hoursAdded: addedHours });
    }
    if (dayTick) {
      this.eventBus.emit('time:day_tick', { date: this.getDate() });
    }
    this.eventBus.emit('time:changed', this.getDate());
  }

  private advanceDays(days: number): void {
    for (let i = 0; i < days; i++) {
      this.currentDate.day += 1;
      const daysInCurrentMonth = this.getDaysInMonth(this.currentDate.year, this.currentDate.month);
      if (this.currentDate.day > daysInCurrentMonth) {
        this.currentDate.day = 1;
        this.currentDate.month += 1;
        if (this.currentDate.month > 12) {
          this.currentDate.month = 1;
          this.currentDate.year += 1;
          this.eventBus.emit('time:year_tick', { year: this.currentDate.year });
        }
      }
    }
  }

  private getDaysInMonth(year: number, month: number): number {
    // 1-based month
    return new Date(year, month, 0).getDate();
  }

  /**
   * Returns sun progress [0..1] where 0 is midnight, 0.25 is 6:00 (dawn),
   * 0.5 is 12:00 (noon), 0.75 is 18:00 (sunset).
   */
  getDayProgress(): number {
    return (this.currentDate.hour * 60 + this.currentDate.minute) / (24 * 60);
  }

  /**
   * Returns a normalized daylight factor (0 at midnight, 1 at peak noon)
   */
  getDaylightFactor(): number {
    const progress = this.getDayProgress(); // 0 to 1
    // Sun angle from -PI/2 (midnight) to PI/2 (noon) to 3PI/2 (midnight)
    const angle = progress * Math.PI * 2 - Math.PI / 2;
    const sinVal = Math.sin(angle);
    return Math.max(0, Math.min(1, (sinVal + 0.3) / 1.3));
  }

  isNight(): boolean {
    const hour = this.currentDate.hour;
    return hour < 6 || hour >= 19;
  }
}
