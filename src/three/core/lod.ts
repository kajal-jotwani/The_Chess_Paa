"use client";

import * as THREE from "three";

/**
 * LEVEL OF DETAIL — honest, biased, and hysteretic.
 *
 * Three ideas, and only three:
 *
 * 1. HYSTERESIS. A bare `distance > threshold` test flickers, because the
 *    camera never sits still: a spring-damped rig breathes a few centimetres
 *    every frame, and a prop parked exactly on a threshold will strobe between
 *    two silhouettes. A child reads that as the toy *twitching*. So every
 *    threshold is a dead-band: you must travel `hysteresis` PAST it to coarsen,
 *    and back INSIDE it by the same margin to refine. Nothing can sit in the
 *    band and oscillate — the band has no exit that leads back into itself.
 *
 * 2. BIAS. Not every object deserves the same budget. ChessPaa is the reason
 *    the child came; a fence post is not. `bias` multiplies every threshold for
 *    one object, so heroes hold their high tier three or four times further out
 *    than set dressing, on the same scheme, with no special-casing.
 *
 * 3. DWELL. Spatial hysteresis handles jitter; it does not handle a camera
 *    sweeping steadily across the band during a dolly. A short dwell timer
 *    (~a quarter second) rate-limits switching so a pass-by cannot machine-gun
 *    tiers. A jump of MORE than one tier bypasses the dwell entirely: that is a
 *    camera cut, not flicker, and it must land instantly or the harness
 *    screenshots the wrong silhouette.
 *
 * The tier list is authored by whoever owns the geometry. This file only
 * decides WHICH one is on screen, and refuses to change its mind cheaply.
 */

/* ------------------------------------------------------------------ */
/* BIAS TABLE — one shared vocabulary so the park is consistent        */
/* ------------------------------------------------------------------ */

/**
 * Named biases. Use these instead of hand-typed numbers: when we retune the
 * park's detail budget we want to move five constants, not five hundred.
 */
export const LOD_BIAS = {
  /** ChessPaa himself. He is the reason the child came. He does not go coarse. */
  hero: 4.0,
  /** Pieces in the game being played — the child is staring straight at them. */
  play: 3.0,
  /** Named landmarks (ferris wheel, tent, gate). They must read from the crest. */
  landmark: 2.0,
  /** Ordinary props: benches, barrels, signposts, lanterns. */
  prop: 1.0,
  /** Crowd set-dressing: fence posts, rocks, the far pines. */
  dressing: 0.6,
} as const;

export type LodBiasName = keyof typeof LOD_BIAS;

/**
 * A global multiplier on every LodGroup's thresholds, driven by the quality
 * ladder in `perf.ts`. Dropping this is the single cheapest way to buy back
 * triangles without changing a silhouette the child is looking at directly:
 * heroes carry a bias large enough that they survive the squeeze.
 */
let globalBias = 1;

export function setGlobalLodBias(b: number): void {
  // Clamped: a runaway governor must never be able to blank the park by
  // pushing every object to its coarsest tier, nor stall it at tier 0.
  globalBias = Math.min(4, Math.max(0.25, Number.isFinite(b) ? b : 1));
}

export function getGlobalLodBias(): number {
  return globalBias;
}

/* ------------------------------------------------------------------ */
/* THE GROUP                                                           */
/* ------------------------------------------------------------------ */

/** One rung of a LOD scheme. */
export interface LodTier<T = THREE.BufferGeometry> {
  /** What to draw at this rung. Usually a BufferGeometry; anything works. */
  geo: T;
  /**
   * This tier is used while the biased camera distance is <= maxDistance.
   * The LAST tier's value is ignored — it runs to infinity by definition.
   */
  maxDistance: number;
  /** Optional name, for the perf overlay and for debugging. */
  label?: string;
}

export interface LodOptions {
  /**
   * Dead-band as a fraction of each threshold. 0.14 = you must reach 114% of a
   * threshold to coarsen and fall back to 86% to refine. Below ~0.06 a
   * breathing camera can still flicker; above ~0.3 the swap becomes visible as
   * a late pop.
   */
  hysteresis?: number;
  /** Per-object threshold multiplier. See LOD_BIAS. */
  bias?: number;
  /** Minimum seconds between single-tier switches. 0 disables. */
  dwell?: number;
  /** Never go coarser than this tier index (heroes pin to 0). */
  maxTier?: number;
  /** Ignore the global bias — for anything that must be pixel-stable, e.g. a harness shot. */
  ignoreGlobalBias?: boolean;
}

/**
 * A LOD decision-maker for ONE object. It owns the current tier, so give each
 * object its own group (they are tiny — a few numbers and a shared tier array).
 */
export class LodGroup<T = THREE.BufferGeometry> {
  readonly tiers: ReadonlyArray<LodTier<T>>;

  /** Per-object threshold multiplier. Mutable: a piece promoted into play can grow its bias mid-game. */
  bias: number;
  hysteresis: number;
  dwell: number;
  maxTier: number;
  ignoreGlobalBias: boolean;

  /** How many times this group has actually swapped tier. The oscillation canary. */
  switches = 0;

