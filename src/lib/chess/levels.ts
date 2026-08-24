"use client";

/**
 * LEVELS — who is ChessPaa talking to, and how much should he say?
 *
 * The same true sentence lands completely differently on a five-year-old and
 * a twelve-year-old. "There's a knight fork on c7 winning the exchange" is
 * precise and useless to the first; "your little horse can hop over and nibble
 * that big castle!" is delightful and patronising to the second.
 *
 * So this file holds two things and nothing else:
 *   1. WHO — an age band the grown-up picks once, and a skill estimate that
 *      quietly follows the child.
 *   2. HOW MUCH — the vocabulary budget those two imply.
 *
 * DESIGN RULES THAT ARE NOT NEGOTIABLE
 * ------------------------------------
 * - The skill number is never shown to the child and never used to rank them.
 *   It exists to decide whether ChessPaa says "fork" or "two at once", and
 *   whether he explains something for the fourth time. It is a VOLUME KNOB,
 *   not a score.
 * - It falls slowly and rises quickly. A child having one bad evening must not
 *   wake up to a grandpa who has started talking down to them.
 * - Local only. localStorage, no account, no network, no telemetry, ever.
 */

/* ================================================================== *
 * THE TWO AXES
 * ================================================================== */

/** 5-7, 8-11, 12+. Chosen once by whoever set the child up. */
export type AgeBand = "little" | "middle" | "big";

/**
 * How ChessPaa feels about a move. Deliberately five warm words and no cold
 * ones: there is no "blunder" in this park and there never will be.
 */
export type Tier = "brilliant" | "clever" | "steady" | "slip" | "careful";

/** Worst to best. `softenTier` walks up this list, never down. */
export const TIER_ORDER: readonly Tier[] = ["careful", "slip", "steady", "clever", "brilliant"] as const;

export function tierIndex(t: Tier): number {
  return TIER_ORDER.indexOf(t);
}

/** Nudge a verdict toward encouragement. The only direction this file moves. */
export function softenTier(t: Tier, notches = 1): Tier {
  return TIER_ORDER[Math.min(TIER_ORDER.length - 1, tierIndex(t) + Math.max(0, notches))];
}

/** Is this a verdict that should feel like praise? */
export function isHappyTier(t: Tier): boolean {
  return t === "brilliant" || t === "clever" || t === "steady";
}

/** What each verdict is worth to the running skill estimate. */
export const TIER_QUALITY: Record<Tier, number> = {
  brilliant: 1.0,
  clever: 0.85,
  steady: 0.62,
  slip: 0.34,
  careful: 0.16,
};

export const BAND_LABEL: Record<AgeBand, string> = {
  little: "Little one (5-7)",
  middle: "Explorer (8-11)",
  big: "Big kid (12+)",
};

export function ageBandFor(age: number): AgeBand {
  if (age <= 7) return "little";
  if (age <= 11) return "middle";
  return "big";
}

/* ================================================================== *
 * THE PROFILE
 * ================================================================== */

export interface LearnerProfile {
  band: AgeBand;
  /** 0..1 rolling estimate. A volume knob, never a grade. */
  skill: number;
  /** concept key -> how many times ChessPaa has explained it to this child. */
  seen: Record<string, number>;
  /** Total graded moves, used to slow the estimate down once it has settled. */
  moves: number;
  /** Consecutive non-slip moves. Feeds the "you're on a roll" flourishes. */
  goodStreak: number;
  /** Consecutive wobbles. Feeds SOFTENING — never scolding. */
  wobbleStreak: number;
  lastTier: Tier | null;
  /** The last handful of lesson keys, so he doesn't harp on one string. */
  recentLessons: string[];
  updatedAt: number;
  version: 1;
}

export function defaultProfile(band: AgeBand = "middle"): LearnerProfile {
  return {
    band,
    // Start each band where a typical child of that age actually starts, so
    // the very first sentence is already pitched right.
    skill: band === "little" ? 0.18 : band === "middle" ? 0.34 : 0.5,
    seen: {},
    moves: 0,
    goodStreak: 0,
    wobbleStreak: 0,
    lastTier: null,
    recentLessons: [],
    updatedAt: Date.now(),
    version: 1,
  };
}

/* ================================================================== *
 * PERSISTENCE — browser only, best effort, never throws
 * ================================================================== */

