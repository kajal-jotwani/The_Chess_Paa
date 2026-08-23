/**
 * The Endgame Ferris Wheel — each cabin is a winning position the child
 * finishes off against the engine. Slow, calm, and confidence-building:
 * "tricky endgames, easy wins".
 */

export interface Cabin {
  slug: string;
  name: string;
  emoji: string;
  color: string;
  fen: string;            // child always plays White, White is winning
  goal: string;
  lesson: string;         // ChessPaa's opening tip for the cabin
  parMoves: number;       // mate within par = 3 stars
  engineLevel: number;    // 0..4 defender strength
}

export const CABINS: Cabin[] = [
  {
    slug: "queen-ladder",
    name: "The Queen's Ladder",
    emoji: "👑",
    color: "#ec4899",
    fen: "8/8/8/4k3/8/8/4Q3/4K3 w - - 0 1",
    goal: "Checkmate the lonely king with your queen and king.",
    lesson:
      "The queen builds a fence the enemy king can't cross, then shrinks his yard rung by rung — like climbing a ladder. Keep the queen a pony-jump away from his king so he can never touch her, walk YOUR king closer, and only give check when it's checkmate. Careful: if he has NO moves and it's NOT check, that's stalemate — a draw!",
    parMoves: 12,
    engineLevel: 2,
  },
  {
    slug: "rook-roller",
    name: "The Rook Roller",
    emoji: "🎢",
    color: "#ef4444",
    fen: "8/8/8/4k3/8/8/R7/1R2K3 w - - 0 1",
    goal: "Checkmate with the famous two-rook 'lawnmower'.",
    lesson:
      "One rook cuts a line the king can't cross. The other rook checks on the next line, pushing him back a row. Then they take turns — mow, mow, mow — until the king runs out of grass. If he attacks a rook, slide it far away along the same line!",
    parMoves: 10,
    engineLevel: 2,
  },
  {
    slug: "pawns-dream",
    name: "The Little Pawn's Dream",
    emoji: "🌟",
    color: "#f59e0b",
    fen: "8/5k2/8/8/8/8/1P4K1/8 w - - 0 1",
    goal: "Walk your pawn all the way and promote it to a queen — then win!",
    lesson:
      "Every pawn dreams of the last rank. The secret: your KING is the bodyguard — walk him in front of the pawn, not behind. Escort the little dreamer up the board, crown a queen, then use the Queen's Ladder you already know!",
    parMoves: 16,
    engineLevel: 1,
  },
  {
    slug: "king-rook",
    name: "The King & Rook Team-Up",
    emoji: "🤝",
    color: "#25A9B4",
    fen: "8/8/8/3k4/8/8/8/R3K3 w - - 0 1",
    goal: "The classic king + rook checkmate — the graduation dance!",
    lesson:
      "This one needs teamwork: the rook builds the fence, but your KING must stand face-to-face with their king (a 'staring contest') before the rook gives the final check. Push him to the edge, win the staring contest, then — check! This is the trickiest cabin, take it slow.",
    parMoves: 18,
    engineLevel: 3,
  },
];

export function getCabin(slug: string): Cabin | undefined {
  return CABINS.find((c) => c.slug === slug);
}
