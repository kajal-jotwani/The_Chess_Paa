"use client";

/**
 * THE FOLD-OUT MAP.
 *
 * Not a menu. A thing.
 *
 * A child pulls a folded paper map out of their pocket, the wings swing open,
 * and there is the whole valley — painted, creased, a little worn at the
 * edges, with a lantern pin standing on the spot where they are right now.
 * Then they put their finger on the Ferris wheel and the coaster car takes
 * them there.
 *
 * Three ideas hold the whole thing up:
 *
 * 1. IT IS ONE SHEET OF PAPER SEEN THROUGH THREE WINDOWS. Each folding panel
 *    contains the SAME full-width painting, shifted sideways by its own width.
 *    So when the map folds, the painting is cut by the creases exactly where
 *    real paper would cut it — an attraction sitting on a fold gets folded in
 *    half. Painting the panels separately would have been easier and would
 *    have looked like three sliding cards.
 *
 * 2. THE MAP IS DERIVED FROM THE REAL WORLD. Every position comes from
 *    `ATTRACTIONS`, the river from `RIVER_POINTS`, the track from
 *    `SPINE_CURVE`. Move an attraction in the park and the map moves with it;
 *    there is no second source of truth to drift.
 *
 * 3. IT IS PAINTED, NOT DRAWN FROM ASSETS. Every hill, gondola and puff of
 *    steam below is vector work generated in this file, in the same cel
 *    language as the 3D park: flat fills, one warm lit band, a fat warm-ink
 *    outline, and `rng(seed)` for every wobble so the paper is identical on
 *    every run.
 */

import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from "react";

import { PALETTE, css, mix } from "@/three/core/palette";
import { rng } from "@/three/core/textures/procedural";
import { ATTRACTIONS, SPINE_CURVE, type StopName } from "@/three/world/coasterSpine";
import { RIVER_POINTS } from "@/three/world/terrain";
import { TOUCH, useHotkey, useReducedMotion, narrate, announce } from "@/lib/a11y";
import {
  UI, Scrim, WoodButton, PaintedPress, StorybookHeading,
  ensureStyleSheet, useStorybookSkin,
} from "./StorybookUI";

/* ==================================================================== */
/* THE PAPER                                                             */
/* ==================================================================== */

/** One sheet, three folding panels. */
export const MAP_SIZE = { w: 588, h: 396, panels: 3 } as const;
const PANEL_W = MAP_SIZE.w / MAP_SIZE.panels;

/**
 * The whole object — hand-lettered title, sheet, and the way out — as one
 * fixed-size block.
 *
 * WHY a fixed block: the map is scaled to fit with a CSS transform, and a
 * transform does not change layout size. Scaling a box whose layout width is
 * still 588 inside a 390px phone leaves the browser centring an overflowing
 * grid item, and the result lands off-centre and clipped. Declaring the block
 * up front lets the wrapper be sized at exactly `block × scale`, with the
 * transform anchored at its top-left — no overflow, nothing to centre wrong.
 */
const TITLE_H = 58;
const FOOT_H = 118;
export const MAP_BLOCK = { w: MAP_SIZE.w, h: TITLE_H + MAP_SIZE.h + FOOT_H } as const;

/**
 * The slice of the valley the paper covers.
 *
 * Wider in X than the attractions need, so the frozen river can run off both
 * edges of the paper the way a real map's river does — a map that stops
 * exactly where the interesting bits stop reads as a diagram.
 */
const WORLD = { x0: -142, x1: 142, z0: -106, z1: 88 };

/** World XZ → paper pixels. North (−Z) is up, as on every map a child will meet later. */
export function worldToMap(x: number, z: number): { x: number; y: number } {
  return {
    x: ((x - WORLD.x0) / (WORLD.x1 - WORLD.x0)) * MAP_SIZE.w,
    y: ((z - WORLD.z0) / (WORLD.z1 - WORLD.z0)) * MAP_SIZE.h,
  };
}

/* ==================================================================== */
/* THE PLACES                                                            */
/* ==================================================================== */

export interface ParkPlace {
  stop: StopName;
  /** The name painted on the map. */
  name: string;
  /** What ChessPaa says about it when a child touches it. */
  blurb: string;
  /** The five wonders are pressable destinations; the gate is the way in. */
  isAttraction: boolean;
}

/**
 * The five wonders, plus the gate.
 *
 * Order matters — it is the order a child meets them, and the order the HUD's
 * five lamps light up in.
 */
export const PARK_PLACES: ParkPlace[] = [
  {
    stop: "plaza",
    name: "The Great Board",
    blurb: "The Great Board, in the middle of everything. That is where you and I play, my dear.",
    isAttraction: true,
  },
  {
    stop: "parade",
    name: "The Piece Parade",
    blurb: "The Piece Parade! Every knight and bishop marching about, and each one has a song.",
    isAttraction: true,
  },
  {
    stop: "ferris",
    name: "The Endgame Wheel",
    blurb: "The Endgame Wheel. Nice and slow up there — endgames are the bedtime stories of chess.",
    isAttraction: true,
  },
  {
    stop: "coaster",
    name: "The Tactics Coaster",
    blurb: "The Tactics Rollercoaster! Forks and pins and sneaky checks. Hands inside the cart!",
    isAttraction: true,
  },
  {
    stop: "train",
    name: "The Puzzle Train",
    blurb: "All aboard the Puzzle Train. Solve a puzzle, and off we chug to the next one.",
    isAttraction: true,
  },
  {
    stop: "gate",
    name: "The Front Gate",
    blurb: "The front gate, where you came in. The lanterns are always lit for you there.",
    isAttraction: false,
  },
];

/* ==================================================================== */
/* PAINTED ICONS — each one a tiny cel-shaded scene                      */
/* ==================================================================== */

const INK = css(PALETTE.ink);

/** Shared props for the little painted scenes. All are 64×64 in local units. */
interface IconProps { x: number; y: number; size?: number }

function place({ x, y, size = 64 }: IconProps): string {
  // Centre the 64-unit icon on the map coordinate.
  const s = size / 64;
  return `translate(${x - size / 2} ${y - size / 2}) scale(${s})`;
}

