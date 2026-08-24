"use client";

import * as THREE from "three";
import { NO_INK_LAYER } from "./postfx/effects";

/**
 * CROWDS — one draw call for six hundred pines.
 *
 * The park is full of repeated things: pines, fence posts, bunting flags,
 * lanterns, gondolas, snow lumps, the pieces on a board. Drawn one at a time
 * they are hundreds of draw calls; instanced they are one. That difference is
 * the whole 60fps budget.
 *
 * Three jobs live here:
 *
 *   buildInstanced   — a transform list becomes an InstancedMesh, with the
 *                      per-instance cull spheres precomputed once.
 *   updateInstances  — move a HANDFUL of instances without re-uploading the
 *                      whole matrix buffer (partial GPU update ranges).
 *   packVisible      — cull to the camera and keep the survivors CONTIGUOUS at
 *                      the front of the buffer, so `count` alone controls what
 *                      is drawn.
 *
 * Why packing matters: three's InstancedMesh draws instances `0 .. count-1`.
 * There is no per-instance visibility flag. If the ten pines behind the camera
 * are scattered through the buffer, the only way to skip them is to not draw
 * them — which means moving the survivors forward. That is what the packer
 * does, and it does it against a scratch order so a static camera re-uploads
 * nothing at all.
 *
 * ONE RULE, AND IT IS SHARP: once a mesh is packed, `instanceMatrix.array` is a
 * DRAW buffer, not the truth. The truth is the packer's `src`, in authoring
 * order. Write through `updateInstances` or not at all. A crowd that writes
 * `mesh.instanceMatrix.array` by hand and is later handed to `packVisible` will
 * snap every instance back to wherever it was built, because that is the last
 * position the packer was told about. If you are hand-writing the buffer (which
 * is fine, and cheaper, for a crowd that moves every instance every frame),
 * then never call `packVisible` on that mesh.
 */

/* ------------------------------------------------------------------ */
/* INPUT                                                               */
/* ------------------------------------------------------------------ */

export type Vec3Tuple = readonly [number, number, number];

export interface InstanceTransform {
  position?: Vec3Tuple | THREE.Vector3;
  /** Euler XYZ. Ignored if `quaternion` is given. */
  rotation?: Vec3Tuple | THREE.Euler;
  quaternion?: THREE.Quaternion;
  /** A single number means uniform scale. */
  scale?: number | Vec3Tuple | THREE.Vector3;
  /**
   * Per-instance tint. Adds an instanceColor attribute to the whole mesh.
   * REQUIRES `material.vertexColors = true` — three gates the multiply on
   * USE_COLOR, so without it the tint is silently ignored.
   */
  color?: THREE.Color | number;
}

/** Anything you might plausibly have on hand when building a crowd. */
export type InstanceInput = InstanceTransform | THREE.Matrix4 | THREE.Object3D;

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

function toVec3(v: Vec3Tuple | THREE.Vector3 | undefined, out: THREE.Vector3, dflt: number): THREE.Vector3 {
  if (!v) return out.set(dflt, dflt, dflt);
  if (v instanceof THREE.Vector3) return out.copy(v);
  return out.set(v[0], v[1], v[2]);
}

/** Normalise any accepted input into `out`. Returns the (possibly absent) colour. */
function composeMatrix(t: InstanceInput, out: THREE.Matrix4): THREE.Color | null {
  if (t instanceof THREE.Matrix4) { out.copy(t); return null; }
  if (t instanceof THREE.Object3D) { t.updateMatrix(); out.copy(t.matrix); return null; }

  toVec3(t.position, _p, 0);
  if (t.quaternion) {
    _q.copy(t.quaternion);
  } else if (t.rotation instanceof THREE.Euler) {
    _q.setFromEuler(t.rotation);
  } else if (t.rotation) {
    _q.setFromEuler(_e.set(t.rotation[0], t.rotation[1], t.rotation[2]));
  } else {
    _q.identity();
  }
  if (typeof t.scale === "number") _s.set(t.scale, t.scale, t.scale);
  else toVec3(t.scale, _s, 1);

  out.compose(_p, _q, _s);
  if (t.color === undefined) return null;
  return typeof t.color === "number" ? _c.setHex(t.color) : _c.copy(t.color);
}

/* ------------------------------------------------------------------ */
/* STATE CARRIED ON THE MESH                                           */
/* ------------------------------------------------------------------ */

