"use client";

/**
 * VOICE LIBRARY — the difference between a tooltip and a person.
 *
 * Everything ChessPaa knows is decided elsewhere (motifs.ts sees, tutorEngine
 * judges). This file only decides HOW HE SAYS IT, and that is the whole
 * product: a child does not come back tomorrow for a correct evaluation, they
 * come back for the grandfather who noticed.
 *
 * HOW IT AVOIDS SOUNDING LIKE A TEMPLATE
 * --------------------------------------
 * Four independent layers, each with its own bank and its own memory:
 *
 *      [opener]   +   [verdict]   +   [the one lesson]   +   [flourish]
 *      "Ooh —"        "Clever!"      "your horse is       "…and my cocoa
 *                                     poking two things     went cold, I was
 *                                     at once!"             watching so hard."
 *
 * Ten openers x eight verdicts x seven bodies x twelve flourishes is a lot of
 * different evenings. On top of that, every layer keeps a ring of recently
 * used line ids IN LOCALSTORAGE, so the fork he explains on Tuesday genuinely
 * does not draw the same sentence as the fork on Thursday.
 *
 * HOUSE RULES FOR EVERY LINE IN THIS FILE
 * ---------------------------------------
 * - Never the words blunder, bad, wrong, mistake, stupid, losing. Not once.
 * - A warning is something the two of you NOTICE TOGETHER, never something
 *   the child did to themselves. "Peek at h2 —" not "You hung your bishop."
 * - Little ones get verbs they can act out: hop, nibble, gobble, tuck, peek,
 *   wobble, sneak. Big kids get real chess words and a bit of dry wit.
 * - The park is always nearby: lanterns, cocoa, the Ferris wheel, pigeons,
 *   his beard, his knitted scarf, the toffee stall at dusk.
 */

import { rng } from "@/three/core/textures/procedural";
import type { AgeBand, Tier, VoiceSettings } from "./levels";
import type { MotifKind } from "./motifs";
import type { PieceSymbol } from "chess.js";

/* ================================================================== *
 * WHAT HE CAN TALK ABOUT
 * ================================================================== */

export type LessonKey =
  // --- the game ended -------------------------------------------------
  | "mateWin" | "mateLoss" | "stalemate" | "drawn"
  // --- praise ---------------------------------------------------------
  | "foundFork" | "foundPin" | "foundSkewer" | "foundDiscovered" | "threatenMate"
  | "foundBest" | "goodCapture" | "goodCheck" | "savedIt" | "solidQuiet"
  | "castled" | "developed" | "promoted" | "centre"
  // --- gentle warnings ------------------------------------------------
  | "hungMovedPiece" | "hangingPiece" | "opponentFork" | "opponentPin"
  | "opponentSkewer" | "mateDanger" | "backRankDanger" | "trappedPiece"
  | "overloadedDefender" | "inCheck"
  // --- the secret they walked past ------------------------------------
  | "missedMate" | "missedFork" | "missedCapture" | "missedBetter"
  // --- grandpa's standing advice --------------------------------------
  | "earlyQueen" | "keepDeveloping" | "kingSafety";

export type GamePhase = "opening" | "middlegame" | "endgame";

/** Lessons that carry the whole moment on their own — no verdict line in front. */
const SOLO_LESSONS = new Set<LessonKey>(["mateWin", "mateLoss", "stalemate", "drawn", "promoted", "missedMate"]);

/** Which motif maps onto which lesson when the child MADE it happen. */
export const PRAISE_FOR_MOTIF: Partial<Record<MotifKind, LessonKey>> = {
  fork: "foundFork",
  pin: "foundPin",
  skewer: "foundSkewer",
  discoveredAttack: "foundDiscovered",
  mateThreat: "threatenMate",
};

/** Which motif maps onto which lesson when the child is on the receiving end. */
export const WARNING_FOR_MOTIF: Partial<Record<MotifKind, LessonKey>> = {
  fork: "opponentFork",
  pin: "opponentPin",
  skewer: "opponentSkewer",
  hanging: "hangingPiece",
  mateThreat: "mateDanger",
  backRank: "backRankDanger",
  trapped: "trappedPiece",
  overloaded: "overloadedDefender",
};

/* ================================================================== *
 * THE SUBSTITUTION TOKENS
 * ================================================================== */

export interface VoiceTokens {
  /** The child's piece, already in their vocabulary ("little horse" / "knight"). */
  piece?: string;
  /** A second piece in the story — usually the thing being attacked. */
  piece2?: string;
  /** The opponent's piece doing the damage. */
  theirPiece?: string;
  /**
   * The piece the child just physically moved. Usually the same as `piece`,
   * but not for a discovered attack — there the mover steps aside and a
   * different piece does the work, and naming both is the whole picture.
   */
  mover?: string;
  /** Possessive for the opponent: "my" when ChessPaa is playing, else "their". */
  opp?: string;
  /** Subject pronoun to match: "I" / "they". */
  oppThey?: string;
  /** Object pronoun to match: "me" / "them". */
  oppThem?: string;
  /** The move the child played, already band-appropriate ("Nf3" or "that hop"). */
  played?: string;
  /** The move he wishes they'd seen, band-appropriate. */
  best?: string;
  /** Anchor square, only ever used in bands allowed to read squares. */
  sq?: string;
  sq2?: string;
  /** A number: mate in N, pawns won, pieces attacked. */
  n?: string;
  /** Material at stake, in pawns, as words the band can hold. */
  value?: string;
  from?: string;
  to?: string;
}

/* ================================================================== *
 * PIECE NAMES — the same truth, dressed for the listener
 * ================================================================== */

const KID_PIECE_NAMES: Record<PieceSymbol, string[]> = {
  p: ["little pawn", "brave little pawn", "tiny pawn", "small marching pawn"],
  n: ["little horse", "hoppy horse", "pony", "brave little horse"],
  b: ["pointy-hat bishop", "tall-hat bishop", "slidey bishop", "bishop in the pointy hat"],
  r: ["castle tower", "big castle", "tower", "chunky castle"],
  q: ["queen", "mighty queen", "queen with the big crown"],
  k: ["king", "cosy king", "king in his crown"],
};

const PLAIN_PIECE_NAMES: Record<PieceSymbol, string> = {
  p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king",
};

/**
 * The piece, named for whoever is listening. Little ones get a creature they
 * can picture; older ones get the word they'll need at a real board.
 * The variant rotates so even the noun doesn't wear a groove.
 */
export function pieceWord(p: PieceSymbol, settings: VoiceSettings, pick = 0): string {
  if (!settings.useKidPieceNames) return PLAIN_PIECE_NAMES[p];
  const bank = KID_PIECE_NAMES[p];
  return bank[Math.abs(pick) % bank.length];
}

/**
 * How to refer to the move itself, given whether this child reads notation yet.
 *
 * The one thing it must never do is return a phrase with no information in it
 * ("that move"): a hint that says "the move is that move" is worse than no
 * hint at all. Without notation we name the piece, and add the destination
 * square whenever the child can read one.
 */
export function moveWord(
  san: string,
  piece: PieceSymbol,
  settings: VoiceSettings,
  pick = 0,
  to?: string,
): string {
  if (settings.useNotation) return san;
  if (san === "O-O" || san === "O-O-O") return "castling";
  const noun = pieceWord(piece, settings, pick);
  if (settings.useSquares && to) {
    const forms = piece === "n"
      ? [`your ${noun} hopping to ${to}`, `your ${noun} to ${to}`]
      : [`your ${noun} to ${to}`, `your ${noun} going over to ${to}`];
    return forms[Math.abs(pick) % forms.length];
  }
  const forms = piece === "n"
    ? [`that hop with your ${noun}`, `a little jump with your ${noun}`]
    : [`moving your ${noun}`, `that move with your ${noun}`];
  return forms[Math.abs(pick) % forms.length];
}

/** Turn pawns-at-stake into words the band can actually hold in their head. */
export function valueWord(pawns: number, settings: VoiceSettings): string {
  if (settings.useEvaluation) return `${pawns.toFixed(1)} pawns`;
  if (pawns >= 8) return "the whole queen";
  if (pawns >= 4.5) return "a big castle's worth";
  if (pawns >= 2.5) return "a whole piece";
  if (pawns >= 1.5) return "a good chunk";
  return "a pawn";
}

/* ================================================================== *
 * LAYER 1 — OPENERS
 * ================================================================== */

type Bank = Partial<Record<AgeBand, string[]>> & { all?: string[] };

const OPENERS: Record<"cheer" | "warm" | "gentle", Bank> = {
  cheer: {
    little: ["Ooh!", "Oho!", "Well look at that —", "Sweet strawberries!", "My whiskers!", "Ha!", "Yes yes yes —"],
    middle: ["Oho —", "Now then.", "Well look at that.", "Ha! Right,", "Ooh, nice —", "There we go."],
    big: ["Oho.", "Now then.", "Right —", "Well, well.", "Good.", "Ah —"],
  },
  warm: {
    little: ["Mm-hm.", "Righto.", "Good, good.", "Ah, lovely.", "That's the way."],
    middle: ["Mm.", "Right,", "Good.", "Fair enough —", "Steady as she goes."],
    big: ["Mm.", "Sure.", "Fine —", "Alright.", "Reasonable."],
  },
  gentle: {
    little: ["Ooh, wait —", "Hold on a tick —", "Hmm.", "Ah, hang on.", "Peek here a moment —"],
    middle: ["Hmm, hold on.", "Ah — one second.", "Wait, look here.", "Hmm.", "Now, careful —"],
    big: ["Hmm.", "Hold on.", "Careful —", "Ah — one thing.", "Let's look."],
  },
};

/* ================================================================== *
 * LAYER 2 — THE VERDICT
 *
 * Five warm words and no cold ones. The tier is a FEELING, not a score, and
 * the bottom two tiers are written so they can be read out loud to a
 * six-year-old at bedtime without anyone's face falling.
 * ================================================================== */

