"use client";

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import PlayerRig from "./PlayerRig";
import TrainRide from "./TrainRide";
import ChessPaa from "../characters/ChessPaa";
import { terrainHeight } from "../world/terrain";
import { director, grantStars, STATIONS, type LessonKind } from "./gameState";
import PiecesLesson from "./lessons/PiecesLesson";
import TacticsLesson from "./lessons/TacticsLesson";
import MatchLesson from "./lessons/MatchLesson";

/**
 * THE GAME, composed.
 *
 * Everything that makes the park PLAYABLE mounts here, inside the Canvas:
 * the walking kid, the rideable train, the gate greeter, the lessons, and
 * the cine override that lets the screenshot harness pose a camera without
 * fighting the player for it.
 */

const LESSONS: Record<LessonKind, React.ComponentType<{ active: boolean; onExit: () => void; onStars: (n: number) => void }>> = {
  pieces: PiecesLesson,
  tactics: TacticsLesson,
  match: MatchLesson,
};

/** ChessPaa waits by the gate train; he boards when you do. */
function GateGreeter() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.visible = director.mode === "explore" || director.mode === "cine";
    if (!g.visible) return;
    // he turns gently toward the child as they wander close
    const p = director.playerPos;
    const dx = p.x - 6.2, dz = p.z - 60;
    if (dx * dx + dz * dz < 500) {
      const want = Math.atan2(dx, dz);
      let d = want - g.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      g.rotation.y += d * 0.04;
    }
  });
  return (
    <group ref={ref} position={[6.2, terrainHeight(6.2, 60), 60]} rotation={[0, -2.05, 0]}>
      <ChessPaa mood="idle" lanternIntensity={3.2} />
    </group>
  );
}

/** The harness's posed camera. Real input cancels it (director.cancelCine). */
function CineCamera() {
  const { camera } = useThree();
  useFrame((_, dt) => {
    if (director.mode !== "cine" || !director.cine) return;
    const c = director.cine;
    const k = 1 - Math.exp(-dt * 10);
    camera.position.lerp(new THREE.Vector3(...c.position), k);
    camera.lookAt(new THREE.Vector3(...c.target));
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov += ((c.fov ?? 50) - cam.fov) * k;
    cam.updateProjectionMatrix();
  });
  return null;
}

export default function Game() {
  // re-render on director changes so lesson `active` props stay truthful
  useSyncExternalStore(
    useCallback((cb: () => void) => director.subscribe(cb), []),
    () => director.mode + ":" + (director.lesson ?? ""),
    () => "explore:"
  );
  const lessons = useMemo(() => Object.entries(LESSONS) as [LessonKind, (typeof LESSONS)[LessonKind]][], []);
  return (
    <group>
      <GateGreeter />
      <PlayerRig />
      <TrainRide />
      <CineCamera />
      {lessons.map(([kind, Lesson]) => (
        <Lesson
          key={kind}
          active={director.mode === "lesson" && director.lesson === kind}
          onExit={() => director.closeLesson()}
          onStars={(n) => grantStars(kind, n)}
        />
      ))}
    </group>
  );
}

export { STATIONS };
