import * as THREE from 'three';
import { FigureCharacter, WALK_FULL_SPEED, RUN_SPEED, TURN_MIN_ANGLE, TURN_MOVE_GATE } from './figure/FigureCharacter';
import { InputManager } from '../core/InputManager';
import { SpatialGrid } from '../world/SpatialGrid';
import { checkCircleBoxCollision, clamp } from '../utils/math';
import { groundHeightAt, waterSurfaceAt } from '../world/CurvedRoads';
import { pushCarOutOfBoxes } from '../vehicles/CarCollision';

/** water deeper than this (about chest height) lifts the character off the bottom: he swims on the surface */
const SWIM_DEPTH = 1.1;

/** Third-person camera on foot: how far behind the character it starts (m) and how far it looks down (rad). A moderate, over-the-back view. */
const FOOT_DISTANCE = 4.2;
const FOOT_PITCH = 0.2;
/** In the car the camera sits this much further back / higher (m, rad), blended in smoothly (see vehicleEase) */
const DRIVE_EXTRA_DISTANCE = 2.4;
const DRIVE_EXTRA_PITCH = 0.03;
/** seconds the camera takes to go from the character to the car (the enter clip is 5.5 s long) and back (the exit clip is 5.8 s) */
const VEHICLE_BLEND_IN = 2.4;
const VEHICLE_BLEND_OUT = 1.8;

export class PlayerController {
  public characterModel: FigureCharacter;
  private camera: THREE.PerspectiveCamera;
  private inputManager: InputManager;
  private collisionGrid: SpatialGrid;

  // Position, Physics & Kinematics
  public position: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  /**
   * true while the car sequence (vehicles/CarRider.ts) drives the character: the stick / keys no longer move it (the camera still
   * orbits and follows). The rider walks, turns and places the character through autoWalk / faceYaw / placeExternal.
   */
  public externalControl = false;
  /** length of the movement stick / keys on the last frame (0..1), also while externalControl is on: lets the rider cancel a walk */
  public moveInputMagnitude = 0;
  /** the stick / keys on the last frame (x: + = right, y: + = forward) and whether the jump key is held: what the car drives with */
  public moveInput = { x: 0, y: 0 };
  public jumpHeld = false;
  // ---- vehicle camera (CarRider feeds it; see setVehicleCamera / setVehicleAnchor)
  /** true from the moment the character starts getting in until the exit begins */
  private vehicleWant = false;
  /** 0..1 progress of the blend between the on-foot camera and the car camera (linear in time) and the same eased (what the camera uses) */
  private vehicleT = 0;
  private vehicleEase = 0;
  /** the car the camera follows: ground position under the middle of the wheelbase, heading, ground height, speed (m/s) */
  private vehicle = { x: 0, y: 0, z: 0, yaw: 0, speed: 0 };
  private vehicleSeen = false;
  /** the car's height, smoothed (kerbs and bumps must not bounce the camera) */
  private vehicleY = 0;
  /** lowest the camera may go over the ground, smoothed for the same reason */
  private camFloor = 0;
  private velocity: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  private isGrounded: boolean = true;
  private playerRadius: number = 0.42;

  // Internal movement tuning parameters
  /** how deep the water is where the character stands now (0 = dry); wading slows him, past SWIM_DEPTH he swims */
  public waterDepth = 0;
  private swimClock = 0;
  /** full-stick walking / running speeds (m/s): the speeds the walk and run clips were captured at, so the feet stay planted (see FigureCharacter) */
  private readonly walkSpeed: number = WALK_FULL_SPEED;
  private readonly sprintSpeed: number = RUN_SPEED;
  private readonly acceleration: number = 18.0;
  private readonly deceleration: number = 20.0;
  private readonly gravity: number = -24.0;
  private readonly jumpForce: number = 8.4;

  // Camera Orbit parameters & Target states for smooth damping
  private targetCameraYaw: number = 0; // Horizontal orbit angle in radians
  private targetCameraPitch: number = FOOT_PITCH; // Vertical pitch in radians
  private targetCameraDistance: number = FOOT_DISTANCE;

