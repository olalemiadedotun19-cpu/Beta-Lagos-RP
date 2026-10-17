import { groundHeightAt, waterSurfaceAt } from '../world/CurvedRoads';
import * as THREE from 'three';
import { WorldRenderer } from '../rendering/WorldRenderer';
import { graphics, loadRadiusFor } from '../graphics/GraphicsSettings';
import { TimeSystem, SimulationSpeed } from './TimeSystem';
import { InputManager } from './InputManager';
import { EventBus } from './EventBus';
import { NeedsSystem } from '../systems/NeedsSystem';
import { InteractionSystem } from '../systems/InteractionSystem';
import { CityGenerator, GeneratedDistrictResult } from '../procedural/CityGenerator';
import { FigureCharacter } from '../player/figure/FigureCharacter';
import { takePreloadedCharacter } from '../player/figure/CharacterPreload';
import { PlayerCar } from '../vehicles/PlayerCar';
import { CarRider, type CarButton } from '../vehicles/CarRider';
import { driveTelemetry } from '../vehicles/DriveTelemetry';
import { RouteArrows } from '../navigation/RouteArrows';
import { ALWAYS_SPAWN_AT_BARRACKS, BARRACKS_SPAWN, BARRACKS_SPAWN_YAW } from '../world/barracks/BarracksLayout';
import { PlayerController } from '../player/PlayerController';
import { LocationSceneManager } from './LocationSceneManager';
import { LocationDefinition } from '../world/LocationDefinition';
import { getLocationDefinition } from '../data/locationCatalog';
import { getDistrictData } from '../data/worldData';
import {
  DistrictData,
  GameDate,
  InventoryItem,
  LocationAction,
  POILocation,
  PlayerData,
  PlayerStats,
  WorldCoordinate,
} from '../types/game';
import { globalSaveManager } from '../save/SaveManager';
import { timeService } from '../services/TimeService';
import { NavSnapshot, Route, computeRoute, nextRoutePoint, getMapData } from '../navigation/NavMap';
import { bankService } from '../services/BankService';
import { notificationService } from '../services/NotificationService';
import { MultiplayerSession, type NetSource } from '../net/MultiplayerSession';
import { currentCloudAccount } from '../net/cloudAuth';
import { chatStore } from '../net/chatStore';
import { LocalChatBubble } from '../net/ChatBubble';
import { CHAT_MIN_GAP, cleanChatText, type NetState } from '../net/protocol';

export interface GameEngineState {
  playerData: PlayerData;
  stats: PlayerStats;
  currentDate: GameDate;
  simSpeed: SimulationSpeed;
  activePOI: POILocation | null;
  isInterior?: boolean;
  currentLocationDef?: LocationDefinition | null;
  /** which car button the HUD shows: the door when the car is close, the open door while sitting in it, nothing otherwise */
  carButton?: CarButton;
}

export interface WaypointState {
  poiId: string;
  name: string;
  /** Metres to walk along the computed route (real roads + any short off-road legs) */
  distanceMeters: number;
  /** Straight-line metres, for reference only (it is NOT the route) */
  directMeters: number;
  /** Road the route follows first; null for a short direct walk */
  viaRoad: string | null;
  /** Angle (radians) of the NEXT route point relative to where the camera is looking: 0 = straight ahead */
  relativeAngle: number;
  /** True once the player is next to the target */
  arrived: boolean;
  /** True for a building entrance (ENTER becomes available), false for a dropped pin / landmark */
  enterable: boolean;
}

export class GameEngine {
  public eventBus: EventBus;
  public timeSystem: TimeSystem;
  public needsSystem: NeedsSystem;
  public interactionSystem: InteractionSystem;
  public inputManager: InputManager;
  public renderer: WorldRenderer;
  public sceneManager: LocationSceneManager;

  private characterModel: FigureCharacter;
  private spawnHint: { x: number; y: number; z: number } | null = null;
  public playerController: PlayerController;
  private playerCar: PlayerCar;
  private carRider: CarRider;
  private lastCarButton: CarButton = null;
  private currentDistrictData: DistrictData;
  private districtResult: GeneratedDistrictResult | null = null;

