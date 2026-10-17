import { groundHeightAt, waterSurfaceAt } from '../world/CurvedRoads';
import type { PlayerController } from '../player/PlayerController';
import type { PlayerCar } from './PlayerCar';
import clipData from '../player/figure/assets/clips.json';
import { sampleCarClip, blendRoot, type CarClipSet, type CarClipName, type RootSample } from './carClips';
import { newDriveState, stepDrive, groundSpeed, forwardSpeed, slipSpeed, type DriveInput, type DriveState, type DriveWorld } from './CarDriving';
import { beginTelemetry, endTelemetry, stepTelemetry } from './DriveTelemetry';
import { EngineSound } from './EngineSound';
import { driveControls, resetDriveControls } from './DriveControls';
import {
  distanceToCar,
  nearestDoor,
  planApproach,
  rootToWorld,
  seatToCar,
  wrapPi,
  type CarPose,
  type Side,
} from './carGeometry';

/** what the rider needs to know about other players' cars (provided by the multiplayer layer, see GameEngine) */
export interface SharedCars {
  /** the nearest other player's car within `maxDistance` (m, to its footprint) of (x, z) */
  nearest(x: number, z: number, maxDistance: number): { uid: string; name: string; distance: number } | null;
  /** where that car is drawn right now, how fast it moves, and which side its driver sits on (null: nobody drives it) */
  view(uid: string): { x: number; y: number; z: number; yaw: number; speed: number; driverSide: Side | null } | null;
  /** is somebody already in, or getting into, that seat of the car of player `hostUid`? */
  seatTaken(hostUid: string, side: Side): boolean;
  /** works a door of somebody's car for the local player; null gives it back to the owner */
  setDoor(uid: string, side: Side, open: boolean | null): void;
  /** the local player's own uid (the host of the local car) */
  ownUid(): string | null;
}

const CURVES = (clipData as unknown as { meta: { car: { clips: CarClipSet } } }).meta.car.clips;

/** the "car" button shows up when the character is this close to the car (m, to its footprint); it stays until this far */
export const CAR_BUTTON_NEAR = 6;
const CAR_BUTTON_FAR = 7.5;
/** walking pace to the door: a brisk walk, a jog when the car is far */
const APPROACH_SPEED = 2.2;
const APPROACH_SPEED_FAR = 3.6;
const APPROACH_FAR_FROM = 8;
/** a walk that makes no headway for this long is given up (something is in the way of the door) */
const STUCK_SECONDS = 1.3;
/** the stick pushed this far while walking to the door cancels it */
const CANCEL_STICK = 0.4;
/** another player's car must be this slow (m/s) before the character walks up to it */
const RIDE_MAX_SPEED = 1.5;

export type CarButton = 'enter' | 'exit' | null;
type Phase = 'idle' | 'approach' | 'face' | 'enter' | 'seated' | 'exit';

/** the car's footprint for collisions with buildings and obstacles: a rectangle the size of the body (metres, half sizes; mirrors may graze) and its height */
const CAR_HALF_WIDTH = 1.04;
const CAR_HALF_LENGTH = 2.34;
const CAR_HEIGHT = 1.35;
/** the car moves at most this far (m) between two collision tests, so even at top speed it cannot skip through a wall */
const MAX_STEP_DISTANCE = 0.3;
/** the car must be this slow (m/s) before the character can get out */
const EXIT_MAX_SPEED = 2.5;
/** physics runs in steps of at most this many seconds (a long frame is split so a fast car cannot skip through a wall) */
const PHYSICS_STEP = 1 / 60;

const smooth = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

