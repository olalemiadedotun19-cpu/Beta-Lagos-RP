import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CHAT_FOCUS_EVENT, chatStore, type ChatLine } from '../../net/chatStore';
import { CHAT_MAX_LEN } from '../../net/protocol';

interface ChatBoxProps {
  /** says it; false = not sent (too soon after the last one), so the text stays in the box */
  onSend: (text: string) => boolean;
  /** the keyboard is in the box (the game stops listening to the movement keys / hides the touch controls meanwhile) */
  onFocusChange: (focused: boolean) => void;
}

/** a steady colour per name, light enough to read on any background (the letters have a black outline) */
const nameColor = (name: string): string => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 75% 74%)`;
};

const Line = memo(({ line }: { line: ChatLine }) => (
  <div className="chat-line">
    <span className="chat-name" style={{ color: line.mine ? '#f2c14e' : nameColor(line.name) }}>
      {line.name}:
    </span>{' '}
    {line.text}
  </div>
));

/**
 * Proximity chat: a long see-through box at the top of the screen, between the minimap and the status panel.
 * The list shows the last 5 lines; scroll (swipe) up inside it for older ones. The input underneath says "Type a message".
 * Only what was said within hearing distance ever reaches the list (see net/MultiplayerSession).
 */
export const ChatBox = memo(({ onSend, onFocusChange }: ChatBoxProps) => {
  const lines = useSyncExternalStore(chatStore.subscribe, chatStore.get);
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // follow the newest line, unless the player scrolled up to read older ones
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  useEffect(() => {
    const focus = (): void => inputRef.current?.focus();
    window.addEventListener(CHAT_FOCUS_EVENT, focus);
    return () => window.removeEventListener(CHAT_FOCUS_EVENT, focus);
  }, []);

  // never leave the game thinking the keyboard is still in the box if this goes away
  useEffect(() => () => onFocusChange(false), [onFocusChange]);

  const submit = useCallback(() => {
    if (!text.trim()) {
      inputRef.current?.blur();
      return;
    }
    if (!onSend(text)) return;
    setText('');
    stick.current = true;
    // a phone keeps the keyboard up to carry on talking; a computer goes back to the game (Enter opens the box again)
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.blur();
  }, [text, onSend]);

  return (
    <div className="chat-box" data-focus={focused || undefined} data-empty={lines.length === 0 || undefined}>
      {lines.length > 0 && (
        <div
          ref={listRef}
          className="chat-list"
          role="log"
          aria-live="polite"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
          }}
        >
          {lines.map((l) => (
            <Line key={l.id} line={l} />
          ))}
        </div>
      )}
      <div className="chat-input-row">
        <input
          ref={inputRef}
          className="chat-input"
          type="text"
          value={text}
          maxLength={CHAT_MAX_LEN}
          placeholder="Type a message"
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="sentences"
          spellCheck={false}
          aria-label="Type a message"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => {
            setFocused(true);
            onFocusChange(true);
          }}
          onBlur={() => {
            setFocused(false);
            onFocusChange(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation(); // the game's own key handlers must not see what is being typed
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') inputRef.current?.blur();
          }}
          onKeyUp={(e) => e.stopPropagation()}
        />
        {(focused || text) && (
          <button
            type="button"
            tabIndex={-1}
            className="chat-send"
            aria-label="Send"
            // pressing it must not take the keyboard away from the input
            onPointerDown={(e) => e.preventDefault()}
            onClick={submit}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 12h15M13 6l6 6-6 6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
});
