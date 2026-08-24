"use client";

import * as THREE from "three";
import { rng } from "../core/textures/procedural";

/**
 * THE CHESSPAA RIG — headless.
 *
 * Everything in this file is maths. No React, no geometry, no materials.
 * `ChessPaa.tsx` builds the plush body and reads this rig every frame;
 * `Grandchildren.tsx` reuses the springs, the chain and the IK. Any other
 * scene that wants a warm, breathing, hand-animated character can too.
 *
 * WHY it is built this way:
 *
 *   1. NOTHING SNAPS. Every pose value is a spring, so a mood change is a
 *      settle, never a cut. A cut is the single fastest way to make a
 *      character read as a puppet instead of a person.
 *
 *   2. AMPLITUDES SPRING, OSCILLATORS DO NOT. Breath, jabber, chuckle-shake
 *      and sway are evaluated straight from elapsed time; only how MUCH of
 *      each plays is spring-smoothed. That keeps the whole rig deterministic
 *      for the screenshot harness (same `t` → same frame) while still easing
 *      between moods.
 *
 *   3. THE REST POSE IS THE GOOD POSE. If the frame loop never ran, ChessPaa
 *      would stand in a relaxed, weight-on-one-foot, arms-down pose — never a
 *      T-pose. Animation only ever ADDS to that. A frozen ChessPaa is still a
 *      handsome ChessPaa.
 *
 *   4. SECONDARY MOTION IS SIMULATED, NOT KEYED. Beard, scarf tail and the
 *      lantern are verlet/pendulum chains driven by where their anchor
 *      actually went. They arrive a beat late for free, which is the whole
 *      trick — cheap, stable, and impossible to fake convincingly by hand.
 */

/* ================================================================== *
 * SCRATCH — module scope so the frame loop allocates nothing.
 * ================================================================== */
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _m0 = new THREE.Matrix4();

/** Limb geometry in this project hangs DOWN from its joint. */
export const BONE_DOWN = /* @__PURE__ */ new THREE.Vector3(0, -1, 0);

/* ================================================================== *
 * 1.  SPRINGS
 * ================================================================== */

/**
 * A damped spring with an explicit damping ratio.
 *
 * zeta = 1 is critical (settles fast, never overshoots) — the default, and
 * what you want for almost every pose value. zeta ~0.55 overshoots, which is
 * exactly the anticipation-and-follow-through you want on a pointing arm or
 * a bobble hat: the hand throws past the target and eases back.
 *
 * Integrated semi-implicitly with a clamped step so it cannot explode when a
 * tab is backgrounded and dt arrives as 3 seconds.
 */
export class Spring {
  value: number;
  velocity = 0;
  target: number;
  /** Natural frequency, rad/s. */
  omega: number;
  /** Damping ratio. 1 = critical. */
  zeta: number;

  constructor(value = 0, halfLife = 0.15, zeta = 1) {
    this.value = value;
    this.target = value;
    this.omega = omegaFromHalfLife(halfLife);
    this.zeta = zeta;
  }

  /** Retune responsiveness without disturbing the current state. */
  tune(halfLife: number, zeta = this.zeta): this {
    this.omega = omegaFromHalfLife(halfLife);
    this.zeta = zeta;
    return this;
  }

  /** Teleport — use on mount, never mid-shot. */
  snap(v: number): this {
    this.value = v;
    this.target = v;
    this.velocity = 0;
    return this;
  }

  to(t: number): this {
    this.target = t;
    return this;
  }

  step(h: number): number {
    const k = this.omega * this.omega;
    const c = 2 * this.zeta * this.omega;
    // Substepped INSIDE the spring, so the guarantee in the class comment is
    // actually the class's own. This integrator goes unstable above h = 2/omega
    // and our stiffest tunes put that at ~0.02 s — a single raw step(0.5) used
    // to run away to 1e38. 0.4/omega is comfortably inside the limit and costs
    // exactly one iteration at every step size the park actually feeds it.
    const maxH = 0.4 / this.omega;
    let acc = Math.min(1, Math.max(0, h));
    while (acc > 1e-9) {
      const dt = Math.min(maxH, acc);
      this.velocity += (-k * (this.value - this.target) - c * this.velocity) * dt;
      this.value += this.velocity * dt;
      acc -= dt;
    }
    return this.value;
  }
}

/** Three springs sharing a tuning — used for IK targets. */
export class SpringVec3 {
  readonly value = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  omega: number;
  zeta: number;

  constructor(halfLife = 0.16, zeta = 1) {
    this.omega = omegaFromHalfLife(halfLife);
    this.zeta = zeta;
  }

  tune(halfLife: number, zeta = this.zeta): this {
    this.omega = omegaFromHalfLife(halfLife);
    this.zeta = zeta;
    return this;
  }

  snap(v: THREE.Vector3): this {
    this.value.copy(v);
    this.target.copy(v);
    this.velocity.set(0, 0, 0);
    return this;
  }

  to(v: THREE.Vector3): this {
    this.target.copy(v);
    return this;
  }

  step(h: number): THREE.Vector3 {
    const k = this.omega * this.omega;
    const c = 2 * this.zeta * this.omega;
    // Same internal substep as Spring — these carry the IK hand targets, and
    // an exploded hand target is an arm flung off the character.
    const maxH = 0.4 / this.omega;
    let acc = Math.min(1, Math.max(0, h));
    while (acc > 1e-9) {
      const dt = Math.min(maxH, acc);
      _v0.subVectors(this.value, this.target).multiplyScalar(-k);
      _v0.addScaledVector(this.velocity, -c);
      this.velocity.addScaledVector(_v0, dt);
      this.value.addScaledVector(this.velocity, dt);
      acc -= dt;
    }
    return this.value;
  }
}

/** Half-life (seconds to close half the gap) → natural frequency. */
export function omegaFromHalfLife(halfLife: number): number {
  // For a critically damped spring x(t) = (1+wt)e^-wt; x = 0.5 at wt ≈ 1.6783.
  return 1.6783469 / Math.max(1e-3, halfLife);
}

/**
 * Three incommensurate sines. Reads as gentle organic noise, never repeats
 * inside a play session, costs nothing, and is perfectly reproducible — which
 * matters because the screenshot harness poses cameras at fixed times.
 * Range is roughly -1..1.
 */
export function fbmSin(t: number, seed = 0): number {
  return (
    Math.sin(t * 1.0 + seed * 1.7) * 0.55 +
    Math.sin(t * 1.618 + seed * 3.1) * 0.3 +
    Math.sin(t * 2.718 + seed * 5.9) * 0.15
  );
}

/** Ease that starts fast and settles — good for gesture accents. */
export function easeOutBack(p: number, overshoot = 1.7): number {
  const x = Math.min(1, Math.max(0, p)) - 1;
  return 1 + (overshoot + 1) * x * x * x + overshoot * x * x;
}