  private currentCameraYaw: number = 0;
  private currentCameraPitch: number = FOOT_PITCH;
  private currentActualDistance: number = FOOT_DISTANCE;

  // Vertical limits: prevents camera from flipping or burrowing through the ground
  private readonly minPitch: number = -0.9; // ~-52 degrees: looking up at the buildings / sky (see the look-up handling in updateCamera)
  private readonly maxPitch: number = 1.25; // ~72 degrees, high bird's eye view looking down
  private readonly minDistance: number = 2.5;
  private readonly maxDistance: number = 14.0;

  // scratch vectors reused every frame (no garbage while the camera follows the player)
  private camTarget: THREE.Vector3 = new THREE.Vector3();
  private camIdeal: THREE.Vector3 = new THREE.Vector3();
  private smoothCamPos: THREE.Vector3 = new THREE.Vector3();
  private smoothCamTarget: THREE.Vector3 = new THREE.Vector3();
  private targetFacingAngle: number = 0;
  /** seconds the character has been standing still (a walker reversing direction passes through zero speed for a moment: that is not standing) */
  private standTime: number = 0;
  // seconds since the player last dragged / turned the camera by hand (auto-follow only runs while they are not looking around)
  private lookIdle: number = 10;

  constructor(
    characterModel: FigureCharacter,
    camera: THREE.PerspectiveCamera,
    inputManager: InputManager,
    collisionGrid: SpatialGrid,
    initialPosition: { x: number; y: number; z: number } = { x: 0, y: 0, z: 12 }
  ) {
    this.characterModel = characterModel;
    this.camera = camera;
    this.inputManager = inputManager;
    this.collisionGrid = collisionGrid;

    this.position.set(initialPosition.x, initialPosition.y, initialPosition.z);
    this.characterModel.group.position.copy(this.position);

    // Initial camera placement
    this.updateCamera(1.0);
  }

  /** on the ground (false while jumping or falling): other players are told, so they play the same jump */
  public get grounded(): boolean {
    return this.isGrounded;
  }

  public setCollisionGrid(grid: SpatialGrid): void {
    this.collisionGrid = grid;
  }

  /** Turns the camera to `cameraYaw` right away (no easing) and makes the character face away from it, i.e. forward. */
  public setFacing(cameraYaw: number): void {
    this.targetCameraYaw = cameraYaw;
    this.currentCameraYaw = cameraYaw;
    this.targetFacingAngle = cameraYaw + Math.PI;
    this.characterModel.group.rotation.y = cameraYaw + Math.PI;
    this.updateCamera(1.0);
  }

  public setPosition(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.characterModel.group.position.copy(this.position);
    // a teleport snaps the camera: no car blend left over
    this.vehicleWant = false;
    this.vehicleT = 0;
    this.vehicleEase = 0;
    this.updateCamera(1.0);
  }

  // ---------------------------------------------------------------- vehicle camera (vehicles/CarRider.ts)

  /**
   * Switches the camera between the on-foot view and the car view. It does not jump: distance, height, pivot and the way the camera
   * swings round behind the car all ease over a couple of seconds (VEHICLE_BLEND_IN / _OUT), whatever the camera was doing.
   */
  public setVehicleCamera(on: boolean): void {
    if (on === this.vehicleWant) return;
    this.vehicleWant = on;
    if (on) this.vehicleSeen = false;
  }

  /** Where the car is this frame (call it every frame the car sequence runs, after the car has moved). */
  public setVehicleAnchor(x: number, y: number, z: number, yaw: number, speed: number): void {
    this.vehicle.x = x;
    this.vehicle.y = y;
    this.vehicle.z = z;
    this.vehicle.yaw = yaw;
    this.vehicle.speed = speed;
    if (!this.vehicleSeen) {
      this.vehicleY = y;
      this.vehicleSeen = true;
    }
  }

  private stepVehicleBlend(dt: number): void {
    const dur = this.vehicleWant ? VEHICLE_BLEND_IN : VEHICLE_BLEND_OUT;
    this.vehicleT = clamp(this.vehicleT + (this.vehicleWant ? dt : -dt) / dur, 0, 1);
    const t = this.vehicleT;
    this.vehicleEase = t * t * t * (t * (t * 6 - 15) + 10); // smootherstep: no kick at either end
  }

