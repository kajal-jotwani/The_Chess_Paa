"use client";

import * as THREE from "three";
import { rng } from "../core/textures/procedural";
import { terrainHeight } from "../world/terrain";
import { ATTRACTIONS } from "../world/coasterSpine";
import { CHESSPAA_SKELETON } from "../characters/chessPaaRig";

/**
 * THE CINEMATIC RIGS — the shots the park is remembered by.
 *
 * A locked-off camera reads as a screenshot. Every rig in this file is always
 * moving: a slow push, a drift on an arc, an operator's breath. Nothing here
 * ever comes to rest, and nothing here ever repeats — the drifts are layered
 * sines on non-harmonic frequencies, so the camera never lands back on a pose
 * a child has already seen.
 *
 * WHY A PHYSICAL CAMERA MODEL:
 * Field of view authored as a number in degrees is a rendering decision.
 * Field of view derived from "a 40mm lens on full frame" is a PHOTOGRAPHIC
 * one, and it drags its friends along with it — an aperture, a focus
 * distance, a depth of field that behaves the way every photograph a child
 * has ever seen behaves. Faces separate from backgrounds because the lens is
 * open, not because someone tuned a blur slider. That is the whole difference
 * between "photographed on something lovely" and "rendered".
 *
 * So: focal length in mm → fov; f-stop + focus distance → circle of confusion
 * → `bokeh()` and `range()`, which drop straight into postprocessing's
 * DepthOfField (`bokehScale`, `focusDistance`, `focusRange`, all world units).
 *
 * DETERMINISM: every pose is a pure function of `t` (see `pose(t)`), so the
 * screenshot harness gets the same frame for the same time, every run. The
 * only stateful thing in here is the focus puller, and it settles in ~0.7s.
 */

/* ================================================================== *
 * 1.  THE PHYSICAL CAMERA
 * ================================================================== */

const TAU = Math.PI * 2;
const RAD2DEG = 180 / Math.PI;

/** Sensor HEIGHT in mm. three's `fov` is the VERTICAL angle, so height it is. */
export const FULL_FRAME_MM = 24;

/** A lens. Focal length and f-stop mean exactly what they mean on a camera. */
export interface Lens {
  /** Focal length in millimetres, referenced to `sensorMm`. */
  focalMm: number;
  /** f-number. f/2 is wide open and dreamy; f/8 is deep and documentary. */
  fStop: number;
  /** Sensor height in millimetres. 24 = full frame. */
  sensorMm: number;
}

/**
 * The one conversion everything else hangs off:
 *   fov = 2·atan(sensorHeight / 2·focalLength)
 */
export function focalToFov(focalMm: number, sensorMm: number = FULL_FRAME_MM): number {
  const f = Math.max(1e-3, focalMm);
  return 2 * Math.atan(sensorMm / (2 * f)) * RAD2DEG;
}

/** The inverse — handy for matching a shot someone already authored in degrees. */
export function fovToFocal(fovDeg: number, sensorMm: number = FULL_FRAME_MM): number {
  const half = (THREE.MathUtils.clamp(fovDeg, 1, 175) * 0.5) / RAD2DEG;
  return sensorMm / (2 * Math.tan(half));
}

/**
 * The acceptable circle of confusion for this sensor — the "how sharp is
 * sharp" constant every depth-of-field table is built on. Industry rule:
 * sensor diagonal / 1500 (0.029mm on full frame). 3:2 gives diagonal =
 * height × 1.803.
 */
function cocLimitMm(sensorMm: number): number {
  return (sensorMm * 1.803) / 1500;
}

/** Hyperfocal distance in world units (metres). Focus here → sharp to infinity. */
export function hyperfocalM(lens: Lens): number {
  const c = cocLimitMm(lens.sensorMm);
  const f = Math.max(1e-3, lens.focalMm);
  return (f * f) / (Math.max(0.7, lens.fStop) * c) / 1000 + f / 1000;
}

/**
 * Blur-disc diameter for a subject at infinity, expressed as a fraction of
 * sensor height and scaled into postprocessing's `bokehScale` units.
 *
 * BOKEH_GAIN is calibrated once, here: a portrait lens wide open on a face at
 * conversational distance lands at ~1.5, which is a creamy but still readable
 * background. Everything else falls out of the physics from there — and it
 * SHOULD come out small for a wide lens on a landscape, because that is what
 * a wide lens on a landscape looks like.
 */