/* ================================================================== *
 * 2.  TWO-BONE IK
 * ================================================================== */

export interface TwoBoneIKOptions {
  upperLength: number;
  lowerLength: number;
  /**
   * The bone's local axis that points from its own joint toward the child.
   * Every limb in this project hangs down, so (0,-1,0).
   */
  boneAxis?: THREE.Vector3;
  /**
   * Fraction of full reach the solver is allowed to use. Kept under 1 on
   * purpose: a fully locked elbow is the most mannequin-looking thing a rig
   * can do, and a plush grandfather should never have one.
   */
  maxExtend?: number;
  /** Never fold tighter than this fraction of full reach. */
  minExtend?: number;
}

/**
 * Analytic two-bone IK. Sets `upper` and `lower` local quaternions so the end
 * of `lower` lands on `targetWorld`, with the elbow swung toward `poleWorld`.
 *
 * Analytic rather than iterative because it is exact, allocation-free and
 * costs about twenty flops — we solve four of these per frame (two arms on
 * ChessPaa, four across the grandchildren) and never want to think about it.
 *
 * The parent chain's world matrix is refreshed first: R3F runs frame callbacks
 * BEFORE three updates the scene graph, so without this we would be solving
 * against last frame's shoulder position and the arm would smear one frame
 * behind the body on every quick move.
 */
export function solveTwoBoneIK(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  targetWorld: THREE.Vector3,
  poleWorld: THREE.Vector3,
  opts: TwoBoneIKOptions
): void {
  const a = opts.upperLength;
  const b = opts.lowerLength;
  const axis = opts.boneAxis ?? BONE_DOWN;
  const maxExtend = opts.maxExtend ?? 0.985;
  const minExtend = opts.minExtend ?? 0.22;

  const parent = upper.parent;
  if (!parent) return;
  parent.updateWorldMatrix(true, false);

  // Shoulder in world space, derived from the fresh parent matrix.
  const root = _v0.copy(upper.position).applyMatrix4(parent.matrixWorld);

  // Parent world rotation (scale-safe).
  _m0.extractRotation(parent.matrixWorld);
  const parentQ = _q0.setFromRotationMatrix(_m0);

  // Reach vector, clamped so the elbow neither locks nor inverts.
  const toTarget = _v1.subVectors(targetWorld, root);
  const reach = a + b;
  let dist = toTarget.length();
  if (dist < 1e-5) {
    toTarget.set(0, -1, 0);
    dist = 1e-5;
  }
  const lo = Math.max(Math.abs(a - b) * 1.02, reach * minExtend);
  const hi = reach * maxExtend;
  const clamped = Math.min(hi, Math.max(lo, dist));
  toTarget.multiplyScalar(clamped / dist);

  // Shoulder opening angle, law of cosines.
  const cosAlpha = (a * a + clamped * clamped - b * b) / (2 * a * clamped);
  const alpha = Math.acos(Math.min(1, Math.max(-1, cosAlpha)));

  // Bend plane. Rotating `toTarget` by +alpha about normalize(toTarget × pole)
  // swings it TOWARD the pole (right-hand rule), which puts the elbow where
  // the animator asked for it.
  const poleDir = _v2.subVectors(poleWorld, root);
  const bendAxis = _v3.crossVectors(toTarget, poleDir);
  if (bendAxis.lengthSq() < 1e-10) {
    // Degenerate: pole is on the reach line. Fall back to a stable axis.
    bendAxis.set(1, 0, 0).cross(toTarget);
    if (bendAxis.lengthSq() < 1e-10) bendAxis.set(0, 0, 1);
  }
  bendAxis.normalize();

  // Upper bone direction (world), then the forearm direction from the elbow.
  const upperDir = _v2.copy(toTarget).normalize().applyAxisAngle(bendAxis, alpha);
  // elbow = root + upperDir * a  → forearm dir = target - elbow
  const lowerDir = _v3
    .copy(toTarget)
    .addScaledVector(upperDir, -a)
    .normalize();

  // World → local. setFromUnitVectors gives the minimal rotation, leaving
  // twist about the bone undefined — which is exactly right for a plush arm
  // with no wrist to speak of.
  const upperWorldQ = _q1.setFromUnitVectors(axis, upperDir);
  upper.quaternion.copy(parentQ).invert().multiply(upperWorldQ);

  // `lower`'s parent is `upper`, whose world rotation we just committed.
  const lowerWorldQ = _q0.setFromUnitVectors(axis, lowerDir);
  lower.quaternion.copy(upperWorldQ).invert().multiply(lowerWorldQ);
}

/* ================================================================== *
 * 3.  VERLET CHAIN — beards, scarf tails, bobble-hat tails
 * ================================================================== */

/**
 * A tapered capsule the chain is not allowed inside.
 *
 * One of these standing in for the torso is the difference between a scarf
 * that hangs on a chest and a scarf that saws through one. Tapered rather
 * than a plain capsule because a body is not a cylinder: ChessPaa is 0.35
 * wide at the belly and 0.18 at the collar, and a single radius that fits
 * one either eats his beard or lets the scarf sink into his coat.
 */
export interface ChainCollider {
  /** Lower axis point, chain space. */
  a: THREE.Vector3;
  /** Upper axis point, chain space. */
  b: THREE.Vector3;
  /** Radius at `a`. */
  ra: number;
  /** Radius at `b`. */
  rb: number;
}

export interface VerletChainOptions {
  /** Number of segments (points = segments + 1). */
  segments?: number;
  /** Total length, in the space the chain runs in. */
  length?: number;
  /** Downward acceleration. ~7 reads plush; 9.8 reads like real cloth. */
  gravity?: number;
  /** Velocity kept per substep. Lower = wetter, heavier cloth. */
  damping?: number;
  /** How hard the chain is pulled back toward its rest line, in rad/s. */
  restPull?: number;
  /** Cone half-angle each joint may deviate from its parent, radians. */
  maxAngle?: number;
  /** Distance-constraint relaxation passes. 2 is plenty at this length. */
  iterations?: number;
}

/**
 * A follow-the-leader verlet chain.
 *
 * Runs in the CHARACTER-ROOT's local space, not world space. That choice is
 * deliberate and it matters:
 *
 *   - Everything the character does internally (breathing, turning at the
 *     waist, throwing an arm out, tipping his head back to laugh) moves the
 *     anchor inside root space, so the beard and scarf lag behind all of it.
 *   - But re-parenting or scaling the whole character does NOT inject a
 *     spurious kick, and world scale never leaks into the segment lengths.
 *
 * Point 0 is pinned to the anchor. Every other point integrates, then a
 * downstream distance pass keeps segment lengths exact, then a cone limit
 * stops the beard from folding back through his chest.
 */
