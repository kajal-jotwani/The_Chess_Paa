"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { PALETTE, mix } from "../core/palette";
import { createToonMaterial, type ToonMaterial } from "../core/materials/ToonMaterial";
import { addOutline, smoothNormalsForOutline } from "../core/materials/OutlineMaterial";
import { patchMaterialForBandedFog } from "../core/materials/SkyMaterial";
import { glowSprite, rng } from "../core/textures/procedural";
import { mergeGeometries } from "../world/terrain";
import { pieceGeometry, type PieceType } from "../core/geometry/pieces";
import { NO_INK_LAYER } from "../core/postfx/effects";
import { Spring } from "./chessPaaRig";

/**
 * THE PIECES ARE CHARACTERS.
 *
 * A chess piece is a turned lump of wood. A child does not fall in love with
 * a turned lump of wood. So every piece in this park has:
 *
 *   - EYES, so it reads as alive from across a room;
 *   - a PERSONALITY IDLE that says who it is before anyone explains the rules
 *     (the knight prances, the bishop glides and bows, the rook plants its
 *     feet, the pawn waddles bravely, the queen is regal, the king is careful);
 *   - a CHEER for a good move and a COMIC SLUMP for a slip. The slump is a
 *     pratfall, never a scolding: it wobbles, it flops wide, it springs back
 *     up. Nothing in this park ever tells a child they are bad at this.
 *
 * Two ways to get a piece out of this file:
 *
 *   <PieceCharacter type="n" />              hero: animated eyes, blinks,
 *                                            sparkles, ~8 draw calls.
 *   facedPieceGeometry("n", "light")         board: eyes BAKED into the mesh
 *                                            with vertex colours, so all
 *                                            thirty-two pieces on a board are
 *                                            still one mesh each.
 *
 * Both share this file's face table and grain, so a pawn on the board and a
 * pawn on a plinth in the Piece Castle are recognisably the same little guy.
 */

const TAU = Math.PI * 2;

/* ================================================================== *
 * TONE — the two sides
 * ================================================================== */

export type PieceTone = "light" | "dark";

/**
 * The body colour of each side.
 *
 * These are deliberately pushed OUTSIDE the two square values rather than
 * matched to them. The board's light squares are cream and its dark squares
 * are walnut; if the pieces used those same two colours — and the first pass
 * did — every dark piece dissolved into every dark square. So the light side
 * is lifted above the lightest square and the dark side dropped below the
 * darkest one, and the fresnel rim covers what is left.
 */
export const TONE_COLOR: Record<PieceTone, number> = {
  // Warm ivory, NOT white: nothing in this park is pure white, and a pure
  // white body blows straight out under the golden key.
  light: /* @__PURE__ */ mix(PALETTE.creamPale, PALETTE.honey, 0.2),
  dark: /* @__PURE__ */ mix(PALETTE.cocoa, PALETTE.ink, 0.18),
};

/**
 * ONE MATERIAL PER SIDE, and the body colour lives in VERTEX COLOURS instead
 * of `material.color`. Two reasons, both load-bearing:
 *
 *   1. it lets the eyes be part of the same mesh (white sclera, dark pupil)
 *      without a second draw call per piece — thirty-two pieces with eyes for
 *      the price of thirty-two pieces;
 *   2. it lets us paint wood GRAIN into the vertices, so a turned piece shows
 *      the streaks of the dowel it was turned from. Perfectly even colour is
 *      what makes cheap 3D chess sets read as plastic.
 *
 * The rim is deliberately ferocious (0.90 / 0.95). A cream piece standing on
 * a cream square is THE failure mode of a 3D chess board, and the warm fresnel
 * is the thing that stops it happening.
 */
const materialCache = new Map<PieceTone, ToonMaterial>();

export function pieceMaterial(tone: PieceTone): ToonMaterial {
  const hit = materialCache.get(tone);
  if (hit) return hit;
  const m = createToonMaterial(
    tone === "light"
      ? {
          color: 0xffffff,
          ramp: "hero",
          // The light side works hardest: it stands on cream squares and has
          // the least value left to separate with. A BROAD rim (low power)
          // wraps honey right around the silhouette rather than leaving a
          // thin line that vanishes at this size.
          rim: 0.82,
          // A pale rim on a pale piece adds nothing, so the light side gets the
          // DEEPER honey — it still separates, without blowing out to white.
          rimColor: PALETTE.honeyDeep,
          rimPower: 2.5,
          bounce: 0.24,
        }
      : {
          color: 0xffffff,
          ramp: "hero",
          rim: 0.95,
          rimColor: PALETTE.honey,
          rimPower: 2.4,
          // The dark side is the one that can go to mud. A big lavender
          // bounce plus a whisper of warm emissive keeps the deepest band off
          // the floor, so a dark piece still has a readable FORM in shadow
          // instead of being a black cut-out.
          bounce: 0.38,
          emissive: PALETTE.walnut,
          emissiveIntensity: 0.12,
        }
  );
  m.vertexColors = true;
  patchMaterialForBandedFog(m);
  materialCache.set(tone, m);
  return m;
}

