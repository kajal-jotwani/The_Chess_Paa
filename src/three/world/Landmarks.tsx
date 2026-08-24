"use client";

import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { PALETTE, css, mix } from "../core/palette";
import { createToonMaterial, type ToonMaterial } from "../core/materials/ToonMaterial";
import { createOutlineMaterial, smoothNormalsForOutline } from "../core/materials/OutlineMaterial";
import { patchMaterialForBandedFog } from "../core/materials/SkyMaterial";
import {
  woodTexture, stripeTexture, snowTexture, parchmentTexture, glowSprite, rng,
} from "../core/textures/procedural";
import { NO_INK_LAYER } from "../core/postfx/effects";
import { mergeGeometries, terrainHeight } from "./terrain";
import { SPINE_CURVE, ATTRACTIONS } from "./coasterSpine";
import { pieceGeometry, pieceHeight, type PieceType } from "../core/geometry/pieces";

/**
 * WHY THE GEOMETRY AND THE COMPONENTS SHARE ONE FILE.
 *
 * `landmarks.ts` and `Landmarks.tsx` differ ONLY in case. Webpack and
 * Turbopack both try `.tsx` before `.ts`, and on a case-insensitive
 * filesystem — every default macOS install — `import ... from "./landmarks"`
 * inside `Landmarks.tsx` therefore resolves to `Landmarks.tsx` ITSELF. The
 * build succeeds, every imported symbol is `undefined`, and the park dies on
 * first render with a mystifying "not a function". (esbuild refuses outright
 * and names the hazard; the Next bundlers do not.)
 *
 * So this file imports nothing local, and `landmarks.ts` next to it is a pure
 * re-export facade. Whichever spelling anyone reaches for, they land here.
 * DO NOT "tidy" this by splitting the builders back out into `landmarks.ts`
 * and importing them — that is the bug, not the fix.
 */

/**
 * THE FIVE ATTRACTIONS — every structure in the park, carved in code.
 *
 * PART ONE of this file is PURE GEOMETRY: builders that know nothing about
 * React, materials or frames. Each hands back a BAG of BufferGeometry keyed by
 * which material it wants, plus the small amount of rig data the animated
 * pieces need (where the Ferris hub is, where the train's rail runs, which way
 * a gondola hangs). PART TWO turns those bags into meshes and drives the three
 * independent clocks. Jump to "THE MATERIAL BANK" for the React half.
 *
 * WHY BAGS AND NOT MESHES: the whole set — five attractions plus the plaza
 * dressing — resolves to ONE merged mesh per material. A striped valance on
 * the big top and a striped valance on the ticket booth are the same draw
 * call. That is the only way this many built structures fit inside a 60fps
 * budget at retina.
 *
 * WHY EVERYTHING IS PLACED ON terrainHeight(): the valley rolls. A shed that
 * floats 40cm above the snow destroys the illusion faster than any shader can
 * rebuild it, so every foot, post, pier and pad is sunk to real ground.
 *
 * WHY THE LANDMARKS BEND AROUND THE COASTER: the spine threads straight
 * through three of the five sites. Rather than shove the rides aside we made
 * that the point — the coaster runs under the parade canopy, between the legs
 * of the Ferris wheel, and over the puzzle train's trestle. `spineDistanceXZ`
 * is what keeps the posts out of its way.
 */

/* ================================================================== */
/* MATERIAL KEYS — the park's whole palette of surfaces                */
/* ================================================================== */

/**
 * Every surface in the park belongs to exactly one of these. Keep the list
 * short: each key costs one draw call (two if it wears an ink outline).
 */
export type MatKey =
  /** Structural toy-wood: posts, beams, decks, trestles. */
  | "timber"
  /** Pale planed wood: platform boards, shed cladding, carved signs. */
  | "timberPale"
  /** Dark ironwork: rails, chain housings, hoops, hinges. */
  | "iron"
  /** Painted cream panels and parchment sign faces. */
  | "cream"
  /** Painted teal joinery and gondolas. */
  | "teal"
  /** Painted plum joinery and gondolas. */
  | "plum"
  /** Warm painted honey — trim, wheels, finials. */
  | "honey"
  /** Polished brass — lamp housings, hoops, spinning drums. */
  | "brass"
  /** Teal-and-plum striped canvas: the Piece Parade canopy. */
  | "canvasParade"
  /** Plum-and-cream striped canvas: the Grand Match Tent. */
  | "canvasTent"
  /** Honey-and-cream striped canvas: booths, awnings, the carousel. */
  | "canvasFair"
  /** Snow lying on roofs and ledges. */
  | "snow"
  /** Painted sign faces (their own texture atlas). */
  | "signPaint"
  /** Painted signpost fingerboards (icon atlas). */
  | "signIcons"
  /** The clock face. */
  | "clockFace";

/** A bag of geometry waiting to be merged, keyed by the material it wants. */
export type GeoBag = Map<MatKey, THREE.BufferGeometry[]>;

/** One merged geometry per material — what a bag becomes when it is baked. */
export type BakedParts = Partial<Record<MatKey, THREE.BufferGeometry>>;

export function makeBag(): GeoBag {
  return new Map();
}

/** Drop geometry into a bag under a material key. */
export function put(bag: GeoBag, key: MatKey, ...geos: THREE.BufferGeometry[]): void {
  const list = bag.get(key);
  if (list) list.push(...geos);
  else bag.set(key, [...geos]);
}

/** Pour one bag into another (used to merge all five attractions into one set). */
export function absorb(dst: GeoBag, src: GeoBag): void {
  for (const [k, v] of src) put(dst, k, ...v);
}

/**
 * Merge a bag down to one geometry per material.
 * NOTE: `mergeGeometries` disposes its inputs, so a bag is single-use.
 */
export function bake(bag: GeoBag): BakedParts {
  const out: BakedParts = {};
  for (const [k, list] of bag) {
    if (!list.length) continue;
    out[k] = list.length === 1 ? list[0] : mergeGeometries(list);
  }
  return out;
}

/* ================================================================== */
/* LIGHT DATA — what the component turns into sprites and pointLights  */
/* ================================================================== */

/**
 * A warm practical light. `glow` is the additive sprite radius (0 = no sprite),
 * `intensity`/`distance` drive a real pointLight (intensity 0 = no light).
 * Sprites MUST end up on NO_INK_LAYER or the Sobel pass inks them into squares.
 */
export interface GlowSpot {
  pos: [number, number, number];
  color: number;
  glow: number;
  intensity: number;
  distance: number;
  /** Twinkle phase so a row of lanterns does not pulse in lockstep. */
  phase: number;
}

/** The standard return of a landmark builder. */
export interface LandmarkBuild {
  parts: GeoBag;
  glows: GlowSpot[];
}

function glow(
  pos: [number, number, number],
  color: number,
  g: number,
  intensity: number,
  distance: number,
  phase: number
): GlowSpot {
  return { pos, color, glow: g, intensity, distance, phase };
}

/* ================================================================== */
/* PRIMITIVES — the small vocabulary everything is carved from         */
/* ================================================================== */

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

function box(w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

function cyl(
  rTop: number, rBot: number, h: number, seg: number,
  x = 0, y = 0, z = 0
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1);
  g.translate(x, y, z);
  return g;
}

/**
 * A beam running from a to b. Every leg, brace, guy-rope and rail in the park
 * is one of these — it is the single most-used primitive here.
 */
function strut(
  a: THREE.Vector3, b: THREE.Vector3, rA: number, rB = rA, seg = 6
): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  // A zero-length strut would produce an attribute-less geometry and crash the
  // merge, so degenerate cases collapse to a sliver instead of nothing.
  if (len < 1e-5) return new THREE.CylinderGeometry(rB, rA, 1e-3, 3, 1).translate(a.x, a.y, a.z);
  const g = new THREE.CylinderGeometry(rB, rA, len, seg, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.divideScalar(len)));
  g.translate(a.x, a.y, a.z);
  return g;
}

/**
 * A LATTICE TOWER between two points.
 *
 * A solid twenty-four-metre post reads as a black slab pasted on the dusk. A
 * real fairground tower is an open lattice you can see the sky through, and
 * that openness is most of what makes a great wheel feel light instead of
 * industrial. Four chords, a rung at every bay, and zigzag diagonals on the
 * two broad faces — the same thing the coaster's own trestles do, so the
 * Ferris wheel reads as built by the same carpenter.
 */
function latticeTower(
  a: THREE.Vector3, b: THREE.Vector3, w0: number, w1: number, bays: number, r = 0.15
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3().subVectors(b, a);
  if (up.lengthSq() < 1e-6) return out;
  up.normalize();
  const lat = new THREE.Vector3(0, 1, 0).cross(up);
  if (lat.lengthSq() < 1e-6) lat.set(1, 0, 0);
  lat.normalize();
  const perp = new THREE.Vector3().crossVectors(up, lat).normalize();
  const at = (t: number, sx: number, sy: number) => {
    const w = THREE.MathUtils.lerp(w0, w1, t);
    return new THREE.Vector3().lerpVectors(a, b, t)
      .addScaledVector(lat, sx * w).addScaledVector(perp, sy * w);
  };
  const corners: Array<[number, number]> = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
  for (const [sx, sy] of corners) {
    for (let i = 0; i < bays; i++) {
      out.push(strut(at(i / bays, sx, sy), at((i + 1) / bays, sx, sy), r, r * 0.86, 5));
    }
  }
  for (let i = 0; i <= bays; i++) {
    const t = i / bays;
    for (let c = 0; c < 4; c++) {
      const [ax, ay] = corners[c];
      const [bx, by] = corners[(c + 1) % 4];
      out.push(strut(at(t, ax, ay), at(t, bx, by), r * 0.5, r * 0.5, 4));
      // zigzag: each bay leans the opposite way to its neighbour
      if (i < bays) {
        const flip = (i + c) % 2 === 0;
        out.push(strut(
          at(t, flip ? ax : bx, flip ? ay : by),
          at((i + 1) / bays, flip ? bx : ax, flip ? by : ay), r * 0.4, r * 0.4, 4));
      }
    }
  }
  return out;
}

/** A turned column: a hand-authored [radius, height] profile on a lathe. */
function lathe(profile: Array<[number, number]>, seg = 12): THREE.BufferGeometry {
  return new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(Math.max(r, 1e-4), h)), seg);
}

/**
 * BARLEY-TWIST POLE — the spiral-fluted column of every fairground.
 *
 * A lathe cannot make one: the radius has to vary with ANGLE as well as
 * height. So we sweep the surface by hand, twisting the flute phase as we
 * climb. It costs a few hundred triangles and it is the single detail that
 * makes a pole read "carnival" instead of "cylinder".
 */
function twistPole(
  h: number, r0: number, amp: number, flutes: number, twist: number,
  seg = 14, rings = 18, y0 = 0
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const v = j / rings;
    const y = y0 + v * h;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      const r = r0 + amp * Math.sin(flutes * (a + v * twist));
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      uvs.push(i / seg, v * 3);
    }
  }
  const stride = seg + 1;
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * stride + i;
      idx.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * SCALLOPED VALANCE — the frilled skirt that hangs off every canopy edge.
 *
 * The bottom edge dips in half-sine arcs. This one silhouette is what makes a
 * cone of canvas read as a fairground tent rather than a traffic cone, so it
 * is used on the parade canopy, the big top, the carousel, the booths and the
 * cotton-candy awning.
 */
