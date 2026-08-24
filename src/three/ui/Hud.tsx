"use client";

/**
 * THE HUD, WHICH IS ALMOST NOTHING.
 *
 * One small wooden park token, hanging in a corner. That is the entire
 * heads-up display.
 *
 * What is deliberately absent, and must stay absent:
 *   • NO TIMER. Nothing in this park is ever counting down at a child.
 *   • NO SCORE. The token shows five little lamps for the five wonders — a
 *     picture of where you have BEEN, not a number of how well you did.
 *   • NO LEVEL, NO STREAK, NO XP BAR. Those are engagement mechanics; this is
 *     a grandfather with a lantern.
 *   • NO MINIMAP, NO OBJECTIVE TEXT, NO NOTIFICATION STACK.
 *
 * And it disappears completely on one key. `H` hides it, and with it hidden
 * the park is untouched — no ghost outline, no docked tab, no faded chrome.
 * The painting gets the whole screen. Pressing `H` again brings it back, and
 * because a child who cannot read cannot know that, hiding it says so out
 * loud once, on a warm little card, and then gets out of the way.
 */

import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties,
} from "react";

import { PALETTE, css, mix } from "@/three/core/palette";
import {
  TOUCH, announce, narrate, useHotkey, useReducedMotion, markPath,
} from "@/lib/a11y";
import {
  UI, PaintedPress, ensureStyleSheet, useStorybookSkin, ParchmentCard,
} from "./StorybookUI";

/** The one key. Documented here so other surfaces do not steal it. */
export const HUD_HOTKEY = "h";

/** Where the child's choice lives between visits. */
const HUD_PREF_KEY = "chesspaa:hud";

const HUD_STYLE_ID = "cp-hud";

const HUD_CSS = `
.cp-hud {
  position: fixed; z-index: 25;
  pointer-events: none;
}
.cp-hud > * { pointer-events: auto; }
.cp-hud-tl { left: max(18px, env(safe-area-inset-left)); top: max(18px, env(safe-area-inset-top)); }
.cp-hud-tr { right: max(18px, env(safe-area-inset-right)); top: max(18px, env(safe-area-inset-top)); }

/* The token hangs off a little nail and breathes. Very slow, very small —
   at this amplitude you do not notice it moving, you only notice that the
   corner of the screen is alive. */
.cp-token-swing { animation: cp-token-swing 7.5s ease-in-out infinite; transform-origin: 50% 4%; }
@keyframes cp-token-swing {
  0%, 100% { transform: rotate(-2.2deg); }
  50%      { transform: rotate(2.2deg); }
}
.cp-token-core { animation: cp-token-core 3.4s ease-in-out infinite; transform-origin: center; }
@keyframes cp-token-core {
  0%, 100% { opacity: 0.72; transform: scale(1); }
  50%      { opacity: 1;    transform: scale(1.09); }
}
/* The little celebration when a wonder lights up for the first time. */
.cp-token-cheer { animation: cp-token-cheer 900ms cubic-bezier(.2,.9,.3,1.5); transform-origin: 50% 6%; }
@keyframes cp-token-cheer {
  0%   { transform: scale(1) rotate(0deg); }
  28%  { transform: scale(1.22) rotate(-9deg); }
  56%  { transform: scale(0.97) rotate(6deg); }
  80%  { transform: scale(1.06) rotate(-2deg); }
  100% { transform: scale(1) rotate(0deg); }
}

.cp-hud-whisper {
  position: fixed; z-index: 26;
  left: 50%; transform: translateX(-50%);
  bottom: max(28px, env(safe-area-inset-bottom));
  max-width: min(430px, calc(100vw - 32px));
  text-align: center; font-size: 18px; font-weight: 700; line-height: 1.35;
  animation: cp-whisper 4.4s ease-out forwards;
  pointer-events: none;
}
@keyframes cp-whisper {
  0%   { opacity: 0; transform: translateX(-50%) translateY(14px) scale(0.94); }
  12%  { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
  72%  { opacity: 1; }
  100% { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(0.98); }
}

@media (prefers-reduced-motion: reduce) {
  .cp-token-swing, .cp-token-core, .cp-token-cheer { animation: none !important; }
  .cp-hud-whisper { animation: none !important; opacity: 1; }
}
`;

/* ==================================================================== */
/* THE TOKEN                                                             */
/* ==================================================================== */

