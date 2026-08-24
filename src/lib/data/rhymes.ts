/**
 * THE SIX PIECE RHYMES — the heart of the Piece Parade.
 * ============================================================================
 *
 * Six poems, one per piece, in ChessPaa's voice. The text is FINAL — it is the
 * bible text, transcribed verbatim, and must never be rewritten or "improved".
 * Everything else in this file exists so the board can act the poems out.
 *
 * WHY THIS SHAPE
 * --------------
 * A rhyme is not a paragraph, it is a little play. Each LINE of the poem gets a
 * matching BEAT — a stage direction telling the board what to be while that line
 * is spoken. The parade therefore never has to understand chess; it just walks
 * the beats in order and does exactly what each one says:
 *
 *     1. load  beat.demoFen           (reset the board — every beat is self-contained)
 *     2. glow  beat.highlight         (what the words are pointing at RIGHT NOW)
 *     3. speak rhyme[beat.line]       (and show beat.note as the grown-up gloss)
 *     4. if beat.from/to, slide the piece across while the line lands
 *
 * INVARIANTS you may rely on (all six rhymes, checked against chess.js):
 *   • beats.length === rhyme.length, and beats[i].line === i  (0-based).
 *     So `rhyme.map((line, i) => [line, beats[i]])` is always valid.
 *   • Every demoFen loads in chess.js without throwing.
 *   • Every from/to (and tryIt.from/to) is a LEGAL move in its own fen.
 *   • Every square string is a real square (the `Square` type is 64 literals,
 *     so a typo is a compile error, not a runtime shrug).
 *
 * EVERY BEAT IS A RESET, NOT A CONTINUATION. Beat 5 does not inherit beat 4's
 * board. This is deliberate: it lets a line rewind ("or two, the first…" puts
 * the pawn back on e2) and it means a child who taps a line out of order still
 * sees the right picture. Storybooks turn pages; they do not keep a stack.
 *
 * THE WALLFLOWER KINGS. chess.js will not load a position without both kings,
 * so most demos park a king in a far corner where it cannot possibly interfere.
 * For the bishop demos the kings sit on the OPPOSITE colour to the bishop, which
 * makes it geometrically impossible for them to block a single diagonal. Those
 * kings are scenery — a renderer is welcome to fade them right down.
 *
 * HIGHLIGHT MEANS "LOOK HERE", NOT ALWAYS "YOU MAY GO HERE". Usually it is the
 * squares the piece can reach, but sometimes it is the squares it is FORBIDDEN
 * (the pawn's blocked path, the bishop's cream neighbours, the rook's corners).
 * `note` always says which in prose — and `glow` says which in a way a renderer can
 * actually branch on. Read `GlowKind` before you draw a single dot.
 *
 * @see pieceLessons.ts for the "did you know" material for older children.
 */

import type { PieceType } from "@/three/core/geometry/pieces";

export type { PieceType };

/* ========================================================================== */
/*  TYPES                                                                      */
/* ========================================================================== */

type FileLetter = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";
type RankDigit = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";

/**
 * A board square in algebraic notation. Structurally identical to chess.js's
 * own `Square` union, so these strings drop straight into `chess.move({from,to})`
 * with no cast — but declared here so this module stays dependency-free and can
 * be imported from a worker, the server, or a build script.
 */
export type Square = `${FileLetter}${RankDigit}`;

/**
 * What a `highlight` array MEANS, so the board never offers a move it would refuse.
 *
 *  "reach" (the default when the field is absent) — every highlighted square is a
 *      square the piece we are talking about may legally move to right now. Safe to
 *      render as "you may go here" move dots.
 *
 *  "look" — the words are POINTING at these squares, not offering them. They might be
 *      squares the piece is forbidden (the bishop's four cream neighbours), squares it
 *      merely travels through, the piece's own square, the line an enemy is attacking
 *      along, or two different pieces' lanes at once. Render these as a warm "look
 *      here" glow — a second, softer treatment — and NEVER as a move affordance.
 *
 * This is not a nicety. 21 of the 48 rhyme beats are "look" beats, and on every one
 * of them a green "you may move here" dot would be telling a child something false.
 */
export type GlowKind = "reach" | "look";

/**
 * One line of the poem, staged.
 *
 * `line` is a 0-based index into the parent rhyme's `rhyme` array. It is always
 * equal to the beat's own position in `beats`; the field is spelled out anyway
 * so a beat can be passed around on its own and still know which words it belongs to.
 */
export interface Beat {
  /** 0-based index into `PieceRhyme.rhyme`. */
  line: number;
  /** A legal FEN staging this line. Load it fresh — beats do not chain. */
  demoFen: string;
  /** How to draw `highlight`. Absent means "reach" — safe as move dots. */
  glow?: GlowKind;
  /** Squares to light up while the line is spoken. `note` says what they mean. */
  highlight: Square[];
  /** If present with `to`: act the move out. For castling this is the KING's move. */
  from?: Square;
  to?: Square;
  /** ChessPaa's aside, written to be read aloud or printed under the board. */
  note?: string;
}