function scallopBand(opts: {
  radius: number;
  top: number;
  depth: number;
  scallops: number;
  seg?: number;
  /** Radius at the bottom edge, for a valance that flares out. */
  radiusBottom?: number;
  uRepeat?: number;
  /** Only sweep part of the circle (radians). */
  arcStart?: number;
  arcLength?: number;
}): THREE.BufferGeometry {
  const {
    radius, top, depth, scallops, seg = 96, radiusBottom = radius,
    uRepeat = 1, arcStart = 0, arcLength = TAU,
  } = opts;
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const f = i / seg;
    const a = arcStart + f * arcLength;
    const scallopPhase = ((a * scallops) / TAU) % 1;
    const dip = Math.sin(Math.PI * ((scallopPhase + 1) % 1));
    const drop = depth * (0.26 + 0.74 * dip);
    pos.push(Math.cos(a) * radius, top, Math.sin(a) * radius);
    pos.push(Math.cos(a) * radiusBottom, top - drop, Math.sin(a) * radiusBottom);
    uvs.push(f * uRepeat, 1, f * uRepeat, 0);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A CANOPY OF CANVAS — the swept surface used for the parade ring, the big
 * top and the carousel.
 *
 * The two shape controls are what sell it as cloth:
 *   `sag`      — the canvas hangs BETWEEN the poles, so the surface dips in
 *                the bays and pulls tight along each pole line.
 *   `poleLift` — at the eave, each pole pushes the hem UP, giving the classic
 *                scalloped tent skyline.
 * UVs run u = angle (so painted stripes converge on the peak) and v = radial.
 */
function canopySurface(opts: {
  rOuter: number; yOuter: number;
  rInner: number; yInner: number;
  bays: number;
  seg?: number; steps?: number;
  sag?: number; poleLift?: number;
  uRepeat?: number;
  /** Skip an angular slice — used to cut the big top's doorway. */
  gapCenter?: number; gapWidth?: number;
}): THREE.BufferGeometry {
  const {
    rOuter, yOuter, rInner, yInner, bays,
    seg = 120, steps = 10, sag = 0.35, poleLift = 0.3, uRepeat = 1,
    gapCenter, gapWidth = 0,
  } = opts;

  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= steps; j++) {
    const s = j / steps; // 0 = outer eave, 1 = inner ring / peak
    const r = THREE.MathUtils.lerp(rOuter, rInner, s);
    for (let i = 0; i <= seg; i++) {
      const f = i / seg;
      const a = f * TAU;
      // +1 exactly on a pole, -1 in the middle of a bay
      const bay = Math.cos(a * bays);
      const droop = sag * Math.sin(Math.PI * Math.pow(s, 0.75)) * (0.5 - 0.5 * bay);
      const lift = poleLift * bay * (1 - s) * (1 - s);
      const y = THREE.MathUtils.lerp(yOuter, yInner, Math.pow(s, 0.86)) - droop + lift;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      uvs.push(f * uRepeat, s);
    }
  }
  const stride = seg + 1;
  const inGap = (i: number) => {
    if (gapCenter === undefined || gapWidth <= 0) return false;
    const a = (i / seg) * TAU;
    let d = Math.abs(((a - gapCenter + Math.PI * 3) % TAU) - Math.PI);
    d = Math.abs(d);
    return d < gapWidth * 0.5;
  };
  for (let j = 0; j < steps; j++) {
    for (let i = 0; i < seg; i++) {
      if (inGap(i + 0.5)) continue;
      const a = j * stride + i;
      idx.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A vertical wall of canvas, optionally with a doorway cut out of it. */
function canvasWall(opts: {
  radius: number; yBottom: number; yTop: number; seg?: number;
  uRepeat?: number; gapCenter?: number; gapWidth?: number; hemScallop?: number;
}): THREE.BufferGeometry {
  const { radius, yBottom, yTop, seg = 120, uRepeat = 1, gapCenter, gapWidth = 0 } = opts;
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const f = i / seg;
    const a = f * TAU;
    pos.push(Math.cos(a) * radius, yBottom, Math.sin(a) * radius);
    pos.push(Math.cos(a) * radius, yTop, Math.sin(a) * radius);
    uvs.push(f * uRepeat, 0, f * uRepeat, 1);
  }
  const inGap = (i: number) => {
    if (gapCenter === undefined || gapWidth <= 0) return false;
    const a = (i / seg) * TAU;
    const d = Math.abs(((a - gapCenter + Math.PI * 3) % TAU) - Math.PI);
    return d < gapWidth * 0.5;
  };
  for (let i = 0; i < seg; i++) {
    if (inGap(i + 0.5)) continue;
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Scale a geometry's UVs — grain should run along a plank, not across it. */
function scaleUV(g: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
  if (!uv) return g;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return g;
}

/** A flat quad lying in the XZ plane — light pools, painted floor discs. */
function quadXZ(w: number, d: number, x = 0, y = 0, z = 0, ry = 0): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

/** An upright billboard quad — sign faces, glow planes, pennants. */
function quadXY(w: number, h: number, x = 0, y = 0, z = 0, ry = 0): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

/** A simple gabled roof: two sloped slabs plus the ridge. */
function gableRoof(
  w: number, d: number, rise: number, thickness: number,
  x: number, y: number, z: number, ry: number, overhang = 0.3
): THREE.BufferGeometry[] {
  const half = w / 2 + overhang;
  const slope = Math.atan2(rise, half);
  const len = Math.hypot(half, rise);
  const out: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(len, thickness, d + overhang * 2);
    g.rotateZ(-s * slope);
    g.translate((s * half) / 2, rise / 2, 0);
    g.rotateY(ry);
    g.translate(x, y, z);
    out.push(g);
  }
  const ridge = new THREE.BoxGeometry(thickness * 1.4, thickness * 1.4, d + overhang * 2.3);
  ridge.rotateY(ry);
  ridge.translate(x, y + rise + thickness * 0.3, z);
  out.push(ridge);
  return out;
}

/** A star, extruded — the Ferris hub cap and every finial that needs sparkle. */
function star(points: number, rOuter: number, rInner: number, depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * TAU - Math.PI / 2;
    const r = i % 2 === 0 ? rOuter : rInner;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 2 });
}

/* ================================================================== */
/* THE SPINE — every landmark has to make room for the coaster         */
/* ================================================================== */

let _spineSamples: THREE.Vector3[] | null = null;
function spineSamples(): THREE.Vector3[] {
  if (!_spineSamples) {
    _spineSamples = [];
    for (let i = 0; i < 1400; i++) _spineSamples.push(SPINE_CURVE.getPointAt(i / 1400));
  }
  return _spineSamples;
}

/** Horizontal distance from a point to the coaster track. */
export function spineDistanceXZ(x: number, z: number): number {
  let best = Infinity;
  for (const p of spineSamples()) {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Curve parameter of the track point nearest a given spot. */
export function nearestSpineT(x: number, z: number): number {
  const s = spineSamples();
  let best = Infinity;
  let bi = 0;
  for (let i = 0; i < s.length; i++) {
    const d = (s[i].x - x) ** 2 + (s[i].z - z) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  return bi / s.length;
}

/** Highest ground under a list of XZ spots — used to level a pad or a deck. */
function groundMax(spots: Array<[number, number]>): number {
  let m = -Infinity;
  for (const [x, z] of spots) m = Math.max(m, terrainHeight(x, z));
  return m;
}
function groundMin(spots: Array<[number, number]>): number {
  let m = Infinity;
  for (const [x, z] of spots) m = Math.min(m, terrainHeight(x, z));
  return m;
}
function ringSpots(cx: number, cz: number, r: number, n = 24): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return out;
}

/**
 * A skirted pad: a level timber deck with a wall that runs down to the ground
 * on every side. This is how a rigid structure meets a rolling valley without
 * a visible gap — the wall always over-reaches, and the snow banks eat the rest.
 */
function skirtedPad(
  cx: number, cz: number, r: number, top: number, sides: number, floorY: number
): THREE.BufferGeometry[] {
  const disc = new THREE.CircleGeometry(r, sides);
  disc.rotateX(-Math.PI / 2);
  disc.translate(cx, top, cz);
  scaleUV(disc, r * 0.45, r * 0.45);
  const wall = new THREE.CylinderGeometry(r, r * 1.02, top - floorY, sides, 1, true);
  wall.translate(cx, (top + floorY) / 2, cz);
  scaleUV(wall, sides * 0.5, 1);
  return [disc, wall];
}

/* ================================================================== */
/* PAINTED SIGNAGE — canvas2D, cached, never downloaded                */
/* ================================================================== */

const signCache = new Map<string, THREE.Texture>();

function paintTexture(
  key: string, w: number, h: number,
  paint: (x: CanvasRenderingContext2D, w: number, h: number) => void
): THREE.Texture {
  const hit = signCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d")!;
  paint(x, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  signCache.set(key, t);
  return t;
}

/** The storybook hand — a serif with weight, never a UI font. */
const SIGN_FONT = "'Georgia', 'Palatino Linotype', 'Book Antiqua', serif";

/**
 * Hand-painted lettering: a warm ink shadow offset down-right, then the face
 * colour, each glyph nudged a hair off the baseline. Perfectly set type reads
 * printed; a wobbling baseline reads painted by a person.
 */
function paintedText(
  x: CanvasRenderingContext2D, text: string, cx: number, cy: number,
  size: number, face: number, ink: number, wobbleSeed = 4, letterSpacing = 0
): void {
  const r = rng(wobbleSeed);
  x.font = `bold ${size}px ${SIGN_FONT}`;
  x.textAlign = "center";
  x.textBaseline = "middle";
  const widths = [...text].map((ch) => x.measureText(ch).width + letterSpacing);
  const total = widths.reduce((a, b) => a + b, 0);
  let px = cx - total / 2;
  for (let i = 0; i < text.length; i++) {
    const w = widths[i];
    const jitterY = (r() - 0.5) * size * 0.05;
    const jitterR = (r() - 0.5) * 0.045;
    x.save();
    x.translate(px + w / 2, cy + jitterY);
    x.rotate(jitterR);
    x.fillStyle = css(ink);
    x.fillText(text[i], size * 0.035, size * 0.05);
    x.fillStyle = css(face);
    x.fillText(text[i], 0, 0);
    x.restore();
    px += w;
  }
}

/** The plank-and-nail ground every painted board is painted onto. */
function paintBoard(x: CanvasRenderingContext2D, w: number, h: number, tint: number, seed: number): void {
  const r = rng(seed);
  x.fillStyle = css(tint);
  x.fillRect(0, 0, w, h);
  // plank seams
  const planks = 4;
  x.globalAlpha = 0.22;
  for (let i = 1; i < planks; i++) {
    x.strokeStyle = css(mix(tint, PALETTE.cocoa, 0.6));
    x.lineWidth = 2.2;
    x.beginPath();
    const y = (i / planks) * h;
    x.moveTo(0, y);
    for (let px = 0; px <= w; px += 24) x.lineTo(px, y + (r() - 0.5) * 3);
    x.stroke();
  }
  // grain
  for (let i = 0; i < 60; i++) {
    x.globalAlpha = 0.07 + r() * 0.1;
    x.strokeStyle = css(mix(tint, r() > 0.5 ? PALETTE.walnutLight : PALETTE.cocoa, 0.5));
    x.lineWidth = 0.8 + r() * 1.8;
    const y0 = r() * h;
    x.beginPath();
    x.moveTo(-10, y0);
    for (let px = 0; px <= w + 10; px += 22) x.lineTo(px, y0 + Math.sin(px * 0.02 + i) * 4);
    x.stroke();
  }
  x.globalAlpha = 1;
}

/** A painted rule inside the board edge — every fairground sign has one. */
function paintFrame(x: CanvasRenderingContext2D, w: number, h: number, color: number, inset: number): void {
  x.strokeStyle = css(color);
  x.lineWidth = Math.max(3, h * 0.022);
  x.beginPath();
  x.roundRect(inset, inset, w - inset * 2, h - inset * 2, h * 0.08);
  x.stroke();
  x.globalAlpha = 0.55;
  x.lineWidth = Math.max(1.5, h * 0.008);
  x.beginPath();
  x.roundRect(inset * 1.9, inset * 1.9, w - inset * 3.8, h - inset * 3.8, h * 0.06);
  x.stroke();
  x.globalAlpha = 1;
}

/* -- the five painted ride icons, drawn as paths ------------------- */

type IconName = "parade" | "coaster" | "ferris" | "train" | "tent";

function paintIcon(x: CanvasRenderingContext2D, icon: IconName, cx: number, cy: number, s: number, color: number): void {
  x.save();
  x.translate(cx, cy);
  x.scale(s, s);
  x.fillStyle = css(color);
  x.strokeStyle = css(color);
  x.lineWidth = 0.13;
  x.lineCap = "round";
  x.lineJoin = "round";

  if (icon === "parade") {
    // a crowned pawn on a plinth
    x.beginPath();
    x.arc(0, -0.5, 0.26, 0, TAU);
    x.fill();
    x.beginPath();
    x.moveTo(-0.16, -0.28); x.quadraticCurveTo(-0.30, 0.20, -0.42, 0.44);
    x.lineTo(0.42, 0.44); x.quadraticCurveTo(0.30, 0.20, 0.16, -0.28);
    x.closePath(); x.fill();
    x.fillRect(-0.56, 0.46, 1.12, 0.20);
  } else if (icon === "coaster") {
    // a swooping track with a little car cresting it
    x.beginPath();
    x.moveTo(-0.78, 0.42);
    x.bezierCurveTo(-0.45, -0.62, 0.12, -0.66, 0.34, -0.12);
    x.bezierCurveTo(0.48, 0.22, 0.62, 0.34, 0.80, 0.34);
    x.stroke();
    x.beginPath();
    x.roundRect(-0.34, -0.72, 0.44, 0.28, 0.08);
    x.fill();
    x.beginPath(); x.arc(-0.24, -0.40, 0.09, 0, TAU); x.fill();
    x.beginPath(); x.arc(0.00, -0.40, 0.09, 0, TAU); x.fill();
  } else if (icon === "ferris") {
    x.beginPath(); x.arc(0, -0.10, 0.62, 0, TAU); x.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      x.beginPath();
      x.moveTo(0, -0.10);
      x.lineTo(Math.cos(a) * 0.62, -0.10 + Math.sin(a) * 0.62);
      x.stroke();
    }
    x.beginPath(); x.arc(0, -0.10, 0.13, 0, TAU); x.fill();
    x.beginPath();
    x.moveTo(-0.42, 0.72); x.lineTo(0, -0.10); x.lineTo(0.42, 0.72);
    x.stroke();
  } else if (icon === "train") {
    x.beginPath(); x.roundRect(-0.72, -0.20, 0.90, 0.46, 0.10); x.fill();
    x.beginPath(); x.roundRect(0.10, -0.54, 0.42, 0.80, 0.09); x.fill();
    x.beginPath(); x.roundRect(-0.62, -0.56, 0.20, 0.38, 0.05); x.fill();
    for (const wx of [-0.50, -0.16, 0.30]) {
      x.beginPath(); x.arc(wx, 0.34, 0.16, 0, TAU); x.fill();
    }
    x.beginPath(); x.arc(-0.52, -0.72, 0.13, 0, TAU); x.fill();
    x.beginPath(); x.arc(-0.30, -0.86, 0.10, 0, TAU); x.fill();
  } else {
    // the big top
    x.beginPath();
    x.moveTo(0, -0.82);
    x.quadraticCurveTo(0.66, -0.30, 0.80, 0.34);
    x.lineTo(-0.80, 0.34);
    x.quadraticCurveTo(-0.66, -0.30, 0, -0.82);
    x.closePath(); x.fill();
    x.fillRect(-0.90, 0.34, 1.80, 0.16);
    x.beginPath();
    x.moveTo(0, -0.90); x.lineTo(0.34, -0.78); x.lineTo(0, -0.66);
    x.closePath(); x.fill();
  }
  x.restore();
}

/**
 * THE BIG PAINTED SIGNS — one texture atlas, four boards stacked vertically.
 * Each ride's nameboard takes one horizontal band, so all the signage in the
 * park is a single draw call.
 */
export const SIGN_ATLAS_ROWS = 4;
export type SignRow = "coaster" | "train" | "tent" | "tickets";
const SIGN_ROW_INDEX: Record<SignRow, number> = { coaster: 0, train: 1, tent: 2, tickets: 3 };

export function signAtlasTexture(): THREE.Texture {
  return paintTexture("landmark-signs", 1024, 1024, (x) => {
    const rowH = 1024 / SIGN_ATLAS_ROWS;
    const rows: Array<{ label: string; sub: string; icon: IconName; face: number; board: number }> = [
      // High-contrast pairs on purpose: at dusk, across a plaza, cream-on-deep
      // is the only combination that still reads as words rather than a smudge.
      { label: "TACTICS", sub: "· COASTER ·", icon: "coaster", face: PALETTE.lanternCore, board: PALETTE.plumDeep },
      { label: "PUZZLE HALT", sub: "ALL ABOARD", icon: "train", face: PALETTE.creamPale, board: PALETTE.tealDeep },
      { label: "GRAND MATCH", sub: "· TONIGHT ·", icon: "tent", face: PALETTE.lanternCore, board: PALETTE.plumDeep },
      { label: "TICKETS", sub: "free for kids", icon: "tent", face: PALETTE.plumDeep, board: PALETTE.creamPale },
    ];
    rows.forEach((row, i) => {
      x.save();
      x.translate(0, i * rowH);
      paintBoard(x, 1024, rowH, row.board, 17 + i * 31);
      paintFrame(x, 1024, rowH, mix(row.face, row.board, 0.35), rowH * 0.07);
      if (i === 3) {
        paintedText(x, row.label, 512, rowH * 0.40, rowH * 0.30, row.face, mix(row.face, PALETTE.ink, 0.7), 9 + i);
        paintedText(x, row.sub, 512, rowH * 0.72, rowH * 0.14, mix(row.face, PALETTE.walnut, 0.4), row.board, 21 + i);
      } else {
        paintIcon(x, row.icon, 150, rowH * 0.50, rowH * 0.30, row.face);
        paintIcon(x, row.icon, 874, rowH * 0.50, rowH * 0.30, row.face);
        paintedText(x, row.label, 512, rowH * 0.40, rowH * 0.29, row.face, mix(row.face, PALETTE.ink, 0.75), 9 + i, 2);
        paintedText(x, row.sub, 512, rowH * 0.75, rowH * 0.115, mix(row.face, PALETTE.cream, 0.4), row.board, 21 + i, 6);
      }
      x.restore();
    });
  });
}

/** Remap a sign quad's UVs onto one row of the atlas. (Not a hook — see the
 *  name: an earlier `useSignRow` tripped react-hooks/rules-of-hooks.) */
function mapSignRow(g: THREE.BufferGeometry, row: SignRow): THREE.BufferGeometry {
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  const i = SIGN_ROW_INDEX[row];
  const h = 1 / SIGN_ATLAS_ROWS;
  for (let k = 0; k < uv.count; k++) {
    // atlas row 0 is at the TOP of the canvas, so flip into UV space
    uv.setXY(k, uv.getX(k), (SIGN_ATLAS_ROWS - 1 - i) * h + uv.getY(k) * h);
  }
  uv.needsUpdate = true;
  return g;
}

/**
 * THE FINGERPOST ATLAS — five painted arms in one 2×3 grid, each with its
 * ride icon and name, so a whole signpost is one draw call.
 */
const FINGER_ORDER: IconName[] = ["parade", "coaster", "ferris", "train", "tent"];
const FINGER_LABEL: Record<IconName, string> = {
  parade: "PIECE PARADE",
  coaster: "TACTICS COASTER",
  ferris: "ENDGAME WHEEL",
  train: "PUZZLE TRAIN",
  tent: "GRAND MATCH",
};
const FINGER_TINT: Record<IconName, number> = {
  parade: PALETTE.plumDeep,
  coaster: PALETTE.tealDeep,
  ferris: PALETTE.plum,
  train: PALETTE.teal,
  tent: PALETTE.honeyDeep,
};

export function signpostAtlasTexture(): THREE.Texture {
  return paintTexture("landmark-fingers", 1024, 768, (x) => {
    const cw = 512, ch = 256;
    FINGER_ORDER.forEach((icon, i) => {
      const cx0 = (i % 2) * cw;
      const cy0 = Math.floor(i / 2) * ch;
      x.save();
      x.translate(cx0, cy0);
      paintBoard(x, cw, ch, PALETTE.cream, 61 + i * 17);
      // No painted arrow here — the point is carved out of the board itself, so
      // that it still aims at the ride when you walk round the post.
      paintFrame(x, cw, ch, mix(FINGER_TINT[icon], PALETTE.cream, 0.3), 12);
      paintIcon(x, icon, 76, ch * 0.5, 74, FINGER_TINT[icon]);
      paintedText(x, FINGER_LABEL[icon], 310, ch * 0.5, 46, FINGER_TINT[icon], mix(PALETTE.cream, PALETTE.walnut, 0.5), 33 + i, 1);
      x.restore();
    });
    // the unused sixth cell gets the park's own mark
    x.save();
    x.translate(512, 512);
    paintBoard(x, 512, 256, PALETTE.walnut, 99);
    paintedText(x, "WONDERLAND", 256, 128, 46, PALETTE.honey, PALETTE.cocoa, 77, 1);
    x.restore();
  });
}

/**
 * TWO-SIDED PAINTED BOARDS — the rule, once, so nobody has to re-derive it.
 *
 * A quad's painted text reads correctly from the side its NORMAL points at,
 * because a viewer there has screen-right along the quad's +X, which is the
 * direction its u runs. So a board painted on both faces is simply two quads
 * whose normals point opposite ways: `rotateY(yaw - PI/2)` and
 * `rotateY(yaw + PI/2)`, the SAME texture cell on each, nothing mirrored.
 *
 * Two things that look like fixes and are not:
 *   - Mirroring u on the back board. Reversing u reverses the order of the
 *     letters AND mirrors every glyph. You get "ECARAP ECEIP".
 *   - Keeping one rotation and flipping the winding. Winding decides
 *     visibility, not reading direction; the back then reads mirrored too.
 *
 * The one thing the back board genuinely cannot inherit is a DIRECTIONAL mark:
 * on the far face, +X points back down the arm, so a painted arrow would aim
 * at the post. That is why the fingerpost's chevron is CARVED (a wooden wedge
 * at the outer end) instead of painted — geometry points the same way from
 * every side.
 */

function mapFingerCell(g: THREE.BufferGeometry, icon: IconName): THREE.BufferGeometry {
  const i = FINGER_ORDER.indexOf(icon);
  const col = i % 2, row = Math.floor(i / 2);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let k = 0; k < uv.count; k++) {
    // rows are laid top-down on the canvas; UV v is bottom-up
    uv.setXY(k, (col + uv.getX(k)) * 0.5, (2 - row + uv.getY(k)) / 3);
  }
  uv.needsUpdate = true;
  return g;
}

/** The station clock — Roman-ish numerals, a warm cream face, painted hands. */
export function clockFaceTexture(): THREE.Texture {
  return paintTexture("landmark-clock", 512, 512, (x) => {
    const g = x.createRadialGradient(256, 240, 20, 256, 256, 256);
    g.addColorStop(0, css(PALETTE.creamPale));
    g.addColorStop(1, css(mix(PALETTE.cream, PALETTE.walnut, 0.22)));
    x.fillStyle = g;
    x.beginPath(); x.arc(256, 256, 250, 0, TAU); x.fill();
    x.strokeStyle = css(PALETTE.walnut);
    x.lineWidth = 14;
    x.beginPath(); x.arc(256, 256, 240, 0, TAU); x.stroke();
    x.strokeStyle = css(PALETTE.plumDeep);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU - Math.PI / 2;
      x.lineWidth = i % 3 === 0 ? 14 : 7;
      const r0 = i % 3 === 0 ? 178 : 196;
      x.beginPath();
      x.moveTo(256 + Math.cos(a) * r0, 256 + Math.sin(a) * r0);
      x.lineTo(256 + Math.cos(a) * 224, 256 + Math.sin(a) * 224);
      x.stroke();
    }
    paintedText(x, "CHESSPAA", 256, 150, 34, mix(PALETTE.walnut, PALETTE.plum, 0.4), PALETTE.cream, 12, 3);
    paintedText(x, "ALWAYS TIME", 256, 372, 26, mix(PALETTE.walnut, PALETTE.teal, 0.35), PALETTE.cream, 15, 2);
  });
}

/* ================================================================== */
/* 1 · PIECE PARADE                                                    */
/* ================================================================== */

export const PARADE_CENTER: [number, number] = [ATTRACTIONS.parade.x, ATTRACTIONS.parade.z];

const PARADE = {
  loopRadius: 9.6,
  poleRadius: 12.4,
  plinthRadius: 11.0,
  canopyInner: 4.6,
  /**
   * Kept deliberately taller than it is wide-looking: at 15m out and 5.6m up
   * the canopy read as a car-park roof. Raising the poles and crowning the
   * inner ring turns the same surface back into a fairground tent.
   */
  canopyOuter: 13.8,
  poleHeight: 7.3,
  crown: 4.3,
  bays: 12,
};

/**
 * Where the six piece-characters stand.
 *
 * `pos` is the top face of the plinth — drop a character in with its feet at
 * y = pos[1]. `look` is a Y rotation: set `group.rotation.y = look` and the
 * character's local +Z faces the ride, which is what a rider sees as the
 * little carousel-coaster swings past.
 *
 * Angles deliberately dodge 32° and 206°, where the main coaster spine
 * threads straight through the parade ring.
 */
export const PARADE_PLINTHS: Array<{ pos: [number, number, number]; look: number }> = (() => {
  const [cx, cz] = PARADE_CENTER;
  const out: Array<{ pos: [number, number, number]; look: number }> = [];
  const deck = groundMax(ringSpots(cx, cz, PARADE.plinthRadius, 18)) + 0.02;
  for (let i = 0; i < 6; i++) {
    const a = ((i * 60 + 8) * Math.PI) / 180;
    const x = cx + Math.cos(a) * PARADE.plinthRadius;
    const z = cz + Math.sin(a) * PARADE.plinthRadius;
    // face the loop centre so riders passing below get the character head-on
    const look = Math.atan2(cx - x, cz - z);
    out.push({ pos: [x, deck + 1.55, z], look });
  }
  return out;
})();

/**
 * THE PIECE PARADE.
 *
 * A striped teal-and-plum canopy on twelve carved poles, a slow
 * carousel-coaster loop underneath, and six lantern-lit plinths where the
 * piece characters stand. The main coaster spine passes right through the
 * open middle at about 2.7m, UNDER the canopy — so a child riding the spine
 * glides through the parade and past every character's face. Poles that would
 * have stood on the track are simply left out of the ring.
 */
export function buildPieceParade(seed = 1201): LandmarkBuild {
  const bag = makeBag();
  const glows: GlowSpot[] = [];
  const r = rng(seed);
  const [cx, cz] = PARADE_CENTER;

  const deck = groundMax(ringSpots(cx, cz, PARADE.poleRadius, 24));
  const canopyY = deck + PARADE.poleHeight;

  /* ---- twelve carved poles, minus any the coaster would hit ---- */
  const poleTops: THREE.Vector3[] = [];
  for (let i = 0; i < PARADE.bays; i++) {
    const a = (i / PARADE.bays) * TAU;
    const x = cx + Math.cos(a) * PARADE.poleRadius;
    const z = cz + Math.sin(a) * PARADE.poleRadius;
    if (spineDistanceXZ(x, z) < 3.4) continue; // the track owns this bay
    const gy = terrainHeight(x, z);
    const h = canopyY - gy;
    put(bag, "timberPale",
      twistPole(h - 0.5, 0.17, 0.032, 6, 2.3, 12, 16, 0).translate(x, gy, z));
    // base moulding and capital, so the pole meets ground and canvas properly
    put(bag, "timberPale",
      lathe([[0, 0], [0.34, 0], [0.36, 0.12], [0.26, 0.2], [0.2, 0.34], [0, 0.34]], 10).translate(x, gy, z),
      lathe([[0, 0], [0.2, 0], [0.28, 0.1], [0.34, 0.24], [0.3, 0.36], [0, 0.4]], 10).translate(x, gy + h - 0.5, z));
    put(bag, "honey", cyl(0.2, 0.2, 0.09, 10, x, gy + h * 0.52, z));
    poleTops.push(new THREE.Vector3(x, canopyY, z));
  }

  /* ---- the canopy: striped canvas, sagging between the poles ---- */
  const canopy = canopySurface({
    rOuter: PARADE.canopyOuter, yOuter: 0,
    rInner: PARADE.canopyInner, yInner: PARADE.crown,
    bays: PARADE.bays, seg: 144, steps: 8,
    sag: 0.52, poleLift: 0.42, uRepeat: 1,
  });
  canopy.translate(cx, canopyY, cz);
  put(bag, "canvasParade", canopy);

  put(bag, "canvasParade", scallopBand({
    radius: PARADE.canopyOuter, radiusBottom: PARADE.canopyOuter + 0.12,
    top: canopyY, depth: 0.95, scallops: 36, seg: 168, uRepeat: 6,
  }).translate(cx, 0, cz));

  // the ring beam the canvas is nailed to, and an inner collar round the eye
  const beam = new THREE.TorusGeometry(PARADE.canopyOuter - 0.12, 0.12, 5, 96);
  beam.rotateX(Math.PI / 2);
  beam.translate(cx, canopyY - 0.02, cz);
  const collar = new THREE.TorusGeometry(PARADE.canopyInner, 0.16, 5, 48);
  collar.rotateX(Math.PI / 2);
  collar.translate(cx, canopyY + PARADE.crown, cz);
  put(bag, "timberPale", beam, collar);

  /* ---- the slow carousel-coaster loop ---- */
  const railGauge = 0.92;
  const loopSeg = 96;
  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= loopSeg; i++) {
      const a = (i / loopSeg) * TAU;
      const rr = PARADE.loopRadius + (railGauge / 2) * side;
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      pts.push(new THREE.Vector3(x, terrainHeight(x, z) + 0.62, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5);
    put(bag, "iron", new THREE.TubeGeometry(curve, 120, 0.055, 5, true));
  }
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * TAU;
    const x = cx + Math.cos(a) * PARADE.loopRadius;
    const z = cz + Math.sin(a) * PARADE.loopRadius;
    const gy = terrainHeight(x, z);
    put(bag, "timber", box(1.5, 0.1, 0.24, x, gy + 0.53, z, -a));
    if (i % 4 === 0) {
      put(bag, "timber", cyl(0.09, 0.11, 0.55, 6, x, gy + 0.27, z));
    }
  }

  /* ---- six plinths, each under its own pool of lantern-light ---- */
  PARADE_PLINTHS.forEach((p, i) => {
    const [x, py, z] = p.pos;
    const gy = terrainHeight(x, z);
    const h = py - gy;
    // turned drum with a moulded cap
    put(bag, "timberPale", lathe([
      [0, 0], [1.02, 0], [1.06, 0.14], [0.88, 0.28], [0.78, 0.36],
      [0.74, h - 0.4], [0.86, h - 0.3], [1.00, h - 0.14], [0.98, h], [0, h],
    ], 20).translate(x, gy, z));
    put(bag, "plum", new THREE.TorusGeometry(0.82, 0.07, 5, 24).rotateX(Math.PI / 2).translate(x, gy + h * 0.5, z));

    // a slim lantern post behind, arm reaching over the plinth
    const back = 1.5;
    const bx = x - Math.sin(p.look) * back;
    const bz = z - Math.cos(p.look) * back;
    const bgy = terrainHeight(bx, bz);
    const lampY = bgy + 3.9;
    put(bag, "iron",
      cyl(0.055, 0.075, lampY - bgy, 6, bx, (bgy + lampY) / 2, bz),
      strut(new THREE.Vector3(bx, lampY, bz),
        new THREE.Vector3(x, lampY + 0.1, z), 0.045, 0.035, 5));
    put(bag, "brass", lathe([
      [0, 0], [0.16, 0.03], [0.30, 0.14], [0.33, 0.52], [0.21, 0.63], [0.30, 0.69], [0.09, 0.84], [0, 0.84],
    ], 8).translate(x, lampY - 0.78, z));
    glows.push(glow([x, lampY - 0.28, z], PALETTE.lanternCore, 1.5, 12, 12, i * 1.13));
  });

  /* ---- fairy lights strung round the canopy eave ---- */
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * TAU + 0.05;
    glows.push(glow([
      cx + Math.cos(a) * (PARADE.canopyOuter - 0.3),
      canopyY - 0.62 - r() * 0.18,
      cz + Math.sin(a) * (PARADE.canopyOuter - 0.3),
    ], PALETTE.honey, 0.55, 0, 0, i * 0.71));
  }

  // a carved entrance arch on the plaza side, so the pocket has a threshold
  const entryA = Math.atan2(0 - cz, 0 - cx);
  for (const s of [-1, 1]) {
    const ax = cx + Math.cos(entryA + (s * 0.24)) * (PARADE.poleRadius + 2.6);
    const az = cz + Math.sin(entryA + (s * 0.24)) * (PARADE.poleRadius + 2.6);
    const ay = terrainHeight(ax, az);
    put(bag, "timber", twistPole(3.7, 0.19, 0.04, 5, 3.0, 12, 14, 0).translate(ax, ay, az));
    put(bag, "honey", lathe([[0, 0], [0.24, 0.05], [0.16, 0.2], [0.1, 0.34], [0, 0.44]], 8).translate(ax, ay + 3.7, az));
  }

  return { parts: bag, glows };
}

/* ================================================================== */
/* 2 · TACTICS COASTER STATION                                         */
/* ================================================================== */

/**
 * The station rides the crest of the far hill, eighteen metres of trestle
 * above the slope, because that is where the coaster spine actually is. Its
 * silhouette against the dusk is the first thing you see from the plaza.
 */
export interface StationRig {
  /** Curve parameter the platform is centred on. */
  t: number;
  /** Track centreline at that point. */
  track: [number, number, number];
  /** Deck top height (absolute). */
  deckY: number;
  /** Yaw that aligns local +Z with the track's direction of travel. */
  yaw: number;
}

export function stationRig(): StationRig {
  const anchor = ATTRACTIONS.coaster;
  const t = nearestSpineT(anchor.x, anchor.z);
  const p = SPINE_CURVE.getPointAt(t);
  const tan = SPINE_CURVE.getTangentAt(t);
  const yaw = Math.atan2(tan.x, tan.z);
  return { t, track: [p.x, p.y, p.z], deckY: p.y + 0.30, yaw };
}