/**
 * The packer's bookkeeping. Lives on `mesh.userData.__pack` so the required
 * `buildInstanced -> THREE.InstancedMesh` signature stays clean, and so any
 * InstancedMesh built by someone else can still be packed (we adopt its buffer
 * on first use).
 */
export interface InstancedPacker {
  /** The authoritative transforms, in AUTHORING order. Never reordered. */
  src: Float32Array;
  /** Authoritative colours, in authoring order, or null. */
  srcColor: Float32Array | null;
  /** Live instance count (<= capacity). */
  count: number;
  capacity: number;
  /** Local-space cull sphere per instance: cx, cy, cz, r. */
  spheres: Float32Array;
  /** srcIndex drawn in each slot, for the current packing. */
  order: Int32Array;
  /** Slot each srcIndex occupies right now, or -1 when culled. */
  slot: Int32Array;
  /** Scratch used while deciding the next packing. */
  next: Int32Array;
  /** Squared distances, for the budget sort. */
  dist: Float32Array;
  drawn: number;
  /**
   * The "did anything move" gate: 32 floats — the CAMERA's world matrix
   * followed by the MESH's. Both matter. A ferris wheel full of instanced
   * gondolas turns while the camera stands still; gating on the camera alone
   * freezes the packing and the half of the crowd that swung into view stays
   * culled. Set element 0 to NaN to force the next pack.
   */
  gate: Float32Array;
  /** True while the whole matrix buffer needs re-uploading (packing changed). */
  fullDirty: boolean;
  packs: number;
  /** Whether a packing has ever run; before that, slot === srcIndex. */
  packed: boolean;
}

const PACK_KEY = "__pack";

function geometryRadius(geo: THREE.BufferGeometry): number {
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  return geo.boundingSphere ? geo.boundingSphere.radius : 1;
}

/** Recompute one instance's local cull sphere from its matrix. */
function writeSphere(st: InstancedPacker, i: number, baseRadius: number): void {
  const o = i * 16;
  const s = st.src;
  // Column lengths of the upper 3x3 are the axis scales; the largest one is the
  // only honest radius multiplier for a non-uniform instance.
  const sx = Math.hypot(s[o], s[o + 1], s[o + 2]);
  const sy = Math.hypot(s[o + 4], s[o + 5], s[o + 6]);
  const sz = Math.hypot(s[o + 8], s[o + 9], s[o + 10]);
  const k = i * 4;
  st.spheres[k] = s[o + 12];
  st.spheres[k + 1] = s[o + 13];
  st.spheres[k + 2] = s[o + 14];
  st.spheres[k + 3] = baseRadius * Math.max(sx, sy, sz);
}

/** The packer for this mesh, adopting an externally built buffer if needed. */
export function getPacker(inst: THREE.InstancedMesh): InstancedPacker {
  const existing = (inst.userData as Record<string, unknown>)[PACK_KEY] as InstancedPacker | undefined;
  if (existing) return existing;

  const capacity = inst.instanceMatrix.count;
  const live = (inst.instanceMatrix.array as Float32Array).slice(0, capacity * 16);
  const st: InstancedPacker = {
    src: live,
    srcColor: inst.instanceColor ? (inst.instanceColor.array as Float32Array).slice(0, capacity * 3) : null,
    count: inst.count,
    capacity,
    spheres: new Float32Array(capacity * 4),
    order: new Int32Array(capacity),
    slot: new Int32Array(capacity),
    next: new Int32Array(capacity),
    dist: new Float32Array(capacity),
    drawn: inst.count,
    gate: new Float32Array(32).fill(Number.NaN),
    fullDirty: false,
    packs: 0,
    packed: false,
  };
  const r = geometryRadius(inst.geometry);
  for (let i = 0; i < capacity; i++) {
    st.order[i] = i;
    st.slot[i] = i < st.count ? i : -1;
    writeSphere(st, i, r);
  }
  (inst.userData as Record<string, unknown>)[PACK_KEY] = st;
  return st;
}

/* ------------------------------------------------------------------ */
/* BUILD                                                               */
/* ------------------------------------------------------------------ */