/**
 * The child's own turn, offered once the poem has finished.
 *
 * Pass this through `beatMove({ demoFen: fen, from, to })` before handing it to
 * chess.js — the pawn's tryIt is a promotion, and without the inferred `q` the
 * move is ambiguous and will be rejected.
 */
export interface TryIt {
  /** Legal FEN. The child is always the side to move, and always White. */
  fen: string;
  /** The move we are hoping for. Every tryIt is built so this is findable. */
  from: Square;
  to: Square;
  /** The ask, in ChessPaa's voice. */
  prompt: string;
  /** What he says when they get it. */
  praise: string;
  /** What he says when they wander — a hand on the shoulder, never a buzzer. */
  nudge: string;
}

export interface PieceRhyme {
  type: PieceType;
  /** Storybook chapter title — goes on the parade banner. */
  title: string;
  /** The poem, one entry per line. FINAL TEXT. Do not edit. */
  rhyme: string[];
  /** One beat per line, in order. `beats[i].line === i`. */
  beats: Beat[];
  tryIt: TryIt;
  /** The fact ChessPaa saves for last, leaning in. */
  secret: string;
}

/* ========================================================================== */
/*  THE SIX RHYMES                                                             */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
/*  PAWN                                                                       */
/*                                                                             */
/*  Wallflower kings: black a8 / h8, white a1 / h1 depending on the scene.      */
/*  The promotion scene puts the black king on a6 so that the new queen on e8   */
/*  does NOT give check — a red "check" ring in the middle of the happiest      */
/*  moment in the whole poem would be a lie about what just happened.           */
/* -------------------------------------------------------------------------- */

const PAWN: PieceRhyme = {
  type: "p",
  title: "The Brave Little Pawn",
  rhyme: [
    "Little pawn, so brave and small,",
    "I only march ahead —",
    "one square onward, that is all",
    "(or two, the first, it's said).",
    "I never strike the road I tread;",
    "I nip the corners, near instead.",
    "And if I reach the farthest lane,",
    "I stride back grand — a queen again!",
  ],
  beats: [
    {
      line: 0,
      demoFen: "7k/8/8/8/8/8/4P3/K7 w - - 0 1",
      glow: "look",
      highlight: ["e2"],
      note: "There he is, on e2. The smallest piece on the whole board, and the bravest.",
    },
    {
      line: 1,
      demoFen: "7k/8/8/8/8/8/4P3/K7 w - - 0 1",
      highlight: ["e3", "e4"],
      note: "Forwards. Only ever forwards. A pawn cannot turn round, not once, not ever.",
    },
    {
      line: 2,
      demoFen: "7k/8/8/8/8/8/4P3/K7 w - - 0 1",
      from: "e2",
      to: "e3",
      highlight: ["e3"],
      note: "One square. Plod. That is the whole of a pawn's ordinary day.",
    },
    {
      // Rewind to e2 on purpose: the two-square hop is only ever offered from
      // the pawn's HOME square, and showing it from e3 would teach a lie.
      line: 3,
      demoFen: "7k/8/8/8/8/8/4P3/K7 w - - 0 1",
      from: "e2",
      to: "e4",
      highlight: ["e3", "e4"],
      note: "But on his very first step — and only then — he may take a big two-square hop.",
    },
    {
      line: 4,
      demoFen: "7k/8/8/3np3/4P3/8/8/K7 w - - 0 1",
      glow: "look",
      highlight: ["e5"],
      note: "Now look: a pawn stands right in his path on e5. He cannot take it. Straight ahead is for walking, never for eating.",
    },
    {
      line: 5,
      demoFen: "7k/8/8/3np3/4P3/8/8/K7 w - - 0 1",
      from: "e4",
      to: "d5",
      glow: "look",
      highlight: ["d5", "f5"],
      note: "He eats sideways-and-forwards, one little slant. There is a pony on d5 — munch! (f5 is empty, so that corner stays shut.)",
    },
    {
      line: 6,
      demoFen: "8/4P3/k7/8/8/8/8/7K w - - 0 1",
      highlight: ["e8"],
      note: "One square from the farthest lane. Every step of the way he has been marching towards this.",
    },
    {
      // Pawn to the last rank: `beatMove()` adds promotion "q" so the parade
      // crowns her exactly the way the poem promises.
      line: 7,
      demoFen: "8/4P3/k7/8/8/8/8/7K w - - 0 1",
      from: "e7",
      to: "e8",
      highlight: ["e8"],
      note: "And up he stands — a QUEEN. The smallest piece becomes the mightiest, and the whole park cheers.",
    },
  ],
  tryIt: {
    fen: "8/6P1/8/2k5/8/8/8/6K1 w - - 0 1",
    from: "g7",
    to: "g8",
    prompt: "Your turn, my dear! One brave little pawn on g7, one step from the end of the world. March him.",
    praise: "A QUEEN! From the smallest to the mightiest in one single step. ChessPaa is doing a small dance and knocking things over.",
    nudge: "Straight up, my dear — g7 to g8. The far edge is where the magic lives.",
  },
  secret:
    "A pawn who reaches the end may choose to become a rook, a bishop or a pony instead of a queen. Almost nobody does. Choosing the pony has a name — underpromotion — and it is the cheekiest move in all of chess.",
};

