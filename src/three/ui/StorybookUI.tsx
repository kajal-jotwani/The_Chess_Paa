"use client";

/**
 * THE STORYBOOK SKIN.
 *
 * Every piece of interface in ChessPaa's Wonderland is built from these
 * primitives, and they exist so that the UI reads as PART OF THE PARK rather
 * than a browser window someone left open on top of it.
 *
 * The rules this file enforces, so no screen can quietly break them:
 *
 *   • NO HARD RECTANGLES. Every corner radius here is asymmetric — hand-cut
 *     paper and hand-sawn wood, never a CSS box.
 *   • NO THIN GREY SYSTEM TYPE. One rounded storybook stack, weight 700+, in
 *     warm ink. Grey is not in the palette and never will be.
 *   • THE SURFACES ARE THE PARK'S OWN. The wood on these buttons is literally
 *     `woodTexture()` — the same canvas the ride frames and the jetty planks
 *     are painted with — lifted into CSS as a data URI. The cards are
 *     `parchmentTexture()`, the same parchment as the signage. Nothing is
 *     downloaded; nothing is a stock gradient pretending to be wood.
 *   • A BUTTON IS A CHUNK OF WOOD. It stands on a visible slab of its own
 *     end-grain, and pressing it drives it down onto that slab with a little
 *     overshoot. That physical give is the whole feeling.
 *   • KID-SAFE BY CONSTRUCTION. No primitive here accepts an `href`. There is
 *     no way to express "leave the park" with these components.
 *
 * Public surface is at the bottom of each section. Everything is a plain DOM
 * overlay — mount it as a sibling of the R3F <Canvas>, not inside it.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { PALETTE, css, mix } from "@/three/core/palette";
import { rng, woodTexture, parchmentTexture, stripeTexture } from "@/three/core/textures/procedural";
import { TOUCH, useReducedMotion, narrate, markPath, type Mark } from "@/lib/a11y";

/* ==================================================================== */
/* TOKENS — the numbers the whole interface agrees on                    */
/* ==================================================================== */

/**
 * The interface's own small vocabulary. Colours all come from PALETTE; the
 * radii and shadows are here because they are the difference between "a
 * storybook" and "a settings dialog".
 */
export const UI = {
  ink: css(PALETTE.ink),
  inkSoft: css(mix(PALETTE.ink, PALETTE.plum, 0.35)),
  cream: css(PALETTE.creamPale),
  parchment: css(PALETTE.cream),
  wood: css(PALETTE.walnut),
  woodLight: css(PALETTE.walnutLight),
  woodDark: css(PALETTE.cocoa),
  honey: css(PALETTE.honey),
  honeyDeep: css(PALETTE.honeyDeep),
  lantern: css(PALETTE.lanternCore),
  teal: css(PALETTE.teal),
  tealDeep: css(PALETTE.tealDeep),
  plum: css(PALETTE.plum),
  plumDeep: css(PALETTE.plumDeep),
  scarf: css(PALETTE.scarfRed),

  /**
   * Hand-cut paper: never the same radius twice around one shape.
   *
   * The asymmetry has to be LARGE to register — a 22/26 pair reads as a
   * rounded rectangle with a rendering bug. Roughly 2:1 between the widest
   * and tightest corner is where the eye starts calling it hand-cut.
   */
  radiusCard: "36px 18px 32px 22px / 22px 34px 18px 34px",
  radiusPanel: "44px 24px 40px 28px / 28px 42px 24px 44px",
  radiusButton: "30px 14px 26px 18px / 18px 28px 14px 30px",

  /** Warm shadows. A grey drop shadow is a hole punched in the dusk. */
  shadowSoft: "0 10px 26px rgba(46,30,40,0.30), 0 2px 6px rgba(46,30,40,0.20)",
  shadowLift: "0 20px 44px rgba(46,30,40,0.38), 0 4px 10px rgba(46,30,40,0.24)",

  /** Type stack. Defers to the app's --font-park when it exists. */
  font:
    'var(--font-park, "Baloo 2", "Chalkboard SE", "Comic Sans MS", "Comic Neue", "Marker Felt", ui-rounded, "SF Pro Rounded", system-ui, sans-serif)',
} as const;

export type ButtonTone = "wood" | "honey" | "teal" | "plum" | "cream" | "quiet";

/* ==================================================================== */
/* PAINTED SURFACES — the park's own canvas textures, lifted into CSS    */
/* ==================================================================== */

/**
 * We publish each texture ONCE as a CSS custom property on :root rather than
 * inlining the data URI per element.
 *
 * WHY: a 256px painted-wood PNG is ~50KB of base64. Inlining that on every
 * button would put a megabyte of duplicate string into the DOM and make React
 * diff it on every render. One variable, many references, one decode.
 */
const SURFACE_STYLE_ID = "cp-storybook-surfaces";

function canvasOf(tex: { image: unknown }): HTMLCanvasElement | null {
  const img = tex.image;
  // CanvasTexture keeps the source canvas on .image; three types it as `any`.
  return img && typeof (img as HTMLCanvasElement).toDataURL === "function"
    ? (img as HTMLCanvasElement)
    : null;
}

let surfacesInstalled = false;

/**
 * Paint the park's textures into CSS variables. Idempotent, client-only.
 * Fails silently — every component below has a gradient fallback underneath,
 * so a browser that refuses `toDataURL` still gets a warm wooden button.
 */
function installParkSurfaces(): void {
  if (surfacesInstalled || typeof document === "undefined") return;
  surfacesInstalled = true;
  try {
    // `--cp-wood` is deliberately the LIGHT walnut, not the dark one. Painted
    // wood at button size needs to stay well clear of the ink outline, and the
    // dark walnut plus an ink rim collapses into one black lump — which is
    // exactly what the first captured frames showed.
    const wood = canvasOf(woodTexture(PALETTE.walnutLight, 7));
    const woodDeep = canvasOf(woodTexture(PALETTE.walnut, 19));
    const woodHoney = canvasOf(woodTexture(PALETTE.honey, 23));
    const parchment = canvasOf(parchmentTexture(5));
    const canopy = canvasOf(stripeTexture(PALETTE.teal, PALETTE.creamPale, 8, 2));
    const canopyWarm = canvasOf(stripeTexture(PALETTE.plum, PALETTE.creamPale, 8, 4));
    if (!wood || !parchment) return;

    const decl = [
      `--cp-wood:url(${wood.toDataURL("image/png")})`,
      woodDeep ? `--cp-wood-deep:url(${woodDeep.toDataURL("image/png")})` : "",
      woodHoney ? `--cp-wood-honey:url(${woodHoney.toDataURL("image/png")})` : "",
      `--cp-parchment:url(${parchment.toDataURL("image/png")})`,
      canopy ? `--cp-canopy:url(${canopy.toDataURL("image/png")})` : "",
      canopyWarm ? `--cp-canopy-warm:url(${canopyWarm.toDataURL("image/png")})` : "",
    ].filter(Boolean).join(";");

    const el = document.createElement("style");
    el.id = SURFACE_STYLE_ID;
    el.textContent = `:root{${decl}}`;
    document.head.appendChild(el);
  } catch {
    /* Tainted canvas or no 2D context: fall through to the gradients. */
  }
}

