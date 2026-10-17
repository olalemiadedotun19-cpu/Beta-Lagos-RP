/**
 * Bridge between the game and the full-screen loading page (public/launch/launch.html).
 *
 * LaunchGate keeps that page alive (hidden) after the first load, so the SAME loading screen can come back
 * after character creation while the world is built around the player. Without the launch page (`?nolaunch`)
 * every call is a harmless no-op.
 */
export interface LoadingScreenImpl {
  /** shows the screen with the bar at 0 and resolves once it has been painted, so heavy work can start behind it */
  show: (label: string) => Promise<void>;
  set: (fraction: number, label?: string) => void;
  /** fades the screen out and resolves when it is gone */
  hide: () => Promise<void>;
}

let impl: LoadingScreenImpl | null = null;

export function registerLoadingScreen(next: LoadingScreenImpl | null): void {
  impl = next;
}

export const loadingScreen = {
  show: (label: string): Promise<void> => (impl ? impl.show(label) : Promise.resolve()),
  set: (fraction: number, label?: string): void => impl?.set(fraction, label),
  hide: (): Promise<void> => (impl ? impl.hide() : Promise.resolve()),
};
