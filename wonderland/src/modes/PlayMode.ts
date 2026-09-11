import { Chess, Move, Square } from "chess.js";
import { ModeContext, Mode, wait, pick } from "./Context";
import { BoardSession } from "./BoardSession";
import { judgeMove, evalToSmile, Verdict } from "../chess/Coach";
import { moveFromUci, describeMove } from "../chess/Motifs";
import type { EngineLine } from "../chess/Engine";

/**
 * `wobble` is how often ChessPaa takes a "small slip" instead of the engine's
 * pick, and `slack` how many pawns of eval that slip may cost — the slip is
 * chosen among the engine's own top lines, so a sleepy Teddy still plays chess
 * rather than random legal moves (which hung rooks and walked the king out).
 */
interface Level { id: string; name: string; emoji: string; skill: number; wobble: number; slack: number; movetime: number; blurb: string; }
const LEVELS: Level[] = [
  { id: "teddy", name: "Teddy", emoji: "🧸", skill: 0, wobble: 0.6, slack: 3.0, movetime: 150, blurb: "Very sleepy. Great for the first games." },
  { id: "bunny", name: "Bunny", emoji: "🐰", skill: 1, wobble: 0.4, slack: 1.5, movetime: 200, blurb: "Hops about, makes little slips." },
  { id: "fox", name: "Fox", emoji: "🦊", skill: 4, wobble: 0.2, slack: 0.8, movetime: 300, blurb: "Clever, but you can outfox it." },
  { id: "owl", name: "Owl", emoji: "🦉", skill: 9, wobble: 0.0, slack: 0, movetime: 450, blurb: "Wise and careful." },
  { id: "champ", name: "Champion", emoji: "🏆", skill: 16, wobble: 0.0, slack: 0, movetime: 700, blurb: "ChessPaa at full strength!" },
];

const PAA_MOVES = ["Let me think… there!", "My turn. Hmm, hmm… this one.", "I'll try this, little champion.", "Watch out for this one!", "Here comes ChessPaa!"];

/** A real game against ChessPaa, with a kind word about every single move. */
export class PlayMode implements Mode {
  private s: BoardSession;
  private level: Level = LEVELS[1];
  private kidColor: "w" | "b" = "w";
  private moves = 0;
  private thinking = false;
  private over = false;
  /** game token — bumped by every startGame() and checked after every await, so a stale verdict/reply/undo can never touch a newer game */
  private game = 0;
  constructor(private ctx: ModeContext) { this.s = ctx.session("grand_match"); }
  private stale(g: number) { return this.over || g !== this.game; }