export class VerletChain {
  readonly points: THREE.Vector3[] = [];
  readonly segLength: number;
  readonly count: number;

  gravity: number;
  damping: number;
  restPull: number;
  maxAngle: number;
  iterations: number;
  /** Optional body to stay outside of. Null = no collision. */
  collider: ChainCollider | null = null;

  private prev: THREE.Vector3[] = [];
  private acc = 0;
  private primed = false;

  constructor(opts: VerletChainOptions = {}) {
    const segments = Math.max(1, opts.segments ?? 3);
    const length = opts.length ?? 0.3;
    this.count = segments + 1;
    this.segLength = length / segments;
    this.gravity = opts.gravity ?? 7;
    this.damping = opts.damping ?? 0.94;
    this.restPull = opts.restPull ?? 7;
    this.maxAngle = opts.maxAngle ?? 0.7;
    this.iterations = opts.iterations ?? 2;
    for (let i = 0; i < this.count; i++) {
      this.points.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
    }
  }

  /** Drop the chain straight onto its rest line — no settle-in wobble. */
  reset(anchor: THREE.Vector3, restDir: THREE.Vector3): void {
    for (let i = 0; i < this.count; i++) {
      this.points[i].copy(anchor).addScaledVector(restDir, this.segLength * i);
      this.prev[i].copy(this.points[i]);
    }
    this.primed = true;
    this.acc = 0;
  }

  /**
   * Advance the chain. `anchor` and `restDir` are in the chain's space;
   * `force` is an extra acceleration (wind, a gust, a coaster drop).
   */
  step(
    dt: number,
    anchor: THREE.Vector3,
    restDir: THREE.Vector3,
    force?: THREE.Vector3
  ): void {
    if (!this.primed) {
      this.reset(anchor, restDir);
      return;
    }
    // Fixed timestep: a verlet chain fed a variable dt changes stiffness with
    // framerate, which is how cloth "explodes" on a stutter.
    const H = 1 / 90;
    this.acc += Math.min(0.1, Math.max(0, dt));
    let steps = 0;
    while (this.acc >= H && steps < 8) {
      this.substep(H, anchor, restDir, force);
      this.acc -= H;
      steps++;
    }
    if (steps === 8) this.acc = 0; // never spiral on a long frame
  }

  private substep(
    h: number,
    anchor: THREE.Vector3,
    restDir: THREE.Vector3,
    force?: THREE.Vector3
  ): void {
    const k = this.restPull * this.restPull;
    for (let i = 1; i < this.count; i++) {
      const p = this.points[i];
      const pr = this.prev[i];

      // velocity from the last two positions, bled off by damping
      _v0.subVectors(p, pr).multiplyScalar(this.damping);

      // acceleration: gravity + wind + a soft pull toward the rest line
      _v1.set(0, -this.gravity, 0);
      if (force) _v1.add(force);
      _v2.copy(anchor).addScaledVector(restDir, this.segLength * i).sub(p);
      _v1.addScaledVector(_v2, k);

      pr.copy(p);
      p.add(_v0).addScaledVector(_v1, h * h);
    }

    this.points[0].copy(anchor);
    this.prev[0].copy(anchor);

    for (let it = 0; it < this.iterations; it++) {
      // Follow-the-leader: the parent point is authoritative, so the anchor's
      // motion propagates down the chain one link per pass — that propagation
      // delay IS the lag we want.
      for (let i = 1; i < this.count; i++) {
        const a = this.points[i - 1];
        const p = this.points[i];
        _v0.subVectors(p, a);
        const d = _v0.length();
        if (d < 1e-6) {
          p.copy(a).addScaledVector(restDir, this.segLength);
        } else {
          p.copy(a).addScaledVector(_v0, this.segLength / d);
        }
      }
      // Cone limit — keeps a beard out of a chest and a scarf off a face.
      for (let i = 1; i < this.count; i++) {
        const ref =
          i === 1
            ? _v1.copy(restDir)
            : _v1.subVectors(this.points[i - 1], this.points[i - 2]).normalize();
        const cur = _v2.subVectors(this.points[i], this.points[i - 1]).normalize();
        const dot = Math.min(1, Math.max(-1, cur.dot(ref)));
        const ang = Math.acos(dot);
        if (ang > this.maxAngle) {
          _v3.crossVectors(ref, cur);
          if (_v3.lengthSq() < 1e-10) continue;
          _v3.normalize();
          _q0.setFromAxisAngle(_v3, this.maxAngle);
          _v0.copy(ref).applyQuaternion(_q0).multiplyScalar(this.segLength);
          this.points[i].copy(this.points[i - 1]).add(_v0);
        }
      }
      if (this.collider) this.pushOutOfCollider();
    }
  }

  /** Project every free point to the outside of the tapered capsule. */
  private pushOutOfCollider(): void {
    const col = this.collider;
    if (!col) return;
    _v0.subVectors(col.b, col.a);
    const axisLenSq = Math.max(1e-8, _v0.lengthSq());
    for (let i = 1; i < this.count; i++) {
      const p = this.points[i];
      // closest point on the axis segment, clamped to its ends
      const tt = Math.min(1, Math.max(0, _v1.subVectors(p, col.a).dot(_v0) / axisLenSq));
      _v2.copy(col.a).addScaledVector(_v0, tt);
      const r = col.ra + (col.rb - col.ra) * tt;
      _v3.subVectors(p, _v2);
      const d = _v3.length();
      if (d < r && d > 1e-6) {
        p.copy(_v2).addScaledVector(_v3, r / d);
      } else if (d <= 1e-6) {
        // Dead centre: eject forward, the only direction that always reads.
        p.copy(_v2).add(_v1.set(0, 0, r));
      }
    }
  }

  /**
   * Pose one Object3D per segment. Each object must be a child of the chain's
   * space, and its geometry must hang from the origin along -Y with a length
   * of `segLength`.
   */
  applyToSegments(objs: THREE.Object3D[]): void {
    const n = Math.min(objs.length, this.count - 1);
    for (let i = 0; i < n; i++) {
      const a = this.points[i];
      const b = this.points[i + 1];
      objs[i].position.copy(a);
      _v0.subVectors(b, a);
      if (_v0.lengthSq() < 1e-10) continue;
      _v0.normalize();
      objs[i].quaternion.setFromUnitVectors(BONE_DOWN, _v0);
    }
  }

  /** Tip of the chain — handy for hanging a pom-pom or a tassel. */
  tip(): THREE.Vector3 {
    return this.points[this.count - 1];
  }
}

/* ================================================================== *
 * 4.  PENDULUM — the lantern
 * ================================================================== */