const KEY = (slot: string) => `chesspaa:learner:${slot}`;

export function loadProfile(slot = "default"): LearnerProfile {
  if (typeof window === "undefined") return defaultProfile();
  try {
    const raw = window.localStorage.getItem(KEY(slot));
    if (!raw) return defaultProfile();
    const parsed = JSON.parse(raw) as Partial<LearnerProfile>;
    const base = defaultProfile(parsed.band ?? "middle");
    return {
      ...base,
      ...parsed,
      band: parsed.band ?? base.band,
      skill: clamp(typeof parsed.skill === "number" ? parsed.skill : base.skill, 0.02, 0.99),
      seen: typeof parsed.seen === "object" && parsed.seen ? parsed.seen : {},
      recentLessons: Array.isArray(parsed.recentLessons) ? parsed.recentLessons.slice(-8) : [],
      version: 1,
    };
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(p: LearnerProfile, slot = "default"): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY(slot), JSON.stringify(p));
    // Same signal shape as lib/progress.ts so a HUD can listen to one event.
    window.dispatchEvent(new CustomEvent("chesspaa:learner", { detail: { slot } }));
  } catch { /* private browsing, quota, whatever — the park still works */ }
}

export function clearProfile(slot = "default"): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(KEY(slot)); } catch { /* ignore */ }
}

/* ================================================================== *
 * THE UPDATE
 * ================================================================== */

export interface MoveNote {
  tier: Tier;
  /** The one lesson ChessPaa actually chose to talk about, if any. */
  lessonKey?: string;
  /** Concept keys touched by this move (motif keys, pattern names). */
  concepts?: string[];
}

/**
 * Fold one graded move into the profile. PURE — returns a new profile so React
 * callers can just setState with it and persist when they feel like it.
 *
 * The asymmetry is deliberate and is the whole point of this function:
 * good moves move the estimate faster than bad ones, and a single wobble is
 * capped at a small dip. A child who hangs a queen has not become a worse
 * player; they have had one bad second.
 */
export function noteMove(p: LearnerProfile, note: MoveNote): LearnerProfile {
  const q = TIER_QUALITY[note.tier];
  // Learn quickly for the first few moves (we know nothing yet), then settle.
  // Not TOO quickly, though: six tidy opening moves shouldn't unlock the
  // twelve-year-old vocabulary for a child who's about to hang their queen.
  const base = p.moves < 12 ? 0.16 : 0.09;
  const rising = q > p.skill;
  const alpha = rising ? base : base * 0.6;
  let skill = p.skill + alpha * (q - p.skill);
  // Kindness clamp: one move may never cost more than six points of estimate.
  if (skill < p.skill - 0.06) skill = p.skill - 0.06;
  skill = clamp(skill, 0.02, 0.99);

  const seen = { ...p.seen };
  for (const c of note.concepts ?? []) seen[c] = (seen[c] ?? 0) + 1;
  if (note.lessonKey) seen[note.lessonKey] = (seen[note.lessonKey] ?? 0) + 1;

  const happy = isHappyTier(note.tier);
  return {
    ...p,
    skill,
    seen,
    moves: p.moves + 1,
    goodStreak: happy ? p.goodStreak + 1 : 0,
    wobbleStreak: happy ? 0 : p.wobbleStreak + 1,
    lastTier: note.tier,
    recentLessons: [...p.recentLessons, note.lessonKey ?? ""].filter(Boolean).slice(-8),
    updatedAt: Date.now(),
  };
}

export function setBand(p: LearnerProfile, band: AgeBand): LearnerProfile {
  if (band === p.band) return p;
  // Re-pitch the estimate toward the new band's floor without wiping what we
  // learned — a bright six-year-old moving to "middle" keeps their credit.
  const floor = defaultProfile(band).skill;
  return { ...p, band, skill: clamp(Math.max(p.skill, floor * 0.8), 0.02, 0.99), updatedAt: Date.now() };
}

/* ================================================================== *
 * FAMILIARITY — has he explained this before?
 * ================================================================== */

export type Familiarity = "new" | "learning" | "known";

export function familiarity(p: LearnerProfile, key: string): Familiarity {
  const n = p.seen[key] ?? 0;
  if (n === 0) return "new";
  if (n <= 2) return "learning";
  return "known";
}