/* ================================================================== *
 * THE FACE TABLE
 *
 * Hand-placed, not solved. Each eye is positioned so it pokes out of the
 * turned surface by roughly a third of its own radius: any less and it sinks
 * into the wood, any more and it looks stuck on.
 * ================================================================== */

export interface FaceSpec {
  /** Right eye centre, in piece-local space. The left eye mirrors x. */
  eye: [number, number, number];
  /** Sclera radius. */
  r: number;
  /** z of the axis the eye looks out from — the knight's head leans forward. */
  headZ: number;
  /** Who this piece is, in one line. The idle below is built from it. */
  note: string;
}

export const PIECE_FACE: Record<PieceType, FaceSpec> = {
  // Wide-set and low on the round head: the classic brave-little-guy face.
  p: { eye: [0.085, 0.78, 0.178], r: 0.055, headZ: 0, note: "brave, waddling, always going forward" },
  // High on the skull and set back from the muzzle — a horse's eye is on the
  // SIDE of its head, and getting that wrong makes the knight read as a dog.
  n: { eye: [0.135, 1.19, 0.228], r: 0.048, headZ: 0.096, note: "prancing, can't stand still" },
  // Small and close-set under the mitre: serene, a little bit above it all.
  b: { eye: [0.072, 1.16, 0.142], r: 0.046, headZ: 0, note: "glides, bows, never bounces" },
  // Square in the middle of the tower, wide and steady: a doorman.
  r: { eye: [0.105, 0.87, 0.245], r: 0.058, headZ: 0, note: "plants its feet, guards the door" },
  // High and calm, just under the coronet.
  q: { eye: [0.09, 1.185, 0.245], r: 0.05, headZ: 0, note: "regal, unhurried, surveys the room" },
  // Set a touch low so he reads kindly rather than stern.
  k: { eye: [0.1, 1.29, 0.245], r: 0.056, headZ: 0, note: "careful, watchful, a bit worried" },
};

/** Warm off-white — pure white is a hole in the picture, same as pure black. */
const SCLERA = 0xfff4e2;
const PUPIL = /* @__PURE__ */ mix(PALETTE.ink, PALETTE.cocoa, 0.3);
const SPARK = 0xfffdf6;

/** Where an eye sits and which way it faces. */
function eyeFrame(spec: FaceSpec, side: 1 | -1) {
  const c = new THREE.Vector3(spec.eye[0] * side, spec.eye[1], spec.eye[2]);
  const out = new THREE.Vector3(c.x, 0, c.z - spec.headZ);
  if (out.lengthSq() < 1e-8) out.set(0, 0, 1);
  out.normalize();
  // Tip the gaze very slightly upward. A face angled a hair up reads as open
  // and friendly; angled down it reads as sulking. This is the whole trick.
  out.y = 0.16;
  out.normalize();
  return { c, out };
}

/**
 * One eye as a self-contained blob: sclera, pupil, and the catchlight speck
 * that does most of the work of making it look alive.
 *
 * Built AROUND THE ORIGIN so the caller can squash it on Y to blink, or to
 * make the ">.<" face of a comic slump.
 */
function eyeBlob(spec: FaceSpec, side: 1 | -1, quality: "high" | "low"): THREE.BufferGeometry {
  const seg = quality === "high" ? 10 : 6;
  const { out } = eyeFrame(spec, side);
  const r = spec.r;

  const sclera = new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2));
  // Slightly flattened along the gaze so it hugs the head instead of bulging.
  sclera.scale(1, 1, 0.92);

  const pupil = new THREE.SphereGeometry(r * 0.52, Math.max(6, seg - 2), Math.max(4, seg - 4));
  pupil.translate(out.x * r * 0.6, out.y * r * 0.6, out.z * r * 0.6);

  const spark = new THREE.SphereGeometry(r * 0.2, 5, 4);
  // Up and inboard of the pupil — the light in this park comes from a low
  // warm sun ahead and to the left, so that is where the catchlight goes.
  spark.translate(
    out.x * r * 0.82 - side * r * 0.2,
    out.y * r * 0.82 + r * 0.26,
    out.z * r * 0.82
  );

  return mergeTinted([
    { geo: sclera, color: SCLERA },
    { geo: pupil, color: PUPIL },
    { geo: spark, color: SPARK },
  ]);
}

/* ================================================================== *
 * WOOD GRAIN, PAINTED INTO THE VERTICES
 * ================================================================== */

/**
 * A turned piece was cut from a vertical dowel, so its grain shows as slow
 * streaks running UP the piece, not as rings around it.
 *
 * Frequencies are kept low on purpose: the lathe only has 24 segments around,
 * so anything above ~7 cycles aliases into sparkly noise instead of wood.
 */
function grainAt(x: number, y: number, z: number, phase: number): number {
  const a = Math.atan2(z, x);
  const g =
    0.55 * Math.sin(a * 3 + phase) +
    0.3 * Math.sin(a * 7 + y * 1.9 + phase * 1.7) +
    0.18 * Math.sin(y * 9.5 + phase * 0.6);
  // A whisper. Grain should be felt, not counted.
  return 1 + g * 0.06;
}

