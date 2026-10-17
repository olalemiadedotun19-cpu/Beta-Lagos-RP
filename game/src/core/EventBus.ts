/**
 * Central event bus for decoupled system communication
 */

type Listener<T = any> = (data: T) => void;

export class EventBus {
  private listeners: Map<string, Set<Listener>> = new Map();

  on<T = any>(event: string, callback: Listener<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.off(event, callback);
    };
  }

  off<T = any>(event: string, callback: Listener<T>): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(callback);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  emit<T = any>(event: string, data?: T): void {
    const set = this.listeners.get(event);
    if (set) {
      set.forEach((cb) => {
        try {
          cb(data);
        } catch (err) {
          console.error(`Error in event handler for "${event}":`, err);
        }
      });
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const globalEventBus = new EventBus();