export interface PendulumOptions {
  /** Distance from the pivot to the centre of mass. */
  length?: number;
  gravity?: number;
  /** 0..1 — how much the pivot's own acceleration throws the bob. */
  drive?: number;
  /** Damping ratio. Under 1 so it keeps swinging for a beat or two. */
  damping?: number;
  /** Hard limit so it can never wrap over the top. */
  maxAngle?: number;
  /** Amplitude of the never-quite-still idle sway, radians. */
  idle?: number;
}

/**
 * A two-axis damped pendulum driven by its pivot's measured acceleration.
 *
 * This is what makes the lantern feel HEAVY. Nothing about the swing is keyed:
 * ChessPaa's hand moves, we measure where the hand actually went, and the
 * lantern (and therefore the pool of honey light on the snow) answers a beat
 * later. Belly-laugh and the lantern shakes. Point at the sky and it sweeps.
 */
export class Pendulum {
  /** Rotation about X — swings the bob along -Z / +Z. */
  ax = 0;
  /** Rotation about Z — swings the bob along +X / -X. */
  az = 0;

  private vx = 0;
  private vz = 0;
  private readonly last = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private primed = false;

  length: number;
  gravity: number;
  drive: number;
  damping: number;
  maxAngle: number;
  idle: number;

  constructor(o: PendulumOptions = {}) {
    this.length = o.length ?? 0.22;
    this.gravity = o.gravity ?? 9.0;
    this.drive = o.drive ?? 1.0;
    this.damping = o.damping ?? 0.34;
    this.maxAngle = o.maxAngle ?? 0.85;
    this.idle = o.idle ?? 0.045;
  }

  /** Magnitude of the current swing — feed it to the flame flicker. */
  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /**
   * @param anchor pivot position, in any consistent space (world is fine).
   * @param t      elapsed time, for the idle sway.
   */
  step(dt: number, anchor: THREE.Vector3, t: number): void {
    const h = Math.min(1 / 45, Math.max(1 / 480, dt));

    // Pivot acceleration by finite difference. Smoothed and clamped, because
    // a teleport (respawn, camera cut, tab wake) would otherwise fling the
    // lantern into orbit.
    _v0.set(0, 0, 0);
    if (this.primed) {
      _v1.subVectors(anchor, this.last).divideScalar(h);
      _v0.subVectors(_v1, this.vel).divideScalar(h);
      const m = _v0.length();
      if (m > 45) _v0.multiplyScalar(45 / m);
      this.vel.lerp(_v1, 0.5);
    } else {
      this.vel.set(0, 0, 0);
      this.primed = true;
    }
    this.last.copy(anchor);

    const w2 = this.gravity / Math.max(0.02, this.length);
    const w = Math.sqrt(w2);
    const c = 2 * this.damping * w;

    // A pivot accelerating +X leaves the bob behind at -X, which is a NEGATIVE
    // rotation about Z (Rz(+θ) carries (0,-1,0) toward +X). Same reasoning
    // flips the sign on the other axis.
    const driveZ = -(_v0.x * this.drive) / Math.max(0.02, this.length);
    const driveX = (_v0.z * this.drive) / Math.max(0.02, this.length);

    // A lantern is never perfectly still in a hand — a whisper of sway keeps
    // it alive even while he stands and listens.
    const idleX = this.idle * Math.sin(t * 0.83 + 1.7) * w2 * 0.12;
    const idleZ = this.idle * Math.sin(t * 1.13) * w2 * 0.12;

    this.vx += (-w2 * this.ax - c * this.vx + driveX + idleX) * h;
    this.vz += (-w2 * this.az - c * this.vz + driveZ + idleZ) * h;
    this.ax += this.vx * h;
    this.az += this.vz * h;

    const lim = this.maxAngle;
    if (this.ax > lim) { this.ax = lim; this.vx *= -0.25; }
    if (this.ax < -lim) { this.ax = -lim; this.vx *= -0.25; }
    if (this.az > lim) { this.az = lim; this.vz *= -0.25; }
    if (this.az < -lim) { this.az = -lim; this.vz *= -0.25; }
  }

  applyTo(o: THREE.Object3D): void {
    o.rotation.set(this.ax, 0, this.az);
  }
}

/* ================================================================== *
 * 5.  THE SKELETON
 * ================================================================== */

/**
 * ChessPaa's proportions, in world units, measured from the soles of his
 * boots. A pawn is ~1.0 tall, so at 1.70 to the cap crown (1.766 to the tip of
 * the bobble) he reads as a head taller than the pieces he teaches with — big
 * enough to be the grown-up, small enough that a child's eye holds him and the
 * board in one glance.
 *
 * Offsets are LOCAL to the parent joint; `*W` values are the resulting world
 * heights, kept here so the geometry builder and the rig can never disagree.
 */
export const CHESSPAA_SKELETON = {
  /** Crown of his knitted cap. The bobble adds another 0.06 on top. */
  height: 1.7,

  hipY: 0.6,
  spineY: 0.16,
  chestY: 0.18,
  neckY: 0.22,
  headY: 0.12,

  /** World heights of the joints above. */
  spineW: 0.76,
  chestW: 0.94,
  shoulderW: 1.1,
  neckW: 1.16,
  headW: 1.28,
  /** Centre of the head sphere, world. */
  faceW: 1.43,

  shoulderX: 0.245,
  shoulderYOff: 0.16,
  upperArm: 0.3,
  foreArm: 0.27,
  mittenR: 0.105,

  hipX: 0.115,
  thigh: 0.24,
  shin: 0.2,

  headR: 0.205,

  /**
   * Rest position of the beard chain's anchor, root-local. At runtime the
   * live anchor is read off the HEAD bone every frame — that is what makes
   * the beard swing out when he turns and flip when he tips back to laugh.
   */
  beardRoot: new THREE.Vector3(0, 1.23, 0.2),
  beardLength: 0.34,
  /** Same story for the scarf tail: the live anchor comes off the CHEST. */
  scarfRoot: new THREE.Vector3(-0.115, 1.13, 0.2),
  scarfLength: 0.46,

  /**
   * Torso stand-in for cloth collision — a tapered capsule from the widest
   * part of his coat up to his collar, in root space.
   */
  torsoCollider: {
    a: new THREE.Vector3(0, 0.6, 0.02),
    b: new THREE.Vector3(0, 1.19, 0.02),
    ra: 0.35,
    rb: 0.175,
  },

  /** Resting hand positions, root-local. Left carries the lantern. */
  restHandL: new THREE.Vector3(-0.4, 0.86, 0.26),
  restHandR: new THREE.Vector3(0.335, 0.7, 0.115),
} as const;

/* ================================================================== *
 * 6.  MOODS
 * ================================================================== */

export type ChessPaaMood =
  | "idle"
  | "talking"
  | "pointing"
  | "chuckling"
  | "delighted"
  | "concerned";

