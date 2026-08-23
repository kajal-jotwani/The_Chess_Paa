/**
 * The Opening Carousel — guided opening rides. The child plays BOTH sides'
 * correct moves in order (guided by ChessPaa's line for each move), because
 * openings are muscle memory: round and round we go.
 */

export interface OpeningStep {
  uci: string;      // expected move
  san: string;      // for display
  say: string;      // ChessPaa's line once the move is played
}

export interface OpeningRide {
  slug: string;
  name: string;
  horse: string;      // emoji horse flavor
  color: string;
  tagline: string;
  intro: string;
  steps: OpeningStep[];
  outro: string;
}

export const OPENINGS: OpeningRide[] = [
  {
    slug: "italian",
    name: "The Sunny Italian",
    horse: "🐴",
    color: "#f59e0b",
    tagline: "The classic sunshine opening — fast friends to the center!",
    intro: "This is the Italian Game — sunny, simple, and strong. We grab the center, bring out our helpers, and point a bishop at the enemy's weakest pawn. You play the moves for BOTH sides — round and round!",
    steps: [
      { uci: "e2e4", san: "e4", say: "White steps into the sunshine! The center squares are the best seats in the park." },
      { uci: "e7e5", san: "e5", say: "Black says 'me too!' and takes a center seat as well. Fair is fair." },
      { uci: "g1f3", san: "Nf3", say: "The pony jumps out AND attacks the e5 pawn. Develop with a threat — two jobs, one move!" },
      { uci: "b8c6", san: "Nc6", say: "Black's pony guards the pawn. Pieces protecting each other — that's friendship." },
      { uci: "f1c4", san: "Bc4", say: "The bishop slides to its sunniest square, staring right at f7 — the enemy king's softest spot!" },
      { uci: "f8c5", san: "Bc5", say: "Black copies the trick. Both bishops are out. Now the kings dream of castling." },
      { uci: "e1g1", san: "O-O", say: "CASTLE! The king tucks into his cosy corner and the rook wakes up. Safety first, adventure second!" },
      { uci: "g8f6", san: "Nf6", say: "Black develops the other pony and eyes our e4 pawn. Everyone's invited to the party." },
    ],
    outro: "That's the Italian Game! Center pawns, ponies out, bishop aimed at f7, castle early. Ride it again until your fingers remember it by heart!",
  },
  {
    slug: "london",
    name: "The Cosy London",
    horse: "🎠",
    color: "#25A9B4",
    tagline: "Build the same warm pyramid every time — rain or shine.",
    intro: "The London System is ChessPaa's comfy armchair: you build the SAME safe little pyramid almost no matter what the other side does. Builders, assemble!",
    steps: [
      { uci: "d2d4", san: "d4", say: "This time we start with the queen's pawn. A different door into the park!" },
      { uci: "d7d5", san: "d5", say: "Black mirrors us. Very polite." },
      { uci: "c1f4", san: "Bf4", say: "THE London move! The bishop leaves home BEFORE we close the door with our pawns. No bishop left behind!" },
      { uci: "g8f6", san: "Nf6", say: "Black develops a pony. We stay calm — we have a plan." },
      { uci: "e2e3", san: "e3", say: "A little pawn step makes a warm wall for the bishop and opens the other bishop's window." },
      { uci: "e7e6", san: "e6", say: "Black builds too. See how both sides are making pawn pyramids?" },
      { uci: "g1f3", san: "Nf3", say: "Pony out! Our pyramid has a guard tower now." },
      { uci: "f8d6", san: "Bd6", say: "Black's bishop challenges ours. Bishops love staring contests." },
      { uci: "f1d3", san: "Bd3", say: "We develop and get ready to castle. The pyramid is nearly finished — d4, e3, bishop f4, ponies out. THAT's the London!" },
    ],
    outro: "The Cosy London! Same pyramid, every game: d4, Bf4, e3, Nf3, Bd3, castle. When you know your house by heart, you can spend your brain on adventures!",
  },
  {
    slug: "queens-gambit",
    name: "The Queen's Gift Trick",
    horse: "🦄",
    color: "#ec4899",
    tagline: "Offer a pawn like a lollipop — and win the center!",
    intro: "The Queen's Gambit is a magic trick: we OFFER a pawn like a free lollipop. If they grab it, we get the whole center playground. Watch closely…",
    steps: [
      { uci: "d2d4", san: "d4", say: "Queen's pawn forward — the trick begins." },
      { uci: "d7d5", san: "d5", say: "Black takes a center seat. Perfect. Now for the magic…" },
      { uci: "c2c4", san: "c4", say: "TA-DA! We offer the c-pawn for free. It's not really free — it's bait! That's what 'gambit' means." },
      { uci: "d5c4", san: "dxc4", say: "They took the lollipop! Now their pawn is far from home, and the WHOLE center belongs to us." },
      { uci: "e2e3", san: "e3", say: "We open the bishop's window — and secretly plan to visit that runaway pawn on c4." },
      { uci: "g8f6", san: "Nf6", say: "Black develops. But notice: they can't easily KEEP the extra pawn." },
      { uci: "f1c4", san: "Bxc4", say: "And we take the pawn back with a smile. The lollipop returns! Now we have the big center and a happy bishop." },
      { uci: "e7e6", san: "e6", say: "Black opens a window too. But our center is taller than theirs." },
      { uci: "g1f3", san: "Nf3", say: "Pony out, castle next. The gift trick is complete — center power without losing a crumb!" },
    ],
    outro: "The Queen's Gambit! Offer a pawn, win the center, take the pawn back later. Remember: a gambit isn't a gift — it's an investment!",
  },
  {
    slug: "pony-parade",
    name: "The Pony Parade",
    horse: "🐎",
    color: "#8b5cf6",
    tagline: "All four knights trot out — the friendliest parade in chess.",
    intro: "The Four Knights Game! Every single pony comes out to march. It's the friendliest, safest parade in chess — perfect for learning good habits.",
    steps: [
      { uci: "e2e4", san: "e4", say: "Center first — always center first!" },
      { uci: "e7e5", san: "e5", say: "Black joins the parade grounds." },
      { uci: "g1f3", san: "Nf3", say: "The first pony trots out, attacking e5. Clip-clop!" },
      { uci: "b8c6", san: "Nc6", say: "The second pony answers, guarding e5. Clip-clop clip-clop!" },
      { uci: "b1c3", san: "Nc3", say: "Third pony! It guards our e4 pawn. The parade is getting loud." },
      { uci: "g8f6", san: "Nf6", say: "FOURTH pony! All knights on parade — that's why it's called the Four Knights!" },
      { uci: "f1b5", san: "Bb5", say: "A bishop joins, poking Black's pony. Even parades have surprises." },
      { uci: "f8b4", san: "Bb4", say: "Black pokes back — a mirror! Next comes castling, and the real adventure begins." },
    ],
    outro: "The Pony Parade teaches the golden rules: center pawns, knights before bishops, castle soon. March it again — the ponies love the exercise!",
  },
];

export function getOpening(slug: string): OpeningRide | undefined {
  return OPENINGS.find((o) => o.slug === slug);
}