/** The plaza: a warm chessboard on a wooden plinth, with a lantern beside it. */
export function IconGreatBoard(p: IconProps) {
  const light = css(PALETTE.cream), dark = css(PALETTE.walnut);
  const squares: ReactNode[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      squares.push(
        <rect key={`${r}-${c}`} x={16 + c * 8} y={22 + r * 5} width={8} height={5}
              fill={(r + c) % 2 ? dark : light} />
      );
    }
  }
  return (
    <g transform={place(p)}>
      {/* plinth */}
      <path d="M14,44 L50,44 L54,56 L10,56 Z" fill={css(PALETTE.walnut)} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <path d="M14,44 L50,44 L51,48 L13,48 Z" fill={css(PALETTE.walnutLight)} />
      {/* board, tilted the way a board on a table reads */}
      <g transform="rotate(-4 32 32)">
        <rect x={14} y={20} width={36} height={22} rx={2} fill={light} stroke={INK} strokeWidth={3} />
        {squares}
        <rect x={14} y={20} width={36} height={22} rx={2} fill="none" stroke={INK} strokeWidth={3} />
      </g>
      {/* a queen standing on it — the promise of the place */}
      <path d="M30,20 L34,20 L35,13 L32,10 L29,13 Z" fill={css(PALETTE.honey)} stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
      {/* lantern */}
      <g transform="translate(52 30)">
        <rect x={-4} y={-4} width={8} height={11} rx={2} fill={css(PALETTE.lanternCore)} stroke={INK} strokeWidth={2.2} />
        <path d="M0,-9 L0,-5" stroke={css(PALETTE.honeyDeep)} strokeWidth={2} />
      </g>
    </g>
  );
}

/** The parade: a striped canopy with two little pieces marching under it. */
export function IconPieceParade(p: IconProps) {
  return (
    <g transform={place(p)}>
      {/* canopy */}
      <path d="M8,26 Q32,10 56,26 L56,30 Q32,18 8,30 Z" fill={css(PALETTE.plum)} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <path d="M14,23 Q32,13 50,23" fill="none" stroke={css(PALETTE.creamPale)} strokeWidth={4} opacity={0.85} />
      {/* scalloped hem */}
      <path d="M8,30 q6,7 12,0 q6,7 12,0 q6,7 12,0 q6,7 12,0 L56,26 L8,26 Z"
            fill={css(PALETTE.creamPale)} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
      {/* posts */}
      <rect x={9} y={28} width={4} height={24} fill={css(PALETTE.walnut)} stroke={INK} strokeWidth={2.4} />
      <rect x={51} y={28} width={4} height={24} fill={css(PALETTE.walnut)} stroke={INK} strokeWidth={2.4} />
      {/* two pieces on parade: a knight's pennant head and a pawn */}
      <path d="M24,52 L24,44 Q22,38 27,36 L31,32 L33,36 Q35,42 32,44 L32,52 Z"
            fill={css(PALETTE.teal)} stroke={INK} strokeWidth={2.8} strokeLinejoin="round" />
      <circle cx={41} cy={38} r={4.4} fill={css(PALETTE.honey)} stroke={INK} strokeWidth={2.6} />
      <path d="M37,52 L37,47 Q41,42 45,47 L45,52 Z" fill={css(PALETTE.honey)} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
    </g>
  );
}

/** The Ferris wheel: eight spokes, four gondolas, a lantern at the hub. */
export function IconFerrisWheel(p: IconProps) {
  const spokes: ReactNode[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    spokes.push(
      <line key={i} x1={32} y1={28} x2={32 + Math.cos(a) * 19} y2={28 + Math.sin(a) * 19}
            stroke={css(PALETTE.walnutLight)} strokeWidth={2.4} />
    );
  }
  const cars: ReactNode[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const gx = 32 + Math.cos(a) * 20, gy = 28 + Math.sin(a) * 20;
    cars.push(
      <g key={i}>
        <rect x={gx - 4} y={gy - 2} width={8} height={7} rx={2.5}
              fill={i % 2 ? css(PALETTE.teal) : css(PALETTE.plum)} stroke={INK} strokeWidth={2.2} />
      </g>
    );
  }
  return (
    <g transform={place(p)}>
      {/* legs */}
      <path d="M20,56 L32,30 L44,56" fill="none" stroke={css(PALETTE.walnut)} strokeWidth={4.4} strokeLinecap="round" />
      <path d="M20,56 L32,30 L44,56" fill="none" stroke={INK} strokeWidth={1.6} opacity={0.5} />
      <circle cx={32} cy={28} r={21} fill={css(mix(PALETTE.cream, PALETTE.honey, 0.25))} stroke={INK} strokeWidth={3} />
      {spokes}
      {cars}
      <circle cx={32} cy={28} r={5} fill={css(PALETTE.lanternCore)} stroke={INK} strokeWidth={2.6} />
    </g>
  );
}

/** The coaster: a wooden hill, a cresting car, and the reveal-sparkle. */
export function IconTacticsCoaster(p: IconProps) {
  const ties: ReactNode[] = [];
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    // Follow the same curve the track path uses, one tie every step.
    const tx = 8 + t * 48;
    const ty = 46 - Math.sin(t * Math.PI) * 26;
    ties.push(<line key={i} x1={tx} y1={ty} x2={tx} y2={ty + 6} stroke={css(PALETTE.walnut)} strokeWidth={2.6} />);
  }
  return (
    <g transform={place(p)}>
      {/* the hill behind */}
      <path d="M4,56 Q22,28 32,28 Q44,28 60,56 Z" fill={css(PALETTE.forestMid)} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" opacity={0.9} />
      {ties}
      {/* the track: the one shape that says rollercoaster in a thumbnail */}
      <path d="M8,46 Q32,-4 56,46" fill="none" stroke={css(PALETTE.walnutLight)} strokeWidth={4.4} strokeLinecap="round" />
      <path d="M8,46 Q32,-4 56,46" fill="none" stroke={INK} strokeWidth={1.5} opacity={0.5} />
      {/* the car, right at the crest, right at the moment of the reveal */}
      <g transform="translate(30 17)">
        <rect x={-6} y={-4} width={12} height={8} rx={3} fill={css(PALETTE.scarfRed)} stroke={INK} strokeWidth={2.4} />
        <circle cx={-3} cy={-5} r={2.2} fill={css(PALETTE.creamPale)} stroke={INK} strokeWidth={1.6} />
        <circle cx={3} cy={-5} r={2.2} fill={css(PALETTE.creamPale)} stroke={INK} strokeWidth={1.6} />
      </g>
      <path d="M48,12 l2,5 5,2 -5,2 -2,5 -2,-5 -5,-2 5,-2 z" fill={css(PALETTE.lanternCore)} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
    </g>
  );
}

