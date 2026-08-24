"use client";

import * as THREE from "three";
import { PALETTE, css } from "./palette";
import { setGlobalLodBias } from "./lod";

/**
 * THE BUDGET MONITOR AND THE QUALITY LADDER.
 *
 * 60fps is not an optimisation target here, it is part of the art direction.
 * A child feels a dropped frame in their body long before they could explain
 * it: the lantern stutters, the coaster jerks, and the place stops being a
 * place. So the park watches its own frame time and spends detail down a
 * documented ladder rather than letting the frame rate sag.
 *
 * The two hard requirements on a governor like this:
 *
 *   IT MUST NOT OSCILLATE. Quality that pumps up and down is worse than
 *   quality that is simply low — the change itself is the thing you notice.
 *   Four defences, all of them tested:
 *     · a WIDE NEUTRAL BAND (54–58.5fps) where nothing happens at all;
 *     · SUSTAIN windows — 1.2s of bad frames to demote, 5s of good ones to
 *       promote, so a single hitch decides nothing;
 *     · COOLDOWNS after every change, longer upward than downward;
 *     · REGRET BACKOFF — if a rung is promoted into and then demoted back out
 *       of within 10 seconds, that rung is blocked for an exponentially
 *       growing time, and after three strikes it is closed for the session.
 *       This is what makes "never oscillates" a guarantee and not a hope.
 *
 *   IT MUST NOT PANIC AT STARTUP. The first seconds of any WebGL scene are
 *   shader compilation and texture upload; frame times there are meaningless.
 *   A warmup window and a hitch filter (any frame longer than `spikeMs` is
 *   discarded, not averaged) keep the park from arriving at "low" because the
 *   browser was busy compiling the toon ramp.
 */

/* ------------------------------------------------------------------ */
/* THE LADDER                                                          */
/* ------------------------------------------------------------------ */

export type QualityLevel = "low" | "medium" | "high" | "ultra";

/** Coarse to fine. Index order is the ladder order. */
export const QUALITY_ORDER: readonly QualityLevel[] = ["low", "medium", "high", "ultra"] as const;

/**
 * What EXACTLY changes at each rung.
 *
 *   rung   │ dpr  │ shadow │ casters │ particles │ bloom lv │ lodBias │ crowd │ aniso
 *   ───────┼──────┼────────┼─────────┼───────────┼──────────┼─────────┼───────┼──────
 *   ultra  │ 2.00 │  2048  │    2    │   1.00    │    6     │  1.00   │ 1.00  │  8
 *   high   │ 1.75 │  1536  │    2    │   0.80    │    5     │  0.85   │ 0.85  │  4
 *   medium │ 1.25 │  1024  │    1    │   0.55    │    4     │  0.62   │ 0.60  │  2
 *   low    │ 1.00 │   512  │    1    │   0.30    │    3     │  0.45   │ 0.40  │  1
 *
 * ultra → low is roughly a 4x cut in shaded pixels (dpr), a 16x cut in shadow
 * texels, a third of the particles, and about half the visible crowd. That is
 * the whole budget, and it is enough to take a mid tablet from 30 to 60.
 *
 * WHAT NEVER CHANGES, AT ANY RUNG:
 *   · the inverted-hull outlines,
 *   · the Sobel interior ink,
 *   · the warm LUT grade and the toon ramp,
 *   · the banded fog.
 * Those are not effects, they are the drawing. A park that drops to "low" must
 * still be the same handmade storybook park, just softer and smaller. Every
 * rung therefore carries `celPipeline: true`, in code, so nobody can quietly
 * negotiate the look away in a future perf pass.
 *
 * Bloom is likewise never switched off — the lantern halo IS the golden hour.
 * What shrinks is the mipmap chain (`bloomLevels`), which is where its cost
 * actually lives.
 */
