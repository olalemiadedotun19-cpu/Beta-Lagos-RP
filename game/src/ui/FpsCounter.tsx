import React, { useSyncExternalStore } from 'react';
import { graphics } from '../graphics/GraphicsSettings';

/** small frame-rate readout, shown when "Show FPS" is on in Graphics settings */
export const FpsCounter: React.FC = () => {
  const s = useSyncExternalStore(graphics.subscribe, graphics.get);
  const fps = useSyncExternalStore(graphics.subscribe, graphics.getFps);
  const info = useSyncExternalStore(graphics.subscribe, graphics.getInfo);
  if (!s.showFps) return null;
  const color = fps >= 55 ? 'text-emerald-400' : fps >= 30 ? 'text-amber-400' : 'text-rose-400';
  return (
    <div className="fixed left-1/2 -translate-x-1/2 top-1 z-30 pointer-events-none px-2 py-0.5 rounded-md bg-black/55 font-mono text-[11px] font-bold">
      <span className={color}>{fps}</span> <span className="text-slate-400">FPS</span>
      <span className="text-slate-500"> · {info.calls} calls · {Math.round(info.tris / 1000)}k tris · {info.pr}x</span>
    </div>
  );
};
