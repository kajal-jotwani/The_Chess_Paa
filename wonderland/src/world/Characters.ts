import * as THREE from "three";

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

function findByPrefix(root: THREE.Object3D, prefix: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  root.traverse((o) => { if (!found && o !== root && o.name.split(".")[0] === prefix) found = o; });
  return found;
}

/** gltfpack leaves mesh nodes unnamed under their named parent — give them the parent's name. */
function nameMeshesAfterParents(root: THREE.Object3D) {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (!o.name || /^mesh_\d+$/.test(o.name)) && o.parent && o.parent.name) {
      // an unnamed mesh directly under a joint empty is that joint's skin; under a named mesh-node it *is* that node
      o.name = o.parent.children.length === 1 && !(o.parent as THREE.Mesh).isMesh ? o.parent.name : o.parent.name + "_mesh";
    }
  });
}

function prepare(root: THREE.Object3D, envIntensity = 0.9) {
  nameMeshesAfterParents(root);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true; m.receiveShadow = true;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat && "envMapIntensity" in mat) mat.envMapIntensity = envIntensity;
    }
  });
}

/** A joint with its rest pose remembered, so animation adds to it. */
class Joint {
  rest: THREE.Quaternion;
  constructor(public node: THREE.Object3D) { this.rest = node.quaternion.clone(); }
  set(axis: THREE.Vector3, angle: number, axis2?: THREE.Vector3, angle2?: number) {
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    if (axis2 && angle2) q.multiply(new THREE.Quaternion().setFromAxisAngle(axis2, angle2));
    this.node.quaternion.copy(this.rest).multiply(q);
  }
}

/* ------------------------------------------------------------------------ */
/* Piece-folk                                                                */
/* ------------------------------------------------------------------------ */

export class Folk {
  readonly root: THREE.Group;
  private armL?: Joint; private armR?: Joint; private legs?: THREE.Object3D; private body?: THREE.Object3D;
  private phase = Math.random() * 10;
  constructor(root: THREE.Group, public kind: string) {
    this.root = root;
    const l = findByPrefix(root, "armL"), r = findByPrefix(root, "armR");
    if (l) this.armL = new Joint(l);
    if (r) this.armR = new Joint(r);
    this.legs = findByPrefix(root, "legs");
    this.body = findByPrefix(root, "body");
  }
  setSeated(seated: boolean) {
    if (this.legs) this.legs.visible = !seated;
    this.root.position.y = seated ? 0 : 0.11;
  }
  /** 0 = arms down, 1 = arms straight up (coaster drops!) */
  setArms(lift: number, t: number) {
    const w = Math.sin(t * 6 + this.phase) * 0.15 * lift;
    this.armL?.set(Z, -lift * 2.4 + w);
    this.armR?.set(Z, lift * 2.4 - w);
  }
  /** walking cycle: arm swing + a little bob/waddle */
  walk(t: number, speed: number) {
    const s = Math.sin(t * 7 * speed + this.phase);
    this.armL?.set(X, s * 0.7);
    this.armR?.set(X, -s * 0.7);
    if (this.body) { this.body.rotation.z = s * 0.06; this.body.position.y = Math.abs(Math.sin(t * 7 * speed + this.phase)) * 0.06; }
  }
  cheer(t: number) {
    const s = Math.sin(t * 9 + this.phase);
    this.armL?.set(Z, -2.2 + s * 0.3);
    this.armR?.set(Z, 2.2 - s * 0.3);
    this.root.position.y = 0.11 + Math.abs(Math.sin(t * 5 + this.phase)) * 0.18;
  }
}

export class FolkFactory {
  private templates = new Map<string, THREE.Object3D>();
  constructor(scene: THREE.Group) {
    prepare(scene);
    scene.traverse((o) => { if (o.name.endsWith("_folk")) this.templates.set(o.name.replace("_folk", ""), o); });
  }
  create(kind: string, scale = 1): Folk {
    const t = this.templates.get(kind) ?? this.templates.get("pawn")!;
    const clone = t.clone(true) as THREE.Group;
    clone.position.set(0, 0, 0);
    clone.scale.setScalar(scale);
    const wrap = new THREE.Group();
    wrap.add(clone);
    return new Folk(wrap, kind);
  }
}

/* ------------------------------------------------------------------------ */
/* ChessPaa                                                                  */
/* ------------------------------------------------------------------------ */

export type PaaMood = "idle" | "talk" | "wave" | "cheer" | "think" | "sit";

