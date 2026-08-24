"use client";

import * as THREE from "three";
import { PALETTE, css, mix } from "../core/palette";
import { rng } from "../core/textures/procedural";
import { mergeGeometries, terrainHeight, RIVER_POINTS } from "./terrain";
import { ATTRACTIONS, SPINE_CURVE, STOP_T } from "./coasterSpine";
import { pieceGeometry, pieceHeight } from "../core/geometry/pieces";

/**
 * THE PAINTED GATES OF CHESSPAA'S WONDERLAND — geometry, lettering, timeline.
 *
 * This is the FIRST THING A CHILD EVER SEES, so it gets the most craft in the
 * park: a carved wooden arch with a scalloped signboard, hand-lettered; two
 * lantern posts with bunting sagging between them; a turnstile that suggests
 * a ticket gate without ever being a barrier; a carved map board painted with
 * the whole valley; snow piled plush on every ledge; balloons tugging; and a
 * warm pool of light on the snow that pulls the eye THROUGH the opening.
 *
 * WHY THE ARCH IS NOT EXACTLY ON THE ANCHOR: `ATTRACTIONS.gate` is where the
 * coaster spine hairpins — the track sweeps in from the east, turns at (4,64)
 * and runs back south. Standing posts on that apex would put 60cm of timber
 * inside the running line. So the anchor stays where the shared API says it
 * is (it is the CAR's mark, and ChessPaa's), and the arch stands `ARCH_Z`
 * metres OUTSIDE it. A child walks under the gates and the little wooden car
 * is already there, waiting, framed by the opening. That is the shot.
 *
 * Nothing here touches React. `Gate.tsx` turns these bags into meshes.
 */

const TAU = Math.PI * 2;

/* ================================================================== */
/* THE GATE'S FRAME IN THE WORLD                                       */
/* ================================================================== */

/** The gate group's origin: the shared attraction anchor. */
export const GATE_ANCHOR: THREE.Vector3 = ATTRACTIONS.gate.clone();

/**
 * A hair off axis. A gate squared to the world grid reads as CG; three
 * degrees of turn reads as something a person put up on a slope.
 */
export const GATE_YAW = 0.12;

/** Ground level at the anchor — the group's Y. Everything else is relative. */
export const GATE_BASE_Y: number = terrainHeight(GATE_ANCHOR.x, GATE_ANCHOR.z);

/** How far OUTSIDE the anchor the arch stands (see the note above). */
export const ARCH_Z = 3.4;

const YC = Math.cos(GATE_YAW);
const YS = Math.sin(GATE_YAW);

/** Gate-local XZ → world XZ. */
export function gateLocalToWorld(lx: number, lz: number): [number, number] {
  return [GATE_ANCHOR.x + lx * YC + lz * YS, GATE_ANCHOR.z - lx * YS + lz * YC];
}

/**
 * Local Y of the real ground under a local XZ.
 *
 * The valley rolls even here, and a post that floats four centimetres above
 * the snow kills the whole illusion. Every foot, leg and plinth in this file
 * is sunk with this.
 */
export function gateGroundY(lx: number, lz: number): number {
  const [wx, wz] = gateLocalToWorld(lx, lz);
  return terrainHeight(wx, wz) - GATE_BASE_Y;
}

/* ================================================================== */
/* MATERIAL KEYS                                                       */
/* ================================================================== */

/**
 * One draw call each (two where an ink hull is wanted). Keep the list short:
 * the whole gate is meant to cost about as much as one small landmark.
 */
export type GateMat =
  /** Structural toy-wood: posts, chords, legs, rails. */
  | "timber"
  /** Pale planed wood: signboard body, map frame, kiosk cladding, planks. */
  | "timberPale"
  /** Dark ironwork: brackets, turnstile arms, hinges, hoops. */
  | "iron"
  /** Warm painted honey: trim, finial collars, lantern housings. */
  | "honey"
  /** The two carved chess-piece finials, painted cream. */
  | "cream"
  /** Snow lying plush on every ledge. */
  | "snow"
  /** The big hand-lettered sign face. */
  | "signFace"
  /** The painted valley map. */
  | "mapFace"
  /** The kiosk's striped canvas valance. */
  | "awning"
  /** The kiosk's little painted TICKETS board. */
  | "ticketFace"
  /** Balloons and bunting — one texture of painted colour chips. */
  | "chip"
  /** Balloon strings and bunting cord. */
  | "cord"
  /** Emissive lantern panes. */
  | "glass";

type Bag = Map<GateMat, THREE.BufferGeometry[]>;
export type GateParts = Partial<Record<GateMat, THREE.BufferGeometry>>;

function put(bag: Bag, key: GateMat, ...geos: THREE.BufferGeometry[]): void {
  const list = bag.get(key);
  if (list) list.push(...geos);
  else bag.set(key, [...geos]);
}

function bake(bag: Bag): GateParts {
  const out: GateParts = {};
  for (const [k, list] of bag) {
    if (!list.length) continue;
    out[k] = list.length === 1 ? list[0] : mergeGeometries(list);
  }
  return out;
}

/* ================================================================== */
/* SMALL GEOMETRY TOOLS                                                */
/* ================================================================== */

/**
 * Swap u and v.
 *
 * `LatheGeometry` runs u AROUND the turning and v UP it, while `woodTexture`
 * paints its grain along u — so a post straight off the lathe wears its grain
 * as barrel hoops, which is what turned the first gate posts into a diamond
 * weave. Swapping puts the grain back where a carpenter would have it.
 */
function swapUV(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const uv = g.getAttribute("uv");
  if (!uv) return g;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
  uv.needsUpdate = true;
  return g;
}

/** Rescale a geometry's UVs so a tiled wood/snow map lands at a sane size. */
function scaleUV(g: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = g.getAttribute("uv");
  if (!uv) return g;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return g;
}

/**
 * Slam every UV into one horizontal band of the painted colour-chip texture.
 *
 * WHY: balloons and bunting want six different colours in ONE draw call. The
 * shared `mergeGeometries` copies position/normal/uv and nothing else, so a
 * vertex-colour attribute would be silently dropped on merge. Painting the
 * colours into a chip strip and addressing them by UV survives the merge AND
 * lets each chip carry a painted sheen the flat colour never could.
 */
function uvBand(g: THREE.BufferGeometry, band: number, bands: number, wrapV = true): THREE.BufferGeometry {
  const uv = g.getAttribute("uv");
  if (!uv) return g;
  const h = 1 / bands;
  const y0 = band * h;
  for (let i = 0; i < uv.count; i++) {
    // v runs across the chip (so a sphere's pole-to-pole v samples the sheen),
    // u runs along it; inset a touch so bilinear filtering never bleeds.
    const v = wrapV ? uv.getY(i) : 0.5;
    uv.setXY(i, 0.08 + uv.getX(i) * 0.84, y0 + h * (0.08 + v * 0.84));
  }
  uv.needsUpdate = true;
  return g;
}

/** A rectangular cross-section, counter-clockwise in the (right, up) plane. */
function RECT(w: number, h: number): Array<[number, number]> {
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
}

/**
 * Sweep a closed 2-D profile along a path of world points.
 *
 * The frame is built from world-up rather than Frenet frames, which flip at
 * inflection points — the same trap `coasterSpine.frameAt` avoids. Every path
 * in this file is broadly horizontal, so world-up is stable and free.
 */