export function buildTacticsStation(seed = 2202): LandmarkBuild {
  const bag = makeBag();
  const glows: GlowSpot[] = [];
  const r = rng(seed);
  const rig = stationRig();

  const [tx, , tz] = rig.track;
  const fwd = new THREE.Vector3(Math.sin(rig.yaw), 0, Math.cos(rig.yaw));
  // side vector: pick whichever side the hilltop is on, so the stairs are short
  let side = new THREE.Vector3(fwd.z, 0, -fwd.x);
  const toSummit = new THREE.Vector3(ATTRACTIONS.coaster.x - tx, 0, ATTRACTIONS.coaster.z - tz);
  if (side.dot(toSummit) < 0) side = side.multiplyScalar(-1);

  const DECK_L = 19, DECK_W = 7.2;
  const deckY = rig.deckY;
  const deckC = new THREE.Vector3(tx, deckY, tz).addScaledVector(side, DECK_W / 2 + 0.95);

  const at = (along: number, across: number, y = 0) =>
    new THREE.Vector3(
      deckC.x + fwd.x * along + side.x * across,
      deckY + y,
      deckC.z + fwd.z * along + side.z * across
    );

  /* ---- the deck: planks, edge beams, and the joists under them ---- */
  const deck = box(DECK_W, 0.28, DECK_L, deckC.x, deckY - 0.14, deckC.z, rig.yaw);
  put(bag, "timberPale", scaleUV(deck, 3, 8));
  for (const across of [DECK_W / 2, -DECK_W / 2]) {
    const e = at(0, across, -0.42);
    put(bag, "timber", box(0.34, 0.5, DECK_L + 0.4, 0, 0, 0).rotateY(rig.yaw).translate(e.x, e.y, e.z));
  }

  /* ---- the trestle: posts down to the hillside, cross-braced ---- */
  const rows = 7;
  for (let i = 0; i < rows; i++) {
    const along = -DECK_L / 2 + 0.9 + (i / (rows - 1)) * (DECK_L - 1.8);
    const legs: THREE.Vector3[] = [];
    for (const across of [-DECK_W / 2 + 0.4, DECK_W / 2 - 0.4]) {
      const top = at(along, across, -0.4);
      const gy = terrainHeight(top.x, top.z);
      const foot = new THREE.Vector3(top.x, gy - 0.3, top.z);
      put(bag, "timber", strut(foot, top, 0.24, 0.17, 6));
      legs.push(foot);
      // stone-ish footing pad so the post does not stab the snow
      put(bag, "timberPale", cyl(0.42, 0.5, 0.34, 8, foot.x, gy + 0.06, foot.z));
    }
    // horizontal ties and an X-brace every couple of metres of drop
    const h = deckY - Math.max(legs[0].y, legs[1].y);
    const ties = Math.max(1, Math.min(6, Math.floor(h / 3.2)));
    for (let b = 1; b <= ties; b++) {
      const y = THREE.MathUtils.lerp(legs[0].y, deckY - 0.6, b / (ties + 1));
      const a0 = new THREE.Vector3(legs[0].x, y, legs[0].z);
      const a1 = new THREE.Vector3(legs[1].x, y, legs[1].z);
      put(bag, "timber", strut(a0, a1, 0.1, 0.1, 5));
      if (b < ties) {
        const y2 = THREE.MathUtils.lerp(legs[0].y, deckY - 0.6, (b + 1) / (ties + 1));
        put(bag, "timber",
          strut(a0, new THREE.Vector3(legs[1].x, y2, legs[1].z), 0.07, 0.07, 4),
          strut(a1, new THREE.Vector3(legs[0].x, y2, legs[0].z), 0.07, 0.07, 4));
      }
    }
    // longitudinal tie to the next row
    if (i < rows - 1) {
      const nextAlong = -DECK_L / 2 + 0.9 + ((i + 1) / (rows - 1)) * (DECK_L - 1.8);
      for (const across of [-DECK_W / 2 + 0.4, DECK_W / 2 - 0.4]) {
        const p0 = at(along, across, -0.4);
        const p1 = at(nextAlong, across, -0.4);
        const y = Math.max(terrainHeight(p0.x, p0.z), terrainHeight(p1.x, p1.z)) + (deckY - Math.max(terrainHeight(p0.x, p0.z), terrainHeight(p1.x, p1.z))) * 0.45;
        put(bag, "timber", strut(
          new THREE.Vector3(p0.x, y, p0.z), new THREE.Vector3(p1.x, y, p1.z), 0.09, 0.09, 4));
      }
    }
  }

  /* ---- the shed ---- */
  // The shed hugs the OUTER edge of the deck (SHED_ACROSS), leaving the whole
  // inner strip beside the track free for the queue lanes and the loading edge.
  const SHED_ACROSS = 1.25;
  const shedC = at(4.6, SHED_ACROSS);
  const SW = 4.4, SD = 7.4, SH = 3.5;
  // clad walls (four boxes so the doorway side can be split around the opening)
  put(bag, "timberPale",
    scaleUV(box(0.22, SH, SD, 0, 0, 0).rotateY(rig.yaw).translate(shedC.x + side.x * SW / 2, deckY + SH / 2, shedC.z + side.z * SW / 2), 4, 2),
    scaleUV(box(SW, SH, 0.22, 0, 0, 0).rotateY(rig.yaw).translate(shedC.x + fwd.x * SD / 2, deckY + SH / 2, shedC.z + fwd.z * SD / 2), 3, 2),
    scaleUV(box(SW, SH, 0.22, 0, 0, 0).rotateY(rig.yaw).translate(shedC.x - fwd.x * SD / 2, deckY + SH / 2, shedC.z - fwd.z * SD / 2), 3, 2));
  // platform-side wall, split around a wide doorway
  for (const s of [-1, 1]) {
    const seg = box(0.22, SH, SD * 0.32, 0, 0, 0).rotateY(rig.yaw);
    seg.translate(
      shedC.x - side.x * SW / 2 + fwd.x * s * SD * 0.34,
      deckY + SH / 2,
      shedC.z - side.z * SW / 2 + fwd.z * s * SD * 0.34);
    put(bag, "timberPale", scaleUV(seg, 2, 2));
  }
  put(bag, "timber",
    box(0.3, 0.34, SD * 0.38, 0, 0, 0).rotateY(rig.yaw)
      .translate(shedC.x - side.x * SW / 2, deckY + SH - 0.2, shedC.z - side.z * SW / 2));

  // gable roof + snow
  put(bag, "plum", ...gableRoof(SW + 0.5, SD, 1.5, 0.2, shedC.x, deckY + SH, shedC.z, rig.yaw, 0.42));
  put(bag, "snow", ...gableRoof(SW + 0.3, SD - 0.3, 1.42, 0.13, shedC.x, deckY + SH + 0.2, shedC.z, rig.yaw, 0.34));
  // gable end panels, painted cream
  for (const s of [-1, 1]) {
    const tri = new THREE.BufferGeometry();
    const hw = (SW + 0.5) / 2;
    tri.setAttribute("position", new THREE.Float32BufferAttribute(
      [-hw, 0, 0, hw, 0, 0, 0, 1.5, 0], 3));
    tri.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    tri.setIndex([0, 1, 2]);
    tri.computeVertexNormals();
    tri.rotateY(rig.yaw + (s > 0 ? 0 : Math.PI));
    tri.translate(shedC.x + fwd.x * s * SD / 2, deckY + SH, shedC.z + fwd.z * s * SD / 2);
    put(bag, "cream", tri);
  }

  // warm windows and the doorway light
  for (const s of [-1, 1]) {
    const wp = at(4.6 + s * 2.2, SHED_ACROSS - SW / 2 - 0.16, 1.9);
    put(bag, "honey", box(0.9, 0.9, 0.06, 0, 0, 0).rotateY(rig.yaw + Math.PI / 2).translate(wp.x, wp.y, wp.z));
    glows.push(glow([wp.x - side.x * 0.2, wp.y, wp.z - side.z * 0.2], PALETTE.lanternCore, 1.5, 6, 9, s * 0.8));
  }
  const doorP = at(4.6, SHED_ACROSS - SW / 2 - 0.1, 1.15);
  glows.push(glow([doorP.x - side.x * 0.5, doorP.y, doorP.z - side.z * 0.5], PALETTE.lanternCore, 2.6, 22, 15, 0.3));

  /* ---- queue rail: three switchbacks along the platform ---- */
  for (let lane = 0; lane < 3; lane++) {
    const across = -DECK_W / 2 + 0.5 + lane * 0.85;
    const a0 = at(-DECK_L / 2 + 1.2, across, 0);
    const a1 = at(-1.2, across, 0);
    put(bag, "iron",
      strut(new THREE.Vector3(a0.x, deckY + 0.92, a0.z), new THREE.Vector3(a1.x, deckY + 0.92, a1.z), 0.05, 0.05, 5),
      strut(new THREE.Vector3(a0.x, deckY + 0.52, a0.z), new THREE.Vector3(a1.x, deckY + 0.52, a1.z), 0.035, 0.035, 4));
    const posts = 6;
    for (let i = 0; i <= posts; i++) {
      const p = at(THREE.MathUtils.lerp(-DECK_L / 2 + 1.2, -1.2, i / posts), across, 0);
      put(bag, "iron", cyl(0.055, 0.065, 0.98, 6, p.x, deckY + 0.49, p.z));
      if (i === posts) put(bag, "brass", lathe([[0, 0], [0.09, 0.03], [0.06, 0.12], [0, 0.16]], 7).translate(p.x, deckY + 0.98, p.z));
    }
  }

  /* ---- the big painted sign, arched over the platform ---- */
  const signC = at(-3.4, 0.4, 3.4);
  const SIGN_W = 7.0, SIGN_H = 2.0;
  put(bag, "signPaint", mapSignRow(
    quadXY(SIGN_W, SIGN_H, 0, 0, 0).rotateY(rig.yaw - Math.PI / 2)
      .translate(signC.x - side.x * 0.09, signC.y, signC.z - side.z * 0.09), "coaster"));
  put(bag, "signPaint", mapSignRow(
    quadXY(SIGN_W, SIGN_H, 0, 0, 0).rotateY(rig.yaw + Math.PI / 2)
      .translate(signC.x + side.x * 0.09, signC.y, signC.z + side.z * 0.09), "coaster"));
  put(bag, "timber",
    box(SIGN_W + 0.7, 0.3, 0.3, 0, 0, 0).rotateY(rig.yaw + Math.PI / 2).translate(signC.x, signC.y + SIGN_H / 2 + 0.12, signC.z),
    box(SIGN_W + 0.7, 0.24, 0.24, 0, 0, 0).rotateY(rig.yaw + Math.PI / 2).translate(signC.x, signC.y - SIGN_H / 2 - 0.1, signC.z));
  for (const s of [-1, 1]) {
    const p = at(-3.4 + s * (SIGN_W / 2 + 0.2), 0.4, 0);
    put(bag, "timber", twistPole(4.7, 0.14, 0.028, 5, 2.6, 10, 12, 0).translate(p.x, deckY, p.z));
    put(bag, "honey", lathe([[0, 0], [0.2, 0.04], [0.13, 0.16], [0, 0.3]], 8).translate(p.x, deckY + 4.7, p.z));
    glows.push(glow([p.x, deckY + 4.8, p.z], PALETTE.honey, 0.9, 5, 10, s));
  }

  /* ---- switchback stair down to the summit ---- */
  {
    let cur = at(DECK_L / 2 - 1.4, DECK_W / 2 - 0.6, 0);
    let dir = side.clone();
    const flights = 4;
    let y = deckY;
    for (let f = 0; f < flights; f++) {
      const ground = terrainHeight(cur.x + dir.x * 4.2, cur.z + dir.z * 4.2);
      const drop = Math.min((y - ground) / (flights - f), 4.4);
      if (drop < 0.35) break;
      const run = 4.2;
      const end = new THREE.Vector3(cur.x + dir.x * run, y - drop, cur.z + dir.z * run);
      // stringers
      const off = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(0.72);
      for (const s of [-1, 1]) {
        put(bag, "timber", strut(
          cur.clone().addScaledVector(off, s),
          end.clone().addScaledVector(off, s), 0.11, 0.11, 5));
        put(bag, "iron", strut(
          cur.clone().addScaledVector(off, s).setY(cur.y + 0.95),
          end.clone().addScaledVector(off, s).setY(end.y + 0.95), 0.045, 0.045, 4));
      }
      const steps = Math.max(3, Math.round(drop / 0.32));
      for (let i = 0; i <= steps; i++) {
        const p = new THREE.Vector3().lerpVectors(cur, end, i / steps);
        put(bag, "timberPale", box(1.5, 0.09, 0.34, p.x, p.y, p.z, Math.atan2(dir.x, dir.z)));
        if (i % 3 === 0) {
          for (const s of [-1, 1]) {
            const q = p.clone().addScaledVector(off, s);
            put(bag, "iron", cyl(0.04, 0.045, 0.95, 5, q.x, q.y + 0.47, q.z));
          }
        }
      }
      // landing
      put(bag, "timberPale", box(1.7, 0.14, 1.7, end.x, end.y - 0.04, end.z, Math.atan2(dir.x, dir.z)));
      const lg = terrainHeight(end.x, end.z);
      if (end.y - lg > 0.6) {
        put(bag, "timber", strut(new THREE.Vector3(end.x, lg - 0.2, end.z), new THREE.Vector3(end.x, end.y, end.z), 0.16, 0.12, 6));
      }
      y = end.y;
      cur = end;
      dir = new THREE.Vector3(-dir.z, 0, dir.x); // switch back
    }
  }

  /* ---- the lift-hill chain housing, running down the climb ---- */
  {
    const t0 = rig.t - 0.088;
    const steps = 74;
    for (let i = 0; i <= steps; i++) {
      const t = t0 + (rig.t - 0.004 - t0) * (i / steps);
      const p = SPINE_CURVE.getPointAt(((t % 1) + 1) % 1);
      const tan = SPINE_CURVE.getTangentAt(((t % 1) + 1) % 1);
      const ang = Math.atan2(tan.x, tan.z);
      const pitch = Math.asin(THREE.MathUtils.clamp(tan.y, -1, 1));
      // the timber trough that carries the chain, tilted with the climb
      const trough = new THREE.BoxGeometry(0.62, 0.2, 0.9);
      trough.rotateX(-pitch);
      trough.rotateY(ang);
      trough.translate(p.x, p.y + 0.19, p.z);
      put(bag, "timber", trough);
      if (i % 3 === 0) {
        // the chain dogs — the clank a child hears on the way up
        const dog = new THREE.BoxGeometry(0.2, 0.13, 0.16);
        dog.rotateX(-pitch);
        dog.rotateY(ang);
        dog.translate(p.x, p.y + 0.33, p.z);
        put(bag, "iron", dog);
      }
    }
    // the motor house at the foot of the lift
    const mp = SPINE_CURVE.getPointAt(((t0 % 1) + 1) % 1);
    const mtan = SPINE_CURVE.getTangentAt(((t0 % 1) + 1) % 1);
    const mAng = Math.atan2(mtan.x, mtan.z);
    const mSide = new THREE.Vector3(mtan.z, 0, -mtan.x).normalize();
    const mc = new THREE.Vector3(mp.x, mp.y, mp.z).addScaledVector(mSide, 2.2);
    put(bag, "timberPale", scaleUV(box(2.6, 2.1, 3.2, mc.x, mc.y + 1.05, mc.z, mAng), 3, 2));
    put(bag, "plum", ...gableRoof(2.9, 3.4, 0.85, 0.16, mc.x, mc.y + 2.1, mc.z, mAng, 0.28));
    put(bag, "snow", ...gableRoof(2.7, 3.2, 0.8, 0.1, mc.x, mc.y + 2.28, mc.z, mAng, 0.22));
    for (let i = 0; i < 4; i++) {
      const gy = terrainHeight(mc.x, mc.z);
      put(bag, "timber", strut(
        new THREE.Vector3(mc.x + (i % 2 ? 1 : -1) * 1.1, gy - 0.2, mc.z + (i < 2 ? 1.4 : -1.4)),
        new THREE.Vector3(mc.x + (i % 2 ? 1 : -1) * 1.1, mc.y, mc.z + (i < 2 ? 1.4 : -1.4)), 0.16, 0.13, 5));
    }
    glows.push(glow([mc.x, mc.y + 1.4, mc.z], PALETTE.honey, 1.2, 8, 10, 2.1));
  }

  /* ---- lanterns strung the length of the platform ---- */
  for (let i = 0; i < 7; i++) {
    const p = at(-DECK_L / 2 + 1.6 + (i / 6) * (DECK_L - 3.2), -DECK_W / 2 + 0.35, 2.7 + r() * 0.12);
    glows.push(glow([p.x, p.y, p.z], PALETTE.honey, 0.8, 7, 11, i * 0.9));
  }

  return { parts: bag, glows };
}

/* ================================================================== */
/* 3 · THE ENDGAME FERRIS WHEEL                                        */
/* ================================================================== */

/**
 * The rig for the great wheel, solved rather than hand-placed.
 *
 * THE IDEA: the coaster spine passes within two metres of the Ferris
 * anchor, so instead of shoving the wheel aside we STRADDLE the track — the
 * wheel is centred on the track, its plane running along the direction of
 * travel, its two A-frames set either side. A rider on the spine passes
 * straight under the axle with the gondolas swinging overhead. That also
 * happens to put the wheel almost perfectly broadside to the plaza, which is
 * what a skyline icon needs.
 */
export interface FerrisRig {
  /** World position of the axle. */
  hub: [number, number, number];
  /** Y rotation of the whole rig — local +Z is the axle. */
  yaw: number;
  radius: number;
  /** Half-distance between the two A-frames AT THE FEET — the corridor the track runs in. */
  frameOffset: number;
  /** Half-distance between them at the axle. The legs splay outward as they descend. */
  frameApex: number;
  /** Half-spread of the legs, in the wheel plane. */
  legSpread: number;
  /** Local Y of each foot (relative to the hub), in leg order. */
  footY: [number, number, number, number];
  gondolaAngles: number[];
  /** Seconds for one full revolution. Slow — this wheel is for looking, not thrilling. */
  period: number;
}

const FERRIS = {
  radius: 16.5,
  hubHeight: 24,
  legSpread: 12,
  /**
   * The A-frames are narrow at the axle and SPLAY as they descend. That is the
   * whole trick: the feet can be pushed as far apart as the curving coaster
   * demands without the wheel turning into a drum, because the two rims stay
   * tied to the apex width. Widening both together put the rims fifteen metres
   * apart on a thirty-three-metre wheel.
   */
  frameApex: 3.3,
  frameOffset: 3.4,
  gondolas: 8,
  period: 62,
};

export function ferrisRig(): FerrisRig {
  const anchor = ATTRACTIONS.ferris;
  const t = nearestSpineT(anchor.x, anchor.z);
  const p = SPINE_CURVE.getPointAt(t);
  const tan = SPINE_CURVE.getTangentAt(t);
  const h = new THREE.Vector3(tan.x, 0, tan.z).normalize();

  // axle = the horizontal perpendicular to the track, flipped to face the plaza
  let axle = new THREE.Vector3(h.z, 0, -h.x);
  const toPlaza = new THREE.Vector3(ATTRACTIONS.plaza.x - p.x, 0, ATTRACTIONS.plaza.z - p.z);
  if (axle.dot(toPlaza) < 0) axle.multiplyScalar(-1);
  axle = axle.normalize();
  const yaw = Math.atan2(axle.x, axle.z);

  // Widen the A-frame corridor until no foot sits on the track. The track
  // curves through here, so a straight-line estimate is not good enough.
  const localToWorld = (lx: number, lz: number): [number, number] => [
    p.x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
    p.z - lx * Math.sin(yaw) + lz * Math.cos(yaw),
  ];
  let frameOffset = FERRIS.frameOffset;
  for (let guard = 0; guard < 16; guard++) {
    let worst = Infinity;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const [fx, fz] = localToWorld(sx * FERRIS.legSpread, sz * frameOffset);
        worst = Math.min(worst, spineDistanceXZ(fx, fz));
      }
    }
    if (worst >= 2.6) break;
    frameOffset += 0.45;
  }

  const feet: Array<[number, number]> = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) feet.push(localToWorld(sx * FERRIS.legSpread, sz * frameOffset));
  const padY = groundMax([...feet, [p.x, p.z]]);
  const hubY = padY + FERRIS.hubHeight;

  const footY = feet.map(([fx, fz]) => terrainHeight(fx, fz) - hubY - 0.25) as [number, number, number, number];

  const gondolaAngles: number[] = [];
  for (let i = 0; i < FERRIS.gondolas; i++) gondolaAngles.push((i / FERRIS.gondolas) * TAU);

  return {
    hub: [p.x, hubY, p.z],
    yaw,
    radius: FERRIS.radius,
    frameOffset,
    frameApex: FERRIS.frameApex,
    legSpread: FERRIS.legSpread,
    footY,
    gondolaAngles,
    period: FERRIS.period,
  };
}

export interface FerrisBuild {
  /** Everything that stands still: legs, ties, pads, the operator's hut. */
  base: LandmarkBuild;
  /**
   * The wheel itself, in HUB-LOCAL space: wheel plane = XY, axle = +Z.
   * Spin it by setting `rotation.z` on its group.
   */
  rim: GeoBag;
  /**
   * One gondola, in PIN-LOCAL space: the hanging pin is at the origin and the
   * tub hangs below. Colour variants are separate merged geometries so a
   * gondola is exactly one draw call.
   */
  gondolas: Array<{ angle: number; mat: MatKey; geo: THREE.BufferGeometry }>;
  /** Local positions of the rim lights that turn with the wheel. */
  rimLights: Float32Array;
  rig: FerrisRig;
}

/**
 * THE GREAT SLOW WHEEL.
 *
 * Two rims, a hub, radial spokes with crossed tension rods between them, and
 * eight upright gondolas in teal, plum, honey and cream. It turns once a minute
 * on its own clock — slow enough that a child watching from the plaza can see
 * a gondola climb, and slow enough that the counter-rotation reads as gravity
 * rather than as a trick.
 */
