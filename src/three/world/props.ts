"use client";

import * as THREE from "three";
import { mergeGeometries, terrainHeight, riverDistance } from "./terrain";
import { rng } from "../core/textures/procedural";

/**
 * THE SET DRESSING — pines, lanterns, bunting, banks, booths.
 *
 * All built in code, all merged into a handful of geometries so the whole
 * park costs a handful of draw calls. Nothing here is a downloaded model.
 */

/* ------------------------------------------------------------------ */
/* PINES — the near-black wall that frames the valley                   */
/* ------------------------------------------------------------------ */

/** One stylised pine: stacked cones, deliberately chunky and cut-paper. */
function pineGeometry(h: number, r: number, tiers: number, seed: number): THREE.BufferGeometry {
  const rnd = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(r * 0.11, r * 0.15, h * 0.30, 5);
  trunk.translate(0, h * 0.15, 0);
  parts.push(trunk);
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const tierR = r * (1 - t * 0.62) * (0.9 + rnd() * 0.2);
    const tierH = (h * 0.82) / tiers * 1.55;
    const c = new THREE.ConeGeometry(tierR, tierH, 7);
    c.rotateY(rnd() * Math.PI);
    c.translate(0, h * 0.26 + t * h * 0.62 + tierH * 0.28, 0);
    parts.push(c);
  }
  return mergeGeometries(parts);
}

/** Snow caps that sit on the pine tiers — plush and rounded. */
function pineSnow(h: number, r: number, tiers: number, seed: number): THREE.BufferGeometry {
  const rnd = rng(seed + 991);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const tierR = r * (1 - t * 0.62) * (0.9 + rnd() * 0.2);
    const tierH = (h * 0.82) / tiers * 1.55;
    const cap = new THREE.ConeGeometry(tierR * 0.72, tierH * 0.42, 7);
    cap.translate(0, h * 0.26 + t * h * 0.62 + tierH * 0.62, 0);
    parts.push(cap);
  }
  return mergeGeometries(parts);
}

export interface ForestResult {
  trees: THREE.BufferGeometry;
  snow: THREE.BufferGeometry;
  /** Transform list for the far cut-paper billboards. */
  far: Array<{ x: number; z: number; y: number; s: number }>;
}

/**
 * Ring the valley with pines. Density rises toward the rim, so the eye reads
 * a dark wall closing the composition without the middle filling up.
 */
export function buildForest(seed = 42, count = 620): ForestResult {
  const rnd = rng(seed);
  const trees: THREE.BufferGeometry[] = [];
  const snows: THREE.BufferGeometry[] = [];
  const far: ForestResult["far"] = [];

  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 18) {
    const a = rnd() * Math.PI * 2;
    // bias outward — the rim is a wall, the middle is a park
    const rr = 46 + Math.pow(rnd(), 0.55) * 86;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;

    if (riverDistance(x, z) < 15) continue;          // keep the ice clear
    if (Math.hypot(x, z) < 40) continue;             // keep the plaza clear
    if (Math.hypot(x - 4, z - 64) < 20) continue;    // the entrance clearing
    // keep the coaster's big hill readable
    if (Math.hypot(x - 60, z + 72) < 26) continue;
    if (Math.hypot(x + 70, z + 60) < 22) continue;   // ferris clearing
    if (Math.hypot(x - 36, z - 30) < 16) continue;   // train clearing
    if (Math.hypot(x + 46, z + 24) < 18) continue;   // parade clearing

    const y = terrainHeight(x, z);
    // Reject steep ground: a pine planted on a 45-degree face reads as
    // half-buried, which is exactly how the valley rim looked before.
    const dx = terrainHeight(x + 2, z) - terrainHeight(x - 2, z);
    const dz = terrainHeight(x, z + 2) - terrainHeight(x, z - 2);
    if (Math.hypot(dx, dz) / 4 > 0.55) continue;
    const h = 6 + rnd() * 10;
    const r = 1.5 + rnd() * 1.6;
    const tiers = 3 + Math.floor(rnd() * 2);

    if (rr > 96) {
      // Far band: flat cut-paper billboards, cheap and graphic in the haze.
      far.push({ x, z, y, s: h * 0.75 });
    } else {
      const g = pineGeometry(h, r, tiers, seed + placed);
      g.translate(x, y, z);
      trees.push(g);
      if (rnd() > 0.25) {
        const s = pineSnow(h, r, tiers, seed + placed);
        s.translate(x, y, z);
        snows.push(s);
      }
    }
    placed++;
  }
  return {
    trees: trees.length ? mergeGeometries(trees) : new THREE.BufferGeometry(),
    snow: snows.length ? mergeGeometries(snows) : new THREE.BufferGeometry(),
    far,
  };
}

/* ------------------------------------------------------------------ */
/* LANTERN POLES — the warm practical lights the park is lit by         */
/* ------------------------------------------------------------------ */

export interface LanternSpot { x: number; y: number; z: number; }