function sweepProfile(
  path: THREE.Vector3[],
  profile: Array<[number, number]>,
  opts: { caps?: boolean; uScale?: number } = {}
): THREE.BufferGeometry {
  const { caps = true, uScale = 1 } = opts;
  const n = path.length, m = profile.length;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const t = new THREE.Vector3(), r = new THREE.Vector3(), u = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    const p = path[i];
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
    t.subVectors(b, a).normalize();
    r.crossVectors(t, up).normalize();
    if (!isFinite(r.x) || r.lengthSq() < 1e-6) r.set(1, 0, 0);
    u.crossVectors(r, t).normalize();
    for (let k = 0; k < m; k++) {
      const [pr, pu] = profile[k];
      pos.push(p.x + r.x * pr + u.x * pu, p.y + r.y * pr + u.y * pu, p.z + r.z * pr + u.z * pu);
      uv.push((i / (n - 1)) * uScale, k / m);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < m; k++) {
      const a = i * m + k, b = i * m + ((k + 1) % m);
      const a2 = (i + 1) * m + k, b2 = (i + 1) * m + ((k + 1) % m);
      idx.push(a, a2, b, b, a2, b2);
    }
  }
  if (caps) {
    const last = (n - 1) * m;
    for (let k = 1; k < m - 1; k++) {
      idx.push(0, k, k + 1);                              // start cap faces -t
      idx.push(last, last + k + 1, last + k);             // end cap faces +t
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A flat carved PLATE from a closed polygon in XY, extruded along Z.
 *
 * Fans from the polygon's centroid, so the outline may be as scalloped as a
 * signwriter likes as long as it stays star-shaped about its middle. Front,
 * back and rim get their own vertices so the edges stay crisp under
 * `computeVertexNormals`.
 */
function plateXY(poly: Array<[number, number]>, z: number, t: number): THREE.BufferGeometry {
  const n = poly.length;
  let cx = 0, cy = 0, area = 0;
  for (let i = 0; i < n; i++) {
    cx += poly[i][0]; cy += poly[i][1];
    const j = (i + 1) % n;
    area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  cx /= n; cy /= n;
  // A clockwise outline would face the fan the wrong way, so normalise it.
  const ring = area >= 0 ? poly : [...poly].reverse();

  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const [px, py] of ring) {
    bx0 = Math.min(bx0, px); bx1 = Math.max(bx1, px);
    by0 = Math.min(by0, py); by1 = Math.max(by1, py);
  }
  const U = (px: number) => (px - bx0) / Math.max(1e-6, bx1 - bx0);
  const V = (py: number) => (py - by0) / Math.max(1e-6, by1 - by0);

  for (const face of [0, 1]) {
    const fz = face === 0 ? z + t / 2 : z - t / 2;
    const base = pos.length / 3;
    pos.push(cx, cy, fz); uv.push(U(cx), V(cy));
    for (const [px, py] of ring) { pos.push(px, py, fz); uv.push(U(px), V(py)); }
    for (let i = 0; i < n; i++) {
      const a = base + 1 + i, b = base + 1 + ((i + 1) % n);
      if (face === 0) idx.push(base, a, b); else idx.push(base, b, a);
    }
  }
  const rim = pos.length / 3;
  for (const [px, py] of ring) {
    pos.push(px, py, z + t / 2); uv.push(U(px) * 3, 0);
    pos.push(px, py, z - t / 2); uv.push(U(px) * 3, 1);
  }
  for (let i = 0; i < n; i++) {
    const a = rim + i * 2, b = a + 1;
    const c = rim + ((i + 1) % n) * 2, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Sample a parabolic arch: u in -1..1, peaks at u = 0. */
function archY(u: number, spring: number, rise: number): number {
  return spring + rise * (1 - u * u);
}

/** The arch path, as world-space points in gate-local coordinates. */
function archPath(halfSpan: number, spring: number, rise: number, z: number, steps = 40): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * 2 - 1;
    pts.push(new THREE.Vector3(u * halfSpan, archY(u, spring, rise), z));
  }
  return pts;
}

/**
 * PLUSH SNOW ON A LEDGE.
 *
 * Built from a sphere cap so winding, normals and UVs are correct for free,
 * then bullied into a rounded-rectangular pillow: a flat-ish plateau, softly
 * rounded corners, and a LIP that bulges out over the front edge and droops.
 * That droop is the whole trick — snow that stops flush at an edge reads as
 * paint, snow that hangs over it reads as weight.
 */
function snowPillow(
  w: number, d: number, h: number, seed: number,
  opts: { lip?: number; droop?: number; lobes?: number; square?: number; seg?: number } = {}
): THREE.BufferGeometry {
  const { lip = 0.16, droop = 0.10, lobes = 5, square = 0.78, seg = 16 } = opts;
  const g = new THREE.SphereGeometry(1, seg, 8, 0, TAU, 0, Math.PI * 0.60);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const rnd = rng(seed);
  // a small ring of noise so no two pillows in the park are the same drift
  const wob: number[] = [];
  for (let i = 0; i < 12; i++) wob.push(0.86 + rnd() * 0.28);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const hr = Math.hypot(x, z);
    const dx = hr > 1e-6 ? x / hr : 1, dz = hr > 1e-6 ? z / hr : 0;
    const az = Math.atan2(dz, dx);

    // circle → rounded rectangle, so the pillow fills its ledge
    const rect = 1 / Math.max(Math.abs(dx) / (w * 0.5), Math.abs(dz) / (d * 0.5), 1e-6);
    const circ = Math.min(w, d) * 0.5;
    const R = circ + (rect - circ) * square;

    const wi = ((Math.floor(((az + Math.PI) / TAU) * 12) % 12) + 12) % 12;
    let rr = hr * R * wob[wi];

    // Plateau on top; below the equator the drift tucks DOWN and grips the
    // ledge. A shallow skirt reads as a saucer balanced on the woodwork —
    // snow has weight, and weight means it hangs on.
    let ny = y >= 0 ? h * Math.pow(y, 0.55) : y * h * 3.2;

    // the overhanging front lip, scalloped so the edge is never a clean arc
    const front = Math.max(0, dz);
    const lobe = 0.55 + 0.45 * Math.sin(az * lobes + seed * 0.7);
    const lipT = front * (1 - Math.max(0, y)) * lobe;
    rr *= 1 + lip * lipT;
    ny -= droop * lipT;

    pos.setXYZ(i, dx * rr, ny, dz * rr);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A plush snow RIDGE swept along a path — for the arch chord, the sign's top
 * edge, and every long ledge a pillow would look silly on.
 */
function snowRidge(path: THREE.Vector3[], w: number, h: number, lean = 0.24): THREE.BufferGeometry {
  // an open-bottomed lens, leaning forward so it overhangs the front face
  const prof: Array<[number, number]> = [];
  const N = 9;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI;
    prof.push([Math.cos(a) * (w / 2) + lean * w * 0.5, Math.sin(a) * h]);
  }
  // Counter-clockwise in (right, up): the arc already runs +r → over the top
  // → −r, so closing along the bottom left-to-right completes the loop.
  prof.push([-w / 2 + lean * w * 0.5, -h * 0.28]);
  prof.push([w / 2 + lean * w * 0.5, -h * 0.28]);
  return sweepProfile(path, prof, { caps: true, uScale: path.length * 0.25 });
}

/* ================================================================== */
/* 1 · THE HAND-LETTERED ALPHABET                                      */
/* ================================================================== */

/**
 * NO FONT FILES, AND NO SYSTEM FONTS EITHER.
 *
 * A canvas `fillText` in Georgia is at the mercy of whatever the machine has
 * installed, and it always reads TYPESET. So the park's signwriting is a
 * stroke alphabet authored here: each glyph is a handful of pen strokes in a
 * unit box, drawn with a round brush at variable weight, every sampled point
 * nudged by a deterministic wobble. Shadow pass, face pass, highlight pass —
 * the same three passes a fairground signwriter lays down.
 *
 * Coordinates: x runs 0 → `adv`, y runs 0 (baseline) → 1 (cap height).
 * Lowercase sits on an x-height of 0.66 with ascenders at 1.02.
 */
interface Stroke {
  /** Flat [x0,y0,x1,y1,…] control points. */
  p: number[];
  /** Weight multiplier — down-strokes heavy, cross-strokes light. */
  w: number;
  /** Smooth through the points (default: yes for 3+ points). */
  k: boolean;
  /** Closed loop (bowls of o, O, a). */
  c: boolean;
}
interface Glyph { adv: number; s: Stroke[] }

const st = (p: number[], w = 1, k?: boolean, c?: boolean): Stroke => ({
  p, w, k: k ?? p.length > 4, c: c ?? false,
});
const gl = (adv: number, ...s: Stroke[]): Glyph => ({ adv, s });

const ALPHABET: Record<string, Glyph> = {
  " ": gl(0.38),
  A: gl(0.80, st([.03, 0, .40, 1]), st([.77, 0, .40, 1]), st([.16, .34, .64, .34], .72)),
  B: gl(0.74, st([.10, 0, .10, 1]), st([.10, 1, .46, 1, .66, .86, .50, .55, .10, .53]),
    st([.10, .53, .52, .52, .72, .30, .52, .02, .10, 0])),
  C: gl(0.76, st([.71, .79, .55, .98, .26, .97, .08, .68, .08, .34, .26, .03, .55, .02, .72, .20])),
  D: gl(0.78, st([.10, 0, .10, 1]), st([.10, 1, .46, .99, .74, .72, .74, .30, .46, .01, .10, 0])),
  E: gl(0.68, st([.11, 0, .11, 1]), st([.11, 1, .64, 1], .92), st([.11, .53, .52, .53], .70),
    st([.11, 0, .66, 0], .92)),
  F: gl(0.64, st([.11, 0, .11, 1]), st([.11, 1, .62, 1], .92), st([.11, .55, .50, .55], .70)),
  G: gl(0.82, st([.71, .80, .54, .98, .25, .97, .07, .68, .07, .32, .27, .02, .58, .05, .74, .28]),
    st([.74, .28, .74, .47], .9), st([.52, .47, .78, .47], .72)),
  H: gl(0.80, st([.10, 0, .10, 1]), st([.71, 0, .71, 1]), st([.10, .52, .71, .52], .70)),
  I: gl(0.38, st([.19, 0, .19, 1]), st([.04, 1, .34, 1], .62), st([.04, 0, .34, 0], .62)),
  J: gl(0.58, st([.44, 1, .44, .26, .32, .03, .14, .04, .06, .20]), st([.26, 1, .56, 1], .62)),
  K: gl(0.78, st([.10, 0, .10, 1]), st([.72, 1, .12, .45]), st([.31, .62, .76, 0])),
  L: gl(0.64, st([.11, 1, .11, 0]), st([.11, 0, .62, 0], .92)),
  M: gl(0.98, st([.07, 0, .07, 1]), st([.07, 1, .49, .28]), st([.49, .28, .91, 1]), st([.91, 1, .91, 0])),
  N: gl(0.82, st([.10, 0, .10, 1]), st([.10, 1, .73, 0]), st([.73, 0, .73, 1])),
  O: gl(0.84, st([.42, 1, .76, .76, .76, .24, .42, 0, .08, .24, .08, .76], 1, true, true)),
  P: gl(0.72, st([.10, 0, .10, 1]), st([.10, 1, .48, 1, .68, .84, .50, .56, .10, .55])),
  Q: gl(0.86, st([.42, 1, .76, .76, .76, .24, .42, 0, .08, .24, .08, .76], 1, true, true),
    st([.50, .26, .82, -.08], .85)),
  R: gl(0.78, st([.10, 0, .10, 1]), st([.10, 1, .48, 1, .67, .85, .50, .58, .10, .57]),
    st([.36, .58, .76, 0])),
  S: gl(0.72, st([.66, .84, .48, .99, .17, .92, .19, .68, .50, .53, .68, .36, .58, .05, .25, .01, .07, .15])),
  T: gl(0.72, st([.04, 1, .68, 1], .92), st([.36, 1, .36, 0])),
  U: gl(0.80, st([.09, 1, .09, .28, .29, .02, .55, .02, .73, .28, .73, 1])),
  V: gl(0.78, st([.04, 1, .39, 0]), st([.39, 0, .74, 1])),
  W: gl(1.10, st([.04, 1, .27, 0]), st([.27, 0, .55, .72]), st([.55, .72, .83, 0]), st([.83, 0, 1.06, 1])),
  X: gl(0.76, st([.06, 1, .70, 0]), st([.70, 1, .06, 0])),
  Y: gl(0.76, st([.05, 1, .38, .50]), st([.71, 1, .38, .50]), st([.38, .50, .38, 0])),
  Z: gl(0.72, st([.07, 1, .65, 1], .92), st([.65, 1, .07, 0]), st([.07, 0, .67, 0], .92)),

  a: gl(0.68, st([.36, .66, .60, .50, .60, .16, .36, 0, .12, .16, .12, .50], 1, true, true),
    st([.60, .66, .60, 0])),
  b: gl(0.68, st([.12, 1.02, .12, 0]), st([.12, .52, .34, .66, .60, .50, .60, .16, .34, 0, .12, .13])),
  c: gl(0.60, st([.54, .54, .36, .67, .14, .55, .10, .34, .16, .09, .38, -.01, .55, .10])),
  d: gl(0.68, st([.56, 1.02, .56, 0]), st([.56, .52, .34, .66, .08, .50, .08, .16, .34, 0, .56, .13])),
  e: gl(0.64, st([.09, .34, .56, .34, .56, .55, .34, .68, .11, .50, .10, .18, .31, -.01, .54, .09])),
  f: gl(0.44, st([.42, .92, .32, 1.02, .18, .94, .18, 0]), st([.02, .62, .42, .62], .70)),
  g: gl(0.68, st([.36, .66, .60, .50, .60, .16, .36, 0, .12, .16, .12, .50], 1, true, true),
    st([.60, .66, .60, -.10, .42, -.24, .20, -.20])),
  h: gl(0.68, st([.11, 1.02, .11, 0]), st([.11, .44, .30, .66, .52, .60, .57, .38, .57, 0])),
  i: gl(0.32, st([.15, .66, .15, 0]), st([.15, .86, .15, .93], 1.15)),
  j: gl(0.34, st([.18, .66, .18, -.08, .04, -.22]), st([.18, .86, .18, .93], 1.15)),
  k: gl(0.64, st([.11, 1.02, .11, 0]), st([.60, .66, .14, .28]), st([.30, .40, .62, 0])),
  l: gl(0.34, st([.15, 1.02, .15, .12, .28, .02])),
  m: gl(1.02, st([.10, .66, .10, 0]), st([.10, .46, .28, .66, .48, .58, .51, .38, .51, 0]),
    st([.51, .46, .69, .66, .89, .58, .92, .38, .92, 0])),
  n: gl(0.68, st([.11, .66, .11, 0]), st([.11, .44, .30, .66, .52, .60, .57, .38, .57, 0])),
  o: gl(0.70, st([.35, .66, .61, .50, .61, .16, .35, 0, .09, .16, .09, .50], 1, true, true)),
  p: gl(0.68, st([.12, .66, .12, -.24]), st([.12, .52, .34, .66, .60, .50, .60, .16, .34, 0, .12, .13])),
  q: gl(0.68, st([.58, .66, .58, -.24]), st([.58, .52, .36, .66, .10, .50, .10, .16, .36, 0, .58, .13])),
  r: gl(0.50, st([.12, .66, .12, 0]), st([.12, .44, .30, .66, .48, .60])),
  s: gl(0.56, st([.50, .55, .32, .68, .12, .58, .22, .41, .40, .31, .47, .14, .29, -.01, .07, .09])),
  t: gl(0.48, st([.22, .94, .22, .14, .38, .02]), st([.03, .66, .44, .66], .70)),
  u: gl(0.68, st([.11, .66, .11, .20, .30, .01, .50, .06, .57, .24]), st([.57, .66, .57, 0])),
  v: gl(0.62, st([.05, .66, .31, 0]), st([.31, 0, .57, .66])),
  w: gl(0.92, st([.04, .66, .23, 0]), st([.23, 0, .46, .48]), st([.46, .48, .69, 0]), st([.69, 0, .88, .66])),
  x: gl(0.60, st([.06, .66, .54, 0]), st([.54, .66, .06, 0])),
  y: gl(0.62, st([.05, .66, .32, .02]), st([.58, .66, .26, -.24])),
  z: gl(0.58, st([.07, .66, .52, .66], .82), st([.52, .66, .07, 0]), st([.07, 0, .54, 0], .82)),

  /**
   * DIGITS. Tabular on purpose — every numeral carries the same 0.68 advance
   * (bar the 1) so a price, a time or a queue count never shimmies when it
   * changes. Without these a sign asking for a number paints a silent GAP:
   * `glyphOf` finds nothing, falls through to the uppercase form, finds
   * nothing again, and `letteringWidth` still advances. Nobody sees an error;
   * they just see "OPEN  :  ".
   */
  0: gl(0.68, st([.34, 1, .62, .76, .62, .24, .34, 0, .06, .24, .06, .76], 1, true, true)),
  1: gl(0.56, st([.10, .78, .32, 1.0, .32, 0]), st([.06, 0, .54, 0], .84)),
  2: gl(0.68, st([.08, .82, .22, .99, .48, .99, .60, .78, .44, .48, .08, .04]),
    st([.07, .02, .63, .02], .86)),
  3: gl(0.68, st([.09, .86, .27, 1.0, .55, .93, .52, .69, .30, .57]),
    st([.30, .57, .58, .50, .62, .21, .34, -.01, .08, .11])),
  4: gl(0.70, st([.48, 1, .05, .29], .92), st([.05, .29, .66, .29], .80), st([.48, 1, .48, 0])),
  5: gl(0.68, st([.60, .98, .18, .98], .86), st([.18, .98, .14, .60]),
    st([.14, .60, .38, .66, .62, .49, .60, .20, .34, -.01, .08, .11])),
  6: gl(0.68, st([.58, .87, .41, 1.0, .17, .85, .09, .45, .12, .16, .36, -.01, .59, .15, .56, .39, .33, .51, .11, .43])),
  7: gl(0.66, st([.05, 1, .62, 1], .86), st([.62, 1, .26, 0])),
  8: gl(0.68, st([.34, 1.0, .57, .87, .55, .67, .34, .57, .13, .67, .11, .87], 1, true, true),
    st([.34, .57, .62, .43, .62, .14, .34, 0, .06, .14, .06, .43], 1, true, true)),
  9: gl(0.68, st([.10, .13, .27, 0, .51, .15, .59, .55, .56, .84, .32, 1.01, .09, .85, .12, .61, .35, .49, .57, .57])),

  "?": gl(0.62, st([.08, .80, .20, .99, .44, .99, .56, .78, .40, .56, .32, .46, .32, .28]),
    st([.32, .04, .32, .06], 1.25)),
  ":": gl(0.30, st([.15, .52, .15, .54], 1.2), st([.15, .05, .15, .07], 1.2)),
  "&": gl(0.86, st([.80, 0, .30, .92, .50, 1.0, .58, .84, .16, .46, .08, .22, .28, .0, .52, .14, .76, .42])),

  "'": gl(0.26, st([.13, 1.02, .09, .76], .95)),
  "·": gl(0.34, st([.17, .40, .17, .42], 1.2)),
  ".": gl(0.30, st([.15, .03, .15, .05], 1.25)),
  ",": gl(0.30, st([.16, .06, .10, -.14], .9)),
  "-": gl(0.48, st([.06, .46, .42, .46], .78)),
  "!": gl(0.32, st([.16, 1, .16, .22]), st([.16, .05, .16, .07], 1.25)),
};

/** Catmull-Rom through a flat point list, so a five-point bowl reads round. */
function sampleStroke(p: number[], closed: boolean, smooth: boolean, per = 7): Array<[number, number]> {
  const n = p.length / 2;
  const pt = (i: number): [number, number] => {
    const j = closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
    return [p[j * 2], p[j * 2 + 1]];
  };
  if (!smooth || n < 3) {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) out.push(pt(i));
    if (closed) out.push(pt(0));
    return out;
  }
  const out: Array<[number, number]> = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = pt(i - 1), p1 = pt(i), p2 = pt(i + 1), p3 = pt(i + 2);
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(closed ? out[0] : pt(n - 1));
  return out;
}

export interface LetterOpts {
  /** Cap height in pixels. */
  size: number;
  face: number;
  ink: number;
  /** The signwriter's highlight along the top-left of each stroke. */
  highlight?: number;
  /** Brush width as a fraction of cap height. 0.13 is a light hand, 0.20 fat. */
  weight?: number;
  /** Extra advance between glyphs, as a fraction of cap height. */
  tracking?: number;
  /** 0 = machine-set, 1 = a very unsteady hand. 0.5 is right for a fairground. */
  wobble?: number;
  seed?: number;
  /** Baseline rise at the centre, in pixels — for lettering on an arch. */
  arc?: number;
  align?: "center" | "left";
  /** Draw nothing, just measure. */
  measureOnly?: boolean;
}

function glyphOf(ch: string): Glyph | null {
  const g = ALPHABET[ch];
  if (g) return g;
  // Unknown character: fall back to its uppercase form rather than a tofu box.
  const up = ALPHABET[ch.toUpperCase()];
  return up ?? null;
}

/** Total advance width of a string, in pixels, at the given options. */
export function letteringWidth(text: string, o: LetterOpts): number {
  const track = (o.tracking ?? 0.06) * o.size;
  let w = 0;
  for (const ch of text) {
    const g = glyphOf(ch);
    w += (g ? g.adv : 0.4) * o.size + track;
  }
  return Math.max(0, w - track);
}

/**
 * Paint a line of hand-lettered signwriting. Returns the width it occupied.
 *
 * `cx` is the centre (or left edge if `align: "left"`), `baseY` the baseline.
 */
export function paintedLettering(
  x: CanvasRenderingContext2D, text: string, cx: number, baseY: number, o: LetterOpts
): number {
  const size = o.size;
  const weight = (o.weight ?? 0.155) * size;
  const track = (o.tracking ?? 0.06) * size;
  const wobble = o.wobble ?? 0.5;
  const arc = o.arc ?? 0;
  const total = letteringWidth(text, o);
  if (o.measureOnly) return total;

  const left = o.align === "left" ? cx : cx - total / 2;
  const rnd = rng((o.seed ?? 17) * 7919 + text.length);

  x.save();
  x.lineCap = "round";
  x.lineJoin = "round";

  let pen = left;
  for (const ch of text) {
    const g = glyphOf(ch);
    const adv = (g ? g.adv : 0.4) * size;
    if (g && g.s.length) {
      // where this glyph sits along the arc, and which way the arc leans there
      const u = total > 0 ? (pen + adv / 2 - left) / total : 0.5;
      const dy = -arc * (1 - (2 * u - 1) * (2 * u - 1));
      const slope = total > 0 ? Math.atan((-arc * (4 - 8 * u)) / total) : 0;

      // a hand never sets two letters at the same height or the same angle
      const jy = (rnd() - 0.5) * size * 0.035 * wobble;
      const jr = (rnd() - 0.5) * 0.05 * wobble;
      const js = 1 + (rnd() - 0.5) * 0.045 * wobble;

      x.save();
      x.translate(pen + adv / 2, baseY + dy + jy);
      x.rotate(slope + jr);
      x.scale(js, js);
      x.translate(-adv / 2, 0);

      // sample every stroke once, wobble it once, then draw it three times
      const strokes = g.s.map((s) => {
        const pts = sampleStroke(s.p, s.c, s.k);
        const amp = size * 0.014 * wobble;
        return {
          w: s.w,
          pts: pts.map(([px, py], i): [number, number] => [
            px * size + Math.sin(i * 1.9 + rnd() * 6) * amp,
            -py * size + Math.cos(i * 2.3 + rnd() * 6) * amp,
          ]),
        };
      });

      const pass = (dxp: number, dyp: number, col: number, mul: number, alpha: number) => {
        x.globalAlpha = alpha;
        x.strokeStyle = css(col);
        for (const s of strokes) {
          x.lineWidth = weight * s.w * mul;
          x.beginPath();
          x.moveTo(s.pts[0][0] + dxp, s.pts[0][1] + dyp);
          for (let i = 1; i < s.pts.length; i++) x.lineTo(s.pts[i][0] + dxp, s.pts[i][1] + dyp);
          x.stroke();
        }
      };

      // 1 · the warm ink shadow, dropped down-right so the letters lift off
      pass(size * 0.055, size * 0.062, o.ink, 1.16, 1);
      // 2 · the painted face
      pass(0, 0, o.face, 1, 1);
      // 3 · the signwriter's highlight, a thin lick along the top-left
      if (o.highlight !== undefined) pass(-size * 0.022, -size * 0.028, o.highlight, 0.34, 0.55);

      x.restore();
    }
    pen += adv + track;
  }
  x.restore();
  return total;
}

/* ================================================================== */
/* 2 · THE SIGNBOARD'S SILHOUETTE                                      */
/* ================================================================== */

/**
 * The board is a scalloped valance that follows the arch. Geometry and paint
 * must agree exactly on its outline, so both read it from here.
 * `u` runs 0..1 left to right; y is in board-local metres, 0 at the springing.
 */
export const SIGN = {
  // 10.6, not the full 12.4 post spacing: the carved knight and rook stand at
  // ±6.2 and the board has to clear them, or the gate loses its two best
  // silhouettes behind a plank.
  width: 10.6,
  thickness: 0.15,
  /** Rise of the board's arc at the centre — matches the arch chords. */
  rise: 0.72,
  lobes: 11,
  lobeDepth: 0.22,
  /** Height of the board above its own arc line, at the ends. */
  body: 1.28,
  /** Extra crown at the centre. */
  crown: 0.34,
} as const;

export function signBottomY(u: number): number {
  const a = SIGN.rise * (1 - (2 * u - 1) ** 2);
  const f = (u * SIGN.lobes) % 1;
  const scallop = Math.sqrt(Math.max(0, 1 - (2 * f - 1) ** 2));
  return a - SIGN.lobeDepth * scallop;
}

export function signTopY(u: number): number {
  const a = SIGN.rise * (1 - (2 * u - 1) ** 2);
  return a * 1.05 + SIGN.body + SIGN.crown * (1 - (2 * u - 1) ** 2) ** 1.4;
}

/** The board's own arc line, without scallops — where the lettering sits. */
export function signArcY(u: number): number {
  return SIGN.rise * (1 - (2 * u - 1) ** 2);
}

const SIGN_Y_MIN = -SIGN.lobeDepth;
const SIGN_Y_MAX = SIGN.rise * 1.05 + SIGN.body + SIGN.crown;
export const SIGN_SPAN = SIGN_Y_MAX - SIGN_Y_MIN;

/** Board-local y → canvas row fraction. 0 = the TOP of the painted art. */
function signPx01(y: number): number {
  return 1 - (y - SIGN_Y_MIN) / SIGN_SPAN;
}

/**
 * Board-local y → geometry UV.v.
 *
 * Three uploads canvas textures with `flipY`, so v = 0 samples the BOTTOM of
 * the painted art, not the top. Reading the canvas mapping straight into the
 * UVs paints the whole sign upside down — which is exactly what the first
 * capture of this gate showed.
 */
function signUV(y: number): number {
  return (y - SIGN_Y_MIN) / SIGN_SPAN;
}

/**
 * The scalloped board itself. Front, back and rim are separate vertices so
 * `computeVertexNormals` keeps the edges crisp instead of rounding the paint
 * away at the scallops.
 */
function buildSignBoard(): THREE.BufferGeometry {
  const N = 132, W = SIGN.width, T = SIGN.thickness;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const push = (px: number, py: number, pz: number, uu: number, vv: number): number => {
    pos.push(px, py, pz); uv.push(uu, vv); return pos.length / 3 - 1;
  };

  // front (+z) and back (−z) faces
  for (let face = 0; face < 2; face++) {
    const z = face === 0 ? T / 2 : -T / 2;
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const u = i / N, x = (u - 0.5) * W;
      const b = signBottomY(u), t = signTopY(u);
      push(x, b, z, face === 0 ? u : 1 - u, signUV(b));
      push(x, t, z, face === 0 ? u : 1 - u, signUV(t));
    }
    for (let i = 0; i < N; i++) {
      const a = base + i * 2, bb = a + 1, c = a + 2, d = a + 3;
      if (face === 0) idx.push(a, c, bb, bb, c, d);
      else idx.push(a, bb, c, bb, d, c);
    }
  }

  // top and bottom rims
  for (let edge = 0; edge < 2; edge++) {
    const base = pos.length / 3;
    const yOf = edge === 0 ? signTopY : signBottomY;
    for (let i = 0; i <= N; i++) {
      const u = i / N, x = (u - 0.5) * W, y = yOf(u);
      push(x, y, T / 2, u * 8, edge === 0 ? 0 : 1);
      push(x, y, -T / 2, u * 8, edge === 0 ? 0.06 : 0.94);
    }
    for (let i = 0; i < N; i++) {
      const a = base + i * 2, bb = a + 1, c = a + 2, d = a + 3;
      // top rim faces up, bottom rim faces down
      if (edge === 0) idx.push(a, c, bb, bb, c, d);
      else idx.push(a, bb, c, bb, d, c);
    }
  }

  // the two end caps
  for (const side of [0, 1]) {
    const u = side === 0 ? 0 : 1;
    const x = (u - 0.5) * W, b = signBottomY(u), t = signTopY(u);
    const base = pos.length / 3;
    push(x, b, T / 2, 0, 1); push(x, t, T / 2, 0, 0);
    push(x, b, -T / 2, 1, 1); push(x, t, -T / 2, 1, 0);
    if (side === 0) idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    else idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ================================================================== */
/* 3 · PAINTED TEXTURES — canvas2D, cached, never downloaded           */
/* ================================================================== */

const texCache = new Map<string, THREE.Texture>();

function paint(
  key: string, w: number, h: number,
  fn: (x: CanvasRenderingContext2D, w: number, h: number) => void,
  anisotropy = 8
): THREE.Texture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d")!;
  fn(x, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  texCache.set(key, t);
  return t;
}

/** Planked, grained, slightly worn wood ground for every painted board. */
function paintPlanks(
  x: CanvasRenderingContext2D, w: number, h: number, tint: number, planks: number, seed: number
): void {
  const r = rng(seed);
  x.fillStyle = css(tint);
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 150; i++) {
    x.globalAlpha = 0.05 + r() * 0.1;
    x.strokeStyle = css(mix(tint, r() > 0.5 ? PALETTE.walnutLight : PALETTE.cocoa, 0.45 + r() * 0.3));
    x.lineWidth = 0.8 + r() * 2.6;
    const y0 = r() * h;
    x.beginPath();
    x.moveTo(-10, y0);
    for (let px = 0; px <= w + 10; px += 26) x.lineTo(px, y0 + Math.sin(px * 0.011 + i) * (2 + r() * 6));
    x.stroke();
  }
  x.globalAlpha = 0.26;
  for (let i = 1; i < planks; i++) {
    const py = (i / planks) * h;
    x.strokeStyle = css(mix(tint, PALETTE.cocoa, 0.7));
    x.lineWidth = 2.4;
    x.beginPath();
    x.moveTo(0, py);
    for (let px = 0; px <= w; px += 20) x.lineTo(px, py + (r() - 0.5) * 3.2);
    x.stroke();
  }
  x.globalAlpha = 1;
}

/** A handful of snow flecks caught in the paint. */
function paintFlecks(x: CanvasRenderingContext2D, w: number, h: number, n: number, seed: number): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    x.globalAlpha = 0.10 + r() * 0.3;
    x.fillStyle = css(PALETTE.snow);
    const px = r() * w, py = r() * h, rr = 1 + r() * 4;
    x.beginPath(); x.ellipse(px, py, rr * (1 + r()), rr, r() * 3, 0, TAU); x.fill();
  }
  x.globalAlpha = 1;
}