/* ==================================================================== */
/* THE STYLESHEET                                                        */
/* ==================================================================== */

const STYLE_ID = "cp-storybook-skin";

/**
 * One sheet, built from PALETTE at module load so there is exactly one place
 * a colour can come from. Class prefix `cp-` throughout.
 */
const SKIN_CSS = `
.cp-root, .cp-root * { box-sizing: border-box; }
.cp-root {
  font-family: ${UI.font};
  color: ${UI.ink};
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}

/* Focus is a warm lantern halo, never a blue browser ring. It must be
   obvious from across a living room.

   TWO THINGS THIS RULE HAS TO GET RIGHT, and the first pass got both wrong:

   1. ".cp-root :focus-visible" alone is a DESCENDANT selector, and every
      primitive below puts "cp-root" on ITSELF. So the rule matched nothing on
      an ordinary <WoodButton> and Chrome fell back to its own 1px hairline —
      measured, on the park's primary control. Hence the ".cp-root:focus-visible"
      half of the pair.
   2. It is an OUTLINE, not a box-shadow. A box-shadow here replaces the
      button's box-shadow, and the button's box-shadow IS the chunk of wood —
      the carved rim, the end-grain slab, the shadow it casts. Focusing a
      button must not flatten it into a sticker. An outline follows
      border-radius, so the halo still hugs the hand-cut corners, and the fat
      ink rim every primitive already carries supplies the dark inner ring. */
.cp-root:focus-visible, .cp-root :focus-visible {
  outline: 4px solid ${css(PALETTE.lanternCore)};
  outline-offset: 3px;
}

.cp-sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
}

/* ---------------- hand-lettered headings ---------------- */
.cp-head {
  margin: 0;
  font-weight: 800;
  letter-spacing: 0.012em;
  line-height: 1.05;
  /* Ink relief: a soft dark edge under the letters plus a warm bounce above,
     so type sits ON the page instead of floating over the 3D scene. */
  text-shadow:
    0 2px 0 rgba(46,30,40,0.30),
    0 4px 10px rgba(46,30,40,0.28),
    0 -1px 0 rgba(255,232,190,0.45);
}
.cp-head-letter {
  display: inline-block;
  transform-origin: 50% 85%;
  will-change: transform;
}
.cp-head-space { display: inline-block; width: 0.32em; }
.cp-head-sm { font-size: 20px; } .cp-head-md { font-size: 28px; }
.cp-head-lg { font-size: 40px; } .cp-head-xl { font-size: 58px; }
@media (max-width: 640px) {
  .cp-head-lg { font-size: 32px; } .cp-head-xl { font-size: 40px; }
}

/* ---------------- the wooden button ---------------- */
.cp-btn {
  position: relative;
  display: inline-flex; align-items: center; justify-content: center; gap: 12px;
  border: 0; margin: 0;
  padding: 14px 26px;
  min-height: ${TOUCH.min}px; min-width: ${TOUCH.min}px;
  border-radius: ${UI.radiusButton};
  font-family: inherit; font-weight: 800; font-size: 20px; line-height: 1.1;
  cursor: pointer;
  /* Two layers: a warm top-light / shadow-foot wash OVER the painted grain.
     NOT multiply — multiplying walnut grain by a walnut ground crushes the
     whole button into an unlit lump with no visible grain at all. */
  background-color: ${UI.woodLight};
  background-image:
    linear-gradient(rgba(255,236,198,0.22), rgba(255,236,198,0.02) 42%, rgba(46,30,40,0.24)),
    var(--cp-wood, linear-gradient(${UI.woodLight}, ${UI.wood}));
  background-size: auto, 170px 170px;
  color: ${UI.cream};
  text-shadow: 0 2px 0 rgba(46,30,40,0.6), 0 0 10px rgba(46,30,40,0.35);
  /* The chunk: a carved rim (inset), the slab of end-grain it stands on
     (the 7px solid), and the warm shadow it casts on the park. */
  box-shadow:
    inset 0 3px 0 rgba(255,232,190,0.34),
    inset 0 -4px 0 rgba(46,30,40,0.34),
    inset 0 0 0 3px rgba(46,30,40,0.55),
    0 7px 0 ${css(PALETTE.cocoa)},
    0 12px 22px rgba(46,30,40,0.34);
  transform: translateZ(0);
  transition:
    transform 110ms cubic-bezier(.2,.9,.3,1.5),
    box-shadow 110ms ease-out,
    filter 140ms ease-out;
  touch-action: manipulation;
  user-select: none;
}
.cp-btn:hover:not(:disabled) { filter: brightness(1.06) saturate(1.04); }
/* THE PRESS: it descends onto its own slab. 7px of travel is exaggerated on
   purpose — a small child needs to SEE that the toy moved. */
.cp-btn[data-pressed="1"]:not(:disabled) {
  transform: translateY(6px) scale(0.985);
  box-shadow:
    inset 0 3px 0 rgba(255,232,190,0.20),
    inset 0 -2px 0 rgba(46,30,40,0.40),
    inset 0 0 0 3px rgba(46,30,40,0.62),
    0 1px 0 ${css(PALETTE.cocoa)},
    0 3px 8px rgba(46,30,40,0.34);
  filter: brightness(1.10);
}
.cp-btn[data-released="1"]:not(:disabled) { animation: cp-wobble 260ms ease-out; }
.cp-btn:disabled { cursor: default; filter: saturate(0.7) brightness(0.94); opacity: 0.75; }

.cp-btn-honey {
  background-color: ${UI.honey};
  background-image:
    linear-gradient(rgba(255,246,224,0.5), rgba(255,246,224,0.04) 46%, rgba(160,96,32,0.22)),
    var(--cp-wood-honey, linear-gradient(${UI.lantern}, ${UI.honeyDeep}));
  background-size: auto, 170px 170px;
  color: ${UI.ink}; text-shadow: 0 1px 0 rgba(255,240,210,0.7);
  box-shadow:
    inset 0 3px 0 rgba(255,246,224,0.66),
    inset 0 -4px 0 rgba(160,96,32,0.34),
    inset 0 0 0 3px rgba(46,30,40,0.48),
    0 7px 0 ${css(PALETTE.honeyDeep)},
    0 12px 26px rgba(200,120,40,0.40);
}
.cp-btn-honey[data-pressed="1"]:not(:disabled) {
  box-shadow:
    inset 0 3px 0 rgba(255,246,224,0.40),
    inset 0 -2px 0 rgba(160,96,32,0.40),
    inset 0 0 0 3px rgba(46,30,40,0.55),
    0 1px 0 ${css(PALETTE.honeyDeep)}, 0 3px 8px rgba(200,120,40,0.34);
}
/* Painted wood, not plastic: the grain shows THROUGH the paint. soft-light
   keeps the hue while letting the grain modulate it — a plain multiply turns
   a teal button into a brown one, which is what the first pass did. */
.cp-btn-teal, .cp-btn-plum {
  background-image:
    linear-gradient(rgba(255,246,224,0.26), rgba(46,30,40,0.24)),
    var(--cp-wood, none);
  background-size: auto, 170px 170px;
  background-blend-mode: normal, soft-light;
}
.cp-btn-teal { background-color: ${UI.teal}; box-shadow:
    inset 0 3px 0 rgba(214,246,240,0.42), inset 0 -4px 0 rgba(12,60,56,0.34),
    inset 0 0 0 3px rgba(46,30,40,0.52), 0 7px 0 ${UI.tealDeep}, 0 12px 24px rgba(20,80,76,0.38); }
.cp-btn-teal[data-pressed="1"]:not(:disabled) { box-shadow:
    inset 0 3px 0 rgba(214,246,240,0.28), inset 0 -2px 0 rgba(12,60,56,0.40),
    inset 0 0 0 3px rgba(46,30,40,0.58), 0 1px 0 ${UI.tealDeep}, 0 3px 8px rgba(20,80,76,0.34); }
.cp-btn-plum { background-color: ${UI.plum}; box-shadow:
    inset 0 3px 0 rgba(246,214,234,0.36), inset 0 -4px 0 rgba(56,16,38,0.36),
    inset 0 0 0 3px rgba(46,30,40,0.52), 0 7px 0 ${UI.plumDeep}, 0 12px 24px rgba(74,26,54,0.38); }
.cp-btn-plum[data-pressed="1"]:not(:disabled) { box-shadow:
    inset 0 3px 0 rgba(246,214,234,0.24), inset 0 -2px 0 rgba(56,16,38,0.42),
    inset 0 0 0 3px rgba(46,30,40,0.58), 0 1px 0 ${UI.plumDeep}, 0 3px 8px rgba(74,26,54,0.34); }
/* PARCHMENT, WASHED.
   The raw parchment canvas is painted with strong brown blotches so it reads
   as aged paper across a whole 3D signboard. At UI scale, un-washed, those
   blotches read as MOULD. Every parchment surface therefore gets the same
   treatment: a big tile (so the blotch scale is bigger than the card) under a
   warm cream wash (so it reads as warm paper, not damp paper). */
.cp-btn-cream {
  background-color: ${UI.parchment};
  background-image:
    linear-gradient(rgba(252,244,228,0.76), rgba(244,178,74,0.12)),
    var(--cp-parchment, linear-gradient(${UI.cream}, ${UI.parchment}));
  background-size: auto, 150% 150%;
  background-position: center, center;
  color: ${UI.ink}; text-shadow: 0 1px 0 rgba(255,246,224,0.8);
  box-shadow:
    inset 0 3px 0 rgba(255,252,240,0.8), inset 0 -4px 0 rgba(140,96,60,0.26),
    inset 0 0 0 3px rgba(46,30,40,0.42), 0 7px 0 ${css(mix(PALETTE.cream, PALETTE.walnut, 0.45))},
    0 12px 24px rgba(46,30,40,0.28);
}
.cp-btn-cream[data-pressed="1"]:not(:disabled) { box-shadow:
    inset 0 3px 0 rgba(255,252,240,0.5), inset 0 -2px 0 rgba(140,96,60,0.30),
    inset 0 0 0 3px rgba(46,30,40,0.5),
    0 1px 0 ${css(mix(PALETTE.cream, PALETTE.walnut, 0.45))}, 0 3px 8px rgba(46,30,40,0.26); }
/* "quiet" is for the small, always-available escapes (close, hide). Still
   wooden, still warm — just not shouting. */
.cp-btn-quiet {
  padding: 10px 16px; font-size: 17px;
  background-color: ${css(mix(PALETTE.walnutLight, PALETTE.cream, 0.30))};
  background-image:
    linear-gradient(rgba(255,236,198,0.26), rgba(46,30,40,0.18)),
    var(--cp-wood, none);
  background-size: auto, 150px 150px;
  color: ${UI.cream};
  box-shadow:
    inset 0 2px 0 rgba(255,232,190,0.26), inset 0 0 0 2px rgba(46,30,40,0.46),
    0 4px 0 ${css(PALETTE.cocoa)}, 0 8px 16px rgba(46,30,40,0.28);
}
.cp-btn-quiet[data-pressed="1"]:not(:disabled) { transform: translateY(3px) scale(0.99); box-shadow:
    inset 0 2px 0 rgba(255,232,190,0.18), inset 0 0 0 2px rgba(46,30,40,0.5),
    0 1px 0 ${css(PALETTE.cocoa)}, 0 2px 6px rgba(46,30,40,0.26); }

.cp-btn-comfy { min-height: ${TOUCH.comfy}px; font-size: 22px; padding: 16px 30px; }
.cp-btn-hero  { min-height: ${TOUCH.hero}px;  font-size: 27px; padding: 20px 40px; border-radius: 30px 36px 28px 34px / 34px 28px 36px 30px; }
.cp-btn-wide  { width: 100%; }
.cp-btn-icon  { display: inline-flex; align-items: center; font-size: 1.15em; line-height: 1; }

/* ---------------- ticket stub ---------------- */
.cp-ticket {
  position: relative;
  display: inline-flex; align-items: center; gap: 14px;
  padding: 16px 30px 16px 26px;
  min-height: ${TOUCH.comfy}px;
  background-color: ${UI.parchment};
  background-image:
    linear-gradient(rgba(252,244,228,0.60), rgba(244,178,74,0.16)),
    var(--cp-parchment, linear-gradient(${UI.cream}, ${UI.parchment}));
  background-size: auto, 150% 150%;
  background-position: center, center;
  color: ${UI.ink};
  font-family: inherit; font-weight: 800; font-size: 20px;
  border: 0; border-radius: 14px 6px 12px 8px;
  /* The two bites out of the sides are what makes it a TICKET and not a card.
     Unsupported mask-composite degrades to an un-notched stub, never a break. */
  -webkit-mask-image:
    radial-gradient(circle 13px at 0% 50%, transparent 96%, #000 100%),
    radial-gradient(circle 13px at 100% 50%, transparent 96%, #000 100%);
  -webkit-mask-composite: source-in;
  mask-image:
    radial-gradient(circle 13px at 0% 50%, transparent 96%, #000 100%),
    radial-gradient(circle 13px at 100% 50%, transparent 96%, #000 100%);
  mask-composite: intersect;
  filter: drop-shadow(0 8px 16px rgba(46,30,40,0.34));
  cursor: pointer; touch-action: manipulation; user-select: none;
  transition: transform 120ms cubic-bezier(.2,.9,.3,1.5), filter 140ms ease-out;
}
.cp-ticket[data-pressed="1"] { transform: translateY(4px) rotate(-0.6deg) scale(0.99); filter: drop-shadow(0 3px 7px rgba(46,30,40,0.34)); }
.cp-ticket-static { cursor: default; }
/* The perforation the grandfather tears along. */
.cp-ticket-perf {
  position: absolute; top: 12px; bottom: 12px; left: 62px; width: 0;
  border-left: 3px dashed ${css(mix(PALETTE.walnut, PALETTE.cream, 0.42))};
  opacity: 0.85; pointer-events: none;
}
.cp-ticket-serial {
  font-size: 13px; letter-spacing: 0.16em; font-weight: 700;
  color: ${css(mix(PALETTE.walnut, PALETTE.cream, 0.25))};
  writing-mode: vertical-rl; transform: rotate(180deg);
}
.cp-ticket-edge {
  position: absolute; inset: 3px; border-radius: 8px 12px 10px 8px;
  border: 2px solid ${css(mix(PALETTE.walnut, PALETTE.cream, 0.55))};
  opacity: 0.55; pointer-events: none;
}

/* ---------------- parchment card ---------------- */
.cp-card {
  position: relative;
  background-color: ${UI.parchment};
  background-image:
    linear-gradient(rgba(252,244,228,0.76), rgba(244,178,74,0.12)),
    var(--cp-parchment, linear-gradient(${UI.cream}, ${UI.parchment}));
  /* 150%, the same tile the cream button uses, and for the same reason. At
     116% the parchment canvas's edge vignette landed INSIDE the card and its
     blotches sat at page scale — so ChessPaa's speech card, the surface a
     child looks at more than any other, read as a damp, stained page next to
     a cream button that read as clean paper. Same texture, same wash; the
     only thing that differed was the tile. */
  background-size: auto, 150% 150%;
  background-position: center, center;
  color: ${UI.ink};
  border-radius: ${UI.radiusCard};
  box-shadow:
    inset 0 0 0 3px rgba(46,30,40,0.34),
    inset 0 3px 0 rgba(255,252,240,0.7),
    ${UI.shadowSoft};
  padding: 20px 24px;
}
.cp-card-pad-lg { padding: 28px 32px; }
.cp-card-lift { box-shadow: inset 0 0 0 3px rgba(46,30,40,0.34), inset 0 3px 0 rgba(255,252,240,0.7), ${UI.shadowLift}; }
/* A warm halo behind the card so cream type never dissolves into a cream
   snowfield. This is the single most important legibility trick in the UI. */
.cp-card::after {
  content: ""; position: absolute; inset: -26px; z-index: -1;
  border-radius: inherit;
  background: radial-gradient(closest-side, rgba(46,30,40,0.52), rgba(46,30,40,0.22) 62%, rgba(46,30,40,0));
  pointer-events: none;
}

/* ---------------- wooden sign ---------------- */
.cp-sign {
  position: relative; display: inline-block;
  padding: 18px 30px;
  background-color: ${UI.woodLight};
  background-image:
    linear-gradient(rgba(255,236,198,0.24), rgba(255,236,198,0.02) 44%, rgba(46,30,40,0.26)),
    var(--cp-wood, linear-gradient(${UI.woodLight}, ${UI.wood}));
  background-size: auto, 190px 190px;
  color: ${UI.cream};
  border-radius: 26px 12px 22px 16px / 16px 24px 12px 26px;
  box-shadow:
    inset 0 0 0 4px rgba(46,30,40,0.55),
    inset 0 4px 0 rgba(255,232,190,0.26),
    inset 0 -6px 0 rgba(46,30,40,0.34),
    0 14px 26px rgba(46,30,40,0.36);
  transform-origin: 50% -26px;
}
.cp-sign-sway { animation: cp-sway 5.2s ease-in-out infinite; }
/* Two brass screws — the detail that says "someone hung this". */
.cp-sign-screw {
  position: absolute; top: 10px; width: 11px; height: 11px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, ${UI.lantern}, ${css(PALETTE.honeyDeep)} 60%, ${css(PALETTE.cocoa)});
  box-shadow: inset 0 -1px 0 rgba(46,30,40,0.6), 0 1px 2px rgba(46,30,40,0.5);
}
.cp-sign-screw-l { left: 12px; } .cp-sign-screw-r { right: 12px; }
/* The rope it hangs from. */
.cp-sign-rope {
  position: absolute; top: -26px; width: 4px; height: 28px;
  background: linear-gradient(${css(PALETTE.honeyDeep)}, ${css(PALETTE.walnutLight)});
  border-radius: 2px; box-shadow: 0 0 0 1px rgba(46,30,40,0.45);
}
.cp-sign-rope-l { left: 22px; transform: rotate(9deg); }
.cp-sign-rope-r { right: 22px; transform: rotate(-9deg); }

/* ---------------- carousel panel ---------------- */
.cp-carousel {
  position: relative;
  background-color: ${UI.parchment};
  background-image:
    linear-gradient(rgba(252,244,228,0.78), rgba(244,178,74,0.11)),
    var(--cp-parchment, linear-gradient(${UI.cream}, ${UI.parchment}));
  background-size: auto, 112% 112%;
  background-position: center, center;
  border-radius: ${UI.radiusPanel};
  box-shadow: inset 0 0 0 4px rgba(46,30,40,0.38), ${UI.shadowLift};
  padding: 74px 40px 34px;
  color: ${UI.ink};
}
/* The striped canopy: real stripeTexture when it has loaded, a painted
   fallback when it has not. */
.cp-carousel-canopy {
  position: absolute; left: -10px; right: -10px; top: -18px; height: 92px;
  background-color: ${UI.teal};
  background-image: var(--cp-canopy, repeating-linear-gradient(90deg, ${UI.teal} 0 26px, ${UI.cream} 26px 52px));
  background-size: 208px 100%;
  border-radius: 46px 46px 8px 8px;
  box-shadow: inset 0 -5px 0 rgba(46,30,40,0.30), inset 0 0 0 3px rgba(46,30,40,0.45), 0 10px 20px rgba(46,30,40,0.30);
}
/* Scalloped hem — the fairground detail that stops it reading as a header bar. */
.cp-carousel-hem {
  position: absolute; left: -10px; right: -10px; top: 66px; height: 26px;
  background: radial-gradient(circle 14px at 14px 0, ${UI.cream} 96%, transparent 100%) repeat-x;
  background-size: 28px 26px;
  filter: drop-shadow(0 3px 3px rgba(46,30,40,0.30));
}
.cp-carousel-post {
  position: absolute; top: 44px; bottom: 22px; width: 16px;
  border-radius: 8px;
  background: repeating-linear-gradient(150deg, ${UI.cream} 0 9px, ${UI.scarf} 9px 18px);
  box-shadow: inset 0 0 0 2px rgba(46,30,40,0.42), 0 3px 8px rgba(46,30,40,0.30);
}
.cp-carousel-post-l { left: 12px; } .cp-carousel-post-r { right: 12px; }
/* The title sits ON a little wooden plaque nailed to the canopy.
   Cream lettering straight onto cream stripes is unreadable — which is
   exactly how the first pass rendered, and why the plaque exists. */
.cp-carousel-title {
  position: absolute; top: 12px; left: 50%;
  transform: translateX(-50%) rotate(-1.2deg);
  z-index: 3; pointer-events: none; white-space: nowrap;
  padding: 8px 24px;
  background-color: ${css(PALETTE.cocoa)};
  background-image:
    linear-gradient(rgba(255,236,198,0.20), rgba(46,30,40,0.28)),
    var(--cp-wood-deep, none);
  background-size: auto, 160px 160px;
  border-radius: 24px 10px 20px 14px / 14px 22px 10px 24px;
  box-shadow: inset 0 0 0 3px rgba(46,30,40,0.6), 0 7px 14px rgba(46,30,40,0.42);
  color: ${UI.cream};
}

/* ---------------- ribbon ---------------- */
.cp-ribbon {
  display: inline-block; padding: 9px 26px;
  background: ${UI.scarf}; color: ${UI.cream};
  font-weight: 800; font-size: 18px;
  text-shadow: 0 2px 0 rgba(46,30,40,0.42);
  clip-path: polygon(0 0, 100% 0, calc(100% - 16px) 50%, 100% 100%, 0 100%, 16px 50%);
  box-shadow: 0 6px 14px rgba(46,30,40,0.34);
}
.cp-ribbon-honey { background: ${UI.honeyDeep}; color: ${UI.ink}; text-shadow: 0 1px 0 rgba(255,246,224,0.6); }
.cp-ribbon-teal  { background: ${UI.tealDeep}; }

/* ---------------- scrim ---------------- */
/* Honey-tinted, never grey: the park dims like a theatre at dusk. */
.cp-scrim {
  position: fixed; inset: 0; z-index: 40;
  background:
    radial-gradient(circle at 50% 46%, rgba(244,178,74,0.10), rgba(46,30,40,0.30) 46%, rgba(46,30,40,0.62) 100%);
  backdrop-filter: blur(2.5px) saturate(1.05);
  -webkit-backdrop-filter: blur(2.5px) saturate(1.05);
  display: grid; place-items: center;
  animation: cp-fade-in 260ms ease-out;
}

/* ---------------- painted icon ---------------- */
.cp-icon { display: inline-block; vertical-align: middle; overflow: visible; }
.cp-icon-twinkle { animation: cp-twinkle 2.6s ease-in-out infinite; transform-origin: 50% 50%; }

/* ---------------- painted press (a picture that is a button) ------- */
.cp-press {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  background: none; border: 0; padding: 0; margin: 0;
  min-width: ${TOUCH.min}px; min-height: ${TOUCH.min}px;
  cursor: pointer; touch-action: manipulation; user-select: none;
  font-family: inherit; color: inherit;
  transition: transform 130ms cubic-bezier(.2,.9,.3,1.5), filter 160ms ease-out;
}
.cp-press:hover:not(:disabled) { transform: translateY(-3px) scale(1.045); filter: brightness(1.07); }
.cp-press[data-pressed="1"]:not(:disabled) { transform: translateY(2px) scale(0.965); }
.cp-press:disabled { cursor: default; }

/* ---------------- motion ---------------- */
@keyframes cp-wobble {
  0%   { transform: translateY(6px) scale(0.985) rotate(0deg); }
  45%  { transform: translateY(-2px) scale(1.012) rotate(-0.7deg); }
  75%  { transform: translateY(1px) scale(0.998) rotate(0.4deg); }
  100% { transform: translateY(0) scale(1) rotate(0deg); }
}
@keyframes cp-sway {
  0%, 100% { transform: rotate(-1.5deg); }
  50%      { transform: rotate(1.5deg); }
}
@keyframes cp-twinkle {
  0%, 100% { transform: scale(1) rotate(0deg); opacity: 0.95; }
  50%      { transform: scale(1.18) rotate(18deg); opacity: 1; }
}
@keyframes cp-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes cp-pop-in {
  0%   { transform: scale(0.86) rotate(-2.2deg); opacity: 0; }
  60%  { transform: scale(1.035) rotate(0.7deg); opacity: 1; }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
.cp-pop { animation: cp-pop-in 380ms cubic-bezier(.2,.9,.3,1.4) both; }

/* CALM MODE.
   Reduced motion means calmer, NEVER plainer: every colour, every painted
   edge and every warm shadow stays exactly as it is. We only stop things
   travelling, swinging, typing and twinkling. */
@media (prefers-reduced-motion: reduce) {
  .cp-root *, .cp-root *::before, .cp-root *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
  }
  .cp-sign-sway, .cp-icon-twinkle { animation: none !important; }
}
`;