/** Where the gesturing (right) hand wants to be for a given mood. */
type HandMode = "rest" | "point" | "belly" | "beard" | "up";

interface MoodTargets {
  breathRate: number;
  breathDepth: number;
  lean: number;
  headPitch: number;
  headRoll: number;
  browRaise: number;
  /** + = inner ends up (worry). - = inner ends down (mock-stern). */
  browTilt: number;
  eyeOpen: number;
  smile: number;
  mouthBase: number;
  /** How much of the speech layer plays. */
  talk: number;
  /** How much of the laugh layer plays. */
  chuckle: number;
  /** Toe-bounce amplitude. */
  bounce: number;
  cheek: number;
  twinkle: number;
  gestureAmp: number;
  fingerPoint: number;
  lanternRaise: number;
  hand: HandMode;
}

const MOODS: Record<ChessPaaMood, MoodTargets> = {
  // Waiting patiently. The hardest one to get right, and the one a child
  // sees most: he must read as a person choosing to stand still, not a model
  // that stopped.
  idle: {
    breathRate: 0.26, breathDepth: 1, lean: 0.015, headPitch: 0.02, headRoll: 0,
    browRaise: 0.08, browTilt: 0, eyeOpen: 1, smile: 0.42, mouthBase: 0.02,
    talk: 0, chuckle: 0, bounce: 0, cheek: 0.35, twinkle: 1, gestureAmp: 0.1,
    fingerPoint: 0, lanternRaise: 0, hand: "rest",
  },
  // Hands do most of the talking. The pauses matter more than the syllables.
  talking: {
    breathRate: 0.34, breathDepth: 1.15, lean: 0.05, headPitch: -0.01, headRoll: 0.02,
    browRaise: 0.34, browTilt: 0.06, eyeOpen: 1, smile: 0.55, mouthBase: 0.1,
    talk: 1, chuckle: 0, bounce: 0, cheek: 0.5, twinkle: 1.05, gestureAmp: 1,
    fingerPoint: 0.12, lanternRaise: 0.35, hand: "rest",
  },
  // "Look — THERE." Torso leads, eyes arrive first, finger last.
  pointing: {
    breathRate: 0.32, breathDepth: 1.05, lean: 0.09, headPitch: -0.03, headRoll: 0.01,
    browRaise: 0.5, browTilt: 0.05, eyeOpen: 1.06, smile: 0.6, mouthBase: 0.16,
    talk: 0.35, chuckle: 0, bounce: 0, cheek: 0.55, twinkle: 1.15, gestureAmp: 0.3,
    fingerPoint: 1, lanternRaise: 0.15, hand: "point",
  },
  // A belly chuckle: shoulders first, belly second, head tips back last.
  chuckling: {
    breathRate: 0.62, breathDepth: 1.5, lean: -0.06, headPitch: -0.2, headRoll: 0.05,
    browRaise: 0.42, browTilt: -0.1, eyeOpen: 0.14, smile: 1, mouthBase: 0.42,
    talk: 0, chuckle: 1, bounce: 0.25, cheek: 1, twinkle: 1.2, gestureAmp: 0.2,
    fingerPoint: 0, lanternRaise: 0, hand: "belly",
  },
  // Delight is VERTICAL. Everything goes up: arms, brows, heels, eyebrows.
  delighted: {
    breathRate: 0.5, breathDepth: 1.35, lean: -0.09, headPitch: -0.14, headRoll: 0,
    browRaise: 1, browTilt: 0.1, eyeOpen: 1.18, smile: 1, mouthBase: 0.5,
    talk: 0.15, chuckle: 0.25, bounce: 1, cheek: 1, twinkle: 1.4, gestureAmp: 0.5,
    fingerPoint: 0, lanternRaise: 1, hand: "up",
  },
  // Not sad — thoughtful. He strokes his beard and takes his time.
  concerned: {
    breathRate: 0.2, breathDepth: 0.85, lean: -0.04, headPitch: 0.08, headRoll: 0.15,
    browRaise: 0.18, browTilt: 0.85, eyeOpen: 0.86, smile: 0.16, mouthBase: 0.02,
    talk: 0, chuckle: 0, bounce: 0, cheek: 0.2, twinkle: 0.8, gestureAmp: 0.08,
    fingerPoint: 0.2, lanternRaise: 0, hand: "beard",
  },
};

/** Root-local anchor for each hand mode (before per-mood drift is added). */
const HAND_ANCHORS: Record<HandMode, THREE.Vector3> = {
  rest: CHESSPAA_SKELETON.restHandR.clone(),
  point: new THREE.Vector3(0.42, 1.06, 0.34),
  belly: new THREE.Vector3(0.185, 0.8, 0.235),
  beard: new THREE.Vector3(0.105, 1.235, 0.245),
  up: new THREE.Vector3(0.44, 1.34, 0.22),
};

/* ================================================================== *
 * 7.  THE POSE STATE
 * ================================================================== */

/**
 * One frame of ChessPaa, as plain numbers. `ChessPaa.tsx` copies these onto
 * Object3Ds; nothing here knows or cares that three.js exists (beyond the two
 * IK target vectors, which have to be points in space).
 */
export interface ChessPaaPose {
  /* torso */
  /** -1..1 chest rise. */
  breath: number;
  /** + leans forward. */
  lean: number;
  /** + turns to his left. */
  twist: number;
  /** + sways to his right. */
  side: number;
  /** Vertical bob of the whole body. */
  bob: number;
  /** -1..1 contrapposto — which foot the weight is on. */
  weight: number;
  bellyBounce: number;
  shoulderShake: number;
  chestScale: number;
  bellyScale: number;

  /* head */
  headPitch: number;
  headYaw: number;
  headRoll: number;

  /* face */
  /** 0 = shut, 1 = normal, >1 = wide. */
  eyeOpen: number;
  /** Root-local-ish gaze offset applied to the eyes, in units. */
  eyeShiftX: number;
  eyeShiftY: number;
  browRaise: number;
  browTilt: number;
  /** Per-brow so worry can be asymmetric. */
  browL: number;
  browR: number;
  smile: number;
  mouthOpen: number;
  cheek: number;
  /** Catchlight brightness/scale, ~0.7..1.6. */
  twinkle: number;

  /* hands */
  /** IK targets, ROOT-LOCAL. */
  handL: THREE.Vector3;
  handR: THREE.Vector3;
  fingerPoint: number;

  /* lantern */
  lanternFlicker: number;

  /* breath fog */
  /** True on the single frame a puff is born. */
  exhaled: boolean;
  /** Seconds since the current puff was born; >= puffLife means finished. */
  exhaleAge: number;
  puffLife: number;
}

