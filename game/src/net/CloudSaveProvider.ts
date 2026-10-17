import { get, ref, remove, set } from 'firebase/database';
import type { PlayerData, SaveMetadata } from '../types/game';
import { LocalStorageSaveProvider, type SaveProvider } from '../save/SaveManager';
import { getFirebase } from './firebase';

/**
 * Saves the player to Firebase Realtime Database at  users/<uid>/save  (one save per account; only its owner can read or write it).
 *
 * - Every save is also written to this device (LocalStorageSaveProvider), so the game keeps working offline and a tab that closes
 *   before the cloud write finished loses nothing: on the next load the NEWER of the two copies wins (and is pushed to the cloud).
 * - The game saves on every state change (a few times a second at worst), so cloud writes are batched: at most one every
 *   MIN_INTERVAL_MS, always the latest data. flush() (sign-out, page hidden / closed) sends it immediately.
 * - The player is stored as one JSON string: Realtime Database drops empty arrays and null fields, which would silently change
 *   the player (empty inventory, clothes set to "nothing"). A string comes back exactly as it went in.
 */
const MIN_INTERVAL_MS = 15000;
const SAVE_VERSION = 1;

interface CloudSaveNode {
  v: number;
  updatedAt: number;
  data: string;
}

/** fills what older / partial saves may lack so the rest of the game can rely on it */
function normalize(d: PlayerData): PlayerData {
  return { ...d, inventory: Array.isArray(d.inventory) ? d.inventory : [] };
}

export class CloudSaveProvider implements SaveProvider {
  private readonly local = new LocalStorageSaveProvider();
  private pending: PlayerData | null = null;
  private timer: number | null = null;
  private lastWrite = 0;
  private disposed = false;
  private warned = false;

  constructor(private readonly uid: string) {
    window.addEventListener('pagehide', this.onLeave);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private readonly onLeave = (): void => {
    void this.writeNow();
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') void this.writeNow();
  };

  private nodeRef() {
    return ref(getFirebase().db, `users/${this.uid}/save`);
  }

  // ------------------------------------------------------------------ SaveProvider

  async saveGame(slotId: string, data: PlayerData): Promise<boolean> {
    if (this.disposed) return false;
    const stamped: PlayerData = { ...data, lastSavedAt: Date.now() };
    // queued first, so a flush() right after this call (page closing) already sees it
    this.pending = stamped;
    const written = this.local.saveGame(slotId, stamped);
    this.schedule();
    return written;
  }

  async loadGame(slotId: string): Promise<PlayerData | null> {
    let cloud: PlayerData | null = null;
    try {
      const snap = await get(this.nodeRef());
      if (snap.exists()) {
        const node = snap.val() as CloudSaveNode;
        if (typeof node.data === 'string') cloud = normalize(JSON.parse(node.data) as PlayerData);
      }
    } catch (e) {
      console.warn('Could not read the cloud save (offline?), using this device\'s copy', e);
    }
    const local = await this.local.loadGame(slotId);
    if (local && (!cloud || local.lastSavedAt > cloud.lastSavedAt)) {
      // this device holds a newer save than the cloud (the tab closed before the last cloud write): keep it and send it up
      this.pending = local;
      this.schedule();
      return normalize(local);
    }
    return cloud;
  }

  listSaves(): Promise<SaveMetadata[]> {
    return this.local.listSaves();
  }

  async deleteSave(slotId: string): Promise<boolean> {
    const ok = await this.local.deleteSave(slotId);
    this.pending = null;
    try {
      await remove(this.nodeRef());
    } catch (e) {
      console.warn('Could not delete the cloud save', e);
      return false;
    }
    return ok;
  }

  async getLatestSave(): Promise<{ slotId: string; data: PlayerData } | null> {
    return this.local.getLatestSave();
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    await this.writeNow();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    window.removeEventListener('pagehide', this.onLeave);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  // ------------------------------------------------------------------ batching

  private schedule(): void {
    if (this.timer !== null) return;
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - this.lastWrite));
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.writeNow();
    }, wait);
  }

  private async writeNow(): Promise<void> {
    const data = this.pending;
    if (!data) return;
    this.pending = null;
    this.lastWrite = Date.now();
    const node: CloudSaveNode = { v: SAVE_VERSION, updatedAt: data.lastSavedAt || Date.now(), data: JSON.stringify(data) };
    try {
      await set(this.nodeRef(), node);
    } catch (e) {
      this.pending ??= data; // try again with the next save
      if (!this.warned) {
        this.warned = true;
        console.warn('Cloud save failed (offline, or the database rules are not published yet). The game keeps saving on this device.', e);
      }
    }
  }
}
