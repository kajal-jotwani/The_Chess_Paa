import { Chess, Move, Square, PieceSymbol } from "chess.js";
import { Engine, scoreToPawns } from "./Engine";
import { hangingPieces, freeCaptures, forkTargets, developedMinors, describeMove, moveFromUci, NAME, VALUE, kingSquare } from "./Motifs";

export type Tier = "brilliant" | "great" | "good" | "okay" | "hmm" | "careful" | "oops";

export interface Verdict {
  tier: Tier;
  emoji: string;
  title: string;
  cpLoss: number;
  bestMove: Move | null;
  played: Move;
  explanation: string;
  suggestion: string;
  evalAfter: number;     // white-perspective pawns after the move
  mateIn: number | null; // positive: mover mates; negative: mover gets mated
  facts: string[];
  showSquares: Square[]; // squares worth highlighting when explaining
}

const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

const PRAISE = [
  "Sparkle sparkle, what a move — you've got the champion groove!",
  "Ho ho! That's exactly what ChessPaa would play.",
  "Brilliant! My monocle nearly popped out!",
  "Wonderful! The pieces are cheering for you.",
  "Top of the coaster, that one! Superb.",
];
const GOOD = [
  "Nice one! A solid, sensible move.",
  "Good thinking — the pieces are working together.",
  "That's a fine move, little champion.",
  "Yes! Steady as the puzzle train.",
];
const OKAY = [
  "That works, but there was a sparklier idea hiding on the board.",
  "Not bad at all — though ChessPaa spotted something even better.",
  "Fine and safe. Let me show you a bigger idea.",
];
const HMM = [
  "Hmm, that gives a little bit away.",
  "Careful — that move lets your opponent breathe easier.",
  "Not quite, my friend; there was a stronger move waiting.",
];
const CAREFUL = [
  "Whoa there! That's a slippery step.",
  "Careful, careful! Look before you hop.",
  "Oh dear — that move opens a door for your opponent.",
];
const OOPS = [
  "Oops-a-daisy! That one hurts, but that's how we learn.",
  "Ouch! Even grandmasters slip on a banana peel sometimes.",
  "Oh my whiskers! Let me show you what happened.",
];

function tierFor(loss: number, missedMate: boolean, sacrificeAndFine: boolean): Tier {
  if (missedMate && loss > 1) return "careful";
  if (sacrificeAndFine) return "brilliant";
  if (loss <= 0.08) return "great";
  if (loss <= 0.35) return "good";
  if (loss <= 0.7) return "okay";
  if (loss <= 1.4) return "hmm";
  if (loss <= 3) return "careful";
  return "oops";
}

const TIER_META: Record<Tier, { emoji: string; title: string }> = {
  brilliant: { emoji: "🌟", title: "Brilliant!" }, great: { emoji: "⭐", title: "Great move!" }, good: { emoji: "👍", title: "Good move" },
  okay: { emoji: "🙂", title: "Okay" }, hmm: { emoji: "🤔", title: "Hmm…" }, careful: { emoji: "😬", title: "Careful!" }, oops: { emoji: "🙈", title: "Oops!" },
};

/**
 * Grade a move the child just played.  Stockfish supplies the truth (best
 * move, evaluations); chess.js finds the story (hanging pieces, forks, missed
 * captures, mates); ChessPaa tells it kindly.
 */
