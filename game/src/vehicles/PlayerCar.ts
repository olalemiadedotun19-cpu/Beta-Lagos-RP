import * as THREE from 'three';
import { groundHeightAt } from '../world/CurvedRoads';
import type { PlayerController } from '../player/PlayerController';
import {
  buildBmwI8,
  disposeBmwI8,
  stepBmwDoors,
  setBmwDoor,
  bmwDoorOpenness,
  steerBmwWheels,
  rollBmwWheels,
  BMW_HALF_WIDTH,
  BMW_TRACK,
  BMW_WHEELBASE,
} from './bmw/BmwI8';
import type { CarPose, Side } from './carGeometry';

/** free space between the side of the car (over its mirrors) and the character, in metres */
const SIDE_GAP = 0.85;
/** the car never leans further than this on uneven ground (radians) */
const MAX_TILT = 0.3;
/** gravity for the car in the air (m/s^2): a little above real, so jumps feel weighty rather than floaty at 100+ km/h */
const AIR_GRAVITY = 15;
/** the car only counts as flying (no steering / gas / grip) once its wheels are this far off the ground (m): kerb hops do not cut the controls */
const AIR_CONTROL_HEIGHT = 0.25;
/** how far the nose and tail reach from the middle of the wheelbase (m) */
const NOSE_Z = 2.2;
const TAIL_Z = 2.1;
/** largest vertical speed a slope may give the car when it drives off the end of it (m/s) */
const MAX_LAUNCH = 12;

/**
 * The player's BMW i8: summoned from the phone, parked on the character's right-hand side, sent away from the phone.
 * It is built the first time it is spawned (a couple of seconds) and kept for the next spawn.
 */
export class PlayerCar {
  private car: THREE.Group | null = null;
  private building: Promise<THREE.Group> | null = null;
  /** true from the moment the car is asked for until it is sent away (also while it is still loading) */
  private wanted = false;
  private disposed = false;
  /** where the car stands (set when it is placed) */
  private pose: CarPose & { y: number } = { x: 0, y: 0, z: 0, yaw: 0 };
  /** the ride height / pitch / roll the body currently shows while driving (smoothed so kerbs and bumps do not snap the whole car) */
  private ride: { y: number; pitch: number; roll: number; vy: number; air: boolean } | null = null;
  /** how far the middle of the car is above the ground under it (0 on the ground) */
  private heightAboveGround = 0;
  /** front wheel angle last set (rad), for other players' copy of the car */
  private steer = 0;

  constructor(
    private scene: THREE.Scene,
    private gl: THREE.WebGLRenderer,
    private player: PlayerController
  ) {}

  get isSpawned(): boolean {
    return this.wanted;
  }

  /** true once the car is built, placed and in the scene (the character can get in) */
  get isReady(): boolean {
    return this.wanted && !!this.car && this.car.parent === this.scene && this.car.visible;
  }

  /** where the car stands: ground position under the middle of the wheelbase, heading, ground height */
  getPose(): (CarPose & { y: number }) | null {
    return this.isReady ? this.pose : null;
  }

  /**
   * The car as other players see it (see net/protocol.ts NetCar), or null when it is not out. Still reported while the character is
   * inside a building: the car stays parked outside, only its local visibility is switched off.
   */
  getNetState(): { x: number; y: number; z: number; r: number; p: number; l: number; s: number; dl: number; dr: number } | null {
    const c = this.car;
    if (!this.wanted || !c || c.parent !== this.scene) return null;
    return {
      x: c.position.x,
      y: c.position.y,
      z: c.position.z,
      r: c.rotation.y,
      p: -c.rotation.x,
      l: c.rotation.z,
      s: this.steer,
      dl: this.doorOpenness('L') > 0.5 ? 1 : 0,
      dr: this.doorOpenness('R') > 0.5 ? 1 : 0,
    };
  }

  /** opens / closes one of the two doors (they swing on their own over 0.9 s: call update every frame) */
  setDoor(side: Side, open: boolean): void {
    if (this.car) setBmwDoor(this.car, side, open);
  }

  /** 0 (closed) .. 1 (open) */
  doorOpenness(side: Side): number {
    return this.car ? bmwDoorOpenness(this.car, side) : 0;
  }

