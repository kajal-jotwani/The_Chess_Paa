import { Chess, Move, Square } from "chess.js";
import { ModeContext, Mode, wait, pick } from "./Context";
import { BoardSession } from "./BoardSession";
import { AttractionId } from "../world/Layout";
import { hintFor, wrongMoveText } from "../chess/Coach";
import { moveFromUci, describeMove, NAME } from "../chess/Motifs";

export interface PuzzleDef { id: string; fen: string; moves: string; rating: number; themes: string; }
export interface PuzzleRunOptions {
  attraction: AttractionId;
  title: string;
  intro: string;
  puzzles: PuzzleDef[];
  rush?: { lives: number; seconds: number };
  /** called between puzzles; return true to take a ride break */
  onSolved?: (count: number) => Promise<void> | void;
  onFinished?: (solved: number, total: number) => void;
}

const CHEERS = ["Yes! That's the move!", "Wonderful! You saw it!", "Ha-HA! Exactly right!", "Superb, little champion!", "That's how a grandmaster thinks!"];

/**
 * Runs a list of Lichess puzzles on one park board.  First move of `moves`
 * is the opponent's; the child answers the rest.  Wrong answers rewind kindly.
 */
export class PuzzleMode implements Mode {
  private s: BoardSession;
  private idx = -1;
  private solution: string[] = [];
  private step = 0;
  private wrongTries = 0;
  private solved = 0;
  private lives = 0;
  private timeLeft = 0;
  private active = false;
  private streak = 0;
  private hintSquare: Square | null = null;
  /** puzzle token — bumped by next(); continuations from an older puzzle (or after exit) bail on mismatch */
  private run = 0;
  /** true while next() is setting a puzzle up, so Skip / "Next puzzle" can't double-advance */
  private loading = false;
  constructor(private ctx: ModeContext, private opts: PuzzleRunOptions) {
    this.s = ctx.session(opts.attraction);
  }
  private stale(run: number) { return !this.active || run !== this.run; }

  async enter() {
    const { ui, world } = this.ctx;
    this.active = true;
    this.s.locked = true;
    world.placeCast(this.opts.attraction);
    ui.say(this.opts.intro);
    this.lives = this.opts.rush?.lives ?? 0;
    this.timeLeft = this.opts.rush?.seconds ?? 0;
    this.renderHud();
    this.s.onHumanMove = (m) => this.onMove(m);
    await wait(1.2);
    if (!this.active) return;
    this.next();
  }

  exit() {
    this.active = false;
    this.s.onHumanMove = undefined;
    this.s.board.interactive = false;
    this.s.board.clearHighlights();
    this.s.board.detach(); // no taps on a scenery board from the hub
    this.ctx.ui.clearHud();
  }

  private renderHud() {
    const { ui } = this.ctx;
    const rush = this.opts.rush;
    const carriages = "🚃".repeat(Math.min(12, this.solved));
    ui.setHud(`
      <div class="pill">${this.opts.title} · puzzle <b>${Math.max(1, this.idx + 1)}</b> / ${this.opts.puzzles.length}</div>
      ${rush ? `<div class="pill">❤️ ${"❤️".repeat(Math.max(0, this.lives - 1))}${this.lives <= 0 ? "💔" : ""} · <span class="timer">${this.fmt(this.timeLeft)}</span></div>` : ""}
      <div class="pill"><span class="streak">🔥 ${this.streak}</span> &nbsp; ⭐ ${this.solved}</div>
      ${rush ? `<div class="pill">${carriages || "🚂 fill the train!"}</div>` : ""}
      <div class="row"><button class="btn small teal" id="pz-hint">💡 Hint</button><button class="btn small ghost" id="pz-skip">⏭ Skip</button></div>`);
    ui.panelEl();
    (document.getElementById("pz-hint") as HTMLButtonElement).onclick = () => this.hint();
    (document.getElementById("pz-skip") as HTMLButtonElement).onclick = () => { if (this.s.locked) return; this.streak = 0; this.next(); }; // never mid-animation: a load() then would re-sync the board to the old game
  }
  private fmt(sec: number) { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return `${m}:${s.toString().padStart(2, "0")}`; }