  /** swings the camera round behind the car: slowly while it is still arriving there (getting in), tighter once driving; never while the player is looking around */
  private chaseVehicleYaw(dt: number): void {
    if (!this.vehicleWant || this.lookIdle < 0.8) return;
    let d = this.vehicle.yaw + Math.PI - this.targetCameraYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const ramp = clamp(this.vehicleT / 0.3, 0, 1); // starts from zero, no jerk when the sequence begins
    const tau = 0.75 - 0.5 * this.vehicleEase; // 0.75 s -> 0.25 s
    const gain = 0.5 + 0.5 * clamp(this.vehicle.speed / 5, 0, 1); // gentle at a standstill, tight at speed
    const fade = clamp((this.lookIdle - 0.8) / 0.6, 0, 1); // eases back in after the player lets go of the camera
    const k = (1 - Math.exp((-dt * gain) / tau)) * ramp * ramp * fade;
    const maxStep = 3.0 * dt;
    this.targetCameraYaw += clamp(d * k, -maxStep, maxStep);
  }

  public update(deltaSeconds: number): { isMoving: boolean; isSprinting: boolean } {
    // 1. Process Input
    const input = this.inputManager.getState();
    this.moveInputMagnitude = Math.min(1, Math.hypot(input.moveVector.x, input.moveVector.y));
    this.moveInput.x = input.moveVector.x;
    this.moveInput.y = input.moveVector.y;
    this.jumpHeld = input.jump;

    // Smoothly accumulate target camera angles
    this.targetCameraYaw += input.cameraDeltaYaw;
    this.targetCameraPitch = clamp(
      this.targetCameraPitch + input.cameraDeltaPitch,
      this.minPitch,
      this.maxPitch
    );
    this.targetCameraDistance = clamp(
      this.targetCameraDistance + input.zoomDelta,
      this.minDistance,
      this.maxDistance
    );

    this.stepVehicleBlend(deltaSeconds);

    // manual look-around pauses the automatic follow-camera below
    const lookingNow = Math.abs(input.cameraDeltaYaw) > 1e-4 || Math.abs(input.cameraDeltaPitch) > 1e-4;
    this.lookIdle = lookingNow ? 0 : this.lookIdle + deltaSeconds;

    // Exponential smoothing / damping on camera angles (smooth, responsive, no sticky lag); a little tighter in the car
    const dampingSpeed = 18.0 + 27.0 * this.vehicleEase;
    const dampFactor = clamp(dampingSpeed * deltaSeconds, 0, 1);
    this.currentCameraYaw += (this.targetCameraYaw - this.currentCameraYaw) * dampFactor;
    this.currentCameraPitch += (this.targetCameraPitch - this.currentCameraPitch) * dampFactor;

    // the car sequence moves and animates the character itself
    if (this.externalControl) {
      this.chaseVehicleYaw(deltaSeconds);
      this.velocity.set(0, 0, 0);
      this.characterModel.group.position.copy(this.position);
      this.updateCamera(deltaSeconds);
      return { isMoving: false, isSprinting: false };
    }

    // 2. Horizontal Movement Direction relative to current camera yaw
    let moveDirX = 0;
    let moveDirZ = 0;
    let inputMag = 0;

    const { x: vx, y: vy } = input.moveVector;
    const hasMoveInput = Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05;

    if (hasMoveInput) {
      // Forward vector projected on horizontal plane
      const fwdX = -Math.sin(this.currentCameraYaw);
      const fwdZ = -Math.cos(this.currentCameraYaw);
      // Right vector
      const rightX = Math.cos(this.currentCameraYaw);
      const rightZ = -Math.sin(this.currentCameraYaw);

      moveDirX = fwdX * vy + rightX * vx;
      moveDirZ = fwdZ * vy + rightZ * vx;

      const len = Math.sqrt(moveDirX * moveDirX + moveDirZ * moveDirZ);
      if (len > 0.001) {
        moveDirX /= len;
        moveDirZ /= len;
      }
      // how far the stick is pushed (0..1): a light push is a slow, short-stride walk, the full push is a full walk
      inputMag = clamp(Math.hypot(vx, vy), 0, 1);
    }

    // Turning on the spot: standing still and asked to head somewhere well off the way the body faces, the character turns with the
    // 90 / 180 degree turn clip first (the clip rotates it) and only walks off once most of the turn is done.
    const cm = this.characterModel;
    this.standTime = Math.hypot(this.velocity.x, this.velocity.z) < 0.3 ? this.standTime + deltaSeconds : 0;
    if (hasMoveInput && !cm.isTurning && this.isGrounded && this.waterDepth < 0.5 && this.standTime > 0.12) {
      let toWant = Math.atan2(moveDirX, moveDirZ) - cm.group.rotation.y;
      while (toWant > Math.PI) toWant -= Math.PI * 2;
      while (toWant < -Math.PI) toWant += Math.PI * 2;
      if (Math.abs(toWant) >= TURN_MIN_ANGLE) cm.startTurn(toWant);
    }
    const holdForTurn = cm.isTurning && cm.turnProgress < TURN_MOVE_GATE;

    // Target horizontal speed with smooth acceleration/deceleration
    const isSprinting = input.sprint && hasMoveInput;
    // wading drags: up to -42% at chest depth, a swimmer is slower still
    const wadeK = 1 - 0.42 * clamp(this.waterDepth / SWIM_DEPTH, 0, 1) - (this.waterDepth > SWIM_DEPTH ? 0.1 : 0);
    const targetSpeed = hasMoveInput && !holdForTurn ? (isSprinting ? this.sprintSpeed : this.walkSpeed) * inputMag * wadeK : 0;

    const targetVelX = moveDirX * targetSpeed;
    const targetVelZ = moveDirZ * targetSpeed;

    const accelRate = hasMoveInput ? this.acceleration : this.deceleration;
    this.velocity.x = THREE.MathUtils.lerp(
      this.velocity.x,
      targetVelX,
      clamp(accelRate * deltaSeconds, 0, 1)
    );
    this.velocity.z = THREE.MathUtils.lerp(
      this.velocity.z,
      targetVelZ,
      clamp(accelRate * deltaSeconds, 0, 1)
    );

    // Jump & Gravity (single jump, no infinite jumping while airborne)
    if (this.isGrounded) {
      if (input.jump && this.waterDepth < 0.7) {
        this.velocity.y = this.jumpForce;
        this.isGrounded = false;
        this.characterModel.triggerJump((2 * this.jumpForce) / Math.abs(this.gravity));
      } else {
        this.velocity.y = 0;
      }
    } else {
      this.velocity.y += this.gravity * deltaSeconds;
      // Clamp terminal fall velocity
      this.velocity.y = Math.max(-28.0, this.velocity.y);
    }

    // 3. Positional displacement
    const deltaX = this.velocity.x * deltaSeconds;
    const deltaZ = this.velocity.z * deltaSeconds;
    const nextX = this.position.x + deltaX;
    const nextZ = this.position.z + deltaZ;

    // 4. Collision Detection against SpatialGrid
    const resolvedPos = this.resolveCollisions(nextX, nextZ, this.position.y);
    this.position.x = resolvedPos.x;
    this.position.z = resolvedPos.z;

    // Vertical Position & Floor Detection
    // (ground is flat y = 0 everywhere except the curved-road chunk: hills, road surface, bridge decks)
    const gyLand = groundHeightAt(this.position.x, this.position.z, this.position.y);
    // water (sea, pond, stream): depth = surface - bottom. Deep water floats the character at chest height with a small bob.
    const wSurf = waterSurfaceAt(this.position.x, this.position.z);
    this.waterDepth = Math.max(0, wSurf - gyLand);
    this.swimClock += deltaSeconds;
    const gy = this.waterDepth > SWIM_DEPTH ? wSurf - SWIM_DEPTH + Math.sin(this.swimClock * 2.2) * 0.035 : gyLand;
    this.position.y += this.velocity.y * deltaSeconds;
    if (this.isGrounded && this.velocity.y <= 0) {
      // stay glued to slopes; smoothed so kerbs and small steps do not pop
      this.position.y += (gy - this.position.y) * clamp(30 * deltaSeconds, 0, 1);
      if (Math.abs(gy - this.position.y) < 0.01) this.position.y = gy;
    } else if (this.position.y <= gy) {
      this.position.y = gy;
      this.velocity.y = 0;
      this.isGrounded = true;
    }

    // Sync mesh position
    this.characterModel.group.position.copy(this.position);

    // 5. Smooth Character Rotation towards movement direction
    const horizontalSpeed = Math.sqrt(
      this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z
    );

    if (hasMoveInput) {
      this.targetFacingAngle = Math.atan2(moveDirX, moveDirZ);
    }

    // Follow-camera: like a normal third-person game, the camera swings round behind the direction the character is
    // running, so the player never has to turn it by hand. Straight ahead needs no turning; it pauses while the player
    // is dragging the camera and eases back in ~1 s after they let go, and it does not spin when walking backwards.
    if (hasMoveInput && horizontalSpeed > 0.5 && vy > -0.25 && this.lookIdle > 1.0) {
      let yawDiff = this.targetFacingAngle + Math.PI - this.targetCameraYaw;
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
      const fade = clamp((this.lookIdle - 1.0) / 0.5, 0, 1);
      const maxStep = (isSprinting ? 2.2 : 1.7) * deltaSeconds * fade; // rad per frame cap
      this.targetCameraYaw += clamp(yawDiff * 2.4 * deltaSeconds * fade, -maxStep, maxStep);
    }

    if (!cm.isTurning && (hasMoveInput || horizontalSpeed > 0.05)) {
      let diff = this.targetFacingAngle - this.characterModel.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      // the body swings round to the walking direction at a human pace (it lags the travel direction a little, which is what
      // lets the legs side-step through a sharp change of direction instead of the body snapping round)
      const maxTurn = (isSprinting ? 3.5 : 4.5) * deltaSeconds;
      this.characterModel.group.rotation.y += clamp(diff * clamp(10.0 * deltaSeconds, 0, 1), -maxTurn, maxTurn);
    }

    // 6. Character Kinematic Animation Tick
    const speedRatio = horizontalSpeed / this.walkSpeed;
    this.characterModel.updateAnimation(deltaSeconds, speedRatio, this.isGrounded);

    // 7. Update Third-Person Camera with Collision Obstruction checks
    this.updateCamera(deltaSeconds);

    return {
      isMoving: horizontalSpeed > 0.1,
      isSprinting,
    };
  }