const BOKEH_GAIN = 30;

export function bokehScaleFor(lens: Lens, focusM: number): number {
  const f = Math.max(1e-3, lens.focalMm);
  // Keep the subject outside the lens itself, or magnification explodes.
  const s = Math.max(focusM * 1000, f * 1.02);
  const magnification = f / (s - f);
  const apertureMm = f / Math.max(0.7, lens.fStop);
  return (apertureMm * magnification) / lens.sensorMm * BOKEH_GAIN;
}

/**
 * The depth of the in-focus band, in world units, from the standard near/far
 * DoF limits. Feeds DepthOfField's `focusRange`.
 *
 * Two clamps, both deliberate:
 *  • MIN — a physically honest 85mm at f/2.4 holds about 13cm at 2.6m, and
 *    ChessPaa's head is 0.4 deep. The truth would put his nose and his ears
 *    out of focus, and a soft nose reads to a child as a BUG, not as craft.
 *    The band never closes below MIN_RANGE, which is sized to hold a whole
 *    face. It only ever binds on the close-up; every other shot is wider than
 *    it by an order of magnitude.
 *  • MAX — past the hyperfocal the true answer is Infinity, and Infinity in a
 *    shader uniform is a screenful of NaN. Never ship Infinity.
 */
const MIN_RANGE = 0.6;
const MAX_RANGE = 5000;

export function focusRangeFor(lens: Lens, focusM: number): number {
  const f = lens.focalMm;
  const h = hyperfocalM(lens) * 1000;
  const s = Math.max(focusM * 1000, f * 1.02);
  const near = (s * (h - f)) / (h + s - 2 * f);
  const far = s >= h ? Infinity : (s * (h - f)) / (h - s);
  const span = (far - near) / 1000;
  return THREE.MathUtils.clamp(Number.isFinite(span) ? span : MAX_RANGE, MIN_RANGE, MAX_RANGE);
}

/* ================================================================== *
 * 2.  AUTHORED MOTION
 * ================================================================== */

/**
 * A drift channel: three sines on non-harmonic ratios, deterministic phases,
 * output roughly ±1.
 *
 * WHY NOT ONE SINE: a single sine is a metronome — the eye finds the loop in
 * about two cycles and the shot dies. At 1 : φ : 2.713 the components never
 * re-phase inside a session, so the camera wanders instead of oscillating.
 * WHY NOT NOISE: it must be identical every run for the screenshot harness,
 * and it must be C-infinite — any kink in a camera path is visible.
 */
function makeDrift(seed: number, hz: number): (t: number) => number {
  const r = rng(seed);
  const p0 = r() * TAU;
  const p1 = r() * TAU;
  const p2 = r() * TAU;
  const w0 = hz * TAU;
  const w1 = w0 * 1.618;
  const w2 = w0 * 2.713;
  return (t: number) =>
    Math.sin(t * w0 + p0) * 0.62 +
    Math.sin(t * w1 + p1) * 0.26 +
    Math.sin(t * w2 + p2) * 0.12;
}

/** The low sun, matching the key light in the park. Used to choose which
 *  side of a face to shoot from — always the backlit one. */
const SUN = /* @__PURE__ */ new THREE.Vector3(46, 22, 58).normalize();

/** Centre of the head sphere above the soles. Imported, never copied — the
 *  portrait's eye line has to move when his proportions do. */
const CHESSPAA_FACE_Y = CHESSPAA_SKELETON.faceW;

/** No camera may ever dip below the snow. */
const GROUND_CLEARANCE = 0.55;

/* ================================================================== *
 * 3.  THE RIG INTERFACE
 * ================================================================== */

/** A fully authored pose. Structurally a harness `CameraPose`, plus DoF. */
export interface CinePose {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  /** Focus distance, world units — DepthOfField `focusDistance`. */
  focus: number;
  /** Blur strength — DepthOfField `bokehScale`. */
  bokeh: number;
  /** Depth of the sharp band, world units — DepthOfField `focusRange`. */
  range: number;
  /** Horizon tilt in radians. Tiny; a drone leaning into its turn. */
  roll: number;
}