export interface QualityRung {
  readonly level: QualityLevel;
  /** Cap for renderer.setPixelRatio. The single biggest lever we have. */
  readonly pixelRatio: number;
  /** Square shadow map edge, per casting light. */
  readonly shadowMapSize: number;
  /** How many lights may cast. The sun always wins the last slot. */
  readonly shadowCasters: number;
  /** Multiplier on every particle system's count: snow, fireflies, sparks, steam. */
  readonly particleScale: number;
  /** Mipmap levels in the bloom chain. Fewer = tighter, cheaper halo. */
  readonly bloomLevels: number;
  readonly bloomIntensity: number;
  /** Global multiplier on every LOD threshold — see lod.ts. */
  readonly lodBias: number;
  /** Multiplier on instanced-crowd budgets fed to packVisible. */
  readonly crowdScale: number;
  readonly anisotropy: number;
  /** The cel pipeline is not negotiable. It is true at every rung, forever. */
  readonly celPipeline: true;
}

export const QUALITY_LADDER: Readonly<Record<QualityLevel, QualityRung>> = {
  ultra: {
    level: "ultra", pixelRatio: 2.0, shadowMapSize: 2048, shadowCasters: 2,
    particleScale: 1.0, bloomLevels: 6, bloomIntensity: 0.62,
    lodBias: 1.0, crowdScale: 1.0, anisotropy: 8, celPipeline: true,
  },
  high: {
    level: "high", pixelRatio: 1.75, shadowMapSize: 1536, shadowCasters: 2,
    particleScale: 0.8, bloomLevels: 5, bloomIntensity: 0.60,
    lodBias: 0.85, crowdScale: 0.85, anisotropy: 4, celPipeline: true,
  },
  medium: {
    level: "medium", pixelRatio: 1.25, shadowMapSize: 1024, shadowCasters: 1,
    particleScale: 0.55, bloomLevels: 4, bloomIntensity: 0.56,
    lodBias: 0.62, crowdScale: 0.60, anisotropy: 2, celPipeline: true,
  },
  low: {
    level: "low", pixelRatio: 1.0, shadowMapSize: 512, shadowCasters: 1,
    particleScale: 0.30, bloomLevels: 3, bloomIntensity: 0.52,
    lodBias: 0.45, crowdScale: 0.40, anisotropy: 1, celPipeline: true,
  },
};

export function qualityIndex(level: QualityLevel): number {
  return QUALITY_ORDER.indexOf(level);
}

/** Scale a designed count by the rung's particle budget, never below 1. */
export function particleCount(base: number, rung: QualityRung): number {
  return Math.max(1, Math.round(base * rung.particleScale));
}

/** Scale a crowd budget by the rung. */
export function crowdBudget(base: number, rung: QualityRung): number {
  return Math.max(1, Math.round(base * rung.crowdScale));
}

/* ------------------------------------------------------------------ */
/* STATS                                                               */
/* ------------------------------------------------------------------ */

export interface PerfStats {
  /** Smoothed frames per second — what the governor actually reasons about. */
  fps: number;
  /** This frame only. Jittery by nature; for the overlay, not for decisions. */
  fpsInstant: number;
  /** Smoothed frame time in ms. */
  frameMs: number;
  /** 95th percentile frame time over the rolling window — the hitch detector. */
  worstMs: number;
  /**
   * Fraction of recent frames that missed the budget. This, not the average,
   * is what judder actually is: a scene can average 63fps and still lurch
   * twice a second, and a child feels the lurch, not the average.
   */
  jitter: number;
  calls: number;
  tris: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  programs: number;
  level: QualityLevel;
  levelIndex: number;
  /** (budget - frameMs) / budget. Positive = room to spend. */
  headroom: number;
  /** How many rung changes have happened. Should stay in single digits. */
  changes: number;
  /** Frames discarded as hitches (compile, GC, tab restore). */
  hitches: number;
  /** True once a rung has been closed for the session by repeated regret. */
  locked: boolean;
  ceiling: QualityLevel;
  uptime: number;
}

