"use client";

/**
 * THE LIVING TUTOR.
 *
 * THE PROMISE: after every move a child makes, anywhere in the game, ChessPaa
 * responds warmly and instantly and tells them, in age-right words, what was
 * good and what they hadn't quite seen — like a patient grandpa who has been
 * watching the whole time.
 *
 * Four moving parts, in order:
 *   1. TIER      — how he feels about the move. Five warm words, no cold ones.
 *   2. SELECT    — the ONE thing worth saying. Not three. One.
 *   3. VOICE     — that one thing, in this child's language, in words he
 *                  hasn't used lately (voiceLibrary.ts).
 *   4. FORWARD   — a hint ladder and a takeback, so there is never a wall.
 *
 * ------------------------------------------------------------------
 * THE THREE RULES THIS FILE IS BUILT AROUND
 * ------------------------------------------------------------------
 *
 * 1. NEVER STALL. Every engine call races a timeout. If Stockfish is slow,
 *    the board scan alone still produces a warm, true, useful sentence, and
 *    the abandoned engine job quietly fills the cache for next time. A grandpa
 *    who goes silent for two seconds after every move is worse than a grandpa
 *    who occasionally says something slightly less precise.
 *
 * 2. NEVER SCOLD. The tier thresholds below are all tuned kinder than a
 *    correct engine would tune them, and the strongest word in the vocabulary
 *    is "Careful". There is no blunder, no red X, no buzzer. Where the engine
 *    and kindness disagree about the *label*, kindness wins; where they
 *    disagree about the *fact*, the engine wins and the fact gets said gently.
 *
 * 3. NEVER CRY WOLF. A false "that's a fork!" costs more trust than ten missed
 *    ones. Motifs arrive with confidence scores, and when the engine says the
 *    move was fine, board-level "threats" get suppressed — because a piece
 *    that looks hanging in a position the engine likes is nearly always part
 *    of a tactic the child stumbled into correctly.
 */

import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";

import { getEngine, scoreToCp, type Analysis, type EngineClient, type Score } from "./engine";
import {
  detectMotifs, flipTurn, scanPosition, topMotifs, motifImportance, PIECE_NAME,
  type Motif, type MotifKind,
} from "./motifs";
import {
  defaultProfile, familiarity, isHappyTier, lessonRecency, noteMove, softenTier,
  tierIndex, voiceSettings,
  type AgeBand, type LearnerProfile, type Tier, type VoiceSettings,
} from "./levels";
import {
  moveWord, opponentWords, pieceWord, valueWord, voiceHint, voiceLine, voiceTakeback,
  voiceTierLabel, voiceGreeting,
  PRAISE_FOR_MOTIF, WARNING_FOR_MOTIF, TIER_MOOD, TIER_STICKER,
  type ChessPaaMood, type GamePhase, type HintRung, type LessonKey, type VoiceTokens,
} from "./voiceLibrary";

export type { Tier, AgeBand, LearnerProfile } from "./levels";
export type { LessonKey, GamePhase, ChessPaaMood } from "./voiceLibrary";
export type { Motif, MotifKind } from "./motifs";

/* ================================================================== *
 * THE BOARD POINTERS
 *
 * Deliberately the same three words Board3D's `highlight` prop already
 * speaks, so a caller can pass `response.pointers.highlightSquares` straight
 * into the board with no translation layer.
 * ================================================================== */

export type PointerKind = "hint" | "danger" | "good";

export interface TutorPointers {
  highlightSquares: Record<string, PointerKind>;
  /** [from, to] — draw it as an arrow over the board. */
  arrow?: [string, string];
}

const NO_POINTERS: TutorPointers = { highlightSquares: {} };

/* ================================================================== *
 * THE RESPONSE
 * ================================================================== */

export interface TutorFacts {
  playedSan: string;
  playedUci: string;
  bestSan?: string;
  bestUci?: string;
  /** Pawns given up versus the engine's choice. Always >= 0. */
  lossPawns: number;
  /** Position score after the move, from the CHILD's point of view, in pawns. */
  scoreAfterPawns: number;
  mateForKidIn?: number;
  mateAgainstKidIn?: number;
  check: boolean;
  mate: boolean;
  stalemate: boolean;
  gameOver: boolean;
  phase: GamePhase;
  /** The honest ones only — everything here is above the confidence floor. */
  motifs: Motif[];
  /** False when the engine timed out and the answer came from the board alone. */
  engineUsed: boolean;
  kidColor: Color;
  fenBefore: string;
  fenAfter: string;
}

export interface HintStep {
  rung: HintRung;
  text: string;
  pointers: TutorPointers;
}

export interface HintLadder {
  /** "Want to see a sparkle?" — the invitation, never a demand. */
  invitation: string;
  /** Two rungs for little ones, three for everyone else. Never zero. */
  steps: HintStep[];
  /** The move being pointed at, in UCI, if the caller wants to play it. */
  move?: string;
}

export interface TakebackOffer {
  text: string;
  /** Restore the board to this position. */
  fen: string;
  /** The move to lift back off the board, for the animation. */
  undo: [string, string];
}

export interface TutorResponse {
  tier: Tier;
  /** Short sticker label — "Brilliant!", "Careful…". Never harsh. */
  tierLabel: string;
  sticker: string;
  /** ChessPaa's actual sentence, ready to speak or type out. */
  say: string;
  /** The single thing he chose to talk about. */
  lesson: LessonKey | null;
  /** The motif behind that lesson, when there was one. */
  motif: Motif | null;
  pointers: TutorPointers;
  hints: HintLadder;
  /** Only offered when it would help — never as a punishment. */
  takeback: TakebackOffer | null;
  /** A face for the character rig. */
  mood: ChessPaaMood;
  facts: TutorFacts;
  /** The profile with this move folded in. Persist it if you like. */
  profile: LearnerProfile;
  /** How long the whole thing took, so callers can tune their budget. */
  elapsedMs: number;
}

export interface TutorMoveInput {
  fenBefore: string;
  /** The child's move in UCI, e.g. "g1f3" or "e7e8q". */
  playedUci: string;
  kidColor: Color;
  /** Defaults to the shared engine. Pass null to run board-only (instant). */
  engine?: EngineClient | null;
  profile?: LearnerProfile;
  /** Total wall-clock the tutor may spend waiting on the engine. Default 1100ms. */
  budgetMs?: number;
  /** True in "Play vs ChessPaa" — then he says "my rook", not "their rook". */
  chessPaaIsOpponent?: boolean;
  /** Pin the dialogue for tests and the screenshot harness. */
  seed?: number;
}