/**
 * Install a stylesheet once, by id. Client-only, idempotent, safe to call from
 * a render path. The other UI modules build on this so each surface can carry
 * its own CSS without a bundler-level CSS-modules setup.
 */
export function ensureStyleSheet(id: string, cssText: string): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = cssText;
  document.head.appendChild(el);
}

let skinInstalled = false;

/** Idempotently install the storybook stylesheet. Client-only, safe to spam. */
export function ensureStorybookSkin(): void {
  if (typeof document === "undefined") return;
  if (!skinInstalled && !document.getElementById(STYLE_ID)) {
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = SKIN_CSS;
    document.head.appendChild(el);
  }
  skinInstalled = true;
  installParkSurfaces();
}

/**
 * Every primitive calls this, so a lone <WoodButton> works anywhere without
 * the caller remembering to mount a provider. Styles land in an effect, which
 * keeps server and client markup identical (no hydration mismatch).
 */
export function useStorybookSkin(): void {
  useEffect(() => { ensureStorybookSkin(); }, []);
}

/**
 * Optional explicit mount point, for a screen that wants the skin installed
 * before its own first paint. Renders nothing.
 */
export function StorybookStyles(): null {
  useStorybookSkin();
  return null;
}

/* ==================================================================== */
/* HAND-LETTERED HEADING                                                 */
/* ==================================================================== */

