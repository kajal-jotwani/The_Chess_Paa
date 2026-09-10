import * as THREE from "three";
import { Assets, pbr } from "../core/Assets";
import { cloud, glow, leafCluster } from "../core/Textures";
import { instanced, merge, placed, rnd } from "./Geo";
import { heightAt } from "./Ground";
import { PARK, pathNetwork, ATTRACTIONS } from "./Layout";

export type AvoidFn = (x: number, z: number) => boolean;

function nearPath(x: number, z: number, dist: number) {
  for (const path of pathNetwork()) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const abx = b.x - a.x, abz = b.z - a.z;
      const t = THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz), 0, 1);
      const px = a.x + abx * t, pz = a.z + abz * t;
      if (Math.hypot(x - px, z - pz) < dist) return true;
    }
  }
  return false;
}

export function defaultAvoid(extra: AvoidFn): AvoidFn {
  const keep: [number, number, number][] = [
    [PARK.castle.x, PARK.castle.z, 18], [PARK.ferris.x, PARK.ferris.z, 16], [PARK.bigTop.x, PARK.bigTop.z, 17], [PARK.carousel.x, PARK.carousel.z, 11],
    [PARK.club.x, PARK.club.z, 7], [PARK.iceCream.x, PARK.iceCream.z, 4], [PARK.foodTruck.x, PARK.foodTruck.z, 6], [PARK.gate.x, PARK.gate.z, 12], [PARK.ticketBooth.x, PARK.ticketBooth.z, 4],
    [PARK.trainStation.x, PARK.trainStation.z, 10], [16, 14, 6],
  ];
  for (const a of ATTRACTIONS) keep.push([a.board.pos.x, a.board.pos.z, 9]);
  return (x, z) => {
    if (nearPath(x, z, 4.5)) return true;
    for (const [kx, kz, r] of keep) if (Math.hypot(x - kx, z - kz) < r) return true;
    const L = PARK.lake; if (Math.hypot((x - L.center.x) / L.rx, (z - L.center.z) / L.rz) < 1.25) return true;
    const T = PARK.trainOval; const e = Math.hypot((x - T.center.x) / T.rx, (z - T.center.z) / T.rz); if (e > 0.88 && e < 1.12) return true;
    return extra(x, z);
  };
}

export function trees(assets: Assets, avoid: AvoidFn) {
  const g = new THREE.Group();
  const rand = rnd(1234);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.42, 3.4, 8).translate(0, 1.7, 0);
  const trunkMat = pbr(assets.tex.bark, { repeat: [1, 2], roughness: 1, metalness: 0, color: 0xd9c2a6 });
  // canopy = a bundle of leaf cards at random orientations around a few puffs
  const cardRand = rnd(55);
  const cards: THREE.BufferGeometry[] = [];
  const puffs: [number, number, number, number][] = [[0, 4.5, 0, 2.1], [1.3, 3.9, 0.5, 1.6], [-1.2, 4.1, -0.7, 1.5], [0.3, 5.8, -0.2, 1.4], [-0.4, 3.6, 1.2, 1.3]];
  for (const [px, py, pz, pr] of puffs) {
    for (let i = 0; i < 9; i++) {
      const g = new THREE.PlaneGeometry(pr * 1.7, pr * 1.7);
      const dir = new THREE.Vector3(cardRand() - 0.5, cardRand() - 0.5, cardRand() - 0.5).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      const off = dir.clone().multiplyScalar(pr * 0.45);
      cards.push(placed(g, px + off.x, py + off.y, pz + off.z, new THREE.Euler().setFromQuaternion(q)));
    }
  }
  const roundGeo = merge(cards);
  const pineGeo = merge([placed(new THREE.ConeGeometry(2.2, 3.2, 10), 0, 3.6, 0), placed(new THREE.ConeGeometry(1.7, 3.0, 10), 0, 5.4, 0), placed(new THREE.ConeGeometry(1.1, 2.6, 10), 0, 7.0, 0)]);
  const leafMat = new THREE.MeshStandardMaterial({ map: leafCluster(0.3), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, envMapIntensity: 0.5, color: 0xffffff });
  const pineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  const trunks: THREE.Matrix4[] = [], rounds: THREE.Matrix4[] = [], pines: THREE.Matrix4[] = [];
  const roundCols: THREE.Color[] = [], pineCols: THREE.Color[] = [];
  const place = (x: number, z: number) => {
    const y = heightAt(x, z);
    const s = 0.75 + rand() * 0.6;
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.1, z), rot, new THREE.Vector3(s, s, s));
    trunks.push(m);
    if (rand() < 0.62) { rounds.push(m); roundCols.push(new THREE.Color().setHSL(0.27 + rand() * 0.08, 0.5, 0.5 + rand() * 0.25)); }
    else { pines.push(m); pineCols.push(new THREE.Color().setHSL(0.36 + rand() * 0.05, 0.45, 0.22 + rand() * 0.1)); }
  };
  // outer ring
  for (let i = 0; i < 520; i++) {
    const a = rand() * Math.PI * 2, r = 104 + rand() * 60;
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.95;
    if (avoid(x, z)) continue;
    place(x, z);
  }
  // inner lawns
  const lawns: [number, number, number, number][] = [[-30, -30, 14, 10], [34, 8, 10, 12], [-70, 30, 10, 8], [60, -10, 9, 14], [-10, -30, 8, 6], [20, -60, 8, 6], [-40, 52, 9, 6]];
  for (const [cx, cz, rx, rz] of lawns) for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand());
    const x = cx + Math.cos(a) * r * rx * 0.9, z = cz + Math.sin(a) * r * rz * 0.9;
    if (avoid(x, z)) continue;
    place(x, z);
  }
  // sprinkle inside the park edge
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2, r = 78 + rand() * 24;
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.9;
    if (avoid(x, z)) continue;
    place(x, z);
  }
  g.add(instanced(trunkGeo, trunkMat, trunks), instanced(roundGeo, leafMat, rounds, roundCols), instanced(pineGeo, pineMat, pines, pineCols));
  g.name = "trees";
  return g;
}