export class ChessPaa {
  readonly root: THREE.Group;
  private head?: Joint; private armL?: Joint; private forearmL?: Joint; private armR?: Joint; private forearmR?: Joint; private legL?: Joint; private legR?: Joint;
  private megaphone?: THREE.Object3D;
  mood: PaaMood = "idle";
  private talkUntil = 0;
  private blend = 0;
  constructor(scene: THREE.Group) {
    prepare(scene, 0.8);
    this.root = new THREE.Group();
    const inner = scene;
    this.root.add(inner);
    const j = (n: string) => { const o = findByPrefix(inner, n); return o ? new Joint(o) : undefined; };
    this.head = j("head"); this.armL = j("armL"); this.forearmL = j("forearmL"); this.armR = j("armR"); this.forearmR = j("forearmR"); this.legL = j("legL"); this.legR = j("legR");
    this.megaphone = findByPrefix(inner, "megaphone");
  }
  /** Speak for `seconds` — raises the megaphone and nods. */
  say(seconds: number) { this.mood = "talk"; this.talkUntil = performance.now() / 1000 + seconds; }
  update(dt: number, t: number) {
    if (this.mood === "talk" && t > this.talkUntil) this.mood = "idle";
    const target = this.mood === "idle" ? 0 : 1;
    this.blend = THREE.MathUtils.damp(this.blend, target, 6, dt);
    const b = this.blend;
    const breathe = Math.sin(t * 1.6) * 0.02;
    this.root.scale.set(1, 1 + breathe, 1);
    const idleHead = Math.sin(t * 0.6) * 0.18;
    switch (this.mood) {
      case "talk": {
        const nod = Math.sin(t * 11) * 0.06 * b;
        this.head?.set(X, -0.08 * b + nod, Y, idleHead * (1 - b) + Math.sin(t * 0.9) * 0.08 * b);
        this.armR?.set(X, -2.35 * b, Z, 0.55 * b);
        this.forearmR?.set(X, -1.35 * b, Y, 0.5 * b);
        this.armL?.set(X, Math.sin(t * 1.3) * 0.12, Z, 0.15 * b);
        this.forearmL?.set(X, -0.25 * b);
        break;
      }
      case "wave": {
        this.head?.set(Y, idleHead + 0.2 * b);
        this.armL?.set(Z, 2.6 * b + Math.sin(t * 8) * 0.25 * b, X, 0.3 * b);
        this.forearmL?.set(Z, Math.sin(t * 8) * 0.5 * b);
        this.armR?.set(X, -0.35 * b);
        break;
      }
      case "cheer": {
        const s = Math.sin(t * 7);
        this.head?.set(X, -0.25 * b, Y, s * 0.1);
        this.armL?.set(Z, (2.5 + s * 0.3) * b, X, -0.6 * b);
        this.armR?.set(Z, (-2.5 - s * 0.3) * b, X, -0.6 * b);
        this.forearmL?.set(X, -0.4 * b); this.forearmR?.set(X, -0.4 * b);
        this.root.position.y = Math.abs(s) * 0.12 * b;
        break;
      }
      case "think": {
        this.head?.set(Z, 0.18 * b, X, 0.1 * b);
        this.armR?.set(X, -1.9 * b, Z, 0.7 * b);
        this.forearmR?.set(X, -1.9 * b, Y, 0.9 * b);
        this.armL?.set(X, 0.2 * b);
        break;
      }
      case "sit": {
        this.legL?.set(X, -1.45 * b); this.legR?.set(X, -1.45 * b);
        this.armL?.set(X, -0.9 * b); this.armR?.set(X, -0.9 * b);
        this.forearmL?.set(X, -0.6 * b); this.forearmR?.set(X, -0.6 * b);
        this.head?.set(Y, idleHead);
        break;
      }
      default: {
        this.head?.set(Y, idleHead, X, Math.sin(t * 1.1) * 0.05);
        this.armL?.set(X, Math.sin(t * 1.3) * 0.12);
        this.armR?.set(X, Math.sin(t * 1.3 + 1) * 0.1);
        this.forearmR?.set(X, -0.2);
        this.legL?.set(X, 0); this.legR?.set(X, 0);
        this.root.position.y = THREE.MathUtils.damp(this.root.position.y, 0, 6, dt);
      }
    }
    if (this.mood !== "cheer" && this.mood !== "sit") { this.legL?.set(X, 0); this.legR?.set(X, 0); }
  }
}

/* ------------------------------------------------------------------------ */
/* Grandchildren                                                             */
/* ------------------------------------------------------------------------ */

export class Kid {
  readonly root: THREE.Group;
  private head?: Joint; private armL?: Joint; private armR?: Joint; private legL?: Joint; private legR?: Joint;
  private phase = Math.random() * 6;
  mood: "idle" | "sit" | "cheer" | "think" = "idle";
  constructor(node: THREE.Object3D) {
    prepare(node, 0.8);
    this.root = new THREE.Group();
    const clone = node.clone(true); clone.position.set(0, 0, 0);
    this.root.add(clone);
    const j = (n: string) => { const o = findByPrefix(clone, n); return o ? new Joint(o) : undefined; };
    this.head = j("head"); this.armL = j("armL"); this.armR = j("armR"); this.legL = j("legL"); this.legR = j("legR");
  }
  update(dt: number, t: number) {
    const s = Math.sin(t * 1.4 + this.phase);
    switch (this.mood) {
      case "sit":
        this.legL?.set(X, -1.5); this.legR?.set(X, -1.5);
        this.armL?.set(X, -0.5 + s * 0.1); this.armR?.set(X, -0.5 - s * 0.1);
        this.head?.set(Y, s * 0.2, X, 0.15);
        break;
      case "cheer": {
        const c = Math.sin(t * 8 + this.phase);
        this.armL?.set(Z, 2.4 + c * 0.3); this.armR?.set(Z, -2.4 - c * 0.3);
        this.root.position.y = Math.abs(c) * 0.15;
        this.head?.set(X, -0.2);
        break;
      }
      case "think":
        this.head?.set(Z, 0.2, X, 0.2); this.armR?.set(X, -1.8, Z, 0.5); this.armL?.set(X, 0.1);
        break;
      default:
        this.legL?.set(X, 0); this.legR?.set(X, 0);
        this.armL?.set(X, s * 0.15); this.armR?.set(X, -s * 0.15);
        this.head?.set(Y, s * 0.25, X, Math.sin(t * 0.9) * 0.05);
        this.root.position.y = THREE.MathUtils.damp(this.root.position.y, 0, 6, dt);
    }
  }
}
