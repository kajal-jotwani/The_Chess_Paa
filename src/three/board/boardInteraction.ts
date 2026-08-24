"use client";

import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";

/**
 * BOARD INTERACTION — the rules, the geometry and the bookkeeping.
 *
 * Deliberately free of three.js and React so it can be reasoned about (and
 * one day tested) on its own. Board3D.tsx does the drawing; this file decides
 * WHAT is true.
 *
 * THE ONE RULE OF THIS FILE: chess.js is the only rules authority. Nothing
 * here ever hand-rolls a move generator, a check test or a promotion test —
 * every legality question is answered by asking chess.js and nothing else.
 * A child must never be allowed to make an illegal move, and must never be
 * told a legal move is illegal.
 */

/* ================================================================== *
 * TYPES
 * ================================================================== */

export type Orientation = "white" | "black";

/** Which colour the local player is allowed to move. `null` = look, don't touch. */
export type LegalFor = "w" | "b" | "both" | null;

/** The `highlight` prop's vocabulary — a square -> a kind of glow. */
export type HighlightKind = "hint" | "danger" | "good";

export type { Square, PieceSymbol, Color };

export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
export const RANKS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

/** The four pieces a pawn may become, in the order a child expects to see them. */
export const PROMOTION_CHOICES: PieceSymbol[] = ["q", "r", "b", "n"];

/* ================================================================== *
 * LAYOUT
 *
 * One square is one unit. Every number below is in that unit, measured in
 * "deck space": the origin is the CENTRE OF THE PLAYING SURFACE and y = 0 is
 * the wood a piece stands on. Board3D lifts the whole deck by the stand's
 * height so that the component's `position` prop can be the point where the
 * stand's foot meets the ground (which is what terrainHeight() gives you).
 * ================================================================== */

export const BOARD = {
  /** Edge length of one square. */
  SQUARE: 1,
  /** 8 squares across. */
  SPAN: 8,
  /** Half the playing field — the field runs -4..+4 in x and z. */
  HALF: 4,
  /** Width of the raised rim outside the playing field. */
  RIM: 0.68,
  /** How far the rim stands proud of the playing surface. */
  RIM_TOP: 0.16,
  /** Thickness of the board slab below the surface. */
  SLAB: 0.3,
  /** The little chamfered lip under the slab. */
  LIP: 0.12,
  /** Half the whole board including the rim. */
  OUTER_HALF: 4 + 0.68,
} as const;

export type StandKind = "none" | "plinth" | "table";

/**
 * Distance from the stand's FOOT (the component's `position`) up to the
 * playing surface. Exported so whoever places the board in the park can put
 * a lantern, a hand or a camera at the right height without guessing.
 */
export const STAND_HEIGHT: Record<StandKind, number> = {
  none: BOARD.SLAB + BOARD.LIP, // the slab simply rests on the ground
  plinth: 0.74,
  table: 2.35,
};

/* ================================================================== *
 * SQUARES <-> GEOMETRY
 * ================================================================== */

/** "e4" -> { file: 4, rank: 3 }. Returns null for anything that isn't a square. */
export function squareToFileRank(sq: string): { file: number; rank: number } | null {
  if (typeof sq !== "string" || sq.length !== 2) return null;
  const file = sq.charCodeAt(0) - 97; // 'a'
  const rank = sq.charCodeAt(1) - 49; // '1'
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return { file, rank };
}

/** { file: 4, rank: 3 } -> "e4". */
export function fileRankToSquare(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return (FILES[file] + RANKS[rank]) as Square;
}

/**
 * Centre of a square in deck space.
 *
 * We never rotate the board group to flip orientation — we remap the squares
 * instead. That matters: a rotated group would turn the rank/file letters
 * painted on the rim upside down, and a child reading "e4" upside down is a
 * child who has stopped playing. (The checker pattern survives the remap
 * untouched, because an 8x8 checker is symmetric under a half turn.)
 */
export function squareCenter(sq: string, orientation: Orientation = "white"): { x: number; z: number } {
  const fr = squareToFileRank(sq);
  if (!fr) return { x: 0, z: 0 };
  return fileRankCenter(fr.file, fr.rank, orientation);
}

