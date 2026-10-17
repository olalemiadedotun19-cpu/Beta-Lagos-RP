import * as THREE from 'three';
import { buildBmwI8, disposeBmwI8, rollBmwWheels, setBmwDoor, steerBmwWheels, stepBmwDoors } from '../vehicles/bmw/BmwI8';
import type { NetCar } from './protocol';

/** try to build a car again after a failed build only this many seconds later */
const RETRY_AFTER = 15;

/**
 * Another player's BMW. It is the same model the local player's car uses, parked or driven wherever its owner's updates say
 * (position, heading, pitch, roll, steering and doors all come over the network; the wheels roll with the speed measured here).
 * Built the first time a car is needed (a couple of seconds), then kept until the owner leaves.
 */
export class RemoteCar {
  private car: THREE.Group | null = null;
  private building = false;
  private disposed = false;
  private failedAt = -Infinity;
  private lastX = 0;
  private lastZ = 0;
  private haveLast = false;
  /** doors the local player is working (getting into this car): they win over what the owner's updates say */
  private readonly doorOverride: { L: boolean | null; R: boolean | null } = { L: null, R: null };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly gl: THREE.WebGLRenderer
  ) {}

  private ensureBuilt(nowSeconds: number): void {
    if (this.car || this.building || this.disposed || nowSeconds - this.failedAt < RETRY_AFTER) return;
    this.building = true;
    buildBmwI8(this.gl)
      .then((car) => {
        this.building = false;
        if (this.disposed) {
          disposeBmwI8(car);
          return;
        }
        car.visible = false;
        this.scene.add(car);
        this.car = car;
      })
      .catch((e) => {
        this.building = false;
        this.failedAt = performance.now() / 1000;
        console.warn('Could not build a remote player\'s car', e);
      });
  }

  /** Opens / closes a door for the local player getting in or out; `null` hands the door back to the owner's updates. */
  setDoorOverride(side: 'L' | 'R', open: boolean | null): void {
    this.doorOverride[side] = open;
  }

  /** Puts the car where `c` says. `visible` false hides it without losing it (out of range / the viewer is inside a building). */
  apply(c: NetCar, dt: number, visible: boolean): void {
    if (!visible) {
      if (this.car) this.car.visible = false;
      this.haveLast = false;
      return;
    }
    if (!this.car) {
      this.ensureBuilt(performance.now() / 1000);
      return;
    }
    const car = this.car;
    car.visible = true;
    car.rotation.order = 'YXZ';
    car.rotation.set(-c.p, c.r, c.l);
    car.position.set(c.x, c.y, c.z);
    setBmwDoor(car, 'L', this.doorOverride.L ?? c.dl > 0.5);
    setBmwDoor(car, 'R', this.doorOverride.R ?? c.dr > 0.5);
    stepBmwDoors(car, dt);
    const wheel = car.userData.steeringWheel as THREE.Object3D | undefined;
    if (wheel) wheel.rotation.z = -c.s * 2.6;
    steerBmwWheels(car, c.s);
    // wheel roll from the speed along the nose, measured between frames
    let forward = 0;
    if (this.haveLast && dt > 0) {
      const dx = c.x - this.lastX;
      const dz = c.z - this.lastZ;
      if (dx * dx + dz * dz < (60 * dt) ** 2) forward = (dx * Math.sin(c.r) + dz * Math.cos(c.r)) / dt;
    }
    this.lastX = c.x;
    this.lastZ = c.z;
    this.haveLast = true;
    rollBmwWheels(car, forward, dt, false);
  }

  dispose(): void {
    this.disposed = true;
    if (this.car) {
      this.scene.remove(this.car);
      disposeBmwI8(this.car);
      this.car = null;
    }
  }
}
