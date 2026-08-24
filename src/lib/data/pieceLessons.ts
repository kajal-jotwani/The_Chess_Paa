/**
 * DID YOU KNOW — ChessPaa leans in.
 * ============================================================================
 *
 * The six rhymes in `rhymes.ts` teach the RULES: how each piece moves, sung so a
 * five-year-old can join in. This file is the second helping, for the child who
 * has heard the poem, learned the moves, and now wants to know WHY.
 *
 * Three beats per piece, eighteen in all, covering the things that actually turn
 * a child who knows the moves into a child who is playing chess: what the pieces
 * are worth, why a pony in a corner is a sad pony, why two bishops on opposite
 * colours can never settle an argument, the five little rules of castling, and
 * the stalemate that snatches a won game away from a careless queen.
 *
 * SAME STAGE, SAME CONTRACT. A `LessonBeat` stages itself exactly like a `Beat`
 * does — legal FEN, squares to glow, an optional move to act out — so whatever
 * component plays the parade can play these too, with nothing new to learn:
 *
 *     1. load  beat.fen
 *     2. glow  beat.highlight
 *     3. show  beat.title / speak beat.body
 *     4. if beat.from/to, slide the piece
 *
 * Every FEN and every move here is verified against chess.js. The mates are real
 * mates, the stalemate is a real stalemate, and the fork really does win the queen.
 * These teach the actual rules, so they had better be actually right.
 *
 * VOICE. Still ChessPaa: warm, specific, a bit silly, never talking down. Where a
 * grown-up word is genuinely useful ("en passant", "opposition", "the bishop pair")
 * we say it, because a child who knows the real word feels ten feet tall.
 */

import type { GlowKind, PieceType, Square } from "./rhymes";

/* ========================================================================== */
/*  TYPES                                                                      */
/* ========================================================================== */

/**
 * What kind of idea this is, so a UI can sort, colour or filter them:
 *  value    — what a piece is worth, and what to trade it for
 *  geometry — how the piece moves through space (colours, corners, distance)
 *  rule     — a genuine rule of chess most beginners miss
 *  safety   — how to not lose the thing
 *  endgame  — what changes when the board empties out
 */
export type LessonTag = "value" | "geometry" | "rule" | "safety" | "endgame";

/**
 * The youngest age this really lands for — a hint for gating, not a gate.
 * 6 = anyone who has heard the rhyme. 8 = reads and counts happily.
 * 10 = enjoys an idea that needs holding in the head for a moment.
 *
 * Nothing here is ever hidden as a punishment: a UI that shows all three to
 * everybody is also correct, just chattier.
 */
export type LessonAge = 6 | 8 | 10;

export interface LessonBeat {
  /** Stable key for React lists, progress marks and deep links. */
  id: string;
  title: string;
  /** ChessPaa's explanation. Written as one spoken paragraph — read it aloud. */
  body: string;
  /** Legal FEN staging the idea. */
  fen: string;
  /**
   * How to draw `highlight` — see `GlowKind` in rhymes.ts. Absent means "reach".
   * Sixteen of these eighteen beats are "look" beats: the lessons point at prices,
   * blocked diagonals, mating nets and forbidden squares far more often than they
   * point at legal moves.
   */
  glow?: GlowKind;
  /** Squares to light up. The body always says what they mean. */
  highlight: Square[];
  /** Optional move to act out. For castling this is the KING's move. */
  from?: Square;
  to?: Square;
  age: LessonAge;
  tag: LessonTag;
}

export interface PieceLesson {
  type: PieceType;
  /** Matches `PIECE_SLUG` in rhymes.ts, for routing. */
  slug: string;
  /** Section heading above the beats. */
  title: string;
  beats: LessonBeat[];
}

/* ========================================================================== */
/*  PAWN                                                                       */
/* ========================================================================== */