export function buildFerrisWheel(seed = 3303): FerrisBuild {
  const rig = ferrisRig();
  const base = makeBag();
  const rim = makeBag();
  const glows: GlowSpot[] = [];
  const r = rng(seed);          // drives the garland's twinkle offsets
  const R = rig.radius;
  const [hx, hy, hz] = rig.hub;

  /* ---- BASE: two A-frames straddling the coaster ---- */
  const apexZ = rig.frameApex;
  const feetLocal: Array<[number, number, number]> = [];
  let k = 0;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      feetLocal.push([sx * rig.legSpread, rig.footY[k], sz * rig.frameOffset]);
      k++;
    }
  }
  // note: feet are ordered (-x,-z) (-x,+z) (+x,-z) (+x,+z) by the loop above
  /** Half-width of the frame pair at a fraction t of the way down a leg. */
  const splayAt = (t: number) => THREE.MathUtils.lerp(rig.frameApex, rig.frameOffset, t);
  const toWorld = (lx: number, ly: number, lz: number) => new THREE.Vector3(
    hx + lx * Math.cos(rig.yaw) + lz * Math.sin(rig.yaw),
    hy + ly,
    hz - lx * Math.sin(rig.yaw) + lz * Math.cos(rig.yaw));

  for (const [lx, ly, lz] of feetLocal) {
    const foot = toWorld(lx, ly, lz);
    const apex = toWorld(0, -0.4, lz);
    put(base, "timberPale", ...latticeTower(foot, apex, 0.78, 0.34, 9, 0.16));
    put(base, "timberPale", cyl(1.35, 1.55, 0.7, 10, foot.x, foot.y + 0.3, foot.z));
    put(base, "iron", new THREE.TorusGeometry(0.62, 0.09, 5, 12).rotateX(Math.PI / 2).translate(foot.x, foot.y + 0.68, foot.z));
  }
  // ties between the two A-frames — top, and a pair of X-braces low down
  put(base, "timber",
    strut(toWorld(0, -0.4, -apexZ), toWorld(0, -0.4, apexZ), 0.34, 0.34, 8),
    strut(toWorld(-rig.legSpread * 0.55, -FERRIS.hubHeight * 0.5, -splayAt(0.55)), toWorld(-rig.legSpread * 0.55, -FERRIS.hubHeight * 0.5, splayAt(0.55)), 0.16, 0.16, 5),
    strut(toWorld(rig.legSpread * 0.55, -FERRIS.hubHeight * 0.5, -splayAt(0.55)), toWorld(rig.legSpread * 0.55, -FERRIS.hubHeight * 0.5, splayAt(0.55)), 0.16, 0.16, 5));
  for (const sz of [-1, 1]) {
    const a = toWorld(-rig.legSpread * 0.72, -FERRIS.hubHeight * 0.72, sz * splayAt(0.72));
    const b = toWorld(-rig.legSpread * 0.34, -FERRIS.hubHeight * 0.3, sz * splayAt(0.34));
    const c = toWorld(rig.legSpread * 0.72, -FERRIS.hubHeight * 0.72, sz * splayAt(0.72));
    const d = toWorld(rig.legSpread * 0.34, -FERRIS.hubHeight * 0.3, sz * splayAt(0.34));
    put(base, "timber", strut(a, b, 0.13), strut(c, d, 0.13));
  }

  /* ---- the loading platform and the operator's hut, clear of the track ---- */
  const platSide = new THREE.Vector3(Math.sin(rig.yaw), 0, Math.cos(rig.yaw)); // +Z local = axle
  const platC = new THREE.Vector3(hx, 0, hz).addScaledVector(platSide, rig.frameOffset + 4.4);
  const platGround = groundMax(ringSpots(platC.x, platC.z, 3.4, 10));
  const platY = platGround + 0.55;
  put(base, "timberPale", ...skirtedPad(platC.x, platC.z, 4.0, platY, 14, groundMin(ringSpots(platC.x, platC.z, 4.2, 10)) - 0.5));
  const toWheel = Math.atan2(hx - platC.x, hz - platC.z);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    // leave a gate facing the wheel so riders can walk on
    if (Math.abs(((a - toWheel + Math.PI * 3) % TAU) - Math.PI) < 0.6) continue;
    const px = platC.x + Math.sin(a) * 3.8;
    const pz = platC.z + Math.cos(a) * 3.8;
    put(base, "iron", cyl(0.05, 0.06, 1.0, 6, px, platY + 0.5, pz));
  }
  const hutC = platC.clone().addScaledVector(platSide, 2.0);
  put(base, "timberPale", scaleUV(box(2.0, 2.0, 2.0, hutC.x, platY + 1.0, hutC.z, rig.yaw), 3, 2));
  put(base, "teal", ...gableRoof(2.4, 2.4, 0.7, 0.15, hutC.x, platY + 2.0, hutC.z, rig.yaw, 0.24));
  put(base, "snow", ...gableRoof(2.2, 2.2, 0.66, 0.09, hutC.x, platY + 2.16, hutC.z, rig.yaw, 0.2));
  glows.push(glow([hutC.x, platY + 1.3, hutC.z], PALETTE.lanternCore, 1.6, 10, 12, 0.4));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    glows.push(glow([platC.x + Math.sin(a) * 3.8, platY + 1.15, platC.z + Math.cos(a) * 3.8], PALETTE.honey, 0.7, 5, 9, i));
  }

  /* ---- HUB ---- */
  const hubLen = rig.frameApex * 2 + 1.4;
  const hub = cyl(1.05, 1.05, hubLen, 14);
  hub.rotateX(Math.PI / 2);
  put(rim, "iron", hub);
  for (const sz of [-1, 1]) {
    const collar = cyl(1.35, 1.35, 0.42, 14);
    collar.rotateX(Math.PI / 2);
    collar.translate(0, 0, sz * (hubLen / 2 - 0.3));
    put(rim, "iron", collar);
    // a honey star cap on each face — the wheel's jewel
    const s = star(10, 2.5, 1.05, 0.22);
    s.translate(0, 0, sz * (hubLen / 2 + 0.02) - (sz > 0 ? 0 : 0.22));
    put(rim, "honey", s);
  }

  /* ---- RIMS, SPOKES AND TENSION RODS ---- */
  const RIM_Z = rig.frameApex + 0.35;
  for (const sz of [-1, 1]) {
    const outer = new THREE.TorusGeometry(R, 0.32, 6, 96);
    outer.translate(0, 0, sz * RIM_Z);
    const inner = new THREE.TorusGeometry(R * 0.34, 0.22, 5, 60);
    inner.translate(0, 0, sz * RIM_Z);
    put(rim, "iron", outer, inner);

    // 20 crossed cables turned the wheel into a cobweb at any distance.
    const SPOKES = 14;
    for (let i = 0; i < SPOKES; i++) {
      const a = (i / SPOKES) * TAU;
      const pIn = new THREE.Vector3(Math.cos(a) * R * 0.34, Math.sin(a) * R * 0.34, sz * RIM_Z);
      const pOut = new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, sz * RIM_Z);
      // crossed tension rods: each spoke leans to its neighbour, so the wheel
      // reads as strung wire rather than a solid disc
      const aNext = ((i + 1) / SPOKES) * TAU;
      const pCross = new THREE.Vector3(Math.cos(aNext) * R, Math.sin(aNext) * R, sz * RIM_Z);
      put(rim, "iron", strut(pIn, pOut, 0.125, 0.09, 5));
      if (i % 2 === 0) put(rim, "iron", strut(pIn, pCross, 0.05, 0.04, 4));
      if (i % 2 === 0) {
        const pHub = new THREE.Vector3(Math.cos(a) * 1.0, Math.sin(a) * 1.0, sz * (hubLen / 2 - 0.2));
        put(rim, "timberPale", strut(pHub, pIn, 0.2, 0.15, 6));
      }
    }
  }
  // lattice between the two rims
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * TAU;
    const aNext = ((i + 1) / 22) * TAU;
    const p0 = new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, -RIM_Z);
    const p1 = new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, RIM_Z);
    const p2 = new THREE.Vector3(Math.cos(aNext) * R, Math.sin(aNext) * R, RIM_Z);
    put(rim, "iron", strut(p0, p1, 0.095), strut(p0, p2, 0.07));
  }
  // pin brackets where the gondolas hang
  for (const a of rig.gondolaAngles) {
    const c = new THREE.Vector3(Math.cos(a) * (R + 0.5), Math.sin(a) * (R + 0.5), 0);
    for (const sz of [-1, 1]) {
      put(rim, "iron", strut(
        new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, sz * RIM_Z),
        c, 0.09, 0.09, 5));
    }
    // just wide enough to carry the gondola yoke — at RIM_Z*1.2 this was a
    // four-metre brass rod skewering the wheel
    const pin = cyl(0.16, 0.16, 1.05, 8);
    pin.rotateX(Math.PI / 2);
    pin.translate(c.x, c.y, 0);
    put(rim, "brass", pin);
  }

  /* ---- the string of rim lights that turn with the wheel ---- */
  const lights: number[] = [];
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU;
    // a hair of deterministic scatter, so the garland is strung by hand
    const rr = R + 0.42 + r() * 0.16;
    lights.push(Math.cos(a) * rr, Math.sin(a) * rr, (i % 2 ? 1 : -1) * RIM_Z);
  }
  // A sparkle line down the two plaza-side legs, in world space this time.
  // It has to follow the REAL leg: the A-frame splays from frameApex at the
  // axle out to frameOffset at the feet (which the track widened to 7.45m
  // here), and each foot sits on its own ground — the four differ by 8.8m on
  // this hillside. Stringing a straight line at the apex width off one foot's
  // height left the garland hanging 4m clear of the leg and 4.8m off vertically,
  // in mid-air over the coaster corridor.
  for (const li of [1, 3]) {          // feetLocal order: (-x,-z) (-x,+z) (+x,-z) (+x,+z)
    const [lx, ly, lz] = feetLocal[li];
    for (let i = 0; i < 10; i++) {
      const t = i / 9;
      const p = toWorld(lx * t, THREE.MathUtils.lerp(-0.4, ly, t), THREE.MathUtils.lerp(apexZ, lz, t));
      glows.push(glow([p.x, p.y, p.z], PALETTE.honey, 0.55, 0, 0, i * 0.6 + li));
    }
  }

  /* ---- GONDOLAS ---- */
  // One authored tub, cloned per car. Colour cycles teal / plum / honey /
  // cream around the wheel so the rhythm reads even from across the plaza.
  const GOND_COLORS: MatKey[] = ["teal", "plum", "honey", "cream"];
  const master = buildGondolaGeometry();
  const gondolas: FerrisBuild["gondolas"] = rig.gondolaAngles.map((angle, i) => ({
    angle,
    mat: GOND_COLORS[i % GOND_COLORS.length],
    geo: master.clone(),
  }));
  master.dispose();

  return { base: { parts: base, glows }, rim, gondolas, rimLights: new Float32Array(lights), rig };
}

/**
 * ONE GONDOLA, hanging from a pin at the origin.
 *
 * A round swing tub with a scalloped hood, a bench and a wrought yoke. Built
 * in one colour and merged to a single geometry: eight of these turn every frame
 * and each extra material would cost another eight draw calls.
 */
function buildGondolaGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const DROP = 2.9;
  const RAD = 1.45;

  // the yoke: two arms down from the pin to the tub's trunnions
  for (const sd of [-1, 1]) {
    parts.push(strut(
      new THREE.Vector3(sd * 0.2, 0, 0),
      new THREE.Vector3(sd * RAD, -DROP + 0.85, 0), 0.1, 0.08, 5));
  }
  const pin = cyl(0.15, 0.15, 0.9, 8);
  pin.rotateX(Math.PI / 2);
  parts.push(pin);
  parts.push(strut(new THREE.Vector3(-RAD, -DROP + 0.85, 0), new THREE.Vector3(RAD, -DROP + 0.85, 0), 0.08, 0.08, 5));

  // THE TUB. Open at the top with a visible rim and a real floor inside — a
  // closed pot reads as a bauble hanging off a bicycle wheel. The lip flares
  // so the silhouette has a shoulder at this distance.
  parts.push(lathe([
    [0.00, -DROP],
    [0.72, -DROP + 0.02],
    [1.14, -DROP + 0.22],
    [1.30, -DROP + 0.70],
    [1.36, -DROP + 1.28],
    [1.46, -DROP + 1.44],
    [1.34, -DROP + 1.52],
    [1.24, -DROP + 1.36],
    [1.20, -DROP + 0.34],
    [0.00, -DROP + 0.22],
  ], 20));

  // scalloped skirt round the lip — the one detail that says "fairground"
  parts.push(scallopBand({
    radius: 1.44, radiusBottom: 1.52, top: -DROP + 1.40,
    depth: 0.42, scallops: 12, seg: 48,
  }));

  // bench, back rail and the two hood posts
  parts.push(box(2.0, 0.14, 0.62, 0, -DROP + 0.78, 0));
  parts.push(box(1.9, 0.5, 0.12, 0, -DROP + 1.14, -0.6));
  parts.push(cyl(0.07, 0.07, 1.05, 6, 0, -DROP + 1.95, -0.66));
  parts.push(cyl(0.07, 0.07, 1.05, 6, 0, -DROP + 1.95, 0.66));

  // The hood: a part-dome over the back. No fringe here — a scallop band on a
  // squashed dome sticks out as spikes and reads as feathers, not canvas.
  const hood = new THREE.SphereGeometry(1.5, 16, 8, Math.PI * 0.1, Math.PI * 1.3, 0, Math.PI * 0.46);
  hood.scale(1, 0.66, 1);
  hood.translate(0, -DROP + 1.9, 0);
  parts.push(hood);

  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

/* ================================================================== */
/* 4 · THE PUZZLE TRAIN                                                */
/* ================================================================== */

/**
 * The Puzzle Train anchor sits in the middle of the frozen river — the height
 * field carves a channel right through (36,30). Rather than shove the
 * attraction onto dry land we lean into it: the little railway runs a loop out
 * over the ice on a low timber trestle, and the halt, clock and water tower
 * stand on the same viaduct. It gives the park's one cool passage a warm
 * wooden structure to cross it, and it is the only place a child gets to look
 * straight down at the ice.
 */
export const TRAIN_CENTER: [number, number] = [ATTRACTIONS.train.x, ATTRACTIONS.train.z];
const TRAIN = {
  rx: 13,
  rz: 9,
  /** Deck top. About a metre above the ice; the coaster crosses well above. */
  deckY: -0.35,
  gauge: 0.86,
  /** Seconds for one lap. A puffing amble, not a dash. */
  period: 46,
};

/** The rail centreline, arc-length parameterised so the train ambles evenly. */
export const TRAIN_CURVE: THREE.CatmullRomCurve3 = (() => {
  const [cx, cz] = TRAIN_CENTER;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU;
    // y is the RAIL HEAD, so a wheel authored with its tread at y=0 sits on it
    pts.push(new THREE.Vector3(cx + Math.cos(a) * TRAIN.rx, TRAIN.deckY + 0.18, cz + Math.sin(a) * TRAIN.rz));
  }
  return new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5);
})();

export const TRAIN_PERIOD = TRAIN.period;

/** Where the funnel is at lap parameter u — used to trail steam behind it. */
export function trainPoseAt(u: number): { pos: THREE.Vector3; yaw: number } {
  const t = ((u % 1) + 1) % 1;
  const pos = TRAIN_CURVE.getPointAt(t);
  const tan = TRAIN_CURVE.getTangentAt(t);
  return { pos, yaw: Math.atan2(tan.x, tan.z) };
}

export interface TrainBuild extends LandmarkBuild {
  /** Engine body, authored with +Z forward and its wheel treads at y=0. */
  engine: BakedParts;
  /**
   * One carriage per colour, +Z forward, each already ONE merged geometry —
   * wheels and trim included. Three carriages that each needed a second
   * material would cost three more draw calls every frame for detail a child
   * never looks at while the thing is moving.
   */
  carriages: Array<{ mat: MatKey; geo: THREE.BufferGeometry }>;
  /** Lap offsets (in curve parameter) of the engine and each carriage. */
  spacing: number[];
  /** Where the funnel sits relative to the engine origin. */
  funnel: [number, number, number];
  /** Clock hand geometry + the world transform of the clock. */
  clock: { face: [number, number, number]; yaw: number; hour: THREE.BufferGeometry; minute: THREE.BufferGeometry };
}