/** The puzzle train: a chunky loco and three puffs of steam. */
export function IconPuzzleTrain(p: IconProps) {
  return (
    <g transform={place(p)}>
      {/* steam, biggest last — the eye reads the direction of travel from it */}
      <circle cx={16} cy={20} r={4} fill={css(PALETTE.snow)} stroke={INK} strokeWidth={2} opacity={0.95} />
      <circle cx={23} cy={14} r={5.4} fill={css(PALETTE.snow)} stroke={INK} strokeWidth={2} opacity={0.95} />
      <circle cx={32} cy={9} r={6.6} fill={css(PALETTE.snow)} stroke={INK} strokeWidth={2} opacity={0.95} />
      {/* body */}
      <path d="M8,44 L8,30 L26,30 L26,24 L44,24 L48,30 L54,30 L54,44 Z"
            fill={css(PALETTE.teal)} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <path d="M8,30 L26,30 L26,24 L44,24 L44,28 L8,34 Z" fill={css(mix(PALETTE.teal, PALETTE.lanternCore, 0.35))} opacity={0.75} />
      {/* chimney and cab window */}
      <rect x={11} y={22} width={8} height={8} rx={2} fill={css(PALETTE.plum)} stroke={INK} strokeWidth={2.6} />
      <rect x={31} y={28} width={9} height={8} rx={2} fill={css(PALETTE.creamPale)} stroke={INK} strokeWidth={2.4} />
      {/* wheels */}
      <circle cx={18} cy={46} r={7} fill={css(PALETTE.walnut)} stroke={INK} strokeWidth={3} />
      <circle cx={40} cy={46} r={7} fill={css(PALETTE.walnut)} stroke={INK} strokeWidth={3} />
      <circle cx={18} cy={46} r={2.4} fill={css(PALETTE.honey)} />
      <circle cx={40} cy={46} r={2.4} fill={css(PALETTE.honey)} />
    </g>
  );
}

/** The gate: a rounded arch with bunting. Small — it is the way in, not a ride. */
export function IconFrontGate(p: IconProps) {
  return (
    <g transform={place(p)}>
      <path d="M12,54 L12,30 Q32,12 52,30 L52,54" fill="none" stroke={css(PALETTE.walnut)} strokeWidth={7} strokeLinecap="round" />
      <path d="M12,54 L12,30 Q32,12 52,30 L52,54" fill="none" stroke={INK} strokeWidth={2} opacity={0.45} />
      {/* bunting */}
      <path d="M8,26 Q32,40 56,26" fill="none" stroke={css(PALETTE.honeyDeep)} strokeWidth={2} />
      <path d="M18,31 l4,6 4,-4 z" fill={css(PALETTE.plum)} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
      <path d="M30,35 l4,6 4,-5 z" fill={css(PALETTE.teal)} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
      <path d="M42,31 l4,6 4,-4 z" fill={css(PALETTE.scarfRed)} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
    </g>
  );
}

/**
 * How wide a place's hit target may grow before it eats its neighbour's.
 *
 * Two 108px circles whose centres are 88px apart OVERLAP, and the map has three
 * such pairs — the Piece Parade and the Endgame Wheel overlapped by 19px, so a
 * finger aimed at one could open the other. A target that is much bigger than
 * the painting it sits on is its own bug anyway: a child taps blank snow and a
 * ride starts.
 *
 * Computed once from the real `ATTRACTIONS` positions, so moving an attraction
 * moves its target's ceiling with it, and never below the touch floor.
 */
const HIT_CEILING: Record<StopName, number> = (() => {
  const out = {} as Record<StopName, number>;
  const pts = PARK_PLACES.map((p) => ({ stop: p.stop, m: worldToMap(ATTRACTIONS[p.stop].x, ATTRACTIONS[p.stop].z) }));
  for (const a of pts) {
    let nearest = Infinity;
    for (const b of pts) {
      if (b.stop === a.stop) continue;
      nearest = Math.min(nearest, Math.hypot(a.m.x - b.m.x, a.m.y - b.m.y));
    }
    // Two circles of diameter d, centres L apart, clear each other by L − d.
    out[a.stop] = Math.max(TOUCH.min, nearest - TOUCH.gap);
  }
  return out;
})();

const ICON_FOR: Record<StopName, (p: IconProps) => ReactNode> = {
  plaza: IconGreatBoard,
  parade: IconPieceParade,
  ferris: IconFerrisWheel,
  coaster: IconTacticsCoaster,
  train: IconPuzzleTrain,
  gate: IconFrontGate,
};

/* ==================================================================== */
/* THE PAINTED SHEET                                                     */
/* ==================================================================== */

/**
 * How far above its map position the "you are here" lantern stands, so its
 * post and flame clear the attraction icon underneath rather than skewering it.
 */
const HERE_LIFT = 38;

/** The lantern art reaches this far above the top of the post. */
const HERE_LANTERN_REACH = 48;

/**
 * The lift, clamped so the lantern never climbs off the top of the paper.
 * The Ferris wheel sits high on the page and was the case that broke it.
 */
export function hereLift(mapY: number): number {
  return Math.min(HERE_LIFT, Math.max(4, mapY - HERE_LANTERN_REACH - 16));
}

