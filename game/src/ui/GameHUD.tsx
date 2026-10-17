import React, { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { GameDate, OrientationMode, POILocation, PlayerData, PlayerStats } from '../types/game';
import type { InputManager } from '../core/InputManager';
import type { WaypointState } from '../core/GameEngine';
import type { NavSnapshot } from '../navigation/NavMap';
import { formatGameDateTime } from '../utils/math';
import { notificationService } from '../services/NotificationService';
import { gameSettings, hudEdit, type HudMode } from '../settings/GameSettings';
import { Minimap } from './Minimap';
import { HudButton } from './hud/HudButton';
import { HudEditBar, HudModeContext, HudMover } from './hud/HudMover';
import { IconBag, IconMenu, IconMoon, IconPhone, IconSun } from './hud/icons';
import { ChatBox } from './hud/ChatBox';
import { StatusPanel } from './hud/StatusPanel';
import { ObjectivePill, Toasts } from './hud/Objective';
import { Speedometer, speedoSize } from './hud/Speedometer';
import { ActionCluster, CameraZone, DriveSteerPad, FloatingJoystick } from './hud/VirtualControls';
import type { HudExtras, NavTab } from './hud/hudTypes';

interface GameHUDProps {
  playerData: PlayerData;
  stats: PlayerStats;
  currentDate: GameDate;
  activePOI: POILocation | null;
  isInterior: boolean;
  currentLocationName?: string;
  waypoint: WaypointState | null;
  inputManager: InputManager | null;
  /** false while a modal is open: touch controls unmount (and release every virtual input) */
  controlsActive: boolean;
  isPortrait: boolean;
  /** no longer used: the orientation button was removed from the HUD */
  orientationPreference?: OrientationMode;
  onToggleOrientation?: () => void;
  onOpenTab: (tab: NavTab) => void;
  onInteract: () => void;
  /** which car button to show: 'enter' (car close by), 'exit' (sitting in it), null (none) */
  carButton?: 'enter' | 'exit' | null;
  onCar?: () => void;
  onExitInterior: () => void;
  onCancelWaypoint: () => void;
  getNav: () => NavSnapshot | null;
  /** optional, real state of systems that may not exist yet (armour, wanted, weapon, combat buttons) */
  extras?: HudExtras;
  /** proximity chat: says something (false = not sent) and tells the game when the keyboard is in / out of the chat box */
  onSendChat: (text: string) => boolean;
  onChatFocus: (focused: boolean) => void;
}

const useUnread = () =>
  useSyncExternalStore(
    (cb) => notificationService.subscribe(cb),
    () => notificationService.getUnreadCount()
  );

/**
 * Gameplay HUD overlay. Layout (landscape-first, works in portrait):
 *   top-left   minimap, utility column (inventory, phone)
 *   top-center objective / interior name, toasts
 *   top-right  status panel, weapon card (if any), clock + menu
 *   bottom-left floating joystick      bottom-right action cluster
 * Pure presentation: every value comes from the engine's real state; every button calls a real action.
 * Two HUDs: the character HUD (on foot) and the vehicle HUD (sitting in the car). Every item is its own HudMover, and each HUD keeps
 * its own saved layout (Settings > Interface > HUD layout).
 */
export const GameHUD: React.FC<GameHUDProps> = ({
  playerData,
  stats,
  currentDate,
  activePOI,
  isInterior,
  currentLocationName,
  waypoint,
  inputManager,
  controlsActive,
  isPortrait,
  onOpenTab,
  onInteract,
  carButton = null,
  onCar,
  onExitInterior,
  onCancelWaypoint,
  getNav,
  extras,
  onSendChat,
  onChatFocus,
}) => {
  // Stable callbacks so memoized children don't re-render when App re-renders
  const cb = useRef({ onOpenTab, onInteract, onExitInterior, onCar });
  cb.current = { onOpenTab, onInteract, onExitInterior, onCar };
  const openCharacter = useCallback(() => cb.current.onOpenTab('character'), []);
  const openInventory = useCallback(() => cb.current.onOpenTab('inventory'), []);
  const openPhone = useCallback(() => cb.current.onOpenTab('phone'), []);
  const openMenu = useCallback(() => cb.current.onOpenTab('more'), []);
  const openMap = useCallback(() => cb.current.onOpenTab('map'), []);
  const interact = useCallback(() => cb.current.onInteract(), []);
  const exit = useCallback(() => cb.current.onExitInterior(), []);
  const car = useCallback(() => cb.current.onCar?.(), []);
  // 'exit' is only offered while sitting in the car: that is when the driving controls replace the walking ones
  const driving = carButton === 'exit';

  const unread = useUnread();
  const { showMinimap } = useSyncExternalStore(gameSettings.subscribe, gameSettings.get);
  const editMode = useSyncExternalStore(hudEdit.subscribe, hudEdit.get);
  const editing = editMode !== null;
  // never leave rearrange mode switched on if the HUD goes away
  useEffect(() => () => hudEdit.set(null), []);
  // which HUD is on screen: while rearranging, the one being edited (even if you are not in a car); otherwise the one that matches what you are doing
  const mode: HudMode = editMode ?? (driving ? 'drive' : 'foot');
  const showDrive = mode === 'drive';
  // while rearranging, the minimap is shown even indoors so it can be placed
  const miniShown = (!isInterior || editing) && showMinimap;
  const hasObjective = isInterior || !!waypoint;
  const { timeStr } = formatGameDateTime(currentDate);
  const isNight = currentDate.hour < 6 || currentDate.hour >= 19;
  const { firstName, lastName, username } = playerData.identity;
  const initials = ((firstName?.[0] ?? username?.[0] ?? '?') + (lastName?.[0] ?? '')).toUpperCase();

  // top-center stack: the chat box with the route / pop-ups under it.
  // Landscape: the stack sits in the gap between the minimap (left) and the status panel (right) and touches neither.
  // Portrait: that gap is too narrow, so the stack goes under the top row, as wide as the screen allows.
  const centerTop = isPortrait
    ? 'calc(var(--hud-t) + max(var(--mini) + 28px, 158px))'
    : 'var(--hud-t)';
  const centerMax = isPortrait ? 'calc(100vw - 150px)' : 'min(300px, 100%)';
  const centerLeft = isPortrait || !miniShown ? 'var(--hud-l)' : 'calc(var(--hud-l) + var(--mini) + 10px)';
  const centerRight = isPortrait ? 'var(--hud-r)' : 'calc(var(--hud-r) + clamp(178px, 30vw, 236px) + 10px)';

  return (
    <HudModeContext.Provider value={mode}>
    <div
      className="hud-layer hud-nocallout fixed inset-0 z-20 pointer-events-none overflow-hidden"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* touch zones sit at the very bottom of the stack so every button above them wins */}
      {controlsActive && !editing && (
        <>
          <CameraZone inputManager={inputManager} />
          {!driving && <FloatingJoystick inputManager={inputManager} />}
        </>
      )}
      {/* sitting in the car: steering arrows where the stick was (gas / brake / drift are in the action cluster) */}
      {showDrive && (controlsActive || editing) && <DriveSteerPad isPortrait={isPortrait} editing={editing} />}

      {/* vehicle HUD: the speedometer (shown while rearranging the vehicle HUD too, so it can be placed) */}
      {showDrive && (
        <HudMover
          id="speedo"
          label="Speedometer"
          isPortrait={isPortrait}
          editing={editing}
          className="absolute pointer-events-none"
          style={{
            left: '50%',
            // landscape: nudged right of centre so the car stays visible. The shift is the smaller of ~20vw and the room that is left
            // before the speed chip (it sticks out 30% past the dial) would touch the gas / brake buttons (2 buttons + gap + margin).
            translate: isPortrait
              ? '-50% 0'
              : `calc(-50% + max(0px, min(20vw, 50vw - var(--hud-r) - var(--hud-p) * 2.3 - 8px - 20px - 0.8 * ${speedoSize(false)}))) 0`,
            bottom: isPortrait ? 'calc(var(--hud-b) + var(--hud-p) * 1.3 + 22px)' : 'var(--hud-b)',
          }}
        >
          <Speedometer isPortrait={isPortrait} />
        </HudMover>
      )}

      {/* ---------------------------------------------------------------- top-left */}
      {miniShown && (
        <HudMover
          id="minimap"
          label="Minimap"
          isPortrait={isPortrait}
          editing={editing}
          className="absolute left-[var(--hud-l)] top-[var(--hud-t)] z-10"
          style={{ width: 'var(--mini)', height: 'var(--mini)' }}
        >
          <Minimap getNav={getNav} onOpen={openMap} paused={!controlsActive} />
        </HudMover>
      )}
      <div
        className="absolute left-[var(--hud-l)] flex flex-col gap-2 pointer-events-none"
        style={{ top: miniShown ? 'calc(var(--hud-t) + var(--mini) + 26px)' : 'var(--hud-t)' }}
      >
        <HudMover id="bag" label="Bag" isPortrait={isPortrait} editing={editing} className="pointer-events-auto">
          <HudButton label="Bag" icon={<IconBag className="w-5 h-5" />} size="var(--hud-u)" onTap={openInventory} />
        </HudMover>
        <HudMover id="phone" label="Phone" isPortrait={isPortrait} editing={editing} className="pointer-events-auto">
          <HudButton label="Phone" icon={<IconPhone className="w-5 h-5" />} size="var(--hud-u)" badge={unread} onTap={openPhone} />
        </HudMover>
      </div>

      {/* ------------------------------------------------------------- top-center */}
      <div
        className="absolute flex flex-col items-center gap-2 pointer-events-none"
        style={{ top: centerTop, left: centerLeft, right: centerRight }}
      >
        <HudMover
          id="chat"
          label="Chat"
          isPortrait={isPortrait}
          editing={editing}
          className="w-full pointer-events-auto"
          style={{ maxWidth: 520 }}
        >
          <ChatBox onSend={onSendChat} onFocusChange={onChatFocus} />
        </HudMover>
        <div className="flex flex-col items-center gap-2 pointer-events-none" style={{ maxWidth: centerMax }}>
          <HudMover id="objective" label="Objective" isPortrait={isPortrait} editing={editing} className="flex flex-col items-center gap-2 pointer-events-none empty:hidden">
            <ObjectivePill
              waypoint={isInterior ? null : waypoint}
              interiorName={isInterior ? currentLocationName || 'Interior' : null}
              onCancel={onCancelWaypoint}
            />
            {/* placeholder so the (usually empty) objective spot can be found and moved */}
            {editing && !hasObjective && (
              <div className="hud-glass px-4 py-2 leading-none text-[13px] font-semibold uppercase tracking-[0.1em] text-slate-300">Route / objective</div>
            )}
          </HudMover>
          <HudMover id="toasts" label="Pop-ups" isPortrait={isPortrait} editing={editing} className="flex flex-col items-center gap-2 pointer-events-none empty:hidden">
            <Toasts />
            {/* placeholder so the (usually empty) pop-up spot can be found and moved */}
            {editing && <div className="hud-glass px-4 py-2 leading-none text-[13px] font-semibold uppercase tracking-[0.1em] text-slate-300">Pop-up messages</div>}
          </HudMover>
        </div>
      </div>

      {/* -------------------------------------------------------------- top-right */}
      <div className="absolute right-[var(--hud-r)] top-[var(--hud-t)] flex flex-col items-end gap-2 pointer-events-none">
        <HudMover id="status" label="Status" isPortrait={isPortrait} editing={editing} className="flex flex-col items-end gap-2 pointer-events-none">
          <StatusPanel
            health={stats.health}
            energy={stats.energy}
            hunger={stats.hunger}
            happiness={stats.happiness}
            hygiene={stats.hygiene}
            stress={stats.stress}
            cash={playerData.finances.cash}
            currencySymbol={playerData.finances.currencySymbol}
            initials={initials}
            armor={extras?.armor}
            wantedLevel={extras?.wantedLevel}
            onOpenCharacter={openCharacter}
          />
        </HudMover>

        {(extras?.weapon || editing) && (
          <HudMover id="weapon" label="Weapon" isPortrait={isPortrait} editing={editing} className="pointer-events-none">
            <div className="hud-glass px-3 py-1.5 flex items-baseline gap-2.5" aria-label="Current weapon">
              <span className="hud-label text-[12px] max-w-[110px] truncate">{extras?.weapon ? extras.weapon.name : 'Weapon'}</span>
              {extras?.weapon ? (
                <span className="text-[22px] font-bold text-white leading-none hud-shadow">
                  {extras.weapon.ammo}
                  <span className="text-[14px] font-semibold text-slate-400"> / {extras.weapon.reserve}</span>
                </span>
              ) : (
                // rearrange mode only: shows where the weapon card will appear once a weapon system exists
                <span className="text-[22px] font-bold text-slate-500 leading-none">- / -</span>
              )}
            </div>
          </HudMover>
        )}

        <div className="flex items-center gap-1.5 pointer-events-none">
          <HudMover id="clock" label="Clock" isPortrait={isPortrait} editing={editing} className="pointer-events-auto">
            <div className="hud-glass px-2.5 h-8 flex items-center gap-1.5 text-[16px] font-semibold text-slate-100 hud-shadow">
              {isNight ? <IconMoon className="w-3.5 h-3.5 text-indigo-300" /> : <IconSun className="w-3.5 h-3.5 text-amber-300" />}
              {timeStr}
            </div>
          </HudMover>
          <HudMover id="menu" label="Menu" isPortrait={isPortrait} editing={editing} className="pointer-events-auto">
            <HudButton label="Menu" icon={<IconMenu className="w-5 h-5" />} size="var(--hud-u)" iconOnly onTap={openMenu} />
          </HudMover>
        </div>
      </div>

      {/* ----------------------------------------------------------- bottom-right */}
      {(controlsActive || editing) && (
        <ActionCluster
          isPortrait={isPortrait}
          editing={editing}
          inputManager={inputManager}
          canInteract={!!activePOI}
          interactLabel={activePOI?.interiorAvailable ? 'Enter' : 'Use'}
          promptText={activePOI?.name ?? ''}
          isInterior={isInterior}
          onInteract={interact}
          onExit={exit}
          carButton={carButton}
          onCar={car}
          driving={showDrive}
          extraActions={extras?.actions}
        />
      )}

      {editing && <HudEditBar isPortrait={isPortrait} mode={mode} />}
    </div>
    </HudModeContext.Provider>
  );
};
