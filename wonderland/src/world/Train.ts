import * as THREE from "three";
import { frames, tubeAlong, instanced, frameAt, Frame, merge, placed } from "./Geo";
import { PARK } from "./Layout";
import { heightAt } from "./Ground";
import { sign, stripes, glow } from "../core/Textures";
import { FolkFactory, Folk } from "./Characters";

const CAR_COLORS = [0xffc93c, 0x7bc96f, 0x4aa3ff];

/** The Puzzle Train: chugs around an oval, stops at its station, puffs smoke. */
export class Train {
  readonly group = new THREE.Group();
  readonly curve: THREE.CatmullRomCurve3;
  readonly frames: Frame[];
  readonly length: number;
  readonly cars: THREE.Group[] = [];
  readonly riders: Folk[] = [];
  readonly stationS: number;
  readonly stationPos: THREE.Vector3;
  s = 0;
  v = 0;
  private t = 0;
  private holdUntil = 0;
  private departed = false;
  private smoke: THREE.Sprite[] = [];
  private smokeAge: number[] = [];
  private chimney = new THREE.Object3D();

  constructor(folk: FolkFactory) {
    const { center, rx, rz } = PARK.trainOval;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; pts.push(new THREE.Vector3(center.x + Math.cos(a) * rx, 0, center.z + Math.sin(a) * rz)); }
    for (const p of pts) p.y = heightAt(p.x, p.z) + 0.25;
    this.curve = new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5);
    this.curve.arcLengthDivisions = 1000;
    this.length = this.curve.getLength();
    this.frames = frames(this.curve, Math.round(this.length / 0.6), true, 0);

    // rails + sleepers + ballast
    const railMat = new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 0.4, metalness: 0.8 });
    for (const off of [-0.5, 0.5]) { const r = new THREE.Mesh(tubeAlong(this.frames, 0.06, 0.06, off, true, 6), railMat); r.castShadow = true; r.frustumCulled = false; this.group.add(r); }
    const sleeperGeo = new THREE.BoxGeometry(1.5, 0.1, 0.24);
    const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.9 });
    const mats: THREE.Matrix4[] = [];
    for (let i = 0; i < this.frames.length; i += 2) { const f = this.frames[i]; mats.push(new THREE.Matrix4().makeBasis(f.b, f.n, f.t).setPosition(f.p)); }
    this.group.add(instanced(sleeperGeo, sleeperMat, mats));

    // station at the north end of the oval
    const st = PARK.trainStation;
    let best = 0, bd = 1e9;
    this.frames.forEach((f) => { const d = f.p.distanceTo(st); if (d < bd) { bd = d; best = f.s; } });
    this.stationS = best;
    const sf = frameAt(this.frames, best, this.length);
    this.stationPos = sf.p.clone();
    const platform = new THREE.Group();
    platform.position.copy(sf.p).setY(heightAt(sf.p.x, sf.p.z));
    platform.lookAt(sf.p.clone().add(sf.t));
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 12), new THREE.MeshStandardMaterial({ color: 0xc89b6a, roughness: 0.85 }));
    deck.position.set(-2.4, 0.35, 0); deck.receiveShadow = true; deck.castShadow = true;
    platform.add(deck);
    const postMat = new THREE.MeshStandardMaterial({ color: 0xfff1d6, roughness: 0.6 });
    for (const z of [-5, 5]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.6, 8), postMat); post.position.set(-2.4, 2.5, z); post.castShadow = true; platform.add(post); }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.16, 12.6), new THREE.MeshStandardMaterial({ map: stripes("#4aa3ff", "#fff6e3", 10, true), roughness: 0.8 }));
    roof.position.set(-2.4, 4.4, 0); roof.castShadow = true; platform.add(roof);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.3), new THREE.MeshBasicMaterial({ map: sign("PUZZLE TRAIN", { bg: "#fff3d6", fg: "#3b2a1a", border: "#4aa3ff", emoji: "🚂" }), transparent: true, side: THREE.DoubleSide }));
    label.position.set(-2.4, 5.3, 0); label.rotation.y = Math.PI / 2;
    platform.add(label);
    this.group.add(platform);

    this.buildTrain(folk);
    this.s = this.stationS;
    this.holdUntil = 3;
    this.group.name = "train";
  }

  private buildTrain(folk: FolkFactory) {
    const red = new THREE.MeshStandardMaterial({ color: 0xd63a3a, roughness: 0.4, metalness: 0.2 });
    const black = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.5 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xffd23c, roughness: 0.3, metalness: 0.7 });
    // engine (forward = -Z)
    const engine = new THREE.Group();
    const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 2.6, 20).rotateX(Math.PI / 2), red);
    boiler.position.set(0, 1.15, -0.5);
    const front = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.2, 20).rotateX(Math.PI / 2), gold);
    front.position.set(0, 1.15, -1.85);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.6, 1.3), red);
    cab.position.set(0, 1.45, 1.1);
    const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 1.5), black);
    cabRoof.position.set(0, 2.3, 1.1);
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.9, 12), black);
    chimney.position.set(0, 2.15, -1.35);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), gold);
    dome.position.set(0, 1.8, -0.4);
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 3.8), black);
    chassis.position.set(0, 0.55, 0);
    const cow = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.6), gold);
    cow.position.set(0, 0.4, -2.0); cow.rotation.x = 0.5;
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.2, 14).rotateZ(Math.PI / 2);
    const wheels = new THREE.Mesh(merge([placed(wheelGeo, -0.75, 0.42, -1), placed(wheelGeo, 0.75, 0.42, -1), placed(wheelGeo, -0.75, 0.42, 0.2), placed(wheelGeo, 0.75, 0.42, 0.2), placed(wheelGeo, -0.75, 0.42, 1.4), placed(wheelGeo, 0.75, 0.42, 1.4)]), black);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfff6c0, emissive: 0xffe9a0, emissiveIntensity: 2 }));
    lamp.position.set(0, 1.55, -1.95);
    engine.add(boiler, front, cab, cabRoof, chimney, dome, chassis, cow, wheels, lamp);
    this.chimney.position.set(0, 2.7, -1.35);
    engine.add(this.chimney);
    engine.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.cars.push(engine);
    this.group.add(engine);
    const kinds = ["pawn", "rook", "bishop", "queen", "pawn", "knight"];
    for (let i = 0; i < 3; i++) {
      const car = new THREE.Group();
      const col = new THREE.MeshStandardMaterial({ color: CAR_COLORS[i], roughness: 0.45, metalness: 0.1 });
      const floor = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 3.0), black); floor.position.y = 0.55;
      const walls = new THREE.Mesh(merge([placed(new THREE.BoxGeometry(0.08, 0.7, 3.0), -0.78, 1.0, 0), placed(new THREE.BoxGeometry(0.08, 0.7, 3.0), 0.78, 1.0, 0), placed(new THREE.BoxGeometry(1.6, 0.7, 0.08), 0, 1.0, -1.48), placed(new THREE.BoxGeometry(1.6, 0.7, 0.08), 0, 1.0, 1.48)]), col);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 1.0), new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.8 }));
      bench.position.set(0, 0.95, 0.3);
      const posts = new THREE.Mesh(merge([-0.7, 0.7].flatMap((x) => [-1.3, 1.3].map((z) => placed(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), x, 1.9, z)))), gold);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 3.3), new THREE.MeshStandardMaterial({ map: stripes(i === 1 ? "#ff6b8a" : "#4aa3ff", "#fff6e3", 8, true), roughness: 0.8 }));
      roof.position.y = 2.75;
      const wheels = new THREE.Mesh(merge([placed(wheelGeo, -0.75, 0.42, -0.9), placed(wheelGeo, 0.75, 0.42, -0.9), placed(wheelGeo, -0.75, 0.42, 0.9), placed(wheelGeo, 0.75, 0.42, 0.9)]).scale(1, 0.8, 0.8), black);
      car.add(floor, walls, bench, posts, roof, wheels);
      car.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      for (let k = 0; k < 2; k++) {
        const r = folk.create(kinds[i * 2 + k], 0.72);
        r.setSeated(true);
        r.root.position.set(k ? 0.36 : -0.36, 0.95, 0.3);
        r.root.rotation.y = Math.PI;
        car.add(r.root);
        this.riders.push(r);
      }
      this.cars.push(car);
      this.group.add(car);
    }
    // smoke puffs
    const smokeMat = new THREE.SpriteMaterial({ map: glow("#e9e9e9"), transparent: true, opacity: 0.55, depthWrite: false });
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Sprite(smokeMat.clone());
      sp.visible = false;
      this.smoke.push(sp); this.smokeAge.push(i * 0.35);
      this.group.add(sp);
    }
  }

  update(dt: number) {
    this.t += dt;
    let target = 4.2;
    const d = ((this.stationS - this.s) % this.length + this.length) % this.length;
    if (d < 12 && this.departed) target = Math.max(0.6, d * 0.4);
    if (this.departed && d < 0.4) { this.departed = false; this.holdUntil = this.t + 5; this.v = 0; }
    if (this.t < this.holdUntil) target = 0; else if (!this.departed && d > 2) this.departed = true; else if (!this.departed && this.t >= this.holdUntil && d <= 2) { target = 1.5; if (d > 1) this.departed = true; }
    this.v = THREE.MathUtils.damp(this.v, target, 1.6, dt);
    this.s = (this.s + this.v * dt) % this.length;
    const gaps = [0, 3.9, 7.4, 10.9];
    for (let i = 0; i < this.cars.length; i++) {
      const f = frameAt(this.frames, this.s - gaps[i], this.length);
      const car = this.cars[i];
      new THREE.Matrix4().makeBasis(f.b, f.n, f.t.clone().negate()).setPosition(f.p).decompose(car.position, car.quaternion, car.scale);
    }
    // smoke
    const chimneyWorld = this.chimney.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < this.smoke.length; i++) {
      this.smokeAge[i] += dt;
      const sp = this.smoke[i];
      if (this.smokeAge[i] > 3.2) {
        this.smokeAge[i] = 0;
        sp.position.copy(chimneyWorld);
        sp.visible = this.v > 0.5;
      }
      const a = this.smokeAge[i];
      sp.position.y += dt * 1.6; sp.position.x += dt * 0.3;
      const s = 0.6 + a * 1.4; sp.scale.set(s, s, 1);
      (sp.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.5 * (1 - a / 3.2));
    }
    for (const r of this.riders) r.setArms(0, this.t);
  }
}