export interface GovernorOptions {
  start?: QualityLevel;
  /** Never climb above this. Set it from estimateDeviceTier() on a tablet. */
  ceiling?: QualityLevel;
  /** Never fall below this. "low" must remain playable, so this is the floor. */
  floor?: QualityLevel;
  /** Frames per second we are buying. */
  target?: number;
  /** Below this, sustained, we spend down a rung. */
  demoteBelow?: number;
  /** Above this, sustained, we consider spending up. Gap = the neutral band. */
  promoteAbove?: number;
  /** Below this we drop TWO rungs fast — the park is visibly broken. */
  emergencyBelow?: number;
  /** Seconds of sustained bad frames before demoting. */
  demoteAfter?: number;
  /** Seconds of sustained good frames before promoting. Deliberately long. */
  promoteAfter?: number;
  /** Seconds after any demotion before another change may happen. */
  cooldownDown?: number;
  /** Seconds after any promotion before another change may happen. */
  cooldownUp?: number;
  /**
   * The shortest settle an EMERGENCY drop may skip to. Even a panic has to wait
   * for the new rung to reach the rolling average — otherwise one bad second is
   * measured three times and walks the whole ladder to the floor.
   */
  emergencyCooldown?: number;
  /** Startup seconds ignored entirely — shader compile, texture upload. */
  warmup?: number;
  /** A frame longer than this is a hitch, not a trend. Discarded. */
  spikeMs?: number;
  /** p95 frame time must be under this to allow a promotion. */
  promoteWorstMs?: number;
  /** A frame over this many ms counts toward `jitter`. One dropped vsync. */
  jitterMs?: number;
  /** Promotion is refused above this jitter fraction. 0.02 = one frame in fifty. */
  maxJitter?: number;
  /** Smoothing time constant, seconds. */
  tau?: number;
  /** A promotion undone within this many seconds counts as a regret. */
  regretWindow?: number;
  /** First regret blocks a rung this long; each further regret doubles it. */
  regretBackoff?: number;
  /** Regrets at one rung before it is closed for the session. */
  maxStrikes?: number;
  onChange?: (level: QualityLevel, rung: QualityRung, previous: QualityLevel) => void;
}

const RING = 120;

/**
 * The governor. Feed it `dt` (seconds) and the renderer every frame; it returns
 * the quality level the park should be running at. It does not apply anything
 * itself — call `applyQuality` (or react to `onChange`) so the owner of each
 * subsystem stays in charge of its own knobs.
 */
export class PerfGovernor {
  readonly stats: PerfStats;

  private opt: Required<Omit<GovernorOptions, "onChange">> & { onChange?: GovernorOptions["onChange"] };
  private idx: number;
  private ceilingIdx: number;
  private floorIdx: number;

  private emaMs = 1000 / 60;
  private ring = new Float32Array(RING);
  private ringScratch = new Float32Array(RING);
  private ringN = 0;
  private ringHead = 0;
  private pctlAt = 0;

  private time = 0;
  private bad = 0;
  private good = 0;
  private lastChange = -1e9;
  private lastChangeWasUp = false;

  /** Rung we most recently climbed INTO, and when — the regret detector. */
  private promotedTo = -1;
  private promotedAt = -1e9;
  private strikes = [0, 0, 0, 0];
  private blockedUntil = [-1e9, -1e9, -1e9, -1e9];

  /**
   * Frame-time history for the overlay sparkline. This is a RING: the oldest
   * sample is at `historyHead`, not at 0. Pass `historyHead` to the overlay or
   * the graph reads as a cliff that migrates across it twice a second.
   */
  readonly history = new Float32Array(RING);