/* -------------------------------------------------------------------------- */
/*  KNIGHT                                                                     */
/*                                                                             */
/*  Two scenes: the open board (so the L reads cleanly) and two different       */
/*  cages (so "clear the block" is a fact you can SEE, not a claim). The pawn    */
/*  box in beats 2/3/5 is eight friendly pawns; the hedge in beats 6/7 is five   */
/*  enemy pawns, two of which are attacking him — which is exactly the "road     */
/*  ahead is tight" the poem is talking about.                                  */
/* -------------------------------------------------------------------------- */

const KNIGHT: PieceRhyme = {
  type: "n",
  title: "The Pony Who Will Not Walk",
  rhyme: [
    "I'm the horse who will not walk",
    "the tidy, trotting way —",
    "I hop an L and clear the block,",
    "right over all the fray!",
    "Two-and-across, a clip-clop bound,",
    "the only piece to leave the ground.",
    "So when the road ahead is tight,",
    "call for me — I'll jump it, the knight!",
  ],
  beats: [
    {
      line: 0,
      demoFen: "7k/8/8/8/3N4/8/8/K7 w - - 0 1",
      glow: "look",
      highlight: ["d4"],
      note: "One pony, standing in the middle of the park, refusing to behave.",
    },
    {
      line: 1,
      demoFen: "7k/8/8/8/3N4/8/8/K7 w - - 0 1",
      glow: "look",
      highlight: ["c3", "c4", "c5", "d3", "d5", "e3", "e4", "e5"],
      note: "These are the eight tidy squares next door. He is the only piece on the board who ignores every single one of them.",
    },
    {
      // Three different L's across this poem (f5 here, e6 at line 4, c6 at line 7)
      // so the parade never plays the same slide twice and the child sees the
      // shape rather than memorising one particular hop.
      line: 2,
      demoFen: "7k/8/8/2PPP3/2PNP3/2PPP3/8/K7 w - - 0 1",
      from: "d4",
      to: "f5",
      highlight: ["f5"],
      note: "Walled in on all eight sides by his own friends — and out he pops anyway. Over the top, never through.",
    },
    {
      line: 3,
      demoFen: "7k/8/8/2PPP3/2PNP3/2PPP3/8/K7 w - - 0 1",
      highlight: ["b3", "b5", "c2", "c6", "e2", "e6", "f3", "f5"],
      note: "Eight ways out of that box, all of them straight over somebody's head.",
    },
    {
      line: 4,
      demoFen: "7k/8/8/8/3N4/8/8/K7 w - - 0 1",
      from: "d4",
      to: "e6",
      glow: "look",
      highlight: ["d5", "d6", "e6"],
      note: "Count it with me: two squares one way — d5, d6 — then one square across. Clip. Clop. That's the L.",
    },
    {
      line: 5,
      demoFen: "7k/8/8/2PPP3/2PNP3/2PPP3/8/K7 w - - 0 1",
      glow: "look",
      highlight: ["c3", "c4", "c5", "d3", "d5", "e3", "e4", "e5"],
      note: "Nobody else can do this. Not the queen, not the rook, not anybody. He is the only piece who leaves the ground.",
    },
    {
      line: 6,
      demoFen: "7k/8/8/ppppp3/3N4/8/8/K7 w - - 0 1",
      glow: "look",
      highlight: ["a5", "b5", "c5", "d5", "e5"],
      note: "A whole hedge of enemy pawns, and two of them poking at him. For anybody else this is the end of the road.",
    },
    {
      line: 7,
      demoFen: "7k/8/8/ppppp3/3N4/8/8/K7 w - - 0 1",
      from: "d4",
      to: "c6",
      highlight: ["c6"],
      note: "And over the hedge he goes, landing safe behind it. Hooray for the pony!",
    },
  ],
  tryIt: {
    fen: "7k/8/2r5/2ppp3/2pNp3/2ppp3/8/K7 w - - 0 1",
    from: "d4",
    to: "c6",
    prompt: "Your turn! The pony is fenced in on every single side — and there's a rook sitting on c6 just past the fence. Fetch it.",
    praise: "Clip-clop, CRUNCH! Straight over the fence and home again with a rook under his arm. Nobody else on this board could have done that.",
    nudge: "Two squares up and one across, my dear: d4 to c6. Fences mean absolutely nothing to a pony.",
  },
  secret:
    "Look closely at where a pony lands. He starts on dark and lands on cream, every single hop, for his whole life. So to get from a cream square to another cream square he needs an even number of jumps. Ponies count in twos.",
};

/* -------------------------------------------------------------------------- */
/*  BISHOP                                                                     */
/*                                                                             */
/*  d4 is a DARK square, so the wallflower kings live on a8/h1 — both CREAM.    */
/*  A cream-square king can never stand in a dark-square bishop's way, which     */
/*  means every diagonal in this lesson is guaranteed open, forever.             */
/*  Beat 3 flips the whole thing to a cream bishop with dark-square kings        */
/*  (b8/h2) so the child sees the same rule from the other colour.               */
/* -------------------------------------------------------------------------- */