const PAWN_LESSON: PieceLesson = {
  type: "p",
  slug: "pawn",
  title: "More about the brave little pawn",
  beats: [
    {
      id: "pawn-price-list",
      title: "ChessPaa's price list",
      // The pawn is the unit everything else is measured in, so the whole value
      // chart belongs to him even though it is about the other five pieces.
      body:
        "Everything on this board is priced in pawns, and the little fellow himself is worth exactly one. A pony is three. A bishop is three. A rook is five. The queen is nine — nearly two rooks! And the king has no price at all, because you can never, ever trade him. Line them up like this and you can see it: b4, c4, d4, e4, f4, worth one, three, three, five, nine.",
      fen: "k7/8/8/8/1PNBRQ2/8/8/7K w - - 0 1",
      glow: "look",
      highlight: ["b4", "c4", "d4", "e4", "f4"],
      age: 8,
      tag: "value",
    },
    {
      id: "pawn-en-passant",
      title: "En passant — the sneaky sidestep",
      body:
        "Here is the strangest rule in all of chess, and it is real. That black pawn has just used its big first hop, d7 all the way to d5, whooshing straight past your pawn on e5. You are allowed to catch it anyway — you take it as if it had only stepped to d6, and it vanishes from d5. It is called en passant, which is French for in passing, and you may only do it the very instant it happens. Wait one move and the chance is gone forever.",
      fen: "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1",
      glow: "look",
      highlight: ["d5", "d6", "e5"],
      from: "e5",
      to: "d6",
      age: 8,
      tag: "rule",
    },
    {
      id: "pawn-chain",
      title: "Pawns hold hands",
      body:
        "A pawn is the only piece in the whole game that can never go backwards, so every pawn move is a promise you cannot take back. That is why pawns like to stand on a slant, one behind the other, holding hands: c3 guards d4, and d4 guards e5. Push one and the whole fence still stands. Grown-ups call it a pawn chain, and it is the strongest little wall a child can build.",
      fen: "4k3/8/8/4P3/3P4/2P5/8/4K3 w - - 0 1",
      glow: "look",
      highlight: ["c3", "d4", "e5"],
      age: 8,
      tag: "safety",
    },
  ],
};

/* ========================================================================== */
/*  KNIGHT                                                                     */
/* ========================================================================== */

const KNIGHT_LESSON: PieceLesson = {
  type: "n",
  slug: "knight",
  title: "More about the pony who will not walk",
  beats: [
    {
      id: "knight-hates-corners",
      title: "Why ponies hate corners",
      // Two knights in ONE position so the child compares rather than remembers:
      // eight glowing squares beside two, on the same board, at the same moment.
      body:
        "Count them with me. The pony standing out in the middle on d4 can reach eight squares. The poor thing squashed into the corner on h1 can reach two. Two! That is why ChessPaa always says a knight on the rim is dim — bring your ponies towards the middle of the park where they can see everything, and they will do four times as much work for you.",
      fen: "4k3/8/8/8/3N4/8/8/4K2N w - - 0 1",
      glow: "look",
      highlight: ["b3", "b5", "c2", "c6", "e2", "e6", "f3", "f5", "f2", "g3"],
      age: 6,
      tag: "geometry",
    },
    {
      id: "knight-fork",
      title: "The fork — two prizes, one hop",
      // The pony must SURVIVE the trick, or the picture teaches the wrong thing.
      // Every one of Black's four legal replies is a king step that walks AWAY
      // from d5, so Nxd5 is clean in all of them — and the pony lands in the middle
      // of the park, which is exactly where the lesson above says he belongs.
      body:
        "Now watch his favourite trick in the whole world. The pony hops from g4 to f6, and from there he is poking the king on g8 AND the queen on d5 at the very same time. Black cannot eat him and cannot get in his way either — a pony's check is the one check in all of chess that you can never block — so the king has to step aside, and the moment he does, the pony trots over and helps himself to the queen. Two prizes with one hop. That is a fork, and ponies are the very best in the park at making them.",
      fen: "6k1/8/8/3q4/6N1/8/8/K7 w - - 0 1",
      glow: "look",
      highlight: ["f6", "d5", "g8"],
      from: "g4",
      to: "f6",
      age: 8,
      tag: "geometry",
    },
    {
      id: "knight-colour-flip",
      title: "Ponies count in twos",
      body:
        "Look very carefully at where he is standing and where he can land. He is on a dark square — and every single square he can jump to is cream. He flips colour with every hop, always, without exception. So if your pony is on cream and the square you want is also cream, he will need an even number of hops to get there: two, or four, never three. Once you know that, you can count his journeys before he makes them.",
      fen: "7k/8/8/8/3N4/8/8/K7 w - - 0 1",
      highlight: ["b3", "b5", "c2", "c6", "e2", "e6", "f3", "f5"],
      age: 10,
      tag: "geometry",
    },
  ],
};

