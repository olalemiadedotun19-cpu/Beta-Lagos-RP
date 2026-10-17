/**
 * Central Cross-Platform Input Abstraction
 * Handles:
 * - Desktop: Keyboard (WASD/Arrows, Space, Shift, E), Mouse Drag Orbit, Mouse Wheel Zoom
 * - Mobile: Floating Left Joystick, Dedicated Right Camera Touchpad, Multi-touch
 * - UI Priority: Pauses gameplay input when modals or phone are active
 */

export interface InputState {
  moveForward: boolean;
  moveBackward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
  sprint: boolean;
  jump: boolean;
  interact: boolean;
  // Normalized 2D movement vector (-1 to 1) from keys or touch joystick
  moveVector: { x: number; y: number };
  // Camera rotation deltas in radians
  cameraDeltaYaw: number;
  cameraDeltaPitch: number;
  // Camera zoom delta
  zoomDelta: number;
}

export class InputManager {
  private domElement: HTMLElement;
  private keys: Record<string, boolean> = {};

  // Paused state when menus/modals are active
  private isPaused: boolean = false;

  // Desktop Mouse drag state
  private isMouseDown: boolean = false;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;

  // Camera settings
  public cameraSensitivity: number = 1.0;
  public invertY: boolean = false;

  // Accumulated camera deltas
  private deltaYawAccumulator: number = 0;
  private deltaPitchAccumulator: number = 0;
  private zoomDeltaAccumulator: number = 0;

  // Virtual inputs from mobile touch controls
  private virtualJoystickVector: { x: number; y: number } = { x: 0, y: 0 };
  private virtualJump: boolean = false;
  private virtualSprint: boolean = false;
  private virtualInteract: boolean = false;

  // Bound listeners
  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onKeyUpBound: (e: KeyboardEvent) => void;
  private onMouseDownBound: (e: MouseEvent) => void;
  private onMouseMoveBound: (e: MouseEvent) => void;
  private onMouseUpBound: (e: MouseEvent) => void;
  private onWheelBound: (e: WheelEvent) => void;

  constructor(domElement: HTMLElement) {
    this.domElement = domElement;

    this.onKeyDownBound = this.onKeyDown.bind(this);
    this.onKeyUpBound = this.onKeyUp.bind(this);
    this.onMouseDownBound = this.onMouseDown.bind(this);
    this.onMouseMoveBound = this.onMouseMove.bind(this);
    this.onMouseUpBound = this.onMouseUp.bind(this);
    this.onWheelBound = this.onWheel.bind(this);

    this.attach();
  }

  private attach(): void {
    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);