  constructor(opts: GovernorOptions = {}) {
    this.opt = {
      start: opts.start ?? "high",
      ceiling: opts.ceiling ?? "ultra",
      floor: opts.floor ?? "low",
      target: opts.target ?? 60,
      demoteBelow: opts.demoteBelow ?? 54,
      promoteAbove: opts.promoteAbove ?? 58.5,
      emergencyBelow: opts.emergencyBelow ?? 40,
      demoteAfter: opts.demoteAfter ?? 1.2,
      promoteAfter: opts.promoteAfter ?? 5.0,
      cooldownDown: opts.cooldownDown ?? 2.0,
      cooldownUp: opts.cooldownUp ?? 5.0,
      emergencyCooldown: opts.emergencyCooldown ?? 0.75,
      warmup: opts.warmup ?? 3.0,
      spikeMs: opts.spikeMs ?? 250,
      promoteWorstMs: opts.promoteWorstMs ?? 19,
      jitterMs: opts.jitterMs ?? 20,
      maxJitter: opts.maxJitter ?? 0.02,
      tau: opts.tau ?? 0.4,
      regretWindow: opts.regretWindow ?? 10,
      regretBackoff: opts.regretBackoff ?? 15,
      maxStrikes: opts.maxStrikes ?? 3,
      onChange: opts.onChange,
    };

    this.ceilingIdx = qualityIndex(this.opt.ceiling);
    this.floorIdx = qualityIndex(this.opt.floor);
    this.idx = Math.min(this.ceilingIdx, Math.max(this.floorIdx, qualityIndex(this.opt.start)));

    this.stats = {
      fps: 60, fpsInstant: 60, frameMs: 1000 / 60, worstMs: 1000 / 60, jitter: 0,
      calls: 0, tris: 0, points: 0, lines: 0, geometries: 0, textures: 0, programs: 0,
      level: QUALITY_ORDER[this.idx], levelIndex: this.idx,
      headroom: 0, changes: 0, hitches: 0, locked: false,
      ceiling: QUALITY_ORDER[this.ceilingIdx], uptime: 0,
    };
  }

  /** Index of the OLDEST sample in `history` — the ring's write head. */
  get historyHead(): number { return this.ringHead; }

  get level(): QualityLevel { return QUALITY_ORDER[this.idx]; }
  get rung(): QualityRung { return QUALITY_LADDER[this.level]; }

  /** Pin the top of the ladder (e.g. after sniffing a tablet GPU). */
  setCeiling(level: QualityLevel): void {
    this.ceilingIdx = Math.max(this.floorIdx, qualityIndex(level));
    this.stats.ceiling = QUALITY_ORDER[this.ceilingIdx];
    if (this.idx > this.ceilingIdx) this.setLevel(this.ceilingIdx, false);
  }

  /** Force a rung — the dev overlay and the harness both need this. */
  force(level: QualityLevel): void {
    this.setLevel(Math.min(this.ceilingIdx, Math.max(this.floorIdx, qualityIndex(level))), false);
    // A forced change still spends a cooldown, so a manual pick is not
    // immediately overruled by an accumulator that filled while we watched.
    this.lastChange = this.time;
    this.bad = this.good = 0;
  }

  /**
   * One frame. `dt` in SECONDS (R3F's useFrame delta). The renderer is optional
   * but without it the draw-call and triangle counts stay at zero.
   */
  update(dt: number, renderer?: THREE.WebGLRenderer | null): QualityLevel {
    const s = this.stats;
    const ms = dt * 1000;

    if (renderer) this.readRenderer(renderer);

    // Hitches are not information about steady-state cost. Discarding them is
    // the difference between a governor and a panic button.
    if (!(ms > 0) || ms > this.opt.spikeMs) {
      s.hitches++;
      return this.level;
    }

    this.time += dt;
    s.uptime = this.time;

    const alpha = 1 - Math.exp(-dt / this.opt.tau);
    this.emaMs += (ms - this.emaMs) * alpha;

    this.ring[this.ringHead] = ms;
    this.history[this.ringHead] = ms;
    this.ringHead = (this.ringHead + 1) % RING;
    if (this.ringN < RING) this.ringN++;

    s.frameMs = this.emaMs;
    s.fps = 1000 / this.emaMs;
    s.fpsInstant = 1000 / ms;

    // The percentile costs a 120-element sort; four times a second is plenty.
    if (this.time - this.pctlAt > 0.25) {
      this.pctlAt = this.time;
      s.worstMs = this.percentile(0.95);
      s.jitter = this.overBudgetRatio(this.opt.jitterMs);
    }

    const budget = 1000 / this.opt.target;
    s.headroom = Math.max(-1, Math.min(1, (budget - this.emaMs) / budget));

    // Startup is compilation, not performance. Watch, do not act.
    if (this.time < this.opt.warmup) return this.level;

    this.accumulate(dt, s.fps);
    this.decide();
    return this.level;
  }