export interface CineRig {
  readonly name: string;
  /** The glass this rig is shot on. Handy for a "40mm f/2" debug overlay. */
  readonly lens: Lens;
  /**
   * Drive the camera for one frame.
   *
   * `t` is elapsed seconds and `dt` the delta — pass the SLOW-MO-SCALED clock
   * if you want the camera to slow with the world (you do; see slowmo.ts).
   * Accepts any camera; fov is only written to a perspective one.
   */
  update(camera: THREE.Camera, dt: number, t: number): void;
  /** Focus distance in world units, as pulled this frame. */
  focus(): number;
  /** Bokeh scale for the depth-of-field pass. */
  bokeh(): number;
  /** Depth of the sharp band in world units, for `focusRange`. */
  range(): number;
  /** The authored pose as data — pure in `t`, for the harness or the bridge. */
  pose(t: number): CinePose;
  /**
   * 0..1 — how hard the moment is landing. Feed it slowmo's `swell`: the shot
   * pushes in a breath and the aperture opens about half a stop, so the world
   * goes shallow exactly when the child is being told they did something
   * wonderful. Cheap, and it is the difference between a slow-mo and a beat.
   */
  emphasis(a: number): void;
}

/** Everything a rig's solver has to answer for at time t. */
interface Solved {
  pos: THREE.Vector3;
  aim: THREE.Vector3;
  /** What the lens is focused ON. Usually the subject, not the aim point. */
  focusAt: THREE.Vector3;
  roll: number;
}

interface RigSpec {
  name: string;
  lens: Lens;
  /**
   * World-unit amplitude of the operator's breath, applied in screen space.
   *
   * BREATH, NOT SHAKE. There is deliberately no high-frequency tremor channel
   * anywhere in this file. Handheld jitter is the cheapest way to fake
   * "filmed", and on a big screen it is also the fastest way to make a child
   * feel sick. Everything here runs below half a hertz.
   */
  shoulder: number;
  shoulderHz: number;
  seed: number;
  /**
   * 0..1 lean toward a tilt-shift "toy town" look. Only the drone uses it:
   * physics says a 24mm at 130m is sharp from here to the pine wall, and a
   * tilt-shift lens is the one real, physical piece of glass that turns a
   * valley into a tabletop. We model its wedge-shaped focal plane as a
   * shortened sharp band and a lifted blur — an honest art choice, flagged
   * here rather than smuggled into the maths above.
   */
  miniature?: number;
  solve: (t: number, out: Solved) => void;
}

const MINIATURE_BOKEH = 1.05;

/* ================================================================== *
 * 4.  THE RIG
 * ================================================================== */

const _fwd = /* @__PURE__ */ new THREE.Vector3();
const _right = /* @__PURE__ */ new THREE.Vector3();
const _up = /* @__PURE__ */ new THREE.Vector3();
const _off = /* @__PURE__ */ new THREE.Vector3();
const WORLD_UP = /* @__PURE__ */ new THREE.Vector3(0, 1, 0);

/** How fast the focus puller reacts: τ ≈ 0.24s, so a big rack settles in
 *  about 0.7s. A good assistant, not a servo. */
const PULL_RATE = 4.2;

class Rig implements CineRig {
  readonly name: string;
  readonly lens: Lens;

  private readonly spec: RigSpec;
  private readonly swayX: (t: number) => number;
  private readonly swayY: (t: number) => number;
  private readonly live: Solved = newSolved();
  private readonly probe: Solved = newSolved();
  /** Mutated in place so the frame loop allocates nothing. */
  private readonly eff: Lens;
  private focusM: number;
  private emph = 0;

  constructor(spec: RigSpec) {
    this.spec = spec;
    this.name = spec.name;
    this.lens = spec.lens;
    this.eff = { ...spec.lens };
    this.swayX = makeDrift(spec.seed, spec.shoulderHz);
    this.swayY = makeDrift(spec.seed + 977, spec.shoulderHz * 0.83);
    // Start the puller already racked to the opening frame — no rack-in pop.
    this.solveAt(0, this.live);
    this.focusM = Math.max(0.05, this.live.pos.distanceTo(this.live.focusAt));
  }

