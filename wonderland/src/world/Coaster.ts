import * as THREE from "three";
import { frames, tubeAlong, instanced, frameAt, Frame, merge, placed, rnd } from "./Geo";
import { coasterControlPoints, COASTER_STATIONS } from "./Layout";
import { heightAt } from "./Ground";
import { sign, stripes } from "../core/Textures";
import { FolkFactory, Folk } from "./Characters";

const G = 9.81;
const CAR_GAP = 2.3;
const CAR_COLORS = [0x8e44ad, 0x2ecc71, 0xe84393, 0xf39c12];

export interface CoasterStation { id: string; name: string; s: number; pos: THREE.Vector3; }

/**
 * The Rating Roller-Coaster.  Rails, ties and supports follow parallel-transport
 * frames with banking; the train's speed comes from a chain lift and gravity so
 * drops feel like drops.  Stations slow it; ride mode stops it.
 */
export class Coaster {
  readonly group = new THREE.Group();
  readonly curve: THREE.CatmullRomCurve3;
  readonly frames: Frame[];
  readonly length: number;
  readonly stations: CoasterStation[] = [];
  readonly cars: THREE.Group[] = [];
  readonly riders: Folk[] = [];
  readonly frontSeat = new THREE.Object3D();
  readonly cameraSeat = new THREE.Object3D();
  s = 0;
  v = 6;
  maxHeight = 0;
  /** ride-mode hooks */
  stopAtStations = false;
  onArrive?: (station: CoasterStation) => void;
  private holdUntil = -1;
  private lastStationIdx = -1;
  private liftRange: [number, number] = [0, 0];
  private time = 0;
  private armLift = 0;

  constructor(folkFactory: FolkFactory) {
    const pts = coasterControlPoints();
    this.curve = new THREE.CatmullRomCurve3(pts, true, "centripetal", 0.5);
    this.curve.arcLengthDivisions = 4000;
    this.length = this.curve.getLength();
    this.frames = frames(this.curve, Math.round(this.length / 0.55), true, 3.2);
    for (const f of this.frames) this.maxHeight = Math.max(this.maxHeight, f.p.y);

    // stations → arc lengths
    for (const st of COASTER_STATIONS) {
      let best = 0, bd = 1e9;
      this.frames.forEach((f) => { const d = f.p.distanceTo(st.pos); if (d < bd) { bd = d; best = f.s; } });
      this.stations.push({ id: st.id, name: st.name, s: best, pos: st.pos.clone() });
    }
    // lift hill: from the first station run-out up to the crest
    const crestIdx = this.frames.reduce((bi, f, i, arr) => (f.p.y > arr[bi].p.y ? i : bi), 0);
    this.liftRange = [this.stations[0].s + 18, this.frames[crestIdx].s - 2];

    this.buildTrack();
    this.buildStations();
    this.buildTrain(folkFactory);
    this.s = this.stations[0].s + 3;
    this.group.name = "coaster";
  }