  /** Reset the trend accumulators — call after a scene swap or a rig cut. */
  resettle(): void {
    this.bad = this.good = 0;
    this.lastChange = this.time;
  }

  private readRenderer(r: THREE.WebGLRenderer): void {
    const s = this.stats;
    const info = r.info;
    s.calls = info.render.calls;
    s.tris = info.render.triangles;
    s.points = info.render.points;
    s.lines = info.render.lines;
    s.geometries = info.memory.geometries;
    s.textures = info.memory.textures;
    s.programs = info.programs ? info.programs.length : 0;
  }

  private percentile(p: number): number {
    const n = this.ringN;
    if (n === 0) return this.emaMs;
    const sc = this.ringScratch.subarray(0, n);
    sc.set(this.ring.subarray(0, n));
    sc.sort();
    return sc[Math.min(n - 1, Math.floor(p * n))];
  }

  /** Share of the window that missed the frame budget. The judder number. */
  private overBudgetRatio(ms: number): number {
    const n = this.ringN;
    if (n === 0) return 0;
    let over = 0;
    for (let i = 0; i < n; i++) if (this.ring[i] > ms) over++;
    return over / n;
  }

  /**
   * Two one-way accumulators with a dead zone between them. Sitting anywhere in
   * the neutral band bleeds both back toward zero, so a scene hovering at 56fps
   * — right where a naive governor would pump — does nothing at all.
   */
  private accumulate(dt: number, fps: number): void {
    if (fps < this.opt.demoteBelow) {
      this.bad += fps < this.opt.emergencyBelow ? dt * 2 : dt;
      this.good = 0;
    } else if (fps > this.opt.promoteAbove) {
      this.good += dt;
      this.bad = Math.max(0, this.bad - dt);
    } else {
      this.bad = Math.max(0, this.bad - dt * 0.5);
      this.good = Math.max(0, this.good - dt * 0.5);
    }
  }

  private decide(): void {
    const o = this.opt;
    const s = this.stats;
    const sinceChange = this.time - this.lastChange;
    const cooldown = this.lastChangeWasUp ? o.cooldownUp : o.cooldownDown;

    // DOWN. Protecting the frame outranks everything, including the full
    // cooldown when the park is genuinely broken — but NOT the settle window.
    // Frames rendered before the last change still dominate the average; acting
    // on them again is measuring the same bad second three times, and it walks
    // a park that needed one rung all the way to the floor.
    const emergency = s.fps < o.emergencyBelow && this.bad >= 0.4 && sinceChange >= o.emergencyCooldown;
    if (this.idx > this.floorIdx && (emergency || (this.bad >= o.demoteAfter && sinceChange >= cooldown))) {
      const drop = emergency ? 2 : 1;
      this.registerRegret();
      this.setLevel(Math.max(this.floorIdx, this.idx - drop), false);
      this.bad = this.good = 0;
      return;
    }

    // UP. Slower, stricter, and revocable.
    if (this.idx < this.ceilingIdx && this.good >= o.promoteAfter && sinceChange >= cooldown) {
      const wanted = this.idx + 1;
      // A scene that AVERAGES 60 but lurches is not a scene with headroom.
      // Two independent smoothness gates, because the average hides both: a
      // broad slow tail (p95) and a sparse hard stutter (jitter).
      if (s.worstMs > o.promoteWorstMs || s.jitter > o.maxJitter) { this.good = o.promoteAfter * 0.5; return; }
      if (this.time < this.blockedUntil[wanted]) { this.good = o.promoteAfter * 0.5; return; }
      this.setLevel(wanted, true);
      this.bad = this.good = 0;
    }
  }