/** Smooth a run of points into one path, using midpoints as the on-curve knots. */
function smoothPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += `Q${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += `L${last.x.toFixed(1)},${last.y.toFixed(1)}`;
  return d;
}

export interface ParkMapArtProps {
  /** Where the child is standing. A lantern pin goes here. */
  here?: StopName;
  /** Which wonders have been visited — visited ones get a little gold star. */
  visited?: ReadonlySet<StopName> | StopName[];
  /** Changes the hand-torn edge, the trees and the ink wobble. Deterministic. */
  seed?: number;
}

/**
 * The painting itself, as one standalone SVG the width of the whole sheet.
 *
 * Kept separate from the folding so it can be reused flat — as a poster on a
 * park wall, or (later) painted onto a canvas texture for a signboard in the
 * 3D world. It draws nothing interactive; the hit targets live above it.
 */
export function ParkMapArt({ here, visited, seed = 1207 }: ParkMapArtProps) {
  /* The fold-out renders this sheet THREE times, once behind each panel window.
     With hardcoded ids that published three <clipPath id="cp-map-paper"> into
     one document and every url(#…) resolved to whichever happened to be first —
     harmless while all three are identical, a silent mis-clip the moment they
     are not (a different seed per panel, a poster beside the fold-out). */
  const uid = useId().replace(/:/g, "");
  const duskId = `cp-map-dusk-${uid}`;
  const paperId = `cp-map-paper-${uid}`;

  const been = useMemo(
    () => (visited instanceof Set ? visited : new Set(visited ?? [])),
    [visited]
  );

  const art = useMemo(() => {
    const r = rng(seed);

    /* --- the hand-torn paper edge -------------------------------------
       A rectangle is a printed form; a deckle edge is a page from a book.
       Wobble amplitude stays under 5px so it reads as torn paper, not as a
       cartoon explosion. */
    const edge: string[] = [];
    const STEPS = 44;
    const wob = () => (r() - 0.5) * 8;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      edge.push(`${(8 + t * (MAP_SIZE.w - 16)).toFixed(1)},${(9 + wob()).toFixed(1)}`);
    }
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      edge.push(`${(MAP_SIZE.w - 9 + wob()).toFixed(1)},${(9 + t * (MAP_SIZE.h - 18)).toFixed(1)}`);
    }
    for (let i = STEPS; i >= 0; i--) {
      const t = i / STEPS;
      edge.push(`${(8 + t * (MAP_SIZE.w - 16)).toFixed(1)},${(MAP_SIZE.h - 9 + wob()).toFixed(1)}`);
    }
    for (let i = 18; i >= 0; i--) {
      const t = i / 18;
      edge.push(`${(9 + wob()).toFixed(1)},${(9 + t * (MAP_SIZE.h - 18)).toFixed(1)}`);
    }
    const edgePath = `M${edge.join("L")}Z`;

    /* --- the pine wall across the north --------------------------------
       Two bands of SAWTOOTH, not one scalloped blob.

       The first pass drew the ridge as a smooth wavy mass and it read as a
       green banner pinned to the top of the page. Pines are triangles; a
       forest edge seen from a valley floor is a row of triangles; so the
       silhouette is built from actual triangles, in two depths, with the far
       band hazier — the same flat-paper-card stacking the 3D valley uses. */
    const pineBand = (
      baseY: number, minStep: number, maxStep: number,
      minH: number, maxH: number, phase: number,
    ): string => {
      const d: string[] = ["M-12,0", `L-12,${baseY.toFixed(1)}`];
      let x = -12, i = 0;
      while (x < MAP_SIZE.w + 12) {
        const step = minStep + r() * (maxStep - minStep);
        const h = minH + r() * (maxH - minH);
        // Two slow sines so the skyline undulates instead of marching.
        const drift = Math.sin(i * 0.23 + phase) * 9 + Math.sin(i * 0.071 + phase) * 7;
        d.push(`L${(x + step * 0.5).toFixed(1)},${(baseY + drift - h).toFixed(1)}`);
        // Each tooth only comes back 28% of the way down before the next peak
        // starts — so the triangles OVERLAP into a thicket. Returning to the
        // baseline every time is what made the first pass read as a sawblade.
        d.push(`L${(x + step).toFixed(1)},${(baseY + drift - h * 0.28).toFixed(1)}`);
        x += step; i++;
      }
      d.push(`L${MAP_SIZE.w + 12},0`, "Z");
      return d.join("");
    };
    /* Both bands fill DOWNWARD from the top of the sheet, so whichever has the
       higher silhouette hides the other completely. That means the hazy band
       has to be the LOWER one: the dark mass paints over its upper half and
       what survives is a warm, thinning fringe of trees where the forest meets
       the snow. Drawn the other way round (which is how the first pass did it)
       the second band is invisible and the treeline is one flat shape. */
    const ridgeFringe = pineBand(98, 22, 44, 16, 34, 0.6);
    const ridgeMass = pineBand(74, 15, 30, 18, 38, 2.1);

    /* --- little pines wandering down onto the snow ---------------------- */
    const avoid = PARK_PLACES.map((p) => worldToMap(ATTRACTIONS[p.stop].x, ATTRACTIONS[p.stop].z));
    const pines: Array<{ x: number; y: number; s: number }> = [];
    for (let i = 0; i < 40 && pines.length < 17; i++) {
      const x = 16 + r() * (MAP_SIZE.w - 32);
      // Clustered just below the treeline and thinning fast into the valley —
      // an even scatter reads as wallpaper, not as a forest edge.
      const y = 94 + Math.pow(r(), 2.4) * 190;
      if (avoid.some((a) => Math.abs(a.x - x) < 66 && Math.abs(a.y - y) < 50)) continue;
      // Smaller the further from the treeline, so the page has depth.
      const near = 1 - Math.min(1, (y - 94) / 190);
      pines.push({ x, y, s: 0.42 + near * 0.5 + r() * 0.22 });
    }

    /* --- soft drifts, so the snow is not a blank sheet ------------------ */
    const drifts: Array<{ x: number; y: number; rx: number; ry: number; warm: boolean }> = [];
    for (let i = 0; i < 14; i++) {
      drifts.push({
        x: r() * MAP_SIZE.w,
        y: 110 + r() * (MAP_SIZE.h - 140),
        rx: 40 + r() * 90,
        ry: 10 + r() * 20,
        warm: r() > 0.45,
      });
    }

    /* --- the paper's own grain, painted rather than tiled ---------------
       The parchment CSS texture sits behind the panels, but the flat poster
       version of this map has nothing behind it — so the grain is painted
       here, once, and both versions look the same. */
    const grain: Array<{ x: number; y: number; r: number; a: number }> = [];
    for (let i = 0; i < 46; i++) {
      grain.push({
        x: r() * MAP_SIZE.w, y: r() * MAP_SIZE.h,
        r: 14 + r() * 54, a: 0.03 + r() * 0.05,
      });
    }

    /* --- the frozen river, straight off the terrain's own spline -------- */
    const river = smoothPath(RIVER_POINTS.map(([x, z]) => worldToMap(x, z)));

    /* --- the coaster track, straight off the real curve ---------------- */
    const spinePts = SPINE_CURVE.getPoints(160).map((v) => worldToMap(v.x, v.z));
    const spine = smoothPath(spinePts) + "Z";

    return { edgePath, ridgeFringe, ridgeMass, pines, drifts, grain, river, spine };
  }, [seed]);

  const herePos = here ? worldToMap(ATTRACTIONS[here].x, ATTRACTIONS[here].z) : null;

  return (
    <svg
      width={MAP_SIZE.w}
      height={MAP_SIZE.h}
      viewBox={`0 0 ${MAP_SIZE.w} ${MAP_SIZE.h}`}
      style={{ display: "block" }}
      aria-hidden="true"
    >
      <defs>
        {/* Dusk pooling toward the bottom of the page. Warm, never grey. */}
        <linearGradient id={duskId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={css(PALETTE.honey)} stopOpacity="0.01" />
          <stop offset="100%" stopColor={css(PALETTE.honeyDeep)} stopOpacity="0.13" />
        </linearGradient>
        <clipPath id={paperId}><path d={art.edgePath} /></clipPath>
      </defs>

      {/* the paper — snow-cream, only a touch of honey. Push the honey and the
          valley stops reading as snow and starts reading as sand. */}
      <path d={art.edgePath} fill={css(mix(PALETTE.creamPale, PALETTE.honey, 0.07))} />

      <g clipPath={`url(#${paperId})`}>
        {/* painted grain — the blotches a handled page picks up */}
        {art.grain.map((g, i) => (
          <circle key={i} cx={g.x} cy={g.y} r={g.r}
                  fill={css(mix(PALETTE.cream, PALETTE.walnut, 0.55))} opacity={g.a} />
        ))}

        {/* THE PINE WALL, two flat cut-paper bands. The far one is hazier so
            the page has the same stacked depth as the valley itself. */}
        <path d={art.ridgeFringe} fill={css(mix(PALETTE.forestMid, PALETTE.honey, 0.22))} />
        <path d={art.ridgeMass} fill={css(PALETTE.forest)} />
        <path d={art.ridgeMass} fill="none" stroke={INK} strokeWidth={1.8} opacity={0.4} />

        {/* wind-combed drifts on the snow */}
        {art.drifts.map((d, i) => (
          <ellipse key={i} cx={d.x} cy={d.y} rx={d.rx} ry={d.ry}
                   fill={d.warm ? css(PALETTE.creamPale) : css(PALETTE.snowShadow)}
                   opacity={d.warm ? 0.5 : 0.22} />
        ))}
        <rect x={0} y={0} width={MAP_SIZE.w} height={MAP_SIZE.h} fill={`url(#${duskId})`} />
      </g>

      {/* the frozen river — the one cool passage on a warm page */}
      <path d={art.river} fill="none" stroke={css(PALETTE.waterTeal)} strokeWidth={17} strokeLinecap="round" opacity={0.5} />
      <path d={art.river} fill="none" stroke={css(PALETTE.icePale)} strokeWidth={10} strokeLinecap="round" />
      <path d={art.river} fill="none" stroke={css(PALETTE.creamPale)} strokeWidth={3} strokeLinecap="round"
            strokeDasharray="16 22" opacity={0.75} />

      {/* THE TRACK. Sleepers drawn as a dashed overlay on a solid rail — the
          same trick the 3D track uses, and it reads as a railway at any size. */}
      <path d={art.spine} fill="none" stroke={css(PALETTE.walnut)} strokeWidth={7} strokeLinecap="round" opacity={0.95} />
      <path d={art.spine} fill="none" stroke={css(PALETTE.walnutLight)} strokeWidth={3.2} strokeLinecap="round"
            strokeDasharray="3 9" />

      {/* the plaza clearing */}
      {(() => {
        const c = worldToMap(0, 0);
        const rx = (26 / (WORLD.x1 - WORLD.x0)) * MAP_SIZE.w;
        const ry = (26 / (WORLD.z1 - WORLD.z0)) * MAP_SIZE.h;
        return (
          <>
            <ellipse cx={c.x} cy={c.y} rx={rx} ry={ry} fill={css(mix(PALETTE.cream, PALETTE.honey, 0.34))} opacity={0.9} />
            <ellipse cx={c.x} cy={c.y} rx={rx} ry={ry} fill="none" stroke={css(PALETTE.honeyDeep)}
                     strokeWidth={2.5} strokeDasharray="7 7" opacity={0.8} />
          </>
        );
      })()}

      {/* pines on the slopes — trunk, body, and a warm lit face on the side
          the low sun is coming from, so even a 10px tree obeys the park's
          one-light rule */}
      {art.pines.map((t, i) => (
        <g key={i} transform={`translate(${t.x.toFixed(1)} ${t.y.toFixed(1)}) scale(${t.s.toFixed(2)})`}>
          <rect x={-1.5} y={7} width={3} height={6} fill={css(PALETTE.walnut)} stroke={INK} strokeWidth={1.2} />
          <path d="M0,9 L-8,9 L0,-13 L8,9 Z" fill={css(PALETTE.forestMid)} stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
          <path d="M0,9 L-8,9 L0,-13 Z" fill={css(mix(PALETTE.forestMid, PALETTE.honey, 0.30))} />
        </g>
      ))}

      {/* THE PLACES */}
      {PARK_PLACES.map((p) => {
        const v = ATTRACTIONS[p.stop];
        const m = worldToMap(v.x, v.z);
        const Icon = ICON_FOR[p.stop];
        const size = p.isAttraction ? 66 : 48;
        return (
          <g key={p.stop}>
            {/* a warm pool of lantern light under each one, so an icon never
                sits on the dark pines without a place to stand */}
            <ellipse cx={m.x} cy={m.y + size * 0.32} rx={size * 0.58} ry={size * 0.24}
                     fill={css(PALETTE.honey)} opacity={0.30} />
            <Icon x={m.x} y={m.y} size={size} />
            {/* the name, painted with an ink halo so it survives any ground */}
            <text
              x={m.x}
              y={m.y + size * 0.62}
              textAnchor="middle"
              style={{ fontFamily: UI.font, fontSize: p.isAttraction ? 15 : 13, fontWeight: 800 }}
              fill={css(PALETTE.ink)}
              stroke={css(PALETTE.creamPale)}
              strokeWidth={4.5}
              paintOrder="stroke"
              transform={`rotate(${p.stop === "ferris" ? -2.5 : p.stop === "train" ? 2 : -1} ${m.x} ${m.y})`}
            >
              {p.name}
            </text>
            {/* a gold star for a wonder already visited: shape + colour, and
                its absence is a hollow nothing rather than a grey duplicate */}
            {been.has(p.stop) ? (
              <path
                d={`M${m.x + size * 0.42},${m.y - size * 0.38} l3.2,7 7.4,0.8 -5.6,5 1.7,7.3 -6.7,-3.9 -6.7,3.9 1.7,-7.3 -5.6,-5 7.4,-0.8 z`}
                fill={css(PALETTE.lanternCore)} stroke={INK} strokeWidth={2.2} strokeLinejoin="round"
              />
            ) : null}
          </g>
        );
      })}

      {/* WHERE THE CHILD IS NOW — a lantern on a pin, with its own glow.
          Drawn last so it is never behind anything. */}
      {herePos ? (
        // Lifted clear of the icon it marks. At the original height the post
        // and lantern sat straight through the middle of the Ferris wheel.
        <g transform={`translate(${herePos.x.toFixed(1)} ${(herePos.y - hereLift(herePos.y)).toFixed(1)})`}>
          <circle cx={0} cy={-30} r={24} fill={css(PALETTE.lanternCore)} opacity={0.34} className="cp-map-hereglow" />
          <path d={`M0,${hereLift(herePos.y)} L0,-24`} stroke={css(PALETTE.walnut)} strokeWidth={4} strokeLinecap="round" />
          <path d={`M0,${hereLift(herePos.y)} L0,-24`} stroke={INK} strokeWidth={1.4} opacity={0.45} strokeLinecap="round" />
          <g className="cp-map-herebob">
            <rect x={-8} y={-40} width={16} height={17} rx={4}
                  fill={css(PALETTE.lanternCore)} stroke={INK} strokeWidth={3} />
            <rect x={-10} y={-44} width={20} height={5} rx={2.4}
                  fill={css(PALETTE.honeyDeep)} stroke={INK} strokeWidth={2.6} />
            <path d="M0,-48 q0,-4 4,-4" fill="none" stroke={css(PALETTE.honeyDeep)} strokeWidth={2.4} />
            <ellipse cx={0} cy={-31} rx={3.4} ry={5} fill={css(PALETTE.creamPale)} />
          </g>

          {/* THE LABEL, PAINTED ON THE PAPER.
              It was a DOM ribbon floating above the folding panels, and it
              collided with whatever label happened to be nearby. Drawn into the
              sheet it can never collide with the layout, and — the point of the
              whole component — it folds when the paper folds.
              It hangs off whichever side of the post has room. */}
          {(() => {
            const W = 96;
            const flip = herePos.x > MAP_SIZE.w - (W + 26);
            const dx = flip ? -(W + 13) : 13;
            const tail = flip
              ? `M${W},-13 L0,-13 L10,0 L0,13 L${W},13 Z`
              : `M0,-13 L${W},-13 L${W - 10},0 L${W},13 L0,13 Z`;
            return (
              <g transform={`translate(${dx} -31)`}>
                <path d={tail} fill={css(PALETTE.scarfRed)} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
                <path d={`M${flip ? 10 : 2},-9 L${flip ? W - 2 : W - 12},-9`} stroke={css(PALETTE.creamPale)}
                      strokeWidth={2} opacity={0.4} />
                <text x={W / 2 + (flip ? 4 : -4)} y={5} textAnchor="middle"
                      fill={css(PALETTE.creamPale)}
                      style={{ fontFamily: UI.font, fontSize: 14, fontWeight: 800 }}>
                  you are here
                </text>
              </g>
            );
          })()}
        </g>
      ) : null}

      {/* the compass rose, bottom-left, where map-makers put it */}
      <g transform={`translate(46 ${MAP_SIZE.h - 46})`} opacity={0.9}>
        <circle r={22} fill={css(mix(PALETTE.cream, PALETTE.walnut, 0.10))} stroke={css(PALETTE.walnut)} strokeWidth={2.4} />
        <path d="M0,-19 L5,0 L0,19 L-5,0 Z" fill={css(PALETTE.creamPale)} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        <path d="M0,-19 L5,0 L0,0 Z" fill={css(PALETTE.scarfRed)} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
        <path d="M-19,0 L0,-4 L19,0 L0,4 Z" fill={css(PALETTE.cream)} stroke={INK} strokeWidth={2} strokeLinejoin="round" opacity={0.9} />
        <text x={0} y={-25} textAnchor="middle" fill={css(PALETTE.ink)}
              style={{ fontFamily: UI.font, fontSize: 13, fontWeight: 800 }}>N</text>
      </g>

      {/* the torn edge, drawn last so it crops everything cleanly in ink */}
      <path d={art.edgePath} fill="none" stroke={css(mix(PALETTE.walnut, PALETTE.cream, 0.30))} strokeWidth={3} opacity={0.8} />
      <path d={art.edgePath} fill="none" stroke={INK} strokeWidth={1.6} opacity={0.35} strokeDasharray="2 5" />
    </svg>
  );
}

