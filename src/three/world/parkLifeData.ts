"use client";

import * as THREE from "three";
import { PALETTE, mix } from "../core/palette";
import { rng } from "../core/textures/procedural";
import { terrainHeight, riverDistance, riverCurve } from "./terrain";
import type { PieceType } from "../core/geometry/pieces";

/**
 * THE PARK IS NEVER STILL — the authored data behind its ambient life.
 *
 * Everything here is pure data and pure maths: routes, casts, schedules and
 * closed-form poses. No React, no three.js objects that need a frame loop.
 * ParkLife.tsx turns it into instanced meshes.
 *
 * Two rules hold the whole file together:
 *
 *   IT IS DETERMINISTIC. Every wanderer, every crow, every mote comes from
 *   `rng(seed)`. The park looks identical on every run, which is the only way
 *   a screenshot harness can tell a regression from a coin flip.
 *
 *   POSE IS A PURE FUNCTION OF TIME. Nothing integrates, nothing accumulates,
 *   nothing drifts. Ask where a folk is at t=812.4s and you get the same answer
 *   whether the tab was backgrounded for ten minutes or not — no rubber-banding
 *   after a stall, and the harness can pose the whole park at a chosen instant.
 */

export type LifeQuality = "low" | "medium" | "high";

/** Cast tiers: 0 shows at every quality, 2 only at high. */
type Tier = 0 | 1 | 2;

function tierCap(q: LifeQuality): Tier {
  return q === "low" ? 0 : q === "medium" ? 1 : 2;
}

const TAU = Math.PI * 2;

/* ================================================================== *
 * 1 · WALK ROUTES — the shapes of the walkways, made walkable          *
 * ================================================================== */

export type RouteName = "gate" | "promenade" | "parade" | "train" | "ferris" | "coaster";

export const ROUTE_NAMES: RouteName[] = ["gate", "promenade", "parade", "train", "ferris", "coaster"];

/**
 * THE CENTRELINES.
 *
 * Five of the six follow a ribbon in `paths.ts` — deliberately, because folk
 * who walk beside the trodden path instead of along it read as broken.
 * `paths.ts` keeps its ROUTES private, so the shapes are restated here; if a
 * walkway there is ever re-authored, these must move with it.
 *
 * WHERE THEY DIFFER FROM `paths.ts`, AND WHY:
 *   · promenade — has no ribbon at all. It is an authored loop round the north
 *                 of the plaza, on open snow, because the plaza needs somebody
 *                 crossing it and no walkway does that. If a ribbon is ever
 *                 laid there, move this onto it.
 *   · gate      — the ribbon's (4,62)…(0,20); extended out to the gate itself
 *                 and on into the plaza, so folk arrive from somewhere and go
 *                 somewhere.
 *   · train     — the ribbon starts at (9,6), inside the carousel's 4.9m deck
 *                 at (13,5). Folk join it clear of the ride.
 *   · parade,
 *     ferris    — the ribbon starts at (-8,-4), which is 9.4m from (0,-9) and
 *                 therefore ON the big top's 10.45m boarded deck. Folk start
 *                 further out and turn around clear of the canvas.
 *   · ferris    — is the parade ribbon and the wheel ribbon walked as one leg,
 *                 because that is how a body would walk it.
 *   · coaster   — the ribbon starts at (10,-6), also on the big top's deck.
 *
 * SEVEN POSTS STAND IN THE WALKWAYS, AND NOTHING HERE CAN MOVE THEM.
 *
 * `lanternPositions()` in `props.ts` lines the gate and parade avenues by
 * lerping a STRAIGHT line and offsetting each pole in z alone — but `paths.ts`
 * sweeps a Catmull-Rom curve, and the gate walk runs nearly along z, so an
 * offset in z slides the pole ALONG the path instead of beside it. Measured
 * against the ribbon centrelines: gate poles at (0.60,26), (0.60,38) and
 * (0.60,50) sit 0.17m, 0.63m and 1.39m from the centre of a 4.2m ribbon;
 * parade poles at (-16,-8.8) and (-28,-15.8) sit 0.75m and 1.27m from the
 * centre of a 3.4m one; the plaza-ring pole at (0.30,21.00) is 0.23m off the
 * gate ribbon; and the ferris signpost from `signposts()` stands at (-50,-28),
 * which is exactly ON the wheel ribbon's own centreline.
 *
 * Folk walking their own path therefore walk through posts — worst case 0.01m
 * from a lamp post on the promenade and 0.23m from that signpost. Bending the
 * routes round them from here would only take the folk OFF the trodden path,
 * which reads worse than clipping a pole. THE FIX BELONGS IN `props.ts`: offset
 * each avenue pole and signpost along the path NORMAL, and check the clearance.
 * Until then this is a known, visible defect and it is not fixable from here.
 */
const WALKWAY: Record<RouteName, Array<[number, number]>> = {
  // The first walk a child ever takes here, and the one folk take all evening.
  gate: [[4, 67], [4, 62], [2, 50], [1, 34], [0, 20], [-1, 13]],
  // A stroll round the north of the plaza: past the candy barrow, the ticket
  // booth and the carousel steps. It threads BETWEEN the big top (0,-9 r10.45),
  // the board at the origin, the carousel deck (13,5 r4.9) and the lantern ring
  // at r=21 — the only lane the plaza actually leaves open.
  promenade: [[-16, -3], [-17, 7], [-13, 16], [-4, 20], [5, 19], [9, 14], [7.4, 10.4]],
  // Starts clear of the big top's deck, then joins the parade ribbon.
  parade: [[-12.6, -1.2], [-20, -10], [-33, -17], [-44, -22], [-46.5, -24.5]],
  train: [[6.6, 10.4], [14.8, 13.2], [20, 15], [30, 24], [36, 29]],
  // The long one: plaza → parade → the wheel. Somebody is always walking it.
  ferris: [[-12.6, -1.2], [-20, -10], [-33, -17], [-44, -22], [-48, -26], [-58, -36], [-66, -48], [-70, -58]],
  coaster: [[12, -5], [26, -20], [42, -40], [56, -60], [62, -71]],
};

