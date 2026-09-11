import type { PuzzleDef } from "./PuzzleMode";

type Buckets = Record<string, PuzzleDef[]>;
type Data = { tactics: Buckets; endgames: Buckets; train: Buckets };

// The 556 KB puzzle set is only needed once a puzzle attraction is entered, so it
// loads as its own chunk (App prefetches it a few seconds after boot).
let cached: Promise<Data> | null = null;
export const loadPuzzles = () => (cached ??= import("../data/puzzles.json").then((m) => m.default as unknown as Data));

const shuffle = <T>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

export const TACTIC_THEMES = [
  { key: "mateIn1", name: "Checkmate in 1", emoji: "👑", blurb: "Finish the game in one move" },
  { key: "mateIn2", name: "Checkmate in 2", emoji: "👑👑", blurb: "Two moves to glory" },
  { key: "fork", name: "Forks", emoji: "🍴", blurb: "One piece, two targets" },
  { key: "pin", name: "Pins", emoji: "📌", blurb: "Stuck in place!" },
  { key: "skewer", name: "Skewers", emoji: "🍢", blurb: "Attack through a piece" },
  { key: "discoveredAttack", name: "Discovered attacks", emoji: "🎭", blurb: "Move one, reveal another" },
  { key: "hangingPiece", name: "Free pieces", emoji: "🍬", blurb: "Somebody forgot to guard it" },
  { key: "backRankMate", name: "Back-rank mates", emoji: "🚪", blurb: "The king is boxed in" },
];
export const ENDGAME_THEMES = [
  { key: "queenEndgame", name: "Queen endings", emoji: "♕", blurb: "The queen finishes the job" },
  { key: "rookEndgame", name: "Rook endings", emoji: "♖", blurb: "Towers to the rescue" },
  { key: "pawnEndgame", name: "Pawn races", emoji: "♙", blurb: "Run to the last rank" },
  { key: "promotion", name: "Promotion", emoji: "🌟", blurb: "A pawn becomes a queen" },
  { key: "endgameMate", name: "Endgame mates", emoji: "🏁", blurb: "Checkmate with few pieces" },
];

/**
 * A gentle ramp: mostly from the easier 60% of the bucket (by rank, so it also
 * works for themes with few sub-1000 puzzles), then a few harder ones, sorted so
 * a child never opens a track with its hardest puzzle.
 */
function rampSet(pool: PuzzleDef[], n: number, easyShare = 0.6): PuzzleDef[] {
  const sorted = [...pool].sort((a, b) => a.rating - b.rating);
  const cut = Math.floor(sorted.length * easyShare);
  const easy = shuffle(sorted.slice(0, cut)).slice(0, Math.ceil(n * easyShare));
  const hard = shuffle(sorted.slice(cut)).slice(0, n - easy.length);
  return [...easy, ...hard].sort((a, b) => a.rating - b.rating);
}

export async function tacticSet(theme: string, n = 8): Promise<PuzzleDef[]> { const data = await loadPuzzles(); return rampSet(data.tactics[theme] ?? [], n); }
export async function endgameSet(theme: string, n = 8): Promise<PuzzleDef[]> { const data = await loadPuzzles(); return rampSet(data.endgames[theme] ?? [], n); }
/** Puzzle-rush ladder: easy first, gradually harder. */
export async function rushSet(n = 40): Promise<PuzzleDef[]> {
  const data = await loadPuzzles();
  const out: PuzzleDef[] = [];
  const bands = ["band1", "band2", "band3", "band4", "band5"].map((b) => shuffle(data.train[b] ?? []));
  const plan = [6, 8, 9, 9, 8];
  bands.forEach((b, i) => out.push(...b.slice(0, plan[i])));
  return out.slice(0, n);
}
export async function puzzleCounts() {
  const data = await loadPuzzles();
  return { tactics: Object.fromEntries(Object.entries(data.tactics).map(([k, v]) => [k, v.length])), endgames: Object.fromEntries(Object.entries(data.endgames).map(([k, v]) => [k, v.length])), train: Object.fromEntries(Object.entries(data.train).map(([k, v]) => [k, v.length])) };
}