const TIER_LINES: Record<Tier, Bank> = {
  brilliant: {
    little: [
      "Brilliant! That's the very move I was whispering into my beard.",
      "BRILLIANT! Oh, my hat nearly fell off.",
      "That's it! That's the sparkly one! I could hear the lanterns fizz.",
      "Brilliant, my dear — you saw the whole picture.",
      "Ooh, brilliant! Even the pigeons stopped to look.",
      "Brilliant! I'm going to need a bigger trophy shelf.",
      "That's the one! The exact one. My beard is tingling.",
    ],
    middle: [
      "Brilliant. That's the move I'd have played, and I've had sixty years of practice.",
      "Brilliant! You found the sharpest thing on the board.",
      "That's it exactly — brilliant.",
      "Brilliant. That's not luck, that's looking.",
      "Ooh, brilliant. You saw further than the position asked you to.",
      "Brilliant — you and the engine agree, and the engine doesn't have a beard.",
    ],
    big: [
      "Brilliant. Best move on the board, and it wasn't obvious.",
      "That's the move. Brilliant — precise and cold-blooded.",
      "Brilliant. I looked for something better for a while. There isn't one.",
      "Brilliant — you found the only line that keeps the advantage.",
      "That's engine-quality. Brilliant.",
    ],
  },
  clever: {
    little: [
      "Clever! That's a good strong move.",
      "Ooh, clever. Your pieces are helping each other.",
      "Clever move! Nice and safe and useful.",
      "That's clever thinking. I like it.",
      "Clever! You're playing like someone who's been here before.",
      "Very clever. The board is being nice to you.",
    ],
    middle: [
      "Clever. That's a proper move.",
      "Clever — not the flashiest, but it does real work.",
      "Nice one. Clever and solid.",
      "Clever move. You improved a piece and gave nothing away.",
      "That's clever. Almost exactly what I'd play.",
      "Clever. You're a whisker off the very best there.",
    ],
    big: [
      "Clever. That's within a hair of best.",
      "Clever move — sound, and it keeps your options open.",
      "Good. Clever, even. The engine prefers something else by a fraction; it's a fraction.",
      "Clever. Real move, real plan.",
      "That's clever play. Keeps the tension where you want it.",
    ],
  },
  steady: {
    little: [
      "Good and steady.",
      "Good and steady — nothing broken, nothing burnt.",
      "That's a sensible one. Chug chug, onward we go.",
      "Good and steady. The board still likes you.",
      "Steady as the Puzzle Train. Lovely.",
      "That works! Safe and sound.",
    ],
    middle: [
      "Good and steady.",
      "That's fine — solid, sensible, nothing to fix.",
      "Good and steady. Not fireworks, but fireworks aren't every move.",
      "That'll do nicely. Everything's still tucked in.",
      "Steady move. You kept your shape.",
    ],
    big: [
      "Good and steady.",
      "Solid. Nothing wrong with it.",
      "That's fine — playable, safe, keeps the structure.",
      "Steady. There's a slightly sharper try, but this doesn't cost you anything.",
      "Reasonable move. The position hasn't changed its mind about you.",
    ],
  },
  slip: {
    little: [
      "Hmm, a little slip — nothing broken though.",
      "Ooh, a tiny wobble there. We can fix that.",
      "Hmm! A little slip. Happens to me before breakfast.",
      "A small wobble, that's all. The game's still ours.",
      "Hmm, a little slip. Shall we peek at what happened?",
      "Careful — that one wobbled a bit. But only a bit.",
    ],
    middle: [
      "Hmm, a little slip. Nothing fatal.",
      "That one wobbled slightly. Let's have a look.",
      "A small slip — the sort everybody makes at speed.",
      "Hmm. That gives back a little bit of what you'd built.",
      "Little slip there. Easy to see why, though.",
    ],
    big: [
      "Hmm — that's a small inaccuracy.",
      "Slight slip. It costs a little, not a lot.",
      "That loosens things a touch. Not fatal, worth knowing.",
      "A little slip. There was a cleaner version of the same idea.",
      "Hmm. That hands back some of your edge.",
    ],
  },
  careful: {
    little: [
      "Careful — I think we left someone out in the cold.",
      "Ooh, careful! Somebody's standing out in the rain.",
      "Careful, my dear. Let's look after everyone.",
      "Hold on, careful — one of your team needs you.",
      "Careful! Let's go back and check on the little ones.",
    ],
    middle: [
      "Careful — that leaves something out in the cold.",
      "Careful. I think we've given something away there.",
      "Ooh, careful. Look what that opens up.",
      "Careful — there's a bill to pay on that one.",
      "Hold on. Careful. Something's unguarded.",
    ],
    big: [
      "Careful — that drops material.",
      "Careful. That one's expensive.",
      "Hold on, that leaves a piece hanging.",
      "Careful — there's a tactic against you now.",
      "That costs. Let's see exactly how much.",
    ],
  },
};

/**
 * VERDICTS THAT HAND OFF TO A WARNING.
 *
 * The ordinary happy verdicts assert that everything is fine — "Solid.
 * Nothing wrong with it." — which is a flat contradiction when the very next
 * sentence is "your rook is hanging". So when the lesson is a warning, the
 * happy tiers draw from here instead: a real, warm verdict that leaves the
 * door open for a "but".
 *
 * The slip and careful banks need no equivalent; they are already written to
 * be followed by an explanation.
 */
const WARNING_LEAD_IN: Record<"brilliant" | "clever" | "steady", Bank> = {
  brilliant: {
    little: ["Lovely move!", "Ooh, good one!", "That's a strong move.", "Nice!"],
    middle: ["Strong move.", "That's a good move.", "Nice one.", "Good."],
    big: ["Strong move.", "Good move.", "Nice.", "That's the right idea."],
  },
  clever: {
    little: ["Clever!", "Nice one!", "Good thinking.", "Ooh, nice."],
    middle: ["Clever.", "Nice one.", "Good move.", "That's fine."],
    big: ["Clever.", "Good move.", "Fine.", "Reasonable."],
  },
  steady: {
    little: ["That works.", "Alright.", "Okay!", "Mm-hm."],
    middle: ["That's playable.", "That works.", "Alright.", "Fine."],
    big: ["Playable.", "That works.", "Alright.", "Fine."],
  },
};

/* ================================================================== *
 * LAYER 3 — THE ONE LESSON
 *
 * This is the whole promise: one true thing, said in the listener's own
 * language. Same fact, three costumes.
 * ================================================================== */