/**
 * Lateral spread, and the reason it is smaller than the ribbon is wide.
 *
 * This number is spent TWICE: `outAndBackLoop` offsets the out and back legs by
 * 0.62 of it, and every folk then sits up to 0.96 of it further out again. So
 * the widest a folk ever walks from the centreline is about 1.6 x this — which
 * is what has to stay inside the ribbon, not this number itself. The ribbons
 * are 4.2m (gate) and 3.0–3.4m (the rest), so half-widths of 2.1 and 1.5–1.7.
 */
const LANE_HALF: Record<RouteName, number> = {
  gate: 1.2, promenade: 1.0, parade: 0.95, train: 0.95, ferris: 0.9, coaster: 0.85,
};

export interface WalkRoute {
  name: RouteName;
  /**
   * Packed samples, stride 8: x, y, z, yaw, slope, yRight, ice, yLeft.
   * Arc-length uniform. `yRight`/`yLeft` are the standing heights one full
   * lane to either side, so a folk walking wide still touches the ground; `ice`
   * is 1 where the route is out on the frozen river.
   */
  data: Float32Array;
  count: number;
  /** Loop length in world units. */
  length: number;
  /** Usable lateral offset either side of the centreline. */
  lane: number;
}

const STRIDE = 8;

/**
 * WALKING ON THE RIVER.
 *
 * The gate walk and the train walk both cross the frozen river — there is no
 * bridge in this park, and the ribbon in `paths.ts` simply follows the ground
 * down into the channel. Left alone, folk wade through the ice with their
 * knees under the surface. Those two loops spend about 44% of their length in
 * the river channel and 23% and 27% of it actually on the ice, so this is not
 * an edge case: it is most of the first walk a child takes.
 *
 * So on the river they stand on the ICE. `buildIceGeometry` crowns its ribbon,
 * -2.56 down the middle and -2.62 at the two edges, so -2.56 is the height to
 * stand on: it is never below the surface anywhere.
 *
 * AND THE ICE IS NOT A FIXED-WIDTH STRIP. `buildIceGeometry` breathes its
 * half-width between 6.7m and 13.0m so the river never reads as an extruded
 * tube, while `terrainHeight` carves a FLAT channel bed out to 11.3m either
 * side. Testing against a constant edge therefore stood folk on bare river bed
 * with the ice several metres away — 37% of every ice crossing, up to 0.62m in
 * the air. So we ask where the ice actually is.
 */
const ICE_WALK_Y = -2.56;
/** Matches `buildIceGeometry`'s STEPS, so we sample the ribbon it really laid. */
const ICE_STEPS = 220;
const RIVER_HALF_WIDTH = 12;

/** The ice ribbon's centreline and its real, breathing half-width. */
const ICE_RIBBON: Array<{ x: number; z: number; w: number }> = (() => {
  const out: Array<{ x: number; z: number; w: number }> = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= ICE_STEPS; i++) {
    const t = i / ICE_STEPS;
    riverCurve.getPoint(t, p);
    // The same expression `buildIceGeometry` sweeps. If that one is re-authored
    // this must follow it, or folk go back to walking on air.
    const w = RIVER_HALF_WIDTH * (0.82 + Math.sin(t * 11.3) * 0.16 + Math.cos(t * 5.1) * 0.1);
    out.push({ x: p.x, z: p.z, w });
  }
  return out;
})();

/** Metres INSIDE the ice ribbon. Positive on the ice, negative off it. */
function iceInset(x: number, z: number): number {
  let best = Infinity;
  let w = 0;
  for (const s of ICE_RIBBON) {
    const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
    if (d < best) { best = d; w = s.w; }
  }
  return w - Math.sqrt(best);
}

/**
 * Turn a one-way walkway into a LOOP by walking out on one side of the path
 * and back on the other, with a rounded turn at each end.
 *
 * This is not a trick to save geometry — it is how people actually use a path.
 * Two lanes moving in opposite directions is what makes a walkway read as busy
 * rather than as a conveyor belt, and the U-turns put a folk broadside to the
 * camera twice a lap, which is when their silhouette reads best.
 */
function outAndBackLoop(shape: Array<[number, number]>, lane: number): THREE.Vector3[] {
  const n = shape.length;
  const right: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = shape[Math.max(0, i - 1)];
    const b = shape[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    // Right of travel for yaw = atan2(dx, dz): rotate the tangent -90° in XZ.
    right.push([dz / len, -dx / len]);
  }

  const pts: THREE.Vector3[] = [];
  const push = (x: number, z: number) => pts.push(new THREE.Vector3(x, 0, z));

  for (let i = 0; i < n; i++) push(shape[i][0] + right[i][0] * lane, shape[i][1] + right[i][1] * lane);

  // Rounded turn at the far end: step past the last point, swing across, come back.
  const capAt = (i: number, dir: 1 | -1) => {
    const p = shape[i];
    const r = right[i];
    // forward is right rotated +90°
    const fx = -r[1] * dir, fz = r[0] * dir;
    const d = lane * 0.85;
    push(p[0] + r[0] * lane + fx * d, p[1] + r[1] * lane + fz * d);
    push(p[0] + fx * (d + lane * 0.75), p[1] + fz * (d + lane * 0.75));
    push(p[0] - r[0] * lane + fx * d, p[1] - r[1] * lane + fz * d);
  };
  capAt(n - 1, 1);
  for (let i = n - 1; i >= 0; i--) push(shape[i][0] - right[i][0] * lane, shape[i][1] - right[i][1] * lane);
  capAt(0, -1);

  return pts;
}