  // ---------------------------------------------------------------- car sequence (vehicles/CarRider.ts)

  /**
   * One frame of walking towards `target` at `speed` (m/s) with the normal gait, collisions and ground following. Unlike
   * scriptedWalkTo it does not take over the camera. Returns whether the target was reached and the distance still to go.
   */
  public autoWalk(target: { x: number; z: number }, deltaSeconds: number, speed: number): { arrived: boolean; remaining: number; moved: number } {
    const g = this.characterModel.group;
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const arrived = dist < 0.12;
    let moved = 0;
    if (!arrived) {
      const step = Math.min(dist, speed * deltaSeconds);
      const resolved = this.resolveCollisions(this.position.x + (dx / dist) * step, this.position.z + (dz / dist) * step, this.position.y);
      moved = Math.hypot(resolved.x - this.position.x, resolved.z - this.position.z);
      this.position.x = resolved.x;
      this.position.z = resolved.z;
      // face the way it walks
      const heading = Math.atan2(dx, dz);
      let diff = heading - g.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      g.rotation.y += diff * clamp(12 * deltaSeconds, 0, 1);
    }
    this.velocity.set(0, 0, 0);
    this.position.y = groundHeightAt(this.position.x, this.position.z, this.position.y + 0.6);
    this.isGrounded = true;
    g.position.copy(this.position);
    this.characterModel.updateAnimation(deltaSeconds, moved / Math.max(deltaSeconds, 1e-4) / this.walkSpeed, true);
    return { arrived, remaining: Math.max(0, dist - moved), moved };
  }