const BODY: Record<LessonKey, Bank> = {
  /* ---------------- the game ended ------------------------------- */
  mateWin: {
    little: [
      "CHECKMATE! You did it! Ring the bells — free ice cream for everybody in the park!",
      "That's CHECKMATE! The king has nowhere at all to go. Listen — the whole wonderland is cheering!",
      "CHECKMATE, my dear! I'm getting the fireworks. Stand back, I'm not very good at fireworks.",
      "Checkmate! Oh, look at you. The lanterns are all doing a little dance.",
    ],
    middle: [
      "Checkmate! Every square covered, no escape, game over. Beautifully done.",
      "That's checkmate. You built that from about four moves ago and I watched you do it.",
      "Checkmate! The king can't move, can't block, can't capture. That's the whole art of it.",
      "Checkmate. Ring the bell — that one goes on the trophy shelf.",
    ],
    big: [
      "Checkmate. Clean finish — no escape squares, no interposition, no capture.",
      "That's mate. Nicely converted; you never let the king breathe.",
      "Checkmate. Textbook: cut the escape squares first, then deliver.",
      "Mate. Good technique — you didn't rush it and you didn't let it slip.",
    ],
  },
  mateLoss: {
    little: [
      "Oh! Checkmate — this one's mine. Come on, one more? I'll make the cocoa.",
      "Checkmate! Ha! Don't you dare go home, we're playing again.",
      "That's checkmate for the old man. You made me work for it, though — I was sweating into my scarf.",
    ],
    middle: [
      "Checkmate — mine this time. You had good moments in there; the king just got lonely at the end.",
      "That's mate. Rematch? I'd like to lose one before bedtime.",
      "Checkmate. King safety is the whole lesson in that game — everything else you played well.",
    ],
    big: [
      "Checkmate. The king was too exposed from around move twenty — worth replaying that stretch.",
      "That's mate. Your pieces were fine; the king had no shelter. Rematch?",
      "Checkmate. You out-played me in the middle and then ran out of luft. Next one.",
    ],
  },
  stalemate: {
    little: [
      "Oh! Stalemate — their king had NO moves at all, but nobody was chasing him. So it's a draw, a tie!",
      "Stalemate! Sneaky, isn't it? Remember: leave the lonely king one tiny square until you're ready to pounce.",
      "That's a stalemate — a tie. The king wasn't in check but couldn't move anywhere. Tricky little rule!",
    ],
    middle: [
      "Stalemate — a draw. Their king wasn't in check but had no legal move at all.",
      "Stalemate! The classic heartbreak. When you're winning big, always leave the enemy king one square to breathe.",
      "That's stalemate, so it's a draw. Next time count the king's squares before you take the last one away.",
    ],
    big: [
      "Stalemate — draw. Winning positions need king-move counting, not just material counting.",
      "Stalemate. The old rule: when you're up a lot, check the opponent's legal move count before every move.",
      "That's a draw by stalemate. Painful — and one of the most valuable half-points you'll ever give away.",
    ],
  },
  drawn: {
    all: [
      "That's a draw — a fair share of the cake. Honourable stuff.",
      "A draw! Nobody wins, nobody loses, everybody gets cocoa.",
      "Drawn game. Sometimes two people just play well at each other.",
    ],
  },

  /* ---------------- praise --------------------------------------- */
  foundFork: {
    little: [
      "And look! Your {piece} is poking TWO things at once. They can only save one — the other one's yours!",
      "Ooh, your {piece} found a fork! That's when one piece points at two treasures. Yum yum.",
      "Two at once! Your {piece} is like a fork in a bowl of pasta — it picks up two things in one go.",
      "Your {piece} is looking at two of {opp} pieces at the same time. {oppThey} can't rescue both!",
      "That's a fork! One {piece}, two big targets. {oppThey} won't like that at all.",
      "Look — your {piece} has one eye on each of {opp} pieces. Greedy, and I love it.",
      "Oho! Your {piece} is pointing at two things. Whichever one {oppThey} save, you take the other!",
      "A fork! That's my favourite word in chess and my favourite thing at dinner.",
      "Your {piece} just made me choose between two of my friends. That's not fair and I love it.",
      "Two at once! Somebody's been practising.",
    ],
    middle: [
      "And that's a fork — your {piece} hits two things at once, and {oppThey} can only save one.",
      "Nice fork. Your {piece} attacks two pieces in a single move; something has to fall.",
      "That's a proper fork on {sq}. Two targets, one move — that's how you win material for free.",
      "Fork! The {piece} does double duty. {oppThey} can defend one of them and that's it.",
      "Your {piece} forked them. Best kind of move: no cleverness needed next turn, just take.",
      "A fork on {sq}. Two threats, one move, one turn to answer them — the arithmetic doesn't work for me.",
      "Forked. That's material in the bank, and you didn't have to calculate a thing after it.",
      "Your {piece} hits two at once. Forks are the first tactic worth hunting for on every single move.",
    ],
    big: [
      "That's a fork on {sq} — the {piece} hits two targets and {oppThey} can only answer one. Worth about {value}.",
      "Clean fork. Your {piece} attacks both, {oppThey} can only save one, and you collect the other.",
      "Fork on {sq}. Note why it works: neither target is defended and neither can defend the other.",
      "That's a double attack worth {value}. The {piece} is untouchable on {sq}, which is the part that makes it real.",
    ],
  },
  foundPin: {
    little: [
      "Ooh — your {piece} has {opp} {piece2} stuck! It can't move, because something precious is hiding behind it.",
      "That's a pin! {opp} {piece2} is pinned to the floor. If it steps aside, something much bigger gets caught.",
      "Look, your {piece} is staring right through {opp} {piece2}. It daren't budge!",
      "Your {piece} froze that {piece2} solid. It's stuck like a shoe in toffee.",
    ],
    middle: [
      "That's a pin — {opp} {piece2} can't move without exposing something bigger behind it.",
      "Nice pin. The {piece2} is frozen; now pile more attackers onto it.",
      "You've pinned the {piece2} on {sq}. Pinned pieces are wonderful targets — they can't run.",
      "Pin! Remember the follow-up: attack the pinned piece again, because it can't step out of the way.",
    ],
    big: [
      "Pin on {sq}. The {piece2} is tied down — the standard follow-up is to add attackers to it, not to take it.",
      "That pins the {piece2}. It's now a target that can't move; treat it as a weakness to pile onto.",
      "Good pin. Worth noting it's the line, not the piece, doing the work — keep the line open.",
    ],
  },
  foundSkewer: {
    little: [
      "Ooh, a skewer! The big one has to move out of the way, and then you get the one behind it.",
      "That's like a marshmallow stick — you poke through the big one and the little one behind is yours!",
      "Look! {opp} big piece has to jump aside, and there's a lovely present sitting right behind it.",
    ],
    middle: [
      "That's a skewer — the valuable piece in front has to move, and you collect the one behind it.",
      "Skewer! Same line as a pin, only the big piece is in front. It has to move, and then you take.",
      "Nice skewer on {sq}. The front piece can't stay, and the back one has nowhere to hide.",
    ],
    big: [
      "Skewer on {sq} — front piece is forced to move, back piece drops. Worth about {value}.",
      "That's a skewer, not a pin: the heavier piece is in front, so the move is forced rather than frozen.",
      "Good skewer. The key detail is that the rear piece is undefended — that's what makes it collectible.",
    ],
  },
  foundDiscovered: {
    little: [
      "Sneaky! Your {mover} stepped aside and let your {piece} peek right through. A hidden attack!",
      "Ooh, that's a discovered attack — you moved one piece and a DIFFERENT one started attacking. Magic!",
      "Your {mover} was standing in the doorway. Now it's moved, and your {piece} can see all the way across!",
      "Your {mover} hopped out of the way and — surprise! — your {piece} is staring right at {opp} {piece2}.",
    ],
    middle: [
      "That's a discovered attack — moving the {mover} opened a line for your {piece} behind it.",
      "Discovered attack! Two threats for the price of one move. Those are very hard to answer.",
      "Nice — the {mover} stepping away unmasked your {piece}. Now {oppThey} have two problems and one turn.",
      "Discovery! Your {piece} was hidden behind the {mover}, and now it hits {opp} {piece2}.",
    ],
    big: [
      "Discovered attack — the {mover} vacated the line and the {piece} does the damage. Double threats are the hardest thing to meet.",
      "That's a discovery. The moved piece can go anywhere it likes, which is what makes these so strong.",
      "Discovered attack from {sq}. Note the moved piece can create a second threat of its own — that's the doubling.",
      "Discovery: your {piece} is unmasked onto {opp} {piece2}, and the {mover} is free to make its own threat.",
    ],
  },
  threatenMate: {
    little: [
      "And ooh — you're threatening CHECKMATE next move! Keep your eyes wide open.",
      "Psst — there's checkmate hiding one move away. The fireworks are loaded!",
      "You're one hop from checkmate. Don't blink!",
    ],
    middle: [
      "And you're threatening mate next move — {oppThey} have to deal with it right now.",
      "There's mate in the air. If {oppThey} don't find the only answer, it's over.",
      "Mate threat! That's the strongest kind of move: it forces {opp} whole reply.",
    ],
    big: [
      "That threatens mate — {oppThey} have exactly one job now, which usually means concessions elsewhere.",
      "Mate threat on {sq}. Forcing moves first: this is why checks and mate threats come before quiet improvements.",
      "You're threatening mate. Even if it's parried, the tempo is worth real material.",
    ],
  },
  foundBest: {
    little: [
      "That's the very best move on the whole board. I checked twice!",
      "Out of every single move you could have made, that was the shiniest one.",
      "The best move! I looked and looked and couldn't find better.",
    ],
    middle: [
      "That's the best move in the position — I checked with the clever machine and it agrees with you.",
      "Top move. Out of everything available, that's the one.",
      "That's the engine's first choice, and mine. Good company.",
    ],
    big: [
      "That's the top engine choice. Nothing else comes close in this position.",
      "Best move. The alternatives all give up something.",
      "First line, exactly. Good calculation.",
    ],
  },
  goodCapture: {
    little: [
      "Nom nom — a tasty snack, and a safe one. Your {piece} won't get nibbled back.",
      "Snack acquired! And nobody can bite you for it. That's how it's done.",
      "Munch! Free food is the best food.",
      "Gobbled! And nothing can gobble you back. Perfect.",
      "One for your pocket. Always peek round first to see who's watching — you did.",
      "Yum. That's one fewer of mine for you to worry about.",
    ],
    middle: [
      "Good capture — and safe, which is the part beginners forget to check.",
      "You took the {piece2} and nothing takes you back. That's a clean win of material.",
      "Nice grab. Always check the recapture before you take; you did.",
      "Clean. Take, count the recapture, then take — that's the whole habit.",
      "That's material, and it cost you nothing. Best kind there is.",
      "Good take. The board is a little more yours than it was a second ago.",
    ],
    big: [
      "Clean capture — the exchange works out in your favour.",
      "Good take. Nothing recaptures profitably, so that's material in the bank.",
      "Correct capture. The swap-off on that square favours you.",
      "Sound exchange — you come out ahead on the sequence.",
      "Good. Material won without loosening anything behind it.",
      "Correct, and it simplifies — which is the right direction when you're the one ahead.",
    ],
  },
  goodCheck: {
    little: [
      "Check! You made {opp} king hiccup. He has to answer you RIGHT NOW.",
      "A royal hello! The king has to stop whatever he was doing.",
      "Check! Nothing else in the world matters to {oppThem} this turn.",
      "Check! Ha — now I have to drop everything and look after my king.",
      "Ooh, check. You just took my whole turn away from me.",
      "Check! The king can only do three things: run, hide behind somebody, or send someone to grab you.",
    ],
    middle: [
      "Check — and a useful one. Forcing moves make your opponent play your game.",
      "Good check. {oppThey} have only three answers to any check: move, block, or capture.",
      "Check! That buys you a tempo, and tempo is how attacks get built.",
      "Nice check. It takes {opp} turn away — every check is a free move if it improves something.",
      "Check. Worth asking each time: is my position better after the answer? Here it is.",
      "Good check. Forcing moves first, always: checks, then captures, then threats.",
    ],
    big: [
      "Useful check — it gains a tempo rather than just making noise.",
      "Good check. The test for a check is always 'does my position improve after the forced reply?' — here it does.",
      "Check, and it improves your worst piece at the same time. That's the good kind.",
      "Sound check. It narrows my options, which is worth more than the check itself.",
      "Good — a check with a follow-up. The ones without a follow-up just lose you a tempo.",
      "Check, and it comes with gain. That's the whole distinction worth learning about checks.",
    ],
  },
  savedIt: {
    little: [
      "Phew! You spotted the danger and moved your {piece} somewhere cosy. Good eyes!",
      "Rescued! Your {piece} was about to get gobbled and you whisked it away.",
      "Ooh, good save. I was about to cough loudly and pretend it was nothing.",
    ],
    middle: [
      "Good save — you noticed the threat and dealt with it before it cost you.",
      "Nicely spotted. That {piece} was in real trouble and now it isn't.",
      "That's the move. Seeing the threat is most of the skill; you saw it.",
    ],
    big: [
      "Good — you saw the threat and answered it without weakening anything else.",
      "Correct defensive move. Most losses are threats that nobody noticed.",
      "Well spotted. That was the cleanest way to meet it.",
    ],
  },
  // THE BIGGEST BANK IN THE FILE, ON PURPOSE. Most moves in most games are
  // quiet ones, so this is the lesson a child hears more than any other — and
  // a bank of three here wears through in a single evening while the ten
  // lovely fork lines sit unused for a week.
  solidQuiet: {
    little: [
      "Everyone's safe, everyone's helping. That's a good board.",
      "Nothing dramatic — and nothing dropped. That's most of chess, you know.",
      "Cosy. Your pieces are all holding hands.",
      "Quiet move. Sometimes the board just wants a little tidy-up.",
      "No fireworks, no wobbles. Lovely.",
      "That one didn't need to be clever. It just needed to be kind to your pieces.",
      "Tuck, tuck. Everything's where it ought to be.",
      "Steady hands. The lanterns are still on and nobody's fallen off anything.",
      "A calm one. Calm ones are how you get to the exciting ones.",
      "Everything still tucked in. On we go.",
    ],
    middle: [
      "Nothing dramatic there — and that's fine. Most good moves are quiet ones.",
      "Solid. Your pieces are defending each other, which is the whole trick.",
      "Quiet move, sound position. Not every turn needs fireworks.",
      "Nothing to fix. Games are mostly made of moves like that one.",
      "No tactics in the air yet, so improving a piece is exactly the right answer.",
      "That keeps everything talking to everything else. Good.",
      "Quiet is underrated — it's what the loud moves get built on.",
      "Nothing loose, nothing given away. Onward.",
      "Sensible. You improved your position without asking it for anything.",
    ],
    big: [
      "Quiet move, no weaknesses created. Fine.",
      "Nothing forcing available, so improving a piece is right.",
      "Solid. The position isn't asking for anything sharper yet.",
      "No tactics here. Improving your worst piece is the standard answer.",
      "Nothing loose, nothing weakened. That's the whole bar for a quiet move.",
      "Reasonable. The position is still gathering itself.",
      "Fine. Not every move has a point you can name — some just cost nothing.",
      "Sound. Keep playing like that and the tactics turn up on their own.",
      "Useful move. Small improvements compound faster than they look like they should.",
    ],
  },
  castled: {
    little: [
      "You castled! Now your king is home with cocoa and a blanket, and your castle came out to play.",
      "Castle sweet castle! Your king just moved into the safest little cabin in the park.",
      "Ooh, castling — the only move where TWO pieces go at once. Your king is tucked in now.",
    ],
    middle: [
      "You castled — king safe, rook activated. Two good things in one move.",
      "Good, castled. A king in the middle of the board is a king in the middle of the road.",
      "Castling done. Now your rook can join in and your king can stop worrying.",
    ],
    big: [
      "Castled — king off the centre file and the rook connected. Right priority.",
      "Good, castling before opening lines. That order matters more than the moves themselves.",
      "Castled. Now the rooks can talk to each other.",
    ],
  },
  developed: {
    little: [
      "I love it — another helper comes out to play! Pieces are happiest when they're helping each other.",
      "Out you come! Your team is waking up. Horses and bishops first, then tuck the king in.",
      "Another one out of the toy box! That's exactly how a game should start.",
      "Another friend joins the party. Nobody ever won from the back row!",
      "Up and out! Every piece you wake up makes the next move easier.",
      "That's the way — get everybody out of bed before the fun starts.",
    ],
    middle: [
      "Good development — get the pieces out, castle, then think about attacking.",
      "Another piece into the game. In the opening that's worth more than a pawn grab.",
      "Nice. Knights and bishops out, king tucked away, then the plans can start.",
      "Developing move. Count your pieces in play against mine — that count decides most openings.",
      "Good. A piece still on its starting square is a piece you haven't got.",
      "That's the right sort of opening move: it does something and asks for nothing back.",
    ],
    big: [
      "Good development. Piece activity in the opening beats material almost every time.",
      "Right idea — minor pieces out before committing the queen or the pawns.",
      "Sound developing move. Fastest route to a playable middlegame.",
      "Correct priority: develop with purpose, castle, then go looking for a plan.",
      "Good. A developing move that also does a second job is worth two.",
      "Sensible. Development count is the cheapest evaluation there is, and yours is fine.",
    ],
  },
  promoted: {
    little: [
      "A PAWN BECAME A QUEEN! Tiny legs, giant dreams. I'm not crying, YOU'RE crying.",
      "PROMOTION! Your little pawn walked all that way and grew a crown. What a journey!",
      "Look at that! The smallest one on the board is now the biggest. That's my favourite rule in all of chess.",
    ],
    middle: [
      "Promotion! Your pawn crossed the whole board and came back a queen. That's the reward for all that marching.",
      "New queen! Remember this feeling — endgames are all about getting one pawn to the end.",
      "Promoted! Every pawn is a queen who hasn't arrived yet.",
    ],
    big: [
      "Promotion. That's the whole point of endgame technique, right there.",
      "New queen. Worth remembering: underpromotion to a knight is occasionally the stronger move — not here, though.",
      "Promoted — converted. That's the cleanest way to end a game.",
    ],
  },
  centre: {
    little: [
      "Right in the middle! The middle of the board is the best seat in the house.",
      "Ooh, centre squares. Pieces in the middle can reach everywhere, like standing in the middle of the park.",
      "Bang in the middle. That's the busiest, best bit of the board.",
      "Middle squares! From there your pieces can see nearly everywhere at once.",
      "The middle of the board is like the plaza — everything is close to it.",
      "Good spot! Pieces stuck at the edges can only see half the world.",
    ],
    middle: [
      "Good — you took space in the centre. Central pieces reach more squares than edge pieces, always.",
      "Centre control. That's what the whole opening is arguing about.",
      "Centre pawn. Every opening you'll ever learn is a different opinion about these four squares.",
      "Good centre grab. Space there makes every one of your pieces slightly better at once.",
      "That's the middle staked out. Now your pieces have somewhere to aim.",
      "A knight on the rim is dim, as the old rhyme goes. The middle is where the work happens.",
    ],
    big: [
      "Good central play. Space in the centre restricts their pieces more than it helps yours — that's the real gain.",
      "Solid centre grab. Now the knights have outposts to aim for.",
      "Central space. The value isn't the square you take, it's the squares it denies.",
      "Good. Central pawns are the frame every plan hangs on.",
      "Right structural priority — centre before flank, nearly always.",
      "Centre staked. Keep it defensible; an overextended pawn turns into a target.",
    ],
  },

  /* ---------------- gentle warnings ------------------------------ */
  hungMovedPiece: {
    little: [
      "But peek — the {piece} you just moved is standing out in the rain, and {opp} {theirPiece} has an umbrella AND a fork.",
      "Ooh, careful — your {piece} landed on a square where {opp} {theirPiece} can gobble it right up.",
      "Your {piece} was reaching for something lovely, but it forgot its own tail was showing! {opp} {theirPiece} can nibble it.",
      "Wait — nobody is looking after that {piece}. {opp} {theirPiece} is licking its lips.",
      "That {piece} needs a friend standing next to it. Right now it's all alone out there.",
      "Hold on — that square isn't safe! {opp} {theirPiece} is already looking at it.",
      "Ooh. Your {piece} hopped somewhere brave, but {opp} {theirPiece} was waiting.",
      "Your {piece} went exploring and landed right where {opp} {theirPiece} can reach. Shall we find it a cosier square?",
    ],
    middle: [
      "But look — the {piece} you just moved can be taken by {opp} {theirPiece}, and nothing of yours defends it.",
      "Careful: that {piece} is undefended on {sq}. Before every move, ask 'can anything take this?'",
      "The {piece} landed on a square {opp} {theirPiece} covers. Nothing's guarding it, so it just drops.",
      "That square isn't safe — {opp} {theirPiece} hits it and you've no defender there.",
      "One thing: {opp} {theirPiece} covers {sq}, and nothing of yours does. The {piece} can just be taken.",
      "Before every move, the same three words: is it safe? {opp} {theirPiece} says that square isn't.",
    ],
    big: [
      "The {piece} on {sq} is hanging — {opp} {theirPiece} takes it and you've nothing that recaptures. That's about {value}.",
      "That square's covered by {opp} {theirPiece} and undefended by you. Straight material loss of {value}.",
      "Careful — {piece} on {sq} drops to {opp} {theirPiece}. Always run the capture check on the destination square.",
      "You've put the {piece} on a square {opp} {theirPiece} already covers. Nothing defends it — that's {value}.",
      "{sq} isn't safe. The habit that fixes this is one question before you let go: what attacks the square I'm landing on?",
      "The {piece} hangs on {sq}. Worth a rewind — finding the safe version of the same idea is the useful bit.",
      "Careful. {opp} {theirPiece} hits {sq} and you've no recapture, so that's {value} for nothing.",
    ],
  },
  hangingPiece: {
    little: [
      "But peek over at your {piece} — it's all alone and {opp} {theirPiece} can reach it!",
      "Ooh — while we were busy, your {piece} got left behind at the fair. Somebody should go and stand next to it.",
      "Careful! Your {piece} has nobody guarding it, and {opp} {theirPiece} noticed before I did.",
      "Your poor {piece} is standing out in the cold with no scarf on. {opp} {theirPiece} is coming.",
      "Peek at your {piece} — it's got nobody next to it, and {opp} {theirPiece} is creeping closer.",
      "One of your team wandered off on their own. {opp} {theirPiece} spotted them before I did!",
    ],
    middle: [
      "But your {piece} on {sq} is undefended, and {opp} {theirPiece} can take it.",
      "Careful — the {piece} on {sq} has no defender. That's the piece {oppThey} will go for.",
      "Look at {sq}: your {piece} is loose. Loose pieces drop off, as the old saying goes.",
      "The {piece} on {sq} needs a guard or a new square. {opp} {theirPiece} is looking straight at it.",
    ],
    big: [
      "Your {piece} on {sq} is hanging to {opp} {theirPiece} — about {value}.",
      "Loose piece on {sq}. Loose pieces drop off; either defend it or move it.",
      "The {piece} on {sq} is undefended and attacked. That's {value} unless you address it now.",
      "{sq} is loose. Defend it, move it, or make a bigger threat — those are the only three answers.",
      "The {piece} on {sq} has no defender. Scanning your own loose pieces before every move is the cheapest habit in chess.",
      "Undefended on {sq}, and {opp} {theirPiece} is looking at it. About {value}.",
    ],
  },
  opponentFork: {
    little: [
      "Careful! {opp} {theirPiece} can hop somewhere and poke TWO of your pieces at once.",
      "Ooh — watch out, {oppThey} have a fork coming. One piece pointing at two of yours!",
      "Peek at {opp} {theirPiece} — it's about to point at two of your friends at the same time.",
    ],
    middle: [
      "Careful — {opp} {theirPiece} has a fork available. It'll hit two of your pieces and you can only save one.",
      "There's a fork coming from {opp} {theirPiece}. Look for a move that defends both, or moves one away with tempo.",
      "Watch {sq} — {opp} {theirPiece} forks two of your pieces from there.",
    ],
    big: [
      "{opp} {theirPiece} has a fork on {sq}, hitting two of your pieces. You'll need to remove one target or cover the square.",
      "There's a fork available to {oppThem} worth about {value}. Best defences: cover the forking square, or move a target with tempo.",
      "Careful — fork on {sq} for {oppThem}. Two targets, one defender, no good answer unless you act now.",
    ],
  },
  opponentPin: {
    little: [
      "Ooh — {opp} {theirPiece} has your {piece} stuck. It can't move, because your king is behind it!",
      "Careful, your {piece} is pinned. It's stuck like a shoe in toffee until we sort it out.",
      "Your {piece} can't run away — something important is hiding behind it.",
    ],
    middle: [
      "Careful — your {piece} is pinned by {opp} {theirPiece}. It can't move, so it's a sitting target.",
      "That's a pin against you on {sq}. Either break it (move the piece behind) or defend the pinned piece more.",
      "Your {piece} is pinned. {oppThey} will pile more attackers onto it — deal with the pin first.",
    ],
    big: [
      "Your {piece} on {sq} is pinned by {opp} {theirPiece}. Standard answers: unpin by moving the rear piece, block the line, or challenge the pinner.",
      "That's a pin on {sq}. Pinned pieces attract attackers — don't leave it sitting there.",
      "Pinned on {sq}. Note it also stops that piece defending anything else, which is usually the real cost.",
    ],
  },
  opponentSkewer: {
    little: [
      "Careful! If your big piece moves, there's a present sitting right behind it for {oppThem}.",
      "Ooh — {opp} {theirPiece} is looking straight through your pieces. The one at the back is in trouble.",
      "Careful — two of yours are standing in a line, and {opp} {theirPiece} can see all the way down it.",
      "Hold on. When the front one steps out of the way, the one hiding behind is all on its own.",
    ],
    middle: [
      "Careful — that's a skewer. Your bigger piece has to move, and then {oppThey} take the one behind.",
      "There's a skewer on {sq}: your front piece must move, and the piece behind it drops.",
      "Skewer against you. It's a pin in reverse — the big one is in front, so it can't just sit there.",
      "Careful — two of your pieces are lined up. Getting one out of the line is worth doing right now.",
    ],
    big: [
      "Skewer on {sq} — your front piece is forced to move and the rear one falls. Worth about {value}.",
      "That's a skewer against you. Best answers are usually to interpose or to defend the rear piece before moving.",
      "Skewer. Look for a move that saves both, or one that answers with a bigger threat of your own.",
      "You're skewered on {sq}. Lining two pieces up on an open line is the habit to break, not this move.",
    ],
  },
  /**
   * Plain check, said out loud while the child is looking at the board.
   * The over-the-shoulder watch used to go quiet in exactly this moment,
   * because "what does the opponent threaten?" is a null-move question and a
   * null move is illegal while you are in check — so the one position where a
   * grandfather should lean forward was the one where he said nothing.
   */
  inCheck: {
    little: [
      "Check! Your king is being poked. He has to be safe again before anything else — move him, block the road, or gobble the poker.",
      "Ooh, check! Everything else on the board can wait. Let's look after the king first.",
      "Careful — that's check! Three ways out, always: move him, put somebody in the way, or take the piece that's shouting.",
      "Check! Don't panic. Kings get shouted at all the time. Move, block, or munch.",
    ],
    middle: [
      "Check — the king comes first. Move it, block the line, or capture the checking piece.",
      "You're in check. Only three legal answers ever: move, block, capture. Count all three before you pick.",
      "Check. Have a proper look at all three answers — the obvious one isn't always the best one.",
      "That's check. Worth checking whether one of the answers also does something useful.",
    ],
    big: [
      "Check. Move, block, or capture — and look at all three, because the king move is often the worst of them.",
      "You're in check. Count the legal answers first; if there's only one, that's information about the position.",
      "Check. The interposition is worth calculating before you reach for the king.",
      "In check. If a capture of the checker is available, price the recapture before you play it.",
    ],
  },
  mateDanger: {
    little: [
      "Big careful now — if we snooze, {oppThey} have CHECKMATE next move! Let's look after the king.",
      "Red lanterns! {oppThey} can checkmate you right now. Quick — can we block, or move, or capture?",
      "Careful careful! The king is in real trouble. Every check has three answers: move, block, or gobble the attacker.",
    ],
    middle: [
      "Careful — {oppThey} have mate next move. King safety before everything else now.",
      "There's checkmate threatened. Three answers to any mate threat: move the king, block the line, or capture the piece.",
      "Watch out — mate is coming on {sq}. Everything else on the board can wait.",
    ],
    big: [
      "Mate threatened on {sq}. Everything else is irrelevant until that's parried.",
      "Careful — there's mate in one. Look for luft, a blocking interposition, or a capture of the mating piece.",
      "Mate threat live on {sq}. Deal with it now; positional considerations don't survive checkmate.",
    ],
  },
  backRankDanger: {
    little: [
      "Peek at your king — he's tucked in behind his little pawn duvet with no window! A castle tower can sneak along the back row.",
      "Careful — your king has no escape hatch. Sometimes you need to push one pawn to make a little window for him to breathe.",
      "Ooh, back row trouble! Your king is cosy, but a bit TOO cosy. He can't get out!",
    ],
    middle: [
      "Careful — back rank. Your king has no escape squares, so a rook or queen landing on that row is mate.",
      "Watch the back rank. One little pawn move gives your king a window and takes the whole problem away.",
      "Your king's back rank is weak — all three squares in front are blocked. That's a mate waiting to happen.",
    ],
    big: [
      "Back-rank weakness — no luft, and {oppThey} have a heavy piece that can reach the rank.",
      "Careful with the back rank. h-pawn (or g-pawn) push solves it permanently and costs almost nothing.",
      "Back-rank mate is live. Every tactic in this position is going to hinge on it.",
    ],
  },
  trappedPiece: {
    little: [
      "Ooh — your {piece} went for a snack and now it can't find its way home! Every road out is blocked.",
      "Poor {piece}. It's stuck in the corner with no way back, like me at a birthday party.",
      "Careful — your {piece} has nowhere safe to run. It went too far in.",
    ],
    middle: [
      "Careful — your {piece} on {sq} is trapped. Every square it can go to is covered.",
      "That {piece} has no safe squares. Grabbing that pawn cost more than the pawn was worth.",
      "Your {piece} is trapped on {sq}. Worth checking escape routes BEFORE a piece goes hunting.",
    ],
    big: [
      "Your {piece} on {sq} is trapped — no safe retreat. That's {value} unless you can create an escape square.",
      "Trapped piece on {sq}. The classic cause is a greedy pawn grab; always count the retreat squares first.",
      "That {piece} has no way out. Look for a counter-threat — trapped pieces are usually saved by tactics, not by moving them.",
    ],
  },
  overloadedDefender: {
    little: [
      "Careful — your {piece} is trying to look after TWO friends at once. It can't do both jobs!",
      "Your poor {piece} is babysitting two little ones. If it runs to one, the other one is all alone.",
      "That {piece} is doing two jobs at the same time. Shall we find it some help?",
      "Ooh — your {piece} is the only one watching two of your team. That's a lot to ask of one piece.",
    ],
    middle: [
      "Careful — your {piece} on {sq} is the only defender of two different pieces. It can't cover both if {oppThey} strike.",
      "That {piece} is overloaded: two jobs, one piece. Give one of its charges another defender.",
      "Your {piece} is holding up two things at once. That's the shape {oppThey} will aim at next.",
      "One defender, two duties. Either add a second guard or move one of the pieces it's covering.",
    ],
    big: [
      "Your {piece} on {sq} is overloaded — sole defender of two attacked pieces. That's a standard tactical target.",
      "Overloaded defender on {sq}. {oppThey} deflect it and collect whichever charge is left.",
      "That's an overload. The tactic against it is always deflection — so remove the second duty before it arrives.",
      "Your {piece} can't do both jobs. Overloads don't hurt until they do, and then they hurt all at once.",
    ],
  },

  /* ---------------- the secret they walked past ------------------ */
  missedMate: {
    little: [
      "And ooh, here's a secret — there was CHECKMATE hiding! {best} would have ended the whole show with fireworks.",
      "Psst. Come closer. There was a checkmate right there — {best}! The king was standing under the dunk tank.",
      "Shall I tell you a secret? Checkmate was waiting. It's still a lovely game though — carry on!",
    ],
    middle: [
      "Here's a secret: there was checkmate in {n}. {best} finished it on the spot.",
      "Psst — {best} was mate. Don't feel bad, I only saw it because I've been staring at boards since 1961.",
      "There was a mate hiding: {best}. Worth playing through afterwards — those patterns stick.",
    ],
    big: [
      "There was mate in {n} with {best}. Worth setting up again afterwards to see the pattern.",
      "{best} was checkmate. Forcing-move discipline — checks first, always.",
      "Mate in {n} was available via {best}. The pattern is worth memorising; it recurs constantly.",
    ],
  },
  missedFork: {
    little: [
      "And a little secret — your {piece} could have hopped over and poked two things at once! Next time, look for those.",
      "Psst — there was a fork hiding. One hop and you'd have pointed at two treasures.",
      "Ooh, you were SO close to something sneaky — your {piece} had a two-at-once move waiting.",
    ],
    middle: [
      "Small secret: there was a fork available — {best} attacks two pieces at once.",
      "There was a fork sitting there: {best}. Knights especially — always check where a knight can hop to hit two things.",
      "{best} would have forked them. Worth about {value}. Next time, scan for knight hops before anything else.",
    ],
    big: [
      "{best} was a fork worth about {value}. Standard scan: checks, captures, then forks — in that order.",
      "There was a fork with {best}, hitting two undefended pieces. Easy to miss, easy to train.",
      "Missed fork: {best}. The tell was two of their pieces sitting on the same knight-hop colour.",
    ],
  },
  missedCapture: {
    little: [
      "And peek — there was a free snack sitting right there! {best} would have gobbled it up.",
      "Psst, you walked right past the toffee stall — {best} takes a piece for free!",
      "There was free popcorn on the board and nobody was guarding it. Next time have a good look around first.",
      "Ooh — you walked right past a present with your name on it. {best} unwraps it!",
      "Secret: something of mine was sitting out with nobody watching it. {best} takes it, free.",
    ],
    middle: [
      "There was a free piece: {best} wins it, and nothing takes back.",
      "You could have taken for free with {best} — worth about {value}. Always scan every capture before you move.",
      "{best} grabs material for nothing. The habit that fixes this: list every capture available, every single turn.",
    ],
    big: [
      "{best} wins material cleanly — about {value}, no recapture. Captures-first discipline.",
      "There was free material with {best}. Nothing defends it and nothing recaptures.",
      "Missed {best}, which wins {value} outright.",
    ],
  },
  missedBetter: {
    little: [
      "Between you and me, {best} was the one with sprinkles on top. But your move is fine!",
      "My old whiskers twitched at {best} — a shinier path. Yours works too, though.",
      "There was a slightly tastier move: {best}. Keep it in your pocket for next time.",
    ],
    middle: [
      "For what it's worth, {best} was a touch stronger. Yours is perfectly playable.",
      "The sharper try was {best}. Not a big difference — worth seeing though.",
      "{best} was a shade better. File it away; the pattern comes round again.",
    ],
    big: [
      "{best} was more precise here. The difference is small but the idea is worth knowing.",
      "Engine prefers {best}. Same plan, cleaner move order.",
      "{best} keeps more of the advantage. Marginal, but these add up over a game.",
    ],
  },

  /* ---------------- grandpa's standing advice -------------------- */
  earlyQueen: {
    little: [
      "One grandpa tip: don't send the queen out too early! The little ones chase her round the park and she never gets a rest.",
      "Your queen came out very early — brave lady! But the little pieces will chase her. Horses and bishops first, remember?",
      "Careful with the queen so soon. She's precious. Let the little ones warm up first.",
    ],
    middle: [
      "Grandpa's rule: don't bring the queen out early. Every minor piece that attacks her gains a free move.",
      "The queen is out very early. She'll get chased around, and each chase develops one of {opp} pieces for free.",
      "Knights and bishops first, then castle, then the queen. It's an old rule because it keeps being right.",
    ],
    big: [
      "Early queen sorties usually just lose tempo — every attack on her develops a piece for free.",
      "The queen's out too early. It's not losing, it's just donating tempo.",
      "Careful with the early queen. Develop minors first; the queen has nothing useful to do yet.",
    ],
  },
  keepDeveloping: {
    little: [
      "Shall we get another helper out? Pieces sitting at home can't join the fun.",
      "Some of your team is still asleep in the back row! Let's wake them up.",
      "More friends out to play — that's the way to start a game.",
    ],
    middle: [
      "Worth getting another piece out — you've still got pieces on the back rank.",
      "Development first. A piece at home is a piece that isn't helping.",
      "Try to get everything out and the king tucked away before you start anything sharp.",
    ],
    big: [
      "You're behind in development. Get the remaining minors out before committing to a plan.",
      "Finish developing. Attacks launched with pieces still at home tend to bounce.",
    ],
  },
  kingSafety: {
    little: [
      "Let's look after the king — he likes being tucked in behind his pawns with a blanket.",
      "The king is a bit exposed out there. Shall we find him somewhere cosy?",
      "Poor king, standing in the middle of the fair with no coat on. Let's get him home.",
      "Kings don't like crowds. Let's move him somewhere quiet before anything else.",
    ],
    middle: [
      "Your king's a little exposed. Castling (or just making a safe square) is worth more than a pawn here.",
      "King safety first. Open lines near an uncastled king turn into tactics very quickly.",
      "The king is still in the middle. That's the one thing worth spending a move on right now.",
      "Tuck the king away. Every attack you'll ever face starts by finding a king that's still in the centre.",
    ],
    big: [
      "King safety is the concern here — the centre files are opening and your king is still there.",
      "Get the king sorted before anything else. Everything else in the position is fine.",
      "Your king is the weakness. Castle, or make luft, before you commit to anything on the wings.",
      "King safety outranks the rest of this position. Solve it while it's cheap to solve.",
    ],
  },
};

