/**
 * ChessPaa's Wonderland — THE COMMITTED PALETTE.
 *
 * Every colour in the park comes from here. Ice, wood, forest, sky, UI.
 * If a surface reads cold, clinical, flat-plastic or default-grey, it is
 * not using this file correctly.
 *
 * Colours are authored as hex ints so they drop straight into three.js.
 */

export const PALETTE = {
  /** The sun and every warm light: lanterns, fairy-lights, ChessPaa's glow. */
  honey: 0xf4b24a,
  honeyDeep: 0xe89a3c,
  /** Lantern core — the warmest point on screen. */
  lanternCore: 0xffd27a,

  /** Parchment, signage, light board squares. */
  cream: 0xf3e4c6,
  creamPale: 0xfaf1de,

  /** All the toy-wood: ride frames, jetty planks, dark board squares. */
  walnut: 0x6e4326,
  cocoa: 0x53321c,
  walnutLight: 0x8b5a37,

  /** The carnival accent pair — bunting, booths, awnings, gondolas. */
  teal: 0x2fa69a,
  tealDeep: 0x1f7d74,
  plum: 0x9c3f72,
  plumDeep: 0x74294f,

  /** Reserved almost entirely for ChessPaa. */
  scarfRed: 0xc6402f,

  /** The pine wall that frames the valley — flat cut-paper in the haze. */
  forest: 0x1b2a20,
  forestMid: 0x27392c,

  /** The one cool passage in the park. Used sparingly so the chill registers. */
  ice: 0x4d8ea6,
  icePale: 0x9fcede,
  waterTeal: 0x2f6b7d,
  waterDeep: 0x2d5f6d,

  /** Snow is never white — it takes the dusk. */
  snow: 0xf6ecdc,
  snowShadow: 0xc9bcd0,

  /** Outline ink. NEVER pure black — pure black is a hole in the picture. */
  ink: 0x2e1e28,

  /** Sky: lavender crown grading to peach horizon. */
  skyTop: 0x6c5c8a,
  skyHorizon: 0xe8a97e,
  skyMid: 0xa87f8b,

  /** Cool lavender bounce — shadows are coloured, never grey. */
  fillLavender: 0x8b7aa8,

  /** Banded fog picks up the honey haze. */
  fogNear: 0xdcb69d,
  fogFar: 0xdfa98c,
} as const;

/** Convenience: palette entries as CSS strings for canvas-2D texture painting. */
export function css(hex: number): string {
  return "#" + hex.toString(16).padStart(6, "0");
}

/** Mix two palette ints in linear-ish space. t=0 → a, t=1 → b. */
export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Push a colour toward plum for shadow bands. */
export function towardShadow(hex: number, amount = 0.4): number {
  return mix(hex, 0x3a2740, amount);
}

/** Push a colour toward honey for lit bands. */
export function towardLight(hex: number, amount = 0.35): number {
  return mix(hex, PALETTE.honey, amount);
}