  /**
   * One frame of turning on the spot towards heading `yaw` (turn clip for big angles, a quick ease for the rest) with the idle
   * animation. Returns true once it faces that way.
   */
  public faceYaw(yaw: number, deltaSeconds: number): boolean {
    const g = this.characterModel.group;
    const wrap = (a: number) => {
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      return a;
    };
    if (!this.characterModel.isTurning) {
      const diff = wrap(yaw - g.rotation.y);
      if (Math.abs(diff) >= TURN_MIN_ANGLE) this.characterModel.startTurn(diff);
      else g.rotation.y += diff * clamp(10 * deltaSeconds, 0, 1);
    }
    g.position.copy(this.position);
    this.characterModel.updateAnimation(deltaSeconds, 0, true);
    return !this.characterModel.isTurning && Math.abs(wrap(yaw - g.rotation.y)) < 0.05;
  }

  /** Puts the character exactly there (feet position and heading) and forgets any speed. The rider calls it every frame of a clip. */
  public placeExternal(x: number, y: number, z: number, yaw: number): void {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.isGrounded = true;
    const g = this.characterModel.group;
    g.position.copy(this.position);
    g.rotation.y = yaw;
  }

  /**
   * Scripted locomotion used by cinematic sequences (travel departure / arrival).
   * Walks towards `target` ignoring input, plays the walk cycle, and swings the camera behind
   * the character. Returns true once the target has been reached.
   */
  public scriptedWalkTo(
    target: { x: number; z: number },
    deltaSeconds: number,
    speed: number = 3.4
  ): boolean {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const arrived = dist < 0.3;

    let moved = 0;
    if (!arrived) {
      const step = Math.min(dist, speed * deltaSeconds);
      const nx = this.position.x + (dx / dist) * step;
      const nz = this.position.z + (dz / dist) * step;
      const resolved = this.resolveCollisions(nx, nz, this.position.y);
      this.position.x = resolved.x;
      this.position.z = resolved.z;
      moved = step / Math.max(deltaSeconds, 1e-4);

      // Face the walking direction
      const heading = Math.atan2(dx, dz);
      let diff = heading - this.characterModel.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.characterModel.group.rotation.y += diff * clamp(12 * deltaSeconds, 0, 1);

      // Camera glides to sit behind the walking direction
      let yawDiff = heading + Math.PI - this.targetCameraYaw;
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
      this.targetCameraYaw += yawDiff * clamp(2.2 * deltaSeconds, 0, 1);
    }

    this.velocity.set(0, 0, 0);
    this.position.y = groundHeightAt(this.position.x, this.position.z, this.position.y + 0.6);
    this.isGrounded = true;
    this.characterModel.group.position.copy(this.position);

    const damp = clamp(10 * deltaSeconds, 0, 1);
    this.currentCameraYaw += (this.targetCameraYaw - this.currentCameraYaw) * damp;
    this.currentCameraPitch += (FOOT_PITCH + 0.02 - this.currentCameraPitch) * damp;
    this.targetCameraDistance += (FOOT_DISTANCE * 0.85 - this.targetCameraDistance) * clamp(2 * deltaSeconds, 0, 1);

    this.characterModel.updateAnimation(deltaSeconds, moved / this.walkSpeed, true);
    this.updateCamera(deltaSeconds);
    return arrived;
  }

