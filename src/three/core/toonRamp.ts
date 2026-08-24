"use client";

import * as THREE from "three";
import { PALETTE, mix } from "./palette";

/**
 * THE TOON RAMP — the single most important tuning job in the whole look.
 *
 * Every lit surface samples one of these hand-authored gradients through a
 * texture set to NearestFilter, so the steps stay CRISP and never smear into
 * a smooth PBR falloff.
 *
 * Band structure (bottom → top of the ramp = dark → lit):
 *   1. deep shadow, tinted toward plum
 *   2. mid band carrying the local colour
 *   3. warm lit band pushed toward honey
 *   4. a NARROW near-white kiss at the very top
 *
 * The thresholds between bands are set by eye under the actual dusk key.
 * Hero pieces and ChessPaa get 2 shadow bands (crisper, more carved);
 * large soft forms (snowbanks, sky-adjacent) get 3–4 (softer, rounder).
 */

export type RampKind = "hero" | "soft" | "wood" | "snow" | "ice" | "foliage";

/**
 * Band stops as [position 0..1, colour]. Position is where the band BEGINS.
 * Authored deliberately: note how little of the ramp the top kiss occupies —
 * a narrow highlight is what makes a form read as carved rather than shiny.
 */
const RAMPS: Record<RampKind, Array<[number, number]>> = {
  // CRITICAL: MeshToonMaterial MULTIPLIES the ramp against the surface's own
  // colour. So these ramps are LUMINANCE ramps carrying only a whisper of hue
  // — plum-cool in shadow, honey-warm in light. If they carry strong colour,
  // every surface in the park collapses into one monochrome wash. (It did.)

  // Hero — ChessPaa and the chess pieces. Two shadow bands, hard steps,
  // a tight bright kiss so a pale piece stays legible on a pale board.
  hero: [
    [0.0, 0x574a63],  // deep shadow, plum-cool
    [0.34, 0x8e7f88],
    [0.52, 0xc4b3ac], // mid — lets the local colour speak
    [0.78, 0xefe0cb],
    [0.93, 0xfff8ec], // narrow near-white kiss
  ],
  // Soft — big rounded forms. More bands so the steps read as gentle.
  soft: [
    [0.0, 0x5d5070],
    [0.28, 0x7d7186],
    [0.46, 0xa2949a],
    [0.64, 0xc9b8ae],
    [0.82, 0xeddcc6],
    [0.95, 0xfdf4e6],
  ],
  // Wood — warm even in shadow, never muddy.
  wood: [
    [0.0, 0x4c3a44],
    [0.33, 0x7b6357],
    [0.55, 0xab8f75],
    [0.8, 0xdcc3a0],
    [0.94, 0xf7e6c9],
  ],
  // Snow — plush, takes the dusk hard. Lavender shadow, honey top.
  snow: [
    [0.0, 0x7d6f96],
    [0.3, 0xa294ab],
    [0.5, 0xc4b8bc],
    [0.7, 0xe8dbd2],
    [0.88, 0xfff7ea],
  ],
  // Ice — THE one cool passage. Keeps its chill; barely warms at the top.
  ice: [
    [0.0, 0x44586a],
    [0.34, 0x6a8494],
    [0.58, 0x93aab6],
    [0.80, 0xbcd0d8],
    [0.95, 0xdcecf2],
  ],
  // Foliage — near-black pine. Flat cut-paper; almost no highlight at all.
  foliage: [
    [0.0, 0x6e7a70],
    [0.45, 0x9aa48c],
    [0.75, 0xc2c7a6],
    [0.93, 0xe2e0bd],
  ],
};

const cache = new Map<string, THREE.DataTexture>();

/**
 * Build the ramp as a tiny 1-D DataTexture with NearestFilter.
 * Width is deliberately small (32px) — enough to place thresholds precisely,
 * small enough that NEAREST guarantees hard, un-smeared steps.
 */
export function getToonRamp(kind: RampKind = "hero"): THREE.DataTexture {
  const key = kind;
  const hit = cache.get(key);
  if (hit) return hit;

  const W = 32;
  const stops = RAMPS[kind];
  const data = new Uint8Array(W * 4);

  for (let i = 0; i < W; i++) {
    const t = i / (W - 1);
    // Find the band this sample falls in — NO interpolation between bands.
    // That hard selection is the entire point of a toon ramp.
    let colour = stops[0][1];
    for (const [pos, c] of stops) {
      if (t >= pos) colour = c;
    }
    data[i * 4 + 0] = (colour >> 16) & 255;
    data[i * 4 + 1] = (colour >> 8) & 255;
    data[i * 4 + 2] = colour & 255;
    data[i * 4 + 3] = 255;
  }

  const tex = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/**
 * The colour-grading LUT, generated in code (never purchased).
 * A warm, cozy grade: lifts the ambers, deepens the plums in shadow,
 * and unifies every scene into one storybook page.
 *
 * Returned as a 3D texture of size N^3 laid out for LUT lookup.
 */
export function buildWarmLUT(size = 16): THREE.Data3DTexture {
  const data = new Uint8Array(size * size * size * 4);
  let p = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        let R = r / (size - 1);
        let G = g / (size - 1);
        let B = b / (size - 1);

        const lum = R * 0.299 + G * 0.587 + B * 0.114;

        // --- deepen and plum-tint the shadows ---
        const shadowW = Math.pow(1 - lum, 2.0);
        R = mixf(R, R * 0.86 + 0.055, shadowW);
        G = mixf(G, G * 0.78 + 0.028, shadowW);
        B = mixf(B, B * 0.92 + 0.072, shadowW);

        // --- lift the ambers through the midtones ---
        const midW = 1 - Math.abs(lum - 0.5) * 2;
        R = mixf(R, Math.min(1, R * 1.1 + 0.02), midW * 0.55);
        G = mixf(G, Math.min(1, G * 1.03), midW * 0.3);
        B = mixf(B, B * 0.94, midW * 0.45);

        // --- warm, slightly rolled-off highlights (no clinical clipping) ---
        const hiW = Math.pow(lum, 2.2);
        R = mixf(R, Math.min(1, R * 1.02 + 0.012), hiW);
        B = mixf(B, B * 0.97, hiW);

        // gentle S-curve for storybook contrast
        R = sCurve(R); G = sCurve(G); B = sCurve(B);

        data[p++] = Math.round(Math.max(0, Math.min(1, R)) * 255);
        data[p++] = Math.round(Math.max(0, Math.min(1, G)) * 255);
        data[p++] = Math.round(Math.max(0, Math.min(1, B)) * 255);
        data[p++] = 255;
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function mixf(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}
function sCurve(x: number): number {
  // mild contrast lift that protects both ends
  return x * x * (3 - 2 * x) * 0.34 + x * 0.66;
}

/** Sky gradient colours, exposed so the sky shader and fog agree. */
export const SKY = {
  top: new THREE.Color(PALETTE.skyTop),
  mid: new THREE.Color(PALETTE.skyMid),
  horizon: new THREE.Color(PALETTE.skyHorizon),
};
