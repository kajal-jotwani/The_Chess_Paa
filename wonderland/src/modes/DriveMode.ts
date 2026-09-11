import * as THREE from "three";
import { ModeContext, Mode } from "./Context";
import { Playground } from "../world/Kart";
import { ATTRACTIONS, AttractionId } from "../world/Layout";

/** Free-roam driving: WASD / arrows, or the on-screen pad. Drive into an attraction to enter it. */
export class DriveMode implements Mode {
  private pg: Playground;
  private keys = new Set<string>();
  private near: AttractionId | null = null;
  /** edge-triggered so a held key fires once, not once per frame */
  private wantEnter = false;
  private wantReset = false;
  /** set once we've handed off to App.enter(): the kart coasts to a stop and the chase cam lets the fly-to play */
  private entering = false;
  /** attractions ChessPaa has already announced this drive — the pill still updates every crossing */
  private announced = new Set<AttractionId>();
  private fine = matchMedia("(pointer: fine)").matches;
  private onKey = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (e.type === "keydown") {
      this.keys.add(key);
      if (!e.repeat && key === "e") this.wantEnter = true;
      if (!e.repeat && key === "r") this.wantReset = true;
    } else this.keys.delete(key);
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) e.preventDefault();
  };
  private pad = { f: 0, s: 0, b: 0 };
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private bumpAt = 0;
  constructor(private ctx: ModeContext, private onEnter: (id: AttractionId) => void) {
    if (!(ctx.world as any).playground) (ctx.world as any).playground = new Playground(ctx.world);
    this.pg = (ctx.world as any).playground;
    if (!this.pg.group.parent) ctx.world.group.add(this.pg.group);
  }

  enter() {
    const { ui, world, rig } = this.ctx;
    window.addEventListener("keydown", this.onKey); window.addEventListener("keyup", this.onKey);
    this.pg.reset(0, 44);
    this.pg.seatDriver(world.kids[0].root);
    world.kids[0].mood = "sit";
    rig.lock();
    this.entering = false; this.wantEnter = false; this.wantReset = false; this.announced.clear();
    this.camPos.copy(this.pg.position()).add(new THREE.Vector3(0, 4, -8));
    world.setShadowFocus(this.pg.position(), 60);
    const touch = matchMedia("(pointer: coarse)").matches;
    ui.say(touch
      ? "Take the **Rook Rover** for a spin! Use the arrows at the bottom to drive. Knock over the pawn pins, bump the beach balls — and drive up to any ride to hop in."
      : "Take the **Rook Rover** for a spin! Arrow keys or WASD to drive. Knock over the pawn pins, bump the beach balls — and drive up to any ride to hop in.");
    ui.setHud(`
      <div class="pill" id="drv-near" style="display:none"></div>
      <div class="row" style="justify-content:flex-end"><button class="btn small berry" id="drv-reset">↺ Flip me</button></div>`);
    // the pad lives in its own strip at the bottom: steering under the left thumb, throttle under the right,
    // and (on phones) the speech bubble is lifted above it instead of covering the ▲ button
    const padEl = document.createElement("div");
    padEl.className = "drive-pad"; padEl.id = "drive-pad";
    padEl.innerHTML = `
      <div class="cluster"><button class="btn icon-btn ghost" id="pad-l">◀</button><button class="btn icon-btn ghost" id="pad-r">▶</button></div>
      <div class="cluster"><button class="btn icon-btn ghost" id="pad-b">▼</button><button class="btn icon-btn teal" id="pad-f">▲</button></div>`;
    ui.root.appendChild(padEl);
    ui.root.classList.add("driving");
    const bind = (id: string, on: () => void, off: () => void) => {
      const el = document.getElementById(id)!;
      el.onpointerdown = (e) => { e.preventDefault(); on(); };
      el.onpointerup = el.onpointerleave = el.onpointercancel = () => off();
      el.oncontextmenu = (e) => e.preventDefault(); // no iOS long-press callout on a held button
    };
    bind("pad-l", () => (this.pad.s = 1), () => (this.pad.s = 0));
    bind("pad-r", () => (this.pad.s = -1), () => (this.pad.s = 0));
    bind("pad-f", () => (this.pad.f = 1), () => (this.pad.f = 0));
    bind("pad-b", () => (this.pad.f = -1), () => (this.pad.f = 0));
    (document.getElementById("drv-reset") as HTMLButtonElement).onclick = () => this.pg.reset(this.pg.position().x, this.pg.position().z);
  }

  exit() {
    window.removeEventListener("keydown", this.onKey); window.removeEventListener("keyup", this.onKey);
    this.keys.clear();
    this.pg.input = { forward: 0, steer: 0, brake: 0 };
    this.pg.unseatDriver();
    const { world, ui } = this.ctx;
    world.group.add(world.kids[0].root); world.kids[0].mood = "idle"; world.placeCast("grand_match");
    ui.root.classList.remove("driving");
    document.getElementById("drive-pad")?.remove();
    ui.clearHud();
  }

  private tryEnter(id: AttractionId) {
    if (this.entering) return;
    this.entering = true;
    this.keys.clear(); this.pad = { f: 0, s: 0, b: 0 };
    this.onEnter(id);
  }

  update(dt: number) {
    if (this.entering) {
      // hand-off in progress: brake gently, keep physics syncing, but stop driving the camera so
      // the rig's cinematic fly-to (which runs before us in the frame) is what the player sees
      this.pg.input = { forward: 0, steer: 0, brake: 1 };
      this.pg.update(dt);
      return;
    }
    const k = this.keys;
    const f = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0) + this.pad.f;
    const s = (k.has("a") || k.has("arrowleft") ? 1 : 0) - (k.has("d") || k.has("arrowright") ? 1 : 0) + this.pad.s;
    this.pg.input.forward = THREE.MathUtils.clamp(f, -1, 1);
    this.pg.input.steer = THREE.MathUtils.clamp(s, -1, 1);
    this.pg.input.brake = k.has(" ") ? 1 : (f === 0 ? 0.08 : 0);
    if (this.wantReset) { this.wantReset = false; this.pg.reset(this.pg.position().x, this.pg.position().z); }
    const speedBefore = this.pg.speed();
    this.pg.update(dt);
    // a sudden speed loss means we hit something — one thud, throttled so a pin cluster doesn't stack a dozen
    if (speedBefore - this.pg.speed() > 2.5 && performance.now() - this.bumpAt > 120) { this.bumpAt = performance.now(); this.ctx.sound.bump(); }
    // chase camera
    const pos = this.pg.position(), fwd = this.pg.forward();
    const target = pos.clone().addScaledVector(fwd, -7.5).add(new THREE.Vector3(0, 3.6, 0));
    this.camPos.lerp(target, 1 - Math.exp(-dt * 4));
    this.camLook.lerp(pos.clone().addScaledVector(fwd, 3).add(new THREE.Vector3(0, 0.8, 0)), 1 - Math.exp(-dt * 8));
    const cam = this.ctx.r.camera;
    cam.position.copy(this.camPos); cam.lookAt(this.camLook);
    // attraction proximity
    let near: AttractionId | null = null;
    for (const a of ATTRACTIONS) if (pos.distanceTo(a.board.pos) < 9) near = a.id;
    if (near !== this.near) {
      this.near = near;
      const el = document.getElementById("drv-near");
      if (el) {
        if (near) {
          const a = ATTRACTIONS.find((x) => x.id === near)!;
          el.style.display = "";
          el.innerHTML = `${a.emoji} <b>${a.name}</b> &nbsp;<button class="btn small" id="drv-go">Hop in ➜</button>${this.fine ? ' <span class="kbd">E</span>' : ""}`;
          (document.getElementById("drv-go") as HTMLButtonElement).onclick = () => this.tryEnter(a.id);
          // announce each attraction once, and never talk over ChessPaa mid-sentence
          if (!this.announced.has(near) && !this.ctx.ui.isTyping()) { this.announced.add(near); this.ctx.ui.say(`${a.emoji} You've reached the **${a.name}**! ${a.tagline}. Want to hop in?`); }
        } else el.style.display = "none";
      }
    }
    if (this.wantEnter) { this.wantEnter = false; if (near) this.tryEnter(near); }
  }
}