/* ================================================================== *
 * EVALUATION CACHE
 *
 * Two jobs: don't pay twice for a position, and let `primeTutor` do the work
 * while the child is still deciding, so the answer is already sitting there
 * when their hand comes off the piece.
 * ================================================================== */

const CACHE_CAP = 220;
const evalCache = new Map<string, Analysis>();
const inFlight = new Map<string, Promise<Analysis>>();

function cacheKey(fen: string, multipv: number): string {
  return `${multipv}|${fen}`;
}

function remember(key: string, a: Analysis): void {
  if (evalCache.size >= CACHE_CAP) {
    // Map keeps insertion order, so the first key is the oldest.
    const oldest = evalCache.keys().next().value;
    if (oldest !== undefined) evalCache.delete(oldest);
  }
  evalCache.set(key, a);
}

/** Resolve to null instead of hanging. The underlying job keeps running. */
function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  if (ms <= 0) return Promise.resolve(null);
  return new Promise<T | null>((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, ms);
    p.then(
      (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } },
      () => { if (!done) { done = true; clearTimeout(t); resolve(null); } },
    );
  });
}

async function analyzeCached(
  engine: EngineClient,
  fen: string,
  movetimeMs: number,
  multipv: number,
  timeoutMs: number,
): Promise<Analysis | null> {
  const key = cacheKey(fen, multipv);
  const hit = evalCache.get(key);
  if (hit) return hit;

  let job = inFlight.get(key);
  if (!job) {
    job = engine.analyze(fen, { movetimeMs, multipv }).then(
      (a) => { remember(key, a); inFlight.delete(key); return a; },
      (e) => { inFlight.delete(key); throw e; },
    );
    // Someone has to own the rejection or the console fills with noise when we
    // walk away from a slow job.
    job.catch(() => { /* handled by raceTimeout's callers */ });
    inFlight.set(key, job);
  }
  return raceTimeout(job, timeoutMs);
}

/**
 * Warm the cache for a position the child is currently staring at. Call this
 * the moment it becomes their turn: by the time they let go of the piece the
 * "before" analysis is usually already sitting in the cache, and `tutorMove`
 * only has to price the position they created.
 *
 * Fire and forget — it never throws and never blocks.
 */
export function primeTutor(fen: string, engine?: EngineClient | null, movetimeMs = 420): void {
  const eng = engine === undefined ? safeEngine() : engine;
  if (!eng) return;
  void analyzeCached(eng, fen, movetimeMs, 2, 60_000).catch(() => { /* nothing to do */ });
}

export function clearTutorCache(): void {
  evalCache.clear();
  inFlight.clear();
}

/** The engine is browser-only; on a server render we just do board-only work. */
function safeEngine(): EngineClient | null {
  if (typeof window === "undefined") return null;
  try { return getEngine(); } catch { return null; }
}

/* ================================================================== *
 * SMALL BOARD FACTS
 * ================================================================== */

const CP: Record<PieceSymbol, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

function otherColor(c: Color): Color {
  return c === "w" ? "b" : "w";
}

function kidPov(scoreWhite: Score, kid: Color): number {
  const cp = scoreToCp(scoreWhite);
  return kid === "w" ? cp : -cp;
}

function mateForKid(s: Score | undefined, kid: Color): number | undefined {
  if (!s || s.type !== "mate") return undefined;
  const v = kid === "w" ? s.value : -s.value;
  return v > 0 ? v : undefined;
}

function mateAgainstKid(s: Score | undefined, kid: Color): number | undefined {
  if (!s || s.type !== "mate") return undefined;
  const v = kid === "w" ? s.value : -s.value;
  return v < 0 ? -v : undefined;
}

/**
 * Where in the game are we? Material first, move number second — an eight-move
 * queen trade puts you in an endgame no matter what the clock says.
 */
function phaseOf(fen: string): GamePhase {
  const placement = fen.split(" ")[0];
  let material = 0;
  for (const ch of placement) {
    const lower = ch.toLowerCase();
    if (lower === "n" || lower === "b" || lower === "r" || lower === "q") {
      material += CP[lower as PieceSymbol];
    }
  }
  if (material <= 1900) return "endgame";
  const fullmove = Number(fen.split(" ")[5] ?? "1") || 1;
  if (fullmove <= 9 && material >= 5600) return "opening";
  return "middlegame";
}

function playMove(fen: string, uci: string): { move: Move; fenAfter: string; chess: Chess } | null {
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    return move ? { move, fenAfter: chess.fen(), chess } : null;
  } catch {
    return null;
  }
}

function sanOf(fen: string, uci: string): string | undefined {
  return playMove(fen, uci)?.move.san;
}

/* ================================================================== *
 * 1. THE TIER
 * ================================================================== */

interface TierInput {
  loss: number;               // centipawns given up vs best, >= 0
  scoreAfter: number;         // centipawns, child's point of view
  scoreBefore: number;
  playedIsBest: boolean;
  engineUsed: boolean;
  mate: boolean;
  stalemate: boolean;
  motifs: Motif[];
  kidColor: Color;
  fullmove: number;
  profile: LearnerProfile;
}

/** A motif that means the child SAW something. Worth the top word. */
const STRONG_PRAISE: MotifKind[] = ["fork", "skewer", "discoveredAttack", "mateThreat"];

/** Something concrete and nameable has gone wrong. Required before "Careful". */
function hasNameableTrouble(motifs: Motif[], kid: Color): Motif | null {
  const bad = motifs
    .filter((m) => m.source === "threat" && m.forSide !== kid && m.confidence >= 0.7)
    .filter((m) => m.kind === "mateThreat" || m.kind === "trapped" || (m.value ?? 0) >= 2.5)
    .sort((a, b) => motifImportance(b) - motifImportance(a));
  return bad[0] ?? null;
}

/**
 * Grade the move. Every threshold here starts from the honest engine numbers
 * and is then bent one notch toward encouragement, on purpose.
 *
 * The single most important rule is the one about "careful": the strongest
 * word we own is only spent when there is something the child can actually
 * SEE and fix. A four-pawn positional drift a beginner cannot perceive earns
 * "a little slip", because telling a six-year-old to be careful about
 * something invisible teaches them only that chess is frightening.
 */
