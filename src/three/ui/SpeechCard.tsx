"use client";

/**
 * WHERE CHESSPAA'S WORDS APPEAR.
 *
 * A warm parchment card with his little painted portrait, text that types on
 * at the pace of a person talking, and the two buttons that make this park
 * safe to be bad at:
 *
 *     "want to see a sparkle?"     — a hint, offered, never pushed
 *     "shall we try that again?"   — a takeback, always available
 *
 * Three problems this file exists to solve, in order of how much they matter:
 *
 * 1. LEGIBILITY OVER A BUSY PAINTING. The card floats over a cel-shaded dusk
 *    valley full of cream snow and honey lanterns. Cream type on cream snow is
 *    invisible. So the card carries its own dark halo (`.cp-card::after`), its
 *    own ink outline, and it never, ever sits centre-screen where the board is.
 *
 * 2. THE PACE OF SPEECH. A typewriter that emits one character every N ms
 *    reads like a fax machine. Real speech has rhythm — it lingers on commas,
 *    it stops at full stops, it rushes through short words. So each character
 *    carries its own cost, and the reveal follows those costs.
 *
 * 3. NEVER MAKE A CHILD WAIT. Tapping the card finishes the line instantly.
 *    A five-year-old who has already read it should never be held hostage by
 *    an animation.
 */