export interface ProgressTokenProps {
  /** How many wonders have been visited. */
  found: number;
  /** How many there are. Five, in this park. */
  total?: number;
  size?: number;
  /** Skip the idle sway and the lantern pulse. */
  still?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * A wooden park token with ChessPaa's lantern on it, ringed by one small lamp
 * per wonder.
 *
 * COLOURBLIND-SAFE BY SHAPE: a lamp that is lit is a filled STAR; a lamp not
 * yet lit is a hollow RING. Colour agrees with that (honey vs cocoa) but never
 * carries it alone — in greyscale, in deuteranopia, and on a washed-out screen
 * in a sunlit room, star-versus-ring still reads instantly.
 *
 * Everything is drawn here in code, in the same cel language as the park:
 * flat fills, one lit band, a fat warm-ink outline.
 */
export function ProgressToken({
  found, total = 5, size = 78, still = false, className = "", style,
}: ProgressTokenProps) {
  const ink = css(PALETTE.ink);
  const litPath = markPath("star", 100);
  const dimPath = markPath("ring", 100);

  /* Lamps around the rim, starting at the top and going clockwise.

     Centred on the DISC (50,52) at r=36, not on the viewBox at r=37: the disc
     sits 2px low to leave room for its nail, so a ring centred on the box put
     the twelve-o'clock lamp's top point through the nail head and out past the
     wooden rim. Measured: the star tip landed at y≈5.6 with the rim's outer
     ink edge at y≈6.75. */
  const lamps = Array.from({ length: total }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / total;
    return { x: 50 + Math.cos(a) * 36, y: 52 + Math.sin(a) * 36, lit: i < found, key: i };
  });

  return (
    <svg
      className={className}
      width={size} height={size} viewBox="0 0 100 100"
      aria-hidden="true" style={style}
    >
      {/* the nail it hangs from */}
      <circle cx="50" cy="4" r="3.2" fill={css(PALETTE.honeyDeep)} stroke={ink} strokeWidth="2" />

      {/* the wooden disc */}
      <circle cx="50" cy="52" r="43" fill={css(PALETTE.walnut)} stroke={ink} strokeWidth="4.5" />
      {/* one lit band across the top-left, matching the low sun */}
      <path d="M12,48 A43,43 0 0 1 66,12 A38,38 0 0 0 15,60 Z" fill={css(PALETTE.walnutLight)} opacity="0.85" />
      {/* brass inner ring */}
      <circle cx="50" cy="52" r="30" fill={css(mix(PALETTE.walnut, PALETTE.cocoa, 0.45))} stroke={css(PALETTE.honeyDeep)} strokeWidth="2.6" />

      {/* THE LANTERN — the park's whole promise in eleven vector ops */}
      <g transform="translate(50 52)">
        <path d="M-2.6,-19 Q0,-23 2.6,-19" fill="none" stroke={css(PALETTE.honeyDeep)} strokeWidth="2.2" />
        <rect x="-9" y="-17" width="18" height="4" rx="1.8" fill={css(PALETTE.honeyDeep)} stroke={ink} strokeWidth="1.8" />
        <path d="M-8,-13 L8,-13 L10,11 L-10,11 Z" fill={css(PALETTE.lanternCore)} stroke={ink} strokeWidth="2.4" strokeLinejoin="round" />
        <ellipse className={still ? undefined : "cp-token-core"} cx="0" cy="0" rx="5" ry="7" fill={css(PALETTE.creamPale)} />
        <rect x="-11" y="11" width="22" height="4.5" rx="2" fill={css(PALETTE.honeyDeep)} stroke={ink} strokeWidth="1.8" />
      </g>

      {/* the lamps */}
      {lamps.map((l) => (
        <g key={l.key} transform={`translate(${l.x - 8} ${l.y - 8}) scale(0.16)`}>
          <path
            d={l.lit ? litPath : dimPath}
            fill={l.lit ? css(PALETTE.lanternCore) : css(mix(PALETTE.cocoa, PALETTE.walnut, 0.4))}
            fillRule="evenodd"
            stroke={ink}
            strokeWidth={l.lit ? 26 : 20}
            strokeLinejoin="round"
            paintOrder="stroke"
          />
        </g>
      ))}
    </svg>
  );
}

/* ==================================================================== */
/* THE HUD                                                               */
/* ==================================================================== */

export interface HudProps {
  /**
   * How many of the park's wonders this child has found. Drives the lamps.
   * There is no other progress signal, on purpose.
   */
  found?: number;
  /** How many wonders there are. Five. */
  total?: number;
  /** Pressing the token — usually "open the fold-out map". Optional. */
  onPress?: () => void;
  /** What the token says when it is pressed or read out. */
  label?: string;
  /** Controlled visibility. Omit to let the HUD remember the child's choice. */
  visible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
  /** The hide key. `H` unless something very good argues otherwise. */
  hotkey?: string;
  corner?: "top-left" | "top-right";
  className?: string;
  style?: CSSProperties;
}

/* The child's show/hide choice, kept as a tiny external store.
   WHY a store and not `useState` + an effect: reading localStorage during
   render would disagree with the server's render, and reading it in an effect
   means a synchronous setState in an effect body — a cascading render, and a
   visible flash of the token appearing after the first paint. A store with an
   explicit server snapshot of `true` has neither problem. */
const hudListeners = new Set<() => void>();