let ROUTE_CACHE: WalkRoute[] | null = null;

/**
 * Build (and cache) every walk route, with GROUND HEIGHT BAKED IN.
 *
 * Baking matters more than it looks: `terrainHeight` walks 261 river samples
 * per call, and a folk asking for its ground height every frame would spend
 * more time on the terrain than on everything else in this file combined.
 * Routes never move, so we pay once at build and lerp thereafter.
 *
 * TWO SAMPLES A METRE, and the U-turns are why. Between samples the folk walks
 * a straight chord, and a chord across the tight turn at the top of the coaster
 * — which is cut into a hillside that climbs a metre for every metre sideways —
 * cuts the corner right through the snow. At 1.25m spacing that buried a folk
 * 0.31m; at 0.5m it is 0.04m, which is under the ankle. The whole build costs
 * about 50ms against the 160ms `buildForest` already spends, and it happens
 * once.
 */
export function walkRoutes(): WalkRoute[] {
  if (ROUTE_CACHE) return ROUTE_CACHE;

  ROUTE_CACHE = ROUTE_NAMES.map((name) => {
    const lane = LANE_HALF[name];
    const loop = outAndBackLoop(WALKWAY[name], lane * 0.62);
    // Centripetal keeps the tight U-turns from overshooting into the snow the
    // way a uniform catmullrom does when segment lengths differ this much.
    const curve = new THREE.CatmullRomCurve3(loop, true, "centripetal", 0.5);
    const rough = curve.getLength();
    const count = Math.min(1400, Math.max(96, Math.round(rough * 2.0)));

    // getSpacedPoints returns count+1 arc-length-uniform points on a closed
    // loop, the last of which repeats the first — drop it.
    const spaced = curve.getSpacedPoints(count);
    const data = new Float32Array(count * STRIDE);

    /** Standing height at a point: the ground, or the ice if we are on it. */
    const stand = (x: number, z: number): { y: number; ice: number } => {
      const g = terrainHeight(x, z);
      // On the ice, stand on it; off it, stand on the bed the terrain carved.
      // No ramp between the two, tempting as it is: the ice ribbon's edge IS
      // about half a metre above the channel floor and `buildSnowBanks` puts
      // its drifts 15-21m out, so there is nothing there to ramp up. Better a
      // folk steps up onto the ice like a kerb than floats over a gap.
      if (iceInset(x, z) <= 0) return { y: g, ice: 0 };
      const y = Math.max(g, ICE_WALK_Y);
      return { y, ice: y > g + 0.02 ? 1 : 0 };
    };

    for (let i = 0; i < count; i++) {
      const p = spaced[i];
      const s = stand(p.x, p.z);
      data[i * STRIDE] = p.x;
      data[i * STRIDE + 1] = s.y + 0.08; // stand ON the ribbon, not in it
      data[i * STRIDE + 2] = p.z;
      data[i * STRIDE + 6] = s.ice;
    }
    // Yaw and slope from the neighbours, so both stay smooth through the turns.
    const step = rough / count;
    for (let i = 0; i < count; i++) {
      const a = (i - 1 + count) % count, b = (i + 1) % count;
      const dx = data[b * STRIDE] - data[a * STRIDE];
      const dz = data[b * STRIDE + 2] - data[a * STRIDE + 2];
      const yaw = Math.atan2(dx, dz);
      data[i * STRIDE + 3] = yaw;
      data[i * STRIDE + 4] = (data[b * STRIDE + 1] - data[a * STRIDE + 1]) / (2 * step);

      // THE LANE HEIGHTS. Lanes sit up to a metre off the centreline, and on
      // the climb to the coaster that is most of a metre of height — the
      // difference between a folk on the hill and a folk hovering beside it.
      //
      // Bake the real standing height at BOTH lane edges rather than a sideways
      // gradient. A gradient has to be extrapolated, and it has a direction, so
      // interpolating it through the 50-degrees-per-sample yaw swing of a
      // U-turn is meaningless — which is how a folk ended up 0.3m inside the
      // coaster hillside. Two absolute heights interpolate honestly.
      const cx = data[i * STRIDE], cz = data[i * STRIDE + 2];
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      data[i * STRIDE + 5] = stand(cx + rx * lane, cz + rz * lane).y + 0.08;
      data[i * STRIDE + 7] = stand(cx - rx * lane, cz - rz * lane).y + 0.08;
    }
    return { name, data, count, length: rough, lane };
  });

  return ROUTE_CACHE;
}

export function routeIndex(name: RouteName): number {
  return ROUTE_NAMES.indexOf(name);
}

export interface RoutePoint {
  x: number; y: number; z: number;
  /** Heading in radians, three's yaw convention (0 faces +Z). */
  yaw: number;
  /** Rise over run along the route — used to lean folk into a climb. */
  slope: number;
  /** 1 where this stretch crosses the frozen river. */
  ice: number;
}

