/**
 * The Castle of Pieces — every hero on ChessPaa's board.
 * Songs are the Suno tracks in /public/music (null = "ChessPaa is still
 * humming this one", the page shows the rhyme and reads it aloud instead).
 */

export interface PieceInfo {
  slug: string;
  name: string;
  title: string;
  glyph: string;           // unicode piece for UI accents
  fenChar: string;         // lowercase fen letter
  color: string;           // accent color
  song: string | null;     // /music/xxx.mp3
  songAlt?: string;        // bonus take
  rhyme: string[];         // sing-along lines
  secret: string;          // ChessPaa's fun fact
  /** Board demo: piece on square, squares it can reach get sunshine. */
  demo: { square: string; fen: string };
  /** Catch-the-stars mini game: reach every star, legal moves only. */
  starGame: { fen: string; start: string; stars: string[]; parMoves: number };
}

export const PIECES: PieceInfo[] = [
  {
    slug: "pawn",
    name: "Pawn",
    title: "The Brave Little Pawn",
    glyph: "♟",
    fenChar: "p",
    color: "#f59e0b",
    song: "/music/pawn.mp3",
    rhyme: [
      "I'm a little pawn, I march straight ahead,",
      "one square forward, never back, ChessPaa said.",
      "Two on my very first step, then one at a time,",
      "and I capture on a slant — a sneaky diagonal climb!",
      "March me all the way across and what do you see?",
      "A tiny brave pawn turns into a QUEEN — that's me!",
    ],
    secret: "A pawn that reaches the end of the board remembers every step it took.",
    demo: { square: "e2", fen: "8/8/8/8/8/8/4P3/8 w - - 0 1" },
    starGame: {
      fen: "8/8/8/8/8/8/4P3/8 w - - 0 1",
      start: "e2",
      stars: ["e4", "e6", "e8"],
      parMoves: 5,
    },
  },
  {
    slug: "rook",
    name: "Rook",
    title: "The Mighty Rook",
    glyph: "♜",
    fenChar: "r",
    color: "#ef4444",
    song: "/music/rook.mp3",
    rhyme: [
      "I'm the mighty rook, a tower so tall,",
      "I zoom in straight lines, right down the hall!",
      "Up and down, side to side, as far as I please —",
      "but never on a slant, I move straight with ease.",
      "Find me an open lane and watch me roll,",
      "keeping my king safe is my favorite role!",
    ],
    secret: "Two rooks working together are called 'the rook roller' — they can checkmate all by themselves!",
    demo: { square: "d4", fen: "8/8/8/8/3R4/8/8/8 w - - 0 1" },
    starGame: {
      fen: "8/8/8/8/3R4/8/8/8 w - - 0 1",
      start: "d4",
      stars: ["d8", "h8", "h1"],
      parMoves: 3,
    },
  },
  {
    slug: "knight",
    name: "Knight",
    title: "The Knight Who Jumps",
    glyph: "♞",
    fenChar: "n",
    color: "#25A9B4",
    song: "/music/knight.mp3",
    songAlt: "/music/knight-alt.mp3",
    rhyme: [
      "I'm the trickiest knight, I hop just like this —",
      "two squares then one, it's an L you can't miss!",
      "I leap right over my friends and my foes,",
      "the only one who JUMPS, everybody knows!",
      "Up, over, around, I sneak and I spring,",
      "a galloping horse is a marvellous thing!",
    ],
    secret: "A knight in the middle of the board can jump to 8 squares — in the corner, only 2. Ponies hate corners!",
    demo: { square: "d4", fen: "8/8/8/8/3N4/8/8/8 w - - 0 1" },
    starGame: {
      fen: "8/8/8/8/3N4/8/8/8 w - - 0 1",
      start: "d4",
      stars: ["e6", "g5", "f3"],
      parMoves: 3,
    },
  },
  {
    slug: "bishop",
    name: "Bishop",
    title: "The Slippery Bishop",
    glyph: "♝",
    fenChar: "b",
    color: "#8b5cf6",
    song: null,
    rhyme: [
      "I'm the slippery bishop, I glide on a slant,",
      "straight ahead? Diagonals only — I can't and I shan't!",
      "I pick one colour and there I will stay,",
      "light or dark, it's my lane all day.",
      "Give me a long open line to careen,",
      "slicing 'cross the board, so quick and so keen!",
    ],
    secret: "Each side starts with one light-square bishop and one dark-square bishop. They never, ever swap lanes.",
    demo: { square: "d4", fen: "8/8/8/8/3B4/8/8/8 w - - 0 1" },
    starGame: {
      fen: "8/8/8/8/3B4/8/8/8 w - - 0 1",
      start: "d4",
      stars: ["h8", "e1", "a5"],
      parMoves: 4,
    },
  },
  {
    slug: "queen",
    name: "Queen",
    title: "The Marvelous Queen",
    glyph: "♛",
    fenChar: "q",
    color: "#ec4899",
    song: null,
    rhyme: [
      "I'm the Queen, the strongest of all,",
      "any direction — I answer the call!",
      "Straight like the rook, slant like the bishop too,",
      "as far as I like, there's nothing I can't do.",
      "But don't rush me out while it's early and warm —",
      "keep me tucked safe, and I'll weather the storm!",
    ],
    secret: "The queen is worth about nine pawns — as much as a whole rook, bishop, and pawn having a party together.",
    demo: { square: "d4", fen: "8/8/8/8/3Q4/8/8/8 w - - 0 1" },
    starGame: {
      fen: "8/8/8/8/3Q4/8/8/8 w - - 0 1",
      start: "d4",
      stars: ["d8", "h4", "a1"],
      parMoves: 3,
    },
  },
  {
    slug: "king",
    name: "King",
    title: "Checkmate, My Friend",
    glyph: "♚",
    fenChar: "k",
    color: "#facc15",
    song: "/music/king.mp3",
    rhyme: [
      "I'm the King, the heart of it all,",
      "I step just one square — nice and small.",
      "Any direction, but only one at a time,",
      "guard me with care through the danger and grime!",
      "If I'm ever trapped with nowhere to flee,",
      "that's checkmate, my friend — it's all over for me.",
      "So castle me cosy and safe away,",
      "and your king lives to play another day!",
    ],
    secret: "The king never gets captured — the game ends the moment he's trapped. Royal rules!",
    demo: { square: "d4", fen: "3k4/8/8/8/3K4/8/8/8 w - - 0 1" },
    starGame: {
      fen: "8/8/8/8/3K4/8/8/8 w - - 0 1",
      start: "d4",
      stars: ["e5", "f4", "e3"],
      parMoves: 3,
    },
  },
];

export function getPiece(slug: string): PieceInfo | undefined {
  return PIECES.find((p) => p.slug === slug);
}