export function fileRankCenter(file: number, rank: number, orientation: Orientation = "white"): { x: number; z: number } {
  // White at the bottom of the screen: file 'a' to the left (-x), rank 1
  // nearest the camera (+z). Black orientation is the same board seen from
  // the other side, so both axes flip.
  const s = orientation === "white" ? 1 : -1;
  return { x: s * (file - 3.5), z: s * (3.5 - rank) };
}

/** Which square is under this deck-space point? null if it is off the field. */
export function squareAt(x: number, z: number, orientation: Orientation = "white"): Square | null {
  if (Math.abs(x) > BOARD.HALF || Math.abs(z) > BOARD.HALF) return null;
  return nearestSquare(x, z, orientation);
}

/** Nearest square, even if the point is off the edge. Big thumbs deserve mercy. */
export function nearestSquare(x: number, z: number, orientation: Orientation = "white"): Square {
  const s = orientation === "white" ? 1 : -1;
  const file = clampIndex(Math.floor(s * x + 4));
  const rank = clampIndex(Math.floor(4 - s * z));
  return (FILES[file] + RANKS[rank]) as Square;
}

function clampIndex(i: number): number {
  return i < 0 ? 0 : i > 7 ? 7 : i;
}

/**
 * Index into the 8x8 overlay texture for a square.
 *
 * The overlay is a single quad with a tiny 8x8 data texture driving it, so
 * every dot, ring and glow on the board costs ONE draw call instead of 64.
 * Row 0 of a DataTexture is v = 0, which our plane puts at z = +4, hence the
 * (4 - z) below. Get this wrong and the hints land on the wrong squares.
 */
export function cellIndexOfSquare(sq: string, orientation: Orientation = "white"): number {
  const { x, z } = squareCenter(sq, orientation);
  const col = clampIndex(Math.floor(x + 4));
  const row = clampIndex(Math.floor(4 - z));
  return row * 8 + col;
}

/* ================================================================== *
 * CHESS QUERIES — every one of these asks chess.js
 * ================================================================== */

/**
 * chess.js instances are not free, and Board3D asks the same questions of the
 * same FEN many times per frame. One-slot memo, which is all we ever need
 * because the FEN only changes between moves.
 */
let memoFen: string | null = null;
let memoChess: Chess | null = null;

function load(fen: string): Chess | null {
  if (memoFen === fen && memoChess) return memoChess;
  try {
    const c = new Chess(fen);
    memoFen = fen;
    memoChess = c;
    return c;
  } catch {
    // A malformed FEN must degrade to "an empty board you cannot touch",
    // never to a crash in a child's hands.
    memoFen = null;
    memoChess = null;
    return null;
  }
}

export interface PlacedPiece {
  square: Square;
  type: PieceSymbol;
  color: Color;
}

/** Every piece on the board, in a stable order. */
export function readPlacement(fen: string): PlacedPiece[] {
  const c = load(fen);
  if (!c) return [];
  const out: PlacedPiece[] = [];
  for (const row of c.board()) {
    for (const cell of row) {
      if (cell) out.push({ square: cell.square, type: cell.type, color: cell.color });
    }
  }
  return out;
}

export function sideToMove(fen: string): Color | null {
  return load(fen)?.turn() ?? null;
}

/** Is this colour allowed to be picked up right now? */
export function canTouch(fen: string, color: Color, legalFor: LegalFor): boolean {
  if (legalFor === null || legalFor === undefined) return false;
  const c = load(fen);
  if (!c) return false;
  // Only the side to move can ever be lifted — otherwise a child picks up a
  // black knight on white's turn, sees no dots, and learns nothing but that
  // the board is broken.
  if (c.turn() !== color) return false;
  return legalFor === "both" || legalFor === color;
}

export interface PickupInfo {
  from: Square;
  piece: PlacedPiece;
  /** Quiet destinations — honey dots. */
  quiet: Square[];
  /** Destinations that take something — red rings. */
  captures: Square[];
  /** Destinations that would ask the promotion question. */
  promotions: Square[];
  /** Everything, for hit testing. */
  all: Square[];
}