  private idx = 0;
  private since = Number.POSITIVE_INFINITY; // seconds since the last switch
  private lastDist = 0;

  constructor(tiers: ReadonlyArray<LodTier<T>>, opts: LodOptions = {}) {
    if (!tiers.length) throw new Error("LodGroup needs at least one tier");
    // Defensive sort: authored tier lists get reordered during art passes, and
    // a mis-ordered list silently produces a scheme that never leaves tier 0.
    this.tiers = [...tiers].sort((a, b) => a.maxDistance - b.maxDistance);
    this.hysteresis = opts.hysteresis ?? 0.14;
    this.bias = opts.bias ?? 1;
    this.dwell = opts.dwell ?? 0.25;
    // Clamped at BOTH ends. `maxTier: tiers.length - 2` is a natural thing to
    // write and goes negative on a one-tier list; an unclamped negative cap
    // walks `select` off the front of the array and `pick` returns undefined.
    this.maxTier = Math.max(0, Math.min(opts.maxTier ?? this.tiers.length - 1, this.tiers.length - 1));
    this.ignoreGlobalBias = opts.ignoreGlobalBias ?? false;
  }

  /** Current tier index. */
  get index(): number {
    return this.idx;
  }

  /** Current tier record. */
  get tier(): LodTier<T> {
    return this.tiers[this.idx];
  }

  /** Current payload, without re-evaluating distance. */
  get current(): T {
    return this.tiers[this.idx].geo;
  }

  /** Effective threshold multiplier, global squeeze included. */
  get effectiveBias(): number {
    return this.bias * (this.ignoreGlobalBias ? 1 : globalBias);
  }

  /** The boundary between tier i and tier i+1, after bias. */
  threshold(i: number): number {
    return this.tiers[i].maxDistance * this.effectiveBias;
  }

  /**
   * Pick a tier for this camera distance and return its payload.
   * `dt` (seconds) enables the dwell timer; omit it and only the spatial
   * dead-band applies, which is still enough to stop threshold flicker.
   */
  pick(dist: number, dt = 0): T {
    return this.tiers[this.select(dist, dt)].geo;
  }

  /** As `pick`, but returns the index — for callers driving their own meshes. */
  select(dist: number, dt = 0): number {
    const d = Number.isFinite(dist) && dist > 0 ? dist : 0;
    this.lastDist = d;
    if (this.tiers.length === 1) return 0;
    if (dt > 0) this.since += dt;

    const h = this.hysteresis;
    const last = this.tiers.length - 1;
    const cap = this.maxTier;
    let target = this.idx;

    // Coarsen: only once we are clearly PAST the boundary we are standing on.
    while (target < last && target < cap && d > this.threshold(target) * (1 + h)) target++;
    // Refine: only once we are clearly back INSIDE the boundary below us.
    while (target > 0 && d < this.threshold(target - 1) * (1 - h)) target--;

    if (target > cap) target = cap; // a bias change can leave us past the pin

    if (target === this.idx) return this.idx;

    // A multi-tier jump is a camera CUT, not flicker — land it immediately, or
    // the harness poses a rig and screenshots the previous silhouette.
    const jump = Math.abs(target - this.idx) > 1;
    if (!jump && this.dwell > 0 && dt > 0 && this.since < this.dwell) return this.idx;

    this.idx = target;
    this.since = 0;
    this.switches++;
    return this.idx;
  }

  /**
   * Snap to the correct tier with NO hysteresis and no dwell. Call this on a
   * hard camera cut (rig change, teleport) so the first frame after the cut is
   * already correct.
   */
  reset(dist = this.lastDist): void {
    const d = Number.isFinite(dist) && dist > 0 ? dist : 0;
    let i = 0;
    while (i < this.tiers.length - 1 && d > this.threshold(i)) i++;
    this.idx = Math.min(i, this.maxTier);
    this.since = Number.POSITIVE_INFINITY;
  }

  /** Set the per-object bias and re-evaluate on the next pick. */
  setBias(b: number): void {
    this.bias = Math.max(0.05, b);
  }
}

/* ------------------------------------------------------------------ */
/* THE R3F-FRIENDLY OBJECT                                             */
/* ------------------------------------------------------------------ */

const _camPos = new THREE.Vector3();
const _objPos = new THREE.Vector3();

function nowSeconds(): number {
  return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
}

export interface LodMeshOptions extends LodOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  /**
   * Tiers ABOVE this index stop casting shadows. A pine four hundred metres out
   * contributes a shadow the size of a pixel and costs a full extra draw in the
   * shadow pass — that trade is never worth it. Default 1.
   */
  shadowUntilTier?: number;
  /** Per-level hook: add the inverted-hull outline, thin it with distance, rename. */
  decorate?: (mesh: THREE.Mesh, tierIndex: number, tier: LodTier) => void;
  name?: string;
}

