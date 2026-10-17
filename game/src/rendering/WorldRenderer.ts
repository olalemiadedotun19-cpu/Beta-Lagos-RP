import * as THREE from 'three';
import { TimeSystem } from '../core/TimeSystem';
import { waterUniforms } from '../procedural/TerrainTextures';
import { ANISO, DRAW_METRES, SHADOW_EVERY, SHADOW_MAP, graphics, pixelRatioFor, setAnisotropyCap } from '../graphics/GraphicsSettings';

export class WorldRenderer {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;

  // Dynamic Lighting
  private sunLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;
  private hemisphereLight: THREE.HemisphereLight;
  private streetLights: { light: THREE.PointLight; pole: THREE.Object3D }[] = [];

  // Colors for diurnal transitions
  private daySkyColor = new THREE.Color(0x87ceeb); // Sky blue
  private sunsetSkyColor = new THREE.Color(0xf6ad55); // Golden sunset
  private nightSkyColor = new THREE.Color(0x0a1128); // Deep midnight blue

  // Barracks island (x,z of its centre, see world/barracks/BarracksLayout.ts): it is lit by EXACTLY the same lights as the city
  // (ambient / hemisphere / sun / exposure, day and night). Only the view distance is lifted near the island.
  private static readonly BAR_X = 31.5;
  private static readonly BAR_Z = 1670;
  /** draw distance in metres (camera far plane); there is no fog: everything past it is simply not drawn */
  private baseFar = 250;
  /** the barracks island is seen from further away than the city streets are */
  private farMul = 1;
  private nightNow = 0;
  private static readonly FAR = 700;
  /** the far plane never goes past this, even near the barracks */
  private static readonly FAR_MAX = 900;
  private unsubGfx: (() => void) | null = null;
  private fpsFrames = 0;
  private fpsT0 = performance.now();

  // sun shadow map cadence: the shadowed scene is static, so the depth pass is redone every few frames instead of every frame
  private shadowFrame = 0;
  private shadowWasActive = false;
  private shadowDirty = true;

  // dynamic resolution (see updateAdaptive): multiplier on the chosen pixel ratio, 1 = exactly what the settings ask for
  private static readonly DYN_MIN = 0.8; // sharpness first: never drop below 80% of the chosen resolution
  private dynScale = 1;
  private dynHold = 0; // seconds to wait before the next change
  private dynBackoff = 4; // seconds to wait before raising again after a drop (doubles every time a raise fails)
  private dynStable = 0; // seconds of comfortable fps in a row
  private dynGrace = 5; // seconds after start / after a settings change in which fps is not judged (shaders compile, textures upload)
  private dynSinceRaise = 99; // seconds since the last raise

  constructor(container: HTMLElement) {
    const gfx = graphics.get();
    this.scene = new THREE.Scene();
    this.scene.background = this.daySkyColor.clone();
    this.scene.fog = null; // no fog: the draw distance cuts the world, it does not fade it

    const aspect = container.clientWidth / container.clientHeight;
    const initialFov = aspect < 1.0 ? 68 : 55;

    this.camera = new THREE.PerspectiveCamera(initialFov + gfx.fov, aspect, 0.1, WorldRenderer.FAR);
    this.camera.position.set(0, 8, 16);

    this.renderer = new THREE.WebGLRenderer({
      // multisampling is wasted work once the picture is already drawn at 1.5x+ pixels per CSS pixel (edges are fine and it costs memory + fill)
      antialias: gfx.antialias && pixelRatioFor(gfx) < 1.5,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(pixelRatioFor(gfx));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    container.appendChild(this.renderer.domElement);

    // Initialize Lighting
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(this.ambientLight);

    this.hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x4a6b3d, 0.4);
    this.scene.add(this.hemisphereLight);

    this.sunLight = new THREE.DirectionalLight(0xfffaf0, 1.4);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 180;

    const d = 45;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;

    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);

    this.applyGraphics();
    this.unsubGfx = graphics.subscribe(this.applyGraphics);
  }

