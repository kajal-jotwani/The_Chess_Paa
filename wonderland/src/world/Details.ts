import * as THREE from "three";
import { Assets, pbr } from "../core/Assets";
import { instanced, merge, placed, rnd } from "./Geo";
import { heightAt } from "./Ground";
import { ATTRACTIONS, PAVED, pathNetwork, onPaving, nearPath } from "./Layout";
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
  for (const d of PAVED) disc(d.x, d.z, d.r);
  g.name = "paving";
  return g;
}

/**
 * PointsMaterial whose per-vertex `aSize` attribute scales gl_PointSize, so one
 * draw call can stand in for a field of differently-sized glow sprites.  `size`
 * is set so a point of aSize = s covers the same pixels as a sprite of world
 * scale s: sprite px = s·(h/2)/(z·tan(fov/2)), point px = aSize·size·(h/2)/z.
 */
export function sizedPoints(map: THREE.Texture, fovDeg: number, opts: { blending?: THREE.Blending } = {}) {
  const mat = new THREE.PointsMaterial({ map, size: 1 / Math.tan(THREE.MathUtils.degToRad(fovDeg / 2)), sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: opts.blending ?? THREE.NormalBlending });
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace("void main() {", "attribute float aSize;\nvoid main() {").replace("gl_PointSize = size;", "gl_PointSize = size * aSize;");
  };
  mat.customProgramCacheKey = () => "aSize";
  return mat;
}

const CAMERA_FOV = 50; // Renderer.ts camera fov; only affects the point/sprite size equivalence

/** A fountain with a basin, tiers and a spray of 90 water drops in one draw call. */
export class Fountain {
  readonly group = new THREE.Group();
  private readonly n = 90;
  private age: number[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private sz: Float32Array;
  private geo: THREE.BufferGeometry;
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
    // the spray: one THREE.Points with per-drop alpha + size (the old 90 sprites
    // shared one material, so the whole spray pulsed in unison — now every drop
    // fades on its own, and it's 1 draw call instead of 90)
    this.pos = new Float32Array(this.n * 3); this.col = new Float32Array(this.n * 4); this.sz = new Float32Array(this.n);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.sz, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 0), 6);
    const spray = new THREE.Points(this.geo, sizedPoints(glow("#dff4ff"), CAMERA_FOV));
    spray.name = "spray";
    this.group.add(spray);
    for (let i = 0; i < this.n; i++) this.age.push(Math.random() * 1.6);
    this.group.name = "fountain";
  }
  update(dt: number) {
    this.t += dt;
    const tint = [0.87, 0.96, 1.0];
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] > 1.6) this.age[i] = 0;
      const a = this.age[i], k = (i / this.n) * Math.PI * 2;
      const r = 0.15 + a * 1.9;
      const y = 3.6 + a * 4.2 - 4.9 * a * a;
      this.pos[i * 3] = Math.cos(k + i) * r; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = Math.sin(k + i) * r;
      this.col[i * 4] = tint[0]; this.col[i * 4 + 1] = tint[1]; this.col[i * 4 + 2] = tint[2]; this.col[i * 4 + 3] = Math.max(0, 0.85 - a * 0.45);
      this.sz[i] = 0.25 + a * 0.35;
    }
    for (const k of ["position", "color", "aSize"]) (this.geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
  }
}

/**
 * A fireworks show over the plaza: one THREE.Points of 600 additive sparks.
 * `show(seconds)` fires a warm burst every ~1.1 s; sparks fall under gravity
 * and fade by scaling their colour toward black (additive, so black = gone).
 */
export class Fireworks {
  readonly points: THREE.Points;
  private readonly n = 600;
  private pos = new Float32Array(this.n * 3);
  private col = new Float32Array(this.n * 3);
  private vel = new Float32Array(this.n * 3);
  private base = new Float32Array(this.n * 3);
  private life = new Float32Array(this.n);
  private head = 0;
  private t = 0;
  private showUntil = -1;
  private nextBurst = 0;
  private geo = new THREE.BufferGeometry();
  private palette = [0xffd23c, 0xff5d5d, 0x35d07f, 0xffa640, 0x7ec8ff];
  constructor() {
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({ map: glow("#ffffff"), size: 0.6 / Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)), sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.name = "fireworks";
    for (let i = 0; i < this.n; i++) this.pos[i * 3 + 1] = -50;
  }
  /** One shell bursting at `at`. */
  burst(at: THREE.Vector3, color: number, count = 110) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.head; this.head = (this.head + 1) % this.n;
      // uniform direction on the sphere, speed spread so the shell has a soft edge
      const u = Math.random() * 2 - 1, ph = Math.random() * Math.PI * 2, s = 7 + Math.random() * 7;
      const rr = Math.sqrt(1 - u * u);
      this.vel[i * 3] = rr * Math.cos(ph) * s; this.vel[i * 3 + 1] = u * s + 1.5; this.vel[i * 3 + 2] = rr * Math.sin(ph) * s;
      this.pos[i * 3] = at.x; this.pos[i * 3 + 1] = at.y; this.pos[i * 3 + 2] = at.z;
      const tw = 0.85 + Math.random() * 0.3;
      this.base[i * 3] = c.r * tw; this.base[i * 3 + 1] = c.g * tw; this.base[i * 3 + 2] = c.b * tw;
      this.life[i] = 1.6 + Math.random() * 0.8;
    }
    this.points.visible = true;
  }
  /** Run a show for `seconds` over the plaza. */
  show(seconds = 8) {
    this.showUntil = this.t + seconds;
    this.nextBurst = this.t;
  }
  update(dt: number) {
    this.t += dt;
    if (this.t < this.showUntil && this.t >= this.nextBurst) {
      this.nextBurst = this.t + 0.9 + Math.random() * 0.5;
      this.burst(new THREE.Vector3(-25 + Math.random() * 50, 26 + Math.random() * 10, -35 + Math.random() * 30), this.palette[Math.floor(Math.random() * this.palette.length)]);
    }
    if (!this.points.visible) return;
    let any = false;
    const drag = Math.exp(-dt * 0.9);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      any = true;
      this.life[i] -= dt;
      this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - 6.5 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const a = THREE.MathUtils.clamp(this.life[i] / 1.2, 0, 1) * (0.7 + 0.3 * Math.sin(this.t * 18 + i)); // flicker as they die
      this.col[i * 3] = this.base[i * 3] * a; this.col[i * 3 + 1] = this.base[i * 3 + 1] * a; this.col[i * 3 + 2] = this.base[i * 3 + 2] * a;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    if (!any && this.t >= this.showUntil) this.points.visible = false;
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
        // plazas and the fountain island stay open, and no picket lands on a crossing walkway at a junction
        if (onPaving(p.x, p.z, 2) || Math.hypot(p.x, p.z - 36) < 9 || nearPath(p.x, p.z, 3.4)) continue;
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