/**
 * THE SIGN: "ChessPaa's Wonderland".
 *
 * Deep plum board, cream letters with a honey highlight, a painted gold rule
 * that hugs the scallops, and a turned star at each end. Everything follows
 * the board's arc, so the words rise over the middle of the gate the way a
 * real painted valance does.
 */
export function signFaceTexture(): THREE.Texture {
  const W = 2048, H = Math.round(W / (SIGN.width / SIGN_SPAN));
  return paint("gate-sign", W, H, (x, w, h) => {
    const topPx = (u: number) => signPx01(signTopY(u)) * h;
    const botPx = (u: number) => signPx01(signBottomY(u)) * h;
    const arcPx = (u: number) => signPx01(signArcY(u)) * h;

    paintPlanks(x, w, h, PALETTE.plumDeep, 5, 31);

    // a warm bloom behind the words — the sign is lit from below by lanterns.
    // Kept weak: past ~0.2 the plum board turns to gingerbread under the key.
    const bloom = x.createRadialGradient(w * 0.5, h * 0.70, 0, w * 0.5, h * 0.70, w * 0.42);
    bloom.addColorStop(0, "rgba(244,178,74,0.17)");
    bloom.addColorStop(0.55, "rgba(198,64,47,0.09)");
    bloom.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = bloom; x.fillRect(0, 0, w, h);

    // painted rules that follow the silhouette, inset from each edge
    const rule = (inset: number, col: number, lw: number, alpha: number) => {
      x.globalAlpha = alpha;
      x.strokeStyle = css(col);
      x.lineWidth = lw;
      x.beginPath();
      for (let i = 0; i <= 260; i++) {
        const u = i / 260, px = u * w, py = topPx(u) + inset;
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      for (let i = 260; i >= 0; i--) {
        const u = i / 260;
        x.lineTo(u * w, botPx(u) - inset);
      }
      x.closePath();
      x.stroke();
      x.globalAlpha = 1;
    };
    rule(h * 0.052, PALETTE.honey, h * 0.026, 0.95);
    rule(h * 0.076, PALETTE.honeyDeep, h * 0.010, 0.55);

    /**
     * THE WORDS.
     *
     * The board is far taller at the crown than at its ends, so the lettering
     * rides the board's own arc: `arcRise` measures how far the arc line
     * climbs between the ends of THIS line of text and its middle, which is
     * the number `paintedLettering` wants for `arc`. Getting this wrong is
     * what makes arched signage look like text pasted onto a curve.
     */
    const arcRise = (halfU: number) => arcPx(0.5 - halfU) - arcPx(0.5);
    const cap = h * 0.27;
    let o: LetterOpts = {
      size: cap,
      face: PALETTE.creamPale,
      ink: 0x3a1526,
      highlight: PALETTE.lanternCore,
      weight: 0.158,
      tracking: 0.075,
      wobble: 0.62,
      seed: 4211,
    };
    const TITLE = "ChessPaa's Wonderland";
    while (letteringWidth(TITLE, o) > w * 0.84 && o.size > cap * 0.55) {
      o = { ...o, size: o.size * 0.97 };
    }
    const titleW = letteringWidth(TITLE, o);
    o = { ...o, arc: arcRise(titleW / (2 * w)) };
    paintedLettering(x, TITLE, w / 2, arcPx(0.5) - o.size * 0.33 + (o.arc ?? 0), o);

    // a small painted line above the words, up in the crown where there is room
    const sub: LetterOpts = {
      size: cap * 0.19, face: PALETTE.honey, ink: 0x3a1526,
      weight: 0.21, tracking: 0.16, wobble: 0.85, seed: 77,
    };
    const SUB = "· come back tomorrow ·";
    const subArc = arcRise(letteringWidth(SUB, sub) / (2 * w));
    paintedLettering(x, SUB, w / 2, arcPx(0.5) - o.size * 1.44 + subArc, { ...sub, arc: subArc });

    // turned stars at each end, where a signwriter always puts one
    const star = (px: number, py: number, rr: number, seed: number) => {
      const r = rng(seed);
      x.save(); x.translate(px, py); x.rotate(r() * 1.2);
      x.fillStyle = css(PALETTE.honey);
      x.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        const rad = i % 2 ? rr * 0.42 : rr * (0.92 + r() * 0.16);
        const sx = Math.cos(a) * rad, sy = Math.sin(a) * rad;
        if (i === 0) x.moveTo(sx, sy); else x.lineTo(sx, sy);
      }
      x.closePath(); x.fill();
      x.fillStyle = css(PALETTE.lanternCore);
      x.beginPath(); x.arc(0, 0, rr * 0.26, 0, TAU); x.fill();
      x.restore();
    };
    star(w * 0.055, (topPx(0.055) + botPx(0.055)) / 2, h * 0.10, 5);
    star(w * 0.945, (topPx(0.945) + botPx(0.945)) / 2, h * 0.10, 9);

    paintFlecks(x, w, h, 90, 313);

    // the paint has taken a winter — knock the corners back
    const vg = x.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, "rgba(46,30,40,0.22)");
    vg.addColorStop(0.4, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(46,30,40,0.28)");
    x.fillStyle = vg; x.fillRect(0, 0, w, h);
  });
}