/* ================================================================== *
 * LAYER 4 — FLOURISHES
 *
 * Never load-bearing. They exist so the same true sentence arrives wearing a
 * different hat, and they are the first thing trimmed when the word budget
 * runs out.
 * ================================================================== */

const FLOURISH: Record<"cheer" | "warm" | "gentle", Bank> = {
  cheer: {
    little: [
      "My beard did a little dance.",
      "Somewhere a confetti cannon just went off.",
      "The pigeons on the Ferris wheel are applauding.",
      "I nearly dropped my cocoa!",
      "The lanterns all went twinkle at once.",
      "Even the toffee man looked up.",
      "I'm putting a gold star right on your forehead.",
      "Ding ding ding goes the carnival bell!",
    ],
    middle: [
      "My beard did a little dance.",
      "That one's going on the trophy shelf.",
      "The Ferris wheel pigeons approve.",
      "I nearly spilt my cocoa, and I never spill my cocoa.",
      "Somewhere a confetti cannon just went off.",
      "Keep that up and I'll have to start trying.",
    ],
    big: [
      "That one's going on the shelf.",
      "I'll have to start trying, at this rate.",
      "Nicely done.",
      "The old man is impressed, and the old man is hard to impress.",
    ],
  },
  warm: {
    little: [
      "Onward we go!",
      "Chug chug, next stop.",
      "The lanterns are just coming on.",
      "Nice and cosy.",
      "Good, good.",
    ],
    middle: [
      "Onward.",
      "Keep going.",
      "The lanterns are just coming on — lovely time of day for a game.",
      "Steady does it.",
    ],
    big: [
      "Carry on.",
      "Keep the plan going.",
      "Fine so far.",
    ],
  },
  gentle: {
    little: [
      "Every wobble is a teacher wearing a silly hat.",
      "I do this three times before breakfast, you know.",
      "Shall we have another look together?",
      "Nothing's broken. Come on.",
      "I've made that exact move with these exact whiskers.",
    ],
    middle: [
      "Everyone does this. I did it last Tuesday.",
      "Worth a second look — no harm done.",
      "That's the sort of thing you only miss once.",
      "Nothing's lost that a good look can't fix.",
    ],
    big: [
      "Worth remembering — those recur.",
      "Everyone drops one of those. The trick is noticing faster next time.",
      "Not fatal. Keep playing.",
    ],
  },
};