export async function judgeMove(engine: Engine, fenBefore: string, played: Move, depth = 12): Promise<Verdict> {
  const before = new Chess(fenBefore);
  const after = new Chess(played.after);
  const mover = played.color;
  const moverIsWhite = mover === "w";
  const [evBefore, evAfter] = await Promise.all([
    engine.evaluate(fenBefore, { depth, multipv: 2 }),
    engine.evaluate(played.after, { depth, multipv: 1 }),
  ]);
  const bestLine = evBefore.lines[0];
  const bestMove = bestLine ? moveFromUci(before, bestLine.move) : null;
  // scores: convert to the mover's perspective in pawns
  const bestForMover = bestLine ? scoreToPawns(bestLine.cp, bestLine.mate, moverIsWhite) * (moverIsWhite ? 1 : -1) : 0;
  const afterLine = evAfter.lines[0];
  let afterForMover: number;
  if (after.isCheckmate()) afterForMover = 50;
  else if (after.isDraw() || after.isStalemate()) afterForMover = 0;
  else afterForMover = afterLine ? scoreToPawns(afterLine.cp, afterLine.mate, !moverIsWhite) * (moverIsWhite ? 1 : -1) : 0;
  const isBest = !!bestMove && bestMove.from === played.from && bestMove.to === played.to && (bestMove.promotion ?? "q") === (played.promotion ?? "q");
  let loss = isBest ? 0 : Math.max(0, bestForMover - afterForMover);
  if (bestForMover > 40 && afterForMover > 40) loss = 0; // still mating
  const evalAfter = afterForMover * (moverIsWhite ? 1 : -1);
  const mateIn = after.isCheckmate() ? 0 : afterLine?.mate != null ? -afterLine.mate * -1 * (1) : null; // afterLine mate is from opponent's view
  const moverMateIn = afterLine?.mate != null ? -afterLine.mate : null; // + means mover mates in N (opponent is mated)

  const facts: string[] = [];
  const showSquares: Square[] = [];
  const opp = mover === "w" ? "b" : "w";

  // --- what did the move do?
  const givesMate = after.isCheckmate();
  const hangingAfter = hangingPieces(after, mover);
  const hangingBefore = hangingPieces(before, mover);
  const newlyHanging = hangingAfter.filter((h) => !hangingBefore.some((b) => b.square === h.square && b.piece === h.piece) || h.square === played.to);
  const freeBefore = freeCaptures(before, mover);
  const missedFree = !played.captured && freeBefore.length && freeBefore[0].gain >= 3 ? freeBefore[0] : null;
  const missedMate = !!(bestLine && bestLine.mate !== null && bestLine.mate > 0 && bestLine.mate <= 3 && !givesMate && (moverMateIn === null || moverMateIn > bestLine.mate));
  const forks = forkTargets(after, played.to, mover);
  const bestForks = bestMove && !isBest ? forkTargets(new Chess(bestMove.after), bestMove.to, mover) : [];
  const oppReply = afterLine ? moveFromUci(after, afterLine.move) : null;
  const oppThreat = oppReply ? new Chess(oppReply.after) : null;
  const oppForks = oppReply ? forkTargets(oppThreat!, oppReply.to, opp) : [];
  const oppMatesSoon = afterLine?.mate != null && afterLine.mate > 0 && afterLine.mate <= 3;
  const moveNo = before.moveNumber();
  const castled = played.flags.includes("k") || played.flags.includes("q");
  const developed = (played.piece === "n" || played.piece === "b") && moveNo <= 10 && ["1", "8"].includes(played.from[1]);
  const earlyQueen = played.piece === "q" && moveNo <= 5 && developedMinors(before, mover) < 2;
  const capturedValue = played.captured ? VALUE[played.captured] : 0;
  const sacrifice = !!played.captured && VALUE[played.piece] > capturedValue + 1 && after.attackers(played.to, opp).length > 0 && loss <= 0.1 || (!played.captured && hangingAfter.some((h) => h.square === played.to && VALUE[h.piece] >= 3) && loss <= 0.1);

  const tier = tierFor(loss, missedMate, sacrifice);
  const meta = TIER_META[tier];

  // --- build the explanation
  const parts: string[] = [];
  const you = (sq: Square) => { const p = after.get(sq) ?? before.get(sq); return p ? `your ${NAME[p.type]} on ${sq}` : sq; };
  if (givesMate) {
    parts.push(pick(["CHECKMATE! You did it! The king has nowhere to run!", "Checkmate! Ring the bells, the game is yours!"]));
    facts.push("checkmate");
  } else if (tier === "brilliant") {
    parts.push(pick(PRAISE));
    if (sacrifice) { parts.push(`You gave up material on purpose — and it works! That's a real sacrifice, like a chess magician.`); facts.push("sacrifice"); }
  } else if (tier === "great") {
    parts.push(pick(PRAISE));
    if (forks.length >= 2) { parts.push(`That's a FORK — one piece attacking two at once (${forks.join(" and ")}). Like a toasting fork with two prongs!`); facts.push("fork"); showSquares.push(...forks); }
    else if (played.san.includes("+")) { parts.push("Check! The king must deal with that right away."); facts.push("check"); }
    else if (castled) { parts.push("Castling tucks the king into his cosy castle and wakes up the rook. Smart!"); facts.push("castled"); }
    else if (played.captured && !hangingAfter.some((h) => h.square === played.to)) { parts.push(`You won a ${NAME[played.captured]} for free. Yum!`); facts.push("free capture"); }
    else if (developed) { parts.push("Bringing out a new piece early — that's how strong players start every game."); facts.push("development"); }
  } else if (tier === "good") {
    parts.push(pick(GOOD));
    if (castled) { parts.push("Castling keeps the king safe. ChessPaa approves!"); facts.push("castled"); }
    else if (developed) { parts.push("A new piece joins the party — lovely development."); facts.push("development"); }
    else if (played.captured) { parts.push(`Snap! You captured a ${NAME[played.captured]}.`); }
  } else if (tier === "okay") {
    parts.push(pick(OKAY));
  } else {
    parts.push(tier === "hmm" ? pick(HMM) : tier === "careful" ? pick(CAREFUL) : pick(OOPS));
  }

  // the "why" for anything below great
  if (tier !== "great" && tier !== "brilliant" && !givesMate) {
    if (missedMate && bestMove) {
      parts.push(`There was a CHECKMATE in ${bestLine!.mate}! ${cap(describeMove(bestMove))} would have finished the game.`);
      facts.push("missed mate"); showSquares.push(bestMove.from, bestMove.to);
    } else if (newlyHanging.length) {
      const h = newlyHanging[0];
      const att = h.cheapestAttacker;
      parts.push(`Uh-oh: ${you(h.square)} is hanging — the enemy ${NAME[att]} can gobble it up${h.defenders ? " and it costs you more than you get back" : " for free"}.`);
      facts.push("hanging piece"); showSquares.push(h.square);
    } else if (missedFree) {
      parts.push(`You could have taken the ${NAME[missedFree.move.captured!]} on ${missedFree.move.to} for free! Always look for hungry captures first.`);
      facts.push("missed free capture"); showSquares.push(missedFree.move.to);
    } else if (bestForks.length >= 2 && bestMove) {
      parts.push(`${cap(describeMove(bestMove))} was a FORK: attacking ${bestForks.join(" and ")} at the same time. Two targets, one hero!`);
      facts.push("missed fork"); showSquares.push(...bestForks);
    } else if (oppMatesSoon) {
      parts.push(`Danger! Your king can be checkmated in ${afterLine!.mate}. Look at ${oppReply ? describeMove(oppReply) : "the enemy pieces near your king"}.`);
      facts.push("mate threat");
      const k = kingSquare(after, mover); if (k) showSquares.push(k);
    } else if (oppForks.length >= 2 && oppReply) {
      parts.push(`Watch out: now the enemy ${NAME[oppReply.piece]} can hop to ${oppReply.to} and fork ${oppForks.join(" and ")}.`);
      facts.push("walked into fork"); showSquares.push(oppReply.to);
    } else if (earlyQueen) {
      parts.push("The queen came out very early. She's precious — little pieces can chase her around and gain time. Knights and bishops first!");
      facts.push("early queen");
    } else if (bestMove && loss > 0.3) {
      parts.push(`ChessPaa would have played ${describeMove(bestMove)}.`);
    }
  }
  if (played.promotion) { parts.push(`A pawn became a ${NAME[played.promotion]}! That's called promotion — the pawn's dream come true.`); facts.push("promotion"); }

  const suggestion = bestMove && !isBest && !givesMate ? `Better was: ${bestMove.san} (${describeMove(bestMove)})` : "";
  return { tier, emoji: meta.emoji, title: givesMate ? "Checkmate!" : meta.title, cpLoss: loss, bestMove, played, explanation: parts.join(" "), suggestion, evalAfter, mateIn: moverMateIn, facts, showSquares };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A gentle hint for a puzzle or a game: never the answer, just where to look. */
export function hintFor(chess: Chess, solution: Move): string {
  const p = NAME[solution.piece];
  const options = [
    `Look at your ${p}. It has a big idea on the board…`,
    `Something near ${solution.to} looks tasty. Which of your pieces can get there?`,
    solution.captured ? `There's a capture waiting. Who can take the ${NAME[solution.captured]}?` : `Your ${p} wants to be brave. Where could it go?`,
    solution.san.includes("+") || solution.san.includes("#") ? `Can you give the king a fright? Think CHECK!` : `Think about what your ${p} attacks after it moves.`,
  ];
  return pick(options);
}

/** When a puzzle move is wrong, say what the correct idea achieves. */
export function wrongMoveText(chess: Chess, tried: Move, solution: Move, reply: Move | null): string {
  const bits: string[] = [];
  bits.push(pick(["Not that one, my friend.", "Close, but not quite.", "Hmm, let's rewind that."]));
  if (reply) bits.push(`If you play ${tried.san}, your opponent answers ${reply.san} (${describeMove(reply)}) and the magic fizzles.`);
  bits.push(`Try again — think about your ${NAME[solution.piece]}.`);
  return bits.join(" ");
}

export function evalToSmile(evalWhite: number, forWhite: boolean): number {
  const v = forWhite ? evalWhite : -evalWhite;
  return 1 / (1 + Math.exp(-v * 0.8)); // 0..1
}