  /**
   * We are about to demote. If the rung we are leaving is one we climbed into
   * only moments ago, that promotion was a mistake — record a strike and lock
   * the rung out for exponentially longer each time. Three strikes and it is
   * closed for the session: better a permanently honest "high" than a park
   * that breathes between high and ultra all afternoon.
   */
  private registerRegret(): void {
    if (this.promotedTo !== this.idx) return;
    if (this.time - this.promotedAt > this.opt.regretWindow) return;

    const i = this.idx;
    this.strikes[i]++;
    const backoff = Math.min(300, this.opt.regretBackoff * Math.pow(2, this.strikes[i] - 1));
    this.blockedUntil[i] = this.time + backoff;
    if (this.strikes[i] >= this.opt.maxStrikes) {
      this.ceilingIdx = Math.max(this.floorIdx, i - 1);
      this.stats.ceiling = QUALITY_ORDER[this.ceilingIdx];
      this.stats.locked = true;
    }
    this.promotedTo = -1;
  }

  private setLevel(next: number, up: boolean): void {
    if (next === this.idx) return;
    const prev = QUALITY_ORDER[this.idx];
    this.idx = next;
    this.lastChange = this.time;
    this.lastChangeWasUp = up;
    if (up) { this.promotedTo = next; this.promotedAt = this.time; }
    this.stats.level = QUALITY_ORDER[next];
    this.stats.levelIndex = next;
    this.stats.changes++;
    this.opt.onChange?.(this.stats.level, QUALITY_LADDER[this.stats.level], prev);
  }
}

/* ------------------------------------------------------------------ */
/* APPLYING A RUNG                                                     */
/* ------------------------------------------------------------------ */

/** Where we stash a light's authored shadow intent, so we can only ever take. */
const AUTHORED_CAST = "__authoredCastShadow";

/**
 * Push a rung into the renderer and the scene. Subsystems that own their own
 * knobs (post chain, particle emitters, crowd budgets) should read the rung
 * instead — this handles only what lives on the renderer and the lights.
 *
 * Shadow maps are disposed rather than resized in place: three allocates the
 * render target on first use from `mapSize`, and will happily keep the old one
 * forever if you only change the numbers.
 */
export function applyQuality(
  renderer: THREE.WebGLRenderer,
  rung: QualityRung,
  scene?: THREE.Scene | null,
  maxDevicePixelRatio?: number
): void {
  const devMax = maxDevicePixelRatio ?? (typeof window !== "undefined" ? window.devicePixelRatio : 1);
  renderer.setPixelRatio(Math.min(rung.pixelRatio, devMax || 1));

  setGlobalLodBias(rung.lodBias);

  if (!scene) return;

  // ONLY EVER TAKE SHADOWS AWAY. The first time we see a light we remember
  // whether its author wanted it to cast; a light that was authored dark stays
  // dark forever, however bright it is. Sorting by intensity alone would hand a
  // shadow to the brightest lantern fill in the plaza — a light deliberately
  // set not to cast — which buys a whole extra shadow pass to draw something
  // the art direction says should not exist.
  const casters: THREE.Light[] = [];
  scene.traverse((o) => {
    const l = o as THREE.Light & { shadow?: THREE.LightShadow; userData: Record<string, unknown> };
    if (!l.isLight || !l.shadow) return;
    if (l.userData[AUTHORED_CAST] === undefined) l.userData[AUTHORED_CAST] = l.castShadow;
    if (l.userData[AUTHORED_CAST] === true) casters.push(l);
  });
  // Among the lights that were authored to cast, the brightest keep their
  // shadows — in this park that is the low sun, then the plaza key.
  casters.sort((a, b) => b.intensity - a.intensity);

  casters.forEach((l, i) => {
    const sh = (l as THREE.Light & { shadow?: THREE.LightShadow }).shadow;
    if (!sh) return;
    const wanted = i < rung.shadowCasters;
    l.castShadow = wanted;
    if (!wanted) return;
    if (sh.mapSize.width !== rung.shadowMapSize) {
      sh.mapSize.setScalar(rung.shadowMapSize);
      sh.map?.dispose();
      sh.map = null;
      sh.needsUpdate = true;
    }
  });
}

