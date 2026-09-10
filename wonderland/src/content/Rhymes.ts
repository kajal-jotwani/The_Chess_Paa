import type { Square } from "chess.js";

/**
 * The Piece Academy: one rhyme per piece, each line paired with a board
 * "beat" (a position + squares to glow + an optional move to act out), then a
 * little try-it challenge.  Kings parked far away are scenery.
 */
export interface Beat { fen: string; glow: Square[]; from?: Square; to?: Square; note: string; }
export interface TryIt { fen: string; goal: string; targets: Square[]; piece: Square; hint: string; }
export interface PieceLesson { piece: "p" | "n" | "b" | "r" | "q" | "k"; name: string; emoji: string; song?: string; rhyme: string[]; beats: Beat[]; tryIt: TryIt; }

export const LESSONS: PieceLesson[] = [
  {
    piece: "p", name: "Pawn", emoji: "♙", song: "/music/pawn.mp3",
    rhyme: [
      "I'm the little pawn, so brave and small,",
      "I march straight forward, never back at all.",
      "One step at a time — but on my very first go,",
      "I can hop two squares, ready, set, GO!",
      "I capture sideways, diagonally, with a cheer,",
      "And if I reach the end… a QUEEN appears!",
    ],
    beats: [
      { fen: "7k/8/8/8/8/8/4P3/K7 w - - 0 1", glow: ["e2"], note: "Meet the pawn on e2. Small, but full of dreams." },
      { fen: "7k/8/8/8/8/8/4P3/K7 w - - 0 1", glow: ["e3"], from: "e2", to: "e3", note: "Forward only. A pawn never, ever goes backwards." },
      { fen: "7k/8/8/8/8/8/4P3/K7 w - - 0 1", glow: ["e3", "e4"], note: "From its home square it may choose one step or two." },
      { fen: "7k/8/8/8/8/8/4P3/K7 w - - 0 1", glow: ["e4"], from: "e2", to: "e4", note: "Two squares on the first move — a running start!" },
      { fen: "7k/8/8/8/3p1p2/4P3/8/K7 w - - 0 1", glow: ["d4", "f4"], from: "e3", to: "d4", note: "It captures diagonally, one square ahead, left or right." },
      { fen: "7k/4P3/8/8/8/8/8/K7 w - - 0 1", glow: ["e8"], from: "e7", to: "e8", note: "Reach the far side and the pawn is promoted — usually to a queen!" },
    ],
    tryIt: { fen: "7k/8/8/8/3p4/8/4P3/K7 w - - 0 1", goal: "Move the pawn so it could capture next turn — get to the ⭐ square!", targets: ["e3"], piece: "e2", hint: "Diagonal captures need the enemy pawn to be one square ahead on the side." },
  },
  {
    piece: "n", name: "Knight", emoji: "♘", song: "/music/knight.mp3",
    rhyme: [
      "I'm the knight, a horse that hops,",
      "In the shape of an L — I never stop!",
      "Two squares one way, then one to the side,",
      "Over the heads of pieces I ride.",
      "Nobody blocks me, I jump with glee,",
      "The only piece who leaps — that's me!",
    ],
    beats: [
      { fen: "7k/8/8/8/3N4/8/8/K7 w - - 0 1", glow: ["d4"], note: "The knight on d4. Ready to hop." },
      { fen: "7k/8/8/8/3N4/8/8/K7 w - - 0 1", glow: ["b3", "b5", "c2", "c6", "e2", "e6", "f3", "f5"], note: "Eight L-shaped landing squares — a star of hops." },
      { fen: "7k/8/8/8/3N4/8/8/K7 w - - 0 1", glow: ["d5", "d6", "e6"], from: "d4", to: "e6", note: "Two up, one across. That's the L." },
      { fen: "7k/8/8/8/3N4/8/8/K7 w - - 0 1", glow: ["c4", "b4", "b5"], from: "d4", to: "b5", note: "Or two across, one up. Still an L!" },
      { fen: "7k/8/8/2ppp3/2pNp3/2ppp3/8/K7 w - - 0 1", glow: ["b3", "b5", "c2", "c6", "e2", "e6", "f3", "f5"], from: "d4", to: "f5", note: "Surrounded? No problem. The knight jumps right over." },
      { fen: "7k/8/8/8/3N4/8/8/K7 w - - 0 1", glow: ["d4"], note: "The only piece that leaps. Every hop lands on the opposite colour!" },
    ],
    tryIt: { fen: "7k/8/8/8/8/8/1N6/K7 w - - 0 1", goal: "Hop the knight to the ⭐ square in ONE jump.", targets: ["c4", "d3", "d1", "a4"], piece: "b2", hint: "Two squares one way, then one square sideways." },
  },
  {
    piece: "b", name: "Bishop", emoji: "♗",
    rhyme: [
      "I'm the bishop, sliding on the slant,",
      "Diagonals are my dance — straight lines I can't!",
      "I glide far, as far as I please,",
      "Until a piece stands in my way… then I freeze.",
      "One of us loves light squares, one loves dark,",
      "Together we cover the whole board — what a lark!",
    ],
    beats: [
      { fen: "k7/8/8/8/3B4/8/8/7K w - - 0 1", glow: ["d4"], note: "The bishop on d4, a dark square. It will live on dark squares forever." },
      { fen: "k7/8/8/8/3B4/8/8/7K w - - 0 1", glow: ["a1", "b2", "c3", "e5", "f6", "g7", "h8", "a7", "b6", "c5", "e3", "f2", "g1"], note: "Two long diagonals, like an X across the board." },
      { fen: "k7/8/8/8/3B4/8/8/7K w - - 0 1", glow: ["e5", "f6", "g7"], from: "d4", to: "g7", note: "Slide as far as you like along the slant." },
      { fen: "k7/8/5p2/8/3B4/8/8/7K w - - 0 1", glow: ["e5", "f6"], from: "d4", to: "f6", note: "A piece in the way? Capture it — but you cannot jump past." },
      { fen: "k7/8/8/8/3B4/8/8/7K w - - 0 1", glow: ["d5", "c4", "e4", "d3"], note: "Never straight up, down or across. Those are not the bishop's roads." },
      { fen: "k7/8/8/8/2BB4/8/8/7K w - - 0 1", glow: ["c4", "d4"], note: "One bishop on light, one on dark: together they see everything." },
    ],
    tryIt: { fen: "k7/8/8/8/8/8/1B6/7K w - - 0 1", goal: "Slide the bishop to the ⭐ square.", targets: ["f6", "e5", "g7", "h8"], piece: "b2", hint: "Follow the long diagonal from b2 toward the top-right corner." },
  },
  {
    piece: "r", name: "Rook", emoji: "♖", song: "/music/rook.mp3",
    rhyme: [
      "I'm the rook, a tower strong and tall,",
      "I roll in straight lines — that's my call.",
      "Up and down, side to side,",
      "Files and ranks are where I glide.",
      "I love an open road, wide and free,",
      "And I guard the king in castling — with glee!",
    ],
    beats: [
      { fen: "k7/8/8/8/3R4/8/8/7K w - - 0 1", glow: ["d4"], note: "The rook on d4. Square shoulders, straight roads." },
      { fen: "k7/8/8/8/3R4/8/8/7K w - - 0 1", glow: ["d1", "d2", "d3", "d5", "d6", "d7", "d8", "a4", "b4", "c4", "e4", "f4", "g4", "h4"], note: "A plus sign: the whole file and the whole rank." },
      { fen: "k7/8/8/8/3R4/8/8/7K w - - 0 1", glow: ["d5", "d6", "d7", "d8"], from: "d4", to: "d8", note: "Up the file, as far as the road is clear." },
      { fen: "k7/8/8/8/3R4/8/8/7K w - - 0 1", glow: ["e4", "f4", "g4", "h4"], from: "d4", to: "h4", note: "Or across the rank." },
      { fen: "k7/8/8/8/3R2p1/8/8/7K w - - 0 1", glow: ["e4", "f4", "g4"], from: "d4", to: "g4", note: "Stopped by a piece? Capture it, but no jumping." },
      { fen: "k7/8/8/8/8/8/8/4K2R w K - 0 1", glow: ["e1", "h1", "f1", "g1"], from: "e1", to: "g1", note: "Castling: the king hops two squares and the rook leaps over to guard him." },
    ],
    tryIt: { fen: "k7/8/8/8/8/8/8/R6K w - - 0 1", goal: "Roll the rook to the ⭐ square.", targets: ["a8", "a7", "a6"], piece: "a1", hint: "Straight up the a-file." },
  },
  {
    piece: "q", name: "Queen", emoji: "♕",
    rhyme: [
      "I'm the queen — the strongest of all!",
      "Straight like a rook, I roll down the hall,",
      "Slanted like a bishop, I glide with grace,",
      "Every direction, I cover the place.",
      "But careful, dear friend, don't rush me out —",
      "Protect your queen, she's what winning's about!",
    ],
    beats: [
      { fen: "k7/8/8/8/3Q4/8/8/7K w - - 0 1", glow: ["d4"], note: "Her Majesty on d4." },
      { fen: "k7/8/8/8/3Q4/8/8/7K w - - 0 1", glow: ["d1", "d2", "d3", "d5", "d6", "d7", "d8", "a4", "b4", "c4", "e4", "f4", "g4", "h4"], note: "Rook roads: files and ranks…" },
      { fen: "k7/8/8/8/3Q4/8/8/7K w - - 0 1", glow: ["a1", "b2", "c3", "e5", "f6", "g7", "h8", "a7", "b6", "c5", "e3", "f2", "g1"], note: "…AND bishop roads: the diagonals." },
      { fen: "k7/8/8/8/3Q4/8/8/7K w - - 0 1", glow: ["d1", "d2", "d3", "d5", "d6", "d7", "d8", "a4", "b4", "c4", "e4", "f4", "g4", "h4", "a1", "b2", "c3", "e5", "f6", "g7", "h8", "a7", "b6", "c5", "e3", "f2", "g1"], from: "d4", to: "h8", note: "Twenty-seven squares from the middle of the board. Wow!" },
      { fen: "k7/8/8/8/3Q4/8/8/7K w - - 0 1", glow: ["d4"], note: "So strong that everyone wants to catch her. Keep her safe early on." },
      { fen: "k7/8/8/8/3Q4/8/8/7K w - - 0 1", glow: ["d4"], note: "Knights and bishops first; the queen joins the party a little later." },
    ],
    tryIt: { fen: "k7/8/8/8/8/8/8/3Q3K w - - 0 1", goal: "Move the queen to the ⭐ square in ONE move.", targets: ["h5", "d8", "a4"], piece: "d1", hint: "Straight OR diagonal — the queen can do both." },
  },
  {
    piece: "k", name: "King", emoji: "♔", song: "/music/king.mp3",
    rhyme: [
      "I'm the king — the most important of all,",
      "Lose me, and the whole kingdom falls!",
      "I step one square, in any direction,",
      "Slow and careful, with royal perfection.",
      "When I'm attacked, they shout out CHECK!",
      "And if I can't escape… it's CHECKMATE — by heck!",
    ],
    beats: [
      { fen: "k7/8/8/8/3K4/8/8/8 w - - 0 1", glow: ["d4"], note: "The king on d4. Slow, precious, and never captured — only trapped." },
      { fen: "k7/8/8/8/3K4/8/8/8 w - - 0 1", glow: ["c3", "c4", "c5", "d3", "d5", "e3", "e4", "e5"], note: "One step in any direction: eight squares around him." },
      { fen: "k7/8/8/8/3K4/8/8/8 w - - 0 1", glow: ["e5"], from: "d4", to: "e5", note: "One careful step at a time." },
      { fen: "k7/8/8/8/3K4/8/8/8 w - - 0 1", glow: ["c3", "c4", "c5", "d3", "d5", "e3", "e4", "e5"], note: "He may never step onto an attacked square." },
      { fen: "k7/8/8/8/8/8/8/3r1K2 w - - 0 1", glow: ["f1", "d1"], note: "CHECK! The rook attacks the king. He must get out of it right away." },
      { fen: "k7/8/8/8/8/8/5q2/7K w - - 0 1", glow: ["h1", "f2"], note: "CHECKMATE: attacked, and no escape at all. The game is over." },
    ],
    tryIt: { fen: "k7/8/8/8/8/8/8/3r1K2 w - - 0 1", goal: "The king is in CHECK. Step him to a safe ⭐ square.", targets: ["e2", "f2", "g2"], piece: "f1", hint: "Any square the rook can't see — off the first rank!" },
  },
];

export const CHECKMATE_LESSON = {
  title: "Checkmate!",
  lines: ["Attack the king so he cannot escape — that's checkmate, and the game is won!", "Three ways out of check: move the king, block the attack, or capture the attacker.", "If none of the three work… CHECKMATE!"],
};