  private async next() {
    if (this.loading) return; // already setting one up — a double-tap must not skip a puzzle
    const { ui } = this.ctx;
    const run = ++this.run;
    this.loading = true;
    try {
      this.idx++;
      this.step = 0; this.wrongTries = 0; this.hintSquare = null;
      if (this.idx >= this.opts.puzzles.length || (this.opts.rush && this.lives <= 0)) { this.finish(); return; }
      const p = this.opts.puzzles[this.idx];
      const chess = new Chess(p.fen);
      this.solution = p.moves.split(" ");
      this.s.board.interactive = false;
      this.s.load(p.fen);
      this.s.locked = true; // after load() (which unlocks) — keeps the rush timer paused through the intro
      this.s.playerColor = chess.turn() === "w" ? "b" : "w";
      this.renderHud();
      await wait(0.7);
      if (this.stale(run)) return;
      const first = moveFromUci(chess, this.solution[0]);
      await this.s.playUci(this.solution[0]);
      if (this.stale(run)) return;
      const you = this.s.playerColor === "w" ? "White" : "Black";
      const theme = p.themes.split(" ").find((t) => ["mateIn1", "mateIn2", "fork", "pin", "skewer", "discoveredAttack", "hangingPiece", "backRankMate", "promotion"].includes(t));
      const themeText: Record<string, string> = { mateIn1: "Checkmate in ONE!", mateIn2: "Checkmate in two moves.", fork: "Look for a FORK.", pin: "There's a PIN here.", skewer: "A SKEWER is hiding.", discoveredAttack: "Move one piece to unmask another.", hangingPiece: "Somebody left a piece hanging!", backRankMate: "The back rank is weak…", promotion: "A pawn wants to become a queen." };
      ui.say(`${pick(["Here we go!", "New puzzle!", "Next one!", "Ready?"])} You are **${you}**. ${first ? `They just played ${describeMove(first)}.` : ""} ${theme ? themeText[theme] : "Find the best move!"}`);
      this.s.locked = false;
      this.s.board.interactive = true;
      this.s.board.attach(this.ctx.r.renderer.domElement, this.ctx.r.camera);
    } finally {
      if (run === this.run) this.loading = false;
    }
  }

  private async onMove(m: Move) {
    const { ui, sound, world, progress } = this.ctx;
    const run = this.run;
    const expected = this.solution[this.step + 1];
    const uci = m.from + m.to + (m.promotion ?? "");
    const expectedMove = moveFromUci(new Chess(m.before), expected);
    const ok = uci === expected || (this.s.chess.isCheckmate() && expectedMove && new Chess(expectedMove.after).isCheckmate());
    if (ok) {
      this.step += 2;
      sound.good();
      this.s.board.hint(null);
      if (this.step >= this.solution.length) {
        // solved!
        this.solved++; this.streak++;
        progress.addStar(this.opts.attraction);
        progress.markSolved(this.opts.puzzles[this.idx].id);
        ui.setStars(progress.stars);
        world.chessPaa.mood = "cheer";
        world.chessPaa.say(2);
        sound.great();
        ui.say(`${pick(CHEERS)} ${this.s.chess.isCheckmate() ? "CHECKMATE!" : ""} ⭐`);
        this.renderHud();
        this.s.locked = true; this.s.board.interactive = false;
        await this.opts.onSolved?.(this.solved); // may be a ride break — its speech replaces ours
        if (this.stale(run)) return;
        if (this.opts.rush) { await wait(0.9); if (this.stale(run)) return; this.next(); return; }
        // only now offer the button, so it can't start a puzzle mid-ride and it's still there when the ride ends
        ui.setActions([{ label: "Next puzzle ➜", onClick: () => this.next() }]);
        return;
      }
      // play the reply
      this.s.locked = true;
      ui.say(pick(["Good! And they reply…", "Right! Now watch…", "Yes — keep going!"]));
      await wait(0.5);
      if (this.stale(run)) return;
      await this.s.playUci(this.solution[this.step]);
      if (this.stale(run)) return;
      this.s.locked = false;
      ui.say("Your move again. Finish it!");
    } else {
      this.wrongTries++;
      this.streak = 0;
      sound.oops();
      if (this.opts.rush) this.lives--;
      // explain with the engine's best reply to the tried move (lines[0], never the Skill-Level-degraded bestmove)
      let reply: Move | null = null;
      try {
        const ev = await this.ctx.engine.evaluate(m.after, { depth: 10 });
        const best = ev.lines[0]?.move ?? ev.bestMove;
        if (best) reply = moveFromUci(new Chess(m.after), best);
      } catch { /* engine busy */ }
      if (this.stale(run)) return;
      const sol = expectedMove!;
      ui.say(wrongMoveText(this.s.chess, m, sol, reply));
      await wait(0.9);
      if (this.stale(run)) return;
      await this.s.undo();
      if (this.stale(run)) return;
      this.renderHud();
      if (this.opts.rush && this.lives <= 0) { await wait(1.0); if (this.stale(run)) return; this.finish(); return; }
      if (this.wrongTries >= 2) { this.hintSquare = sol.from; this.s.board.hint(sol.from); }
      this.s.locked = false;
    }
  }