/**
 * A startup guess, so a tablet does not spend its first ten seconds at ultra
 * and its next ten walking back down. Deliberately conservative: starting one
 * rung low and climbing is invisible; starting high and stuttering is not.
 *
 * Reads only local device hints. Nothing is sent anywhere — no telemetry lives
 * in this park.
 */
export function estimateDeviceTier(): { start: QualityLevel; ceiling: QualityLevel } {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return { start: "high", ceiling: "ultra" };
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  // `deviceMemory` is Chromium-only: Safari and Firefox never report it. An
  // absent value is IGNORANCE, not four gigabytes — defaulting it to 4 quietly
  // capped every Safari and Firefox machine on earth, a Mac Studio included, at
  // "high" for the whole session with no way back up.
  const mem = typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;
  const smallMem = mem !== null && mem <= 4;
  const bigMem = mem === null || mem >= 8;
  const dpr = window.devicePixelRatio || 1;
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

  // A retina tablet is the hard case: plenty of pixels, a fraction of the fill
  // rate. Cap it so the governor never even tries the top rung.
  if (coarse && dpr >= 2 && (cores <= 6 || smallMem)) return { start: "medium", ceiling: "high" };
  if (cores <= 4 || smallMem) return { start: "medium", ceiling: "high" };
  if (cores >= 8 && bigMem && dpr <= 2) return { start: "high", ceiling: "ultra" };
  return { start: "high", ceiling: "high" };
}

/* ------------------------------------------------------------------ */
/* DEV OVERLAY                                                         */
/* ------------------------------------------------------------------ */

export interface PerfOverlayOptions {
  /** Key that toggles it. Default backtick. */
  key?: string;
  /** Start visible. Default false. */
  visible?: boolean;
  /** Also publish the handle on window.__perf for the screenshot harness. */
  expose?: boolean;
  /** Redraws per second. The overlay must never be the reason a frame is late. */
  hz?: number;
}

export interface PerfOverlayHandle {
  readonly el: HTMLElement | null;
  visible: boolean;
  update(stats: PerfStats, history?: Float32Array, historyHead?: number): void;
  toggle(force?: boolean): void;
  dispose(): void;
}

const INERT: PerfOverlayHandle = {
  el: null,
  visible: false,
  update: () => {},
  toggle: () => {},
  dispose: () => {},
};

/**
 * A small warm card: fps, the frame-time sparkline, and the counts that
 * actually explain a bad frame — draw calls first, because in this park a
 * regression is nearly always someone forgetting to merge or instance.
 *
 * DEV ONLY. It returns an inert handle in production and on the server, so
 * calling it unconditionally is safe and nothing ships to a child's screen.
 */