/** Sample a route at s ∈ [0,1), offset `lane` metres to the right of travel. */
export function sampleRoute(route: WalkRoute, s: number, lane: number, out: RoutePoint): RoutePoint {
  const n = route.count;
  const f = (((s % 1) + 1) % 1) * n;
  const i = Math.floor(f) % n;
  const j = (i + 1) % n;
  const k = f - Math.floor(f);
  const d = route.data;
  const a = i * STRIDE, b = j * STRIDE;

  const x = d[a] + (d[b] - d[a]) * k;
  const y = d[a + 1] + (d[b + 1] - d[a + 1]) * k;
  const z = d[a + 2] + (d[b + 2] - d[a + 2]) * k;

  // Yaw is an angle: lerp it the short way round or a folk spins on the seam.
  const ya = d[a + 3];
  let dy = d[b + 3] - ya;
  if (dy > Math.PI) dy -= TAU; else if (dy < -Math.PI) dy += TAU;
  const yaw = ya + dy * k;

  out.yaw = yaw;
  out.x = x + Math.cos(yaw) * lane;
  out.z = z - Math.sin(yaw) * lane;
  // Follow the ground sideways as well as forwards: blend toward the baked
  // height of whichever lane edge we are heading for, so the folk is exactly on
  // the ground at the edge and never worse than a straight line in between.
  const q = route.lane > 1e-6 ? lane / route.lane : 0;
  const edge = q >= 0
    ? d[a + 5] + (d[b + 5] - d[a + 5]) * k
    : d[a + 7] + (d[b + 7] - d[a + 7]) * k;
  out.y = y + (edge - y) * Math.min(1, Math.abs(q));
  out.slope = d[a + 4] + (d[b + 4] - d[a + 4]) * k;
  out.ice = d[a + 6] + (d[b + 6] - d[a + 6]) * k;
  return out;
}

/* ================================================================== *
 * 2 · PIECE-FOLK — the little citizens on their errands                *
 * ================================================================== */

export type GaitName = "hurry" | "glide" | "trot" | "trundle";

export interface Gait {
  /** Metres per second along the route. */
  speed: number;
  /** Metres per step — the bob is driven by DISTANCE, so it never foot-skates. */
  stride: number;
  /** Vertical bounce, metres. */
  bob: number;
  /** Side-to-side waddle, metres. */
  sway: number;
  /** Body tip into the waddle, radians. */
  roll: number;
  /** Per-step nod, radians. */
  pitch: number;
  /** Constant forward lean, radians. A hurrying pawn leans; a bishop does not. */
  lean: number;
  /** Slow hover, for the one who does not walk at all. */
  float: number;
}

/**
 * FOUR WAYS TO CROSS A PARK.
 *
 * The whole reading of a piece-folk is in its gait — at thirty metres you
 * cannot see a face, only a rhythm. So each rhythm is a different animal:
 * the pawn is late, the knight is a rocking horse, the bishop does not appear
 * to touch the ground at all, and the rook has to move its whole weight.
 */
export const GAITS: Record<GaitName, Gait> = {
  hurry:   { speed: 1.95, stride: 0.62, bob: 0.075, sway: 0.030, roll: 0.045, pitch: 0.055, lean: 0.085, float: 0 },
  trot:    { speed: 1.55, stride: 0.86, bob: 0.110, sway: 0.045, roll: 0.075, pitch: 0.105, lean: 0.030, float: 0 },
  glide:   { speed: 1.15, stride: 1.40, bob: 0.012, sway: 0.055, roll: 0.030, pitch: 0.008, lean: 0.000, float: 0.045 },
  trundle: { speed: 0.92, stride: 0.74, bob: 0.055, sway: 0.085, roll: 0.105, pitch: 0.030, lean: 0.020, float: 0 },
};

/** A pause on the way: `at` is a fraction of the loop, `secs` how long it lasts. */
export interface Dwell { at: number; secs: number }

export interface FolkSpec {
  type: PieceType;
  gait: GaitName;
  /** Index into `walkRoutes()`. */
  route: number;
  /** Signed lateral offset — negative is the returning lane. */
  lane: number;
  /** Seconds of offset into this folk's own cycle. */
  phase: number;
  speed: number;
  scale: number;
  tint: number;
  dwells: Dwell[];
  /** A few carry a lantern; it swells as the dusk comes on. */
  lantern: boolean;
  seed: number;
}

interface Errand {
  route: RouteName;
  type: PieceType;
  gait: GaitName;
  tier: Tier;
  /** Where along the loop this folk stops, and for how long. */
  dwells?: Array<[number, number]>;
  lantern?: boolean;
}

/**
 * THE CAST.
 *
 * Hand-authored, because a park full of randomly scattered walkers reads as
 * traffic. Every one of these is somebody with an errand: the pawn who is late
 * for the train, the bishop who stops at the carousel every single lap, the
 * queen taking the evening air with a lantern.
 *
 * Ordered so the first eight carry the park on their own at "low".
 */
