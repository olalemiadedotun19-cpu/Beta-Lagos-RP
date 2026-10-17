import React, { useSyncExternalStore } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import {
  graphics, pixelRatioFor, TIER_LABEL, TIER_ORDER,
  type GraphicsSettings, type Tier,
} from '../graphics/GraphicsSettings';
import { Section, Row, Toggle, Slider, Segmented } from './settings/kit';

/** Graphics tab of the settings page: device-tuned recommendation, quick presets, then the individual options. */
export const GraphicsPanel: React.FC = () => {
  const s: GraphicsSettings = useSyncExternalStore(graphics.subscribe, graphics.get);
  const tuning = useSyncExternalStore(graphics.subscribe, graphics.getTuning);
  const set = (p: Partial<GraphicsSettings>) => graphics.set(p);
  const w = Math.round(window.innerWidth * pixelRatioFor(s));
  const h = Math.round(window.innerHeight * pixelRatioFor(s));
  const activeTier = s.preset === 'custom' || s.preset === 'recommended' ? null : s.preset;
  const recommendedActive = s.preset === 'recommended';

  return (
    <div>
      {/* recommended for this device */}
      <div className="mb-5 rounded-xl border border-[var(--st-accent)]/40 bg-[var(--st-accent)]/[0.07] p-3.5 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="st-label !text-[var(--st-accent)]">Recommended for this device{recommendedActive ? ' · active' : ''}</div>
          <div className="text-[22px] font-bold text-[var(--st-ink)] leading-tight">{TIER_LABEL[s.recommendedTier]}</div>
          <div className="text-[12px] text-[var(--st-dim)] leading-snug">
            {tuning.active ? tuning.message : 'Tested on this device for smooth play.'}
          </div>
        </div>
        <button
          disabled={tuning.active}
          onClick={() => void graphics.autoTune()}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[var(--st-accent)] text-[#1a1400] text-[14px] font-bold cursor-pointer disabled:opacity-60 active:scale-[0.97] transition"
        >
          {tuning.active ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Auto-detect
        </button>
      </div>

      <Section title="Quality preset" note={s.preset === 'custom' ? 'Custom' : 'Keeps your resolution'}>
        <div className="p-2">
          <Segmented
            label="Quality preset"
            value={activeTier ?? 'none'}
            options={TIER_ORDER.map((t) => ({ v: t as Tier | 'none', t: TIER_LABEL[t] }))}
            onPick={(v) => v !== 'none' && graphics.applyTier(v)}
          />
        </div>
      </Section>

      <Section title="Picture">
        <Row title="Resolution" hint={`${w} × ${h}`}>
          <Segmented label="Resolution" value={s.resolution}
            options={[{ v: '50', t: '50%' }, { v: '60', t: '60%' }, { v: '75', t: '75%' }, { v: '85', t: '85%' }, { v: '100', t: '100%' }, { v: 'native', t: 'Native' }]}
            onPick={(v) => set({ resolution: v })} />
        </Row>
        <Row title="Frame rate" hint="Lower runs cooler and saves battery">
          <Segmented label="Frame rate" value={s.fps}
            options={[{ v: 30, t: '30' }, { v: 60, t: '60' }, { v: 90, t: '90' }, { v: 120, t: '120' }, { v: 0, t: 'Max' }]}
            onPick={(v) => set({ fps: v })} />
        </Row>
        <Row title="Field of view" hint="Wider shows more of the sides">
          <Slider label="Field of view" value={s.fov} min={-8} max={20} step={1}
            onChange={(v) => set({ fov: Math.round(v) })} format={(v) => `${v > 0 ? '+' : ''}${v}°`} />
        </Row>
        <Toggle title="Anti-aliasing" hint="Smoother edges · applies after restart · switched off by itself when the picture is already sharp (1.5x+)" on={s.antialias} onToggle={() => set({ antialias: !s.antialias })} />
      </Section>

      <Section title="World detail">
        <Row title="Shadows">
          <Segmented label="Shadows" value={s.shadows}
            options={[{ v: 'off', t: 'Off' }, { v: 'low', t: 'Low' }, { v: 'medium', t: 'Med' }, { v: 'high', t: 'High' }, { v: 'ultra', t: 'Ultra' }]}
            onPick={(v) => set({ shadows: v })} />
        </Row>
        <Row title="Textures" hint="Low = smooth plain surfaces + simpler buildings (fastest)">
          <Segmented label="Textures" value={s.textures}
            options={[{ v: 'low', t: 'Low' }, { v: 'medium', t: 'Med' }, { v: 'high', t: 'High' }, { v: 'ultra', t: 'Ultra' }]}
            onPick={(v) => set({ textures: v })} />
        </Row>
        <Row title="Draw distance" hint="How far the city is built around you">
          <Segmented label="Draw distance" value={s.drawDistance}
            options={[{ v: 'tiny', t: 'Tiny' }, { v: 'short', t: 'Short' }, { v: 'medium', t: 'Med' }, { v: 'long', t: 'Long' }, { v: 'ultra', t: 'Ultra' }]}
            onPick={(v) => set({ drawDistance: v })} />
        </Row>
      </Section>

      <Section title="Performance">
        <Toggle title="Adaptive resolution" hint="Quietly lowers the resolution when the game can't keep up" on={s.adaptive} onToggle={() => set({ adaptive: !s.adaptive })} />
      </Section>
    </div>
  );
};