export function createPerfOverlay(opts: PerfOverlayOptions = {}): PerfOverlayHandle {
  if (typeof document === "undefined") return INERT;
  if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "production") return INERT;

  const hz = opts.hz ?? 5;
  const key = opts.key ?? "`";

  const el = document.createElement("div");
  el.style.cssText = [
    "position:fixed", "left:12px", "bottom:12px", "z-index:9999",
    "font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace",
    `color:${css(PALETTE.creamPale)}`,
    `background:${css(PALETTE.ink)}e8`,
    `border:1px solid ${css(PALETTE.walnutLight)}`,
    "border-radius:10px", "padding:9px 11px", "min-width:186px",
    "pointer-events:none", "user-select:none",
    "box-shadow:0 6px 22px rgba(46,30,40,0.35)",
  ].join(";");

  const head = document.createElement("div");
  head.style.cssText = `font-size:19px;font-weight:700;letter-spacing:.02em;color:${css(PALETTE.lanternCore)};line-height:1.1`;
  el.appendChild(head);

  const canvas = document.createElement("canvas");
  canvas.width = 168;
  canvas.height = 34;
  canvas.style.cssText = "width:168px;height:34px;display:block;margin:6px 0 5px;border-radius:4px";
  el.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const body = document.createElement("div");
  body.style.cssText = "white-space:pre";
  el.appendChild(body);

  // Closure state, not `this` — every method here is designed to survive being
  // destructured into a useFrame callback, which is exactly how it will be used.
  let visible = opts.visible ?? false;
  let last = 0;
  const setVisible = (v: boolean) => { visible = v; el.style.display = v ? "block" : "none"; };
  const onKey = (e: KeyboardEvent) => { if (e.key === key) setVisible(!visible); };

  const handle: PerfOverlayHandle = {
    el,
    get visible() { return visible; },
    set visible(v: boolean) { setVisible(v); },
    update(stats: PerfStats, history?: Float32Array, historyHead = 0) {
      if (!visible) return;
      const now = performance.now();
      if (now - last < 1000 / hz) return;
      last = now;

      const fps = Math.round(stats.fps);
      // Traffic light in palette colours: honey is good, plum is trouble.
      head.style.color = css(fps >= 57 ? PALETTE.lanternCore : fps >= 48 ? PALETTE.honeyDeep : PALETTE.plum);
      head.textContent = `${fps} fps  ${stats.frameMs.toFixed(1)}ms`;

      body.textContent =
        `quality  ${stats.level}${stats.locked ? " (locked)" : ""}\n` +
        `p95      ${stats.worstMs.toFixed(1)}ms\n` +
        `judder   ${(stats.jitter * 100).toFixed(1)}% of frames\n` +
        `calls    ${stats.calls}\n` +
        `tris     ${fmt(stats.tris)}\n` +
        `tex/prog ${stats.textures} / ${stats.programs}\n` +
        `geo      ${stats.geometries}\n` +
        `changes  ${stats.changes}   hitch ${stats.hitches}`;

      if (ctx && history) drawSpark(ctx, canvas, history, historyHead);
    },
    toggle(force?: boolean) {
      setVisible(force ?? !visible);
    },
    dispose() {
      window.removeEventListener("keydown", onKey);
      el.remove();
      delete (window as Window & { __perf?: unknown }).__perf;
    },
  };

  window.addEventListener("keydown", onKey);
  el.style.display = visible ? "block" : "none";
  document.body.appendChild(el);
  if (opts.expose) (window as Window & { __perf?: PerfOverlayHandle }).__perf = handle;
  return handle;
}

function fmt(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`;
}

/**
 * 16.7ms is drawn as a line, so a glance tells you whether we are over budget.
 * `head` is the ring's write head — the OLDEST sample. Reading the buffer from
 * index 0 instead draws a false vertical cliff wherever the head happens to be,
 * which is the one artefact that makes a sparkline actively misleading.
 */
function drawSpark(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, history: Float32Array, head = 0): void {
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(0, 0, w, h);

  const scale = h / 40; // 40ms full height — 25fps sits on the floor
  const budgetY = h - 16.7 * scale;
  ctx.strokeStyle = css(PALETTE.teal);
  ctx.globalAlpha = 0.65;
  ctx.beginPath();
  ctx.moveTo(0, budgetY);
  ctx.lineTo(w, budgetY);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const n = history.length;
  ctx.strokeStyle = css(PALETTE.honey);
  ctx.lineWidth = 1;
  ctx.beginPath();
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    // Oldest to newest, so time runs left to right whatever the head is doing.
    const ms = history[(head + i) % n];
    if (!ms) continue; // an unwritten slot, before the ring has filled once
    const x = (i / (n - 1)) * w;
    const y = Math.max(1, h - Math.min(40, ms) * scale);
    if (drawn++ === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