const BISHOP: PieceRhyme = {
  type: "b",
  title: "The Bishop Keeps His Colour",
  rhyme: [
    "On slants I slide, I never stray",
    "from the one hue I grew —",
    "I keep to cream, or keep to dark,",
    "whichever square is true.",
    "As far as open corners run,",
    "I glide, a long unbroken bow.",
    "Two of us, one pale, one deep —",
    "the criss-cross lanes are ours to keep.",
  ],
  beats: [
    {
      line: 0,
      demoFen: "k7/8/8/8/3B4/8/8/7K w - - 0 1",
      highlight: [
        "a1", "b2", "c3", "e5", "f6", "g7", "h8",
        "a7", "b6", "c5", "e3", "f2", "g1",
      ],
      note: "Thirteen squares from d4, and not one of them is straight. The bishop only ever travels on the slant.",
    },
    {
      line: 1,
      demoFen: "k7/8/8/8/3B4/8/8/7K w - - 0 1",
      glow: "look",
      highlight: ["c4", "d5", "e4", "d3"],
      note: "And look at the four squares right beside him. Every one of them is cream. He cannot reach a single one — not today, not in a hundred games.",
    },
    {
      line: 2,
      demoFen: "k7/8/8/8/3B4/8/8/7K w - - 0 1",
      from: "d4",
      to: "g1",
      highlight: ["g1"],
      note: "Send him right across the park to g1. Still dark. Wherever he lands, he lands on his own colour.",
    },
    {
      line: 3,
      demoFen: "1k6/8/8/8/4B3/8/7K/8 w - - 0 1",
      highlight: [
        "d5", "c6", "b7", "a8", "f5", "g6", "h7",
        "d3", "c2", "b1", "f3", "g2", "h1",
      ],
      note: "Here is his cream-coloured brother on e4, on his own cream lanes. Two bishops, two worlds, and the worlds never touch.",
    },
    {
      line: 4,
      demoFen: "k7/8/8/8/3B4/8/8/7K w - - 0 1",
      highlight: ["a1", "h8", "a7", "g1"],
      note: "Give him an open lane and he takes the whole thing, right the way out to the corner.",
    },
    {
      line: 5,
      demoFen: "k7/8/8/8/3B4/8/8/7K w - - 0 1",
      from: "d4",
      to: "h8",
      highlight: ["e5", "f6", "g7", "h8"],
      note: "One smooth glide, all in a single move. No stopping, no turning, no fuss.",
    },
    {
      line: 6,
      demoFen: "k7/8/8/8/8/8/8/2B2B1K w - - 0 1",
      glow: "look",
      highlight: ["c1", "f1"],
      note: "You begin every game with two of them: the one born on c1 is dark, the one born on f1 is cream. They keep those colours for life.",
    },
    {
      line: 7,
      demoFen: "k7/8/8/8/8/8/8/2B2B1K w - - 0 1",
      glow: "look",
      highlight: [
        "b2", "a3", "d2", "e3", "f4", "g5", "h6",
        "e2", "d3", "c4", "b5", "a6", "g2", "h3",
      ],
      note: "But together — oh, together they cover both colours, and the whole park turns into a net of crossing lanes.",
    },
  ],
  tryIt: {
    fen: "k7/8/7r/8/8/8/6K1/2B5 w - - 0 1",
    from: "c1",
    to: "h6",
    prompt: "Your turn! There's a rook on h6, sitting all alone on a dark square. Ride the long slant and collect it.",
    praise: "Swoosh! Corner to corner in one unbroken bow, and a rook for your trouble. That is the bishop's entire trick and you just did it perfectly.",
    nudge: "Follow the dark squares out of c1: d2, e3, f4, g5… and there's the rook waiting on h6. It's all one straight slant.",
  },
  secret:
    "Because a bishop can never change colour, half of the board is invisible to him for his entire life. That is why two bishops working together are so strong — one takes the cream squares, one takes the dark, and suddenly there is nowhere left to hide.",
};

/* -------------------------------------------------------------------------- */
/*  ROOK                                                                       */
/*                                                                             */
/*  Wallflower kings a5 / h1: a5 is off the rook's d-file AND off his 4th       */
/*  rank, so none of the long charges accidentally land in check. Beats 6–7      */
/*  switch to a real castling position — the from/to there is the KING's move    */
/*  (e1→g1), which is how chess.js, UCI and every engine encode castling.        */
/* -------------------------------------------------------------------------- */

