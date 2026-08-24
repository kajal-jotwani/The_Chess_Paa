"use client";

import * as THREE from "three";

/**
 * FREE LOOK & WANDER — native on the iPad, native on the laptop.
 *
 * This is NOT a desktop control scheme that also tolerates touch. Both inputs
 * are first-class:
 *   • touch: one finger orbits, two fingers pinch to dolly, tap to interact
 *   • mouse: drag orbits, wheel dollies, hover is honest
 *   • keyboard: arrows/WASD nudge, so a laptop user is never stuck dragging
 *
 * Motion is spring-damped with a soft, kid-friendly lag — a child should feel
 * they are leaning to look, not driving a camera.
 */

export interface FreeLookOptions {
  /** What we orbit around. */
  target: THREE.Vector3;
  minDistance?: number;
  maxDistance?: number;
  /** Clamp so a child can never end up under the snow or staring at the sky. */
  minPolar?: number;
  maxPolar?: number;
  /** Optional yaw clamp, for attraction pockets that should stay facing in. */
  yawCenter?: number;
  yawRange?: number;
  distance?: number;
}

export class FreeLookController {
  private el: HTMLElement | null = null;
  private opts: Required<Omit<FreeLookOptions, "yawCenter" | "yawRange">> & {
    yawCenter?: number; yawRange?: number;
  };

  // where we are, and where we want to be (spring-damped between)
  private yaw = 0;
  private pitch = 0.28;
  private dist: number;
  private wantYaw = 0;
  private wantPitch = 0.28;
  private wantDist: number;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private pinchStart = 0;
  private pinchDist = 0;
  private keys = new Set<string>();
  private enabled = true;

  constructor(opts: FreeLookOptions) {
    this.opts = {
      target: opts.target,
      minDistance: opts.minDistance ?? 4,
      maxDistance: opts.maxDistance ?? 30,
      minPolar: opts.minPolar ?? 0.06,
      maxPolar: opts.maxPolar ?? 1.15,
      distance: opts.distance ?? 12,
      yawCenter: opts.yawCenter,
      yawRange: opts.yawRange,
    };
    this.dist = this.wantDist = this.opts.distance;
    if (opts.yawCenter !== undefined) {
      this.yaw = this.wantYaw = opts.yawCenter;
    }
  }

  attach(el: HTMLElement) {
    this.detach();
    this.el = el;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("touchstart", this.onTouchStart, { passive: false });
    el.addEventListener("touchmove", this.onTouchMove, { passive: false });
    el.addEventListener("touchend", this.onTouchEnd);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    // A child dragging to look should never accidentally select page text or
    // trigger the browser's pull-to-refresh.
    el.style.touchAction = "none";
    el.style.userSelect = "none";
  }

  detach() {
    const el = this.el;
    if (!el) return;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onUp);
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("touchstart", this.onTouchStart);
    el.removeEventListener("touchmove", this.onTouchMove);
    el.removeEventListener("touchend", this.onTouchEnd);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.el = null;
  }

  setEnabled(v: boolean) { this.enabled = v; if (!v) this.dragging = false; }
  setTarget(t: THREE.Vector3) { this.opts.target = t; }
  setDistance(d: number) { this.wantDist = THREE.MathUtils.clamp(d, this.opts.minDistance, this.opts.maxDistance); }

  /** True while the user is actively dragging — used to suppress taps. */
  get isDragging() { return this.dragging; }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled || e.pointerType === "touch") return; // touch handled below
    this.dragging = true;
    this.lastX = e.clientX; this.lastY = e.clientY;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.dragging || e.pointerType === "touch") return;
    this.orbitBy(e.clientX - this.lastX, e.clientY - this.lastY);
    this.lastX = e.clientX; this.lastY = e.clientY;
  };

  private onUp = () => { this.dragging = false; };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.setDistance(this.wantDist + e.deltaY * 0.012);
  };

  private onTouchStart = (e: TouchEvent) => {
    if (!this.enabled) return;
    if (e.touches.length === 1) {
      this.dragging = true;
      this.lastX = e.touches[0].clientX;
      this.lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      this.dragging = false;
      this.pinchStart = this.touchSpread(e);
      this.pinchDist = this.wantDist;
    }
  };

  private onTouchMove = (e: TouchEvent) => {
    if (!this.enabled) return;
    if (e.touches.length === 1 && this.dragging) {
      e.preventDefault();
      const t = e.touches[0];
      // Touch gets a slightly gentler gain than mouse — fingers travel further.
      this.orbitBy((t.clientX - this.lastX) * 0.8, (t.clientY - this.lastY) * 0.8);
      this.lastX = t.clientX; this.lastY = t.clientY;
    } else if (e.touches.length === 2) {
      e.preventDefault();
      const spread = this.touchSpread(e);
      if (this.pinchStart > 0) {
        this.setDistance(this.pinchDist * (this.pinchStart / Math.max(1, spread)));
      }
    }
  };

  private onTouchEnd = () => { this.dragging = false; this.pinchStart = 0; };

  private touchSpread(e: TouchEvent): number {
    const [a, b] = [e.touches[0], e.touches[1]];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  private onKeyDown = (e: KeyboardEvent) => { this.keys.add(e.key.toLowerCase()); };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };

  private orbitBy(dx: number, dy: number) {
    this.wantYaw -= dx * 0.005;
    this.wantPitch = THREE.MathUtils.clamp(
      this.wantPitch + dy * 0.004, this.opts.minPolar, this.opts.maxPolar
    );
    if (this.opts.yawCenter !== undefined && this.opts.yawRange !== undefined) {
      this.wantYaw = THREE.MathUtils.clamp(
        this.wantYaw,
        this.opts.yawCenter - this.opts.yawRange,
        this.opts.yawCenter + this.opts.yawRange
      );
    }
  }

  /** Call every frame. Writes the camera's position and orientation. */
  update(camera: THREE.PerspectiveCamera, dt: number) {
    if (this.enabled) {
      // keyboard nudge, so a laptop is never stuck dragging
      const k = this.keys;
      const kx = (k.has("arrowright") || k.has("d") ? 1 : 0) - (k.has("arrowleft") || k.has("a") ? 1 : 0);
      const ky = (k.has("arrowdown") || k.has("s") ? 1 : 0) - (k.has("arrowup") || k.has("w") ? 1 : 0);
      if (kx || ky) this.orbitBy(-kx * 260 * dt, ky * 160 * dt);
    }

    // Spring-damped: the camera arrives a beat after the finger, which reads
    // as weight rather than lag.
    const s = 1 - Math.exp(-dt * 6.5);
    this.yaw += (this.wantYaw - this.yaw) * s;
    this.pitch += (this.wantPitch - this.pitch) * s;
    this.dist += (this.wantDist - this.dist) * (1 - Math.exp(-dt * 5));

    const t = this.opts.target;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    camera.position.set(
      t.x + Math.sin(this.yaw) * cp * this.dist,
      t.y + sp * this.dist,
      t.z + Math.cos(this.yaw) * cp * this.dist
    );
    camera.lookAt(t);
  }
}