/* ---------------- the painted valley map ---------------- */

/** World XZ bounds the map board covers. */
const MAP_BOUNDS = { x0: -104, x1: 104, z0: -108, z1: 92 };

/**
 * THE PARK MAP BOARD.
 *
 * A plan of the valley painted on parchment: the frozen river drawn from the
 * SAME `RIVER_POINTS` the ground is carved from, the trodden paths, a hand
 * icon for every ride, and YOU ARE HERE at the gate with an arrow. Oriented
 * so that UP on the board is the way the child is facing — into the park.
 */
export function mapBoardTexture(): THREE.Texture {
  const W = 1280, H = 1000;
  return paint("gate-map", W, H, (x, w, h) => {
    const pad = 44;
    const mx = (wx: number) => pad + ((wx - MAP_BOUNDS.x0) / (MAP_BOUNDS.x1 - MAP_BOUNDS.x0)) * (w - pad * 2);
    // world +Z is toward the gate, which is the BOTTOM of the board
    const my = (wz: number) => pad + ((wz - MAP_BOUNDS.z0) / (MAP_BOUNDS.z1 - MAP_BOUNDS.z0)) * (h - pad * 2);
    const r = rng(8821);

    // --- parchment ground ---
    x.fillStyle = css(PALETTE.cream);
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      x.globalAlpha = 0.04 + r() * 0.07;
      x.fillStyle = css(mix(PALETTE.cream, PALETTE.walnut, 0.25 + r() * 0.45));
      x.beginPath(); x.arc(r() * w, r() * h, 4 + r() * 44, 0, TAU); x.fill();
    }
    x.globalAlpha = 1;

    // --- the pine wall that closes the valley: a wobbly ring of dark ---
    const cx = w * 0.5, cy = h * 0.52;
    const erx = w * 0.435, ery = h * 0.435;
    const ringPt = (a: number): [number, number] => {
      const wob = 1 + 0.032 * Math.sin(a * 9 + 1.3) + 0.018 * Math.sin(a * 23 - 0.4);
      return [cx + Math.cos(a) * erx * wob, cy + Math.sin(a) * ery * wob];
    };
    x.fillStyle = css(PALETTE.forest);
    x.globalAlpha = 0.94;
    x.beginPath();
    x.rect(0, 0, w, h);
    for (let i = 0; i <= 200; i++) {
      const [px, py] = ringPt((i / 200) * TAU);
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath();
    x.fill("evenodd");   // dark everywhere EXCEPT the valley floor
    x.globalAlpha = 1;

    // little painted pines standing along the tree line
    for (let i = 0; i < 130; i++) {
      const a = (i / 130) * TAU + r() * 0.06;
      const [bx, by] = ringPt(a);
      const push = 0.92 + r() * 0.16;
      const px = cx + (bx - cx) * push, py = cy + (by - cy) * push;
      const s = 8 + r() * 9;
      x.fillStyle = css(i % 3 ? PALETTE.forestMid : PALETTE.forest);
      x.beginPath();
      x.moveTo(px, py - s); x.lineTo(px + s * 0.52, py + s * 0.5); x.lineTo(px - s * 0.52, py + s * 0.5);
      x.closePath(); x.fill();
    }

    // --- soft snow-field wash inside the ring ---
    const field = x.createRadialGradient(cx, cy, 0, cx, cy, erx);
    field.addColorStop(0, "rgba(250,241,222,0.9)");
    field.addColorStop(0.78, "rgba(246,236,220,0.6)");
    field.addColorStop(1, "rgba(246,236,220,0)");
    x.fillStyle = field; x.fillRect(0, 0, w, h);

    // --- the frozen river and the paths, CLIPPED to the valley floor ---
    // A river drawn straight off the world spline runs out past the tree line
    // and over the painted frame; in a hand-drawn plan it simply disappears
    // into the pines, which is what this clip does.
    x.save();
    x.beginPath();
    for (let i = 0; i <= 200; i++) {
      const [px, py] = ringPt((i / 200) * TAU);
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath();
    x.clip();

    x.lineCap = "round"; x.lineJoin = "round";
    const river = (lw: number, col: string) => {
      x.strokeStyle = col; x.lineWidth = lw;
      x.beginPath();
      RIVER_POINTS.forEach(([wx, wz], i) => {
        const px = mx(wx), py = my(wz);
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      });
      x.stroke();
    };
    river(30, "rgba(79,142,166,0.35)");
    river(21, css(PALETTE.icePale));
    x.globalAlpha = 0.5; river(7, "#ffffff"); x.globalAlpha = 1;

    // --- the trodden paths (mirrors the routes in paths.ts) ---
    const ROUTES: Array<Array<[number, number]>> = [
      [[4, 62], [2, 50], [1, 34], [0, 20]],
      [[-8, -4], [-20, -10], [-33, -17], [-44, -22]],
      [[9, 6], [20, 15], [30, 24], [36, 29]],
      [[-48, -26], [-58, -36], [-66, -48], [-70, -58]],
      [[10, -6], [26, -20], [42, -40], [56, -60], [62, -71]],
    ];
    x.setLineDash([9, 8]);
    x.strokeStyle = css(mix(PALETTE.walnut, PALETTE.cream, 0.25));
    x.lineWidth = 5;
    for (const route of ROUTES) {
      x.beginPath();
      route.forEach(([wx, wz], i) => {
        const px = mx(wx), py = my(wz);
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      });
      x.stroke();
    }
    x.setLineDash([]);
    x.restore();

    /* ---------- the ride icons ---------- */
    const label = (text: string, px: number, py: number, size: number) =>
      paintedLettering(x, text, px, py, {
        size, face: PALETTE.cocoa, ink: PALETTE.cream, weight: 0.17,
        tracking: 0.08, wobble: 0.7, seed: text.length * 31 + 3,
      });

    const disc = (px: number, py: number, rad: number, col: number) => {
      x.fillStyle = css(PALETTE.creamPale);
      x.beginPath(); x.arc(px, py, rad * 1.12, 0, TAU); x.fill();
      x.strokeStyle = css(col); x.lineWidth = 3.4;
      x.beginPath(); x.arc(px, py, rad * 1.12, 0, TAU); x.stroke();
    };

    // the plaza + big top
    {
      const px = mx(0), py = my(0);
      disc(px, py, 34, PALETTE.plum);
      x.fillStyle = css(PALETTE.plumDeep);
      x.beginPath(); x.moveTo(px, py - 30); x.lineTo(px + 27, py + 16); x.lineTo(px - 27, py + 16);
      x.closePath(); x.fill();
      x.fillStyle = css(PALETTE.creamPale);
      for (let i = -2; i <= 2; i += 2) {
        x.beginPath();
        x.moveTo(px + i * 5.5, py - 30 + Math.abs(i) * 3);
        x.lineTo(px + i * 12 + 5, py + 16); x.lineTo(px + i * 12 - 2, py + 16);
        x.closePath(); x.fill();
      }
      x.strokeStyle = css(PALETTE.honey); x.lineWidth = 3;
      x.beginPath(); x.moveTo(px, py - 30); x.lineTo(px, py - 44); x.stroke();
      x.fillStyle = css(PALETTE.honey);
      x.beginPath(); x.moveTo(px, py - 44); x.lineTo(px + 14, py - 39); x.lineTo(px, py - 34);
      x.closePath(); x.fill();
      label("THE GRAND PLAZA", px, py + 54, 21);
    }

    // the ferris wheel
    {
      const px = mx(-70), py = my(-60);
      disc(px, py, 30, PALETTE.teal);
      x.strokeStyle = css(PALETTE.tealDeep); x.lineWidth = 4;
      x.beginPath(); x.arc(px, py - 4, 24, 0, TAU); x.stroke();
      x.lineWidth = 2.4;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        x.beginPath(); x.moveTo(px, py - 4);
        x.lineTo(px + Math.cos(a) * 24, py - 4 + Math.sin(a) * 24); x.stroke();
        x.fillStyle = css(i % 2 ? PALETTE.plum : PALETTE.honey);
        x.beginPath();
        x.arc(px + Math.cos(a) * 24, py - 4 + Math.sin(a) * 24, 4.6, 0, TAU); x.fill();
      }
      x.strokeStyle = css(PALETTE.walnut); x.lineWidth = 5;
      x.beginPath(); x.moveTo(px - 13, py + 26); x.lineTo(px, py - 4); x.lineTo(px + 13, py + 26); x.stroke();
      label("ENDGAME WHEEL", px, py + 52, 20);
    }

    // the tactics coaster hill
    {
      const px = mx(62), py = my(-72);
      disc(px, py, 32, PALETTE.honeyDeep);
      x.strokeStyle = css(PALETTE.walnut); x.lineWidth = 5;
      x.beginPath();
      x.moveTo(px - 30, py + 18);
      x.bezierCurveTo(px - 14, py + 16, px - 12, py - 24, px + 2, py - 24);
      x.bezierCurveTo(px + 18, py - 24, px + 14, py + 14, px + 30, py + 10);
      x.stroke();
      x.fillStyle = css(PALETTE.scarfRed);
      x.beginPath(); x.ellipse(px + 1, py - 30, 8, 5.4, 0, 0, TAU); x.fill();
      label("TACTICS COASTER", px, py + 52, 20);
    }

    // the puzzle train
    {
      const px = mx(37), py = my(29);
      disc(px, py, 28, PALETTE.forestMid);
      x.fillStyle = css(PALETTE.forestMid);
      x.fillRect(px - 22, py - 4, 30, 16);
      x.fillStyle = css(PALETTE.walnut);
      x.fillRect(px + 8, py - 12, 15, 24);
      x.fillStyle = css(PALETTE.cocoa);
      x.beginPath(); x.arc(px - 14, py + 14, 6, 0, TAU); x.fill();
      x.beginPath(); x.arc(px + 4, py + 14, 6, 0, TAU); x.fill();
      x.beginPath(); x.arc(px + 18, py + 14, 6, 0, TAU); x.fill();
      x.fillStyle = css(PALETTE.snow);
      x.beginPath(); x.ellipse(px - 20, py - 14, 10, 7, 0, 0, TAU); x.fill();
      label("PUZZLE TRAIN", px, py + 48, 20);
    }

    // the piece parade
    {
      const px = mx(-45), py = my(-23);
      disc(px, py, 30, PALETTE.teal);
      x.fillStyle = css(PALETTE.tealDeep);
      x.beginPath();
      x.moveTo(px - 28, py - 6);
      for (let i = 0; i <= 6; i++) x.lineTo(px - 28 + i * 9.4, py - 6 + (i % 2 ? 7 : 0));
      x.lineTo(px + 28, py - 16); x.lineTo(px - 28, py - 16);
      x.closePath(); x.fill();
      for (let i = 0; i < 3; i++) {
        x.fillStyle = css(i === 1 ? PALETTE.creamPale : PALETTE.cocoa);
        const bx = px - 15 + i * 15;
        x.beginPath();
        x.moveTo(bx - 6, py + 20); x.lineTo(bx + 6, py + 20);
        x.lineTo(bx + 3, py + 6); x.lineTo(bx + 5, py + 1); x.lineTo(bx - 5, py + 1);
        x.lineTo(bx - 3, py + 6); x.closePath(); x.fill();
        x.beginPath(); x.arc(bx, py - 2, 4.6, 0, TAU); x.fill();
      }
      label("PIECE PARADE", px, py + 48, 20);
    }

    // --- YOU ARE HERE ---
    {
      const px = mx(GATE_ANCHOR.x), py = my(GATE_ANCHOR.z);
      x.strokeStyle = css(PALETTE.scarfRed); x.lineWidth = 5;
      x.beginPath(); x.arc(px, py, 17, 0, TAU); x.stroke();
      x.fillStyle = css(PALETTE.scarfRed);
      x.beginPath(); x.arc(px, py, 8, 0, TAU); x.fill();
      // an arrow pointing the way in
      x.lineWidth = 5;
      x.beginPath(); x.moveTo(px, py - 22); x.lineTo(px, py - 48); x.stroke();
      x.beginPath();
      x.moveTo(px, py - 58); x.lineTo(px + 11, py - 42); x.lineTo(px - 11, py - 42);
      x.closePath(); x.fill();
      paintedLettering(x, "YOU ARE HERE", px, py + 46, {
        size: 24, face: PALETTE.scarfRed, ink: PALETTE.creamPale,
        weight: 0.19, tracking: 0.09, wobble: 0.75, seed: 991,
      });
    }

    // --- title, on a painted ribbon so it reads against the tree line ---
    {
      const bw = w * 0.56, bh = 96, by = 30;
      x.fillStyle = css(PALETTE.creamPale);
      x.beginPath();
      x.moveTo(w / 2 - bw / 2, by + 12);
      x.quadraticCurveTo(w / 2, by - 12, w / 2 + bw / 2, by + 12);
      x.lineTo(w / 2 + bw / 2 - 26, by + bh);
      x.quadraticCurveTo(w / 2, by + bh - 22, w / 2 - bw / 2 + 26, by + bh);
      x.closePath();
      x.fill();
      x.strokeStyle = css(PALETTE.walnut); x.lineWidth = 5; x.stroke();
      // the ribbon's folded tails
      x.fillStyle = css(mix(PALETTE.creamPale, PALETTE.walnut, 0.3));
      for (const s of [-1, 1]) {
        x.beginPath();
        x.moveTo(w / 2 + s * (bw / 2), by + 12);
        x.lineTo(w / 2 + s * (bw / 2 + 46), by + 34);
        x.lineTo(w / 2 + s * (bw / 2 + 46), by + 84);
        x.lineTo(w / 2 + s * (bw / 2 - 12), by + bh - 6);
        x.closePath(); x.fill();
      }
      paintedLettering(x, "The Valley of Wonders", w / 2, by + 74, {
        size: 46, face: PALETTE.cocoa, ink: PALETTE.honey, highlight: PALETTE.creamPale,
        weight: 0.15, tracking: 0.07, wobble: 0.6, seed: 1207, arc: 9,
      });
    }

    {
      const px = w - 104, py = 186;
      x.strokeStyle = css(PALETTE.walnut); x.lineWidth = 3;
      x.beginPath(); x.arc(px, py, 34, 0, TAU); x.stroke();
      x.fillStyle = css(PALETTE.scarfRed);
      x.beginPath(); x.moveTo(px, py - 30); x.lineTo(px + 9, py); x.lineTo(px - 9, py); x.closePath(); x.fill();
      x.fillStyle = css(PALETTE.cocoa);
      x.beginPath(); x.moveTo(px, py + 30); x.lineTo(px + 9, py); x.lineTo(px - 9, py); x.closePath(); x.fill();
      paintedLettering(x, "N", px, py - 40, {
        size: 22, face: PALETTE.cocoa, ink: PALETTE.creamPale, weight: 0.2, wobble: 0.6, seed: 12,
      });
    }

    x.strokeStyle = css(PALETTE.walnut);
    x.globalAlpha = 0.85; x.lineWidth = 9;
    x.strokeRect(16, 16, w - 32, h - 32);
    x.globalAlpha = 0.5; x.lineWidth = 3;
    x.strokeRect(30, 30, w - 60, h - 60);
    x.globalAlpha = 1;

    paintFlecks(x, w, h, 110, 55);

    const vg = x.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.8);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(110,67,38,0.30)");
    x.fillStyle = vg; x.fillRect(0, 0, w, h);
  });
}