const CAST: Errand[] = [
  /* --- the gate walk: arrivals, and the longest sightline in the park --- */
  { route: "gate", type: "p", gait: "hurry", tier: 0, dwells: [[0.44, 3.5]] },
  { route: "gate", type: "b", gait: "glide", tier: 0, dwells: [[0.47, 6.0]] },
  { route: "gate", type: "p", gait: "hurry", tier: 1 },
  { route: "gate", type: "n", gait: "trot", tier: 1, dwells: [[0.20, 2.5], [0.72, 2.0]] },
  { route: "gate", type: "r", gait: "trundle", tier: 2, dwells: [[0.50, 8.0]] },

  /* --- the plaza promenade: the busiest, closest, most-seen lane --- */
  { route: "promenade", type: "p", gait: "hurry", tier: 0 },
  { route: "promenade", type: "b", gait: "glide", tier: 0, dwells: [[0.38, 7.5]] },
  { route: "promenade", type: "n", gait: "trot", tier: 1, dwells: [[0.62, 3.0]] },
  { route: "promenade", type: "p", gait: "hurry", tier: 1, dwells: [[0.12, 2.0]] },
  { route: "promenade", type: "q", gait: "glide", tier: 2, lantern: true, dwells: [[0.30, 5.0], [0.80, 4.0]] },
  { route: "promenade", type: "r", gait: "trundle", tier: 2 },
  { route: "promenade", type: "p", gait: "hurry", tier: 2, dwells: [[0.55, 2.5]] },

  /* --- out to the parade --- */
  { route: "parade", type: "n", gait: "trot", tier: 0 },
  { route: "parade", type: "p", gait: "hurry", tier: 1, dwells: [[0.48, 3.0]] },
  { route: "parade", type: "b", gait: "glide", tier: 2 },
  { route: "parade", type: "p", gait: "hurry", tier: 2 },

  /* --- out to the train --- */
  { route: "train", type: "p", gait: "hurry", tier: 0 },
  { route: "train", type: "r", gait: "trundle", tier: 1, dwells: [[0.46, 6.0]] },
  { route: "train", type: "n", gait: "trot", tier: 2 },
  { route: "train", type: "p", gait: "hurry", tier: 2, lantern: true },

  /* --- the long walk to the wheel, and the long climb to the crest --- */
  { route: "ferris", type: "b", gait: "glide", tier: 0, lantern: true, dwells: [[0.49, 9.0]] },
  { route: "ferris", type: "p", gait: "hurry", tier: 2 },
  { route: "coaster", type: "n", gait: "trot", tier: 1, dwells: [[0.47, 5.0]] },
  { route: "coaster", type: "p", gait: "hurry", tier: 2 },
];

/**
 * The folk wear the park's own woods and canvases: mostly the cream-and-walnut
 * of a chess set, with the occasional one dressed for the fair.
 */
const FOLK_TINTS: number[] = [
  PALETTE.creamPale,
  mix(PALETTE.cream, PALETTE.honey, 0.18),
  PALETTE.cream,
  mix(PALETTE.creamPale, PALETTE.icePale, 0.16),
  PALETTE.walnutLight,
  mix(PALETTE.walnut, PALETTE.honeyDeep, 0.28),
  PALETTE.walnut,
  // The two fair colours are pulled well toward cream. At full strength a teal
  // folk is a boiled sweet on a snowfield — it pulls the eye off ChessPaa, who
  // is meant to be the warmest thing on screen.
  mix(PALETTE.teal, PALETTE.cream, 0.55),
  mix(PALETTE.plum, PALETTE.cream, 0.55),
];

/** How tall each type stands as a citizen, not as a playing piece. */
const FOLK_SCALE: Record<PieceType, number> = {
  p: 1.30, n: 1.24, b: 1.02, r: 1.14, q: 1.00, k: 1.00,
};

export function buildFolk(quality: LifeQuality): FolkSpec[] {
  const cap = tierCap(quality);
  const r = rng(4771);
  const out: FolkSpec[] = [];

  CAST.forEach((e, i) => {
    // Draw for EVERY cast member, tier or not, so a folk that survives to the
    // next quality rung keeps the exact look it had at the last one.
    const tintPick = FOLK_TINTS[Math.floor(r() * FOLK_TINTS.length)];
    const speedVar = 0.86 + r() * 0.28;
    const scaleVar = 0.92 + r() * 0.17;
    const phase = r();
    const laneJitter = 0.62 + r() * 0.34;
    if (e.tier > cap) return;

    const gait = GAITS[e.gait];
    const ri = routeIndex(e.route);
    const route = walkRoutes()[ri];
    const speed = gait.speed * speedVar;
    // Alternate the lanes so folk pass each other rather than file along.
    const side = i % 2 === 0 ? 1 : -1;

    out.push({
      type: e.type,
      gait: e.gait,
      route: ri,
      lane: side * route.lane * laneJitter,
      // Spread the cycle so nobody sets off at the same instant as anybody else.
      phase: phase * (route.length / speed) + i * 3.7,
      speed,
      scale: FOLK_SCALE[e.type] * scaleVar,
      tint: tintPick,
      dwells: (e.dwells ?? []).map(([at, secs]) => ({ at, secs })),
      lantern: e.lantern === true,
      seed: 100 + i * 17,
    });
  });

  return out;
}

export interface FolkPose {
  /** Position along the loop, 0..1. */
  s: number;
  /** 0 while stopped, 1 at full stride — also scales the bob. */
  moving: number;
  /** 0..1 through a pause, for looking about. */
  dwellPhase: number;
}

/** Seconds a folk spends easing out of, or into, a stop. */
const EASE_SECS = 0.75;

/**
 * Distance covered as a fraction of a leg, given eased ends.
 *
 * A folk that walks at a flat speed and then stops dead reads as a bug. So each
 * leg carries a smoothstep ramp at whichever end touches a pause, and this is
 * the exact integral of that ramp — position and speed stay consistent, which
 * is what keeps the stride in sync with the ground.
 */
function legProgress(x: number, kIn: number, kOut: number): { p: number; v: number } {
  const total = 1 - 0.5 * kIn - 0.5 * kOut;
  if (total <= 1e-4) return { p: x, v: 1 };
  if (kIn > 1e-4 && x < kIn) {
    const u = x / kIn;
    return { p: (kIn * (u * u * u - 0.5 * u * u * u * u)) / total, v: u * u * (3 - 2 * u) };
  }
  if (kOut > 1e-4 && x > 1 - kOut) {
    const u = (1 - x) / kOut;
    return { p: (total - kOut * (u * u * u - 0.5 * u * u * u * u)) / total, v: u * u * (3 - 2 * u) };
  }
  return { p: (0.5 * kIn + (x - kIn)) / total, v: 1 };
}