  /** does a collider block a body standing at height y (feet) 1.8 m tall? Bridge rails / piers carry a vertical extent so that walkers on the road UNDER a flyover (or ON the deck) are not blocked by the other level. */
  private blocksAt(box: { y0?: number; y1?: number }, y: number, height = 1.8): boolean {
    if (box.y0 === undefined && box.y1 === undefined) return true;
    return y < (box.y1 ?? Infinity) && y + height > (box.y0 ?? -Infinity);
  }

  /** pushes a circle out of the buildings and obstacles (the car drives with a few of these along its body) */
  public collideCircle(x: number, z: number, radius: number, y = this.position.y): { x: number; z: number } {
    return this.resolveCollisions(x, z, y, radius);
  }

  /**
   * Pushes the car's real footprint (a rectangle, see vehicles/CarCollision.ts) out of the buildings and obstacles that reach its
   * height. `y` = the car's ground height, `height` = how tall the car is. Returns the pushed centre, or null when it is free.
   */
  public collideCarBox(x: number, z: number, yaw: number, halfWidth: number, halfLength: number, y: number, height: number): { x: number; z: number } | null {
    const near = this.collisionGrid.queryRadius(x, z, halfLength + halfWidth + 1.0);
    const boxes = near.filter((b) => this.blocksAt(b, y, height));
    return boxes.length ? pushCarOutOfBoxes(x, z, yaw, halfWidth, halfLength, boxes) : null;
  }