function gradeTier(input: TierInput): Tier {
  const { loss, scoreAfter, scoreBefore, playedIsBest, mate, stalemate, motifs, kidColor } = input;

  if (mate) return "brilliant";

  // Mate was on the board and the child played something else. Even when the
  // engine still says "mate next move" (so the eval never moved and `loss` is
  // zero), calling that brilliant is a lie a child will eventually catch.
  const declinedMate = motifs.some(
    (m) => m.source === "missed" && m.kind === "mateThreat" && m.forSide === kidColor,
  );

  const foundTactic = motifs.some(
    (m) => m.source === "played" && m.forSide === kidColor && m.confidence >= 0.8 && STRONG_PRAISE.includes(m.kind),
  ) && !declinedMate;

  // --- board-only fallback: the engine didn't answer in time --------
  // A tactic we can PROVE from the board outranks a shape we can only guess
  // at, and the order matters: a mating sacrifice always leaves the sacrificed
  // piece looking hung, so testing "is anything loose?" first would grade
  // every queen sacrifice in history as a wobble.
  if (!input.engineUsed) {
    if (foundTactic) return "clever";
    const trouble = hasNameableTrouble(motifs, kidColor);
    if (trouble && (trouble.value ?? 0) >= 3) return "slip";   // stay soft without engine backing
    return "steady";
  }

  let tier: Tier;
  if (playedIsBest) tier = "brilliant";
  else if (foundTactic && loss <= 80) tier = "brilliant";
  else if (loss <= 60) tier = "clever";
  else if (loss <= 150) tier = "steady";
  else if (loss <= 320) tier = "slip";
  else tier = "careful";

  // Delaying a mate you already had is never better than "good and steady".
  if (declinedMate && tierIndex(tier) > tierIndex("steady")) tier = "steady";

  // Something concrete the child can see and fix. Computed once, because
  // every kindness rule below has to respect it: a warm verdict attached to a
  // warning about a hanging bishop reads as nonsense, and a tutor that
  // contradicts itself is a tutor a child stops believing.
  const trouble = hasNameableTrouble(motifs, kidColor);

  // "Careful" must be earnable — it needs a nameable, visible problem. A
  // four-pawn positional drift that a beginner cannot perceive gets the
  // gentler word, because telling a six-year-old to be careful about
  // something invisible only teaches them that chess is frightening.
  if (tier === "careful" && !trouble) tier = "slip";

  // --- and now the kindness pass -----------------------------------
  const atLeast = (floor: Tier) => { if (tierIndex(tier) < tierIndex(floor)) tier = floor; };

  // Still completely winning? Then nothing that just happened is a crisis.
  if (scoreAfter >= 700) atLeast("steady");
  else if (scoreAfter >= 400 && tier === "careful") tier = "slip";

  // Already lost before the move — you cannot spoil a soup that's on the floor.
  if (scoreBefore <= -600) atLeast("steady");

  // Stalemating from a winning position: a real lesson, but a gentle one.
  if (stalemate) tier = scoreBefore > 400 ? "slip" : "steady";

  // Two wobbles in a row: soften one notch. Piling on is how children stop
  // playing. One notch only — the warning itself still gets said.
  if (input.profile.wobbleStreak >= 2 && !isHappyTier(tier)) tier = softenTier(tier);

  // A warm welcome for a child's very first moves — but only for small
  // things. If they've just dropped a rook, "Good and steady" is a lie.
  if (input.profile.moves < 3 && loss <= 400 && !trouble) atLeast("steady");

  // Opening inaccuracies that cost nothing concrete are just... the opening.
  if (input.fullmove <= 6 && loss <= 220 && !trouble) atLeast("steady");

  // Little ones get one more notch of grace when nothing is actually hanging.
  if (input.profile.band === "little" && tier === "slip" && loss <= 220 && !trouble) {
    tier = "steady";
  }

  return tier;
}

/* ================================================================== *
 * 2. THE ONE LESSON
 * ================================================================== */

interface Candidate {
  lesson: LessonKey;
  weight: number;
  motif?: Motif;
  tokens?: VoiceTokens;
  /** A move to point at if the child asks for help. UCI. */
  hintMove?: string;
  /** Base pointers for this lesson. */
  pointers?: TutorPointers;
}

/**
 * The teaching priority order, as weights. It is one opinion, written down
 * so it can be argued with: for a beginner, a piece they can lose right now
 * beats every subtlety on the board, praise for a tactic they actually found
 * beats generic encouragement, and the secret they walked past comes last
 * because it is the only one that can wait until tomorrow.
 */
const BASE_WEIGHT: Record<LessonKey, number> = {
  mateWin: 1000, mateLoss: 1000, stalemate: 960, drawn: 940,
  promoted: 780,
  mateDanger: 820,
  // Only reachable from `tutorWatch` — nothing else grades a position in which
  // the child is already in check, because they cannot have just moved into one.
  inCheck: 800,
  hungMovedPiece: 700,
  hangingPiece: 640,
  missedMate: 600,
  opponentFork: 560,
  threatenMate: 545,
  foundFork: 520,
  opponentSkewer: 515,
  trappedPiece: 500,
  foundDiscovered: 480,
  foundSkewer: 450,
  opponentPin: 430,
  backRankDanger: 420,
  missedCapture: 415,
  foundPin: 400,
  missedFork: 380,
  foundBest: 350,
  overloadedDefender: 330,
  savedIt: 300,
  castled: 300,
  goodCapture: 260,
  goodCheck: 250,
  earlyQueen: 240,
  developed: 220,
  kingSafety: 200,
  centre: 180,
  keepDeveloping: 150,
  missedBetter: 120,
  solidQuiet: 60,
};

const WARNING_LESSONS = new Set<LessonKey>([
  "mateDanger", "inCheck", "hungMovedPiece", "hangingPiece", "opponentFork", "opponentPin",
  "opponentSkewer", "trappedPiece", "backRankDanger", "overloadedDefender",
]);

/** Concrete things a child can point at, versus ideas they have to hold in their head. */
const CONCRETE_LESSONS = new Set<LessonKey>([
  "hungMovedPiece", "hangingPiece", "missedCapture", "goodCapture", "foundFork",
  "missedFork", "promoted", "mateWin", "mateDanger", "missedMate", "goodCheck",
]);
const ABSTRACT_LESSONS = new Set<LessonKey>([
  "overloadedDefender", "backRankDanger", "foundPin", "opponentPin",
  "keepDeveloping", "kingSafety", "missedBetter",
]);

function highlight(pairs: Array<[string | undefined, PointerKind]>, arrow?: [string, string]): TutorPointers {
  const highlightSquares: Record<string, PointerKind> = {};
  for (const [sq, kind] of pairs) if (sq) highlightSquares[sq] = kind;
  // A zero-length arrow (trapped pieces point at themselves) is a smudge.
  const usable = arrow && arrow[0] && arrow[1] && arrow[0] !== arrow[1] ? arrow : undefined;
  return usable ? { highlightSquares, arrow: usable } : { highlightSquares };
}