/* ==================================================================== */
/* THE FOLDING                                                           */
/* ==================================================================== */

const MAP_STYLE_ID = "cp-park-map";

const MAP_CSS = `
.cp-map-stage {
  position: relative;
  perspective: 1500px;
  perspective-origin: 50% 42%;
}
/* The stage takes focus when the map opens (tabindex -1) so a keyboard child
   lands inside the dialog instead of tabbing the park behind it. It must not
   draw the lantern halo for that — a honey ring around the entire object is
   not a focus indicator, it is a border. The paper itself is the indicator. */
.cp-map-stage:focus, .cp-map-stage:focus-visible { outline: none; }
/* THE FOLD IS A CSS ANIMATION, NOT A TRANSITION — and that is a bug fix.
   A transition needs the folded pose to be COMMITTED before the flat pose is
   applied, which in React means mounting and then flipping state a frame or
   two later. Measured, that double-rAF took over 400ms to fire on the very
   frames that matter, because the scrim's backdrop blur makes the first frames
   after opening expensive. The map appeared to hang, then snap open.
   A keyframe animation runs from its own from-state the instant the element is
   inserted. No committed style to wait for, no frame budget to lose. */
.cp-map-flip {
  transform-style: preserve-3d;
  transform-origin: 50% 100%;
}
.cp-map[data-state="open"] .cp-map-flip {
  animation: cp-sheet-drop 380ms cubic-bezier(.22,.9,.28,1.06) both;
}
.cp-map[data-state="closing"] .cp-map-flip {
  animation: cp-sheet-lift 260ms ease-in 200ms both;
}
@keyframes cp-sheet-drop {
  from { transform: rotateX(-74deg); opacity: 0.2; }
  to   { transform: rotateX(0deg);   opacity: 1; }
}
@keyframes cp-sheet-lift {
  from { transform: rotateX(0deg);   opacity: 1; }
  to   { transform: rotateX(-74deg); opacity: 0; }
}
.cp-map-sheet {
  display: flex; align-items: stretch;
  transform-style: preserve-3d;
  filter: drop-shadow(0 26px 40px rgba(46,30,40,0.5));
}
.cp-map-panel {
  position: relative;
  overflow: hidden;
  flex: none;
  background-color: ${css(PALETTE.cream)};
  background-image:
    linear-gradient(rgba(252,244,228,0.66), rgba(244,178,74,0.13)),
    var(--cp-parchment, linear-gradient(${css(PALETTE.creamPale)}, ${css(PALETTE.cream)}));
  background-size: auto, 520px 520px;
  transform-style: preserve-3d;
  backface-visibility: hidden;
}
/* The wings hinge on their INNER edge, like every paper map ever folded, and
   they stand edge-on (±90°) when shut — so no back face is ever seen. */
.cp-map-panel-l { transform-origin: 100% 50%; }
.cp-map-panel-r { transform-origin: 0% 50%; }
.cp-map[data-state="open"] .cp-map-panel-l {
  animation: cp-wing-open-l 420ms cubic-bezier(.2,.86,.3,1.08) 120ms both;
}
.cp-map[data-state="open"] .cp-map-panel-r {
  animation: cp-wing-open-r 420ms cubic-bezier(.2,.86,.3,1.08) 190ms both;
}
.cp-map[data-state="closing"] .cp-map-panel-l { animation: cp-wing-shut-l 240ms ease-in both; }
.cp-map[data-state="closing"] .cp-map-panel-r { animation: cp-wing-shut-r 240ms ease-in 50ms both; }
@keyframes cp-wing-open-l { from { transform: rotateY(90deg); }  to { transform: rotateY(0deg); } }
@keyframes cp-wing-open-r { from { transform: rotateY(-90deg); } to { transform: rotateY(0deg); } }
@keyframes cp-wing-shut-l { from { transform: rotateY(0deg); } to { transform: rotateY(90deg); } }
@keyframes cp-wing-shut-r { from { transform: rotateY(0deg); } to { transform: rotateY(-90deg); } }
/* The painting inside each window is the full sheet, slid sideways. */
.cp-map-art { position: absolute; top: 0; }
/* Paper is thicker at a crease and catches the light there. */
.cp-map-crease {
  position: absolute; top: 0; bottom: 0; width: 26px; pointer-events: none;
}
.cp-map-crease-r { right: -13px; background: linear-gradient(90deg, rgba(46,30,40,0) 0%, rgba(46,30,40,0.22) 44%, rgba(255,246,224,0.34) 56%, rgba(46,30,40,0) 100%); }
.cp-map-crease-l { left: -13px;  background: linear-gradient(90deg, rgba(46,30,40,0) 0%, rgba(255,246,224,0.34) 44%, rgba(46,30,40,0.22) 56%, rgba(46,30,40,0) 100%); }

/* The targets appear only once the paper is flat. They do not animate with the
   panels (a target straddling a crease would have to be cut in two and pressed
   in two halves), so they simply fade in on the beat the wings land. */
.cp-map-hits { position: absolute; inset: 0; }
.cp-map[data-state="open"] .cp-map-hits { animation: cp-hits-in 200ms ease-out 500ms both; }
.cp-map[data-state="closing"] .cp-map-hits { opacity: 0; pointer-events: none; }
@keyframes cp-hits-in { from { opacity: 0; } to { opacity: 1; } }
/* NO CENTRING TRANSFORM HERE. Both ".cp-press:hover" and
   ".cp-press[data-pressed]" set a transform of their own, and they out-specify
   this rule — so a translate(-50%,-50%) living here got WIPED the instant a
   pointer touched the target. Measured: the hit box jumped +52px right and
   +49px down on hover, which on a mouse is an infinite hover-on/hover-off
   flicker and on a finger slides the button out from under the press.
   The offset is baked into the left/top values instead. */
.cp-map-hit {
  position: absolute;
  border-radius: 50%;
}
/* A dashed lantern ring on hover/focus: the "you may press this" affordance,
   drawn as a ring so it works with no colour vision at all. */
.cp-map-hit::after {
  content: ""; position: absolute; inset: -6px; border-radius: 50%;
  border: 3px dashed ${css(PALETTE.honeyDeep)};
  opacity: 0; transition: opacity 160ms ease-out, transform 200ms ease-out;
  transform: scale(0.9);
}
.cp-map-hit:hover::after, .cp-map-hit:focus-visible::after { opacity: 0.95; transform: scale(1); }

.cp-map-herebob { animation: cp-map-bob 2.6s ease-in-out infinite; }
@keyframes cp-map-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
.cp-map-hereglow { animation: cp-map-glow 3.2s ease-in-out infinite; transform-origin: center; }
@keyframes cp-map-glow { 0%,100% { opacity: 0.26; } 50% { opacity: 0.46; } }

.cp-map-frame {
  position: relative;
  display: flex; flex-direction: column; align-items: center;
}
.cp-map-title {
  height: ${TITLE_H}px; display: flex; align-items: center;
  transform: rotate(-1.4deg);
  z-index: 3; white-space: nowrap;
}
.cp-map-foot {
  height: ${FOOT_H}px;
  display: flex; align-items: center; justify-content: center; gap: ${TOUCH.gap}px;
  flex-wrap: wrap;
}

/* CALM MODE: the paper still opens, it just does not travel. Delays have to be
   zeroed too, or the map sits invisible for half a second before appearing. */
@media (prefers-reduced-motion: reduce) {
  .cp-map-herebob, .cp-map-hereglow { animation: none !important; }
  .cp-map *, .cp-map { animation-delay: 0ms !important; animation-duration: 1ms !important; }
}
`;

