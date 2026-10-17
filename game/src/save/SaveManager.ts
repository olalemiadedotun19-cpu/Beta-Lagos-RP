import { PlayerData, SaveMetadata } from '../types/game';
import { calculateAge } from '../utils/math';

export interface SaveProvider {
  listSaves(): Promise<SaveMetadata[]>;
  saveGame(slotId: string, data: PlayerData): Promise<boolean>;
  loadGame(slotId: string): Promise<PlayerData | null>;
  deleteSave(slotId: string): Promise<boolean>;
  getLatestSave(): Promise<{ slotId: string; data: PlayerData } | null>;
  /** writes anything still waiting to be sent (cloud saves are batched); optional */
  flush?(): Promise<void>;
  /** called when the provider is replaced (stop timers / listeners); optional */
  dispose?(): void;
}

const STORAGE_PREFIX = 'intl_life_save_';
const METADATA_KEY = 'intl_life_saves_meta';

export class LocalStorageSaveProvider implements SaveProvider {
  async listSaves(): Promise<SaveMetadata[]> {
    try {
      const raw = localStorage.getItem(METADATA_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as SaveMetadata[];
    } catch (e) {
      console.error('Failed to parse saves metadata:', e);
      return [];
    }
  }

  async saveGame(slotId: string, data: PlayerData): Promise<boolean> {
    try {
      const updatedData: PlayerData = {
        ...data,
        lastSavedAt: Date.now(),
      };

      const key = `${STORAGE_PREFIX}${slotId}`;
      localStorage.setItem(key, JSON.stringify(updatedData));

      // Update metadata list
      const list = await this.listSaves();
      const filtered = list.filter((s) => s.id !== slotId);

      const fullName = `${data.identity.firstName || ''} ${data.identity.lastName || ''}`.trim();
      const meta: SaveMetadata = {
        id: slotId,
        playerName: fullName,
        username: data.identity.username || '',
        age: calculateAge(data.identity.dateOfBirth, {
          year: 2027,
          month: 1,
          day: 15,
          hour: 9,
          minute: 0,
        }),
        locationName: `${data.location.districtId.replace('district_', '').toUpperCase()}, ${data.location.cityId.replace('city_', '').toUpperCase()}`,
        currentDate: data.identity.dateOfBirth,
        lastSavedAt: updatedData.lastSavedAt,
      };

      filtered.unshift(meta);
      localStorage.setItem(METADATA_KEY, JSON.stringify(filtered));
      return true;
    } catch (e) {
      console.error('Failed to save game to localStorage:', e);
      return false;
    }
  }

  async loadGame(slotId: string): Promise<PlayerData | null> {
    try {
      const key = `${STORAGE_PREFIX}${slotId}`;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as PlayerData;
    } catch (e) {
      console.error(`Failed to load game from slot "${slotId}":`, e);
      return null;
    }
  }

  async deleteSave(slotId: string): Promise<boolean> {
    try {
      const key = `${STORAGE_PREFIX}${slotId}`;
      localStorage.removeItem(key);

      const list = await this.listSaves();
      const filtered = list.filter((s) => s.id !== slotId);
      localStorage.setItem(METADATA_KEY, JSON.stringify(filtered));
      return true;
    } catch (e) {
      console.error(`Failed to delete save slot "${slotId}":`, e);
      return false;
    }
  }

  async getLatestSave(): Promise<{ slotId: string; data: PlayerData } | null> {
    const list = await this.listSaves();
    if (list.length === 0) return null;
    // Sort descending by lastSavedAt
    list.sort((a, b) => b.lastSavedAt - a.lastSavedAt);
    const newest = list[0];
    const data = await this.loadGame(newest.id);
    if (!data) return null;
    return { slotId: newest.id, data };
  }
}

export class SaveManager {
  private provider: SaveProvider;
  private currentSlotId: string = 'slot_1';

  constructor(provider?: SaveProvider) {
    this.provider = provider || new LocalStorageSaveProvider();
  }

  setProvider(provider: SaveProvider): void {
    if (provider === this.provider) return;
    this.provider.dispose?.();
    this.provider = provider;
  }

  /** sends any save that is still waiting (cloud saves are batched every few seconds): call before the page closes or the player signs out */
  async flush(): Promise<void> {
    await this.provider.flush?.();
  }

  getCurrentSlotId(): string {
    return this.currentSlotId;
  }

  setCurrentSlotId(slotId: string): void {
    this.currentSlotId = slotId;
  }

  async save(data: PlayerData, slotId?: string): Promise<boolean> {
    const slot = slotId || this.currentSlotId;
    this.currentSlotId = slot;
    return this.provider.saveGame(slot, data);
  }

  async load(slotId?: string): Promise<PlayerData | null> {
    const slot = slotId || this.currentSlotId;
    this.currentSlotId = slot;
    return this.provider.loadGame(slot);
  }

  async listSaves(): Promise<SaveMetadata[]> {
    return this.provider.listSaves();
  }

  async deleteSave(slotId: string): Promise<boolean> {
    return this.provider.deleteSave(slotId);
  }

  async getLatestSave(): Promise<{ slotId: string; data: PlayerData } | null> {
    return this.provider.getLatestSave();
  }
}

export const globalSaveManager = new SaveManager();