const ROOK: PieceRhyme = {
  type: "r",
  title: "The Rook and the Long Hallway",
  rhyme: [
    "Straight as a hallway, plain and true,",
    "I charge the ranks and files —",
    "no corners for me, I barrel through",
    "in long and level miles.",
    "Up or down or side to side,",
    "as far as open floors are wide.",
    "And with my king I've one neat trick:",
    "we castle away, snug and quick!",
  ],
  beats: [
    {
      line: 0,
      demoFen: "8/8/8/k7/3R4/8/8/7K w - - 0 1",
      glow: "look",
      highlight: ["d4"],
      note: "The rook. Square shoulders, square manners, and absolutely no imagination — which is exactly why he is so good at his job.",
    },
    {
      line: 1,
      demoFen: "8/8/8/k7/3R4/8/8/7K w - - 0 1",
      highlight: [
        "d1", "d2", "d3", "d5", "d6", "d7", "d8",
        "a4", "b4", "c4", "e4", "f4", "g4", "h4",
      ],
      note: "Fourteen squares from d4: everything up and down his file, everything left and right along his rank. Two hallways, crossing.",
    },
    {
      line: 2,
      demoFen: "8/8/8/k7/3R4/8/8/7K w - - 0 1",
      glow: "look",
      highlight: ["c3", "c5", "e3", "e5"],
      note: "Slants? Not for him. He does not know how to turn a corner and he is not the least bit sorry about it.",
    },
    {
      line: 3,
      demoFen: "8/8/8/k7/3R4/8/8/7K w - - 0 1",
      from: "d4",
      to: "d8",
      highlight: ["d5", "d6", "d7", "d8"],
      note: "Straight up the file, the whole length of the board, all in one move.",
    },
    {
      line: 4,
      demoFen: "8/8/8/k7/3R4/8/8/7K w - - 0 1",
      from: "d4",
      to: "h4",
      highlight: ["e4", "f4", "g4", "h4"],
      note: "And sideways just as far. Up, down, left, right — he treats them all exactly the same.",
    },
    {
      line: 5,
      demoFen: "8/8/3p4/k7/3R4/8/8/7K w - - 0 1",
      from: "d4",
      to: "d6",
      highlight: ["d5", "d6"],
      note: "As far as the floor is OPEN, mind. That pawn on d6 is where the hallway ends. He may munch it — but d7 and d8 are behind a shut door.",
    },
    {
      line: 6,
      demoFen: "4k3/8/8/8/8/8/8/4K2R w K - 0 1",
      glow: "look",
      highlight: ["e1", "h1"],
      note: "Here is the trick, and it needs two things: the king and this rook must both still be sitting where they started, with nothing at all in between.",
    },
    {
      // from/to is the KING's e1→g1. chess.js reads that as O-O and swings the
      // rook to f1 by itself; the parade should animate BOTH pieces.
      line: 7,
      demoFen: "4k3/8/8/8/8/8/8/4K2R w K - 0 1",
      from: "e1",
      to: "g1",
      highlight: ["f1", "g1"],
      note: "Castling! One move, two pieces: the king takes two steps sideways and the rook leaps over him to f1. Snug as a bug, quick as that.",
    },
  ],
  tryIt: {
    fen: "6k1/8/8/8/R6b/8/8/6K1 w - - 0 1",
    from: "a4",
    to: "h4",
    prompt: "Your turn! Look along the fourth rank — a clear hallway all the way across, and a bishop loitering on h4. Charge!",
    praise: "WHOOSH — straight down the hall and out the other end with a bishop. Long and level miles, exactly as promised.",
    nudge: "Stay on the fourth rank, my dear. All the way from a4 across to h4 — there is nothing in your way at all.",
  },
  secret:
    "Castling is the only move in the whole of chess where two of your own pieces move at once. The king shuffles two squares sideways, and the rook hops clean over him to land on the other side — the one and only time in the game that a rook is allowed to jump anything.",
};

/* -------------------------------------------------------------------------- */
/*  QUEEN                                                                      */
/*                                                                             */
/*  Wallflower kings a6 / h1 — a6 sits off every one of the queen's four lines  */
/*  from d4 AND off rank 8 and the h-file, so neither of her big marches         */
/*  (d4→d8, d4→h8) ends in an accidental check. The last beat is the poem's      */
/*  warning made literal: a single pawn on c6 shoos her off the board's best     */
/*  square. That pawn is also, neatly, what shields its own king from her.       */
/* -------------------------------------------------------------------------- */

