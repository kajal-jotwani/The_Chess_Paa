"use client";

/**
 * MOTIFS — the part of ChessPaa that actually *sees* the board.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Stockfish tells us a move was worth 1.4 pawns less than the best one. That
 * is true, and it is completely useless to a six-year-old. What a child needs
 * is the *shape*: "your horse and your castle are standing on the same little
 * road, and her bishop is looking straight down it."
 *
 * So: the engine supplies the verdict, this file supplies the NOUN. Everything
 * here is derived from attack maps, ray geometry and a real static exchange
 * evaluation — never from a hunch.
 *
 * THE HONESTY RULE
 * ----------------
 * A false "that's a fork!" is worse than saying nothing at all: a child who is
 * told they found a tactic that isn't there learns to distrust the grandpa. So
 * every detector below is deliberately conservative, every claim carries a
 * `confidence`, and the tutor bins anything under ~0.6. Where a heuristic can
 * only be approximate (SEE ignores pins, for instance) we cross-check the
 * claim against a *legal* move before we let ChessPaa say it.
 *
 * WHY THE LITTLE Uint8Array BOARD
 * -------------------------------
 * The first cut of this file asked chess.js for everything and took 300-500ms
 * per move, because every SEE probe round-tripped a FEN string through a fresh
 * Chess object. Attack maps and swap-offs are pure arithmetic, so they live on
 * a 64-byte board here; chess.js stays the sole authority on *legality*
 * (what moves exist, what is check, what is mate) where being exactly right
 * matters more than being fast. A full scan is now ~2-4ms.
 */

import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";

/* ================================================================== *
 * VOCABULARY
 * ================================================================== */

export type MotifKind =
  | "fork"
  | "pin"
  | "skewer"
  | "discoveredAttack"
  | "hanging"
  | "mateThreat"
  | "backRank"
  | "trapped"
  | "overloaded";

/**
 * Where the motif came from, relative to the move that was just played.
 *  - "played"  the mover created it (praise material)
 *  - "threat"  the mover is now on the receiving end of it (warning material)
 *  - "missed"  it was available before the move and the move walked past it
 */
export type MotifSource = "played" | "threat" | "missed";

export interface Motif {
  kind: MotifKind;
  /** Squares to light up, most important first (the tutor anchors on squares[0]). */
  squares: string[];
  /** Plain English piece names, index-aligned with `squares` where it makes sense. */
  pieces: string[];
  /** Material at stake IN PAWNS, positive = good for `forSide`. Kid-facing, so pawns not centipawns. */
  value?: number;
  /** Which colour this motif is good news for. */
  forSide: Color;
  source: MotifSource;
  /** 0..1. Under 0.6 ChessPaa keeps his mouth shut. */
  confidence: number;
  /** The square the motif radiates from (the forking knight, the pinning bishop…). */
  from?: string;
  /** The things being hit. */
  targets?: string[];
  /** Machine-readable flavour: "check-fork" | "absolute" | "mate-now" | "just-moved" … */
  detail?: string;
  /** If the motif is only reachable by playing a specific move, that move in UCI. */
  via?: string;
}

export const PIECE_CP: Record<PieceSymbol, number> = {
  p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000,
};

export const PIECE_NAME: Record<PieceSymbol, string> = {
  p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king",
};

const FILES = "abcdefgh";

function other(c: Color): Color {
  return c === "w" ? "b" : "w";
}

/* ================================================================== *
 * THE LITTLE BOARD
 *
 * index = rank * 8 + file, so index 0 is a1 and 63 is h8.
 * cell   = 0 for empty, else (colourBit | typeCode).
 * ================================================================== */

type Bd = Uint8Array;

const T = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 } as const;
const WHITE_BIT = 8;
const BLACK_BIT = 16;
const COLOUR_MASK = 24;
const TYPE_MASK = 7;

/** typeCode -> PieceSymbol, index 0 unused. */
const TYPE_OF: PieceSymbol[] = ["p", "p", "n", "b", "r", "q", "k"];
/** typeCode -> centipawns. */
const CP_OF = [0, 100, 320, 330, 500, 900, 20000];

function bit(c: Color): number {
  return c === "w" ? WHITE_BIT : BLACK_BIT;
}
function cellType(v: number): PieceSymbol {
  return TYPE_OF[v & TYPE_MASK];
}
function cellColour(v: number): Color {
  return (v & WHITE_BIT) !== 0 ? "w" : "b";
}
function idx(f: number, r: number): number {
  return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f;
}
function algebraic(i: number): Square {
  return (FILES[i & 7] + String((i >> 3) + 1)) as Square;
}
function indexOfSquare(s: string): number {
  return idx(FILES.indexOf(s[0]), Number(s[1]) - 1);
}

/** Parse only the placement field of a FEN — the rest is chess.js's business. */
function fenToBd(fen: string): Bd {
  const bd = new Uint8Array(64);
  const rows = fen.split(" ")[0].split("/");
  for (let ri = 0; ri < 8 && ri < rows.length; ri++) {
    const r = 7 - ri; // FEN starts at rank 8
    let f = 0;
    for (const ch of rows[ri]) {
      if (ch >= "1" && ch <= "8") { f += Number(ch); continue; }
      const lower = ch.toLowerCase() as PieceSymbol;
      const code = T[lower as keyof typeof T];
      if (code && f < 8) bd[r * 8 + f] = (ch === lower ? BLACK_BIT : WHITE_BIT) | code;
      f++;
    }
  }
  return bd;
}

