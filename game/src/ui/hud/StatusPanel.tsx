import React, { memo, useState } from 'react';
import { formatCurrency } from '../../utils/math';
import { IconArmor, IconCash, IconChevronDown, IconFun, IconHealth, IconHunger, IconHygiene, IconMood, IconStamina, IconStar } from './icons';

interface StatusPanelProps {
  health: number;
  energy: number;
  hunger: number;
  happiness: number;
  hygiene: number;
  stress: number;
  cash: number;
  currencySymbol: string;
  initials: string;
  /** optional systems: rendered only when provided (see hudTypes.ts) */
  armor?: number;
  wantedLevel?: number;
  onOpenCharacter: () => void;
}

const Bar = memo(
  ({ icon, value, color, label, showValue }: { icon: React.ReactNode; value: number; color: string; label: string; showValue?: boolean }) => {
    const v = Math.max(0, Math.min(100, Math.round(value)));
    const low = v <= 20;
    return (
      <div className="flex items-center gap-1.5" role="meter" aria-label={label} aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
        <span className={`shrink-0 flex ${low ? 'hud-pulse' : ''}`} style={{ color }}>
          {icon}
        </span>
        <div className="relative h-[5px] flex-1 bg-white/[0.12] overflow-hidden" style={{ borderRadius: 1 }}>
          <div
            className="absolute inset-0 origin-left transition-transform duration-300 ease-out"
            style={{ transform: `scaleX(${v / 100})`, background: color, opacity: low ? 1 : 0.92 }}
          />
        </div>
        {showValue && (
          <span className="w-[54px] flex justify-between text-[11px] font-semibold leading-none text-slate-300 hud-shadow">
            <span className="uppercase tracking-[0.1em] text-slate-400">{label}</span>
            <span>{v}</span>
          </span>
        )}
      </div>
    );
  }
);

const ICON = 'w-[13px] h-[13px]';

/**
 * Health / Energy / Hunger are always visible (Energy is the game's stamina: sprinting burns it).
 * Tap the bars to expand Fun, Hygiene and Mood. Tap the avatar for the character profile.
 */
export const StatusPanel = memo(
  ({ health, energy, hunger, happiness, hygiene, stress, cash, currencySymbol, initials, armor, wantedLevel, onOpenCharacter }: StatusPanelProps) => {
    const [open, setOpen] = useState(false);
    const hasStars = wantedLevel !== undefined;

    return (
      <div className="hud-glass pointer-events-auto p-1.5 flex items-stretch gap-2" style={{ width: 'clamp(178px, 30vw, 236px)' }}>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Open character profile"
          onClick={onOpenCharacter}
          className="hud-btn hud-nocallout shrink-0 self-start w-10 h-10 rounded-full flex items-center justify-center text-[15px] font-bold tracking-wider cursor-pointer"
        >
          {initials}
        </button>

        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[19px] font-bold leading-none truncate hud-shadow" style={{ color: 'var(--hud-cash)' }}>
              <IconCash className="w-[15px] h-[15px] shrink-0 opacity-90" />
              {formatCurrency(cash, currencySymbol)}
            </span>
            {hasStars && (
              <span className="flex gap-px" aria-label={`Wanted level ${wantedLevel}`}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <IconStar key={i} className={`w-3 h-3 ${i < (wantedLevel ?? 0) ? 'text-white' : 'text-white/20'}`} />
                ))}
              </span>
            )}
          </div>

          <button
            type="button"
            tabIndex={-1}
            aria-expanded={open}
            aria-label="Toggle detailed needs"
            onClick={() => setOpen((v) => !v)}
            className="hud-nocallout flex flex-col gap-[5px] text-left cursor-pointer"
          >
            <Bar icon={<IconHealth className={ICON} />} value={health} color="#e5535f" label="Health" showValue={open} />
            <Bar icon={<IconStamina className={ICON} />} value={energy} color="#4fc3d9" label="Energy" showValue={open} />
            <Bar icon={<IconHunger className={ICON} />} value={hunger} color="#e0a050" label="Hunger" showValue={open} />
            {armor !== undefined && <Bar icon={<IconArmor className={ICON} />} value={armor} color="#6f9bf0" label="Armor" showValue={open} />}
            {open && (
              <>
                <Bar icon={<IconFun className={ICON} />} value={happiness} color="#7fd6a4" label="Fun" showValue />
                <Bar icon={<IconHygiene className={ICON} />} value={hygiene} color="#6fb8e8" label="Hygiene" showValue />
                <Bar icon={<IconMood className={ICON} />} value={100 - stress} color="#a99bea" label="Mood" showValue />
              </>
            )}
            {!open && <IconChevronDown className="w-3 h-3 self-center -my-0.5 text-white/35" />}
          </button>
        </div>
      </div>
    );
  }
);
