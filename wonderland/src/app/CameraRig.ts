import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { tween, Easing } from "../core/Tween";
import { heightAt } from "../world/Ground";

export type RigMode = "orbit" | "fly" | "seat" | "board" | "locked";

/**
 * One camera, several behaviours: free orbit around the park, cinematic
 * fly-to tweens, a seat on the coaster, and a fixed board view.
 */
export class CameraRig {
  readonly controls: OrbitControls;
  mode: RigMode = "orbit";
  private seat: THREE.Object3D | null = null;
  private seatLook = new THREE.Vector3();
  private idle = 0;
  private lookTarget = new THREE.Vector3(0, 2, 0);
  /** seat mode: a drag lets the rider glance sideways at the park; it eases back to straight ahead on release */
  private seatYaw = 0;
  private dragging = false;
  private lastX = 0;

  constructor(readonly camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.controls = new OrbitControls(camera, dom);
    dom.addEventListener("pointerdown", (e) => { if (this.mode !== "seat") return; this.dragging = true; this.lastX = e.clientX; });
    dom.addEventListener("pointermove", (e) => { if (!this.dragging || this.mode !== "seat") return; this.seatYaw = THREE.MathUtils.clamp(this.seatYaw + (e.clientX - this.lastX) * 0.004, -1.05, 1.05); this.lastX = e.clientX; });
    const release = () => { this.dragging = false; };
    dom.addEventListener("pointerup", release); dom.addEventListener("pointercancel", release); dom.addEventListener("pointerleave", release);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minPolarAngle = 0.15;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 190;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.8;
    this.controls.target.set(0, 2, -6);
    camera.position.set(0, 70, 130);
    this.controls.addEventListener("start", () => { this.idle = 0; });
  }

  /** Cinematic move to a pose; returns when finished. */
  async flyTo(pos: THREE.Vector3, look: THREE.Vector3, seconds = 1.8, ease = Easing.inOut) {
    this.mode = "fly";
    this.controls.enabled = false;
    const p0 = this.camera.position.clone(), l0 = this.lookTarget.clone();
    // arc a little upward mid-flight so we never clip through rides
    const mid = p0.clone().lerp(pos, 0.5); mid.y = Math.max(mid.y, Math.max(p0.y, pos.y) + p0.distanceTo(pos) * 0.12);
    await tween(seconds, (k) => {
      const a = p0.clone().lerp(mid, k), b = mid.clone().lerp(pos, k);
      this.camera.position.copy(a.lerp(b, k));
      this.lookTarget.copy(l0).lerp(look, k);
      this.camera.lookAt(this.lookTarget);
    }, ease).promise;
    this.camera.position.copy(pos);
    this.lookTarget.copy(look);
    this.camera.lookAt(look);
  }

  /** Hand control back to the user, orbiting around `look`. */
  orbitAround(look: THREE.Vector3, minD = 8, maxD = 190) {
    this.mode = "orbit";
    this.controls.target.copy(look);
    this.controls.minDistance = minD;
    this.controls.maxDistance = maxD;
    this.controls.enabled = true;
    this.controls.update();
  }

  /** Sit in a coaster/train seat: the camera follows the object each frame. */
  sitIn(seat: THREE.Object3D, lookAhead = new THREE.Vector3(0, 0.4, -6)) {
    this.mode = "seat";
    this.controls.enabled = false;
    this.seat = seat;
    this.seatLook.copy(lookAhead);
    this.seatYaw = 0; this.dragging = false;
  }

  /** Board view: fixed cinematic pose, no user orbit, but a gentle breathing drift. */
  async boardView(center: THREE.Vector3, yaw: number, seconds = 1.6) {
    const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    // the pose is tuned for landscape; in a portrait phone (aspect ~0.46) pull back a
    // little so the whole board plus its rank/file labels fit inside the narrow frustum
    const k = THREE.MathUtils.clamp(0.62 / this.camera.aspect, 1, 1.6);
    const pos = center.clone().addScaledVector(back, 6.8 * k).add(new THREE.Vector3(0, 6.6 * k, 0));
    pos.y = Math.max(pos.y, heightAt(pos.x, pos.z) + 3);
    const look = center.clone().add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(back, -0.3);
    await this.flyTo(pos, look, seconds);
    this.mode = "board";
    this.controls.target.copy(look);
    this.controls.minDistance = 4; this.controls.maxDistance = 16 * k;
    this.controls.minPolarAngle = 0.2; this.controls.maxPolarAngle = Math.PI * 0.44;
    this.controls.enabled = true;
    this.controls.update();
  }

  lock() { this.mode = "locked"; this.controls.enabled = false; }

  update(dt: number) {
    if (this.mode === "orbit" || this.mode === "board") {
      this.idle += dt;
      this.controls.autoRotate = this.mode === "orbit" && this.idle > 6;
      this.controls.autoRotateSpeed = 0.35;
      this.controls.update();
      this.lookTarget.copy(this.controls.target);
      // keep above terrain
      const minY = heightAt(this.camera.position.x, this.camera.position.z) + 2.5;
      if (this.camera.position.y < minY) this.camera.position.y = minY;
    } else if (this.mode === "seat" && this.seat) {
      const p = this.seat.getWorldPosition(new THREE.Vector3());
      const q = this.seat.getWorldQuaternion(new THREE.Quaternion());
      this.camera.position.lerp(p, 1 - Math.exp(-dt * 30));
      // blend the up vector with the seat's up so loops feel like loops
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      if (!this.dragging) this.seatYaw *= Math.exp(-dt * 1.2);
      const look = p.clone().add(this.seatLook.clone().applyQuaternion(q).applyAxisAngle(up, this.seatYaw));
      this.camera.up.lerp(up, 1 - Math.exp(-dt * 6)).normalize();
      this.camera.lookAt(look);
      this.lookTarget.copy(look);
    }
    if (this.mode !== "seat") this.camera.up.lerp(new THREE.Vector3(0, 1, 0), 1 - Math.exp(-dt * 4)).normalize();
  }
}