export function buildPuzzleTrain(seed = 4404): TrainBuild {
  const bag = makeBag();
  const glows: GlowSpot[] = [];
  const r = rng(seed);          // scatters the lamp posts along the loop
  const [cx, cz] = TRAIN_CENTER;
  const deckY = TRAIN.deckY;

  /* ---- the viaduct: deck, rails, sleepers, piers ---- */
  const SEG = 132;
  const deckPts: THREE.Vector3[] = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    deckPts.push(TRAIN_CURVE.getPointAt(t % 1));
  }
  // deck boards
  for (let i = 0; i < SEG; i++) {
    const p = deckPts[i];
    const q = deckPts[(i + 1) % SEG];
    const yaw = Math.atan2(q.x - p.x, q.z - p.z);
    put(bag, "timberPale", scaleUV(box(2.5, 0.16, TAU * 12 / SEG + 0.14, p.x, deckY - 0.08, p.z, yaw), 1, 0.5));
  }
  // rails
  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const p = TRAIN_CURVE.getPointAt(t % 1);
      const tan = TRAIN_CURVE.getTangentAt(t % 1);
      const n = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
      pts.push(p.clone().addScaledVector(n, (TRAIN.gauge / 2) * side).setY(deckY + 0.13));
    }
    put(bag, "iron", new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5), 150, 0.05, 5, true));
  }
  // sleepers
  for (let i = 0; i < 88; i++) {
    const t = i / 88;
    const p = TRAIN_CURVE.getPointAt(t);
    const tan = TRAIN_CURVE.getTangentAt(t);
    put(bag, "timber", box(1.4, 0.08, 0.24, p.x, deckY + 0.04, p.z, Math.atan2(tan.x, tan.z)));
  }
  // piers down to the channel floor
  for (let i = 0; i < 34; i++) {
    const t = i / 34;
    const p = TRAIN_CURVE.getPointAt(t);
    const tan = TRAIN_CURVE.getTangentAt(t);
    const n = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
    const legs: THREE.Vector3[] = [];
    for (const s of [-1, 1]) {
      const lx = p.x + n.x * 1.0 * s;
      const lz = p.z + n.z * 1.0 * s;
      const gy = terrainHeight(lx, lz);
      const foot = new THREE.Vector3(lx, gy - 0.25, lz);
      const top = new THREE.Vector3(lx, deckY - 0.14, lz);
      put(bag, "timber", strut(foot, top, 0.15, 0.12, 6));
      legs.push(foot);
    }
    put(bag, "timber", strut(
      new THREE.Vector3(legs[0].x, deckY - 0.3, legs[0].z),
      new THREE.Vector3(legs[1].x, deckY - 0.3, legs[1].z), 0.08, 0.08, 4));
    if (i % 2 === 0) {
      put(bag, "timber", strut(
        new THREE.Vector3(legs[0].x, legs[0].y + 0.2, legs[0].z),
        new THREE.Vector3(legs[1].x, deckY - 0.4, legs[1].z), 0.06, 0.06, 4));
    }
  }

  /* ---- the halt: platform, canopy, bench, nameboard ---- */
  const stationA = Math.PI * 0.75;
  const sx = cx + Math.cos(stationA) * (TRAIN.rx + 2.4);
  const sz = cz + Math.sin(stationA) * (TRAIN.rz + 2.4);
  const sYaw = Math.atan2(cx - sx, cz - sz); // face the rails
  const fwd = new THREE.Vector3(Math.cos(sYaw), 0, -Math.sin(sYaw)); // along the platform
  const inward = new THREE.Vector3(Math.sin(sYaw), 0, Math.cos(sYaw));

  const platC = new THREE.Vector3(sx, deckY, sz);
  // With rotateY(sYaw), a box's X runs ALONG the platform (fwd) and its Z runs
  // toward the rails (inward). Getting these the wrong way round builds an
  // eleven-metre pier jutting into the loop instead of a platform beside it.
  put(bag, "timberPale", scaleUV(box(11, 0.24, 4.4, platC.x, deckY + 0.06, platC.z, sYaw), 5, 2));
  put(bag, "timber", box(11.2, 0.3, 0.3, 0, 0, 0).rotateY(sYaw)
    .translate(platC.x + inward.x * 2.2, deckY - 0.12, platC.z + inward.z * 2.2));
  // platform piers
  for (let i = -2; i <= 2; i++) {
    for (const s of [-1, 1]) {
      const p = platC.clone().addScaledVector(fwd, i * 2.4).addScaledVector(inward, s * 1.8);
      const gy = terrainHeight(p.x, p.z);
      put(bag, "timber", strut(new THREE.Vector3(p.x, gy - 0.25, p.z), new THREE.Vector3(p.x, deckY - 0.05, p.z), 0.15, 0.12, 6));
    }
  }
  // canopy on six posts
  const CANOPY_Y = deckY + 3.05;
  for (let i = -1; i <= 1; i++) {
    for (const s of [-1, 1]) {
      const p = platC.clone().addScaledVector(fwd, i * 3.4).addScaledVector(inward, s * 1.5);
      put(bag, "timber", twistPole(CANOPY_Y - deckY - 0.15, 0.11, 0.024, 5, 2.4, 10, 12, 0).translate(p.x, deckY + 0.15, p.z));
    }
  }
  // A pitched roof, not a flat plate: from above, a slab reads as a table top
  // dropped on six sticks.
  put(bag, "teal", ...gableRoof(4.6, 9.2, 0.9, 0.14, platC.x, CANOPY_Y, platC.z, sYaw + Math.PI / 2, 0.3));
  put(bag, "snow", ...gableRoof(4.4, 8.9, 0.86, 0.09, platC.x, CANOPY_Y + 0.15, platC.z, sYaw + Math.PI / 2, 0.24));
  // scalloped valance along both long edges of the canopy
  for (const s of [-1, 1]) {
    const edge = platC.clone().addScaledVector(inward, s * 2.55);
    const band = new THREE.BufferGeometry();
    const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const f = i / N;
      const p = edge.clone().addScaledVector(fwd, (f - 0.5) * 9.4);
      const dip = Math.sin(Math.PI * ((f * 10) % 1));
      pos.push(p.x, CANOPY_Y - 0.02, p.z);
      pos.push(p.x, CANOPY_Y - 0.16 - 0.34 * dip, p.z);
      uvs.push(f * 3, 1, f * 3, 0);
    }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    band.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    band.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    band.setIndex(idx);
    band.computeVertexNormals();
    put(bag, "canvasFair", band);
  }
  // bench and a stack of parcels
  const benchP = platC.clone().addScaledVector(fwd, -2.6).addScaledVector(inward, -1.2);
  put(bag, "timberPale",
    box(2.2, 0.1, 0.5, benchP.x, deckY + 0.62, benchP.z, sYaw),
    box(2.2, 0.5, 0.14, 0, 0, 0).rotateY(sYaw).translate(benchP.x - inward.x * 0.2, deckY + 0.9, benchP.z - inward.z * 0.2));
  put(bag, "iron",
    cyl(0.05, 0.05, 0.5, 5, benchP.x + fwd.x * 0.9, deckY + 0.36, benchP.z + fwd.z * 0.9),
    cyl(0.05, 0.05, 0.5, 5, benchP.x - fwd.x * 0.9, deckY + 0.36, benchP.z - fwd.z * 0.9));
  const parcelP = platC.clone().addScaledVector(fwd, 3.7).addScaledVector(inward, -1.1);
  put(bag, "plum", box(0.8, 0.55, 0.7, parcelP.x, deckY + 0.46, parcelP.z, sYaw + 0.2));
  put(bag, "honey", box(0.6, 0.45, 0.55, parcelP.x + 0.1, deckY + 0.96, parcelP.z + 0.15, sYaw - 0.35));

  // nameboard — a BACK-TO-BACK PAIR (see "TWO-SIDED PAINTED BOARDS"). signPaint
  // is DoubleSide, so a single quad shows the far side of its own paint and the
  // platform reads "TLAH ELZZUP" to anyone standing on it or riding past.
  const boardP = platC.clone().addScaledVector(inward, -2.05).addScaledVector(fwd, 0.4);
  for (const face of [-1, 1]) {
    put(bag, "signPaint", mapSignRow(
      quadXY(4.6, 1.3, 0, 0, 0).rotateY(face > 0 ? sYaw + Math.PI : sYaw).translate(
        boardP.x + inward.x * face * -0.045, deckY + 2.2, boardP.z + inward.z * face * -0.045), "train"));
  }
  put(bag, "timber",
    box(4.9, 0.16, 0.16, 0, 0, 0).rotateY(sYaw).translate(boardP.x, deckY + 2.9, boardP.z),
    box(4.9, 0.14, 0.14, 0, 0, 0).rotateY(sYaw).translate(boardP.x, deckY + 1.5, boardP.z));

  /* ---- the clock ---- */
  const clockP = platC.clone().addScaledVector(fwd, 4.6);
  const clockY = deckY + 3.5;
  put(bag, "timber", twistPole(3.3, 0.14, 0.03, 6, 2.8, 12, 14, 0).translate(clockP.x, deckY + 0.14, clockP.z));
  // rotateX lays the turned drum on its side; rotateY then points its axis at
  // the rails, so the drum lines up with the two painted dials.
  put(bag, "timberPale", lathe([
    [0, 0], [0.68, 0.02], [0.72, 0.12], [0.66, 0.2], [0.3, 0.26], [0, 0.28],
  ], 16).rotateX(Math.PI / 2).rotateY(sYaw).translate(clockP.x, clockY, clockP.z));
  for (const s of [-1, 1]) {
    put(bag, "clockFace", new THREE.CircleGeometry(0.6, 28)
      .rotateY(s > 0 ? sYaw : sYaw + Math.PI)
      .translate(clockP.x + Math.sin(sYaw) * s * 0.16, clockY, clockP.z + Math.cos(sYaw) * s * 0.16));
  }
  put(bag, "honey", lathe([[0, 0], [0.2, 0.04], [0.12, 0.2], [0, 0.34]], 8).translate(clockP.x, clockY + 0.7, clockP.z));
  glows.push(glow([clockP.x, clockY + 0.82, clockP.z], PALETTE.lanternCore, 1.2, 9, 11, 1.7));

  const hourGeo = mergeGeometries([
    box(0.07, 0.34, 0.03, 0, 0.13, 0),
    box(0.05, 0.1, 0.03, 0, -0.05, 0),
  ]);
  const minuteGeo = mergeGeometries([
    box(0.05, 0.48, 0.03, 0, 0.2, 0),
    box(0.04, 0.12, 0.03, 0, -0.06, 0),
  ]);

  /* ---- water tower ---- */
  const wtA = Math.PI * 1.18;
  const wx = cx + Math.cos(wtA) * (TRAIN.rx + 3.0);
  const wz = cz + Math.sin(wtA) * (TRAIN.rz + 3.0);
  const wBase = deckY;
  const legTop = wBase + 3.6;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const fx = wx + Math.cos(a) * 1.9;
    const fz = wz + Math.sin(a) * 1.9;
    const gy = terrainHeight(fx, fz);
    put(bag, "timber", strut(
      new THREE.Vector3(fx, gy - 0.25, fz),
      new THREE.Vector3(wx + Math.cos(a) * 1.35, legTop, wz + Math.sin(a) * 1.35), 0.19, 0.15, 6));
  }
  for (const yy of [wBase + 1.2, wBase + 2.5]) {
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * TAU + Math.PI / 4;
      const a1 = ((i + 1) / 4) * TAU + Math.PI / 4;
      const t0 = (yy - wBase) / (legTop - wBase);
      const rr = THREE.MathUtils.lerp(1.9, 1.35, t0);
      put(bag, "timber", strut(
        new THREE.Vector3(wx + Math.cos(a0) * rr, yy, wz + Math.sin(a0) * rr),
        new THREE.Vector3(wx + Math.cos(a1) * rr, yy, wz + Math.sin(a1) * rr), 0.08, 0.08, 4));
    }
  }
  put(bag, "timberPale", scaleUV(cyl(1.75, 1.75, 2.5, 16, wx, legTop + 1.25, wz), 6, 1));
  for (const yy of [legTop + 0.4, legTop + 1.25, legTop + 2.1]) {
    put(bag, "iron", new THREE.TorusGeometry(1.79, 0.07, 5, 20).rotateX(Math.PI / 2).translate(wx, yy, wz));
  }
  put(bag, "plum", cyl(0.16, 2.0, 0.95, 16, wx, legTop + 2.95, wz));
  put(bag, "snow", cyl(0.14, 1.86, 0.5, 16, wx, legTop + 3.02, wz));
  put(bag, "honey", lathe([[0, 0], [0.18, 0.05], [0.1, 0.2], [0, 0.3]], 8).translate(wx, legTop + 3.42, wz));
  // the swing spout, reaching out over the rails
  const spoutDir = new THREE.Vector3(cx - wx, 0, cz - wz).normalize();
  put(bag, "iron", strut(
    new THREE.Vector3(wx + spoutDir.x * 1.7, legTop + 0.9, wz + spoutDir.z * 1.7),
    new THREE.Vector3(wx + spoutDir.x * 3.6, legTop - 0.35, wz + spoutDir.z * 3.6), 0.16, 0.2, 8));
  put(bag, "brass", new THREE.TorusGeometry(0.24, 0.06, 5, 12)
    .rotateX(Math.PI / 2).translate(wx + spoutDir.x * 3.6, legTop - 0.45, wz + spoutDir.z * 3.6));
  glows.push(glow([wx, legTop + 3.5, wz], PALETTE.honey, 0.9, 6, 10, 2.4));

  /* ---- a few lamps along the loop ---- */
  for (let i = 0; i < 8; i++) {
    const t = (i + r() * 0.4) / 8;
    const p = TRAIN_CURVE.getPointAt(t % 1);
    const tan = TRAIN_CURVE.getTangentAt(t % 1);
    const n = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
    const lx = p.x + n.x * 1.9, lz = p.z + n.z * 1.9;
    put(bag, "iron", cyl(0.05, 0.07, 2.4, 6, lx, deckY + 1.2, lz));
    put(bag, "brass", lathe([[0, 0], [0.16, 0.04], [0.18, 0.26], [0.1, 0.34], [0, 0.36]], 8).translate(lx, deckY + 2.3, lz));
    glows.push(glow([lx, deckY + 2.45, lz], PALETTE.lanternCore, 0.9, 7, 10, i * 0.83));
  }

  /* ---- THE ENGINE (local: +Z forward, rail top at y = 0) ---- */
  const eng = makeBag();
  const BOILER_R = 0.52;
  const BOILER_Y = 0.98;
  {
    // frames and buffer beam
    put(eng, "plum",
      box(1.24, 0.24, 3.6, 0, 0.46, 0.1),
      box(1.5, 0.42, 0.22, 0, 0.52, 1.92),
      box(1.5, 0.42, 0.22, 0, 0.52, -1.72));
    // boiler
    const boiler = cyl(BOILER_R, BOILER_R, 2.35, 16);
    boiler.rotateX(Math.PI / 2);
    boiler.translate(0, BOILER_Y, 0.62);
    put(eng, "plum", boiler);
    // smokebox front + door
    const sb = cyl(BOILER_R + 0.06, BOILER_R + 0.06, 0.5, 16);
    sb.rotateX(Math.PI / 2);
    sb.translate(0, BOILER_Y, 1.82);
    put(eng, "iron", sb);
    put(eng, "brass", new THREE.CircleGeometry(BOILER_R * 0.78, 16).translate(0, BOILER_Y, 2.08));
    // funnel with a flared cap
    put(eng, "iron", cyl(0.2, 0.24, 0.72, 12, 0, BOILER_Y + 0.72, 1.56));
    put(eng, "brass", lathe([[0.2, 0], [0.32, 0.06], [0.3, 0.2], [0.22, 0.22], [0.2, 0.06]], 12)
      .translate(0, BOILER_Y + 1.05, 1.56));
    // steam dome + whistle
    put(eng, "brass", lathe([[0, 0], [0.24, 0], [0.26, 0.16], [0.18, 0.28], [0, 0.3]], 12)
      .translate(0, BOILER_Y + 0.42, 0.75));
    put(eng, "brass", cyl(0.06, 0.06, 0.3, 6, 0.18, BOILER_Y + 0.62, 0.2));
    // cab
    put(eng, "plum",
      box(1.28, 1.35, 0.16, 0, BOILER_Y + 0.28, -1.34),
      box(0.16, 1.35, 1.5, -0.56, BOILER_Y + 0.28, -0.62),
      box(0.16, 1.35, 1.5, 0.56, BOILER_Y + 0.28, -0.62));
    put(eng, "cream", box(1.5, 0.14, 1.9, 0, BOILER_Y + 1.0, -0.66));
    // cab windows, warm from the firebox
    put(eng, "honey",
      box(0.42, 0.42, 0.05, -0.34, BOILER_Y + 0.62, -1.42),
      box(0.42, 0.42, 0.05, 0.34, BOILER_Y + 0.62, -1.42),
      box(0.05, 0.42, 0.42, -0.63, BOILER_Y + 0.62, -0.7),
      box(0.05, 0.42, 0.42, 0.63, BOILER_Y + 0.62, -0.7));
    // lamps
    for (const s of [-1, 1]) {
      put(eng, "brass", lathe([[0, 0], [0.13, 0], [0.15, 0.16], [0.08, 0.22], [0, 0.22]], 8)
        .rotateX(Math.PI / 2).translate(s * 0.34, BOILER_Y + 0.18, 2.12));
    }
    // wheels + coupling rod
    const wheelZ = [1.28, 0.2, -0.95];
    wheelZ.forEach((wz2, i) => {
      const rr = i === 2 ? 0.5 : 0.4;
      for (const s of [-1, 1]) {
        const w = cyl(rr, rr, 0.14, 14);
        w.rotateZ(Math.PI / 2);
        w.translate(s * 0.68, rr, wz2);
        put(eng, "honey", w);
        const hubc = cyl(0.12, 0.12, 0.2, 8);
        hubc.rotateZ(Math.PI / 2);
        hubc.translate(s * 0.72, rr, wz2);
        put(eng, "brass", hubc);
      }
    });
    for (const s of [-1, 1]) {
      put(eng, "brass", box(0.06, 0.1, 2.4, s * 0.8, 0.44, 0.16));
    }
    put(eng, "brass", lathe([[0, 0], [0.1, 0.02], [0.13, 0.1], [0.06, 0.16], [0, 0.16]], 8)
      .translate(0, BOILER_Y + 0.55, -1.0));
  }

  /* ---- CARRIAGES (local: +Z forward) ---- */
  const carriageMats: MatKey[] = ["teal", "honey", "cream"];
  const carriages = carriageMats.map((mat) => {
    const body: THREE.BufferGeometry[] = [];
    const trim = body;
    // an open tub with a scalloped top edge and a curved end
    body.push(box(1.3, 0.7, 2.5, 0, 0.78, 0));
    body.push(box(1.42, 0.16, 2.62, 0, 0.44, 0));
    body.push(scallopBand({
      radius: 0.8, radiusBottom: 0.86, top: 1.18, depth: 0.24, scallops: 10, seg: 40,
    }).scale(0.95, 1, 1.7));
    trim.push(box(1.46, 0.1, 0.12, 0, 1.16, 1.3));
    trim.push(box(1.46, 0.1, 0.12, 0, 1.16, -1.3));
    for (const s of [-1, 1]) {
      for (const wz2 of [0.85, -0.85]) {
        const w = cyl(0.3, 0.3, 0.12, 12);
        w.rotateZ(Math.PI / 2);
        w.translate(s * 0.66, 0.3, wz2);
        trim.push(w);
      }
    }
    trim.push(box(0.1, 0.1, 0.5, 0, 0.5, 1.55));
    trim.push(box(0.1, 0.1, 0.5, 0, 0.5, -1.55));
    return { mat, geo: mergeGeometries(body) };
  });

  return {
    parts: bag,
    glows,
    engine: bake(eng),
    carriages,
    // engine at 0, carriages trailing behind by a whole car length each
    spacing: [0, -0.058, -0.106, -0.154],
    funnel: [0, BOILER_Y + 1.2, 1.56],
    clock: { face: [clockP.x, clockY, clockP.z], yaw: sYaw, hour: hourGeo, minute: minuteGeo },
  };
}

/* ================================================================== */
/* 5 · THE GRAND MATCH TENT                                            */
/* ================================================================== */

/**
 * WHERE THE TENT STANDS.
 *
 * The brief says "plaza centre". Two things live at the literal origin: the
 * coaster spine clips past at (-6, 2) — six metres out — and the board camera
 * frames (0,0,0). So the tent is set nine metres back along -Z, doorway facing
 * the gate. From the plaza and gate rigs it still reads as dead centre, the
 * spine clears its canvas by 2.4m (1.6m to the guy pegs — measured, tight),
 * and the board at the origin sits in
 * the pool of light spilling out of its door. Pass a different centre if you
 * want it literally at the origin.
 */
export const BIG_TOP_CENTER: [number, number] = [0, -9];

const TENT = {
  radius: 9.4,
  wallTop: 4.9,
  peak: 13.4,
  bays: 12,
  /** Doorway faces +Z, toward the gate. */
  doorAngle: Math.PI / 2,
  /** ~4.3m of opening on an 18.8m tent: a doorway, not an absent wall. */
  doorWidth: 0.47,
};

export interface BigTopBuild extends LandmarkBuild {
  /** The pennant crown, in tent-local space — the component sways it. */
  pennants: GeoBag;
  /** Local origin of the pennant crown. */
  pennantOrigin: [number, number, number];
  /** Additive glow planes for the doorway spill; already in world space. */
  doorGlow: THREE.BufferGeometry;
  /** Soft light pool cast on the ground in front of the door. */
  lightPool: THREE.BufferGeometry;
}

/**
 * THE BIG TOP — the destination, and by design the brightest thing in the park.
 *
 * The canvas material carries a low honey emissive (set in Landmarks.tsx), so
 * the whole tent glows from inside the way a lit marquee does at dusk. The
 * doorway adds a real pointLight plus two additive planes, one standing in the
 * opening and one lying on the snow, so the light READS as spilling out.
 */
export function buildBigTop(center: [number, number] = BIG_TOP_CENTER, seed = 5505): BigTopBuild {
  const bag = makeBag();
  const pennants = makeBag();
  const glows: GlowSpot[] = [];
  const r = rng(seed);
  const [cx, cz] = center;

  const footprint = ringSpots(cx, cz, TENT.radius + 0.9, 24);
  const padY = groundMax([...footprint, [cx, cz]]) + 0.24;
  const padFloor = groundMin(footprint) - 0.8;

  /* ---- the boarded deck the tent stands on ---- */
  put(bag, "timberPale", ...skirtedPad(cx, cz, TENT.radius + 1.05, padY, 32, padFloor));
  put(bag, "timber", new THREE.TorusGeometry(TENT.radius + 1.05, 0.14, 5, 48)
    .rotateX(Math.PI / 2).translate(cx, padY, cz));

  const wallTop = padY + TENT.wallTop;
  const peakY = padY + TENT.peak;

  /* ---- striped canvas: side wall, then the drooping roof ---- */
  put(bag, "canvasTent", canvasWall({
    radius: TENT.radius, yBottom: padY, yTop: wallTop, seg: 132, uRepeat: 1,
    gapCenter: TENT.doorAngle, gapWidth: TENT.doorWidth,
  }).translate(cx, 0, cz));

  const roof = canopySurface({
    rOuter: TENT.radius + 0.55, yOuter: wallTop,
    rInner: 0.5, yInner: peakY,
    bays: TENT.bays, seg: 156, steps: 14,
    sag: 0.75, poleLift: 0.55, uRepeat: 1,
  });
  roof.translate(cx, 0, cz);
  put(bag, "canvasTent", roof);

  /* ---- the scalloped valance: the tent's signature silhouette ---- */
  put(bag, "canvasFair", scallopBand({
    radius: TENT.radius + 0.6, radiusBottom: TENT.radius + 0.72,
    top: wallTop + 0.06, depth: 1.05, scallops: 36, seg: 180, uRepeat: 9,
  }).translate(cx, 0, cz));

  /* ---- twelve quarter poles, their finials poking through the canvas ---- */
  const finials: THREE.Vector3[] = [];
  for (let i = 0; i < TENT.bays; i++) {
    const a = (i / TENT.bays) * TAU;
    // Set just OUTSIDE the canvas, the way a real big top laces its side poles
    // on. Sunk into the wall they sat in the tent's own shadow and read as
    // black bars; out here the key light finds them and they cast the stripes.
    const px = cx + Math.cos(a) * (TENT.radius + 0.17);
    const pz = cz + Math.sin(a) * (TENT.radius + 0.17);
    // the eave is lifted at each pole by canopySurface's poleLift
    const top = wallTop + 0.55;
    put(bag, "timberPale", twistPole(top - padY + 0.75, 0.12, 0.024, 5, 2.6, 10, 14, 0).translate(px, padY, pz));
    put(bag, "honey", lathe([[0, 0], [0.17, 0.03], [0.2, 0.12], [0.1, 0.24], [0.06, 0.34], [0, 0.4]], 8)
      .translate(px, top + 0.75, pz));
    finials.push(new THREE.Vector3(px, top + 0.75, pz));
  }

  /* ---- centre pole and the crown of pennants ---- */
  put(bag, "timber", cyl(0.16, 0.24, peakY - padY + 1.9, 10, cx, padY + (peakY - padY + 1.9) / 2, cz));
  put(bag, "brass", new THREE.TorusGeometry(0.6, 0.06, 5, 20).rotateX(Math.PI / 2).translate(cx, peakY + 0.4, cz));
  put(bag, "honey", lathe([[0, 0], [0.26, 0.06], [0.16, 0.3], [0.08, 0.5], [0, 0.62]], 10)
    .translate(cx, peakY + 1.9, cz));

  // pennant crown, built at the origin so the component can sway it
  {
    const N = 14;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const tint: MatKey = i % 3 === 0 ? "teal" : i % 3 === 1 ? "plum" : "honey";
      const g = new THREE.BufferGeometry();
      const w = 0.5, h = 1.9;
      g.setAttribute("position", new THREE.Float32BufferAttribute(
        [-w, 0, 0, w, 0, 0, 0, h, 0.22], 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
      g.setIndex([0, 1, 2]);
      g.computeVertexNormals();
      g.rotateY(-a);
      g.translate(Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62);
      put(pennants, tint, g);
    }
    put(pennants, "honey", new THREE.TorusGeometry(0.62, 0.035, 4, 18).rotateX(Math.PI / 2));
    // the big flag on the very top
    const flag = new THREE.BufferGeometry();
    flag.setAttribute("position", new THREE.Float32BufferAttribute(
      [0, 1.6, 0, 0, 3.1, 0, 2.8, 2.72, 0.42, 2.7, 1.85, 0.42], 3));
    flag.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2));
    flag.setIndex([0, 1, 2, 0, 2, 3]);
    flag.computeVertexNormals();
    put(pennants, "plum", flag);
  }

  /* ---- guy ropes and pegs ---- */
  for (const f of finials) {
    const dir = new THREE.Vector3(f.x - cx, 0, f.z - cz).normalize();
    const peg = new THREE.Vector3(cx + dir.x * (TENT.radius + 0.82), padY + 0.05, cz + dir.z * (TENT.radius + 0.82));
    put(bag, "iron", strut(f.clone().addScaledVector(dir, 0.06), peg, 0.028, 0.028, 4));
    put(bag, "timber", cyl(0.07, 0.09, 0.42, 5, peg.x, padY + 0.16, peg.z));
  }

  /* ---- THE DOORWAY: porch, proscenium, and the light spilling out ---- */
  const dA = TENT.doorAngle;
  const dOut = new THREE.Vector3(Math.cos(dA), 0, Math.sin(dA));
  const dSide = new THREE.Vector3(-Math.sin(dA), 0, Math.cos(dA));
  const doorC = new THREE.Vector3(cx + dOut.x * TENT.radius, padY, cz + dOut.z * TENT.radius);
  const doorYaw = Math.atan2(dOut.x, dOut.z);
  const halfW = Math.sin(TENT.doorWidth / 2) * TENT.radius;

  // jambs and lintel
  for (const s of [-1, 1]) {
    const p = doorC.clone().addScaledVector(dSide, s * (halfW + 0.12));
    put(bag, "timber", twistPole(TENT.wallTop + 0.2, 0.19, 0.045, 5, 3.2, 12, 14, 0).translate(p.x, padY, p.z));
  }
  // NB: rotateY(doorYaw) puts a box's long (X) axis ACROSS the doorway.
  // rotateY(doorYaw + 90°) sends it straight back over the roof.
  put(bag, "timber", box(halfW * 2 + 0.8, 0.34, 0.34, 0, 0, 0).rotateY(doorYaw)
    .translate(doorC.x, padY + TENT.wallTop + 0.2, doorC.z));

  // the porch awning, projecting toward the gate
  const porchOut = 3.2;
  // Set BELOW the eaves. Level with them, the porch merged into the valance
  // and the doorway read as the whole front of the tent being open.
  const porchY = padY + TENT.wallTop - 1.15;
  const porchC = doorC.clone().addScaledVector(dOut, porchOut / 2);
  put(bag, "canvasFair", scaleUV(
    box(halfW * 2 + 1.6, 0.14, porchOut, porchC.x, porchY, porchC.z, doorYaw), 4, 2));
  {
    // scalloped front edge of the porch
    const edge = doorC.clone().addScaledVector(dOut, porchOut);
    const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
    const N = 32;
    for (let i = 0; i <= N; i++) {
      const f = i / N;
      const p = edge.clone().addScaledVector(dSide, (f - 0.5) * (halfW * 2 + 1.6));
      const dip = Math.sin(Math.PI * ((f * 8) % 1));
      pos.push(p.x, porchY - 0.04, p.z);
      pos.push(p.x, porchY - 0.22 - 0.42 * dip, p.z);
      uvs.push(f * 3, 1, f * 3, 0);
    }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    const band = new THREE.BufferGeometry();
    band.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    band.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    band.setIndex(idx);
    band.computeVertexNormals();
    put(bag, "canvasFair", band);
  }
  for (const s of [-1, 1]) {
    const p = doorC.clone().addScaledVector(dOut, porchOut - 0.2).addScaledVector(dSide, s * (halfW + 0.6));
    const gy = terrainHeight(p.x, p.z);
    put(bag, "timber", twistPole(porchY - Math.max(gy, padY) - 0.1, 0.16, 0.04, 5, 3.0, 12, 14, 0)
      .translate(p.x, Math.max(gy, padY), p.z));
  }

  // the painted proscenium board over the porch
  const signC = doorC.clone().addScaledVector(dOut, porchOut - 0.05);
  // Sized to the PORCH, not to the tent: a board wide enough to span the canvas
  // reads as a billboard bolted to a marquee, and hides the silhouette we spent
  // the sag and the pole-lift building.
  // Back-to-back again: you read the far face of this one on your way back OUT
  // through the porch.
  const SIGN_W = halfW * 1.9, SIGN_H = 1.3;
  for (const face of [1, -1]) {
    put(bag, "signPaint", mapSignRow(
      quadXY(SIGN_W, SIGN_H, 0, 0, 0).rotateY(face > 0 ? doorYaw : doorYaw + Math.PI)
        .translate(signC.x + dOut.x * face * 0.05, porchY + 0.72, signC.z + dOut.z * face * 0.05), "tent"));
  }
  put(bag, "timber",
    box(SIGN_W + 0.5, 0.18, 0.18, 0, 0, 0).rotateY(doorYaw).translate(signC.x, porchY + 0.06 + SIGN_H, signC.z),
    box(SIGN_W + 0.5, 0.16, 0.16, 0, 0, 0).rotateY(doorYaw).translate(signC.x, porchY + 0.06, signC.z));

  // A plum LINER inside the tent. A flat backdrop quad would show its edges as
  // soon as you looked in off-axis; a full cylinder set inside the canvas reads
  // as a lined interior from every angle in the plaza and never shows a seam.
  put(bag, "plum", canvasWall({
    radius: TENT.radius - 1.5, yBottom: padY, yTop: wallTop + 1.2, seg: 64,
    uRepeat: 4, gapCenter: TENT.doorAngle, gapWidth: TENT.doorWidth * 1.35,
  }).translate(cx, 0, cz));
  // and a swept honey floor, so the doorway looks into a room and not a void
  put(bag, "honey", new THREE.CircleGeometry(TENT.radius - 1.4, 40)
    .rotateX(-Math.PI / 2).translate(cx, padY + 0.03, cz));

  // additive glow standing in the opening + a pool on the snow outside
  const doorGlow = quadXY(halfW * 2.05, TENT.wallTop + 0.1, 0, 0, 0).rotateY(doorYaw)
    .translate(doorC.x - dOut.x * 0.35, padY + (TENT.wallTop + 0.1) / 2, doorC.z - dOut.z * 0.35);
  const lightPool = quadXZ(halfW * 3.4, 12, 0, 0, 0, doorYaw)
    .translate(doorC.x + dOut.x * 4.2, padY + 0.035, doorC.z + dOut.z * 4.2);

  glows.push(
    glow([doorC.x - dOut.x * 1.2, padY + 2.1, doorC.z - dOut.z * 1.2], PALETTE.lanternCore, 3.6, 46, 26, 0),
    glow([doorC.x + dOut.x * 1.4, padY + 3.3, doorC.z + dOut.z * 1.4], PALETTE.honey, 1.6, 16, 14, 1.4),
    glow([cx, padY + TENT.peak * 0.55, cz], PALETTE.lanternCore, 0, 34, 22, 2.2));

  // lanterns hung along the valance
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU + 0.13;
    const d = Math.abs(((a - dA + Math.PI * 3) % TAU) - Math.PI);
    if (d < TENT.doorWidth * 0.6) continue;
    glows.push(glow([
      cx + Math.cos(a) * (TENT.radius + 0.75),
      wallTop - 0.85 - r() * 0.2,
      cz + Math.sin(a) * (TENT.radius + 0.75),
    ], PALETTE.honey, 0.7, i % 4 === 0 ? 5 : 0, 9, i * 0.63));
  }

  return {
    parts: bag,
    glows,
    pennants,
    pennantOrigin: [cx, peakY + 0.42, cz],
    doorGlow,
    lightPool,
  };
}