/** One arrow rule for every motif: the thing doing it, pointing at the thing it hits. */
function motifArrow(m: Motif): [string, string] | undefined {
  const to = m.targets?.[0];
  return m.from && to ? [m.from, to] : undefined;
}

/**
 * WHO IS WHO IN EACH MOTIF.
 *
 * Every detector packs `pieces` in the order that made sense while detecting
 * it, which is not the order a sentence needs. A fork lists the forker first;
 * a pin lists the *pinned* piece first. Get this wrong and ChessPaa says
 * "there's a fork coming from my rook" when it's the knight doing the
 * forking — which is exactly the sort of small wrongness that stops a child
 * believing him.
 *
 * So: one table, indices into `motif.pieces`.
 *   actor   — the piece doing the work
 *   victim  — the piece being hit
 *   victim2 — a second thing being hit
 */
const MOTIF_ROLES: Record<MotifKind, { actor?: number; victim?: number; victim2?: number }> = {
  fork:             { actor: 0, victim: 1, victim2: 2 },
  pin:              { actor: 1, victim: 0, victim2: 2 },
  skewer:           { actor: 2, victim: 0, victim2: 1 },
  discoveredAttack: { actor: 0, victim: 1 },
  hanging:          { actor: 1, victim: 0 },
  mateThreat:       { actor: 0 },
  trapped:          { victim: 0 },
  overloaded:       { victim: 0, victim2: 1 },
  backRank:         { victim: 0 },
};

/**
 * Turn a motif into speakable nouns.
 *
 * `role` says whose side the ACTOR is on: in praise the child is the actor
 * ("your knight forked them"), in a warning the opponent is ("my knight is
 * about to fork you"), and the pronouns have to follow.
 */
function motifTokens(
  m: Motif,
  settings: VoiceSettings,
  pickSeed: number,
  role: "praise" | "threat" = "praise",
): VoiceTokens {
  const t: VoiceTokens = {};
  const roles = MOTIF_ROLES[m.kind];
  const name = (i: number | undefined, salt: number) =>
    i === undefined || !m.pieces[i] ? undefined : kidWord(m.pieces[i], settings, pickSeed + salt);

  const actor = name(roles.actor, 0);
  const victim = name(roles.victim, 1);
  const victim2 = name(roles.victim2, 2);

  if (role === "praise") {
    // The child owns the actor; the targets belong to the other side.
    if (actor) t.piece = actor;
    if (victim) t.piece2 = victim;
    if (victim2) t.theirPiece = victim2;
  } else {
    // The other side owns the actor; the targets are the child's.
    if (actor) t.theirPiece = actor;
    if (victim) t.piece = victim;
    if (victim2) t.piece2 = victim2;
  }

  if (settings.useSquares) {
    t.sq = m.squares[0];
    t.sq2 = m.squares[1];
  }
  if (m.value !== undefined) t.value = valueWord(m.value, settings);
  return t;
}

/** Map a plain piece name back through the child's vocabulary. */
function kidWord(plain: string, settings: VoiceSettings, pick: number): string {
  const sym = (Object.keys(PIECE_NAME) as PieceSymbol[]).find((k) => PIECE_NAME[k] === plain);
  return sym ? pieceWord(sym, settings, pick) : plain;
}

interface SelectInput {
  tier: Tier;
  motifs: Motif[];
  facts: TutorFacts;
  played: Move;
  settings: VoiceSettings;
  profile: LearnerProfile;
  kidColor: Color;
  seed: number;
  opp: Pick<VoiceTokens, "opp" | "oppThey" | "oppThem">;
}

/**
 * Build every honest thing he COULD say, weight it, and take exactly one.
 * The weighting is where all the teaching judgement lives.
 */
