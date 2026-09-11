import { Chess, Move, Square } from "chess.js";
import { ModeContext, Mode, wait, pick } from "./Context";
import { BoardSession } from "./BoardSession";
import { LESSONS, PieceLesson } from "../content/Rhymes";

/**
 * The Piece Academy: pick a piece, hear its rhyme line by line while the board
 * acts it out, then try it yourself.
 */
export class AcademyMode implements Mode {
  private s: BoardSession;
  private lesson: PieceLesson | null = null;
  private line = 0;
  private audio: HTMLAudioElement | null = null;
  private inTryIt = false;
  constructor(private ctx: ModeContext) { this.s = ctx.session("academy"); }

  async enter() {
    const { ui, world } = this.ctx;
    world.placeCast("academy");
    this.s.load("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    this.s.board.interactive = false;
    ui.say("Welcome to the **Piece Academy**! Every piece has its own little song. Pick one and I'll tell you all about it.");
    this.showMenu();
  }

  exit() {
    this.stopSong();
    this.lesson = null; this.inTryIt = false; // showLine()/tryIt() continuations compare against these and bail
    this.s.onHumanMove = undefined; this.s.pickFilter = undefined;
    this.s.board.interactive = false; this.s.board.clearHighlights(); this.s.board.detach();
    this.ctx.ui.hidePanel(); this.ctx.ui.clearHud();
  }

  private showMenu() {
    const { ui, progress } = this.ctx;
    const el = ui.showPanel(`<h2><span class="emoji">🏰</span>Piece Academy</h2><p>Tap a piece to hear its rhyme.</p><div class="cards">${LESSONS.map((L) => `
      <button class="card" data-p="${L.piece}"><div class="big">${L.emoji}</div><div class="name">${L.name}</div><div class="sub">${L.rhyme[0]}</div><div class="stars">${"⭐".repeat(Math.min(3, progress.starsFor("academy:" + L.piece)))}</div></button>`).join("")}</div>`);
    el.querySelectorAll<HTMLButtonElement>(".card").forEach((b) => { b.onclick = () => { this.ctx.sound.click(); this.startLesson(LESSONS.find((L) => L.piece === b.dataset.p)!); }; });
  }

  private startLesson(L: PieceLesson) {
    this.lesson = L; this.line = 0; this.inTryIt = false;
    this.ctx.ui.hidePanel();
    this.ctx.world.chessPaa.mood = "talk";
    this.showLine();
  }

  private stopSong() { if (this.audio) { this.audio.pause(); this.audio = null; } }

  private async showLine() {
    const L = this.lesson!; const { ui, world } = this.ctx;
    const beat = L.beats[this.line];
    this.s.load(beat.fen);
    this.s.board.glow(beat.glow, 0xffd23c);
    const actions = [];
    const last = this.line >= L.rhyme.length - 1;
    actions.push({ label: last ? "Try it yourself! ➜" : "Next line ➜", onClick: () => { this.ctx.sound.click(); if (last) this.tryIt(); else { this.line++; this.showLine(); } }, kind: "sun" as const });
    if (this.line > 0) actions.push({ label: "◀ Back", onClick: () => { this.line--; this.showLine(); }, kind: "ghost" as const });
    if (L.song) actions.push({ label: this.audio ? "⏹ Stop song" : "🎵 Play the song", onClick: () => { if (this.audio) { this.stopSong(); } else { this.audio = new Audio(this.ctx.base + L.song); this.audio.volume = 0.7; this.audio.play().catch(() => {}); } this.showLine(); }, kind: "teal" as const });
    actions.push({ label: "🏰 Other pieces", onClick: () => { this.stopSong(); this.s.board.clearHighlights(); this.showMenu(); }, kind: "ghost" as const });
    const dur = ui.say(`**${L.rhyme[this.line]}**  ${beat.note}`, actions, `ChessPaa · ${L.emoji} ${L.name} (${this.line + 1}/${L.rhyme.length})`);
    world.chessPaa.say(dur);
    ui.setHud(`<div class="rhyme">${L.rhyme.map((r, i) => `<span class="line ${i === this.line ? "on" : ""}">${r}</span>`).join("")}</div>`);
    if (beat.from && beat.to) {
      await wait(0.9);
      if (this.lesson !== L || this.line !== L.beats.indexOf(beat)) return;
      this.s.locked = true;
      await this.s.play({ from: beat.from, to: beat.to });
      this.s.locked = false;
      this.s.board.glow(beat.glow, 0xffd23c);
    }
  }

  private tryIt() {
    const L = this.lesson!; const { ui, world } = this.ctx;
    this.inTryIt = true;
    this.s.load(L.tryIt.fen);
    this.s.playerColor = "w";
    this.s.pickFilter = (sq) => sq === L.tryIt.piece;
    this.s.board.glow(L.tryIt.targets, 0x35d07f);
    this.s.board.hint(L.tryIt.piece);
    this.s.board.interactive = true;
    this.s.board.attach(this.ctx.r.renderer.domElement, this.ctx.r.camera);
    ui.setHud(`<div class="pill">⭐ Land on a green square</div>`);
    world.chessPaa.mood = "think";
    ui.say(`Your turn! ${L.tryIt.goal}`, [{ label: "💡 Hint", onClick: () => ui.say(L.tryIt.hint, [], "ChessPaa · hint"), kind: "teal" }]);
    this.s.onHumanMove = async (m: Move) => {
      if (L.tryIt.targets.includes(m.to)) {
        this.ctx.sound.great();
        this.ctx.progress.addStar("academy:" + L.piece); this.ctx.progress.addStar("academy");
        ui.setStars(this.ctx.progress.stars);
        this.ctx.progress.addTicket(1); ui.setTickets(this.ctx.progress.tickets);
        setTimeout(() => this.ctx.sound.coin(), 350); // after the cheer
        world.chessPaa.mood = "cheer"; world.chessPaa.say(2.5);
        this.s.board.interactive = false; this.s.board.clearHighlights();
        const next = LESSONS[(LESSONS.indexOf(L) + 1) % LESSONS.length];
        ui.say(`${pick(["Perfect!", "That's it!", "Wonderful!"])} You've mastered the **${L.name}**! ⭐`, [
          { label: `Next: the ${next.name} ${next.emoji} ➜`, onClick: () => this.startLesson(next) },
          { label: "🏰 Pick another piece", onClick: () => this.showMenu(), kind: "ghost" },
          { label: "🎢 Back to the park", onClick: () => this.ctx.exit(), kind: "berry" },
        ]);
      } else {
        this.ctx.sound.oops();
        ui.say(pick(["Not quite — try a green square!", "Almost! Aim for the green squares.", "Nearly! Where can it really go?"]));
        await wait(0.7);
        if (this.lesson !== L || !this.inTryIt) return;
        await this.s.undo();
        if (this.lesson !== L || !this.inTryIt) return;
        this.s.board.glow(L.tryIt.targets, 0x35d07f);
        this.s.board.hint(L.tryIt.piece);
      }
    };
  }

  update(dt: number, t: number) { this.s.board.pulse(t); }
}
