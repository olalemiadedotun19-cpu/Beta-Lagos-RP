import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { gameSettings, hudEdit, type HudMode } from '../../settings/GameSettings';

const clamp = (v: number, a: number, b: number) => (a > b ? (a + b) / 2 : Math.min(b, Math.max(a, v)));
const css = (x: number, y: number) => `translate3d(${x}px, ${y}px, 0)`;
const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** re-render on window resize / rotation so fractional offsets are re-applied at the new screen size */
const useViewportTick = (): number => {
  const [t, setT] = useState(0);
  useEffect(() => {
    const f = () => setT((v) => v + 1);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return t;
};

/** which HUD the items below belong to: the character HUD ('foot') or the vehicle HUD ('drive'). Each keeps its own saved positions. */
export const HudModeContext = createContext<HudMode>('foot');

interface HudMoverProps {
  /** stable key for the saved layout, e.g. 'minimap' */
  id: string;
  /** name shown on the box while rearranging */
  label: string;
  isPortrait: boolean;
  /** rearrange mode: the item becomes a draggable box and its own buttons stop working */
  editing: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

/**
 * Wraps one HUD item. The saved offset (from the player's Rearrange HUD settings) is applied as a CSS transform on top of the item's
 * normal position, so the default layout is untouched until the player moves something. In rearrange mode the item is dragged with
 * one pointer (so each item tracks its own finger), kept fully on screen, and saved on release.
 * Landscape and portrait keep separate layouts (the HUD is laid out differently in each), and so do the character and vehicle HUDs
 * (HudModeContext). Every HudMover is one item: it never moves together with a neighbour.
 */
export const HudMover: React.FC<HudMoverProps> = ({ id, label, isPortrait, editing, className = '', style, children }) => {
  const layout = useSyncExternalStore(gameSettings.subscribe, gameSettings.get).hudLayout;
  const mode = useContext(HudModeContext);
  const tick = useViewportTick();
  const key = isPortrait ? 'p' : 'l';
  const off = layout[mode][key][id];
  const tx = off ? off.x * window.innerWidth : 0;
  const ty = off ? off.y * window.innerHeight : 0;

  const ref = useRef<HTMLDivElement>(null);
  const applied = useRef({ x: tx, y: ty });
  const drag = useRef<{ pid: number; sx: number; sy: number; ox: number; oy: number; minX: number; maxX: number; minY: number; maxY: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // keep a moved item on screen if the window got smaller / rotated since it was placed (visual only: the saved value is untouched)
  useLayoutEffect(() => {
    const el = ref.current;
    applied.current = { x: tx, y: ty };
    if (!el || !off || drag.current) return;
    el.style.transform = css(tx, ty);
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const fx = r.left < 0 ? -r.left : r.right > w ? w - r.right : 0;
    const fy = r.top < 0 ? -r.top : r.bottom > h ? h - r.bottom : 0;
    if (fx || fy) {
      el.style.transform = css(tx + fx, ty + fy);
      applied.current = { x: tx + fx, y: ty + fy };
    }
  }, [tx, ty, tick, editing, key, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pid) return;
    drag.current = null;
    setDragging(false);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const { x, y } = applied.current;
    const cur = gameSettings.get().hudLayout;
    gameSettings.set({
      hudLayout: { ...cur, [mode]: { ...cur[mode], [key]: { ...cur[mode][key], [id]: { x: round4(x / w), y: round4(y / h) } } } },
    });
  };

  return (
    <div
      ref={ref}
      data-hud-id={id}
      data-dragging={dragging || undefined}
      className={`${className} ${editing ? 'hud-edit' : ''}`}
      style={{ ...style, transform: tx || ty ? css(tx, ty) : undefined }}
      onPointerDown={(e) => {
        const el = ref.current;
        if (!editing || !el || drag.current) return;
        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        const r = el.getBoundingClientRect();
        const { x: ox, y: oy } = applied.current;
        const w = window.innerWidth;
        const h = window.innerHeight;
        // the item's untransformed box, so the allowed offsets keep it inside the screen
        drag.current = {
          pid: e.pointerId,
          sx: e.clientX,
          sy: e.clientY,
          ox,
          oy,
          minX: -(r.left - ox),
          maxX: w - (r.right - ox),
          minY: -(r.top - oy),
          maxY: h - (r.bottom - oy),
        };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const el = ref.current;
        if (!d || !el || e.pointerId !== d.pid) return;
        const nx = clamp(d.ox + (e.clientX - d.sx), d.minX, d.maxX);
        const ny = clamp(d.oy + (e.clientY - d.sy), d.minY, d.maxY);
        applied.current = { x: nx, y: ny };
        el.style.transform = css(nx, ny);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    >
      {children}
      {editing && <span className="hud-edit-tag">{label}</span>}
    </div>
  );
};

/** Centre-screen panel shown while rearranging: switch between the Character and Vehicle HUD, Reset (this HUD + orientation) and Done. */
export const HudEditBar: React.FC<{ isPortrait: boolean; mode: HudMode }> = ({ isPortrait, mode }) => {
  const key = isPortrait ? 'p' : 'l';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hudEdit.set(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const reset = () => {
    const cur = gameSettings.get().hudLayout;
    gameSettings.set({ hudLayout: { ...cur, [mode]: { ...cur[mode], [key]: {} } } });
  };
  const tabs: { id: HudMode; label: string }[] = [
    { id: 'foot', label: 'Character' },
    { id: 'drive', label: 'Vehicle' },
  ];
  return (
    <div
      className="hud-glass absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto px-4 py-3 flex flex-col items-center gap-2 text-center"
      style={{ width: 'min(300px, 66vw)' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex w-full rounded-md border border-white/25 overflow-hidden" role="tablist" aria-label="Which HUD to rearrange">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={mode === t.id}
            onClick={() => hudEdit.set(t.id)}
            className={`flex-1 h-8 text-[12px] font-bold uppercase tracking-[0.1em] cursor-pointer ${
              mode === t.id ? 'bg-[var(--hud-accent)] text-[#1a1400]' : 'text-slate-200 active:bg-white/10'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="hud-label text-[11px]">
        {mode === 'drive' ? 'Vehicle HUD' : 'Character HUD'} · {isPortrait ? 'Portrait' : 'Landscape'}
      </div>
      <div className="text-[14px] font-medium text-slate-200 leading-tight">Drag any highlighted item. Each one moves on its own.</div>
      <div className="flex gap-2 mt-0.5">
        <button
          type="button"
          onClick={reset}
          className="px-3.5 h-9 rounded-md border border-white/25 text-[13px] font-semibold uppercase tracking-[0.1em] text-slate-100 cursor-pointer active:bg-white/10"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => hudEdit.set(null)}
          className="px-5 h-9 rounded-md bg-[var(--hud-accent)] text-[13px] font-bold uppercase tracking-[0.1em] text-[#1a1400] cursor-pointer active:brightness-90"
        >
          Done
        </button>
      </div>
    </div>
  );
};