function selectLesson(input: SelectInput): Candidate | null {
  const { motifs, facts, played, settings, profile, kidColor, seed } = input;
  const them = otherColor(kidColor);
  const declinedMate = motifs.some(
    (m) => m.source === "missed" && m.kind === "mateThreat" && m.forSide === kidColor,
  );
  const out: Candidate[] = [];
  const add = (c: Candidate) => { if (c.weight > 0) out.push(c); };

  /* --- the game is over ------------------------------------------- */
  if (facts.mate) {
    return {
      lesson: "mateWin", weight: 1000,
      pointers: highlight([[played.to, "good"], [played.from, "good"]]),
    };
  }
  if (facts.stalemate) {
    return { lesson: "stalemate", weight: 960, pointers: NO_POINTERS };
  }

  /* --- how much do we trust board-level alarm? --------------------- */
  // If the engine likes the position after this move, a piece that LOOKS
  // hanging is nearly always part of a tactic the child found by accident or
  // on purpose. Shouting about it would be both wrong and discouraging.
  const warningScale = facts.engineUsed
    ? Math.max(0.12, Math.min(1, facts.lossPawns / 1.5))
    : 1;

  // A proven forced mate ends the conversation. "Your queen is loose on b8" is
  // perfectly true and completely beside the point when b8 was the sacrifice
  // that mates next move — and it is the exact sentence that would teach a
  // child never to play one again.
  const kidHasForcedMate =
    !!facts.mateForKidIn ||
    motifs.some((m) => m.source === "played" && m.kind === "mateThreat" && m.forSide === kidColor && m.confidence >= 0.9);

  for (const m of motifs) {
    const isThreat = m.source === "threat" && m.forSide === them;
    const isPraise = m.source === "played" && m.forSide === kidColor;
    const isMissed = m.source === "missed" && m.forSide === kidColor;
    const tokens = {
      ...motifTokens(m, settings, seed, isThreat ? "threat" : "praise"),
      ...input.opp,
    };

    if (isThreat) {
      const key = WARNING_FOR_MOTIF[m.kind];
      if (!key) continue;
      const justMoved = m.detail === "just-moved";
      const lesson: LessonKey = key === "hangingPiece" && justMoved ? "hungMovedPiece" : key;
      // Mate threats are never scaled down — they are true regardless of how
      // pretty the rest of the position looks.
      const scale = m.kind === "mateThreat" ? 1 : kidHasForcedMate ? 0.08 : warningScale;
      add({
        lesson,
        weight: (BASE_WEIGHT[lesson] + (m.value ?? 0) * 8) * m.confidence * scale,
        motif: m,
        tokens,
        pointers: highlight(
          [[m.squares[0], "danger"], [m.squares[1], "danger"]],
          motifArrow(m),
        ),
      });
    } else if (isPraise) {
      const key = PRAISE_FOR_MOTIF[m.kind];
      if (!key) continue;
      // "You're threatening mate!" is embarrassing when mate was available
      // this move and they walked past it. The secret outranks the boast.
      if (key === "threatenMate" && declinedMate) continue;
      add({
        lesson: key,
        weight: (BASE_WEIGHT[key] + (m.value ?? 0) * 6) * m.confidence,
        motif: m,
        tokens,
        pointers: highlight(
          m.squares.slice(0, 3).map((s): [string, PointerKind] => [s, "good"]),
          motifArrow(m),
        ),
      });
    } else if (isMissed) {
      const key: LessonKey | null =
        m.kind === "mateThreat" ? "missedMate"
        : m.kind === "fork" ? "missedFork"
        : m.kind === "hanging" ? "missedCapture"
        : null;
      if (!key) continue;
      const hintMove = m.via ?? facts.bestUci;
      if (key === "missedMate") tokens.n = "1";
      // If the mate is STILL there, the secret is less urgent (they can just
      // play it next move) but it is not less true — halve it, don't hide it.
      const stillAvailable = key === "missedMate" && !!facts.mateForKidIn ? 0.75 : 1;
      add({
        lesson: key,
        weight: (BASE_WEIGHT[key] + (m.value ?? 0) * 5) * m.confidence * stillAvailable,
        motif: m,
        tokens,
        hintMove,
        // Missed things are NOT lit up by default — that's what the hint
        // ladder is for. Showing the answer unasked steals the discovery.
        pointers: NO_POINTERS,
      });
    }
  }

  /* --- praise for good habits, independent of tactics -------------- */
  const goodPointers = highlight([[played.from, "good"], [played.to, "good"]]);
  const pieceTok = { ...input.opp, piece: pieceWord(played.piece, settings, seed) };

  if (played.isKingsideCastle() || played.isQueensideCastle()) {
    add({ lesson: "castled", weight: BASE_WEIGHT.castled, tokens: pieceTok, pointers: goodPointers });
  }
  if (played.promotion) {
    add({ lesson: "promoted", weight: BASE_WEIGHT.promoted, tokens: pieceTok, pointers: goodPointers });
  }
  if (isHappyTier(input.tier)) {
    if (facts.check) {
      add({ lesson: "goodCheck", weight: BASE_WEIGHT.goodCheck, tokens: pieceTok, pointers: goodPointers });
    }
    if (played.captured) {
      add({
        lesson: "goodCapture",
        weight: BASE_WEIGHT.goodCapture + CP[played.captured] / 60,
        tokens: { ...pieceTok, piece2: pieceWord(played.captured, settings, seed + 1) },
        pointers: goodPointers,
      });
    }
    if (facts.phase === "opening") {
      const homeRank = kidColor === "w" ? "1" : "8";
      if ((played.piece === "n" || played.piece === "b") && played.from[1] === homeRank) {
        add({ lesson: "developed", weight: BASE_WEIGHT.developed, tokens: pieceTok, pointers: goodPointers });
      }
      if (played.piece === "p" && "de".includes(played.to[0])) {
        add({ lesson: "centre", weight: BASE_WEIGHT.centre, tokens: pieceTok, pointers: goodPointers });
      }
    }
    if (facts.playedUci === facts.bestUci) {
      add({ lesson: "foundBest", weight: BASE_WEIGHT.foundBest, tokens: pieceTok, pointers: goodPointers });
    }
  }

  /* --- grandpa's standing advice ----------------------------------- */
  if (facts.phase === "opening") {
    const fullmove = Number(facts.fenBefore.split(" ")[5] ?? "1") || 1;
    if (played.piece === "q" && fullmove <= 6 && facts.playedUci !== facts.bestUci) {
      // A habit note, not a verdict: it fires whenever the queen comes out
      // early and the engine wanted something else, weighted by how much it
      // actually cost so a real tactic always outranks it.
      add({
        lesson: "earlyQueen",
        weight: BASE_WEIGHT.earlyQueen + Math.min(120, facts.lossPawns * 90),
        tokens: pieceTok,
        pointers: goodPointers,
      });
    }
    if (undevelopedCount(facts.fenAfter, kidColor) >= 3 && facts.lossPawns > 0.3) {
      add({ lesson: "keepDeveloping", weight: BASE_WEIGHT.keepDeveloping, tokens: pieceTok, pointers: NO_POINTERS });
    }
  }

  /* --- the generic "there was something better" -------------------- */
  if (facts.bestSan && facts.lossPawns >= 0.5 && !isHappyTier(input.tier)) {
    add({
      lesson: "missedBetter",
      // Capped: this is the vaguest thing he can say, so it must never
      // out-shout a concrete one just because the number got big.
      weight: BASE_WEIGHT.missedBetter + Math.min(200, facts.lossPawns * 25),
      tokens: { ...input.opp, best: settings.useNotation ? facts.bestSan : bestAsWords(facts, settings, seed) },
      hintMove: facts.bestUci,
      pointers: NO_POINTERS,
    });
  }

  /* --- the floor: something warm and true is always available ------ */
  add({ lesson: "solidQuiet", weight: BASE_WEIGHT.solidQuiet, tokens: pieceTok, pointers: NO_POINTERS });

  if (out.length === 0) return null;

  /* --- now bend the weights toward THIS child, TODAY --------------- */
  for (const c of out) {
    // Something he's never explained is worth more than the fourth reminder.
    const fam = familiarity(profile, c.lesson);
    if (fam === "new") c.weight += 45;
    else if (fam === "learning") c.weight += 18;
    else c.weight -= 10;

    // Don't harp. Warnings get a much smaller penalty, because a child who
    // hangs a piece two moves running genuinely does need telling twice.
    const recency = lessonRecency(profile, c.lesson);
    if (recency === 0) c.weight -= WARNING_LESSONS.has(c.lesson) ? 45 : 150;
    else if (recency === 1) c.weight -= WARNING_LESSONS.has(c.lesson) ? 15 : 70;

    // Little ones want something they can point at; big kids can hold an idea.
    if (settings.band === "little") {
      if (CONCRETE_LESSONS.has(c.lesson)) c.weight *= 1.18;
      if (ABSTRACT_LESSONS.has(c.lesson)) c.weight *= 0.6;
    } else if (settings.band === "big") {
      if (ABSTRACT_LESSONS.has(c.lesson)) c.weight *= 1.1;
    }

    // If he can't say it in this child's words yet, he doesn't say it at all.
    if (!settings.useTechnicalTerms && ABSTRACT_LESSONS.has(c.lesson)) c.weight *= 0.4;
  }

  out.sort((a, b) => b.weight - a.weight);
  return out[0];
}