/**
 * Gets the character into the player's car and out again.
 *
 * Press "car" near it: the nearest door is chosen (left = driver's seat, right = passenger's), the character walks round the car to
 * the spot beside that door (the spot the Entering_Car clip starts from), turns to face it, and the clip plays: the door swings open
 * when the hand is on the handle, the character steps in, sits, and the door is pulled shut. Then the Driving pose loops until
 * "exit" is pressed, which plays Exiting_Car the same way round. The clips only carry the pose; the root motion (position and heading
 * in the seat frame, see scripts/locomotion/bake_car_clips.py) is applied here. The right-hand door uses the same clips with the
 * character mirrored (scale.x = -1) and the root motion mirrored.
 *
 * While it runs the PlayerController is in externalControl mode: the rider moves, turns and animates the character.
 */
export class CarRider {
  private phase: Phase = 'idle';
  private side: Side = 'L';
  private pose: CarPose & { y: number } = { x: 0, y: 0, z: 0, yaw: 0 };
  /** clip time (enter / exit) or seated time */
  private t = 0;
  private near = false;
  private route: { x: number; z: number }[] = [];
  private stuck = 0;
  /** where the character really stood when the clip began, minus where the clip wants it: fades out as the clip pose takes over */
  private err = { x: 0, z: 0, yaw: 0 };
  /** root the character had when the current clip took over (blended into the clip's own with the pose weight) */
  private from: RootSample | null = null;
  private lastRoot: RootSample = { x: 0, z: 0, yaw: 0, dy: 0, inside: 0 };
  /** the car's motion while it is being driven (position, heading, velocity: carried between frames) */
  private drive: DriveState = newDriveState(0, 0, 0);
  private readonly world: DriveWorld = {
    collide: (x, z, yaw) => this.collideCar(x, z, yaw),
    blocked: (x, z, yaw) => this.inWater(x, z, yaw),
  };
  /** after leaving by the right-hand door the character is still mirrored: flipped back once it stands still */
  private mirrored = false;
  private stillFor = 0;
  private readonly engine = new EngineSound();
  /** other players' cars (null while playing offline): set by the engine */
  shared: SharedCars | null = null;
  /** set while the character gets into / sits in / leaves ANOTHER player's car (as a passenger); null for the player's own car */
  private ride: { uid: string; name: string } | null = null;
  private rideSpeed = 0;

  constructor(
    private player: PlayerController,
    private car: PlayerCar,
    private tell: (message: string) => void
  ) {}

  /** what the HUD should offer right now */
  get button(): CarButton {
    if (this.phase === 'seated') return 'exit';
    if (this.phase === 'idle' && this.near) return 'enter';
    return null;
  }

  /** true from pressing "car" until the character is out again (also while walking to the door) */
  get active(): boolean {
    return this.phase !== 'idle';
  }

  get isSeated(): boolean {
    return this.phase === 'seated';
  }

  /**
   * What other players need to draw this character's car sequence (see net/protocol.ts): k = 0 none (also while still walking to the
   * door), 1 getting in, 2 driving, 3 getting out; t = clip time; mirrored = the right-hand (passenger) door.
   */
  get netClip(): { k: 0 | 1 | 2 | 3; t: number; mirrored: boolean; host: string | null } {
    const mirrored = this.side === 'R';
    const host = this.ride?.uid ?? null;
    switch (this.phase) {
      case 'enter':
        return { k: 1, t: this.t, mirrored, host };
      case 'seated':
        return { k: 2, t: this.t, mirrored, host };
      case 'exit':
        return { k: 3, t: this.t, mirrored, host };
      default:
        return { k: 0, t: 0, mirrored: false, host: null };
    }
  }

  /** the car being used right now: another player's (where it is drawn) or the player's own */
  private hostPose(): (CarPose & { y: number }) | null {
    if (this.ride) {
      const v = this.shared?.view(this.ride.uid);
      return v ? { x: v.x, y: v.y, z: v.z, yaw: v.yaw } : null;
    }
    return this.car.getPose();
  }

  private setDoor(side: Side, open: boolean): void {
    if (this.ride) this.shared?.setDoor(this.ride.uid, side, open);
    else this.car.setDoor(side, open);
  }

