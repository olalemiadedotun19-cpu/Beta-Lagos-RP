import React, { useState } from 'react';
import { ArrowRight, Check, Lock, MapPin } from 'lucide-react';
import type { Account } from '../../auth/AccountStore';
import { useOrientation } from '../../utils/useOrientation';
import { DEFAULT_SPAWN_POINT, SPAWN_POINTS, type SpawnPointId } from '../../spawn/SpawnPoints';

interface SpawnPickerProps {
  account: Account;
  initial?: SpawnPointId;
  /** the citizen has played before: "Where you left off" is offered (and chosen first) */
  hasLastLocation?: boolean;
  onStart: (spawn: SpawnPointId) => void;
  onSignOut: () => void;
}

/** small flat scenes for the cards (shapes only, coloured by the card state in entry.css) */
const Art: React.FC<{ id: SpawnPointId }> = ({ id }) => {
  if (id === 'last') {
    return (
      <svg viewBox="0 0 200 84" aria-hidden="true" preserveAspectRatio="xMidYMax slice">
        <rect className="a-ground" x="0" y="66" width="200" height="18" />
        <path className="a-line" d="M20 70 C 60 54, 80 74, 112 58 S 150 50, 150 50" strokeDasharray="5 5" />
        <path className="a-main" d="M150 14 C 138 14 130 23 130 33 C 130 46 150 64 150 64 C 150 64 170 46 170 33 C 170 23 162 14 150 14 Z" />
        <circle className="a-dark" cx="150" cy="33" r="7" />
      </svg>
    );
  }
  if (id === 'home') {
    return (
      <svg viewBox="0 0 200 84" aria-hidden="true" preserveAspectRatio="xMidYMax slice">
        <rect className="a-ground" x="0" y="66" width="200" height="18" />
        <circle className="a-soft" cx="156" cy="46" r="16" />
        <rect className="a-soft" x="154" y="56" width="4" height="12" />
        <rect className="a-main" x="64" y="38" width="64" height="30" />
        <polygon className="a-main2" points="58,40 96,16 134,40" />
        <rect className="a-dark" x="88" y="48" width="16" height="20" rx="1" />
        <rect className="a-glow" x="70" y="46" width="12" height="11" rx="1" />
        <rect className="a-glow" x="110" y="46" width="12" height="11" rx="1" />
      </svg>
    );
  }
  if (id === 'random') {
    return (
      <svg viewBox="0 0 200 84" aria-hidden="true" preserveAspectRatio="xMidYMax slice">
        <path className="a-line" d="M24 62 C 54 20, 84 70, 112 38 S 160 20, 178 52" />
        <g className="a-main"><circle cx="24" cy="62" r="5" /><circle cx="112" cy="38" r="5" /><circle cx="178" cy="52" r="5" /></g>
        <g className="a-soft"><circle cx="64" cy="30" r="3.5" /><circle cx="146" cy="68" r="3.5" /><circle cx="84" cy="64" r="3.5" /></g>
        <text className="a-glowtxt" x="100" y="24" textAnchor="middle" fontSize="26" fontWeight="700">?</text>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 200 84" aria-hidden="true" preserveAspectRatio="xMidYMax slice">
      <rect className="a-ground" x="0" y="64" width="200" height="20" />
      <rect className="a-line2" x="12" y="73" width="26" height="3" rx="1.5" /><rect className="a-line2" x="58" y="73" width="26" height="3" rx="1.5" />
      <rect className="a-line2" x="104" y="73" width="26" height="3" rx="1.5" /><rect className="a-line2" x="150" y="73" width="26" height="3" rx="1.5" />
      <rect className="a-soft" x="150" y="30" width="3" height="36" />
      <rect className="a-main2" x="140" y="20" width="23" height="14" rx="2" />
      <rect className="a-main" x="30" y="32" width="96" height="34" rx="7" />
      <rect className="a-glow" x="38" y="38" width="16" height="12" rx="2" /><rect className="a-glow" x="58" y="38" width="16" height="12" rx="2" />
      <rect className="a-glow" x="78" y="38" width="16" height="12" rx="2" /><rect className="a-glow" x="98" y="38" width="20" height="22" rx="2" />
      <circle className="a-dark" cx="52" cy="67" r="7" /><circle className="a-dark" cx="104" cy="67" r="7" />
      <circle className="a-soft" cx="52" cy="67" r="3" /><circle className="a-soft" cx="104" cy="67" r="3" />
    </svg>
  );
};

/**
 * The step before the game starts: where do you want to appear? Laid out for landscape (the game's orientation): three scene cards
 * side by side, stacked only when the player forces portrait. Only the bus station can be picked for now; Home and Random location are
 * shown locked until their spawn points exist (spawn/SpawnPoints.ts). The choice is saved with the player; it does not move the
 * character yet.
 */
export const SpawnPicker: React.FC<SpawnPickerProps> = ({ account, initial, hasLastLocation = false, onStart, onSignOut }) => {
  const options = SPAWN_POINTS.filter((s) => s.id !== 'last' || hasLastLocation);
  const first = hasLastLocation ? 'last' : (options.find((s) => s.id === initial && s.available)?.id ?? DEFAULT_SPAWN_POINT);
  const [selected, setSelected] = useState<SpawnPointId>(first);
  const [starting, setStarting] = useState(false);
  const { effectiveIsPortrait: portrait } = useOrientation();
  const firstName = account.name.split(/\s+/)[0] || account.username;
  const current = options.find((s) => s.id === selected);

  const go = (): void => {
    if (starting) return;
    setStarting(true);
    onStart(selected);
  };

  return (
    <div className="ef-root ef-welcome sp-root" role="main" data-portrait={portrait ? '1' : '0'}>
      <div className="ef-welcome-glow" aria-hidden="true" />
      <div className="sp-grid-bg" aria-hidden="true" />
      <div className="sp-wrap">
        <div className="sp-eyebrow">Welcome, {firstName}</div>
        <h1 className="sp-title">Choose your starting point</h1>

        <div className="sp-list" role="radiogroup" aria-label="Spawn point">
          {options.map((s, i) => {
            const on = s.available && selected === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-disabled={!s.available}
                disabled={!s.available || starting}
                className="sp-card"
                data-on={on}
                data-locked={!s.available}
                style={{ animationDelay: `${0.08 + i * 0.07}s` }}
                onClick={() => setSelected(s.id)}
              >
                <span className="sp-art"><Art id={s.id} /></span>
                <span className="sp-body">
                  <span className="sp-name">{s.label}</span>
                  <span className="sp-desc">{s.description}</span>
                </span>
                {s.available ? (
                  <span className="sp-check" aria-hidden="true"><Check size={15} strokeWidth={3} /></span>
                ) : (
                  <span className="sp-soon"><Lock size={12} /> Coming soon</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="sp-foot">
          <div className="sp-where" aria-live="polite">
            <MapPin size={17} aria-hidden="true" />
            <span>Starting at <b>{current?.label}</b></span>
          </div>
          <button type="button" className="ef-submit sp-go" onClick={go} disabled={starting}>
            START <ArrowRight size={18} />
          </button>
        </div>
      </div>
      <button type="button" className="ef-back" onClick={onSignOut} disabled={starting}>
        Not {firstName}? Sign out
      </button>
    </div>
  );
};