/* ================================================================== */
/* PLAZA DRESSING                                                      */
/* ================================================================== */

export const CAROUSEL_CENTER: [number, number] = [13, 5];
/** On the gate path, off the plaza rig's eyeline — at (8,17) it filled that frame. */
export const TICKET_BOOTH: [number, number] = [10.5, 24];
export const CANDY_STAND: [number, number] = [-9, 16];
export const SIGNPOSTS: Array<[number, number]> = [[6, 12], [-16, -12]];
export const BALLOON_POSTS: Array<[number, number]> = [[9.5, 9.5], [-3.5, 13.5]];

export interface CarouselBuild {
  /** Everything that stands still: the base drum and its steps. */
  base: GeoBag;
  /** The turning top: canopy, poles, ring beams — local to the carousel centre. */
  spinner: GeoBag;
  /**
   * Two rings of mounts that rise and fall in antiphase, exactly as alternate
   * horses do on a real carousel. Local to the carousel centre.
   */
  bobA: GeoBag;
  bobB: GeoBag;
  center: [number, number, number];
  /** Seconds per revolution. */
  period: number;
  glows: GlowSpot[];
}

/**
 * THE PLAZA CAROUSEL — chess pieces instead of horses.
 *
 * The mounts are real `pieceGeometry()` knights, bishops, rooks and queens,
 * scaled up to ride-height and alternating cream and walnut like a set laid
 * out for a game. It is the cheapest, clearest way to tell a child, before a
 * single word of tutoring, that this park is ABOUT the pieces.
 */
export function buildCarousel(seed = 6606): CarouselBuild {
  const r = rng(seed);          // nudges the painted rounding boards off-true
  const base = makeBag();
  const spinner = makeBag();
  const bobA = makeBag();
  const bobB = makeBag();
  const glows: GlowSpot[] = [];
  const [cx, cz] = CAROUSEL_CENTER;
  const ground = groundMax(ringSpots(cx, cz, 5.4, 12));
  const deckY = ground + 0.46;

  put(base, "timberPale", ...skirtedPad(cx, cz, 4.9, deckY, 24, groundMin(ringSpots(cx, cz, 5.2, 12)) - 0.5));
  put(base, "plum", new THREE.TorusGeometry(4.9, 0.16, 5, 40).rotateX(Math.PI / 2).translate(cx, deckY, cz));
  // a step up on the plaza side
  const stepA = Math.atan2(0 - cx, 0 - cz);
  put(base, "timberPale",
    box(2.4, 0.22, 0.7, cx + Math.sin(stepA) * 5.2, ground + 0.24, cz + Math.cos(stepA) * 5.2, stepA),
    box(2.4, 0.22, 0.7, cx + Math.sin(stepA) * 5.8, ground + 0.06, cz + Math.cos(stepA) * 5.8, stepA));

  /* ---- the turning top (local space: origin at the deck centre) ---- */
  const CANOPY_Y = 4.3;
  put(spinner, "timber", cyl(0.4, 0.5, CANOPY_Y + 1.4, 12, 0, (CANOPY_Y + 1.4) / 2, 0));
  put(spinner, "brass",
    new THREE.TorusGeometry(0.46, 0.05, 4, 16).rotateX(Math.PI / 2).translate(0, 1.2, 0),
    new THREE.TorusGeometry(0.46, 0.05, 4, 16).rotateX(Math.PI / 2).translate(0, 2.8, 0));
  const POLES = 10;
  for (let i = 0; i < POLES; i++) {
    const a = (i / POLES) * TAU;
    const px = Math.cos(a) * 4.1, pz = Math.sin(a) * 4.1;
    put(spinner, "timber", twistPole(CANOPY_Y - 0.15, 0.13, 0.03, 5, 3.0, 10, 14, 0).translate(px, 0.06, pz));
    put(spinner, "brass", new THREE.TorusGeometry(0.17, 0.035, 4, 10).rotateX(Math.PI / 2).translate(px, CANOPY_Y - 0.2, pz));
  }
  const roof = canopySurface({
    rOuter: 5.2, yOuter: CANOPY_Y, rInner: 0.45, yInner: CANOPY_Y + 1.9,
    bays: POLES, seg: 100, steps: 8, sag: 0.3, poleLift: 0.26, uRepeat: 1,
  });
  put(spinner, "canvasFair", roof);
  put(spinner, "canvasFair", scallopBand({
    radius: 5.2, radiusBottom: 5.3, top: CANOPY_Y, depth: 0.72, scallops: 20, seg: 100, uRepeat: 5,
  }));
  put(spinner, "timber", new THREE.TorusGeometry(5.15, 0.1, 5, 48).rotateX(Math.PI / 2).translate(0, CANOPY_Y, 0));
  put(spinner, "brass", lathe([[0, 0], [0.3, 0.06], [0.18, 0.3], [0.08, 0.5], [0, 0.66]], 10)
    .translate(0, CANOPY_Y + 1.9, 0));
  // painted rounding boards between the poles
  for (let i = 0; i < POLES; i++) {
    const a = ((i + 0.5) / POLES) * TAU;
    // each board hung a degree or so off true — a machined ring reads as plastic
    put(spinner, "cream", quadXY(2.5, 0.62, 0, 0, 0)
      .rotateZ((r() - 0.5) * 0.05).rotateY(-a + Math.PI / 2)
      .translate(Math.cos(a) * 4.85, CANOPY_Y - 0.38 + (r() - 0.5) * 0.05, Math.sin(a) * 4.85));
  }

  /* ---- eight chess-piece mounts on brass poles, in two bob rings ----
   *
   * Ring A is CREAM and ring B is WALNUT, and they rise and fall in antiphase.
   * That is not just a bob: it means the carousel is always showing a cream
   * rank up and a dark rank down, like a set mid-game going round. It also
   * keeps each ring to two materials, so the moving half of this ride is four
   * meshes rather than a dozen.
   *
   * THE ORDER IS A CHESS CLAIM, so it has to be true. Cycling n,b,r,q,n,b,r,q
   * across alternating rings gave cream every knight and rook and walnut every
   * bishop and queen — a "set" in which one colour owns no queen. Pairing the
   * types instead hands each ring the same four pieces, so the ride really is
   * two half-sets facing each other, and every pair that swings past a child is
   * the light and the dark of the SAME piece, side by side. */
  const MOUNT_PIECES: PieceType[] = ["n", "n", "b", "b", "r", "r", "q", "q"];
  const ringPieces: Array<THREE.BufferGeometry[]> = [[], []];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    const px = Math.cos(a) * 3.3, pz = Math.sin(a) * 3.3;
    const which = i % 2;
    const ring = which === 0 ? bobA : bobB;
    const type = MOUNT_PIECES[i];
    // scale the real piece up to ride height
    const h = pieceHeight(type);
    const sc = 1.75 / h;
    // pieceGeometry is CACHED — clone before merging, or the cache is destroyed
    const g = pieceGeometry(type, "high").clone();
    g.scale(sc, sc, sc);
    g.rotateY(-a + Math.PI); // face outward for the rider
    g.translate(px, 0.9, pz);
    ringPieces[which].push(g);
    // The brass pole it rides, and a little stirrup platform.
    // The pole has to OVERLAP the deck and reach the canopy across the whole
    // bob. At 3.6m centred on 2.1 it spanned y 0.3 -> 3.9: its foot floated
    // 30cm above the boards and its head stopped 1.2m short of the canvas, so
    // eight brass rods hung in mid-air at both ends. The canopy sits at ~4.9-5.3
    // out here at r=3.3, so the pole runs -0.6 -> 4.55 and, with the +-0.3 bob,
    // is always sunk into the deck and always lost in the roof's shadow.
    put(ring, "brass",
      cyl(0.055, 0.055, 5.15, 8, px, 1.975, pz),
      new THREE.TorusGeometry(0.42, 0.05, 4, 14).rotateX(Math.PI / 2).translate(px, 0.86, pz));
  }
  put(bobA, "cream", ...ringPieces[0]);
  put(bobB, "timber", ...ringPieces[1]);

  // chariots between the mounts, for the ones who would rather sit. On a real
  // carousel these are FIXED, so they live on the spinner and never bob.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    // rotateY(PI/2 - a) lays the seat ACROSS the radius; rotateY(-a) would
    // point it outward like a diving board.
    const ry = Math.PI / 2 - a;
    put(spinner, "teal",
      box(1.5, 0.12, 0.6, Math.cos(a) * 2.2, 0.62, Math.sin(a) * 2.2, ry),
      box(1.5, 0.6, 0.12, 0, 0, 0).rotateY(ry).translate(Math.cos(a) * 1.95, 0.9, Math.sin(a) * 1.95));
  }

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    glows.push(glow([cx + Math.cos(a) * 5.0, deckY + CANOPY_Y - 0.55, cz + Math.sin(a) * 5.0],
      PALETTE.honey, 0.7, i % 3 === 0 ? 6 : 0, 9, i * 0.52));
  }
  glows.push(glow([cx, deckY + CANOPY_Y + 2.4, cz], PALETTE.lanternCore, 1.4, 14, 14, 0.9));

  return { base, spinner, bobA, bobB, center: [cx, deckY, cz], period: 26, glows };
}

/** Ticket booth, cotton-candy barrow, signposts, benches and barrels. */
export interface DressingBuild extends LandmarkBuild {
  /** Where the cotton-candy chimney puffs from. */
  candySmoke: [number, number, number];
  balloonBunches: Array<{ origin: [number, number, number]; warm: THREE.BufferGeometry; cool: THREE.BufferGeometry }>;
}

export function buildPlazaDressing(seed = 7707): DressingBuild {
  const bag = makeBag();
  const glows: GlowSpot[] = [];
  const r = rng(seed);

  /* ---- TICKET BOOTH ---- */
  {
    const [bx, bz] = TICKET_BOOTH;
    const gy = groundMax(ringSpots(bx, bz, 2.2, 8));
    const yaw = Math.atan2(0 - bx, 0 - bz); // face the plaza
    const R = 1.6, WALL = 2.4;
    put(bag, "timberPale", ...skirtedPad(bx, bz, R + 0.35, gy + 0.22, 6, groundMin(ringSpots(bx, bz, 2.0, 8)) - 0.4));
    // six walls, with the serving window left out of the one facing the plaza
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + yaw;
      const d = Math.abs(((a - yaw + Math.PI * 3) % TAU) - Math.PI);
      const px = bx + Math.sin(a) * R * 0.866;
      const pz = bz + Math.cos(a) * R * 0.866;
      if (d < 0.4) {
        // the counter under the window, and the shutter above it
        put(bag, "timberPale", box(R, 0.9, 0.16, px, gy + 0.22 + 0.45, pz, a));
        put(bag, "teal", box(R + 0.5, 0.14, 0.55, 0, 0, 0).rotateY(a)
          .translate(px + Math.sin(a) * 0.22, gy + 0.22 + 1.02, pz + Math.cos(a) * 0.22));
        put(bag, "timberPale", box(R, 0.55, 0.14, px, gy + 0.22 + WALL - 0.28, pz, a));
        // the warm interior seen through the hatch
        put(bag, "honey", box(R - 0.16, 0.86, 0.06, px - Math.sin(a) * 0.14, gy + 0.22 + 1.5, pz - Math.cos(a) * 0.14, a));
        glows.push(glow([px - Math.sin(a) * 0.5, gy + 1.9, pz - Math.cos(a) * 0.5], PALETTE.lanternCore, 2.0, 18, 13, 0.5));
      } else {
        put(bag, "timberPale", scaleUV(box(R, WALL, 0.16, px, gy + 0.22 + WALL / 2, pz, a), 2, 2));
      }
      put(bag, "timber", cyl(0.1, 0.12, WALL, 6, bx + Math.sin(a + Math.PI / 6) * R, gy + 0.22 + WALL / 2, bz + Math.cos(a + Math.PI / 6) * R));
    }
    const eave = gy + 0.22 + WALL;
    put(bag, "canvasFair", canopySurface({
      rOuter: R + 0.75, yOuter: eave, rInner: 0.18, yInner: eave + 1.3,
      bays: 6, seg: 48, steps: 5, sag: 0.16, poleLift: 0.18, uRepeat: 1,
    }).translate(bx, 0, bz));
    put(bag, "canvasFair", scallopBand({
      radius: R + 0.75, radiusBottom: R + 0.84, top: eave, depth: 0.42, scallops: 12, seg: 48, uRepeat: 3,
    }).translate(bx, 0, bz));
    put(bag, "snow", canopySurface({
      rOuter: R + 0.5, yOuter: eave + 0.28, rInner: 0.16, yInner: eave + 1.26,
      bays: 6, seg: 36, steps: 4, sag: 0.12, poleLift: 0.14,
    }).translate(bx, 0, bz));
    put(bag, "honey", lathe([[0, 0], [0.18, 0.05], [0.1, 0.24], [0, 0.4]], 8).translate(bx, eave + 1.3, bz));
    // The painted TICKETS board over the window, back-to-back (see "TWO-SIDED
    // PAINTED BOARDS"). The gate path runs behind this booth, so a single quad
    // on a DoubleSide material greets everyone walking down from the gate with
    // "STEKCIT".
    for (const face of [1, -1]) {
      put(bag, "signPaint", mapSignRow(
        quadXY(2.3, 0.72, 0, 0, 0).rotateY(face > 0 ? yaw : yaw + Math.PI).translate(
          bx + Math.sin(yaw) * (R * 0.9 + face * 0.045),
          eave + 0.52,
          bz + Math.cos(yaw) * (R * 0.9 + face * 0.045)), "tickets"));
    }
    glows.push(glow([bx, eave + 1.44, bz], PALETTE.honey, 0.9, 6, 10, 1.1));
  }

  /* ---- COTTON-CANDY BARROW ---- */
  let candySmoke: [number, number, number] = [0, 0, 0];
  {
    const [sx, sz] = CANDY_STAND;
    const gy = terrainHeight(sx, sz);
    const yaw = Math.atan2(0 - sx, 0 - sz);
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const bodyY = gy + 0.92;
    put(bag, "teal", scaleUV(box(2.5, 0.85, 1.5, sx, bodyY, sz, yaw), 3, 1));
    put(bag, "cream", box(2.62, 0.14, 1.62, sx, bodyY + 0.48, sz, yaw));
    put(bag, "plum", box(2.56, 0.2, 1.56, sx, bodyY - 0.44, sz, yaw));
    // spoked wheels
    for (const s of [-1, 1]) {
      const p = new THREE.Vector3(sx, gy + 0.5, sz).addScaledVector(side, s * 0.86);
      const w = new THREE.TorusGeometry(0.5, 0.07, 5, 18);
      w.rotateY(yaw);
      w.translate(p.x, p.y, p.z);
      put(bag, "honey", w);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        const sp = cyl(0.03, 0.03, 1.0, 4);
        sp.rotateZ(a);
        sp.rotateY(yaw);
        sp.translate(p.x, p.y, p.z);
        put(bag, "brass", sp);
      }
    }
    // handles
    for (const s of [-1, 1]) {
      const a = new THREE.Vector3(sx, bodyY + 0.2, sz).addScaledVector(fwd, -1.3).addScaledVector(side, s * 0.55);
      const b = a.clone().addScaledVector(fwd, -0.9).setY(bodyY + 0.5);
      put(bag, "timber", strut(a, b, 0.055, 0.05, 5));
    }
    // the spinning drum on top
    const drumP = new THREE.Vector3(sx, bodyY + 0.72, sz).addScaledVector(fwd, 0.45);
    put(bag, "brass", lathe([
      [0, 0], [0.62, 0.02], [0.66, 0.16], [0.6, 0.34], [0.3, 0.36], [0.28, 0.3], [0, 0.3],
    ], 16).translate(drumP.x, drumP.y, drumP.z));
    put(bag, "cream", lathe([[0, 0], [0.26, 0.06], [0.3, 0.2], [0.2, 0.3], [0, 0.32]], 12)
      .translate(drumP.x, drumP.y + 0.34, drumP.z));
    // a rack of finished clouds on sticks
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Vector3(sx, bodyY + 0.55, sz)
        .addScaledVector(fwd, -0.55).addScaledVector(side, (i - 1.5) * 0.42);
      put(bag, "timberPale", cyl(0.025, 0.025, 0.55, 4, p.x, p.y + 0.28, p.z));
      const cloud = new THREE.SphereGeometry(0.26 + r() * 0.05, 9, 7);
      cloud.scale(1, 0.9, 1);
      cloud.translate(p.x, p.y + 0.72, p.z);
      put(bag, i % 2 ? "plum" : "cream", cloud);
    }
    // the little chimney the smoke curls from
    const chim = new THREE.Vector3(sx, bodyY + 0.5, sz).addScaledVector(fwd, -0.15).addScaledVector(side, 0.85);
    put(bag, "iron", cyl(0.09, 0.11, 0.75, 8, chim.x, chim.y + 0.38, chim.z));
    put(bag, "brass", new THREE.TorusGeometry(0.11, 0.03, 4, 10).rotateX(Math.PI / 2).translate(chim.x, chim.y + 0.74, chim.z));
    candySmoke = [chim.x, chim.y + 0.82, chim.z];

    // the striped awning over it all
    const awnY = gy + 2.7;
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Vector3(sx, gy, sz)
        .addScaledVector(fwd, (i < 2 ? 1 : -1) * 1.2)
        .addScaledVector(side, (i % 2 ? 1 : -1) * 0.82);
      put(bag, "timber", cyl(0.06, 0.075, awnY - gy, 6, p.x, (gy + awnY) / 2, p.z));
    }
    put(bag, "canvasFair", scaleUV(box(2.9, 0.12, 2.2, sx, awnY, sz, yaw), 5, 2));
    for (const s of [-1, 1]) {
      const edge = new THREE.Vector3(sx, 0, sz).addScaledVector(fwd, s * 1.1);
      const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
      const N = 18;
      for (let i = 0; i <= N; i++) {
        const f = i / N;
        const p = edge.clone().addScaledVector(side, (f - 0.5) * 2.9);
        const dip = Math.sin(Math.PI * ((f * 6) % 1));
        pos.push(p.x, awnY - 0.02, p.z);
        pos.push(p.x, awnY - 0.14 - 0.26 * dip, p.z);
        uvs.push(f * 2, 1, f * 2, 0);
      }
      for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
      const band = new THREE.BufferGeometry();
      band.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      band.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      band.setIndex(idx);
      band.computeVertexNormals();
      put(bag, "canvasFair", band);
    }
    glows.push(glow([sx, awnY - 0.35, sz], PALETTE.lanternCore, 1.6, 13, 11, 2.0));
  }

  /* ---- FINGERPOSTS ---- */
  {
    const targets: Array<{ icon: IconName; at: THREE.Vector3 }> = [
      { icon: "parade", at: ATTRACTIONS.parade },
      { icon: "coaster", at: ATTRACTIONS.coaster },
      { icon: "ferris", at: ATTRACTIONS.ferris },
      { icon: "train", at: ATTRACTIONS.train },
      { icon: "tent", at: new THREE.Vector3(BIG_TOP_CENTER[0], 0, BIG_TOP_CENTER[1]) },
    ];
    SIGNPOSTS.forEach(([px, pz], si) => {
      const gy = terrainHeight(px, pz);
      put(bag, "timber", twistPole(3.5, 0.17, 0.038, 6, 2.8, 12, 18, 0).translate(px, gy, pz));
      put(bag, "timberPale", lathe([[0, 0], [0.36, 0], [0.38, 0.14], [0.26, 0.24], [0.2, 0.36], [0, 0.36]], 10)
        .translate(px, gy, pz));
      put(bag, "honey", lathe([[0, 0], [0.22, 0.05], [0.14, 0.22], [0.06, 0.36], [0, 0.44]], 8)
        .translate(px, gy + 3.5, pz));
      targets.forEach((t, i) => {
        // point the arm at the real attraction — a compass that tells the truth
        const yaw = Math.atan2(t.at.x - px, t.at.z - pz);
        const armY = gy + 3.15 - i * 0.5;
        const ARM_L = 2.1, ARM_H = 0.46;
        for (const face of [1, -1]) {
          // opposite normals, identical paint — see "TWO-SIDED PAINTED BOARDS"
          const q = quadXY(ARM_L, ARM_H, 0, 0, 0);
          mapFingerCell(q, t.icon);
          q.rotateY(yaw + face * (Math.PI / 2) * -1);
          q.translate(
            px + Math.sin(yaw) * (ARM_L / 2 + 0.2) - Math.cos(yaw) * face * 0.055,
            armY,
            pz + Math.cos(yaw) * (ARM_L / 2 + 0.2) + Math.sin(yaw) * face * 0.055);
          put(bag, "signIcons", q);
        }
        // THE CARVED CHEVRON. Painted on, it would point backwards on the far
        // face; cut from wood, it points at the ride from every angle.
        {
          const wedge = new THREE.Shape();
          wedge.moveTo(0, ARM_H / 2);
          wedge.lineTo(0.46, 0);
          wedge.lineTo(0, -ARM_H / 2);
          wedge.closePath();
          const tip = new THREE.ExtrudeGeometry(wedge, { depth: 0.12, bevelEnabled: false, curveSegments: 1 });
          tip.translate(0, 0, -0.06);
          tip.rotateY(yaw - Math.PI / 2);
          tip.translate(px + Math.sin(yaw) * (ARM_L + 0.2), armY, pz + Math.cos(yaw) * (ARM_L + 0.2));
          put(bag, "honey", tip);
        }
        put(bag, "timber", box(ARM_L + 0.1, 0.09, 0.09, 0, 0, 0).rotateY(yaw + Math.PI / 2)
          .translate(px + Math.sin(yaw) * (ARM_L / 2 + 0.2), armY - ARM_H / 2 - 0.04, pz + Math.cos(yaw) * (ARM_L / 2 + 0.2)));
      });
      glows.push(glow([px, gy + 3.66, pz], PALETTE.lanternCore, 1.1, 9, 11, si * 1.9));
    });
  }

  /* ---- barrels, crates and a snowy bench, to keep the plaza lived-in ---- */
  {
    const spots: Array<[number, number, number]> = [
      [10.5, 15.5, 0.3], [11.4, 16.4, 1.1], [-11.5, 14.4, 2.4],
      [5.0, 20.0, 0.8], [-6.0, -14.0, 1.9], [16.5, 1.0, 0.4],
    ];
    for (const [px, pz, rot] of spots) {
      const gy = terrainHeight(px, pz);
      if (r() > 0.45) {
        put(bag, "timber", scaleUV(lathe([
          [0, 0], [0.42, 0], [0.5, 0.22], [0.52, 0.5], [0.5, 0.78], [0.42, 1.0], [0, 1.0],
        ], 12).translate(px, gy, pz), 3, 1));
        put(bag, "iron",
          new THREE.TorusGeometry(0.5, 0.035, 4, 14).rotateX(Math.PI / 2).translate(px, gy + 0.22, pz),
          new THREE.TorusGeometry(0.5, 0.035, 4, 14).rotateX(Math.PI / 2).translate(px, gy + 0.78, pz));
        put(bag, "snow", cyl(0.44, 0.4, 0.12, 12, px, gy + 1.04, pz));
      } else {
        put(bag, "timberPale", scaleUV(box(0.9, 0.7, 0.9, px, gy + 0.35, pz, rot), 2, 2));
        put(bag, "timber",
          box(0.96, 0.08, 0.08, px, gy + 0.66, pz, rot),
          box(0.08, 0.08, 0.96, px, gy + 0.66, pz, rot));
        put(bag, "snow", box(0.86, 0.1, 0.86, px, gy + 0.74, pz, rot));
      }
    }
    // a bench facing the tent
    const bx = -4.5, bz = 5.5;
    const bgy = terrainHeight(bx, bz);
    const byaw = Math.atan2(BIG_TOP_CENTER[0] - bx, BIG_TOP_CENTER[1] - bz);
    put(bag, "timberPale",
      box(2.2, 0.12, 0.55, bx, bgy + 0.5, bz, byaw),
      box(2.2, 0.5, 0.12, 0, 0, 0).rotateY(byaw).translate(bx - Math.sin(byaw) * 0.24, bgy + 0.8, bz - Math.cos(byaw) * 0.24));
    put(bag, "snow", box(2.1, 0.07, 0.5, bx, bgy + 0.59, bz, byaw));
    for (const s of [-1, 1]) {
      put(bag, "iron", box(0.1, 0.5, 0.5, bx + Math.cos(byaw) * s, bgy + 0.25, bz - Math.sin(byaw) * s, byaw));
    }
  }

  /* ---- BALLOON BUNCHES ---- */
  const balloonBunches: DressingBuild["balloonBunches"] = BALLOON_POSTS.map(([px, pz], bi) => {
    const gy = terrainHeight(px, pz);
    // the bollard the strings are knotted to
    put(bag, "timber", lathe([
      [0, 0], [0.16, 0], [0.17, 0.9], [0.22, 0.98], [0.14, 1.06], [0.08, 1.14], [0, 1.16],
    ], 10).translate(px, gy, pz));
    put(bag, "honey", new THREE.TorusGeometry(0.18, 0.03, 4, 12).rotateX(Math.PI / 2).translate(px, gy + 0.7, pz));

    // Two sub-bunches so the group can breathe with two phases. Strings are
    // built as straight tubes from the knot, so tilting the group around the
    // knot keeps every string attached.
    const knotY = 1.1;
    const warmParts: THREE.BufferGeometry[] = [];
    const coolParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) {
      const warm = i % 2 === 0;
      const a = (i / 8) * TAU + bi * 0.7;
      const spread = 0.55 + r() * 0.55;
      const rise = 3.2 + r() * 1.5 + (warm ? 0.35 : 0);
      const bxp = Math.cos(a) * spread;
      const bzp = Math.sin(a) * spread;
      const top = new THREE.Vector3(bxp, knotY + rise, bzp);
      // string
      const str = strut(new THREE.Vector3(0, knotY, 0), top.clone().setY(top.y - 0.34), 0.014, 0.014, 4);
      // balloon: a teardrop, wider than tall at the top, pinched at the knot
      const bal = lathe([
        [0.0, 0.0], [0.1, 0.03], [0.2, 0.1], [0.33, 0.3], [0.38, 0.55],
        [0.34, 0.78], [0.22, 0.94], [0.0, 1.0],
      ], 14);
      bal.scale(0.62, 0.62, 0.62);
      bal.translate(top.x, top.y - 0.3, top.z);
      const knot = new THREE.ConeGeometry(0.05, 0.09, 6);
      knot.rotateX(Math.PI);
      knot.translate(top.x, top.y - 0.33, top.z);
      (warm ? warmParts : coolParts).push(str, bal, knot);
    }
    return {
      origin: [px, gy + 0, pz] as [number, number, number],
      warm: mergeGeometries(warmParts),
      cool: mergeGeometries(coolParts),
    };
  });

  return { parts: bag, glows, candySmoke, balloonBunches };
}