  /** push the current graphics settings into the renderer, lights, camera and fog (runs at start and on every change) */
  private gfxSig = '';
  private applyGraphics = (): void => {
    const g = graphics.get();
    // the settings object also notifies on every fps-counter tick: only react when something this method uses changed
    const sig = [g.resolution, g.shadows, g.textures, g.drawDistance, g.fov, g.adaptive].join('|');
    if (sig === this.gfxSig) return;
    this.gfxSig = sig;
    // resolution
    if (!g.adaptive) this.dynScale = 1;
    this.applyPixelRatio();
    this.dynGrace = Math.max(this.dynGrace, 3); // a settings change: do not judge the fps while shaders / shadow maps / textures settle
    // shadows
    const sm = SHADOW_MAP[g.shadows];
    this.sunLight.castShadow = g.shadows !== 'off';
    const sh = this.sunLight.shadow;
    if (sh.mapSize.width !== sm.size) {
      sh.map?.dispose();
      sh.map = null;
      sh.mapSize.set(sm.size, sm.size);
    }
    sh.camera.left = -sm.d;
    sh.camera.right = sm.d;
    sh.camera.top = sm.d;
    sh.camera.bottom = -sm.d;
    sh.camera.updateProjectionMatrix();
    this.shadowDirty = true;
    // texture filtering
    setAnisotropyCap(Math.min(ANISO[g.textures], this.renderer.capabilities.getMaxAnisotropy()), this.scene);
    // draw distance: camera far plane (no fog)
    this.baseFar = DRAW_METRES[g.drawDistance];
    this.updateFarPlane(true);
    // field of view
    this.onResize();
  };

  private nightListeners: ((night: number) => void)[] = [];

  /** Listeners receive 0 (day) .. 1 (full night), smoothly through the evening. */
  public registerNightListener(cb: (night: number) => void): void {
    this.nightListeners.push(cb);
  }

  public clearNightListeners(): void {
    this.nightListeners = [];
  }

  public registerStreetLights(lights: { light: THREE.PointLight; pole: THREE.Object3D }[]): void {
    this.streetLights = lights;
    for (const item of lights) {
      item.light.visible = this.lampsOn;
      item.light.intensity = this.lampsOn ? 2.6 : 0;
    }
  }

  // The pooled street-lamp PointLights: a light that is in the scene costs every lit pixel its share even at intensity 0.
  // By day they are taken out of the scene's light list (visible = false). Switching changes the shader variant, so the
  // new variant is compiled in the background first (compileAsync) and the lights are only switched once it is ready.
  private lampsOn = false;
  private lampTarget = false;
  private lampBusy = false;

  private flipLamps(on: boolean): void {
    this.lampTarget = on;
    if (this.lampBusy || this.lampsOn === on) return;
    const apply = (): void => {
      this.lampBusy = false;
      this.lampsOn = this.lampTarget;
      for (const item of this.streetLights) item.light.visible = this.lampsOn;
      if (this.lampsOn !== this.lampTarget) this.flipLamps(this.lampTarget);
    };
    const r = this.renderer as THREE.WebGLRenderer & { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown> };
    if (!r.compileAsync || graphics.measuring || this.streetLights.length === 0) { apply(); return; }
    this.lampBusy = true;
    const was = this.lampsOn;
    try {
      // the sync part of compileAsync reads the light list right now: show the lights for that instant, then put them back
      for (const item of this.streetLights) item.light.visible = on;
      r.compileAsync(this.scene, this.camera).then(apply, apply);
    } catch {
      this.lampBusy = false;
      apply();
      return;
    } finally {
      if (this.lampBusy) for (const item of this.streetLights) item.light.visible = was;
    }
  }

