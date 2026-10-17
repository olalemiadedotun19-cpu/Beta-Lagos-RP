import { EventBus } from '../core/EventBus';
import { PlayerStats } from '../types/game';
import { clamp } from '../utils/math';

export class NeedsSystem {
  private stats: PlayerStats;
  private eventBus: EventBus;
  private decayAccumulator: number = 0;

  constructor(eventBus: EventBus, initialStats: PlayerStats) {
    this.eventBus = eventBus;
    this.stats = { ...initialStats };

    // Listen to time advances (e.g. 1 hour jump or 8 hour sleep)
    this.eventBus.on('time:minute_tick', ({ minutesAdded }: { minutesAdded: number }) => {
      this.simulateTimePassage(minutesAdded);
    });
  }

  getStats(): PlayerStats {
    return { ...this.stats };
  }

  setStats(newStats: PlayerStats): void {
    this.stats = { ...newStats };
    this.clampStats();
    this.eventBus.emit('player:stats_updated', this.getStats());
  }

  applyDelta(delta: Partial<PlayerStats>): void {
    if (delta.energy !== undefined) this.stats.energy += delta.energy;
    if (delta.hunger !== undefined) this.stats.hunger += delta.hunger;
    if (delta.health !== undefined) this.stats.health += delta.health;
    if (delta.happiness !== undefined) this.stats.happiness += delta.happiness;
    if (delta.hygiene !== undefined) this.stats.hygiene += delta.hygiene;
    if (delta.stress !== undefined) this.stats.stress += delta.stress;

    this.clampStats();
    this.eventBus.emit('player:stats_updated', this.getStats());
  }

  /**
   * Called per frame to simulate continuous exertion (e.g., walking, sprinting)
   */
  update(deltaSeconds: number, isSprinting: boolean, isMoving: boolean): void {
    this.decayAccumulator += deltaSeconds;

    // Small exertion consumption while moving/sprinting
    if (isMoving) {
      const energyBurn = (isSprinting ? 1.2 : 0.3) * deltaSeconds;
      this.stats.energy = Math.max(0, this.stats.energy - energyBurn);
    }

    // Every 5 real seconds, trigger a gentle ambient update
    if (this.decayAccumulator >= 5) {
      this.decayAccumulator = 0;
      this.eventBus.emit('player:stats_updated', this.getStats());
    }
  }

  private simulateTimePassage(minutes: number): void {
    const hours = minutes / 60;

    // Natural decay rates per game hour:
    // Hunger drops ~4-5 points per hour
    // Energy drops ~3-4 points per hour awake
    // Hygiene drops ~2 points per hour
    // Happiness drifts slightly downwards if hungry or exhausted
    this.stats.hunger -= hours * 4.2;
    this.stats.energy -= hours * 3.5;
    this.stats.hygiene -= hours * 2.0;

    // Health damage if starving or total exhaustion
    if (this.stats.hunger <= 10) {
      this.stats.health -= hours * 3.0;
      this.stats.stress += hours * 5.0;
    }
    if (this.stats.energy <= 5) {
      this.stats.health -= hours * 2.0;
      this.stats.stress += hours * 4.0;
    }

    // High hygiene or well-fed boosts happiness slightly
    if (this.stats.hunger > 70 && this.stats.energy > 60) {
      this.stats.happiness += hours * 1.5;
      this.stats.stress -= hours * 2.0;
    }

    this.clampStats();
    this.eventBus.emit('player:stats_updated', this.getStats());
  }

  private clampStats(): void {
    this.stats.health = clamp(this.stats.health, 0, 100);
    this.stats.energy = clamp(this.stats.energy, 0, 100);
    this.stats.hunger = clamp(this.stats.hunger, 0, 100);
    this.stats.happiness = clamp(this.stats.happiness, 0, 100);
    this.stats.hygiene = clamp(this.stats.hygiene, 0, 100);
    this.stats.stress = clamp(this.stats.stress, 0, 100);
  }
}