/* ================================================================== */
/* STEAM — the one custom shader in this file                          */
/* ================================================================== */

/**
 * PUFFS THAT GROW AND FADE.
 *
 * `THREE.PointsMaterial` has ONE size for every point, which cannot express a
 * puff that swells as it rises. So the steam gets its own tiny shader: an
 * `aLife` attribute (0 at the funnel, 1 when it dissolves) drives both point
 * size and alpha, and a per-particle seed offsets the drift so no two puffs
 * follow the same line.
 *
 * This is safe to hand-roll because steam lives on NO_INK_LAYER: the normal +
 * depth prepass never sees it, so the Sobel pass can never ink it into a black
 * square, and no override material ever has to understand this shader.
 */
export function createSteamMaterial(opts: {
  color?: number;
  size?: number;
  opacity?: number;
} = {}): THREE.ShaderMaterial {
  const { color = 0xf6ecdc, size = 34, opacity = 0.5 } = opts;
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uSize: { value: size },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      attribute float aLife;
      uniform float uSize;
      varying float vLife;
      void main() {
        vLife = aLife;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // swell from a tight puff at the funnel to a soft cloud as it rises
        float grow = 0.35 + 1.65 * aLife;
        gl_PointSize = uSize * grow * (28.0 / max(-mv.z, 1.0));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vLife;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d);
        if (r > 0.5) discard;
        // soft round puff, brightest in the middle, gone by the end of its life
        float a = smoothstep(0.5, 0.06, r);
        a *= uOpacity * (1.0 - smoothstep(0.15, 1.0, vLife)) * smoothstep(0.0, 0.08, vLife);
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    fog: false,
    toneMapped: false,
  });
}

/* ================================================================== */
/* LANTERN GLOWS — every practical light in the park, in one draw call */
/* ================================================================== */

/**
 * The park hangs well over a hundred lanterns, fairy-lights and window-glows.
 * As sprites that would be a hundred draw calls; as `THREE.Points` with the
 * stock material they would all be the same size and colour.
 *
 * So the glows get a shader too: per-point SIZE, COLOUR and TWINKLE PHASE come
 * in as attributes, and the whole park's warmth costs one additive draw call.
 * Like the steam, this lives on NO_INK_LAYER — an inked firefly is a black
 * square, and that is a bug this project has already paid for once.
 */
export function makeGlowGeometry(glows: GlowSpot[]): THREE.BufferGeometry {
  const n = glows.length;
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const col = new Float32Array(n * 3);
  const phase = new Float32Array(n);
  const c = new THREE.Color();
  glows.forEach((g, i) => {
    pos[i * 3] = g.pos[0]; pos[i * 3 + 1] = g.pos[1]; pos[i * 3 + 2] = g.pos[2];
    size[i] = g.glow;
    c.set(g.color);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    phase[i] = g.phase;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  geo.computeBoundingSphere();
  return geo;
}

export function createGlowPointsMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      /** Rises with dusk — the park gets warmer as the light goes. */
      uBoost: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute vec3  aColor;
      attribute float aPhase;
      uniform float uTime;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vColor = aColor;
        // two beats at incommensurate rates, so a row of lanterns never
        // pulses in lockstep the way a single sine would make it
        vTwinkle = 0.80 + 0.13 * sin(uTime * 1.7 + aPhase * 6.283)
                        + 0.07 * sin(uTime * 0.61 + aPhase * 2.7);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * 190.0 / max(-mv.z, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uBoost;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d) * 2.0;
        if (r > 1.0) discard;
        // hot core, wide soft halo — a lantern seen through cold air
        float core = pow(max(0.0, 1.0 - r), 3.0);
        float halo = pow(max(0.0, 1.0 - r), 1.35) * 0.42;
        gl_FragColor = vec4(vColor * (core + halo) * vTwinkle * uBoost, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
}

/** Allocate a steam plume's buffers. Positions are refreshed every frame. */
export function makeSteamGeometry(count: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute("aLife", new THREE.BufferAttribute(new Float32Array(count), 1));
  // the plume never leaves its own neighbourhood; skip per-frame bounds work
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
  return g;
}

/**
 * Deterministic per-particle jitter for a plume. Returned once at build time
 * so the frame loop stays allocation-free.
 */
export function steamJitter(count: number, seed: number): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    out[i * 3] = r() * 2 - 1;
    out[i * 3 + 1] = r();
    out[i * 3 + 2] = r() * 2 - 1;
  }
  return out;
}

/* ================================================================== */
/* THE MATERIAL BANK                                                   */
/* ================================================================== */

/**
 * One material per surface key, shared by every structure in the park.
 *
 * Rim strength is the dial that matters most here: at dusk, on snow, a pale
 * form dissolves into a pale ground unless something warm traces its
 * silhouette. Set dressing sits around 0.3–0.5; the pieces on the carousel and
 * the brass that catches the last of the sun get more, because those are where
 * a child's eye is meant to land.
 */
export type MatBank = Record<MatKey, ToonMaterial>;

/**
 * Ink weights for the inverted-hull outlines. Keys absent from this map render
 * without a hull — the screen-space Sobel pass still gives them interior
 * creases, and a second draw call per material is a real cost.
 *
 * `honey`, `brass` and the canvases are deliberately absent: bright surfaces
 * separate themselves, and a hull on a DoubleSide canvas smears.
 */
const OUTLINE: Partial<Record<MatKey, number>> = {
  timber: 1.9,
  timberPale: 1.7,
  cream: 1.6,
  teal: 1.6,
  plum: 1.6,
};

function buildMaterials(): MatBank {
  const mk = (o: Parameters<typeof createToonMaterial>[0]): ToonMaterial => {
    const m = createToonMaterial(o);
    // every lit surface must stack into the same banded haze as the valley
    patchMaterialForBandedFog(m);
    return m;
  };

  return {
    timber: mk({ color: PALETTE.walnut, ramp: "wood", map: woodTexture(PALETTE.walnut, 7), rim: 0.5, rimPower: 2.8, bounce: 0.38 }),
    timberPale: mk({ color: PALETTE.walnutLight, ramp: "wood", map: woodTexture(PALETTE.walnutLight, 3), rim: 0.55, rimPower: 2.6, bounce: 0.4 }),
    iron: mk({ color: PALETTE.cocoa, ramp: "soft", rim: 0.62, rimPower: 3.2, bounce: 0.34 }),
    cream: mk({ color: PALETTE.creamPale, ramp: "soft", map: parchmentTexture(5), rim: 0.3, rimPower: 3.4, bounce: 0.3 }),
    teal: mk({ color: PALETTE.tealDeep, ramp: "soft", rim: 0.4, rimPower: 3.2, bounce: 0.28 }),
    plum: mk({ color: PALETTE.plumDeep, ramp: "soft", rim: 0.4, rimPower: 3.2, bounce: 0.3 }),
    honey: mk({ color: PALETTE.honey, ramp: "hero", rim: 0.62, rimPower: 2.6, bounce: 0.18 }),
    brass: mk({ color: PALETTE.honeyDeep, ramp: "hero", rim: 0.8, rimPower: 2.2, bounce: 0.14 }),

    // CANVAS. Three things had to be dialled right back here, because the
    // first pass turned teal-and-plum stripes into sage-and-salmon:
    //   rim   — these are the biggest surfaces in the park and we see them
    //           near edge-on from underneath, which is exactly where a fresnel
    //           rim is strongest. At 0.34 it painted honey over every stripe.
    //   emissive — a lit tent needs a LIFT, not a wash; past ~0.1 the map stops
    //           reading as dyed cloth at all.
    //   colour — leaving it pure white lets the stripe texture blow out under
    //           the toon ramp, so each canvas is tinted to its own dye.
    // DoubleSide throughout: you look through a tent door at its far wall.
    canvasParade: mk({
      color: 0xe8dfd2, ramp: "soft", side: THREE.DoubleSide,
      map: stripeTexture(PALETTE.teal, PALETTE.plum, 24),
      rim: 0.13, rimPower: 4.4, rimColor: 0xf0c48a, bounce: 0.26,
      emissive: PALETTE.honey, emissiveIntensity: 0.03,
    }),
    canvasTent: mk({
      color: 0xf2e6d4, ramp: "soft", side: THREE.DoubleSide,
      map: stripeTexture(PALETTE.plum, PALETTE.creamPale, 24),
      rim: 0.16, rimPower: 4.0, rimColor: PALETTE.lanternCore, bounce: 0.26,
      // THE TENT GLOWS — the lift that makes the big top the brightest thing
      // in the plaza without bleaching its stripes off.
      emissive: PALETTE.lanternCore, emissiveIntensity: 0.11,
    }),
    canvasFair: mk({
      color: 0xf0e6d6, ramp: "soft", side: THREE.DoubleSide,
      map: stripeTexture(PALETTE.honeyDeep, PALETTE.creamPale, 20),
      rim: 0.15, rimPower: 4.2, rimColor: PALETTE.lanternCore, bounce: 0.26,
      emissive: PALETTE.honey, emissiveIntensity: 0.045,
    }),

    snow: mk({ color: PALETTE.snow, ramp: "snow", map: snowTexture(11), rim: 0.32, rimPower: 4.0, bounce: 0.34 }),

    signPaint: mk({
      color: 0xffffff, ramp: "soft", map: signAtlasTexture(), side: THREE.DoubleSide,
      rim: 0.18, rimPower: 3.8, bounce: 0.24,
      emissive: PALETTE.honey, emissiveIntensity: 0.17,
    }),
    // FrontSide on purpose: each fingerboard is a back-to-back PAIR (see
    // "TWO-SIDED PAINTED BOARDS"), so DoubleSide would only add a mirrored
    // ghost behind each.
    signIcons: mk({
      color: 0xffffff, ramp: "soft", map: signpostAtlasTexture(), side: THREE.FrontSide,
      rim: 0.22, rimPower: 3.6, bounce: 0.24,
    }),
    clockFace: mk({
      color: 0xffffff, ramp: "soft", map: clockFaceTexture(), side: THREE.DoubleSide,
      rim: 0.2, rimPower: 3.6, bounce: 0.26,
      emissive: PALETTE.honey, emissiveIntensity: 0.14,
    }),
  };
}

/* ================================================================== */
/* BAKED PARTS → MESHES                                                */
/* ================================================================== */

interface MeshOpts {
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Restrict outlines to these keys. Omit for the default OUTLINE map; pass [] for none. */
  outlineKeys?: MatKey[];
}

/**
 * Attach an inverted-hull outline, pushed along SMOOTHED normals.
 *
 * WHY NOT `addOutline` DIRECTLY: `addOutline` reuses the mesh's own geometry,
 * and everything in this park is boxes, planks and struts merged into one bag.
 * A box's normals are FACE normals — the three vertices at a corner disagree —
 * so the hull push tears the silhouette open at every corner and the ink
 * arrives as a heap of disconnected slabs. Measured: 73% of the timber
 * vertices and 77% of timberPale move when welded, i.e. three quarters of the
 * park's woodwork was outlined wrong.
 *
 * The hull gets its OWN welded copy rather than smoothing in place (the way
 * Gate.tsx does it), so the lit mesh keeps its crisp toon facets — a merged
 * crate with smoothed normals shades like a beanbag.
 */
function inkHull(mesh: THREE.Mesh, thickness: number, fadeStart = 70, fadeEnd = 190): void {
  const hull = new THREE.Mesh(
    smoothNormalsForOutline(mesh.geometry as THREE.BufferGeometry),
    createOutlineMaterial({ thickness, fadeStart, fadeEnd })
  );
  hull.name = "__outline";
  hull.castShadow = false;
  hull.receiveShadow = false;
  hull.renderOrder = (mesh.renderOrder ?? 0) - 1;
  mesh.add(hull);
}

/** One mesh per material, with an ink hull where the OUTLINE policy asks for one. */
function meshesFor(parts: BakedParts, mats: MatBank, opts: MeshOpts = {}): THREE.Mesh[] {
  const { castShadow = true, receiveShadow = true, outlineKeys } = opts;
  const out: THREE.Mesh[] = [];
  (Object.keys(parts) as MatKey[]).forEach((key) => {
    const geo = parts[key];
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, mats[key]);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    const wanted = outlineKeys ? outlineKeys.includes(key) : true;
    const ink = OUTLINE[key];
    if (wanted && ink) inkHull(mesh, ink);
    out.push(mesh);
  });
  return out;
}

/* ================================================================== */
/* THE WORLD BUILD                                                     */
/* ================================================================== */

/**
 * Build every structure exactly once and bake it down to merged geometry.
 *
 * Exported so a scene can reach the same data — plinth positions, the Ferris
 * rig, the train's loop — without re-running the builders. Running them twice
 * would double the geometry AND let the two copies drift apart, which is
 * exactly the bug you cannot see in a screenshot.
 */
export function useLandmarkWorld() {
  return useMemo(() => {
    const parade = buildPieceParade();
    const station = buildTacticsStation();
    const ferris = buildFerrisWheel();
    const train = buildPuzzleTrain();
    const tent = buildBigTop();
    const carousel = buildCarousel();
    const dressing = buildPlazaDressing();

    // EVERYTHING that never moves merges into one set of meshes: the big top's
    // valance and the ticket booth's end up in the same draw call. That is the
    // whole reason this many built structures fit inside the frame budget.
    const still = makeBag();
    absorb(still, parade.parts);
    absorb(still, station.parts);
    absorb(still, ferris.base.parts);
    absorb(still, train.parts);
    absorb(still, tent.parts);
    absorb(still, carousel.base);
    absorb(still, dressing.parts);

    const glows: GlowSpot[] = [
      ...parade.glows, ...station.glows, ...ferris.base.glows,
      ...train.glows, ...tent.glows, ...carousel.glows, ...dressing.glows,
    ];

    // A lookup table for the train loop. The steam trail asks the loop where
    // the funnel was ~60 times a frame; sampling a CatmullRom that often is
    // real work, and the loop never changes, so bake it once.
    const LUT = 384;
    const lut = new Float32Array(LUT * 4);
    for (let i = 0; i < LUT; i++) {
      const p = TRAIN_CURVE.getPointAt(i / LUT);
      const t = TRAIN_CURVE.getTangentAt(i / LUT);
      lut[i * 4] = p.x; lut[i * 4 + 1] = p.y; lut[i * 4 + 2] = p.z;
      lut[i * 4 + 3] = Math.atan2(t.x, t.z);
    }

    return {
      stillParts: bake(still),
      rimParts: bake(ferris.rim),
      spinnerParts: bake(carousel.spinner),
      bobAParts: bake(carousel.bobA),
      bobBParts: bake(carousel.bobB),
      pennantParts: bake(tent.pennants),
      glows,
      ferris, train, tent, carousel, dressing,
      lut, LUT,
    };
  }, []);
}

export type LandmarkWorld = ReturnType<typeof useLandmarkWorld>;

export interface LandmarksProps {
  /**
   * 0 = golden hour, 1 = deep dusk. Drives how hard the practical lights burn.
   * It rebuilds no geometry, so it is safe to animate every frame.
   */
  dusk?: number;
  /**
   * How many of the park's lanterns become REAL pointLights; the rest stay
   * additive sprites. Forward rendering pays for every light on every lit
   * fragment, so this is the single most important perf dial in the file.
   * The brightest lights win — the tent doorway always makes the cut.
   */
  pointLights?: number;
}

/* ================================================================== */
/* THE COMPONENT                                                       */
/* ================================================================== */