/** Fit a fixed-size object inside the viewport without ever scaling it up. */
function useFitScale(w: number, h: number, padX = 32, padY = 40): number {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => {
      const sx = (window.innerWidth - padX) / w;
      const sy = (window.innerHeight - padY) / h;
      setScale(Math.max(0.4, Math.min(1, sx, sy)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [w, h, padX, padY]);
  return scale;
}

export interface ParkMapFoldoutProps {
  /** Is the map out of the child's pocket? */
  open: boolean;
  /** Fold it away. Required — a map you cannot close is a trap. */
  onClose: () => void;
  /** Where the child is standing right now. The lantern pin goes here. */
  here?: StopName;
  /** Which wonders have been visited. Visited ones get a gold star. */
  visited?: ReadonlySet<StopName> | StopName[];
  /**
   * Take the child somewhere. Omit and the map is still perfectly good — the
   * places simply tell you about themselves instead of travelling.
   */
  onTravel?: (stop: StopName) => void;
  /** Painted on the wooden sign above the map. */
  title?: string;
  /** Read each place's line aloud when it is touched. Default true. */
  speak?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * THE FOLD-OUT MAP.
 *
 * ```tsx
 * <ParkMapFoldout
 *   open={mapOpen}
 *   onClose={() => setMapOpen(false)}
 *   here={ride.at}
 *   visited={visited}
 *   onTravel={(stop) => { setMapOpen(false); ride.travelTo(stop); }}
 * />
 * ```
 *
 * Mount it as a sibling of the R3F <Canvas>. It stays mounted through its
 * fold-away animation and then removes itself.
 */
export default function ParkMapFoldout({
  open, onClose, here, visited, onTravel,
  title = "ChessPaa's Wonderland", speak = true, className = "", style,
}: ParkMapFoldoutProps) {
  useStorybookSkin();
  useEffect(() => { ensureStyleSheet(MAP_STYLE_ID, MAP_CSS); }, []);
  const reduced = useReducedMotion();
  const scale = useFitScale(MAP_BLOCK.w, MAP_BLOCK.h);

  /* The map stays mounted while it folds away, so the paper is SEEN closing
     rather than blinking out. That is the only thing this state machine does —
     the fold itself is pure CSS keyframes keyed off `data-state`, which start
     the moment the element is inserted and therefore cannot be missed. */
  const [mounted, setMounted] = useState(open);
  const [openWas, setOpenWas] = useState(open);
  /* The targets are invisible until the paper is flat (CSS), and unpressable
     until then (this). Without it a stray finger can fire an attraction that
     is not on screen yet — a five-year-old taps twice more often than not. */
  const [armed, setArmed] = useState(false);
  const closeTimer = useRef<number | null>(null);

  // Mounting has to land BEFORE the first paint of a new `open` value (React's
  // "adjust state on prop change" pattern). Done in an effect it costs a frame,
  // and a frame here is the difference between paper opening and a dialog
  // appearing.
  if (open !== openWas) {
    setOpenWas(open);
    if (open) setMounted(true);
    else setArmed(false);
  }

  /* Where the child's keyboard focus was before the map came out.
     `aria-modal` tells assistive tech to ignore the park behind the paper, but
     it does NOT move focus — so a keyboard or switch user opened a modal map
     and went on tabbing through the buttons underneath it, unable to see what
     they were on. Focus comes here, and goes back where it was afterwards. */
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (open) {
      announce("the fold-out map is open.");
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) returnFocusTo.current = active;
      dialogRef.current?.focus();
      const arm = window.setTimeout(() => setArmed(true), reduced ? 0 : 520);
      return () => window.clearTimeout(arm);
    }
    const back = returnFocusTo.current;
    returnFocusTo.current = null;
    if (back?.isConnected) back.focus();
    // Stay mounted until the paper has finished folding away.
    closeTimer.current = window.setTimeout(() => setMounted(false), reduced ? 20 : 480);
    return () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); };
  }, [open, reduced]);

  useHotkey("escape", onClose, open);
  useHotkey("m", onClose, open);

  const handlePlace = useCallback((p: ParkPlace) => {
    if (speak) narrate(p.blurb);
    announce(p.blurb);
    onTravel?.(p.stop);
  }, [speak, onTravel]);

  if (!mounted) return null;

  const panels = [0, 1, 2];

  return (
    <Scrim onDismiss={onClose} zIndex={45} className={className}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="cp-map-stage"
        style={{ width: MAP_BLOCK.w * scale, height: MAP_BLOCK.h * scale, ...style }}
        role="dialog"
        aria-modal="true"
        aria-label="the fold-out park map"
      >
        <div
          style={{
            width: MAP_BLOCK.w,
            height: MAP_BLOCK.h,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        >
          <div className="cp-map cp-map-frame" data-state={open ? "open" : "closing"} style={{ width: MAP_SIZE.w }}>
            {/* the hand-lettered title, pinned above the paper */}
            <div className="cp-map-title">
              <StorybookHeading as="h2" size="lg" seed={303} color={css(PALETTE.creamPale)}>
                {title}
              </StorybookHeading>
            </div>

            <div className="cp-map-flip">
              <div className="cp-map-sheet" style={{ width: MAP_SIZE.w, height: MAP_SIZE.h }}>
                {panels.map((i) => {
                  const isLeft = i === 0, isRight = i === 2;
                  return (
                    <div
                      key={i}
                      className={`cp-map-panel${isLeft ? " cp-map-panel-l" : ""}${isRight ? " cp-map-panel-r" : ""}`}
                      style={{ width: PANEL_W, height: MAP_SIZE.h }}
                    >
                      <div className="cp-map-art" style={{ left: -i * PANEL_W }}>
                        <ParkMapArt here={here} visited={visited} />
                      </div>
                      {!isRight ? <span className="cp-map-crease cp-map-crease-r" /> : null}
                      {!isLeft ? <span className="cp-map-crease cp-map-crease-l" /> : null}
                    </div>
                  );
                })}
              </div>

              {/* THE HIT TARGETS.
                  Deliberately above the folding panels rather than inside them:
                  a target that straddles a crease would otherwise have to be cut
                  in two and pressed in two halves. They fade in only once the
                  paper is flat — there is nothing to press mid-fold. */}
              <div className="cp-map-hits" style={{ pointerEvents: armed ? "auto" : "none" }}>
                {PARK_PLACES.map((p) => {
                  const v = ATTRACTIONS[p.stop];
                  const m = worldToMap(v.x, v.z);
                  /* The targets live INSIDE the scaled block, so their real
                     on-screen size shrinks with the fit. Grow them locally to
                     keep the floor honoured in actual pixels — on a phone the
                     gate's 64px target would otherwise land at 38px, which is
                     not a target a five-year-old can hit. */
                  const want = p.isAttraction ? TOUCH.hero : TOUCH.min;
                  const grown = Math.max(want, Math.min(TOUCH.hero, TOUCH.min / scale));
                  // ...but never so grown that it overlaps the next place along.
                  const d = Math.min(grown, HIT_CEILING[p.stop]);
                  return (
                    <PaintedPress
                      key={p.stop}
                      className="cp-map-hit"
                      label={`${p.name}. ${p.blurb}`}
                      onPress={() => handlePlace(p)}
                      style={{ left: m.x - d / 2, top: m.y - d / 2, width: d, height: d }}
                    >
                      {/* The artwork underneath IS the button's face; this is
                          just the reachable, focusable, correctly-sized area. */}
                      <span style={{ display: "block", width: d, height: d }} />
                    </PaintedPress>
                  );
                })}

              </div>
            </div>

            <div className="cp-map-foot">
              <WoodButton tone="honey" size="comfy" onPress={onClose} speak="fold it away">
                fold it away
              </WoodButton>
            </div>
          </div>
        </div>
      </div>
    </Scrim>
  );
}