export interface BuildInstancedOptions {
  /**
   * Reserve room beyond the supplied transforms. InstancedMesh cannot grow, so
   * anything that spawns at runtime (a parade that gains marchers) must reserve
   * up front or be rebuilt — and rebuilding mid-play is a visible hitch.
   */
  capacity?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /**
   * Particles, glows and sprites MUST set this. The Sobel interior-line pass
   * reads a normal+depth prepass; anything soft and additive that reaches that
   * prepass comes back as a black square. This is a bug we have already shipped
   * once and fixed once.
   */
  noInk?: boolean;
  name?: string;
  /**
   * Leave the renderer's own whole-mesh frustum test on. Default false, because
   * a crowd's bounding sphere usually contains the camera and the test then
   * costs a matrix decompose for nothing — `packVisible` culls per instance
   * instead.
   */
  frustumCulled?: boolean;
  /** Force an instanceColor attribute even when no transform carries a colour. */
  color?: boolean;
}

/**
 * Build an InstancedMesh from a transform list, with per-instance cull spheres
 * ready for `packVisible`.
 */
export function buildInstanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  transforms: ReadonlyArray<InstanceInput>,
  opts: BuildInstancedOptions = {}
): THREE.InstancedMesh {
  const count = transforms.length;
  const capacity = Math.max(count, opts.capacity ?? count, 1);

  const inst = new THREE.InstancedMesh(geo, mat, capacity);
  inst.count = count;
  inst.name = opts.name ?? "instanced";
  inst.castShadow = opts.castShadow ?? false;
  inst.receiveShadow = opts.receiveShadow ?? true;
  inst.frustumCulled = opts.frustumCulled ?? false;
  if (opts.noInk) inst.layers.set(NO_INK_LAYER);

  const wantColor = opts.color === true || transforms.some((t) => !(t instanceof THREE.Matrix4) && !(t instanceof THREE.Object3D) && t.color !== undefined);
  if (wantColor) {
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    // three multiplies instanceColor into vColor, but only folds vColor into
    // diffuseColor under USE_COLOR — i.e. `material.vertexColors === true`.
    // Without it the tints upload, cost bandwidth, and change nothing on
    // screen. We refuse to set it for you: a material shared with a mesh that
    // has no `color` attribute would render BLACK, which is a far worse day.
    if (!mat.vertexColors && typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
      console.warn(
        `buildInstanced("${inst.name}"): per-instance colours were given but ` +
        `material.vertexColors is false, so they will not be visible. Set ` +
        `mat.vertexColors = true on a material used ONLY by this crowd.`
      );
    }
  }

  const src = new Float32Array(capacity * 16);
  const srcColor = wantColor ? new Float32Array(capacity * 3).fill(1) : null;

  // Identity for the reserved tail, so a stray draw of an unwritten instance is
  // a unit-scale object at the origin rather than a collapsed NaN triangle.
  for (let i = count; i < capacity; i++) _m.identity().toArray(src, i * 16);

  for (let i = 0; i < count; i++) {
    const col = composeMatrix(transforms[i], _m);
    _m.toArray(src, i * 16);
    if (srcColor && col) col.toArray(srcColor, i * 3);
  }

  (inst.instanceMatrix.array as Float32Array).set(src);
  inst.instanceMatrix.needsUpdate = true;
  if (srcColor && inst.instanceColor) {
    (inst.instanceColor.array as Float32Array).set(srcColor);
    inst.instanceColor.needsUpdate = true;
  }

  const st: InstancedPacker = {
    src,
    srcColor,
    count,
    capacity,
    spheres: new Float32Array(capacity * 4),
    order: new Int32Array(capacity),
    slot: new Int32Array(capacity),
    next: new Int32Array(capacity),
    dist: new Float32Array(capacity),
    drawn: count,
    gate: new Float32Array(32).fill(Number.NaN),
    fullDirty: false,
    packs: 0,
    packed: false,
  };
  const r = geometryRadius(geo);
  for (let i = 0; i < capacity; i++) {
    st.order[i] = i;
    st.slot[i] = i < count ? i : -1;
    writeSphere(st, i, r);
  }
  (inst.userData as Record<string, unknown>)[PACK_KEY] = st;

  // Covers every instance, so shadows and any external culling behave.
  inst.computeBoundingSphere();
  return inst;
}

/* ------------------------------------------------------------------ */
/* CHEAP SUBSET UPDATES                                                */
/* ------------------------------------------------------------------ */