import {
  useCallback, useEffect, useId, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from "react";

import { PALETTE, css, mix } from "@/three/core/palette";
import { TOUCH, useReducedMotion, useSpokenText, squareMark } from "@/lib/a11y";
import {
  WoodButton, PaintedIcon, StorybookHeading,
  ensureStyleSheet, useStorybookSkin,
} from "./StorybookUI";

/* ==================================================================== */
/* MOOD                                                                  */
/* ==================================================================== */

/**
 * Matches the four tones in `lib/audio/chessPaaVoice` by string value, so a
 * caller can hand the same word to both his voice and his face without a
 * translation table. Kept as a local union rather than an import: this card
 * must render on a device with no audio at all.
 */
export type SpeechMood = "warm" | "delighted" | "caring" | "teaching";

interface MoodLook {
  /** Lantern glow behind the portrait. */
  glow: number;
  /** Eyebrow lift in px, and the tilt of the inner end in degrees. */
  brow: number;
  browAngle: number;
  /**
   * Extra lift on the LEFT brow only, in px.
   *
   * The one-brow-up face is what "let me explain something" looks like, and it
   * is the only cheap way to tell `teaching` from `warm` at 74px — they were
   * separated by a lantern hue and three degrees of tilt, which is to say they
   * were not separated at all.
   */
  browAsym: number;
  /** Mouth curve: 1 = big smile, 0 = level, negative = concerned. */
  smile: number;
  /** Open, laughing mouth — only when he is really pleased. */
  open: boolean;
  /** Happy closed-arc eyes instead of round ones. */
  archEyes: boolean;
  /** Head tilt in degrees. */
  tilt: number;
  /** Plain English for the alt text. "ChessPaa looks teaching" is not English. */
  word: string;
}

/**
 * The four faces.
 *
 * Expression has to survive at 74px behind a large white beard, which throws
 * out almost every subtlety. What survives is: BROW HEIGHT, BROW ANGLE, and
 * whether the eyes are round or arched. Those three do nearly all the work
 * here; the mouth is a supporting player because the moustache eats it.
 */
const MOOD: Record<SpeechMood, MoodLook> = {
  warm:      { glow: PALETTE.honey,       brow:  0,  browAngle:  0,  browAsym: 0,   smile: 0.7,  open: false, archEyes: false, tilt: -1.5, word: "happy" },
  delighted: { glow: PALETTE.lanternCore, brow: -5,  browAngle: -8,  browAsym: 0,   smile: 1.0,  open: true,  archEyes: true,  tilt: -5.5, word: "delighted" },
  // Inner ends UP and brows slightly lifted. Positive browAngle DROPS the inner
  // end, which by the note on the brow paths below is glee — so the one face a
  // child sees right after a mistake was rendering as a frown. It is sympathy.
  caring:    { glow: PALETTE.plum,        brow: -1,  browAngle: -15, browAsym: 0,   smile: 0.05, open: false, archEyes: false, tilt:  4.5, word: "gentle" },
  // One brow up, head cocked the other way: the "now, watch this" face.
  // icePale, not teal: teal over the warm sky disc mixes to a sickly khaki, and
  // an olive halo on a grandfather's face is the one thing the art direction
  // forbids outright. Pale ice still reads cool against three honey moods.
  teaching:  { glow: PALETTE.icePale,     brow:  0,  browAngle: -2,  browAsym: -6,  smile: 0.35, open: false, archEyes: false, tilt: -3.5, word: "thoughtful" },
};

/* ==================================================================== */
/* THE PORTRAIT                                                          */
/* ==================================================================== */

const PORTRAIT_STYLE_ID = "cp-speech-card";

const SPEECH_CSS = `
.cp-speech {
  position: fixed; z-index: 30;
  display: flex; flex-direction: column; gap: 0;
  pointer-events: none;              /* the park stays clickable around it */
}
.cp-speech > * { pointer-events: auto; }
.cp-speech-bl { left: max(20px, env(safe-area-inset-left)); bottom: max(20px, env(safe-area-inset-bottom)); }
.cp-speech-br { right: max(20px, env(safe-area-inset-right)); bottom: max(20px, env(safe-area-inset-bottom)); }
.cp-speech-bc { left: 50%; transform: translateX(-50%); bottom: max(20px, env(safe-area-inset-bottom)); }
.cp-speech-inline { position: relative; }

.cp-speech-body { display: flex; gap: 16px; align-items: flex-start; }
.cp-speech-text {
  font-size: 20px; line-height: 1.42; font-weight: 700;
  color: ${css(PALETTE.ink)};
  /* A whisper of warm relief under the type, so it reads as painted onto the
     parchment rather than laid on top of it. */
  text-shadow: 0 1px 0 rgba(255,250,236,0.85);
  min-height: 2.9em;                 /* the card must not jump as text grows */
  overflow-wrap: break-word;
}
.cp-speech-caret {
  display: inline-block; width: 0.42em; height: 1.05em;
  margin-left: 2px; vertical-align: -0.16em;
  border-radius: 4px 5px 4px 6px;
  background: ${css(PALETTE.honeyDeep)};
  animation: cp-caret 780ms steps(1, end) infinite;
}
@keyframes cp-caret { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0.15; } }

.cp-speech-name {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 4px;
}
.cp-speech-actions {
  display: flex; flex-wrap: wrap; gap: ${TOUCH.gap}px;
  margin-top: 16px;
}

/* The little tail that points back at the grandfather who is talking.
   Without it the card belongs to the operating system; with it, to him. */
/* The ink has to be a drop-shadow stack, not an inset box-shadow: an inset
   shadow is drawn INSIDE the element box and then clipped away by clip-path,
   so the long diagonal — the only edge anyone looks at — came out as a raw
   cream slope with no outline, on a card whose every other edge is inked.
   A filter runs AFTER the clip, so it traces the actual triangle. */
.cp-speech-tail {
  position: absolute; width: 30px; height: 22px;
  background: ${css(PALETTE.cream)};
  clip-path: polygon(0 0, 100% 0, 22% 100%);
  filter:
    drop-shadow(1.5px 0 0 rgba(46,30,40,0.62)) drop-shadow(-1.5px 0 0 rgba(46,30,40,0.62))
    drop-shadow(0 1.5px 0 rgba(46,30,40,0.62)) drop-shadow(0 -1.5px 0 rgba(46,30,40,0.62));
}
.cp-speech-tail-left { left: 34px; bottom: -19px; }
.cp-speech-tail-right { right: 34px; bottom: -19px; transform: scaleX(-1); }

.cp-portrait { display: block; flex: none; }
.cp-portrait-blink { animation: cp-blink 5.4s ease-in-out infinite; transform-origin: center; }
@keyframes cp-blink {
  0%, 92%, 100% { transform: scaleY(1); }
  95%           { transform: scaleY(0.06); }
}

@media (max-width: 700px) {
  .cp-speech-bl, .cp-speech-br, .cp-speech-bc {
    left: 12px; right: 12px; transform: none;
    bottom: max(12px, env(safe-area-inset-bottom));
  }
  .cp-speech-text { font-size: 18px; }
}
@media (prefers-reduced-motion: reduce) {
  .cp-portrait-blink, .cp-speech-caret { animation: none !important; }
}
`;

export interface ChessPaaPortraitProps {
  size?: number;
  mood?: SpeechMood;
  /** Turn the idle blink off (screenshots, reduced motion). */
  still?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * ChessPaa's little painted portrait, drawn in code.
 *
 * Cel language on purpose: flat fills, ONE warm lit band, a fat warm-ink
 * outline — the 2D equivalent of the toon ramp and the inverted hull, so the
 * face in the card and the man in the park are recognisably the same person.
 *
 * The lantern behind his shoulder is the mood channel: it warms to honey when
 * he is pleased, cools to plum when he is being careful with you.
 */
export function ChessPaaPortrait({
  size = 74, mood = "warm", still = false, className = "", style,
}: ChessPaaPortraitProps) {
  useStorybookSkin();
  const reduced = useReducedMotion();
  const look = MOOD[mood];
  const ink = css(PALETTE.ink);
  const blink = !still && !reduced;
  // Per-instance SVG ids. Two portraits on one screen (the card and a HUD
  // corner) used to publish the same `id`, and `url(#…)` silently resolves to
  // whichever came first in the document — so one unmounting broke the other.
  const uid = useId().replace(/:/g, "");
  const clipId = `cp-pt-clip-${uid}`;
  const glowId = `cp-pt-glow-${uid}`;

  // Only the LEFT brow takes the asymmetry, so `teaching` is a one-brow-up
  // face rather than a slightly-different-eyebrow-height face.
  const browL = look.brow + look.browAsym;
  const browR = look.brow;

  // Mouth: one quadratic curve whose control point carries the whole emotion.
  const mouthY = 71;
  const mouthCtrl = mouthY + 9 * look.smile;

  return (
    <svg
      className={`cp-portrait ${className}`}
      width={size} height={size} viewBox="-9 -9 118 118"
      role="img" aria-label={`ChessPaa looks ${look.word}`}
      style={style}
    >
      <defs>
        <clipPath id={clipId}><circle cx="50" cy="50" r="45" /></clipPath>
        <radialGradient id={glowId}>
          <stop offset="55%" stopColor={css(look.glow)} stopOpacity="0.85" />
          <stop offset="100%" stopColor={css(look.glow)} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* THE MOOD LANTERN.
          It has to sit OUTSIDE the wooden frame — inside, the frame covers it
          entirely and every mood renders identically, which is how the first
          pass looked. Hence the oversized viewBox. */}
      <circle cx="50" cy="50" r="57" fill={`url(#${glowId})`} />

      {/* the wooden locket frame */}
      <circle cx="50" cy="50" r="46" fill="none" stroke={css(PALETTE.walnut)} strokeWidth="7" />
      <circle cx="50" cy="50" r="46" fill="none" stroke={ink} strokeWidth="3" />
      {/* the sky behind him takes the mood too, gently */}
      <circle cx="50" cy="50" r="42" fill={css(mix(mix(PALETTE.skyHorizon, PALETTE.honey, 0.35), look.glow, 0.28))} />

      <g clipPath={`url(#${clipId})`} transform={`rotate(${look.tilt} 50 54)`}>
        {/* scarf — the one place scarfRed is allowed */}
        <path d="M22,96 Q50,78 78,96 L78,104 L22,104 Z" fill={css(PALETTE.scarfRed)} stroke={ink} strokeWidth="3" />
        <path d="M22,96 Q50,78 78,96" fill="none" stroke={css(mix(PALETTE.scarfRed, PALETTE.lanternCore, 0.4))} strokeWidth="3" opacity="0.65" />

        {/* face */}
        <ellipse cx="50" cy="56" rx="27" ry="29" fill={css(mix(PALETTE.cream, PALETTE.honey, 0.28))} stroke={ink} strokeWidth="3.4" />
        {/* the single lit band, top-left, matching the low sun */}
        <path d="M23,52 Q34,26 62,29 Q40,34 34,58 Z" fill={css(PALETTE.lanternCore)} opacity="0.5" />

        {/* beard: three plush lobes, big enough to be the silhouette */}
        <path
          d="M25,58 Q22,92 50,97 Q78,92 75,58 Q70,80 50,82 Q30,80 25,58 Z"
          fill={css(PALETTE.snow)} stroke={ink} strokeWidth="3.4" strokeLinejoin="round"
        />
        <path d="M36,74 Q50,86 64,74" fill="none" stroke={css(PALETTE.snowShadow)} strokeWidth="2.6" opacity="0.8" />

        {/* moustache */}
        <path d="M34,66 Q42,60 50,64 Q58,60 66,66 Q58,72 50,69 Q42,72 34,66 Z"
              fill={css(PALETTE.snow)} stroke={ink} strokeWidth="2.8" strokeLinejoin="round" />

        {/* mouth, under the moustache. Open and laughing when he is delighted. */}
        {look.open ? (
          <path d={`M41,${mouthY - 1} Q50,${mouthY + 12} 59,${mouthY - 1} Q50,${mouthY + 3} 41,${mouthY - 1} Z`}
                fill={css(mix(PALETTE.scarfRed, PALETTE.ink, 0.45))} stroke={ink} strokeWidth="2.4" strokeLinejoin="round" />
        ) : (
          <path d={`M42,${mouthY} Q50,${mouthCtrl} 58,${mouthY}`} fill="none" stroke={ink} strokeWidth="2.8" strokeLinecap="round" />
        )}

        {/* eyes — the twinkle is a single offset highlight, and it is the
            whole character. Without it he is a snowman in a hat. */}
        <g className={blink ? "cp-portrait-blink" : undefined}>
          {look.archEyes ? (
            <>
              {/* squeezed-shut happy arcs. Nothing else says "delighted" this
                  fast on a face this small. */}
              <path d="M34.5,54 Q40,46 45.5,54" fill="none" stroke={ink} strokeWidth="3.6" strokeLinecap="round" />
              <path d="M54.5,54 Q60,46 65.5,54" fill="none" stroke={ink} strokeWidth="3.6" strokeLinecap="round" />
            </>
          ) : (
            <>
              <ellipse cx="40" cy="52" rx="4.6" ry="5" fill={ink} />
              <ellipse cx="60" cy="52" rx="4.6" ry="5" fill={ink} />
              <circle cx="41.8" cy="50.2" r="1.7" fill={css(PALETTE.creamPale)} />
              <circle cx="61.8" cy="50.2" r="1.7" fill={css(PALETTE.creamPale)} />
            </>
          )}
        </g>

        {/* eyebrows — height AND inner-end angle. A brow whose inner end lifts
            is concern; one whose inner end drops is glee. That single degree
            of freedom carries more emotion than the whole rest of the face. */}
        {/* INK FIRST, FATTER — the same fat-outline-underneath trick the beard
            and the moustache already use, and for the same reason: snow on a
            cream face is about 1.25:1 contrast, which is to say invisible. The
            previous pass tried a 1.4px half-opacity line offset BELOW the brow
            instead, and at 74px the brows rendered as two faint smudges — the
            one channel this whole face's expression is built on, lost. */}
        {[
          `M32,${43 + browL} Q39,${37 + browL} 47,${42 + browL + look.browAngle * 0.28}`,
          `M53,${42 + browR + look.browAngle * 0.28} Q61,${37 + browR} 68,${43 + browR}`,
        ].map((d, i) => (
          <g key={i}>
            <path d={d} fill="none" stroke={ink} strokeWidth="8.4" strokeLinecap="round" />
            <path d={d} fill="none" stroke={css(PALETTE.snow)} strokeWidth="5" strokeLinecap="round" />
          </g>
        ))}

        {/* nose */}
        <ellipse cx="50" cy="59" rx="5.4" ry="4.4" fill={css(mix(PALETTE.cream, PALETTE.scarfRed, 0.26))} stroke={ink} strokeWidth="2.4" />

        {/* THE KNITTED CAP, WORN SIX UNITS HIGHER THAN IT WAS.
            The brim used to land at y≈45 with the eyes topping out at y≈47,
            which left a two-pixel band for the eyebrows — so the cap painted
            straight over them and `warm` and `delighted` rendered browless.
            Measured on a capture: the whole channel this face's expression is
            built on was invisible. Now the brim clears the brow arc. */}
        <path d="M20,36 Q26,4 50,4 Q74,4 80,36 Q50,26 20,36 Z"
              fill={css(PALETTE.plum)} stroke={ink} strokeWidth="3.4" strokeLinejoin="round" />
        <path d="M20,36 Q50,26 80,36 L80,43 Q50,33 20,43 Z"
              fill={css(PALETTE.creamPale)} stroke={ink} strokeWidth="3" strokeLinejoin="round" />
        <circle cx="50" cy="2" r="8" fill={css(PALETTE.creamPale)} stroke={ink} strokeWidth="3" />
        <path d="M28,20 Q50,12 72,20" fill="none" stroke={css(PALETTE.plumDeep)} strokeWidth="2.6" opacity="0.75" />
      </g>
    </svg>
  );
}

/* ==================================================================== */
/* THE TYPEWRITER                                                        */
/* ==================================================================== */

/**
 * How long each character dwells before the next one appears.
 *
 * WHY per-character costs: an even tick reads as machinery. Punctuation is
 * where a person BREATHES, and reproducing that is most of the difference
 * between "text appearing" and "a grandfather talking". Spaces are nearly
 * free so short words tumble out the way they do in speech.
 */
function charCost(ch: string, base: number): number {
  switch (ch) {
    case ".": case "!": case "?": return base * 11;
    case ",": case ";": case ":": return base * 6;
    case "—": case "…": return base * 8;
    case " ": return base * 0.45;
    case "\n": return base * 9;
    default: return base;
  }
}

export interface TypewriterState {
  /** The portion of the line revealed so far. */
  shown: string;
  /** True once the whole line is on screen. */
  done: boolean;
  /** Skip to the end. Wired to a tap on the card. */
  finish: () => void;
}

/**
 * Reveal `text` at the pace of speech.
 *
 * Driven by rAF against elapsed time rather than a setInterval per character:
 * a stalled frame (shader compile, a ride starting) must not desynchronise the
 * reveal from the narration reading the same line aloud.
 */
export function useTypewriter(
  text: string,
  { enabled = true, charMs = 24 }: { enabled?: boolean; charMs?: number } = {},
): TypewriterState {
  const reduced = useReducedMotion();
  const active = enabled && !reduced;
  const [count, setCount] = useState(active ? 0 : text.length);
  const rafRef = useRef<number | null>(null);

  // Cumulative reveal times, recomputed only when the line changes.
  const schedule = useMemo(() => {
    const out: number[] = new Array(text.length);
    let t = 0;
    for (let i = 0; i < text.length; i++) {
      t += charCost(text[i], charMs);
      out[i] = t;
    }
    return out;
  }, [text, charMs]);

  useEffect(() => {
    if (!active) { setCount(text.length); return; }
    setCount(0);
    const start = performance.now();
    let i = 0;
    const step = (now: number) => {
      const elapsed = now - start;
      while (i < schedule.length && schedule[i] <= elapsed) i++;
      setCount(i);
      if (i < schedule.length) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [schedule, active, text.length]);

  const finish = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    setCount(text.length);
  }, [text.length]);

  return { shown: text.slice(0, count), done: count >= text.length, finish };
}

/* ==================================================================== */
/* THE CARD                                                             */
/* ==================================================================== */

export type SpeechAnchor = "bottom-left" | "bottom-right" | "bottom-center" | "inline";

export interface SpeechCardProps {
  /** What he is saying. Changing this restarts the reveal and the narration. */
  text: string;
  /** Whose voice this is. Only ever ChessPaa today; a slot, not a feature. */
  speakerName?: string;
  mood?: SpeechMood;
  /**
   * Where it sits.
   *
   * Default is bottom-LEFT and that is a real decision, not a default: the
   * board lives centre-screen and ChessPaa stands to the child's left. A card
   * that covers the board is a card that stops the game.
   */
  anchor?: SpeechAnchor;
  /** Cap in px. The card also caps itself against the viewport. */
  maxWidth?: number;

  /** "want to see a sparkle?" — the hint. Omit and no hint button appears. */
  onHint?: () => void;
  hintLabel?: string;
  /** "shall we try that again?" — the takeback. Always offer it after a wobble. */
  onTakeback?: () => void;
  takebackLabel?: string;
  /** Anything else this moment needs: "ride again", "next puzzle". */
  extra?: ReactNode;
  /** The quiet way out. */
  onDismiss?: () => void;
  dismissLabel?: string;

  /** Read the line aloud for pre-readers. Honours the global voice switch. */
  speak?: boolean;
  /** Type the line on. Off → it simply appears. */
  typing?: boolean;
  /** ms per ordinary character. 24 is roughly a warm reading pace. */
  charMs?: number;
  /** Fires once the whole line is on screen. */
  onTypedOut?: () => void;

  /** A grade badge, a sticker, a painted mark — sits by his name. */
  badge?: ReactNode;
  /** Slide the card away without unmounting (keeps his voice's state). */
  hidden?: boolean;
  className?: string;
  style?: CSSProperties;
}

const ANCHOR_CLASS: Record<SpeechAnchor, string> = {
  "bottom-left": "cp-speech-bl",
  "bottom-right": "cp-speech-br",
  "bottom-center": "cp-speech-bc",
  inline: "cp-speech-inline",
};

/**
 * ChessPaa's speech card.
 *
 * ```tsx
 * <SpeechCard
 *   text={chessPaaSays(facts)}
 *   mood="caring"
 *   onHint={() => board.showBestMove()}
 *   onTakeback={() => game.undo()}
 * />
 * ```
 *
 * KID-SAFETY NOTE: there is no text input anywhere on this card and no way to
 * add one. A child can press his buttons; a child cannot type into the park,
 * and so nothing a child does can leave this device.
 */
export default function SpeechCard({
  text,
  speakerName = "ChessPaa",
  mood = "warm",
  anchor = "bottom-left",
  maxWidth = 440,
  onHint,
  hintLabel = "want to see a sparkle?",
  onTakeback,
  takebackLabel = "shall we try that again?",
  extra,
  onDismiss,
  dismissLabel = "off we go!",
  speak = true,
  typing = true,
  charMs = 24,
  onTypedOut,
  badge,
  hidden = false,
  className = "",
  style,
}: SpeechCardProps) {
  useStorybookSkin();
  useEffect(() => { ensureStyleSheet(PORTRAIT_STYLE_ID, SPEECH_CSS); }, []);
  const reduced = useReducedMotion();

  const { shown, done, finish } = useTypewriter(text, { enabled: typing, charMs });

  // Narration reads the WHOLE line as soon as it changes, deliberately not in
  // step with the reveal: hearing a word a beat before seeing it is how a
  // grown-up reading aloud actually sounds, and a pre-reader is listening
  // anyway.
  useSpokenText(text, { active: speak });

  const firedFor = useRef<string | null>(null);
  useEffect(() => {
    if (done && firedFor.current !== text) {
      firedFor.current = text;
      onTypedOut?.();
    }
  }, [done, text, onTypedOut]);

  const hintMark = squareMark("hint");
  const tail = anchor === "bottom-right" ? "cp-speech-tail-right" : "cp-speech-tail-left";

  return (
    <div
      className={`cp-root cp-speech ${ANCHOR_CLASS[anchor]} ${className}`}
      style={{
        width: `min(${maxWidth}px, calc(100vw - 32px))`,
        // Hiding slides it down and fades — it never just vanishes, because a
        // thing that vanishes was never really there.
        transform: hidden
          ? `${anchor === "bottom-center" ? "translateX(-50%) " : ""}translateY(140%)`
          : anchor === "bottom-center" ? "translateX(-50%)" : undefined,
        opacity: hidden ? 0 : 1,
        transition: reduced ? "none" : "transform 420ms cubic-bezier(.2,.9,.3,1.2), opacity 300ms ease-out",
        ...style,
      }}
      // `inert` as well as `aria-hidden`: a slid-away card is still in the tab
      // order otherwise, and a keyboard child ends up pressing "want to see a
      // sparkle?" on a card that is off the bottom of the screen.
      inert={hidden}
      aria-hidden={hidden}
    >
      <div
        className={`cp-card cp-card-lift${reduced ? "" : " cp-pop"}`}
        style={{ position: "relative", padding: "18px 22px 20px" }}
        // Tap anywhere on the card to skip the reveal. Never make a child wait
        // for an animation they have already read past.
        onPointerDown={done ? undefined : finish}
      >
        {/* THE LIVE REGION IS THIS SPAN, AND ONLY THIS SPAN.
            It used to be the whole card (`role="status" aria-atomic`), which
            meant every character the typewriter added re-announced the entire
            card — portrait alt text, his name, both button labels — sixty
            times a second. A screen-reader child got a stammer, not a sentence.
            One hidden span holding the FINISHED line changes exactly once per
            line, so they hear it once, whole. */}
        <span className="cp-sr" role="status" aria-live="polite" aria-atomic="true">{text}</span>

        {anchor !== "inline" ? <span className={`cp-speech-tail ${tail}`} aria-hidden="true" /> : null}

        <div className="cp-speech-body">
          <ChessPaaPortrait size={78} mood={mood} still={reduced} />

          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="cp-speech-name">
              <StorybookHeading as="span" size="sm" seed={7} color={css(mix(PALETTE.walnut, PALETTE.ink, 0.3))}>
                {speakerName}
              </StorybookHeading>
              {badge}
            </div>

            {/* The words, revealed at the pace of speech. */}
            {/* Hidden from assistive tech: the span above is what speaks. */}
            <p className="cp-speech-text" style={{ margin: 0 }} aria-hidden="true">
              {shown}
              {!done ? <span className="cp-speech-caret" aria-hidden="true" /> : null}
            </p>
          </div>
        </div>

        {(onHint || onTakeback || extra || onDismiss) ? (
          <div className="cp-speech-actions">
            {onHint ? (
              <WoodButton
                tone="honey"
                onPress={onHint}
                speak={hintLabel}
                icon={<PaintedIcon mark={hintMark} size={24} twinkle />}
              >
                {hintLabel}
              </WoodButton>
            ) : null}

            {onTakeback ? (
              <WoodButton tone="cream" onPress={onTakeback} speak={takebackLabel} icon={<span>↺</span>}>
                {takebackLabel}
              </WoodButton>
            ) : null}

            {extra}

            {onDismiss ? (
              <WoodButton tone="quiet" onPress={onDismiss} speak={dismissLabel}>
                {dismissLabel}
              </WoodButton>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ==================================================================== */
/* THE TWO STOCK OFFERS                                                  */
/* ==================================================================== */

/**
 * The exact words, in one place, so every screen offers help in the same
 * voice.
 *
 * These are OFFERS, and the phrasing is the whole point. "Hint" is a
 * confession of failure; "want to see a sparkle?" is an invitation. "Undo" is
 * an admin action; "shall we try that again?" is a grandfather holding the
 * door open. The park has no fail state, so nothing here may ever imply one.
 */
export const OFFERS = {
  hint: "want to see a sparkle?",
  takeback: "shall we try that again?",
  onward: "off we go!",
  again: "again! again!",
  /** When a child has been stuck a while — offered, never forced. */
  showMe: "would you like me to show you?",
} as const;