const QUEEN: PieceRhyme = {
  type: "q",
  title: "Her Majesty Borrows Everything",
  rhyme: [
    "I am the queen, and I confess",
    "I borrow every art —",
    "the rook's long road, the bishop's slant,",
    "I play them both by heart.",
    "Any line and any length,",
    "I rule the board with gentle strength.",
    "The mightiest march you'll ever see —",
    "but mind me well: don't leave me free!",
  ],
  beats: [
    {
      line: 0,
      demoFen: "8/8/k7/8/3Q4/8/8/7K w - - 0 1",
      glow: "look",
      highlight: ["d4"],
      note: "Her Majesty, standing in the middle of absolutely everything.",
    },
    {
      line: 1,
      demoFen: "8/8/k7/8/3Q4/8/8/7K w - - 0 1",
      highlight: [
        "d1", "d2", "d3", "d5", "d6", "d7", "d8",
        "a4", "b4", "c4", "e4", "f4", "g4", "h4",
        "a1", "b2", "c3", "e5", "f6", "g7", "h8",
        "a7", "b6", "c5", "e3", "f2", "g1",
      ],
      note: "Twenty-seven squares from one single spot. More than half the park, all at once.",
    },
    {
      line: 2,
      demoFen: "8/8/k7/8/3Q4/8/8/7K w - - 0 1",
      highlight: [
        "d1", "d2", "d3", "d5", "d6", "d7", "d8",
        "a4", "b4", "c4", "e4", "f4", "g4", "h4",
      ],
      note: "Here is the rook's half of her gift: straight up, straight down, straight across.",
    },
    {
      line: 3,
      demoFen: "8/8/k7/8/3Q4/8/8/7K w - - 0 1",
      highlight: [
        "a1", "b2", "c3", "e5", "f6", "g7", "h8",
        "a7", "b6", "c5", "e3", "f2", "g1",
      ],
      note: "And here is the bishop's half: every slant, both colours of lane. She simply does both, and she does not even hurry.",
    },
    {
      line: 4,
      demoFen: "8/8/k7/8/3Q4/8/8/7K w - - 0 1",
      from: "d4",
      to: "d8",
      highlight: ["d5", "d6", "d7", "d8"],
      note: "Pick a line — up the file, right to the top.",
    },
    {
      line: 5,
      demoFen: "8/8/k7/8/3Q4/8/8/7K w - - 0 1",
      highlight: [
        "d1", "d2", "d3", "d5", "d6", "d7", "d8",
        "a4", "b4", "c4", "e4", "f4", "g4", "h4",
        "a1", "b2", "c3", "e5", "f6", "g7", "h8",
        "a7", "b6", "c5", "e3", "f2", "g1",
      ],
      note: "And notice she has not moved at all. She does not need to. Every one of those squares already belongs to her.",
    },
    {
      line: 6,
      demoFen: "8/8/k7/8/3Q4/8/8/7K w - - 0 1",
      from: "d4",
      to: "h8",
      highlight: ["e5", "f6", "g7", "h8"],
      note: "Or pick a slant, and take it corner to corner. There is no longer march anywhere on this board.",
    },
    {
      line: 7,
      demoFen: "k7/8/2p5/3Q4/8/8/8/7K w - - 0 1",
      from: "d5",
      to: "h5",
      glow: "look",
      highlight: ["c6", "d5", "h5"],
      note: "But look — one small pawn on c6 says shoo, and the mightiest piece in the park must gather her skirts and run. Never leave her standing somewhere she can be taken for nothing.",
    },
  ],
  tryIt: {
    fen: "k7/8/8/7r/8/8/8/3Q2K1 w - - 0 1",
    from: "d1",
    to: "h5",
    prompt: "Your turn! The queen can do anything a bishop can do. Send her up the slant and collect that rook on h5.",
    praise: "Beautiful! She borrowed the bishop's slant and came home with a whole rook. That is Her Majesty exactly.",
    nudge: "Look at the slant leaving d1: e2, f3, g4… and there sits the rook on h5. One long glide, my dear.",
  },
  secret:
    "She was not always the strongest. For hundreds of years the queen could only shuffle one square at a time, just like the king. Then about five hundred years ago somebody set her free, and chess has been a very much faster game ever since.",
};

/* -------------------------------------------------------------------------- */
/*  KING                                                                       */
/*                                                                             */
/*  This is the only rhyme that ends in a real checkmate, and it should. The     */
/*  poem's last line IS the rule — so beat 7 plays Ra1–a8#, a back-rank mate      */
/*  where the king is shut in by his OWN pawns, which is the mistake every        */
/*  child makes first and remembers longest.                                     */
/* -------------------------------------------------------------------------- */