  private playerData: PlayerData;
  /** the shared world: other players, their cars (null while playing offline) */
  private net: MultiplayerSession | null = null;
  /** what the local player says, above their own head (other players' bubbles are drawn by net/RemoteAvatar) */
  private localBubble: LocalChatBubble;
  private lastChatAt = 0;
  private isRunning: boolean = false;
  private animationFrameId: number | null = null;
  private lastTime: number = 0;

  private onStateChangeCallback: ((state: GameEngineState) => void) | null = null;

  // GPS walking route
  private onWaypointCallback: ((wp: WaypointState | null) => void) | null = null;
  private waypoint: { id: string; name: string; entrance: WorldCoordinate; enterable: boolean } | null = null;
  private waypointBeacon: THREE.Group | null = null;
  /** gold arrows on the road toward the waypoint, shown only while driving */
  private routeArrows: RouteArrows;
  private waypointTimer: number = 0;
  // Shared by the minimap and the world map (see navigation/NavMap.ts)
  private navRoute: Route | null = null;
  private navSnap: NavSnapshot = { x: 0, z: 0, face: 0, view: 0, interior: false, speed: 0, target: null, targetName: '', route: null };
  private navT = 0;
  private navPx = 0;
  private navPz = 0;
  private navDir = new THREE.Vector3();

  constructor(container: HTMLElement, initialPlayerData: PlayerData) {
    if (!initialPlayerData.appearance.gender) {
      initialPlayerData.appearance.gender = initialPlayerData.identity.sex === 'female' ? 'female' : 'male';
    }
    this.playerData = initialPlayerData;
    this.eventBus = new EventBus();

    // 1. Core Systems
    this.timeSystem = new TimeSystem(this.eventBus, {
      year: 2027,
      month: 1,
      day: 15,
      hour: 9,
      minute: 0,
    });

    this.needsSystem = new NeedsSystem(this.eventBus, initialPlayerData.stats);
    this.interactionSystem = new InteractionSystem(this.eventBus);
    this.inputManager = new InputManager(container);

    // Initialize authoritative time service with offline progression
    const catchup = timeService.initializeFromPersistence(
      initialPlayerData.lastSavedAt,
      this.timeSystem.getDate()
    );
    if (catchup.elapsedMinutes > 0) {
      this.timeSystem.advanceMinutes(catchup.elapsedMinutes);
      const decayHunger = Math.min(30, Math.round(catchup.elapsedMinutes * 0.05));
      const decayEnergy = Math.min(25, Math.round(catchup.elapsedMinutes * 0.04));
      this.needsSystem.applyDelta({ hunger: -decayHunger, energy: -decayEnergy });
    }

    // 2. 3D World Renderer
    this.renderer = new WorldRenderer(container);
    this.localBubble = new LocalChatBubble(this.renderer.scene);

    // 3. World Generation from Data
    this.currentDistrictData = getDistrictData(
      initialPlayerData.location.continentId,
      initialPlayerData.location.countryId,
      initialPlayerData.location.stateId,
      initialPlayerData.location.cityId,
      initialPlayerData.location.districtId
    );
    // where the player starts (decided first, so the streets around it - not the old city centre - are built at start-up):
    // a returning citizen who chose "Where you left off" resumes at their last position, everybody else starts as before
    const resume = this.resumePoint(initialPlayerData);
    const spawnPos = resume
      ? resume.position
      : ALWAYS_SPAWN_AT_BARRACKS
        ? { ...BARRACKS_SPAWN }
        : initialPlayerData.location.position || this.currentDistrictData.spawnPoint;
    this.spawnHint = spawnPos;
    this.loadDistrict(this.currentDistrictData);

    // 4. Player Character & Controller
    // normally already built on the loading screen
    this.characterModel = takePreloadedCharacter() ?? new FigureCharacter(initialPlayerData.appearance);
    this.characterModel.setCastShadow(false); // the showroom may have turned shadows on
    this.characterModel.setOutfit(initialPlayerData.outfit); // the clothes picked in the showroom
    this.renderer.scene.add(this.characterModel.group);

    this.playerController = new PlayerController(
      this.characterModel,
      this.renderer.camera,
      this.inputManager,
      this.districtResult!.collisionGrid,
      spawnPos
    );
    if (resume) this.playerController.setFacing(resume.cameraYaw);
    else if (ALWAYS_SPAWN_AT_BARRACKS) this.playerController.setFacing(BARRACKS_SPAWN_YAW);
    this.playerCar = new PlayerCar(this.renderer.scene, this.renderer.renderer, this.playerController);
    this.routeArrows = new RouteArrows(this.renderer.scene);
    this.carRider = new CarRider(this.playerController, this.playerCar, (message) =>
      notificationService.post({ title: 'Car', body: message, type: 'system' })
    );
    // other players' cars (only there while the multiplayer session runs): the car button can also get the character into one of those
    const now = (): number => performance.now() / 1000;
    this.carRider.shared = {
      nearest: (x, z, max) => this.net?.cars.nearestCar(x, z, max, now()) ?? null,
      view: (uid) => this.net?.cars.carView(uid, now()) ?? null,
      seatTaken: (uid, side) => this.net?.cars.seatTaken(uid, side) ?? false,
      setDoor: (uid, side, open) => this.net?.cars.setCarDoor(uid, side, open),
      ownUid: () => currentCloudAccount()?.uid ?? null,
    };

    // 5. Location Scene Manager (handles Exterior and Interior Scenes)
    this.sceneManager = new LocationSceneManager(
      this.renderer,
      this.playerController,
      this.currentDistrictData,
      this.eventBus
    );

    this.sceneManager.adoptInitialDistrict(this.districtResult!);

    // 6. Connect System Events
    this.setupEventListeners();
  }

