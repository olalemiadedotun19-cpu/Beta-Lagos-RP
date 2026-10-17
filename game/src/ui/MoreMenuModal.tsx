import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  X, Gamepad2, Monitor, LayoutDashboard, UserRound, Info, Maximize, Minimize,
  Save, Check, RotateCcw, UserPlus, BookOpen, Car, PersonStanding,
} from 'lucide-react';
import { GraphicsPanel } from './GraphicsPanel';
import { graphics, isMobileDevice, TIER_LABEL } from '../graphics/GraphicsSettings';
import { gameSettings, hudEdit, canVibrate, DEFAULT_GAME_SETTINGS, EMPTY_ORIENTED_LAYOUT, hudLayoutCount } from '../settings/GameSettings';
import { enterFullscreen, exitFullscreen, isFullscreen } from '../utils/fullscreen';
import type { OrientationMode, PlayerData } from '../types/game';
import { Section, Row, Toggle, Slider, Segmented, ActionRow, InfoRow } from './settings/kit';

interface MoreMenuModalProps {
  playerData: PlayerData;
  cameraSettings: { sensitivity: number; invertY: boolean };
  onUpdateCameraSettings: (settings: { sensitivity: number; invertY: boolean }) => void;
  orientationPreference: OrientationMode;
  onSetOrientation: (mode: OrientationMode) => void;
  onSaveNow: () => void;
  onNewLife: () => void;
  onOpenHelp: () => void;
  onClose: () => void;
}

type TabId = 'controls' | 'graphics' | 'interface' | 'account' | 'about';

const TABS: { id: TabId; label: string; title: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'controls', label: 'Controls', title: 'Controls', Icon: Gamepad2 },
  { id: 'graphics', label: 'Graphics', title: 'Graphics', Icon: Monitor },
  { id: 'interface', label: 'Interface', title: 'Interface & display', Icon: LayoutDashboard },
  { id: 'account', label: 'Account', title: 'Account & data', Icon: UserRound },
  { id: 'about', label: 'About', title: 'About', Icon: Info },
];

/** two-step button state: first tap arms it, second tap (within 4 s) confirms */
function useConfirm(): [boolean, (run: () => void) => void] {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [
    armed,
    (run) => {
      if (armed) {
        window.clearTimeout(timer.current);
        setArmed(false);
        run();
      } else {
        setArmed(true);
        timer.current = window.setTimeout(() => setArmed(false), 4000);
      }
    },
  ];
}