const KING: PieceRhyme = {
  type: "k",
  title: "The King Who Does Not Race",
  rhyme: [
    "I'm the king — I do not race;",
    "just one small step, and slow,",
    "a single square to any place",
    "that I might wish to go.",
    "I'm not the strongest, that is true,",
    "yet I'm the one they're fighting through:",
    "so shield me, keep me safe from harm —",
    "the whole game rests upon my arm.",
  ],
  beats: [
    {
      line: 0,
      demoFen: "7k/8/8/8/3K4/8/8/8 w - - 0 1",
      glow: "look",
      highlight: ["d4"],
      note: "The old fellow himself. He has never hurried anywhere in his life.",
    },
    {
      line: 1,
      demoFen: "7k/8/8/8/3K4/8/8/8 w - - 0 1",
      from: "d4",
      to: "d5",
      highlight: ["d5"],
      note: "One step. That is the whole of it.",
    },
    {
      line: 2,
      demoFen: "7k/8/8/8/3K4/8/8/8 w - - 0 1",
      highlight: ["c3", "c4", "c5", "d3", "d5", "e3", "e4", "e5"],
      note: "Any of the eight squares beside him — forwards, backwards, sideways, slantways. He is allowed everywhere, one door at a time.",
    },
    {
      line: 3,
      demoFen: "7k/8/8/8/3K4/8/8/8 w - - 0 1",
      from: "d4",
      to: "c3",
      highlight: ["c3"],
      note: "And he chooses. Slowly. With his hands behind his back.",
    },
    {
      line: 4,
      demoFen: "7k/8/8/r7/3K4/8/8/8 w - - 0 1",
      glow: "look",
      highlight: ["c5", "d5", "e5"],
      note: "One black rook on a5, and three of his eight squares are simply gone. He is not the strongest. He is not even close.",
    },
    {
      line: 5,
      demoFen: "7k/8/8/8/3K4/8/8/3r4 w - - 0 1",
      from: "d4",
      to: "c4",
      glow: "look",
      highlight: ["d1", "d2", "d3", "d4"],
      note: "CHECK. When the king is attacked, everything else on the board stops mattering — you must fix it this very move. Nothing else in chess works like that.",
    },
    {
      line: 6,
      demoFen: "4k3/8/8/8/8/8/5PPP/5RK1 w - - 0 1",
      glow: "look",
      highlight: ["f2", "g2", "h2"],
      note: "So build him a cottage. Three pawns in front like a garden hedge, a rook at his elbow, the corner all to himself. THAT is a safe king.",
    },
    {
      line: 7,
      demoFen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
      from: "a1",
      to: "a8",
      glow: "look",
      highlight: ["a8", "b8", "c8", "d8", "e8", "f8", "g8", "h8"],
      note: "Checkmate. The rook arrives on the back row, and the king's own pawns have shut the door behind him. The game ends the instant this happens — it was always, always about him.",
    },
  ],
  tryIt: {
    // Built so exactly ONE legal move exists (Kh1–h2): the rook on a1 covers the
    // whole first rank, the rook on g8 covers the g-file. A child cannot pick
    // wrong here, which is the point — no fail states, ever.
    fen: "6rk/8/8/8/8/8/8/r6K w - - 0 1",
    from: "h1",
    to: "h2",
    prompt: "Oh dear — CHECK! That rook on a1 is staring straight along the bottom row at your king. Find him the one square where he is safe.",
    praise: "Phew! Up and out of trouble. When your king is in check you must deal with it that very move — and you found the only door, first try.",
    nudge: "The whole bottom row is dangerous, and so is the g-file. One small step UP, my dear: h1 to h2.",
  },
  secret:
    "The two kings may never stand next to one another — far too grand for that. Which means a lonely king can actually push the other king around the board, like two magnets that absolutely refuse to touch.",
};

/* ========================================================================== */
/*  PUBLIC API                                                                 */
/* ========================================================================== */

/**
 * Parade order: smallest to mightiest. This is the order the Piece Parade
 * marches in and the order the lantern lights them, so it is deliberate — the
 * pawn opens because he is the one the child already feels like, and the king
 * closes because his rhyme ends on checkmate.
 */
export const PARADE_ORDER: PieceType[] = ["p", "n", "b", "r", "q", "k"];

/** The six rhymes, in parade order. */
export const RHYMES: PieceRhyme[] = [PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING];

export const RHYME_BY_TYPE: Record<PieceType, PieceRhyme> = {
  p: PAWN,
  n: KNIGHT,
  b: BISHOP,
  r: ROOK,
  q: QUEEN,
  k: KING,
};

/** URL/route slugs, matching the existing `/pieces/[piece]` route. */
export const PIECE_SLUG: Record<PieceType, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

const TYPE_BY_SLUG: Record<string, PieceType> = {
  pawn: "p",
  knight: "n",
  bishop: "b",
  rook: "r",
  queen: "q",
  king: "k",
};

/** Total (never undefined) — every piece type has a rhyme. */
export function rhymeFor(type: PieceType): PieceRhyme {
  return RHYME_BY_TYPE[type];
}

/** Route helper: "knight" → the knight's rhyme. Unknown slug → undefined. */
export function rhymeBySlug(slug: string): PieceRhyme | undefined {
  const type = TYPE_BY_SLUG[slug.toLowerCase()];
  return type ? RHYME_BY_TYPE[type] : undefined;
}

/**
 * The beat staged for a given line. Guaranteed present for every valid line
 * index, but returns undefined rather than throwing so a parade that overruns
 * the poem simply holds its last picture instead of crashing mid-show.
 */
export function beatFor(rhyme: PieceRhyme, line: number): Beat | undefined {
  return rhyme.beats.find((b) => b.line === line);
}

/* -------------------------------------------------------------------------- */
/*  MOVE HELPERS — enough chess to animate, without importing an engine        */
/* -------------------------------------------------------------------------- */

/**
 * What a beat physically does on the board, so the parade can pick a sound and a camera.
 *
 * "capture" INCLUDES en passant, where the piece that leaves the board is NOT on
 * `to` — it is on the square the capturing pawn passed over. Do not assume the
 * victim is under the destination square; ask the engine (or clear both squares).
 */
export type BeatKind = "still" | "move" | "capture" | "promotion" | "castle";

export interface BeatMove {
  from: Square;
  to: Square;
  /** Only ever "q": the poem promises a queen, so the parade crowns a queen. */
  promotion?: "q";
}

const FILES = "abcdefgh";

/**
 * Read the piece standing on a square straight out of a FEN's placement field.
 *
 * Reimplemented here (rather than importing chess.js) on purpose: this module is
 * imported by the parade, the lesson pages and any build script, and none of them
 * should have to pull a whole rules engine in just to ask "what's on e2?".
 * Returns the raw FEN letter — uppercase White, lowercase Black — or null.
 */