export function shrubsAndFlowers(avoid: AvoidFn) {
  const g = new THREE.Group();
  const rand = rnd(77);
  const bushGeo = new THREE.SphereGeometry(0.9, 10, 8).scale(1, 0.7, 1).translate(0, 0.45, 0);
  const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const bushes: THREE.Matrix4[] = [], bushCols: THREE.Color[] = [];
  const flowerGeo = merge([placed(new THREE.SphereGeometry(0.09, 6, 5), 0, 0.26, 0), placed(new THREE.CylinderGeometry(0.015, 0.015, 0.26, 4), 0, 0.13, 0), placed(new THREE.SphereGeometry(0.16, 6, 5).scale(1, 0.4, 1), 0, 0.05, 0)]);
  const flowerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  const flowers: THREE.Matrix4[] = [], flowerCols: THREE.Color[] = [];
  const palette = [0xff4f6d, 0xffc93c, 0xff8fb1, 0xb388ff, 0xffffff, 0xff7a1a];
  for (const path of pathNetwork()) for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const len = a.distanceTo(b), n = Math.floor(len / 7);
    for (let k = 0; k <= n; k++) {
      const t = (k + 0.5) / (n + 1);
      const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
      const dx = -(b.z - a.z) / len, dz = (b.x - a.x) / len;
      for (const side of [-1, 1]) {
        const x = px + dx * side * 3.6 + (rand() - 0.5), z = pz + dz * side * 3.6 + (rand() - 0.5);
        if (avoid(x, z) && !nearPath(x, z, 5)) continue;
        if (rand() < 0.5) {
          const s = 0.6 + rand() * 0.7;
          bushes.push(new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(x, z), z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
          bushCols.push(new THREE.Color().setHSL(0.28 + rand() * 0.06, 0.55, 0.36 + rand() * 0.1));
        }
        for (let f = 0; f < 10; f++) {
          const fx = x + (rand() - 0.5) * 2.0, fz = z + (rand() - 0.5) * 2.0;
          flowers.push(new THREE.Matrix4().setPosition(fx, heightAt(fx, fz), fz));
          flowerCols.push(new THREE.Color(palette[Math.floor(rand() * palette.length)]));
        }
      }
    }
  }
  // flower beds around the plaza
  for (let i = 0; i < 520; i++) {
    const a = rand() * Math.PI * 2, r = 25 + rand() * 2.2;
    const x = Math.cos(a) * r, z = 8 + Math.sin(a) * r;
    if (nearPath(x, z, 3)) continue;
    flowers.push(new THREE.Matrix4().setPosition(x, heightAt(x, z), z));
    flowerCols.push(new THREE.Color(palette[Math.floor(rand() * palette.length)]));
  }
  const bm = instanced(bushGeo, bushMat, bushes, bushCols);
  const fm = instanced(flowerGeo, flowerMat, flowers, flowerCols); fm.castShadow = false;
  g.add(bm, fm);
  g.name = "flowers";
  return g;
}

