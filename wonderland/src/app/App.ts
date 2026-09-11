import * as THREE from "three";
import { Renderer } from "../core/Renderer";
import { World } from "../world/World";
import { CameraRig } from "./CameraRig";
import { Assets } from "../core/Assets";
import { ATTRACTIONS, Attraction, AttractionId, byId } from "../world/Layout";
import { UI, Progress, Action } from "../ui/UI";
import { Sound } from "../audio/Sound";
import { Engine } from "../chess/Engine";
import { Board3D } from "../chess/Board3D";
import { BoardSession } from "../modes/BoardSession";
import { ModeContext, Mode, wait, pick } from "../modes/Context";
import { PuzzleMode } from "../modes/PuzzleMode";
import { AcademyMode } from "../modes/AcademyMode";
import { PlayMode } from "../modes/PlayMode";
import { RideMode } from "../modes/RideMode";
import { TACTIC_THEMES, ENDGAME_THEMES, tacticSet, endgameSet, rushSet, loadPuzzles } from "../modes/Puzzles";
import { heightAt } from "../world/Ground";
import { Atmosphere } from "../world/Atmosphere";
import { detectTheme, THEME_META, ThemeId } from "../core/WeatherDetect";

const GREETINGS = [
  "Welcome to my **Chess Wonderland**! Ride the coaster, spin the wheel, or come play a game with me.",
  "Ho ho! A new champion arrives! Tap any ride to hop in — or tap **Ride the coaster** for the grand tour.",
];

/** The director: owns the modes, the boards, the HUD, and the camera choreography. */
export class App {
  readonly ui: UI;
  readonly sound = new Sound();
  readonly engine = new Engine();
  readonly progress = new Progress();
  readonly boards = {} as Record<AttractionId, Board3D>;
  private sessions = {} as Record<AttractionId, BoardSession>;
  private labels: { el: HTMLElement; a: Attraction }[] = [];
  private mode: Mode | null = null;
  private ride: RideMode | null = null;
  private inHub = false;
  private time = 0;
  readonly ctx: ModeContext;
  /** the long welcome plays once per device; later visits get the short greeting */
  private greeted = (() => { try { return localStorage.getItem("cw.seen") === "1"; } catch { return false; } })();
  private panelShown = false;
  /** per-frame hook for the simple rides (train chug, carousel organ, wheel ding) — they aren't Modes */
  private rideTick: ((dt: number) => void) | null = null;
  /** re-entrancy guard for enter(): a held key or a double-tap must not queue several flights */
  private entering = false;
  /** transition generation — bumped on every mode/camera transition so stale async continuations can bail */
  private gen = 0;