  update(dt: number): void {
    if (this.car && this.car.parent) stepBmwDoors(this.car, dt);
  }

  /** Puts the car on the character's right, parallel to the way the character faces. */
  async spawn(): Promise<void> {
    if (this.wanted) return;
    this.wanted = true;
    try {
      if (!this.car) {
        this.building ??= buildBmwI8(this.gl);
        const built = await this.building;
        if (this.disposed) {
          disposeBmwI8(built);
          return;
        }
        this.car = built;
      }
    } catch (e) {
      this.building = null; // try again next time
      this.wanted = false;
      throw e;
    }
    if (!this.wanted) return; // sent away while it was still loading
    this.place(this.car);
    this.scene.add(this.car);
  }

  despawn(): void {
    this.wanted = false;
    if (this.car) {
      this.scene.remove(this.car);
      // doors shut for the next spawn (it is out of the scene, so nothing would animate them)
      for (const side of ['L', 'R'] as Side[]) {
        setBmwDoor(this.car, side, false);
        const d = (this.car.userData.doors as Record<Side, { open: number }> | undefined)?.[side];
        if (d) d.open = 0;
      }
      stepBmwDoors(this.car, 0);
    }
  }

  /** The car is hidden while the character is inside a building. */
  setVisible(visible: boolean): void {
    if (this.car) this.car.visible = visible;
  }

  dispose(): void {
    this.disposed = true;
    this.wanted = false;
    if (this.car) {
      this.scene.remove(this.car);
      disposeBmwI8(this.car);
      this.car = null;
    }
  }

  private place(car: THREE.Group): void {
    const p = this.player.position;
    // the way the character faces: forward = (sin yaw, cos yaw), so its right-hand side = (-cos yaw, sin yaw)
    const yaw = this.player.characterModel.group.rotation.y;
    const side = BMW_HALF_WIDTH + SIDE_GAP;
    this.setCarPose(car, p.x - Math.cos(yaw) * side, p.z + Math.sin(yaw) * side, yaw, p.y + 0.6);
  }

  /** true while the car is really in the air (ramp, crest, bridge end): the wheels cannot steer or push, the car just flies */
  get isAirborne(): boolean {
    return !!this.ride && this.ride.air && this.heightAboveGround > AIR_CONTROL_HEIGHT;
  }

  /** how high the car is above the ground (m) */
  get airHeight(): number {
    return this.ride?.air ? this.heightAboveGround : 0;
  }