export function fenPieceAt(fen: string, square: Square): string | null {
  const placement = fen.split(" ")[0];
  const fileIndex = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  if (fileIndex < 0 || !Number.isFinite(rank)) return null;

  // FEN ranks are listed 8 → 1, so rank 8 is row 0.
  const row = placement.split("/")[8 - rank];
  if (!row) return null;

  let file = 0;
  for (const ch of row) {
    if (ch >= "1" && ch <= "8") {
      file += Number(ch);
    } else {
      if (file === fileIndex) return ch;
      file += 1;
    }
    if (file > fileIndex) return null; // walked past it through empty squares
  }
  return null;
}

/**
 * The move a beat wants acted out, ready to hand to `chess.move(...)`, or null
 * if this beat is a still frame.
 *
 * Promotion is inferred rather than stored: a pawn that lands on the far edge
 * has no choice but to promote, so carrying a redundant field in the data would
 * only be one more thing to get out of sync with the FEN.
 */
export function beatMove(beat: Pick<Beat, "demoFen" | "from" | "to">): BeatMove | null {
  const { from, to, demoFen } = beat;
  if (!from || !to) return null;

  const piece = fenPieceAt(demoFen, from);
  const landsOnEdge = to[1] === "1" || to[1] === "8";
  if (piece && piece.toLowerCase() === "p" && landsOnEdge) {
    return { from, to, promotion: "q" };
  }
  return { from, to };
}

/**
 * Classify a beat so the parade can choose a sound, a camera move and a bit of
 * confetti without asking a chess engine anything.
 *
 * Castling is detected as "a king travelling two files", which is exactly the
 * definition every engine uses for king-move castling notation.
 */
export function beatKind(beat: Pick<Beat, "demoFen" | "from" | "to">): BeatKind {
  const { from, to, demoFen } = beat;
  if (!from || !to) return "still";

  const piece = fenPieceAt(demoFen, from);
  const kind = piece ? piece.toLowerCase() : "";
  const fileTravel = Math.abs(FILES.indexOf(to[0]) - FILES.indexOf(from[0]));

  if (kind === "k" && fileTravel === 2) return "castle";
  if (kind === "p" && (to[1] === "1" || to[1] === "8")) return "promotion";
  if (fenPieceAt(demoFen, to)) return "capture";
  // En passant is the one capture that does not land on its victim, so the
  // "is something standing on `to`?" test above misses it entirely. A pawn only
  // ever changes file in order to take, so a pawn stepping sideways onto an empty
  // square has just taken one in passing — and the sneakiest capture in chess
  // must not play with the polite little "slide" sound.
  if (kind === "p" && fileTravel === 1) return "capture";
  return "move";
}

/* -------------------------------------------------------------------------- */
/*  TIMING — so the lights land ON the words                                   */
/* -------------------------------------------------------------------------- */

/** A grandfather reading to a five-year-old at dusk. Not a newsreader. */
const SYLLABLES_PER_SECOND = 2.6;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * A HINT at how long to hold one line, in seconds.
 *
 * If real speech is playing, drive the beats off the speech-end event instead —
 * this is for the silent case (audio off, TTS unavailable, or the poem printed
 * on a sign in the park) so the board still breathes at roughly reading pace.
 *
 * We count vowel GROUPS rather than vowels ("brave" is one beat, "again" is two),
 * drop a silent trailing "e" — but keep it for the "-tle"/"-dle" endings where it
 * really is its own syllable ("little") — then add a breath sized by the line's
 * punctuation, because a dash or a full stop is a place a reader actually pauses.
 */
export function suggestedBeatSeconds(line: string): number {
  // Drop apostrophes BEFORE splitting, or every contraction is torn into two
  // "words" and counted twice: "I'm" would be worth as much as "little". These
  // poems are full of them ("I'm", "I'll", "it's", "you'll", "don't", "they're"),
  // so this is worth about half a second a verse — a real drift by the last line.
  const words = line.toLowerCase().replace(/['’]/g, "").replace(/[^a-z]+/g, " ").trim().split(/\s+/);

  let syllables = 0;
  for (const word of words) {
    if (!word) continue;
    const groups = word.match(/[aeiouy]+/g);
    let n = groups ? groups.length : 1;
    const silentE =
      word.length > 2 &&
      word.endsWith("e") &&
      !/[aeiouy]e$/.test(word) &&   // "…ee", "…ie": the e is doing real work
      !/[^aeiouy]le$/.test(word);   // "little", "candle": the -le IS a syllable
    if (silentE) n -= 1;
    syllables += Math.max(1, n);
  }

  const tail = line.trim().slice(-1);
  const breath =
    tail === "—" || tail === "." || tail === "!" || tail === "?" || tail === ":" || tail === ";"
      ? 0.55
      : tail === ","
        ? 0.28
        : 0.18;

  return clamp(syllables / SYLLABLES_PER_SECOND + breath, 1.6, 4.5);
}

/** Roughly how long the whole poem takes to read aloud, in seconds. */
export function rhymeDurationSeconds(rhyme: PieceRhyme): number {
  return rhyme.rhyme.reduce((total, line) => total + suggestedBeatSeconds(line), 0);
}