function readStoredVisible(): boolean {
  try {
    return localStorage.getItem(HUD_PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeStoredVisible(v: boolean): void {
  try { localStorage.setItem(HUD_PREF_KEY, v ? "1" : "0"); } catch { /* private mode */ }
  for (const l of hudListeners) {
    try { l(); } catch { /* a bad listener must not take the HUD down */ }
  }
}

function subscribeHud(cb: () => void): () => void {
  hudListeners.add(cb);
  return () => { hudListeners.delete(cb); };
}

/** True when the little token is on screen. Server snapshot is always `true`. */
export function useHudVisible(): boolean {
  return useSyncExternalStore(subscribeHud, readStoredVisible, () => true);
}

/**
 * The whole heads-up display.
 *
 * ```tsx
 * <Hud found={visited.size} onPress={() => setMapOpen(true)} />
 * ```
 *
 * Mount it as a sibling of the R3F <Canvas>. It is a DOM overlay and knows
 * nothing about three.js — which is exactly why it can be switched off without
 * touching the render loop.
 */
export default function Hud({
  found = 0,
  total = 5,
  onPress,
  label = "your park token",
  visible,
  onVisibleChange,
  hotkey = HUD_HOTKEY,
  corner = "top-left",
  className = "",
  style,
}: HudProps) {
  useStorybookSkin();
  useEffect(() => { ensureStyleSheet(HUD_STYLE_ID, HUD_CSS); }, []);
  const reduced = useReducedMotion();

  // Uncontrolled by default, and it remembers. A child (or a parent) who wants
  // the clean picture should not have to ask for it twice.
  const ownVisible = useHudVisible();
  const shown = visible ?? ownVisible;

  // Shown once, right after hiding: the only place the park ever explains a
  // control, and it exists solely so that hiding the HUD can never become a
  // dead end for someone who does not know about `H`.
  const [whisper, setWhisper] = useState<string | null>(null);
  const whisperTimer = useRef<number | null>(null);

  const setShown = useCallback((next: boolean) => {
    if (visible === undefined) writeStoredVisible(next);
    onVisibleChange?.(next);

    const line = next
      ? "your little token is back."
      : `the park is all yours. press ${hotkey.toUpperCase()} whenever you want your token back.`;
    announce(line);
    // announce() only reaches a screen reader. The child this sentence is FOR
    // is the pre-reader who just hid their only signpost and cannot read the
    // card telling them how to get it back — so it has to be said out loud too.
    narrate(line);
    if (!next) {
      setWhisper(line);
      if (whisperTimer.current) window.clearTimeout(whisperTimer.current);
      whisperTimer.current = window.setTimeout(() => setWhisper(null), 4600);
    } else {
      setWhisper(null);
    }
  }, [visible, onVisibleChange, hotkey]);

  useHotkey(hotkey, () => setShown(!shown));
  useEffect(() => () => { if (whisperTimer.current) window.clearTimeout(whisperTimer.current); }, []);

  /* A wonder lighting up deserves a little jump — and a sentence, because a
     pre-reader cannot count the lamps.

     The comparison happens DURING RENDER (React's documented "adjust state
     when a prop changes" pattern) rather than in an effect. Doing it in an
     effect means a synchronous setState in the effect body, which renders the
     un-cheering token first and then immediately re-renders it cheering — a
     visible one-frame stutter on the exact beat that is supposed to feel like
     a celebration. */
  const [seenFound, setSeenFound] = useState(found);
  const [cheerFor, setCheerFor] = useState<number | null>(null);
  if (found !== seenFound) {
    setSeenFound(found);
    if (found > seenFound) setCheerFor(found);
  }
  const cheering = cheerFor !== null;

  useEffect(() => {
    if (cheerFor === null) return;
    const line = cheerFor >= total
      ? "you found every wonder in the whole park!"
      : `that is ${cheerFor} of the ${total} wonders. shall we find another?`;
    announce(line);
    narrate(line);
    const t = window.setTimeout(() => setCheerFor(null), 950);
    return () => window.clearTimeout(t);
  }, [cheerFor, total]);

  const spoken =
    found >= total
      ? `${label}. every wonder is lit.`
      : `${label}. ${found} of ${total} wonders lit.`;

  return (
    <>
      {shown ? (
        <div
          className={`cp-root cp-hud ${corner === "top-left" ? "cp-hud-tl" : "cp-hud-tr"} ${className}`}
          style={style}
        >
          <PaintedPress
            label={spoken}
            speak
            onPress={() => onPress?.()}
            disabled={!onPress}
            style={{
              minWidth: TOUCH.min,
              minHeight: TOUCH.min,
              // A soft dark halo so a warm wooden token stays legible against a
              // bright honey sky. Same trick as the parchment cards.
              filter: "drop-shadow(0 8px 16px rgba(46,30,40,0.45))",
              // A disabled <button> still needs to look alive — it is scenery
              // when there is nothing to open, not a broken control.
              cursor: onPress ? "pointer" : "default",
              opacity: 1,
            }}
          >
            <ProgressToken
              found={found}
              total={total}
              size={82}
              still={reduced}
              className={`${reduced ? "" : "cp-token-swing"}${cheering && !reduced ? " cp-token-cheer" : ""}`}
            />
          </PaintedPress>
        </div>
      ) : null}

      {whisper ? (
        <div className="cp-root cp-hud-whisper">
          <ParchmentCard style={{ padding: "12px 20px" }}>
            <span style={{ color: UI.ink }}>{whisper}</span>
          </ParchmentCard>
        </div>
      ) : null}
    </>
  );
}
