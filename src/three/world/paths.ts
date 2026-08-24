"use client";

import * as THREE from "three";
import { terrainHeight, mergeGeometries } from "./terrain";
import { ATTRACTIONS } from "./coasterSpine";

/**
 * THE WALKWAYS.
 *
 * Swept, trodden paths connecting the plaza to every attraction. They matter
 * more than they look: a child should always be able to SEE where the next
 * thing is, and a trodden path pointing at a ride is the oldest, warmest
 * wayfinding there is. No child is ever lost in this park.
 *
 * Built as ribbons laid just above the terrain, so they take the snow ramp
 * but read a touch warmer and more compacted than fresh drift.
 */

interface PathSpec {
  points: THREE.Vector3[];
  width: number;
}

const P = (x: number, z: number) => new THREE.Vector3(x, 0, z);

/** Each route is authored, not generated — composition beats convenience. */
const ROUTES: PathSpec[] = [
  // gate → plaza (the first walk a child ever takes here)
  { points: [P(4, 62), P(2, 50), P(1, 34), P(0, 20)], width: 4.2 },
  // plaza → piece parade
  { points: [P(-8, -4), P(-20, -10), P(-33, -17), P(-44, -22)], width: 3.4 },
  // plaza → puzzle train
  { points: [P(9, 6), P(20, 15), P(30, 24), P(36, 29)], width: 3.4 },
  // parade → ferris wheel
  { points: [P(-48, -26), P(-58, -36), P(-66, -48), P(-70, -58)], width: 3.0 },
  // plaza → coaster hill (the long climb on foot)
  { points: [P(10, -6), P(26, -20), P(42, -40), P(56, -60), P(62, -71)], width: 3.0 },
];

/**
 * Sweep a ribbon along a route, hugging the terrain.
 * Sampled densely so the path never floats over a dip or sinks into a rise.
 */
function ribbon(spec: PathSpec): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(spec.points, false, "catmullrom", 0.5);
  const STEPS = 60;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const p = curve.getPoint(t);
    const tan = curve.getTangent(t).normalize();
    const nrm = new THREE.Vector3(-tan.z, 0, tan.x);
    // paths narrow slightly at their ends so they blend into the snow
    const taper = Math.min(1, Math.sin(t * Math.PI) * 1.8 + 0.35);
    const w = (spec.width * taper) / 2;

    for (let j = 0; j <= 2; j++) {
      const s = j - 1; // -1, 0, 1
      const x = p.x + nrm.x * w * s;
      const z = p.z + nrm.z * w * s;
      // +0.06 keeps it clear of z-fighting with the ground
      positions.push(x, terrainHeight(x, z) + 0.06, z);
      uvs.push(t * 9, (s + 1) / 2);
    }
  }
  for (let i = 0; i < STEPS; i++) {
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j, b = a + 1, c = a + 3, d = c + 1;
      // Same winding trap as the ice ribbon — wind so faces point UP.
      indices.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export function buildPathGeometry(): THREE.BufferGeometry {
  return mergeGeometries(ROUTES.map(ribbon));
}

/**
 * CARVED WOODEN SIGNPOSTS — diegetic wayfinding with a painted icon per ride.
 * Positions face the route they point along.
 */
export interface Signpost { pos: [number, number, number]; facing: number; to: keyof typeof ATTRACTIONS }

export function signposts(): Signpost[] {
  const mk = (x: number, z: number, facing: number, to: keyof typeof ATTRACTIONS): Signpost => ({
    pos: [x, terrainHeight(x, z), z], facing, to,
  });
  return [
    mk(6.5, 26, -0.15, "plaza"),
    mk(-11, -6, 2.5, "parade"),
    mk(12, 8, 0.8, "train"),
    mk(-50, -28, 2.2, "ferris"),
    mk(14, -9, -0.7, "coaster"),
  ];
}

/** A signpost: post, arrow board, and a little snow cap. */
export function buildSignpostGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const post = new THREE.CylinderGeometry(0.09, 0.12, 2.3, 7);
  post.translate(0, 1.15, 0);
  parts.push(post);

  // arrow board — a plank with a pointed end
  const board = new THREE.BoxGeometry(1.5, 0.36, 0.08);
  board.translate(0.62, 1.86, 0);
  parts.push(board);
  const tip = new THREE.ConeGeometry(0.26, 0.34, 3);
  tip.rotateZ(-Math.PI / 2);
  tip.rotateY(Math.PI / 2);
  tip.translate(1.48, 1.86, 0);
  parts.push(tip);

  // a second, smaller board below
  const board2 = new THREE.BoxGeometry(1.1, 0.28, 0.07);
  board2.translate(-0.42, 1.42, 0);
  parts.push(board2);

  // snow cap on the post
  const cap = new THREE.SphereGeometry(0.14, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
  cap.scale(1, 0.6, 1);
  cap.translate(0, 2.3, 0);
  parts.push(cap);

  return mergeGeometries(parts);
}