/**
 * A THREE.LOD with OUR selection rule.
 *
 * We subclass rather than reimplement because `WebGLRenderer.projectObject`
 * already calls `update(camera)` on every `isLOD` object it walks — which means
 * this works with no `useFrame` hook, no registry, and no chance of an object
 * being left on the wrong tier because someone forgot to tick it. Stock
 * THREE.LOD only has a one-sided fractional hysteresis and no bias or dwell,
 * so `update` is overridden entirely.
 *
 * NOTE: our normal+depth prepass renders the scene a second time with the same
 * camera, so `update` runs twice per frame. Everything here is idempotent and
 * the dwell timer is wall-clock, so the double call is harmless.
 */
export class HysteresisLOD extends THREE.LOD {
  readonly lod: LodGroup<THREE.BufferGeometry>;
  readonly levelMeshes: THREE.Mesh[] = [];
  private lastTick = 0;

  constructor(lod: LodGroup<THREE.BufferGeometry>) {
    super();
    this.lod = lod;
  }

  /** Called by the renderer once per pass. Distance is world-space, zoom-corrected. */
  override update(camera: THREE.Camera): void {
    if (this.levelMeshes.length < 2) return;

    _camPos.setFromMatrixPosition(camera.matrixWorld);
    _objPos.setFromMatrixPosition(this.matrixWorld);
    const zoom = (camera as THREE.PerspectiveCamera).zoom || 1;
    const dist = _camPos.distanceTo(_objPos) / zoom;

    const t = nowSeconds();
    // First tick has no meaningful delta; clamp the rest so a tab-restore hitch
    // cannot instantly satisfy every dwell in the park at once.
    const dt = this.lastTick === 0 ? 0 : Math.min(0.25, t - this.lastTick);
    this.lastTick = t;

    const idx = this.lod.select(dist, dt);
    for (let i = 0; i < this.levelMeshes.length; i++) {
      this.levelMeshes[i].visible = i === idx;
    }
  }

  /** Snap to the right tier immediately — use on a hard camera cut. */
  snap(camera: THREE.Camera): void {
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    _objPos.setFromMatrixPosition(this.matrixWorld);
    this.lod.reset(_camPos.distanceTo(_objPos));
    for (let i = 0; i < this.levelMeshes.length; i++) {
      this.levelMeshes[i].visible = i === this.lod.index;
    }
  }
}

/**
 * Build a ready-to-drop LOD object: one mesh per tier, all sharing a material,
 * with our selection rule wired in. Use it in R3F as `<primitive object={x} />`.
 *
 * Sharing ONE material across tiers is deliberate — it keeps the shader program
 * count flat (a second program means a second compile hitch the first time a
 * distant object comes close) and it guarantees the toon bands and rim light
 * are identical across a swap, so the only thing that changes is the
 * silhouette's fidelity.
 */
export function makeLodMesh(
  tiers: ReadonlyArray<LodTier<THREE.BufferGeometry>>,
  material: THREE.Material,
  opts: LodMeshOptions = {}
): HysteresisLOD {
  const group = new LodGroup(tiers, opts);
  const obj = new HysteresisLOD(group);
  if (opts.name) obj.name = opts.name;

  const shadowUntil = opts.shadowUntilTier ?? 1;

  group.tiers.forEach((tier, i) => {
    // Bounding volumes are needed for per-level frustum culling; authored
    // geometry often arrives without them.
    if (!tier.geo.boundingSphere) tier.geo.computeBoundingSphere();
    if (!tier.geo.boundingBox) tier.geo.computeBoundingBox();

    const mesh = new THREE.Mesh(tier.geo, material);
    mesh.name = tier.label ? `${obj.name || "lod"}:${tier.label}` : `${obj.name || "lod"}:L${i}`;
    mesh.castShadow = (opts.castShadow ?? true) && i <= shadowUntil;
    mesh.receiveShadow = opts.receiveShadow ?? true;
    mesh.visible = i === 0;
    opts.decorate?.(mesh, i, tier);

    obj.levelMeshes.push(mesh);
    // Base-class levels are kept in sync so raycasting still resolves sensibly.
    obj.addLevel(mesh, i === 0 ? 0 : group.tiers[i - 1].maxDistance);
  });

  // Visibility is ours; the base class must not also stamp on it.
  obj.levelMeshes.forEach((m, i) => { m.visible = i === 0; });
  return obj;
}

/**
 * Distance from a camera to an object, zoom-corrected — the same number
 * `HysteresisLOD` feeds its group. Exported so callers driving LodGroup by hand
 * (instanced crowds, the board) measure distance identically.
 */
export function lodDistance(camera: THREE.Camera, object: THREE.Object3D): number {
  _camPos.setFromMatrixPosition(camera.matrixWorld);
  _objPos.setFromMatrixPosition(object.matrixWorld);
  const zoom = (camera as THREE.PerspectiveCamera).zoom || 1;
  return _camPos.distanceTo(_objPos) / zoom;
}

/**
 * Snap every HysteresisLOD in a subtree to its correct tier. Call this the
 * frame a rig cut lands, so the first rendered frame after the cut is already
 * at the right fidelity instead of easing into it over the dwell window.
 */
export function snapLods(root: THREE.Object3D, camera: THREE.Camera): number {
  let n = 0;
  root.traverse((o) => {
    const l = o as HysteresisLOD;
    if (l instanceof HysteresisLOD) { l.snap(camera); n++; }
  });
  return n;
}
