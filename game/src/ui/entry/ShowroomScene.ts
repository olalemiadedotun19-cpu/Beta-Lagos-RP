import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FigureCharacter } from '../../player/figure/FigureCharacter';
import { releaseCharacter, takePreloadedCharacter } from '../../player/figure/CharacterPreload';
import { previewOutfitFor, type Outfit, type WardrobeItem } from '../../wardrobe/Wardrobe';

/**
 * The 3D clothing showroom: a polished-floor boutique (curved walnut-slat wall with warm light strips, pendant lamps, a round
 * podium with a gold edge) with the player figure standing in the relaxed idle on it.
 *
 * Layout trick: the canvas always fills the whole screen (immersive: the room continues behind the glass panel) and the camera's
 * view offset moves the character to the centre of the FREE area (`setFocus`): right of the panel in landscape, above the sheet in
 * portrait. Drag turns the character (smoothly), pinch / wheel zooms, Full / Close-up reframes.
 *
 * Mobile: capped pixel ratio, no shadow map (a soft contact shadow instead), one reflection-only environment map built once.
 * The item cards are rendered once from the real character wearing the real garment (makeThumbnails).
 */

export type ViewMode = 'full' | 'close';
export interface FocusRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const FOV = 30;
const PODIUM_H = 0.14;
const ZOOM_MIN = 0.62;
const ZOOM_MAX = 1.3;
const THUMB_W = 360;
const THUMB_H = 450;
const GOLD = 0xf2c14e;

const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

function canvas2d(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function asTexture(c: HTMLCanvasElement, srgb: boolean, repeatX = 1, repeatY = 1, aniso = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = aniso;
  return t;
}

/** deterministic pseudo random so the room looks the same every time */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function floorTexture(aniso: number): THREE.CanvasTexture {
  const { c, g } = canvas2d(512, 512);
  const r = rng(11);
  g.fillStyle = '#1b1e25';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    const v = 22 + Math.floor(r() * 22);
    g.fillStyle = `rgba(${v + 6},${v + 8},${v + 14},0.35)`;
    g.fillRect(r() * 512, r() * 512, 1 + r() * 3, 1 + r() * 3);
  }
  g.strokeStyle = 'rgba(0,0,0,0.65)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 509, 509);
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 1;
  g.strokeRect(5, 5, 502, 502);
  return asTexture(c, true, 9, 9, aniso);
}