  /** false when the car is gone, or (another player's car) has driven off since the walk to it began */
  private carOk(): boolean {
    const pose = this.hostPose();
    if (!pose) return false;
    if (this.ride && (Math.hypot(pose.x - this.pose.x, pose.z - this.pose.z) > 0.6 || Math.abs(wrapPi(pose.yaw - this.pose.yaw)) > 0.2)) return false;
    return true;
  }

  /** the HUD button was pressed */
  press(): { ok: boolean; message?: string } {
    if (this.phase === 'seated') {
      if ((this.ride ? this.rideSpeed : groundSpeed(this.drive)) > EXIT_MAX_SPEED) return { ok: false, message: 'Stop the car before you get out.' };
      this.beginExit();
      return { ok: true };
    }
    if (this.phase !== 'idle') return { ok: false };
    return this.beginEnter();
  }

  /** the car is being sent away or the world is being left: drop whatever is going on */
  abort(): void {
    if (this.phase === 'idle') return;
    const wasIn = this.phase === 'enter' || this.phase === 'seated' || this.phase === 'exit';
    if (wasIn) {
      this.setDoor(this.side, false);
      if (!this.ride) this.car.setSteering(0);
      // put the character beside the driver's door, on the ground
      const out = rootToWorld(this.pose, this.side, { x: CURVES.carExit.x[CURVES.carExit.x.length - 1], z: CURVES.carExit.z[CURVES.carExit.z.length - 1], yaw: CURVES.carExit.yaw[CURVES.carExit.yaw.length - 1] });
      const y = groundHeightAt(out.x, out.z, this.player.position.y + 0.6);
      this.player.placeExternal(out.x, y, out.z, out.yaw);
    }
    this.release();
  }

  dispose(): void {
    this.engine.dispose();
    endTelemetry();
  }

  update(dt: number): void {
    dt = Math.min(Math.max(dt, 0), 0.1);
    switch (this.phase) {
      case 'idle':
        this.updateIdle(dt);
        break;
      case 'approach':
        this.updateApproach(dt);
        break;
      case 'face':
        this.updateFace(dt);
        break;
      case 'enter':
        this.updateClip('carEnter', dt);
        break;
      case 'seated':
        this.updateSeated(dt);
        break;
      case 'exit':
        this.updateClip('carExit', dt);
        break;
    }
  }

  // ---------------------------------------------------------------- idle: is there a car to get into?

  private updateIdle(dt: number): void {
    const pose = this.car.getPose();
    const range = this.near ? CAR_BUTTON_FAR : CAR_BUTTON_NEAR;
    const px = this.player.position.x;
    const pz = this.player.position.z;
    // the player's own car, or (failing that) any other player's car close by
    this.near = (!!pose && distanceToCar(pose, px, pz) <= range) || !!this.shared?.nearest(px, pz, range);
    // back to the normal, un-mirrored character once it has been standing still for a moment
    if (this.mirrored) {
      this.stillFor = this.player.moveInputMagnitude < 0.05 ? this.stillFor + dt : 0;
      if (this.stillFor > 0.7) {
        this.player.characterModel.group.scale.x = 1;
        this.mirrored = false;
      }
    }
  }

  // ---------------------------------------------------------------- walking to the door