export interface ChessPaaRigInput {
  mood: ChessPaaMood;
  /** What he is pointing at, ROOT-LOCAL. null → he picks a spot ahead. */
  pointAt?: THREE.Vector3 | null;
  /** What he is looking at, ROOT-LOCAL. null → a slow ambient scan. */
  lookAt?: THREE.Vector3 | null;
}

export interface ChessPaaRig {
  readonly pose: ChessPaaPose;
  readonly mood: ChessPaaMood;
  /** Advance one frame. `t` is total elapsed seconds. */
  update(dt: number, t: number, input: ChessPaaRigInput): ChessPaaPose;
}

/* ================================================================== *
 * 8.  THE RIG
 * ================================================================== */

class ChessPaaRigImpl implements ChessPaaRig {
  readonly pose: ChessPaaPose;
  mood: ChessPaaMood = "idle";

  /* one spring per blended pose knob */
  private sBreathRate = new Spring(0.26, 0.6);
  private sBreathDepth = new Spring(1, 0.5);
  private sLean = new Spring(0.015, 0.28);
  private sTwist = new Spring(0, 0.3);
  private sHeadPitch = new Spring(0.02, 0.22);
  private sHeadYaw = new Spring(0, 0.26);
  private sHeadRoll = new Spring(0, 0.3);
  private sBrowRaise = new Spring(0.08, 0.13);
  private sBrowTilt = new Spring(0, 0.16);
  private sEyeOpen = new Spring(1, 0.11);
  private sSmile = new Spring(0.42, 0.18);
  private sMouthBase = new Spring(0.02, 0.12);
  private sTalk = new Spring(0, 0.2);
  private sChuckle = new Spring(0, 0.24);
  private sBounce = new Spring(0, 0.3);
  private sCheek = new Spring(0.35, 0.2);
  private sTwinkle = new Spring(1, 0.3);
  private sGesture = new Spring(0.1, 0.3);
  // Under-damped on purpose: the finger throws out past the pose and settles.
  private sFinger = new Spring(0, 0.13, 0.55);
  private sLantern = new Spring(0, 0.36);
  private sEyeX = new Spring(0, 0.12);
  private sEyeY = new Spring(0, 0.14);
  // The gesturing arm overshoots — anticipation and follow-through, for free.
  private handR = new SpringVec3(0.17, 0.62);
  private handL = new SpringVec3(0.24, 0.8);

  /* timers and one-shots */
  private rnd: () => number;
  private blinkIn = 1.4;
  private blinkT = -1;
  private blinkQueue = 0;
  private gazeIn = 2.2;
  private readonly gazeTarget = new THREE.Vector3(0, 1.3, 3);
  private fidgetIn = 7;
  private fidgetT = -1;
  private fidgetKind = 0;
  private breathPhase = 0;
  private breathCount = 0;
  private phraseT = 0;
  private phraseLen = 2.1;
  private phraseGate = 0;

  /* scratch owned by the instance */
  private readonly tmpHand = new THREE.Vector3();

  constructor(seed = 41) {
    this.rnd = rng(seed);
    this.handR.snap(HAND_ANCHORS.rest);
    this.handL.snap(CHESSPAA_SKELETON.restHandL);
    this.pose = {
      breath: 0, lean: 0.015, twist: 0, side: 0, bob: 0, weight: 0,
      bellyBounce: 0, shoulderShake: 0, chestScale: 1, bellyScale: 1,
      headPitch: 0.02, headYaw: 0, headRoll: 0,
      eyeOpen: 1, eyeShiftX: 0, eyeShiftY: 0,
      browRaise: 0.08, browTilt: 0, browL: 0.08, browR: 0.08,
      smile: 0.42, mouthOpen: 0.02, cheek: 0.35, twinkle: 1,
      handL: this.handL.value, handR: this.handR.value, fingerPoint: 0,
      lanternFlicker: 1,
      exhaled: false, exhaleAge: 99, puffLife: 2.1,
    };
  }