/**
 * Update a SUBSET of instances without re-uploading the whole buffer.
 *
 * `write` receives the instance's current matrix; mutate it in place. We then
 * store it back to the authoritative list AND, if that instance is currently
 * drawn, to its live slot — registering a GPU update range so three uploads
 * only the sixteen floats that changed. Moving eight gondolas out of six
 * hundred instances should cost eight matrices of bandwidth, not six hundred.
 *
 * Update ranges are skipped (and a full upload used) if a repack already dirtied
 * the whole buffer this frame — mixing the two would upload only the ranges and
 * silently drop the repack.
 */
export function updateInstances(
  inst: THREE.InstancedMesh,
  indices: ArrayLike<number>,
  write: (index: number, matrix: THREE.Matrix4) => void
): void {
  const st = getPacker(inst);
  const live = inst.instanceMatrix.array as Float32Array;
  const r = geometryRadius(inst.geometry);
  const partial = !st.fullDirty;
  let movedACulledOne = false;

  for (let n = 0; n < indices.length; n++) {
    const i = indices[n];
    if (i < 0 || i >= st.count) continue;
    _m.fromArray(st.src, i * 16);
    write(i, _m);
    _m.toArray(st.src, i * 16);
    writeSphere(st, i, r);

    const slot = st.packed ? st.slot[i] : i;
    if (slot >= 0) {
      live.set(st.src.subarray(i * 16, i * 16 + 16), slot * 16);
      if (partial) inst.instanceMatrix.addUpdateRange(slot * 16, 16);
    } else {
      // This instance is currently culled and has just moved — it may now be on
      // screen, and the camera-and-mesh motion gate will not notice, because
      // neither of them moved. Only a repack can bring it back, so demand one.
      // A drawn instance that moves OUT of view needs no such push: it stays
      // drawn for a frame or two, which costs a little fill and shows nothing
      // wrong. An invisible piece is the defect; an extra one is not.
      movedACulledOne = true;
    }
  }
  if (movedACulledOne) st.gate[0] = Number.NaN;
  inst.instanceMatrix.needsUpdate = true;
}

/** Read one instance's authoritative matrix (authoring index, not draw slot). */
export function instanceMatrix(inst: THREE.InstancedMesh, index: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  return out.fromArray(getPacker(inst).src, index * 16);
}

/**
 * Change how many instances exist (not how many are visible — that is the
 * packer's job). Capped at the capacity reserved at build time.
 */
export function setInstanceCount(inst: THREE.InstancedMesh, count: number): number {
  const st = getPacker(inst);
  st.count = Math.max(0, Math.min(count, st.capacity));
  st.gate[0] = Number.NaN; // force the next pack
  if (!st.packed) inst.count = st.count;
  return st.count;
}

/* ------------------------------------------------------------------ */
/* FRUSTUM-CULL-AWARE PACKING                                          */
/* ------------------------------------------------------------------ */

const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _localCam = new THREE.Vector3();

/** Shared, grow-only scratch for the budget sort. See the note at its use. */
let _posScratch = new Int32Array(0);
let _keepScratch = new Int32Array(0);

export interface PackOptions {
  /** Drop instances further than this (local units). Fog eats them anyway. */
  maxDistance?: number;
  /** Grow every cull sphere by this much — cheap insurance against pop-in at the screen edge. */
  margin?: number;
  /** Hard ceiling on drawn instances; the nearest survive. Used by the quality ladder. */
  budget?: number;
  /**
   * Skip the whole pass unless the camera's world matrix moved by more than
   * this. A parked camera then costs one matrix comparison per frame.
   */
  epsilon?: number;
  /** Repack regardless of the motion gate (after a rig cut, or a transform edit). */
  force?: boolean;
  /** Turn off frustum testing and keep only the distance/budget rules. */
  noFrustum?: boolean;
}

/**
 * Cull to the camera and pack the survivors to the front of the instance
 * buffer. Returns the number of instances now being drawn.
 *
 * The frustum is built in the mesh's LOCAL space (model matrix folded into
 * projection * view) so the per-instance test is six plane dots against the
 * translation we already have — no per-instance matrix work at all.
 */