  async enter() {
    const { ui, world } = this.ctx;
    world.placeCast("grand_match", true);
    this.s.load("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    this.s.board.interactive = false;
    ui.say("The **Grand Match**! Let's play a real game. I'll tell you what I think after every move you make. Pick how strong you'd like me to be.");
    this.chooseLevel();
  }

  exit() {
    this.over = true; // silences every in-flight continuation (verdict, reply, hint, undo)
    this.s.onHumanMove = undefined;
    this.s.board.interactive = false; this.s.board.clearHighlights(); this.s.board.detach();
    this.ctx.ui.hidePanel(); this.ctx.ui.clearHud();
    this.ctx.world.kids.forEach((k) => (k.mood = "idle"));
  }

  private chooseLevel() {
    const { ui } = this.ctx;
    const el = ui.showModal(`<h1>How strong should ChessPaa be?</h1><div class="cards" style="text-align:left">${LEVELS.map((L) => `<button class="card" data-l="${L.id}"><div class="big">${L.emoji}</div><div class="name">${L.name}</div><div class="sub">${L.blurb}</div></button>`).join("")}</div>
      <p style="margin-top:14px">You play as: <button class="btn small" id="col-w">♔ White</button> <button class="btn small ghost" id="col-b">♚ Black</button></p>`);
    let col: "w" | "b" = "w";
    const cw = el.querySelector("#col-w") as HTMLButtonElement, cb = el.querySelector("#col-b") as HTMLButtonElement;
    cw.onclick = () => { col = "w"; cw.className = "btn small"; cb.className = "btn small ghost"; };
    cb.onclick = () => { col = "b"; cb.className = "btn small"; cw.className = "btn small ghost"; };
    el.querySelectorAll<HTMLButtonElement>(".card").forEach((b) => { b.onclick = () => { this.level = LEVELS.find((L) => L.id === b.dataset.l)!; this.kidColor = col; ui.hideModal(); this.startGame(); }; });
  }

  private async startGame() {
    const { ui, world, rig, engine } = this.ctx;
    const g = ++this.game;
    this.over = false; this.moves = 0; this.thinking = false;
    this.s.load("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    this.s.playerColor = this.kidColor;
    this.s.pickFilter = undefined;
    this.s.onHumanMove = (m) => this.onKidMove(m);
    const board = this.ctx.boards.grand_match;
    const yaw = this.kidColor === "w" ? 0 : Math.PI;
    // camera and board first — the engine warm-up must never leave the level modal closing onto nothing
    await rig.boardView(board.group.position, yaw, 1.2);
    if (this.stale(g)) return;
    this.s.board.attach(this.ctx.r.renderer.domElement, this.ctx.r.camera);
    this.renderHud(0.5);
    if (!engine.isReady) { ui.say("🧐 Let me put on my glasses…"); world.chessPaa.mood = "think"; this.setThinking(true); }
    try { await engine.waitReady(); }
    catch (e) { console.warn("engine unavailable", e); if (!this.stale(g)) ui.say("My glasses are foggy today — let's just play!"); } // paaMove() falls back to a random legal move
    this.setThinking(false);
    if (this.stale(g)) return;
    ui.say(`${this.level.emoji} ChessPaa is feeling like a **${this.level.name}** today. ${this.kidColor === "w" ? "You're White — you go first!" : "You're Black — I'll start."}`);
    world.chessPaa.mood = "think";
    if (this.kidColor === "b") {
      await wait(1.0);
      if (this.stale(g)) return;
      await this.paaMove();
      if (this.stale(g)) return;
    }
    this.s.board.interactive = true;
  }

  private renderHud(smile: number) {
    const { ui } = this.ctx;
    ui.setHud(`
      <div class="pill smile-meter">😟 <div class="bar"><i style="width:${Math.round(smile * 100)}%"></i></div> 😄</div>
      <div class="pill">${this.level.emoji} ${this.level.name} · move ${Math.floor(this.moves / 2) + 1}</div>
      <div class="pill think${this.thinking ? " on" : ""}" id="pm-think">🧐 ChessPaa is thinking…</div>
      <div class="row">
        <button class="btn small teal" id="pm-hint">💡 Hint</button>
        <button class="btn small ghost" id="pm-undo">↩ Oops, undo</button>
        <button class="btn small ghost" id="pm-new">🔁 New game</button>
      </div>`);
    (document.getElementById("pm-hint") as HTMLButtonElement).onclick = () => this.hint();
    (document.getElementById("pm-undo") as HTMLButtonElement).onclick = () => this.undo();
    (document.getElementById("pm-new") as HTMLButtonElement).onclick = () => { if (this.thinking) return; this.ctx.ui.hideModal(); this.chooseLevel(); };
  }
  /** The "thinking" flag also drives a HUD pill, so a cold engine start never looks like a hang. */
  private setThinking(on: boolean) { this.thinking = on; document.getElementById("pm-think")?.classList.toggle("on", on); }

  private async onKidMove(m: Move) {
    const { ui, world, sound, engine } = this.ctx;
    const g = this.game;
    this.moves++;
    this.s.board.interactive = false;
    this.setThinking(true);
    world.chessPaa.mood = "think";
    let verdict: Verdict | null = null;
    try { verdict = await judgeMove(engine, m.before, m, 12, this.level.skill >= 9 ? 900 : 600); } catch (e) { console.warn("judge failed", e); }
    if (this.stale(g)) return;
    if (verdict) {
      const smile = evalToSmile(verdict.evalAfter, this.kidColor === "w");
      this.renderHud(smile);
      if (verdict.showSquares.length) this.s.board.glow(verdict.showSquares, verdict.tier === "great" || verdict.tier === "brilliant" ? 0x35d07f : 0xff8a65);
      const dur = ui.say(`${verdict.emoji} **${verdict.title}** ${verdict.explanation}${verdict.suggestion ? " " + verdict.suggestion : ""}`);
      world.chessPaa.say(dur);
      if (verdict.tier === "great" || verdict.tier === "brilliant") sound.great(); else if (verdict.tier === "good") sound.good(); else if (verdict.tier === "careful" || verdict.tier === "oops") sound.oops();
      world.chessPaa.mood = verdict.tier === "great" || verdict.tier === "brilliant" ? "cheer" : "talk";
      world.kids.forEach((k) => (k.mood = verdict!.tier === "great" || verdict!.tier === "brilliant" ? "cheer" : "sit"));
      await wait(Math.min(2.2, dur * 0.35));
      if (this.stale(g)) return;
    }
    // stays "thinking" through the verdict pause so Undo/New game can't slip in between the kid's move and ChessPaa's reply
    this.setThinking(false);
    if (this.checkEnd()) return;
    await this.paaMove();
  }

  private async paaMove() {
    const { engine, ui, world } = this.ctx;
    if (this.over) return;
    const g = this.game;
    this.setThinking(true);
    world.chessPaa.mood = "think";
    const fen = this.s.chess.fen();
    let uci: string | null = null;
    try {
      // the level's Skill Level shapes bestmove; the multipv lines stay honest, so a "slip" is
      // picked among real candidate moves within `slack` pawns of the best — small, plausible mistakes
      const ev = await engine.evaluate(fen, { movetime: this.level.movetime, multipv: 4, skill: this.level.skill });
      const lines = ev.lines.filter((l) => l.cp !== null || l.mate !== null);
      const val = (l: EngineLine) => (l.mate !== null ? Math.sign(l.mate) * 50 : (l.cp ?? 0) / 100); // side-to-move view
      const best = lines[0];
      uci = ev.bestMove;
      if (best && this.level.wobble > 0 && Math.random() < this.level.wobble) {
        const cands = lines.slice(1).filter((l) => val(best) - val(l) <= this.level.slack);
        if (cands.length) uci = pick(cands).move;
      }
    } catch (e) { console.warn("engine move failed", e); }
    if (this.stale(g)) return;
    if (!uci) { const legal = this.s.chess.moves({ verbose: true }); if (!legal.length) { this.checkEnd(); return; } const m = pick(legal); uci = m.from + m.to + (m.promotion ?? ""); }
    const preview = moveFromUci(this.s.chess, uci);
    if (this.moves % 3 === 0 && preview) { ui.say(`${pick(PAA_MOVES)} ${describeMove(preview)}.`); }
    await wait(0.4);
    if (this.stale(g)) return;
    await this.s.playUci(uci);
    if (this.stale(g)) return;
    this.moves++;
    this.setThinking(false);
    this.s.board.glow([]);
    world.chessPaa.mood = "idle";
    if (this.checkEnd()) return;
    this.s.board.interactive = true;
  }

  private checkEnd(): boolean {
    const c = this.s.chess; const { ui, progress, sound, world } = this.ctx;
    if (!c.isGameOver()) return false;
    this.over = true;
    this.s.board.interactive = false;
    let title = "", text = "", stars = 1;
    if (c.isCheckmate()) {
      const kidWon = c.turn() !== this.kidColor;
      title = kidWon ? "🏆 CHECKMATE — You win!" : "😅 Checkmate — ChessPaa wins";
      text = kidWon ? "You trapped my king! I am so proud I could burst my suspenders." : "I got you this time! Every game teaches something — shall we go again?";
      stars = kidWon ? 3 : 1;
      world.chessPaa.mood = kidWon ? "cheer" : "wave";
      world.kids.forEach((k) => (k.mood = kidWon ? "cheer" : "idle"));
    } else if (c.isStalemate()) { title = "🤝 Stalemate!"; text = "Nobody can move — it's a draw. Sneaky!"; stars = 2; }
    else { title = "🤝 It's a draw!"; text = "Neither of us could win this one."; stars = 2; }
    progress.addStar("grand_match", stars); progress.addTicket(1); ui.setStars(progress.stars); ui.setTickets(progress.tickets);
    sound.fanfare();
    ui.showModal(`<h1>${title}</h1><div class="stars-big">${"⭐".repeat(stars)}${"☆".repeat(3 - stars)}</div><p>${text}</p>
      <div class="row"><button class="btn teal" id="pm-again">🔁 Play again</button><button class="btn" id="pm-park">🎢 Back to the park</button></div>`);
    (document.getElementById("pm-again") as HTMLButtonElement).onclick = () => { ui.hideModal(); this.chooseLevel(); };
    (document.getElementById("pm-park") as HTMLButtonElement).onclick = () => { ui.hideModal(); this.ctx.exit(); };
    return true;
  }

  private async hint() {
    if (this.thinking || this.over || !this.s.humanToMove()) return;
    const { engine, ui } = this.ctx;
    const g = this.game;
    this.ctx.sound.click();
    ui.say("Let me peek… 🧐");
    const r = await engine.evaluate(this.s.chess.fen(), { depth: 12 });
    if (this.stale(g) || !this.s.humanToMove()) return; // the kid moved (or left) while we were peeking
    // lines[0] is the true best line; bestMove is what Skill Level would have played
    const best = r.lines[0]?.move ?? r.bestMove;
    const m = best ? moveFromUci(this.s.chess, best) : null;
    if (!m) return;
    this.s.board.hint(m.from);
    this.s.board.glow([m.to], 0x2ec4c6);
    ui.say(`Psst… look at your **${describeMove(m).split(" ")[0]}**. ${describeMove(m)} looks strong to me.`);
  }

  private async undo() {
    // humanToMove() also blocks the promotion picker (locked) and the gap before paaMove() re-arms `thinking`
    if (this.thinking || this.over || !this.s.humanToMove() || this.s.chess.turn() !== this.kidColor) return;
    if (this.s.chess.history().length < 2) { this.ctx.ui.toast("Nothing to take back yet!"); return; } // a kid playing Black can't undo ChessPaa's opener alone
    const g = this.game;
    this.ctx.sound.click();
    this.s.board.interactive = false;
    this.s.board.clearHighlights(); // drop a stale hint marker
    const a = await this.s.undo();           // ChessPaa's reply
    if (this.stale(g)) return;
    const b = a ? await this.s.undo() : null; // the kid's move
    if (this.stale(g)) return;
    this.moves = this.s.chess.history().length;
    void b;
    this.s.board.glow([]);
    this.renderHud(0.5);
    this.ctx.ui.say("No problem! Everybody gets a do-over at ChessPaa's park.");
    this.s.board.interactive = true;
  }

  update(dt: number, t: number) { this.s.board.pulse(t); }
}
