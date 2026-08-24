"use client";

/**
 * ACCESSIBILITY, KID-SIZED.
 *
 * Four jobs, and they are all the same job: make sure a four-year-old who
 * cannot read, cannot see red from green, and cannot hold still is never
 * locked out of the park.
 *
 *   1. NARRATION      — ChessPaa's words read aloud for pre-readers.
 *   2. REDUCED MOTION — the park still charms when it stops swooping.
 *   3. MARKS          — nothing is ever told by colour alone.
 *   4. TOUCH          — one number every tappable thing in the park obeys.
 *
 * Plus a fifth thing that is not really accessibility but belongs next to it:
 * the kid-safety manifest, and a guard that makes "a link out of the park"
 * a compile-and-run-time impossibility rather than a policy nobody reads.
 *
 * Everything here degrades to silence rather than throwing. A browser with no
 * speech synthesis, no matchMedia and no localStorage must still play.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { PALETTE } from "@/three/core/palette";
import type { PieceType } from "@/three/core/geometry/pieces";

/* ==================================================================== */
/* 1 · TOUCH — the one number                                            */
/* ==================================================================== */

/**
 * Target sizes in CSS pixels.
 *
 * WHY 64 and not the usual 44: 44pt is the adult guideline, measured on adults
 * who are paying attention. A five-year-old aims with a whole hand, from a
 * moving sofa, while narrating what they are about to do. Every playtest of a
 * kids' product lands in the same place — go bigger than you think, then add
 * clear space so a stray thumb cannot hit two things at once.
 */
export const TOUCH = {
  /** Absolute floor. Nothing tappable in this park is smaller than this. */
  min: 64,
  /** Ordinary buttons: hint, takeback, close. */
  comfy: 80,
  /** The big happy ones: "ride again", an attraction on the fold-out map. */
  hero: 108,
  /** Minimum clear space between two independent targets. */
  gap: 14,
} as const;

/** Convenience alias for the floor, so call sites read as intent. */
export const TOUCH_TARGET = TOUCH.min;

/* ==================================================================== */
/* 2 · NARRATION — reading the park aloud                                */
/* ==================================================================== */

/**
 * We share ONE preference key with `lib/audio/chessPaaVoice.ts`, and one
 * speech channel.
 *
 * WHY: both modules speak through the single global `window.speechSynthesis`.
 * Two grandfathers talking over each other is worse than silence, and a child
 * who switches "read to me" off must have it off everywhere — one switch,
 * one voice, always. So we read the same key and we always `cancel()` before
 * we speak. We deliberately do NOT import his voice module: this file must
 * stay usable for plain UI labels ("shall we try that again?"), and routing
 * those through ChessPaa would fire his musical motif every time a child
 * hovered a button.
 */
const VOICE_PREF_KEY = "chesspaa:voice";

/** Voices we prefer, warmest first. Matched loosely against voice.name. */
const WARM_VOICE_HINTS = [
  "samantha", "karen", "moira", "fiona", "serena", "daniel", "alex",
  "google uk english female", "google us english", "zira", "hazel",
];

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  try {
    return window.speechSynthesis ?? null;
  } catch {
    return null;
  }
}

/** True when this browser can narrate at all. Never assume it can. */
export function narrationSupported(): boolean {
  return synth() !== null && typeof SpeechSynthesisUtterance !== "undefined";
}

/**
 * Narration defaults to ON.
 *
 * WHY on: the child who most needs it is the one least able to find the
 * settings panel and switch it on. A reader can turn it off in one press;
 * a pre-reader cannot turn it on at all.
 */