  /**
   * Puts the car at (x, z) heading `yaw`. Parked (no `drive`): it sits on the ground under each wheel and takes its pitch and roll from
   * the slope. Driving: the body RIDES the ground like a real car, it is not glued to it. On a slope it moves up / down at the speed
   * the slope gives it (slope x speed); when the ground falls away faster than gravity can pull the car down (the end of a ramp, a
   * hill crest, a bridge edge) it leaves the ground and flies on its own arc until the ground comes back up to meet it.
   */
  private setCarPose(car: THREE.Group, x: number, z: number, yaw: number, refY: number, drive?: { dt: number; speed: number }): void {
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // height under each wheel (car frame: +z nose, +x left), so the car sits on slopes and kerbs instead of floating or sinking
    const hf = BMW_WHEELBASE / 2;
    const ht = BMW_TRACK / 2;
    const h = (lx: number, lz: number) => groundHeightAt(x + lx * cos + lz * sin, z - lx * sin + lz * cos, refY);
    const frontLeft = h(ht, hf);
    const frontRight = h(-ht, hf);
    const rearLeft = h(ht, -hf);
    const rearRight = h(-ht, -hf);

    const clamp = (v: number) => Math.max(-MAX_TILT, Math.min(MAX_TILT, v));
    const groundPitch = clamp(Math.atan2((frontLeft + frontRight) / 2 - (rearLeft + rearRight) / 2, BMW_WHEELBASE)); // nose up
    const groundRoll = clamp(Math.atan2((frontLeft + rearLeft) / 2 - (frontRight + rearRight) / 2, BMW_TRACK)); // left side up
    let ground = (frontLeft + frontRight + rearLeft + rearRight) / 4;

    // The body is longer than the wheelbase and the belly hangs between the axles: on a crest or at the foot of a slope the nose, the tail or
    // the belly would sink into the terrain even though all four wheels are on it. Check the ground under those three points against
    // the body's line (underside heights: nose 0.2 m, belly 0.12 m, tail 0.15 m) and lift the car until they clear (at most 0.4 m).
    {
      const line = Math.tan(groundPitch);
      const need = (lz: number, clearance: number) => h(0, lz) - (ground + line * lz + clearance);
      const lift = Math.max(need(NOSE_Z, 0.2), need(0, 0.12), need(-TAIL_Z, 0.15), 0);
      ground += Math.min(lift, 0.4);
    }

    if (!drive || !this.ride) {
      // parked / just placed: sit on the ground
      this.ride = { y: ground, pitch: groundPitch, roll: groundRoll, vy: 0, air: false };
    } else {
      const r = this.ride;
      const dt = Math.min(drive.dt, 0.05);
      // the speed the ground itself moves the car up / down at: slope x speed along the nose (reversing up a slope goes down it)
      const slopeVy = Math.max(-MAX_LAUNCH, Math.min(MAX_LAUNCH, Math.tan(groundPitch) * drive.speed));
      if (!r.air) {
        // is the ground now below the path the car would take on its own (the body keeps its vertical speed, gravity pulls)?
        const freeY = r.y + r.vy * dt - 0.5 * AIR_GRAVITY * dt * dt;
        if (freeY - ground > 0.04) r.air = true;
      }
      if (r.air) {
        r.vy -= AIR_GRAVITY * dt;
        r.y += r.vy * dt;
        if (r.y <= ground) {
          // touchdown: the ground catches the car (the tilt then eases back to the slope below, quickly: it lands with a thump)
          r.air = false;
          r.y = ground;
          r.vy = slopeVy;
        }
      } else {
        // on the ground: ride the slope with the speed it gives (no lag on a ramp), and ease out any step (a kerb) over ~50 ms
        r.vy = slopeVy;
        const predicted = r.y + slopeVy * dt;
        r.y = predicted + (ground - predicted) * (1 - Math.exp(-18 * dt));
      }
      if (r.air) {
        // in the air the nose follows the arc (rising: up, falling: down) and the car levels out sideways
        const flight = Math.atan2(r.vy * (drive.speed < 0 ? -1 : 1), Math.abs(drive.speed) + 2);
        const wanted = Math.max(-MAX_TILT * 1.6, Math.min(MAX_TILT * 1.6, flight));
        r.pitch += (wanted - r.pitch) * (1 - Math.exp(-2.5 * dt));
        r.roll += (0 - r.roll) * (1 - Math.exp(-1.5 * dt));
      } else {
        const k = 1 - Math.exp(-14 * dt);
        r.pitch += (groundPitch - r.pitch) * k;
        r.roll += (groundRoll - r.roll) * k;
      }
    }
    const r = this.ride!;
    this.heightAboveGround = Math.max(0, r.y - ground);

    car.rotation.order = 'YXZ';
    car.rotation.set(-r.pitch, yaw, r.roll);
    car.position.set(x, r.y, z);
    this.pose = { x, y: car.position.y, z, yaw };
    car.updateMatrixWorld(true);
  }

  /** Drives the parked car: moves it to (x, z) heading `yaw` (called every frame while the player drives). */
  setPose(x: number, z: number, yaw: number, dt = 0, speed = 0): void {
    if (!this.car) return;
    this.setCarPose(this.car, x, z, yaw, this.pose.y + 0.6, dt > 0 ? { dt, speed } : undefined);
  }

  /** turns the steering wheel in the cabin and the two front wheels: front wheel angle in rad (+ = left) */
  setSteering(steerAngle: number): void {
    this.steer = steerAngle;
    if (!this.car) return;
    const wheel = this.car.userData.steeringWheel as THREE.Object3D | undefined;
    if (wheel) wheel.rotation.z = -steerAngle * 2.6; // about 1.6 rad of wheel for the full 0.62 rad of lock
    steerBmwWheels(this.car, steerAngle);
  }

  /** rolls the four wheels with the car's speed along its nose (m/s, negative = reversing); the handbrake locks the rear pair */
  rollWheels(forwardSpeed: number, dt: number, handbrake: boolean): void {
    if (this.car) rollBmwWheels(this.car, forwardSpeed, dt, handbrake);
  }
}