const KNIGHT_HOPS: Array<[number, number]> = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_STEPS: Array<[number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
/** [df, dr, isDiagonal] */
const RAY_DIRS: Array<[number, number, boolean]> = [
  [1, 1, true], [1, -1, true], [-1, 1, true], [-1, -1, true],
  [1, 0, false], [-1, 0, false], [0, 1, false], [0, -1, false],
];

/**
 * Every piece of `colour` that hits square `i`. Raw attack map: pins are
 * ignored on purpose (a pinned defender still deters a king, and callers that
 * need legality ask chess.js instead).
 */
function attackersTo(bd: Bd, i: number, colour: Color): number[] {
  const f = i & 7, r = i >> 3;
  const cb = bit(colour);
  const res: number[] = [];

  // Pawns: a white pawn attacking upward stands one rank BELOW the square.
  const pr = colour === "w" ? r - 1 : r + 1;
  for (const df of [-1, 1]) {
    const j = idx(f + df, pr);
    if (j >= 0 && bd[j] === (cb | T.p)) res.push(j);
  }
  for (const [df, dr] of KNIGHT_HOPS) {
    const j = idx(f + df, r + dr);
    if (j >= 0 && bd[j] === (cb | T.n)) res.push(j);
  }
  for (const [df, dr] of KING_STEPS) {
    const j = idx(f + df, r + dr);
    if (j >= 0 && bd[j] === (cb | T.k)) res.push(j);
  }
  for (const [df, dr, diag] of RAY_DIRS) {
    let ff = f + df, rr = r + dr;
    for (;;) {
      const j = idx(ff, rr);
      if (j < 0) break;
      const v = bd[j];
      if (v !== 0) {
        if ((v & COLOUR_MASK) === cb) {
          const t = v & TYPE_MASK;
          if (t === T.q || (diag ? t === T.b : t === T.r)) res.push(j);
        }
        break;
      }
      ff += df; rr += dr;
    }
  }
  return res;
}

function isAttackedBd(bd: Bd, i: number, colour: Color): boolean {
  return attackersTo(bd, i, colour).length > 0;
}

/** Squares of pieces of `i`'s own colour that cover it (never the piece itself). */
function defendersBd(bd: Bd, i: number): number[] {
  const v = bd[i];
  if (!v) return [];
  return attackersTo(bd, i, cellColour(v));
}

function leastValuableAttacker(bd: Bd, i: number, colour: Color): number {
  let best = -1;
  let bestCp = Infinity;
  for (const a of attackersTo(bd, i, colour)) {
    const cp = CP_OF[bd[a] & TYPE_MASK];
    if (cp < bestCp) { bestCp = cp; best = a; }
  }
  return best;
}

/* ================================================================== *
 * STATIC EXCHANGE EVALUATION
 *
 * WHY: "is that piece hanging?" is the single most useful question in
 * beginner chess, and counting attackers vs defenders gets it wrong all the
 * time (Q takes defended pawn "wins" a pawn by the count and loses eight by
 * the swap). So we play the whole capture sequence out.
 *
 * The x-ray trick: we never place the capturing piece on the target square,
 * we only REMOVE it from its origin and re-ask for the attackers. Attack rays
 * terminate *at* the target square, so its occupancy is irrelevant — and
 * removing the front piece automatically reveals the rook behind it.
 * ================================================================== */

function seeOn(source: Bd, target: number, side: Color): number {
  const occ = source[target];
  if (!occ || cellColour(occ) === side) return 0;

  const bd = source.slice();
  /**
   * The swap list. w[0] is the piece already standing on the square; w[k] is
   * the piece that makes the k-th capture and is therefore standing there
   * when capture k+1 lands. Building it forwards, then folding it backwards,
   * is longer than the classic in-place trick and enormously easier to prove
   * right — which matters, because a wrong sign here is ChessPaa telling a
   * child their good move hung a piece.
   */
  const w: number[] = [CP_OF[occ & TYPE_MASK]];
  let stm: Color = side;
  for (let guard = 0; guard < 32; guard++) {
    const a = leastValuableAttacker(bd, target, stm);
    if (a < 0) break;
    // A king may only take the last piece standing — never capture into cover.
    if ((bd[a] & TYPE_MASK) === T.k && isAttackedBd(bd, target, other(stm))) break;
    w.push(CP_OF[bd[a] & TYPE_MASK]);
    bd[a] = 0;              // removing it re-reveals any x-ray behind it
    stm = other(stm);
  }

  const n = w.length - 1;   // how many captures are actually available
  if (n === 0) return 0;    // nobody can take it at all, so nothing is won

  // Walk the sequence backwards. At each step the side to capture may simply
  // decline (hence max(0, …)) — except the very first capture, which is the
  // one we are asking about and is therefore forced.
  let gain = 0;
  for (let k = n; k >= 2; k--) gain = Math.max(0, w[k - 1] - gain);
  return w[0] - gain;
}

/**
 * Centipawns won by `side` if they start a capture sequence on `target` and
 * both sides then capture optimally. Positive = the capture wins material.
 *
 * Approximate in exactly one way: the attack map includes pinned pieces, so a
 * defender that cannot legally recapture is still counted. That bias is
 * *toward silence* (we under-claim hanging pieces), which is the right side
 * of the line to be on.
 */
export function seeCapture(fen: string, target: string, side: Color): number {
  const i = indexOfSquare(target);
  if (i < 0) return 0;
  return seeOn(fenToBd(fen), i, side);
}

/** Slide one piece on a scratch board — enough for "would it be safe over there?". */
function bdAfterMove(bd: Bd, from: number, to: number): Bd {
  const nb = bd.slice();
  nb[to] = nb[from];
  nb[from] = 0;
  return nb;
}

/* ================================================================== *
 * POSITION HANDLE — one FEN parsed once, shared by every detector.
 * ================================================================== */

interface Pos {
  fen: string;
  bd: Bd;
  turn: Color;
  /** chess.js, built lazily: only legality questions need it. */
  chess(): Chess;
  /** Legal moves for the side to move, computed once. SAN already carries +/#. */
  legal(): Move[];
  pieces(colour?: Color): Array<{ i: number; sq: Square; type: PieceSymbol; colour: Color }>;
}

function makePos(fen: string): Pos | null {
  let bd: Bd;
  try { bd = fenToBd(fen); } catch { return null; }
  const turn: Color = fen.split(" ")[1] === "b" ? "b" : "w";
  let chessCache: Chess | null = null;
  let legalCache: Move[] | null = null;
  let pieceCache: Array<{ i: number; sq: Square; type: PieceSymbol; colour: Color }> | null = null;
  return {
    fen,
    bd,
    turn,
    chess() {
      if (!chessCache) chessCache = new Chess(fen, { skipValidation: true });
      return chessCache;
    },
    legal() {
      if (!legalCache) {
        try { legalCache = this.chess().moves({ verbose: true }) as Move[]; }
        catch { legalCache = []; }
      }
      return legalCache;
    },
    pieces(colour?: Color) {
      if (!pieceCache) {
        const out: Array<{ i: number; sq: Square; type: PieceSymbol; colour: Color }> = [];
        for (let i = 0; i < 64; i++) {
          const v = bd[i];
          if (v) out.push({ i, sq: algebraic(i), type: cellType(v), colour: cellColour(v) });
        }
        pieceCache = out;
      }
      return colour ? pieceCache.filter((p) => p.colour === colour) : pieceCache;
    },
  };
}

/**
 * Turn-flip a FEN so we can ask "what could the OTHER side do if it were
 * their move?" — the null-move trick that powers threat detection.
 *
 * Returns null when the flip would produce nonsense (either king ends up
 * capturable while not to move). Refusing here is what stops ChessPaa
 * inventing threats out of illegal air.
 */
export function flipTurn(fen: string): string | null {
  const parts = fen.split(" ");
  if (parts.length < 4) return null;
  const bd = fenToBd(fen);
  const stm: Color = parts[1] === "b" ? "b" : "w";
  const kings: Partial<Record<Color, number>> = {};
  for (let i = 0; i < 64; i++) {
    const v = bd[i];
    if (v && (v & TYPE_MASK) === T.k) kings[cellColour(v)] = i;
  }
  const mine = kings[stm], theirs = kings[other(stm)];
  if (mine === undefined || theirs === undefined) return null;
  // Side to move already in check: they must answer, a null move is a lie.
  if (isAttackedBd(bd, mine, other(stm))) return null;
  // Waiting side in check: the position was illegal to begin with.
  if (isAttackedBd(bd, theirs, stm)) return null;
  parts[1] = stm === "w" ? "b" : "w";
  parts[3] = "-";  // en-passant rights never survive a null move
  parts[4] = "0";
  return parts.join(" ");
}

/* ================================================================== *
 * MATE IN ONE
 *
 * chess.js already computes the '#' suffix while building SAN for every legal
 * move, so a whole mate-in-one sweep costs exactly one move generation.
 * Memoised because the tutor asks about the same FEN from three directions.
 * ================================================================== */

export interface MateInOne { uci: string; san: string; to: Square; from: Square; piece: PieceSymbol }

const mateCache = new Map<string, MateInOne | null>();

/**
 * Reuses the caller's already-generated move list. Move generation is by far
 * the most expensive thing this file does, so every detector that needs it
 * shares one Pos rather than re-parsing the FEN.
 */
function findMateInPos(pos: Pos): MateInOne | null {
  const hit = mateCache.get(pos.fen);
  if (hit !== undefined) return hit;
  let found: MateInOne | null = null;
  for (const m of pos.legal()) {
    if (m.san.endsWith("#")) {
      found = { uci: m.from + m.to + (m.promotion ?? ""), san: m.san, to: m.to, from: m.from, piece: m.piece };
      break;
    }
  }
  if (mateCache.size > 400) mateCache.clear();
  mateCache.set(pos.fen, found);
  return found;
}

export function findMateInOne(fen: string): MateInOne | null {
  const hit = mateCache.get(fen);
  if (hit !== undefined) return hit;
  const pos = makePos(fen);
  return pos ? findMateInPos(pos) : null;
}

/**
 * FORCED MATE IN TWO, after a check.
 *
 * WHY THIS EXISTS: the "are we threatening mate?" test elsewhere in this file
 * is a null move, and a null move is illegal while the opponent is in check —
 * which is precisely the moment a mating attack looks most like a disaster.
 * A queen that lands with check and can be captured reads to every board-only
 * heuristic as a hung queen, so without this ChessPaa tells a child that
 * Morphy's Qb8+ was careless.
 *
 * The definition is exact and needs no engine: it is mate in two iff every
 * legal reply allows mate in one.
 *
 * Deliberately narrowed to the case where the opponent has exactly ONE legal
 * answer. That is both the cheapest (one extra movegen) and the only case
 * where we can honestly hand the caller a mating move to draw — with two
 * defences the mate exists but the finishing move differs per line, and an
 * arrow pointing at one of them would be a lie dressed as help.
 */
function forcedMateInTwo(pos: Pos): MateInOne | null {
  const replies = pos.legal();
  if (replies.length !== 1) return null;
  const r = replies[0];
  const board = pos.chess();
  let next: Pos | null = null;
  try {
    board.move({ from: r.from, to: r.to, promotion: r.promotion });
    next = makePos(board.fen());
  } catch {
    return null;
  } finally {
    try { board.undo(); } catch { /* the shared handle stays usable either way */ }
  }
  return next ? findMateInPos(next) : null;
}

/** True when the side to move has been checkmated (no legal moves + in check). */
function isMated(pos: Pos): boolean {
  if (pos.legal().length > 0) return false;
  try { return pos.chess().inCheck(); } catch { return false; }
}

/* ================================================================== *
 * HANGING PIECES
 * ================================================================== */

/**
 * Is the piece on `sq` genuinely losable *right now*?
 *
 * Two independent tests must both agree, because either alone lies:
 *  1. SEE says the capture wins material, AND
 *  2. the capture is an actually LEGAL move for the side to move.
 * Test 2 kills the classic false alarm "your queen is hanging!" when the only
 * attacker is pinned to its own king.
 */
export function isHanging(fen: string, sq: string): { losing: number; by: Square } | null {
  const pos = makePos(fen);
  if (!pos) return null;
  const i = indexOfSquare(sq);
  if (i < 0 || !pos.bd[i]) return null;
  const victim = cellColour(pos.bd[i]);
  if (pos.turn === victim) return null; // only claim danger the opponent can act on now
  const cp = seeOn(pos.bd, i, pos.turn);
  if (cp < 100) return null;            // under a whole pawn is not worth frightening a child about
  for (const m of pos.legal()) if (m.to === sq && m.captured) return { losing: cp, by: m.from };
  return null;
}

function hangingFor(pos: Pos, victim: Color, source: MotifSource, justMovedTo?: string): Motif[] {
  if (pos.turn === victim) return []; // only the side about to be hit is in danger
  const takers = new Map<string, Square>();
  for (const m of pos.legal()) if (m.captured && !takers.has(m.to)) takers.set(m.to, m.from);

  const out: Motif[] = [];
  for (const p of pos.pieces(victim)) {
    if (p.type === "k") continue;
    const by = takers.get(p.sq);
    if (!by) continue;
    const cp = seeOn(pos.bd, p.i, pos.turn);
    if (cp < 100) continue;
    const takerCell = pos.bd[indexOfSquare(by)];
    const fresh = justMovedTo === p.sq;
    out.push({
      kind: "hanging",
      squares: [p.sq, by],
      pieces: [PIECE_NAME[p.type], PIECE_NAME[cellType(takerCell)]],
      value: Math.round(cp / 10) / 10,
      forSide: other(victim),
      source,
      // A piece we JUST put there is the clearest, kindest thing to point at:
      // the child can draw a straight line from their own hand to the result.
      confidence: fresh ? 0.97 : 0.9,
      // from -> targets[0] is attacker -> victim for every motif kind, so a
      // caller can draw one arrow without knowing which motif it has.
      from: by,
      targets: [p.sq],
      detail: fresh ? "just-moved" : "left-behind",
    });
  }
  return out;
}

/* ================================================================== *
 * LINE GEOMETRY — pins and skewers are the same picture, read from
 * opposite ends.
 * ================================================================== */

interface LineTriple {
  slider: number; sliderType: PieceSymbol;
  front: number; frontType: PieceSymbol;
  back: number; backType: PieceSymbol;
}

function raysFor(p: PieceSymbol): Array<[number, number, boolean]> {
  if (p === "b") return RAY_DIRS.filter((d) => d[2]);
  if (p === "r") return RAY_DIRS.filter((d) => !d[2]);
  if (p === "q") return RAY_DIRS;
  return [];
}

/**
 * Every (slider, first victim, second victim) triple on a clear ray. This is
 * the raw material for both pins and skewers: which one it is depends purely
 * on which of the two victims is worth more.
 */
function scanLines(pos: Pos, attacker: Color): LineTriple[] {
  const out: LineTriple[] = [];
  const victimColour = other(attacker);
  const vb = bit(victimColour);
  for (const s of pos.pieces(attacker)) {
    const dirs = raysFor(s.type);
    if (dirs.length === 0) continue;
    for (const [df, dr] of dirs) {
      let f = (s.i & 7) + df, r = (s.i >> 3) + dr;
      let front = -1;
      for (;;) {
        const j = idx(f, r);
        if (j < 0) break;
        const v = pos.bd[j];
        if (v !== 0) {
          if (front < 0) {
            if ((v & COLOUR_MASK) !== vb) break; // our own piece blocks the idea
            front = j;
          } else {
            if ((v & COLOUR_MASK) === vb) {
              out.push({
                slider: s.i, sliderType: s.type,
                front, frontType: cellType(pos.bd[front]),
                back: j, backType: cellType(v),
              });
            }
            break;
          }
        }
        f += df; r += dr;
      }
    }
  }
  return out;
}

function pinsAndSkewers(pos: Pos, attacker: Color, source: MotifSource): Motif[] {
  const out: Motif[] = [];
  const victimColour = other(attacker);
  // Computed once, lazily, and only when a king actually turns up in front of
  // a line — see the royal-skewer branch below for why it is the whole claim.
  let forcedAside: boolean | null = null;
  const kingMustStepAside = () => {
    if (forcedAside === null) {
      forcedAside =
        pos.turn === victimColour &&
        pos.legal().length > 0 &&
        pos.legal().every((m) => m.piece === "k");
    }
    return forcedAside;
  };
  for (const t of scanLines(pos, attacker)) {
    const frontCp = CP_OF[T[t.frontType as keyof typeof T]];
    const backCp = CP_OF[T[t.backType as keyof typeof T]];
    const sliderCp = CP_OF[T[t.sliderType as keyof typeof T]];
    const frontSq = algebraic(t.front);
    const backSq = algebraic(t.back);
    const sliderSq = algebraic(t.slider);

    if (t.backType === "k") {
      // ABSOLUTE PIN — the front piece is nailed by law and may not move.
      // A pinned PAWN is technically a pin and almost never a lesson, so we
      // only mention it when the pin is actually doing work (more attackers
      // than defenders, i.e. the thing can really be won).
      const worthSaying =
        frontCp >= 300 ||
        attackersTo(pos.bd, t.front, attacker).length > defendersBd(pos.bd, t.front).length;
      if (worthSaying) {
        out.push({
          kind: "pin",
          squares: [frontSq, sliderSq, backSq],
          pieces: [PIECE_NAME[t.frontType], PIECE_NAME[t.sliderType], "king"],
          value: Math.round(frontCp / 10) / 10,
          forSide: attacker,
          source,
          confidence: 0.95,
          from: sliderSq,
          targets: [frontSq],
          detail: "absolute",
        });
      }
    } else if (backCp > frontCp + 50 && sliderCp <= backCp && frontCp >= 300) {
      // RELATIVE PIN — moving the front piece is legal but expensive.
      const frontDefended = defendersBd(pos.bd, t.front).length > 0;
      out.push({
        kind: "pin",
        squares: [frontSq, sliderSq, backSq],
        pieces: [PIECE_NAME[t.frontType], PIECE_NAME[t.sliderType], PIECE_NAME[t.backType]],
        value: Math.round((backCp - frontCp) / 10) / 10,
        forSide: attacker,
        source,
        confidence: frontDefended ? 0.62 : 0.78,
        from: sliderSq,
        targets: [frontSq],
        detail: "relative",
      });
    }

    if (t.frontType === "k") {
      // SKEWER through the king: it MUST step aside and the piece behind falls.
      //
      // "Must" is the entire claim, and the geometry alone does not establish
      // it: a check can also be answered by capturing the checker or blocking
      // the line, and then the king never moves and the piece behind is never
      // collected. (Morphy's Qb8+ in the Opera Game is exactly this shape and
      // Black's only legal reply is Nxb8 — calling it a skewer to a child is a
      // false chess claim about the most famous move in the game.)
      //
      // So we ask chess.js: it must be the victim's move, and EVERY legal
      // answer must be a king move. That is one already-memoised movegen, and
      // it turns a guess into a fact.
      if (backCp >= 300 && kingMustStepAside()) {
        out.push({
          kind: "skewer",
          squares: [frontSq, backSq, sliderSq],
          pieces: ["king", PIECE_NAME[t.backType], PIECE_NAME[t.sliderType]],
          value: Math.round(backCp / 10) / 10,
          forSide: attacker,
          source,
          confidence: 0.86,
          from: sliderSq,
          targets: [backSq],
          detail: "royal",
        });
      }
    } else if (frontCp > backCp + 50 && backCp >= 300 && sliderCp < frontCp) {
      // Ordinary skewer: something big in front, something useful behind, and
      // our slider is cheaper than the piece it chases (or nobody has to move).
      out.push({
        kind: "skewer",
        squares: [frontSq, backSq, sliderSq],
        pieces: [PIECE_NAME[t.frontType], PIECE_NAME[t.backType], PIECE_NAME[t.sliderType]],
        value: Math.round(backCp / 10) / 10,
        forSide: attacker,
        source,
        confidence: 0.7,
        from: sliderSq,
        targets: [backSq],
        detail: "plain",
      });
    }
  }
  return out;
}

/* ================================================================== *
 * FORKS
 * ================================================================== */

/**
 * A fork is only a fork if the forking piece SURVIVES and the targets can't
 * both walk away. Three things a naive detector skips:
 *  - the forker must not be simply capturable for profit,
 *  - each target must be the king, undefended, or worth more than the forker,
 *  - at least two must survive that filter.
 */
function forkFrom(bd: Bd, i: number, source: MotifSource, via?: string): Motif | null {
  const v = bd[i];
  if (!v) return null;
  const me = cellColour(v);
  const them = other(me);
  const type = cellType(v);
  const forkerCp = CP_OF[v & TYPE_MASK];

  const targets: Array<{ i: number; type: PieceSymbol }> = [];
  for (let j = 0; j < 64; j++) {
    const e = bd[j];
    if (!e || cellColour(e) !== them) continue;
    if (attackersTo(bd, j, me).includes(i)) targets.push({ i: j, type: cellType(e) });
  }
  if (targets.length < 2) return null;

  const worth = targets.filter((t) => {
    if (t.type === "k") return true;
    if (CP_OF[T[t.type as keyof typeof T]] > forkerCp + 40) return true;
    return defendersBd(bd, t.i).length === 0;
  });
  if (worth.length < 2) return null;

  // Is the forker itself just food? Swap it off from the victim's side.
  const counterCp = seeOn(bd, i, them);
  if (counterCp >= 150) return null; // that's not a fork, that's a donation

  const hitsKing = worth.some((t) => t.type === "k");
  const spoils = worth
    .filter((t) => t.type !== "k")
    .map((t) => CP_OF[T[t.type as keyof typeof T]])
    .sort((a, b) => b - a);
  const prize = hitsKing ? (spoils[0] ?? 0) : (spoils[1] ?? 0);
  if (prize < 100) return null; // forking two pawns you can't take isn't news

  // Confidence: a check-fork cannot be answered by moving one target away, so
  // it is nearly always real. A quiet double attack hands the opponent a free
  // tempo to rescue one of the two, so we claim it more softly.
  let confidence = hitsKing ? 0.93 : 0.66;
  if (!hitsKing && worth.length >= 3) confidence = 0.78;
  if (counterCp > 0) confidence -= 0.12;

  return {
    kind: "fork",
    squares: [algebraic(i), ...worth.map((t) => algebraic(t.i))],
    pieces: [PIECE_NAME[type], ...worth.map((t) => PIECE_NAME[t.type])],
    value: Math.round(prize / 10) / 10,
    forSide: me,
    source,
    confidence: Math.max(0, Math.min(1, confidence)),
    from: algebraic(i),
    targets: worth.map((t) => algebraic(t.i)),
    detail: hitsKing ? "check-fork" : "double-attack",
    via,
  };
}

/** Every fork that exists on the board right now, for one colour. */
function allForks(pos: Pos, me: Color, source: MotifSource): Motif[] {
  const out: Motif[] = [];
  for (const p of pos.pieces(me)) {
    const m = forkFrom(pos.bd, p.i, source);
    if (m) out.push(m);
  }
  return out;
}

/**
 * Forks that are one move AWAY.
 *
 * This is the detector that actually matters for warning a child, and the
 * first cut of this file didn't have it: a fork that already exists on the
 * board has usually just been played, whereas the fork that is *coming* is
 * the one they can still prevent. "Careful — my knight can hop to c7 and hit
 * two things" is the whole point of a grandfather watching over your shoulder.
 *
 * Confidence is scaled down because the victim gets a full move to stop it.
 */
function forkThreats(pos: Pos, me: Color, source: MotifSource, limit = 2): Motif[] {
  if (pos.turn !== me) return [];
  const found: Motif[] = [];
  for (const m of pos.legal()) {
    // Castling moves two pieces; the king forks nothing worth mentioning.
    if (m.isKingsideCastle() || m.isQueensideCastle()) continue;
    const fromI = indexOfSquare(m.from);
    const toI = indexOfSquare(m.to);
    if (fromI < 0 || toI < 0) continue;
    const nb = bdAfterMove(pos.bd, fromI, toI);
    if (m.promotion) nb[toI] = bit(me) | T[m.promotion as keyof typeof T];
    const fork = forkFrom(nb, toI, source, m.from + m.to + (m.promotion ?? ""));
    if (!fork) continue;
    found.push({
      ...fork,
      confidence: fork.confidence * 0.85,
      detail: fork.detail === "check-fork" ? "check-fork-threat" : "fork-threat",
      squares: [m.to, ...(fork.targets ?? [])],
    });
  }
  return found
    .sort((a, b) => motifImportance(b) - motifImportance(a))
    .slice(0, limit);
}

/* ================================================================== *
 * DISCOVERED ATTACKS
 *
 * Rigorously verifiable, which is rare and lovely: the line was blocked
 * BEFORE and is open AFTER, and the piece that unblocked it is the one that
 * moved. No heuristics required.
 * ================================================================== */

function discoveredAttacks(before: Pos, after: Pos, from: string, to: string, me: Color): Motif[] {
  const out: Motif[] = [];
  const them = other(me);
  const fromI = indexOfSquare(from);
  const toI = indexOfSquare(to);
  if (fromI < 0 || toI < 0) return out;

  for (const enemy of after.pieces(them)) {
    const nowAtk = attackersTo(after.bd, enemy.i, me);
    if (nowAtk.length === 0) continue;
    const wasAtk = attackersTo(before.bd, enemy.i, me);
    for (const a of nowAtk) {
      if (a === toI) continue;              // that's the moved piece itself, not a discovery
      if (wasAtk.includes(a)) continue;     // it already had this in its sights
      const t = cellType(after.bd[a]);
      if (t !== "b" && t !== "r" && t !== "q") continue;
      // The vacated square must lie strictly between slider and target, else
      // the new attack came from somewhere else entirely.
      if (!isBetween(a, fromI, enemy.i)) continue;

      const royal = enemy.type === "k";
      const undefended = defendersBd(after.bd, enemy.i).length === 0;
      const bigger = CP_OF[T[enemy.type as keyof typeof T]] > CP_OF[T[t as keyof typeof T]] + 40;
      if (!royal && !undefended && !bigger) continue;

      out.push({
        kind: "discoveredAttack",
        squares: [algebraic(a), from, enemy.sq],
        pieces: [PIECE_NAME[t], PIECE_NAME[enemy.type]],
        value: royal ? 0 : Math.round(CP_OF[T[enemy.type as keyof typeof T]] / 10) / 10,
        forSide: me,
        source: "played",
        confidence: royal ? 0.95 : 0.82,
        from: algebraic(a),
        targets: [enemy.sq],
        detail: royal ? "discovered-check" : "discovered-attack",
      });
    }
  }
  return out;
}

/** Is `mid` strictly on the straight line between `a` and `b`? */
function isBetween(a: number, mid: number, b: number): boolean {
  const af = a & 7, ar = a >> 3, bf = b & 7, br = b >> 3;
  const straight = af === bf || ar === br || Math.abs(bf - af) === Math.abs(br - ar);
  if (!straight) return false;
  const df = Math.sign(bf - af), dr = Math.sign(br - ar);
  let f = af + df, r = ar + dr;
  while (f !== bf || r !== br) {
    const j = idx(f, r);
    if (j < 0) return false;
    if (j === mid) return true;
    f += df; r += dr;
  }
  return false;
}

/* ================================================================== *
 * BACK RANK
 * ================================================================== */

/**
 * The king is home, its little pawn duvet is tucked in on every side, and the
 * enemy owns a rook or queen. On its own that is only a *weakness* — we
 * upgrade it to a real warning when the mate actually exists on that rank.
 */
function backRankWeakness(pos: Pos, victim: Color, source: MotifSource, mate: MateInOne | null): Motif | null {
  const enemy = other(victim);
  const homeRank = victim === "w" ? 0 : 7;
  let kingI = -1;
  let heavies = 0;
  for (const p of pos.pieces()) {
    if (p.type === "k" && p.colour === victim) kingI = p.i;
    if (p.colour === enemy && (p.type === "r" || p.type === "q")) heavies++;
  }
  if (kingI < 0 || heavies === 0) return null;
  if ((kingI >> 3) !== homeRank) return null;

  const kf = kingI & 7;
  const forward = victim === "w" ? 1 : -1;
  let openHatch = false;
  for (let df = -1; df <= 1; df++) {
    const j = idx(kf + df, homeRank + forward);
    if (j < 0) continue;
    const v = pos.bd[j];
    if (v && cellColour(v) === victim) continue;      // blocked by our own duvet
    if (!isAttackedBd(pos.bd, j, enemy)) { openHatch = true; break; }
  }

  const mateOnRank = !!mate && (indexOfSquare(mate.to) >> 3) === homeRank && (mate.piece === "r" || mate.piece === "q");
  if (openHatch && !mateOnRank) return null;

  // A concrete way in: an empty square on the home rank already covered by an
  // enemy rook or queen.
  let entry: string | null = null;
  for (let f = 0; f < 8; f++) {
    const j = idx(f, homeRank);
    if (j < 0 || pos.bd[j]) continue;
    const heavy = attackersTo(pos.bd, j, enemy).some((a) => {
      const t = pos.bd[a] & TYPE_MASK;
      return t === T.r || t === T.q;
    });
    if (heavy) { entry = algebraic(j); break; }
  }
  if (!entry && !mateOnRank) return null;

  return {
    kind: "backRank",
    squares: mateOnRank && mate ? [algebraic(kingI), mate.to] : [algebraic(kingI), ...(entry ? [entry] : [])],
    pieces: ["king", "rook"],
    forSide: enemy,
    source,
    confidence: mateOnRank ? 0.97 : 0.68,
    from: entry ?? algebraic(kingI),
    targets: [algebraic(kingI)],
    detail: mateOnRank ? "mate-now" : "weakness",
    via: mateOnRank && mate ? mate.uci : undefined,
  };
}

/* ================================================================== *
 * TRAPPED PIECES
 * ================================================================== */

/**
 * Trapped: the piece is attacked, standing still loses it, and every square it
 * can run to loses it too. Needs it to be that colour's move, so callers hand
 * us a (possibly turn-flipped) FEN.
 *
 * This is the "your bishop grabbed the h2 pawn and now it can never come home"
 * lesson, which is one of the most common ways a beginner's game quietly dies.
 */
function trappedPieces(pos: Pos, me: Color, source: MotifSource): Motif[] {
  if (pos.turn !== me) return [];
  const them = other(me);
  const out: Motif[] = [];

  // Bucket the legal moves once, by origin square.
  const byFrom = new Map<string, Move[]>();
  for (const m of pos.legal()) {
    const list = byFrom.get(m.from);
    if (list) list.push(m); else byFrom.set(m.from, [m]);
  }

  for (const p of pos.pieces(me)) {
    if (p.type === "p" || p.type === "k") continue;
    if (!isAttackedBd(pos.bd, p.i, them)) continue;
    // Staying put must already be losing, otherwise it isn't trapped, it's fine.
    if (seeOn(pos.bd, p.i, them) < 100) continue;

    const moves = byFrom.get(p.sq);
    if (!moves || moves.length === 0) continue;

    let escaped = false;
    for (const m of moves) {
      const toI = indexOfSquare(m.to);
      if (toI < 0) continue;
      const nb = bdAfterMove(pos.bd, p.i, toI);
      const gained = m.captured ? CP_OF[T[m.captured as keyof typeof T]] : 0;
      const lost = seeOn(nb, toI, them);
      // Running somewhere survivable, or grabbing enough on the way out, both count.
      if (gained - Math.max(0, lost) > -150) { escaped = true; break; }
    }
    if (escaped) continue;

    out.push({
      kind: "trapped",
      squares: [p.sq],
      pieces: [PIECE_NAME[p.type]],
      value: Math.round(CP_OF[T[p.type as keyof typeof T]] / 10) / 10,
      forSide: them,
      source,
      confidence: 0.72,
      from: p.sq,
      targets: [p.sq],
      detail: "no-way-home",
    });
  }
  return out;
}

/* ================================================================== *
 * OVERLOADED DEFENDERS
 * ================================================================== */

/**
 * One defender is the ONLY thing holding up two different pieces, so whichever
 * one it saves, the other falls. Verified by deleting the defender from a
 * scratch board and re-running SEE on both of its charges.
 */
function overloadedDefenders(pos: Pos, me: Color, source: MotifSource): Motif[] {
  const them = other(me);
  const duties = new Map<number, number[]>();

  for (const p of pos.pieces(me)) {
    if (p.type === "k") continue;
    if (!isAttackedBd(pos.bd, p.i, them)) continue;
    const defs = defendersBd(pos.bd, p.i);
    if (defs.length !== 1) continue;
    const list = duties.get(defs[0]);
    if (list) list.push(p.i); else duties.set(defs[0], [p.i]);
  }

  const out: Motif[] = [];
  for (const [defender, charges] of duties) {
    if (charges.length < 2) continue;
    const scratch = pos.bd.slice();
    scratch[defender] = 0;
    const naked = charges.filter((c) => seeOn(scratch, c, them) >= 100);
    if (naked.length < 2) continue;
    const worst = Math.max(...naked.map((c) => CP_OF[pos.bd[c] & TYPE_MASK]));
    out.push({
      kind: "overloaded",
      squares: [algebraic(defender), ...naked.map(algebraic)],
      pieces: [PIECE_NAME[cellType(pos.bd[defender])], ...naked.map((c) => PIECE_NAME[cellType(pos.bd[c])])],
      value: Math.round(worst / 10) / 10,
      forSide: them,
      source,
      confidence: 0.68,
      from: algebraic(defender),
      targets: naked.map(algebraic),
      detail: "two-jobs",
    });
  }
  return out;
}

/* ================================================================== *
 * THE PUBLIC SCANS
 * ================================================================== */

export interface ScanOptions {
  /** Skip the mate-in-one sweep when a caller is in a hurry. Default false. */
  skipMate?: boolean;
  /** Skip trapped-piece search. Default false. */
  skipTrapped?: boolean;
}

/**
 * Everything true about one position, from `forSide`'s point of view as the
 * *beneficiary*. This is what powers ChessPaa's "watching over your shoulder"
 * commentary between moves — no engine, no await, no waiting.
 */
export function scanPosition(fen: string, forSide: Color, source: MotifSource, opts: ScanOptions = {}): Motif[] {
  const pos = makePos(fen);
  if (!pos) return [];
  const out: Motif[] = [];

  out.push(...pinsAndSkewers(pos, forSide, source));
  out.push(...allForks(pos, forSide, source));
  out.push(...overloadedDefenders(pos, other(forSide), source));

  if (pos.turn === forSide) {
    out.push(...forkThreats(pos, forSide, source));
    out.push(...hangingFor(pos, other(forSide), source));
    if (!opts.skipTrapped) out.push(...trappedPieces(pos, forSide, source));
    if (!opts.skipMate) {
      const mate = findMateInPos(pos);
      if (mate) {
        out.push(mateMotif(mate, forSide, source, 0.99, "mate-now"));
        const br = backRankWeakness(pos, other(forSide), source, mate);
        if (br) out.push(br);
      }
    }
  }

  return dedupe(out).sort((a, b) => motifImportance(b) - motifImportance(a));
}

function mateMotif(m: MateInOne, forSide: Color, source: MotifSource, confidence: number, detail: string): Motif {
  return {
    kind: "mateThreat",
    squares: [m.to, m.from],
    pieces: [PIECE_NAME[m.piece]],
    forSide,
    source,
    confidence,
    from: m.from,
    targets: [m.to],
    detail,
    via: m.uci,
  };
}

/**
 * THE MAIN ENTRY POINT.
 *
 * Three lenses on one move, in the order a grandfather actually looks:
 *  1. what did you just walk into? (danger — always first, always concrete)
 *  2. what did you just build?     (praise — the reason he leans forward)
 *  3. what did you walk past?      (the secret, told gently, only if wanted)
 *
 * `pv` is the engine's principal variation for the position BEFORE the move.
 * pv[0] is the move it wanted; we replay it on a scratch board to find the
 * shape the child missed. Everything else is pure board reading, so a missing
 * or late `pv` degrades the answer instead of breaking it — which is exactly
 * what lets the tutor answer instantly and enrich the line a beat later.
 */
export function detectMotifs(
  fenBefore: string,
  fenAfter: string,
  playedUci: string,
  pv?: string[],
): Motif[] {
  const before = makePos(fenBefore);
  const after = makePos(fenAfter);
  if (!before || !after) return [];

  const me = before.turn;
  const them = other(me);
  const from = playedUci.slice(0, 2);
  const to = playedUci.slice(2, 4);
  const toI = indexOfSquare(to);
  const out: Motif[] = [];

  /* ---- 0. THE GAME IS OVER --------------------------------------- */
  // Checkmate isn't really a motif, but handing the tutor the mating square
  // means the fireworks can land on the right piece.
  if (isMated(after)) {
    const kingSq = after.pieces(them).find((p) => p.type === "k")?.sq;
    return [{
      kind: "mateThreat",
      squares: [to, ...(kingSq ? [kingSq] : [])],
      pieces: [PIECE_NAME[cellType(after.bd[toI] || 1)]],
      forSide: me,
      source: "played",
      confidence: 1,
      from,
      targets: kingSq ? [kingSq] : [],
      detail: "mate-delivered",
    }];
  }

  /* ---- 1. DANGER: what the opponent can do to us now ------------- */
  out.push(...hangingFor(after, me, "threat", to));
  out.push(...allForks(after, them, "threat"));
  out.push(...forkThreats(after, them, "threat"));
  out.push(...pinsAndSkewers(after, them, "threat"));
  out.push(...overloadedDefenders(after, me, "threat"));

  const theirMate = findMateInPos(after);
  if (theirMate) {
    out.push(mateMotif(theirMate, them, "threat", 0.99, "mate-now"));
    const br = backRankWeakness(after, me, "threat", theirMate);
    if (br) out.push(br);
  }

  /* ---- 2. PRAISE: what our move built ---------------------------- */
  if (toI >= 0) {
    const mine = forkFrom(after.bd, toI, "played");
    if (mine) out.push(mine);
  }
  // A piece of THEIRS with no way home is good news for us. `trappedPieces`
  // asks "whose move is it, and can that side's piece get out?", so the side
  // whose pieces we are testing must be the side to move — which after our
  // move is them. It already reports the beneficiary as the other colour, so
  // no fixing up of `forSide` is needed (and doing so inverts the whole claim).
  out.push(...trappedPieces(after, them, "played"));
  if (from && to) out.push(...discoveredAttacks(before, after, from, to, me));
  // Only pins/skewers that are NEW — a pin that was already there isn't news.
  const had = new Set(pinsAndSkewers(before, me, "played").map(motifShapeKey));
  for (const p of pinsAndSkewers(after, me, "played")) {
    if (!had.has(motifShapeKey(p))) out.push(p);
  }
  // Are we threatening mate next move? Null-move the opponent and look.
  const nullFen = flipTurn(fenAfter);
  const nullPos = nullFen ? makePos(nullFen) : null;
  if (!nullPos) {
    // The null move was refused, which almost always means we just gave check.
    // That is the one moment a mating attack is easiest to mistake for a
    // catastrophe, so it gets its own exact test rather than a shrug.
    const forced = forcedMateInTwo(after);
    if (forced) out.push(mateMotif(forced, me, "played", 0.97, "mate-forced"));
  }
  if (nullPos) {
    const ourMate = findMateInPos(nullPos);
    if (ourMate) {
      // 0.9 not 0.99: they get one whole move to wriggle out of it.
      out.push(mateMotif(ourMate, me, "played", 0.9, "mate-threat"));
      const br = backRankWeakness(after, them, "played", ourMate);
      if (br) out.push(br);
    }
    // And the mirror: one of OURS that can't get out. It needs to be our move
    // for "can it run anywhere?" to mean anything, which is exactly what the
    // null move gives us. This is a warning, not praise — "your bishop grabbed
    // h2 and now it can never come home" is the lesson, and it belongs to the
    // child's side of the board.
    out.push(...trappedPieces(nullPos, me, "threat"));
  }

  /* ---- 3. THE SECRET: what the engine's move would have built ----- */
  const best = pv?.[0];
  if (best && best.length >= 4 && best.slice(0, 4) !== playedUci.slice(0, 4)) {
    const missedMate = findMateInPos(before);
    if (missedMate) out.push(mateMotif(missedMate, me, "missed", 1, "mate-missed"));

    try {
      const probe = new Chess(fenBefore, { skipValidation: true });
      const bm = probe.move({
        from: best.slice(0, 2),
        to: best.slice(2, 4),
        promotion: best.length > 4 ? best[4] : undefined,
      });
      const probePos = makePos(probe.fen());
      if (bm && probePos) {
        const bmToI = indexOfSquare(bm.to);
        const f = forkFrom(probePos.bd, bmToI, "missed", best);
        if (f) out.push(f);
        out.push(
          ...discoveredAttacks(before, probePos, bm.from, bm.to, me)
            .map((m): Motif => ({ ...m, source: "missed", via: best })),
        );
        // A free lunch we walked past is the most useful "missed" of all.
        if (bm.captured && CP_OF[T[bm.captured as keyof typeof T]] >= 300) {
          const grabbed = CP_OF[T[bm.captured as keyof typeof T]];
          const cost = seeOn(probePos.bd, bmToI, them);
          if (cost < grabbed - 100) {
            out.push({
              kind: "hanging",
              squares: [bm.to, bm.from],
              pieces: [PIECE_NAME[bm.captured], PIECE_NAME[bm.piece]],
              value: Math.round((grabbed - Math.max(0, cost)) / 10) / 10,
              forSide: me,
              source: "missed",
              confidence: 0.95,
              from: bm.from,
              targets: [bm.to],
              detail: "free-lunch",
              via: best,
            });
          }
        }
      }
    } catch { /* engine handed us a move this position can't play — ignore it */ }
  }

  return dedupe(out).sort((a, b) => motifImportance(b) - motifImportance(a));
}

function motifShapeKey(m: Motif): string {
  return `${m.kind}:${m.squares.join(",")}`;
}

function dedupe(list: Motif[]): Motif[] {
  const seen = new Map<string, Motif>();
  for (const m of list) {
    const key = `${m.kind}:${m.source}:${m.forSide}:${[...m.squares].sort().join(",")}`;
    const prev = seen.get(key);
    if (!prev || m.confidence > prev.confidence) seen.set(key, m);
  }
  return [...seen.values()];
}

/* ================================================================== *
 * RANKING — which of these is worth a grandfather's breath?
 * ================================================================== */

/**
 * These weights encode a TEACHING opinion, not an engine opinion: for a
 * beginner, "your knight can be taken" beats "you have a lovely relative pin"
 * every single time. Danger outranks praise, concrete outranks subtle, and
 * anything the child can point at outranks anything they can't.
 */
const KIND_WEIGHT: Record<MotifKind, number> = {
  mateThreat: 100,
  hanging: 80,
  fork: 62,
  backRank: 55,
  discoveredAttack: 48,
  skewer: 44,
  trapped: 40,
  pin: 34,
  overloaded: 24,
};

const SOURCE_WEIGHT: Record<MotifSource, number> = {
  threat: 1.25,  // safety first, always
  played: 1.0,
  missed: 0.85,  // the secret is lovely, but never at the cost of a warning
};

export function motifImportance(m: Motif): number {
  const material = Math.min(9, m.value ?? 0) * 3;
  return (KIND_WEIGHT[m.kind] + material) * SOURCE_WEIGHT[m.source] * m.confidence;
}

/** The n most-worth-saying motifs, already filtered for honesty. */
export function topMotifs(list: Motif[], n = 3, minConfidence = 0.6): Motif[] {
  return list
    .filter((m) => m.confidence >= minConfidence)
    .sort((a, b) => motifImportance(b) - motifImportance(a))
    .slice(0, n);
}

/** Stable key for "has this child seen this idea before?" bookkeeping. */
export function motifKey(m: Motif): string {
  return `${m.source}:${m.kind}`;
}

/** Human-readable piece name for a square, for callers assembling their own text. */
export function pieceNameAt(fen: string, sq: string): string | null {
  const i = indexOfSquare(sq);
  if (i < 0) return null;
  const v = fenToBd(fen)[i];
  return v ? PIECE_NAME[cellType(v)] : null;
}