function slatTextures(aniso: number): { color: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const W = 1024;
  const H = 512;
  const N = 32;
  const sw = W / N;
  const a = canvas2d(W, H);
  const b = canvas2d(W, H);
  const r = rng(5);
  a.g.fillStyle = '#050607';
  a.g.fillRect(0, 0, W, H);
  b.g.fillStyle = '#000';
  b.g.fillRect(0, 0, W, H);
  for (let i = 0; i < N; i++) {
    const shade = 40 + Math.floor(r() * 24);
    a.g.fillStyle = `rgb(${shade + 22},${shade + 8},${shade - 4})`;
    a.g.fillRect(i * sw + 3, 0, sw - 6, H);
    for (let j = 0; j < 14; j++) {
      a.g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.12})`;
      a.g.fillRect(i * sw + 4 + r() * (sw - 9), 0, 1, H);
    }
    // a thin warm light line in every gap (emissive)
    b.g.fillStyle = 'rgb(255,190,115)';
    b.g.fillRect(i * sw - 1, 0, 2, H);
  }
  return { color: asTexture(a.c, true, 5, 1, aniso), glow: asTexture(b.c, true, 5, 1, aniso) };
}

function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const { c, g } = canvas2d(256, 256);
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return asTexture(c, true);
}

function cardBackdrop(): THREE.CanvasTexture {
  const { c, g } = canvas2d(64, 128);
  const lin = g.createLinearGradient(0, 0, 0, 128);
  lin.addColorStop(0, '#2a3140');
  lin.addColorStop(1, '#11151c');
  g.fillStyle = lin;
  g.fillRect(0, 0, 64, 128);
  return asTexture(c, true);
}

export class ShowroomScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 80);
  private fog: THREE.Fog;
  private char: FigureCharacter;
  private envRT: THREE.WebGLRenderTarget;
  private envTex: THREE.Texture;
  private ringMat: THREE.MeshBasicMaterial;
  private ring: THREE.Mesh;
  private container: HTMLElement;
  private isMobile: boolean;

  private raf = 0;
  private disposed = false;
  private last = performance.now();
  private poseTime = 0;
  private w = 1;
  private h = 1;
  private ro: ResizeObserver;

  private focus: FocusRect | null = null;
  private mode: ViewMode = 'full';
  private yaw = 0;
  private yawT = 0;
  private home = 0;
  private zoom = 1;
  private zoomT = 1;
  private cur = { dist: 6, ty: 1.1, ox: 0, oy: 0 };
  private snap = true;
  private pulse = 0;
  private interacted = false;
  private onInteract?: () => void;

  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStart = 0;
  private zoomStart = 1;

  constructor(container: HTMLElement, opts: { isMobile: boolean; onInteract?: () => void }) {
    this.container = container;
    this.isMobile = opts.isMobile;
    this.onInteract = opts.onInteract;

    const dpr = window.devicePixelRatio || 1;
    const renderer = new THREE.WebGLRenderer({ antialias: dpr < 2.5, powerPreference: 'high-performance', alpha: false });
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(dpr, this.isMobile ? 1.5 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !this.isMobile;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const el = renderer.domElement;
    el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;outline:none';
    container.appendChild(el);
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    // ---- reflections for the leather: a studio environment, built once
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.envRT = pmrem.fromScene(room, 0.04);
    this.envTex = this.envRT.texture;
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.35;

    this.scene.background = new THREE.Color(0x090b0f);
    this.fog = new THREE.Fog(0x090b0f, 9, 24);
    this.scene.fog = this.fog;

    this.buildRoom(aniso);
    this.buildLights();

    // gold edge of the podium (pulses when something is equipped)
    this.ringMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.55, fog: false });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.03, 0.011, 8, 120), this.ringMat);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = PODIUM_H + 0.001;
    this.scene.add(this.ring);

    // ---- the character: the one built on the loading screen when there is one
    this.char = takePreloadedCharacter() ?? new FigureCharacter();
    this.char.group.position.y = PODIUM_H;
    this.scene.add(this.char.group);

    this.measure();
    this.ro = new ResizeObserver(() => {
      this.measure();
      this.snap = true;
    });
    this.ro.observe(container);

    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });

    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ room

  private buildRoom(aniso: number): void {
    const scene = this.scene;

    // polished floor
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(16, 72),
      new THREE.MeshStandardMaterial({ map: floorTexture(aniso), color: 0xffffff, roughness: 0.4, metalness: 0.2 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // warm light pool on the floor around the podium
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({
        map: radialTexture('rgba(255,214,160,0.40)', 'rgba(255,214,160,0)'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.003;
    scene.add(pool);

    // podium
    const podium = new THREE.Mesh(
      new THREE.CylinderGeometry(1.0, 1.06, PODIUM_H, 72),
      new THREE.MeshStandardMaterial({ color: 0x242831, roughness: 0.32, metalness: 0.55 })
    );
    podium.position.y = PODIUM_H / 2;
    podium.receiveShadow = true;
    scene.add(podium);

    // soft contact shadow under the feet (the only shadow on phones)
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 1.7),
      new THREE.MeshBasicMaterial({
        map: radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'),
        transparent: true,
        depthWrite: false,
        fog: false,
      })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = PODIUM_H + 0.002;
    scene.add(blob);

    // curved walnut-slat wall with warm light strips in the gaps
    const slats = slatTextures(aniso);
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(8, 8, 7, 96, 1, true, Math.PI - 1.45, 2.9),
      new THREE.MeshStandardMaterial({
        map: slats.color,
        emissiveMap: slats.glow,
        emissive: 0xffffff,
        emissiveIntensity: 0.9,
        roughness: 0.78,
        metalness: 0.05,
        side: THREE.BackSide,
      })
    );
    wall.position.y = 3.5;
    scene.add(wall);

    // pendant lamps hanging along the back of the room
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe4b8, fog: false });
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x15181d });
    const lampGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.42, 28);
    const wireGeo = new THREE.CylinderGeometry(0.006, 0.006, 3, 6);
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i - 3) * 0.2;
      const x = Math.sin(a) * 5.6;
      const z = Math.cos(a) * 5.6;
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(x, 4.3, z);
      const wire = new THREE.Mesh(wireGeo, wireMat);
      wire.position.set(x, 5.8, z);
      scene.add(lamp, wire);
    }
  }

  private buildLights(): void {
    const scene = this.scene;
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    const key = new THREE.DirectionalLight(0xfff5ea, 1.8);
    key.position.set(2.5, 3.8, 3.2);
    key.target.position.set(0, 1, 0);
    if (!this.isMobile) {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -2.2;
      key.shadow.camera.right = 2.2;
      key.shadow.camera.top = 2.8;
      key.shadow.camera.bottom = -1.2;
      key.shadow.camera.near = 0.5;
      key.shadow.camera.far = 14;
      key.shadow.bias = -0.0008;
      key.shadow.normalBias = 0.02;
    }
    scene.add(key, key.target);

    const fill = new THREE.DirectionalLight(0xa5c4e8, 0.85);
    fill.position.set(-2.5, 2, 2.5);
    scene.add(fill);

    const rimBlue = new THREE.DirectionalLight(0x60a5fa, 1.1);
    rimBlue.position.set(2.5, 3, -3);
    scene.add(rimBlue);
    const rimGold = new THREE.DirectionalLight(GOLD, 0.9);
    rimGold.position.set(-3, 2.6, -2.5);
    scene.add(rimGold);
  }

  // ------------------------------------------------------------------ public API

  /** resolves true when the character is built and standing on the podium */
  public async prepare(): Promise<boolean> {
    await this.char.whenReady;
    if (this.disposed || !this.char.ready) return false;
    this.char.setCastShadow(!this.isMobile);
    return true;
  }

  public setOutfit(outfit: Outfit, celebrate = true): void {
    this.char.setOutfit(outfit);
    if (celebrate) {
      this.pulse = 1;
      // glide back to the front (the nearest equivalent turn) so the new garment is seen straight away
      this.yawT = this.home + Math.PI * 2 * Math.round((this.yawT - this.home) / (Math.PI * 2));
    }
  }

  /** where on the container (px) the character should stand: the free area next to the panel */
  public setFocus(rect: FocusRect, homeYaw: number): void {
    this.focus = rect;
    const moved = Math.abs(this.home - homeYaw) > 1e-3;
    this.home = homeYaw;
    if (moved && !this.interacted) this.yawT = homeYaw;
  }

  public setView(mode: ViewMode): void {
    this.mode = mode;
    this.zoomT = 1;
  }

  public zoomBy(factor: number): void {
    this.zoomT = clamp(this.zoomT * factor, ZOOM_MIN, ZOOM_MAX);
  }

  public resetView(): void {
    this.zoomT = 1;
    this.yawT = this.home + Math.PI * 2 * Math.round((this.yawT - this.home) / (Math.PI * 2));
  }

  /**
   * One card picture per item: the real character wearing that garment (jacket card = jacket over the knit, knit card = knit alone),
   * framed from the head to the hips on the card background. Everything happens in this one call, before the next frame is shown.
   */
  public async makeThumbnails(items: WardrobeItem[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (!(await this.prepare()) || items.length === 0) return out;

    const r = this.renderer;
    const prevOutfit = this.char.getOutfit();
    const prevPR = r.getPixelRatio();
    const prevSize = r.getSize(new THREE.Vector2());
    const group = this.char.group;
    const prevY = group.position.y;
    const prevRot = group.rotation.y;

    const tscene = new THREE.Scene();
    const backdrop = cardBackdrop();
    tscene.background = backdrop;
    tscene.environment = this.envTex;
    tscene.environmentIntensity = 0.35;
    tscene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xfff5ea, 1.8);
    key.position.set(2.5, 3.5, 3.0);
    const fill = new THREE.DirectionalLight(0xa5c4e8, 0.85);
    fill.position.set(-2.5, 2, 2.5);
    const rim = new THREE.DirectionalLight(GOLD, 1.0);
    rim.position.set(-2, 2.5, -3);
    tscene.add(key, fill, rim);
    const cam = new THREE.PerspectiveCamera(26, THUMB_W / THUMB_H, 0.1, 20);
    cam.position.set(0.12, 1.5, 2.55);
    cam.lookAt(0, 1.4, 0);

    const shot = canvas2d(THUMB_W, THUMB_H);
    try {
      tscene.add(group); // moves the character out of the showroom for the shots
      group.position.y = 0;
      group.rotation.y = -0.32;
      r.setPixelRatio(1);
      r.setSize(THUMB_W, THUMB_H, false);
      for (const item of items) {
        this.char.setOutfit(previewOutfitFor(item));
        for (let i = 0; i < 3; i++) this.char.setPreviewPose((this.poseTime += 1 / 60));
        r.render(tscene, cam);
        shot.g.drawImage(r.domElement, 0, 0, THUMB_W, THUMB_H);
        out[item.id] = shot.c.toDataURL('image/webp', 0.88);
      }
    } catch (e) {
      console.error('Showroom thumbnails failed', e);
    } finally {
      r.setPixelRatio(prevPR);
      r.setSize(prevSize.x, prevSize.y, false);
      group.position.y = prevY;
      group.rotation.y = prevRot;
      this.scene.add(group);
      this.char.setOutfit(prevOutfit);
      backdrop.dispose();
      this.renderMain(); // no blank frame between the shots and the next animation frame
    }
    return out;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onUp);
    el.removeEventListener('wheel', this.onWheel);

    // the character goes back to the loading-screen pool (the game takes it from there) without showroom shadows
    this.char.setCastShadow(false);
    releaseCharacter(this.char, this.scene);

    const mats = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const ms = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      ms.forEach((x) => mats.add(x));
    });
    mats.forEach((m) => {
      const s = m as THREE.MeshStandardMaterial;
      s.map?.dispose?.();
      s.emissiveMap?.dispose?.();
      m.dispose();
    });
    this.envRT.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (el.parentElement === this.container) this.container.removeChild(el);
  }

  // ------------------------------------------------------------------ internals

  private measure(): void {
    this.w = Math.max(1, this.container.clientWidth);
    this.h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
  }

  /** camera distance, look-at height and view offset for the current framing */
  private goal(): { dist: number; ty: number; ox: number; oy: number } {
    const W = this.w;
    const H = this.h;
    const f = this.focus ?? { left: 0, top: 0, width: W, height: H };
    const full = this.mode === 'full';
    const heightM = full ? 2.3 : 1.25; // metres of the figure that must fit the free area
    const widthM = full ? 1.3 : 1.0;
    // metres visible over the WHOLE canvas height so that the figure fills ~92 % of the free area
    const span = Math.max((heightM * H) / (f.height * 0.92), (widthM * H) / (f.width * 0.92));
    const dist = (span / (2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2))) * this.zoom;
    const ty = PODIUM_H + (full ? 0.98 : 1.4);
    return { dist, ty, ox: W / 2 - (f.left + f.width / 2), oy: H / 2 - (f.top + f.height / 2) };
  }

  private renderMain(): void {
    const g = this.cur;
    this.camera.position.set(0, g.ty + 0.12, g.dist);
    this.camera.lookAt(0, g.ty, 0);
    this.camera.setViewOffset(this.w, this.h, g.ox, g.oy, this.w, this.h);
    this.fog.near = g.dist + 3;
    this.fog.far = g.dist + 17;
    this.renderer.render(this.scene, this.camera);
  }

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    this.poseTime += dt;
    if (this.char.ready) this.char.setPreviewPose(this.poseTime);

    this.yaw += (this.yawT - this.yaw) * damp(9, dt);
    this.zoom += (this.zoomT - this.zoom) * damp(8, dt);
    this.char.group.rotation.y = this.yaw;

    const goal = this.goal();
    if (this.snap) {
      this.cur = goal;
      this.snap = false;
    } else {
      const k = damp(7, dt);
      this.cur.dist += (goal.dist - this.cur.dist) * k;
      this.cur.ty += (goal.ty - this.cur.ty) * k;
      this.cur.ox += (goal.ox - this.cur.ox) * k;
      this.cur.oy += (goal.oy - this.cur.oy) * k;
    }

    this.pulse = Math.max(0, this.pulse - dt * 1.5);
    this.ringMat.opacity = 0.55 + 0.45 * this.pulse;
    const s = 1 + 0.05 * this.pulse;
    this.ring.scale.set(s, s, s);
    this.renderMain();
  };

  private touched(): void {
    if (this.interacted) return;
    this.interacted = true;
    this.onInteract?.();
  }

  private onDown = (e: PointerEvent): void => {
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.renderer.domElement.style.cursor = 'grabbing';
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchStart = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      this.zoomStart = this.zoomT;
    }
  };

  private onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    p.x = e.clientX;
    p.y = e.clientY;
    this.touched();
    if (this.pointers.size === 1) {
      this.yawT += dx * 0.0115;
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      this.zoomT = clamp((this.zoomStart * this.pinchStart) / d, ZOOM_MIN, ZOOM_MAX);
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.renderer.domElement.style.cursor = 'grab';
    try {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.touched();
    this.zoomT = clamp(this.zoomT * (1 + e.deltaY * 0.0012), ZOOM_MIN, ZOOM_MAX);
  };
}
