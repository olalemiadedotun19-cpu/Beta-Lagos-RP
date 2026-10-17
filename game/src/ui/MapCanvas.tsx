import React, { useCallback, useEffect, useRef } from 'react';
import { MapView, NavSnapshot, Pt, getMapData, screenToWorld } from '../navigation/NavMap';
import { MapMarker, drawMap, pickMarker } from '../navigation/drawMap';
import { BARRACKS_MAX_Z } from '../world/barracks/BarracksLayout';

interface MapCanvasProps {
  getNav: () => NavSnapshot | null;
  selectedId: string | null;
  /** change `focusKey` to centre the map on `focus` */
  focus: Pt | null;
  focusKey: number;
  onTapMarker: (m: MapMarker) => void;
  onTapGround: (p: Pt) => void;
}

const MIN_SCALE = 0.11; // city + the barracks island fit a phone screen
const MAX_SCALE = 4;
const START_SCALE = 0.6;
const TAP_SLOP_PX = 8;
const FRAME_MS = 1000 / 30;
// `?debug` (same switch App uses): publish the current view on the canvas so automated tests can check pan/zoom
const DEBUG = typeof window !== 'undefined' && window.location.search.includes('debug');

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Interactive north-up world map. Pointer Events (one finger = pan, two fingers = pinch + pan, wheel = zoom,
 * tap = select marker / drop waypoint). `touch-action: none` + pointer capture keep every gesture on this canvas, so
 * nothing reaches the game; the engine's own input is additionally paused by App while the map is open.
 */
export const MapCanvas: React.FC<MapCanvasProps> = ({ getNav, selectedId, focus, focusKey, onTapMarker, onTapGround }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ cx: 0, cz: 0, scale: START_SCALE, w: 0, h: 0, ready: false });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef({ moved: false, multi: false, sx: 0, sy: 0, st: 0, lx: 0, ly: 0, dist: 0, scale0: 1, mx: 0, my: 0 });
  const selRef = useRef(selectedId);
  selRef.current = selectedId;
  const getNavRef = useRef(getNav);
  getNavRef.current = getNav;
  const cb = useRef({ onTapMarker, onTapGround });
  cb.current = { onTapMarker, onTapGround };

  const asView = (): MapView => ({ cx: view.current.cx, cz: view.current.cz, scale: view.current.scale, rot: 0, w: view.current.w, h: view.current.h });

  const clampCenter = () => {
    const half = getMapData().half;
    view.current.cx = clampN(view.current.cx, -half, half);
    view.current.cz = clampN(view.current.cz, -half, BARRACKS_MAX_Z); // the barracks island lies south of the city
  };

  /** zoom to `next` keeping the world point under screen (fx, fy) fixed */
  const zoomAt = useCallback((next: number, fx: number, fy: number) => {
    const v = view.current;
    const before = screenToWorld(asView(), fx, fy);
    v.scale = clampN(next, MIN_SCALE, MAX_SCALE);
    v.cx = before.x - (fx - v.w / 2) / v.scale;
    v.cz = before.z - (fy - v.h / 2) / v.scale;
    clampCenter();
  }, []);

  // size + draw loop + wheel
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      view.current.w = wrap.clientWidth;
      view.current.h = wrap.clientHeight;
      canvas.width = Math.round(view.current.w * dpr);
      canvas.height = Math.round(view.current.h * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      zoomAt(view.current.scale * Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < FRAME_MS || view.current.w === 0) return;
      last = t;
      const nav = getNavRef.current();
      if (!nav) return;
      if (!view.current.ready) {
        view.current.ready = true;
        view.current.cx = nav.x;
        view.current.cz = nav.z;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMap(ctx, asView(), nav, { mini: false, labels: true, selectedId: selRef.current });
      if (DEBUG) canvas.dataset.view = [view.current.cx, view.current.cz, view.current.scale, view.current.w, view.current.h].join(',');
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [zoomAt]);

  useEffect(() => {
    if (!focus || focusKey === 0) return;
    view.current.cx = focus.x;
    view.current.cz = focus.z;
    view.current.scale = Math.max(view.current.scale, 0.9);
    view.current.ready = true;
  }, [focus, focusKey]);

  const local = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const s = g.current;
    if (pointers.current.size === 1) {
      s.moved = false;
      s.multi = false;
      s.sx = s.lx = p.x;
      s.sy = s.ly = p.y;
      s.st = performance.now();
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      s.multi = true;
      s.moved = true;
      s.dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      s.scale0 = view.current.scale;
      s.mx = (a.x + b.x) / 2;
      s.my = (a.y + b.y) / 2;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const s = g.current;
    const v = view.current;
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const before = screenToWorld(asView(), s.mx, s.my); // world point that was under the previous midpoint
      v.scale = clampN(s.scale0 * (dist / s.dist), MIN_SCALE, MAX_SCALE);
      v.cx = before.x - (mx - v.w / 2) / v.scale;
      v.cz = before.z - (my - v.h / 2) / v.scale;
      clampCenter();
      s.mx = mx;
      s.my = my;
    } else if (!s.multi) {
      if (!s.moved && Math.hypot(p.x - s.sx, p.y - s.sy) > TAP_SLOP_PX) {
        s.moved = true;
        s.lx = p.x;
        s.ly = p.y;
      }
      if (s.moved) {
        v.cx -= (p.x - s.lx) / v.scale;
        v.cz -= (p.y - s.ly) / v.scale;
        clampCenter();
        s.lx = p.x;
        s.ly = p.y;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = g.current;
    const p = local(e);
    const wasTap = e.type === 'pointerup' && pointers.current.size === 1 && !s.multi && !s.moved && performance.now() - s.st < 700;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 1) {
      // a finger lifted mid-pinch: carry on panning with the other one, never treat it as a tap
      const rest = [...pointers.current.values()][0];
      s.lx = rest.x;
      s.ly = rest.y;
      s.moved = true;
    }
    if (pointers.current.size === 0 && !wasTap) s.multi = false;
    if (wasTap) {
      s.multi = false;
      const v = asView();
      const m = pickMarker(v, p.x, p.y, 26);
      if (m) cb.current.onTapMarker(m);
      else {
        const half = getMapData().half;
        const w = screenToWorld(v, p.x, p.y);
        cb.current.onTapGround({ x: clampN(w.x, -half, half), z: clampN(w.z, -half, BARRACKS_MAX_Z) });
      }
    }
  };

  const zoomBy = (k: number) => zoomAt(view.current.scale * k, view.current.w / 2, view.current.h / 2);
  const recenter = () => {
    const nav = getNavRef.current();
    if (!nav) return;
    view.current.cx = nav.x;
    view.current.cz = nav.z;
  };

  const btn =
    'w-10 h-10 rounded-lg bg-[#14181d]/95 border border-[#2a313a] text-[#dde2e9] flex items-center justify-center shadow-lg active:scale-95 active:bg-[#1c222a] cursor-pointer touch-manipulation';

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden bg-slate-950">
      <canvas
        ref={canvasRef}
        data-testid="world-map-canvas"
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="absolute right-3 bottom-3 flex flex-col gap-2 pointer-events-auto" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" aria-label="Zoom in" data-testid="zoom-in" className={btn} onClick={() => zoomBy(1.5)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button type="button" aria-label="Zoom out" data-testid="zoom-out" className={btn} onClick={() => zoomBy(1 / 1.5)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 12h14" /></svg>
        </button>
        <button type="button" aria-label="Centre on me" data-testid="recenter" className={btn} onClick={recenter}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="3.2" /><circle cx="12" cy="12" r="8" /><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" /></svg>
        </button>
      </div>
    </div>
  );
};