  public updateDayNightCycle(timeSystem: TimeSystem): void {
    const daylightFactor = timeSystem.getDaylightFactor();
    const isNight = timeSystem.isNight();
    const progress = timeSystem.getDayProgress();

    // Sun orbital position
    const sunAngle = progress * Math.PI * 2 - Math.PI / 2;
    const sunDist = 70;
    const sunX = Math.cos(sunAngle) * sunDist;
    const sunY = Math.sin(sunAngle) * sunDist;
    const sunZ = 20;

    this.sunLight.position.set(sunX, Math.max(-10, sunY), sunZ);

    // Lighting states: DAY -> EVENING -> NIGHT, blended from the daylight factor
    const nightFactor = THREE.MathUtils.clamp(1 - daylightFactor / 0.4, 0, 1);
    const eveningFactor = THREE.MathUtils.clamp(1 - Math.abs(daylightFactor - 0.28) / 0.28, 0, 1);
    const sunUp = sunY > 0;

    const sunDay = new THREE.Color(0xfffaf0);
    const sunEvening = new THREE.Color(0xffa860);
    this.sunLight.color.copy(sunDay).lerp(sunEvening, eveningFactor);

    if (sunUp) {
      this.sunLight.intensity = Math.max(0.1, daylightFactor * 1.5);
      this.ambientLight.intensity = THREE.MathUtils.lerp(0.15, 0.55, daylightFactor);
      this.hemisphereLight.intensity = THREE.MathUtils.lerp(0.1, 0.45, daylightFactor);
    } else {
      // moonlight: soft, cool, from above (the sun is below the horizon)
      this.sunLight.position.set(-30, 60, 20);
      this.sunLight.color.set(0x9db4ff);
      this.sunLight.intensity = 0.32;
      this.ambientLight.intensity = 0.46;
      this.hemisphereLight.intensity = 0.34;
    }
    // cool moonlit ambient at night, warm bounce in the evening
    this.ambientLight.color.set(0xffffff).lerp(new THREE.Color(0x7f93c9), nightFactor).lerp(new THREE.Color(0xffd7b0), eveningFactor * 0.5);
    this.hemisphereLight.color.set(0x87ceeb).lerp(new THREE.Color(0x3b4a7a), nightFactor).lerp(new THREE.Color(0xf0a070), eveningFactor * 0.6);
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(1.05, 1.2, nightFactor);
    this.nightNow = nightFactor;

    // Sky Color transition
    let currentSky = new THREE.Color();
    if (daylightFactor > 0.4) {
      currentSky.copy(this.daySkyColor);
    } else if (daylightFactor > 0.05) {
      const t = (daylightFactor - 0.05) / 0.35;
      currentSky.lerpColors(this.sunsetSkyColor, this.daySkyColor, t);
    } else {
      currentSky.copy(this.nightSkyColor);
    }

    this.scene.background = currentSky;
    // water shader: sun / moon glints, day-night brightness and sky reflection colour
    waterUniforms.uSunDir.value.copy(this.sunLight.position).normalize();
    waterUniforms.uLight.value = 1 - nightFactor;
    const skyRgb = { r: 0, g: 0, b: 0 };
    currentSky.getRGB(skyRgb, THREE.SRGBColorSpace);
    waterUniforms.uSky.value.set(skyRgb.r, skyRgb.g, skyRgb.b);
    for (const cb of this.nightListeners) cb(nightFactor);

    // Street lamps toggle
    const streetLampIntensity = isNight ? 2.6 : 0.0;
    for (const item of this.streetLights) {
      item.light.intensity = streetLampIntensity;
    }
    this.flipLamps(isNight);
  }

  /** a canvas resize / pixel-ratio change wipes the drawing buffer; it is done at the start of render() and drawn straight away, so a blank or half-initialised buffer (green / noisy blocks on some phone GPUs) is never put on screen */
  private pendingResize = false;
  public onResize = (): void => {
    this.pendingResize = true;
  };

  private pendingPixelRatio: number | null = null;

  private doResize(): void {
    this.pendingResize = false;
    if (this.pendingPixelRatio !== null) {
      this.renderer.setPixelRatio(this.pendingPixelRatio);
      this.pendingPixelRatio = null;
    }
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;

    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (width === 0 || height === 0) return;

    const aspect = width / height;

    // Responsive FOV: widen FOV in portrait to avoid cramped vertical composition
    this.camera.fov = (aspect < 1.0 ? 68 : 55) + graphics.get().fov;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  }

  /** chosen resolution x the dynamic-resolution multiplier */
  private applyPixelRatio(): void {
    const g = graphics.get();
    const pr = Math.max(0.4, pixelRatioFor(g) * (g.adaptive ? this.dynScale : 1));
    const current = this.pendingPixelRatio ?? this.renderer.getPixelRatio();
    if (Math.abs(current - pr) > 1e-3) {
      this.pendingPixelRatio = pr; // applied at the start of the next render() (setPixelRatio reallocates the canvas buffer)
      this.onResize();
    }
  }