export function packVisible(
  inst: THREE.InstancedMesh,
  camera: THREE.Camera,
  opts: PackOptions = {}
): number {
  const st = getPacker(inst);
  if (st.count === 0) { inst.count = 0; return 0; }

  const eps = opts.epsilon ?? 0.02;
  const cm = camera.matrixWorld.elements;
  const om = inst.matrixWorld.elements;
  if (!opts.force) {
    let moved = false;
    for (let i = 0; i < 16; i++) {
      // NaN compares false, which is exactly the "never packed yet" behaviour.
      if (!(Math.abs(cm[i] - st.gate[i]) <= eps)) { moved = true; break; }
      if (!(Math.abs(om[i] - st.gate[i + 16]) <= eps)) { moved = true; break; }
    }
    if (!moved) { inst.count = st.drawn; return st.drawn; }
  }
  for (let i = 0; i < 16; i++) { st.gate[i] = cm[i]; st.gate[i + 16] = om[i]; }

  _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(inst.matrixWorld);
  _frustum.setFromProjectionMatrix(_pv);
  _inv.copy(inst.matrixWorld).invert();
  _localCam.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_inv);

  const margin = opts.margin ?? 0;
  const maxD = opts.maxDistance ?? Number.POSITIVE_INFINITY;
  const maxD2 = maxD === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : maxD * maxD;
  const planes = _frustum.planes;
  const sph = st.spheres;
  const next = st.next;
  let n = 0;

  for (let i = 0; i < st.count; i++) {
    const k = i * 4;
    const cx = sph[k], cy = sph[k + 1], cz = sph[k + 2];
    const rad = sph[k + 3] + margin;

    const dx = cx - _localCam.x, dy = cy - _localCam.y, dz = cz - _localCam.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > maxD2) continue;

    if (!opts.noFrustum) {
      let inside = true;
      for (let p = 0; p < 6; p++) {
        const pl = planes[p].normal;
        if (pl.x * cx + pl.y * cy + pl.z * cz + planes[p].constant < -rad) { inside = false; break; }
      }
      if (!inside) continue;
    }

    st.dist[n] = d2;
    next[n++] = i;
  }

  // Budget: keep the nearest.
  //
  // This is NOT a rare path. The quality ladder feeds `crowdBudget()` in here,
  // so on a low rung every crowd overflows on every frame — which is exactly
  // the device that can least afford a Map and two arrays of garbage per crowd
  // per frame. So we sort POSITIONS in reusable scratch and gather through it.
  const budget = opts.budget ?? Number.POSITIVE_INFINITY;
  if (n > budget) {
    if (_posScratch.length < n) {
      _posScratch = new Int32Array(n);
      _keepScratch = new Int32Array(n);
    }
    const pos = _posScratch;
    const keep = _keepScratch;
    const d = st.dist;
    for (let i = 0; i < n; i++) pos[i] = i;
    // Subarray so the sort only touches the live prefix.
    pos.subarray(0, n).sort((a, b) => d[a] - d[b]);
    n = budget;
    for (let i = 0; i < n; i++) keep[i] = next[pos[i]];
    for (let i = 0; i < n; i++) next[i] = keep[i];
  }

  // If the packing is identical to last frame there is nothing to upload —
  // the common case for a slowly panning camera over a static crowd.
  let same = st.packed && n === st.drawn;
  if (same) {
    for (let i = 0; i < n; i++) if (st.order[i] !== next[i]) { same = false; break; }
  }
  if (same) { inst.count = n; return n; }

  const live = inst.instanceMatrix.array as Float32Array;
  const liveColor = inst.instanceColor ? (inst.instanceColor.array as Float32Array) : null;
  st.slot.fill(-1, 0, st.count);
  for (let i = 0; i < n; i++) {
    const s = next[i];
    st.order[i] = s;
    st.slot[s] = i;
    live.set(st.src.subarray(s * 16, s * 16 + 16), i * 16);
    if (liveColor && st.srcColor) liveColor.set(st.srcColor.subarray(s * 3, s * 3 + 3), i * 3);
  }

  // A full rewrite invalidates any partial ranges queued by updateInstances.
  inst.instanceMatrix.clearUpdateRanges();
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  st.fullDirty = true;
  st.drawn = n;
  st.packs++;
  st.packed = true;
  inst.count = n;
  return n;
}

/**
 * Call once per frame AFTER rendering (or at the top of the next frame) to let
 * partial update ranges resume. Optional: without it, updates stay on the
 * conservative full-upload path, which is correct but costs bandwidth.
 */
export function endInstanceFrame(inst: THREE.InstancedMesh): void {
  getPacker(inst).fullDirty = false;
}

/** How many instances are actually being drawn right now. */
export function drawnCount(inst: THREE.InstancedMesh): number {
  return getPacker(inst).drawn;
}
