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
  private paused = false;
  private liftSaid = false;
  onStation?: (id: AttractionId) => void;
  constructor(private ctx: ModeContext, private resumeAt: CoasterStation | null = null) {}

  async enter() {
    const { world, rig, ui, sound } = this.ctx;
    const c = world.coaster;
    ui.hidePanel(); ui.showHome(true);
    // seat the cast: ChessPaa in the front car, kids in the second
    for (let i = 0; i < 4; i++) {
      const car = c.cars[i];
      const riders = c.riders.slice(i * 2, i * 2 + 2);
      riders.forEach((r) => { r.root.visible = false; this.hiddenRiders.push(r.root); });
    }
    world.chessPaa.root.parent?.remove(world.chessPaa.root);
    c.cars[0].add(world.chessPaa.root);
    world.chessPaa.root.position.set(0, 0.86, 0.35); world.chessPaa.root.rotation.set(0, Math.PI, 0); world.chessPaa.root.scale.setScalar(0.72);
    world.chessPaa.mood = "sit";
    world.kids.forEach((k, i) => { k.root.parent?.remove(k.root); c.cars[1].add(k.root); k.root.position.set(i ? 0.36 : -0.36, 0.86, 0.35); k.root.rotation.set(0, Math.PI, 0); k.root.scale.setScalar(0.85); k.mood = "sit"; });
    c.cameraSeat.position.set(0, 1.85, 1.35);
    if (this.resumeAt) c.teleportTo(this.resumeAt); else c.teleportTo(c.stations[0]);
    c.stopAtStations = true;
    c.holdHere();
    rig.sitIn(c.cameraSeat, new THREE.Vector3(0, 0.2, -8));
    world.setShadowFocus(new THREE.Vector3(0, 0, -10), 160);
    this.stationCb = (st) => this.arrive(st);
    c.onArrive = this.stationCb;
    sound.whoosh();
    const dur = ui.say(pick(LINES.depart), [{ label: "🎢 Let's go!", onClick: () => { sound.click(); c.resume(); ui.say("Wheee!"); } }]);
    world.chessPaa.say(dur);
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
    const { ui, world, sound } = this.ctx;
    const c = world.coaster;
    sound.ding();
    if (st.id === "main") {
      c.holdHere();
      const dur = ui.say(pick(LINES.home), [
        { label: "🎢 Ride again!", onClick: () => { sound.click(); c.resume(); ui.say(pick(LINES.depart)); } },
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
    const c = this.ctx.world.coaster;
    if (!this.liftSaid && c.v > 3 && c.s > c.stations[0].s + 30 && c.s < c.stations[0].s + 60) { this.liftSaid = true; this.ctx.ui.say(pick(LINES.lift)); }
  }
}