  private beginEnter(): { ok: boolean; message?: string } {
    const own = this.car.getPose();
    const p = this.player.position;
    // the player's own car first; another player's car when it is the closer one (or the player has none out)
    const other = this.shared?.nearest(p.x, p.z, CAR_BUTTON_FAR) ?? null;
    const useOther = !!other && (!own || other.distance < distanceToCar(own, p.x, p.z));
    if (!own && !other) return { ok: false, message: 'The car is not here.' };
    if (this.player.waterDepth > 0.4) return { ok: false, message: "You can't get in the car from the water." };
    const start = CURVES.carEnter;
    const spotL = seatToCar('L', start.x[0], start.z[0]);
    let pose: CarPose & { y: number };
    if (useOther && other && this.shared) {
      const v = this.shared.view(other.uid);
      if (!v) return { ok: false, message: 'The car is not here.' };
      if (v.speed > RIDE_MAX_SPEED) return { ok: false, message: `${other.name}'s car is moving. Wait for it to stop.` };
      // somebody else's car: the passenger seat (the side opposite its driver)
      const side: Side = v.driverSide === 'R' ? 'L' : 'R';
      if (this.shared.seatTaken(other.uid, side)) return { ok: false, message: `${other.name}'s car is full.` };
      pose = { x: v.x, y: v.y, z: v.z, yaw: v.yaw };
      this.ride = { uid: other.uid, name: other.name };
      this.side = side;
    } else {
      pose = own!;
      this.ride = null;
      this.side = nearestDoor(pose, p.x, p.z, spotL.x, spotL.z);
      // somebody is already sitting on that side of the player's own car: take the other one
      const me = this.shared?.ownUid();
      if (me && this.shared!.seatTaken(me, this.side)) {
        const free: Side = this.side === 'L' ? 'R' : 'L';
        if (this.shared!.seatTaken(me, free)) return { ok: false, message: 'Your car is full.' };
        this.side = free;
      }
    }
    this.pose = { ...pose };
    const spot = rootToWorld(pose, this.side, { x: start.x[0], z: start.z[0], yaw: start.yaw[0] });
    this.route = planApproach(pose, { x: p.x, z: p.z }, spot);
    this.stuck = 0;
    this.phase = 'approach';
    this.engine.prime(); // browsers only allow audio after a tap: this is inside the car button's press
    this.player.externalControl = true;
    this.player.characterModel.cancelTurn();
    return { ok: true };
  }

  private cancelApproach(message?: string): void {
    this.release();
    if (message) this.tell(message);
  }

  private release(): void {
    if (this.ride) {
      this.shared?.setDoor(this.ride.uid, this.side, null); // the door goes back to the owner's updates
      this.ride = null;
    }
    this.rideSpeed = 0;
    this.engine.stop();
    endTelemetry();
    this.phase = 'idle';
    this.player.setVehicleCamera(false);
    resetDriveControls();
    this.player.externalControl = false;
    this.player.characterModel.setCarClip(null);
    this.from = null;
    this.stillFor = 0;
    this.near = false; // a mirrored character is flipped back by updateIdle once it stands still
  }

  private updateApproach(dt: number): void {
    if (!this.carOk()) return this.cancelApproach(this.ride ? 'The car drove off.' : undefined);
    if (this.player.moveInputMagnitude > CANCEL_STICK) return this.cancelApproach();
    const wp = this.route[0];
    const last = this.route.length === 1;
    const toGo = Math.hypot(wp.x - this.player.position.x, wp.z - this.player.position.z);
    const speed = toGo + (last ? 0 : 3) > APPROACH_FAR_FROM ? APPROACH_SPEED_FAR : APPROACH_SPEED;
    const r = this.player.autoWalk(wp, dt, speed);
    this.stuck = r.moved < speed * dt * 0.25 ? this.stuck + dt : 0;
    if (this.stuck > STUCK_SECONDS) return this.cancelApproach('Something is in the way of the door.');
    if (r.arrived || (!last && r.remaining < 0.6)) {
      this.route.shift();
      if (this.route.length === 0) this.phase = 'face';
    }
  }

  private updateFace(dt: number): void {
    if (!this.carOk()) return this.cancelApproach(this.ride ? 'The car drove off.' : undefined);
    if (this.player.moveInputMagnitude > CANCEL_STICK) return this.cancelApproach();
    const start = CURVES.carEnter;
    const want = rootToWorld(this.pose, this.side, { x: start.x[0], z: start.z[0], yaw: start.yaw[0] }).yaw;
    if (!this.player.faceYaw(want, dt)) return;
    this.beginClip();
  }

  // ---------------------------------------------------------------- the clips

