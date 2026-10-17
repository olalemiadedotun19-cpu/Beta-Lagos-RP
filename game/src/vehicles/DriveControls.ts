/**
 * The on-screen driving buttons (left / right on the left of the screen, gas / brake / drift on the right) write their held state here;
 * the CarRider reads it every frame next to the keyboard (W/S or the arrows to drive, A/D to steer, Space = drift).
 * Plain module state so the HUD (React) and the game loop need no plumbing between them.
 */
export interface DriveControlsState {
  left: boolean;
  right: boolean;
  gas: boolean;
  brake: boolean;
  drift: boolean;
}

export const driveControls: DriveControlsState = { left: false, right: false, gas: false, brake: false, drift: false };

/** let go of everything (leaving the car, a button that lost its touch) */
export function resetDriveControls(): void {
  driveControls.left = false;
  driveControls.right = false;
  driveControls.gas = false;
  driveControls.brake = false;
  driveControls.drift = false;
}