function undevelopedCount(fen: string, colour: Color): number {
  const rank = colour === "w" ? "1" : "8";
  const chess = new Chess(fen, { skipValidation: true });
  let n = 0;
  for (const file of "bcfg") {
    const p = chess.get((file + rank) as Square);
    if (p && p.color === colour && (p.type === "n" || p.type === "b")) n++;
  }
  return n;
}

/** Describe the engine's move without notation, for children who can't read it yet. */
function bestAsWords(facts: TutorFacts, settings: VoiceSettings, seed: number): string {
  if (!facts.bestUci) return "";
  const info = playMove(facts.fenBefore, facts.bestUci);
  if (!info) return "";
  return moveWord(info.move.san, info.move.piece, settings, seed, info.move.to);
}

/* ================================================================== *
 * 4. THE WAY FORWARD
 * ================================================================== */

/**
 * The hint ladder always exists, even after a perfect move — because "what
 * now?" is a question a child asks when they're winning too, and a tutor that
 * only speaks when you're wrong teaches you to fear it.
 *
 * After a wobble it points at the move they missed. After a good move it
 * points at their own next idea, taken from the engine's line.
 */
function buildLadder(
  facts: TutorFacts,
  candidate: Candidate | null,
  settings: VoiceSettings,
  band: AgeBand,
  seed: number,
  beforeLine: string[] | undefined,
): HintLadder {
  const happy = !candidate || !WARNING_LESSONS.has(candidate.lesson);

  /**
   * WHICH MOVE ARE WE POINTING AT?
   *
   * The ladder always belongs to `fenBefore`, because that is the only
   * position where a move the child could have made is legal, and because it
   * pairs with the takeback ("shall we try that again?").
   *
   * After a good move there is nothing to fix — so instead of inventing a
   * future move that can't be drawn on the current board, the ladder points
   * at what the child ALREADY built: the arrow of the tactic they found, or
   * failing that, their own move, which is usually the engine's choice too.
   * A hint that ends in "yes — that one" is a fine thing for a child to hear.
   */
  let move: string | undefined = candidate?.hintMove;
  if (!move && !happy) move = facts.bestUci;
  if (!move && happy) {
    const built = candidate?.motif;
    if (built && built.source === "played") move = facts.playedUci || undefined;
  }
  if (!move) move = facts.bestUci || facts.playedUci || undefined;
  void beforeLine; // the engine's deeper continuation isn't drawable on this board

  const tokens: VoiceTokens = {};
  if (move) {
    const info = playMove(facts.fenBefore, move);
    if (info) {
      tokens.piece = pieceWord(info.move.piece, settings, seed);
      tokens.best = settings.useNotation
        ? info.move.san
        : moveWord(info.move.san, info.move.piece, settings, seed, info.move.to);
      tokens.from = info.move.from;
      tokens.to = info.move.to;
    }
  }
  // A tactic the child already played is best drawn along its own line
  // (knight → target) rather than along the move that created it.
  const built = happy ? candidate?.motif : undefined;
  if (built && built.source === "played" && built.from && built.targets?.[0]) {
    tokens.from = built.from;
    tokens.to = built.targets[0];
  }

  const rungs: HintRung[] = settings.hintRungs >= 3 ? ["nudge", "highlight", "show"] : ["nudge", "show"];
  const steps: HintStep[] = rungs.map((rung, i) => ({
    rung,
    text: voiceHint(rung, band, tokens, seed + i * 17),
    pointers:
      rung === "nudge"
        ? NO_POINTERS
        : rung === "highlight"
          ? highlight([[tokens.from, "hint"]])
          : highlight(
              [[tokens.from, "hint"], [tokens.to, "hint"]],
              tokens.from && tokens.to ? [tokens.from, tokens.to] : undefined,
            ),
  }));

  const invitation = band === "little"
    ? "Want to see a sparkle?"
    : band === "middle"
      ? "Want a little hint?"
      : "Want a hint?";

  return { invitation, steps, move };
}

/* ================================================================== *
 * THE MAIN ENTRY POINT
 * ================================================================== */

/**
 * One child move in, one warm grandfather out.
 *
 * Timing: the engine work is capped by `budgetMs` and everything else is a
 * few milliseconds of board arithmetic, so this resolves in well under a
 * second even on a cold cache and typically in ~10ms when `primeTutor` has
 * been doing its job.
 */
export async function tutorMove(input: TutorMoveInput): Promise<TutorResponse> {
  const started = Date.now();
  const profile = input.profile ?? defaultProfile();
  const settings = voiceSettings(profile);
  const seed = input.seed ?? ((Date.now() ^ (input.playedUci.charCodeAt(0) << 8)) >>> 0);

  try {
    return await tutorMoveInner(input, profile, settings, seed, started);
  } catch (err) {
    // A tutor that throws is a grandpa who goes silent — the single worst
    // failure mode this file has. Say something kind and carry on.
    if (typeof console !== "undefined") console.warn("tutorMove fell back:", err);
    return fallbackResponse(input, profile, settings, seed, started);
  }
}