/** Occasional scene-setting, keyed to where in the game we are. */
const PHASE_TINT: Record<GamePhase, Bank> = {
  opening: {
    little: ["The park gates are only just open.", "We're still stretching our legs."],
    middle: ["Still early — plenty of park left.", "Opening's barely done."],
    big: ["Still theory-ish territory.", "Early days."],
  },
  middlegame: {
    little: ["This is the busy bit — everyone's out on the rides!", "Middle of the fair now."],
    middle: ["This is the middlegame — where games are actually decided.", "Busiest part of the board now."],
    big: ["Middlegame proper now.", "This is where the game gets decided."],
  },
  endgame: {
    little: ["The lanterns are lit — this is the quiet, magic bit.", "Nearly bedtime on the board."],
    middle: ["Endgame now — quiet, deep, and full of magic.", "Fewer pieces, bigger decisions."],
    big: ["Endgame. Precision matters more than plans now.", "Technical phase — count everything."],
  },
};

/* ================================================================== *
 * THE HINT LADDER
 * ================================================================== */

export type HintRung = "nudge" | "highlight" | "show";

const HINT_LINES: Record<HintRung, Bank> = {
  nudge: {
    little: [
      "Want a sparkle? Have a peek at your {piece} — it's got a secret.",
      "Little whisper: one of your pieces is dying to show you something.",
      "Psst. Look at your {piece}. Just look at it for a moment.",
      "Here's a sparkle: something lovely starts with your {piece}.",
    ],
    middle: [
      "Want a hint? Look at your {piece} — it has a move you'll like.",
      "Little nudge: the answer starts with one of your pieces you haven't touched yet.",
      "Try this — check every capture first, then every check. It's in there.",
      "Hint: your {piece} is the one to think about.",
    ],
    big: [
      "Hint: the move involves your {piece}.",
      "Scan checks and captures first — it's one of those.",
      "The idea starts with your {piece}. See if you can find the rest.",
    ],
  },
  highlight: {
    little: [
      "I'll light up the square for you. See it glowing? Something starts right there.",
      "Look — I've made that square sparkle. Your {piece} wants to be involved.",
      "There! The glowing one. Have a think about what could go there.",
    ],
    middle: [
      "I've lit the square up. The move starts from there.",
      "See the glow? That's the piece. Now find where it wants to go.",
      "There's your starting square. The rest is one step away.",
    ],
    big: [
      "Lit the origin square. The move's from there.",
      "That's the piece. Destination's the interesting part.",
      "Starting square highlighted — work out the target.",
    ],
  },
  show: {
    little: [
      "Here it is! The arrow shows you exactly where to go. Shall we do it together?",
      "There we are — follow the arrow. That's the sparkly move!",
      "Look, I've drawn it for you. That's the one I was humming about.",
    ],
    middle: [
      "Here it is: {best}. Follow the arrow — and next time you'll spot it yourself.",
      "The move is {best}. Have a proper look at WHY it works before you play it.",
      "There: {best}. See the shape? That shape comes back again and again.",
      "There — I've drawn it on the board. See why it works before you play it.",
      "That's the one, arrow and all. The shape is the bit worth remembering.",
    ],
    big: [
      "It's {best}. Play through why the alternatives fail — that's where the value is.",
      "{best}. The point is the follow-up, not the move itself.",
      "The move is {best}.",
      "There it is on the board. Work out why the alternatives fall short.",
      "Drawn it for you. The follow-up is the interesting part.",
    ],
  },
};

