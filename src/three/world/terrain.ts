"use client";

import * as THREE from "three";
import { rng } from "../core/textures/procedural";

/**
 * THE VALLEY — a warm little bowl cupped between pine-dark hills, with a
 * frozen river winding through its heart.
 *
 * All geometry generated in code. The ground is a displaced plane; the river
 * is carved into it by the same height function, so the ice always sits in a
 * real channel rather than being pasted on top.
 */

export const VALLEY = {
  size: 260,
  segments: 190,
  /** Plaza sits at the origin and is deliberately flat and walkable. */
  plazaRadius: 26,
};

/** The river's path through the valley, as a 2-D spline in XZ. */
export const RIVER_POINTS: Array<[number, number]> = [
  [-128, 78], [-92, 62], [-62, 52], [-34, 44],
  [-6, 40], [22, 34], [48, 22], [70, 4],
  [88, -18], [104, -44], [122, -74],
];

const riverCurve = new THREE.CatmullRomCurve3(
  RIVER_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
  false, "catmullrom", 0.5
);

/** Cached samples make the distance query cheap enough for a 190² grid. */
const RIVER_SAMPLES: THREE.Vector3[] = (() => {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 260; i++) pts.push(riverCurve.getPoint(i / 260));
  return pts;
})();

/** Distance from a point to the river centreline (XZ only). */
export function riverDistance(x: number, z: number): number {
  let best = Infinity;
  for (const p of RIVER_SAMPLES) {
    const dx = p.x - x, dz = p.z - z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

const RIVER_HALF_WIDTH = 12;

/**
 * THE HEIGHT FIELD.
 *
 * Deliberately gentle: this is a storybook valley, not a mountain range.
 * Rolling low hills, a flat plaza, pine-dark ridges rising at the rim, and a
 * carved channel where the river runs.
 */
export function terrainHeight(x: number, z: number): number {
  const r = Math.sqrt(x * x + z * z);

  // Rolling base — low frequency, soft.
  let h =
    Math.sin(x * 0.028) * 1.5 +
    Math.cos(z * 0.032) * 1.4 +
    Math.sin((x + z) * 0.016) * 2.1 +
    Math.sin(x * 0.061 + z * 0.043) * 0.7;

  // The rim rises into the pine walls that frame the valley. Deliberately
  // gentle and started far out: a quadratic wall here reads as a quarry and
  // buries the pines standing on it.
  const rim = Math.max(0, (r - 88) / 52);
  h += Math.pow(rim, 1.5) * 15;

  // The far hill the Tactics Coaster climbs (south-east).
  const hillD = Math.hypot(x - 64, z + 74);
  h += Math.max(0, 1 - hillD / 52) ** 2 * 17;

  // A gentler rise north-west for the Ferris wheel to stand against the sky.
  const nwD = Math.hypot(x + 72, z + 62);
  h += Math.max(0, 1 - nwD / 44) ** 2 * 7;

  // The plaza is flat, walkable, and blends out smoothly.
  const plazaT = 1 - THREE.MathUtils.smoothstep(r, VALLEY.plazaRadius * 0.55, VALLEY.plazaRadius);
  h = THREE.MathUtils.lerp(h, 0.15, plazaT);

  // Carve the river channel.
  const rd = riverDistance(x, z);
  if (rd < RIVER_HALF_WIDTH * 1.55) {
    // Flat channel floor out to the ice edge, then banks that turn over
    // quickly — the ice needs a real bed, not a shallow saucer.
    const t = THREE.MathUtils.smoothstep(rd, RIVER_HALF_WIDTH * 0.94, RIVER_HALF_WIDTH * 1.55);
    h = THREE.MathUtils.lerp(-3.1, h, t);
  }
  return h;
}

/** Ground level for placing props, clamped so nothing floats. */
export function groundAt(x: number, z: number): number {
  return terrainHeight(x, z);
}

export function isOnIce(x: number, z: number): boolean {
  return riverDistance(x, z) < RIVER_HALF_WIDTH;
}

/**
 * Build the valley mesh. Vertex colours carry the snow/ice/rock split so a
 * single draw call covers the whole ground and the toon ramp still reads.
 */
export function buildTerrainGeometry(): THREE.BufferGeometry {
  const { size, segments } = VALLEY;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * The frozen river surface — a separate ribbon mesh laid in the carved
 * channel, so the ice can take its own cool toon ramp and its own material.
 */
export function buildIceGeometry(): THREE.BufferGeometry {
  const STEPS = 220, ACROSS = 8;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const p = riverCurve.getPoint(t);
    const tan = riverCurve.getTangent(t).normalize();
    const nrm = new THREE.Vector3(-tan.z, 0, tan.x);

    // width breathes a little so the river never reads as a extruded tube
    const w = RIVER_HALF_WIDTH * (0.82 + Math.sin(t * 11.3) * 0.16 + Math.cos(t * 5.1) * 0.1);

    for (let j = 0; j <= ACROSS; j++) {
      const s = (j / ACROSS) * 2 - 1;
      const x = p.x + nrm.x * w * s;
      const z = p.z + nrm.z * w * s;
      // Ice sits just above the carved channel floor, dipping at the middle.
      const y = -2.62 + Math.cos(s * Math.PI * 0.5) * 0.06;
      positions.push(x, y, z);
      uvs.push(t * 14, (s * 0.5 + 0.5) * 1.6);
    }
  }
  const stride = ACROSS + 1;
  for (let i = 0; i < STEPS; i++) {
    for (let j = 0; j < ACROSS; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      // Winding matters: tangent x normal points DOWN for this ribbon, so the
      // obvious (a,c,b) order made every ice face back-facing and the whole
      // frozen river vanished under back-face culling. Wind it the other way.
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * PLUSH SNOW BANKS — rounded caps that sit along the river edges and against
 * buildings, so snow reads as deep and soft rather than a painted-on layer.
 */
export function buildSnowBanks(seed = 21): THREE.BufferGeometry {
  const r = rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 54; i++) {
    const t = r();
    const p = riverCurve.getPoint(t);
    const tan = riverCurve.getTangent(t);
    const nrm = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    const side = r() > 0.5 ? 1 : -1;
    const off = RIVER_HALF_WIDTH * (1.24 + r() * 0.55);
    const x = p.x + nrm.x * off * side;
    const z = p.z + nrm.z * off * side;
    // Keep banks inside the valley floor. Out on the rim the ground climbs
    // 20+ units and a bank there silhouettes as a floating dark stone.
    if (Math.hypot(x, z) > 84) continue;
    // The plaza is a swept, walkable clearing — a drift dumped in the middle
    // of it blocks the very view the plaza exists to give.
    if (Math.hypot(x, z) < 32) continue;
    const y = terrainHeight(x, z);
    if (y > 6) continue;

    const rad = 1.1 + r() * 2.3;
    const g = new THREE.SphereGeometry(rad, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.52);
    g.scale(1 + r() * 0.5, 0.34 + r() * 0.22, 1 + r() * 0.5);
    g.rotateY(r() * Math.PI);
    g.translate(x, y - 0.15, z);
    geos.push(g);
  }
  return mergeGeometries(geos);
}

/** Minimal merge so we don't pull in BufferGeometryUtils for one call. */
export function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  let vCount = 0, iCount = 0;
  for (const g of list) {
    vCount += g.getAttribute("position").count;
    iCount += g.index ? g.index.count : g.getAttribute("position").count;
  }
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);

  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    const u = g.getAttribute("uv");
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i); pos[(vo + i) * 3 + 1] = p.getY(i); pos[(vo + i) * 3 + 2] = p.getZ(i);
      if (n) { nrm[(vo + i) * 3] = n.getX(i); nrm[(vo + i) * 3 + 1] = n.getY(i); nrm[(vo + i) * 3 + 2] = n.getZ(i); }
      if (u) { uv[(vo + i) * 2] = u.getX(i); uv[(vo + i) * 2 + 1] = u.getY(i); }
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
      io += g.index.count;
    } else {
      for (let i = 0; i < p.count; i++) idx[io + i] = i + vo;
      io += p.count;
    }
    vo += p.count;
    g.dispose();
  }
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export { riverCurve };
