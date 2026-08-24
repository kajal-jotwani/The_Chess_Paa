"use client";

import * as THREE from "three";
import { terrainHeight } from "../../world/terrain";
import type { LessonKind } from "../gameState";

/**
 * THE LESSON CONTRACT.
 *
 * A lesson is a scene-within-the-scene: it owns the camera while active, puts
 * a real Board3D on a table in the world, stands ChessPaa beside it, and
 * teaches. It must:
 *
 *   • drive the camera every frame while `active` (a soft push-in, board
 *     fully legible — the board camera never trades legibility for style)
 *   • call `onExit()` when the child leaves — NEVER trap them
 *   • call `onStars(1..3)` when the child completes it (repeat visits may
 *     re-earn; grantStars keeps the max)
 *   • speak through director.say(...) + speakAsChessPaa(...) so the words and
 *     the voice always agree
 */
export interface LessonProps {
  active: boolean;
  onExit: () => void;
  onStars: (n: number) => void;
}

export interface LessonAnchor {
  /** Board centre in world space. */
  board: THREE.Vector3;
  /** Yaw the board's "white side" faces (the child stands opposite). */
  facing: number;
}

/**
 * Where each lesson's table stands in the park.
 *
 * Placement rule, learned from a screenshot: the camera sits BEHIND the board
 * (opposite `facing`), so `facing` must point at open, pretty backdrop — never
 * into a structure. The tactics anchor originally sat inside the summit
 * station's scaffolding and the shot was all posts; both outdoor anchors were
 * pulled clear of their buildings' footprints.
 */
export const LESSON_ANCHORS: Record<LessonKind, LessonAnchor> = {
  pieces: {
    // Clear of the parade canopy (collider −46,−24 r8.5); backdrop = the parade.
    board: new THREE.Vector3(-38, terrainHeight(-38, -14) + 1.02, -14),
    facing: -2.47,
  },
  tactics: {
    // Clear of the summit station (collider 64,−74 r7.5); backdrop = the climb.
    board: new THREE.Vector3(52, terrainHeight(52, -64) + 1.02, -64),
    facing: 2.27,
  },
  match: {
    // Outside the Grand Match tent mouth; backdrop = the tent itself.
    board: new THREE.Vector3(0, terrainHeight(0, 9.6) + 1.02, 9.6),
    facing: Math.PI,
  },
};
