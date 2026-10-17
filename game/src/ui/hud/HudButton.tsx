import React, { memo, useEffect, useRef, useState } from 'react';
import { haptic } from '../../settings/GameSettings';

interface HudButtonProps {
  label: string;
  icon: React.ReactNode;
  /** CSS size, e.g. 'var(--hud-p)' or '48px' */
  size: string;
  /** finger down (hold-style actions) */
  onPress?: () => void;
  /** finger up / cancelled (always paired with onPress) */
  onRelease?: () => void;
  /** completed tap: fires on finger-up inside the button (so rapid re-taps are never dropped by the browser's click heuristics) */
  onTap?: () => void;
  /** toggled-on look */
  active?: boolean;
  disabled?: boolean;
  variant?: 'glass' | 'primary';
  badge?: number;
  /** hide the caption under the icon (very small buttons) */
  iconOnly?: boolean;
  className?: string;
}

/**
 * One HUD button. Uses Pointer Events + pointer capture so every button tracks its own finger:
 * holding Jump while steering the joystick while tapping Sprint all work at once, and a press never
 * leaks to the camera zone underneath.
 */
export const HudButton = memo(
  ({ label, icon, size, onPress, onRelease, onTap, active, disabled, variant = 'glass', badge, iconOnly, className = '' }: HudButtonProps) => {
    const [pressed, setPressed] = useState(false);
    const downId = useRef<number | null>(null);
    const suppressClick = useRef(false);
    const releaseRef = useRef(onRelease);
    releaseRef.current = onRelease;
    const tapRef = useRef(onTap);
    tapRef.current = onTap;

    const end = () => {
      if (downId.current === null) return;
      downId.current = null;
      setPressed(false);
      releaseRef.current?.();
    };

    // never leave a virtual input stuck if the button disappears mid-press
    useEffect(() => () => end(), []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
      <button
        type="button"
        tabIndex={-1}
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        aria-disabled={disabled || undefined}
        data-pressed={pressed || undefined}
        data-active={active || undefined}
        data-variant={variant}
        data-disabled={disabled || undefined}
        style={{ width: size, height: size }}
        className={`hud-btn hud-nocallout relative shrink-0 rounded-full flex flex-col items-center justify-center gap-0.5 cursor-pointer ${className}`}
        onPointerDown={(e) => {
          if (disabled || downId.current !== null) return;
          if (e.pointerType === 'mouse') {
            if (e.button !== 0) return;
            e.preventDefault(); // keep focus off the button so Space/Enter never re-trigger it
          }
          e.stopPropagation();
          suppressClick.current = false;
          downId.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          setPressed(true);
          haptic();
          onPress?.();
        }}
        onPointerUp={(e) => {
          if (e.pointerId !== downId.current) return;
          const r = e.currentTarget.getBoundingClientRect();
          const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
          end();
          if (inside && !disabled && onTap) {
            suppressClick.current = true; // the click that follows must not fire the tap a second time
            // deferred one task so the browser's trailing click lands on THIS button, never on a
            // modal / backdrop that the tap just opened
            window.setTimeout(() => tapRef.current?.(), 0);
          }
        }}
        onPointerCancel={(e) => {
          if (e.pointerId === downId.current) end();
        }}
        onLostPointerCapture={(e) => {
          if (e.pointerId === downId.current) end();
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (!disabled) onTap?.(); // keyboard / assistive-tech activation
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="flex items-center justify-center pointer-events-none">{icon}</span>
        {!iconOnly && (
          <span className="pointer-events-none text-[10px] font-semibold uppercase tracking-[0.14em] leading-none opacity-85">{label}</span>
        )}
        {badge !== undefined && badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#e5484d] text-white text-[10px] font-bold leading-none flex items-center justify-center ring-1 ring-black/70 pointer-events-none">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>
    );
  }
);