/**
 * Where a folk is, and whether it is walking, at time t. Closed form — no state.
 */
export function folkPose(f: FolkSpec, route: WalkRoute, t: number, out: FolkPose): FolkPose {
  const travel = route.length / f.speed;
  let cycle = travel;
  for (const d of f.dwells) cycle += d.secs;

  let u = (t + f.phase) % cycle;
  if (u < 0) u += cycle;

  let acc = 0;
  let sPrev = 0;
  const n = f.dwells.length;

  for (let i = 0; i <= n; i++) {
    const sEnd = i < n ? f.dwells[i].at : 1;
    const legLen = sEnd - sPrev;
    const legDur = legLen * travel;
    if (legDur > 1e-4 && u < acc + legDur) {
      // Ease away from a stop behind us, and into a stop ahead of us. The loop
      // seam at s=0 is a continuation, never a stop, so it is never eased.
      const kIn = i > 0 ? Math.min(0.45, EASE_SECS / legDur) : 0;
      const kOut = i < n ? Math.min(0.45, EASE_SECS / legDur) : 0;
      const { p, v } = legProgress((u - acc) / legDur, kIn, kOut);
      out.s = sPrev + legLen * p;
      out.moving = v;
      out.dwellPhase = 0;
      return out;
    }
    acc += legDur;
    sPrev = sEnd;
    if (i < n) {
      const d = f.dwells[i];
      if (u < acc + d.secs) {
        out.s = d.at;
        out.moving = 0;
        out.dwellPhase = (u - acc) / d.secs;
        return out;
      }
      acc += d.secs;
    }
  }

  // Float slop can land us a hair past the last leg; hold at the seam.
  out.s = 1;
  out.moving = 1;
  out.dwellPhase = 0;
  return out;
}

/* ================================================================== *
 * 3 · CROWS — the pines have opinions                                  *
 * ================================================================== */

export interface CrowSpec {
  /** A real treetop: these are the tips of actual pines from buildForest(42). */
  perch: [number, number, number];
  /** Centre of the circling loop, out over open air rather than in the canopy. */
  hub: [number, number];
  radius: number;
  /** How far above the perch the circle sits. */
  climb: number;
  /** Seconds between one take-off and the next. */
  period: number;
  /** Seconds spent in the air. */
  flight: number;
  /** Fractions of the flight spent leaving the branch and returning to it. */
  takeoff: number;
  landing: number;
  phase: number;
  laps: number;
  /** Which way it faces while sitting. */
  restYaw: number;
  /** -1 or 1: not every bird circles the same way. */
  dir: 1 | -1;
  scale: number;
  seed: number;
}

/**
 * PERCHES ON REAL TREES.
 *
 * Each of these is the tip of an actual pine from `buildForest(42)` — sampled
 * once, offline, and written down. A crow floating a few metres beside its tree
 * is the sort of mistake that quietly tells a child none of this is real, and
 * the forest is far too expensive to re-derive at runtime just to ask where its
 * tallest trees are.
 *
 * Every perch is in at least one camera rig's frame: (1) and (5) from the lake
 * and gate, (2) from the crest, (3) and (4) from the train, (6) from the plaza
 * looking south, (7) from the parade.
 */
const PERCHES: Array<{ p: [number, number]; apex: number; tier: Tier }> = [
  { p: [-19.66, 60.65], apex: 15.09, tier: 0 },
  { p: [27.62, 63.21], apex: 17.90, tier: 0 },
  { p: [53.92, -5.78], apex: 20.28, tier: 0 },
  { p: [56.47, -7.77], apex: 17.69, tier: 1 },
  { p: [-49.92, 6.49], apex: 12.99, tier: 1 },
  { p: [17.52, -62.76], apex: 13.94, tier: 2 },
  { p: [-72.54, -36.68], apex: 14.24, tier: 2 },
];

export function buildCrows(quality: LifeQuality): CrowSpec[] {
  const cap = tierCap(quality);
  const r = rng(9091);
  const out: CrowSpec[] = [];

  PERCHES.forEach((perch, i) => {
    const rad = 8.5 + r() * 6;
    const climb = 6.5 + r() * 6;
    const laps = r() > 0.62 ? 2 : 1;
    // A FLIGHT BUDGET MADE OF REAL SPEEDS, not of seconds picked out of the air.
    // Fixed fractions on a fixed duration send a bird round a wide circle at
    // ninety kilometres an hour and straight up off its branch like a firework;
    // both read as broken long before anyone works out why.
    const cruise = 10 + r() * 3.5;      // m/s along the circle
    const climbRate = 2.8 + r() * 1.2;  // m/s of climb: a burst, not a rocket
    const cruiseSecs = (TAU * rad * laps) / cruise;
    const climbSecs = climb / climbRate;
    const flight = cruiseSecs + climbSecs * 2;
    const takeoff = climbSecs / flight;
    const landing = 1 - takeoff;
    const rest = 38 + r() * 52;
    const period = flight + rest;
    const phase = r() * period;
    const restYaw = r() * TAU;
    const dir: 1 | -1 = r() > 0.5 ? 1 : -1;
    const scale = 0.92 + r() * 0.34;
    if (perch.tier > cap) return;

    const [px, pz] = perch.p;
    // Pull the loop in toward the valley so the circle is over open air, not
    // buried in the pine wall it launched from.
    const d = Math.hypot(px, pz) || 1;
    const hub: [number, number] = [px - (px / d) * (rad * 1.15), pz - (pz / d) * (rad * 1.15)];

    out.push({
      // Just under the tip and a touch off-axis: a bird sits on a branch, it
      // does not balance on the point of the cone.
      perch: [px + 0.22, perch.apex - 0.85, pz + 0.16],
      hub, radius: rad, climb, period, flight, takeoff, landing, phase, laps, restYaw, dir, scale,
      seed: 300 + i * 29,
    });
  });

  return out;
}

