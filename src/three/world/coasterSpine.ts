"use client";

import * as THREE from "three";
import { terrainHeight } from "./terrain";
import { mergeGeometries } from "./terrain";

/**
 * THE COASTER SPINE — the backbone of the whole experience.
 *
 * A gentle wooden coaster track that threads every attraction together.
 * Riding it is literally how ChessPaa carries a child from one stage to the
 * next: the child sits in the plush car, his lantern swinging up front, and
 * the world slides past on a track choreographed for maximum wonder.
 *
 * The choreography that matters most: a SLOW CLIMB that HIDES the view,
 * a crest, and then THE REVEAL — the whole wonderland opening below in
 * stacked paper-flat haze layers. That crest is the shot the game is built
 * around, so the waypoints around it are hand-placed, not procedural.
 */

/** Where each attraction sits in the valley. Everything else references these. */
export const ATTRACTIONS = {
  gate:    new THREE.Vector3(  4, 0,  64),
  plaza:   new THREE.Vector3(  0, 0,   0),
  parade:  new THREE.Vector3(-46, 0, -24),
  ferris:  new THREE.Vector3(-70, 0, -60),
  coaster: new THREE.Vector3( 64, 0, -74),
  train:   new THREE.Vector3( 36, 0,  30),
} as const;

export type StopName = keyof typeof ATTRACTIONS;

interface Waypoint {
  p: [number, number, number];
  /** If set, this waypoint is an attraction platform where the car settles. */
  stop?: StopName;
  /** Extra banking (radians) through this section. */
  bank?: number;
}

/**
 * The full circuit. Height values are ABSOLUTE (the track is a built
 * structure on stilts, it does not follow the ground) except where noted.
 */
const WAYPOINTS: Waypoint[] = [
  { p: [   4, 1.6,  64], stop: "gate" },
  { p: [  -3, 1.7,  50] },
  { p: [ -12, 1.9,  32] },
  { p: [ -13, 2.0,  10] },
  { p: [  -6, 2.0,   2], stop: "plaza" },
  { p: [ -18, 2.2,  -6] },
  { p: [ -32, 2.6, -14] },
  { p: [ -44, 2.6, -22], stop: "parade" },
  { p: [ -58, 3.2, -30] },
  { p: [ -70, 4.2, -44] },
  { p: [ -72, 5.0, -60], stop: "ferris" },
  { p: [ -62, 5.4, -74] },
  { p: [ -42, 5.6, -82] },
  // ---- the slow climb begins; the ridge deliberately HIDES the valley ----
  { p: [ -18, 8.0, -88], bank: 0.05 },
  { p: [   8, 13.5, -92], bank: 0.08 },
  { p: [  30, 21.0, -90], bank: 0.10 },
  { p: [  48, 28.5, -84], bank: 0.12 },
  // ★ THE CREST — everything opens up here.
  { p: [  58, 33.5, -70], stop: "coaster", bank: 0.06 },
  // ---- the drop, fast and swooping back down into the valley ----
  { p: [  62, 27.0, -52], bank: -0.28 },
  { p: [  60, 17.5, -34], bank: -0.34 },
  { p: [  54, 10.0, -18], bank: -0.22 },
  { p: [  48,  5.6,  -2], bank: -0.10 },
  { p: [  44,  3.4,  14] },
  { p: [  38,  2.4,  28], stop: "train" },
  { p: [  28,  2.0,  44] },
  { p: [  16,  1.8,  58] },
];

export const SPINE_CURVE = new THREE.CatmullRomCurve3(
  WAYPOINTS.map((w) => new THREE.Vector3(...w.p)),
  true, "catmullrom", 0.5
);

/** Parametric position (0..1) of each attraction platform along the loop. */
export const STOP_T: Record<StopName, number> = (() => {
  const out = {} as Record<StopName, number>;
  WAYPOINTS.forEach((w, i) => {
    if (w.stop) out[w.stop] = i / WAYPOINTS.length;
  });
  return out;
})();

/** Banking at a given t, interpolated between waypoints. */
export function bankAt(t: number): number {
  const n = WAYPOINTS.length;
  const f = ((t % 1) + 1) % 1 * n;
  const i0 = Math.floor(f) % n;
  const i1 = (i0 + 1) % n;
  const frac = f - Math.floor(f);
  const b0 = WAYPOINTS[i0].bank ?? 0;
  const b1 = WAYPOINTS[i1].bank ?? 0;
  return THREE.MathUtils.lerp(b0, b1, frac);
}

