import React, { useEffect, useRef, useState } from 'react';
import { NavSnapshot, MapView } from '../navigation/NavMap';
import { drawMap } from '../navigation/drawMap';
import { MINI_TILT_DEG, MiniGeo, drawMiniOverlay, makeMiniGeo, radiusForSpeed } from '../navigation/drawMini';
import { getWorldLayout } from '../world/WorldLayout';
import { areaNameAt } from '../world/CityDistricts';

interface MinimapProps {
  /** live player/camera/waypoint state straight from the engine (read every frame, no React state involved) */
  getNav: () => NavSnapshot | null;
  /** tap -> open the full-screen map */
  onOpen: () => void;
  /** stop drawing while a modal covers the HUD */
  paused: boolean;
}

const FRAME_MS = 1000 / 30;
/** time constants (s): speed is smoothed first, then the zoom follows it */
const SPEED_TAU = 0.35;
const ZOOM_TAU = 0.6;

/**
 * Circular radar, top-left (laid out by GameHUD; size/gutters come from its CSS variables).
 *  - Heading-up: the camera's look direction is always "up", so the picture matches what the player sees.
 *  - Perspective: the flat map is tilted by the compositor (CSS perspective + rotateX), the player sits below
 *    centre so more street shows ahead; markers/player/compass live on a flat canvas on top (drawMini.ts).
 *  - Speed zoom: metres-to-rim eases between walking (close) and fast travel (wide) from real ground speed.
 *  - Same terrain renderer + same NavSnapshot as the full map (navigation/drawMap.ts), so they cannot disagree.
 * Mobile cost: 30 fps cap, redraw only when something moved, DPR capped, nothing runs while hidden/paused.
 */
export const Minimap: React.FC<MinimapProps> = ({ getNav, onOpen, paused }) => {
  const wrapRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const getNavRef = useRef(getNav);
  getNavRef.current = getNav;
  const [district, setDistrict] = useState('');

  useEffect(() => {
    if (paused) return;
    const wrap = wrapRef.current;
    const layer = layerRef.current;
    const world = worldRef.current;
    const overlay = overlayRef.current;
    if (!wrap || !layer || !world || !overlay) return;
    const wctx = world.getContext('2d', { alpha: false });
    const octx = overlay.getContext('2d');
    if (!wctx || !octx) return;

    let geo: MiniGeo = makeMiniGeo(108);
    let dpr = 1;
    let dirty = true;
    const resize = () => {
      const d = wrap.clientWidth;
      if (d <= 0) return;
      geo = makeMiniGeo(d);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      world.width = Math.round(geo.W * dpr);
      world.height = Math.round(geo.H * dpr);
      overlay.width = Math.round(d * dpr);
      overlay.height = Math.round(d * dpr);
      layer.style.width = `${geo.W}px`;
      layer.style.height = `${geo.H}px`;
      layer.style.left = `${d / 2 - geo.ax}px`;
      layer.style.top = `${geo.oy - geo.ay}px`;
      layer.style.transformOrigin = `${geo.ax}px ${geo.ay}px`;
      layer.style.transform = `perspective(${geo.P}px) rotateX(${MINI_TILT_DEG}deg)`;
      dirty = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const layout = getWorldLayout();
    let raf = 0;
    let last = 0;
    let lastName = '';
    let nameAt = 0;
    // eased state
    let speedS = 0;
    let radius = radiusForSpeed(0);
    // last drawn state (skip identical frames: standing still costs nothing)
    let dx = NaN, dz = NaN, dView = NaN, dFace = NaN, dR = NaN;
    let dRoute: unknown = null;
    let dTarget: unknown = null;

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < FRAME_MS || document.hidden) return;
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const nav = getNavRef.current();
      if (!nav) return;

      speedS += (nav.speed - speedS) * (1 - Math.exp(-dt / SPEED_TAU));
      radius += (radiusForSpeed(speedS) - radius) * (1 - Math.exp(-dt / ZOOM_TAU));

      const moved =
        dirty ||
        Math.abs(nav.x - dx) > 0.02 || Math.abs(nav.z - dz) > 0.02 ||
        Math.abs(nav.view - dView) > 0.002 || Math.abs(nav.face - dFace) > 0.002 ||
        Math.abs(radius - dR) > 0.05 ||
        nav.route !== dRoute || nav.target !== dTarget;
      if (moved) {
        dirty = false;
        dx = nav.x; dz = nav.z; dView = nav.view; dFace = nav.face; dR = radius;
        dRoute = nav.route; dTarget = nav.target;

        const scale = geo.d / 2 / radius;
        const rot = nav.view - Math.PI; // heading-up
        const view: MapView = { cx: nav.x, cz: nav.z, scale, rot, w: geo.W, h: geo.H, ax: geo.ax, ay: geo.ay };
        wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawMap(wctx, view, nav, { mini: true, labels: false, layer: 'world' });
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawMiniOverlay(octx, geo, view, nav);
      }

      if (t - nameAt > 250) {
        nameAt = t;
        const n = areaNameAt(layout, nav.x, nav.z);
        if (n !== lastName) { lastName = n; setDistrict(n); }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [paused]);

  return (
    <button
      ref={wrapRef}
      type="button"
      aria-label="Open map"
      onClick={onOpen}
      onTouchStart={(e) => e.stopPropagation()}
      style={{ width: 'var(--mini, 108px)' }}
      className="hud-mini absolute left-0 top-0 aspect-square rounded-full pointer-events-auto touch-manipulation cursor-pointer p-0 active:scale-[0.97] transition-transform"
    >
      <span className="hud-mini-clip absolute inset-0 rounded-full overflow-hidden">
        <div ref={layerRef} className="hud-mini-layer absolute">
          <canvas ref={worldRef} className="block w-full h-full" />
        </div>
        <span className="hud-mini-fog absolute inset-0 pointer-events-none" />
        <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      </span>
      <span className="hud-mini-ring absolute inset-0 rounded-full pointer-events-none" />
      {district && <span className="hud-mini-district">{district}</span>}
    </button>
  );
};