  /** Authored pose at t, including the operator's breath and a ground floor. */
  private solveAt(t: number, out: Solved): void {
    this.spec.solve(t, out);

    // The breath is applied in SCREEN space, not world axes: a camera on a
    // shoulder drifts left-and-up relative to what it is looking at, which is
    // the only version of this that survives the camera turning around.
    const amp = this.spec.shoulder;
    if (amp > 0) {
      _fwd.subVectors(out.aim, out.pos);
      const len = _fwd.length();
      if (len > 1e-4) {
        _fwd.divideScalar(len);
        _right.crossVectors(_fwd, WORLD_UP);
        if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
        _right.normalize();
        _up.crossVectors(_right, _fwd).normalize();
        _off.copy(_right).multiplyScalar(this.swayX(t) * amp)
          .addScaledVector(_up, this.swayY(t) * amp * 0.72);
        out.pos.add(_off);
        // The aim follows only partly, so the breath is a small pan as well
        // as a small dolly — a rig that translates without rotating reads as
        // a machine.
        out.aim.addScaledVector(_off, 0.35);
      }
    }

    // The push of emphasis: in toward the subject, never past it.
    if (this.emph > 0) {
      out.pos.lerp(out.aim, 0.035 * this.emph);
    }

    // Nothing, ever, goes under the snow.
    const floor = terrainHeight(out.pos.x, out.pos.z) + GROUND_CLEARANCE;
    if (out.pos.y < floor) out.pos.y = floor;
  }

  /** Effective glass this frame — emphasis opens the iris about half a stop. */
  private effLens(): Lens {
    this.eff.focalMm = this.lens.focalMm;
    this.eff.sensorMm = this.lens.sensorMm;
    this.eff.fStop = this.lens.fStop / (1 + 0.45 * this.emph);
    return this.eff;
  }

  /**
   * Focus breathing. A real lens shortens as it racks close, so the frame
   * opens a hair when the focus pulls in. It is a 1-2% effect and it is one
   * of those details nobody names and everybody feels.
   */
  private fovFor(lens: Lens, focusM: number): number {
    const s = Math.max(focusM * 1000, lens.focalMm * 1.02);
    const magnification = lens.focalMm / (s - lens.focalMm);
    return focalToFov(lens.focalMm * (1 - 0.5 * magnification), lens.sensorMm);
  }