async function tutorMoveInner(
  input: TutorMoveInput,
  profile: LearnerProfile,
  settings: VoiceSettings,
  seed: number,
  started: number,
): Promise<TutorResponse> {
  const { fenBefore, playedUci, kidColor } = input;
  const budget = input.budgetMs ?? 1100;
  const engine = input.engine === undefined ? safeEngine() : input.engine;

  const info = playMove(fenBefore, playedUci);
  if (!info) throw new Error(`illegal move ${playedUci} in ${fenBefore}`);
  const { move: played, fenAfter, chess: afterChess } = info;

  const mate = afterChess.isCheckmate();
  const stalemate = afterChess.isStalemate();
  const check = afterChess.inCheck();
  const gameOver = afterChess.isGameOver();

  /* ---- engine, on a leash ---------------------------------------- */
  let before: Analysis | null = null;
  let after: Analysis | null = null;
  if (engine) {
    // If `primeTutor` did its job the "before" analysis is free and the whole
    // budget goes on pricing the position the child just created.
    const preCached = evalCache.has(cacheKey(fenBefore, 2));
    const beforeBudget = preCached ? 40 : Math.round(budget * 0.55);
    before = await analyzeCached(engine, fenBefore, Math.min(480, beforeBudget), 2, beforeBudget);
    const spent = Date.now() - started;
    const afterBudget = Math.max(0, budget - spent);
    if (!gameOver && afterBudget > 60) {
      after = await analyzeCached(engine, fenAfter, Math.min(400, afterBudget), 1, afterBudget);
    }
  }

  const engineUsed = !!before;
  const scoreBefore = before ? kidPov(before.scoreWhite, kidColor) : 0;
  const scoreAfter = mate
    ? 100_000
    : stalemate
      ? 0
      : after
        ? kidPov(after.scoreWhite, kidColor)
        : scoreBefore;
  const loss = engineUsed && after ? Math.max(0, scoreBefore - scoreAfter) : 0;

  const bestUci = before?.bestMove || undefined;
  const playedIsBest =
    !!bestUci && (bestUci === playedUci || bestUci.slice(0, 4) === playedUci.slice(0, 4));

  /* ---- what does the board say? ---------------------------------- */
  const pv = before?.lines?.[0]?.moves;
  const rawMotifs = detectMotifs(fenBefore, fenAfter, playedUci, pv);
  const motifs = topMotifs(rawMotifs, 5, 0.6);

  const facts: TutorFacts = {
    playedSan: played.san,
    playedUci,
    bestSan: bestUci ? sanOf(fenBefore, bestUci) : undefined,
    bestUci,
    // Clamped for display: mate scores are six figures, and no child (or UI)
    // needs to read "997.99 pawns". The raw `loss` still drives the tier.
    lossPawns: Math.round(Math.min(loss, 3000)) / 100,
    scoreAfterPawns: Math.round(Math.max(-3000, Math.min(3000, scoreAfter))) / 100,
    mateForKidIn: mate ? 0 : mateForKid(after?.scoreWhite, kidColor),
    mateAgainstKidIn: mateAgainstKid(after?.scoreWhite, kidColor),
    check,
    mate,
    stalemate,
    gameOver,
    phase: phaseOf(fenAfter),
    motifs,
    engineUsed,
    kidColor,
    fenBefore,
    fenAfter,
  };

  /* ---- 1. tier --------------------------------------------------- */
  const fullmove = Number(fenBefore.split(" ")[5] ?? "1") || 1;
  const tier = gradeTier({
    loss, scoreAfter, scoreBefore, playedIsBest, engineUsed, mate, stalemate,
    motifs, kidColor, fullmove, profile,
  });

  /* ---- 2. the one lesson ----------------------------------------- */
  const opp = opponentWords(!!input.chessPaaIsOpponent);
  const candidate = selectLesson({
    tier, motifs, facts, played, settings, profile, kidColor, seed, opp,
  });

  /* ---- 3. the voice ---------------------------------------------- */
  const tokens: VoiceTokens = {
    ...opp,
    piece: pieceWord(played.piece, settings, seed),
    mover: pieceWord(played.piece, settings, seed),
    played: settings.useNotation ? played.san : moveWord(played.san, played.piece, settings, seed, played.to),
    ...(facts.bestSan ? { best: settings.useNotation ? facts.bestSan : bestAsWords(facts, settings, seed) } : {}),
    ...(candidate?.tokens ?? {}),
  };
  if (settings.useSquares && !tokens.sq) tokens.sq = played.to;

  const say = voiceLine({
    tier,
    lesson: candidate?.lesson ?? null,
    phase: facts.phase,
    band: profile.band,
    settings,
    tokens,
    seed,
    lessonIsWarning: candidate ? WARNING_LESSONS.has(candidate.lesson) : false,
  });

  /* ---- 4. the way forward ---------------------------------------- */
  const ladder = buildLadder(facts, candidate ?? null, settings, profile.band, seed, pv);
  const takeback: TakebackOffer | null =
    !gameOver && (tier === "slip" || tier === "careful")
      ? { text: voiceTakeback(profile.band, seed + 3), fen: fenBefore, undo: [played.from, played.to] }
      : null;

  /* ---- pointers -------------------------------------------------- */
  // Base pointers never reveal the answer — they show what he's TALKING about.
  let pointers = candidate?.pointers ?? NO_POINTERS;
  if (Object.keys(pointers.highlightSquares).length === 0 && isHappyTier(tier)) {
    pointers = highlight([[played.to, "good"]]);
  }

  const concepts = motifs.map((m) => `${m.source}:${m.kind}`);
  const nextProfile = noteMove(profile, {
    tier,
    lessonKey: candidate?.lesson,
    concepts,
  });

  return {
    tier,
    tierLabel: voiceTierLabel(tier, profile.band, seed + 11),
    sticker: TIER_STICKER[tier],
    say,
    lesson: candidate?.lesson ?? null,
    motif: candidate?.motif ?? null,
    pointers,
    hints: ladder,
    takeback,
    mood: TIER_MOOD[tier],
    facts,
    profile: nextProfile,
    elapsedMs: Date.now() - started,
  };
}

/**
 * The response he gives when something has genuinely gone wrong inside the
 * tutor. Still warm, still true, still never a dead end.
 */
function fallbackResponse(
  input: TutorMoveInput,
  profile: LearnerProfile,
  settings: VoiceSettings,
  seed: number,
  started: number,
): TutorResponse {
  const info = playMove(input.fenBefore, input.playedUci);
  const fenAfter = info?.fenAfter ?? input.fenBefore;
  const facts: TutorFacts = {
    playedSan: info?.move.san ?? input.playedUci,
    playedUci: input.playedUci,
    lossPawns: 0,
    scoreAfterPawns: 0,
    check: false,
    mate: false,
    stalemate: false,
    gameOver: false,
    phase: phaseOf(fenAfter),
    motifs: [],
    engineUsed: false,
    kidColor: input.kidColor,
    fenBefore: input.fenBefore,
    fenAfter,
  };
  return {
    tier: "steady",
    tierLabel: voiceTierLabel("steady", profile.band, seed),
    sticker: TIER_STICKER.steady,
    say: voiceLine({
      tier: "steady", lesson: "solidQuiet", phase: facts.phase, band: profile.band,
      settings, tokens: { ...opponentWords(!!input.chessPaaIsOpponent) }, seed,
    }),
    lesson: "solidQuiet",
    motif: null,
    pointers: NO_POINTERS,
    hints: { invitation: "Want a hint?", steps: [], move: undefined },
    takeback: null,
    mood: "twinkle",
    facts,
    profile,
    elapsedMs: Date.now() - started,
  };
}

