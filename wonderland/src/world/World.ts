import * as THREE from "three";
import { Assets } from "../core/Assets";
import { buildGround, heightAt } from "./Ground";
import { Coaster } from "./Coaster";
import { FerrisWheel } from "./FerrisWheel";
import { Train } from "./Train";
import { Carousel } from "./Carousel";
import { castle, bigTop, umbrella, shops, gate, signage, furniture, LAMP_SPOTS, BENCH_SPOTS } from "./Buildings";
import { trees, shrubsAndFlowers, Sky3D, bunting, defaultAvoid, grassTufts, sunSprite } from "./Nature";
import { FolkFactory, Folk, ChessPaa, Kid } from "./Characters";
import { PARK, ATTRACTIONS, FOUNTAIN, pathNetwork, byId, AttractionId } from "./Layout";
import { pieceMaterials, pieceGeometries, PieceMaterials } from "../chess/Materials";
import { paving, Fountain, fencesAndHedges, Birds, Fireworks } from "./Details";
import { SwanBoats, parkProps, rideArches } from "./Props";

/** A piece-folk walking a path out and back; `far` is the turnaround node, `pause` the seconds left in a breather. */
interface Wanderer { folk: Folk; path: THREE.Vector3[]; far: number; seg: number; t: number; speed: number; pause: number; }

/** The whole park: scenery, rides, characters and lights, updated once per frame. */
export class World {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sunGlow: THREE.Sprite;
  readonly wetMaterials: THREE.MeshStandardMaterial[] = [];
  /** where the night point lights sit (a subset of the posts — every light costs every lit fragment) */
  readonly lampSpots: THREE.Vector3[] = [];
  /** every lamp post's bulb, for the cheap additive glow sprites */
  readonly lampGlowSpots: THREE.Vector3[] = [];
  readonly fireworks: Fireworks;
  readonly coaster: Coaster;
  readonly ferris: FerrisWheel;
  readonly train: Train;
  readonly carousel: Carousel;
  readonly folkFactory: FolkFactory;
  readonly chessPaa: ChessPaa;
  readonly kids: Kid[];
  readonly pieceMats: PieceMaterials;
  readonly pieceGeos: Record<string, THREE.BufferGeometry>;
  readonly pieceGeosLod: Record<string, THREE.BufferGeometry>;
  private ground: ReturnType<typeof buildGround>;
  readonly sky3d: Sky3D;
  private fountain: Fountain;
  private birds: Birds;
  private swans: SwanBoats;
  private wanderers: Wanderer[] = [];
  private time = 0;
  private shadowTarget = new THREE.Object3D();

