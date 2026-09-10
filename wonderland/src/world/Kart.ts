import * as THREE from "three";
import * as CANNON from "cannon-es";
import { World } from "./World";
import { PARK, ATTRACTIONS } from "./Layout";
import { merge, placed } from "./Geo";
import { sign } from "../core/Textures";

/**
 * A Bruno-Simon-style physics playground: a drivable kart (cannon-es raycast
 * vehicle), pawn bowling pins, beach balls and a tower of letter blocks to
 * crash through.  Everything sleeps when idle so it costs nothing at rest.
 */
export class Playground {
  readonly physics = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  readonly group = new THREE.Group();
  readonly vehicle: CANNON.RaycastVehicle;
  readonly chassis: CANNON.Body;
  readonly kart = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private dyn: { body: CANNON.Body; mesh: THREE.Object3D }[] = [];
  input = { forward: 0, steer: 0, brake: 0 };
  private maxSteer = 0.55;
  private maxForce = 900;
  private driver?: THREE.Object3D;

  constructor(private world: World) {
    const p = this.physics;
    p.broadphase = new CANNON.SAPBroadphase(p);
    p.allowSleep = true;
    (p.solver as CANNON.GSSolver).iterations = 8;
    p.defaultContactMaterial.friction = 0.35;
    p.defaultContactMaterial.restitution = 0.15;
    const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    p.addBody(ground);

    // static obstacles: buildings, ride bases, lake rim, park fence
    const box = (x: number, z: number, w: number, h: number, d: number, ry = 0) => {
      const b = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)) });
      b.position.set(x, h / 2, z); b.quaternion.setFromEuler(0, ry, 0); p.addBody(b);
    };
    const cyl = (x: number, z: number, r: number, h: number) => {
      const b = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(r, r, h, 12) });
      b.position.set(x, h / 2, z); p.addBody(b);
    };
    box(PARK.castle.x, PARK.castle.z, 22, 8, 16);
    cyl(PARK.bigTop.x, PARK.bigTop.z, 11.5, 6);
    cyl(PARK.carousel.x, PARK.carousel.z, 6.8, 2);
    cyl(PARK.ferris.x, PARK.ferris.z, 9.5, 2);
    box(PARK.club.x, PARK.club.z, 6.5, 5, 5.5, 0.35);
    box(PARK.foodTruck.x, PARK.foodTruck.z, 5.5, 3, 2.4, Math.PI + 0.3);
    box(PARK.ticketBooth.x, PARK.ticketBooth.z, 2.4, 3, 2.4);
    box(PARK.iceCream.x, PARK.iceCream.z, 2, 1.5, 1.2, -0.4);
    for (const x of [-7, 7]) box(PARK.gate.x + x, PARK.gate.z, 2.2, 9, 2.2);
    cyl(PARK.umbrella.x, PARK.umbrella.z, 0.15, 5);
    for (const a of ATTRACTIONS) box(a.board.pos.x, a.board.pos.z, 5.6, 0.25, 5.6, a.board.yaw);
    box(PARK.trainStation.x - 2.4, PARK.trainStation.z, 3.2, 0.7, 12);
    // lake rim + fence ring
    const L = PARK.lake;
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; box(L.center.x + Math.cos(a) * L.rx * 1.05, L.center.z + Math.sin(a) * L.rz * 1.05, 6, 1.2, 1, -a); }
    for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; box(Math.cos(a) * 112, Math.sin(a) * 104, 18, 4, 1, -a); }

    // ---- the kart
    const chassisShape = new CANNON.Box(new CANNON.Vec3(0.8, 0.3, 1.2));
    this.chassis = new CANNON.Body({ mass: 180 });
    this.chassis.addShape(chassisShape);
    this.chassis.position.set(0, 1.5, 44);
    this.chassis.angularDamping = 0.5;
    this.vehicle = new CANNON.RaycastVehicle({ chassisBody: this.chassis, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
    const wheelOpts = {
      radius: 0.4, directionLocal: new CANNON.Vec3(0, -1, 0), suspensionStiffness: 32, suspensionRestLength: 0.35, frictionSlip: 2.2, dampingRelaxation: 2.4, dampingCompression: 4.4,
      maxSuspensionForce: 100000, rollInfluence: 0.02, axleLocal: new CANNON.Vec3(-1, 0, 0), chassisConnectionPointLocal: new CANNON.Vec3(), maxSuspensionTravel: 0.3, customSlidingRotationalSpeed: -30, useCustomSlidingRotationalSpeed: true,
    };
    for (const [x, z] of [[-0.75, 0.9], [0.75, 0.9], [-0.75, -0.9], [0.75, -0.9]]) {
      wheelOpts.chassisConnectionPointLocal.set(x, 0, z);
      this.vehicle.addWheel(wheelOpts);
    }
    this.vehicle.addToWorld(p);
    this.buildKartMesh();
    this.buildProps();
    this.group.name = "playground";
  }

  private buildKartMesh() {
    const teal = new THREE.MeshStandardMaterial({ color: 0x2ec4c6, roughness: 0.35, metalness: 0.2, envMapIntensity: 1.2 });
    const cream = new THREE.MeshStandardMaterial({ color: 0xfff1d6, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.3 });
    const body = new THREE.Mesh(merge([
      placed(new THREE.BoxGeometry(1.5, 0.4, 2.3), 0, 0.05, 0),
      placed(new THREE.SphereGeometry(0.75, 16, 12).scale(1, 0.5, 1.1), 0, 0.15, 0.6),
      placed(new THREE.BoxGeometry(1.4, 0.35, 0.8), 0, 0.35, -0.7),
    ]), teal);
    const bumper = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.12, 8, 24, Math.PI).rotateX(Math.PI / 2).rotateY(Math.PI), cream);
    bumper.position.set(0, 0.0, 1.0); bumper.scale.set(0.95, 1, 0.7);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.2), dark); seat.position.set(0, 0.55, -0.55);
    const wheelHub = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 8, 20), dark); wheelHub.position.set(0, 0.6, 0.15); wheelHub.rotation.x = 0.5;
    const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 6), cream); flagPole.position.set(-0.6, 0.9, -1.0);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.35), new THREE.MeshBasicMaterial({ map: sign("SAY CHESS!", { bg: "#e8253d", fg: "#fff", w: 512, h: 300 }), side: THREE.DoubleSide }));
    flag.position.set(-0.3, 1.45, -1.0);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.25), new THREE.MeshBasicMaterial({ map: sign("ROOK ROVER", { bg: "#fff3d6", fg: "#3b2a1a", w: 512, h: 180 }) }));
    plate.position.set(0, 0.2, -1.16); plate.rotation.y = Math.PI;
    this.kart.add(body, bumper, seat, wheelHub, flagPole, flag, plate);
    const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 18).rotateZ(Math.PI / 2);
    const cap = new THREE.CylinderGeometry(0.2, 0.2, 0.32, 12).rotateZ(Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(merge([wheelGeo.clone(), cap.clone()]), dark);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.34, 12).rotateZ(Math.PI / 2), cream);
      w.add(hub);
      w.castShadow = true;
      this.wheels.push(w);
      this.group.add(w);
    }
    this.kart.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(this.kart);
  }

  /** Put a character (a kid) in the driving seat. */
  seatDriver(o: THREE.Object3D) {
    this.driver = o;
    o.parent?.remove(o);
    o.position.set(0, 0.25, -0.35); o.rotation.set(0, 0, 0); o.scale.setScalar(0.75);
    this.kart.add(o);
  }
  unseatDriver() { if (this.driver) { this.kart.remove(this.driver); this.driver.scale.setScalar(1); this.driver = undefined; } }

  private buildProps() {
    const geos = this.world.pieceGeos, mats = this.world.pieceMats;
    const addDyn = (mesh: THREE.Object3D, body: CANNON.Body, x: number, y: number, z: number) => {
      body.position.set(x, y, z); body.sleepSpeedLimit = 0.3; body.sleepTimeLimit = 0.6;
      this.physics.addBody(body); this.group.add(mesh); this.dyn.push({ body, mesh });
      mesh.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    };
    // pawn bowling pins on the east lawn
    const pinScale = 1.6;
    let row = 0, inRow = 0;
    const layout = [1, 2, 3, 4];
    let idx = 0;
    for (const n of layout) {
      for (let k = 0; k < n; k++) {
        const x = 34 + row * 1.3, z = 8 + (k - (n - 1) / 2) * 1.3;
        const mesh = new THREE.Mesh(geos.pawn, idx % 2 ? mats.black : mats.white);
        mesh.scale.setScalar(pinScale);
        const h = 0.51 * pinScale, r = 0.14 * pinScale;
        const body = new CANNON.Body({ mass: 1.2, shape: new CANNON.Cylinder(r, r, h, 10) });
        body.shapeOffsets[0].set(0, h / 2, 0);
        addDyn(mesh, body, x, 0.02, z);
        idx++;
      }
      row++;
    }
    void inRow;
    // beach balls
    const ballMat = [0xe84a5f, 0xffc93c, 0x2ec4c6, 0x7bc96f].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, envMapIntensity: 1.1 }));
    for (let i = 0; i < 6; i++) {
      const r = 0.55;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), ballMat[i % 4]);
      const body = new CANNON.Body({ mass: 0.6, shape: new CANNON.Sphere(r), material: new CANNON.Material({ friction: 0.3, restitution: 0.75 }) });
      body.linearDamping = 0.15;
      addDyn(mesh, body, -14 + i * 2.4, 2 + i * 0.6, 26);
    }
    // letter blocks: C H E S S
    const letters = ["C", "H", "E", "S", "S"];
    const cols = [0xe84a5f, 0xffc93c, 0x2ec4c6, 0x7bc96f, 0x8e7cc3];
    for (let i = 0; i < letters.length; i++) {
      for (let j = 0; j < 2; j++) {
        const s = 1.1;
        const mat = new THREE.MeshStandardMaterial({ map: sign(letters[i], { bg: "#" + cols[i].toString(16).padStart(6, "0"), fg: "#fff", w: 256, h: 256, size: 170 }), roughness: 0.6 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
        const body = new CANNON.Body({ mass: 1.5, shape: new CANNON.Box(new CANNON.Vec3(s / 2, s / 2, s / 2)) });
        addDyn(mesh, body, 10 + i * 1.25, s / 2 + j * s + 0.02, 34);
      }
    }
    // a couple of giant pieces to topple
    for (const [kind, x, z] of [["king", -30, 22], ["rook", -34, 26], ["bishop", -30, 30]] as const) {
      const mesh = new THREE.Mesh(geos[kind], mats.white);
      mesh.scale.setScalar(2.2);
      const h = (geos[kind].boundingBox!.max.y) * 2.2, r = 0.45;
      const body = new CANNON.Body({ mass: 4, shape: new CANNON.Cylinder(r, r * 1.3, h, 10) });
      body.shapeOffsets[0].set(0, h / 2, 0);
      addDyn(mesh, body, x, 0.02, z);
    }
  }

  reset(x = 0, z = 44) {
    this.chassis.position.set(x, 1.2, z); this.chassis.velocity.setZero(); this.chassis.angularVelocity.setZero(); this.chassis.quaternion.set(0, 0, 0, 1);
  }

  update(dt: number) {
    const v = this.vehicle;
    const force = -this.input.forward * this.maxForce; // cannon forward axis is +z; our kart nose is +z visually
    v.applyEngineForce(force, 2); v.applyEngineForce(force, 3);
    v.setSteeringValue(this.input.steer * this.maxSteer, 0); v.setSteeringValue(this.input.steer * this.maxSteer, 1);
    const brake = this.input.brake * 40;
    for (let i = 0; i < 4; i++) v.setBrake(brake, i);
    this.physics.step(1 / 60, dt, 3);
    // sync kart
    this.kart.position.copy(this.chassis.position as any);
    this.kart.quaternion.copy(this.chassis.quaternion as any);
    for (let i = 0; i < 4; i++) {
      v.updateWheelTransform(i);
      const t = v.wheelInfos[i].worldTransform;
      this.wheels[i].position.copy(t.position as any);
      this.wheels[i].quaternion.copy(t.quaternion as any);
    }
    for (const d of this.dyn) {
      if (d.body.sleepState === CANNON.Body.SLEEPING) continue;
      d.mesh.position.copy(d.body.position as any);
      d.mesh.quaternion.copy(d.body.quaternion as any);
    }
    // fell off the world? bring it back
    if (this.chassis.position.y < -5) this.reset();
  }

  speed() { return this.chassis.velocity.length(); }
  position() { return new THREE.Vector3().copy(this.chassis.position as any); }
  forward() { return new THREE.Vector3(0, 0, 1).applyQuaternion(this.kart.quaternion); }
}