  update(camera: THREE.Camera, dt: number, t: number): void {
    const s = this.live;
    this.solveAt(t, s);

    // The puller arrives a beat after the subject. Clamped dt so a stalled
    // tab cannot snap focus in a single frame.
    const want = Math.max(0.05, s.pos.distanceTo(s.focusAt));
    const step = 1 - Math.exp(-Math.min(0.1, Math.max(0, dt)) * PULL_RATE);
    this.focusM += (want - this.focusM) * step;

    camera.position.copy(s.pos);
    camera.up.copy(WORLD_UP);
    camera.lookAt(s.aim);
    if (s.roll !== 0) camera.rotateZ(s.roll);

    const cam = camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera) {
      const fov = this.fovFor(this.effLens(), this.focusM);
      // Compared against the CAMERA, never against a value cached on the rig.
      // Cache it on the rig and cycling plaza → drone → plaza silently skips
      // the write, because the rig's own fov has not changed even though the
      // camera is still wearing the drone's 24mm. Rebuilding the projection
      // matrix is the cheap half of this; being right is the other half.
      if (Math.abs(fov - cam.fov) > 1e-4) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
    }
  }

  focus(): number {
    return this.focusM;
  }

  /**
   * Bokeh for one lens and one focus distance. Lives here, rather than inline
   * in both `bokeh()` and `pose()`, because those are the two ways this rig
   * reaches the DoF pass and they must never disagree about the same frame.
   */
  private bokehFor(lens: Lens, focusM: number): number {
    const physical = bokehScaleFor(lens, focusM);
    const mini = this.spec.miniature ?? 0;
    return mini > 0 ? Math.max(physical, mini * MINIATURE_BOKEH) : physical;
  }

  /** Sharp band for one lens and one focus distance. Same reason as above. */
  private rangeFor(lens: Lens, focusM: number): number {
    const physical = focusRangeFor(lens, focusM);
    const mini = this.spec.miniature ?? 0;
    if (mini <= 0) return physical;
    // A tilt narrows the sharp wedge to a slice of the frame, not the whole
    // depth of the valley.
    //
    // Blend down from the FOCUS DISTANCE, never from `physical`: past the
    // hyperfocal `physical` is the MAX_RANGE sentinel, and interpolating out
    // of 5000 left the drone holding a 1300-unit sharp band over a 260-unit
    // valley — a tilt-shift that blurred precisely nothing.
    const open = Math.min(physical, focusM);
    return THREE.MathUtils.lerp(open, Math.max(MIN_RANGE, focusM * 0.42), mini);
  }

  bokeh(): number {
    return this.bokehFor(this.effLens(), this.focusM);
  }

  range(): number {
    return this.rangeFor(this.effLens(), this.focusM);
  }

  pose(t: number): CinePose {
    const s = this.probe;
    this.solveAt(t, s);
    const focusM = Math.max(0.05, s.pos.distanceTo(s.focusAt));
    const lens = this.effLens();
    return {
      position: [s.pos.x, s.pos.y, s.pos.z],
      target: [s.aim.x, s.aim.y, s.aim.z],
      fov: this.fovFor(lens, focusM),
      focus: focusM,
      bokeh: this.bokehFor(lens, focusM),
      range: this.rangeFor(lens, focusM),
      roll: s.roll,
    };
  }

  emphasis(a: number): void {
    this.emph = THREE.MathUtils.clamp(a, 0, 1);
  }
}

function newSolved(): Solved {
  return {
    pos: new THREE.Vector3(),
    aim: new THREE.Vector3(),
    focusAt: new THREE.Vector3(),
    roll: 0,
  };
}

/* ================================================================== *
 * 5.  THE THREE SHOTS
 * ================================================================== */

export const CINE_ORDER = ["plazaCam", "droneCam", "chessPaaCam"] as const;
export type CineName = (typeof CINE_ORDER)[number];

/** Cycle to the next rig — this is what the key press calls. */
export function nextCine(current: CineName | null, dir: number = 1): CineName {
  const i = current ? CINE_ORDER.indexOf(current) : -1;
  const n = CINE_ORDER.length;
  return CINE_ORDER[(((i + dir) % n) + n) % n];
}

/** The key that cycles the shots. Exported so the HUD can say "press C". */
export const CINE_KEY = "c";

/**
 * Install the key press: C for the next shot, shift-C for the previous one.
 * Returns a detach function — call it on unmount.
 *
 * Lives here rather than in the scene so the cycle order, the key and the
 * rigs can never drift apart. Takes no action of its own: it hands you a
 * name and you decide what a shot change means.
 */
export function attachCineCycle(
  onChange: (name: CineName, dir: number) => void,
  target: Window | HTMLElement = typeof window !== "undefined" ? window : ({} as Window)
): () => void {
  let current: CineName | null = null;
  const onKey = (ev: Event) => {
    const e = ev as KeyboardEvent;
    // Never steal a keystroke from someone typing, and never fight a browser
    // shortcut.
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
    if (e.key.toLowerCase() !== CINE_KEY) return;
    const dir = e.shiftKey ? -1 : 1;
    current = nextCine(current, dir);
    onChange(current, dir);
  };
  const t = target as { addEventListener?: typeof window.addEventListener; removeEventListener?: typeof window.removeEventListener };
  t.addEventListener?.("keydown", onKey);
  return () => t.removeEventListener?.("keydown", onKey);
}

export interface CinematicOptions {
  /** Soles of ChessPaa's boots, world space. */
  chessPaaAt?: THREE.Vector3;
  /** His yaw in radians. He faces +Z at 0 — same convention as <ChessPaa/>. */
  chessPaaFacing?: number;
  /** Shifts every drift phase; same seed → same park, every run. */
  seed?: number;
}

