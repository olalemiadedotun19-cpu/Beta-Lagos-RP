import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GameEngine, GameEngineState } from './core/GameEngine';
import { globalSaveManager } from './save/SaveManager';
import { InventoryItem, LocationAction, OrientationMode, POILocation, PlayerData } from './types/game';
import { gameSettings } from './settings/GameSettings';
import { GameHUD } from './ui/GameHUD';
import type { NavTab } from './ui/hud/hudTypes';
import { EntryFlow } from './ui/entry/EntryFlow';
import { LocationModal } from './ui/LocationModal';
import { CitizenProfileModal } from './ui/CitizenProfileModal';
import { ControlsHelpModal } from './ui/ControlsHelpModal';
import { SmartphoneModal } from './ui/SmartphoneModal';
import { MapModal } from './ui/MapModal';
import { InventoryModal } from './ui/InventoryModal';
import { MoreMenuModal } from './ui/MoreMenuModal';
import { FpsCounter } from './ui/FpsCounter';
import type { WaypointState } from './core/GameEngine';
import { useOrientation } from './utils/useOrientation';
import { loadingScreen } from './launch/loadingScreen';
import { chatStore } from './net/chatStore';

/** resolves after the browser has painted what was just changed */
const nextPaint = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// "the character is on the map and the screen is free": enough frames drawn, the last ones smooth, nothing left to build
const SETTLE_FRAMES = 30;
const SETTLE_SMOOTH = 12; // consecutive frames shorter than 50 ms
const SETTLE_CAP_MS = 12000; // never keep the player on the loading screen longer than this