/** The kiosk's little TICKETS board. */
export function ticketBoardTexture(): THREE.Texture {
  return paint("gate-tickets", 512, 220, (x, w, h) => {
    paintPlanks(x, w, h, PALETTE.tealDeep, 3, 63);
    x.strokeStyle = css(PALETTE.honey); x.globalAlpha = 0.9; x.lineWidth = 7;
    x.strokeRect(16, 16, w - 32, h - 32);
    x.globalAlpha = 1;
    paintedLettering(x, "TICKETS", w / 2, h * 0.52, {
      size: 74, face: PALETTE.creamPale, ink: 0x1b3a37, highlight: PALETTE.lanternCore,
      weight: 0.17, tracking: 0.1, wobble: 0.6, seed: 501,
    });
    paintedLettering(x, "always free", w / 2, h * 0.82, {
      size: 26, face: PALETTE.honey, ink: 0x1b3a37, weight: 0.19, tracking: 0.1, wobble: 0.85, seed: 88,
    });
    paintFlecks(x, w, h, 30, 7);
  });
}

/**
 * PAINTED COLOUR CHIPS — one strip, six dyes, so every balloon and every
 * bunting flag in the gate is a single draw call. Each chip carries a soft
 * sheen along its length, which is what turns a flat sphere into rubber.
 */
export const CHIP_COLOURS: number[] = [
  PALETTE.scarfRed, PALETTE.teal, PALETTE.honey,
  PALETTE.plum, PALETTE.creamPale, PALETTE.tealDeep,
];

export function paletteChipTexture(): THREE.Texture {
  const bands = CHIP_COLOURS.length;
  return paint("gate-chips", 256, 64 * bands, (x, w, h) => {
    const bh = h / bands;
    CHIP_COLOURS.forEach((col, i) => {
      const y0 = i * bh;
      const g = x.createLinearGradient(0, y0, 0, y0 + bh);
      g.addColorStop(0, css(mix(col, PALETTE.creamPale, 0.45)));
      g.addColorStop(0.34, css(col));
      g.addColorStop(1, css(mix(col, PALETTE.plumDeep, 0.35)));
      x.fillStyle = g;
      x.fillRect(0, y0, w, bh);
      // the highlight streak a balloon always wears
      const hl = x.createRadialGradient(w * 0.28, y0 + bh * 0.3, 0, w * 0.28, y0 + bh * 0.3, bh * 0.5);
      hl.addColorStop(0, "rgba(255,248,232,0.55)");
      hl.addColorStop(1, "rgba(255,248,232,0)");
      x.fillStyle = hl;
      x.fillRect(0, y0, w, bh);
      // a hand-wobbled seam so the chip never reads as flat fill
      const r = rng(200 + i * 13);
      x.globalAlpha = 0.12;
      for (let k = 0; k < 8; k++) {
        x.strokeStyle = css(mix(col, PALETTE.cream, r()));
        x.lineWidth = 1 + r() * 3;
        const yy = y0 + r() * bh;
        x.beginPath(); x.moveTo(0, yy);
        for (let px = 0; px <= w; px += 24) x.lineTo(px, yy + Math.sin(px * 0.05 + k) * 2.4);
        x.stroke();
      }
      x.globalAlpha = 1;
    });
  }, 4);
}

/* ================================================================== */
/* 4 · THE STRUCTURES                                                  */
/* ================================================================== */

/** The arch's dimensions, in one place so nothing drifts out of alignment. */
export const ARCH = {
  halfSpan: 6.2,
  /** Bottom chord height at the posts. */
  spring: 4.30,
  rise: 0.72,
  chordGap: 0.82,
  beamW: 0.44,
  postTop: 5.05,
  /** Where the signboard's own origin sits. */
  signY: 5.16,
  signZ: 0.30,
} as const;

export interface GateGlow {
  pos: [number, number, number];
  color: number;
  size: number;
  phase: number;
  /**
   * 0 = a steady lantern. 1 = a fairy-light that has NOT QUITE DECIDED TO
   * GLOW — it swells and gutters on its own slow clock. Straight from the
   * bible's opening image, and the single warmest detail at the gate.
   */
  hesitate: number;
}

export interface BalloonBunch {
  /** Local position of the knot the strings are tied to. */
  tie: [number, number, number];
  skins: THREE.BufferGeometry;
  strings: THREE.BufferGeometry;
  /** Peak sway in radians, and a phase so no two bunches tug together. */
  sway: number;
  phase: number;
}

export interface GateMarks {
  /** World centre of the arch opening, at head height. */
  archCentre: THREE.Vector3;
  /** World point on the ground where a child crosses the threshold. */
  threshold: THREE.Vector3;
  /** Where the little wooden coaster car settles (the shared gate stop). */
  carMark: THREE.Vector3;
  /** Where ChessPaa should wait — beside the car, inside the pool of light. */
  paaMark: THREE.Vector3;
  /** His yaw before the greeting (looking away, down the path) … */
  paaFacingAway: number;
  /** … and after it, looking straight at the child who just arrived. */
  paaFacingYou: number;
  /** World centre of the warm pool on the snow. */
  poolCentre: THREE.Vector3;
}

export interface GateBuild {
  parts: GateParts;
  glows: GateGlow[];
  balloons: BalloonBunch[];
  /** The ground-glow disc, already draped over the real terrain. */
  pool: THREE.BufferGeometry;
  marks: GateMarks;
}

/* ---------------- one carved post ---------------- */