  private resolveCollisions(nextX: number, nextZ: number, y = this.position.y, radius = this.playerRadius): { x: number; z: number } {
    let currentX = nextX;
    let currentZ = nextZ;

    const nearbyBoxes = this.collisionGrid.queryRadius(
      currentX,
      currentZ,
      radius + 2.0
    );

    for (let pass = 0; pass < 2; pass++) {
      for (const box of nearbyBoxes) {
        if (!this.blocksAt(box, y)) continue;
        const result = checkCircleBoxCollision(
          currentX,
          currentZ,
          radius,
          box.minX,
          box.maxX,
          box.minZ,
          box.maxZ
        );

        if (result.collides) {
          currentX += result.pushX;
          currentZ += result.pushZ;
        }
      }
    }

    return { x: currentX, z: currentZ };
  }

  /**
   * Lightweight camera collision raycast against SpatialGrid obstacles
   */
  private checkCameraObstruction(
    px: number,
    pz: number,
    idealCx: number,
    idealCz: number,
    desiredDist: number,
    minDist: number
  ): number {
    const nearbyBoxes = this.collisionGrid.queryRadius(px, pz, desiredDist + 1.5);
    let clampedDist = desiredDist;
    const dx = idealCx - px;
    const dz = idealCz - pz;

    for (const box of nearbyBoxes) {
      if (!this.blocksAt(box, this.position.y, 3.2)) continue;
      // 2D segment intersection with bounding box (with 0.25m cushion)
      const bMinX = box.minX - 0.25;
      const bMaxX = box.maxX + 0.25;
      const bMinZ = box.minZ - 0.25;
      const bMaxZ = box.maxZ + 0.25;

      const tHit = rayBoxIntersectFraction(px, pz, dx, dz, bMinX, bMaxX, bMinZ, bMaxZ);
      if (tHit !== null && tHit >= 0 && tHit < 1.0) {
        const hitDist = tHit * desiredDist;
        if (hitDist < clampedDist) {
          clampedDist = Math.max(minDist, hitDist - 0.3);
        }
      }
    }

    return clampedDist;
  }