export class Sky3D {
  readonly group = new THREE.Group();
  private clouds: THREE.Sprite[] = [];
  private balloons: { g: THREE.Group; base: THREE.Vector3; phase: number }[] = [];
  constructor() {
    const rand = rnd(9);
    const cmat = new THREE.SpriteMaterial({ map: cloud(), transparent: true, opacity: 0.92, depthWrite: false });
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(cmat);
      const sc = 40 + rand() * 50;
      s.scale.set(sc, sc * 0.55, 1);
      s.position.set((rand() - 0.5) * 520, 70 + rand() * 50, (rand() - 0.5) * 520);
      this.clouds.push(s); this.group.add(s);
    }
    const bmat = [0xe84a5f, 0xffc93c, 0x2ec4c6, 0x7bc96f, 0xff8fb1, 0x8e7cc3].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, metalness: 0.05, envMapIntensity: 1.2 }));
    const bgeo = new THREE.SphereGeometry(0.42, 14, 12).scale(1, 1.2, 1);
    const knot = new THREE.ConeGeometry(0.1, 0.18, 6).translate(0, -0.55, 0);
    const string = new THREE.CylinderGeometry(0.012, 0.012, 3.2, 4).translate(0, -2.2, 0);
    const smat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let i = 0; i < 26; i++) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(bgeo, bmat[i % bmat.length]); b.castShadow = true;
      const k = new THREE.Mesh(knot, bmat[i % bmat.length]);
      const st = new THREE.Mesh(string, smat);
      g.add(b, k, st);
      const a = rand() * Math.PI * 2, r = 14 + rand() * 60;
      const x = Math.cos(a) * r, z = 6 + Math.sin(a) * r * 0.9;
      const base = new THREE.Vector3(x, heightAt(x, z) + 3.6 + rand() * 1.5, z);
      g.position.copy(base);
      this.balloons.push({ g, base, phase: rand() * 6 });
      this.group.add(g);
    }
    this.group.name = "sky3d";
  }
  update(dt: number, t: number) {
    for (const c of this.clouds) { c.position.x += dt * 0.9; if (c.position.x > 280) c.position.x = -280; }
    for (const b of this.balloons) {
      b.g.position.y = b.base.y + Math.sin(t * 0.8 + b.phase) * 0.35;
      b.g.rotation.z = Math.sin(t * 0.6 + b.phase) * 0.08;
      b.g.rotation.x = Math.cos(t * 0.5 + b.phase) * 0.06;
    }
  }
}

/** Bunting strings between poles around the plaza and stations. */
export function bunting(pairs: [THREE.Vector3, THREE.Vector3][]) {
  const g = new THREE.Group();
  const tri = new THREE.BufferGeometry();
  tri.setAttribute("position", new THREE.Float32BufferAttribute([-0.22, 0, 0, 0.22, 0, 0, 0, -0.42, 0], 3));
  tri.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  tri.setIndex([0, 1, 2]);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.8 });
  const flags: THREE.Matrix4[] = [], cols: THREE.Color[] = [];
  const palette = [0xe84a5f, 0xffc93c, 0x2ec4c6, 0x7bc96f, 0xff8fb1];
  const linePts: THREE.Vector3[] = [];
  const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 1, 6).translate(0, 0.5, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xfff1d6, roughness: 0.6 });
  const poles: THREE.Matrix4[] = [];
  let k = 0;
  for (const [a, b] of pairs) {
    const n = Math.max(3, Math.floor(a.distanceTo(b) / 0.7));
    for (const p of [a, b]) poles.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, heightAt(p.x, p.z), p.z), new THREE.Quaternion(), new THREE.Vector3(1, p.y - heightAt(p.x, p.z), 1)));
    let prev: THREE.Vector3 | null = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(t * Math.PI) * a.distanceTo(b) * 0.06;
      if (prev) linePts.push(prev, p);
      prev = p;
      if (i < n) {
        const dir = b.clone().sub(a).setY(0).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
        flags.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
        cols.push(new THREE.Color(palette[k++ % palette.length]));
      }
    }
  }
  const fm = instanced(tri, mat, flags, cols); fm.castShadow = false;
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(linePts), new THREE.LineBasicMaterial({ color: 0xffffff }));
  g.add(fm, lines, instanced(poleGeo, poleMat, poles));
  g.name = "bunting";
  return g;
}

export function sunSprite() {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow("#fff5c8"), transparent: true, depthWrite: false, opacity: 0.0 }));
  s.scale.set(60, 60, 1);
  return s;
}
