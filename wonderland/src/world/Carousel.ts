import * as THREE from "three";
import { stripes, sign } from "../core/Textures";
import { instanced } from "./Geo";

/** A carousel whose horses are chess knights. */
export class Carousel {
  readonly group = new THREE.Group();
  private spinning = new THREE.Group();
  private knights: THREE.Object3D[] = [];
  private t = 0;
  constructor(position: THREE.Vector3, knightMesh: THREE.Mesh, matWhite: THREE.Material, matBlack: THREE.Material) {
    this.group.position.copy(position);
    const R = 6;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.4, R + 0.8, 0.6, 48), new THREE.MeshStandardMaterial({ map: stripes("#ff6b8a", "#fff6e3", 24, true), roughness: 0.7 }));
    base.position.y = 0.3; base.receiveShadow = true; base.castShadow = true;
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.2, R + 0.2, 0.15, 48), new THREE.MeshStandardMaterial({ color: 0xf1d9a6, roughness: 0.8 }));
    floor.position.y = 0.65; floor.receiveShadow = true;
    this.spinning.add(floor);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 4.4, 24), new THREE.MeshStandardMaterial({ color: 0xffd23c, roughness: 0.35, metalness: 0.3 }));
    column.position.y = 2.8; column.castShadow = true;
    this.spinning.add(column);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(R + 1.2, 2.8, 24, 1, true), new THREE.MeshStandardMaterial({ map: stripes("#ff4f6d", "#fff6e3", 24, true), roughness: 0.75, side: THREE.DoubleSide }));
    roof.position.y = 6.4; roof.castShadow = true; roof.receiveShadow = true;
    this.spinning.add(roof);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 1.2, 0.18, 8, 48).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffd23c, roughness: 0.3, metalness: 0.4 }));
    rim.position.y = 5.0; this.spinning.add(rim);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffd23c, roughness: 0.25, metalness: 0.6 }));
    ball.position.y = 8.0; this.spinning.add(ball);
    // bulbs around the rim
    const bulbs: THREE.Matrix4[] = [];
    for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; bulbs.push(new THREE.Matrix4().setPosition(Math.cos(a) * (R + 1.2), 4.75, Math.sin(a) * (R + 1.2))); }
    const lights = instanced(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffd36b, emissiveIntensity: 2.2 }), bulbs);
    lights.castShadow = false;
    this.spinning.add(lights);
    // knights on poles
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 4.4, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xffd23c, roughness: 0.3, metalness: 0.6 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = Math.cos(a) * (R - 1.4), z = Math.sin(a) * (R - 1.4);
      const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.set(x, 2.9, z); this.spinning.add(pole);
      const k = new THREE.Mesh(knightMesh.geometry, i % 2 ? matBlack : matWhite);
      k.castShadow = true; k.receiveShadow = true;
      k.scale.setScalar(1.15);
      k.position.set(x, 0.75, z);
      k.rotation.y = -a + Math.PI / 2; // face along the spin direction
      this.spinning.add(k);
      this.knights.push(k);
    }
    this.group.add(base, this.spinning);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.3), new THREE.MeshBasicMaterial({ map: sign("KNIGHT CAROUSEL", { bg: "#ffe9a0", fg: "#3b2a1a", border: "#e84a5f", w: 1200, h: 320 }), transparent: true, side: THREE.DoubleSide }));
    s.position.set(0, 3.9, R + 1.6);
    this.group.add(s);
    this.group.name = "carousel";
  }
  update(dt: number) {
    this.t += dt;
    this.spinning.rotation.y = this.t * 0.28;
    this.knights.forEach((k, i) => { k.position.y = 0.75 + Math.abs(Math.sin(this.t * 1.5 + i * 0.8)) * 0.6; });
  }
}