export interface CrowPose {
  x: number; y: number; z: number;
  yaw: number; roll: number; pitch: number;
  /** 0 = wings still, 1 = hauling for altitude. */
  flap: number;
  /** 1 = wings tucked along the back, 0 = spread. */
  fold: number;
  /** True while sitting, so the caller can hold the wings still. */
  perched: boolean;
}


/** Position only, so yaw can be taken from a second sample a moment later. */
function crowPoint(c: CrowSpec, u: number, out: THREE.Vector3): THREE.Vector3 {
  const f = u / c.flight;
  const [px, py, pz] = c.perch;
  const circleY = py + c.climb;
  // The circle is entered (and left) at the point nearest the perch, so the
  // bird never appears to teleport across its own loop.
  const a0 = Math.atan2(pz - c.hub[1], px - c.hub[0]);
  const ex = c.hub[0] + Math.cos(a0) * c.radius;
  const ez = c.hub[1] + Math.sin(a0) * c.radius;

  if (f < c.takeoff) {
    const k = f / c.takeoff;
    const e = k * k * (3 - 2 * k);
    // A crow drops off the branch before it climbs — that little sag is the
    // whole reason a take-off reads as weight rather than as a rising decal.
    const sag = Math.sin(k * Math.PI) * 0.9;
    out.set(
      px + (ex - px) * e,
      py + (circleY - py) * (e * e) - sag,
      pz + (ez - pz) * e
    );
    return out;
  }
  if (f > c.landing) {
    const k = (f - c.landing) / (1 - c.landing);
    const e = k * k * (3 - 2 * k);
    // Flare: the last stretch rises slightly before settling.
    const flare = Math.sin(k * Math.PI) * 1.1;
    out.set(
      ex + (px - ex) * e,
      circleY + (py - circleY) * (e * e * (3 - 2 * e)) + flare,
      ez + (pz - ez) * e
    );
    return out;
  }
  const k = (f - c.takeoff) / (c.landing - c.takeoff);
  const a = a0 + c.dir * c.laps * TAU * k;
  out.set(
    c.hub[0] + Math.cos(a) * c.radius,
    // The lap rises and falls, but it must pass through the entry height at
    // both ends — an offset phase here jumps the bird half a metre the instant
    // it joins its own circle, and reads as a dropped frame.
    circleY + Math.sin(k * TAU * c.laps) * 0.75,
    c.hub[1] + Math.sin(a) * c.radius
  );
  return out;
}

/** How long a wing takes to open or tuck. */
const FOLD_SECS = 0.45;

const _cp = new THREE.Vector3();
const _cq = new THREE.Vector3();

export function crowPose(c: CrowSpec, t: number, out: CrowPose): CrowPose {
  let u = (t + c.phase) % c.period;
  if (u < 0) u += c.period;

  if (u >= c.flight) {
    /* ---- perched: fidget, snap the head about, shrug now and then ---- */
    const rest = u - c.flight;
    const beat = rest * 0.19 + c.seed * 0.31;
    // Sharp, brief hops. Birds do not ease.
    const pulse = Math.max(0, Math.sin(beat * TAU));
    const hop = Math.pow(pulse, 14) * 0.10;
    // Quantised head turns — a crow looks in a direction, it does not pan.
    const look = Math.round(Math.sin(rest * 0.27 + c.seed) * 1.8) * 0.42;
    out.x = c.perch[0];
    out.y = c.perch[1] + hop;
    out.z = c.perch[2];
    out.yaw = c.restYaw + look;
    out.roll = 0;
    out.pitch = -0.05 + hop * 1.4;
    out.flap = Math.pow(pulse, 22) * 0.5; // the shrug that goes with a caw
    // A SITTING BIRD TUCKS ITS WINGS. Spread wings on a branch read as a
    // weathervane, and the eye catches that long before it catches the bird.
    // Unfolds in the last half-second before take-off, folds again on landing.
    out.fold = Math.min(1, Math.min(rest, c.period - u) / FOLD_SECS);
    out.perched = true;
    return out;
  }

  crowPoint(c, u, _cp);
  crowPoint(c, Math.min(u + 0.06, c.flight - 1e-3), _cq);
  const dx = _cq.x - _cp.x, dz = _cq.z - _cp.z, dy = _cq.y - _cp.y;
  const flat = Math.hypot(dx, dz) || 1e-4;

  const f = u / c.flight;
  const cruising = f > c.takeoff && f < c.landing;
  out.x = _cp.x; out.y = _cp.y; out.z = _cp.z;
  out.yaw = Math.atan2(dx, dz);
  out.pitch = -Math.atan2(dy, flat) * 0.55;
  // Bank into the turn while circling; level out for the run in and out.
  out.roll = cruising ? -c.dir * 0.42 : 0;
  out.flap = cruising
    // Gliding, with a few bursts a lap to hold height.
    ? 0.20 + 0.55 * Math.pow(Math.max(0, Math.sin(f * 34 + c.seed)), 6)
    : f <= c.takeoff ? 1 : 0.8;
  out.fold = 1 - Math.min(1, Math.min(u, c.flight - u) / FOLD_SECS);
  out.perched = false;
  return out;
}

/* ================================================================== *
 * 4 · SNOW-GLITTER — the air over the ice                              *
 * ================================================================== */

export interface GlitterField {
  position: Float32Array;
  seed: Float32Array;
  scale: Float32Array;
  /** 1 over the ice, falling off across the banks. Drives density and colour. */
  cold: Float32Array;
  count: number;
}