export type HeadingSize = "sm" | "md" | "lg" | "xl";

export interface StorybookHeadingProps {
  /** Plain text. Letters are laid out individually, so no markup here. */
  children: string;
  size?: HeadingSize;
  /** Ink colour. Defaults to warm ink; pass UI.cream over wood. */
  color?: string;
  /** Changes the hand. Same seed → same wobble, every run, forever. */
  seed?: number;
  as?: "h1" | "h2" | "h3" | "div" | "span";
  className?: string;
  style?: CSSProperties;
}

/**
 * A heading that looks hand-lettered without a hand-lettered webfont.
 *
 * WHY letter-by-letter: we are forbidden from downloading a font (and a
 * downloaded font would break offline play), so the only warmth available is
 * in the LAYOUT. Each letter gets a deterministic rotation, a baseline hop and
 * a hair of scale from `rng(seed)` — the exact irregularity a person's hand
 * produces and a text renderer never does. Deterministic, so a heading never
 * reshuffles between renders or between runs of the screenshot harness.
 *
 * The spans are aria-hidden and the real string is repeated once in a
 * visually-hidden span, so a screen reader hears a word instead of spelling it
 * out letter by letter.
 *
 * WHY a hidden span and not `aria-label`: `as` defaults to "div", and a bare
 * <div aria-label="..."> has no role that can carry a name — the label is
 * dropped and the heading goes completely silent. Text in the flow works for
 * every tag this component can render.
 */
