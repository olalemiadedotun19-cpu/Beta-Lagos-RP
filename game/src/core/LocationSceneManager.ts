import * as THREE from 'three';
import { WorldRenderer } from '../rendering/WorldRenderer';
import { PlayerController } from '../player/PlayerController';
import { SpatialGrid } from '../world/SpatialGrid';
import { CityGenerator, GeneratedDistrictResult } from '../procedural/CityGenerator';
import { InteriorBuilder, GeneratedInteriorResult } from '../world/InteriorBuilder';
import { LocationDefinition } from '../world/LocationDefinition';
import { getLocationDefinition } from '../data/locationCatalog';
import { DistrictData, WorldCoordinate } from '../types/game';
import { EventBus } from './EventBus';

export type SceneMode = 'exterior' | 'interior';

export interface ActiveSceneInfo {
  mode: SceneMode;
  sceneId: string;
  locationId?: string;
  name: string;
}

/**
 * LocationSceneManager
 * Manages loading, caching, transitioning, and unloading between District Exteriors and Location Interiors.
 */
export class LocationSceneManager {
  private renderer: WorldRenderer;
  private playerController: PlayerController;
  private eventBus: EventBus;

  private currentSceneInfo: ActiveSceneInfo;
  private currentDistrictData: DistrictData;
  private districtResult: GeneratedDistrictResult | null = null;
  private interiorResult: GeneratedInteriorResult | null = null;
  private currentLocationDef: LocationDefinition | null = null;

  // Cache for loaded interior groups to avoid rebuilding
  private interiorCache: Map<string, GeneratedInteriorResult> = new Map();
  // Cache for generated district exteriors (kept off-scene while unloaded)
  private districtCache: Map<string, GeneratedDistrictResult> = new Map();
  private suspended: boolean = false;

  constructor(
    renderer: WorldRenderer,
    playerController: PlayerController,
    initialDistrict: DistrictData,
    eventBus: EventBus
  ) {
    this.renderer = renderer;
    this.playerController = playerController;
    this.currentDistrictData = initialDistrict;
    this.eventBus = eventBus;

    this.currentSceneInfo = {
      mode: 'exterior',
      sceneId: initialDistrict.id,
      name: initialDistrict.name,
    };
  }

  /**
   * Adopts the district the engine generated at start-up so it is tracked (and unloaded) properly.
   */
  public adoptInitialDistrict(result: GeneratedDistrictResult): void {
    this.districtResult = result;
    this.districtCache.set(this.currentDistrictData.id, result);
  }

  public getActiveScene(): ActiveSceneInfo {
    return this.currentSceneInfo;
  }

  public getCurrentLocationDef(): LocationDefinition | null {
    return this.currentLocationDef;
  }

  public isInterior(): boolean {
    return this.currentSceneInfo.mode === 'interior';
  }

  /**
   * Loads the exterior city district
   */
  public async loadDistrictExterior(districtData: DistrictData, spawnOverride?: WorldCoordinate): Promise<void> {
    this.unloadCurrentScene();

    this.currentDistrictData = districtData;
    let cached = this.districtCache.get(districtData.id);
    if (!cached) {
      cached = CityGenerator.generateDistrict(districtData);
      this.districtCache.set(districtData.id, cached);
    }
    this.districtResult = cached;
    this.suspended = false;
    this.renderer.scene.add(this.districtResult.rootGroup);
    this.renderer.registerStreetLights(this.districtResult.streetLights);
    this.renderer.clearNightListeners();
    const furn = this.districtResult.furniture;
    const strm = this.districtResult.streamer;
    this.renderer.registerNightListener((n) => {
      furn?.setNight(n);
      strm?.setNight(n);
    });
    this.playerController.setCollisionGrid(this.districtResult.collisionGrid);

    const spawn = spawnOverride || districtData.spawnPoint;
    strm?.warmup(spawn.x, spawn.z);
    this.playerController.setPosition(spawn.x, spawn.y || 0, spawn.z);

    this.currentLocationDef = null;
    this.currentSceneInfo = {
      mode: 'exterior',
      sceneId: districtData.id,
      name: districtData.name,
    };

    this.eventBus.emit('scene:changed', this.currentSceneInfo);
  }