/**
 * Lift a piece: what may it do?
 *
 * Returns null when the square is empty, holds the wrong colour, or the piece
 * has no legal move at all. A piece with nowhere to go is deliberately NOT
 * pickable — an empty ring of hints is a dead end, and this park has none.
 */
export function pickup(fen: string, from: string, legalFor: LegalFor = "both"): PickupInfo | null {
  const c = load(fen);
  if (!c) return null;
  const fr = squareToFileRank(from);
  if (!fr) return null;
  const sq = from as Square;
  const piece = c.get(sq);
  if (!piece) return null;
  if (!canTouch(fen, piece.color, legalFor)) return null;

  const moves = c.moves({ square: sq, verbose: true });
  if (moves.length === 0) return null;

  const quiet: Square[] = [];
  const captures: Square[] = [];
  const promotions: Square[] = [];
  const all: Square[] = [];
  for (const m of moves) {
    if (!all.includes(m.to)) all.push(m.to);
    if (m.promotion && !promotions.includes(m.to)) promotions.push(m.to);
    // A capture ring beats a quiet dot: taking is the loud thing that
    // happened, and it is what a child needs to see first.
    if (m.captured) {
      if (!captures.includes(m.to)) captures.push(m.to);
    } else if (!quiet.includes(m.to)) {
      quiet.push(m.to);
    }
  }
  // en-passant and capture-promotions can land in both buckets; captures win.
  for (let i = quiet.length - 1; i >= 0; i--) {
    if (captures.includes(quiet[i])) quiet.splice(i, 1);
  }
  return { from: sq, piece: { square: sq, type: piece.type, color: piece.color }, quiet, captures, promotions, all };
}

/** Every square holding a piece the player could lift right now. */
export function liftableSquares(fen: string, legalFor: LegalFor = "both"): Square[] {
  const c = load(fen);
  if (!c || legalFor === null) return [];
  const turn = c.turn();
  if (legalFor !== "both" && legalFor !== turn) return [];
  const out = new Set<Square>();
  for (const m of c.moves({ verbose: true })) out.add(m.from);
  return [...out];
}

/** Would from->to be accepted? Asked of chess.js, never guessed. */
export function isLegalMove(fen: string, from: string, to: string): boolean {
  const c = load(fen);
  if (!c) return false;
  const fr = squareToFileRank(from);
  const tr = squareToFileRank(to);
  if (!fr || !tr) return false;
  return c.moves({ square: from as Square, verbose: true }).some((m) => m.to === to);
}

/** Does this move need the promotion picker? */
export function needsPromotion(fen: string, from: string, to: string): boolean {
  const c = load(fen);
  if (!c) return false;
  if (!squareToFileRank(from) || !squareToFileRank(to)) return false;
  return c.moves({ square: from as Square, verbose: true }).some((m) => m.to === to && !!m.promotion);
}

export type MoveFlavour = "quiet" | "capture" | "castle" | "enpassant" | "promotion";

/** What KIND of thing is this move? Drives which sound and which animation plays. */
export function moveFlavour(fen: string, from: string, to: string): MoveFlavour | null {
  const c = load(fen);
  if (!c) return null;
  if (!squareToFileRank(from)) return null;
  const m = c.moves({ square: from as Square, verbose: true }).find((x) => x.to === to);
  if (!m) return null;
  if (m.promotion) return "promotion";
  if (m.isEnPassant()) return "enpassant";
  // chess.js 1.4 exposes the two castles separately; isCastle() is only in
  // the deprecation note, not on the class.
  if (m.isKingsideCastle() || m.isQueensideCastle()) return "castle";
  if (m.captured) return "capture";
  return "quiet";
}

/** The square of the king who is in check, or null. Drives the check glow. */
export function checkedKingSquare(fen: string): Square | null {
  const c = load(fen);
  if (!c || !c.isCheck()) return null;
  const found = c.findPiece({ type: "k", color: c.turn() });
  return found.length ? found[0] : null;
}

/**
 * GENTLE SNAPPING.
 *
 * A drop that lands slightly outside a legal square still counts, as long as
 * the nearest legal target is within `tolerance` squares of the finger. This
 * is the single biggest difference between a board that feels like a toy and
 * one that feels like a form.
 */
