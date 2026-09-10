import * as THREE from "three";
import { merge, placed, instanced, rnd } from "./Geo";
import { heightAt } from "./Ground";
import { PARK, ATTRACTIONS } from "./Layout";
import { sign, stripes } from "../core/Textures";

const std = (color: number, roughness = 0.6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

/** Swan pedal-boats drifting on the lake. */
export class SwanBoats {
  readonly group = new THREE.Group();
  private boats: { g: THREE.Group; a: number; r: number; speed: number }[] = [];
  private t = 0;
  constructor() {
    const white = std(0xfdfdf8, 0.5), orange = std(0xff9f43, 0.5), dark = std(0x2b2b2b, 0.5);
    const L = PARK.lake;
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12).scale(1.0, 0.45, 1.7), white); hull.position.y = 0.1;
      const neck = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.22, 10, 20, Math.PI * 0.9), white); neck.position.set(0, 0.9, 1.3); neck.rotation.y = Math.PI / 2; neck.rotation.z = 0.2;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), white); head.position.set(0, 1.85, 2.15);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 10).rotateX(Math.PI / 2), orange); beak.position.set(0, 1.8, 2.55);
      const eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), dark); eye1.position.set(0.16, 1.92, 2.3); const eye2 = eye1.clone(); eye2.position.x = -0.16;
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 1.0), std([0xe84a5f, 0x2ec4c6, 0xffc93c, 0x7bc96f][i], 0.6)); seat.position.set(0, 0.45, -0.2);
      g.add(hull, neck, head, beak, eye1, eye2, seat);
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      this.boats.push({ g, a: (i / 4) * Math.PI * 2, r: 0.35 + i * 0.12, speed: 0.06 + i * 0.01 });
      this.group.add(g);
    }
    this.group.position.set(L.center.x, -0.25, L.center.z);
    this.group.name = "swans";
  }
  update(dt: number) {
    this.t += dt;
    const L = PARK.lake;
    for (const b of this.boats) {
      b.a += dt * b.speed;
      const x = Math.cos(b.a) * L.rx * b.r, z = Math.sin(b.a) * L.rz * b.r;
      b.g.position.set(x, Math.sin(this.t * 1.3 + b.a) * 0.05, z);
      b.g.rotation.y = -b.a + Math.PI; // nose along the drift
      b.g.rotation.z = Math.sin(this.t * 0.9 + b.a) * 0.03;
    }
  }
}