  update(dtRaw: number, t: number, input: ChessPaaRigInput): ChessPaaPose {
    const dt = Math.min(0.05, Math.max(0, dtRaw));
    const p = this.pose;
    const m = MOODS[input.mood] ?? MOODS.idle;
    this.mood = input.mood;

    /* ---------------- gaze ---------------- */
    // Eyes lead the head. Always. It is the oldest rule in character
    // animation and it is the difference between "looking" and "aiming".
    this.gazeIn -= dt;
    if (input.lookAt) {
      this.gazeTarget.copy(input.lookAt);
      this.gazeIn = 1.2;
    } else if (input.pointAt) {
      this.gazeTarget.copy(input.pointAt);
      this.gazeIn = 1.6;
    } else if (this.gazeIn <= 0) {
      // A small saccade to somewhere plausible — never a dead stare.
      this.gazeTarget.set(
        (this.rnd() - 0.5) * 3.2,
        1.0 + this.rnd() * 0.7,
        1.6 + this.rnd() * 2.4
      );
      this.gazeIn = 1.8 + this.rnd() * 4.2;
    }
    const gx = this.gazeTarget.x;
    const gz = Math.max(0.35, this.gazeTarget.z);
    const gazeYaw = Math.atan2(gx, gz);
    const gazePitch = -Math.atan2(
      this.gazeTarget.y - CHESSPAA_SKELETON.faceW,
      Math.hypot(gx, gz)
    );

    /* ---------------- torso targets ---------------- */
    let twistTarget = 0;
    if (input.mood === "pointing" || input.pointAt) {
      twistTarget = THREE.MathUtils.clamp(gazeYaw * 0.42, -0.5, 0.5);
    }
    this.sBreathRate.to(m.breathRate);
    this.sBreathDepth.to(m.breathDepth);
    this.sLean.to(m.lean);
    this.sTwist.to(twistTarget);
    // Head takes what the eyes cannot cover, clamped so his neck stays kind.
    this.sHeadYaw.to(THREE.MathUtils.clamp(gazeYaw * 0.55, -0.62, 0.62));
    this.sHeadPitch.to(
      m.headPitch + THREE.MathUtils.clamp(gazePitch * 0.5, -0.3, 0.34)
    );
    this.sHeadRoll.to(m.headRoll);
    this.sBrowRaise.to(m.browRaise);
    this.sBrowTilt.to(m.browTilt);
    this.sSmile.to(m.smile);
    this.sMouthBase.to(m.mouthBase);
    this.sTalk.to(m.talk);
    this.sChuckle.to(m.chuckle);
    this.sBounce.to(m.bounce);
    this.sCheek.to(m.cheek);
    this.sTwinkle.to(m.twinkle);
    this.sGesture.to(m.gestureAmp);
    this.sFinger.to(m.fingerPoint);
    this.sLantern.to(m.lanternRaise);
    // Eyes shift within the socket — the head only ever does part of the job.
    this.sEyeX.to(THREE.MathUtils.clamp(gazeYaw * 0.028, -0.016, 0.016));
    this.sEyeY.to(THREE.MathUtils.clamp(-gazePitch * 0.022, -0.012, 0.012));

    /* ---------------- speech ---------------- */
    // Real speech is phrases separated by breaths. The GAPS are what sell it:
    // a mouth that flaps continuously reads as a machine, so the gesture and
    // the jabber both gate off between phrases and the hands settle.
    this.phraseT += dt;
    if (this.phraseT > this.phraseLen) {
      this.phraseT = 0;
      this.phraseLen = 1.3 + this.rnd() * 1.6;
    }
    const pf = this.phraseT / this.phraseLen;
    // trapezoid: quick in, long hold, quick out, then silence for the tail
    const gateRaw =
      pf < 0.08 ? pf / 0.08 : pf < 0.74 ? 1 : pf < 0.86 ? 1 - (pf - 0.74) / 0.12 : 0;
    this.phraseGate += (gateRaw - this.phraseGate) * Math.min(1, dt * 12);

    const talk = this.sTalk.value;
    const syll =
      (Math.sin(t * 9.4) * 0.5 + 0.5) * 0.6 +
      (Math.sin(t * 14.9 + 1.1) * 0.5 + 0.5) * 0.4;

    /* ---------------- laughter ---------------- */
    // Bursts, not a drone. Shoulders at ~5Hz over a ~1.3Hz belly wobble.
    const chuckle = this.sChuckle.value;
    const burst = Math.max(0, Math.sin(t * 1.35)) ** 0.6;
    const shake = Math.sin(t * 32.7);
    const bellyWob = Math.sin(t * 8.2 + 0.6);

    /* ---------------- breath ---------------- */
    // Cleared unconditionally: `exhaled` is a one-frame edge, and a flag that
    // can survive a branch would re-anchor the puff mid-flight.
    p.exhaled = false;
    this.breathPhase += dt * this.sBreathRate.value;
    if (this.breathPhase >= 1) {
      this.breathPhase -= 1;
      this.breathCount++;
      // Every second exhale fogs. Every exhale would be visual noise; this
      // rhythm reads as cold air without ever taking the eye off his face.
      if (this.breathCount % 2 === 0 || talk > 0.5) {
        p.exhaleAge = 0;
        p.exhaled = true;
      }
    }
    p.exhaleAge += dt;
    const breath = Math.sin(this.breathPhase * Math.PI * 2);

    /* ---------------- blink ---------------- */
    this.blinkIn -= dt;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      if (this.blinkT > 0.17) {
        this.blinkT = -1;
        if (this.blinkQueue > 0) {
          this.blinkQueue--;
          this.blinkT = 0;
        }
      }
    } else if (this.blinkIn <= 0) {
      this.blinkT = 0;
      this.blinkIn = 2.2 + this.rnd() * 3.8;
      // Humans double-blink about a fifth of the time.
      if (this.rnd() < 0.22) this.blinkQueue = 1;
    }
    let blink = 0;
    if (this.blinkT >= 0) {
      const bp = this.blinkT / 0.17;
      // Fast close, slower open — an even triangle reads as a shutter.
      blink = bp < 0.34 ? bp / 0.34 : 1 - (bp - 0.34) / 0.66;
    }
    // Laughing eyes squeeze shut and stay there; the blink is irrelevant then.
    this.sEyeOpen.to(m.eyeOpen * (1 - blink * 0.97));

    /* ---------------- fidget ---------------- */
    // Every ten seconds or so he does one small human thing: a shoulder roll,
    // a re-grip on the lantern, a private nod. Without these, three moods'
    // worth of springs still reads as a loop.
    this.fidgetIn -= dt;
    if (this.fidgetT >= 0) {
      this.fidgetT += dt;
      if (this.fidgetT > 1.3) this.fidgetT = -1;
    } else if (this.fidgetIn <= 0) {
      this.fidgetT = 0;
      this.fidgetIn = 8 + this.rnd() * 9;
      this.fidgetKind = Math.floor(this.rnd() * 3);
    }
    let fidget = 0;
    if (this.fidgetT >= 0) {
      const fp = this.fidgetT / 1.3;
      fidget = Math.sin(fp * Math.PI) ** 1.4;
    }

    /* ---------------- hand targets ---------------- */
    const anchor = HAND_ANCHORS[m.hand];
    this.tmpHand.copy(anchor);

    if (m.hand === "point") {
      // Aim from the shoulder at the real target, then stop at arm's length.
      // He never stretches — an over-extended arm is the pose that breaks the
      // illusion fastest.
      const tgt = input.pointAt ?? _v0.set(1.4, 1.35, 2.4);
      _v1.set(CHESSPAA_SKELETON.shoulderX, CHESSPAA_SKELETON.shoulderW, 0);
      _v2.subVectors(tgt, _v1);
      const len = Math.max(0.001, _v2.length());
      // 0.87, not 0.97: the talking-gesture drift below is added ON TOP of
      // this, and a locked elbow is the pose that breaks the illusion fastest.
      const reach = (CHESSPAA_SKELETON.upperArm + CHESSPAA_SKELETON.foreArm) * 0.87;
      _v2.multiplyScalar(Math.min(len, reach) / len);
      this.tmpHand.copy(_v1).add(_v2);
    } else if (m.hand === "beard") {
      // Stroking, not resting. Slow, deliberate, a thinking man's tell.
      this.tmpHand.y += Math.sin(t * 1.15) * 0.045;
      this.tmpHand.z += Math.cos(t * 1.15) * 0.02;
    } else if (m.hand === "belly") {
      this.tmpHand.y += bellyWob * 0.03 * chuckle;
      this.tmpHand.z += shake * 0.012 * chuckle;
    }

    // Talking gesture — small arcs ON the words, settling in the pauses.
    const gAmp = this.sGesture.value * (0.35 + 0.65 * this.phraseGate);
    this.tmpHand.x += fbmSin(t * 1.9, 1) * 0.055 * gAmp;
    this.tmpHand.y += fbmSin(t * 2.4, 2) * 0.07 * gAmp + syll * 0.018 * talk;
    this.tmpHand.z += fbmSin(t * 1.6, 3) * 0.06 * gAmp;
    if (this.fidgetKind === 0) this.tmpHand.y += fidget * 0.035;
    this.handR.to(this.tmpHand);

    // Lantern hand: raised by mood, always drifting a little.
    this.tmpHand
      .copy(CHESSPAA_SKELETON.restHandL)
      .lerp(_v0.set(-0.42, 1.24, 0.2), this.sLantern.value);
    this.tmpHand.x += fbmSin(t * 0.7, 5) * 0.014;
    this.tmpHand.y += fbmSin(t * 0.9, 6) * 0.018 + breath * 0.006;
    this.tmpHand.z += fbmSin(t * 0.8, 7) * 0.012;
    if (this.fidgetKind === 1) this.tmpHand.y -= fidget * 0.03;
    this.tmpHand.y += bellyWob * 0.02 * chuckle * burst;
    this.handL.to(this.tmpHand);

