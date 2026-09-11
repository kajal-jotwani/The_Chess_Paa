import * as THREE from "three";
import { Assets, pbr } from "../core/Assets";
import { stripes, sign } from "../core/Textures";
import { merge, placed, instanced, shadowed } from "./Geo";
import { PARK, ATTRACTIONS } from "./Layout";
import { heightAt } from "./Ground";

const std = (color: number, roughness = 0.6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

export function castle(assets: Assets) {
  const g = new THREE.Group();
  const brick = pbr(assets.tex.castle, { repeat: [3, 2], roughness: 1, metalness: 0, color: 0xf6f1e8 });
  const brickTower = pbr(assets.tex.castle, { repeat: [3, 3], roughness: 1, metalness: 0, color: 0xf6f1e8 });
  // the brick photo is dark Victorian red-brown and a multiplicative tint can only darken it;
  // lift + partly desaturate in the shader so the icon reads as pale storybook limestone
  // with the mortar lines intact, and the blue roofs and gold finials pop against it
  const stone = (m: THREE.MeshStandardMaterial) => {
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
      { float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb = mix(vec3(l), diffuseColor.rgb, 0.45) * vec3(1.9, 1.75, 1.6); diffuseColor.rgb = min(diffuseColor.rgb, vec3(0.92)); }`);
    };
    m.customProgramCacheKey = () => "castle-stone";
  };
  stone(brick); stone(brickTower);
  const roofBlue = std(0x3f6fc9, 0.5), roofPurple = std(0x7d55c4, 0.5), goldM = std(0xffd23c, 0.3, 0.6);
  const winMat = new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.4, metalness: 0.2, emissive: 0xffb45c, emissiveIntensity: 0 });
  winMat.userData.window = true; // Atmosphere lights windows with the lamps: dark by day, warm at night
  const winGeo = new THREE.BoxGeometry(0.7, 1.2, 0.2);
  const wins: THREE.Matrix4[] = [];
  const tower = (x: number, z: number, r: number, h: number, roofH: number, roof: THREE.Material) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, h, 20), brickTower); t.position.set(x, h / 2, z);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.25, r * 1.05, 0.8, 20), std(0xf4ece0, 0.9)); ring.position.set(x, h, z);
    const rf = new THREE.Mesh(new THREE.ConeGeometry(r * 1.3, roofH, 20), roof); rf.position.set(x, h + roofH / 2 + 0.3, z);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 10, 8), goldM); tip.position.set(x, h + roofH + 0.4, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), goldM); pole.position.set(x, h + roofH + 1.4, z);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), new THREE.MeshBasicMaterial({ color: [0xe84a5f, 0xffc93c, 0x2ec4c6, 0xff8fb1][Math.floor(Math.abs(x * 7 + z * 3)) % 4], side: THREE.DoubleSide })); flag.position.set(x + 0.7, h + roofH + 2.0, z);
    g.add(t, ring, rf, tip, pole, flag);
    // windows around the tower
    for (let i = 0; i < 3; i++) for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const pos = new THREE.Vector3(x + Math.cos(a) * r, 3 + i * (h - 4) / 2.5, z + Math.sin(a) * r);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
      wins.push(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)));
    }
  };
  tower(-11, -7, 2.6, 12, 5, roofBlue); tower(11, -7, 2.6, 12, 5, roofBlue); tower(-11, 7, 2.4, 10, 4.5, roofPurple); tower(11, 7, 2.4, 10, 4.5, roofPurple);
  tower(0, -2, 3.4, 22, 9, roofBlue);   // the great spire
  tower(-5, 2, 1.9, 16, 6.5, roofPurple); tower(5, 2, 1.9, 16, 6.5, roofPurple);
  // walls with battlements
  const wallGeo = merge([placed(new THREE.BoxGeometry(22, 7, 1.6), 0, 3.5, -7), placed(new THREE.BoxGeometry(22, 7, 1.6), 0, 3.5, 7), placed(new THREE.BoxGeometry(1.6, 7, 14), -11, 3.5, 0), placed(new THREE.BoxGeometry(1.6, 7, 14), 11, 3.5, 0)]);
  g.add(new THREE.Mesh(wallGeo, brick));
  const merlon = new THREE.BoxGeometry(1.0, 0.9, 1.7);
  const mats: THREE.Matrix4[] = [];
  for (let i = -10; i <= 10; i += 2) { mats.push(new THREE.Matrix4().setPosition(i, 7.45, -7)); mats.push(new THREE.Matrix4().setPosition(i, 7.45, 7)); }
  for (let i = -6; i <= 6; i += 2) { mats.push(new THREE.Matrix4().compose(new THREE.Vector3(-11, 7.45, i), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(1, 1, 1))); mats.push(new THREE.Matrix4().compose(new THREE.Vector3(11, 7.45, i), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(1, 1, 1))); }
  g.add(instanced(merlon, brick, mats));
  // keep
  const keep = new THREE.Mesh(new THREE.BoxGeometry(10, 13, 8), brick); keep.position.set(0, 6.5, 1);
  const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(7.6, 4.5, 4), roofBlue); keepRoof.position.set(0, 15.2, 1); keepRoof.rotation.y = Math.PI / 4;
  g.add(keep, keepRoof);
  for (let i = -3; i <= 3; i += 3) for (let k = 0; k < 2; k++) wins.push(new THREE.Matrix4().compose(new THREE.Vector3(i, 5 + k * 5, 5.05), new THREE.Quaternion(), new THREE.Vector3(1.4, 1.3, 1)));
  g.add(instanced(winGeo, winMat, wins));
  // gatehouse: arch, door, drawbridge
  const gateBlock = new THREE.Mesh(new THREE.BoxGeometry(7, 9, 2.4), brick); gateBlock.position.set(0, 4.5, 7.3);
  const arch = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 2.6, 24, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), std(0x2a1d12, 0.9));
  arch.position.set(0, 2.6, 8.4); arch.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  const door = new THREE.Mesh(new THREE.BoxGeometry(3.8, 4.2, 0.3), std(0x5a3a1e, 0.8)); door.position.set(0, 2.1, 8.5);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.3, 5), std(0x8b5a2b, 0.85)); bridge.position.set(0, 0.15, 11.2);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2), new THREE.MeshBasicMaterial({ map: sign("PIECE ACADEMY", { bg: "#8e5bd6", fg: "#fff", border: "#fff", emoji: "🏰", w: 1400, h: 360 }), transparent: true }));
  banner.position.set(0, 9.9, 8.6);
  g.add(gateBlock, door, bridge, banner);
  shadowed(g);
  g.position.copy(PARK.castle);
  g.name = "castle";
  return g;
}

export function bigTop() {
  const g = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(11, 11.5, 5, 32, 1, true), new THREE.MeshStandardMaterial({ map: stripes("#e8253d", "#fff6e3", 32, true), roughness: 0.8, side: THREE.DoubleSide }));
  wall.position.y = 2.5;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(12.5, 9, 32, 1, true), new THREE.MeshStandardMaterial({ map: stripes("#e8253d", "#fff6e3", 32, true), roughness: 0.8, side: THREE.DoubleSide }));
  roof.position.y = 9.5;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 8), std(0xfff1d6)); pole.position.y = 15.5;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.2), new THREE.MeshBasicMaterial({ color: 0xffc93c, side: THREE.DoubleSide })); flag.position.set(1.1, 16.8, 0);
  const awning = new THREE.Mesh(new THREE.BoxGeometry(6, 0.15, 3), new THREE.MeshStandardMaterial({ map: stripes("#e8253d", "#fff6e3", 8, false), roughness: 0.8, side: THREE.DoubleSide }));
  awning.position.set(0, 4.2, 12.4); awning.rotation.x = 0.2;
  const s = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.8), new THREE.MeshBasicMaterial({ map: sign("CHESS CIRCUS", { bg: "#fff3d6", fg: "#e8253d", border: "#e8253d", emoji: "🎪", w: 1400, h: 360 }), transparent: true }));
  s.position.set(0, 6.4, 11.6);
  g.add(wall, roof, pole, flag, awning, s);
  shadowed(g);
  // eave lights just outside and below the roof rim (base r 12.5 at y 5.0), brightened at night by Atmosphere
  const bulbs: THREE.Matrix4[] = [];
  for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; bulbs.push(new THREE.Matrix4().setPosition(Math.cos(a) * 12.8, 4.85, Math.sin(a) * 12.8)); }
  const lights = instanced(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffd36b, emissiveIntensity: 2.2 }), bulbs);
  lights.castShadow = false;
  g.add(lights);
  g.position.copy(PARK.bigTop);
  g.name = "bigtop";
  return g;
}

export function umbrella(pos: THREE.Vector3) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 5.2, 10), std(0xfff1d6, 0.4, 0.3)); pole.position.y = 2.6;
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(4.6, 1.5, 16, 1, true), new THREE.MeshStandardMaterial({ map: stripes("#3f8fd2", "#fff6e3", 16, true), roughness: 0.75, side: THREE.DoubleSide }));
  canopy.position.y = 5.0;
  const scallops: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; scallops.push(placed(new THREE.SphereGeometry(0.45, 10, 8).scale(1, 0.5, 1), Math.cos(a) * 4.5, 4.25, Math.sin(a) * 4.5)); }
  const frill = new THREE.Mesh(merge(scallops), new THREE.MeshStandardMaterial({ color: 0xfff6e3, roughness: 0.8 }));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), std(0xffd23c, 0.3, 0.6)); tip.position.y = 5.85;
  g.add(pole, canopy, frill, tip);
  shadowed(g);
  g.position.copy(pos);
  g.rotation.z = 0.08;
  return g;
}

export function shops() {
  const g = new THREE.Group();
  const cream = std(0xfff1d6, 0.8), wood = std(0xb07a4a, 0.8);
  // CLUB house
  const club = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(6.5, 4.5, 5.5), std(0x6fb3e0, 0.75)); body.position.y = 2.25;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 3, 4), std(0x2f6fa8, 0.7)); roof.position.y = 6; roof.rotation.y = Math.PI / 4;
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.2), wood); door.position.set(0, 1.2, 2.8);
  const clubWin = new THREE.MeshPhysicalMaterial({ color: 0xcdefff, roughness: 0.05, transparent: true, opacity: 0.7, emissive: 0xffb45c, emissiveIntensity: 0 });
  clubWin.userData.window = true;
  const win = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 0.2), clubWin);
  const w1 = win.clone(); w1.position.set(-2, 2.6, 2.8); const w2 = win.clone(); w2.position.set(2, 2.6, 2.8);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.2), new THREE.MeshBasicMaterial({ map: sign("CHESS CLUB", { bg: "#fff3d6", fg: "#2f6fa8", border: "#2f6fa8", w: 1200, h: 340 }), transparent: true })); s.position.set(0, 4.0, 2.9);
  club.add(body, roof, door, w1, w2, s);
  club.position.copy(PARK.club); club.rotation.y = 0.35;
  g.add(club);
  // ice-cream cart
  const cart = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.3, 1.2), cream); box.position.y = 1.05;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.4, 1.22), new THREE.MeshStandardMaterial({ map: stripes("#ff8fb1", "#fff6e3", 10, true), roughness: 0.8 })); stripe.position.y = 1.3;
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.12, 14).rotateZ(Math.PI / 2);
  const wheels = new THREE.Mesh(merge([placed(wheelGeo, -1.05, 0.35, 0.3), placed(wheelGeo, 1.05, 0.35, 0.3)]), std(0x333333, 0.5, 0.4));
  const upole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8), std(0xfff1d6)); upole.position.set(0.5, 2.4, -0.2);
  const ucan = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.6, 12, 1, true), new THREE.MeshStandardMaterial({ map: stripes("#ff8fb1", "#fff6e3", 12, true), roughness: 0.8, side: THREE.DoubleSide })); ucan.position.set(0.5, 3.7, -0.2);
  const cone = new THREE.Mesh(merge([placed(new THREE.ConeGeometry(0.28, 0.8, 12).rotateX(Math.PI), 0, 0, 0), placed(new THREE.SphereGeometry(0.3, 12, 10), 0, 0.5, 0)]), std(0xffc9d6, 0.6)); cone.position.set(-0.6, 2.4, 0.5);
  const cs = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.6), new THREE.MeshBasicMaterial({ map: sign("ICE CREAM", { bg: "#ff8fb1", fg: "#fff", w: 900, h: 300 }), transparent: true })); cs.position.set(0, 1.0, 0.62);
  cart.add(box, stripe, wheels, upole, ucan, cone, cs);
  cart.position.copy(PARK.iceCream); cart.rotation.y = -0.4;
  g.add(cart);
  // food truck
  const truck = new THREE.Group();
  const tb = new THREE.Mesh(new THREE.BoxGeometry(5.5, 2.6, 2.4), std(0xff9f43, 0.5, 0.1)); tb.position.y = 1.9;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 2.3), std(0xffb870, 0.5, 0.1)); cabin.position.set(3.4, 1.5, 0);
  const tw = new THREE.Mesh(merge([placed(wheelGeo, -1.8, 0.5, 1.2), placed(wheelGeo, 2.9, 0.5, 1.2), placed(wheelGeo, -1.8, 0.5, -1.2), placed(wheelGeo, 2.9, 0.5, -1.2)]).scale(1.3, 1.3, 1), std(0x333333, 0.5, 0.4));
  const hatch = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, 0.1), new THREE.MeshStandardMaterial({ map: stripes("#e8253d", "#fff6e3", 8, false), roughness: 0.8, side: THREE.DoubleSide })); hatch.position.set(-0.5, 3.4, 1.5); hatch.rotation.x = -0.9;
  const ts = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshBasicMaterial({ map: sign("CHECKMATE SNACKS", { bg: "#fff3d6", fg: "#e8253d", border: "#e8253d", w: 1400, h: 340 }), transparent: true })); ts.position.set(-0.5, 2.0, 1.22);
  truck.add(tb, cabin, tw, hatch, ts);
  truck.position.copy(PARK.foodTruck); truck.rotation.y = Math.PI + 0.3;
  g.add(truck);
  // ticket booth
  const booth = new THREE.Group();
  const bb = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.8, 2.4), std(0xe84a5f, 0.7)); bb.position.y = 1.4;
  const broof = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.2, 4), new THREE.MeshStandardMaterial({ map: stripes("#e84a5f", "#fff6e3", 8, true), roughness: 0.8 })); broof.position.y = 3.4; broof.rotation.y = Math.PI / 4;
  const boothWin = new THREE.MeshStandardMaterial({ color: 0x3b2a1a, roughness: 0.9, emissive: 0xffb45c, emissiveIntensity: 0 });
  boothWin.userData.window = true;
  const bwin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 0.1), boothWin); bwin.position.set(0, 1.7, 1.22);
  const bs = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.7), new THREE.MeshBasicMaterial({ map: sign("TICKETS", { bg: "#fff3d6", fg: "#e84a5f", w: 900, h: 300 }), transparent: true })); bs.position.set(0, 2.55, 1.22);
  booth.add(bb, broof, bwin, bs);
  booth.position.copy(PARK.ticketBooth);
  g.add(booth);
  // "I ♥ CHESS" sign near the plaza
  const heart = new THREE.Mesh(new THREE.PlaneGeometry(7, 2), new THREE.MeshBasicMaterial({ map: sign("I ❤ CHESS", { bg: "#2ec4c6", fg: "#fff", border: "#fff", w: 1400, h: 400 }), transparent: true, side: THREE.DoubleSide }));
  heart.position.set(16, 1.4, 14); heart.rotation.y = -0.6;
  const heartBase = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.5, 1.2), std(0x1a9ea0, 0.6)); heartBase.position.set(16, 0.25, 14); heartBase.rotation.y = -0.6;
  g.add(heart, heartBase);
  shadowed(g);
  g.name = "shops";
  return g;
}

export function gate() {
  const g = new THREE.Group();
  const stone = std(0xf1e6d2, 0.9);
  for (const x of [-7, 7]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 9, 2.2), stone); pillar.position.set(x, 4.5, 0);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.8, 4), std(0x8e5bd6, 0.6)); cap.position.set(x, 9.9, 0); cap.rotation.y = Math.PI / 4;
    g.add(pillar, cap);
  }
  const archGeo = new THREE.TorusGeometry(7, 0.55, 10, 40, Math.PI);
  const arch = new THREE.Mesh(archGeo, std(0xe84a5f, 0.5)); arch.position.y = 8.2;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(13, 3.4), new THREE.MeshBasicMaterial({ map: sign("WELCOME TO CHESS WONDERLAND", { bg: "#fff3d6", fg: "#3b2a1a", border: "#ffc93c", w: 2048, h: 540 }), transparent: true, side: THREE.DoubleSide }));
  board.position.y = 11.2;
  const bulbs: THREE.Matrix4[] = [];
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI; bulbs.push(new THREE.Matrix4().setPosition(Math.cos(a) * 7, 8.2 + Math.sin(a) * 7, 0.7)); }
  g.add(arch, board, instanced(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffd36b, emissiveIntensity: 2.2 }), bulbs));
  shadowed(g);
  g.position.copy(PARK.gate);
  g.name = "gate";
  return g;
}

/** Signs floating over each attraction's board, and benches / lamps along paths. */
export function signage() {
  const g = new THREE.Group();
  for (const a of ATTRACTIONS) {
    if (a.id === "grand_match") continue;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.7), new THREE.MeshBasicMaterial({ map: sign(a.name.toUpperCase(), { bg: "#fff3d6", fg: "#3b2a1a", border: "#e84a5f", emoji: a.emoji, w: 1400, h: 400 }), transparent: true, side: THREE.DoubleSide }));
    const p = a.board.pos.clone();
    const dir = new THREE.Vector3(Math.sin(a.board.yaw), 0, Math.cos(a.board.yaw));
    s.position.copy(p).addScaledVector(dir, -5.5).setY(4.2);
    s.lookAt(p.clone().setY(4.2));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4.2, 8), std(0xfff1d6)); post.position.copy(s.position).setY(2.1);
    g.add(s, post);
  }
  const gm = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 1.8), new THREE.MeshBasicMaterial({ map: sign("GRAND MATCH", { bg: "#ffc93c", fg: "#3b2a1a", border: "#fff", emoji: "♟️", w: 1400, h: 400 }), transparent: true, side: THREE.DoubleSide }));
  gm.position.set(-8, 4.4, 4); gm.rotation.y = 0.9;
  const gmPost = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4.4, 8), std(0xfff1d6)); gmPost.position.set(-8, 2.2, 4);
  g.add(gm, gmPost);
  shadowed(g);
  return g;
}

// posts flank the avenue's two lanes (x ±9 from z 27 to 46) and the fountain island, never the basin rim
export const LAMP_SPOTS: [number, number][] = [[-4, 60], [4, 60], [-13, 40], [13, 40], [-9, 20], [9, 20], [18, 36], [-18, 36], [12, -6], [-8, -14], [26, -30], [-14, -40], [34, -56], [-38, -22], [-50, 0], [-6, -56], [24, 56], [-16, 56]];

/** [x, z, yaw] — the bench's seat faces +z rotated by yaw; World seats a piece-folk on each. */
export const BENCH_SPOTS: [number, number, number][] = [[-13, 26, 0.3], [13, 26, -0.3], [-12, 12, 1.2], [14, 8, -1.2], [-18, 40, 0.8], [22, 44, -0.8], [40, -50, 0], [-20, -56, 0], [-34, -6, -0.8], [10, 50, 0]];

export function furniture() {
  const g = new THREE.Group();
  const benchGeo = merge([placed(new THREE.BoxGeometry(1.8, 0.08, 0.5), 0, 0.5, 0), placed(new THREE.BoxGeometry(1.8, 0.4, 0.08), 0, 0.8, -0.24), placed(new THREE.BoxGeometry(0.08, 0.5, 0.5), -0.8, 0.25, 0), placed(new THREE.BoxGeometry(0.08, 0.5, 0.5), 0.8, 0.25, 0)]);
  const benchMat = std(0x9b6b3f, 0.8);
  const lampGeo = merge([placed(new THREE.CylinderGeometry(0.06, 0.09, 3.6, 8), 0, 1.8, 0), placed(new THREE.SphereGeometry(0.28, 12, 10), 0, 3.75, 0), placed(new THREE.CylinderGeometry(0.28, 0.4, 0.12, 12), 0, 0.06, 0)]);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x2a3a4a, roughness: 0.5, metalness: 0.4 });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffd36b, emissiveIntensity: 1.2 });
  const benches: THREE.Matrix4[] = [], lamps: THREE.Matrix4[] = [], bulbs: THREE.Matrix4[] = [];
  for (const [x, z, ry] of BENCH_SPOTS) {
    benches.push(new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(x, z), z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1)));
  }
  for (const [x, z] of LAMP_SPOTS) {
    const y = heightAt(x, z);
    lamps.push(new THREE.Matrix4().setPosition(x, y, z));
    bulbs.push(new THREE.Matrix4().setPosition(x, y + 3.75, z));
  }
  g.add(instanced(benchGeo, benchMat, benches), instanced(lampGeo, lampMat, lamps));
  const bl = instanced(new THREE.SphereGeometry(0.22, 10, 8), bulbMat, bulbs); bl.castShadow = false; g.add(bl);
  g.name = "furniture";
  return g;
}
