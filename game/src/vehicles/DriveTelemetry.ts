/**
 * What the speedometer shows. The CarRider writes it every frame while the character sits in the car; the HUD gauge reads it from its own
 * animation frame (plain module state, like DriveControls, so nothing re-renders React at 60 fps).
 */
export type Gear = 'P' | 'R' | 'N' | 'D';

export interface DriveTelemetry {
  /** true while the character is sitting in the car */
  active: boolean;
  /** speed over the ground, km/h (always >= 0) */
  speedKmh: number;
  gear: Gear;
  /** distance driven since the character got in, km */
  tripKm: number;
  /** 0 (empty) .. 1 (full). There is no refuelling: it only drains, slowly, and nothing happens at empty. */
  fuel: number;
}

/** kilometres on one full tank */
const TANK_RANGE_KM = 250;

export const driveTelemetry: DriveTelemetry = { active: false, speedKmh: 0, gear: 'P', tripKm: 0, fuel: 1 };

export function beginTelemetry(): void {
  driveTelemetry.active = true;
  driveTelemetry.speedKmh = 0;
  driveTelemetry.gear = 'P';
  driveTelemetry.tripKm = 0;
}

export function endTelemetry(): void {
  driveTelemetry.active = false;
  driveTelemetry.speedKmh = 0;
  driveTelemetry.gear = 'P';
}

/** call every driven frame: `speed` m/s over the ground, `forward` m/s along the nose (negative = reversing) */
export function stepTelemetry(dt: number, speed: number, forward: number, throttle: number, brake: number): void {
  const t = driveTelemetry;
  t.speedKmh = speed * 3.6;
  const km = (speed * dt) / 1000;
  t.tripKm += km;
  t.fuel = Math.max(0.02, t.fuel - km / TANK_RANGE_KM);
  if (forward < -0.3) t.gear = 'R';
  else if (speed > 0.5 || throttle > 0.05) t.gear = 'D';
  else if (brake > 0.05) t.gear = 'R'; // braking from a standstill reverses
  else t.gear = 'P';
}
