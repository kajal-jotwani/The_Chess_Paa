import * as THREE from "three";
import { ModeContext, Mode, wait, pick } from "./Context";
import { CoasterStation } from "../world/Coaster";
import { AttractionId } from "../world/Layout";

const LINES: Record<string, string[]> = {
  depart: ["All aboard the Rating Roller-Coaster! Hold on to your hats — and your knights!", "Whee-hee! Here we go, little champions!"],
  lift: ["Up, up, up we climb — just like your rating will!", "Look at the whole park from up here!"],
  academy: ["First stop: the **Piece Academy**, where every piece sings its own song."],
  endgame: ["Next stop: the **Endgame Ferris Wheel** — where games are finished like champions."],
  train: ["Toot toot! The **Puzzle Train** station. Fill the carriages with solved puzzles!"],
  home: ["And we're home! What a ride. Shall we go again, or wander the park?"],
};

/**
 * The tour: ChessPaa drives the coaster, the children ride behind him, and
 * the train stops at every learning station on the way round.
 */
export class RideMode implements Mode {
  private stationCb?: (st: CoasterStation) => void;
  private hiddenRiders: THREE.Object3D[] = [];
  private liftSaid = false;
  /** the station we parked at for a "Hop off & play" — re-entering resumes here, not at the main station */
  private resumeAt: CoasterStation | null = null;
  /** true only while waiting at the boarding station — the auto-depart timer must never dismiss a station stop */
  private boarding = false;
  private clankT = 0;
  private dropped = false;
  onStation?: (id: AttractionId) => void;
  constructor(private ctx: ModeContext) {}

  get station(): CoasterStation | null { return this.resumeAt; }

  async enter() {
    const { world, rig, ui, sound } = this.ctx;
    const c = world.coaster;
    ui.hidePanel(); ui.showHome(true);
    // seat the cast: ChessPaa in the front car, kids in the second (the piece-folk riders step off)
    if (!this.hiddenRiders.length) {
      for (let i = 0; i < 4; i++) {
        const riders = c.riders.slice(i * 2, i * 2 + 2);
        riders.forEach((r) => { r.root.visible = false; this.hiddenRiders.push(r.root); });
      }
    }
    // always re-seat: AcademyMode/PuzzleMode call placeCast() while the cast is still parented to the cars
    world.chessPaa.root.parent?.remove(world.chessPaa.root);
    c.cars[0].add(world.chessPaa.root);
    world.chessPaa.root.position.set(0, 0.86, 0.35); world.chessPaa.root.rotation.set(0, Math.PI, 0); world.chessPaa.root.scale.setScalar(0.72);
    world.chessPaa.mood = "sit";
    world.kids.forEach((k, i) => { k.root.parent?.remove(k.root); c.cars[1].add(k.root); k.root.position.set(i ? 0.36 : -0.36, 0.86, 0.35); k.root.rotation.set(0, Math.PI, 0); k.root.scale.setScalar(0.85); k.mood = "sit"; });
    c.cameraSeat.position.set(0, 1.85, 1.35);
    c.teleportTo(this.resumeAt ?? c.stations[0]);
    c.stopAtStations = true;
    c.holdHere();
    rig.sitIn(c.cameraSeat, new THREE.Vector3(0, 0.2, -8));
    world.setShadowFocus(new THREE.Vector3(0, 0, -10), 160);
    this.stationCb = (st) => this.arrive(st);
    c.onArrive = this.stationCb;
    this.clankT = 0; this.dropped = false;
    sound.whoosh();
    const go = () => { sound.click(); this.boarding = false; c.resume(); ui.say(this.resumeAt ? "Onward!" : "Wheee!"); };
    const dur = this.resumeAt
      ? ui.say(`Back on board at the ${this.resumeAt.name}! Onward to the next stop!`, [{ label: "🎢 Go!", onClick: go }])
      : ui.say(pick(LINES.depart), [{ label: "🎢 Let's go!", onClick: go }]);
    world.chessPaa.say(dur);
    // auto-depart once ChessPaa has finished the line — the button stays as an early skip. Keyed on
    // this instance's callback so a stale timer can never resume a later RideMode (exit() clears onArrive).
    const token = this.stationCb;
    this.boarding = true;
    wait(dur).then(() => { if (c.onArrive === token && this.boarding && c.isHolding()) { this.boarding = false; c.resume(); ui.say(this.resumeAt ? "Onward!" : "Wheee!"); } });
  }

  exit() {
    const { world, rig } = this.ctx;
    const c = world.coaster;
    c.stopAtStations = false; c.onArrive = undefined; c.resume();
    this.hiddenRiders.forEach((r) => (r.visible = true)); this.hiddenRiders = [];
    // return the cast to the park
    for (const o of [world.chessPaa.root, ...world.kids.map((k) => k.root)]) { o.parent?.remove(o); o.scale.setScalar(1); world.group.add(o); }
    world.chessPaa.mood = "idle"; world.kids.forEach((k) => (k.mood = "idle"));
    world.placeCast("grand_match");
    rig.camera.up.set(0, 1, 0);
  }

  private async arrive(st: CoasterStation) {
    this.boarding = false;
    const { ui, world, sound, progress } = this.ctx;
    const c = world.coaster;
    // "Ride again" from home starts from the top; a hop-off station is remembered for re-boarding
    this.resumeAt = st.id === "main" ? null : st;
    sound.ding();
    if (st.id === "main") {
      c.holdHere();
      // teleportTo() pre-sets the station index, so this only fires after a genuine lap
      progress.addTicket(1); ui.setTickets(progress.tickets); sound.coin();
      const dur = ui.say("🎟 Ride complete! " + pick(LINES.home), [
        { label: "🎢 Ride again!", onClick: () => { sound.click(); this.liftSaid = false; c.resume(); ui.say(pick(LINES.depart)); } },
        { label: "🏠 Explore the park", onClick: () => this.ctx.exit(), kind: "berry" },
      ]);
      world.chessPaa.say(dur);
      return;
    }
    c.holdHere();
    const id = st.id as AttractionId;
    const dur = ui.say(pick(LINES[id] ?? ["Next stop!"]), [
      { label: "🚶 Hop off & play", onClick: () => { sound.click(); this.onStation?.(id); } },
      { label: "🎢 Stay on the ride", onClick: () => { sound.click(); c.resume(); ui.say("Onward!"); }, kind: "ghost" },
    ]);
    world.chessPaa.say(dur);
  }

  update(dt: number, t: number) {
    const { world, sound, ui } = this.ctx;
    const c = world.coaster;
    if (c.onLift) {
      if (!this.liftSaid && c.v > 3) { this.liftSaid = true; ui.say(pick(LINES.lift)); }
      this.clankT += dt;
      if (this.clankT > 0.35) { this.clankT = 0; sound.clank(); }
    }
    const d = c.dropIntensity;
    if (d > 0.5 && !this.dropped) { this.dropped = true; sound.drop(); }
    if (d < 0.2) this.dropped = false;
  }
}
