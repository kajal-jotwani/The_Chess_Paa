"use client";

/**
 * ChessPaa's coaching brain.
 *
 * Golden rule: Stockfish supplies the truth (evals, best moves), chess.js
 * supplies the board facts (captures, checks, forks), and ChessPaa only
 * wraps those facts in kindness. Nothing here invents chess claims.
 */

import { Chess, type Square, type Move } from "chess.js";
import { EngineClient, Analysis, Score, scoreToCp } from "./engine";

export type Grade = "sparkle" | "great" | "good" | "okay" | "oops" | "blunder";

export interface CoachFacts {
  playedSan: string;
  playedUci: string;
  bestSan: string;
  bestUci: string;
  grade: Grade;
  /** Roughly how many pawns the move gave away vs the best move (>= 0). */
  lossPawns: number;
  /** Position score AFTER the move, from the kid's point of view, in pawns. */
  kidScoreAfterPawns: number;
  mateForKidIn?: number;      // kid has forced mate in N after this move
  mateAgainstKidIn?: number;  // kid gets mated in N if opponent plays best
  missedMateIn?: number;      // there WAS a mate-in-N and the kid missed it
  patterns: string[];         // machine-readable tags, see detectors below
  /** Piece (kid's) that the opponent can now win, if any, e.g. "queen". */
  hangs?: { piece: string; square: string; capturedBy: string };
  /** What the best move would have captured, if it was a capture. */
  missedCapture?: { piece: string; square: string };
  /** Squares involved in a fork available via the best move. */
  fork?: { from: string; targets: string[] };
  check: boolean;
  mate: boolean;
  stalemate: boolean;
  kidColor: "w" | "b";
  fenBefore: string;
  fenAfter: string;
}

const PIECE_NAMES: Record<string, string> = {
  p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king",
};
const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

function kidPov(scoreWhite: Score, kid: "w" | "b"): number {
  const cp = scoreToCp(scoreWhite);
  return kid === "w" ? cp : -cp;
}

function mateForKid(scoreWhite: Score, kid: "w" | "b"): number | undefined {
  if (scoreWhite.type !== "mate") return undefined;
  const v = kid === "w" ? scoreWhite.value : -scoreWhite.value;
  return v > 0 ? v : undefined;
}

function mateAgainstKid(scoreWhite: Score, kid: "w" | "b"): number | undefined {
  if (scoreWhite.type !== "mate") return undefined;
  const v = kid === "w" ? scoreWhite.value : -scoreWhite.value;
  return v < 0 ? -v : undefined;
}

function sanFor(fen: string, uci: string): string {
  try {
    const c = new Chess(fen);
    const mv = c.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: uci.length > 4 ? (uci[4] as "q" | "r" | "b" | "n") : undefined,
    });
    return mv?.san ?? uci;
  } catch {
    return uci;
  }
}

/** Squares a piece on `square` attacks that hold enemy big fish (value >= 3, or king). */
function bigTargets(chess: Chess, square: Square, attackerColor: "w" | "b"): string[] {
  const targets: string[] = [];
  const moves = chess.moves({ square, verbose: true }) as Move[];
  for (const m of moves) {
    if (m.captured && (PIECE_VALUE[m.captured] >= 3)) targets.push(m.to);
  }
  // include check pressure as a "royal target"
  return targets;
}

export interface AnalyzeMoveInput {
  fenBefore: string;
  playedUci: string;
  engine: EngineClient;
  kidColor: "w" | "b";
  /** Analysis of fenBefore if the caller already has it (saves time). */
  preAnalysis?: Analysis;
  budgetMs?: number;
}

/**
 * The full pipeline for one kid move:
 *  1. What did Stockfish think BEFORE (best move, eval)?
 *  2. What does it think AFTER the kid's move?
 *  3. Grade the difference and name the patterns.
 */
