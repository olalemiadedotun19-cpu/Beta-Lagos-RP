/**
 * Graphics settings: one shared manager the renderer, the engine loop and the settings UI all talk to.
 *   - presets (low / medium / high / max) + a "recommended" tier picked for THIS device (hardware guess, then a short live fps test)
 *   - individual options: resolution, frame-rate cap, shadows, texture filtering, draw distance, anti-aliasing, field of view, fps counter
 *   - saved in localStorage; on the very first launch the device's recommended tier is applied automatically
 */
import * as THREE from 'three';

export type Tier = 'low' | 'medium' | 'high' | 'max';
export type Resolution = '50' | '60' | '75' | '85' | '100' | 'native';
export type ShadowQuality = 'off' | 'low' | 'medium' | 'high' | 'ultra';
export type TextureQuality = 'low' | 'medium' | 'high' | 'ultra';
export type DrawDistance = 'tiny' | 'short' | 'medium' | 'long' | 'ultra';

export interface GraphicsSettings {
  preset: Tier | 'recommended' | 'custom';
  /** the tier worked out for this device (shown on the Recommended button) */
  recommendedTier: Tier;
  resolution: Resolution;
  /** frame-rate cap; 0 = unlimited (display refresh rate) */
  fps: 0 | 30 | 60 | 90 | 120;
  shadows: ShadowQuality;
  textures: TextureQuality;
  drawDistance: DrawDistance;
  /** dynamic resolution: quietly lowers the render resolution (never below ~65 %) while the game can't hold its frame rate, and raises it back when there is headroom */
  adaptive: boolean;
  /** needs a restart (a WebGL context option) */
  antialias: boolean;
  /** degrees added to the camera field of view */
  fov: number;
  showFps: boolean;
}

type TierValues = Pick<GraphicsSettings, 'resolution' | 'fps' | 'shadows' | 'textures' | 'drawDistance' | 'antialias'>;

export const TIER_ORDER: Tier[] = ['low', 'medium', 'high', 'max'];
export const TIER_LABEL: Record<Tier, string> = { low: 'Low', medium: 'Medium', high: 'High', max: 'Max' };

export const TIERS: Record<Tier, TierValues> = {
  low: { resolution: '60', fps: 30, shadows: 'off', textures: 'low', drawDistance: 'tiny', antialias: false },
  medium: { resolution: '75', fps: 60, shadows: 'low', textures: 'medium', drawDistance: 'short', antialias: false },
  high: { resolution: '100', fps: 60, shadows: 'medium', textures: 'high', drawDistance: 'long', antialias: true },
  max: { resolution: 'native', fps: 120, shadows: 'ultra', textures: 'ultra', drawDistance: 'ultra', antialias: true },
};

export const SHADOW_MAP: Record<ShadowQuality, { size: number; d: number }> = {
  off: { size: 1024, d: 45 },
  low: { size: 1024, d: 32 },
  medium: { size: 2048, d: 45 },
  high: { size: 2048, d: 60 },
  ultra: { size: 4096, d: 60 },
};
export const ANISO: Record<TextureQuality, number> = { low: 1, medium: 4, high: 8, ultra: 16 };
/** Draw distance, as a factor on the streaming radius (see DRAW_METRES for the distance that is actually drawn). */
export const DRAW_FACTOR: Record<DrawDistance, number> = { tiny: 0.25, short: 0.35, medium: 0.5, long: 0.65, ultra: 0.8 };
/**
 * Draw distance in metres: the camera far plane. There is NO fog any more: everything past this distance is simply not drawn
 * (same distances the fog-based far plane used before: 137 / 182 / 249 / 316 / 383 m).
 */
export const DRAW_METRES: Record<DrawDistance, number> = { tiny: 140, short: 180, medium: 250, long: 320, ultra: 380 };
/** how far (metres) the world streamer builds cells for a draw distance (never below 100 m so the ground in front of you is always real) */
export const loadRadiusFor = (d: DrawDistance): number => Math.max(100, 250 * DRAW_FACTOR[d]);
/** the sun shadow map is re-rendered once every N frames (the scene it shows is static, so nothing visible changes) */
export const SHADOW_EVERY: Record<ShadowQuality, number> = { off: 1, low: 2, medium: 2, high: 3, ultra: 3 };

const KEY = 'il_graphics_v1';
const BASE_KEYS: (keyof TierValues)[] = ['resolution', 'fps', 'shadows', 'textures', 'drawDistance', 'antialias'];
/** what a quality preset is made of: everything EXCEPT the resolution (that stays whatever the player chose, e.g. 100% with Medium effects) */
const PRESET_KEYS = BASE_KEYS.filter((k) => k !== 'resolution');