/* ========================================================================== */
/*  BISHOP                                                                     */
/* ========================================================================== */

const BISHOP_LESSON: PieceLesson = {
  type: "b",
  slug: "bishop",
  title: "More about the bishop and his colour",
  beats: [
    {
      id: "bishop-opposite-colours",
      title: "Two bishops who never meet",
      // The highlight is both bishops' full reach at once, and the two sets do
      // not share a single square. The picture proves the sentence.
      body:
        "Here is the white bishop's whole world, and here is the black bishop's whole world, both lit up together. Now look for a square where they overlap. There isn't one. There never will be. These two will chase each other for an entire game and never once meet, because one lives on cream and one lives on dark. Grown-ups call this opposite-coloured bishops, and it is the reason some games that look completely lost end in a friendly handshake instead.",
      fen: "4k3/8/8/2b5/4B3/8/8/4K3 w - - 0 1",
      glow: "look",
      highlight: [
        "d5", "c6", "b7", "a8", "f5", "g6", "h7", "d3", "c2", "b1", "f3", "g2", "h1",
        "b4", "a3", "d4", "e3", "f2", "g1", "b6", "a7", "d6", "e7", "f8",
      ],
      age: 10,
      tag: "endgame",
    },
    {
      id: "bishop-pair",
      title: "The bishop pair",
      body:
        "One bishop is worth about three pawns, the same as a pony. But two bishops standing on an open board are worth more than three and three added together — because between them they can finally see every square in the park, cream and dark, with nowhere left to hide. Grown-ups call it the bishop pair, and a good player will happily give up a pony just to get it. Look at how much of the board these two cover between them.",
      fen: "4k3/8/8/8/2B5/8/1B6/4K3 w - - 0 1",
      glow: "look",
      highlight: [
        "a1", "c1", "a3", "c3", "d4", "e5", "f6", "g7", "h8",
        "b3", "a2", "d3", "e2", "f1", "b5", "a6", "d5", "e6", "f7", "g8",
      ],
      age: 8,
      tag: "value",
    },
    {
      id: "bishop-bad-bishop",
      title: "A sad bishop, and how to cheer him up",
      body:
        "Oh dear. This bishop lives on cream squares, and his own pawns have gone and parked on c4 and e4 — cream squares, both of them. Now count what he can actually reach: b1, c2, e2, f1. Four squares, in the whole park, forever. Keep your pawns on the opposite colour to your bishop and he will thank you all game long by flying about like a paper aeroplane instead of sitting behind a wall.",
      fen: "4k3/8/8/2p1p3/2P1P3/3B4/8/4K3 w - - 0 1",
      glow: "look",
      highlight: ["b1", "c2", "e2", "f1", "c4", "e4"],
      age: 10,
      tag: "safety",
    },
  ],
};

/* ========================================================================== */
/*  ROOK                                                                       */
/* ========================================================================== */

const ROOK_LESSON: PieceLesson = {
  type: "r",
  slug: "rook",
  title: "More about the rook and his hallways",
  beats: [
    {
      id: "rook-castling-rules",
      title: "The five little rules of castling",
      // The rhyme shows castling short; the lesson shows it long, so the child
      // sees that it works on both wings and that the rook travels further.
      body:
        "Castling has five rules and every one of them is fair. One: the king and that rook must both still be sitting exactly where they started, and neither may have moved even once. Two: every square between them must be empty. Three: the king may not already be in check. Four: he may not step through a square that somebody is attacking. Five: he may not land on one either. Tick all five and you get the cosiest move in chess. Here it is going the long way, e1 all the way to c1.",
      fen: "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
      glow: "look",
      highlight: ["a1", "b1", "c1", "d1", "e1"],
      from: "e1",
      to: "c1",
      age: 8,
      tag: "rule",
    },
    {
      id: "rook-open-file",
      title: "Rooks love an empty corridor",
      body:
        "A file with no pawns standing in it is called an open file, and it is a rook's favourite thing in the entire world. Put one rook on it, then bring the second one up right behind him — grown-ups call that doubling. Two rooks stacked on an open file are like two elephants in a corridor, both facing the same way. Something at the far end is about to give way.",
      fen: "4k3/8/8/8/8/8/3R4/3R1K2 w - - 0 1",
      highlight: ["d3", "d4", "d5", "d6", "d7", "d8"],
      age: 8,
      tag: "value",
    },
    {
      id: "rook-lawnmower-mate",
      title: "Two rooks can finish a game alone",
      body:
        "Watch the ladder. One rook already owns the whole seventh row, so the king can never come down. Now the other one climbs to the eighth — and snap, there is nowhere left in the world to stand. Checkmate, with two rooks and nobody else helping at all. ChessPaa calls it the lawnmower: one rook cuts the row the king is on, the other cuts the row he wants, and they take turns all the way up the board.",
      fen: "7k/R7/8/8/8/8/1R6/4K3 w - - 0 1",
      glow: "look",
      highlight: ["a7", "b7", "c7", "d7", "e7", "f7", "g7", "h7", "b8"],
      from: "b2",
      to: "b8",
      age: 8,
      tag: "endgame",
    },
  ],
};