export function StorybookHeading({
  children, size = "lg", color, seed = 41, as = "div", className = "", style,
}: StorybookHeadingProps) {
  useStorybookSkin();
  const letters = useMemo(() => {
    const r = rng(seed + children.length * 17);
    return Array.from(children).map((ch, i) => ({
      ch,
      key: `${i}-${ch}`,
      // ±2.6° of tilt, ±1.6px of baseline hop, ±3% of size.
      rot: (r() - 0.5) * 5.2,
      dy: (r() - 0.5) * 3.2,
      scale: 0.97 + r() * 0.06,
    }));
  }, [children, seed]);

  const Tag = as;
  return (
    <Tag
      className={`cp-root cp-head cp-head-${size} ${className}`}
      style={color ? { color, ...style } : style}
    >
      <span className="cp-sr">{children}</span>
      {letters.map((l) =>
        l.ch === " " ? (
          <span key={l.key} className="cp-head-space" aria-hidden="true" />
        ) : (
          <span
            key={l.key}
            className="cp-head-letter"
            aria-hidden="true"
            style={{ transform: `rotate(${l.rot.toFixed(2)}deg) translateY(${l.dy.toFixed(2)}px) scale(${l.scale.toFixed(3)})` }}
          >
            {l.ch}
          </span>
        )
      )}
    </Tag>
  );
}