/** True the first time a concept comes up — worth the full picture-book version. */
export function isNewConcept(p: LearnerProfile, key: string): boolean {
  return (p.seen[key] ?? 0) === 0;
}

/** How recently he said this exact lesson. 0 = last move. -1 = not lately. */
export function lessonRecency(p: LearnerProfile, key: string): number {
  const i = p.recentLessons.lastIndexOf(key);
  return i < 0 ? -1 : p.recentLessons.length - 1 - i;
}

/* ================================================================== *
 * THE VOCABULARY BUDGET
 * ================================================================== */

export interface VoiceSettings {
  band: AgeBand;
  /** Hard ceiling on sentences. Little ones stop listening at three. */
  maxSentences: number;
  /** Soft ceiling on words — it's a speech bubble, not an essay. */
  maxWords: number;
  /** May he write "Nf3", or must it be "your knight"? */
  useNotation: boolean;
  /** May he name a bare square, "look at c7"? */
  useSquares: boolean;
  /** May he use the real words — fork, pin, skewer — or does the picture come first? */
  useTechnicalTerms: boolean;
  /** May he mention material counts and evaluations? */
  useEvaluation: boolean;
  /** Chance a rhyme, a flourish or a bit of park scenery sneaks in. 0..1 */
  whimsy: number;
  /** Rungs on the hint ladder before he simply shows the move. */
  hintRungs: number;
  /** Warm diminutives ("your little horse") instead of piece names. */
  useKidPieceNames: boolean;
}

/**
 * The band sets the shape; the skill estimate opens doors inside it.
 *
 * The one rule that matters: a technical word is only allowed once the child
 * has met the IDEA at least twice in pictures. ChessPaa earns "fork" — he
 * doesn't assume it.
 */
export function voiceSettings(p: LearnerProfile): VoiceSettings {
  const s = p.skill;
  switch (p.band) {
    case "little":
      return {
        band: "little",
        maxSentences: 2,
        maxWords: 34,
        useNotation: false,
        useSquares: s > 0.5,           // squares are reading homework for a 6-year-old
        useTechnicalTerms: s > 0.45,
        useEvaluation: false,
        whimsy: 0.85,
        hintRungs: 2,                  // two rungs, then show — never make a little one climb
        useKidPieceNames: true,
      };
    case "middle":
      return {
        band: "middle",
        // Three, not two: the verdict and the lesson both have to fit, or the
        // trimmer drops "Clever!" and the child only ever hears the warning.
        // `maxWords` is the real governor of how chatty he gets.
        maxSentences: 3,
        maxWords: 48,
        useNotation: s > 0.4,
        useSquares: true,
        useTechnicalTerms: true,
        useEvaluation: s > 0.7,
        whimsy: 0.55,
        hintRungs: 3,
        useKidPieceNames: s < 0.3,
      };
    case "big":
    default:
      return {
        band: "big",
        maxSentences: 3,
        maxWords: 62,
        useNotation: true,
        useSquares: true,
        useTechnicalTerms: true,
        useEvaluation: true,
        whimsy: 0.3,                   // a twelve-year-old will forgive one wink, not four
        hintRungs: 3,
        useKidPieceNames: false,
      };
  }
}

/**
 * Which "grandpa mood" the engine should play at, mapping onto the existing
 * `EngineClient.playForKid` levels 0-4 (Teddy → Champ).
 *
 * Biased one notch soft on purpose: losing every game teaches a child that
 * chess is a thing they are bad at.
 */
export function recommendedEngineLevel(p: LearnerProfile): number {
  const bandFloor = p.band === "little" ? 0 : p.band === "middle" ? 0 : 1;
  const fromSkill = Math.floor(p.skill * 5);
  return Math.max(0, Math.min(4, Math.max(bandFloor, fromSkill - 1)));
}

/** A warm, non-numeric way to describe where a child is. Safe to show. */
export function skillLabel(p: LearnerProfile): string {
  if (p.moves < 6) return "just getting comfy";
  if (p.skill < 0.28) return "learning the ropes";
  if (p.skill < 0.45) return "finding your feet";
  if (p.skill < 0.62) return "playing with ideas";
  if (p.skill < 0.8) return "seeing the board";
  return "sharp as a tack";
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
