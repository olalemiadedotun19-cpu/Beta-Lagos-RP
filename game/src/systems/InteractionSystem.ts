import { EventBus } from '../core/EventBus';
import { POILocation } from '../types/game';
import { distanceSq2D } from '../utils/math';

export class InteractionSystem {
  private pois: Map<string, POILocation> = new Map();
  private eventBus: EventBus;
  private currentActivePOI: POILocation | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  loadPOIs(pois: POILocation[]): void {
    this.pois.clear();
    pois.forEach((p) => this.pois.set(p.id, p));
  }

  registerPOI(poi: POILocation): void {
    this.pois.set(poi.id, poi);
  }

  getActivePOI(): POILocation | null {
    return this.currentActivePOI;
  }

  updatePlayerPosition(playerX: number, playerZ: number): void {
    let nearestPOI: POILocation | null = null;
    let shortestDistSq = Infinity;

    for (const poi of this.pois.values()) {
      const distSq = distanceSq2D(playerX, playerZ, poi.position.x, poi.position.z);
      const radSq = poi.interactionRadius * poi.interactionRadius;

      if (distSq <= radSq && distSq < shortestDistSq) {
        shortestDistSq = distSq;
        nearestPOI = poi;
      }
    }

    if (nearestPOI?.id !== this.currentActivePOI?.id) {
      this.currentActivePOI = nearestPOI;
      this.eventBus.emit('interaction:proximity_changed', this.currentActivePOI);
    }
  }

  triggerInteraction(): boolean {
    if (!this.currentActivePOI) return false;
    this.eventBus.emit('interaction:open_menu', this.currentActivePOI);
    return true;
  }
}