export function makeCinematicRigs(opts: CinematicOptions = {}): Record<CineName, CineRig> {
  const seed = opts.seed ?? 8123;

  /* ---------------------------------------------------------------- *
   * PLAZA — low, warm, intimate.
   *
   * Height is the whole shot: 1.3 above the flagstones puts the lens
   * between a seven-year-old's eye line and ChessPaa's swinging lantern.
   * Everything in the park is suddenly a little taller than you, which is
   * exactly how a fair feels when you are small.
   *
   * The bearing is chosen so the low sun rakes in from camera right at
   * about 110° — side light, the light that models form. Dead front light
   * would flatten the tent stripes into wallpaper.
   *
   * WHAT THIS SHOT ACTUALLY HOLDS, measured: it stands ~5.9 off the big
   * top's doorway and looks THROUGH it, so the frame is lit canvas, the
   * light pool on the snow, and the board at the origin. The tent's peak
   * (13.4 up, 9 back along -Z) is above the top of frame at every sampled
   * time — this is a doorway shot, not an establishing shot of the tent.
   * If it should read as the whole big top, the subject has to move back
   * and the radius roughly double; that is an art call, not a bug fix.
   * ---------------------------------------------------------------- */
  const plazaSubject = new THREE.Vector3(-0.8, 1.15, -1.2);
  const plazaAz = Math.atan2(SUN.x, SUN.z) + 1.9;
  const plazaArc = makeDrift(seed + 11, 1 / 63);
  const plazaPush = makeDrift(seed + 12, 1 / 47);
  const plazaLean = makeDrift(seed + 13, 1 / 39);

  const plazaCam = new Rig({
    name: "plazaCam",
    // 40mm: the reportage length. Wide enough to hold the doorway and a child
    // in one frame, long enough that nothing at the edges stretches.
    lens: { focalMm: 40, fStop: 2.0, sensorMm: FULL_FRAME_MM },
    shoulder: 0.045,
    shoulderHz: 0.13,
    seed: seed + 101,
    solve: (t, out) => {
      const az = plazaAz + plazaArc(t) * 0.2;
      const radius = 7.4 + plazaPush(t) * 0.75;
      out.pos.set(
        plazaSubject.x - Math.sin(az) * radius,
        0,
        plazaSubject.z - Math.cos(az) * radius
      );
      out.pos.y = terrainHeight(out.pos.x, out.pos.z) + 1.3;
      out.aim.copy(plazaSubject);
      // The operator leans on the shot rather than nailing it to a mark.
      out.aim.x += plazaLean(t) * 0.22;
      out.aim.y += plazaLean(t) * 0.06;
      out.focusAt.copy(plazaSubject);
      out.roll = 0;
    },
  });

  /* ---------------------------------------------------------------- *
   * DRONE — the whole wonderland in one breath.
   *
   * Centred on the CENTROID of the attractions rather than a hand-typed
   * point, so the shot still frames the park if someone moves a ride.
   *
   * It arcs. The yaw is a slow sine, so it eases through the ends of its
   * sweep instead of snapping back, and the drone banks INTO the turn by up
   * to a degree — the horizon tips the way a real aircraft tips. Radius and
   * altitude breathe on their own periods, so the parallax never repeats.
   *
   * The aim sits 20 up rather than on the ground: that lifts the pine ridge
   * and a sliver of dusk sky into the top of the frame. A drone shot with no
   * sky in it is a map, not a photograph.
   * ---------------------------------------------------------------- */
  const centre = new THREE.Vector3();
  const stops = Object.values(ATTRACTIONS);
  for (const a of stops) centre.add(a);
  centre.divideScalar(stops.length);

  const DRONE_AZ0 = 0.3;
  const DRONE_SWEEP = 0.55;
  const DRONE_W = TAU / 97;
  const droneRad = makeDrift(seed + 21, 1 / 61);
  const droneAlt = makeDrift(seed + 22, 1 / 83);
  const droneAim = makeDrift(seed + 23, 1 / 71);

  const droneCam = new Rig({
    name: "droneCam",
    // 24mm at f/5.6 — a real drone's deep, crisp wide.
    lens: { focalMm: 24, fStop: 5.6, sensorMm: FULL_FRAME_MM },
    shoulder: 0.5,
    shoulderHz: 0.055,
    seed: seed + 202,
    miniature: 0.75,
    solve: (t, out) => {
      const az = DRONE_AZ0 + DRONE_SWEEP * Math.sin(t * DRONE_W);
      // Radius and altitude are not taste: they were solved against the real
      // attraction positions and the real height field for the pair that
      // holds all six rides and the river's whole visible course in frame
      // while keeping the horizon inside the top of the picture.
      const radius = 136 + droneRad(t) * 9;
      const alt = 66 + droneAlt(t) * 6;
      out.pos.set(
        centre.x + Math.sin(az) * radius,
        alt,
        centre.z + Math.cos(az) * radius
      );
      out.aim.set(
        centre.x + droneAim(t) * 6,
        16 + droneAim(t) * 2.5,
        centre.z + droneAim(t) * 4
      );
      out.focusAt.set(centre.x, 0, centre.z);
      // Bank into the turn: positive roll drops the left side, and at this
      // phase a rising azimuth is a left-hand turn.
      out.roll = DRONE_SWEEP * DRONE_W * Math.cos(t * DRONE_W) * 0.72;
    },
  });

  /* ---------------------------------------------------------------- *
   * CHESSPAA — the shot the game is actually about.
   *
   * 85mm at f/2.4, focused on the centre of his head from 2.6 away: a head-
   * and-shoulders portrait with the tent behind him melting into honey.
   *
   * The side is CHOSEN, not typed: of the two three-quarter positions we
   * take the one that puts the low sun behind him, so he gets a golden rim
   * through the fur of his cap while his face keeps the lantern's warmth.
   * At 85mm the sun itself sits just outside the top of frame — shooting
   * into the light without ever pointing at it.
   * ---------------------------------------------------------------- */
  // DEFAULTS MIRROR <Park/>: he is placed at [6.2, ground, 60] with
  // rotation.y = -2.6, waiting by the gate. They are copied because Park.tsx
  // is a component and exports no mark for him — if he is ever moved there,
  // move him here too or this shot frames empty snow. Pass `chessPaaAt` and
  // `chessPaaFacing` from whatever owns his transform and the copy stops
  // mattering.
  const base = opts.chessPaaAt
    ? opts.chessPaaAt.clone()
    : new THREE.Vector3(6.2, terrainHeight(6.2, 60), 60);
  const facing = opts.chessPaaFacing ?? -2.6;
  const face = new THREE.Vector3(base.x, base.y + CHESSPAA_FACE_Y, base.z);

  // Both three-quarter positions, scored on how much backlight they buy.
  const sunAz = Math.atan2(SUN.x, SUN.z);
  const bestAz = [facing + 0.62, facing - 0.62].reduce((best, cand) => {
    // Camera sits at `cand`; it therefore LOOKS along cand + π.
    const score = Math.cos(cand + Math.PI - sunAz);
    const bestScore = Math.cos(best + Math.PI - sunAz);
    return score > bestScore ? cand : best;
  });

  const paaArc = makeDrift(seed + 31, 1 / 71);
  const paaPush = makeDrift(seed + 32, 1 / 53);
  const paaAim = makeDrift(seed + 33, 1 / 43);

  const chessPaaCam = new Rig({
    name: "chessPaaCam",
    lens: { focalMm: 85, fStop: 2.4, sensorMm: FULL_FRAME_MM },
    shoulder: 0.014,
    shoulderHz: 0.16,
    seed: seed + 303,
    solve: (t, out) => {
      const az = bestAz + paaArc(t) * 0.1;
      const dist = 2.6 + paaPush(t) * 0.22;
      out.pos.set(
        face.x + Math.sin(az) * dist,
        // A touch below his eye line: a child looking up at a grandfather.
        face.y - 0.11 + paaAim(t) * 0.02,
        face.z + Math.cos(az) * dist
      );
      out.aim.copy(face);
      out.aim.y += 0.02 + paaAim(t) * 0.015;
      // The puller rides his eyes, wherever the arc has taken us.
      out.focusAt.copy(face);
      out.roll = 0;
    },
  });

  return { plazaCam, droneCam, chessPaaCam };
}