/* ==================================================================== */
/* PRESS BEHAVIOUR — shared by every control                             */
/* ==================================================================== */

/**
 * Pointer-driven press state.
 *
 * WHY not just `:active`: on touch, `:active` is unreliable (iOS needs a
 * touch listener to fire it at all, and it sticks after a scroll). A child's
 * finger must make the wood move on contact, every single time — that
 * immediacy is most of what makes a toy feel real.
 */
function usePressState(disabled: boolean) {
  const [pressed, setPressed] = useState(false);
  const [released, setReleased] = useState(false);
  const releaseTimer = useRef<number | null>(null);

  // The updater below must stay PURE — React re-runs updaters in StrictMode,
  // and firing a rAF plus a timeout from inside one schedules the wobble twice
  // and leaks the first timer. So the "was it down?" answer comes from a ref.
  const isDown = useRef(false);

  const down = useCallback(() => {
    if (disabled) return;
    isDown.current = true;
    setPressed(true);
  }, [disabled]);

  const up = useCallback(() => {
    const was = isDown.current;
    isDown.current = false;
    setPressed(false);
    if (!was || disabled) return;
    // Retrigger the wobble even on a rapid second press.
    setReleased(false);
    if (releaseTimer.current) window.clearTimeout(releaseTimer.current);
    window.requestAnimationFrame(() => setReleased(true));
    releaseTimer.current = window.setTimeout(() => setReleased(false), 300);
  }, [disabled]);

  const cancel = useCallback(() => { isDown.current = false; setPressed(false); }, []);

  useEffect(() => () => { if (releaseTimer.current) window.clearTimeout(releaseTimer.current); }, []);

  return {
    pressed, released, down, up,
    handlers: {
      onPointerDown: down,
      onPointerUp: up,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
    },
  };
}

/* ==================================================================== */
/* WOODEN BUTTON                                                         */
/* ==================================================================== */

export interface WoodButtonProps {
  children: ReactNode;
  /**
   * What happens when a child presses it.
   *
   * There is deliberately NO `href`. A button in this park cannot navigate
   * anywhere the park did not build — see `KID_SAFE` in `lib/a11y`.
   */
  onPress: () => void;
  tone?: ButtonTone;
  size?: "min" | "comfy" | "hero";
  /** A painted glyph or <PaintedIcon> to sit before the label. */
  icon?: ReactNode;
  disabled?: boolean;
  wide?: boolean;
  /** Spoken/assistive label when the visible label is not enough on its own. */
  label?: string;
  /**
   * Read the label aloud on press, for pre-readers. `true` speaks `label` (or
   * the text of `children` when that is a plain string); a string speaks that.
   */
  speak?: boolean | string;
  className?: string;
  style?: CSSProperties;
  /** Standard button type; defaults to "button" so it never submits a form. */
  type?: "button";
  autoFocus?: boolean;
}