export function snapToTarget(
  x: number,
  z: number,
  targets: readonly string[],
  orientation: Orientation = "white",
  tolerance = 0.62
): Square | null {
  if (targets.length === 0) return null;
  // An exact hit always wins — never drag a confident drop sideways.
  const exact = squareAt(x, z, orientation);
  if (exact && targets.includes(exact)) return exact;

  let best: Square | null = null;
  let bestD = tolerance;
  for (const t of targets) {
    const c = squareCenter(t, orientation);
    const d = Math.hypot(c.x - x, c.z - z);
    if (d < bestD) {
      bestD = d;
      best = t as Square;
    }
  }
  return best;
}

/* ================================================================== *
 * PIECE TRACKING
 *
 * A FEN is a photograph; it has no memory of which knight is which. To make
 * a piece SLIDE from one square to another (instead of teleporting), we have
 * to decide, on every new FEN, which of yesterday's pieces each of today's
 * pieces used to be. That is what this section does.
 * ================================================================== */

export interface TrackedPiece {
  /** Stable across FENs — the identity a mesh and its springs are bound to. */
  id: number;
  type: PieceSymbol;
  color: Color;
  square: Square;
}

export interface PlacementDiff {
  pieces: TrackedPiece[];
  /** Pieces that changed square. */
  moved: Array<{ id: number; from: Square; to: Square }>;
  /** Pieces that changed type on the spot — a pawn that became a queen. */
  promoted: Array<{ id: number; from: PieceSymbol; to: PieceSymbol }>;
  /** Pieces that left the board. Captured, or the position simply changed. */
  removed: TrackedPiece[];
  /** Pieces that appeared. New game, or a puzzle jumping to a new position. */
  added: TrackedPiece[];
}

/**
 * Match yesterday's pieces to today's.
 *
 * Four passes, cheapest and most certain first:
 *   1. same square, same piece  -> obviously the same piece, don't touch it
 *   2. the declared last move   -> the one thing we actually KNOW moved
 *      (plus the rook that castling drags along, which is the classic bug:
 *       without this the rook teleports while the king glides)
 *   3. nearest same-kind match  -> handles arbitrary FEN jumps gracefully,
 *      so a puzzle switching positions still animates instead of popping
 *   4. whatever is left         -> removed / added
 */
export function diffPlacement(
  prev: readonly TrackedPiece[],
  fen: string,
  lastMove: readonly [string, string] | null | undefined,
  mintId: () => number
): PlacementDiff {
  const next = readPlacement(fen);
  const diff: PlacementDiff = { pieces: [], moved: [], promoted: [], removed: [], added: [] };

  const prevLeft = new Map<number, TrackedPiece>();
  for (const p of prev) prevLeft.set(p.id, p);
  const prevBySquare = new Map<Square, TrackedPiece>();
  for (const p of prev) prevBySquare.set(p.square, p);

  const nextLeft = next.slice();
  const take = (n: PlacedPiece, was: TrackedPiece) => {
    prevLeft.delete(was.id);
    const idx = nextLeft.indexOf(n);
    if (idx >= 0) nextLeft.splice(idx, 1);
    const tracked: TrackedPiece = { id: was.id, type: n.type, color: n.color, square: n.square };
    diff.pieces.push(tracked);
    if (was.square !== n.square) diff.moved.push({ id: was.id, from: was.square, to: n.square });
    if (was.type !== n.type) diff.promoted.push({ id: was.id, from: was.type, to: n.type });
  };

  // --- 1. unmoved ---
  for (const n of next.slice()) {
    const was = prevBySquare.get(n.square);
    if (was && prevLeft.has(was.id) && was.color === n.color && was.type === n.type) take(n, was);
  }

  // --- 2. the declared last move (and castling's dragged rook) ---
  if (lastMove) {
    const [lf, lt] = lastMove;
    const was = prevBySquare.get(lf as Square);
    const now = nextLeft.find((n) => n.square === lt);
    if (was && now && prevLeft.has(was.id) && was.color === now.color) {
      const wasFR = squareToFileRank(lf);
      const nowFR = squareToFileRank(lt);
      take(now, was);
      // A king that jumped two files castled; its rook made the other half of
      // the move and must be linked by hand or it will pop across the board.
      if (was.type === "k" && wasFR && nowFR && Math.abs(nowFR.file - wasFR.file) === 2) {
        const kingSide = nowFR.file > wasFR.file;
        const rookFrom = fileRankToSquare(kingSide ? 7 : 0, wasFR.rank);
        const rookTo = fileRankToSquare(kingSide ? 5 : 3, wasFR.rank);
        const rookWas = rookFrom ? prevBySquare.get(rookFrom) : undefined;
        const rookNow = nextLeft.find((n) => n.square === rookTo);
        if (rookWas && rookNow && prevLeft.has(rookWas.id) && rookWas.type === "r") take(rookNow, rookWas);
      }
    }
  }

  // --- 3. nearest same-kind ---
  for (const n of nextLeft.slice()) {
    let best: TrackedPiece | null = null;
    let bestD = Infinity;
    const nf = squareToFileRank(n.square);
    for (const was of prevLeft.values()) {
      if (was.color !== n.color) continue;
      // A pawn is allowed to become a queen; nothing else changes kind.
      const sameKind = was.type === n.type || (was.type === "p" && n.type !== "p" && n.type !== "k");
      if (!sameKind) continue;
      const wf = squareToFileRank(was.square);
      if (!nf || !wf) continue;
      // Prefer an exact kind match, then proximity — a promoting pawn should
      // lose to a real queen standing right there.
      const kindPenalty = was.type === n.type ? 0 : 6;
      const d = Math.hypot(nf.file - wf.file, nf.rank - wf.rank) + kindPenalty;
      if (d < bestD) {
        bestD = d;
        best = was;
      }
    }
    if (best) take(n, best);
  }

  // --- 4. leftovers ---
  for (const was of prevLeft.values()) diff.removed.push(was);
  for (const n of nextLeft) {
    const tracked: TrackedPiece = { id: mintId(), type: n.type, color: n.color, square: n.square };
    diff.pieces.push(tracked);
    diff.added.push(tracked);
  }

  return diff;
}