/* ================================================================== *
 * THE OVER-THE-SHOULDER VOICE
 *
 * Everything below is engine-free and synchronous, so a caller can use it in
 * a render pass or between animation frames without thinking about it.
 * ================================================================== */

export interface TutorWatch {
  /**
   * What he says — or `""` when there is genuinely nothing worth interrupting
   * for, which is most turns. Render nothing at all when it's empty; a
   * grandfather who comments on every single quiet move stops being listened
   * to by about move nine. (For ChessPaa's OWN thinking time, call
   * `voiceWatching()` from voiceLibrary instead — those lines are his mouth,
   * not the child's turn.)
   */
  say: string;
  pointers: TutorPointers;
  /** The most dangerous thing on the board right now, if anything. */
  motif: Motif | null;
  mood: ChessPaaMood;
}

/**
 * "Careful — my bishop is looking at your rook."
 *
 * Called after the OPPONENT moves, before the child touches anything. This is
 * the thing that makes him feel like he's watching rather than marking: a
 * warning that arrives before the mistake costs nothing and teaches
 * everything.
 *
 * Deliberately quiet — it only speaks when there is something genuinely
 * pointed at the child (confidence >= 0.75), and stays silent otherwise.
 */
export function tutorWatch(
  fen: string,
  kidColor: Color,
  profile?: LearnerProfile,
  opts?: { chessPaaIsOpponent?: boolean; seed?: number },
): TutorWatch {
  const p = profile ?? defaultProfile();
  const settings = voiceSettings(p);
  const seed = opts?.seed ?? (Date.now() >>> 3);
  const opp = opponentWords(!!opts?.chessPaaIsOpponent);
  const them = otherColor(kidColor);

  const speak = (lesson: LessonKey, tokens: VoiceTokens, pointers: TutorPointers, motif: Motif | null): TutorWatch => ({
    say: voiceLine({
      tier: "steady",
      lesson,
      phase: phaseOf(fen),
      band: p.band,
      settings,
      tokens,
      seed,
      skipVerdict: true,      // he's not grading anything — he's just pointing
      flourishMood: "gentle", // "your rook is hanging… carry on!" is not a thing
      lessonIsWarning: true,
    }),
    pointers,
    motif,
    mood: "kindly",
  });

  /* ---- the loudest thing on the board: the king is being shouted at ---- */
  // This has to come first AND has to come before the null move, because the
  // null move is illegal while the side to move is in check — which is exactly
  // why the watch used to go silent in the one position that most deserves a
  // grandfather leaning in.
  try {
    const board = new Chess(fen, { skipValidation: true });

    /* ---- the game already ended on this position ---------------------- */
    // A child who has just been checkmated must not be met with silence, and
    // `tutorMove` can never cover it: it only ever grades the child's OWN move.
    // This is the one call that sees the board on the child's turn, so this is
    // where the last word has to live.
    if (board.isGameOver()) {
      const kingSq = board.findPiece({ type: "k", color: kidColor })[0];
      if (board.isCheckmate()) {
        return {
          ...speak("mateLoss", { ...opp }, highlight([[kingSq, "danger"]]), null),
          mood: "kindly",
        };
      }
      // Every other ending is a draw. `drawn` is used even for stalemate here
      // because the stalemate bank is written for the happier direction ("THEIR
      // king had no moves"), and a warm line that is true beats a vivid one
      // that is backwards.
      return { ...speak("drawn", { ...opp }, NO_POINTERS, null), mood: "twinkle" };
    }

    if (board.inCheck()) {
      const kingSq = board.findPiece({ type: "k", color: kidColor })[0];
      return speak(
        "inCheck",
        { ...opp, piece: pieceWord("k", settings, seed), sq: settings.useSquares ? kingSq : undefined },
        highlight([[kingSq, "danger"]]),
        null,
      );
    }
  } catch { /* an unparseable FEN just falls through to the quiet path */ }

  let danger: Motif | null = null;
  try {
    // This runs on the CHILD's turn, and the question is "what does the other
    // side threaten?" — which is a null-move question. Hand the opponent an
    // imaginary free move and see what they'd do with it. Without this the
    // scan finds nothing at all, because nothing is literally hanging while
    // it's your own move.
    const scanFen = flipTurn(fen) ?? fen;
    const found = scanPosition(scanFen, them, "threat", { skipTrapped: true });
    danger = found.find((m) => m.confidence >= 0.75 && m.forSide === them) ?? null;
  } catch { danger = null; }

  if (!danger) {
    // Nothing true and useful to say, so he says nothing. Silence is a
    // feature here: it is what makes the times he DOES speak land.
    return { say: "", pointers: NO_POINTERS, motif: null, mood: "twinkle" };
  }

  return speak(
    WARNING_FOR_MOTIF[danger.kind] ?? "hangingPiece",
    { ...opp, ...motifTokens(danger, settings, seed, "threat") },
    highlight(
      [[danger.squares[0], "danger"], [danger.squares[1], "danger"]],
      motifArrow(danger),
    ),
    danger,
  );
}

/** His hello, pitched at the listener. `ride` is "play" | "tactics" | "train" | "ferris" | "carousel". */
export function tutorGreeting(ride: string, profile?: LearnerProfile, seed?: number): string {
  return voiceGreeting(ride, (profile ?? defaultProfile()).band, seed);
}

/**
 * A stand-alone "what should I do here?" for puzzle rides, where there is no
 * move to grade — just a position and a child who is stuck. Engine-optional:
 * pass the solution's first move and it works instantly.
 */
export function tutorPuzzleHint(
  fen: string,
  solutionUci: string,
  profile?: LearnerProfile,
  seed = 1,
): HintLadder {
  const p = profile ?? defaultProfile();
  const settings = voiceSettings(p);
  const facts: TutorFacts = {
    playedSan: "", playedUci: "", bestUci: solutionUci,
    bestSan: sanOf(fen, solutionUci),
    lossPawns: 0, scoreAfterPawns: 0,
    check: false, mate: false, stalemate: false, gameOver: false,
    phase: phaseOf(fen), motifs: [], engineUsed: false,
    kidColor: fen.split(" ")[1] === "b" ? "b" : "w",
    fenBefore: fen, fenAfter: fen,
  };
  return buildLadder(facts, null, settings, p.band, seed, undefined);
}

/** Re-export so a caller can walk the tier scale without importing levels.ts. */
export { TIER_ORDER, softenTier, tierIndex, isHappyTier } from "./levels";