  constructor(readonly scene: THREE.Scene, readonly assets: Assets) {
    scene.background = assets.skyMap;
    scene.environment = assets.envMap;
    scene.environmentIntensity = 0.75;
    scene.backgroundIntensity = 1.0;
    scene.backgroundRotation = new THREE.Euler(0, -0.9, 0);
    scene.environmentRotation = new THREE.Euler(0, -0.9, 0);
    scene.fog = new THREE.Fog(0xdceeff, 160, 480); // matches the day spec in Atmosphere so the first frame is consistent

    this.sun = new THREE.DirectionalLight(0xffe2bd, 3.6);
    this.sun.position.set(90, 70, 60);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 400;
    this.sun.target = this.shadowTarget;
    scene.add(this.sun, this.shadowTarget);
    const hemi = new THREE.HemisphereLight(0xcfe6ff, 0xd9c39a, 0.4);
    scene.add(hemi);
    this.hemi = hemi;
    const glowS = sunSprite();
    this.sunGlow = glowS;
    glowS.position.set(90, 70, 60).normalize().multiplyScalar(420);
    (glowS.material as THREE.SpriteMaterial).opacity = 0.9;
    (glowS.material as THREE.SpriteMaterial).blending = THREE.AdditiveBlending;
    glowS.scale.set(120, 120, 1);
    scene.add(glowS);
    this.setShadowFocus(new THREE.Vector3(0, 0, -10), 120);

    this.pieceMats = pieceMaterials(assets);
    this.pieceGeos = pieceGeometries(assets.models.pieces);
    this.pieceGeosLod = pieceGeometries(assets.models.pieces_lod);
    this.folkFactory = new FolkFactory(assets.models.piecefolk);

    this.ground = buildGround(assets);
    this.group.add(this.ground.group);
    this.ground.group.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; if (m && o.name === "terrain") this.wetMaterials.push(m); });
    this.coaster = new Coaster(this.folkFactory);
    this.group.add(this.coaster.group);
    this.ferris = new FerrisWheel(PARK.ferris, this.folkFactory);
    this.group.add(this.ferris.group);
    this.train = new Train(this.folkFactory);
    this.group.add(this.train.group);
    const knight = new THREE.Mesh(this.pieceGeosLod.knight);
    this.carousel = new Carousel(PARK.carousel, knight, this.pieceMats.white, this.pieceMats.black);
    this.group.add(this.carousel.group);
    const pav = paving(assets);
    pav.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; if (m && m.map && !this.wetMaterials.includes(m)) this.wetMaterials.push(m); });
    this.group.add(castle(assets), bigTop(), umbrella(PARK.umbrella), shops(), gate(), signage(), furniture(), pav, fencesAndHedges());
    // point lights: one over each outlying board (a player sits there at night), the eight
    // walkway/gate posts, and two landmark lights (castle drawbridge, wheel base) so the icons
    // aren't black silhouettes at night — 14 total; every one is a per-fragment cost in a forward renderer
    for (const a of ATTRACTIONS) if (a.board.pos.lengthSq() > 200) this.lampSpots.push(a.board.pos.clone().add(new THREE.Vector3(0, 4.5, 0)));
    const LIT: [number, number][] = [[-4, 60], [4, 60], [-13, 40], [13, 40], [-9, 20], [9, 20], [18, 36], [-18, 36]];
    for (const [x, z] of LIT) this.lampSpots.push(new THREE.Vector3(x, heightAt(x, z) + 3.6, z));
    for (const [x, z, h] of [[PARK.castle.x, PARK.castle.z + 14, 6], [PARK.ferris.x, PARK.ferris.z + 8, 5]]) this.lampSpots.push(new THREE.Vector3(x, heightAt(x, z) + h, z));
    // every post gets a glow sprite at bulb height so unlit posts still read as lit
    for (const [x, z] of LAMP_SPOTS) this.lampGlowSpots.push(new THREE.Vector3(x, heightAt(x, z) + 3.75, z));
    this.fountain = new Fountain(FOUNTAIN.clone());
    this.group.add(this.fountain.group);
    this.fireworks = new Fireworks();
    this.group.add(this.fireworks.points);
    this.birds = new Birds();
    this.group.add(this.birds.group);
    this.swans = new SwanBoats();
    this.group.add(this.swans.group, parkProps(), rideArches());

    const track = this.coaster.frames.filter((_, i) => i % 6 === 0).map((f) => f.p);
    const stations = this.coaster.stations.map((s) => s.pos);
    const avoid = defaultAvoid((x, z) => {
      for (const p of stations) if (Math.hypot(x - p.x, z - p.z) < 9) return true; // station sheds are 6.5 × 14 m
      for (const p of track) if (Math.hypot(x - p.x, z - p.z) < 3.2) return true;
      return false;
    });
    this.group.add(trees(assets, avoid), shrubsAndFlowers(avoid), grassTufts(avoid));
    this.sky3d = new Sky3D();
    this.group.add(this.sky3d.group);
    const P = (x: number, z: number, h = 3.2) => new THREE.Vector3(x, heightAt(x, z) + h, z);
    this.group.add(bunting([[P(-10, 24), P(10, 24)], [P(-12, -6), P(12, -6)], [P(-6, 62), P(6, 62)], [P(20, 40), P(36, 40)], [P(36, -50), P(52, -50)], [P(-24, -50), P(-8, -50)], [P(-36, 12), P(-36, -4)]]));

    // ChessPaa and the grandchildren at the Grand Match board
    this.chessPaa = new ChessPaa(assets.models.chesspaa);
    this.group.add(this.chessPaa.root);
    this.kids = [];
    assets.models.kids.traverse((o) => { if (o.name === "kid_a" || o.name === "kid_b") this.kids.push(new Kid(o)); });
    for (const k of this.kids) this.group.add(k.root);
    this.placeCast("grand_match");

    // wandering piece-folk: out and back along the longer walkways (short connectors would just be pacing)
    const kinds = ["pawn", "rook", "bishop", "queen", "pawn", "knight", "king", "pawn", "bishop", "pawn", "knight", "rook"];
    const walks = pathNetwork().filter((p) => p.reduce((s, v, i) => (i ? s + v.distanceTo(p[i - 1]) : 0), 0) > 20);
    for (let i = 0; i < 18; i++) {
      const folk = this.folkFactory.create(kinds[i % kinds.length], 0.9);
      const there = i % 2 ? [...walks[i % walks.length]].reverse() : [...walks[i % walks.length]];
      const pts = [...there, ...[...there].reverse().slice(1, -1)]; // A…Z…B: the modulo wrap is now a real leg
      const seg = Math.floor(Math.random() * pts.length);
      const a = pts[seg], b = pts[(seg + 1) % pts.length];
      folk.root.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      this.group.add(folk.root);
      this.wanderers.push({ folk, path: pts, far: there.length - 1, seg, t: Math.random(), speed: 0.9 + Math.random() * 0.5, pause: 0 });
    }
    // folk resting on the benches (seat top at 0.54; the bench faces local +z, which rotation.y maps like a folk's forward)
    BENCH_SPOTS.forEach(([x, z, ry], i) => {
      const f = this.folkFactory.create(kinds[(i * 5 + 2) % kinds.length], 0.9);
      f.setSeated(true);
      const side = i % 2 ? 0.42 : -0.42;
      f.root.position.set(x + Math.cos(ry) * side, heightAt(x, z) + 0.54, z - Math.sin(ry) * side);
      f.root.rotation.y = ry;
      f.root.traverse((o) => { o.castShadow = false; });
      this.group.add(f.root);
    });
    scene.add(this.group);
  }

  /** Put ChessPaa and the kids beside an attraction's board. */
  placeCast(id: AttractionId, sitting = false) {
    // The cast may still be seated in a coaster car / kart ("Hop off & play" keeps the ride alive) —
    // bring them back into park space first, or the board-relative positions below land in car-local space.
    for (const o of [this.chessPaa.root, ...this.kids.map((k) => k.root)]) {
      if (o.parent === this.group) continue;
      o.parent?.remove(o);
      o.scale.setScalar(1);
      o.rotation.set(0, 0, 0);
      this.group.add(o);
    }
    if (this.chessPaa.mood === "sit") this.chessPaa.mood = "idle";
    const a = byId(id);
    const b = a.board.pos, yaw = a.board.yaw;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));      // toward the white player
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const paaPos = b.clone().addScaledVector(right, -4.6).addScaledVector(fwd, 0.6);
    paaPos.y = heightAt(paaPos.x, paaPos.z);
    this.chessPaa.root.position.copy(paaPos);
    this.chessPaa.root.lookAt(b.clone().addScaledVector(fwd, 4).setY(paaPos.y));
    const k0 = b.clone().addScaledVector(fwd, 3.6).addScaledVector(right, 1.6);
    const k1 = b.clone().addScaledVector(fwd, -3.6).addScaledVector(right, -1.4);
    for (const [kid, pos] of [[this.kids[0], k0], [this.kids[1], k1]] as const) {
      if (!kid) continue;
      pos.y = heightAt(pos.x, pos.z);
      kid.root.position.copy(pos);
      kid.root.lookAt(b.clone().setY(pos.y));
      kid.mood = sitting ? "sit" : "idle";
    }
  }

  /** Tighten the sun's shadow frustum around what the camera is looking at. */
  setShadowFocus(center: THREE.Vector3, size: number) {
    this.shadowTarget.position.copy(center);
    this.sun.position.copy(center).add(new THREE.Vector3(90, 70, 60));
    const c = this.sun.shadow.camera;
    c.left = -size / 2; c.right = size / 2; c.top = size / 2; c.bottom = -size / 2;
    c.updateProjectionMatrix();
    this.sun.shadow.needsUpdate = true;
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    this.ground.update(dt, t);
    this.coaster.update(dt);
    this.ferris.update(dt);
    this.train.update(dt);
    this.carousel.update(dt);
    this.sky3d.update(dt, t);
    this.fountain.update(dt);
    this.fireworks.update(dt);
    this.birds.update(dt);
    this.swans.update(dt);
    this.chessPaa.update(dt, t);
    for (const k of this.kids) k.update(dt, t);
    for (const w of this.wanderers) {
      const a = w.path[w.seg], b = w.path[(w.seg + 1) % w.path.length];
      // turn toward the current leg smoothly — so the about-face at the end of a walk happens during the breather
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      const dy = Math.atan2(Math.sin(yaw - w.folk.root.rotation.y), Math.cos(yaw - w.folk.root.rotation.y));
      w.folk.root.rotation.y += dy * Math.min(1, dt * 6);
      if (w.pause > 0) { w.pause -= dt; w.folk.idle(t); continue; }
      const len = a.distanceTo(b) || 1;
      w.t += (dt * w.speed) / len;
      if (w.t >= 1) {
        w.t = 0; w.seg = (w.seg + 1) % w.path.length;
        if (w.seg === 0 || w.seg === w.far) w.pause = 2 + Math.random() * 2; // a look around at either end
      }
      const p = a.clone().lerp(b, w.t);
      p.y = heightAt(p.x, p.z);
      w.folk.root.position.copy(p);
      w.folk.walk(t, w.speed);
    }
  }
}
