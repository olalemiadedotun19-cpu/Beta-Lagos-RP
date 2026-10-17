import React from 'react';
import { ChevronRight } from 'lucide-react';

/** Building blocks for the full-screen settings page. Colours come from the --st-* variables defined in index.css (.settings-root). */

export const Section: React.FC<{ title: string; note?: string; children: React.ReactNode }> = ({ title, note, children }) => (
  <section className="mb-5">
    <div className="flex items-baseline justify-between px-1 mb-1.5">
      <h3 className="st-label">{title}</h3>
      {note && <span className="text-[12px] text-[var(--st-dim)]">{note}</span>}
    </div>
    <div className="st-card divide-y divide-[var(--st-line)]">{children}</div>
  </section>
);

export const Row: React.FC<{ title: string; hint?: string; children?: React.ReactNode }> = ({ title, hint, children }) => (
  <div className="px-3.5 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
    <div className="min-w-0 sm:max-w-[46%]">
      <div className="text-[15px] font-semibold text-[var(--st-ink)] leading-tight">{title}</div>
      {hint && <div className="text-[12px] text-[var(--st-dim)] leading-snug mt-0.5">{hint}</div>}
    </div>
    {children && <div className="sm:flex-1 sm:flex sm:justify-end min-w-0">{children}</div>}
  </div>
);

export const Toggle: React.FC<{ title: string; hint?: string; on: boolean; onToggle: () => void; disabled?: boolean }> = ({ title, hint, on, onToggle, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    disabled={disabled}
    onClick={onToggle}
    className="w-full px-3.5 py-3 flex items-center justify-between gap-4 text-left cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:bg-white/[0.03]"
  >
    <span className="min-w-0">
      <span className="block text-[15px] font-semibold text-[var(--st-ink)] leading-tight">{title}</span>
      {hint && <span className="block text-[12px] text-[var(--st-dim)] leading-snug mt-0.5">{hint}</span>}
    </span>
    <span
      className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${on ? 'bg-[var(--st-accent)]' : 'bg-white/15'}`}
    >
      <span
        className={`absolute top-[3px] w-[18px] h-[18px] rounded-full shadow transition-all ${
          on ? 'left-[23px] bg-[#1a1400]' : 'left-[3px] bg-white'
        }`}
      />
    </span>
  </button>
);

export const Slider: React.FC<{
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  label: string;
}> = ({ value, min, max, step, onChange, format, label }) => (
  <div className="flex items-center gap-3 w-full sm:max-w-[320px]">
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="flex-1 min-w-0 h-8 cursor-pointer accent-[#f2c14e]"
    />
    <span className="w-14 text-right text-[16px] font-bold text-[var(--st-accent)] tabular-nums">{format(value)}</span>
  </div>
);

export function Segmented<T extends string | number>({
  value,
  options,
  onPick,
  label,
}: {
  value: T;
  options: { v: T; t: string }[];
  onPick: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-full sm:w-auto p-0.5 rounded-lg bg-black/40 border border-[var(--st-line)]">
      {options.map((o) => {
        const on = value === o.v;
        return (
          <button
            key={String(o.v)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(o.v)}
            className={`flex-1 sm:flex-none sm:min-w-[52px] px-2.5 py-1.5 rounded-md text-[13px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${
              on ? 'bg-[var(--st-accent)] text-[#1a1400]' : 'text-[var(--st-dim)] hover:text-[var(--st-ink)]'
            }`}
          >
            {o.t}
          </button>
        );
      })}
    </div>
  );
}

export const ActionRow: React.FC<{
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  right?: React.ReactNode;
  tone?: 'default' | 'danger';
  onClick: () => void;
  disabled?: boolean;
}> = ({ icon, title, hint, right, tone = 'default', onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="w-full px-3.5 py-3 flex items-center gap-3 text-left cursor-pointer disabled:opacity-40 active:bg-white/[0.04] hover:bg-white/[0.02]"
  >
    {icon && (
      <span
        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          tone === 'danger' ? 'bg-[#e5484d]/15 text-[#ff7b80]' : 'bg-white/[0.06] text-[var(--st-accent)]'
        }`}
      >
        {icon}
      </span>
    )}
    <span className="min-w-0 flex-1">
      <span className={`block text-[15px] font-semibold leading-tight ${tone === 'danger' ? 'text-[#ff7b80]' : 'text-[var(--st-ink)]'}`}>{title}</span>
      {hint && <span className="block text-[12px] text-[var(--st-dim)] leading-snug mt-0.5">{hint}</span>}
    </span>
    {right ?? <ChevronRight className="w-4 h-4 text-[var(--st-dim)] shrink-0" />}
  </button>
);

export const InfoRow: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <div className="px-3.5 py-2.5 flex items-center justify-between gap-4 text-[14px]">
    <span className="text-[var(--st-dim)]">{k}</span>
    <span className="font-semibold text-[var(--st-ink)] text-right">{v}</span>
  </div>
);
