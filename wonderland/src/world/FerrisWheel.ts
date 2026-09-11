import * as THREE from "three";
import { instanced, merge, placed } from "./Geo";
import { stripes } from "../core/Textures";
import { FolkFactory } from "./Characters";

const GONDOLA_COLORS = [0xe84a5f, 0xffc93c, 0x2ec4c6, 0x7bc96f, 0xff8fb1, 0x8e7cc3];
const RIDER_KINDS = ["pawn", "bishop", "rook", "pawn", "knight", "queen", "pawn", "king", "bishop", "pawn", "rook", "knight"];

/** The Endgame Ferris Wheel: skyline icon, always turning, gondolas stay upright. */
export class FerrisWheel {
  readonly group = new THREE.Group();
  readonly wheel = new THREE.Group();
  readonly gondolas: THREE.Group[] = [];
  readonly radius = 13;
  readonly hubHeight = 15.5;
  private angle = 0;
  private lights: THREE.InstancedMesh;

  constructor(position: THREE.Vector3, folk: FolkFactory) {
    this.group.position.copy(position);
    const steel = new THREE.MeshStandardMaterial({ color: 0xf6f6f6, roughness: 0.4, metalness: 0.5, envMapIntensity: 1 });
    const red = new THREE.MeshStandardMaterial({ color: 0xe0413f, roughness: 0.45, metalness: 0.2 });
    // one shared glass for every cabin and the booth; Atmosphere warms it with the lamps (userData.window)
    const winMat = new THREE.MeshPhysicalMaterial({ color: 0xbfe9ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.5, emissive: 0xffb45c, emissiveIntensity: 0 });
    winMat.userData.window = true;
    const R = this.radius;
    this.wheel.position.y = this.hubHeight;
    // rims
    for (const z of [-0.9, 0.9]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.2, 10, 96), red);
      rim.position.z = z; rim.castShadow = true;
      this.wheel.add(rim);
      const inner = new THREE.Mesh(new THREE.TorusGeometry(R * 0.45, 0.12, 8, 64), steel);
      inner.position.z = z; this.wheel.add(inner);
    }
    // spokes (instanced)
    const spokeGeo = new THREE.CylinderGeometry(0.06, 0.06, R, 6).translate(0, R / 2, 0);
    const mats: THREE.Matrix4[] = [];
    for (const z of [-0.9, 0.9]) for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(0, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a), new THREE.Vector3(1, 1, 1)));
    }
    // cross-ties between the two rims
    const tieGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6).rotateX(Math.PI / 2);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
    }
    const spokes = instanced(spokeGeo, steel, mats.slice(0, 40));
    const ties = instanced(tieGeo, steel, mats.slice(40));
    this.wheel.add(spokes, ties);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 3.2, 24).rotateX(Math.PI / 2), red);
    this.wheel.add(hub);
    // bulbs on the rim
    const bulbGeo = new THREE.SphereGeometry(0.16, 8, 6);
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1b0, emissive: 0xffd36b, emissiveIntensity: 2.4, roughness: 0.3 });
    const bulbs: THREE.Matrix4[] = [];
    for (const z of [-0.9, 0.9]) for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      bulbs.push(new THREE.Matrix4().setPosition(Math.cos(a) * R, Math.sin(a) * R, z + Math.sign(z) * 0.28));
    }
    this.lights = instanced(bulbGeo, bulbMat, bulbs);
    this.lights.castShadow = false;
    this.wheel.add(this.lights);
    this.group.add(this.wheel);

    // A-frame supports
    const legGeo = new THREE.CylinderGeometry(0.28, 0.4, 1, 10).translate(0, 0.5, 0);
    for (const z of [-1.3, 1.3]) for (const x of [-5.5, 5.5]) {
      const from = new THREE.Vector3(x, 0, z * 2.2), to = new THREE.Vector3(0, this.hubHeight, z);
      const len = from.distanceTo(to);
      const leg = new THREE.Mesh(legGeo, steel);
      leg.position.copy(from);
      leg.scale.set(1, len, 1);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      leg.castShadow = true;
      this.group.add(leg);
    }
    // braces tie each leg pair together above head height (at y 5 the legs sit at x ±3.73, z ±2.36);
    // a mid-plane beam lower down would sit exactly where every gondola's roof and hanger pass at the bottom
    for (const z of [-2.36, 2.36]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.4, 0.4), steel);
      b.position.set(0, 5, z); b.castShadow = true;
      this.group.add(b);
    }
    const base = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.5, 0.5, 40), new THREE.MeshStandardMaterial({ color: 0xd9d0c0, roughness: 0.9 }));
    base.position.y = 0.25; base.receiveShadow = true; this.group.add(base);

    // loading deck on the +z side at cabin-floor height, chrome handrails on three sides — the
    // wheel-facing edge stays open as the boarding gate (deck z 1.2–3.4; a cabin at the bottom reaches z 0.78)
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 2.2), steel);
    deck.position.set(0, 0.6, 2.3); deck.receiveShadow = true; deck.castShadow = true;
    this.group.add(deck);
    const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.3, metalness: 0.9 });
    const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.0, 8).translate(0, 0.5, 0);
    const railGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6).rotateZ(Math.PI / 2);
    const alongZ = new THREE.Euler(0, Math.PI / 2, 0);
    const rails = new THREE.Mesh(merge([
      placed(postGeo, -1.55, 0.7, 1.3), placed(postGeo, 1.55, 0.7, 1.3), placed(postGeo, -1.55, 0.7, 3.3), placed(postGeo, 1.55, 0.7, 3.3),
      placed(railGeo, -1.55, 1.65, 2.3, alongZ, new THREE.Vector3(2.0, 1, 1)),
      placed(railGeo, 1.55, 1.65, 2.3, alongZ, new THREE.Vector3(2.0, 1, 1)),
      placed(railGeo, 0, 1.65, 3.3, undefined, new THREE.Vector3(3.1, 1, 1)),
    ]), chrome);
    rails.castShadow = true;
    this.group.add(rails);
    // operator's booth beside the deck, window toward the gate
    const booth = new THREE.Group();
    const bb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 1.2), red); bb.position.y = 1.1; bb.castShadow = true;
    const bw = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), winMat); bw.position.set(0, 1.45, 0.61);
    const broof = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.55, 4), new THREE.MeshStandardMaterial({ map: stripes("#2ec4c6", "#fff6e3", 8, true), roughness: 0.8 }));
    broof.position.y = 2.5; broof.rotation.y = Math.PI / 4; broof.castShadow = true;
    booth.add(bb, bw, broof);
    booth.position.set(2.8, 0, 2.8); booth.rotation.y = -Math.PI / 2;
    this.group.add(booth);

    // gondolas hang from the rim and stay level
    const cabinGeo = merge([
      placed(new THREE.BoxGeometry(1.9, 1.5, 1.5), 0, -1.1, 0),
      placed(new THREE.ConeGeometry(1.35, 0.7, 6), 0, -0.05, 0),
      placed(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), 0, 0.3, 0),
    ]);
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group();
      const cabin = new THREE.Mesh(cabinGeo, new THREE.MeshStandardMaterial({ color: GONDOLA_COLORS[i % GONDOLA_COLORS.length], roughness: 0.4, metalness: 0.1 }));
      cabin.castShadow = true; cabin.receiveShadow = true;
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.6, 1.55), winMat);
      win.position.y = -0.9;
      g.add(cabin, win);
      // a rider in every cabin except 0 and 3 — App.ts seats the player in those two
      if (i !== 0 && i !== 3) {
        const r = folk.create(RIDER_KINDS[i], 0.55);
        r.setSeated(true);
        r.root.position.set(0, -1.55, 0);
        r.root.rotation.y = i % 2 ? Math.PI / 2 : -Math.PI / 2; // look out along the direction of travel
        r.root.traverse((o) => { o.castShadow = false; });
        g.add(r.root);
      }
      this.gondolas.push(g);
      this.group.add(g);
    }
    this.group.name = "ferris";
    this.update(0);
  }

  update(dt: number) {
    this.angle += dt * 0.09;
    this.wheel.rotation.z = this.angle;
    const R = this.radius;
    for (let i = 0; i < this.gondolas.length; i++) {
      const a = this.angle + (i / this.gondolas.length) * Math.PI * 2;
      const g = this.gondolas[i];
      g.position.set(Math.cos(a) * R, this.hubHeight + Math.sin(a) * R, 0);
      g.rotation.z = Math.sin(this.angle * 2 + i) * 0.04;
    }
  }
}