/**
 * The warm wooden button. This is the park's primary control and it is
 * deliberately chunky, loud and obvious.
 */
export function WoodButton({
  children, onPress, tone = "wood", size = "min", icon, disabled = false,
  wide = false, label, speak, className = "", style, autoFocus,
}: WoodButtonProps) {
  useStorybookSkin();
  const { pressed, released, handlers } = usePressState(disabled);

  const handleClick = useCallback(() => {
    if (disabled) return;
    if (speak) {
      const line = typeof speak === "string"
        ? speak
        : label ?? (typeof children === "string" ? children : "");
      if (line) narrate(line);
    }
    onPress();
  }, [disabled, speak, label, children, onPress]);

  return (
    <button
      type="button"
      className={`cp-root cp-btn cp-btn-${tone}${size !== "min" ? ` cp-btn-${size}` : ""}${wide ? " cp-btn-wide" : ""} ${className}`}
      data-pressed={pressed ? "1" : "0"}
      data-released={released ? "1" : "0"}
      onClick={handleClick}
      disabled={disabled}
      aria-label={label}
      autoFocus={autoFocus}
      style={style}
      {...handlers}
    >
      {icon ? <span className="cp-btn-icon" aria-hidden="true">{icon}</span> : null}
      <span>{children}</span>
    </button>
  );
}

/* ==================================================================== */
/* TICKET STUB                                                           */
/* ==================================================================== */