  constructor(readonly r: Renderer, readonly world: World, readonly rig: CameraRig, readonly assets: Assets, readonly atmosphere: Atmosphere) {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    this.ui = new UI(base);
    this.ui.setStars(this.progress.stars); this.ui.setTickets(this.progress.tickets);
    this.ui.setMuted(this.sound.muted); this.ui.setQualityLabel(r.quality);
    this.ui.onHome = () => this.goHub();
    this.ui.onMute = () => this.ui.setMuted(this.sound.toggle());
    this.ui.onQuality = () => { const order = ["low", "medium", "high"] as const; const q = order[(order.indexOf(r.quality) + 1) % 3]; r.setQuality(q); this.ui.setQualityLabel(q); this.ui.toast(`Graphics: ${q}`); };
    r.onQualityChange = (q) => this.ui.setQualityLabel(q);
    this.ui.onTheme = (t) => this.setTheme(t, true);
    this.ui.setThemeLabel(atmosphere.current ?? "day", localStorage.getItem("cw.theme") === null || localStorage.getItem("cw.theme") === "auto");
    for (const a of ATTRACTIONS) {
      const b = new Board3D(assets, world.pieceGeos, world.pieceMats, 0.6, world.pieceGeosLod);
      b.group.position.copy(a.board.pos).setY(heightAt(a.board.pos.x, a.board.pos.z));
      b.group.rotation.y = a.board.yaw;
      world.group.add(b.group);
      this.boards[a.id] = b;
      const s = new BoardSession(b, this.ui, this.sound);
      s.load("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
      this.sessions[a.id] = s;
    }
    this.ctx = { r, world, rig, ui: this.ui, sound: this.sound, engine: this.engine, progress: this.progress, boards: this.boards, session: (id) => this.sessions[id], exit: () => this.exitMode(), base };
    // the engine starts lazily on first use so the park loads faster; warm it after the intro
    setTimeout(() => this.engine.waitReady().catch((e) => console.warn("Stockfish failed to start", e)), 6000);
    // the puzzle set is its own chunk; fetch it once the park is up so the first track opens instantly
    setTimeout(() => loadPuzzles().catch((e) => console.warn("Puzzle set failed to load", e)), 3000);
  }

  /** Slow drift over the park behind the title card. */
  preroll() {
    this.ui.root.style.opacity = "0";
    this.rig.lock();
    this.rig.camera.position.set(-40, 26, 120);
    this.rig.camera.lookAt(0, 6, -10);
    this.prerolling = true;
  }
  private prerolling = false;
  /** Manual pick (persisted) or auto from the clock + real weather. */
  async setTheme(t: ThemeId | "auto", manual = false) {
    if (manual) localStorage.setItem("cw.theme", t);
    if (t === "auto") {
      const { theme, source } = await detectTheme();
      await this.atmosphere.apply(theme);
      this.ui.setThemeLabel(theme, true);
      this.ui.toast(`${THEME_META[theme].emoji} ${THEME_META[theme].name} — from your ${source.startsWith("weather") ? "local weather" : "clock"}`);
      return;
    }
    await this.atmosphere.apply(t);
    this.ui.setThemeLabel(t, false);
    this.ui.toast(`${THEME_META[t].emoji} ${THEME_META[t].name}`);
  }
  start() { this.prerolling = false;
    if ((localStorage.getItem("cw.theme") ?? "auto") === "auto") setTimeout(() => this.setTheme("auto"), 2500); this.ui.root.style.transition = "opacity .8s"; this.ui.root.style.opacity = "1"; this.sound.click(); this.goHub(true); }

  /* ------------------------------------------------------------ hub */
  goHub(first = false) {
    this.setMode(null);
    const g = ++this.gen;
    this.rideTick = null;
    this.panelShown = false;
    this.r.shadowEveryN = 2; // static scenery: the shadow map can rest every other frame
    for (const k of Object.keys(this.boards) as AttractionId[]) { this.boards[k].setDetail(false); this.boards[k].interactive = false; this.boards[k].detach(); }
    this.ride?.exit(); this.ride = null;
    this.inHub = true;
    this.ui.clearAll(); this.ui.showHome(false);
    this.world.setShadowFocus(new THREE.Vector3(0, 0, -10), 150);
    this.r.requestShadowUpdate();
    // lower and closer than the old (0,46,108) "model shot": the gate arch sits at the bottom of the
    // frame between the bubble and the map, with the castle and wheel on the skyline
    const pose = new THREE.Vector3(0, 34, 118), look = new THREE.Vector3(0, 5, -16);
    const settle = () => { if (g === this.gen) this.rig.orbitAround(look.clone()); };
    if (first) {
      this.rig.camera.position.set(0, 60, 150);
      this.rig.flyTo(pose, look, 3.2).then(settle);
    } else {
      this.rig.flyTo(pose, look, 1.6).then(settle);
    }
    this.world.chessPaa.mood = "wave";
    setTimeout(() => { if (this.inHub) this.world.chessPaa.mood = "idle"; }, 4000);
    this.buildLabels();
    const actions: Action[] = [
      { label: "🎢 Ride the coaster tour", onClick: () => this.startRide() },
      { label: "🏎 Drive around", onClick: () => this.startDrive(), kind: "teal" },
      { label: "♟️ Play with ChessPaa", onClick: () => this.enter("grand_match"), kind: "berry" },
    ];
    if (this.progress.tickets >= 5) actions.push({ label: "🎆 Fireworks show (5 🎟)", onClick: () => this.fireworksShow(), kind: "ghost" });
    const dur = this.ui.say(this.greeted ? pick(["Where to next, champion?", "Pick a ride — or take the whole tour!"]) : pick(GREETINGS), actions);
    this.world.chessPaa.say(dur);
    if (!this.greeted) { this.greeted = true; try { localStorage.setItem("cw.seen", "1"); } catch { /* ignore */ } }
    if (first) {
      // first screen: let the park breathe while ChessPaa speaks — the map slides in when he's
      // done, or the moment the child touches the world
      const reveal = () => { if (this.inHub && !this.panelShown && g === this.gen) this.showHubPanel(); };
      setTimeout(reveal, dur * 1000);
      this.r.renderer.domElement.addEventListener("pointerdown", reveal, { once: true });
    } else this.showHubPanel();
  }

  private showHubPanel() {
    this.panelShown = true;
    this.ui.showPanel(`<h2><span class="emoji">🗺️</span>Park map</h2><p>Tap an attraction to hop in.</p><div class="cards">${ATTRACTIONS.map((a) => `<button class="card" data-id="${a.id}"><div class="big">${a.emoji}</div><div class="name">${a.name}</div><div class="sub">${a.tagline}</div><div class="stars">${"⭐".repeat(Math.min(5, this.progress.starsFor(a.id)))}</div></button>`).join("")}</div>
      <p class="divider">Just for fun</p>
      <div class="row"><button class="btn small teal" id="hub-ferris">🎡 Ride the wheel</button><button class="btn small teal" id="hub-train">🚂 Ride the train</button><button class="btn small teal" id="hub-carousel">🎠 Carousel</button></div>`);
    this.ui.panelEl().querySelectorAll<HTMLButtonElement>(".card").forEach((b) => { b.onclick = () => { this.sound.click(); this.enter(b.dataset.id as AttractionId); }; });
    (document.getElementById("hub-ferris") as HTMLButtonElement).onclick = () => this.rideFerris();
    (document.getElementById("hub-train") as HTMLButtonElement).onclick = () => this.rideTrain();
    (document.getElementById("hub-carousel") as HTMLButtonElement).onclick = () => this.rideCarousel();
  }

  /** The ticket sink: five tickets buy a fireworks show over the plaza. */
  private fireworksShow() {
    if (this.progress.tickets < 5) return;
    this.progress.addTicket(-5); this.ui.setTickets(this.progress.tickets);
    this.sound.fanfare();
    this.world.fireworks.show(8);
    this.ui.say(pick(["Ooooh! Look up, everybody!", "Fireworks over the Wonderland — you earned every spark!"]), this.progress.tickets >= 5 ? [{ label: "🎆 Again! (5 🎟)", onClick: () => this.fireworksShow(), kind: "ghost" }] : []);
  }

  private buildLabels() {
    if (this.labels.length) { this.labels.forEach((l) => (l.el.style.display = "")); return; }
    for (const a of ATTRACTIONS) {
      const el = document.createElement("div");
      el.className = "label3d";
      el.innerHTML = `<span class="e">${a.emoji}</span>${a.name}`;
      el.onclick = () => { this.sound.click(); this.enter(a.id); };
      this.ui.root.appendChild(el);
      this.labels.push({ el, a });
    }
  }
  private hideLabels() { this.labels.forEach((l) => (l.el.style.display = "none")); }

  /* ------------------------------------------------------------ modes */
  private setMode(m: Mode | null) {
    this.gen++;
    this.mode?.exit();
    this.mode = m;
    if (m) { this.inHub = false; this.hideLabels(); this.ui.hidePanel(); this.ui.showHome(true); m.enter(); }
  }

  /** Enter an attraction (from the hub or from the ride). */
  async enter(id: AttractionId, fromRide = false) {
    if (this.entering) return;
    this.entering = true;
    if (this.mode) this.setMode(null); // e.g. leaving DriveMode: unseats the kid, drops key listeners, clears the drive HUD
    const g = ++this.gen;
    this.rideTick = null;
    this.r.shadowEveryN = 1; // moving pieces want per-frame shadows; the pass is only ~120 draws in a board view
    try {
      const a = byId(id);
      for (const k of Object.keys(this.boards) as AttractionId[]) this.boards[k].setDetail(k === id);
      this.inHub = false; this.hideLabels(); this.ui.hidePanel(); this.ui.showHome(true);
      this.world.setShadowFocus(a.board.pos, 26);
      this.r.requestShadowUpdate();
      if (this.ride && !fromRide) { this.ride.exit(); this.ride = null; }
      if (id === "grand_match") {
        // start the 7 MB engine fetch on intent, and frame the board behind the level picker —
        // neither is awaited, or the modal would trail the tap by seconds
        void this.engine.waitReady().catch(() => {});
        void this.rig.boardView(this.boards[id].group.position, a.board.yaw, 1.6);
      } else await this.rig.boardView(this.boards[id].group.position, a.board.yaw, 1.8);
    } finally {
      this.entering = false;
    }
    if (g !== this.gen) return; // Home (or another transition) happened mid-flight
    switch (id) {
      case "academy": this.setMode(new AcademyMode(this.ctx)); break;
      case "grand_match": this.setMode(new PlayMode(this.ctx)); break;
      case "tactics": this.chooseTactics(); break;
      case "endgame": this.chooseEndgames(); break;
      case "train": await this.startRush(); break;
    }
  }

  private chooseTactics() {
    this.world.placeCast("tactics");
    this.ui.say("Welcome to the **Tactics Coaster**! Forks, pins, skewers… every puzzle is a little loop-the-loop for your brain. Pick a track!");
    const el = this.ui.showPanel(`<h2><span class="emoji">🎢</span>Tactics tracks</h2><p>Each track is 8 puzzles.</p><div class="cards">${TACTIC_THEMES.map((t) => `<button class="card" data-k="${t.key}"><div class="big">${t.emoji}</div><div class="name">${t.name}</div><div class="sub">${t.blurb}</div><div class="stars">${"⭐".repeat(Math.min(5, this.progress.starsFor("tactics")))}</div></button>`).join("")}</div>`);
    el.querySelectorAll<HTMLButtonElement>(".card").forEach((b) => { b.onclick = async () => {
      const t = TACTIC_THEMES.find((x) => x.key === b.dataset.k)!;
      const g = this.gen;
      const puzzles = await tacticSet(t.key, 8);
      if (g !== this.gen) return; // Home while the set loaded, or a second tap already started the track
      if (!puzzles.length) { this.ui.toast("No puzzles loaded for that track yet"); return; }
      this.sound.click();
      this.setMode(new PuzzleMode(this.ctx, { attraction: "tactics", title: t.name, intro: `${t.emoji} **${t.name}** — ${t.blurb}. Let's ride!`, puzzles }));
    }; });
  }

  private chooseEndgames() {
    this.world.placeCast("endgame");
    this.ui.say("The **Endgame Ferris Wheel**! Winning a won game is a skill. Solve three, and we'll ride to the top together.");
    const el = this.ui.showPanel(`<h2><span class="emoji">🎡</span>Endgame cabins</h2><p>8 puzzles per cabin — a wheel ride every 3 solves.</p><div class="cards">${ENDGAME_THEMES.map((t) => `<button class="card" data-k="${t.key}"><div class="big">${t.emoji}</div><div class="name">${t.name}</div><div class="sub">${t.blurb}</div></button>`).join("")}</div>`);
    el.querySelectorAll<HTMLButtonElement>(".card").forEach((b) => { b.onclick = async () => {
      const t = ENDGAME_THEMES.find((x) => x.key === b.dataset.k)!;
      const g = this.gen;
      const puzzles = await endgameSet(t.key, 8);
      if (g !== this.gen) return;
      if (!puzzles.length) { this.ui.toast("No puzzles loaded for that cabin yet"); return; }
      this.sound.click();
      this.setMode(new PuzzleMode(this.ctx, { attraction: "endgame", title: t.name, intro: `${t.emoji} **${t.name}** — ${t.blurb}.`, puzzles, onSolved: async (n) => { if (n % 3 === 0) await this.ferrisBreak(); } }));
    }; });
  }

  private async startRush() {
    const g = this.gen;
    const puzzles = await rushSet(40);
    if (g !== this.gen) return;
    if (!puzzles.length) { this.ui.toast("No puzzles loaded yet"); return; }
    this.setMode(new PuzzleMode(this.ctx, { attraction: "train", title: "Puzzle Train", intro: "🚂 **Puzzle Train!** Solve puzzles to fill the carriages. Three hearts, five minutes — how far can you go?", puzzles, rush: { lives: 3, seconds: 300 }, onSolved: async (n) => { if (n % 4 === 0) await this.trainBreak(); } }));
  }

  private exitMode() {
    if (this.ride) { // back onto the coaster — RideMode.enter() speaks the "back on board" line itself, from the station we left
      this.setMode(null);
      this.r.shadowEveryN = 1;
      this.ui.clearAll(); this.ui.showHome(true);
      this.ride.enter();
      return;
    }
    this.goHub();
  }

  /* ------------------------------------------------------------ rides */
  startRide() {
    this.setMode(null);
    this.gen++;
    this.rideTick = null;
    this.r.shadowEveryN = 1; // the camera rides a moving caster
    this.ui.clearAll(); this.hideLabels(); this.inHub = false;
    this.ride = new RideMode(this.ctx);
    this.ride.onStation = (id) => { this.enter(id, true); };
    this.ride.enter();
  }

  async startDrive() {
    // cannon-es + the kart only load when someone actually drives
    const g = this.gen;
    const { DriveMode } = await import("../modes/DriveMode");
    if (g !== this.gen) return;
    this.r.shadowEveryN = 1;
    this.setMode(new DriveMode(this.ctx, (id) => this.enter(id)));
  }

  /** Sit in a Ferris gondola for one gentle turn. */
  private async ferrisBreak() {
    const { world, rig, ui, sound } = this.ctx;
    const gen = this.gen; // runs inside PuzzleMode — no bump; Home mid-ride must not fly us back to the board
    const g = world.ferris.gondolas[0];
    const seat = new THREE.Object3D(); seat.position.set(0, -1.05, 0.55); g.add(seat);
    this.r.shadowEveryN = 1;
    try {
      rig.sitIn(seat, new THREE.Vector3(0, -0.15, 6));
      world.setShadowFocus(new THREE.Vector3(0, 0, -10), 160);
      this.rideTick = this.wheelTick(sound);
      ui.say(pick(["Three solved! Up we go — look at the whole Wonderland!", "Ride break! From the top you can see every tower and tent."]));
      await wait(9);
      if (gen !== this.gen) return;
      ui.say(pick(["Down we come. Ready for the next one?", "What a view! Back to the puzzles."]));
      await wait(4);
      if (gen !== this.gen) return;
      this.rideTick = null;
      const a = byId("endgame");
      world.setShadowFocus(a.board.pos, 26);
      await rig.boardView(this.boards.endgame.group.position, a.board.yaw, 1.6);
    } finally { seat.parent?.remove(seat); }
  }
  private async trainBreak() {
    const { world, rig, ui, sound } = this.ctx;
    const gen = this.gen;
    const car = world.train.cars[1];
    const seat = new THREE.Object3D(); seat.position.set(0, 1.9, 0.9); car.add(seat);
    this.r.shadowEveryN = 1;
    try {
      rig.sitIn(seat, new THREE.Vector3(0, -0.2, -6));
      world.setShadowFocus(new THREE.Vector3(0, 0, -10), 160);
      this.rideTick = this.trainTick(sound);
      ui.say(pick(["Toot toot! Four carriages full — enjoy a lap around the park!", "Choo choo! You earned a ride."]));
      await wait(11);
      if (gen !== this.gen) return;
      this.rideTick = null;
      const a = byId("train");
      world.setShadowFocus(a.board.pos, 26);
      await rig.boardView(this.boards.train.group.position, a.board.yaw, 1.6);
    } finally { seat.parent?.remove(seat); }
  }
  /** Ride audio for the rides that aren't Modes: closures called from update() with dt. */
  private trainTick(sound: Sound) { let t = 0; return (dt: number) => { t += dt; if (t > 0.45 && this.world.train.v > 0.5) { t = 0; sound.chug(); } }; }
  private wheelTick(sound: Sound) { let t = 10; return (dt: number) => { t += dt; if (t > 12) { t = 0; sound.ding(); } }; }
  private carouselTick(sound: Sound) {
    const notes = [523, 659, 784, 1046, 784, 659, 523, 659]; let t = 0, i = 0; // C5 E5 G5 C6 G5 E5 C5 E5
    return (dt: number) => { t += dt; if (t > 0.3) { t = 0; sound.carouselNote(notes[i++ % notes.length]); } };
  }
  private beginRide() {
    this.setMode(null); this.ui.clearAll(); this.hideLabels(); this.inHub = false; this.ui.showHome(true);
    this.rideTick = null;
    this.r.shadowEveryN = 1;
    return ++this.gen;
  }
  async rideFerris() {
    const g0 = this.beginRide();
    const { world, rig, ui, sound } = this.ctx;
    const g = world.ferris.gondolas[3];
    const seat = new THREE.Object3D(); seat.position.set(0, -1.05, 0.55); g.add(seat);
    await rig.flyTo(g.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0, 12)), g.getWorldPosition(new THREE.Vector3()), 1.8);
    if (g0 !== this.gen) { seat.parent?.remove(seat); return; }
    rig.sitIn(seat, new THREE.Vector3(0, -0.15, 6));
    world.setShadowFocus(new THREE.Vector3(0, 0, -10), 160);
    this.rideTick = this.wheelTick(sound);
    ui.say("Round and round on the Endgame Wheel! Drag to look around — and when you're ready to come down, tap the button.", [{ label: "🎡 Hop off", onClick: () => { g.remove(seat); this.goHub(); } }]);
  }
  async rideTrain() {
    const g = this.beginRide();
    const { world, rig, ui, sound } = this.ctx;
    const car = world.train.cars[1];
    const seat = new THREE.Object3D(); seat.position.set(0, 1.9, 0.9); car.add(seat);
    await rig.flyTo(car.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(6, 4, 6)), car.getWorldPosition(new THREE.Vector3()), 1.8);
    if (g !== this.gen) { seat.parent?.remove(seat); return; }
    rig.sitIn(seat, new THREE.Vector3(0, -0.2, -6));
    world.setShadowFocus(new THREE.Vector3(0, 0, -10), 160);
    this.rideTick = this.trainTick(sound);
    ui.say("All aboard the Puzzle Train! Chug-a-chug around the whole park.", [{ label: "🚂 Hop off", onClick: () => { car.remove(seat); this.goHub(); } }]);
  }
  async rideCarousel() {
    const g = this.beginRide();
    const { world, rig, ui, sound } = this.ctx;
    const k = world.carousel.group.children[1].children.find((c) => (c as THREE.Mesh).geometry === world.pieceGeosLod.knight) as THREE.Object3D; // the carousel is built from the LOD knight (World.ts)
    const seat = new THREE.Object3D(); seat.position.set(0, 1.4, 0.2); (k ?? world.carousel.group).add(seat);
    await rig.flyTo(world.carousel.group.position.clone().add(new THREE.Vector3(0, 6, 14)), world.carousel.group.position.clone().setY(3), 1.6);
    if (g !== this.gen) { seat.parent?.remove(seat); return; }
    rig.sitIn(seat, new THREE.Vector3(0, 0, 6));
    world.setShadowFocus(world.carousel.group.position, 40);
    this.rideTick = this.carouselTick(sound);
    ui.say("Giddy-up! Ride the knight on the carousel. Knights love to go round in L-shapes… and circles!", [{ label: "🎠 Hop off", onClick: () => { seat.parent?.remove(seat); this.goHub(); } }]);
  }

  /* ------------------------------------------------------------ frame */
  update(dt: number) {
    this.time += dt;
    if (this.prerolling) { const c = this.rig.camera; c.position.x += dt * 1.6; c.position.z -= dt * 0.4; c.lookAt(0, 6, -10); }
    this.rideTick?.(dt);
    try { this.mode?.update?.(dt, this.time); this.ride?.update?.(dt, this.time); }
    catch (e) { if (!(this as any)._loggedErr) { console.error("mode update failed", e); (this as any)._loggedErr = true; } }
    if (this.inHub) {
      const cam = this.r.camera;
      const v = new THREE.Vector3();
      for (const { el, a } of this.labels) {
        v.copy(a.anchor).project(cam);
        const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        el.style.display = visible ? "block" : "none";
        if (visible) { el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`; el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`; }
      }
    }
  }
}