  /**
   * Loads the dedicated interior scene for a specific location
   */
  public async loadLocationInterior(locationDef: LocationDefinition, spawnPoint?: WorldCoordinate): Promise<void> {
    this.unloadCurrentScene();

    this.currentLocationDef = locationDef;

    let interior = this.interiorCache.get(locationDef.locationId);
    if (!interior) {
      interior = InteriorBuilder.buildInterior(locationDef);
      this.interiorCache.set(locationDef.locationId, interior);
    }
    this.interiorResult = interior;

    this.renderer.scene.add(interior.rootGroup);
    this.playerController.setCollisionGrid(interior.collisionGrid);

    // Set player position to interior entrance spawn
    const spawn = spawnPoint || interior.spawnPoint;
    this.playerController.setPosition(spawn.x, 0, spawn.z);

    this.currentSceneInfo = {
      mode: 'interior',
      sceneId: locationDef.interiorSceneId,
      locationId: locationDef.locationId,
      name: `${locationDef.name} (Interior)`,
    };

    this.eventBus.emit('scene:changed', this.currentSceneInfo);
  }

  /**
   * Exits current interior and returns to the location's exterior entrance
   */
  public async exitToExterior(): Promise<void> {
    if (!this.currentLocationDef) {
      await this.loadDistrictExterior(this.currentDistrictData);
      return;
    }

    const entrance = this.currentLocationDef.arrivalPoints.mainEntrance;
    await this.loadDistrictExterior(this.currentDistrictData, entrance);
  }

  /**
   * Called when a journey leaves the current location: the current exterior/interior is unloaded
   * from the scene (kept in cache) so only the travel corridor is alive while travelling.
   */
  public suspendForTravel(): void {
    this.unloadCurrentScene();
    this.suspended = true;
    this.currentLocationDef = null;
    this.currentSceneInfo = { mode: 'exterior', sceneId: 'in_transit', name: 'In transit' };
    this.eventBus.emit('scene:changed', this.currentSceneInfo);
  }

  public getDistrictResult(): GeneratedDistrictResult | null {
    return this.districtResult;
  }

  public isSuspended(): boolean {
    return this.suspended;
  }

  /**
   * Destination preload: builds the exterior district + the location interior into the caches
   * while the player is still travelling, so arrival and ENTER are instant.
   */
  public preloadLocation(locationId: string): void {
    const def = getLocationDefinition(locationId);
    if (!this.districtCache.has(this.currentDistrictData.id)) {
      this.districtCache.set(
        this.currentDistrictData.id,
        CityGenerator.generateDistrict(this.currentDistrictData)
      );
    }
    if (def && def.interiorAvailable && !this.interiorCache.has(def.locationId)) {
      this.interiorCache.set(def.locationId, InteriorBuilder.buildInterior(def));
    }
  }

  /**
   * Position the player at the entrance spawn of the interior currently loaded
   * (used by departure animations to walk towards the way out).
   */
  public getInteriorExitTarget(): WorldCoordinate | null {
    if (this.interiorResult) return this.interiorResult.spawnPoint;
    return null;
  }

  /**
   * Unloads any active scene meshes, lights, and clears memory
   */
  private unloadCurrentScene(): void {
    if (this.districtResult) {
      this.renderer.scene.remove(this.districtResult.rootGroup);
      this.districtResult = null;
    }

    if (this.interiorResult) {
      this.renderer.scene.remove(this.interiorResult.rootGroup);
      this.interiorResult.accentLights.forEach((l) => this.renderer.scene.remove(l));
      this.interiorResult = null;
    }
  }

  public getCollisionGrid(): SpatialGrid | null {
    if (this.currentSceneInfo.mode === 'interior' && this.interiorResult) {
      return this.interiorResult.collisionGrid;
    }
    if (this.districtResult) {
      return this.districtResult.collisionGrid;
    }
    return null;
  }
}
