"use client";

import * as THREE from "three";
import { mergeGeometries } from "../../world/terrain";

/**
 * THE CHESS PIECES — turned on a lathe, in code.
 *
 * Real wooden chess pieces are TURNED: a profile revolved around an axis.
 * So that is exactly how we make them — a hand-authored profile per piece fed
 * to LatheGeometry — plus the small carved additions a lathe cannot make
 * (the knight's head, the bishop's mitre slit, the king's cross, the crowns).
 *
 * They are sized so a pawn is ~1 unit tall and a king ~1.75, which matches a
 * real set's proportions and keeps the board legible from the board camera.
 */

export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

/** Profiles are [radius, height] pairs walking UP from the base. */
const PROFILES: Record<PieceType, Array<[number, number]>> = {
  // Pawn — brave and small. Wide foot, soft collar, round head.
  p: [
    [0.00, 0.000], [0.300, 0.000], [0.305, 0.045], [0.275, 0.075],
    [0.215, 0.110], [0.190, 0.150], [0.200, 0.180], [0.165, 0.215],
    [0.110, 0.270], [0.098, 0.380], [0.120, 0.430], [0.175, 0.455],
    [0.140, 0.485], [0.175, 0.520], [0.190, 0.580], [0.165, 0.650],
    [0.105, 0.700], [0.000, 0.730],
  ],
  // Rook — straight as a hallway. Squat, solid, castellated on top.
  r: [
    [0.00, 0.000], [0.330, 0.000], [0.335, 0.050], [0.300, 0.085],
    [0.245, 0.125], [0.225, 0.175], [0.235, 0.205], [0.210, 0.250],
    [0.205, 0.640], [0.235, 0.680], [0.290, 0.720], [0.300, 0.800],
    [0.290, 0.880], [0.000, 0.880],
  ],
  // Knight — the base is turned; the head is carved on separately.
  n: [
    [0.00, 0.000], [0.320, 0.000], [0.325, 0.048], [0.292, 0.082],
    [0.235, 0.122], [0.212, 0.170], [0.222, 0.202], [0.196, 0.250],
    [0.180, 0.360], [0.190, 0.420], [0.150, 0.470], [0.000, 0.480],
  ],
  // Bishop — tall, slim, with the mitre and its slit.
  b: [
    [0.00, 0.000], [0.315, 0.000], [0.320, 0.048], [0.288, 0.082],
    [0.230, 0.124], [0.208, 0.174], [0.220, 0.206], [0.190, 0.255],
    [0.120, 0.420], [0.108, 0.560], [0.145, 0.605], [0.198, 0.640],
    [0.150, 0.678], [0.175, 0.715], [0.185, 0.800], [0.150, 0.900],
    [0.088, 0.975], [0.052, 1.030], [0.070, 1.062], [0.040, 1.098],
    [0.000, 1.120],
  ],
  // Queen — the mightiest march. Tall, elegant waist, coronet on top.
  q: [
    [0.00, 0.000], [0.355, 0.000], [0.360, 0.052], [0.325, 0.090],
    [0.262, 0.134], [0.238, 0.188], [0.250, 0.222], [0.215, 0.272],
    [0.135, 0.480], [0.118, 0.660], [0.158, 0.710], [0.215, 0.748],
    [0.168, 0.790], [0.196, 0.832], [0.228, 0.930], [0.246, 1.040],
    [0.232, 1.105], [0.000, 1.125],
  ],
  // King — the whole game rests upon him. Broadest, tallest, cross above.
  k: [
    [0.00, 0.000], [0.370, 0.000], [0.375, 0.055], [0.340, 0.095],
    [0.275, 0.142], [0.250, 0.198], [0.262, 0.234], [0.226, 0.288],
    [0.142, 0.510], [0.125, 0.720], [0.166, 0.772], [0.224, 0.812],
    [0.176, 0.856], [0.204, 0.900], [0.236, 1.010], [0.250, 1.120],
    [0.222, 1.185], [0.000, 1.205],
  ],
};

/** Overall scale so a pawn stands ~1.0 units tall on a 1-unit square. */
const PIECE_SCALE = 1.28;

function latheFrom(profile: Array<[number, number]>, segments = 24): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
  const g = new THREE.LatheGeometry(pts, segments);
  return g;
}

/** The rook's castellations — four notches cut from the top ring. */
function rookCrenels(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const g = new THREE.BoxGeometry(0.20, 0.13, 0.155);
    g.translate(Math.cos(a) * 0.225, 0.945, Math.sin(a) * 0.225);
    g.rotateY(-a);
    out.push(g);
  }
  return out;
}

/**
 * The knight's head — the one piece a lathe genuinely cannot make.
 * Built from a few blocky forms in the low-poly, cut-paper spirit: a muzzle,
 * a cheek, a cropped mane and two ears. It reads as a prancing horse in
 * silhouette, which is all the board camera ever needs.
 */