  /**
   * The camera. On foot it hangs behind the character's upper torso with a soft lag. In the car (vehicleEase 1) it hangs behind the CAR:
   * the pivot is the car itself (not the swaying seat), it follows it rigidly (a camera that lags a fast car slides the car back and
   * forth in the frame every time the speed changes: that was the "car glitching backwards" while driving), and only the angles and the
   * height are smoothed. vehicleEase moves between the two, so getting in and out is one continuous glide.
   */
  private updateCamera(deltaSeconds: number): void {
    const e = this.vehicleEase;
    const snap = deltaSeconds >= 1.0;

    // pivot: character torso (Y ~ 1.35) -> the car's middle, a little above its roof line
    let tx = this.position.x;
    let ty = this.position.y + 1.35;
    let tz = this.position.z;
    if (e > 0) {
      if (snap) this.vehicleY = this.vehicle.y;
      else this.vehicleY += (this.vehicle.y - this.vehicleY) * (1 - Math.exp(-10 * deltaSeconds));
      tx += (this.vehicle.x - tx) * e;
      tz += (this.vehicle.z - tz) * e;
      ty += (this.vehicleY + 1.3 - ty) * e;
    }
    const target = this.camTarget.set(tx, ty, tz);

    // spherical offset: further back and a touch higher in the car
    const pitch = this.currentCameraPitch + DRIVE_EXTRA_PITCH * e;
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const desiredDist = this.targetCameraDistance + DRIVE_EXTRA_DISTANCE * e;

    const fullCx = target.x + Math.sin(this.currentCameraYaw) * cosPitch * desiredDist;
    const fullCz = target.z + Math.cos(this.currentCameraYaw) * cosPitch * desiredDist;

    // Check building obstruction along ray to camera (in the car it may not pull in as far, and it eases in and out slowly:
    // a building edge sliding past must not make the car jump nearer and further)
    const collisionAllowedDist = this.checkCameraObstruction(target.x, target.z, fullCx, fullCz, desiredDist, 1.8 + 1.6 * e);

    if (snap) {
      this.currentActualDistance = collisionAllowedDist;
    } else {
      const rateIn = 24.0 - 15.0 * e;
      const rateOut = 12.0 - 8.0 * e;
      const rate = collisionAllowedDist < this.currentActualDistance ? rateIn : rateOut;
      this.currentActualDistance += (collisionAllowedDist - this.currentActualDistance) * (1 - Math.exp(-rate * deltaSeconds));
    }

    // Actual spherical camera coordinates
    const cx = target.x + Math.sin(this.currentCameraYaw) * cosPitch * this.currentActualDistance;
    const cy = target.y + sinPitch * this.currentActualDistance;
    const cz = target.z + Math.cos(this.currentCameraYaw) * cosPitch * this.currentActualDistance;

    // Never let camera drop below minimum height above ground
    // (refY = the player's own height: the camera must not hop onto a flyover deck that passes over the player).
    // The ground under the camera is smoothed: driving over a kerb must not lift the camera in one frame.
    const floor = groundHeightAt(cx, cz, this.position.y + 1.6) + 0.5;
    if (snap) this.camFloor = floor;
    else this.camFloor += (floor - this.camFloor) * (1 - Math.exp(-9 * deltaSeconds));
    const safeCy = Math.max(0.4, this.camFloor, cy);
    const idealCamPos = this.camIdeal.set(cx, safeCy, cz);

    // Looking up: the camera cannot sink below the ground, so past that point the camera stays low and the view itself tilts up
    // (the character slides down the screen and more sky / building shows). The look point is raised so the view keeps the angle the
    // player asked for; when the camera is not held up by the ground this is exactly the character's torso, so nothing changes there.
    if (pitch < 0) {
      const h = cosPitch * this.currentActualDistance;
      target.y = Math.max(target.y, safeCy + Math.tan(-pitch) * h);
    }

    if (snap) {
      this.smoothCamPos.copy(idealCamPos);
      this.smoothCamTarget.copy(target);
    } else {
      // follow rate 16/s on foot (soft lag) -> rigid in the car
      const follow = 16.0 + 984.0 * e * e * e;
      const lerpFactor = e > 0.999 ? 1 : clamp(follow * deltaSeconds, 0, 1);
      this.smoothCamPos.lerp(idealCamPos, lerpFactor);
      this.smoothCamTarget.lerp(target, lerpFactor);
    }

    this.camera.position.copy(this.smoothCamPos);
    this.camera.lookAt(this.smoothCamTarget);
  }
}

/**
 * 2D Ray vs Axis-Aligned Bounding Box segment intersection fraction (0 to 1)
 */
function rayBoxIntersectFraction(
  px: number,
  pz: number,
  dx: number,
  dz: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number
): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;

  if (Math.abs(dx) > 1e-6) {
    const t1 = (minX - px) / dx;
    const t2 = (maxX - px) / dx;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  } else if (px < minX || px > maxX) {
    return null;
  }

  if (Math.abs(dz) > 1e-6) {
    const t1 = (minZ - pz) / dz;
    const t2 = (maxZ - pz) / dz;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  } else if (pz < minZ || pz > maxZ) {
    return null;
  }

  if (tmax >= tmin && tmax >= 0) {
    return tmin >= 0 ? tmin : tmax;
  }

  return null;
}
