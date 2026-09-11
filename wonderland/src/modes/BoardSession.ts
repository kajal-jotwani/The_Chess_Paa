import { Chess, Move, Square, Color, PieceSymbol } from "chess.js";
import { Board3D } from "../chess/Board3D";
import { UI } from "../ui/UI";
import { Sound } from "../audio/Sound";

/**
 * Glue between one Board3D, a chess.js game and the child's taps: selection,
 * legal-move dots, promotion, animation and sounds.  Modes decide what a move
 * means; the session only makes it happen.
 */
export class BoardSession {
  chess = new Chess();
  selected: Square | null = null;
  playerColor: Color | "both" = "w";
  locked = false;
  onHumanMove?: (m: Move) => void;
  onSelect?: (sq: Square | null) => void;
  /** optional filter: which pieces may be picked up (academy try-it) */
  pickFilter?: (sq: Square) => boolean;
  constructor(readonly board: Board3D, private ui: UI, private sound: Sound) {
    board.onSquare = (sq) => this.tap(sq);
  }

  load(fen: string) {
    this.chess = new Chess(fen);
    this.selected = null;
    this.locked = false; // a fresh position is never mid-animation or mid-picker
    this.board.clearHighlights();
    this.board.sync(this.chess);
  }

  get turn() { return this.chess.turn(); }
  humanToMove() { return !this.locked && (this.playerColor === "both" || this.chess.turn() === this.playerColor); }

  private async tap(sq: Square) {
    if (!this.humanToMove()) return;
    const piece = this.chess.get(sq);
    if (this.selected) {
      const legal = this.chess.moves({ square: this.selected, verbose: true }).find((m) => m.to === sq);
      if (legal) {
        let promotion: PieceSymbol | undefined;
        if (legal.promotion) {
          this.locked = true;
          const p = await this.ui.choosePromotion(legal.color);
          this.locked = false;
          if (!p) { this.select(null); return; } // picker dismissed (Home mid-choice): abort the move cleanly
          promotion = p;
        }
        const m = await this.play({ from: this.selected, to: sq, promotion });
        if (m) this.onHumanMove?.(m);
        return;
      }
    }
    if (piece && piece.color === this.chess.turn() && (!this.pickFilter || this.pickFilter(sq))) {
      this.select(sq);
    } else {
      this.select(null);
    }
  }

  select(sq: Square | null) {
    this.selected = sq;
    this.board.select(sq);
    if (sq) { this.board.showLegal(this.chess.moves({ square: sq, verbose: true })); this.sound.pick(); }
    this.onSelect?.(sq);
  }

  /** Validate, animate and apply a move. Returns null if illegal. */
  async play(mv: { from: Square; to: Square; promotion?: PieceSymbol }): Promise<Move | null> {
    let m: Move;
    try { m = this.chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion ?? "q" }); } catch { return null; }
    this.locked = true;
    this.select(null);
    if (m.captured) this.sound.capture(); else this.sound.move();
    await this.board.animateMove(m, this.chess);
    this.locked = false;
    return m;
  }

  /** Play a UCI string (engine/puzzle reply). */
  async playUci(uci: string) {
    return this.play({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci[4] as PieceSymbol | undefined });
  }

  /** Take back the last move (animated). */
  async undo() {
    const m = this.chess.undo();
    if (!m) return null;
    this.locked = true;
    this.select(null);
    // animate the piece back
    const back = { from: m.to, to: m.from, piece: m.piece, color: m.color, flags: "n" } as any;
    await this.board.animateMove(back, this.chess);
    this.board.sync(this.chess);
    this.locked = false;
    return m;
  }
}