/**
 * The LOW edge of the ice ribbon `buildIceGeometry` lays — it crowns at -2.56
 * and falls to -2.62 at its two edges. The lower of the two is the right floor
 * for glitter: a mote sown at -2.62 is on the ice everywhere, never inside it.
 */
const ICE_Y = -2.62;

/**
 * A field of motes, weighted onto the frozen river.
 *
 * Three quarters are sown along the ice, where the low sun comes off the
 * surface and the air is coldest; the rest drift over the whole valley so the
 * ice does not look like a box of glitter with a hard edge.
 */
export function buildGlitterField(count: number, seed = 808): GlitterField {
  const r = rng(seed);
  const position = new Float32Array(count * 3);
  const sd = new Float32Array(count);
  const scale = new Float32Array(count);
  const cold = new Float32Array(count);

  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();

  let n = 0;
  let guard = 0;
  while (n < count && guard++ < count * 6) {
    let x: number, y: number, z: number, c: number;

    if (r() < 0.76) {
      // Over the ice: ride the river curve so the band bends with the water.
      const t = 0.12 + r() * 0.76;
      riverCurve.getPoint(t, p);
      riverCurve.getTangent(t, tan).normalize();
      const off = (r() * 2 - 1) * 15.5;
      x = p.x - tan.z * off;
      z = p.z + tan.x * off;
      if (Math.hypot(x, z) > 118) continue;
      // Hug the surface: glitter lives in the first few metres of air. The band
      // is wider than the ice, so past the edge the snow bank is the floor —
      // without this, a sixth of the field is buried inside the riverbank.
      const floor = Math.abs(off) > 9 ? Math.max(ICE_Y, terrainHeight(x, z)) : ICE_Y;
      y = floor + 0.22 + Math.pow(r(), 1.7) * 3.6;
      c = 1 - Math.min(1, Math.max(0, (Math.abs(off) - 9) / 9));
    } else {
      const a = r() * TAU;
      const rad = Math.sqrt(r()) * 92;
      x = Math.cos(a) * rad;
      z = Math.sin(a) * rad;
      y = terrainHeight(x, z) + 0.45 + Math.pow(r(), 1.5) * 4.4;
      const rd = riverDistance(x, z);
      c = 1 - Math.min(1, Math.max(0, (rd - 12) / 26));
    }

    position[n * 3] = x;
    position[n * 3 + 1] = y;
    position[n * 3 + 2] = z;
    sd[n] = r();
    scale[n] = 0.65 + Math.pow(r(), 2.2) * 1.9; // a few big flakes, many small
    cold[n] = c;
    n++;
  }

  return { position, seed: sd, scale, cold, count: n };
}

/* ------------------------------------------------------------------ */
/* THE GLITTER SPRITE — a four-point star, painted in code             */
/* ------------------------------------------------------------------ */

let SPARK_TEX: THREE.Texture | null = null;

/**
 * `glowSprite()` is a soft round halo — right for lanterns, wrong for glitter.
 * A mote catching the sun throws a cross-shaped flare, and that flare is the
 * difference between "sparkle" and "dust".
 */
export function glitterSprite(): THREE.Texture {
  if (SPARK_TEX) return SPARK_TEX;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;

  const core = x.createRadialGradient(32, 32, 0, 32, 32, 21);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(0.35, "rgba(255,250,238,0.72)");
  core.addColorStop(1, "rgba(255,246,226,0)");
  x.fillStyle = core;
  x.fillRect(0, 0, 64, 64);

  // The flare arms, tapered to a point so the star never reads as a plus sign.
  x.globalCompositeOperation = "lighter";
  x.fillStyle = "rgba(255,248,232,0.55)";
  for (const [ax, ay] of [[1, 0], [0, 1]] as Array<[number, number]>) {
    const L = 30, W = 3.2;
    x.beginPath();
    x.moveTo(32 + ax * L, 32 + ay * L);
    x.lineTo(32 + ay * W, 32 + ax * W);
    x.lineTo(32 - ax * L, 32 - ay * L);
    x.lineTo(32 - ay * W, 32 - ax * W);
    x.closePath();
    x.fill();
  }
  x.globalCompositeOperation = "source-over";

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // NO MIPMAPS. A glitter mote draws one or two pixels wide, and at that size
  // the GPU samples the bottom of the mip chain — which is the AVERAGE alpha of
  // a mostly-transparent star, about 0.08. The whole field then renders and is
  // invisible, which is exactly how it read in the first captures.
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  SPARK_TEX = t;
  return t;
}

/* ================================================================== *
 * 5 · THE SLOW DUSK DRIFT                                              *
 * ================================================================== */

/** How long a session takes to arrive at full dusk, by default. */
export const DUSK_MINUTES = 14;

/**
 * The dusk curve: 0 is the golden hour we open on, 1 is deep evening.
 *
 * Smoothstepped rather than linear on purpose. The gold has to LINGER — that
 * first minute is the picture the park sells itself with — and the last minute
 * has to settle rather than arrive, or a child looks up and notices that the
 * sun moved, which is precisely the moment the place stops being a place.
 *
 * Monotonic, always. Light in this park never goes backwards.
 */
export function duskAt(elapsedSeconds: number, minutesToFull: number = DUSK_MINUTES): number {
  const span = Math.max(0.01, minutesToFull) * 60;
  const t = Math.min(1, Math.max(0, elapsedSeconds / span));
  return t * t * (3 - 2 * t);
}

/* ================================================================== *
 * 6 · SHARED CONSTANTS                                                 *
 * ================================================================== */


/** Baseline mote counts before the quality scale is applied. */
export const GLITTER_BASE = 1600;