/**
 * A stable frame along the track. Three's computeFrenetFrames flips at
 * inflection points, which would roll the car upside-down mid-ride, so we
 * build the frame from a world-up reference plus our authored banking.
 */
export function frameAt(t: number): { pos: THREE.Vector3; tangent: THREE.Vector3; normal: THREE.Vector3; binormal: THREE.Vector3 } {
  const pos = SPINE_CURVE.getPointAt(((t % 1) + 1) % 1);
  const tangent = SPINE_CURVE.getTangentAt(((t % 1) + 1) % 1).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();
  const normal = new THREE.Vector3().crossVectors(binormal, tangent).normalize();
  const bank = bankAt(t);
  if (Math.abs(bank) > 1e-4) {
    const q = new THREE.Quaternion().setFromAxisAngle(tangent, bank);
    binormal.applyQuaternion(q);
    normal.applyQuaternion(q);
  }
  return { pos, tangent, normal, binormal };
}

/* ------------------------------------------------------------------ */
/* TRACK GEOMETRY — two rails, wooden sleepers, and trestle supports   */
/* ------------------------------------------------------------------ */

const RAIL_GAUGE = 1.15;
const RAIL_RADIUS = 0.085;

/** The two running rails, swept along the spine with our stable frame. */
export function buildRailGeometry(segments = 900, sides = 6): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const positions: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const { pos, normal, binormal } = frameAt(t);
      const centre = pos.clone()
        .addScaledVector(binormal, (RAIL_GAUGE / 2) * side)
        .addScaledVector(normal, 0.12);
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        const off = normal.clone().multiplyScalar(Math.cos(a) * RAIL_RADIUS)
          .addScaledVector(binormal, Math.sin(a) * RAIL_RADIUS);
        positions.push(centre.x + off.x, centre.y + off.y, centre.z + off.z);
        uvs.push(t * 90, j / sides);
      }
    }
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < sides; j++) {
        const a = i * sides + j;
        const b = i * sides + ((j + 1) % sides);
        const c = a + sides;
        const d = b + sides;
        indices.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    parts.push(g);
  }
  return mergeGeometries(parts);
}

/** Wooden sleepers laid between the rails. */
export function buildSleeperGeometry(count = 340): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const { pos, tangent, normal, binormal } = frameAt(t);
    const g = new THREE.BoxGeometry(RAIL_GAUGE * 1.6, 0.09, 0.3);
    const m = new THREE.Matrix4().makeBasis(binormal, normal, tangent);
    g.applyMatrix4(m);
    g.translate(pos.x, pos.y + 0.04, pos.z);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

/**
 * TRESTLE SUPPORTS — the wooden legs that carry the track above the ground.
 * Each is a post down to the terrain plus a pair of cross-braces, so the big
 * climb reads as a real built structure rather than a floating ribbon.
 */
export function buildSupportGeometry(count = 96): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const { pos, binormal } = frameAt(t);
    const ground = terrainHeight(pos.x, pos.z);
    const h = pos.y - ground;
    if (h < 0.7) continue;

    for (const side of [-1, 1]) {
      const x = pos.x + binormal.x * (RAIL_GAUGE * 0.72) * side;
      const z = pos.z + binormal.z * (RAIL_GAUGE * 0.72) * side;
      const legH = pos.y - terrainHeight(x, z);
      const post = new THREE.CylinderGeometry(0.10, 0.14, legH, 6);
      post.translate(x, pos.y - legH / 2, z);
      parts.push(post);
    }
    // cross-brace, only where the legs are tall enough to need one
    if (h > 2.4) {
      const braceCount = Math.min(4, Math.floor(h / 2.6));
      for (let b = 1; b <= braceCount; b++) {
        const y = ground + (h * b) / (braceCount + 1);
        const g = new THREE.BoxGeometry(RAIL_GAUGE * 1.62, 0.09, 0.09);
        const ang = Math.atan2(binormal.x, binormal.z);
        g.rotateY(ang);
        g.translate(pos.x, y, pos.z);
        parts.push(g);
      }
    }
  }
  return parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
}

/** Where the car should sit for a given stop, plus the platform's facing. */
export function stopFrame(stop: StopName) {
  return frameAt(STOP_T[stop]);
}
