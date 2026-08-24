"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { SPINE_CURVE, frameAt, STOP_T, type StopName } from "./coasterSpine";
import CoasterCar from "./CoasterCar";

/**
 * THE RIDE — how ChessPaa carries a child from one stage to the next.
 *
 * Between hubs, travel is ON-RAILS: the child sits in the plush little car,
 * ChessPaa's lantern swinging up front, and the world slides past on a track
 * choreographed for maximum wonder.
 *
 * The choreography is the whole point, so it is authored, not simulated:
 *   • the SLOW CLIMB is deliberately slow — it hides the view and builds want
 *   • at the CREST the car almost stalls and the lens widens: THE REVEAL
 *   • the DROP is fast and swooping, and the riders lean
 *   • arrival SETTLES with a soft plush give, then hands over to free look
 *
 * We never let a child sit and wait: finishing a ride puts the car right
 * there, humming, ready. Zero friction, zero empty screens.
 */

export type RideState = "idle" | "travelling" | "arriving";

/** Where the crest sits on the spine (STOP_T.coaster), and how wide it reaches. */
const CREST_T = () => STOP_T.coaster;
const CREST_HALF_WIDTH = 0.075;

/** How close to the crest we are, 0..1 — drives the stall and the lens. */
function crestInfluence(t: number): number {
  let d = Math.abs(((t - CREST_T() + 0.5 + 1) % 1) - 0.5);
  return 1 - THREE.MathUtils.smoothstep(d, 0, CREST_HALF_WIDTH);
}

/** Shortest forward distance from a to b around the loop. */
function forwardDelta(a: number, b: number): number {
  return ((b - a) % 1 + 1) % 1;
}

export interface RideAPI {
  travelTo: (stop: StopName) => void;
  state: RideState;
  at: StopName;
  t: number;
}

export default function RideController({
  start = "gate" as StopName,
  onArrive,
  onCrest,
  cameraMode = "rail",
  children,
  apiRef,
}: {
  start?: StopName;
  onArrive?: (stop: StopName) => void;
  onCrest?: () => void;
  /** "rail" = camera rides the car. "free" = an attraction owns the camera. */
  cameraMode?: "rail" | "free";
  children?: React.ReactNode;
  apiRef?: React.MutableRefObject<RideAPI | null>;
}) {
  const { camera } = useThree();
  const carGroup = useRef<THREE.Group>(null);

  const t = useRef(STOP_T[start]);
  const target = useRef<number | null>(null);
  const targetStop = useRef<StopName>(start);
  const speed = useRef(0);
  const [state, setState] = useState<RideState>("idle");
  const [displaySpeed, setDisplaySpeed] = useState(0);
  const settle = useRef(0);
  const crestFired = useRef(false);

  const travelTo = useCallback((stop: StopName) => {
    targetStop.current = stop;
    target.current = STOP_T[stop];
    crestFired.current = false;
    setState("travelling");
  }, []);

  useEffect(() => {
    if (apiRef) {
      apiRef.current = { travelTo, state, at: targetStop.current, t: t.current };
    }
  }, [apiRef, travelTo, state]);

  const camPos = useRef(new THREE.Vector3());
  const camLook = useRef(new THREE.Vector3());

  useFrame((_, dt) => {
    const d = Math.min(dt, 1 / 30);

    if (target.current !== null) {
      const remaining = forwardDelta(t.current, target.current);
      const crest = crestInfluence(t.current);

      // Fire the reveal beat once, as the car reaches the crest.
      if (crest > 0.72 && !crestFired.current) {
        crestFired.current = true;
        onCrest?.();
      }

      // --- the speed curve, authored for feeling, not physics ---
      // base: gentle cruise
      let want = 0.055;
      // the climb into the crest slows right down and builds anticipation
      want *= THREE.MathUtils.lerp(1, 0.28, crest);
      // the drop just after the crest is fast and swooping
      const past = forwardDelta(CREST_T(), t.current);
      if (past > 0 && past < 0.10) {
        want *= THREE.MathUtils.lerp(2.6, 1.0, past / 0.10);
      }
      // ease into the platform so arrival lands softly
      if (remaining < 0.05) want *= THREE.MathUtils.lerp(0.12, 1, remaining / 0.05);

      speed.current += (want - speed.current) * Math.min(1, d * 2.2);
      t.current = (t.current + speed.current * d) % 1;

      if (remaining < 0.004) {
        t.current = target.current;
        target.current = null;
        speed.current = 0;
        settle.current = 1;              // the plush give on arrival
        setState("arriving");
        onArrive?.(targetStop.current);
        setTimeout(() => setState("idle"), 520);
      }
    } else {
      speed.current *= 1 - Math.min(1, d * 4);
      settle.current *= 1 - Math.min(1, d * 3.4);
    }

    if (Math.abs(displaySpeed - speed.current) > 0.004) setDisplaySpeed(speed.current);

    // ---- place the car on the stable banked frame ----
    const f = frameAt(t.current);
    const g = carGroup.current;
    if (g) {
      g.position.copy(f.pos);
      g.position.y += 0.16 - settle.current * 0.055;   // settles into its springs
      const m = new THREE.Matrix4().makeBasis(f.binormal, f.normal, f.tangent);
      g.quaternion.setFromRotationMatrix(m);
    }

    // ---- the rail camera rides with the car ----
    if (cameraMode === "rail") {
      const crest = crestInfluence(t.current);

      // Sit just behind and above the car, looking forward down the track.
      const behind = f.pos.clone()
        .addScaledVector(f.tangent, -3.4)
        .addScaledVector(f.normal, 1.85);
      const ahead = SPINE_CURVE.getPointAt((t.current + 0.02) % 1);

      // At the crest the camera lifts and turns to hand the child the valley.
      const revealPos = f.pos.clone()
        .addScaledVector(f.tangent, -2.0)
        .addScaledVector(f.normal, 3.2);
      const revealLook = new THREE.Vector3(-10, 2, 4);

      camPos.current.lerpVectors(behind, revealPos, crest);
      camLook.current.lerpVectors(ahead, revealLook, crest);

      const k = 1 - Math.exp(-d * 4.2);
      camera.position.lerp(camPos.current, k);
      const cur = new THREE.Vector3();
      camera.getWorldDirection(cur);
      camera.lookAt(camLook.current);

      // FOV lifts with speed (that low, streaking warmth) and widens further
      // at the crest so the whole wonderland fits in one breath.
      const cam = camera as THREE.PerspectiveCamera;
      const wantFov = 46 + speed.current * 90 + crest * 14;
      cam.fov += (Math.min(74, wantFov) - cam.fov) * k;
      cam.updateProjectionMatrix();
    }
  });

  const carChildren = useMemo(() => children, [children]);

  return (
    <group ref={carGroup}>
      <CoasterCar t={t.current} speed={displaySpeed}>
        {carChildren}
      </CoasterCar>
    </group>
  );
}