const TAKEBACK_LINES: Bank = {
  little: [
    "Shall we try that one again? No harm done — the board doesn't mind a bit.",
    "Want a do-over? I'll close my eyes and count to three.",
    "We can put that one back if you like. Nobody's watching but the pigeons.",
    "Have another go? Go on. I'll pretend I saw nothing.",
  ],
  middle: [
    "Want to take that back and try again? No shame in it — that's how practice works.",
    "Shall we rewind one move? Have another look first.",
    "Take it back if you like. Finding it yourself is worth ten of me telling you.",
  ],
  big: [
    "Take it back if you want to find the better move yourself.",
    "Want to rewind? Worth doing — you'll spot it now.",
    "Rewind one? Your call.",
  ],
};

/* ================================================================== *
 * BETWEEN-MOVES WATCHING — what he says while HE thinks
 * ================================================================== */

const WATCH_LINES: Bank = {
  little: [
    "I'm thinking… don't peek at my scarf, that's where I hide my ideas.",
    "Hmm. Hmm hmm hmm. Give an old man a moment.",
    "Let me see, let me see…",
    "Ooh, you've made this hard for me.",
  ],
  middle: [
    "Give me a moment — you've made this awkward.",
    "Thinking… you've got me actually thinking.",
    "Hmm. There's more going on here than I'd like.",
  ],
  big: [
    "Thinking.",
    "Give me a second — this is genuinely sharp.",
    "Hmm. Nice position you've built.",
  ],
};

