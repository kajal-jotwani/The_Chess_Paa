"use client";

import { useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import Board3D from "../../board/Board3D";
import ChessPaa from "../../characters/ChessPaa";
import { director } from "../gameState";
import { LESSON_ANCHORS, type LessonProps } from "./lessonContract";

/**
 * Match lesson — PLACEHOLDER SHELL.
 * A craft owner replaces this file wholesale; the contract in
 * lessonContract.ts is the only thing the rest of the game relies on.
 */
export default function MatchLesson({ active, onExit }: LessonProps) {
  const { camera } = useThree();
  const a = LESSON_ANCHORS.match;

  useEffect(() => {
    if (active) {
      director.say("Sit close, little one — this lesson is being carved as we speak. Try the train meanwhile!", "warm");
    }
  }, [active]);

  useFrame((_, dt) => {
    if (!active) return;
    const behind = new THREE.Vector3(
      a.board.x - Math.sin(a.facing) * 4.6,
      a.board.y + 3.1,
      a.board.z - Math.cos(a.facing) * 4.6
    );
    camera.position.lerp(behind, 1 - Math.exp(-dt * 4));
    camera.lookAt(a.board.x, a.board.y + 0.2, a.board.z);
  });

  if (!active) return null;
  return (
    <group>
      <group position={[a.board.x, a.board.y, a.board.z]} rotation={[0, a.facing, 0]}>
        <Board3D fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" interactive={false} legalFor={null} scale={0.42} />
      </group>
      <group
        position={[a.board.x + Math.cos(a.facing) * 1.9, a.board.y - 1.02, a.board.z - Math.sin(a.facing) * 1.9]}
        rotation={[0, a.facing + Math.PI / 2, 0]}
      >
        <ChessPaa mood="talking" lantern lanternIntensity={2.4} />
      </group>
    </group>
  );
}