function buildPost(bag: Bag, side: -1 | 1, seed: number): void {
  const x = side * ARCH.halfSpan;
  const z = ARCH_Z;
  const y0 = gateGroundY(x, z) - 0.12;   // sunk a little so snow banks against it

  // plinth: two stacked blocks, the top one turned a degree off true
  const b1 = new THREE.BoxGeometry(1.42, 0.52, 1.42);
  b1.translate(x, y0 + 0.26, z);
  const b2 = new THREE.BoxGeometry(1.18, 0.16, 1.18);
  b2.rotateY(0.03 * side);
  b2.translate(x, y0 + 0.60, z);
  put(bag, "timber", scaleUV(b1, 1.6, 0.7), scaleUV(b2, 1.4, 0.3));

  // shaft: an eight-sided turning with collars — carved, not extruded
  const prof: THREE.Vector2[] = [];
  const add = (r: number, y: number) => prof.push(new THREE.Vector2(r, y));
  add(0.54, y0 + 0.68); add(0.54, y0 + 0.86); add(0.60, y0 + 0.98); add(0.50, y0 + 1.12);
  add(0.49, y0 + 2.30); add(0.56, y0 + 2.44); add(0.56, y0 + 2.58); add(0.47, y0 + 2.72);
  add(0.45, y0 + 4.30); add(0.50, y0 + 4.42); add(0.44, y0 + 4.56);
  // capital: flared, the way a real gatepost carries a beam
  add(0.72, y0 + 4.78); add(0.70, y0 + 4.90); add(0.60, y0 + ARCH.postTop);
  add(0.00, y0 + ARCH.postTop);
  const shaft = new THREE.LatheGeometry(prof, 8);
  shaft.translate(x, 0, z);
  put(bag, "timber", scaleUV(swapUV(shaft), 1.9, 1.1));

  // painted honey collars, so the eye reads bands of colour up the post
  for (const cy of [1.05, 2.51, 4.36]) {
    const ring = new THREE.CylinderGeometry(0.615, 0.615, 0.13, 8);
    ring.translate(x, y0 + cy, z);
    put(bag, "honey", ring);
  }

  /**
   * THE FINIALS. A knight on the left, a rook on the right: the first two
   * pieces a child ever learns to name, standing where the stone lions would.
   *
   * CLONE FIRST. `pieceGeometry` hands back a CACHED, SHARED geometry, and
   * `mergeGeometries` both transforms and DISPOSES what you give it — so
   * scaling the returned object in place would silently corrupt every other
   * rook and knight in the park (the carousel's, the parade's, the board's)
   * and free their buffers out from under them.
   */
  const type = side < 0 ? "n" : "r";
  const FINIAL = 1.35;
  const piece = pieceGeometry(type, "high").clone();
  piece.scale(FINIAL, FINIAL, FINIAL);
  // The carved knight faces +Z out of the box; turn him INWARD and a little
  // toward the path, so he is looking at whoever is walking up to the gate.
  piece.rotateY(side < 0 ? 0.92 : -0.35);
  piece.translate(x, y0 + ARCH.postTop, z);
  put(bag, "cream", piece);
  const finialTop = y0 + ARCH.postTop + pieceHeight(type) * FINIAL;

  // snow: on the plinth ledge, on the capital, and a cap on the finial
  put(bag, "snow",
    snowPillow(1.26, 1.26, 0.20, seed, { lip: 0.22, droop: 0.14, lobes: 6 })
      .translate(x, y0 + 0.66, z),
    snowPillow(1.10, 1.10, 0.22, seed + 3, { lip: 0.30, droop: 0.18, lobes: 5 })
      .translate(x, y0 + ARCH.postTop - 0.06, z),
    // sized and placed off the real piece height, not a guessed offset
    snowPillow(0.44, 0.44, 0.13, seed + 7, { lip: 0.26, droop: 0.16, lobes: 4 })
      .translate(x, finialTop - 0.06, z)
  );
}

/* ---------------- the arch itself ---------------- */

function buildArch(bag: Bag, glows: GateGlow[]): void {
  const { halfSpan, spring, rise, chordGap, beamW } = ARCH;
  const z = ARCH_Z;

  const lower = archPath(halfSpan, spring, rise, z, 42);
  const upper = archPath(halfSpan, spring + chordGap, rise, z, 42);

  put(bag, "timber",
    scaleUV(sweepProfile(lower, RECT(beamW, 0.34), { uScale: 9 }), 1, 1),
    scaleUV(sweepProfile(upper, RECT(beamW, 0.26), { uScale: 9 }), 1, 1)
  );

  // turned balusters between the chords — the fairground's favourite trick
  for (let i = 1; i < 17; i++) {
    const u = (i / 17) * 2 - 1;
    const yl = archY(u, spring, rise) + 0.17;
    const yu = archY(u, spring + chordGap, rise) - 0.13;
    const bp: THREE.Vector2[] = [
      new THREE.Vector2(0.085, yl), new THREE.Vector2(0.055, yl + 0.10),
      new THREE.Vector2(0.105, yl + 0.22), new THREE.Vector2(0.055, yl + 0.36),
      new THREE.Vector2(0.085, yu - 0.05), new THREE.Vector2(0.085, yu),
      new THREE.Vector2(0.0, yu),
    ];
    const bal = new THREE.LatheGeometry(bp, 6);
    bal.translate(u * halfSpan, 0, z);
    put(bag, "timberPale", bal);
  }

  /**
   * CORBEL BRACKETS. A carved quarter-round spandrel filling the corner where
   * the arch lands on the post, plus a slim iron tie across it. The spandrel
   * is what stops the opening reading as a bare goalpost: it rounds the corner
   * the way every fairground arch and every timber-framed porch does.
   */
  for (const side of [-1, 1] as const) {
    const R = 1.62;
    const ox = side * (halfSpan - 0.30);
    const oy = spring - 0.06;
    // a solid quarter-round knee with a scalloped rim, filling the corner
    const poly: Array<[number, number]> = [[ox, oy]];
    for (let k = 0; k <= 22; k++) {
      const a = (k / 22) * (Math.PI / 2);
      const rr = R * (0.90 + 0.055 * Math.sin(a * 9 + 0.4));
      poly.push([ox - side * rr * Math.sin(a), oy - rr * Math.cos(a)]);
    }
    put(bag, "timberPale", scaleUV(plateXY(poly, z, 0.17), 2, 2));

    // an iron tie strapped across the knee, with a bolt at each end
    const tie: THREE.Vector3[] = [
      new THREE.Vector3(ox, oy - R * 0.80, z + 0.13),
      new THREE.Vector3(ox - side * R * 0.80, oy, z + 0.13),
    ];
    put(bag, "iron", sweepProfile(tie, RECT(0.10, 0.09), { uScale: 2 }));
    for (const p of tie) {
      const bolt = new THREE.SphereGeometry(0.08, 7, 5);
      bolt.translate(p.x, p.y, p.z + 0.05);
      put(bag, "iron", bolt);
    }
  }

  /* ---- the scalloped signboard ---- */
  const board = buildSignBoard();
  board.translate(0, ARCH.signY, z + ARCH.signZ);
  put(bag, "signFace", board);

  // a plank back, so the sign has a body when you walk past it
  const backPts = archPath(SIGN.width / 2, ARCH.signY + SIGN.rise * 0.6 + SIGN.body * 0.5, SIGN.rise * 0.4, z + 0.12, 24);
  put(bag, "timberPale", sweepProfile(backPts, RECT(0.22, SIGN.body * 0.9), { uScale: 8 }));

  // snow along the top edge of the board, and along the arch's top chord
  const topEdge: THREE.Vector3[] = [];
  for (let i = 0; i <= 46; i++) {
    const u = i / 46;
    topEdge.push(new THREE.Vector3((u - 0.5) * SIGN.width, ARCH.signY + signTopY(u) - 0.02, z + ARCH.signZ));
  }
  put(bag, "snow", snowRidge(topEdge, 0.40, 0.19, 0.55));
  put(bag, "snow", snowRidge(archPath(halfSpan, spring + chordGap + 0.13, rise, z, 34), 0.48, 0.15, 0.42));

  /* ---- the ring of little bulbs around the sign ---- */
  const BULBS = 26;
  for (let i = 0; i <= BULBS; i++) {
    const u = i / BULBS;
    const y = ARCH.signY + signTopY(u) + 0.13;
    glows.push({
      pos: [(u - 0.5) * (SIGN.width - 0.5), y, z + ARCH.signZ + 0.10],
      color: i % 3 === 0 ? PALETTE.lanternCore : PALETTE.honey,
      size: 1.0,
      phase: (i * 0.31) % 1,
      hesitate: 0.12,
    });
  }
}

/* ---------------- the flanking lantern posts ---------------- */

const LANTERN_X = 8.1;
const LANTERN_H = 4.55;

function buildLanternPost(bag: Bag, glows: GateGlow[], side: -1 | 1, seed: number): void {
  const x = side * LANTERN_X, z = ARCH_Z;
  const y0 = gateGroundY(x, z) - 0.08;

  const base = new THREE.CylinderGeometry(0.36, 0.48, 0.40, 8);
  base.translate(x, y0 + 0.20, z);
  const prof: THREE.Vector2[] = [
    new THREE.Vector2(0.24, y0 + 0.40), new THREE.Vector2(0.28, y0 + 0.60),
    new THREE.Vector2(0.19, y0 + 0.80), new THREE.Vector2(0.175, y0 + LANTERN_H - 0.55),
    new THREE.Vector2(0.24, y0 + LANTERN_H - 0.40), new THREE.Vector2(0.165, y0 + LANTERN_H - 0.26),
    new THREE.Vector2(0.165, y0 + LANTERN_H),
  ];
  const shaft = new THREE.LatheGeometry(prof, 8);
  shaft.translate(x, 0, z);
  put(bag, "timber", scaleUV(base, 1.2, 0.4), scaleUV(swapUV(shaft), 2.6, 0.8));

  // a scrolled iron bracket reaching in toward the gate
  const arm = new THREE.TorusGeometry(0.40, 0.045, 5, 10, Math.PI * 0.62);
  arm.rotateY(Math.PI / 2);
  arm.rotateZ(side < 0 ? -0.2 : Math.PI + 0.2);
  arm.translate(x - side * 0.10, y0 + LANTERN_H - 0.06, z);
  put(bag, "iron", arm);

  const hx = x - side * 0.62;
  const hy = y0 + LANTERN_H - 0.42;

  // the housing: a four-panel brass box with a little pyramid roof
  const cage = new THREE.CylinderGeometry(0.24, 0.28, 0.10, 4);
  cage.rotateY(Math.PI / 4);
  cage.translate(hx, hy + 0.30, z);
  const foot = new THREE.CylinderGeometry(0.26, 0.20, 0.10, 4);
  foot.rotateY(Math.PI / 4);
  foot.translate(hx, hy - 0.28, z);
  const roof = new THREE.ConeGeometry(0.36, 0.30, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(hx, hy + 0.50, z);
  const knob = new THREE.SphereGeometry(0.07, 7, 5);
  knob.translate(hx, hy + 0.68, z);
  put(bag, "honey", cage, foot, roof, knob);

  const panes = new THREE.CylinderGeometry(0.22, 0.25, 0.56, 4);
  panes.rotateY(Math.PI / 4);
  panes.translate(hx, hy, z);
  put(bag, "glass", panes);

  put(bag, "snow",
    snowPillow(0.60, 0.60, 0.12, seed, { lip: 0.24, droop: 0.11, lobes: 4 }).translate(hx, hy + 0.62, z),
    snowPillow(0.86, 0.86, 0.15, seed + 5, { lip: 0.24, droop: 0.13, lobes: 5 }).translate(x, y0 + 0.40, z)
  );

  glows.push({ pos: [hx, hy, z], color: PALETTE.lanternCore, size: 2.6, phase: seed * 0.11, hesitate: 0 });
}

/* ---------------- bunting, cord and hesitant fairy-lights ---------------- */

interface Run { a: THREE.Vector3; b: THREE.Vector3; sag: number; flags: number }

function catenary(run: Run, t: number): THREE.Vector3 {
  const p = new THREE.Vector3().lerpVectors(run.a, run.b, t);
  p.y -= Math.sin(t * Math.PI) * run.sag;
  return p;
}

function buildBunting(bag: Bag, glows: GateGlow[]): void {
  const z = ARCH_Z;
  const lanternTop = (side: -1 | 1) =>
    new THREE.Vector3(side * LANTERN_X, gateGroundY(side * LANTERN_X, z) - 0.08 + LANTERN_H - 0.02, z);
  const postTop = (side: -1 | 1) =>
    new THREE.Vector3(side * (ARCH.halfSpan - 0.15), gateGroundY(side * ARCH.halfSpan, z) - 0.12 + ARCH.postTop - 0.35, z + 0.42);

  const runs: Run[] = [
    // outboard: lantern post → gate post, a short cheerful swag on each side
    { a: lanternTop(-1), b: postTop(-1), sag: 0.42, flags: 5 },
    { a: lanternTop(1), b: postTop(1), sag: 0.42, flags: 5 },
    /**
     * TWO NESTED SWAGS ACROSS THE OPENING — and they must both bow DOWNWARD.
     *
     * These two used to bow toward each other: the long one sagged 1.05 down
     * while the "higher" one carried sag −0.62, i.e. it arced UP. Their ends
     * were also within seven centimetres of each other, because one height was
     * measured from the post's sunk ground (`postTop`) and the other straight
     * off `ARCH.spring` in gate-local — two different bases that happened to
     * land on the same line. Two cords meeting at both ends, one bowing up and
     * one bowing down, enclose a lens; the gate's opening read as a closed eye
     * with the arch's own chord lost behind the flags. Nest them instead, which
     * is what bunting on a real gate does, and the way through is clear again.
     */
    {
      a: postTop(-1).clone().add(new THREE.Vector3(0, 0.1, 0)),
      b: postTop(1).clone().add(new THREE.Vector3(0, 0.1, 0)),
      sag: 0.58, flags: 15,
    },
    // the higher, shorter one — hung off the same base as its neighbour so the
    // two can never drift onto each other again
    {
      a: postTop(-1).clone().add(new THREE.Vector3(0.45, 0.62, 0.34)),
      b: postTop(1).clone().add(new THREE.Vector3(-0.45, 0.62, 0.34)),
      sag: 0.26, flags: 13,
    },
  ];

  const flagGeos: THREE.BufferGeometry[] = [];
  const cordGeos: THREE.BufferGeometry[] = [];
  let chip = 0;

  for (const run of runs) {
    for (let i = 0; i < run.flags; i++) {
      const t = (i + 0.5) / run.flags;
      const p = catenary(run, t);
      const dir = new THREE.Vector3().subVectors(run.b, run.a).normalize();

      // a real pennant has a little belly to it, so it is four triangles, not one
      const w = 0.34, hgt = 0.56;
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      const COLS = 3;
      for (let c = 0; c <= COLS; c++) {
        const cu = c / COLS;
        const belly = Math.sin(cu * Math.PI) * 0.07;
        pos.push((cu - 0.5) * 2 * w, 0, belly);
        uv.push(cu, 1);
        pos.push((cu - 0.5) * 2 * w * 0.12, -hgt, belly * 0.5);
        uv.push(cu, 0);
      }
      for (let c = 0; c < COLS; c++) {
        const a = c * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      uvBand(g, chip % CHIP_COLOURS.length, CHIP_COLOURS.length);
      chip++;
      /**
       * Lay the pennant's WIDTH along the cord.
       *
       * The flag is authored with its span on local +X and its painted face on
       * +Z (that is the way `belly` bulges). `rotateY(θ)` sends +X to
       * (cosθ, 0, −sinθ), so aligning the span with `dir` wants
       * `atan2(−dir.z, dir.x)`. The look-at form — `atan2(dir.x, dir.z)`, which
       * is what you reach for out of habit because it is how you aim a MODEL —
       * points the flag's FACE down the cord instead, and every pennant on a
       * left-to-right run turns exactly 90° and hangs edge-on to the child
       * walking up to the gate.
       */
      g.rotateY(Math.atan2(-dir.z, dir.x));
      g.rotateZ((i % 2 ? 1 : -1) * 0.07);
      g.translate(p.x, p.y, p.z);
      flagGeos.push(g);
    }

    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) pts.push(catenary(run, i / 16));
    cordGeos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.021, 4, false));

    // THE FAIRY-LIGHTS. Threaded on the same cords, and deliberately unsure
    // of themselves: `hesitate` lets each bulb swell and gutter on its own
    // slow clock rather than pulse in time with the rest.
    for (let i = 0; i <= 22; i++) {
      const t = i / 22;
      const p = catenary(run, t);
      glows.push({
        pos: [p.x, p.y - 0.06, p.z],
        color: i % 4 === 0 ? PALETTE.lanternCore : PALETTE.honey,
        size: 0.85 + (i % 3) * 0.09,
        phase: (i * 0.37 + run.sag) % 1,
        hesitate: 0.45 + ((i * 7) % 11) / 20,
      });
    }
  }

  put(bag, "chip", ...flagGeos);
  put(bag, "cord", ...cordGeos);
}

