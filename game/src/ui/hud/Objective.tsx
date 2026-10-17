import React, { memo, useEffect, useRef, useState } from 'react';
import type { WaypointState } from '../../core/GameEngine';
import { gameSettings } from '../../settings/GameSettings';
import { notificationService, SystemNotification } from '../../services/NotificationService';
import { IconBell, IconCash, IconChat, IconClose, IconDoor, IconHealth, IconInfo, IconWaypoint, IconWork } from './icons';

/**
 * The only "mission" the game has today is the GPS walking route, so that is the objective.
 * Indoors it shows where the player is. (When a mission system exists, add its text here.)
 */
export const ObjectivePill = memo(
  ({ waypoint, interiorName, onCancel }: { waypoint: WaypointState | null; interiorName: string | null; onCancel: () => void }) => {
    if (interiorName) {
      return (
        <div className="hud-glass pointer-events-none flex items-center gap-2 pl-2.5 pr-3.5 py-1 max-w-full" style={{ borderLeft: '2px solid var(--hud-accent)' }}>
          <IconDoor className="w-4 h-4 shrink-0" style={{ color: 'var(--hud-accent)' }} />
          <div className="leading-none min-w-0">
            <div className="hud-label text-[10px]">Inside</div>
            <div className="text-[14px] font-semibold uppercase tracking-[0.06em] text-white truncate hud-shadow mt-0.5">{interiorName}</div>
          </div>
        </div>
      );
    }
    if (!waypoint) return null;
    return (
      <div className="hud-glass pointer-events-auto flex items-center gap-2 pl-2 pr-1 py-1 max-w-full" style={{ borderLeft: '2px solid var(--hud-route)' }}>
        <IconWaypoint
          className="w-[18px] h-[18px] shrink-0"
          style={{ color: 'var(--hud-route)', transform: `rotate(${(waypoint.relativeAngle * 180) / Math.PI}deg)`, transition: 'transform 0.2s' }}
        />
        <div className="leading-none min-w-0">
          <div className="text-[14px] font-semibold uppercase tracking-[0.06em] text-white truncate hud-shadow">{waypoint.name}</div>
          <div className="text-[12px] font-medium text-slate-300 truncate mt-0.5">
            {waypoint.arrived ? 'Arrived' : `${waypoint.distanceMeters} m`}
            {waypoint.viaRoad && !waypoint.arrived ? ` · ${waypoint.viaRoad}` : ''}
          </div>
        </div>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Cancel route"
          onClick={onCancel}
          className="hud-btn hud-nocallout shrink-0 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer"
        >
          <IconClose className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }
);

const TOAST_MS = 3800;
const TYPE_ICON: Record<SystemNotification['type'], React.ReactNode> = {
  system: <IconInfo className="w-4 h-4 text-sky-300" />,
  finance: <IconCash className="w-4 h-4 text-[#8fd694]" />,
  vital: <IconHealth className="w-4 h-4 text-[#e5535f]" />,
  work: <IconWork className="w-4 h-4 text-amber-300" />,
  social: <IconChat className="w-4 h-4 text-violet-300" />,
};

/** Brief toasts for REAL notifications only (NotificationService.post: arrivals, salary, transfers...). */
export const Toasts = memo(() => {
  const [items, setItems] = useState<SystemNotification[]>([]);
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const off = notificationService.onPost((n) => {
      if (!gameSettings.get().popups) return;
      setItems((prev) => [...prev.slice(-1), n]); // at most two on screen
      const t = window.setTimeout(() => {
        timers.current.delete(n.id);
        setItems((prev) => prev.filter((x) => x.id !== n.id));
      }, TOAST_MS);
      timers.current.set(n.id, t);
    });
    const live = timers.current;
    return () => {
      off();
      live.forEach((t) => window.clearTimeout(t));
      live.clear();
    };
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="flex flex-col items-center gap-1.5 pointer-events-none" aria-live="polite">
      {items.map((n) => (
        <div key={n.id} className="hud-glass hud-toast-in flex items-center gap-2.5 px-3 py-1.5 max-w-full">
          <span className="shrink-0">{TYPE_ICON[n.type] ?? <IconBell className="w-4 h-4" />}</span>
          <div className="leading-tight min-w-0">
            <div className="text-[14px] font-semibold uppercase tracking-[0.05em] text-white truncate hud-shadow">{n.title}</div>
            <div className="text-[13px] font-medium text-slate-300 line-clamp-2">{n.body}</div>
          </div>
        </div>
      ))}
    </div>
  );
});
