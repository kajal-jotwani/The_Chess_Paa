import * as THREE from "three";
import { Assets, pbr } from "../core/Assets";
import { instanced, merge, placed, rnd } from "./Geo";
import { heightAt } from "./Ground";
import { ATTRACTIONS, PARK, pathNetwork } from "./Layout";
import { glow } from "../core/Textures";

/** Paved plazas: cobbles under every board and a grand circle at the centre. */
export function paving(assets: Assets) {
  const g = new THREE.Group();
  const mat = pbr(assets.tex.cobble, { repeat: 6, roughness: 1, metalness: 0, color: 0xe9dcc6, normalScale: 0.8, envMapIntensity: 0.6 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xf6efe2, roughness: 0.85 });
  const disc = (x: number, z: number, r: number) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48).rotateX(-Math.PI / 2), mat);
    m.position.set(x, heightAt(x, z) + 0.035, z); m.receiveShadow = true;
    const edge = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.35, 48).rotateX(-Math.PI / 2), rim);
    edge.position.set(x, heightAt(x, z) + 0.04, z); edge.receiveShadow = true;
    g.add(m, edge);
  };
  disc(0, 8, 24);
  for (const a of ATTRACTIONS) if (a.id !== "grand_match") disc(a.board.pos.x, a.board.pos.z, 9.5);
  disc(PARK.carousel.x, PARK.carousel.z, 9.5);
  disc(PARK.gate.x, PARK.gate.z - 10, 12);
  g.name = "paving";
  return g;
}

/** A fountain with a basin, tiers and sprite spray. */
export class Fountain {
  readonly group = new THREE.Group();
  private drops: THREE.Sprite[] = [];
  private age: number[] = [];
  private t = 0;
  constructor(pos: THREE.Vector3) {
    this.group.position.copy(pos);
    const stone = new THREE.MeshStandardMaterial({ color: 0xe7e0d2, roughness: 0.7 });
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.5, 0.9, 40), stone); basin.position.y = 0.45;
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 3.8, 0.9, 40), new THREE.MeshPhysicalMaterial({ color: 0x3fa9d8, roughness: 0.08, transparent: true, opacity: 0.85, clearcoat: 1 })); inner.position.y = 0.5;
    const tier = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.0, 0.4, 32), stone); tier.position.y = 2.2;
    const tierWater = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.3, 32), inner.material); tierWater.position.y = 2.3;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 1.6, 20), stone); column.position.y = 1.4;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 1.2, 16), stone); top.position.y = 3.0;
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffd23c, metalness: 0.6, roughness: 0.3 })); crown.position.y = 3.7;
    this.group.add(basin, inner, tier, tierWater, column, top, crown);
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const mat = new THREE.SpriteMaterial({ map: glow("#dff4ff"), transparent: true, opacity: 0.8, depthWrite: false });
    for (let i = 0; i < 90; i++) { const s = new THREE.Sprite(mat); s.scale.setScalar(0.35); this.group.add(s); this.drops.push(s); this.age.push(Math.random() * 1.6); }
    this.group.name = "fountain";
  }
  update(dt: number) {
    this.t += dt;
    for (let i = 0; i < this.drops.length; i++) {
      this.age[i] += dt;
      if (this.age[i] > 1.6) this.age[i] = 0;
      const a = this.age[i], k = (i / this.drops.length) * Math.PI * 2;
      const r = 0.15 + a * 1.9;
      const y = 3.6 + a * 4.2 - 4.9 * a * a;
      const d = this.drops[i];
      d.position.set(Math.cos(k + i) * r, y, Math.sin(k + i) * r);
      d.material.opacity = Math.max(0, 0.85 - a * 0.45);
      d.scale.setScalar(0.25 + a * 0.35);
    }
  }
}