export const MoreMenuModal: React.FC<MoreMenuModalProps> = ({
  playerData,
  cameraSettings,
  onUpdateCameraSettings,
  orientationPreference,
  onSetOrientation,
  onSaveNow,
  onNewLife,
  onOpenHelp,
  onClose,
}) => {
  const [tab, setTab] = useState<TabId>('controls');
  const gs = useSyncExternalStore(gameSettings.subscribe, gameSettings.get);
  const g = useSyncExternalStore(graphics.subscribe, graphics.get);
  // while the device test runs the page is hidden (it keeps its state), so nothing behind it can skew the speed test
  const tuning = useSyncExternalStore(graphics.subscribe, graphics.getTuning);
  const [fs, setFs] = useState<boolean>(isFullscreen());
  const [saved, setSaved] = useState(false);
  const [confirmLife, armLife] = useConfirm();
  const [confirmReset, armReset] = useConfirm();
  const bodyRef = useRef<HTMLDivElement>(null);
  const current = TABS.find((t) => t.id === tab)!;
  const footCustom = hudLayoutCount(gs.hudLayout.foot) > 0;
  const driveCustom = hudLayoutCount(gs.hudLayout.drive) > 0;

  useEffect(() => {
    const onFs = () => setFs(isFullscreen());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isFullscreen()) onClose();
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  const fullscreenSupported = (() => {
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: unknown };
    return !!(el.requestFullscreen || el.webkitRequestFullscreen);
  })();

  const identity = playerData.identity;
  const fullName = [identity.firstName, identity.lastName].filter(Boolean).join(' ') || identity.username;
  const initials = ((identity.firstName?.[0] ?? identity.username?.[0] ?? '?') + (identity.lastName?.[0] ?? '')).toUpperCase();

  const setCamera = (patch: Partial<{ sensitivity: number; invertY: boolean }>) =>
    onUpdateCameraSettings({ ...cameraSettings, ...patch });

  const resetEverything = () => {
    gameSettings.reset();
    onUpdateCameraSettings({ sensitivity: DEFAULT_GAME_SETTINGS.sensitivity, invertY: DEFAULT_GAME_SETTINGS.invertY });
    onSetOrientation('auto');
    graphics.applyTier(g.recommendedTier, 'recommended');
    graphics.set({ fov: 0, adaptive: true, showFps: false });
  };

  const doSave = () => {
    onSaveNow();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  };

  return (
    <>
      {tuning.active && (
        <div className="settings-root fixed top-3 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-full bg-[#121720] border border-[var(--st-accent)] text-[var(--st-ink)] text-[13px] font-semibold pointer-events-none shadow-lg">
          {tuning.message || 'Testing your device…'}
        </div>
      )}

      <div
        className={`settings-root st-enter fixed inset-0 z-50 flex flex-col select-none bg-[var(--st-bg)] text-[var(--st-ink)] ${tuning.active ? 'invisible' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* ------------------------------------------------------------ top bar */}
        <header className="shrink-0 h-14 px-4 flex items-center justify-between border-b border-[var(--st-line)] bg-[var(--st-panel)]">
          <div className="flex items-baseline gap-3 min-w-0">
            <h1 className="text-[22px] font-bold tracking-wide uppercase leading-none">Settings</h1>
            <span className="hidden sm:inline text-[14px] text-[var(--st-dim)] truncate">{current.title}</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="h-9 pl-3 pr-3.5 rounded-full bg-white/[0.07] hover:bg-white/[0.12] active:scale-95 flex items-center gap-1.5 text-[14px] font-semibold cursor-pointer transition"
          >
            <X className="w-4 h-4" /> Close
          </button>
        </header>

        {/* ------------------------------------------------------------ narrow screens: tab strip */}
        <nav className="sm:hidden shrink-0 flex overflow-x-auto border-b border-[var(--st-line)] bg-[var(--st-panel)] px-2" aria-label="Settings sections">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-2.5 text-[14px] font-semibold whitespace-nowrap border-b-2 cursor-pointer ${
                tab === id ? 'text-[var(--st-accent)] border-[var(--st-accent)]' : 'text-[var(--st-dim)] border-transparent'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-h-0 flex">
          {/* ---------------------------------------------------------- sidebar */}
          <nav className="hidden sm:flex w-[200px] lg:w-[240px] shrink-0 flex-col gap-1 p-3 border-r border-[var(--st-line)] bg-[var(--st-panel)] overflow-y-auto" aria-label="Settings sections">
            {TABS.map(({ id, label, Icon }) => {
              const on = tab === id;
              return (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[15px] font-semibold text-left cursor-pointer transition-colors ${
                    on ? 'bg-[var(--st-accent)]/15 text-[var(--st-accent)]' : 'text-[var(--st-dim)] hover:bg-white/[0.05] hover:text-[var(--st-ink)]'
                  }`}
                >
                  <Icon className="w-[18px] h-[18px] shrink-0" />
                  {label}
                </button>
              );
            })}
          </nav>

          {/* ---------------------------------------------------------- content */}
          <main ref={bodyRef} className="flex-1 min-w-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
            <div className="max-w-[720px] mx-auto pb-6">
              {tab === 'controls' && (
                <>
                  <Section title="Camera">
                    <Row title="Look sensitivity" hint="How fast the camera turns when you drag">
                      <Slider label="Look sensitivity" value={cameraSettings.sensitivity} min={0.4} max={2.5} step={0.1}
                        onChange={(v) => setCamera({ sensitivity: Math.round(v * 10) / 10 })} format={(v) => `${v.toFixed(1)}×`} />
                    </Row>
                    <Toggle title="Invert vertical look" hint="Off: drag up looks up" on={cameraSettings.invertY} onToggle={() => setCamera({ invertY: !cameraSettings.invertY })} />
                  </Section>

                  <Section title="Touch controls">
                    <Row title="Control size" hint="Joystick, buttons and minimap">
                      <Slider label="Control size" value={gs.hudScale} min={0.8} max={1.3} step={0.05}
                        onChange={(v) => gameSettings.set({ hudScale: Math.round(v * 100) / 100 })} format={(v) => `${Math.round(v * 100)}%`} />
                    </Row>
                    <Row title="Control opacity" hint="Fade the joystick and action buttons">
                      <Slider label="Control opacity" value={gs.controlsOpacity} min={0.3} max={1} step={0.05}
                        onChange={(v) => gameSettings.set({ controlsOpacity: Math.round(v * 100) / 100 })} format={(v) => `${Math.round(v * 100)}%`} />
                    </Row>
                    {canVibrate() && (
                      <Toggle title="Vibration" hint="A short buzz when you press a button" on={gs.vibration} onToggle={() => gameSettings.set({ vibration: !gs.vibration })} />
                    )}
                  </Section>

                  <Section title="Help">
                    <ActionRow
                      icon={<BookOpen className="w-[18px] h-[18px]" />}
                      title="Keyboard & touch guide"
                      hint="Every control, on one page"
                      onClick={() => { onClose(); onOpenHelp(); }}
                    />
                  </Section>
                </>
              )}

              {tab === 'graphics' && <GraphicsPanel />}

              {tab === 'interface' && (
                <>
                  <Section title="Display">
                    {fullscreenSupported && (
                      <ActionRow
                        icon={fs ? <Minimize className="w-[18px] h-[18px]" /> : <Maximize className="w-[18px] h-[18px]" />}
                        title={fs ? 'Exit full screen' : 'Full screen'}
                        hint="Hides the browser bars"
                        right={<span className="text-[13px] font-semibold text-[var(--st-dim)]">{fs ? 'On' : 'Off'}</span>}
                        onClick={() => void (fs ? exitFullscreen() : enterFullscreen())}
                      />
                    )}
                    <Row title="Screen orientation" hint="Auto follows your device">
                      <Segmented label="Screen orientation" value={orientationPreference}
                        options={[{ v: 'auto', t: 'Auto' }, { v: 'portrait', t: 'Portrait' }, { v: 'landscape', t: 'Landscape' }]}
                        onPick={onSetOrientation} />
                    </Row>
                  </Section>

                  <Section title="HUD layout">
                    <ActionRow
                      icon={<PersonStanding className="w-[18px] h-[18px]" />}
                      title="Character HUD"
                      hint="On foot: place every button, the minimap, status and clock on its own"
                      right={<span className="text-[13px] font-semibold text-[var(--st-dim)]">{footCustom ? 'Custom' : 'Default'}</span>}
                      onClick={() => { onClose(); hudEdit.set('foot'); }}
                    />
                    <ActionRow
                      icon={<Car className="w-[18px] h-[18px]" />}
                      title="Vehicle HUD"
                      hint="In the car: place the speedometer, steering, gas, brake and the rest on their own"
                      right={<span className="text-[13px] font-semibold text-[var(--st-dim)]">{driveCustom ? 'Custom' : 'Default'}</span>}
                      onClick={() => { onClose(); hudEdit.set('drive'); }}
                    />
                    <ActionRow
                      icon={<RotateCcw className="w-[18px] h-[18px]" />}
                      title="Reset character HUD"
                      hint="Put the on-foot HUD back in its original place"
                      disabled={!footCustom}
                      onClick={() => gameSettings.set({ hudLayout: { ...gs.hudLayout, foot: EMPTY_ORIENTED_LAYOUT } })}
                    />
                    <ActionRow
                      icon={<RotateCcw className="w-[18px] h-[18px]" />}
                      title="Reset vehicle HUD"
                      hint="Put the driving HUD back in its original place"
                      disabled={!driveCustom}
                      onClick={() => gameSettings.set({ hudLayout: { ...gs.hudLayout, drive: EMPTY_ORIENTED_LAYOUT } })}
                    />
                  </Section>

                  <Section title="On-screen info">
                    <Toggle title="Minimap" hint="The small map in the corner" on={gs.showMinimap} onToggle={() => gameSettings.set({ showMinimap: !gs.showMinimap })} />
                    <Toggle title="Pop-up messages" hint="Transfers, low vitals, shifts" on={gs.popups} onToggle={() => gameSettings.set({ popups: !gs.popups })} />
                    <Toggle title="FPS counter" hint="Shows your frame rate" on={g.showFps} onToggle={() => graphics.set({ showFps: !g.showFps })} />
                  </Section>
                </>
              )}

              {tab === 'account' && (
                <>
                  <div className="st-card p-3.5 mb-5 flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-full bg-[var(--st-accent)] text-[#1a1400] flex items-center justify-center text-[18px] font-bold shrink-0">{initials}</div>
                    <div className="min-w-0">
                      <div className="text-[18px] font-bold leading-tight truncate">{fullName}</div>
                      <div className="text-[13px] text-[var(--st-dim)] truncate">@{identity.username}</div>
                    </div>
                  </div>

                  <Section title="Game data">
                    <ActionRow
                      icon={saved ? <Check className="w-[18px] h-[18px]" /> : <Save className="w-[18px] h-[18px]" />}
                      title={saved ? 'Saved' : 'Save game now'}
                      hint="The game also saves automatically as you play"
                      right={<span />}
                      onClick={doSave}
                    />
                    <ActionRow
                      icon={<UserPlus className="w-[18px] h-[18px]" />}
                      tone="danger"
                      title={confirmLife ? 'Tap again to confirm' : 'Start a new life'}
                      hint="Opens character creation with a new character"
                      right={<span />}
                      onClick={() => armLife(onNewLife)}
                    />
                  </Section>

                  <Section title="Reset">
                    <ActionRow
                      icon={<RotateCcw className="w-[18px] h-[18px]" />}
                      tone="danger"
                      title={confirmReset ? 'Tap again to confirm' : 'Reset all settings'}
                      hint="Controls, interface and graphics go back to defaults. Your character is untouched"
                      right={<span />}
                      onClick={() => armReset(resetEverything)}
                    />
                  </Section>
                </>
              )}

              {tab === 'about' && (
                <>
                  <div className="st-card p-4 mb-5">
                    <div className="text-[22px] font-bold uppercase tracking-wide leading-tight">International Life</div>
                    <p className="text-[14px] text-[var(--st-dim)] leading-relaxed mt-1.5">
                      A 3D life simulation built with Three.js and TypeScript. Walk, work, travel and build a life, on mobile or desktop.
                    </p>
                  </div>
                  <Section title="This device">
                    <InfoRow k="Platform" v={isMobileDevice() ? 'Mobile' : 'Desktop'} />
                    <InfoRow k="Graphics quality" v={g.preset === 'custom' ? 'Custom' : TIER_LABEL[g.preset === 'recommended' ? g.recommendedTier : g.preset]} />
                    <InfoRow k="Renderer" v="WebGL" />
                  </Section>
                </>
              )}
            </div>
          </main>
        </div>
      </div>
    </>
  );
};