/* ========================================================================== */
/*  QUEEN                                                                      */
/* ========================================================================== */

const QUEEN_LESSON: PieceLesson = {
  type: "q",
  slug: "queen",
  title: "More about Her Majesty",
  beats: [
    {
      id: "queen-worth",
      title: "Is she worth two rooks?",
      body:
        "The queen is worth nine, and a rook is worth five — so two rooks come to ten, which is a whole pawn more than she is. Surprising, isn't it? Two rooks who have found each other, stacked up on an open file with nothing in the way, really are the better deal. But she loves a board full of loose pieces and a king caught out in the open, because she can poke at two things at once and no rook can chase her off. Use ChessPaa's price list to decide a swap, and then use your eyes, because a brilliant pony beats a lazy queen any day of the week.",
      fen: "4k3/8/8/8/3Q4/8/8/2R1K1R1 w - - 0 1",
      glow: "look",
      highlight: ["d4", "c1", "g1"],
      age: 8,
      tag: "value",
    },
    {
      id: "queen-stalemate",
      title: "Stalemate — the queen's only real enemy",
      // The single most heartbreaking thing that happens to a child who is winning.
      // Shown as a move they can watch go wrong, not a rule read out at them.
      body:
        "Careful now, this one stings. White is a whole queen up and plays Qf7, crowding the lonely king into the corner. But look: the black king is NOT in check — and he has nowhere at all to go. g8, g7 and h7 are all covered, and he has nothing else to move. That is stalemate, and stalemate is a DRAW. All that queen, and nobody wins. Always leave the lonely king one square to breathe in, right up until the moment you can say checkmate.",
      fen: "7k/8/8/8/8/8/5Q2/6K1 w - - 0 1",
      glow: "look",
      highlight: ["h8", "g8", "g7", "h7"],
      from: "f2",
      to: "f7",
      age: 8,
      tag: "rule",
    },
    {
      id: "queen-too-early",
      title: "Don't send her out first",
      body:
        "Watch what happens when she rushes out. White brought the queen to h5 on the second move. Black simply answered by bringing a pony to c6, then poked her with a pawn on g6 — and back home to d1 she trudges. Count it up: White has moved his queen twice and she is standing exactly where she began, while Black got a pony out and built a cosy house for a bishop, both for free. Let the little ones go first and build the party. The queen arrives when the party is ready for her.",
      fen: "r1bqkbnr/pppp1p1p/2n3p1/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 4",
      glow: "look",
      highlight: ["h5", "g6", "c6", "d1"],
      from: "h5",
      to: "d1",
      age: 8,
      tag: "safety",
    },
  ],
};

/* ========================================================================== */
/*  KING                                                                       */
/* ========================================================================== */

