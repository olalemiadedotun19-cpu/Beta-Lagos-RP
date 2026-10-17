/**
 * Game settings that are not graphics: camera, touch controls, HUD and notifications.
 * One shared store (same pattern as graphics/GraphicsSettings.ts): the settings screen writes, the HUD / input read.
 * Saved in localStorage. HUD size and control opacity are applied as CSS variables on <html> (see index.css: --hud-k, --ctl-o).
 */

/** where the player dragged a HUD item: offset from its default spot, as a fraction of the screen width / height (so it survives a resize) */
export interface HudOffset {
  x: number;
  y: number;
}
/** l = landscape, p = portrait: the two orientations keep separate layouts. Missing id = default position. */
export interface OrientedLayout {
  l: Record<string, HudOffset>;
  p: Record<string, HudOffset>;
}
/** which HUD is being laid out: the one you see on foot (character) or the one you see sitting in the car (vehicle) */
export type HudMode = 'foot' | 'drive';
/** every item of every HUD has its own saved offset; the character HUD and the vehicle HUD never share one */
export interface HudLayout {
  foot: OrientedLayout;
  drive: OrientedLayout;
}
export const EMPTY_ORIENTED_LAYOUT: OrientedLayout = { l: {}, p: {} };
export const EMPTY_HUD_LAYOUT: HudLayout = { foot: EMPTY_ORIENTED_LAYOUT, drive: EMPTY_ORIENTED_LAYOUT };
export const hudLayoutCount = (o: OrientedLayout): number => Object.keys(o.l).length + Object.keys(o.p).length;

export interface GameSettings {
  /** camera drag / touch sensitivity multiplier */
  sensitivity: number;
  invertY: boolean;
  /** size of the touch controls, minimap and HUD buttons (1 = default) */
  hudScale: number;
  /** opacity of the joystick and action buttons (1 = default) */
  controlsOpacity: number;
  /** short vibration on HUD button presses (Android; iPhone browsers don't support it) */
  vibration: boolean;
  showMinimap: boolean;
  /** small pop-up messages at the top of the screen (transfers, low vitals, shifts ...) */
  popups: boolean;
  /** player-arranged HUD (Settings > Interface > Rearrange HUD) */
  hudLayout: HudLayout;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  sensitivity: 1,
  invertY: false,
  hudScale: 1,
  controlsOpacity: 1,
  vibration: true,
  showMinimap: true,
  popups: true,
  hudLayout: EMPTY_HUD_LAYOUT,
};

const KEY = 'il_game_settings_v1';

function cleanOffsets(v: unknown): Record<string, HudOffset> {
  const out: Record<string, HudOffset> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [id, o] of Object.entries(v as Record<string, Partial<HudOffset>>)) {
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) out[id] = { x: o.x as number, y: o.y as number };
  }
  return out;
}

function cleanOriented(v: unknown): OrientedLayout {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<OrientedLayout>;
  return { l: cleanOffsets(o.l), p: cleanOffsets(o.p) };
}

/** an item that used to be one grouped box is now several: whatever offset the group had is given to each of its parts (so nothing jumps) */
const LEGACY_SPLIT: Record<string, string[]> = {
  utility: ['bag', 'phone'],
  objective: ['objective', 'toasts'],
  clock: ['clock', 'menu'],
  actions: ['sprint', 'punch', 'aim', 'gas', 'brake'],
  car: ['car', 'drift'],
  drivesteer: ['steerleft', 'steerright'],
};

function migrateOffsets(old: Record<string, HudOffset>): Record<string, HudOffset> {
  const out: Record<string, HudOffset> = {};
  for (const [id, o] of Object.entries(old)) for (const nid of LEGACY_SPLIT[id] ?? [id]) out[nid] = o;
  return out;
}

function loadLayout(raw: unknown): HudLayout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (r.foot || r.drive) return { foot: cleanOriented(r.foot), drive: cleanOriented(r.drive) };
  // old format: one layout ({ l, p }) shared by everything. It becomes the starting point of both HUDs.
  const old = cleanOriented(r);
  const mk = (): OrientedLayout => ({ l: migrateOffsets(old.l), p: migrateOffsets(old.p) });
  return { foot: mk(), drive: mk() };
}

function load(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_GAME_SETTINGS };
    const saved = JSON.parse(raw) as Partial<GameSettings>;
    return { ...DEFAULT_GAME_SETTINGS, ...saved, hudLayout: loadLayout(saved.hudLayout) };
  } catch {
    return { ...DEFAULT_GAME_SETTINGS };
  }
}

class GameSettingsManager {
  private s: GameSettings = load();
  private listeners = new Set<() => void>();

  constructor() {
    this.applyCss();
  }

  get = (): GameSettings => this.s;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  set(patch: Partial<GameSettings>): void {
    this.s = { ...this.s, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch {
      /* private mode / storage full: keep working in memory */
    }
    this.applyCss();
    this.listeners.forEach((l) => l());
  }

  reset(): void {
    this.set({ ...DEFAULT_GAME_SETTINGS });
  }

  private applyCss(): void {
    if (typeof document === 'undefined') return;
    const st = document.documentElement.style;
    st.setProperty('--hud-k', String(this.s.hudScale));
    st.setProperty('--ctl-o', String(this.s.controlsOpacity));
  }
}

export const gameSettings = new GameSettingsManager();

/**
 * "Rearrange HUD" mode (not saved). The settings screen turns it on for one HUD ('foot' = character, 'drive' = vehicle) and
 * closes itself; GameHUD then shows every item of that HUD as its own draggable box with a Done / Reset bar. null = off.
 * Plain store, same subscribe/get shape as gameSettings.
 */
class HudEditState {
  private on: HudMode | null = null;
  private listeners = new Set<() => void>();
  get = (): HudMode | null => this.on;
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  set(v: HudMode | null): void {
    if (this.on === v) return;
    this.on = v;
    this.listeners.forEach((l) => l());
  }
}
export const hudEdit = new HudEditState();

/** a very short buzz for HUD button presses (no-op when off or unsupported) */
export function haptic(ms = 8): void {
  if (!gameSettings.get().vibration) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}

export const canVibrate = (): boolean => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