  public setOnStateChange(cb: (state: GameEngineState) => void): void {
    this.onStateChangeCallback = cb;
  }

  private notifyState(): void {
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback({
        playerData: this.getPlayerData(),
        stats: this.needsSystem.getStats(),
        currentDate: this.timeSystem.getDate(),
        simSpeed: this.timeSystem.getSpeed(),
        activePOI: this.interactionSystem.getActivePOI(),
        isInterior: this.sceneManager ? this.sceneManager.isInterior() : false,
        currentLocationDef: this.sceneManager ? this.sceneManager.getCurrentLocationDef() : null,
        carButton: this.carRider ? this.carRider.button : null,
      });
    }
  }

  private setupEventListeners(): void {
    this.eventBus.on('interaction:proximity_changed', () => {
      this.notifyState();
    });

    this.eventBus.on('time:changed', () => {
      this.renderer.updateDayNightCycle(this.timeSystem);
      this.notifyState();
    });

    this.eventBus.on('player:stats_updated', () => {
      this.notifyState();
    });

    this.eventBus.on('scene:changed', () => {
      this.notifyState();
    });
  }

  public loadDistrict(districtData: DistrictData): void {
    // Remove old district if present
    if (this.districtResult) {
      this.renderer.scene.remove(this.districtResult.rootGroup);
    }

    this.currentDistrictData = districtData;
    this.districtResult = CityGenerator.generateDistrict(districtData);
    this.renderer.scene.add(this.districtResult.rootGroup);
    this.renderer.registerStreetLights(this.districtResult.streetLights);
    this.renderer.clearNightListeners();
    const furn = this.districtResult.furniture;
    const strm = this.districtResult.streamer;
    this.renderer.registerNightListener((n) => {
      furn?.setNight(n);
      strm?.setNight(n);
    });
    strm?.warmup(this.playerController?.position?.x ?? this.spawnHint?.x ?? 0, this.playerController?.position?.z ?? this.spawnHint?.z ?? 14);

    // Load POIs into InteractionSystem
    this.interactionSystem.loadPOIs(districtData.pois);

    // Update collision grid if player exists
    if (this.playerController) {
      this.playerController.setCollisionGrid(this.districtResult.collisionGrid);
    }
  }

  /** Streets still waiting to be built around the player (0 = the map around the player is complete). */
  public getPendingWorldJobs(): number {
    return this.sceneManager?.getDistrictResult()?.streamer?.getPendingJobs() ?? 0;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /** One simulation tick (everything except rendering). */
  private step(deltaSeconds: number): void {
    // 1. Update Game Time & Authoritative World Clock
    this.timeSystem.update(deltaSeconds);
    timeService.update(deltaSeconds);

    // 2. Car: walking to its door / getting in and out / sitting in it (drives the character while it runs), then the controller
    this.carRider.update(deltaSeconds);
    this.playerCar.update(deltaSeconds);
    if (this.carRider.button !== this.lastCarButton) {
      this.lastCarButton = this.carRider.button;
      this.notifyState();
    }

    // 2b. Update Player Controller & Locomotion
    const moveInfo = this.playerController.update(deltaSeconds);

    // 3. Update Needs Exertion
    this.needsSystem.update(deltaSeconds, moveInfo.isSprinting, moveInfo.isMoving);

    // 4. Update Interaction Proximity
    this.interactionSystem.updatePlayerPosition(
      this.playerController.position.x,
      this.playerController.position.z
    );

    const dr = this.sceneManager.getDistrictResult();
    dr?.furniture?.update(this.playerController.position.x, this.playerController.position.z);
    dr?.streamer?.update(this.playerController.position.x, this.playerController.position.z, deltaSeconds, 5, loadRadiusFor(graphics.get().drawDistance), this.renderer.camera);

    // 4b. GPS walking route
    this.updateWaypoint(deltaSeconds);
    {
      const pp = this.playerController.position;
      const show = driveTelemetry.active && this.waypoint !== null && !this.sceneManager.isInterior();
      this.routeArrows.update(deltaSeconds, show, this.waypoint ? this.navRoute : null, pp.x, pp.z, pp.y);
    }

    // 4c. the player's car stays outside: hidden while the character is in a building
    this.playerCar.setVisible(!this.sceneManager.isInterior());

    // 5. other players: send where we are, move everyone else
    this.net?.update(deltaSeconds);
    const bp = this.playerController.position;
    this.localBubble.update(deltaSeconds, bp.x, bp.y, bp.z);
  }

  /**
   * Debug/testing helper: advances the simulation without rendering (used by automated visual tests).
   */
  public debugAdvance(seconds: number, stepSeconds: number = 1 / 30): void {
    let t = 0;
    while (t < seconds) {
      this.step(stepSeconds);
      t += stepSeconds;
    }
    this.renderer.render();
  }

  public debugSetTime(hour: number, minute: number = 0): void {
    const d = this.timeSystem.getDate();
    this.timeSystem.setDate({ ...d, hour, minute });
    this.renderer.updateDayNightCycle(this.timeSystem);
  }

  public debugTeleport(x: number, z: number): void {
    this.playerController.setPosition(x, 0, z);
  }

  /** the last few frame times (s) */
  private recentDeltas: number[] = [];

  /**
   * Browsers hand out frame timestamps that wobble by a millisecond or two even at a steady 60 fps. The world moves by speed x frame
   * time, so a fast car moves by a slightly different amount each frame and judders. While the last frames are steady the average
   * is used instead (same speed over time, even steps); a real hitch or a change of frame rate passes straight through.
   */
  private smoothDelta(raw: number): number {
    const h = this.recentDeltas;
    h.push(raw);
    if (h.length > 6) h.shift();
    if (h.length < 4) return raw;
    let sum = 0;
    for (const d of h) sum += d;
    const mean = sum / h.length;
    for (const d of h) if (Math.abs(d - mean) > mean * 0.3) return raw;
    return mean;
  }

  private loop = (currentTime: number): void => {
    if (!this.isRunning) return;

    // frame-rate cap (ignored while the device test runs): skip this frame, the time keeps accumulating in lastTime
    const cap = graphics.get().fps;
    if (cap > 0 && !graphics.measuring && currentTime - this.lastTime < 1000 / cap - 2) {
      this.animationFrameId = requestAnimationFrame(this.loop);
      return;
    }

    const deltaMs = currentTime - this.lastTime;
    this.lastTime = currentTime;
    // Clamp delta time to avoid large jumps when tab is in background
    const deltaSeconds = this.smoothDelta(Math.min(0.1, deltaMs / 1000));

    this.step(deltaSeconds);

    // 5. Render 3D Scene
    this.renderer.render();

    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  /**
   * Performs a life action (eating, sleeping, working, etc.)
   */
  public executeAction(action: LocationAction): void {
    // 1. Advance simulation time
    if (action.durationMinutes > 0) {
      this.timeSystem.advanceMinutes(action.durationMinutes);
    }

    // 2. Apply stat effects
    this.needsSystem.applyDelta({
      energy: action.effects.energy,
      hunger: action.effects.hunger,
      health: action.effects.health,
      happiness: action.effects.happiness,
      hygiene: action.effects.hygiene,
      stress: action.effects.stress,
    });

    // 3. Financial effects
    if (action.effects.cash) {
      this.playerData.finances.cash += action.effects.cash;
    }
    if (action.cost) {
      this.playerData.finances.cash -= action.cost;
      bankService.recordTransaction({
        type: 'debit',
        title: action.label,
        category: 'retail',
        amount: action.cost,
      });
    }
    if (action.earnings) {
      this.playerData.finances.cash += action.earnings;
      bankService.recordTransaction({
        type: 'credit',
        title: action.label,
        category: 'salary',
        amount: action.earnings,
      });
      notificationService.post({
        title: 'Salary Credited',
        body: `₦${action.earnings.toLocaleString()} received for ${action.label}.`,
        type: 'work',
      });
    }

    // 4. Reward Item to Inventory
    if (action.rewardItem) {
      const existing = this.playerData.inventory.find((i) => i.id === action.rewardItem!.id);
      if (existing) {
        existing.quantity += action.rewardItem.quantity;
      } else {
        this.playerData.inventory.push({ ...action.rewardItem });
      }
    }

    this.notifyState();
  }

  /**
   * Consumes an inventory item, applying its vital benefits and updating quantity
   */
  public consumeItem(item: InventoryItem): void {
    const index = this.playerData.inventory.findIndex((i) => i.id === item.id);
    if (index === -1) return;

    const invItem = this.playerData.inventory[index];
    if (invItem.quantity > 1) {
      invItem.quantity -= 1;
    } else {
      this.playerData.inventory.splice(index, 1);
    }

    if (item.effects) {
      this.needsSystem.applyDelta({
        hunger: item.effects.hunger,
        energy: item.effects.energy,
        health: item.effects.health,
        happiness: item.effects.happiness,
        stress: item.effects.stress,
      });
    }

    this.notifyState();
  }

  public getPlayerData(): PlayerData {
    // inside a building the position is a room coordinate, not a place in the world: the last location is then the door
    const door = this.sceneManager?.isInterior() ? this.sceneManager.getCurrentLocationDef()?.arrivalPoints.mainEntrance : undefined;
    const p = this.playerController.position;
    return {
      ...this.playerData,
      hasPlayed: true,
      stats: this.needsSystem.getStats(),
      location: {
        ...this.playerData.location,
        position: door ? { x: door.x, y: door.y ?? 0, z: door.z } : { x: p.x, y: p.y, z: p.z },
        rotationY: this.characterModel.group.rotation.y,
      },
    };
  }

  /**
   * Where a returning citizen resumes: their saved position, when they picked "Where you left off", it is a real place inside the map
   * and not deep water. Null = start at the usual spawn.
   */
  private resumePoint(data: PlayerData): { position: WorldCoordinate; cameraYaw: number } | null {
    if (data.spawnPoint !== 'last' || !data.hasPlayed) return null;
    const p = data.location?.position;
    if (!p || ![p.x, p.y, p.z].every((v) => Number.isFinite(v))) return null;
    const b = this.currentDistrictData.worldBounds;
    if (p.x < b.minX + 2 || p.x > b.maxX - 2 || p.z < b.minZ + 2 || p.z > b.maxZ - 2) return null;
    const y = groundHeightAt(p.x, p.z, p.y + 0.6);
    if (waterSurfaceAt(p.x, p.z) - y > 1.1) return null;
    const yaw = Number.isFinite(data.location.rotationY) ? data.location.rotationY : 0;
    return { position: { x: p.x, y, z: p.z }, cameraYaw: yaw - Math.PI };
  }

  // ===========================================================================================
  // MULTIPLAYER
  // ===========================================================================================

  /**
   * Joins the shared world as the signed-in cloud account: other players appear, with their clothes and cars, and see this player.
   * Returns false (and does nothing) when playing offline, i.e. Firebase is not set up or nobody is signed in.
   */
  public startMultiplayer(): boolean {
    if (this.net) return true;
    const account = currentCloudAccount();
    if (!account?.uid) return false;
    const source: NetSource = {
      scene: this.renderer.scene,
      gl: this.renderer.renderer,
      readLocal: () => this.readNetState(),
      localCar: () => this.playerCar.getPose(),
      localPosition: () => {
        const p = this.playerController.position;
        return { x: p.x, z: p.z, inside: this.sceneManager.isInterior() };
      },
    };
    const session = new MultiplayerSession(
      { uid: account.uid, username: account.username, name: account.name, outfit: this.characterModel.getOutfit() },
      source
    );
    session.start();
    this.net = session;
    return true;
  }

  /**
   * The player says something. It shows at once in their own chat list and above their head; when they are in the shared world it is
   * also sent, and only players within hearing distance (net/protocol.ts CHAT_RADIUS) get it. Returns false when nothing was said
   * (empty, or sent too soon after the last one: the text then stays in the box).
   */
  public sendChat(raw: string): boolean {
    const text = cleanChatText(raw);
    if (!text) return false;
    const now = performance.now();
    if (now - this.lastChatAt < CHAT_MIN_GAP * 1000) return false;
    this.lastChatAt = now;
    const id = this.playerData.identity;
    const name = currentCloudAccount()?.name || [id.firstName, id.lastName].filter(Boolean).join(' ') || 'You';
    chatStore.add({ uid: currentCloudAccount()?.uid ?? '', name, text, mine: true });
    this.localBubble.say(text);
    this.net?.sendChat(text);
    return true;
  }

  public stopMultiplayer(): void {
    this.net?.stop();
    this.net = null;
  }

  /** how many other players are in the world right now */
  public getOnlineCount(): number {
    return this.net?.onlineCount ?? 0;
  }

  /** the local player as the network sends it (see net/protocol.ts) */
  private readNetState(): Omit<NetState, 't'> {
    const inside = this.sceneManager.isInterior();
    const door = inside ? this.sceneManager.getCurrentLocationDef()?.arrivalPoints.mainEntrance : undefined;
    const p = this.playerController.position;
    const clip = this.carRider.netClip;
    const state: Omit<NetState, 't'> = {
      x: door ? door.x : p.x,
      y: door ? (door.y ?? 0) : p.y,
      z: door ? door.z : p.z,
      r: this.characterModel.group.rotation.y,
      g: this.playerController.grounded ? 1 : 0,
      i: inside ? 1 : 0,
      k: clip.k,
      kt: clip.k === 2 ? 0 : clip.t,
      km: clip.mirrored ? 1 : 0,
    };
    if (clip.host) state.h = clip.host; // riding in another player's car
    state.hp = Math.max(0, Math.min(100, Math.round(this.needsSystem.getStats().health))); // shown as a bar under the name
    const car = this.playerCar.getNetState();
    if (car) state.c = car;
    return state;
  }

  public setPlayerData(data: PlayerData): void {
    this.playerData = { ...data };
    this.characterModel.applyAppearance(data.appearance);
    this.characterModel.setOutfit(data.outfit);
    this.needsSystem.setStats(data.stats);
    this.playerController.setPosition(
      data.location.position.x,
      data.location.position.y,
      data.location.position.z
    );
    this.notifyState();
  }

  public async quickSave(): Promise<boolean> {
    const currentData = this.getPlayerData();
    return globalSaveManager.save(currentData);
  }

  public async enterLocationInterior(poiId: string): Promise<boolean> {
    if (this.carRider.active) {
      notificationService.post({ title: 'Car', body: 'Get out of the car first.', type: 'system' });
      return false;
    }
    const locDef = getLocationDefinition(poiId);
    if (!locDef || !locDef.interiorAvailable) return false;

    await this.sceneManager.loadLocationInterior(locDef);
    this.interactionSystem.loadPOIs([]); // Interior interactions handled contextually
    this.notifyState();
    return true;
  }

  public async exitLocationInterior(): Promise<void> {
    await this.sceneManager.exitToExterior();
    this.interactionSystem.loadPOIs(this.currentDistrictData.pois);
    this.notifyState();
  }

  public async travelToLocation(
    destination: POILocation,
    arrivalPoint: WorldCoordinate,
    asInterior: boolean = false
  ): Promise<void> {
    this.carRider.abort();
    if (asInterior) {
      const locDef = getLocationDefinition(destination.id);
      if (locDef && locDef.interiorAvailable) {
        await this.sceneManager.loadLocationInterior(locDef);
        this.interactionSystem.loadPOIs([]);
        this.notifyState();
        return;
      }
    }

    // Default: Spawn at specified exterior entrance / drop-off point
    if (this.sceneManager.isInterior()) {
      await this.sceneManager.loadDistrictExterior(this.currentDistrictData, arrivalPoint);
      this.interactionSystem.loadPOIs(this.currentDistrictData.pois);
    } else {
      this.playerController.setPosition(arrivalPoint.x, arrivalPoint.y || 0, arrivalPoint.z);
    }
    this.notifyState();
  }

  /** Is the player's BMW out (or on its way: it is built the first time)? */
  public isCarSpawned(): boolean {
    return this.playerCar.isSpawned;
  }

  /** Calls the BMW: it appears on the character's right-hand side. */
  public async spawnCar(): Promise<{ ok: boolean; message: string }> {
    if (this.sceneManager.isInterior()) return { ok: false, message: "You can't call your car while you are inside." };
    try {
      await this.playerCar.spawn();
      return { ok: true, message: 'Your BMW i8 is next to you.' };
    } catch (e) {
      console.error('Could not load the BMW', e);
      return { ok: false, message: 'Could not load the car. Try again.' };
    }
  }

  /** Sends the BMW away (not while the character is in it or on the way to it). */
  public despawnCar(): { ok: boolean; message: string } {
    if (this.carRider.active) return { ok: false, message: 'Get out of the car first.' };
    this.playerCar.despawn();
    return { ok: true, message: '' };
  }

  /** The car button of the HUD was pressed: walk to the nearest door and get in, or get out. */
  public pressCarButton(): { ok: boolean; message?: string } {
    const result = this.carRider.press();
    if (!result.ok && result.message) notificationService.post({ title: 'Car', body: result.message, type: 'system' });
    return result;
  }

  public setOnWaypointChange(cb: (wp: WaypointState | null) => void): void {
    this.onWaypointCallback = cb;
  }

  // ===========================================================================================
  // WALK - GPS route: you walk there yourself in normal gameplay
  // ===========================================================================================

  public startWalkRoute(poi: POILocation): void {
    const def = getLocationDefinition(poi.id);
    const entrance = def?.arrivalPoints.mainEntrance ?? poi.position;
    this.setNavTarget(poi.id, poi.name, entrance, true);
  }

  /** Drop a waypoint at any world position (map tap / landmark). It is routed over the real road grid. */
  public setWaypointAt(x: number, z: number, name = 'Waypoint', enterable = false): void {
    const half = getMapData().half;
    const cx = Math.max(-half, Math.min(half, x));
    const cz = Math.max(-half, Math.min(half, z));
    this.setNavTarget(`waypoint_${Math.round(cx)}_${Math.round(cz)}`, name, { x: cx, y: 0, z: cz }, enterable);
  }

  private setNavTarget(id: string, name: string, entrance: WorldCoordinate, enterable: boolean): void {
    this.cancelWaypoint();
    this.waypoint = { id, name, entrance, enterable };
    this.waypointTimer = 1;

    const beacon = new THREE.Group();
    const ringGeo = new THREE.TorusGeometry(1.2, 0.08, 8, 28);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xd946ef });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.12;
    beacon.add(ring);
    const beamGeo = new THREE.CylinderGeometry(0.5, 0.5, 14, 14, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xd946ef,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 7;
    beacon.add(beam);
    beacon.position.set(entrance.x, groundHeightAt(entrance.x, entrance.z), entrance.z);
    beacon.userData.dispose = () => {
      ringGeo.dispose();
      ringMat.dispose();
      beamGeo.dispose();
      beamMat.dispose();
    };
    this.renderer.scene.add(beacon);
    this.waypointBeacon = beacon;
    this.emitWaypoint();
  }

  public cancelWaypoint(): void {
    if (this.waypointBeacon) {
      this.renderer.scene.remove(this.waypointBeacon);
      this.waypointBeacon.userData.dispose?.();
      this.waypointBeacon = null;
    }
    const had = this.waypoint !== null;
    this.waypoint = null;
    this.navRoute = null;
    if (had) this.onWaypointCallback?.(null);
  }

  public hasWaypoint(): boolean {
    return this.waypoint !== null;
  }

  private emitWaypoint(): void {
    if (!this.waypoint) return;
    const { id, name, entrance, enterable } = this.waypoint;
    const p = this.playerController.position;
    const direct = Math.hypot(entrance.x - p.x, entrance.z - p.z);

    // Route over the real road grid. Skipped indoors: interior coordinates are not world coordinates.
    if (!this.sceneManager.isInterior() || !this.navRoute) {
      this.navRoute = computeRoute({ x: p.x, z: p.z }, { x: entrance.x, z: entrance.z });
    }
    const route = this.navRoute;

    // The arrow aims at the next point of the route (not straight at the target) relative to the camera
    const aim = nextRoutePoint(route, { x: p.x, z: p.z });
    this.renderer.camera.getWorldDirection(this.navDir);
    const camAngle = Math.atan2(this.navDir.x, this.navDir.z);
    let rel = Math.atan2(aim.x - p.x, aim.z - p.z) - camAngle;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;

    this.onWaypointCallback?.({
      poiId: id,
      name,
      distanceMeters: Math.round(route.length),
      directMeters: Math.round(direct),
      viaRoad: route.roadName,
      relativeAngle: rel,
      arrived: direct < 3.2,
      enterable,
    });
  }

  /** Live state for the minimap and the world map: read-only, allocation-free, safe to call every frame. */
  public getNavSnapshot(): NavSnapshot {
    const s = this.navSnap;
    const p = this.playerController.position;
    // ground speed from real displacement. Several readers (minimap, world map) call this every frame, so the
    // sample is only refreshed once >= 50 ms have passed; jumps (travel, teleport, interior swap) read as 0.
    const now = performance.now();
    const dt = (now - this.navT) / 1000;
    if (dt >= 0.05) {
      const dist = Math.hypot(p.x - this.navPx, p.z - this.navPz);
      s.speed = this.navT > 0 && dt < 0.5 && dist < 60 * dt + 2 ? dist / dt : 0;
      this.navT = now;
      this.navPx = p.x;
      this.navPz = p.z;
    }
    s.x = p.x;
    s.z = p.z;
    s.face = this.characterModel.group.rotation.y;
    this.renderer.camera.getWorldDirection(this.navDir);
    s.view = Math.atan2(this.navDir.x, this.navDir.z);
    s.interior = this.sceneManager.isInterior();
    s.target = this.waypoint ? this.waypoint.entrance : null;
    s.targetName = this.waypoint ? this.waypoint.name : '';
    s.route = this.waypoint ? this.navRoute : null;
    return s;
  }

  private updateWaypoint(deltaSeconds: number): void {
    if (!this.waypoint) return;
    if (this.waypointBeacon) {
      this.waypointBeacon.visible = !this.sceneManager.isInterior();
      const pulse = 1 + Math.sin(performance.now() / 300) * 0.12;
      this.waypointBeacon.children[0].scale.set(pulse, pulse, pulse);
    }
    this.waypointTimer += deltaSeconds;
    if (this.waypointTimer < 0.2) return;
    this.waypointTimer = 0;
    this.emitWaypoint();

    if (!this.sceneManager.isInterior()) {
      const p = this.playerController.position;
      const e = this.waypoint.entrance;
      if (Math.hypot(e.x - p.x, e.z - p.z) < 3.2) {
        const { name, enterable } = this.waypoint;
        this.cancelWaypoint();
        notificationService.post({
          title: 'You have arrived',
          body: enterable ? `You reached ${name}. Tap ENTER to go inside.` : `You reached ${name}.`,
          type: 'system',
        });
      }
    }
  }

  public dispose(): void {
    this.stop();
    this.stopMultiplayer();
    this.localBubble.dispose();
    chatStore.clear();
    this.cancelWaypoint();
    this.routeArrows.dispose();
    this.inputManager.destroy();
    this.carRider.dispose();
    this.playerCar.dispose();
    this.characterModel.dispose();
    this.renderer.dispose();
    this.eventBus.clear();
  }
}
