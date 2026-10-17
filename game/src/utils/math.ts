/**
 * Mathematical & utility helpers for International Life simulation
 */

import { GameDate } from '../types/game';

/**
 * Calculates current player age in complete years based on their birth date and current game date.
 */
export function calculateAge(birthDate: GameDate, currentDate: GameDate): number {
  let age = currentDate.year - birthDate.year;
  if (
    currentDate.month < birthDate.month ||
    (currentDate.month === birthDate.month && currentDate.day < birthDate.day)
  ) {
    age--;
  }
  return Math.max(0, age);
}

/**
 * Formats a GameDate to readable string, e.g. "January 15, 2027 · 14:30"
 */
export function formatGameDateTime(date: GameDate): { dateStr: string; timeStr: string } {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = months[date.month - 1] || 'January';
  const hourPadded = date.hour.toString().padStart(2, '0');
  const minutePadded = date.minute.toString().padStart(2, '0');

  return {
    dateStr: `${monthName} ${date.day}, ${date.year}`,
    timeStr: `${hourPadded}:${minutePadded}`
  };
}

/**
 * Formats financial amounts with currency symbol and thousands separators
 */
export function formatCurrency(amount: number, symbol: string = '₦'): string {
  // trillions would run off the screen: 90,000,000,035,000 -> ₦90.00T
  if (amount >= 1e12) return `${symbol}${(amount / 1e12).toFixed(2)}T`;
  const formatted = Math.floor(amount).toLocaleString('en-US');
  return `${symbol}${formatted}`;
}

/**
 * Distance squared between two 2D points (x, z)
 */
export function distanceSq2D(x1: number, z1: number, x2: number, z2: number): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  return dx * dx + dz * dz;
}

/**
 * Check 2D bounding box collision between circle (player) and axis-aligned box
 */
export function checkCircleBoxCollision(
  circleX: number,
  circleZ: number,
  radius: number,
  boxMinX: number,
  boxMaxX: number,
  boxMinZ: number,
  boxMaxZ: number
): { collides: boolean; pushX: number; pushZ: number } {
  const closestX = Math.max(boxMinX, Math.min(circleX, boxMaxX));
  const closestZ = Math.max(boxMinZ, Math.min(circleZ, boxMaxZ));

  const dx = circleX - closestX;
  const dz = circleZ - closestZ;
  const distSq = dx * dx + dz * dz;

  if (distSq < radius * radius) {
    const dist = Math.sqrt(distSq);
    if (dist === 0) {
      // If dead center inside, push towards shortest exit
      const left = circleX - boxMinX;
      const right = boxMaxX - circleX;
      const bottom = circleZ - boxMinZ;
      const top = boxMaxZ - circleZ;
      const minVal = Math.min(left, right, bottom, top);
      if (minVal === left) return { collides: true, pushX: -radius, pushZ: 0 };
      if (minVal === right) return { collides: true, pushX: radius, pushZ: 0 };
      if (minVal === bottom) return { collides: true, pushX: 0, pushZ: -radius };
      return { collides: true, pushX: 0, pushZ: radius };
    }
    const overlap = radius - dist;
    return {
      collides: true,
      pushX: (dx / dist) * overlap,
      pushZ: (dz / dist) * overlap
    };
  }

  return { collides: false, pushX: 0, pushZ: 0 };
}

/**
 * Linear interpolation
 */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * Math.min(1, Math.max(0, t));
}

/**
 * Clamps a number between min and max
 */
export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