const KING_LESSON: PieceLesson = {
  type: "k",
  slug: "king",
  title: "More about the king",
  beats: [
    {
      id: "king-cannot-take-defended",
      title: "The one piece who may not be brave",
      body:
        "That pawn on d5 looks like free lunch, doesn't it? Now look just behind it: the pawn on c6 is guarding it. A king may never step onto a square that somebody is attacking — not to escape, not to hide, and not even to eat something delicious. He is the only piece in the whole game who is not allowed to be brave, and that is exactly why everybody else has to be brave for him.",
      fen: "4k3/8/2p5/3pK3/8/8/8/8 w - - 0 1",
      glow: "look",
      highlight: ["d5", "c6"],
      age: 6,
      tag: "rule",
    },
    {
      id: "king-opposition",
      title: "The staring contest",
      body:
        "Two kings may never touch, so when they stand nose to nose with exactly one square between them, something funny happens: whoever has to move first must give way. It is White's turn here, and the whole row in front of him is shut: c4, d4 and e4 all touch the black king, so he is not allowed to set foot on any of them. He must step sideways or backwards and let the black king come forward. Grown-ups call this the opposition, and in a game down to two kings and one pawn, it decides absolutely everything. The trick is to make it the OTHER fellow's turn.",
      fen: "8/8/8/3k4/8/3K4/8/8 w - - 0 1",
      glow: "look",
      highlight: ["d4", "c3", "e3", "c4", "e4"],
      from: "d3",
      to: "c3",
      age: 10,
      tag: "endgame",
    },
    {
      id: "king-endgame-fighter",
      title: "When the old fellow puts his boots on",
      // The pawn is on e4, NOT e5, and that is load-bearing. King e6 + pawn e5 with
      // White to move is the textbook DRAW — Black holds the opposition and White
      // ends up stalemating him. Pulling the pawn back one square hands White the
      // spare tempo, and the promise in the last sentence becomes true: this position
      // is a forced win however Black wriggles. Do not "tidy" the pawn forwards.
      body:
        "For most of the game you keep him tucked in his cottage. But when the board empties out and there is nobody dangerous left, the king stands up, puts on his boots and becomes a fighting piece — worth about as much as a pony. Walk him up the board IN FRONT of your pawn, like a grandfather clearing the snow off the path, and the pawn will follow him all the way to a crown.",
      fen: "4k3/8/4K3/8/4P3/8/8/8 w - - 0 1",
      glow: "look",
      highlight: ["d7", "e7", "f7"],
      age: 10,
      tag: "endgame",
    },
  ],
};

/* ========================================================================== */
/*  PUBLIC API                                                                 */
/* ========================================================================== */

/** The six lesson sets, in the same parade order as `RHYMES`. */
export const PIECE_LESSONS: PieceLesson[] = [
  PAWN_LESSON,
  KNIGHT_LESSON,
  BISHOP_LESSON,
  ROOK_LESSON,
  QUEEN_LESSON,
  KING_LESSON,
];

export const LESSON_BY_TYPE: Record<PieceType, PieceLesson> = {
  p: PAWN_LESSON,
  n: KNIGHT_LESSON,
  b: BISHOP_LESSON,
  r: ROOK_LESSON,
  q: QUEEN_LESSON,
  k: KING_LESSON,
};

/** Total — every piece type has a lesson set. */
export function lessonFor(type: PieceType): PieceLesson {
  return LESSON_BY_TYPE[type];
}

/** Flat list of all eighteen beats, parade order then lesson order. */
export const ALL_LESSON_BEATS: LessonBeat[] = PIECE_LESSONS.flatMap((l) => l.beats);

/** Look one up by its stable id — for deep links and progress marks. */
export function lessonBeatById(id: string): LessonBeat | undefined {
  return ALL_LESSON_BEATS.find((b) => b.id === id);
}

/**
 * The beats suitable for a given age, youngest-first within each piece.
 *
 * `maxAge` is an inclusive ceiling: `lessonBeatsForAge(l, 8)` returns the 6s and
 * the 8s and holds the 10s back. Nothing is ever removed as a punishment — this
 * exists so the six-year-old is not handed a paragraph about the opposition
 * before she has finished enjoying the rhyme.
 *
 * ⚠ CAN RETURN AN EMPTY ARRAY. Only the knight and the king currently carry an
 * age-6 beat, so `lessonBeatsForAge(lesson, 6)` is EMPTY for the pawn, bishop,
 * rook and queen. A caller that renders the result straight into a "did you know"
 * panel will show a six-year-old a blank box on four pieces out of six — a dead
 * end, which this park does not allow. Until those beats are re-aged, callers MUST
 * fall back to something (the rhyme's `secret`, or simply show all three anyway,
 * which the ages permit: they are a hint, not a gate).
 */
export function lessonBeatsForAge(lesson: PieceLesson, maxAge: LessonAge): LessonBeat[] {
  return lesson.beats.filter((b) => b.age <= maxAge);
}