const GREETING_LINES: Record<string, Bank> = {
  play: {
    little: [
      "Climb up here next to me! You play, and after every move I'll tell you what I saw — the good bits, the wobbly bits, and the sneaky bits.",
      "Sit down, sit down. I've got cocoa and a board and nowhere else to be. Your move first!",
      "Ooh, a game! Right — you go first, and I'll watch every single move like a hawk in a cardigan.",
    ],
    middle: [
      "Sit down — you play, I'll watch, and after every move I'll tell you what I noticed.",
      "Right, a proper game. I'll go easy. Ish. Your move.",
      "Let's play. I'll say something after each move — ignore me whenever you like.",
    ],
    big: [
      "Let's play. I'll comment after each move; tell me if you'd rather I shut up.",
      "Your move. I'll flag anything worth flagging and stay quiet otherwise.",
      "Game on. I'll keep the commentary short.",
    ],
  },
  tactics: {
    all: [
      "Welcome to the Tactics Rollercoaster! Forks, pins and sneaky checks ahead. Hands inside the cart!",
      "Up we go! This ride is all about spotting the sneaky move. Eyes wide.",
    ],
  },
  train: {
    all: [
      "All aboard the Puzzle Train! Solve puzzles to keep us chugging along.",
      "Toot toot! Every puzzle you solve puts another log on the fire.",
    ],
  },
  ferris: {
    all: [
      "Ah, the Endgame Ferris Wheel. Nice and slow up here. Endgames are the bedtime stories of chess.",
      "Up in the Ferris wheel, where everything is quiet and every move counts double.",
    ],
  },
  carousel: {
    all: [
      "Round and round the Opening Carousel! Openings are like morning stretches.",
      "The carousel! Let's learn how good games start.",
    ],
  },
};

/* ================================================================== *
 * PICKING — the anti-repetition machinery
 * ================================================================== */

const RECENT_KEY = "chesspaa:voice:recent";
const RECENT_CAP = 160;

let recentIds: string[] | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function loadRecent(): string[] {
  if (recentIds) return recentIds;
  recentIds = [];
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(RECENT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) recentIds = parsed.filter((x) => typeof x === "string").slice(-RECENT_CAP);
      }
    } catch { /* fine, he'll just repeat himself a little more today */ }
  }
  return recentIds;
}

function rememberId(id: string): void {
  const list = loadRecent();
  list.push(id);
  if (list.length > RECENT_CAP) list.splice(0, list.length - RECENT_CAP);
  if (typeof window === "undefined") return;
  // Debounced: a whole turn's layers are one write, not four.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  }, 400);
}

/** Wipe the "he already said that" memory. Mostly for tests and for a fresh child. */
export function resetVoiceMemory(): void {
  recentIds = [];
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
}

/** Pull the band's list, falling back through the bands to `all`. */
function bankFor(bank: Bank | undefined, band: AgeBand): string[] {
  if (!bank) return [];
  return bank[band] ?? bank.all ?? bank.middle ?? bank.big ?? bank.little ?? [];
}

/**
 * Choose one line, strongly preferring something he hasn't used lately.
 * Falls back to the least-recently-used option once every variant is spent,
 * which is why a child who plays a hundred games still gets rotation rather
 * than a hard loop.
 */
function choose(key: string, options: string[], rand: () => number): string | null {
  return chooseWithIds(options, options.map((_, i) => `${key}#${i}`), rand);
}

/** The real picker. `ids` is index-aligned with `options` and is what the ring remembers. */
function chooseWithIds(options: string[], ids: string[], rand: () => number): string | null {
  if (options.length === 0) return null;
  const recent = loadRecent();
  const fresh = ids.map((id, i) => ({ id, i })).filter((o) => !recent.includes(o.id));
  let choice: { id: string; i: number };
  if (fresh.length > 0) {
    choice = fresh[Math.floor(rand() * fresh.length) % fresh.length];
  } else {
    // Everything's been used — take whichever was used longest ago.
    let bestI = 0, bestAt = Infinity;
    for (let i = 0; i < ids.length; i++) {
      const at = recent.lastIndexOf(ids[i]);
      if (at < bestAt) { bestAt = at; bestI = i; }
    }
    choice = { id: ids[bestI], i: bestI };
  }
  rememberId(choice.id);
  return options[choice.i];
}

/* ================================================================== *
 * TEMPLATE FILLING
 * ================================================================== */

const TOKEN = /\{(\w+)\}/g;

/**
 * Substitute tokens, and — importantly — DROP any sentence that still wants a
 * token we don't have. A line with a bare "{sq}" in it would break the spell
 * completely, so a missing value means that whole line is unusable and the
 * caller picks another.
 */
function fill(tpl: string, tokens: VoiceTokens): string | null {
  let missing = false;
  const out = tpl.replace(TOKEN, (_m, name: string) => {
    const v = (tokens as Record<string, string | undefined>)[name];
    if (v === undefined || v === "") { missing = true; return ""; }
    return v;
  });
  return missing ? null : out.replace(/\s{2,}/g, " ").trim();
}

/**
 * Pick from a bank, retrying past any line whose tokens we can't fill.
 *
 * The ids handed to `choose` have to be the line's index in the ORIGINAL bank,
 * not in the filtered survivors — otherwise "body:foundFork:little#2" means a
 * different sentence depending on which tokens happened to be available that
 * turn, and the anti-repetition ring starts suppressing lines he never said.
 */
function chooseFilled(key: string, options: string[], tokens: VoiceTokens, rand: () => number): string | null {
  const usable: string[] = [];
  const ids: string[] = [];
  for (let i = 0; i < options.length; i++) {
    if (fill(options[i], tokens) !== null) { usable.push(options[i]); ids.push(`${key}#${i}`); }
  }
  const got = chooseWithIds(usable, ids, rand);
  return got ? fill(got, tokens) : null;
}

/* ================================================================== *
 * THE COMPOSER
 * ================================================================== */

export interface VoiceRequest {
  tier: Tier;
  /** The single thing he decided to talk about. Null = just the verdict. */
  lesson: LessonKey | null;
  phase: GamePhase;
  band: AgeBand;
  settings: VoiceSettings;
  tokens: VoiceTokens;
  /** Deterministic when supplied; varies naturally when not. */
  seed?: number;
  /** Suppress the verdict line (e.g. the caller is showing a sticker instead). */
  skipVerdict?: boolean;
  /**
   * Override which flourish register he draws from. Normally the tier picks
   * it, but a caller that isn't grading a move (the over-the-shoulder watch)
   * needs to say "shall we look at that together?" rather than "onward!".
   */
  flourishMood?: "cheer" | "warm" | "gentle";
  /**
   * True when the lesson is a warning. Stops a happy verdict promising that
   * everything is fine one clause before he points at a hanging rook.
   */
  lessonIsWarning?: boolean;
}

function moodFor(tier: Tier): "cheer" | "warm" | "gentle" {
  if (tier === "brilliant" || tier === "clever") return "cheer";
  if (tier === "steady") return "warm";
  return "gentle";
}

let seedCounter = 1;
let seedPinned = false;
/**
 * Pin the sequence for tests and for the screenshot harness.
 *
 * This has to disable the wall-clock jitter as well as set the counter, or the
 * harness gets a different sentence on every run and the "pin" is decorative.
 */
export function setVoiceSeed(n: number): void {
  seedCounter = n >>> 0;
  seedPinned = true;
}

