import { Chess, Square, Color, PieceSymbol, Move } from "chess.js";

export const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
export const NAME: Record<PieceSymbol, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

export interface Hanging { square: Square; piece: PieceSymbol; attackers: number; defenders: number; cheapestAttacker: PieceSymbol; }

const other = (c: Color): Color => (c === "w" ? "b" : "w");

/** Pieces of `color` that can be taken for free (or by something cheaper). */
export function hangingPieces(chess: Chess, color: Color): Hanging[] {
  const out: Hanging[] = [];
  for (const row of chess.board()) for (const cell of row) {
    if (!cell || cell.color !== color || cell.type === "k") continue;
    const att = chess.attackers(cell.square, other(color));
    if (!att.length) continue;
    const def = chess.attackers(cell.square, color);
    const cheapest = att.map((s) => chess.get(s)!.type).sort((a, b) => VALUE[a] - VALUE[b])[0];
    if (def.length === 0 || VALUE[cheapest] < VALUE[cell.type]) {
      out.push({ square: cell.square, piece: cell.type, attackers: att.length, defenders: def.length, cheapestAttacker: cheapest });
    }
  }
  return out.sort((a, b) => VALUE[b.piece] - VALUE[a.piece]);
}

/** Enemy pieces `color` could capture safely right now (undefended or cheaper attacker). */
export function freeCaptures(chess: Chess, color: Color): { move: Move; gain: number }[] {
  if (chess.turn() !== color) return [];
  const out: { move: Move; gain: number }[] = [];
  for (const m of chess.moves({ verbose: true })) {
    if (!m.captured) continue;
    const after = new Chess(m.after);
    const recapture = after.attackers(m.to, other(color)).length > 0;
    const gain = VALUE[m.captured] - (recapture ? VALUE[m.piece] : 0);
    if (gain > 0) out.push({ move: m, gain });
  }
  return out.sort((a, b) => b.gain - a.gain);
}

/** Does a move (already played on `after`) attack two or more valuable enemy pieces? */
export function forkTargets(after: Chess, to: Square, mover: Color): Square[] {
  const piece = after.get(to);
  if (!piece) return [];
  const targets: Square[] = [];
  // squares attacked by the piece on `to`: use attackers() from the enemy's perspective
  for (const row of after.board()) for (const cell of row) {
    if (!cell || cell.color === mover) continue;
    if (after.attackers(cell.square, mover).includes(to)) {
      const worth = cell.type === "k" || VALUE[cell.type] > VALUE[piece.type] || after.attackers(cell.square, other(mover)).length === 0;
      if (worth) targets.push(cell.square);
    }
  }
  return targets;
}

/** Is the piece on `sq` pinned to its king (absolute pin)? */
export function isPinned(chess: Chess, sq: Square): boolean {
  const p = chess.get(sq);
  if (!p || p.type === "k") return false;
  if (chess.turn() !== p.color) return false;
  const legal = chess.moves({ square: sq, verbose: true });
  // a pinned piece has few/no moves off the line; approximate: no legal moves but would have pseudo-moves
  if (legal.length > 0) return false;
  const test = new Chess(chess.fen());
  test.remove(sq);
  const kingSq = kingSquare(test, p.color);
  return kingSq !== null && test.isAttacked(kingSq, other(p.color));
}

export function kingSquare(chess: Chess, color: Color): Square | null {
  for (const row of chess.board()) for (const cell of row) if (cell && cell.type === "k" && cell.color === color) return cell.square;
  return null;
}

/** Count developed minor pieces (off their starting squares). */
export function developedMinors(chess: Chess, color: Color): number {
  const home = color === "w" ? ["b1", "g1", "c1", "f1"] : ["b8", "g8", "c8", "f8"];
  let n = 0;
  for (const sq of home) { const p = chess.get(sq as Square); if (!p || p.color !== color || (p.type !== "n" && p.type !== "b")) n++; }
  return n;
}

export function describeSquarePiece(chess: Chess, sq: Square): string {
  const p = chess.get(sq);
  return p ? `${NAME[p.type]} on ${sq}` : `square ${sq}`;
}

/** Plain-English, kid-friendly description of a SAN move. */
export function describeMove(m: Move): string {
  if (m.flags.includes("k")) return "castle on the king's side";
  if (m.flags.includes("q")) return "castle on the queen's side";
  const who = NAME[m.piece];
  const verb = m.captured ? `takes the ${NAME[m.captured]} on ${m.to}` : (m.piece === "n" ? `hops to ${m.to}` : `moves to ${m.to}`);
  const extra = m.promotion ? ` and becomes a ${NAME[m.promotion]}!` : (m.san.includes("#") ? " — checkmate!" : m.san.includes("+") ? " with check!" : "");
  return `${who} ${verb}${extra}`;
}

export function moveFromUci(chess: Chess, uci: string): Move | null {
  const from = uci.slice(0, 2) as Square, to = uci.slice(2, 4) as Square, promotion = uci[4] as PieceSymbol | undefined;
  const test = new Chess(chess.fen());
  try { return test.move({ from, to, promotion }); } catch { return null; }
}