/** White picket fences along the walkways and hedges around the boards. */
export function fencesAndHedges() {
  const g = new THREE.Group();
  const picket = merge([placed(new THREE.BoxGeometry(0.08, 0.9, 0.05), 0, 0.45, 0), placed(new THREE.ConeGeometry(0.06, 0.12, 4), 0, 0.96, 0)]);
  const rail = new THREE.BoxGeometry(1.0, 0.06, 0.04);
  const white = new THREE.MeshStandardMaterial({ color: 0xfbfaf5, roughness: 0.6 });
  const pickets: THREE.Matrix4[] = [], rails: THREE.Matrix4[] = [];
  const paths = pathNetwork();
  const rand = rnd(31);
  for (const path of paths) for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const len = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    if (rand() < 0.35) continue; // leave gaps so the park breathes
    for (const sgn of [-1, 1]) {
      if (rand() < 0.3) continue;
      const off = 4.2;
      const n = Math.floor(len / 0.5);
      for (let k = 2; k < n - 2; k++) {
        const p = a.clone().addScaledVector(dir, k * 0.5).addScaledVector(side, sgn * off);
        if (Math.hypot(p.x, p.z - 8) < 26) continue; // keep the grand plaza open
        p.y = heightAt(p.x, p.z);
        pickets.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
        if (k % 2 === 0) { rails.push(new THREE.Matrix4().compose(p.clone().add(new THREE.Vector3(0, 0.35, 0)).addScaledVector(dir, 0.5), q, new THREE.Vector3(1, 1, 1))); rails.push(new THREE.Matrix4().compose(p.clone().add(new THREE.Vector3(0, 0.75, 0)).addScaledVector(dir, 0.5), q, new THREE.Vector3(1, 1, 1))); }
      }
    }
  }
  const pk = instanced(picket, white, pickets); pk.castShadow = false; const rl = instanced(rail, white, rails); rl.castShadow = false;
  g.add(pk, rl);
  // hedges: a ring of trimmed boxes around each board plaza
  const hedgeGeo = new THREE.BoxGeometry(1.6, 0.9, 0.8);
  const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 0.95 });
  const hedges: THREE.Matrix4[] = [], cols: THREE.Color[] = [];
  for (const a of ATTRACTIONS) {
    const r = a.id === "grand_match" ? 23 : 9;
    const n = Math.round(r * 2.6);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const x = a.board.pos.x + Math.cos(ang) * r, z = a.board.pos.z + Math.sin(ang) * r;
      // gaps for the walkways
      let nearPath = false;
      for (const path of paths) for (let s = 0; s < path.length - 1; s++) {
        const p = path[s], q = path[s + 1]; const abx = q.x - p.x, abz = q.z - p.z; const t = THREE.MathUtils.clamp(((x - p.x) * abx + (z - p.z) * abz) / (abx * abx + abz * abz), 0, 1);
        if (Math.hypot(x - (p.x + abx * t), z - (p.z + abz * t)) < 4.2) nearPath = true;
      }
      if (nearPath) continue;
      hedges.push(new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(x, z) + 0.45, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang), new THREE.Vector3(1, 1, 1)));
      cols.push(new THREE.Color().setHSL(0.3 + rand() * 0.04, 0.5, 0.3 + rand() * 0.08));
    }
  }
  g.add(instanced(hedgeGeo, hedgeMat, hedges, cols));
  g.name = "fences";
  return g;
}

/** A small flock of birds wheeling over the park. */
export class Birds {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private t = 0;
  private n = 18;
  private phases: number[] = [];
  constructor() {
    const wing = new THREE.BufferGeometry();
    wing.setAttribute("position", new THREE.Float32BufferAttribute([-0.6, 0.15, 0, 0, 0, 0, 0, 0, 0.18, 0.6, 0.15, 0, 0, 0, 0, 0, 0, 0.18], 3));
    wing.setIndex([0, 1, 2, 3, 5, 4]);
    wing.computeVertexNormals();
    this.mesh = new THREE.InstancedMesh(wing, new THREE.MeshBasicMaterial({ color: 0x2b2b2b, side: THREE.DoubleSide }), this.n);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < this.n; i++) this.phases.push(Math.random() * 100);
    this.group.add(this.mesh);
    this.group.name = "birds";
  }
  update(dt: number) {
    this.t += dt;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < this.n; i++) {
      const ph = this.phases[i];
      const a = this.t * 0.12 + ph, r = 60 + Math.sin(ph) * 25;
      const p = new THREE.Vector3(Math.cos(a) * r + Math.sin(ph * 3) * 10, 36 + Math.sin(this.t * 0.5 + ph) * 4 + (i % 5), -20 + Math.sin(a) * r * 0.8);
      const flap = Math.sin(this.t * 9 + ph) * 0.6;
      q.setFromEuler(new THREE.Euler(0, -a + Math.PI / 2, 0));
      s.set(1, 1 + flap, 1);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