  private buildTrack() {
    const fr = this.frames;
    const railMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.35, metalness: 0.6, envMapIntensity: 1.0 });
    const spineMat = new THREE.MeshStandardMaterial({ color: 0xffb347, roughness: 0.45, metalness: 0.4 });
    const railL = new THREE.Mesh(tubeAlong(fr, 0.09, 0.0, -0.55, true, 8), railMat);
    const railR = new THREE.Mesh(tubeAlong(fr, 0.09, 0.0, 0.55, true, 8), railMat);
    const spine = new THREE.Mesh(tubeAlong(fr, 0.17, -0.42, 0, true, 8), spineMat);
    for (const m of [railL, railR, spine]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; }
    this.group.add(railL, railR, spine);

    // ties (instanced) every ~1.2 m
    const tieGeo = new THREE.BoxGeometry(1.4, 0.08, 0.22);
    const tieMat = new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.8 });
    const tieMats: THREE.Matrix4[] = [];
    const step = Math.max(1, Math.round(1.2 / (this.length / fr.length)));
    for (let i = 0; i < fr.length; i += step) {
      const f = fr[i];
      const m = new THREE.Matrix4().makeBasis(f.b, f.n, f.t).setPosition(f.p.clone().addScaledVector(f.n, -0.16));
      tieMats.push(m);
    }
    this.group.add(instanced(tieGeo, tieMat, tieMats));

    // supports every ~7.5 m where the track is above ground level: warm graphite
    // steel bents — splayed A-frame legs on tall sections with X-bracing, and a
    // concrete footer under every leg — so they read as a dark secondary
    // structure under the orange track instead of a forest of white poles
    const colGeo = new THREE.CylinderGeometry(0.13, 0.17, 1, 8).translate(0, 0.5, 0);
    const colMat = new THREE.MeshStandardMaterial({ color: 0x5a5652, roughness: 0.6, metalness: 0.5 });
    const footGeo = new THREE.BoxGeometry(1.0, 0.3, 1.0);
    const footMat = new THREE.MeshStandardMaterial({ color: 0xbfb8ac, roughness: 0.9 });
    const cols: THREE.Matrix4[] = [];
    const feet: THREE.Matrix4[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const strut = (from: THREE.Vector3, to: THREE.Vector3, r: number) =>
      new THREE.Matrix4().compose(from, new THREE.Quaternion().setFromUnitVectors(up, to.clone().sub(from).normalize()), new THREE.Vector3(r, from.distanceTo(to), r));
    const stepC = Math.max(1, Math.round(7.5 / (this.length / fr.length)));
    for (let i = 0; i < fr.length; i += stepC) {
      const f = fr[i];
      if (f.n.y < 0.2) continue; // inverted / near-vertical frames (top of the loop) — a column there would pierce the lower track
      const ground = heightAt(f.p.x, f.p.z);
      const top = f.p.y - 0.5;
      const H = top - ground;
      if (H < 0.8) continue;
      const side = new THREE.Vector3(f.b.x, 0, f.b.z).normalize();
      const twoLeg = H > 7;
      const legOff = (u: number) => (twoLeg ? THREE.MathUtils.lerp(2.0, 1.1, u) : 0); // splay: ±2.0 at the base → ±1.1 at the deck
      const legPt = (s: number, u: number) => new THREE.Vector3(f.p.x, ground + u * H, f.p.z).addScaledVector(side, s * legOff(u));
      for (const s of twoLeg ? [-1, 1] : [0]) {
        cols.push(strut(legPt(s, 0).setY(ground - 0.2), legPt(s, 1), 1));
        feet.push(new THREE.Matrix4().setPosition(legPt(s, 0).setY(ground + 0.1)));
      }
      if (twoLeg) {
        // cross beam under the track
        cols.push(new THREE.Matrix4().compose(new THREE.Vector3(f.p.x, top - 0.3, f.p.z), new THREE.Quaternion().setFromUnitVectors(up, f.b.clone()), new THREE.Vector3(0.8, 2.6, 0.8)));
        if (i % (2 * stepC) === 0 && H > 10) {
          // X-brace every other tall bent (0.7x radius — thinner shimmers under SMAA-only AA)
          cols.push(strut(legPt(-1, 0.25), legPt(1, 0.75), 0.7));
          cols.push(strut(legPt(1, 0.25), legPt(-1, 0.75), 0.7));
        }
      }
    }
    this.group.add(instanced(colGeo, colMat, cols));
    const footers = instanced(footGeo, footMat, feet); footers.castShadow = false;
    this.group.add(footers);

    // chaser-light string on the outside of the rails, alternating sides so it reads as a real bulb run;
    // visible from above and from the ride, and Atmosphere brightens it at dusk/night like every other bulb
    const bulbGeo = new THREE.SphereGeometry(0.13, 6, 5);
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1b0, emissive: 0xffd36b, emissiveIntensity: 1.2 });
    const stepB = Math.max(1, Math.round(2.4 / (this.length / fr.length)));
    const bulbs: THREE.Matrix4[] = [];
    for (let i = 0, k = 0; i < fr.length; i += stepB, k++) {
      const f = fr[i];
      bulbs.push(new THREE.Matrix4().setPosition(f.p.clone().addScaledVector(f.b, (k % 2 ? 1 : -1) * 0.72).addScaledVector(f.n, -0.05)));
    }
    const string = instanced(bulbGeo, bulbMat, bulbs);
    string.castShadow = false;
    this.group.add(string);
  }

  private buildStations() {
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xc89b6a, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ map: stripes("#ff5d5d", "#fff5e0", 10, true), roughness: 0.8 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0xfff1d6, roughness: 0.6 });
    for (const st of this.stations) {
      const f = frameAt(this.frames, st.s, this.length);
      const g = new THREE.Group();
      g.position.copy(f.p).setY(heightAt(f.p.x, f.p.z));
      // aim along the track's horizontal heading only: the frame point sits at rail height (1.5 m) while the
      // shed sits on the ground, so looking at f.p + f.t would pitch the whole station up like a ramp
      const flat = new THREE.Vector3(f.t.x, 0, f.t.z).normalize();
      g.lookAt(g.position.clone().add(flat));
      const platform = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.2, 14), woodMat);
      platform.position.set(0, 0.6, 0);
      platform.receiveShadow = true; platform.castShadow = true;
      // a slot for the track through the platform middle: two platforms either side
      const left = platform.clone(); left.scale.x = 0.36; left.position.x = -2.1;
      const right = platform.clone(); right.scale.x = 0.36; right.position.x = 2.1;
      g.add(left, right);
      for (const sx of [-2.6, 2.6]) for (const sz of [-5.5, 5.5]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.2, 8), postMat);
        post.position.set(sx, 3, sz); post.castShadow = true; g.add(post);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.18, 14.6), roofMat);
      roof.position.set(0, 5.2, 0); roof.castShadow = true; roof.receiveShadow = true;
      g.add(roof);
      const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 7.4, 6).rotateZ(Math.PI / 2), postMat);
      ridge.position.set(0, 5.35, 0); g.add(ridge);
      // sign
      const label = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3), new THREE.MeshBasicMaterial({ map: sign(st.name, { bg: "#fff3d6", fg: "#3b2a1a", border: "#e84a5f" }), transparent: true }));
      label.position.set(0, 6.2, 0);
      const label2 = label.clone(); label2.rotation.y = Math.PI;
      g.add(label, label2);
      this.group.add(g);
    }
    // the big "RATINGS" arch over the lift hill and GM/IM flags on the crest
    const crest = this.frames.reduce((a, f) => (f.p.y > a.p.y ? f : a), this.frames[0]);
    const flag = (text: string, f: Frame, color: string) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.5, 6), postMat);
      pole.position.copy(f.p).addScaledVector(f.b, 1.1).add(new THREE.Vector3(0, 1.6, 0));
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.0), new THREE.MeshBasicMaterial({ map: sign(text, { bg: color, fg: "#3b2a1a", w: 512, h: 256 }), side: THREE.DoubleSide }));
      cloth.position.copy(pole.position).add(new THREE.Vector3(0.9, 1.2, 0));
      this.group.add(pole, cloth);
    };
    flag("GM", crest, "#ffd23c");
    const im = frameAt(this.frames, crest.s - 12, this.length); flag("IM", im, "#ffe9a0");
    const fm = frameAt(this.frames, crest.s - 24, this.length); flag("FM", fm, "#fff5d0");
    const arch = frameAt(this.frames, this.stations[0].s + 12, this.length);
    const archSign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.4), new THREE.MeshBasicMaterial({ map: sign("RATING ROLLER-COASTER", { bg: "#ff6b8a", fg: "#fff", border: "#fff", w: 1400, h: 380 }), transparent: true, side: THREE.DoubleSide }));
    archSign.position.copy(arch.p).add(new THREE.Vector3(0, 5.5, 0));
    archSign.lookAt(archSign.position.clone().add(new THREE.Vector3(arch.b.x, 0, arch.b.z)));
    for (const off of [-4.2, 4.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 7, 8), postMat);
      post.position.copy(arch.p).addScaledVector(arch.b, off).add(new THREE.Vector3(0, 2.5, 0));
      post.position.y = heightAt(post.position.x, post.position.z) + 3.5;
      this.group.add(post);
    }
    this.group.add(archSign);
  }

  private buildTrain(folk: FolkFactory) {
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1a, roughness: 0.6 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.25, metalness: 0.9 });
    const kinds = ["queen", "king", "bishop", "knight", "rook", "pawn", "pawn", "bishop"];
    for (let i = 0; i < 4; i++) {
      const car = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: CAR_COLORS[i], roughness: 0.35, metalness: 0.15, envMapIntensity: 1.1 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 2.2, 1, 1, 1), bodyMat);
      body.position.y = 0.55;
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 12).scale(1.2, 0.6, 1), bodyMat);
      nose.position.set(0, 0.55, i === 0 ? -1.35 : -1.1);
      const seatBack = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.7, 0.16), seatMat);
      seatBack.position.set(0, 1.2, 0.9);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.12, 1.2), seatMat);
      seat.position.set(0, 0.86, 0.35);
      const bar = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 8, 20, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI), chromeMat);
      bar.position.set(0, 1.25, -0.2);
      bar.scale.set(1.15, 1, 1);
      const wheels = new THREE.Mesh(merge([placed(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 12).rotateZ(Math.PI / 2), -0.6, 0.2, -0.7), placed(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 12).rotateZ(Math.PI / 2), 0.6, 0.2, -0.7), placed(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 12).rotateZ(Math.PI / 2), -0.6, 0.2, 0.7), placed(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 12).rotateZ(Math.PI / 2), 0.6, 0.2, 0.7)]), chromeMat);
      car.add(body, nose, seatBack, seat, bar, wheels);
      car.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      if (i === 0) {
        const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshBasicMaterial({ map: sign("SAY CHESS!", { bg: "#e8253d", fg: "#fff", border: "#fff", w: 512, h: 280 }), transparent: true }));
        badge.position.set(0, 0.6, -1.95);
        badge.rotation.y = Math.PI;
        car.add(badge);
      }
      // riders: two per car, seated (legs hidden)
      for (let k = 0; k < 2; k++) {
        const r = folk.create(kinds[i * 2 + k], 0.78);
        r.setSeated(true);
        r.root.position.set(k === 0 ? -0.36 : 0.36, 0.86, 0.35);
        r.root.rotation.y = Math.PI; // face forward (-z)
        car.add(r.root);
        this.riders.push(r);
      }
      this.cars.push(car);
      this.group.add(car);
    }
    this.frontSeat.position.set(0, 0.86, 0.35);
    this.cars[0].add(this.frontSeat);
    this.cameraSeat.position.set(0, 1.55, 1.05);
    this.cars[1].add(this.cameraSeat);
  }

  stationAhead(): CoasterStation | null {
    for (const st of this.stations) {
      const d = ((st.s - this.s) % this.length + this.length) % this.length;
      if (d < 10) return st;
    }
    return null;
  }

  /** Distance along the track from the current position to a station. */
  distanceTo(st: CoasterStation) { return ((st.s - this.s) % this.length + this.length) % this.length; }

  /** True while the chain lift has the train (ride audio: clanks). */
  get onLift() { return this.s > this.liftRange[0] && this.s < this.liftRange[1]; }
  /** 0..1 — how hard the riders are throwing their arms up, i.e. how much of a drop this is. */
  get dropIntensity() { return this.armLift; }

  update(dt: number) {
    this.time += dt;
    const f0 = frameAt(this.frames, this.s, this.length);
    const h = f0.p.y;
    const onLift = this.onLift;
    let target = onLift ? 4.2 : THREE.MathUtils.clamp(Math.sqrt(Math.max(0, 2 * G * (this.maxHeight + 3 - h))) * 0.72 + 2.5, 3.5, 26);
    // stations: ease in, hold if in ride mode
    let holding = false;
    for (let i = 0; i < this.stations.length; i++) {
      const st = this.stations[i];
      const d = this.distanceTo(st);
      if (d < 14) target = Math.min(target, 2.5 + d * 0.9);
      if (this.stopAtStations && d < 0.6 && this.lastStationIdx !== i) {
        this.lastStationIdx = i;
        this.holdUntil = this.time + 2.5;
        this.v = 0;
        this.onArrive?.(st);
      }
      if (this.stopAtStations && this.lastStationIdx === i && this.time < this.holdUntil) holding = true;
      if (this.lastStationIdx === i && d > 20 && d < this.length - 20) this.lastStationIdx = -1;
    }
    if (holding) target = 0;
    const accel = target > this.v ? 4.0 : 6.0;
    this.v = THREE.MathUtils.damp(this.v, target, accel * 0.6, dt);
    this.s = (this.s + this.v * dt) % this.length;

    // place cars
    for (let i = 0; i < this.cars.length; i++) {
      const f = frameAt(this.frames, this.s - i * CAR_GAP, this.length);
      const car = this.cars[i];
      const m = new THREE.Matrix4().makeBasis(f.b, f.n, f.t.clone().negate()).setPosition(f.p.clone().addScaledVector(f.n, 0.12));
      car.matrix.copy(m);
      car.matrix.decompose(car.position, car.quaternion, car.scale);
    }
    // riders throw their arms up on drops
    const falling = THREE.MathUtils.clamp(-f0.t.y * 2.2, 0, 1) * THREE.MathUtils.clamp((this.v - 8) / 10, 0, 1);
    this.armLift = THREE.MathUtils.damp(this.armLift, falling, 4, dt);
    for (const r of this.riders) r.setArms(this.armLift, this.time);
  }

  /** Hold at a station until resumed (ride mode). */
  resume() { this.holdUntil = -1; }
  holdHere() { this.holdUntil = 1e12; }
  isHolding() { return this.time < this.holdUntil; }
  teleportTo(station: CoasterStation) { this.s = station.s; this.v = 0; this.lastStationIdx = this.stations.indexOf(station); }
}