// ---------------------------------------------------------------- texture filtering cap (live)
// Three reads texture.anisotropy when a texture is uploaded. A getter on the prototype clamps it to the chosen quality for
// every texture, including ones streamed in later; changing the quality re-uploads the textures that are affected.
let anisoCap = 8;
try {
  Object.defineProperty(THREE.Texture.prototype, 'anisotropy', {
    configurable: true,
    get(this: { __an?: number }) { return Math.min(this.__an ?? 1, anisoCap); },
    set(this: { __an?: number }, v: number) { this.__an = v; },
  });
} catch { /* leave three's own behaviour */ }

export function setAnisotropyCap(cap: number, scene?: THREE.Object3D): void {
  const old = anisoCap;
  anisoCap = cap;
  if (!scene || old === cap) return;
  const seen = new Set<THREE.Texture>();
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      for (const k in mat) {
        const t = (mat as unknown as Record<string, unknown>)[k];
        if (t instanceof THREE.Texture && !seen.has(t)) {
          seen.add(t);
          const want = (t as unknown as { __an?: number }).__an ?? 1;
          if (Math.min(want, old) !== Math.min(want, cap) && t.image) t.needsUpdate = true;
        }
      }
    }
  });
}

// ---------------------------------------------------------------- device detection
function gpuName(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

export function isMobileDevice(): boolean {
  return (navigator.maxTouchPoints > 0 && window.matchMedia?.('(pointer: coarse)').matches) || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** a first guess from the hardware: memory, cores, GPU model, screen size */
export function detectTier(): Tier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mobile = isMobileDevice();
  const gpu = gpuName().toLowerCase();
  let score = mobile ? 0 : 2;
  const cores = nav.hardwareConcurrency || 4;
  if (cores >= 8) score += 2; else if (cores >= 6) score += 1; else if (cores <= 4) score -= 1;
  const mem = nav.deviceMemory;
  if (mem) { if (mem >= 8) score += 2; else if (mem >= 4) score += 1; else if (mem <= 2) score -= 2; }
  if (/swiftshader|llvmpipe|software|microsoft basic/.test(gpu)) score -= 6;
  else if (/adreno.*(6[4-9]\d|7\d\d|8\d\d)|mali-g(7[1-9]|[89]\d\d)|apple|nvidia|geforce|rtx|gtx 1[06]|radeon rx|radeon pro/.test(gpu)) score += 2;
  else if (/adreno.*[2-5]\d\d|mali-(4|t)|powervr|sgx|intel.*(hd|uhd|gma)/.test(gpu)) score -= 2;
  const px = window.innerWidth * window.innerHeight * Math.min(window.devicePixelRatio || 1, 3) ** 2;
  if (px > 3.2e6) score -= 1;
  let tier: Tier = score >= 6 ? 'max' : score >= 3 ? 'high' : score >= 0 ? 'medium' : 'low';
  if (mobile && tier === 'max') tier = 'high';
  return tier;
}

function matchTier(s: Pick<GraphicsSettings, keyof TierValues>): Tier | null {
  for (const t of TIER_ORDER) if (PRESET_KEYS.every((k) => TIERS[t][k] === s[k])) return t;
  return null;
}

function measureFps(ms: number): Promise<number> {
  return new Promise((resolve) => {
    let frames = 0;
    let t0 = 0;
    const tick = (t: number) => {
      if (!t0) t0 = t;
      frames++;
      if (t - t0 >= ms) resolve((frames - 1) / ((t - t0) / 1000));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- manager
class GraphicsManager {
  private s: GraphicsSettings;
  private listeners = new Set<() => void>();
  private tuning: { active: boolean; message: string } = { active: false, message: '' };
  private fpsNow = 0;
  /** true while the device test runs: the engine ignores the fps cap so the real speed is measured */
  public measuring = false;

  constructor() {
    const detected = detectTier();
    let saved: Partial<GraphicsSettings> | null = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { saved = null; }
    if (saved && saved.resolution && saved.shadows) {
      this.s = { ...this.fromTier('high', 'high'), ...saved, recommendedTier: saved.recommendedTier ?? detected };
    } else {
      this.s = this.fromTier(detected, 'recommended');
      this.save();
    }
  }

  private fromTier(tier: Tier, preset: GraphicsSettings['preset']): GraphicsSettings {
    return { preset, recommendedTier: tier, fov: 0, showFps: false, adaptive: true, ...TIERS[tier] };
  }

  private save(): void { try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch { /* private mode */ } }
  private emit(): void { this.listeners.forEach((l) => l()); }

  get = (): GraphicsSettings => this.s;
  subscribe = (cb: () => void): (() => void) => { this.listeners.add(cb); return () => this.listeners.delete(cb); };
  getTuning = () => this.tuning;
  getFps = () => this.fpsNow;
  reportFps(v: number): void { if (v !== this.fpsNow) { this.fpsNow = v; if (this.s.showFps) this.emit(); } }
  /** draw calls / triangles / pixel ratio of the last frame (only measured while the FPS counter is on) */
  private info = { calls: 0, tris: 0, pr: 1 };
  getInfo = () => this.info;
  reportInfo(calls: number, tris: number, pr: number): void {
    const p = Math.round(pr * 100) / 100;
    if (calls === this.info.calls && tris === this.info.tris && p === this.info.pr) return;
    this.info = { calls, tris, pr: p };
    this.emit();
  }

  /** change one or more options by hand */
  set(patch: Partial<GraphicsSettings>): void {
    const next = { ...this.s, ...patch };
    const t = matchTier(next);
    next.preset = t ? (this.s.preset === 'recommended' && t === next.recommendedTier ? 'recommended' : t) : 'custom';
    this.s = next;
    this.save();
    this.emit();
  }

  /** a quality preset: sets shadows, textures, draw distance, frame rate and anti-aliasing. The RESOLUTION is left exactly as the player set it. */
  applyTier(tier: Tier, preset: GraphicsSettings['preset'] = tier): void {
    const { resolution: _keepResolution, ...effects } = TIERS[tier];
    void _keepResolution;
    this.s = { ...this.s, ...effects, preset };
    this.save();
    this.emit();
  }

  /** the "Recommended for your device" button: hardware guess, then a short live test that steps down while the game can't hold ~45 fps */
  async autoTune(): Promise<Tier> {
    if (this.tuning.active) return this.s.recommendedTier;
    let tier = detectTier();
    this.measuring = true;
    this.tuning = { active: true, message: 'Testing your device…' };
    this.emit();
    try {
      for (let step = 0; step < 3; step++) {
        this.s = { ...this.s, ...TIERS[tier], preset: 'recommended', recommendedTier: tier };
        this.save();
        this.emit();
        await sleep(900); // let shadows / textures settle and shaders compile
        const fps = await measureFps(1800);
        if (fps >= 45 || tier === 'low') break;
        tier = TIER_ORDER[TIER_ORDER.indexOf(tier) - 1];
      }
    } finally {
      this.measuring = false;
      this.tuning = { active: false, message: '' };
      this.emit();
    }
    return tier;
  }
}

export const graphics = new GraphicsManager();

// ---------------------------------------------------------------- texture / surface detail level
/**
 * What the "Textures" setting really does (it used to change only the filtering sharpness, i.e. nothing a player could feel):
 *   0 Low    flat smooth surfaces: roads, pavements, concrete and ground are plain colour (no image, no relief, no grain shader),
 *            facades are a small low-res colour image only, no lit windows, and the whole city is built with the simple (far) building LOD
 *   1 Medium colour images at half size, lit night windows, NO relief (normal / bump) maps, buildings keep full detail only close up
 *   2 High   full-size images + relief maps, full building detail
 *   3 Ultra  as High with the sharpest filtering
 */
export type TextureLevel = 0 | 1 | 2 | 3;
export const TEXTURE_LEVEL: Record<TextureQuality, TextureLevel> = { low: 0, medium: 1, high: 2, ultra: 3 };
export const textureLevel = (): TextureLevel => TEXTURE_LEVEL[graphics.get().textures];
/** image size multiplier for a level (relative to the full-size textures) */
export const TEXTURE_SCALE: Record<TextureLevel, number> = { 0: 0.25, 1: 0.5, 2: 1, 3: 1 };

const levelListeners = new Set<(lv: TextureLevel) => void>();
let lastLevel: TextureLevel = textureLevel();
graphics.subscribe(() => {
  const lv = textureLevel();
  if (lv === lastLevel) return;
  lastLevel = lv;
  levelListeners.forEach((f) => f(lv));
});
/** run `cb` now and every time the texture level changes (material factories use it to swap their maps / shaders live) */
export function onTextureLevel(cb: (lv: TextureLevel) => void): () => void {
  levelListeners.add(cb);
  cb(textureLevel());
  return () => levelListeners.delete(cb);
}

export function pixelRatioFor(s: GraphicsSettings): number {
  const dpr = window.devicePixelRatio || 1;
  // phones report a device pixel ratio of 3+ (9+ pixels per CSS pixel); past 2x the extra sharpness is invisible but costs 2x the GPU time
  const nativeCap = isMobileDevice() ? 2 : 3;
  const pr = s.resolution === 'native' ? Math.min(dpr, nativeCap) : Math.min(dpr, 2) * (parseInt(s.resolution, 10) / 100);
  return Math.max(0.4, pr);
}