/**
 * Merge parts, giving each part its own colour, and write the result into a
 * `color` attribute. The shared mergeGeometries() only carries position,
 * normal and uv, so the colours are painted on afterwards by walking the same
 * part boundaries.
 *
 * NOTE: mergeGeometries DISPOSES what it is given. Never hand it a cached
 * geometry — clone first. (This is a real trap: pieceGeometry() is cached.)
 */
function mergeTinted(
  parts: Array<{ geo: THREE.BufferGeometry; color: number | ((x: number, y: number, z: number) => number) }>
): THREE.BufferGeometry {
  const counts = parts.map((p) => p.geo.getAttribute("position").count);
  const merged = mergeGeometries(parts.map((p) => p.geo));
  const pos = merged.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();

  let base = 0;
  for (let pi = 0; pi < parts.length; pi++) {
    const spec = parts[pi].color;
    for (let i = 0; i < counts[pi]; i++) {
      const v = base + i;
      const hex = typeof spec === "number" ? spec : spec(pos.getX(v), pos.getY(v), pos.getZ(v));
      // new THREE.Color(hex) converts sRGB -> the linear working space, which
      // is exactly what a vertex-colour attribute is expected to hold.
      c.setHex(hex);
      col[v * 3] = c.r;
      col[v * 3 + 1] = c.g;
      col[v * 3 + 2] = c.b;
    }
    base += counts[pi];
  }
  merged.setAttribute("color", new THREE.BufferAttribute(col, 3));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** Body colour with the grain multiplied in, clamped to stay in gamut. */
function grainedBody(tone: PieceTone, phase: number) {
  const base = TONE_COLOR[tone];
  const br = (base >> 16) & 255;
  const bg = (base >> 8) & 255;
  const bb = base & 255;
  return (x: number, y: number, z: number) => {
    const g = grainAt(x, y, z, phase);
    const r = Math.min(255, Math.max(0, Math.round(br * g)));
    const gg = Math.min(255, Math.max(0, Math.round(bg * g)));
    const b = Math.min(255, Math.max(0, Math.round(bb * g)));
    return (r << 16) | (gg << 8) | b;
  };
}

/* ================================================================== *
 * GEOMETRY FACTORIES
 * ================================================================== */

export interface PieceGeoPair {
  /** The mesh geometry — original normals, so the carving stays crisp. */
  shade: THREE.BufferGeometry;
  /**
   * The inverted-hull geometry — normals SMOOTHED across hard edges, or the
   * ink splits open at every corner of the rook's crenellations.
   */
  hull: THREE.BufferGeometry;
  /** Top of the piece. Not the same as pieceHeight() for the knight's ears. */
  top: number;
}

const geoCache = new Map<string, PieceGeoPair>();

function finishPair(key: string, shade: THREE.BufferGeometry): PieceGeoPair {
  shade.computeBoundingBox();
  const pair: PieceGeoPair = {
    shade,
    hull: smoothNormalsForOutline(shade),
    top: shade.boundingBox ? shade.boundingBox.max.y : 1,
  };
  geoCache.set(key, pair);
  return pair;
}

/** Deterministic per-type grain phase — the park looks identical every run. */
function grainPhase(type: PieceType, tone: PieceTone): number {
  const seed = type.charCodeAt(0) * 31 + (tone === "light" ? 7 : 91);
  return rng(seed)() * TAU;
}

/** The turned body, grained, no face. Used by the hero <PieceCharacter/>. */
export function pieceBodyGeometry(
  type: PieceType,
  tone: PieceTone,
  quality: "high" | "low" = "high"
): PieceGeoPair {
  const key = `body:${type}:${tone}:${quality}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const body = pieceGeometry(type, quality).clone();
  return finishPair(key, mergeTinted([{ geo: body, color: grainedBody(tone, grainPhase(type, tone)) }]));
}

/**
 * The turned body WITH ITS EYES BAKED IN.
 *
 * This is what a board full of pieces uses. The eyes cannot blink, but they
 * cost nothing, and the inverted hull draws a thin ring of ink around each
 * one for free — which is exactly how you would draw an eye by hand.
 */
export function facedPieceGeometry(
  type: PieceType,
  tone: PieceTone,
  quality: "high" | "low" = "high"
): PieceGeoPair {
  const key = `face:${type}:${tone}:${quality}`;
  const hit = geoCache.get(key);
  if (hit) return hit;

  const spec = PIECE_FACE[type];
  const body = pieceGeometry(type, quality).clone();
  const parts: Array<{ geo: THREE.BufferGeometry; color: number | ((x: number, y: number, z: number) => number) }> = [
    { geo: body, color: grainedBody(tone, grainPhase(type, tone)) },
  ];
  for (const side of [1, -1] as const) {
    const { c } = eyeFrame(spec, side);
    const blob = eyeBlob(spec, side, quality);
    blob.translate(c.x, c.y, c.z);
    // The blob already carries its own colours; re-tinting would flatten the
    // pupil into the sclera, so colour -1 means "keep what you came with".
    parts.push({ geo: blob, color: -1 });
  }
  return finishPair(key, mergeKeepingColors(parts));
}

/**
 * Like mergeTinted, but a part whose colour is -1 keeps the colours it
 * already carries. (The eye blobs are pre-coloured; the body is not.)
 */
function mergeKeepingColors(
  parts: Array<{ geo: THREE.BufferGeometry; color: number | ((x: number, y: number, z: number) => number) }>
): THREE.BufferGeometry {
  const counts = parts.map((p) => p.geo.getAttribute("position").count);
  const existing = parts.map((p) => {
    const a = p.geo.getAttribute("color");
    if (!a) return null;
    const out = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) {
      out[i * 3] = a.getX(i);
      out[i * 3 + 1] = a.getY(i);
      out[i * 3 + 2] = a.getZ(i);
    }
    return out;
  });

  const merged = mergeGeometries(parts.map((p) => p.geo));
  const pos = merged.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();

  let base = 0;
  for (let pi = 0; pi < parts.length; pi++) {
    const spec = parts[pi].color;
    const keep = existing[pi];
    for (let i = 0; i < counts[pi]; i++) {
      const v = base + i;
      if (keep && spec === -1) {
        col[v * 3] = keep[i * 3];
        col[v * 3 + 1] = keep[i * 3 + 1];
        col[v * 3 + 2] = keep[i * 3 + 2];
      } else {
        const hex = typeof spec === "number" ? spec : spec(pos.getX(v), pos.getY(v), pos.getZ(v));
        c.setHex(hex < 0 ? 0xffffff : hex);
        col[v * 3] = c.r;
        col[v * 3 + 1] = c.g;
        col[v * 3 + 2] = c.b;
      }
    }
    base += counts[pi];
  }
  merged.setAttribute("color", new THREE.BufferAttribute(col, 3));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** Top of a piece including everything a lathe could not make (ears, crosses). */
export function pieceTopY(type: PieceType): number {
  return facedPieceGeometry(type, "light").top;
}

/* ================================================================== *
 * THE PERSONALITY IDLES
 *
 * These are pure functions of (type, time, phase) so the board can borrow
 * them at a whisper of their amplitude for its thirty-two pieces, while the
 * hero characters play them full-strength. One source of truth for who each
 * piece IS.
 * ================================================================== */

export interface PiecePose {
  /** Lift above the base, in piece units. */
  y: number;
  /** Lean forward (+) or back (-), radians about X. */
  pitch: number;
  /** Lean sideways, radians about Z. */
  roll: number;
  /** Turn on the spot, radians about Y, added to the base facing. */
  yaw: number;
  /** 1 = neutral. <1 squashes on Y and fattens on XZ, like a real toy. */
  squash: number;
  /** 1 = eyes open, 0 = shut. Blinks and comic squints live here. */
  eye: number;
}

const NEUTRAL: PiecePose = { y: 0, pitch: 0, roll: 0, yaw: 0, squash: 1, eye: 1 };

/** A single smooth 0 -> 1 -> 0 bump, once every `period` seconds. */
function beat(t: number, period: number, phase: number, dur: number): number {
  const local = (t + phase * period) % period;
  if (local > dur) return 0;
  return Math.sin((local / dur) * Math.PI);
}

/**
 * WHO EACH PIECE IS, expressed as motion.
 *
 * The knight cannot stop moving. The bishop never bounces — it floats, and
 * bows. The rook is the only piece that is genuinely STILL, which is what
 * makes it read as sturdy next to five fidgets. The pawn's waddle is a hair
 * too big for its size, because that is what brave looks like.
 */
export function pieceIdle(type: PieceType, t: number, phase = 0): PiecePose {
  const p: PiecePose = { ...NEUTRAL };
  switch (type) {
    case "p": {
      const w = t * 2.3 + phase * TAU;
      p.roll = Math.sin(w) * 0.075;
      p.y = Math.abs(Math.sin(w)) * 0.022;
      p.pitch = -0.03 + Math.sin(w * 2) * 0.012; // chest out
      p.yaw = Math.sin(w * 0.5) * 0.05;
      p.squash = 1 + Math.sin(w * 2) * 0.01;
      // ...and every so often, a little hop of pure enthusiasm.
      const hop = beat(t, 5.5, phase, 0.42);
      p.y += hop * 0.10;
      p.squash -= hop * 0.05;
      break;
    }
    case "n": {
      const w = t * 3.1 + phase * TAU;
      const hoof = Math.max(0, Math.sin(w));
      p.y = hoof * hoof * 0.055;
      p.pitch = -0.1 + Math.sin(w) * 0.1; // head toss
      p.roll = Math.sin(w * 0.5) * 0.05;
      p.yaw = Math.sin(w * 0.37) * 0.1;
      p.squash = 1 - hoof * 0.03;
      // pawing the ground — the tell of a horse that wants to be let go
      const paw = beat(t, 4.3, phase, 0.55);
      p.pitch -= paw * 0.16;
      p.y += paw * 0.02;
      break;
    }
    case "b": {
      const w = t * 1.25 + phase * TAU;
      p.y = 0.03 + Math.sin(w) * 0.03; // floats. never bounces.
      p.roll = Math.sin(w * 0.7) * 0.03;
      p.yaw = Math.sin(w * 0.23) * 0.22; // drifts around like a slow skater
      const bow = beat(t, 6.5, phase, 1.0);
      p.pitch = 0.02 + bow * 0.34;
      p.y -= bow * 0.02;
      break;
    }
    case "r": {
      const w = t * 1.05 + phase * TAU;
      p.squash = 1 + Math.sin(w) * 0.012; // a slow, deep breath
      p.yaw = Math.sin(t * 0.42 + phase * TAU) * 0.3; // scanning the doorway
      const stomp = beat(t, 7.0, phase, 0.45);
      p.y -= stomp * 0.045;
      p.squash -= stomp * 0.085; // plants its feet
      break;
    }
    case "q": {
      const w = t * 0.85 + phase * TAU;
      p.y = 0.012 + Math.sin(w) * 0.012;
      p.roll = Math.sin(w * 0.6) * 0.018;
      p.pitch = -0.045; // chin up, always
      p.yaw = Math.sin(t * 0.28 + phase * TAU) * 0.34; // an unhurried survey
      p.squash = 1 + Math.sin(w) * 0.006;
      break;
    }
    case "k": {
      const w = t * 0.92 + phase * TAU;
      p.y = Math.abs(Math.sin(w * 1.6)) * 0.012; // small careful shifts
      p.roll = Math.sin(w * 1.6) * 0.03;
      p.pitch = 0.035; // leans back a touch: wary, not proud
      p.yaw = Math.sin(t * 0.5 + phase * TAU * 1.3) * 0.26 + Math.sin(t * 0.19) * 0.1;
      p.squash = 1 + Math.sin(w) * 0.008;
      break;
    }
  }
  // Everybody blinks, on their own clock.
  const blink = beat(t, 4.9 + phase * 2.3, phase * 0.7, 0.16);
  p.eye = 1 - blink * 0.94;
  return p;
}

/**
 * SUB-STEP EVERY SPRING.
 *
 * Spring.step() is explicit Euler, which goes unstable once the timestep
 * approaches its natural period: with a 0.06s half-life the velocity term
 * amplifies by 1.8x per frame at dt = 50ms and the value runs away to
 * infinity within a few frames. The visible symptom is characters silently
 * vanishing — they have been flung several light-years off camera — after any
 * hitch: a GC pause, a tab coming back to the foreground, a shader compile.
 *
 * Splitting the frame into steps of at most ~12ms keeps every spring in this
 * file and on the board comfortably inside its stability limit, at a cost of
 * a handful of multiply-adds. Do not remove it.
 */
export function subStep(dt: number, step: (h: number) => void) {
  const n = Math.max(1, Math.min(8, Math.ceil(dt / 0.0125)));
  const h = dt / n;
  for (let i = 0; i < n; i++) step(h);
}

export type PieceState = "idle" | "cheer" | "slump" | "present" | "demo";

/**
 * THE CHEER — one honest jump, with anticipation and a landing.
 *
 * Timing is the whole joke: crouch (0.00-0.12), fly (0.12-0.62), squash on
 * landing (0.62-0.78), wobble back up (0.78-1.00). Skip the crouch and it
 * looks like the piece was fired out of a cannon.
 */
function cheerPose(type: PieceType, u: number, t: number, phase: number): PiecePose {
  const p = pieceIdle(type, t, phase);
  const air = u < 0.12 ? 0 : u < 0.62 ? Math.sin(((u - 0.12) / 0.5) * Math.PI) : 0;
  const crouch = u < 0.12 ? Math.sin((u / 0.12) * Math.PI) : 0;
  const land = u >= 0.62 && u < 0.78 ? Math.sin(((u - 0.62) / 0.16) * Math.PI) : 0;
  const settle = u >= 0.78 ? Math.sin(((u - 0.78) / 0.22) * Math.PI * 2) * (1 - (u - 0.78) / 0.22) : 0;

  p.y += air * 0.6 - crouch * 0.05;
  p.squash *= 1 - crouch * 0.14 + air * 0.1 - land * 0.2 + settle * 0.05;
  // The knight, being a horse, does a whole barrel roll about itself.
  p.yaw += type === "n" ? u * TAU : Math.sin(u * TAU * 1.5) * 0.4;
  p.pitch += Math.sin(u * TAU) * 0.12 - land * 0.1;
  p.roll += Math.sin(u * TAU * 2.0) * 0.06;
  // Eyes wide open and happy for the whole cheer — no blinking through it.
  p.eye = 1 + air * 0.12;
  return p;
}

/**
 * THE SLUMP — a pratfall, never a scolding.
 *
 * It flops WIDE rather than shrinking small, because wide is funny and small
 * is sad; then it wobbles back upright on its own. A child watching this
 * should want to try again, not want to stop.
 */
function slumpPose(type: PieceType, u: number, t: number, phase: number): PiecePose {
  const p = pieceIdle(type, t, phase * 0.4);
  const recoil = u < 0.16 ? Math.sin((u / 0.16) * Math.PI) : 0;
  const melt = u < 0.16 ? 0 : u < 0.55 ? (u - 0.16) / 0.39 : Math.max(0, 1 - (u - 0.55) / 0.45);
  const wobble = u > 0.55 ? Math.sin((u - 0.55) * 26) * (1 - (u - 0.55) / 0.45) : 0;

  p.y += recoil * 0.06 - melt * 0.09;
  p.squash *= 1 - melt * 0.3;              // flat and wide = comic
  p.roll += melt * 0.3 + wobble * 0.1;     // tips over, then rights itself
  p.pitch += melt * 0.18;
  p.yaw += wobble * 0.22;
  p.eye = 1 - melt * 0.84;                 // ">.<"
  return p;
}

/** PRESENT — turning slowly on a plinth, saying "look at me". */
function presentPose(type: PieceType, t: number, phase: number): PiecePose {
  const p = pieceIdle(type, t * 0.6, phase);
  p.yaw = t * 0.55;
  p.y = p.y * 0.5 + 0.06;
  p.roll *= 0.4;
  return p;
}

/** DEMO — near-still, for diagrams. Breathing only, so it is not a corpse. */
function demoPose(type: PieceType, t: number, phase: number): PiecePose {
  const p = pieceIdle(type, t, phase);
  p.y *= 0.25;
  p.pitch *= 0.25;
  p.roll *= 0.25;
  p.yaw *= 0.15;
  p.squash = 1 + (p.squash - 1) * 0.4;
  return p;
}

/** The pose for any state, at time t, `age` seconds into that state. */
export function piecePose(
  type: PieceType,
  state: PieceState,
  t: number,
  age: number,
  phase = 0
): PiecePose {
  switch (state) {
    case "cheer":
      return cheerPose(type, Math.min(1, age / 1.15), t, phase);
    case "slump":
      return slumpPose(type, Math.min(1, age / 1.55), t, phase);
    case "present":
      return presentPose(type, t, phase);
    case "demo":
      return demoPose(type, t, phase);
    default:
      return pieceIdle(type, t, phase);
  }
}

/* ================================================================== *
 * SPARKLES — the little burst of joy on a cheer
 *
 * Exported because the board wants the same fountain for a capture and a
 * promotion: one vocabulary of delight across the whole park.
 * ================================================================== */

/** Scratch for the fade — update() runs every frame of every burst. */
const _sparkColor = /* @__PURE__ */ new THREE.Color();

export class Sparkles {
  readonly points: THREE.Points;
  private readonly mat: THREE.PointsMaterial;
  private readonly base: Float32Array;
  private readonly vel: Float32Array;
  private readonly count: number;
  /** Kept, because the fade below has to tint toward THIS colour, not honey. */
  private readonly tint: THREE.Color;
  private age = 1e9;

  constructor(count: number, seed: number, radius: number, color = PALETTE.lanternCore) {
    const r = rng(seed);
    this.count = count;
    this.tint = new THREE.Color(color);
    this.base = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Deterministic points on a squashed dome — they fountain UP and out.
      const a = r() * TAU;
      const up = 0.45 + r() * 0.75;
      const sp = 0.5 + r() * 0.9;
      this.vel[i * 3] = Math.cos(a) * sp;
      this.vel[i * 3 + 1] = up * 1.7;
      this.vel[i * 3 + 2] = Math.sin(a) * sp;
      this.base[i * 3] = Math.cos(a) * radius * 0.4;
      this.base[i * 3 + 1] = radius * (0.3 + r() * 0.3);
      this.base[i * 3 + 2] = Math.sin(a) * radius * 0.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.mat = new THREE.PointsMaterial({
      map: glowSprite(color),
      size: 0.19,
      transparent: true,
      depthWrite: false,
      // Additive over a warm dusk: the bloom pass finds these and blooms them.
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, this.mat);
    // MUST be on the no-ink layer, or the Sobel pass turns each spark into a
    // little black square. This is a bug we have already shipped once.
    this.points.layers.set(NO_INK_LAYER);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.raycast = () => {};
  }

  burst() {
    this.age = 0;
    this.points.visible = true;
  }

  update(dt: number) {
    if (!this.points.visible) return;
    this.age += dt;
    const life = 1.0;
    if (this.age > life) {
      this.points.visible = false;
      return;
    }
    const u = this.age / life;
    const pos = this.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = this.points.geometry.getAttribute("color") as THREE.BufferAttribute;
    // Additive blending means "fade to black" IS "fade out" — no per-point
    // alpha needed, which PointsMaterial does not support anyway.
    const fade = Math.sin((1 - u) * Math.PI * 0.5) * (1 - u * u);
    // The constructor's `color` used to be honoured by the sprite map but not
    // here, so a teal burst came out teal-times-honey. Same colour, both ends.
    const c = _sparkColor.copy(this.tint).multiplyScalar(fade);
    for (let i = 0; i < this.count; i++) {
      const t = this.age;
      pos.setXYZ(
        i,
        this.base[i * 3] + this.vel[i * 3] * t * 0.6,
        this.base[i * 3 + 1] + this.vel[i * 3 + 1] * t * 0.6 - 1.6 * t * t,
        this.base[i * 3 + 2] + this.vel[i * 3 + 2] * t * 0.6
      );
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.mat.size = 0.19 * (0.5 + fade);
  }

  dispose() {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

/* ================================================================== *
 * THE COMIC SWEAT DROP
 * ================================================================== */

/** A single fat anime tear-drop. Appears on a slump, wobbles, pops. */
function sweatDrop(): THREE.Mesh {
  const ball = new THREE.SphereGeometry(0.075, 9, 7);
  const tip = new THREE.ConeGeometry(0.072, 0.13, 9);
  tip.translate(0, 0.088, 0);
  const geo = mergeTinted([
    { geo: ball, color: PALETTE.icePale },
    { geo: tip, color: PALETTE.icePale },
  ]);
  const mat = createToonMaterial({
    color: 0xffffff,
    ramp: "ice",
    rim: 0.85,
    rimPower: 2.2,
    rimColor: 0xdff3ff,
    bounce: 0.1,
    transparent: true,
    opacity: 0.92,
  });
  mat.vertexColors = true;
  const m = new THREE.Mesh(geo, mat);
  m.visible = false;
  m.raycast = () => {};
  return m;
}

/* ================================================================== *
 * THE HERO CHARACTER
 * ================================================================== */

export interface PieceCharacterProps {
  type: PieceType;
  /** Which side's wood. Defaults to the cream side. */
  color?: PieceTone;
  state?: PieceState;
  position?: [number, number, number];
  scale?: number;
  /**
   * Where to look, in radians about Y, relative to the piece's own forward
   * (+Z). Positive turns to the piece's left. Clamped to about +/-1.1 rad:
   * the eyes take most of it and the body takes the rest, so the character
   * turns to look at you rather than snapping its whole self around.
   */
  look?: number;
  /** Ink weight. Set 0 for no outline (e.g. inside a tiny UI thumbnail). */
  outline?: number;
  /** Show the joy-sparkles on a cheer. */
  sparkles?: boolean;
  /** Deterministic idle offset so a row of pawns is not a chorus line. */
  seed?: number;
  /** Cast/receive shadows. Off inside menus. */
  shadows?: boolean;
}

interface CharRig {
  group: THREE.Group;
  body: THREE.Mesh;
  face: THREE.Group;
  eyes: THREE.Mesh[];
  sparkles: Sparkles;
  drop: THREE.Mesh;
  springs: { y: Spring; pitch: Spring; roll: Spring; yaw: Spring; squash: Spring; eye: Spring; look: Spring };
  phase: number;
  top: number;
  dispose(): void;
}

function buildCharRig(
  type: PieceType,
  tone: PieceTone,
  outline: number,
  wantSparkles: boolean,
  seed: number,
  shadows: boolean
): CharRig {
  const group = new THREE.Group();
  group.name = `piece-character-${type}-${tone}`;

  // Hero pieces get the plain body: their eyes are separate meshes so they
  // can blink, squint and swivel.
  const pair = pieceBodyGeometry(type, tone, "high");
  const body = new THREE.Mesh(pair.shade, pieceMaterial(tone));
  body.castShadow = shadows;
  body.receiveShadow = shadows;
  if (outline > 0) {
    const ink = addOutline(body, { thickness: outline, fadeStart: 40, fadeEnd: 120 });
    // The hull needs the SMOOTHED normals or the ink tears open at the rook's
    // crenellations and the knight's muzzle.
    ink.geometry = pair.hull;
  }
  group.add(body);

  const spec = PIECE_FACE[type];
  // The face group's origin sits on the head's own axis, so swivelling it on
  // Y sweeps the eyes AROUND the head instead of sliding them off it.
  const face = new THREE.Group();
  face.position.set(0, 0, spec.headZ);
  group.add(face);

  const eyes: THREE.Mesh[] = [];
  const eyeMat = pieceMaterial(tone);
  for (const side of [1, -1] as const) {
    const { c } = eyeFrame(spec, side);
    const geo = eyeBlob(spec, side, "high");
    const m = new THREE.Mesh(geo, eyeMat);
    m.position.set(c.x, c.y, c.z - spec.headZ);
    m.castShadow = false;
    m.receiveShadow = false;
    m.raycast = () => {};
    face.add(m);
    eyes.push(m);
  }

  const sparkles = new Sparkles(wantSparkles ? 16 : 0, seed * 977 + 13, pair.top);
  sparkles.points.position.y = pair.top * 0.55;
  group.add(sparkles.points);

  const drop = sweatDrop();
  drop.position.set(spec.eye[0] * 2.1, spec.eye[1] + spec.r * 2.6, spec.eye[2] * 0.6);
  group.add(drop);

  return {
    group,
    body,
    face,
    eyes,
    sparkles,
    drop,
    springs: {
      // Short half-lives: long enough to kill pops on a state change, short
      // enough that the crisp beats of a cheer survive intact.
      y: new Spring(0, 0.06),
      pitch: new Spring(0, 0.08),
      roll: new Spring(0, 0.08),
      yaw: new Spring(0, 0.09),
      squash: new Spring(1, 0.06),
      eye: new Spring(1, 0.045),
      look: new Spring(0, 0.16),
    },
    phase: rng(seed * 7919 + 3)(),
    top: pair.top,
    dispose() {
      sparkles.dispose();
      (drop.material as THREE.Material).dispose();
      drop.geometry.dispose();
      for (const e of eyes) e.geometry.dispose();
    },
  };
}

/**
 * A single chess piece, alive.
 *
 * Drop it anywhere: a plinth in the Piece Castle, a shelf in the gate house,
 * a card in a menu. It is self-contained and does not know the board exists.
 */
export default function PieceCharacter({
  type,
  color = "light",
  state = "idle",
  position = [0, 0, 0],
  scale = 1,
  look = 0,
  outline = 2.6,
  sparkles = true,
  seed = 0,
  shadows = true,
}: PieceCharacterProps) {
  const rig = useMemo(
    () => buildCharRig(type, color, outline, sparkles, seed + type.charCodeAt(0) * 13, shadows),
    [type, color, outline, sparkles, seed, shadows]
  );
  useEffect(() => () => rig.dispose(), [rig]);

  // Age of the current state, so cheer/slump can play as one-shots.
  const stateRef = useRef({ state, since: -1 });

  useFrame((frame, dtRaw) => {
    const t = frame.clock.elapsedTime;
    // A tab that has been in the background hands back an enormous dt; a
    // half-second cap keeps springs from exploding on return.
    const dt = Math.min(0.05, dtRaw);

    const s = stateRef.current;
    if (s.state !== state || s.since < 0) {
      s.state = state;
      s.since = t;
      if (state === "cheer") rig.sparkles.burst();
    }
    const age = t - s.since;

    const pose = piecePose(type, state, t, age, rig.phase);
    const sp = rig.springs;
    sp.y.to(pose.y);
    sp.pitch.to(pose.pitch);
    sp.roll.to(pose.roll);
    sp.yaw.to(pose.yaw);
    sp.squash.to(pose.squash);
    sp.eye.to(pose.eye);
    sp.look.to(Math.max(-1.1, Math.min(1.1, look)));
    subStep(dt, (h) => {
      sp.y.step(h);
      sp.pitch.step(h);
      sp.roll.step(h);
      sp.yaw.step(h);
      sp.squash.step(h);
      sp.eye.step(h);
      sp.look.step(h);
    });

    const g = rig.group;
    g.position.y = sp.y.value;
    g.rotation.set(sp.pitch.value, sp.yaw.value + sp.look.value * 0.35, sp.roll.value);

    // Volume-preserving squash: what goes down must go WIDE. Skipping the xz
    // compensation is what makes cheap animation look like a scaling bug.
    const sq = Math.max(0.35, sp.squash.value);
    const wide = 1 / Math.sqrt(sq);
    g.scale.set(wide, sq, wide);

    // The eyes take the larger share of the look, so the character glances at
    // you before it turns.
    rig.face.rotation.y = sp.look.value * 0.65;
    const lid = Math.max(0.02, sp.eye.value);
    for (const e of rig.eyes) e.scale.set(1, lid, 1);

    // The sweat drop only exists during a slump, and it bobs.
    const slumping = state === "slump" && age > 0.25 && age < 1.5;
    rig.drop.visible = slumping;
    if (slumping) {
      const u = (age - 0.25) / 1.25;
      rig.drop.scale.setScalar(Math.sin(Math.min(1, u * 3) * Math.PI * 0.5) * (1 - u * 0.35));
      rig.drop.position.y = PIECE_FACE[type].eye[1] + PIECE_FACE[type].r * 2.6 - u * 0.18;
      rig.drop.rotation.z = Math.sin(age * 9) * 0.18;
    }

    rig.sparkles.update(dt);
  });

  // The rig's own transform is animated every frame, so the placement props
  // live on a WRAPPER group. Putting them on the rig would have React stamp
  // the prop back over the animation on every re-render.
  return (
    <group position={position} scale={scale}>
      <primitive object={rig.group} />
    </group>
  );
}

/**
 * A whole cast, for the Piece Castle: six characters in a row, each doing its
 * own thing. Exported because "show me all of them" turns out to be the first
 * thing everyone wants.
 */
export function PieceLineup({
  types = ["p", "n", "b", "r", "q", "k"] as PieceType[],
  color = "light" as PieceTone,
  spacing = 1.6,
  state = "idle" as PieceState,
  position = [0, 0, 0] as [number, number, number],
  scale = 1,
}) {
  const half = ((types.length - 1) * spacing) / 2;
  return (
    <group position={position} scale={scale}>
      {types.map((t, i) => (
        <PieceCharacter key={`${t}-${i}`} type={t} color={color} state={state} seed={i * 17 + 1} position={[i * spacing - half, 0, 0]} />
      ))}
    </group>
  );
}