export function narrationEnabled(): boolean {
  if (!narrationSupported()) return false;
  try {
    const v = localStorage.getItem(VOICE_PREF_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

const prefListeners = new Set<() => void>();

function emitPrefChange(): void {
  for (const l of prefListeners) {
    try { l(); } catch { /* a bad listener must not silence the park */ }
  }
}

export function setNarrationEnabled(on: boolean): void {
  try {
    localStorage.setItem(VOICE_PREF_KEY, on ? "1" : "0");
  } catch {
    /* private browsing: the choice holds for this session and no longer */
  }
  if (!on) stopNarration();
  emitPrefChange();
}

/** Subscribe to narration on/off. Returns an unsubscribe. */
export function onNarrationChange(cb: () => void): () => void {
  prefListeners.add(cb);
  return () => { prefListeners.delete(cb); };
}

let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesListenerArmed = false;

/**
 * Pick the warmest available voice.
 *
 * WHY the listener: Chrome returns an EMPTY voice list on the first call and
 * fills it in asynchronously. Without re-picking on `voiceschanged`, the very
 * first thing a child ever hears comes out in the flat robot default — which
 * is precisely the moment we most need him to sound like a grandfather.
 */
function pickVoice(): SpeechSynthesisVoice | null {
  const s = synth();
  if (!s) return null;
  if (cachedVoice) return cachedVoice;

  if (!voicesListenerArmed) {
    voicesListenerArmed = true;
    try {
      s.addEventListener("voiceschanged", () => { cachedVoice = null; });
    } catch { /* Safari sometimes lacks the event; the first pick still works */ }
  }

  let voices: SpeechSynthesisVoice[] = [];
  try { voices = s.getVoices(); } catch { return null; }
  if (!voices.length) return null;

  const en = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const pool = en.length ? en : voices;

  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -Infinity;
  for (const v of pool) {
    const name = v.name.toLowerCase();
    let score = 0;
    const hint = WARM_VOICE_HINTS.findIndex((h) => name.includes(h));
    if (hint >= 0) score += 100 - hint;
    // Local voices do not stall on a network round-trip — and the park is
    // meant to work with the wifi off.
    if (v.localService) score += 30;
    if (name.includes("compact") || name.includes("eloquence")) score -= 40;
    if (score > bestScore) { bestScore = score; best = v; }
  }
  cachedVoice = best;
  return best;
}

export interface NarrateOptions {
  /** Cut off whatever is being said. Default true — children change their minds. */
  interrupt?: boolean;
  /** 0.1..2. Default 0.92 — a hair under normal, the pace of a bedtime story. */
  rate?: number;
  /** 0..2. Default 0.98. */
  pitch?: number;
  /** 0..1. Default 0.95. */
  volume?: number;
  /** Wait this long before starting (ms). Lets an animation land first. */
  delayMs?: number;
  /** Called when the line finishes, or immediately if narration is unavailable. */
  onDone?: () => void;
}

/** Strip the decorations that sound ridiculous when a robot reads them out. */
function spoken(text: string): string {
  return text
    // Emoji and pictographs: a child hears "star emoji" and the spell breaks.
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
    // Chess figurines read as gibberish in most engines.
    .replace(/[♔-♟]/g, " ")
    .replace(/…/g, ", ")
    .replace(/—/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

let pendingTimer: number | null = null;

/**
 * Say something out loud. Safe to call anywhere, any time, on any browser.
 *
 * Deliberately fire-and-forget: narration is a bonus lane. If it fails, the
 * card on screen still says the words and the game continues.
 */
export function narrate(text: string, opts: NarrateOptions = {}): void {
  const done = opts.onDone;
  const line = spoken(text ?? "");
  if (!line || !narrationSupported() || !narrationEnabled()) {
    done?.();
    return;
  }
  const s = synth();
  if (!s) { done?.(); return; }

  const start = () => {
    try {
      if (opts.interrupt !== false) s.cancel();
      const u = new SpeechSynthesisUtterance(line);
      const v = pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = opts.rate ?? 0.92;
      u.pitch = opts.pitch ?? 0.98;
      u.volume = opts.volume ?? 0.95;
      if (done) {
        u.onend = () => done();
        u.onerror = () => done();
      }
      s.speak(u);
    } catch {
      done?.();
    }
  };

  if (pendingTimer !== null) { window.clearTimeout(pendingTimer); pendingTimer = null; }
  if (opts.delayMs && opts.delayMs > 0) {
    pendingTimer = window.setTimeout(() => { pendingTimer = null; start(); }, opts.delayMs);
  } else {
    start();
  }
}

/** Stop talking — a child skipped ahead, or a scene changed under us. */
export function stopNarration(): void {
  if (pendingTimer !== null) { window.clearTimeout(pendingTimer); pendingTimer = null; }
  try { synth()?.cancel(); } catch { /* nothing to cancel */ }
}

function subscribeNarration(cb: () => void): () => void {
  return onNarrationChange(cb);
}
function narrationSnapshot(): boolean { return narrationEnabled(); }
function narrationServerSnapshot(): boolean { return false; }

/**
 * The hook a component uses to read the park aloud.
 *
 *   const { speak, enabled, toggle, supported } = useNarration();
 *   useEffect(() => speak(line), [line, speak]);
 */
export function useNarration(): {
  supported: boolean;
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  toggle: () => void;
  speak: (text: string, opts?: NarrateOptions) => void;
  stop: () => void;
} {
  const enabled = useSyncExternalStore(subscribeNarration, narrationSnapshot, narrationServerSnapshot);
  const speak = useCallback((text: string, opts?: NarrateOptions) => narrate(text, opts), []);
  const toggle = useCallback(() => setNarrationEnabled(!narrationEnabled()), []);
  return {
    supported: narrationSupported(),
    enabled,
    setEnabled: setNarrationEnabled,
    toggle,
    speak,
    stop: stopNarration,
  };
}

/**
 * Narrate a line whenever it changes, and shut up on unmount.
 *
 * WHY the ref dance: React 19 in StrictMode mounts effects twice in dev. Without
 * remembering the last line we actually spoke, every dev session gets a stutter
 * of doubled grandfather.
 */
export function useSpokenText(text: string | null | undefined, opts: NarrateOptions & { active?: boolean } = {}): void {
  const last = useRef<string | null>(null);
  const { active = true, ...rest } = opts;
  // Options are read fresh each time the text changes; keeping them in a ref
  // avoids re-narrating just because a parent re-rendered with a new object.
  // The ref is written in an effect, never during render — a render-phase ref
  // write is invisible to React and breaks under concurrent rendering.
  const optsRef = useRef(rest);
  useEffect(() => { optsRef.current = rest; });

  useEffect(() => {
    if (!active || !text) return;
    if (last.current === text) return;
    last.current = text;
    narrate(text, optsRef.current);
  }, [text, active]);

  useEffect(() => () => { stopNarration(); }, []);
}

/* ==================================================================== */
/* 3 · LIVE REGION — for the parts a screen reader must hear             */
/* ==================================================================== */

let liveRegions: { polite: HTMLElement; urgent: HTMLElement } | null = null;

function ensureLiveRegions(): { polite: HTMLElement; urgent: HTMLElement } | null {
  if (typeof document === "undefined") return null;
  if (liveRegions && liveRegions.polite.isConnected) return liveRegions;

  const make = (live: "polite" | "assertive") => {
    const el = document.createElement("div");
    el.setAttribute("aria-live", live);
    el.setAttribute("aria-atomic", "true");
    el.setAttribute("role", live === "assertive" ? "alert" : "status");
    // Visually hidden, but NOT display:none — display:none is not announced.
    el.style.cssText =
      "position:absolute;width:1px;height:1px;margin:-1px;padding:0;" +
      "overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0";
    document.body.appendChild(el);
    return el;
  };

  liveRegions = { polite: make("polite"), urgent: make("assertive") };
  return liveRegions;
}

/**
 * Announce something to assistive tech without putting it on screen.
 *
 * Use for state a sighted child gets from the picture — "the map is open",
 * "ChessPaa moved his knight to f6" — never for decoration.
 */
export function announce(message: string, tone: "polite" | "urgent" = "polite"): void {
  const regions = ensureLiveRegions();
  if (!regions || !message) return;
  const el = tone === "urgent" ? regions.urgent : regions.polite;
  // Clearing first forces a re-announce when the same string repeats
  // (a second "check!" must be heard as a second check).
  el.textContent = "";
  window.setTimeout(() => { el.textContent = message; }, 40);
}

/* ==================================================================== */
/* 4 · REDUCED MOTION                                                    */
/* ==================================================================== */

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try { return window.matchMedia(REDUCED_QUERY).matches; } catch { return false; }
}

function subscribeMotion(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  let mq: MediaQueryList;
  try { mq = window.matchMedia(REDUCED_QUERY); } catch { return () => {}; }
  // Safari < 14 only has the deprecated addListener; support both quietly.
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  }
  const legacy = mq as MediaQueryList & {
    addListener?: (l: (e: MediaQueryListEvent) => void) => void;
    removeListener?: (l: (e: MediaQueryListEvent) => void) => void;
  };
  legacy.addListener?.(cb);
  return () => legacy.removeListener?.(cb);
}
function motionSnapshot(): boolean { return prefersReducedMotion(); }
function motionServerSnapshot(): boolean { return false; }

/**
 * True when the child (or their grown-up) has asked the world to hold still.
 *
 * IMPORTANT house rule: reduced motion means *calmer*, never *plainer*. We
 * keep every colour, every painted icon and every warm shadow — we only stop
 * things travelling, swinging and typing. A vestibular-sensitive child should
 * get the same beautiful park, sitting down.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, motionSnapshot, motionServerSnapshot);
}

/** Duration helper: `dur(420, reduced)` → 420ms normally, 0ms when calmed. */
export function dur(ms: number, reduced: boolean): number {
  return reduced ? 0 : ms;
}

/* ==================================================================== */
/* 5 · MARKS — never colour alone                                        */
/* ==================================================================== */

/**
 * THE RULE: every meaningful difference in this park is carried on THREE
 * independent channels at once — SHAPE, GLYPH and COLOUR.
 *
 * Deuteranopia (the common one) collapses our teal/plum pair and flattens
 * scarfRed toward walnut, and roughly one boy in twelve has it. A "green dot
 * means you can move here, red dot means danger" board is, for him, a board
 * of identical grey dots. So a legal-move square is a soft DISC, a capture is
 * a RING OF TEETH, a danger square is a JAGGED border — different at a glance
 * in full colour, in greyscale, and through any colour-vision simulation.
 *
 * The shapes are also what the narration describes, so the three channels stay
 * honest with each other.
 */

export type MarkShape =
  | "disc" | "ring" | "star" | "burst" | "crown" | "leaf"
  | "tower" | "pennant" | "shield" | "diamond" | "teeth" | "jag" | "corners";

export interface Mark {
  /** A text figure for dense places (capture strips, legends). */
  glyph: string;
  /** The silhouette. This is the channel that survives everything. */
  shape: MarkShape;
  /** Palette colour, as a hex int. The third channel — never the only one. */
  color: number;
  /** Plain words, for screen readers and for narration. */
  label: string;
  /** SVG stroke-dasharray, so even pure line-art stays distinguishable. */
  dash: string;
}

/**
 * Piece identity.
 *
 * The colours here are for BADGES (legends, capture strips, the fold-out map)
 * — never for the pieces on the board, where colour belongs to the two sides.
 */
const PIECE_MARK_BASE: Record<PieceType, Mark> = {
  p: { glyph: "♟", shape: "disc",    color: PALETTE.teal,      label: "pawn",   dash: "0" },
  n: { glyph: "♞", shape: "pennant", color: PALETTE.plum,      label: "knight", dash: "10 6" },
  b: { glyph: "♝", shape: "leaf",    color: PALETTE.forestMid, label: "bishop", dash: "3 6" },
  r: { glyph: "♜", shape: "tower",   color: PALETTE.walnut,    label: "rook",   dash: "14 5 3 5" },
  q: { glyph: "♛", shape: "star",    color: PALETTE.honeyDeep, label: "queen",  dash: "0" },
  k: { glyph: "♚", shape: "crown",   color: PALETTE.scarfRed,  label: "king",   dash: "18 4" },
};

/** Outline figures for the light side, solid ones for the dark side. */
const LIGHT_GLYPH: Record<PieceType, string> = {
  p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔",
};

export type Side = "w" | "b";

/**
 * The mark for a piece, optionally of a particular side.
 *
 * With a side given, the glyph switches to that side's figure (hollow for
 * light, filled for dark) and the label names it — "light knight" — so the
 * spoken description matches what is drawn.
 */
export function pieceMark(type: PieceType, side?: Side): Mark {
  const base = PIECE_MARK_BASE[type];
  if (!side) return base;
  return {
    ...base,
    glyph: side === "w" ? LIGHT_GLYPH[type] : base.glyph,
    label: `${side === "w" ? "light" : "dark"} ${base.label}`,
  };
}

/** Every piece mark, in board order. Handy for legends. */
export const PIECE_MARKS: Record<PieceType, Mark> = PIECE_MARK_BASE;

export interface SideMark {
  key: Side;
  label: string;
  /** The body colour of the piece. */
  color: number;
  /** The ink that outlines it. */
  ink: number;
  /** Dark side is solid, light side is hollow — legible with no colour at all. */
  filled: boolean;
  /** Dark side additionally carries a hatch, for print and for greyscale. */
  hatch: boolean;
  glyph: string;
}

/**
 * The two teams.
 *
 * Cream vs walnut is a strong LIGHTNESS difference, not a hue difference, so
 * it survives every form of colour blindness on its own — but we still add
 * hollow-vs-solid and a hatch, because a low-contrast screen in a bright room
 * eats lightness differences too.
 */
export function sideMark(side: Side): SideMark {
  return side === "w"
    ? { key: "w", label: "light", color: PALETTE.creamPale, ink: PALETTE.ink, filled: false, hatch: false, glyph: "○" }
    : { key: "b", label: "dark",  color: PALETTE.cocoa,     ink: PALETTE.ink, filled: true,  hatch: true,  glyph: "●" };
}

/**
 * Board square states.
 *
 * `hint` / `danger` / `good` line up one-for-one with `HighlightKind` in
 * `three/board/boardInteraction.ts`; the rest cover the states the UI needs
 * to *talk* about even when the board draws them itself.
 */
export type SquareMarkKind =
  | "selected" | "move" | "capture" | "hint" | "danger" | "good" | "last" | "check";

export interface SquareMark extends Mark {
  /** Should the mark breathe? (Callers must gate this on useReducedMotion.) */
  pulse: boolean;
}

const SQUARE_MARKS: Record<SquareMarkKind, SquareMark> = {
  // A soft ring around the piece you picked up.
  selected: { glyph: "◎", shape: "ring",    color: PALETTE.honey,      label: "picked up",     dash: "0",        pulse: false },
  // A plain dot: "your piece can stand here".
  move:     { glyph: "•", shape: "disc",    color: PALETTE.honey,      label: "you can move here", dash: "0",    pulse: false },
  // A ring of teeth: "something of theirs is here and you may take it".
  capture:  { glyph: "◍", shape: "teeth",   color: PALETTE.plum,       label: "you can capture here", dash: "0", pulse: false },
  // A sparkle: ChessPaa is pointing.
  hint:     { glyph: "✦", shape: "burst",   color: PALETTE.lanternCore, label: "ChessPaa's sparkle", dash: "0",  pulse: true },
  // A jagged edge: careful here. Shape does the warning, not the colour.
  danger:   { glyph: "▲", shape: "jag",     color: PALETTE.scarfRed,   label: "careful here",  dash: "6 4",      pulse: true },
  // A soft star: this is a happy square.
  good:     { glyph: "★", shape: "star",    color: PALETTE.teal,       label: "a good square", dash: "0",        pulse: false },
  // Corner brackets: where the last move came from and went to.
  last:     { glyph: "⌐", shape: "corners", color: PALETTE.walnutLight, label: "the last move", dash: "0",       pulse: false },
  // A shield: the king is being shouted at.
  check:    { glyph: "!", shape: "shield",  color: PALETTE.scarfRed,   label: "the king is in check", dash: "0", pulse: true },
};

export function squareMark(kind: SquareMarkKind): SquareMark {
  return SQUARE_MARKS[kind];
}

/**
 * The SVG path for a mark's silhouette, drawn inside a `size` × `size` box.
 *
 * Returned as a path string so the same shape can be a 16px badge in a legend,
 * a 40px stamp on the fold-out map, or a canvas-painted decal on a board
 * square — one definition, one silhouette, everywhere.
 */
export function markPath(shape: MarkShape, size = 100): string {
  const s = size, h = size / 2, q = size / 4;
  const poly = (pts: Array<[number, number]>): string =>
    "M" + pts.map(([x, y]) => `${round(x)},${round(y)}`).join("L") + "Z";
  const round = (n: number): number => Math.round(n * 100) / 100;

  // A circle drawn as two arcs — valid in a <path>, unlike <circle>.
  const circle = (r: number): string =>
    `M${round(h - r)},${round(h)}A${round(r)},${round(r)} 0 1 0 ${round(h + r)},${round(h)}` +
    `A${round(r)},${round(r)} 0 1 0 ${round(h - r)},${round(h)}Z`;

  // Points of an n-pointed star between two radii.
  const star = (points: number, outer: number, inner: number, phase = -Math.PI / 2): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = phase + (i * Math.PI) / points;
      out.push([h + Math.cos(a) * r, h + Math.sin(a) * r]);
    }
    return out;
  };

  switch (shape) {
    case "disc":
      return circle(h * 0.62);
    case "ring":
      // Two concentric circles, opposite winding → a true annulus under evenodd.
      return circle(h * 0.86) + circle(h * 0.62);
    case "star":
      return poly(star(5, h * 0.92, h * 0.40));
    case "burst":
      // Eight points, deeply notched — reads as a sparkle even at 12px.
      return poly(star(8, h * 0.95, h * 0.30));
    case "teeth":
      // A gear-ish ring: the "you may take this" mark. Unmistakable in mono.
      return poly(star(12, h * 0.92, h * 0.66)) + circle(h * 0.46);
    case "crown":
      return poly([
        [q * 0.5, s * 0.78], [q * 0.5, s * 0.34], [h * 0.62, s * 0.54],
        [h, s * 0.20], [s - h * 0.62, s * 0.54], [s - q * 0.5, s * 0.34],
        [s - q * 0.5, s * 0.78],
      ]);
    case "leaf":
      // A bishop's mitre: a teardrop with the slit cut in the top.
      return `M${h},${round(s * 0.10)}C${round(s * 0.86)},${round(s * 0.34)} ${round(s * 0.84)},${round(s * 0.72)} ${h},${round(s * 0.92)}` +
             `C${round(s * 0.16)},${round(s * 0.72)} ${round(s * 0.14)},${round(s * 0.34)} ${h},${round(s * 0.10)}Z` +
             `M${round(h - s * 0.045)},${round(s * 0.22)}L${round(h + s * 0.045)},${round(s * 0.30)}` +
             `L${round(h + s * 0.045)},${round(s * 0.46)}L${round(h - s * 0.045)},${round(s * 0.38)}Z`;
    case "tower":
      return poly([
        [s * 0.20, s * 0.86], [s * 0.26, s * 0.34], [s * 0.20, s * 0.34],
        [s * 0.20, s * 0.16], [s * 0.34, s * 0.16], [s * 0.34, s * 0.26],
        [s * 0.44, s * 0.26], [s * 0.44, s * 0.16], [s * 0.56, s * 0.16],
        [s * 0.56, s * 0.26], [s * 0.66, s * 0.26], [s * 0.66, s * 0.16],
        [s * 0.80, s * 0.16], [s * 0.80, s * 0.34], [s * 0.74, s * 0.34],
        [s * 0.80, s * 0.86],
      ]);
    case "pennant":
      // A knight's flag — a swallow-tailed triangle on a short pole.
      return poly([
        [s * 0.22, s * 0.10], [s * 0.90, s * 0.34], [s * 0.56, s * 0.46],
        [s * 0.90, s * 0.58], [s * 0.22, s * 0.82], [s * 0.22, s * 0.94],
        [s * 0.10, s * 0.94], [s * 0.10, s * 0.10],
      ]);
    case "shield":
      return `M${round(s * 0.16)},${round(s * 0.14)}L${round(s * 0.84)},${round(s * 0.14)}` +
             `L${round(s * 0.84)},${round(s * 0.52)}Q${round(s * 0.84)},${round(s * 0.84)} ${h},${round(s * 0.94)}` +
             `Q${round(s * 0.16)},${round(s * 0.84)} ${round(s * 0.16)},${round(s * 0.52)}Z`;
    case "diamond":
      return poly([[h, s * 0.06], [s * 0.94, h], [h, s * 0.94], [s * 0.06, h]]);
    case "jag":
      // Zig-zag border: the "careful" mark. Danger is a SHAPE here, not a red.
      return poly(star(10, h * 0.95, h * 0.72));
    case "corners":
      // Four L-brackets — the quietest mark we have, for "the last move".
      return [
        [0, 0, 1, 1], [1, 0, -1, 1], [1, 1, -1, -1], [0, 1, 1, -1],
      ].map(([fx, fy, dx, dy]) => {
        const x = fx * s, y = fy * s, L = s * 0.30, T = s * 0.13;
        return poly([
          [x + dx * s * 0.06, y + dy * s * 0.06],
          [x + dx * L, y + dy * s * 0.06],
          [x + dx * L, y + dy * (s * 0.06 + T)],
          [x + dx * (s * 0.06 + T), y + dy * (s * 0.06 + T)],
          [x + dx * (s * 0.06 + T), y + dy * L],
          [x + dx * s * 0.06, y + dy * L],
        ]);
      }).join("");
  }
}

/* ==================================================================== */
/* 6 · CONTRAST — so the words survive a busy 3D scene                   */
/* ==================================================================== */

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a palette int. */
export function luminance(hex: number): number {
  const r = channel((hex >> 16) & 255);
  const g = channel((hex >> 8) & 255);
  const b = channel(hex & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 (identical) … 21 (black on white). */
export function contrastRatio(a: number, b: number): number {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Pick warm ink or warm cream — whichever stays readable on this background.
 *
 * WHY not just black/white: pure black is a hole in a storybook page and pure
 * white glares at dusk. Our two "text colours" are the same ink the outline
 * pass uses and the same cream the signage is painted on, so type belongs to
 * the picture instead of floating over it.
 */
export function readableInk(background: number): number {
  return contrastRatio(background, PALETTE.ink) >= contrastRatio(background, PALETTE.creamPale)
    ? PALETTE.ink
    : PALETTE.creamPale;
}

/* ==================================================================== */
/* 7 · KID SAFETY — enforced, not promised                               */
/* ==================================================================== */

/**
 * What this park will never do. Stated here so it can be pointed at in a
 * review, and enforced below so it cannot drift.
 */
export const KID_SAFE = Object.freeze({
  chat: false,              // no messaging of any kind, with anyone
  externalLinks: false,     // nothing leaves the park
  ads: false,               // no advertising, no promotion, no upsell
  analytics: false,         // no telemetry, no tracking, no beacons
  accountRequired: false,   // no sign-in wall between a child and playing
  uploads: false,           // nothing a child makes leaves this device
  purchases: false,         // no currency, no store, no "unlock"
  failStates: false,        // nothing scolds, nothing ends in defeat
  deadEnds: false,          // every screen offers at least one way onward
} as const);

/**
 * The park is allowed to navigate to its own routes and nowhere else.
 *
 * Any `http:`/`https:`/`mailto:` target — or a protocol-relative `//evil` —
 * is refused. Call this from every place that could conceivably navigate;
 * `StorybookUI`'s buttons take handlers rather than hrefs precisely so that
 * "a link out of the park" is not expressible in the first place, and this is
 * the belt to that pair of braces.
 */
export function isInParkHref(href: string): boolean {
  if (!href) return false;
  if (href.startsWith("//")) return false;
  if (!href.startsWith("/")) return false;
  // `/\evil.com` is parsed as protocol-relative by some browsers.
  if (href.startsWith("/\\")) return false;
  return true;
}

/** Throws in development, refuses silently in production. Never navigates out. */
export function assertInPark(href: string): string {
  if (isInParkHref(href)) return href;
  if (process.env.NODE_ENV !== "production") {
    throw new Error(`[kid-safety] refused to leave the park: ${href}`);
  }
  return "/park";
}

/* ==================================================================== */
/* 8 · SMALL HELPERS THE UI USES EVERYWHERE                              */
/* ==================================================================== */

/**
 * Make a keyboard press behave exactly like a tap.
 *
 * Every interactive thing we build is a real <button>, so this is only needed
 * for the few places where a painted object *is* the control (an attraction on
 * the fold-out map). Space and Enter both fire, because a child who has just
 * learned the space bar uses it for everything.
 */
export function pressableKeys(onPress: () => void) {
  return (e: ReactKeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      onPress();
    }
  };
}

/**
 * Attach a single-key shortcut, ignoring presses aimed at text fields.
 *
 * Kept here rather than in the HUD because more than one surface wants it
 * (H hides the HUD, M opens the map, Escape folds it away).
 */
export function useHotkey(key: string, handler: () => void, enabled = true): void {
  // Latest-handler ref, written in an effect rather than during render so the
  // listener below never has to be torn down and re-added on every keystroke.
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, enabled]);
}
