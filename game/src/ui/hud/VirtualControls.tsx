import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { InputManager } from '../../core/InputManager';
import { HudButton } from './HudButton';
import { HudMover } from './HudMover';
import type { HudExtraAction } from './hudTypes';
import { IconAim, IconBrake, IconCarAjar, IconCarDoor, IconDrift, IconEnter, IconExit, IconGas, IconPunch, IconSprint, IconSteerLeft, IconSteerRight } from './icons';
import { driveControls } from '../../vehicles/DriveControls';

const DEADZONE = 0.12;
/** the stick origin follows the thumb once it is dragged this many radii away, so the thumb never "runs out" */
const DRIFT = 1.5;
/** two Sprint taps closer together than this (ms) are a double tap: jump */
const DOUBLE_TAP_MS = 300;
/** how long the virtual jump key is held for one double-tap jump (ms): a few frames, so the controller always sees it */
const JUMP_PULSE_MS = 130;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// =============================================================================================
// Floating joystick (left ~42% of the screen). Appears under the thumb; a faint ring marks the
// resting spot. Drives InputManager.setVirtualJoystick. Knob moves via transforms, no React renders.
// =============================================================================================
export const FloatingJoystick = memo(({ inputManager }: { inputManager: InputManager | null }) => {
  const zoneRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const imRef = useRef(inputManager);
  imRef.current = inputManager;
  const s = useRef({ id: -1, cx: 0, cy: 0, r: 52, zl: 0, zt: 0, zw: 0, zh: 0 });

  const place = () => {
    const b = baseRef.current;
    if (!b) return;
    const st = s.current;
    b.style.transform = `translate3d(${st.cx - st.zl - st.r}px, ${st.cy - st.zt - st.r}px, 0)`;
  };

  const release = useCallback(() => {
    const st = s.current;
    if (st.id === -1) return;
    st.id = -1;
    const b = baseRef.current;
    if (b) {
      b.dataset.active = '0';
      b.style.transform = '';
    }
    if (knobRef.current) knobRef.current.style.transform = '';
    imRef.current?.setVirtualJoystick(0, 0);
  }, []);

  useEffect(() => () => {
    release();
    imRef.current?.setVirtualJoystick(0, 0);
  }, [release]);

  const move = (clientX: number, clientY: number) => {
    const st = s.current;
    let dx = clientX - st.cx;
    let dy = clientY - st.cy;
    let dist = Math.hypot(dx, dy);
    if (dist > st.r * DRIFT) {
      const excess = dist - st.r * DRIFT;
      const m = st.r + 6;
      st.cx = clamp(st.cx + (dx / dist) * excess, st.zl + m, st.zl + st.zw - m);
      st.cy = clamp(st.cy + (dy / dist) * excess, st.zt + m, st.zt + st.zh - m);
      place();
      dx = clientX - st.cx;
      dy = clientY - st.cy;
      dist = Math.hypot(dx, dy);
    }
    const k = dist > st.r ? st.r / dist : 1;
    if (knobRef.current) knobRef.current.style.transform = `translate3d(${dx * k}px, ${dy * k}px, 0)`;

    const mag = Math.min(1, dist / st.r);
    if (mag <= DEADZONE || dist === 0) {
      imRef.current?.setVirtualJoystick(0, 0);
      return;
    }
    const scaled = (mag - DEADZONE) / (1 - DEADZONE);
    // screen-down is world-back, hence the inverted Y
    imRef.current?.setVirtualJoystick((dx / dist) * scaled, (-dy / dist) * scaled);
  };

  return (
    <div
      ref={zoneRef}
      className="hud-touch-zone hud-nocallout absolute left-0 bottom-0 w-[42%] h-[72%]"
      onPointerDown={(e) => {
        const st = s.current;
        const z = zoneRef.current;
        const b = baseRef.current;
        if (st.id !== -1 || !z || !b) return;
        const rect = z.getBoundingClientRect();
        st.id = e.pointerId;
        st.r = b.offsetWidth / 2;
        st.zl = rect.left;
        st.zt = rect.top;
        st.zw = rect.width;
        st.zh = rect.height;
        const m = st.r + 6;
        st.cx = clamp(e.clientX, rect.left + m, rect.right - m);
        st.cy = clamp(e.clientY, rect.top + m, rect.bottom - m);
        z.setPointerCapture(e.pointerId);
        b.dataset.active = '1';
        place();
        move(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.pointerId === s.current.id) move(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        if (e.pointerId === s.current.id) release();
      }}
      onPointerCancel={(e) => {
        if (e.pointerId === s.current.id) release();
      }}
      onLostPointerCapture={(e) => {
        if (e.pointerId === s.current.id) release();
      }}
    >
      <div ref={baseRef} data-active="0" className="hud-joy-base">
        <div className="hud-joy-ring" />
        <div ref={knobRef} className="hud-joy-knob" />
      </div>
    </div>
  );
});

// =============================================================================================
// Camera zone (right ~58%): one finger orbits, two fingers pinch-zoom. Sits UNDER the buttons, so a
// button press never reaches it. Touch-only (see .hud-touch-zone) so desktop mouse-orbit still works.
// =============================================================================================
export const CameraZone = memo(({ inputManager }: { inputManager: InputManager | null }) => {
  const imRef = useRef(inputManager);
  imRef.current = inputManager;
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  const pinchDist = () => {
    let ax = 0, ay = 0, bx = 0, by = 0, i = 0;
    for (const p of pts.current.values()) {
      if (i === 0) { ax = p.x; ay = p.y; } else if (i === 1) { bx = p.x; by = p.y; }
      i++;
    }
    return Math.hypot(ax - bx, ay - by);
  };

  const up = (e: React.PointerEvent) => {
    if (!pts.current.delete(e.pointerId)) return;
    if (pts.current.size < 2) pinch.current = null;
  };

  return (
    <div
      className="hud-touch-zone hud-nocallout absolute right-0 top-0 bottom-0 w-[58%]"
      onPointerDown={(e) => {
        pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        e.currentTarget.setPointerCapture(e.pointerId);
        if (pts.current.size === 2) pinch.current = pinchDist();
      }}
      onPointerMove={(e) => {
        const p = pts.current.get(e.pointerId);
        if (!p) return;
        if (pts.current.size >= 2) {
          p.x = e.clientX;
          p.y = e.clientY;
          const d = pinchDist();
          // fingers spreading = zoom in = smaller camera distance
          if (pinch.current !== null) imRef.current?.addPinchZoomDelta(-(d - pinch.current) * 0.035);
          pinch.current = d;
        } else {
          imRef.current?.addTouchCameraDelta(e.clientX - p.x, e.clientY - p.y);
          p.x = e.clientX;
          p.y = e.clientY;
        }
      }}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
    />
  );
});

// =============================================================================================
// Action cluster (bottom-right, thumb arc): [prompt + Interact] above [extras.. Sprint Jump]
// =============================================================================================
interface ActionClusterProps {
  inputManager: InputManager | null;
  /** a building / POI is in range (InteractionSystem.activePOI) */
  canInteract: boolean;
  interactLabel: string;
  promptText: string;
  isInterior: boolean;
  onInteract: () => void;
  onExit: () => void;
  /** the car button: 'enter' (the car door) while the player's car is close, 'exit' (the open door) while sitting in it, null = hidden */
  carButton: 'enter' | 'exit' | null;
  onCar: () => void;
  /** the vehicle HUD is showing (sitting in the car, or rearranging it): gas / brake replace sprint / punch / aim (the steering arrows are DriveSteerPad, the handbrake sits beside the exit-car button) */
  driving: boolean;
  extraActions?: HudExtraAction[];
  /** layout is saved per orientation */
  isPortrait: boolean;
  /** Rearrange HUD mode: every button is its own draggable box and the Interact button is shown even when nothing is nearby */
  editing: boolean;
}

export const ActionCluster = memo(
  ({ inputManager, canInteract, interactLabel, promptText, isInterior, onInteract, onExit, carButton, onCar, driving, extraActions, isPortrait, editing }: ActionClusterProps) => {
    const [sprint, setSprint] = useState(false);
    const imRef = useRef(inputManager);
    imRef.current = inputManager;

    const jumpTimer = useRef<number | null>(null);
    useEffect(() => () => {
      imRef.current?.setVirtualSprint(false);
      imRef.current?.setVirtualJump(false);
      if (jumpTimer.current) window.clearTimeout(jumpTimer.current);
    }, []);

    const sprintRef = useRef(false);
    const lastTap = useRef(0);
    const setSprintState = useCallback((on: boolean) => {
      sprintRef.current = on;
      setSprint(on);
      imRef.current?.setVirtualSprint(on);
    }, []);
    /**
     * Sprint button. One tap toggles sprint (instantly, no waiting for a second tap). A second tap within DOUBLE_TAP_MS is a double tap:
     * it undoes the toggle of the first tap, so sprint stays as it was, and jumps.
     */
    const onSprintTap = useCallback(() => {
      const now = performance.now();
      const double = now - lastTap.current < DOUBLE_TAP_MS;
      lastTap.current = double ? 0 : now; // a third quick tap starts a new pair
      if (!double) {
        setSprintState(!sprintRef.current);
        return;
      }
      setSprintState(!sprintRef.current);
      imRef.current?.setVirtualJump(true);
      if (jumpTimer.current) window.clearTimeout(jumpTimer.current);
      jumpTimer.current = window.setTimeout(() => {
        jumpTimer.current = null;
        imRef.current?.setVirtualJump(false);
      }, JUMP_PULSE_MS);
    }, [setSprintState]);

    // Punch / Aim: the game has no combat system yet, so these two only show their pressed / toggled look. Wire them to real actions
    // here (or pass your own `extraActions` from App to replace them) once melee / aiming exist.
    const [aim, setAim] = useState(false);
    const toggleAim = useCallback(() => setAim((v) => !v), []);

    // every button below is its OWN HudMover, so moving one never drags a neighbour along
    return (
      <div className="absolute right-[var(--hud-r)] bottom-[var(--hud-b)] flex flex-col items-end gap-2 pointer-events-none">
        {(carButton || editing) && (
          <div className="flex items-center gap-2 pointer-events-none">
            {/* sitting in the car: the handbrake (drift) sits just left of the exit button and a little higher */}
            {driving && (
              <HudMover id="drift" label="Drift" isPortrait={isPortrait} editing={editing} className="pointer-events-auto" style={{ translate: '0 -22px' }}>
                <HudButton
                  label="Drift"
                  icon={<IconDrift className="w-8 h-8" />}
                  size="calc(var(--hud-s) * 1.1)"
                  onPress={() => (driveControls.drift = true)}
                  onRelease={() => (driveControls.drift = false)}
                />
              </HudMover>
            )}
            <HudMover id="car" label={driving ? 'Exit car' : 'Car'} isPortrait={isPortrait} editing={editing} className="pointer-events-auto">
              <div className="hud-ring rounded-full">
                {driving ? (
                  // in rearrange mode (not really sitting in the car) this only shows where the button will be: it does nothing
                  <HudButton label="Exit car" icon={<IconCarAjar className="w-7 h-7" />} size="calc(var(--hud-p) * 0.92)" variant="primary" onTap={carButton === 'exit' ? onCar : undefined} />
                ) : (
                  <HudButton label="Car" icon={<IconCarDoor className="w-7 h-7" />} size="calc(var(--hud-p) * 0.92)" variant="primary" onTap={carButton ? onCar : undefined} />
                )}
              </div>
            </HudMover>
          </div>
        )}

        {!driving && (canInteract || isInterior || editing) && (
          <HudMover id="interact" label="Interact" isPortrait={isPortrait} editing={editing} className="flex items-center gap-2 pointer-events-none">
            {canInteract && promptText && (
              <div className="hud-glass hud-toast-in max-w-[44vw] sm:max-w-[240px] px-2.5 py-1 leading-none" style={{ borderRight: '2px solid var(--hud-accent)' }}>
                <div className="hud-label text-[10px]">Nearby</div>
                <div className="text-[14px] font-semibold uppercase tracking-[0.05em] text-white truncate hud-shadow mt-0.5">{promptText}</div>
              </div>
            )}
            {canInteract ? (
              <div className="pointer-events-auto hud-ring rounded-full">
                <HudButton
                  label={interactLabel}
                  icon={<IconEnter className="w-6 h-6" />}
                  size="calc(var(--hud-p) * 0.92)"
                  variant="primary"
                  onTap={onInteract}
                />
              </div>
            ) : isInterior ? (
              <div className="pointer-events-auto">
                <HudButton label="Exit" icon={<IconExit className="w-6 h-6" />} size="calc(var(--hud-p) * 0.92)" variant="primary" onTap={onExit} />
              </div>
            ) : (
              // rearrange mode only: shows where the Enter / Use button will appear (it does nothing)
              <div className="pointer-events-auto">
                <HudButton label="Use" icon={<IconEnter className="w-6 h-6" />} size="calc(var(--hud-p) * 0.92)" variant="primary" />
              </div>
            )}
          </HudMover>
        )}

        {/* row-reverse + wrap-reverse: Sprint stays in the corner (double tap = jump), and on a narrow portrait screen the left-most buttons wrap onto a row above */}
        <div className="hud-actions pointer-events-none">
          {driving ? (
            <>
              <HudMover id="gas" label="Gas" isPortrait={isPortrait} editing={editing} className="pointer-events-auto">
                <HudButton
                  label="Gas"
                  icon={<IconGas className="w-10 h-10" />}
                  size="calc(var(--hud-p) * 1.25)"
                  variant="primary"
                  onPress={() => (driveControls.gas = true)}
                  onRelease={() => (driveControls.gas = false)}
                />
              </HudMover>
              <HudMover id="brake" label="Brake" isPortrait={isPortrait} editing={editing} className="pointer-events-auto">
                <HudButton
                  label="Brake"
                  icon={<IconBrake className="w-9 h-9" />}
                  size="calc(var(--hud-p) * 1.05)"
                  onPress={() => (driveControls.brake = true)}
                  onRelease={() => (driveControls.brake = false)}
                />
              </HudMover>
            </>
          ) : (
            <>
              <HudMover id="sprint" label="Sprint" isPortrait={isPortrait} editing={editing} className="pointer-events-auto">
                <HudButton label="Sprint" icon={<IconSprint className="w-8 h-8" />} size="var(--hud-p)" active={sprint} onTap={onSprintTap} />
              </HudMover>
              <HudMover id="punch" label="Punch" isPortrait={isPortrait} editing={editing} className="pointer-events-auto">
                <HudButton label="Punch" icon={<IconPunch className="w-[26px] h-[26px]" />} size="var(--hud-s)" />
              </HudMover>
              <HudMover id="aim" label="Aim" isPortrait={isPortrait} editing={editing} className="pointer-events-auto">
                <HudButton label="Aim" icon={<IconAim className="w-[26px] h-[26px]" />} size="var(--hud-s)" active={aim} onTap={toggleAim} />
              </HudMover>
              {extraActions &&
                [...extraActions].reverse().map((a) => (
                  <HudMover key={a.id} id={`extra-${a.id}`} label={a.label} isPortrait={isPortrait} editing={editing} className="pointer-events-auto">
                    <HudButton
                      label={a.label}
                      icon={a.icon}
                      size="var(--hud-s)"
                      active={a.active}
                      disabled={a.disabled}
                      onPress={a.onPress}
                      onRelease={a.onRelease}
                      onTap={a.onTap}
                    />
                  </HudMover>
                ))}
            </>
          )}
        </div>
      </div>
    );
  }
);

/**
 * Steering arrows at the bottom-left while sitting in the car (where the movement stick is on foot). Hold one to steer; the other
 * gas / brake / drift buttons are in ActionCluster. Writes to driveControls, which the CarRider reads every frame.
 */
export const DriveSteerPad = memo(({ isPortrait, editing }: { isPortrait: boolean; editing: boolean }) => (
  <div className="absolute left-[var(--hud-l)] bottom-[var(--hud-b)] pointer-events-none">
    <div className="flex items-center gap-3 pointer-events-none">
      <HudMover id="steerleft" label="Left" isPortrait={isPortrait} editing={editing} className="pointer-events-auto">
        <HudButton
          label="Left"
          icon={<IconSteerLeft className="w-10 h-10" />}
          size="calc(var(--hud-p) * 1.3)"
          onPress={() => (driveControls.left = true)}
          onRelease={() => (driveControls.left = false)}
        />
      </HudMover>
      <HudMover id="steerright" label="Right" isPortrait={isPortrait} editing={editing} className="pointer-events-auto">
        <HudButton
          label="Right"
          icon={<IconSteerRight className="w-10 h-10" />}
          size="calc(var(--hud-p) * 1.3)"
          onPress={() => (driveControls.right = true)}
          onRelease={() => (driveControls.right = false)}
        />
      </HudMover>
    </div>
  </div>
));