/* ---------------- the ticket arch / turnstile ---------------- */

function buildTurnstile(bag: Bag, glows: GateGlow[]): void {
  const z = ARCH_Z - 1.5;

  /** A low rail: two posts, a top rail, a snow ridge along it. */
  const rail = (x0: number, x1: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6, x = x0 + (x1 - x0) * t;
      pts.push(new THREE.Vector3(x, gateGroundY(x, z) + 1.02, z));
    }
    put(bag, "timberPale", sweepProfile(pts, RECT(0.13, 0.11), { uScale: 4 }));
    const midPts = pts.map((p) => p.clone().setY(p.y - 0.34));
    put(bag, "timberPale", sweepProfile(midPts, RECT(0.10, 0.08), { uScale: 4 }));
    for (let i = 0; i <= 3; i++) {
      const x = x0 + (x1 - x0) * (i / 3);
      const gy = gateGroundY(x, z);
      const p = new THREE.CylinderGeometry(0.09, 0.11, 1.2, 7);
      p.translate(x, gy + 0.55, z);
      const cap = new THREE.ConeGeometry(0.13, 0.16, 7);
      cap.translate(x, gy + 1.20, z);
      put(bag, "timber", p, cap);
    }
    put(bag, "snow", snowRidge(pts.map((p) => p.clone().setY(p.y + 0.09)), 0.20, 0.09, 0.5));
  };

  rail(-5.6, -3.4);
  rail(1.7, 5.6);

  // THE TURNSTILE. One drum with three arms over on the left, and a wide open
  // gap beside it — the gate must SUGGEST a ticket barrier and never be one.
  // There are no fail states in this park, not even at the door.
  const tx = -2.5, ty = gateGroundY(tx, z);
  const drum: THREE.Vector2[] = [
    new THREE.Vector2(0.20, ty), new THREE.Vector2(0.22, ty + 0.10),
    new THREE.Vector2(0.13, ty + 0.22), new THREE.Vector2(0.13, ty + 0.92),
    new THREE.Vector2(0.20, ty + 1.02), new THREE.Vector2(0.17, ty + 1.14),
    new THREE.Vector2(0.0, ty + 1.20),
  ];
  const post = new THREE.LatheGeometry(drum, 8);
  post.translate(tx, 0, z);
  put(bag, "timber", scaleUV(post, 1.2, 1.2));

  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    const arm = new THREE.CylinderGeometry(0.045, 0.045, 0.86, 6);
    arm.rotateZ(Math.PI / 2);
    arm.translate(0.43, 0, 0);
    arm.rotateY(a);
    arm.translate(tx, ty + 0.86, z);
    const tip = new THREE.SphereGeometry(0.075, 7, 5);
    tip.translate(Math.cos(a) * 0.86, 0, -Math.sin(a) * 0.86);
    tip.translate(tx, ty + 0.86, z);
    put(bag, "iron", arm, tip);
  }
  put(bag, "snow", snowPillow(0.40, 0.40, 0.10, 21, { lip: 0.2, droop: 0.09, lobes: 4 })
    .translate(tx, ty + 1.20, z));

  /* ---- the little kiosk, off to the left ---- */
  const kx = -9.6, kz = ARCH_Z + 3.0;
  const ky = gateGroundY(kx, kz) - 0.05;

  const body = new THREE.CylinderGeometry(1.32, 1.38, 2.16, 6);
  body.rotateY(0.32);
  body.translate(kx, ky + 1.08, kz);
  put(bag, "timberPale", scaleUV(body, 3.4, 1.1));

  const sill = new THREE.CylinderGeometry(1.52, 1.46, 0.14, 6);
  sill.rotateY(0.32);
  sill.translate(kx, ky + 1.42, kz);
  const skirt = new THREE.CylinderGeometry(1.46, 1.52, 0.20, 6);
  skirt.rotateY(0.32);
  skirt.translate(kx, ky + 0.10, kz);
  put(bag, "timber", sill, skirt);

  const roof = new THREE.ConeGeometry(2.05, 0.86, 6);
  roof.rotateY(0.32);
  roof.translate(kx, ky + 2.56, kz);
  put(bag, "timber", scaleUV(roof, 3, 1));

  // a striped canvas valance all round, under the eaves
  const aw = new THREE.CylinderGeometry(1.98, 1.58, 0.54, 6, 1, true);
  aw.rotateY(0.32);
  aw.translate(kx, ky + 2.02, kz);
  put(bag, "awning", scaleUV(aw, 6, 1));

  const finial = new THREE.SphereGeometry(0.17, 8, 6);
  finial.translate(kx, ky + 3.02, kz);
  put(bag, "honey", finial);

  // Snow on a CONE has to be a cone. A flat pillow up here reads as a saucer
  // hovering over the roof — which is exactly how the first capture looked.
  const roofSnow = new THREE.ConeGeometry(1.86, 0.80, 6);
  roofSnow.rotateY(0.32);
  roofSnow.translate(kx, ky + 2.66, kz);
  const eaves: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * TAU + 0.32;
    eaves.push(new THREE.Vector3(kx + Math.cos(a) * 1.98, ky + 2.20, kz + Math.sin(a) * 1.98));
  }
  put(bag, "snow",
    roofSnow,
    snowRidge(eaves, 0.34, 0.15, 0.5),
    snowPillow(3.1, 3.1, 0.12, 43, { lip: 0.22, droop: 0.12, lobes: 6, square: 0.5 })
      .translate(kx, ky + 1.48, kz)
  );

  // the TICKETS board, hung on the face of the kiosk that meets the path
  const boardYaw = 1.30;
  const bx = kx + Math.sin(boardYaw) * 1.20;
  const bz = kz + Math.cos(boardYaw) * 1.20;
  const face = new THREE.PlaneGeometry(1.5, 0.64);
  face.rotateY(boardYaw);
  face.translate(bx, ky + 1.74, bz);
  put(bag, "ticketFace", face);

  const trim = new THREE.BoxGeometry(1.62, 0.76, 0.09);
  trim.rotateY(boardYaw);
  trim.translate(bx - Math.sin(boardYaw) * 0.05, ky + 1.74, bz - Math.cos(boardYaw) * 0.05);
  put(bag, "timber", trim);

  put(bag, "snow", snowPillow(1.60, 0.34, 0.10, 47, { lip: 0.3, droop: 0.12, lobes: 5 })
    .rotateY(boardYaw).translate(bx, ky + 2.14, bz));

  glows.push({
    pos: [bx + Math.sin(boardYaw) * 0.24, ky + 2.28, bz + Math.cos(boardYaw) * 0.24],
    color: PALETTE.honey, size: 1.6, phase: 0.4, hesitate: 0,
  });
}

/* ---------------- the carved park map board ---------------- */

const MAP_W = 4.0, MAP_H = 3.12;

function buildMapBoard(bag: Bag, glows: GateGlow[]): void {
  const cx = 8.6, cz = ARCH_Z + 3.0;
  const yaw = -0.62;   // angled to meet a child walking up the path
  const s = Math.sin(yaw), c = Math.cos(yaw);
  /** Board-local (bx, bz) → gate-local. */
  const L = (bx: number, bz: number): [number, number] => [cx + bx * c + bz * s, cz - bx * s + bz * c];

  const place = (g: THREE.BufferGeometry, bx: number, by: number, bz: number): THREE.BufferGeometry => {
    g.rotateY(yaw);
    const [lx, lz] = L(bx, bz);
    g.translate(lx, by, lz);
    return g;
  };

  // two chunky legs, each sunk to its own patch of ground
  for (const side of [-1, 1] as const) {
    const [lx, lz] = L(side * (MAP_W / 2 - 0.34), 0);
    const gy = gateGroundY(lx, lz) - 0.10;
    const leg = new THREE.BoxGeometry(0.30, 2.05, 0.34);
    leg.translate(0, 1.02, 0);
    place(leg, side * (MAP_W / 2 - 0.34), gy, 0);
    put(bag, "timber", scaleUV(leg, 0.6, 2));
    const shoe = new THREE.BoxGeometry(0.62, 0.20, 0.62);
    place(shoe, side * (MAP_W / 2 - 0.34), gy + 0.10, 0);
    put(bag, "timber", shoe);
    put(bag, "snow", place(
      snowPillow(0.78, 0.78, 0.12, 61 + side * 3, { lip: 0.2, droop: 0.1, lobes: 5 }),
      side * (MAP_W / 2 - 0.34), gy + 0.20, 0
    ));
  }

  const baseY = Math.min(
    gateGroundY(...L(-(MAP_W / 2 - 0.34), 0)),
    gateGroundY(...L(MAP_W / 2 - 0.34, 0))
  ) - 0.10;

  // the frame and the painted panel, tilted back so it faces a child's eyes
  const tilt = -0.16;
  const panelY = baseY + 2.62;

  const frame = new THREE.BoxGeometry(MAP_W, MAP_H, 0.20);
  frame.rotateX(tilt);
  place(frame, 0, panelY, 0);
  put(bag, "timber", scaleUV(frame, 2.4, 1.8));

  const inner = new THREE.BoxGeometry(MAP_W - 0.34, MAP_H - 0.34, 0.24);
  inner.rotateX(tilt);
  place(inner, 0, panelY, 0.02);
  put(bag, "timberPale", scaleUV(inner, 2, 1.6));

  const panel = new THREE.PlaneGeometry(MAP_W - 0.44, MAP_H - 0.44);
  panel.rotateX(tilt);
  place(panel, 0, panelY, 0.145);   // 5mm proud of the raised inner panel
  put(bag, "mapFace", panel);

  // a little pitched roof to keep the snow off the paint (mostly)
  const roofPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const [lx, lz] = L((t - 0.5) * (MAP_W + 0.5), 0.34);
    roofPts.push(new THREE.Vector3(lx, baseY + 4.30 - Math.sin(t * Math.PI) * 0.10, lz));
  }
  const roofBack = roofPts.map((p) => p.clone());
  const roof = sweepProfile(roofPts, [[-0.44, -0.09], [0.50, 0.16], [0.46, 0.26], [-0.44, 0.01]], { uScale: 5 });
  put(bag, "timber", roof);
  put(bag, "snow", snowRidge(roofBack.map((p) => p.clone().setY(p.y + 0.22)), 0.72, 0.24, 0.62));

  for (const side of [-1, 1] as const) {
    const brace: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const [lx, lz] = L(side * (MAP_W / 2 - 0.30), 0.16 + t * 0.30);
      brace.push(new THREE.Vector3(lx, baseY + 3.55 + t * 0.72, lz));
    }
    put(bag, "iron", sweepProfile(brace, RECT(0.10, 0.10), { uScale: 2 }));
  }

  // a reading lamp over the map — a map board you cannot read at dusk is décor
  const [gx, gz] = L(0, 0.7);
  glows.push({ pos: [gx, baseY + 4.10, gz], color: PALETTE.lanternCore, size: 1.7, phase: 0.7, hesitate: 0 });
}