function makeRandom(seed?: number): () => number {
  // rng() is the park's deterministic generator — same one the geometry uses,
  // so a seeded run reproduces the scene AND the dialogue exactly.
  if (seed !== undefined) return rng(seed >>> 0);
  seedCounter = (seedCounter * 1103515245 + 12345) >>> 0;
  // Unpinned, the clock keeps two children on two machines from hearing the
  // same evening; pinned, it must not exist at all.
  const s = seedPinned ? seedCounter : seedCounter ^ (Date.now() & 0xffff);
  return rng(s >>> 0);
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function countSentences(s: string): number {
  // The closing-quote case matters: without it a line ending in ask 'like
  // this?' doesn't count, and the budget quietly lets one extra sentence past.
  return (s.match(/[.!?]["'\u2019\u201d]?(\s|$)/g) ?? []).length || 1;
}

/**
 * Assemble one utterance.
 *
 * Order of assembly matters: the LESSON is built first, because it's the only
 * layer that carries information. Everything else is decoration that gets
 * trimmed, cheapest first, until the line fits the child's attention span.
 */
export function voiceLine(req: VoiceRequest): string {
  const rand = makeRandom(req.seed);
  const { band, settings, tokens } = req;
  const mood = req.flourishMood ?? moodFor(req.tier);
  const solo = req.lesson !== null && SOLO_LESSONS.has(req.lesson);

  const body = req.lesson ? chooseFilled(`body:${req.lesson}:${band}`, bankFor(BODY[req.lesson], band), tokens, rand) : null;

  // Only the three happy tiers have a hand-off bank; slip and careful already
  // read as the opening half of an explanation.
  const handoffTier: "brilliant" | "clever" | "steady" | null =
    req.lessonIsWarning && (req.tier === "brilliant" || req.tier === "clever" || req.tier === "steady")
      ? req.tier
      : null;
  const verdict = (solo && body) || req.skipVerdict
    ? null
    : handoffTier
      ? chooseFilled(`lead:${handoffTier}:${band}`, bankFor(WARNING_LEAD_IN[handoffTier], band), tokens, rand)
      : chooseFilled(`tier:${req.tier}:${band}`, bankFor(TIER_LINES[req.tier], band), tokens, rand);

  const wantOpener = rand() < settings.whimsy * 0.55;
  const opener = wantOpener && verdict
    ? chooseFilled(`open:${mood}:${band}`, bankFor(OPENERS[mood], band), tokens, rand)
    : null;

  const wantFlourish = rand() < settings.whimsy * 0.65;
  const flourish = wantFlourish
    ? chooseFilled(`flourish:${mood}:${band}`, bankFor(FLOURISH[mood], band), tokens, rand)
    : null;

  // Phase colour is rare on purpose — it's atmosphere, not information, and
  // it only earns its place when nothing more useful is being said.
  const wantTint = !body && rand() < settings.whimsy * 0.3;
  const tint = wantTint ? chooseFilled(`phase:${req.phase}:${band}`, bankFor(PHASE_TINT[req.phase], band), tokens, rand) : null;

  // An opener only earns its place if it doesn't collide with the verdict.
  // Half the openers end in a comma or a dash and every verdict starts with a
  // capital, so a naive join produces "Fair enough — Good and steady." and
  // "Right, Alright." — which is the exact seam that makes generated dialogue
  // read as generated.
  // (An opener is only ever drawn when there is a verdict for it to lean on.)
  const head = opener && verdict ? (glue(opener, verdict) ?? verdict) : verdict;

  // Bodies are written to follow a verdict, so most of the warnings open with
  // "But…" or "And…". When the verdict is suppressed — the over-the-shoulder
  // watch does exactly that — the conjunction is left dangling off the front of
  // the sentence: "But your knight on f3 is undefended." Snip it.
  const lead = !head && body ? unhinge(body) : body;

  const core = [head, lead, tint].filter(Boolean) as string[];
  let text = core.join(" ");
  const withFlourish = flourish ? `${text} ${flourish}` : text;

  // Trim decoration until it fits. Flourish goes first, then the opener, then
  // the verdict — the lesson is the last thing standing, always.
  if (fits(withFlourish, settings)) return tidy(withFlourish);
  if (fits(text, settings)) return tidy(text);
  text = [verdict, verdict ? body : lead].filter(Boolean).join(" ");
  if (fits(text, settings)) return tidy(text);
  const last = lead ?? verdict ?? "Onward we go!";
  return tidy(last);
}

/** Drop a leading conjunction from a line that has become the first thing said. */
function unhinge(s: string): string {
  const cut = s.replace(/^(?:But|And)\s+/, "");
  return cut === s ? s : cut.charAt(0).toUpperCase() + cut.slice(1);
}

/** Words that must keep their capital wherever they land in a sentence. */
const ALWAYS_CAPITAL = /^(I|I'm|I'd|I've|I'll|ChessPaa|Ferris|Tuesday|Grandpa)\b/;

/**
 * Join an opener to the line that follows it.
 *
 * Returns null when the two would stutter — "Fine — Fine.", "Right, Alright." —
 * because dropping the opener entirely is always better than a grandfather who
 * sounds like he's buffering.
 */
function glue(opener: string, next: string): string | null {
  const openWord = /([A-Za-z']+)[^A-Za-z']*$/.exec(opener)?.[1]?.toLowerCase();
  const nextWord = /^([A-Za-z']+)/.exec(next)?.[1]?.toLowerCase();
  // Containment, not equality, so "Right," + "Alright." is caught too.
  if (openWord && nextWord && openWord.length >= 3 && nextWord.length >= 3 &&
      (openWord === nextWord || openWord.includes(nextWord) || nextWord.includes(openWord))) {
    return null;
  }
  // Only a trailing comma or dash makes the next fragment mid-sentence; an
  // opener that ended in "." or "!" is a sentence of its own and the capital
  // is correct where it is.
  if (!/[,—–-]\s*$/.test(opener)) return `${opener} ${next}`;
  const lowered =
    ALWAYS_CAPITAL.test(next) || /^[A-Z]{2,}/.test(next)   // "BRILLIANT!" keeps its shout
      ? next
      : next.charAt(0).toLowerCase() + next.slice(1);
  return `${opener} ${lowered}`;
}

function fits(s: string, settings: VoiceSettings): boolean {
  return countWords(s) <= settings.maxWords && countSentences(s) <= settings.maxSentences;
}

function tidy(s: string): string {
  const flat = s.replace(/\s+/g, " ").replace(/\s+([.!?,;:])/g, "$1").trim();
  // A substituted token can easily land at the head of a sentence ("their rook
  // is licking its lips"), so sentence starts are capitalised after the fact
  // rather than being every line author's problem.
  return flat.replace(/(^|[.!?]\s+)([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}

/* ================================================================== *
 * THE SMALLER VOICES
 * ================================================================== */

/**
 * The short sticker label — what the HUD prints next to the move. These are
 * the exact five feelings, kept deliberately gentle at the bottom end: the
 * worst thing this park ever says out loud is "Careful".
 */
const TIER_LABELS: Record<Tier, Bank> = {
  brilliant: {
    little: ["Brilliant!", "Sparkle move!", "That's the one!", "Ooh, brilliant!"],
    middle: ["Brilliant!", "Sparkle move!", "That's the one!", "Top move!"],
    big: ["Brilliant.", "Best move.", "That's the one.", "Precise."],
  },
  clever: {
    little: ["Clever!", "Nice one!", "Ooh, clever!", "Good thinking!"],
    middle: ["Clever!", "Nice one!", "Good move.", "Sharp."],
    big: ["Clever.", "Good move.", "Sharp.", "Sound."],
  },
  steady: {
    little: ["Good and steady.", "That works!", "Nice and safe.", "Good one."],
    middle: ["Good and steady.", "Solid.", "That works.", "Fine move."],
    big: ["Good and steady.", "Solid.", "Playable.", "Fine."],
  },
  slip: {
    little: ["Hmm, a little slip…", "A little wobble…", "Ooh, nearly!", "Almost…"],
    middle: ["Hmm, a little slip…", "A little wobble…", "Hmm — nearly.", "Small slip."],
    big: ["Slight slip.", "Inaccuracy.", "Hmm — nearly.", "A little loose."],
  },
  careful: {
    little: ["Careful…", "Ooh, careful!", "Hold on…", "Let's look…"],
    middle: ["Careful…", "Careful — let's look.", "Ooh, careful.", "Hold on…"],
    big: ["Careful.", "Careful — that costs.", "Hold on.", "That's expensive."],
  },
};

export function voiceTierLabel(tier: Tier, band: AgeBand = "middle", seed?: number): string {
  const rand = makeRandom(seed);
  const options = bankFor(TIER_LABELS[tier], band);
  return choose(`label:${tier}:${band}`, options, rand) ?? options[0] ?? "Good and steady.";
}

/** The little emoji sticker. Warm at every tier — there is no red X in this park. */
export const TIER_STICKER: Record<Tier, string> = {
  brilliant: "🌟",
  clever: "✨",
  steady: "👍",
  slip: "🤔",
  careful: "🧣",
};

/** A ChessPaa face for the character rig to play. */
export type ChessPaaMood = "delighted" | "proud" | "twinkle" | "thinking" | "kindly";

export const TIER_MOOD: Record<Tier, ChessPaaMood> = {
  brilliant: "delighted",
  clever: "proud",
  steady: "twinkle",
  slip: "thinking",
  careful: "kindly",
};

export function voiceHint(rung: HintRung, band: AgeBand, tokens: VoiceTokens, seed?: number): string {
  const rand = makeRandom(seed);
  return (
    chooseFilled(`hint:${rung}:${band}`, bankFor(HINT_LINES[rung], band), tokens, rand) ??
    // Last resort still has to be warm and still has to be useful.
    (rung === "show" && tokens.best ? `Here it is: ${tokens.best}.` : "Have a little look around the board.")
  );
}

export function voiceTakeback(band: AgeBand, seed?: number): string {
  const rand = makeRandom(seed);
  return chooseFilled(`takeback:${band}`, bankFor(TAKEBACK_LINES, band), {}, rand) ?? "Shall we try that again?";
}

export function voiceWatching(band: AgeBand, seed?: number): string {
  const rand = makeRandom(seed);
  return chooseFilled(`watch:${band}`, bankFor(WATCH_LINES, band), {}, rand) ?? "Thinking…";
}

export function voiceGreeting(ride: string, band: AgeBand, seed?: number): string {
  const rand = makeRandom(seed);
  const bank = GREETING_LINES[ride] ?? GREETING_LINES.play;
  return (
    chooseFilled(`greet:${ride}:${band}`, bankFor(bank, band), {}, rand) ??
    "Come and sit down — let's play."
  );
}

/**
 * How ChessPaa refers to the other side. When he IS the other side he says
 * "my rook", which is one of those tiny things that makes a character feel
 * like a person rather than a narrator.
 */
export function opponentWords(chessPaaIsOpponent: boolean): Pick<VoiceTokens, "opp" | "oppThey" | "oppThem"> {
  return chessPaaIsOpponent
    ? { opp: "my", oppThey: "I", oppThem: "me" }
    : { opp: "their", oppThey: "they", oppThem: "them" };
}

/**
 * How many distinct lines exist for a lesson in a band — used by the tutor to
 * decide whether it's safe to repeat a lesson soon, and by tests to make sure
 * nobody accidentally ships a bank of one.
 */
export function bankSize(lesson: LessonKey, band: AgeBand): number {
  return bankFor(BODY[lesson], band).length;
}

/** Every lesson key, for exhaustiveness checks and for the harness. */
export const ALL_LESSONS = Object.keys(BODY) as LessonKey[];

/** Does this profile's band have a picture-book version of this lesson? */
export function hasLesson(lesson: LessonKey, band: AgeBand): boolean {
  return bankFor(BODY[lesson], band).length > 0;
}