export async function analyzeKidMove(input: AnalyzeMoveInput): Promise<CoachFacts> {
  const { fenBefore, playedUci, engine, kidColor } = input;
  const budget = input.budgetMs ?? 700;

  const before = input.preAnalysis ?? (await engine.analyze(fenBefore, { movetimeMs: budget, multipv: 2 }));

  const chessAfter = new Chess(fenBefore);
  const played = chessAfter.move({
    from: playedUci.slice(0, 2) as Square,
    to: playedUci.slice(2, 4) as Square,
    promotion: playedUci.length > 4 ? (playedUci[4] as "q" | "r" | "b" | "n") : undefined,
  });
  const fenAfter = chessAfter.fen();

  const mate = chessAfter.isCheckmate();
  const stalemate = chessAfter.isStalemate();
  const check = chessAfter.inCheck();

  let after: Analysis | null = null;
  if (!mate && !stalemate && !chessAfter.isGameOver()) {
    after = await engine.analyze(fenAfter, { movetimeMs: Math.round(budget * 0.85), multipv: 1 });
  }

  const beforeKid = kidPov(before.scoreWhite, kidColor);
  const afterKid = mate
    ? 100_000
    : stalemate
      ? 0
      : after
        ? kidPov(after.scoreWhite, kidColor)
        : 0;

  const rawLoss = Math.max(0, beforeKid - afterKid);
  const lossPawns = Math.round(rawLoss) / 100;

  const playedSan = played?.san ?? playedUci;
  const bestSan = sanFor(fenBefore, before.bestMove);
  const playedIsBest = playedUci === before.bestMove ||
    (playedUci.slice(0, 4) === before.bestMove.slice(0, 4) && before.bestMove.length <= 4);

  // ---- grade ----------------------------------------------------------
  let grade: Grade;
  if (mate) grade = "sparkle";
  else if (playedIsBest) grade = rawLoss <= 60 ? "sparkle" : "great";
  else if (rawLoss <= 45) grade = "great";
  else if (rawLoss <= 95) grade = "good";
  else if (rawLoss <= 190) grade = "okay";
  else if (rawLoss <= 420) grade = "oops";
  else grade = "blunder";

  // A kind curve: if the kid is still completely winning, soften the blow.
  if ((grade === "oops" || grade === "blunder") && afterKid >= 600) grade = "okay";
  // Stalemating from a totally winning position is its own teachable moment.
  if (stalemate && beforeKid > 400) grade = "oops";

  // ---- patterns -------------------------------------------------------
  const patterns: string[] = [];
  const facts: CoachFacts = {
    playedSan,
    playedUci,
    bestSan,
    bestUci: before.bestMove,
    grade,
    lossPawns,
    kidScoreAfterPawns: Math.round(afterKid) / 100,
    mateForKidIn: after ? mateForKid(after.scoreWhite, kidColor) : undefined,
    mateAgainstKidIn: after ? mateAgainstKid(after.scoreWhite, kidColor) : undefined,
    patterns,
    check,
    mate,
    stalemate,
    kidColor,
    fenBefore,
    fenAfter,
  };

  if (mate) { patterns.push("checkmateWin"); return facts; }
  if (stalemate) { patterns.push("stalemate"); return facts; }

  const beforeChess = new Chess(fenBefore);

  // missed a forced mate?
  const mateBefore = mateForKid(before.scoreWhite, kidColor);
  if (mateBefore && !facts.mateForKidIn && !playedIsBest) {
    facts.missedMateIn = mateBefore;
    patterns.push("missedMate");
  }

  // did the best move win material we skipped?
  if (!playedIsBest && rawLoss >= 140) {
    try {
      const b = new Chess(fenBefore);
      const bm = b.move({
        from: before.bestMove.slice(0, 2) as Square,
        to: before.bestMove.slice(2, 4) as Square,
        promotion: before.bestMove.length > 4 ? (before.bestMove[4] as "q") : undefined,
      });
      if (bm?.captured && PIECE_VALUE[bm.captured] >= 3) {
        facts.missedCapture = { piece: PIECE_NAMES[bm.captured], square: bm.to };
        patterns.push("missedCapture");
      } else if (bm && !bm.captured) {
        const forkTargets = bigTargets(b, bm.to as Square, kidColor);
        const givesCheck = b.inCheck();
        if (forkTargets.length >= 2 || (givesCheck && forkTargets.length >= 1)) {
          facts.fork = { from: bm.to, targets: forkTargets };
          patterns.push("missedFork");
        }
      }
    } catch { /* best move failed to parse — skip pattern */ }
  }

  // does the opponent's best reply win one of our pieces?
  if (after && rawLoss >= 120 && after.bestMove) {
    try {
      const a = new Chess(fenAfter);
      const reply = a.move({
        from: after.bestMove.slice(0, 2) as Square,
        to: after.bestMove.slice(2, 4) as Square,
        promotion: after.bestMove.length > 4 ? (after.bestMove[4] as "q") : undefined,
      });
      if (reply?.captured && PIECE_VALUE[reply.captured] >= 3) {
        facts.hangs = {
          piece: PIECE_NAMES[reply.captured],
          square: reply.to,
          capturedBy: PIECE_NAMES[reply.piece],
        };
        patterns.push(reply.to === playedUci.slice(2, 4) ? "hungMovedPiece" : "hungPiece");
      }
    } catch { /* ignore */ }
  }

  // nice-thing detectors (independent of grade)
  if (played?.san === "O-O" || played?.san === "O-O-O") patterns.push("castled");
  if (played?.promotion) patterns.push("promoted");
  if (check && (grade === "sparkle" || grade === "great" || grade === "good")) patterns.push("goodCheck");
  if (played?.captured && rawLoss <= 60) patterns.push("goodCapture");
  if (playedIsBest) patterns.push("bestMove");
  if (facts.mateForKidIn) patterns.push("matingSoon");
  if (facts.mateAgainstKidIn && facts.mateAgainstKidIn <= 3) patterns.push("dangerMate");

  // early-game development praise
  const moveNum = parseInt(fenBefore.split(" ")[5] ?? "1", 10);
  if (moveNum <= 8 && played && (played.piece === "n" || played.piece === "b")) {
    const fromRank = played.from[1];
    const homeRank = kidColor === "w" ? "1" : "8";
    if (fromRank === homeRank && rawLoss <= 80) patterns.push("developed");
  }
  if (moveNum <= 6 && played?.piece === "q" && rawLoss > 80) patterns.push("earlyQueen");

  // did the kid ignore a threat? (opponent could have taken something anyway)
  void beforeChess;

  return facts;
}