  /**
   * The draw distance IS the camera far plane: nothing past it is drawn (no fog, no fade). That stops the GPU drawing far geometry.
   * Near the barracks island the distance is lifted (see applyBarracksReach). The projection matrix is only rebuilt when the
   * distance moved by more than a couple of metres.
   */
  private updateFarPlane(force = false): void {
    const far = THREE.MathUtils.clamp(this.baseFar * this.farMul, 80, WorldRenderer.FAR_MAX);
    if (force || Math.abs(far - this.camera.far) > 2) {
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Dynamic resolution. While the frame rate sits clearly below its target (60, or 30 when the cap is 30) the render resolution steps
   * down a little (never below DYN_MIN x the chosen resolution); once there has been headroom for a while it steps back up. Every failed
   * attempt to go back up doubles the wait, so it settles instead of flip-flopping. Does nothing while the device test runs.
   */
  private updateAdaptive(fps: number, windowSec: number): void {
    const g = graphics.get();
    if (!g.adaptive || graphics.measuring || document.hidden) return;
    if (this.dynGrace > 0) { this.dynGrace -= windowSec; return; }
    const target = g.fps === 30 ? 30 : 60;
    this.dynHold = Math.max(0, this.dynHold - windowSec);
    this.dynSinceRaise += windowSec;
    let next = this.dynScale;
    if (fps < target * 0.9) {
      this.dynStable = 0;
      if (this.dynHold > 0) return;
      // dropping again soon after a raise means the raise was too optimistic: wait longer before trying again
      if (this.dynSinceRaise < 10) this.dynBackoff = Math.min(60, this.dynBackoff * 2);
      next = Math.max(WorldRenderer.DYN_MIN, this.dynScale - (fps < target * 0.6 ? 0.16 : 0.08));
      this.dynHold = 1.5;
    } else if (fps >= target * 0.97) {
      this.dynStable += windowSec;
      if (this.dynScale < 1 && this.dynStable >= this.dynBackoff) {
        next = Math.min(1, this.dynScale + 0.04);
        this.dynStable = 0;
        this.dynSinceRaise = 0;
        this.dynHold = 3;
      }
    }
    if (next !== this.dynScale) {
      this.dynScale = next;
      this.dynGrace = 0.6; // the resize itself costs a frame; do not judge the window that contains it
      this.applyPixelRatio();
    }
  }

  /**
   * The sun's shadow map covers a fixed patch around the map centre. Drawing it costs a full extra depth pass every frame
   * (4096 x 4096 at Max), so it is skipped while that patch is too far away to be seen: beyond the draw distance.
   * Nothing visible changes, and in the barracks (1.5 km away) the whole pass disappears.
   */
  private updateShadowPass(): void {
    const gfx = graphics.get();
    const sm = this.renderer.shadowMap;
    if (gfx.shadows === 'off') return;
    const t = this.sunLight.target.position;
    const cam = this.camera.position;
    const dist = Math.hypot(cam.x - t.x, cam.z - t.z);
    const seeDist = this.baseFar; // nothing is drawn past the far plane
    const reach = SHADOW_MAP[gfx.shadows].d * 1.5 + 20; // radius of the shadow patch
    const active = dist < seeDist + reach;
    sm.autoUpdate = false; // we decide when the depth pass runs
    if (!active) { this.shadowWasActive = false; return; }
    // redo the depth pass when the patch comes into view, when the settings changed, and otherwise every N frames
    this.shadowFrame++;
    if (!this.shadowWasActive || this.shadowDirty || this.shadowFrame % SHADOW_EVERY[gfx.shadows] === 0) {
      sm.needsUpdate = true;
      this.shadowDirty = false;
    }
    this.shadowWasActive = true;
  }

  /**
   * The Independence Barracks sits 1.5 km from the map centre. It has NO lights of its own and no longer gets a brighter rig:
   * it uses the same ambient / hemisphere / sun / exposure as the city. What it still gets is a longer view distance
   * near the island (the sea and the bridge are seen from far away).
   */
  private applyBarracksReach(): void {
    const cam = this.camera.position;
    const d = Math.hypot(cam.x - WorldRenderer.BAR_X, cam.z - WorldRenderer.BAR_Z);
    const t = THREE.MathUtils.clamp((520 - d) / 200, 0, 1); // full strength within 320 m, gone by 520 m
    const s = t * t * (3 - 2 * t);
    const n = this.nightNow;
    this.farMul = s <= 0 ? 1 : THREE.MathUtils.lerp(1, THREE.MathUtils.lerp(2.8, 1.8, n), s);
  }

  public render(): void {
    const now = performance.now();
    waterUniforms.uTime.value = now / 1000;
    if (this.pendingResize) this.doResize();
    this.applyBarracksReach();
    this.updateFarPlane();
    this.updateShadowPass();
    this.renderer.render(this.scene, this.camera);
    this.fpsFrames++;
    if (now - this.fpsT0 >= 500) {
      const fps = (this.fpsFrames * 1000) / (now - this.fpsT0);
      graphics.reportFps(Math.round(fps));
      if (graphics.get().showFps) {
        const inf = this.renderer.info.render;
        graphics.reportInfo(inf.calls, inf.triangles, this.renderer.getPixelRatio());
      }
      this.updateAdaptive(fps, (now - this.fpsT0) / 1000);
      this.fpsFrames = 0;
      this.fpsT0 = now;
    }
  }

  public dispose(): void {
    this.unsubGfx?.();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    this.renderer.dispose();
  }
}