  private beginClip(): void {
    const c = CURVES.carEnter;
    const intended = rootToWorld(this.pose, this.side, { x: c.x[0], z: c.z[0], yaw: c.yaw[0] });
    const g = this.player.characterModel.group;
    this.err = { x: this.player.position.x - intended.x, z: this.player.position.z - intended.z, yaw: wrapPi(g.rotation.y - intended.yaw) };
    this.mirrored = this.side === 'R';
    g.scale.x = this.mirrored ? -1 : 1;
    this.t = 0;
    this.from = null;
    this.phase = 'enter';
    this.player.characterModel.cancelTurn();
    this.player.characterModel.setCarClip('carEnter', 0);
    // from here on the camera glides from the character to behind the car (it keeps going while the clip plays)
    this.player.setVehicleCamera(true);
    this.updateClip('carEnter', 0);
  }

  private beginExit(): void {
    this.drive.vx = 0;
    this.drive.vz = 0;
    if (!this.ride) this.car.setSteering(0);
    this.engine.stop();
    endTelemetry();
    this.player.setVehicleCamera(false); // the camera glides back to the character
    resetDriveControls();
    this.t = 0;
    this.from = this.lastRoot;
    this.phase = 'exit';
    this.err = { x: 0, z: 0, yaw: 0 };
    this.player.characterModel.setCarClip('carExit', 0);
  }

  private fire(clip: CarClipName, prev: number, now: number): void {
    const ev = CURVES[clip].events;
    if (ev.doorOpen !== undefined && prev < ev.doorOpen && now >= ev.doorOpen) this.setDoor(this.side, true);
    if (ev.doorClose !== undefined && prev < ev.doorClose && now >= ev.doorClose) this.setDoor(this.side, false);
  }

  /** enter / exit: step the clip, place the character from the baked root motion, run the door events */
  private updateClip(clip: 'carEnter' | 'carExit', dt: number): void {
    if (this.ride) {
      // another player's car: follow it where it is drawn; if it vanishes (owner left / sent it away) step out
      const live = this.hostPose();
      if (!live) {
        this.abort();
        this.tell('The car is gone.');
        return;
      }
      this.pose = live;
    }
    const c = CURVES[clip];
    const prev = this.t;
    this.t = Math.min(this.t + dt, c.dur);
    this.fire(clip, prev, this.t);
    let root = sampleCarClip(c, this.t);
    const model = this.player.characterModel;
    model.setCarClip(clip, this.t);
    const blend = model.carBlend;
    if (this.from) root = blendRoot(this.from, root, blend);
    this.applyRoot(root, clip === 'carEnter' ? 1 - blend : 0);
    model.updateAnimation(dt, 0, true);
    this.player.setVehicleAnchor(this.pose.x, this.pose.y, this.pose.z, this.pose.yaw, 0);
    if (this.t >= c.dur) {
      if (clip === 'carEnter') {
        this.phase = 'seated';
        this.t = 0;
        this.from = root;
        this.drive = newDriveState(this.pose.x, this.pose.z, this.pose.yaw);
        resetDriveControls();
        this.rideSpeed = 0;
        if (!this.ride) {
          beginTelemetry();
          this.engine.start();
        }
        model.setCarClip('carDrive', 0);
      } else {
        this.finishExit();
      }
    }
  }