/** Waits (behind the loading screen) until the engine has drawn the map around the player smoothly. */
function settleWorld(engine: GameEngine, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise<void>((resolve) => {
    let finished = false;
    let frames = 0;
    let smooth = 0;
    let last = performance.now();
    const finish = (): void => {
      if (finished) return;
      finished = true;
      window.clearTimeout(cap);
      resolve();
    };
    const cap = window.setTimeout(finish, SETTLE_CAP_MS);
    const tick = (now: number): void => {
      if (finished) return;
      frames++;
      smooth = now - last < 50 ? smooth + 1 : 0;
      last = now;
      onProgress(Math.min(1, (frames / SETTLE_FRAMES + Math.min(1, smooth / SETTLE_SMOOTH)) / 2));
      if (frames >= SETTLE_FRAMES && smooth >= SETTLE_SMOOTH && engine.getPendingWorldJobs() === 0) finish();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  // Orientation and screen responsiveness
  const { effectiveIsPortrait, preference, setPreference } = useOrientation();

  // App UI States
  const [gameState, setGameState] = useState<GameEngineState | null>(null);
  const [showEntry, setShowEntry] = useState<boolean>(false);
  // "start a new life" from inside the game: the sign-in flow ignores the account's saved progress
  const [entryFresh, setEntryFresh] = useState<boolean>(false);
  const [activePOIForModal, setActivePOIForModal] = useState<POILocation | null>(null);
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [isEngineReady, setIsEngineReady] = useState<boolean>(false);
  // true while the loading screen covers the game (input stays paused until it is gone)
  const [starting, setStarting] = useState<boolean>(false);

  const [waypoint, setWaypoint] = useState<WaypointState | null>(null);
  const [carSpawned, setCarSpawned] = useState(false);
  // Short black fade used for ENTER / EXIT scene transitions
  const [sceneFade, setSceneFade] = useState<boolean>(false);
  // true while the keyboard is in the chat box: the game ignores the movement keys (and hides the touch controls) so typing never moves the character
  const [chatTyping, setChatTyping] = useState<boolean>(false);

  // Active Bottom Navigation Tab
  const [activeNavTab, setActiveNavTab] = useState<NavTab>('home');

  // Camera Settings State (Persisted in engine)
  const [cameraSettings, setCameraSettings] = useState<{
    sensitivity: number;
    invertY: boolean;
  }>({
    sensitivity: gameSettings.get().sensitivity,
    invertY: gameSettings.get().invertY,
  });

  // Check whether any blocking UI modal or sheet is open
  const isAnyModalOpen =
    activeNavTab !== 'home' ||
    activePOIForModal !== null ||
    showEntry ||
    showHelpModal ||
    chatTyping ||
    starting;

  // Sync InputManager pause state whenever modal state changes
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.inputManager.setInputPaused(isAnyModalOpen);
    }
  }, [isAnyModalOpen]);

  // The last position must survive closing the tab or the phone going to sleep: save what the engine knows right now and send it to the cloud.
  // (A periodic save covers the case where the browser kills the page without telling us.)
  useEffect(() => {
    const saveNow = () => {
      const engine = engineRef.current;
      if (!engine) return;
      globalSaveManager.save(engine.getPlayerData());
      void globalSaveManager.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') saveNow();
    };
    const timer = window.setInterval(() => {
      const engine = engineRef.current;
      if (engine) globalSaveManager.save(engine.getPlayerData());
    }, 30000);
    window.addEventListener('pagehide', saveNow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', saveNow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Every launch starts at the sign-in screen (the loading screen is still up and fades out as soon as it shows)
  useEffect(() => {
    setShowEntry(true);
    return () => {
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
    };
  }, []);

  const initEngine = (playerData: PlayerData) => {
    if (!containerRef.current) return;

    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
    }

    const engine = new GameEngine(containerRef.current, playerData);
    engineRef.current = engine;
    if (new URLSearchParams(window.location.search).has('debug')) {
      const w = window as unknown as Record<string, unknown>;
      w.__engine = engine;
    }

    // Apply camera settings
    engine.inputManager.setCameraSettings(cameraSettings);

    engine.setOnStateChange((state) => {
      setGameState({ ...state });
      globalSaveManager.save(state.playerData);
    });

    engine.setOnWaypointChange((wp) => setWaypoint(wp ? { ...wp } : null));

    engine.start();
    setCarSpawned(false);
    setIsEngineReady(true);
    setShowEntry(false);

    setGameState({
      playerData: engine.getPlayerData(),
      stats: engine.needsSystem.getStats(),
      currentDate: engine.timeSystem.getDate(),
      simSpeed: engine.timeSystem.getSpeed(),
      activePOI: null,
      isInterior: false,
      currentLocationDef: null,
    });
  };

  // the loading screen is only in the way while the sign-in flow is showing, so it goes as soon as that appears
  useEffect(() => {
    if (showEntry) void loadingScreen.hide();
  }, [showEntry]);

  /**
   * After the showroom (START GAME): the SAME loading screen as the first one comes back, and behind it the entry flow closes
   * (handing the prepared character back, still wearing the chosen outfit), the world is built and the character is placed on the
   * map. Only when the map is drawn smoothly does the loading screen go away and the game start.
   */
  const handleEntryComplete = async (data: PlayerData, slotId: string) => {
    if (starting) return;
    globalSaveManager.setCurrentSlotId(slotId);
    globalSaveManager.save(data, slotId);
    setStarting(true);
    await loadingScreen.show('Creating your character');
    await sleep(300);

    loadingScreen.set(0.06, 'Creating your character');
    setShowEntry(false); // closes the showroom, which hands the prepared character back to the game
    setEntryFresh(false);
    await nextPaint();

    loadingScreen.set(0.14, 'Building the world around you');
    await sleep(300);

    initEngine(data); // the heavy part, it runs behind the loading screen
    loadingScreen.set(0.6, 'Placing you on the map');
    const engine = engineRef.current;
    if (engine) await settleWorld(engine, (f) => loadingScreen.set(0.6 + 0.4 * f));

    loadingScreen.set(1, 'Starting game');
    await sleep(400);
    await loadingScreen.hide();
    setStarting(false);

    // the loading screen is gone: now the player steps into the shared world (other players see them from here on)
    engineRef.current?.startMultiplayer();
  };

  const handleSetOrientation = (mode: OrientationMode) => {
    setPreference(mode);
    setTimeout(() => {
      engineRef.current?.renderer.onResize();
    }, 50);
  };

  const handleSaveNow = () => {
    if (engineRef.current) globalSaveManager.save(engineRef.current.getPlayerData());
  };

  const handleToggleOrientation = () => {
    const nextMode =
      preference === 'auto' ? 'portrait' : preference === 'portrait' ? 'landscape' : 'auto';
    setPreference(nextMode);

    setTimeout(() => {
      engineRef.current?.renderer.onResize();
    }, 50);
  };

  const handleInteract = () => {
    if (gameState?.activePOI) {
      setActivePOIForModal(gameState.activePOI);
    }
  };

  const handleEnterInterior = async () => {
    if (gameState?.activePOI && engineRef.current) {
      const poiId = gameState.activePOI.id;
      setActivePOIForModal(null);
      setSceneFade(true);
      await new Promise((r) => setTimeout(r, 260));
      await engineRef.current.enterLocationInterior(poiId);
      setSceneFade(false);
      const current = engineRef.current.getPlayerData();
      globalSaveManager.save(current);
    }
  };

  const handleExitInterior = async () => {
    if (engineRef.current) {
      setActivePOIForModal(null);
      setSceneFade(true);
      await new Promise((r) => setTimeout(r, 260));
      await engineRef.current.exitLocationInterior();
      setSceneFade(false);
      const current = engineRef.current.getPlayerData();
      globalSaveManager.save(current);
    }
  };

  const handleExecuteLocationAction = (action: LocationAction) => {
    if (engineRef.current) {
      engineRef.current.executeAction(action);
      const current = engineRef.current.getPlayerData();
      globalSaveManager.save(current);
    }
  };

  const handleUseInventoryItem = (item: InventoryItem) => {
    if (engineRef.current) {
      engineRef.current.consumeItem(item);
      const current = engineRef.current.getPlayerData();
      globalSaveManager.save(current);
    }
  };

  const handleUpdateCameraSettings = (settings: { sensitivity: number; invertY: boolean }) => {
    setCameraSettings(settings);
    gameSettings.set(settings);
    if (engineRef.current) {
      engineRef.current.inputManager.setCameraSettings(settings);
    }
  };

  const handleSelectNavTab = (tab: NavTab) => {
    if (tab === 'home') {
      setActiveNavTab('home');
      setActivePOIForModal(null);
      setShowHelpModal(false);
    } else {
      setActiveNavTab(tab);
    }
  };

  const handleStartNewLife = () => {
    setActiveNavTab('home');
    setEntryFresh(true);
    setShowEntry(true);
  };

  // Navigation: minimap + world map read the same live snapshot and set/clear the same waypoint
  const getNav = () => engineRef.current?.getNavSnapshot() ?? null;
  const handleSetWaypoint = (x: number, z: number, name?: string) => engineRef.current?.setWaypointAt(x, z, name);
  const handleSetPoiWaypoint = (poi: POILocation) => engineRef.current?.startWalkRoute(poi);
  const handleClearWaypoint = () => engineRef.current?.cancelWaypoint();

  // phone > Car: spawn the BMW beside the character, or send it away
  const handleToggleCar = async (): Promise<{ ok: boolean; message: string }> => {
    const engine = engineRef.current;
    if (!engine) return { ok: false, message: 'Game is not ready.' };
    if (engine.isCarSpawned()) {
      const result = engine.despawnCar();
      if (result.ok) setCarSpawned(false);
      return result;
    }
    setCarSpawned(true);
    const result = await engine.spawnCar();
    setCarSpawned(engine.isCarSpawned());
    return result;
  };

  const handleSendChat = useCallback((text: string): boolean => engineRef.current?.sendChat(text) ?? false, []);
  const handleChatFocus = useCallback((focused: boolean) => setChatTyping(focused), []);

  // Keyboard shortcuts: 'Enter' chat, 'E' interact, 'F' car
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // while typing in any text box the letters are text, not shortcuts
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable) return;
      if (e.key === 'Enter' && !e.repeat && isEngineReady && !isAnyModalOpen) {
        e.preventDefault();
        chatStore.requestFocus();
        return;
      }
      if (
        e.code === 'KeyE' &&
        gameState?.activePOI &&
        !isAnyModalOpen
      ) {
        setActivePOIForModal(gameState.activePOI);
      }
      // 'F': the car button (walk to the nearest door and get in / get out)
      if (e.code === 'KeyF' && !e.repeat && gameState?.carButton && !isAnyModalOpen) {
        engineRef.current?.pressCarButton();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [gameState?.activePOI, gameState?.carButton, isAnyModalOpen, isEngineReady]);

  return (
    <div
      className={`relative w-screen h-screen overflow-hidden bg-slate-950 font-sans text-slate-100 select-none ${
        effectiveIsPortrait ? 'is-portrait-layout' : 'is-landscape-layout'
      }`}
    >
      {/* 3D WebGL Canvas Viewport */}
      <div
        ref={containerRef}
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing outline-none"
      />

      <FpsCounter />

      {/* Gameplay HUD: minimap, status, objective, utilities + floating joystick / camera / action controls.
          `extras` is the integration point for armour / wanted / weapon / combat buttons (none exist yet). */}
      {isEngineReady && gameState && (
        <GameHUD
          playerData={gameState.playerData}
          stats={gameState.stats}
          currentDate={gameState.currentDate}
          activePOI={gameState.activePOI}
          isInterior={!!gameState.isInterior}
          currentLocationName={gameState.currentLocationDef?.shortName || gameState.currentLocationDef?.name}
          waypoint={waypoint}
          inputManager={engineRef.current ? engineRef.current.inputManager : null}
          controlsActive={!isAnyModalOpen}
          isPortrait={effectiveIsPortrait}
          orientationPreference={preference}
          onToggleOrientation={handleToggleOrientation}
          onOpenTab={handleSelectNavTab}
          onInteract={handleInteract}
          carButton={gameState.carButton ?? null}
          onCar={() => engineRef.current?.pressCarButton()}
          onExitInterior={handleExitInterior}
          onCancelWaypoint={handleClearWaypoint}
          getNav={getNav}
          onSendChat={handleSendChat}
          onChatFocus={handleChatFocus}
        />
      )}

      {/* Short fade for ENTER / EXIT */}
      <div
        className="fixed inset-0 z-30 bg-black pointer-events-none transition-opacity duration-300"
        style={{ opacity: sceneFade ? 1 : 0 }}
      />

      {/* ========================================================================= */}
      {/* SYSTEM MODALS ROUTED BY BOTTOM NAVIGATION                                  */}
      {/* ========================================================================= */}

      {/* 1. Phone Modal */}
      {activeNavTab === 'phone' && gameState && (
        <SmartphoneModal
          playerData={gameState.playerData}
          stats={gameState.stats}
          currentDate={gameState.currentDate}
          cameraSettings={cameraSettings}
          onUpdateCameraSettings={handleUpdateCameraSettings}
          carSpawned={carSpawned}
          onToggleCar={handleToggleCar}
          onClose={() => setActiveNavTab('home')}
        />
      )}

      {/* 2. Map GPS Modal */}
      {activeNavTab === 'map' && gameState && (
        <MapModal
          playerPosition={gameState.playerData.location.position}
          onClose={() => setActiveNavTab('home')}
          getNav={getNav}
          waypoint={waypoint}
          onSetWaypoint={handleSetWaypoint}
          onSetPoiWaypoint={handleSetPoiWaypoint}
          onClearWaypoint={handleClearWaypoint}
        />
      )}

      {/* 3. Inventory Modal */}
      {activeNavTab === 'inventory' && gameState && (
        <InventoryModal
          playerData={gameState.playerData}
          onUseItem={handleUseInventoryItem}
          onClose={() => setActiveNavTab('home')}
        />
      )}

      {/* 4. Character Passport & Profile Modal */}
      {activeNavTab === 'character' && gameState && (
        <CitizenProfileModal
          playerData={gameState.playerData}
          stats={gameState.stats}
          currentDate={gameState.currentDate}
          onNewLife={handleStartNewLife}
          onClose={() => setActiveNavTab('home')}
        />
      )}

      {/* 5. More Menu Modal */}
      {activeNavTab === 'more' && gameState && (
        <MoreMenuModal
          playerData={gameState.playerData}
          cameraSettings={cameraSettings}
          onUpdateCameraSettings={handleUpdateCameraSettings}
          orientationPreference={preference}
          onSetOrientation={handleSetOrientation}
          onSaveNow={handleSaveNow}
          onNewLife={handleStartNewLife}
          onOpenHelp={() => setShowHelpModal(true)}
          onClose={() => setActiveNavTab('home')}
        />
      )}

      {/* Location / Building Action Modal */}
      {activePOIForModal && gameState && (
        <LocationModal
          poi={activePOIForModal}
          playerData={gameState.playerData}
          stats={gameState.stats}
          isInterior={gameState.isInterior}
          onExecuteAction={handleExecuteLocationAction}
          onEnterInterior={handleEnterInterior}
          onExitInterior={handleExitInterior}
          onClose={() => setActivePOIForModal(null)}
        />
      )}

      {/* Entry flow: SIGN IN -> login form -> clothing showroom -> START GAME */}
      {showEntry && (
        <EntryFlow
          onComplete={handleEntryComplete}
          freshStart={entryFresh}
          onCancel={
            entryFresh
              ? () => {
                  setShowEntry(false);
                  setEntryFresh(false);
                }
              : undefined
          }
        />
      )}

      {/* Controls & Simulation Guide Modal */}
      {showHelpModal && <ControlsHelpModal onClose={() => setShowHelpModal(false)} />}
    </div>
  );
}
