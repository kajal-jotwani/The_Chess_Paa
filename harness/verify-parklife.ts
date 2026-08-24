/**
 * PARK LIFE — INVARIANT CHECKS.
 *
 * Everything the "parklife" slice claims about itself, checked against the real
 * terrain, the real forest, the real props and the real cast. Pure maths, no
 * WebGL, so it runs anywhere:  npx tsx harness/verify-parklife.ts
 *
 * The numbers this prints are the numbers quoted in ParkLife.tsx's header and
 * in parkLifeData.ts's route comments. If one moves, one of the two is wrong.
 */
import * as THREE from "three";
import { terrainHeight, riverDistance, riverCurve } from "../src/three/world/terrain";
import { rng } from "../src/three/core/textures/procedural";
import { pieceGeometry, type PieceType } from "../src/three/core/geometry/pieces";
import { smoothNormalsForOutline } from "../src/three/core/materials/OutlineMaterial";
import { mergeGeometries } from "../src/three/world/terrain";
import {
  walkRoutes, sampleRoute, buildFolk, folkPose, buildCrows, crowPose,
  buildGlitterField, duskAt, GLITTER_BASE,
  type LifeQuality, type RoutePoint, type FolkPose, type CrowPose,
} from "../src/three/world/parkLifeData";

const log = (...a: unknown[]) => console.log(...a);
let failures = 0;
const check = (ok: boolean, label: string, detail: string) => {
  if (!ok) failures++;
  log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(46)} ${detail}`);
};

/* ---------- the world's own props, restated so we can test against them ---- */
const CAROUSEL = { x: 13, z: 5, r: 4.9 };             // Landmarks.CAROUSEL_CENTER, deck radius
const BIGTOP = { x: 0, z: -9, r: 10.45 };             // Landmarks.BIG_TOP_CENTER, TENT.radius + 1.05
const POLES: Array<[number, number]> = [];            // props.lanternPositions()
for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + 0.3; POLES.push([Math.cos(a) * 21, Math.sin(a) * 21]); }
for (let i = 0; i < 7; i++) POLES.push([4 + (i % 2 ? 3.4 : -3.4), THREE.MathUtils.lerp(26, 62, i / 6)]);
for (let i = 0; i < 5; i++) POLES.push([THREE.MathUtils.lerp(-16, -40, i / 4), THREE.MathUtils.lerp(-6, -20, i / 4) + (i % 2 ? 2.8 : -2.8)]);
const SIGNS: Array<[number, number]> = [[6.5, 26], [-11, -6], [12, 8], [-50, -28], [14, -9]];  // paths.signposts()

/** The ice ribbon buildIceGeometry actually lays: breathing half-width. */
const ICE: Array<{ x: number; z: number; w: number }> = (() => {
  const out: Array<{ x: number; z: number; w: number }> = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= 220; i++) {
    const t = i / 220;
    riverCurve.getPoint(t, p);
    out.push({ x: p.x, z: p.z, w: 12 * (0.82 + Math.sin(t * 11.3) * 0.16 + Math.cos(t * 5.1) * 0.1) });
  }
  return out;
})();
function iceInset(x: number, z: number): number {
  let best = Infinity, w = 0;
  for (const s of ICE) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < best) { best = d; w = s.w; } }
  return w - Math.sqrt(best);
}

/* ================================================================== *
 * 1 · CROW PERCHES ARE REAL TREETOPS                                  *
 * ================================================================== */
/** buildForest(42)'s placement loop, replayed to recover each pine's apex. */
function forestTrees(seed = 42, count = 620) {
  const rnd = rng(seed);
  const out: Array<{ x: number; z: number; apex: number; far: boolean }> = [];
  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 18) {
    const a = rnd() * Math.PI * 2;
    const rr = 46 + Math.pow(rnd(), 0.55) * 86;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (riverDistance(x, z) < 15) continue;
    if (Math.hypot(x, z) < 40) continue;
    if (Math.hypot(x - 4, z - 64) < 20) continue;
    if (Math.hypot(x - 60, z + 72) < 26) continue;
    if (Math.hypot(x + 70, z + 60) < 22) continue;
    if (Math.hypot(x - 36, z - 30) < 16) continue;
    if (Math.hypot(x + 46, z + 24) < 18) continue;
    const y = terrainHeight(x, z);
    const h = 6 + rnd() * 10, r = 1.5 + rnd() * 1.6, tiers = 3 + Math.floor(rnd() * 2);
    const far = rr > 96;
    let apex = 0;
    if (!far) {
      const inner = rng(seed + placed);
      let top = 0;
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        inner(); inner();                                  // tierR jitter, rotateY
        const tierH = (h * 0.82) / tiers * 1.55;
        top = h * 0.26 + t * h * 0.62 + tierH * 0.78;
      }
      apex = y + top;
      rnd();                                               // snow-cap coin flip
    }
    out.push({ x, z, apex, far });
    placed++;
  }
  return out;
}

log("\n=== 1 · CROW PERCHES vs buildForest(42) ===");
{
  const trees = forestTrees();
  let worstD = 0, worstApex = 0, allReal = true;
  for (const c of buildCrows("high")) {
    // buildCrows offsets the written-down apex by (+0.22, -0.85, +0.16)
    const px = c.perch[0] - 0.22, pz = c.perch[2] - 0.16, apex = c.perch[1] + 0.85;
    let best = { d: Infinity, apex: 0, far: false };
    for (const t of trees) { const d = Math.hypot(t.x - px, t.z - pz); if (d < best.d) best = { d, apex: t.apex, far: t.far }; }
    worstD = Math.max(worstD, best.d);
    worstApex = Math.max(worstApex, Math.abs(best.apex - apex));
    if (best.far) allReal = false;
  }
  check(worstD < 0.02, "every perch sits on a real pine", `worst offset ${worstD.toFixed(4)} m`);
  check(worstApex < 0.02, "every perch height matches its treetop", `worst error ${worstApex.toFixed(4)} m`);
  check(allReal, "no perch is on a far cut-paper billboard", `${trees.filter(t => !t.far).length} real cones of ${trees.length}`);
}

/* ================================================================== *
 * 2 · FOLK STAND ON THE PARK                                          *
 * ================================================================== */
log("\n=== 2 · FOLK GROUNDING (high) ===");
{
  const routes = walkRoutes();
  const folk = buildFolk("high");
  const rp: RoutePoint = { x: 0, y: 0, z: 0, yaw: 0, slope: 0, ice: 0 };
  let sunk = 0, air = 0, total = 0, worstSink = 0, worstAir = 0;
  for (const f of folk) {
    const route = routes[f.route];
    for (let i = 0; i < 4000; i++, total++) {
      sampleRoute(route, i / 4000, f.lane, rp);
      const g = terrainHeight(rp.x, rp.z);
      const inset = iceInset(rp.x, rp.z);
      const floor = inset > 0 ? Math.max(g, -2.62) : g;
      if (rp.y - floor < -0.02) { sunk++; worstSink = Math.min(worstSink, rp.y - floor); }
      if (inset <= 0 && rp.y > g + 0.35) { air++; worstAir = Math.max(worstAir, rp.y - g); }
    }
  }
  // The ice edge is a real half-metre lip; one 0.5m sample straddles it.
  check(sunk / total < 0.003, "folk are not in the ground", `${sunk}/${total} samples, worst ${worstSink.toFixed(3)} m`);
  check(air / total < 0.003, "folk are not standing on air", `${air}/${total} samples, worst ${worstAir.toFixed(3)} m`);

  let maxStep = 0, maxYaw = 0, back = 0;
  const pose: FolkPose = { s: 0, moving: 1, dwellPhase: 0 };
  for (const f of folk) {
    const route = routes[f.route];
    const cycle = route.length / f.speed + f.dwells.reduce((a, d) => a + d.secs, 0);
    let px = 0, py = 0, pz = 0, ps = 0, pyaw = 0, first = true;
    for (let t = 0; t < cycle * 2; t += 1 / 60) {
      folkPose(f, route, t, pose);
      sampleRoute(route, pose.s, f.lane, rp);
      if (!first) {
        maxStep = Math.max(maxStep, Math.hypot(rp.x - px, rp.y - py, rp.z - pz));
        let d = rp.yaw - pyaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        maxYaw = Math.max(maxYaw, Math.abs(d));
        let ds = pose.s - ps; if (ds < -0.5) ds += 1;
        if (ds < -1e-9) back++;
      }
      px = rp.x; py = rp.y; pz = rp.z; ps = pose.s; pyaw = rp.yaw; first = false;
    }
  }
  check(back === 0, "nobody ever walks backwards", `${back} reversals`);
  check(maxStep < 0.12, "no per-frame jump", `worst ${maxStep.toFixed(3)} m/frame (gait max is 0.033)`);
  log(`  NOTE  outer-lane folk sweep ${maxStep.toFixed(3)} m/frame and ${(maxYaw * 180 / Math.PI).toFixed(1)} deg/frame`);
  log(`        through the U-turn caps — the stride is driven by centreline`);
  log(`        distance, so those few frames DO foot-skate.`);
}

/* ================================================================== *
 * 3 · FOLK DO NOT WALK THROUGH THE PARK                               *
 * ================================================================== */
log("\n=== 3 · PROP CLEARANCE (high) ===");
{
  const routes = walkRoutes();
  const rp: RoutePoint = { x: 0, y: 0, z: 0, yaw: 0, slope: 0, ice: 0 };
  let inCar = 0, inTop = 0, minPole = Infinity, minSign = Infinity, worstPole = "";
  for (const f of buildFolk("high")) {
    const route = routes[f.route];
    for (let i = 0; i < 3000; i++) {
      sampleRoute(route, i / 3000, f.lane, rp);
      if (Math.hypot(rp.x - CAROUSEL.x, rp.z - CAROUSEL.z) < CAROUSEL.r) inCar++;
      if (Math.hypot(rp.x - BIGTOP.x, rp.z - BIGTOP.z) < BIGTOP.r) inTop++;
      for (const [lx, lz] of POLES) {
        const d = Math.hypot(rp.x - lx, rp.z - lz);
        if (d < minPole) { minPole = d; worstPole = `(${lx.toFixed(1)}, ${lz.toFixed(1)})`; }
      }
      for (const [sx, sz] of SIGNS) minSign = Math.min(minSign, Math.hypot(rp.x - sx, rp.z - sz));
    }
  }
  check(inCar === 0, "nobody walks onto the carousel deck", `${inCar} samples inside r${CAROUSEL.r}`);
  check(inTop === 0, "nobody walks into the big top", `${inTop} samples inside r${BIGTOP.r}`);
  check(minPole > 0.4, "nobody walks through a lamp post", `worst ${minPole.toFixed(3)} m at ${worstPole}`);
  check(minSign > 0.4, "nobody walks through a signpost", `worst ${minSign.toFixed(3)} m`);
  log(`  NOTE  the two failures above are upstream: props.ts plants poles and`);
  log(`        signposts on the paths.ts ribbon centrelines. See the WALKWAY`);
  log(`        comment in parkLifeData.ts.`);
}

/* ================================================================== *
 * 4 · CROWS                                                           *
 * ================================================================== */
log("\n=== 4 · CROWS ===");
{
  const crows = buildCrows("high");
  const p: CrowPose = { x: 0, y: 0, z: 0, yaw: 0, roll: 0, pitch: 0, flap: 0, fold: 1, perched: true };
  let peak = 0, minClear = Infinity, jumps = 0;
  for (const c of crows) {
    let px = 0, py = 0, pz = 0, first = true;
    for (let t = 0; t < c.period + 1; t += 1 / 60) {
      crowPose(c, t, p);
      if (!p.perched) minClear = Math.min(minClear, p.y - terrainHeight(p.x, p.z));
      if (!first) {
        const v = Math.hypot(p.x - px, p.y - py, p.z - pz) * 60;
        peak = Math.max(peak, v);
        if (v > 30) jumps++;
      }
      px = p.x; py = p.y; pz = p.z; first = false;
    }
  }
  check(peak < 20, "no crow flies faster than a crow", `peak ${peak.toFixed(1)} m/s`);
  check(minClear > 8, "no crow clips the ground", `min clearance ${minClear.toFixed(2)} m`);
  check(jumps === 0, "flight path is continuous", `${jumps} discontinuities`);
}

/* ================================================================== *
 * 5 · GLITTER                                                         *
 * ================================================================== */
log("\n=== 5 · GLITTER ===");
for (const [label, n] of [["high", 1280], ["medium", 880], ["low", 480]] as Array<[string, number]>) {
  const f = buildGlitterField(n);
  let cold = 0, buried = 0;
  for (let i = 0; i < f.count; i++) {
    const x = f.position[i * 3], y = f.position[i * 3 + 1], z = f.position[i * 3 + 2];
    if (f.cold[i] > 0.5) cold++;
    const floor = iceInset(x, z) > 0 ? Math.min(terrainHeight(x, z), -2.62) : terrainHeight(x, z);
    if (y < floor - 1e-6) buried++;
  }
  check(f.count === n && buried === 0, `${label}: full field, nothing buried`,
    `${f.count}/${n} motes, ${buried} buried, ${(cold / f.count * 100).toFixed(1)}% over the ice`);
}

/* ================================================================== *
 * 6 · DUSK                                                            *
 * ================================================================== */
log("\n=== 6 · DUSK ===");
{
  let mono = true, prev = -1;
  for (let s = 0; s <= 1200; s += 0.5) { const v = duskAt(s); if (v < prev - 1e-12) mono = false; prev = v; }
  check(mono, "light never goes backwards", "monotonic over 20 minutes");
  check(duskAt(0) === 0 && duskAt(840) === 1 && duskAt(9e9) === 1 && duskAt(-5) === 0,
    "0 at the start, 1 at the deadline, holds", `${duskAt(0)} .. ${duskAt(840)} .. ${duskAt(9e9)}`);
}

/* ================================================================== *
 * 7 · THE BILL                                                        *
 * ================================================================== */
log("\n=== 7 · DRAW CALLS AND TRIANGLES (the header table) ===");
{
  const tris = (g: THREE.BufferGeometry) => (g.getIndex() ? g.getIndex()!.count : g.getAttribute("position").count) / 3;
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.SphereGeometry(0.13, 8, 6); body.scale(0.82, 0.76, 1.85); parts.push(body);
  const head = new THREE.SphereGeometry(0.085, 7, 5); head.scale(1, 0.96, 1.1); head.translate(0, 0.07, 0.21); parts.push(head);
  const beak = new THREE.ConeGeometry(0.036, 0.14, 4); beak.rotateX(Math.PI / 2); beak.translate(0, 0.055, 0.31); parts.push(beak);
  const tail = new THREE.BoxGeometry(0.15, 0.02, 0.30); tail.translate(0, -0.01, -0.31); parts.push(tail);
  for (const side of [-1, 1]) {
    const g = new THREE.BufferGeometry();
    const xi = side * 0.07, xo = side * 0.47;
    g.setAttribute("position", new THREE.Float32BufferAttribute([xi, 0.02, 0.13, xo, 0.05, 0.02, xo, 0.05, -0.17, xi, 0.02, -0.15], 3));
    g.setIndex(side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
    parts.push(g);
  }
  const crowTris = tris(mergeGeometries(parts));

  const expected: Record<LifeQuality, [number, number]> = { high: [18, 61738], medium: [15, 14228], low: [6, 2932] };
  for (const q of ["high", "medium", "low"] as LifeQuality[]) {
    const folk = buildFolk(q), crows = buildCrows(q);
    const byType = new Map<PieceType, number>();
    folk.forEach(f => byType.set(f.type, (byType.get(f.type) ?? 0) + 1));
    let t = 0, main = 0, shadow = 0;
    for (const [type, n] of byType) {
      const g = pieceGeometry(type, q === "high" ? "high" : "low").clone();
      t += tris(g) * n; main += 1;
      if (q !== "low") { t += tris(smoothNormalsForOutline(g)) * n + tris(g) * n; main += 1; shadow += 1; }
    }
    t += crowTris * crows.length;
    main += 2 + (folk.some(f => f.lantern) ? 1 : 0);      // crows, glitter, lanterns
    const [ec, et] = expected[q];
    check(main + shadow === ec && t === et, `${q}: header table is honest`,
      `${main}+${shadow} = ${main + shadow} calls (says ${ec}), ${t} tris (says ${et})`);
  }
}

log(`\n${failures === 0 ? "ALL CHECKS PASS" : `${failures} CHECK(S) FAILED`}\n`);