    /* ---------------- integrate ---------------- */
    // Fixed 1/120 substeps: springs tuned this stiff go unstable on a long
    // frame, and a long frame is exactly when a stutter would be visible.
    const H = 1 / 120;
    let acc = dt;
    let guard = 0;
    while (acc > 1e-5 && guard < 12) {
      const h = Math.min(H, acc);
      this.sBreathRate.step(h); this.sBreathDepth.step(h);
      this.sLean.step(h); this.sTwist.step(h);
      this.sHeadPitch.step(h); this.sHeadYaw.step(h); this.sHeadRoll.step(h);
      this.sBrowRaise.step(h); this.sBrowTilt.step(h);
      this.sEyeOpen.step(h); this.sSmile.step(h); this.sMouthBase.step(h);
      this.sTalk.step(h); this.sChuckle.step(h); this.sBounce.step(h);
      this.sCheek.step(h); this.sTwinkle.step(h); this.sGesture.step(h);
      this.sFinger.step(h); this.sLantern.step(h);
      this.sEyeX.step(h); this.sEyeY.step(h);
      this.handR.step(h); this.handL.step(h);
      acc -= h;
      guard++;
    }

    /* ---------------- compose the frame ---------------- */
    const depth = this.sBreathDepth.value;

    p.breath = breath;
    // Never zero: even his stillest moment has a floor of motion under it.
    p.chestScale = 1 + breath * 0.03 * depth + 0.004;
    // The belly follows the chest a beat later — a real anatomical lag, and
    // one of the cheapest details that makes a body read as a body.
    p.bellyScale =
      1 + Math.sin((this.breathPhase - 0.14) * Math.PI * 2) * 0.024 * depth;

    p.lean = this.sLean.value + breath * 0.012 + fidget * (this.fidgetKind === 2 ? 0.03 : 0);
    p.twist = this.sTwist.value + fbmSin(t * 0.31, 11) * 0.022;
    p.side = fbmSin(t * 0.42, 13) * 0.02;
    // A very slow migration of weight from foot to foot — the thing people
    // actually do while they wait.
    p.weight = Math.sin(t * 0.29) * 0.7 + Math.sin(t * 0.17 + 2.3) * 0.3;

    const bounce = this.sBounce.value;
    p.bob =
      breath * 0.006 +
      Math.abs(Math.sin(t * 4.3)) * 0.032 * bounce -
      chuckle * burst * Math.abs(shake) * 0.012;

    p.bellyBounce = chuckle * burst * (shake * 0.45 + bellyWob * 0.55);
    p.shoulderShake = chuckle * burst * shake;

    p.headPitch =
      this.sHeadPitch.value +
      breath * 0.008 +
      talk * this.phraseGate * (syll - 0.5) * 0.09 +
      chuckle * burst * shake * 0.035;
    p.headYaw = this.sHeadYaw.value + fbmSin(t * 0.37, 17) * 0.03;
    p.headRoll =
      this.sHeadRoll.value +
      fbmSin(t * 0.29, 19) * 0.022 +
      talk * this.phraseGate * fbmSin(t * 1.7, 23) * 0.05;

    p.eyeOpen = this.sEyeOpen.value;
    p.eyeShiftX = this.sEyeX.value;
    p.eyeShiftY = this.sEyeY.value;

    const br = this.sBrowRaise.value + talk * this.phraseGate * syll * 0.22;
    const tilt = this.sBrowTilt.value;
    p.browRaise = br;
    p.browTilt = tilt;
    // A touch of asymmetry, always. Perfectly matched brows look printed on.
    p.browL = br + tilt * 0.5 + fbmSin(t * 0.9, 29) * 0.05;
    p.browR = br - tilt * 0.18 + fbmSin(t * 0.9, 31) * 0.05;

    p.smile = this.sSmile.value + chuckle * 0.25;
    p.mouthOpen = Math.min(
      1,
      this.sMouthBase.value +
        talk * this.phraseGate * (0.16 + syll * 0.5) +
        chuckle * burst * (0.35 + Math.max(0, shake) * 0.35)
    );
    p.cheek = this.sCheek.value;
    // The twinkle: a slow shimmer on the catchlights, brighter when he is
    // pleased. This is the single most-looked-at pixel in the whole park.
    p.twinkle =
      this.sTwinkle.value * (0.92 + Math.sin(t * 2.3) * 0.06 + Math.sin(t * 5.1) * 0.03);

    p.fingerPoint = Math.max(0, this.sFinger.value);
    // Candle flicker: two fast sines plus a lift from how hard it is swinging.
    p.lanternFlicker =
      0.9 + Math.sin(t * 11.3) * 0.05 + Math.sin(t * 17.9 + 1.4) * 0.035;

    p.puffLife = 2.1;
    return p;
  }
}

/**
 * Build a ChessPaa rig.
 *
 * @param seed deterministic seed for blink/gaze/fidget timing.
 *
 * CAVEAT, because the screenshot harness leans on this: the oscillator layer
 * (breath, jabber, chuckle, sway) is a pure function of `t` and IS identical
 * for a given elapsed time. The EVENT layer is not — blinks, saccades and
 * fidgets are scheduled by counting down dt, so they consume the seeded rng in
 * an order that depends on frame pacing. Same seed + same dt SEQUENCE is
 * bit-identical (verified); same seed + same elapsed time reached by different
 * frame lengths is not. Drive the harness at a fixed dt.
 */
export function createChessPaaRig(seed = 41): ChessPaaRig {
  return new ChessPaaRigImpl(seed);
}

/* ================================================================== *
 * 9.  WIND — shared by every chain in the park
 * ================================================================== */

const _wind = new THREE.Vector3();

/**
 * The valley's breeze, as an acceleration. One source of truth so ChessPaa's
 * scarf, his beard and the children's bobble tails all lean the same way at
 * the same instant — which is what makes a group of characters feel like they
 * are standing in one real place.
 */
export function parkWind(t: number, strength = 1, out = _wind): THREE.Vector3 {
  const gust = 0.5 + 0.5 * Math.sin(t * 0.21) * Math.sin(t * 0.09 + 1.3);
  const s = strength * (0.35 + gust * 0.95);
  out.set(
    (fbmSin(t * 0.55, 2) * 0.7 + 0.45) * s,
    fbmSin(t * 0.8, 4) * 0.22 * s,
    (fbmSin(t * 0.47, 6) * 0.6 - 0.2) * s
  );
  return out;
}