/** Lantern poles ringing the plaza and lining the main paths. */
export function lanternPositions(): LanternSpot[] {
  const out: LanternSpot[] = [];
  // plaza ring
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const x = Math.cos(a) * 21, z = Math.sin(a) * 21;
    out.push({ x, y: terrainHeight(x, z), z });
  }
  // path to the gate
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const x = THREE.MathUtils.lerp(4, 4, t) + (i % 2 ? 3.4 : -3.4);
    const z = THREE.MathUtils.lerp(26, 62, t);
    out.push({ x, y: terrainHeight(x, z), z });
  }
  // path toward the parade
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const x = THREE.MathUtils.lerp(-16, -40, t);
    const z = THREE.MathUtils.lerp(-6, -20, t) + (i % 2 ? 2.8 : -2.8);
    out.push({ x, y: terrainHeight(x, z), z });
  }
  return out;
}

/** A lantern pole: post, curved arm, and the glass housing. */
export function buildLanternPoleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const post = new THREE.CylinderGeometry(0.075, 0.105, 3.5, 7);
  post.translate(0, 1.75, 0);
  parts.push(post);
  const collar = new THREE.CylinderGeometry(0.13, 0.13, 0.11, 8);
  collar.translate(0, 3.4, 0);
  parts.push(collar);
  const arm = new THREE.TorusGeometry(0.42, 0.045, 5, 9, Math.PI * 0.55);
  arm.rotateY(Math.PI / 2);
  arm.translate(0, 3.42, 0.0);
  parts.push(arm);
  const cap = new THREE.ConeGeometry(0.24, 0.24, 7);
  cap.translate(0.36, 3.62, 0);
  parts.push(cap);
  return mergeGeometries(parts);
}

/** The lantern's glowing glass housing — kept separate so it can be emissive. */
export function buildLanternGlassGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.155, 0.185, 0.32, 7);
  g.translate(0.36, 3.34, 0);
  return g;
}

/* ------------------------------------------------------------------ */
/* BUNTING — the sagging triangles that make it a FAIR                  */
/* ------------------------------------------------------------------ */

export interface BuntingRun {
  a: THREE.Vector3;
  b: THREE.Vector3;
  sag: number;
  flags: number;
}

export function buntingRuns(): BuntingRun[] {
  const runs: BuntingRun[] = [];
  const poles = lanternPositions().slice(0, 10);
  for (let i = 0; i < poles.length; i++) {
    const p0 = poles[i], p1 = poles[(i + 1) % poles.length];
    runs.push({
      a: new THREE.Vector3(p0.x, p0.y + 3.2, p0.z),
      b: new THREE.Vector3(p1.x, p1.y + 3.2, p1.z),
      sag: 1.35,
      flags: 9,
    });
  }
  return runs;
}

/**
 * Build one bunting run as a catenary of little triangles.
 * Returned as geometry plus the per-flag anchor data so a shader/frame loop
 * can ripple them.
 */
export function buildBuntingGeometry(runs: BuntingRun[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const run of runs) {
    for (let i = 0; i < run.flags; i++) {
      const t = (i + 0.5) / run.flags;
      const p = new THREE.Vector3().lerpVectors(run.a, run.b, t);
      // catenary sag
      p.y -= Math.sin(t * Math.PI) * run.sag;

      const g = new THREE.BufferGeometry();
      const w = 0.3, h = 0.42;
      g.setAttribute("position", new THREE.Float32BufferAttribute([
        -w, 0, 0, w, 0, 0, 0, -h, 0,
      ], 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2));
      g.setIndex([0, 1, 2]);
      g.computeVertexNormals();

      const dir = new THREE.Vector3().subVectors(run.b, run.a).normalize();
      const ang = Math.atan2(dir.x, dir.z);
      g.rotateY(ang);
      g.translate(p.x, p.y, p.z);
      parts.push(g);
    }
  }
  return parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
}

/** The cord the bunting hangs from. */
export function buildBuntingCordGeometry(runs: BuntingRun[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const run of runs) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const p = new THREE.Vector3().lerpVectors(run.a, run.b, t);
      p.y -= Math.sin(t * Math.PI) * run.sag;
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    parts.push(new THREE.TubeGeometry(curve, 14, 0.022, 4, false));
  }
  return parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
}

/* ------------------------------------------------------------------ */
/* FAIRY LIGHTS — instanced points strung between the poles             */
/* ------------------------------------------------------------------ */

export function fairyLightPositions(): Float32Array {
  const runs = buntingRuns();
  const out: number[] = [];
  for (const run of runs) {
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const p = new THREE.Vector3().lerpVectors(run.a, run.b, t);
      p.y -= Math.sin(t * Math.PI) * run.sag * 0.82;
      out.push(p.x, p.y - 0.08, p.z);
    }
  }
  return new Float32Array(out);
}

/* ------------------------------------------------------------------ */
/* THE PLAZA FLOOR — swept, warm, with a painted compass                */
/* ------------------------------------------------------------------ */

export function buildPlazaGeometry(radius = 24): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(radius, 48);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.18, 0);
  return g;
}