  private updateSeated(dt: number): void {
    this.t += dt;
    const model = this.player.characterModel;

    // ---- a passenger just rides along with the car (its owner drives it)
    if (this.ride) {
      const live = this.hostPose();
      if (!live) {
        this.abort();
        this.tell('The car is gone.');
        return;
      }
      this.rideSpeed = this.shared?.view(this.ride.uid)?.speed ?? 0;
      this.pose = live;
      this.player.setVehicleAnchor(live.x, live.y, live.z, live.yaw, this.rideSpeed);
    } else if (this.car.getPose()) {
      // ---- drive the car
      const driver = this.readDriveInput();
      // in the air the wheels have nothing to grip: no gas, brake or steering until they touch down again
      const input: DriveInput = this.car.isAirborne ? { throttle: 0, brake: 0, steer: 0, drift: false } : driver;
      const steps = Math.min(16, Math.max(1, Math.ceil(dt / PHYSICS_STEP), Math.ceil((groundSpeed(this.drive) * dt) / MAX_STEP_DISTANCE)));
      for (let i = 0; i < steps; i++) {
        stepDrive(this.drive, input, dt / steps, this.world);
      }
      const fwd = forwardSpeed(this.drive);
      this.car.setPose(this.drive.x, this.drive.z, this.drive.yaw, dt, fwd);
      this.car.setSteering(this.drive.steerAngle);
      this.car.rollWheels(fwd, dt, input.drift);
      stepTelemetry(dt, groundSpeed(this.drive), fwd, input.throttle, input.brake);
      this.engine.update(dt, { speed: fwd, throttle: driver.throttle, slip: this.car.isAirborne ? 0 : slipSpeed(this.drive), handbrake: input.drift });
      const live = this.car.getPose();
      if (live) this.pose = { ...live };
      // the camera follows the car itself and swings round behind it (unless the player is dragging it)
      this.player.setVehicleAnchor(this.pose.x, this.pose.y, this.pose.z, this.pose.yaw, groundSpeed(this.drive));
    }

    // ---- the seated character goes wherever the car goes
    model.setCarClip('carDrive', this.t);
    let root = sampleCarClip(CURVES.carDrive, 0);
    if (this.from) {
      root = blendRoot(this.from, root, model.carBlend);
      if (model.carBlend > 0.999) this.from = null;
    }
    this.applyRoot(root, 0);
    model.updateAnimation(dt, 0, true);
  }

  /** keys (W/S or arrows = gas / brake, A/D = steer, Space = drift) and the on-screen buttons, together */
  private readDriveInput(): DriveInput {
    const p = this.player;
    const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
    const c = driveControls;
    return {
      throttle: clamp(Math.max(p.moveInput.y, 0) + (c.gas ? 1 : 0), 0, 1),
      brake: clamp(Math.max(-p.moveInput.y, 0) + (c.brake ? 1 : 0), 0, 1),
      steer: clamp(-p.moveInput.x + (c.left ? 1 : 0) - (c.right ? 1 : 0), -1, 1),
      drift: c.drift || p.jumpHeld,
    };
  }

  /** pushes the car out of buildings and obstacles: its whole rectangle, not a few circles; null when it is free */
  private collideCar(x: number, z: number, yaw: number): { x: number; z: number } | null {
    return this.player.collideCarBox(x, z, yaw, CAR_HALF_WIDTH, CAR_HALF_LENGTH, this.pose.y, CAR_HEIGHT);
  }

  /** deep water (the sea, a pond, a stream) under the middle or the ends of the car: it stops and bounces back instead */
  private inWater(x: number, z: number, yaw: number): boolean {
    if (this.car.airHeight > 0.8) return false; // flying over it
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    for (const lz of [-1.9, 0, 1.9]) {
      const px = x + sin * lz;
      const pz = z + cos * lz;
      const w = waterSurfaceAt(px, pz);
      if (w > -1e6 && w > groundHeightAt(px, pz, this.pose.y + 0.6) + 0.12) return true;
    }
    return false;
  }

  private finishExit(): void {
    // the clip ends with the character standing outside, walking away: the controller takes over from there
    this.release();
    this.err = { x: 0, z: 0, yaw: 0 };
  }

  /** puts the character where the root motion says: position through the seat frame -> car frame -> world, heights from the ground / the car floor */
  private applyRoot(r: RootSample, errWeight: number): void {
    const w = rootToWorld(this.pose, this.side, r);
    const x = w.x + this.err.x * errWeight;
    const z = w.z + this.err.z * errWeight;
    const yaw = w.yaw + this.err.yaw * errWeight;
    const ground = groundHeightAt(x, z, this.player.position.y + 0.6);
    const y = ground + (this.pose.y - ground) * r.inside + r.dy;
    this.player.placeExternal(x, y, z, yaw);
    this.lastRoot = r;
  }
}