function knightHead(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];

  // neck rising and leaning forward
  const neck = new THREE.CylinderGeometry(0.165, 0.20, 0.42, 8);
  neck.rotateX(-0.24);
  neck.translate(0, 0.66, 0.045);
  out.push(neck);

  // skull
  const skull = new THREE.SphereGeometry(0.185, 10, 8);
  skull.scale(0.92, 0.86, 1.05);
  skull.translate(0, 0.885, 0.075);
  out.push(skull);

  // muzzle, angled down and forward
  const muzzle = new THREE.BoxGeometry(0.17, 0.155, 0.30);
  muzzle.rotateX(0.34);
  muzzle.translate(0, 0.845, 0.245);
  out.push(muzzle);

  // nose tip softening the box
  const nose = new THREE.SphereGeometry(0.088, 8, 6);
  nose.scale(1, 0.86, 1);
  nose.translate(0, 0.795, 0.375);
  out.push(nose);

  // cropped mane down the back of the neck
  for (let i = 0; i < 5; i++) {
    const m = new THREE.BoxGeometry(0.075, 0.10, 0.075);
    m.rotateX(-0.3);
    m.translate(0, 0.955 - i * 0.088, -0.10 - i * 0.028);
    out.push(m);
  }

  // ears
  for (const s of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.052, 0.135, 5);
    ear.translate(s * 0.082, 1.035, 0.03);
    out.push(ear);
  }
  return out;
}

/** The bishop's mitre slit — a thin wedge cut across the head. */
function bishopSlit(): THREE.BufferGeometry[] {
  const g = new THREE.BoxGeometry(0.035, 0.16, 0.20);
  g.rotateZ(0.5);
  g.translate(0.0, 1.015, 0.02);
  return [g];
}

/** The king's cross. */
function kingCross(): THREE.BufferGeometry[] {
  const v = new THREE.BoxGeometry(0.062, 0.245, 0.062);
  v.translate(0, 1.315, 0);
  const h = new THREE.BoxGeometry(0.175, 0.062, 0.062);
  h.translate(0, 1.352, 0);
  return [v, h];
}

/** The queen's coronet — points around the crown. */
function queenCoronet(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const p = new THREE.ConeGeometry(0.045, 0.115, 5);
    p.translate(Math.cos(a) * 0.185, 1.175, Math.sin(a) * 0.185);
    out.push(p);
  }
  const ball = new THREE.SphereGeometry(0.062, 8, 6);
  ball.translate(0, 1.20, 0);
  out.push(ball);
  return out;
}

const cache = new Map<PieceType, THREE.BufferGeometry>();

/**
 * Build (and cache) one piece's geometry, already scaled and sitting with its
 * base at y=0 so it can be dropped straight onto a square.
 */
export function pieceGeometry(type: PieceType, quality: "high" | "low" = "high"): THREE.BufferGeometry {
  const key = (quality === "low" ? "L" : "") + type as PieceType;
  const hit = cache.get(key);
  if (hit) return hit;

  const segs = quality === "high" ? 24 : 10;
  const parts: THREE.BufferGeometry[] = [latheFrom(PROFILES[type], segs)];

  if (quality === "high") {
    if (type === "r") parts.push(...rookCrenels());
    if (type === "n") parts.push(...knightHead());
    if (type === "b") parts.push(...bishopSlit());
    if (type === "k") parts.push(...kingCross());
    if (type === "q") parts.push(...queenCoronet());
  } else {
    // Low LOD keeps the SILHOUETTE cue only — a knight still reads as a horse.
    if (type === "n") {
      const head = new THREE.BoxGeometry(0.2, 0.26, 0.34);
      head.rotateX(0.2); head.translate(0, 0.63, 0.11);
      parts.push(head);
    }
    if (type === "k") { const c = new THREE.BoxGeometry(0.16, 0.2, 0.06); c.translate(0, 1.3, 0); parts.push(c); }
    if (type === "q") { const b = new THREE.SphereGeometry(0.09, 6, 5); b.translate(0, 1.19, 0); parts.push(b); }
    if (type === "r") parts.push(...rookCrenels());
  }

  const geo = mergeGeometries(parts);
  geo.scale(PIECE_SCALE, PIECE_SCALE, PIECE_SCALE);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  cache.set(key, geo);
  return geo;
}

/** Height of a piece, for placing labels, glows and speech bubbles. */
export function pieceHeight(type: PieceType): number {
  const prof = PROFILES[type];
  const top = prof[prof.length - 1][1];
  const extra = type === "k" ? 0.19 : type === "q" ? 0.09 : type === "n" ? 0.24 : type === "r" ? 0.05 : 0;
  return (top + extra) * PIECE_SCALE;
}

export const ALL_PIECES: PieceType[] = ["p", "n", "b", "r", "q", "k"];