    // Desktop mouse events only on 3D canvas
    this.domElement.addEventListener('mousedown', this.onMouseDownBound);
    window.addEventListener('mousemove', this.onMouseMoveBound);
    window.addEventListener('mouseup', this.onMouseUpBound);
    this.domElement.addEventListener('wheel', this.onWheelBound, { passive: false });
  }

  public destroy(): void {
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    this.domElement.removeEventListener('mousedown', this.onMouseDownBound);
    window.removeEventListener('mousemove', this.onMouseMoveBound);
    window.removeEventListener('mouseup', this.onMouseUpBound);
    this.domElement.removeEventListener('wheel', this.onWheelBound);
  }

  /**
   * Pause/resume gameplay inputs when UI modals or phone open
   */
  public setInputPaused(paused: boolean): void {
    this.isPaused = paused;
    if (paused) {
      this.virtualJoystickVector = { x: 0, y: 0 };
      this.virtualJump = false;
      this.virtualSprint = false;
      this.isMouseDown = false;
      this.deltaYawAccumulator = 0;
      this.deltaPitchAccumulator = 0;
      this.zoomDeltaAccumulator = 0;
    }
  }

  public isInputPaused(): boolean {
    return this.isPaused;
  }

  public setCameraSettings(settings: { sensitivity?: number; invertY?: boolean }): void {
    if (settings.sensitivity !== undefined) this.cameraSensitivity = settings.sensitivity;
    if (settings.invertY !== undefined) this.invertY = settings.invertY;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (
      this.isPaused ||
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      (e.target as HTMLElement)?.isContentEditable
    ) {
      return;
    }
    this.keys[e.code] = true;
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys[e.code] = false;
  }

  private onMouseDown(e: MouseEvent): void {
    if (this.isPaused) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button') || target.closest('nav') || target.closest('input')) {
      return;
    }

    this.isMouseDown = true;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.isMouseDown || this.isPaused) return;

    const dx = e.clientX - this.lastMouseX;
    const dy = e.clientY - this.lastMouseY;

    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    // Base mouse sensitivity: 0.004
    const baseSensitivity = 0.004 * this.cameraSensitivity;

    // Horizontal: drag left -> rotate view left
    this.deltaYawAccumulator -= dx * baseSensitivity;

    // Vertical: drag up (dy < 0) -> camera looks up (pitch decreases)
    // Default Invert Y = OFF
    const pitchFactor = this.invertY ? -1 : 1;
    this.deltaPitchAccumulator += dy * baseSensitivity * pitchFactor;
  }

  private onMouseUp(): void {
    this.isMouseDown = false;
  }

  private onWheel(e: WheelEvent): void {
    if (this.isPaused) return;
    e.preventDefault();
    this.zoomDeltaAccumulator += e.deltaY * 0.007;
  }

  // =========================================================================
  // Mobile Touch Controls Routing
  // =========================================================================

  /**
   * Called by the HUD's CameraZone (ui/hud/VirtualControls.tsx) when the dedicated Right Camera Touchpad is dragged
   */
  public addTouchCameraDelta(dx: number, dy: number): void {
    if (this.isPaused) return;

    // Base touch sensitivity: 0.0045
    const baseSensitivity = 0.0045 * this.cameraSensitivity;

    // Horizontal: Drag left (dx < 0) -> view rotates left
    this.deltaYawAccumulator -= dx * baseSensitivity;

    // Vertical: Drag up (dy < 0) -> view looks up (pitch decreases)
    const pitchFactor = this.invertY ? -1 : 1;
    this.deltaPitchAccumulator += dy * baseSensitivity * pitchFactor;
  }

  public addPinchZoomDelta(deltaZoom: number): void {
    if (this.isPaused) return;
    this.zoomDeltaAccumulator += deltaZoom;
  }

  public setVirtualJoystick(x: number, y: number): void {
    if (this.isPaused) {
      this.virtualJoystickVector = { x: 0, y: 0 };
      return;
    }
    this.virtualJoystickVector = { x, y };
  }

  public setVirtualJump(pressed: boolean): void {
    if (this.isPaused) {
      this.virtualJump = false;
      return;
    }
    this.virtualJump = pressed;
  }

  public setVirtualSprint(pressed: boolean): void {
    if (this.isPaused) {
      this.virtualSprint = false;
      return;
    }
    this.virtualSprint = pressed;
  }

  public triggerVirtualInteract(): void {
    if (this.isPaused) return;
    this.virtualInteract = true;
  }

  /**
   * Samples current unified input state across desktop and mobile
   */
  public getState(): InputState {
    if (this.isPaused) {
      return {
        moveForward: false,
        moveBackward: false,
        moveLeft: false,
        moveRight: false,
        sprint: false,
        jump: false,
        interact: false,
        moveVector: { x: 0, y: 0 },
        cameraDeltaYaw: 0,
        cameraDeltaPitch: 0,
        zoomDelta: 0,
      };
    }

    const forward = !!(this.keys['KeyW'] || this.keys['ArrowUp']);
    const backward = !!(this.keys['KeyS'] || this.keys['ArrowDown']);
    const left = !!(this.keys['KeyA'] || this.keys['ArrowLeft']);
    const right = !!(this.keys['KeyD'] || this.keys['ArrowRight']);
    const sprint = !!(this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.virtualSprint);
    const jump = !!(this.keys['Space'] || this.virtualJump);
    const interact = !!(this.keys['KeyE'] || this.virtualInteract);

    // Calculate normalized movement vector
    let vx = 0;
    let vy = 0;

    if (forward) vy += 1;
    if (backward) vy -= 1;
    if (right) vx += 1;
    if (left) vx -= 1;

    // Merge keyboard with virtual touch joystick
    if (
      Math.abs(this.virtualJoystickVector.x) > 0.05 ||
      Math.abs(this.virtualJoystickVector.y) > 0.05
    ) {
      vx = this.virtualJoystickVector.x;
      vy = this.virtualJoystickVector.y;
    } else {
      const len = Math.sqrt(vx * vx + vy * vy);
      if (len > 0) {
        vx /= len;
        vy /= len;
      }
    }

    const yaw = this.deltaYawAccumulator;
    const pitch = this.deltaPitchAccumulator;
    const zoom = this.zoomDeltaAccumulator;

    // Reset single frame deltas
    this.deltaYawAccumulator = 0;
    this.deltaPitchAccumulator = 0;
    this.zoomDeltaAccumulator = 0;
    this.virtualInteract = false;

    return {
      moveForward: forward,
      moveBackward: backward,
      moveLeft: left,
      moveRight: right,
      sprint,
      jump,
      interact,
      moveVector: { x: vx, y: vy },
      cameraDeltaYaw: yaw,
      cameraDeltaPitch: pitch,
      zoomDelta: zoom,
    };
  }
}