/**
 * THE FIVE ATTRACTIONS AND THE FAIR AROUND THEM.
 *
 * Drop `<Landmarks />` into the park scene and you get: the Piece Parade with
 * its striped canopy and six lit plinths, the Tactics station perched on the
 * far hill, the great slow Ferris wheel straddling the coaster, the Puzzle
 * Train running its trestle loop over the ice, the glowing Grand Match Tent at
 * the heart of the plaza, and the carousel, booths, signposts and balloons
 * that make it a fair rather than a diagram.
 *
 * Three things turn on their own clocks — the wheel (62s a revolution), the
 * carousel (26s) and the train (46s a lap). Nothing is synchronised on
 * purpose: a park where everything moves on the same beat looks mechanical,
 * and this one is meant to look alive.
 */
export default function Landmarks({ dusk = 0, pointLights = 9 }: LandmarksProps) {
  const mats = useMemo(() => buildMaterials(), []);
  const world = useLandmarkWorld();

  const stillMeshes = useMemo(() => meshesFor(world.stillParts, mats), [world, mats]);

  /* ---- the handful of lanterns that get to be real lights ---- */
  const lit = useMemo(
    () => [...world.glows]
      .filter((g) => g.intensity > 0)
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, Math.max(0, pointLights)),
    [world, pointLights]
  );

  /* ---- every glow sprite in the park, in one additive draw call ----
   *
   * Held in lazy STATE rather than a memo: its uniforms are written on every
   * frame, and a value handed to useMemo is not ours to mutate. Same reason
   * for the wheel's garland and the tent's two glow planes below. */
  const [glowPoints] = useState(() => {
    const visible = world.glows.filter((g) => g.glow > 0);
    const pts = new THREE.Points(makeGlowGeometry(visible), createGlowPointsMaterial());
    pts.layers.set(NO_INK_LAYER); // never inked — an inked glow is a black square
    pts.frustumCulled = false;
    pts.renderOrder = 4;
    return pts;
  });

  useFrame((s) => {
    const m = glowPoints.material as THREE.ShaderMaterial;
    m.uniforms.uTime.value = s.clock.elapsedTime;
    m.uniforms.uBoost.value = 0.82 + dusk * 0.5;
  });

  return (
    <group name="landmarks">
      {stillMeshes.map((m, i) => <primitive key={`still-${i}`} object={m} />)}

      <EndgameFerrisWheel world={world} mats={mats} />
      <PlazaCarousel world={world} mats={mats} />
      <PuzzleTrainRide world={world} mats={mats} />
      <BigTopCrown world={world} mats={mats} />
      <TentGlow world={world} dusk={dusk} />
      <BalloonBunches world={world} mats={mats} />
      <SmokeCurl origin={world.dressing.candySmoke} seed={9091} count={30} rise={2.2} life={4.6} size={24} />

      <primitive object={glowPoints} />

      {lit.map((g, i) => (
        <pointLight
          key={`lamp-${i}`}
          position={g.pos}
          color={g.color}
          intensity={g.intensity * (0.7 + dusk * 0.55)}
          distance={g.distance}
          decay={2}
        />
      ))}
    </group>
  );
}

/* ================================================================== */
/* 3 · THE GREAT SLOW WHEEL                                            */
/* ================================================================== */

/**
 * The wheel turns once a minute against the horizon, and the gondolas hang
 * upright the whole way round.
 *
 * THE COUNTER-ROTATION: each gondola is a child of the turning rim, so the
 * parent transform carries it round its orbit; setting the gondola's OWN
 * rotation.z to -a cancels the parent's spin exactly, which is what a real
 * gravity-hung car does. A small sine on top of that gives the slow pendulum
 * swing that says "hanging" rather than "bolted on".
 *
 * The eight cars each need an independent pivot, so they are eight meshes —
 * the one place in this file where merging is impossible.
 */
export function EndgameFerrisWheel({ world, mats }: { world: LandmarkWorld; mats: MatBank }) {
  const { ferris, rimParts } = world;
  const rimRef = useRef<THREE.Group>(null);
  const gondolaRefs = useRef<Array<THREE.Group | null>>([]);

  const rimMeshes = useMemo(
    // The wheel is 33 metres across and sits well outside the sun's shadow
    // frustum, so casting from it is pure cost with nothing on screen to show.
    () => meshesFor(rimParts, mats, { castShadow: false, receiveShadow: false, outlineKeys: [] }),
    [rimParts, mats]
  );

  const [rimLights] = useState(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(ferris.rimLights, 3));
    const n = ferris.rimLights.length / 3;
    const size = new Float32Array(n).fill(0.6);
    const col = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      // alternate hot core and honey so the rim reads as a strung garland
      c.set(i % 3 === 0 ? PALETTE.lanternCore : PALETTE.honey);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      phase[i] = (i * 0.37) % 1;
    }
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    g.computeBoundingSphere();
    const pts = new THREE.Points(g, createGlowPointsMaterial());
    pts.layers.set(NO_INK_LAYER);
    return pts;
  });

  const gondolaMeshes = useMemo(
    () => ferris.gondolas.map((g) => {
      const m = new THREE.Mesh(g.geo, mats[g.mat]);
      m.castShadow = false;
      m.receiveShadow = true;
      return m;
    }),
    [ferris, mats]
  );

  useFrame((s) => {
    const a = (s.clock.elapsedTime / ferris.rig.period) * TAU;
    if (rimRef.current) rimRef.current.rotation.z = a;
    (rimLights.material as THREE.ShaderMaterial).uniforms.uTime.value = s.clock.elapsedTime;
    // THE SWING RUNS ON ITS OWN CLOCK, NOT THE WHEEL'S. Driving it off `a`
    // gave the sine the wheel's period — one lazy 62-second lean, which reads
    // as a car bolted on at a slight angle, not as a car hanging. A tub whose
    // pin is 2.9m above its floor swings at 2*pi*sqrt(L/g) ~ 3.4s, so that is
    // the beat; a second slower term keeps it from ticking like a metronome.
    const t = s.clock.elapsedTime;
    for (let i = 0; i < gondolaRefs.current.length; i++) {
      const g = gondolaRefs.current[i];
      if (!g) continue;
      const ph = i * 0.9;
      g.rotation.z = -a
        + Math.sin(t * 1.85 + ph) * 0.038
        + Math.sin(t * 0.47 + ph * 1.7) * 0.022;
    }
  });

  return (
    <group position={ferris.rig.hub} rotation={[0, ferris.rig.yaw, 0]}>
      <group ref={rimRef}>
        {rimMeshes.map((m, i) => <primitive key={`rim-${i}`} object={m} />)}
        <primitive object={rimLights} />
        {ferris.gondolas.map((g, i) => (
          <group
            key={`gondola-${i}`}
            ref={(el: THREE.Group | null) => { gondolaRefs.current[i] = el; }}
            position={[
              Math.cos(g.angle) * (ferris.rig.radius + 0.5),
              Math.sin(g.angle) * (ferris.rig.radius + 0.5),
              0,
            ]}
          >
            <primitive object={gondolaMeshes[i]} />
          </group>
        ))}
      </group>
    </group>
  );
}

/* ================================================================== */
/* PLAZA CAROUSEL                                                      */
/* ================================================================== */

/**
 * The carousel turns, and its chess-piece mounts rise and fall in two rings
 * that are exactly out of phase — the trick a real carousel plays with
 * alternate horses, and the reason the ride reads as a wave going round rather
 * than a platter going up and down. Ring A is cream, ring B walnut, so what
 * goes past is always a light rank up and a dark rank down.
 */
export function PlazaCarousel({ world, mats }: { world: LandmarkWorld; mats: MatBank }) {
  const { carousel, spinnerParts, bobAParts, bobBParts } = world;
  const spinRef = useRef<THREE.Group>(null);
  const aRef = useRef<THREE.Group>(null);
  const bRef = useRef<THREE.Group>(null);

  const spinner = useMemo(
    () => meshesFor(spinnerParts, mats, { outlineKeys: ["cream", "teal"] }),
    [spinnerParts, mats]
  );
  const bobA = useMemo(() => meshesFor(bobAParts, mats), [bobAParts, mats]);
  const bobB = useMemo(() => meshesFor(bobBParts, mats), [bobBParts, mats]);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const a = (t / carousel.period) * TAU;
    if (spinRef.current) spinRef.current.rotation.y = a;
    // three bobs a revolution, so a rider crests three times a lap
    const bob = Math.sin(a * 3);
    if (aRef.current) aRef.current.position.y = bob * 0.3;
    if (bRef.current) bRef.current.position.y = -bob * 0.3;
  });

  return (
    <group position={carousel.center}>
      <group ref={spinRef}>
        {spinner.map((m, i) => <primitive key={`spin-${i}`} object={m} />)}
        <group ref={aRef}>{bobA.map((m, i) => <primitive key={`bobA-${i}`} object={m} />)}</group>
        <group ref={bRef}>{bobB.map((m, i) => <primitive key={`bobB-${i}`} object={m} />)}</group>
      </group>
    </group>
  );
}

/* ================================================================== */
/* 4 · THE PUZZLE TRAIN                                                */
/* ================================================================== */

/**
 * A cheerful engine and three carriages ambling round the trestle loop, a
 * station clock keeping real minutes, and a curl of steam trailing behind.
 *
 * THE STEAM: a puff must come out of where the funnel WAS, not where it is
 * now, or the plume rides along with the engine like a hat. The train's
 * position is an analytic function of time (u = t / period), so we simply ask
 * the loop where the funnel was `age` seconds ago and spawn there — the trail
 * lays itself down along the track for free, and correctly round the curves.
 */
export function PuzzleTrainRide({ world, mats }: { world: LandmarkWorld; mats: MatBank }) {
  const { train, lut, LUT } = world;
  const engineRef = useRef<THREE.Group>(null);
  const carRefs = useRef<Array<THREE.Group | null>>([]);

  const engineMeshes = useMemo(
    () => meshesFor(train.engine, mats, { outlineKeys: ["plum", "cream"] }),
    [train, mats]
  );
  const carriageMeshes = useMemo(
    () => train.carriages.map((c) => {
      const m = new THREE.Mesh(c.geo, mats[c.mat]);
      m.castShadow = true;
      m.receiveShadow = true;
      inkHull(m, 1.6);
      return m;
    }),
    [train, mats]
  );

  /**
   * Sample the baked loop table. Returns the yaw and fills `out` with the
   * position — allocation-free, because this runs ~70 times a frame.
   */
  const poseAt = useMemo(() => (u: number, out: THREE.Vector3): number => {
    const f = (((u % 1) + 1) % 1) * LUT;
    const i = Math.floor(f) % LUT;
    const j = (i + 1) % LUT;
    const k = f - Math.floor(f);
    out.set(
      lut[i * 4] + (lut[j * 4] - lut[i * 4]) * k,
      lut[i * 4 + 1] + (lut[j * 4 + 1] - lut[i * 4 + 1]) * k,
      lut[i * 4 + 2] + (lut[j * 4 + 2] - lut[i * 4 + 2]) * k
    );
    // yaw wraps at ±π; interpolate the short way or the engine spins on its axis
    const a0 = lut[i * 4 + 3];
    let d = lut[j * 4 + 3] - a0;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return a0 + d * k;
  }, [lut, LUT]);

  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((s) => {
    const u = s.clock.elapsedTime / TRAIN_PERIOD;
    if (engineRef.current) {
      engineRef.current.rotation.y = poseAt(u + train.spacing[0], tmp);
      engineRef.current.position.copy(tmp);
    }
    for (let i = 0; i < carRefs.current.length; i++) {
      const g = carRefs.current[i];
      if (!g) continue;
      g.rotation.y = poseAt(u + train.spacing[i + 1], tmp);
      g.position.copy(tmp);
    }
  });

  return (
    <group>
      <group ref={engineRef}>
        {engineMeshes.map((m, i) => <primitive key={`eng-${i}`} object={m} />)}
      </group>

      {carriageMeshes.map((m, i) => (
        <group key={`car-${i}`} ref={(el: THREE.Group | null) => { carRefs.current[i] = el; }}>
          <primitive object={m} />
        </group>
      ))}

      <StationClockHands clock={train.clock} mat={mats.iron} />
      <TrainSteam poseAt={poseAt} funnel={train.funnel} />
    </group>
  );
}

/**
 * The hands on the platform clock, hung a hair in front of the painted dial
 * that faces the platform. They keep REAL time — a minute a minute — because a
 * child who notices the clock has moved is a child who believes the place is
 * running whether or not they are watching.
 */
/** 7:10pm, as a fraction of a full sweep of each hand. */
const START_MIN = 10 / 60;
const START_HOUR = (7 + 10 / 60) / 12;

function StationClockHands({
  clock, mat,
}: {
  clock: LandmarkWorld["train"]["clock"];
  mat: THREE.Material;
}) {
  const hour = useRef<THREE.Mesh>(null);
  const minute = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    // ONE MINUTE PER MINUTE. A minute hand takes an HOUR to go round (3600s)
    // and the hour hand twelve (43200s). Driving them off t/60 and t/720 ran
    // the clock sixty times fast — the minute hand whirled a full revolution
    // every minute, which is the single loudest "this is a mock-up" tell a
    // fairground can have. It starts at ten past seven so the dial reads as a
    // real dusk clock instead of a stopwatch someone just reset.
    if (minute.current) minute.current.rotation.z = -(START_MIN + t / 3600) * TAU;
    if (hour.current) hour.current.rotation.z = -(START_HOUR + t / 43200) * TAU;
  });
  return (
    <group
      position={[
        clock.face[0] + Math.sin(clock.yaw) * 0.2,
        clock.face[1],
        clock.face[2] + Math.cos(clock.yaw) * 0.2,
      ]}
      rotation={[0, clock.yaw, 0]}
    >
      <mesh ref={hour} geometry={clock.hour} material={mat} />
      <mesh ref={minute} geometry={clock.minute} material={mat} />
    </group>
  );
}

/** The plume behind the funnel, laid down along the track the engine has left. */
function TrainSteam({
  poseAt, funnel,
}: {
  poseAt: (u: number, out: THREE.Vector3) => number;
  funnel: [number, number, number];
}) {
  const COUNT = 56;
  const LIFE = 5.2;
  const geo = useMemo(() => makeSteamGeometry(COUNT), []);
  const jitter = useMemo(() => steamJitter(COUNT, 5150), []);
  const mat = useMemo(() => createSteamMaterial({ color: 0xfaf1de, size: 28, opacity: 0.42 }), []);
  const points = useMemo(() => {
    const p = new THREE.Points(geo, mat);
    p.layers.set(NO_INK_LAYER);
    p.frustumCulled = false;
    p.renderOrder = 3;
    return p;
  }, [geo, mat]);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const life = geo.getAttribute("aLife") as THREE.BufferAttribute;
    for (let i = 0; i < COUNT; i++) {
      const age = (((t / LIFE + jitter[i * 3 + 1]) % 1) + 1) % 1;
      // where the funnel was, age*LIFE seconds ago
      const yaw = poseAt((t - age * LIFE) / TRAIN_PERIOD, tmp);
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      const fx = tmp.x + funnel[2] * sn + funnel[0] * c;
      const fy = tmp.y + funnel[1];
      const fz = tmp.z + funnel[2] * c - funnel[0] * sn;
      const spread = 0.18 + age * 1.5;
      pos.setXYZ(i,
        fx + jitter[i * 3] * spread + Math.sin(t * 0.6 + i) * age * 0.35,
        fy + age * 3.1 + age * age * 0.9,
        fz + jitter[i * 3 + 2] * spread + Math.cos(t * 0.5 + i) * age * 0.35);
      life.setX(i, age);
    }
    pos.needsUpdate = true;
    life.needsUpdate = true;
  });

  return <primitive object={points} />;
}

/* ================================================================== */
/* 5 · THE GRAND MATCH TENT                                            */
/* ================================================================== */

/** The crown of pennants at the peak, breathing in the same air as the bunting. */
export function BigTopCrown({ world, mats }: { world: LandmarkWorld; mats: MatBank }) {
  const { tent, pennantParts } = world;
  const ref = useRef<THREE.Group>(null);
  const meshes = useMemo(
    () => meshesFor(pennantParts, mats, { castShadow: false, receiveShadow: false, outlineKeys: [] }),
    [pennantParts, mats]
  );

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    if (!ref.current) return;
    // two slow, incommensurate periods so the sway never visibly repeats
    ref.current.rotation.z = Math.sin(t * 0.53) * 0.045 + Math.sin(t * 0.31) * 0.025;
    ref.current.rotation.x = Math.cos(t * 0.44) * 0.04;
    // A HEADING THAT WANDERS, NOT A TURNTABLE. `t * 0.06` was a constant
    // unidirectional spin — one full revolution every 105 seconds. Wind swings
    // a flag back and forth about a heading; only a motor turns it one way
    // forever, and the eye reads that instantly as a display-stand.
    ref.current.rotation.y = Math.sin(t * 0.17) * 0.5 + Math.sin(t * 0.09) * 0.34;
  });

  return (
    <group position={tent.pennantOrigin}>
      <group ref={ref}>
        {meshes.map((m, i) => <primitive key={`pen-${i}`} object={m} />)}
      </group>
    </group>
  );
}

/**
 * THE LIGHT SPILLING OUT OF THE TENT.
 *
 * Two additive planes on the no-ink layer, both wearing a radial-gradient
 * sprite so they have NO hard edge: one standing in the doorway (the bright
 * mouth) and one lying on the snow in front of it (the pool). Together with
 * the canvas emissive and the doorway pointLight, this is what makes the big
 * top the brightest thing in the plaza — the place the eye goes and the place
 * a child walks toward.
 *
 * The slow flicker matters more than the brightness: a constant plane reads as
 * a decal, a breathing one reads as lantern light.
 */
export function TentGlow({ world, dusk }: { world: LandmarkWorld; dusk: number }) {
  const { tent } = world;

  const [kit] = useState(() => {
    const soft = glowSprite(PALETTE.lanternCore);
    const door = new THREE.MeshBasicMaterial({
      color: PALETTE.lanternCore, map: soft, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      fog: false, toneMapped: false,
    });
    const pool = new THREE.MeshBasicMaterial({
      color: PALETTE.honey, map: soft, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      fog: false, toneMapped: false,
    });
    const d = new THREE.Mesh(tent.doorGlow, door);
    const p = new THREE.Mesh(tent.lightPool, pool);
    for (const m of [d, p]) {
      m.layers.set(NO_INK_LAYER);
      m.renderOrder = 3;
      m.castShadow = false;
      m.receiveShadow = false;
    }
    return { d, p, door, pool };
  });

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const flick = 0.9 + Math.sin(t * 1.9) * 0.05 + Math.sin(t * 4.3) * 0.03;
    const k = 0.75 + dusk * 0.5;
    kit.door.opacity = 0.82 * flick * k;
    kit.pool.opacity = 0.3 * flick * k;
  });

  return (
    <group>
      <primitive object={kit.d} />
      <primitive object={kit.p} />
    </group>
  );
}

/* ================================================================== */
/* BALLOONS                                                            */
/* ================================================================== */

/**
 * Balloons tugging at their strings.
 *
 * Each bunch is two sub-groups pivoting AT THE KNOT, which is what keeps every
 * string attached to the post however far the bunch leans: the strings are
 * straight tubes drawn from the pivot, so rotating the group can never detach
 * them. The two halves lean on different phases, so a bunch jostles against
 * itself the way a real one does instead of swinging as one lump.
 */
export function BalloonBunches({ world, mats }: { world: LandmarkWorld; mats: MatBank }) {
  const bunches = world.dressing.balloonBunches;
  const refs = useRef<Array<THREE.Group | null>>([]);

  const meshes = useMemo(
    () => bunches.map((b, i) => {
      const warm = new THREE.Mesh(b.warm, i % 2 === 0 ? mats.honey : mats.teal);
      const cool = new THREE.Mesh(b.cool, i % 2 === 0 ? mats.plum : mats.cream);
      for (const m of [warm, cool]) {
        m.castShadow = false;
        m.receiveShadow = false;
        // balloons live against the sky; without a hull they lose their edge
        inkHull(m, 1.5, 50, 130);
      }
      return { warm, cool };
    }),
    [bunches, mats]
  );

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    for (let i = 0; i < refs.current.length; i++) {
      const g = refs.current[i];
      if (!g) continue;
      const ph = i * 1.7 + (i % 2) * 0.9;
      // a slow lean plus a faster nod — buoyant, not pendulous
      g.rotation.z = Math.sin(t * 0.62 + ph) * 0.12 + Math.sin(t * 1.31 + ph) * 0.045;
      g.rotation.x = Math.cos(t * 0.51 + ph * 1.3) * 0.11;
      g.rotation.y = Math.sin(t * 0.23 + ph) * 0.3;
    }
  });

  return (
    <group>
      {bunches.map((b, i) => (
        <group key={`bunch-${i}`} position={b.origin}>
          <group ref={(el: THREE.Group | null) => { refs.current[i * 2] = el; }}>
            <primitive object={meshes[i].warm} />
          </group>
          <group ref={(el: THREE.Group | null) => { refs.current[i * 2 + 1] = el; }}>
            <primitive object={meshes[i].cool} />
          </group>
        </group>
      ))}
    </group>
  );
}

/* ================================================================== */
/* A CURL OF SMOKE                                                     */
/* ================================================================== */

export interface SmokeCurlProps {
  origin: [number, number, number];
  seed: number;
  count?: number;
  /** Metres the plume climbs over one puff's life. */
  rise?: number;
  /** Seconds a puff lives. */
  life?: number;
  size?: number;
  color?: number;
}

/**
 * A lazy curl of smoke from a fixed point — the cotton-candy stand's chimney,
 * or anything else warm. Unlike the train's plume this one spirals rather than
 * trails: a slow helix that widens as it climbs, which is what warm air does
 * on a still evening.
 */
export function SmokeCurl({
  origin, seed, count = 30, rise = 2.4, life = 5, size = 26, color = 0xf6ecdc,
}: SmokeCurlProps) {
  const geo = useMemo(() => makeSteamGeometry(count), [count]);
  const jitter = useMemo(() => steamJitter(count, seed), [count, seed]);
  const mat = useMemo(() => createSteamMaterial({ color, size, opacity: 0.34 }), [color, size]);
  const points = useMemo(() => {
    const p = new THREE.Points(geo, mat);
    p.layers.set(NO_INK_LAYER);
    p.frustumCulled = false;
    p.renderOrder = 3;
    return p;
  }, [geo, mat]);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const lf = geo.getAttribute("aLife") as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      const age = (((t / life + jitter[i * 3 + 1]) % 1) + 1) % 1;
      const spin = age * 3.4 + jitter[i * 3] * 3.0;
      const spread = 0.1 + age * 0.85;
      pos.setXYZ(i,
        origin[0] + Math.cos(spin) * spread + jitter[i * 3] * 0.12,
        origin[1] + age * rise + age * age * 0.6,
        origin[2] + Math.sin(spin) * spread + jitter[i * 3 + 2] * 0.12);
      lf.setX(i, age);
    }
    pos.needsUpdate = true;
    lf.needsUpdate = true;
  });

  return <primitive object={points} />;
}