  private hint() {
    const expected = this.solution[this.step + 1];
    if (!expected) return;
    const sol = moveFromUci(this.s.chess, expected);
    if (!sol) return;
    this.ctx.sound.click();
    if (!this.hintSquare) { this.hintSquare = sol.from; this.s.board.hint(sol.from); this.ctx.ui.say(hintFor(this.s.chess, sol)); }
    else { this.ctx.ui.say(`The answer is **${sol.san}** — ${describeMove(sol)}. Play it!`); this.s.board.hint(sol.to); }
  }

  private finish() {
    const { ui, progress, sound } = this.ctx;
    this.s.board.interactive = false;
    this.s.locked = true;
    sound.fanfare();
    if (this.opts.rush) progress.setBestRush(this.solved);
    const total = this.opts.puzzles.length;
    const stars = this.solved >= total ? 3 : this.solved >= total * 0.6 ? 2 : this.solved > 0 ? 1 : 0;
    if (stars > 0) { progress.addTicket(stars); ui.setTickets(progress.tickets); sound.coin(); } // tickets buy the fireworks show
    ui.showModal(`<h1>${this.opts.rush ? "🚂 All aboard!" : "🎉 Round complete!"}</h1>
      <div class="stars-big">${"⭐".repeat(Math.max(1, stars))}${"☆".repeat(3 - Math.max(1, stars))}</div>
      <p>You solved <b>${this.solved}</b> ${this.opts.rush ? `puzzles — the train has ${this.solved} carriages! Best ever: ${progress.bestRush}` : `of ${total} puzzles.`}</p>
      <div class="row"><button class="btn teal" id="pz-again">🔁 Play again</button><button class="btn" id="pz-park">🎢 Back to the park</button></div>`);
    (document.getElementById("pz-again") as HTMLButtonElement).onclick = () => { ui.hideModal(); this.idx = -1; this.solved = 0; this.streak = 0; this.lives = this.opts.rush?.lives ?? 0; this.timeLeft = this.opts.rush?.seconds ?? 0; this.next(); };
    (document.getElementById("pz-park") as HTMLButtonElement).onclick = () => { ui.hideModal(); this.ctx.exit(); };
    this.opts.onFinished?.(this.solved, total);
  }

  update(dt: number, t: number) {
    this.s.board.pulse(t);
    if (this.opts.rush && this.timeLeft > 0 && !this.s.locked) {
      this.timeLeft -= dt;
      const el = document.querySelector(".timer"); if (el) el.textContent = this.fmt(Math.max(0, this.timeLeft));
      if (this.timeLeft <= 0) this.finish();
    }
  }
}
