"use client";

import { useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import CoasterCar from "../world/CoasterCar";
import ChessPaa from "../characters/ChessPaa";
import { Grandchild } from "../characters/Grandchildren";
import { SPINE_CURVE, frameAt, STOP_T } from "../world/coasterSpine";
import { director, input, stationFor } from "./gameState";
import { speakAsChessPaa } from "@/lib/audio/chessPaaVoice";
import { setMusicMood } from "@/lib/audio/score";
import { isAudioReady } from "@/lib/audio";

/**
 * THE RIDE — the heart of the whole request.
 *
 * The child boards at the gate; ChessPaa sits up front with his lantern; the
 * kids sit behind him; and the train carries everyone through the park,
 * pulling in at the level stations. The speed curve is authored for feeling:
 * the slow climb hides the valley, the crest hands it to you all at once,
 * the drop earns a lean from everyone aboard.
 */

const CREST_T = () => STOP_T.coaster;
const CREST_HALF = 0.075;

function crestInfluence(t: number): number {
  const d = Math.abs((((t - CREST_T()) % 1) + 1.5) % 1 - 0.5);
  return 1 - THREE.MathUtils.smoothstep(d, 0, CREST_HALF);
}

function forwardDelta(a: number, b: number): number {
  return (((b - a) % 1) + 1) % 1;
}

export default function TrainRide() {
  const { camera } = useThree();
  const carGroup = useRef<THREE.Group>(null);
  const speed = useRef(0);
  const said = useRef<string>("");            // guard: one line per leg/stop
  const crestFired = useRef(false);
  const camPos = useRef(new THREE.Vector3());
  const camLook = useRef(new THREE.Vector3());
  // React state (not a ref): the kids' reaction must re-render their props.
  const [reaction, setReaction] = useState<"idle" | "lean" | "gasp">("idle");
  const reactionRef = useRef(reaction);
  const lean = (r: "idle" | "lean" | "gasp") => {
    if (reactionRef.current !== r) { reactionRef.current = r; setReaction(r); }
  };

  // seats, in car-local space (car is ~2 units long, +Z forward)
  const seatPaa: [number, number, number] = [0, 0.62, 0.55];
  const seatKidA: [number, number, number] = [-0.22, 0.62, -0.35];
  const seatKidB: [number, number, number] = [0.24, 0.62, -0.55];

  useFrame((state, rawDt) => {
    const riding = director.mode === "riding";
    const g = carGroup.current;
    if (!g) return;
    g.visible = riding || director.mode === "cine";
    if (!riding) { speed.current = 0; return; }
    const dt = Math.min(rawDt, 1 / 30);

    const next = director.nextStation;
    const tNow = director.rideT;

    if (director.atStation) {
      // stopped at a platform; the HUD offers hop-off / keep-riding
      speed.current = 0;
    } else if (next) {
      const target = STOP_T[next.stop];
      const remaining = forwardDelta(tNow, target);
      const crest = crestInfluence(tNow);

      // ---- the authored speed curve ----
      let want = 0.052;
      want *= THREE.MathUtils.lerp(1, 0.26, crest);           // the climb slows
      const past = forwardDelta(CREST_T(), tNow);
      if (past > 0 && past < 0.1) want *= THREE.MathUtils.lerp(2.7, 1, past / 0.1); // the drop
      if (remaining < 0.05) want *= Math.max(0.14, remaining / 0.05);               // ease in
      speed.current += (want - speed.current) * Math.min(1, dt * 2.4);
      director.rideT = (tNow + speed.current * dt) % 1;

      // the crest beat — the reveal, said once per lap
      if (crest > 0.75 && !crestFired.current) {
        crestFired.current = true;
        director.say("Look, little one… the whole wonderland, all at once. This is my favourite bend in the world.", "delighted");
        if (isAudioReady()) { setMusicMood("reveal"); speakAsChessPaa("Look! The whole wonderland, all at once!", "delighted"); }
        lean("gasp");
      }
      if (crest < 0.2 && past > 0.12) crestFired.current = false;

      // kids lean into the fast parts
      if (reactionRef.current !== "gasp" || crest < 0.3) lean(speed.current > 0.075 ? "lean" : "idle");

      // arrival
      if (remaining < 0.004) {
        director.rideT = target;
        director.atStation = next;
        director.nextStation = null;
        speed.current = 0;
        lean("idle");
        const st = stationFor(next.stop);
        if (st && said.current !== `arr:${st.stop}`) {
          said.current = `arr:${st.stop}`;
          director.say(st.arrive, st.level ? "teaching" : "warm");
          if (isAudioReady()) { speakAsChessPaa(st.arrive, st.level ? "teaching" : "warm"); setMusicMood("plaza"); }
        }
        director.emit();
      } else if (said.current !== `leg:${next.stop}`) {
        said.current = `leg:${next.stop}`;
        director.say(next.depart, "warm");
        if (isAudioReady()) { speakAsChessPaa(next.depart, "warm"); setMusicMood("quiet"); }
      }
    }

    // interact while stopped = hop off (same button that boarded)
    if (director.atStation && input.consumeInteract()) {
      const st = director.atStation;
      director.hopOff();
      if (st.lesson) director.openLesson(st.lesson, st);
      return;
    }

    /* ---- place the car on the banked frame ---- */
    const f = frameAt(director.rideT);
    g.position.copy(f.pos);
    g.position.y += 0.16;
    const m = new THREE.Matrix4().makeBasis(f.binormal, f.normal, f.tangent);
    g.quaternion.setFromRotationMatrix(m);

    /* ---- the rail camera rides with everyone ---- */
    const crest = crestInfluence(director.rideT);
    const behind = f.pos.clone().addScaledVector(f.tangent, -4.1).addScaledVector(f.normal, 2.1);
    const ahead = SPINE_CURVE.getPointAt((director.rideT + 0.02) % 1);
    const revealPos = f.pos.clone().addScaledVector(f.tangent, -2.2).addScaledVector(f.normal, 3.4);
    const revealLook = new THREE.Vector3(-10, 2, 4);
    camPos.current.lerpVectors(behind, revealPos, crest);
    camLook.current.lerpVectors(ahead, revealLook, crest);

    const k = 1 - Math.exp(-dt * 4.4);
    camera.position.lerp(camPos.current, k);
    camera.lookAt(camLook.current);
    const cam = camera as THREE.PerspectiveCamera;
    const wantFov = 48 + speed.current * 130 + crest * 15;
    cam.fov += (Math.min(76, wantFov) - cam.fov) * k;
    cam.updateProjectionMatrix();
  });

  return (
    <group ref={carGroup} visible={false}>
      <CoasterCar t={0} speed={speed.current} showLantern={false} />
      {/* ChessPaa drives, lantern in hand — the warmest point of the train */}
      <group position={seatPaa} scale={0.78}>
        <ChessPaa mood="talking" lantern lanternIntensity={2.6} breathFog={false} />
      </group>
      {/* the kids — including you — sitting at his back */}
      <group position={seatKidA} rotation={[0, 0.08, 0]} scale={0.8}>
        <Grandchild which={0} reaction={reaction} breathFog={false} seed={5} />
      </group>
      <group position={seatKidB} rotation={[0, -0.06, 0]} scale={0.76}>
        <Grandchild which={1} reaction={reaction} breathFog={false} seed={11} delay={0.18} />
      </group>
    </group>
  );
}