export interface TicketStubProps {
  children: ReactNode;
  /** The little vertical number printed down the torn end. */
  serial?: string;
  /** Pressable when given; a plain keepsake when not. */
  onPress?: () => void;
  /** Degrees of tilt. A ticket in a pocket is never square to the world. */
  tilt?: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * A carnival ticket stub — the motif for anything earned, spent or handed
 * over. Notched sides, a torn perforation, a serial down the stub end.
 */
export function TicketStub({
  children, serial = "No. 8", onPress, tilt = -1.6, label, className = "", style,
}: TicketStubProps) {
  useStorybookSkin();
  const { pressed, handlers } = usePressState(false);
  const common = {
    className: `cp-root cp-ticket${onPress ? "" : " cp-ticket-static"} ${className}`,
    style: { transform: `rotate(${tilt}deg)`, ...style } as CSSProperties,
  };
  const inner = (
    <>
      <span className="cp-ticket-edge" aria-hidden="true" />
      <span className="cp-ticket-serial" aria-hidden="true">{serial}</span>
      <span className="cp-ticket-perf" aria-hidden="true" />
      <span style={{ paddingLeft: 22, display: "inline-flex", alignItems: "center", gap: 10 }}>{children}</span>
    </>
  );

  if (!onPress) return <div {...common} aria-label={label}>{inner}</div>;
  return (
    <button
      type="button"
      {...common}
      data-pressed={pressed ? "1" : "0"}
      onClick={onPress}
      aria-label={label}
      {...handlers}
    >
      {inner}
    </button>
  );
}

/* ==================================================================== */
/* PARCHMENT CARD                                                        */
/* ==================================================================== */

export interface ParchmentCardProps {
  children: ReactNode;
  /** Extra roomy padding for a card that carries a heading. */
  roomy?: boolean;
  /** Sit further off the page — for anything that must beat a busy 3D scene. */
  lifted?: boolean;
  /** Degrees. A page pinned by hand is never perfectly straight. */
  tilt?: number;
  /** Play the little pop-in. Ignored under reduced motion. */
  animateIn?: boolean;
  role?: string;
  ariaLabel?: string;
  ariaLive?: "off" | "polite" | "assertive";
  className?: string;
  style?: CSSProperties;
}

/**
 * Warm parchment, hand-cut edges, and — crucially — a soft dark halo behind
 * it. Cream type on a cream snowfield is the single easiest way to lose a
 * child, so every card carries its own contrast with it.
 */
export function ParchmentCard({
  children, roomy = false, lifted = false, tilt = 0, animateIn = false,
  role, ariaLabel, ariaLive, className = "", style,
}: ParchmentCardProps) {
  useStorybookSkin();
  const reduced = useReducedMotion();
  return (
    <div
      className={`cp-root cp-card${roomy ? " cp-card-pad-lg" : ""}${lifted ? " cp-card-lift" : ""}${animateIn && !reduced ? " cp-pop" : ""} ${className}`}
      style={tilt ? { transform: `rotate(${tilt}deg)`, ...style } : style}
      role={role}
      aria-label={ariaLabel}
      aria-live={ariaLive}
    >
      {children}
    </div>
  );
}

/* ==================================================================== */
/* WOODEN SIGN                                                           */
/* ==================================================================== */

export interface WoodSignProps {
  children: ReactNode;
  /** Hang it from two little ropes and let it breathe in the dusk. */
  hanging?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Rounded, screwed, rope-hung park signage. Use it for titles above panels. */
export function WoodSign({ children, hanging = false, className = "", style }: WoodSignProps) {
  useStorybookSkin();
  const reduced = useReducedMotion();
  return (
    <div className={`cp-root cp-sign${hanging && !reduced ? " cp-sign-sway" : ""} ${className}`} style={style}>
      {hanging ? (
        <>
          <span className="cp-sign-rope cp-sign-rope-l" aria-hidden="true" />
          <span className="cp-sign-rope cp-sign-rope-r" aria-hidden="true" />
        </>
      ) : null}
      <span className="cp-sign-screw cp-sign-screw-l" aria-hidden="true" />
      <span className="cp-sign-screw cp-sign-screw-r" aria-hidden="true" />
      {children}
    </div>
  );
}

/* ==================================================================== */
/* CAROUSEL PANEL                                                        */
/* ==================================================================== */

export interface CarouselPanelProps {
  children: ReactNode;
  /** Painted across the striped canopy in hand-lettered type. */
  title?: string;
  /** Renders the always-available way out. A panel with no exit is a dead end. */
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * A panel dressed as a fairground carousel: striped canopy, scalloped hem,
 * barber-pole posts. This is what a "menu" looks like in this park.
 *
 * `onClose` is not optional in spirit — every panel a child can open must
 * offer a way back to the park, or we have built a dead end.
 */
export function CarouselPanel({
  children, title, onClose, closeLabel = "back to the park", className = "", style,
}: CarouselPanelProps) {
  useStorybookSkin();
  return (
    <div className={`cp-root cp-carousel ${className}`} style={style}>
      <div className="cp-carousel-canopy" aria-hidden="true" />
      <div className="cp-carousel-hem" aria-hidden="true" />
      <span className="cp-carousel-post cp-carousel-post-l" aria-hidden="true" />
      <span className="cp-carousel-post cp-carousel-post-r" aria-hidden="true" />
      {title ? (
        <StorybookHeading as="h2" size="md" color={UI.cream} seed={91} className="cp-carousel-title">
          {title}
        </StorybookHeading>
      ) : null}
      {children}
      {onClose ? (
        <div style={{ marginTop: 22, display: "flex", justifyContent: "center" }}>
          <WoodButton tone="quiet" onPress={onClose} speak={closeLabel}>{closeLabel}</WoodButton>
        </div>
      ) : null}
    </div>
  );
}

/* ==================================================================== */
/* RIBBON                                                                */
/* ==================================================================== */

export interface RibbonBannerProps {
  children: ReactNode;
  tone?: "scarf" | "honey" | "teal";
  className?: string;
  style?: CSSProperties;
}

/** A small folded ribbon for a label: "you are here", "new!", a piece name. */
export function RibbonBanner({ children, tone = "scarf", className = "", style }: RibbonBannerProps) {
  useStorybookSkin();
  const cls = tone === "scarf" ? "" : ` cp-ribbon-${tone}`;
  return <span className={`cp-root cp-ribbon${cls} ${className}`} style={style}>{children}</span>;
}

/* ==================================================================== */
/* PAINTED ICON                                                          */
/* ==================================================================== */

export interface PaintedIconProps {
  /** A Mark from `lib/a11y` — shape + glyph + colour, never colour alone. */
  mark: Mark;
  size?: number;
  /** Solid fill (dark side, "taken" states) vs hollow (light side). */
  filled?: boolean;
  /** Gentle twinkle — for sparkles and hints. Off under reduced motion. */
  twinkle?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Draws a Mark's silhouette as cel-shaded SVG: flat fill, warm ink outline,
 * and a light bounce along the top edge so it belongs to the same lighting as
 * the 3D park.
 *
 * The shape carries the meaning. Colour is decoration on top of it — which is
 * what makes the whole interface safe for a colourblind child.
 */
export function PaintedIcon({
  mark, size = 28, filled = true, twinkle = false, className = "", style,
}: PaintedIconProps) {
  useStorybookSkin();
  const reduced = useReducedMotion();
  const d = useMemo(() => markPath(mark.shape, 100), [mark.shape]);
  const body = css(mark.color);
  const lit = css(mix(mark.color, PALETTE.lanternCore, 0.42));

  return (
    <svg
      className={`cp-icon${twinkle && !reduced ? " cp-icon-twinkle" : ""} ${className}`}
      width={size} height={size} viewBox="-6 -6 112 112"
      role="img" aria-label={mark.label} style={style}
    >
      {/* Ink first, fattened underneath: the same inverted-hull idea the 3D
          outline pass uses, so 2D and 3D silhouettes read as one language. */}
      <path d={d} fill="none" stroke={css(PALETTE.ink)} strokeWidth={14}
            strokeLinejoin="round" strokeLinecap="round" fillRule="evenodd" />
      <path d={d} fill={filled ? body : css(PALETTE.creamPale)} fillRule="evenodd"
            stroke={css(PALETTE.ink)} strokeWidth={6} strokeDasharray={mark.dash === "0" ? undefined : mark.dash}
            strokeLinejoin="round" />
      {/* One warm band across the top — the toon ramp's lit step, painted by
          hand. `inset()` on the top 38% is the 2D equivalent of the ramp's
          hard terminator, so a badge and a 3D piece catch the light alike. */}
      <path d={d} fill={lit} fillRule="evenodd" opacity={filled ? 0.5 : 0.25}
            style={{ clipPath: "inset(0 0 62% 0)" }} />
    </svg>
  );
}

/* ==================================================================== */
/* PAINTED PRESS — when the picture itself is the button                 */
/* ==================================================================== */

export interface PaintedPressProps {
  children: ReactNode;
  onPress: () => void;
  /** Required: the picture cannot speak for itself. */
  label: string;
  /** Read the label aloud on press. */
  speak?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * A transparent, fully accessible button wrapped around artwork — used where
 * the control IS the painting (an attraction on the fold-out map, ChessPaa's
 * little portrait). Keeps the touch-target floor and the warm focus halo, and
 * adds the same lift-and-press feel as the wooden buttons.
 */
export function PaintedPress({
  children, onPress, label, speak = false, disabled = false, className = "", style,
}: PaintedPressProps) {
  useStorybookSkin();
  const { pressed, handlers } = usePressState(disabled);
  return (
    <button
      type="button"
      className={`cp-root cp-press ${className}`}
      data-pressed={pressed ? "1" : "0"}
      onClick={() => {
        if (disabled) return;
        if (speak) narrate(label);
        onPress();
      }}
      disabled={disabled}
      aria-label={label}
      style={style}
      {...handlers}
    >
      {children}
    </button>
  );
}

/* ==================================================================== */
/* SCRIM                                                                 */
/* ==================================================================== */

export interface ScrimProps {
  children?: ReactNode;
  /** Tapping the dimmed park closes whatever is open. Never a trap. */
  onDismiss?: () => void;
  zIndex?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * The honey-tinted dim behind an overlay. It is NOT a grey modal backdrop —
 * the park lowers its lanterns like a theatre, and stays visible and warm
 * behind whatever has opened.
 */
export function Scrim({ children, onDismiss, zIndex = 40, className = "", style }: ScrimProps) {
  useStorybookSkin();
  return (
    <div
      className={`cp-root cp-scrim ${className}`}
      style={{ zIndex, ...style }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onDismiss?.(); }}
    >
      {children}
    </div>
  );
}

/* ==================================================================== */
/* SR-ONLY                                                               */
/* ==================================================================== */

/** Visually hidden text that assistive tech still reads. */
export function SrOnly({ children }: { children: ReactNode }) {
  useStorybookSkin();
  return <span className="cp-sr">{children}</span>;
}

/**
 * The class name itself, for the rare place that needs it on an element we
 * are not rendering (a <caption>, a <legend>).
 */
export const SR_ONLY_CLASS = "cp-sr";