/* ================================================================== *
 * OVERLAY CELL CODES
 *
 * Shared vocabulary between this file and the overlay shader in Board3D.
 * Keep the numbers and the shader's switch in step or the board will glow
 * the wrong colours.
 * ================================================================== */

export const CELL = {
  none: 0,
  /** Honey dot — you may go here. */
  move: 1,
  /** Red ring — something of theirs is standing here. */
  capture: 2,
  /** Soft honey frame — this is where the last move came from / went to. */
  last: 3,
  /** The square you have picked up from. */
  select: 4,
  /** `highlight` prop: a gentle nudge from the tutor. */
  hint: 5,
  /** `highlight` prop: careful. */
  danger: 6,
  /** `highlight` prop: yes, that one. */
  good: 7,
  /** The king is in check. Pulses. */
  check: 8,
  /** The square the dragged piece is currently hovering over. */
  drop: 9,
} as const;

export type CellCode = (typeof CELL)[keyof typeof CELL];

export function highlightToCell(kind: HighlightKind): CellCode {
  return kind === "danger" ? CELL.danger : kind === "good" ? CELL.good : CELL.hint;
}

/* ================================================================== *
 * INTERACTION STATE
 *
 * The pointer state machine, written down so it can be read in one sitting.
 * Board3D owns an instance of this and feeds it pointer events; it answers
 * with what should be highlighted and what move (if any) to emit.
 * ================================================================== */

export type Phase =
  /** Nothing picked up. */
  | { kind: "idle" }
  /** Picked up by tapping — dots are showing, waiting for a second tap. */
  | { kind: "armed"; pick: PickupInfo }
  /** A finger or mouse is carrying the piece. */
  | { kind: "dragging"; pick: PickupInfo; over: Square | null }
  /** Waiting for the child to choose a queen, rook, bishop or knight. */
  | { kind: "promoting"; pick: PickupInfo; to: Square };

/**
 * The tap/drag threshold, in CSS pixels. Touch gets a bigger one because a
 * thumb never lands and lifts on exactly the same pixel; treating a 5px
 * wobble as a drag is why so many mobile boards feel hostile.
 */
export function dragThreshold(pointerType: string): number {
  return pointerType === "touch" ? 9 : 4;
}
