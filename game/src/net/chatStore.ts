import { CHAT_HISTORY } from './protocol';

/** one line in the chat list */
export interface ChatLine {
  id: string;
  /** who said it (uid; '' for the local player when playing offline) */
  uid: string;
  name: string;
  text: string;
  /** local time (ms) it arrived */
  at: number;
  /** said by the local player */
  mine: boolean;
}

let localSeq = 0;
const listeners = new Set<() => void>();
let lines: ChatLine[] = [];

/**
 * The chat list the player sees: what they said and what they heard (only people within hearing, see protocol.ts CHAT_RADIUS).
 * A tiny external store so React reads it with useSyncExternalStore and the network code can add to it without knowing about React.
 * The array is replaced (never changed in place) on every change, which is what useSyncExternalStore needs.
 */
export const chatStore = {
  get: (): ChatLine[] => lines,

  subscribe: (cb: () => void): (() => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },

  /** adds a line (the newest at the end); only the last CHAT_HISTORY are kept */
  add(line: Omit<ChatLine, 'id' | 'at'> & { id?: string }): void {
    const full: ChatLine = { ...line, id: line.id ?? `local_${++localSeq}`, at: Date.now() };
    if (lines.some((l) => l.id === full.id)) return;
    lines = lines.length >= CHAT_HISTORY ? [...lines.slice(lines.length - CHAT_HISTORY + 1), full] : [...lines, full];
    for (const cb of listeners) cb();
  },

  clear(): void {
    if (!lines.length) return;
    lines = [];
    for (const cb of listeners) cb();
  },

  /** asks the chat box to take the keyboard (the Enter key does this) */
  requestFocus(): void {
    window.dispatchEvent(new Event(CHAT_FOCUS_EVENT));
  },
};

export const CHAT_FOCUS_EVENT = 'il-chat-focus';