/* ---------------- balloons ---------------- */

/** One balloon: an egg with a pinched neck and a knot. */
function balloonGeometry(r: number, chip: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 12, 10);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const rnd = rng(seed);
  const squash = 0.96 + rnd() * 0.1;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ny = y / r;
    // pinch toward the knot: a balloon is a teardrop, never a ball
    const taper = ny < 0 ? 1 - Math.pow(-ny, 2.1) * 0.62 : 1 + (1 - ny) * 0.02;
    pos.setXYZ(i, x * taper * squash, y * 1.20 - (ny < 0 ? Math.pow(-ny, 3) * r * 0.28 : 0), z * taper * squash);
  }
  g.computeVertexNormals();
  uvBand(g, chip, CHIP_COLOURS.length);
  const knot = new THREE.ConeGeometry(r * 0.16, r * 0.30, 6);
  knot.translate(0, -r * 1.42, 0);
  uvBand(knot, chip, CHIP_COLOURS.length);
  return mergeGeometries([g, knot]);
}

function buildBalloonBunch(tie: [number, number, number], count: number, seed: number): BalloonBunch {
  const rnd = rng(seed);
  const skins: THREE.BufferGeometry[] = [];
  const strings: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + rnd() * 0.8;
    const lift = 1.9 + rnd() * 1.5;
    const spread = 0.30 + rnd() * 0.62;
    const bx = Math.cos(a) * spread;
    const bz = Math.sin(a) * spread;
    const r = 0.25 + rnd() * 0.10;

    const b = balloonGeometry(r, i % CHIP_COLOURS.length, seed + i * 17);
    b.rotateZ((rnd() - 0.5) * 0.35);
    b.rotateX((rnd() - 0.5) * 0.3);
    b.translate(bx, lift, bz);
    skins.push(b);

    // the string bellies out before it straightens — never a taut CG line
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(bx * 0.22 + (rnd() - 0.5) * 0.16, lift * 0.36, bz * 0.22),
      new THREE.Vector3(bx * 0.75, lift * 0.72, bz * 0.75),
      new THREE.Vector3(bx, lift - r * 1.5, bz),
    ]);
    strings.push(new THREE.TubeGeometry(curve, 12, 0.011, 4, false));
  }
  return {
    tie,
    skins: mergeGeometries(skins),
    strings: mergeGeometries(strings),
    sway: 0.07 + rnd() * 0.05,
    phase: rnd() * TAU,
  };
}

/* ---------------- the pool of warm light ---------------- */

/**
 * A disc of ground-glow draped over the real terrain, stretched INTO the park
 * so the eye is pulled through the opening rather than pinned to the arch.
 * The shader that fades it lives in `Gate.tsx`; the geometry carries the
 * radial falloff in its UVs (u = normalised radius, v = angle).
 */
function buildPool(): THREE.BufferGeometry {
  const RINGS = 11, SEGS = 46;
  const RX = 10.6, RZ = 9.0;
  const CZ = ARCH_Z - 1.1;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];

  for (let r = 0; r <= RINGS; r++) {
    const t = r / RINGS;
    for (let s = 0; s <= SEGS; s++) {
      const a = (s / SEGS) * TAU;
      // the pool leans into the park: a touch longer behind the arch
      const stretch = 1 + 0.26 * Math.max(0, -Math.sin(a));
      const lx = Math.cos(a) * RX * t;
      const lz = CZ + Math.sin(a) * RZ * t * stretch;
      pos.push(lx, gateGroundY(lx, lz) + 0.055, lz);
      uv.push(t, s / SEGS);
    }
  }
  for (let r = 0; r < RINGS; r++) {
    for (let s = 0; s < SEGS; s++) {
      const a = r * (SEGS + 1) + s, b = a + 1;
      const c = (r + 1) * (SEGS + 1) + s, d = c + 1;
      idx.push(a, b, c, b, d, c);   // wound so the disc faces UP
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ================================================================== */
/* 5 · THE BUILD                                                       */
/* ================================================================== */

/**
 * Build the whole gate once, merged down to one geometry per material.
 * Pure data — no React, no textures, no side effects beyond the terrain query.
 */
export function buildGate(): GateBuild {
  const bag: Bag = new Map();
  const glows: GateGlow[] = [];

  buildPost(bag, -1, 101);
  buildPost(bag, 1, 137);
  buildArch(bag, glows);
  buildLanternPost(bag, glows, -1, 5);
  buildLanternPost(bag, glows, 1, 9);
  buildBunting(bag, glows);
  buildTurnstile(bag, glows);
  buildMapBoard(bag, glows);

  // Tied where a child would tie them: the right lantern post, and the near
  // leg of the map board. They tug on their strings in `Gate.tsx`.
  const balloons: BalloonBunch[] = [
    buildBalloonBunch(
      [LANTERN_X - 0.30, gateGroundY(LANTERN_X, ARCH_Z) + 0.66, ARCH_Z + 0.28], 6, 771),
    buildBalloonBunch(
      [7.25, gateGroundY(7.25, 5.44) + 0.72, 5.44], 5, 913),
  ];

  const [tx, tz] = gateLocalToWorld(0, ARCH_Z);
  const [px, pz] = gateLocalToWorld(0, ARCH_Z - 1.9);
  const paaLocal: [number, number] = [-2.35, 0.5];
  const [pax, paz] = gateLocalToWorld(paaLocal[0], paaLocal[1]);

  const marks: GateMarks = {
    archCentre: new THREE.Vector3(tx, GATE_BASE_Y + ARCH.spring, tz),
    threshold: new THREE.Vector3(tx, GATE_BASE_Y + gateGroundY(0, ARCH_Z), tz),
    // straight off the spine, so the car's mark can never drift from the rails
    carMark: SPINE_CURVE.getPointAt(STOP_T.gate).clone(),
    paaMark: new THREE.Vector3(pax, GATE_BASE_Y + gateGroundY(paaLocal[0], paaLocal[1]), paz),
    // He is watching the path down into the park …
    paaFacingAway: GATE_YAW + Math.PI,
    // … then turns square to the gates and to whoever just walked through.
    paaFacingYou: GATE_YAW + Math.atan2(0 - paaLocal[0], ARCH_Z - paaLocal[1]),
    poolCentre: new THREE.Vector3(px, GATE_BASE_Y + gateGroundY(0, ARCH_Z - 1.9), pz),
  };

  return { parts: bake(bag), glows, balloons, pool: buildPool(), marks };
}

/**
 * A CAMERA THAT ACTUALLY SEES THE GATE.
 *
 * Advisory only — the camera rigs belong to someone else. But the harness's
 * `gate` rig stands nine metres inside the right-hand post, which frames the
 * path and not the arch, so this is the framing the sign was drawn for: far
 * enough back on the approach that the whole scalloped board reads, low
 * enough that the arch still towers.
 */
export const GATE_FRAMING = {
  position: [8.5, 3.6, 88] as [number, number, number],
  target: [3.4, 3.4, 64] as [number, number, number],
  fov: 42,
} as const;

/* ================================================================== */
/* 6 · THE ARRIVAL                                                     */
/* ================================================================== */

/**
 * Clamp to 0..1, and swallow NaN.
 *
 * The NaN arm is not defensive noise. These curves drive a yaw and a position
 * that are LERPED every frame; one NaN frame — a divide by a zero-length
 * sequence, a slider read before it is initialised — writes NaN into a
 * transform, and a NaN transform never recovers. ChessPaa disappears for the
 * rest of the session and the console says nothing.
 */
const clamp01 = (v: number) => (v > 0 ? (v > 1 ? 1 : v) : 0);

/** Re-normalise global t into a beat's own 0..1 window. */
function span(t: number, a: number, b: number): number {
  return clamp01((t - a) / (b - a));
}

const smooth = (u: number) => u * u * (3 - 2 * u);

/** Ease with a small overshoot — the thing that makes a motion feel alive. */
function overshoot(u: number, amount = 1.25): number {
  const p = 1 - u;
  return 1 + (amount + 1) * -p * p * p + amount * p * p;
}

/**
 * A damped spring settling to rest. Returns 0 (still moving) → 1 (settled),
 * ringing past 1 twice on the way, which is exactly what a little wooden car
 * on leaf springs does when it stops.
 */
function settle(u: number, rings = 2.6, decay = 5.2): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return 1 - Math.cos(u * Math.PI * rings) * Math.exp(-decay * u) * (1 - u * 0.35);
}

/**
 * THE OPENING BEAT, as four normalised curves.
 *
 * Feed it 0 → 1 over roughly eleven seconds. Nothing here touches the scene:
 * it is only the shape of the moment, so whoever wires the camera, ChessPaa
 * and the car can all read from the same clock and stay in step.
 *
 *   gateFade  0 → 1  How PRESENT the gates are. 0 = held back in the blue
 *                    dusk, lanterns low, sign unlit, the pool of light barely
 *                    there. 1 = full warmth. Drive lantern intensity, the
 *                    sign's emissive, the ground pool and the fairy-lights
 *                    with it. It leads everything else — the park lights up
 *                    BEFORE anybody moves.
 *
 *   paaTurn   0 → 1  ChessPaa turning to greet you. Lerp his yaw from
 *                    `marks.paaFacingAway` to `marks.paaFacingYou`, and lift
 *                    the lantern arm on the same value. It overshoots ~6%
 *                    near the end and comes back: DO NOT CLAMP IT, that
 *                    overshoot is the difference between a man turning and a
 *                    turntable rotating.
 *
 *   carSettle 0 → 1  The little wooden car coming to rest against its
 *                    springs. Rings past 1 twice, decaying. Use it on the
 *                    car's body bob (`y += (1 - carSettle) * 0.06`) and on a
 *                    small pitch, not on its position along the track.
 *
 *   roll      0 → 1  The forward roll off the gate platform, once the
 *                    greeting has landed. Heavy start (a real car has to
 *                    break stiction), then a long smooth pull. Map it onto
 *                    the spine: `t = STOP_T.gate + roll * <distance>`.
 *
 * Values outside 0..1 are clamped at the ends, so a driver can scrub freely.
 */
export function arrivalTimeline(t: number): {
  gateFade: number; paaTurn: number; carSettle: number; roll: number;
} {
  const u = clamp01(t);

  // 1 · the gates come up out of the dusk, slow then confident
  const gateFade = smooth(span(u, 0.00, 0.34)) ** 0.82;

  // 2 · he hears you, and turns
  const pt = span(u, 0.22, 0.58);
  const paaTurn = pt >= 1 ? 1 : Math.max(0, Math.min(1.08, overshoot(smooth(pt), 1.05)));

  // 3 · the car rocks and settles beside him
  const carSettle = settle(span(u, 0.30, 0.72));

  // 4 · and then, at last, forward
  const rr = span(u, 0.62, 1.0);
  const roll = rr * rr * (3 - 2 * rr) * (0.30 + 0.70 * rr);

  return { gateFade, paaTurn, carSettle, roll };
}

/**
 * The same beats, named — for a scrubber, a debug HUD, or anyone who needs to
 * fire a sound or a line of dialogue on the right frame.
 *
 * SORTED BY `at`, and it must stay that way: the obvious driver keeps a cursor
 * and fires every beat whose `at` the clock has just passed, so a single
 * out-of-order entry is silently never fired.
 */
export const ARRIVAL_BEATS: ReadonlyArray<{ at: number; name: string; note: string }> = [
  { at: 0.00, name: "the gates ahead", note: "dusk-blue, lanterns low; gateFade begins to climb" },
  { at: 0.20, name: "the lights find their nerve", note: "fairy-lights swell for the first time" },
  { at: 0.22, name: "he hears you", note: "paaTurn starts — the lantern swings first, then the shoulders" },
  { at: 0.34, name: "full warmth", note: "gateFade reaches 1; the pool of light is at its widest" },
  { at: 0.50, name: "the greeting", note: "paaTurn overshoots and rocks back — hold a beat here" },
  { at: 0.55, name: "the car arrives", note: "carSettle rings hardest; snow shakes off the roof" },
  { at: 0.62, name: "stiction", note: "roll leaves zero, painfully slowly" },
  { at: 0.72, name: "settled", note: "everything at rest; the longest breath in the sequence" },
  { at: 1.00, name: "away", note: "roll = 1; the gate is behind you and the valley is open" },
] as const;