/** Planters, queue railings, popcorn cart, bins, arrow signposts — the texture of a real park. */
export function parkProps() {
  const g = new THREE.Group();
  const rand = rnd(404);
  // planters around the plaza
  const planterGeo = merge([placed(new THREE.CylinderGeometry(0.9, 0.7, 0.7, 16), 0, 0.35, 0), placed(new THREE.SphereGeometry(0.75, 12, 8).scale(1, 0.5, 1), 0, 0.85, 0)]);
  const planterMat = std(0xd8c9b0, 0.8);
  const planters: THREE.Matrix4[] = [];
  const bloomGeo = new THREE.SphereGeometry(0.16, 6, 5);
  const bloomMat = std(0xffffff, 0.7);
  const blooms: THREE.Matrix4[] = [], bloomCols: THREE.Color[] = [];
  const palette = [0xff4f6d, 0xffc93c, 0xff8fb1, 0xb388ff, 0xffffff];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13, r = 19.5;
    const x = Math.cos(a) * r, z = 8 + Math.sin(a) * r;
    if (Math.abs(x) < 4 && z > 8) continue; // keep the entrance path clear
    planters.push(new THREE.Matrix4().setPosition(x, heightAt(x, z), z));
    for (let k = 0; k < 9; k++) { blooms.push(new THREE.Matrix4().setPosition(x + (rand() - 0.5) * 1.1, heightAt(x, z) + 0.95 + rand() * 0.15, z + (rand() - 0.5) * 1.1)); bloomCols.push(new THREE.Color(palette[Math.floor(rand() * palette.length)])); }
  }
  g.add(instanced(planterGeo, planterMat, planters));
  const bl = instanced(bloomGeo, bloomMat, blooms, bloomCols); bl.castShadow = false; g.add(bl);
  // queue railings in front of every attraction board (zig-zag)
  const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.0, 8).translate(0, 0.5, 0);
  const railGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6).rotateZ(Math.PI / 2);
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.3, metalness: 0.9 });
  const posts: THREE.Matrix4[] = [], rails: THREE.Matrix4[] = [];
  for (const a of ATTRACTIONS) {
    const fwd = new THREE.Vector3(Math.sin(a.board.yaw), 0, Math.cos(a.board.yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const base = a.board.pos.clone().addScaledVector(fwd, 6.5);
    for (let row = 0; row < 3; row++) {
      const p0 = base.clone().addScaledVector(right, -3).addScaledVector(fwd, row * 1.2);
      const p1 = base.clone().addScaledVector(right, 3).addScaledVector(fwd, row * 1.2);
      for (let k = 0; k <= 4; k++) { const p = p0.clone().lerp(p1, k / 4); p.y = heightAt(p.x, p.z); posts.push(new THREE.Matrix4().setPosition(p.x, p.y, p.z)); }
      const mid = p0.clone().lerp(p1, 0.5); mid.y = heightAt(mid.x, mid.z) + 0.95;
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), right);
      rails.push(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(6, 1, 1)));
    }
  }
  g.add(instanced(postGeo, chrome, posts), instanced(railGeo, chrome, rails));
  // bins + arrow signposts along the paths
  const binGeo = merge([placed(new THREE.CylinderGeometry(0.35, 0.3, 0.9, 12), 0, 0.45, 0), placed(new THREE.CylinderGeometry(0.38, 0.38, 0.08, 12), 0, 0.94, 0)]);
  const bins: THREE.Matrix4[] = [];
  for (const [x, z] of [[-5, 52], [5, 52], [-5, 36], [5, 36], [16, 32], [-16, 32], [-30, 40], [22, 44], [34, -52], [-22, -52], [-40, 0], [40, 10]]) bins.push(new THREE.Matrix4().setPosition(x, heightAt(x, z), z));
  g.add(instanced(binGeo, std(0x2f6fa8, 0.5, 0.2), bins));
  const postMat = std(0x8b5a2b, 0.8);
  const signSpots: [number, number, string[], number][] = [[6, 44, ["🏰 Piece Academy ➜", "🎢 Tactics Coaster ➜"], -0.6], [-6, 20, ["🎡 Endgame Wheel ➜", "🚂 Puzzle Train ➜"], 0.7], [-22, -2, ["🚂 Puzzle Train ➜"], 1.6], [24, -24, ["🏰 Piece Academy ➜"], -0.4]];
  for (const [x, z, labels, ry] of signSpots) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.0, 8), postMat); post.position.set(x, heightAt(x, z) + 1.5, z); post.castShadow = true; g.add(post);
    labels.forEach((text, i) => {
      const arrow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), new THREE.MeshBasicMaterial({ map: sign(text, { bg: "#fff3d6", fg: "#3b2a1a", border: "#ffc93c", w: 900, h: 220 }), transparent: true, side: THREE.DoubleSide }));
      arrow.position.set(x, heightAt(x, z) + 2.6 - i * 0.65, z); arrow.rotation.y = ry + i * 0.5; g.add(arrow);
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.6, 0.06), postMat); board.position.copy(arrow.position); board.rotation.copy(arrow.rotation); board.position.y -= 0.0; board.translateZ(-0.04); g.add(board);
    });
  }
  // popcorn cart near the gate
  const cart = new THREE.Group();
  const cbox = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.0), std(0xe8253d, 0.5)); cbox.position.y = 1.0;
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.9), new THREE.MeshPhysicalMaterial({ color: 0xfff1c0, roughness: 0.1, transparent: true, opacity: 0.55 })); glass.position.y = 2.0;
  const croof = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.5, 4), new THREE.MeshStandardMaterial({ map: stripes("#e8253d", "#fff6e3", 8, true), roughness: 0.8 })); croof.position.y = 2.7; croof.rotation.y = Math.PI / 4;
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.1, 14).rotateZ(Math.PI / 2);
  const cw = new THREE.Mesh(merge([placed(wheelGeo, -0.8, 0.35, 0), placed(wheelGeo, 0.8, 0.35, 0)]), std(0x333333, 0.5, 0.3));
  const cs = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.4), new THREE.MeshBasicMaterial({ map: sign("POPCORN", { bg: "#fff3d6", fg: "#e8253d", w: 800, h: 240 }), transparent: true })); cs.position.set(0, 1.2, 0.52);
  cart.add(cbox, glass, croof, cw, cs);
  cart.position.set(10, 0, 70); cart.rotation.y = -0.5;
  cart.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.add(cart);
  g.name = "props";
  return g;
}

/** Entrance arches with signs for the rides. */
export function rideArches() {
  const g = new THREE.Group();
  const mk = (text: string, x: number, z: number, ry: number, color: string) => {
    const a = new THREE.Group();
    const pole = new THREE.CylinderGeometry(0.12, 0.14, 4.2, 10);
    const pm = std(0xfff1d6, 0.6);
    for (const sx of [-2.6, 2.6]) { const p = new THREE.Mesh(pole, pm); p.position.set(sx, 2.1, 0); p.castShadow = true; a.add(p); }
    const top = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.3, 0.3), pm); top.position.y = 4.2; a.add(top);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.4), new THREE.MeshBasicMaterial({ map: sign(text, { bg: color, fg: "#fff", border: "#fff", w: 1400, h: 380 }), transparent: true, side: THREE.DoubleSide })); s.position.y = 3.4; a.add(s);
    a.position.set(x, heightAt(x, z), z); a.rotation.y = ry;
    g.add(a);
  };
  mk("🎡 ENDGAME WHEEL", PARK.ferris.x, PARK.ferris.z + 14, 0, "#2ec4c6");
  mk("🎠 KNIGHT CAROUSEL", PARK.carousel.x + 8, PARK.carousel.z + 6, -0.6, "#ff6b8a");
  mk("🎪 CHESS CIRCUS", PARK.bigTop.x, PARK.bigTop.z + 17, 0, "#e8253d");
  mk("🚂 PUZZLE TRAIN", PARK.trainStation.x + 6, PARK.trainStation.z + 2, Math.PI / 2, "#4aa3ff");
  g.name = "arches";
  return g;
}
