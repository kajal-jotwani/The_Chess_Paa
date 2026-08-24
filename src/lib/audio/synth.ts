"use client";

/**
 * THE INSTRUMENT KIT — every sound in ChessPaa's Wonderland starts here.
 *
 * NOT ONE AUDIO FILE. Every clack, chirp, chord and reverb tail in this park is
 * computed from numbers at play time. That is not a stunt: it means the whole
 * soundscape ships in a few kilobytes, it can be tuned per-event (a pawn and a
 * rook are literally different resonant bodies, not two mp3s), and it can never
 * fall out of sync with the art.
 *
 * ART DIRECTION FOR THE EAR (the audio half of "warm storybook at golden hour"):
 *   - Nothing is allowed to be BRIGHT AND THIN. Every voice gets a body: a low
 *     partial, a wooden resonance, or a felt transient. Cheap web audio sounds
 *     cheap because it is a bare oscillator with a linear ramp; we never do that.
 *   - Transients are FELT, not clicked. Hammers have cloth on them.
 *   - Everything sits in the same room. One code-generated impulse response
 *     glues the park together the way one colour palette glues the visuals.
 *   - Nothing harsh, ever. No sawtooth in the top octave, no buzzers, no clipping.
 *     The master bus ends in a soft limiter so a child mashing the board cannot
 *     make an ugly sound.
 *
 * LAYERING: this file is the bottom of the audio stack and imports nothing from
 * the other audio modules, so there are no cycles:
 *   synth.ts  <-  soundscape.ts / score.ts / chessPaaVoice.ts  <-  index.ts
 */

import { rng } from "@/three/core/textures/procedural";

/* ==================================================================== */
/* 0. SMALL NUMBERS                                                      */
/* ==================================================================== */

/** MIDI note number -> Hz. 69 = A4 = 440. */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Decibels -> linear gain. Written in dB because dB is how ears think. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Cents of detune -> frequency ratio. Used for the fairground-organ wheeze. */
export function centsToRatio(cents: number): number {
  return Math.pow(2, cents / 1200);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * WebAudio's exponentialRampToValueAtTime cannot touch zero, and a linear ramp
 * to zero sounds like a fade on a mixing desk rather than a note dying. Every
 * envelope in this file therefore decays to this floor and is then hard-zeroed.
 */
const SILENCE = 0.00012;

/* ==================================================================== */
/* 1. THE ENGINE — context, buses, the one shared room                   */
/* ==================================================================== */

export type BusName = "music" | "sfx" | "ambience" | "voice";

export const BUS_NAMES: readonly BusName[] = ["music", "sfx", "ambience", "voice"];

export interface AudioEngine {
  readonly ctx: AudioContext;
  /** Global volume + mute live here. Everything audible passes through it. */
  readonly master: GainNode;
  /**
   * Connect a source to `buses[name]` and it inherits that family's volume,
   * ducking and default reverb amount. This is the node you want 95% of the time.
   */
  readonly buses: Readonly<Record<BusName, GainNode>>;
  /** Extra long-hall wet for a single sound (chimes, fanfares, reveals). */
  readonly hallSends: Readonly<Record<BusName, GainNode>>;
  /** Extra short-wooden-room wet for a single sound (clacks, footsteps). */
  readonly roomSends: Readonly<Record<BusName, GainNode>>;
  /**
   * Pull music + ambience down while ChessPaa is talking, then let them back up.
   * `depth` is linear (0.45 = drop to 45%), `hold` is seconds at the low level.
   */
  duck(depth: number, hold: number): void;
  /** Deterministic seed for anything that wants stable randomness this session. */
  readonly seed: number;
}

let engine: AudioEngine | null = null;
let engineDead = false;

interface WebkitWindow {
  webkitAudioContext?: typeof AudioContext;
}

function makeContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as WebkitWindow).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor({ latencyHint: "interactive" });
  } catch {
    try {
      // Some browsers reject the options bag; the bare constructor still works.
      return new Ctor();
    } catch {
      return null;
    }
  }
}

/**
 * Build the whole mixing desk once.
 *
 *   source ──▶ buses[b] ──▶ duck[b] ──┐
 *                    │                ├──▶ master ──▶ warmth ──▶ limiter ──▶ out
 *                    └▶ busTap ──▶ hall/room ──▶ return ──┘
 *
 * Mute sits on `master` so it kills reverb tails too — a child hitting mute
 * expects SILENCE, not two seconds of hall.
 */
function buildEngine(): AudioEngine | null {
  const ctx = makeContext();
  if (!ctx) return null;

  // --- master chain -------------------------------------------------
  const master = ctx.createGain();
  master.gain.value = 1;

  // "Warmth": shave the brittle top and the rumbling bottom. This single pair of
  // filters is most of the difference between "web audio demo" and "cosy".
  const warmthHi = ctx.createBiquadFilter();
  warmthHi.type = "highpass";
  warmthHi.frequency.value = 38;
  const warmthLo = ctx.createBiquadFilter();
  warmthLo.type = "lowpass";
  warmthLo.frequency.value = 13500;
  warmthLo.Q.value = 0.5;

  // Safety limiter: a kid can trigger twenty sounds in a second and it must
  // still be pleasant. Slow release so it breathes rather than pumps.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -9;
  limiter.knee.value = 8;
  limiter.ratio.value = 10;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.28;

  master.connect(warmthHi);
  warmthHi.connect(warmthLo);
  warmthLo.connect(limiter);
  limiter.connect(ctx.destination);

  // --- the two rooms ------------------------------------------------
  // One warm wooden hall (music, voice, chimes) and one small room (clacks).
  // Both impulses are generated below from seeded noise: no .wav anywhere.
  const hall = ctx.createConvolver();
  hall.buffer = renderImpulse(ctx, {
    seconds: 2.9,
    decay: 2.4,
    seed: 20250823,
    damping: 0.72,
    predelay: 0.022,
    earlyTaps: 9,
    energy: 0.85,
  });
  const hallReturn = ctx.createGain();
  hallReturn.gain.value = 0.85;
  hall.connect(hallReturn);
  hallReturn.connect(master);

  const room = ctx.createConvolver();
  room.buffer = renderImpulse(ctx, {
    seconds: 0.62,
    decay: 3.1,
    seed: 4242,
    damping: 0.55,
    predelay: 0.005,
    earlyTaps: 5,
    energy: 0.6,
  });
  const roomReturn = ctx.createGain();
  roomReturn.gain.value = 0.7;
  room.connect(roomReturn);
  roomReturn.connect(master);

  // --- per-family buses ---------------------------------------------
  const buses: Record<BusName, GainNode> = {} as Record<BusName, GainNode>;
  const ducks: Record<BusName, GainNode> = {} as Record<BusName, GainNode>;
  const hallSends: Record<BusName, GainNode> = {} as Record<BusName, GainNode>;
  const roomSends: Record<BusName, GainNode> = {} as Record<BusName, GainNode>;

  // Default wet per family. Music lives in the hall; clacks live in the room and
  // stay mostly dry or the board turns to soup.
  const defaultHall: Record<BusName, number> = {
    music: 0.3,
    sfx: 0.1,
    ambience: 0.16,
    voice: 0.24,
  };
  const defaultRoom: Record<BusName, number> = {
    music: 0.04,
    sfx: 0.22,
    ambience: 0.08,
    voice: 0.06,
  };
  const defaultLevel: Record<BusName, number> = {
    music: 0.85,
    sfx: 1.0,
    ambience: 0.9,
    voice: 1.0,
  };

  for (const name of BUS_NAMES) {
    const input = ctx.createGain();
    input.gain.value = defaultLevel[name];
    const duckNode = ctx.createGain();
    duckNode.gain.value = 1;
    input.connect(duckNode);
    duckNode.connect(master);

    // Post-fader family sends: turning a bus down turns its reverb down too.
    const hTap = ctx.createGain();
    hTap.gain.value = defaultHall[name];
    duckNode.connect(hTap);
    hTap.connect(hall);

    const rTap = ctx.createGain();
    rTap.gain.value = defaultRoom[name];
    duckNode.connect(rTap);
    rTap.connect(room);

    // Per-sound extra wet (pre-fader, post-mute) for the big moments.
    const hSend = ctx.createGain();
    hSend.gain.value = 1;
    hSend.connect(hall);
    const rSend = ctx.createGain();
    rSend.gain.value = 1;
    rSend.connect(room);

    buses[name] = input;
    ducks[name] = duckNode;
    hallSends[name] = hSend;
    roomSends[name] = rSend;
  }

  const duck = (depth: number, hold: number): void => {
    const t = ctx.currentTime;
    const d = clamp(depth, 0.05, 1);
    // Duck fast (people notice a slow duck as a mistake), recover slowly and
    // musically so the park seems to lean back in rather than snap back.
    for (const name of ["music", "ambience"] as const) {
      const g = ducks[name].gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(d, t + 0.09);
      g.setValueAtTime(d, t + 0.09 + Math.max(0, hold));
      g.linearRampToValueAtTime(1, t + 0.09 + Math.max(0, hold) + 0.75);
    }
  };

  return {
    ctx,
    master,
    buses,
    hallSends,
    roomSends,
    duck,
    seed: 0x5eed,
  };
}

/**
 * Lazily create the audio engine. Returns null (never throws) when audio is
 * unavailable or still blocked — every caller in this codebase treats null as
 * "stay silent and carry on", so a locked-down browser simply gets a quiet park.
 */
export function getAudioEngine(): AudioEngine | null {
  if (engine) return engine;
  if (engineDead) return null;
  try {
    engine = buildEngine();
  } catch {
    engine = null;
  }
  if (!engine) engineDead = true;
  return engine;
}

/** True once a context exists and is actually running. */
export function audioRunning(): boolean {
  return engine != null && engine.ctx.state === "running";
}

/** Resume a suspended context. Safe to call from anywhere, resolves either way. */
export async function resumeAudio(): Promise<void> {
  const e = getAudioEngine();
  if (!e) return;
  if (e.ctx.state === "running") return;
  try {
    await e.ctx.resume();
  } catch {
    /* autoplay policy said no; the next gesture will try again */
  }
}

/** Current audio clock, or 0 if there is no audio. Never throws. */
export function audioNow(): number {
  const e = getAudioEngine();
  return e ? e.ctx.currentTime : 0;
}

/** Run `fn` only if audio exists; swallow anything it throws. Returns success. */
export function withEngine(fn: (e: AudioEngine) => void): boolean {
  const e = getAudioEngine();
  if (!e) return false;
  try {
    fn(e);
    return true;
  } catch {
    return false;
  }
}

/* ==================================================================== */
/* 2. NOISE + THE CODE-GENERATED ROOM                                    */
/* ==================================================================== */

const bufferCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

function cached(ctx: BaseAudioContext, key: string, make: () => AudioBuffer): AudioBuffer {
  let m = bufferCache.get(ctx);
  if (!m) {
    m = new Map();
    bufferCache.set(ctx, m);
  }
  const hit = m.get(key);
  if (hit) return hit;
  const made = make();
  m.set(key, made);
  return made;
}

export type NoiseColour = "white" | "pink" | "brown";

/**
 * Seeded noise, cached per context.
 *
 * WHY PINK MATTERS: white noise is the sound of a broken television. Wind,
 * breath, distant crowds and fabric are all roughly pink (equal energy per
 * octave), which is why the pink bed reads as "outdoors on a mild evening"
 * while the same gain of white noise reads as "hiss".
 */
export function noiseBuffer(
  ctx: BaseAudioContext,
  seconds: number,
  seed: number,
  colour: NoiseColour = "white",
): AudioBuffer {
  const key = `noise|${seconds}|${seed}|${colour}`;
  return cached(ctx, key, () => {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    const r = rng(seed);
    if (colour === "white") {
      for (let i = 0; i < len; i++) data[i] = r() * 2 - 1;
    } else if (colour === "brown") {
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = r() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        data[i] = last * 3.5;
      }
    } else {
      // Paul Kellet's pink filter: cheap, stable, and close enough to -3dB/oct
      // that no one has ever heard the difference outside a lab.
      let b0 = 0,
        b1 = 0,
        b2 = 0,
        b3 = 0,
        b4 = 0,
        b5 = 0,
        b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = r() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
        data[i] = out * 0.11;
      }
    }
    // Loop-safe: cross-fade the last 40ms into the head so a looped bed has no
    // seam. A clicking wind loop is the most obvious "this is fake" tell there is.
    const fade = Math.min(Math.floor(ctx.sampleRate * 0.04), Math.floor(len / 4));
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      data[i] = data[i] * t + data[len - fade + i] * (1 - t);
    }
    return buf;
  });
}

export interface ImpulseOptions {
  /** Tail length in seconds. */
  seconds: number;
  /** Decay exponent — higher is a faster, tighter tail. */
  decay: number;
  seed: number;
  /**
   * 0..1 how fast the highs die relative to the lows. Real wooden rooms eat
   * treble first; a reverb without this sounds like cheap digital sparkle.
   */
  damping: number;
  /** Silence before the tail — this is what makes a room feel BIG. */
  predelay: number;
  /** A few discrete early reflections give the room walls and a size. */
  earlyTaps: number;
  /**
   * Target energy, sqrt(sum of squares), per channel. See the normalisation
   * note at the bottom of renderImpulse — this is the number that decides how
   * loud the room is, and getting it wrong is how convolution reverbs blow up.
   */
  energy?: number;
}

/**
 * THE ROOM, GENERATED FROM NOISE.
 *
 * A convolution reverb is just "play this recording of a handclap in a room".
 * We synthesise that recording: an exponentially-decaying noise burst, run
 * through a one-pole lowpass whose cutoff *falls over time* (so the tail gets
 * progressively darker and woodier, exactly like a hall full of pine and
 * canvas), plus a handful of sparse early reflections that tell the ear how
 * far away the walls are.
 */
export function renderImpulse(ctx: BaseAudioContext, opts: ImpulseOptions): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(16, Math.floor(sr * opts.seconds));
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(sr * Math.max(0, opts.predelay));

  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    // Different seed per channel = genuine stereo width without any phase tricks.
    const r = rng(opts.seed + ch * 9176);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre); // 0..1 through the tail
      const env = Math.pow(1 - t, opts.decay);
      // Cutoff coefficient falls from ~open to nearly closed across the tail.
      const a = lerp(0.9, 0.06, Math.pow(t, 0.65)) * (1 - opts.damping * 0.55);
      const w = r() * 2 - 1;
      lp += (w - lp) * clamp(a, 0.02, 0.98);
      data[i] = lp * env;
    }
    // Early reflections: alternating polarity, jittered per channel.
    const er = rng(opts.seed + 555 + ch * 31);
    for (let k = 0; k < opts.earlyTaps; k++) {
      const at = pre + Math.floor((0.004 + er() * 0.055) * sr);
      if (at >= len) continue;
      data[at] += (k % 2 === 0 ? 1 : -1) * (0.55 - k * 0.05) * (0.6 + er() * 0.4);
    }
  }

  /*
   * NORMALISE BY ENERGY, NOT BY PEAK.
   *
   * This is the single most important line in the reverb and it cost us a
   * measured 12dB of limiter crush before it was fixed. Convolution multiplies
   * a sustained signal by roughly sqrt(sum(h^2)) — the ENERGY of the impulse —
   * not by its peak. A three-second noise tail normalised to peak 0.6 has an
   * energy of ~40, so a held organ chord came out forty times too loud and the
   * master limiter spent the whole fanfare pumping. Scaling each channel so
   * sqrt(sum(h^2)) = `energy` makes the wet path unity-gain for sustained
   * material, which is what every hardware reverb does.
   */
  const target = opts.energy ?? 0.8;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let sum = 0;
    for (let i = 0; i < len; i++) sum += d[i] * d[i];
    const e = Math.sqrt(sum);
    if (e <= 0) continue;
    let g = target / e;
    // Safety: never let a single early reflection clip on its own.
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak * g > 0.9) g = 0.9 / peak;
    for (let i = 0; i < len; i++) d[i] *= g;
  }
  return buf;
}

/* ==================================================================== */
/* 3. ENVELOPES + PLUMBING                                               */
/* ==================================================================== */

export interface Envelope {
  /** Seconds to peak. Under ~4ms reads as a click; over ~40ms reads as soft. */
  attack?: number;
  /** Seconds from peak to the sustain level (or to silence if sustain is 0). */
  decay?: number;
  /** 0..1 of peak. 0 = percussive. */
  sustain?: number;
  /** Seconds from sustain to silence after `dur`. */
  release?: number;
  /** Linear peak gain. */
  peak?: number;
}

/**
 * Write an ADSR onto a gain param and return the time it is fully silent.
 * All ramps are exponential because loudness is logarithmic — a linear fade
 * sounds like it "hangs" at the end and then vanishes.
 */
export function shapeGain(g: GainNode, t0: number, dur: number, env: Envelope): number {
  const peak = Math.max(env.peak ?? 1, SILENCE * 2);
  const a = Math.max(env.attack ?? 0.006, 0.0005);
  const d = Math.max(env.decay ?? 0.12, 0.001);
  const s = clamp(env.sustain ?? 0, 0, 1);
  const rel = Math.max(env.release ?? 0.18, 0.004);
  const p = g.gain;
  p.cancelScheduledValues(t0);
  p.setValueAtTime(SILENCE, t0);
  p.exponentialRampToValueAtTime(peak, t0 + a);

  if (s <= 0.001) {
    // Percussive: one long exponential fall, which is what struck things do.
    const end = t0 + a + Math.max(d, dur);
    p.exponentialRampToValueAtTime(SILENCE, end);
    p.setValueAtTime(0, end + 0.001);
    return end + 0.01;
  }

  const sustainLevel = Math.max(peak * s, SILENCE * 2);
  p.exponentialRampToValueAtTime(sustainLevel, t0 + a + d);
  const relStart = Math.max(t0 + a + d, t0 + dur);
  p.setValueAtTime(sustainLevel, relStart);
  p.exponentialRampToValueAtTime(SILENCE, relStart + rel);
  p.setValueAtTime(0, relStart + rel + 0.001);
  return relStart + rel + 0.01;
}

/**
 * Merge a caller's envelope over a voice's default SHAPE, and make `gain`
 * AUTHORITATIVE: `env.peak` is a multiplier on `gain` (default 1), never a
 * replacement for it.
 *
 * This exists because of a real and expensive bug. The first version let a
 * caller-supplied `env` replace the default outright, so any call that passed
 * `env: { ..., peak: 1 }` to shape its attack silently threw the `gain`
 * argument away and played at FULL SCALE. Measured on the master bus, the
 * checkmate fanfare peaked at 3.45 — roughly 20dB into the limiter, which is
 * why it sounded squashed rather than plush. `gain` sets how loud; `env` sets
 * how it moves. They are never the same knob again.
 */
function resolveEnv(gain: number, base: Envelope, override?: Envelope): Envelope {
  const merged: Envelope = { ...base, ...(override ?? {}) };
  merged.peak = gain * (override?.peak ?? 1);
  return merged;
}

/*
 * MEASURED LOUDNESS NORMALISATION.
 *
 * Every instrument in this file used to interpret `gain` differently: a
 * bandpassed noise burst at gain 0.1 came out at 0.027 while an organ note at
 * gain 0.1 came out at 0.159 — a six-to-one spread, which made mixing the park
 * guesswork. These constants were measured by playing each voice dry into an
 * analyser in a real browser (see the calibration harness) and they scale each
 * one so that `gain` means, near enough, THE PEAK AMPLITUDE YOU WILL GET.
 *
 * They are approximations: a bandpass loses more energy at high Q, and a
 * formant voice is louder on a low vowel than a high one. Close enough that a
 * number in a call site is now a level rather than a wish.
 */
const NORM = {
  mallet: 0.86,
  bell: 0.78,
  wood: 0.73,
  organ: 0.63,
  formant: 2.4,
  noise: 2.6,
  drone: 1.3,
  bed: 2.2,
} as const;

/**
 * WebAudio nodes are garbage-collected only once they are disconnected and have
 * stopped, and a park that plays thousands of sounds an hour will absolutely
 * leak without this. Every voice in this file ends with a call to it.
 */
export function autoDisconnect(src: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
  src.onended = () => {
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        /* already gone */
      }
    }
    try {
      src.disconnect();
    } catch {
      /* already gone */
    }
  };
}

/** A handle for anything that plays until you stop it (beds, drones, rides). */
export interface SustainHandle {
  /** Connect further processing here if you need to; already routed to dest. */
  readonly output: GainNode;
  /** Ramp the level over `ramp` seconds. */
  setGain(v: number, ramp?: number): void;
  /** Fade out and free every node. Idempotent. */
  stop(fade?: number): void;
}

/* ==================================================================== */
/* 4. SPATIALISATION                                                     */
/* ==================================================================== */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface PannerOptions {
  /** Distance at which the sound is at full volume. */
  refDistance?: number;
  /** Beyond this it stops getting quieter. */
  maxDistance?: number;
  /** How steeply it falls off. 1 = physical, lower = more forgiving/filmic. */
  rolloff?: number;
  /** HRTF is richer but costs more CPU — use it only for a handful of anchors. */
  hrtf?: boolean;
}

/**
 * A positioned source. We use the inverse distance model with a gentle rolloff
 * (0.7 rather than 1.0) because a physically correct park is a park where you
 * hear nothing: real 1/r falloff makes the carousel inaudible twenty metres out,
 * and the brief is that it should *drift* across the plaza.
 */
export function createPanner(ctx: BaseAudioContext, opts: PannerOptions = {}): PannerNode {
  const p = ctx.createPanner();
  p.panningModel = opts.hrtf ? "HRTF" : "equalpower";
  p.distanceModel = "inverse";
  p.refDistance = opts.refDistance ?? 8;
  p.maxDistance = opts.maxDistance ?? 320;
  p.rolloffFactor = opts.rolloff ?? 0.7;
  p.coneInnerAngle = 360;
  p.coneOuterAngle = 360;
  p.coneOuterGain = 1;
  return p;
}

/** Move a panner. Uses the AudioParam form when available, else the legacy call. */
export function setPannerPosition(p: PannerNode, x: number, y: number, z: number, when = 0): void {
  const t = when || (p.context ? p.context.currentTime : 0);
  const anyP = p as PannerNode & {
    setPosition?: (x: number, y: number, z: number) => void;
  };
  if ("positionX" in p && p.positionX) {
    // Ramping rather than setting stops zipper noise when a coaster car is
    // moving 20 m/s past the camera.
    p.positionX.setTargetAtTime(x, t, 0.02);
    p.positionY.setTargetAtTime(y, t, 0.02);
    p.positionZ.setTargetAtTime(z, t, 0.02);
  } else if (anyP.setPosition) {
    anyP.setPosition(x, y, z);
  }
}

/**
 * Point the listener. `forward` and `up` come straight from the camera; pass a
 * THREE.Vector3 and it satisfies Vec3Like structurally, so this module never has
 * to import three.
 */
export function setListenerPose(
  ctx: BaseAudioContext,
  pos: Vec3Like,
  forward?: Vec3Like,
  up?: Vec3Like,
): void {
  const l = ctx.listener;
  const t = ctx.currentTime;
  const legacy = l as AudioListener & {
    setPosition?: (x: number, y: number, z: number) => void;
    setOrientation?: (
      fx: number,
      fy: number,
      fz: number,
      ux: number,
      uy: number,
      uz: number,
    ) => void;
  };
  const f = forward ?? { x: 0, y: 0, z: -1 };
  const u = up ?? { x: 0, y: 1, z: 0 };
  if ("positionX" in l && l.positionX) {
    l.positionX.setTargetAtTime(pos.x, t, 0.02);
    l.positionY.setTargetAtTime(pos.y, t, 0.02);
    l.positionZ.setTargetAtTime(pos.z, t, 0.02);
    l.forwardX.setTargetAtTime(f.x, t, 0.03);
    l.forwardY.setTargetAtTime(f.y, t, 0.03);
    l.forwardZ.setTargetAtTime(f.z, t, 0.03);
    l.upX.setTargetAtTime(u.x, t, 0.05);
    l.upY.setTargetAtTime(u.y, t, 0.05);
    l.upZ.setTargetAtTime(u.z, t, 0.05);
  } else {
    legacy.setPosition?.(pos.x, pos.y, pos.z);
    legacy.setOrientation?.(f.x, f.y, f.z, u.x, u.y, u.z);
  }
}

/* ==================================================================== */
/* 5. THE VOICES                                                         */
/* ==================================================================== */

export interface VoiceBase {
  /** Where it goes. Usually engine.buses.sfx / .music / .ambience. */
  dest: AudioNode;
  /** Absolute context time to start. Defaults to "now + a hair". */
  when?: number;
  /**
   * Linear gain, normalised so it means ROUGHLY THE PEAK AMPLITUDE you will
   * hear (see NORM above). 0.3 is a firm board clack, 0.05 is a whisper.
   * If you also pass `env`, its `peak` multiplies this rather than replacing it.
   */
  gain?: number;
  /** -1..1 stereo placement for non-spatial sounds. */
  pan?: number;
}

function startAt(dest: AudioNode, when?: number): number {
  // A tiny lead-in keeps envelopes sample-accurate instead of being clamped to
  // "now", which is what causes the classic WebAudio click on the first note.
  return when ?? dest.context.currentTime + 0.008;
}

function panned(ctx: BaseAudioContext, dest: AudioNode, pan?: number): AudioNode {
  if (pan === undefined || pan === 0 || !ctx.createStereoPanner) return dest;
  const p = ctx.createStereoPanner();
  p.pan.value = clamp(pan, -1, 1);
  p.connect(dest);
  return p;
}

/* ---------------------------------------------------------------- */
/* 5a. tone — the general-purpose filtered oscillator                */
/* ---------------------------------------------------------------- */

export interface ToneOptions extends VoiceBase {
  freq: number;
  dur?: number;
  type?: OscillatorType;
  env?: Envelope;
  /** Optional glide, in Hz, reached by `bendTime` seconds after the start. */
  bendTo?: number;
  bendTime?: number;
  /** Lowpass on the way out. Everything gets one; nothing here is ever raw. */
  cutoff?: number;
  q?: number;
  /** Vibrato depth in cents and rate in Hz. */
  vibrato?: { cents: number; hz: number; delay?: number };
}

/** One filtered, enveloped oscillator. The workhorse. */
export function tone(opts: ToneOptions): number {
  const ctx = opts.dest.context;
  const t0 = startAt(opts.dest, opts.when);
  const dur = opts.dur ?? 0.3;

  const osc = ctx.createOscillator();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(opts.freq, t0);
  if (opts.bendTo !== undefined) {
    // Exponential because pitch is logarithmic: a linear pitch ramp sounds like
    // a siren, an exponential one sounds like a voice or a spring.
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(opts.bendTo, 1),
      t0 + (opts.bendTime ?? dur),
    );
  }

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = opts.cutoff ?? Math.min(opts.freq * 6 + 900, 12000);
  lp.Q.value = opts.q ?? 0.7;

  const g = ctx.createGain();
  const end = shapeGain(
    g,
    t0,
    dur,
    resolveEnv(opts.gain ?? 0.25, { attack: 0.008, decay: 0.1, sustain: 0.6, release: 0.2 }, opts.env),
  );

  let vibOsc: OscillatorNode | null = null;
  if (opts.vibrato) {
    vibOsc = ctx.createOscillator();
    vibOsc.frequency.value = opts.vibrato.hz;
    const vg = ctx.createGain();
    vg.gain.value = 0;
    // Vibrato that is present from the very first millisecond sounds like a
    // synthesiser; a delayed swell sounds like a person or a bowed string.
    const vd = opts.vibrato.delay ?? 0.12;
    vg.gain.setValueAtTime(0, t0);
    vg.gain.linearRampToValueAtTime(opts.vibrato.cents, t0 + vd + 0.1);
    vibOsc.connect(vg);
    vg.connect(osc.detune);
    vibOsc.start(t0);
    vibOsc.stop(end);
  }

  osc.connect(lp);
  lp.connect(g);
  g.connect(panned(ctx, opts.dest, opts.pan));
  osc.start(t0);
  osc.stop(end);
  autoDisconnect(osc, lp, g);
  return end;
}

/* ---------------------------------------------------------------- */
/* 5b. mallet — soft felt hammer on wood/metal (music box, marimba)   */
/* ---------------------------------------------------------------- */

export interface MalletOptions extends VoiceBase {
  freq: number;
  /** Ring time. Music box ~1.2s, marimba ~0.5s. */
  dur?: number;
  /** 0 = hard stick (bright, clicky), 1 = thick felt (dark, thumpy). */
  softness?: number;
  /** Extra shimmer partial an octave and a fifth up — the "music box" sparkle. */
  shimmer?: number;
}

/**
 * THE SOFT MALLET — the park's main melodic voice.
 *
 * Three ingredients, and all three are needed:
 *   1. a fundamental sine that DROPS about 4% in the first 30ms. Struck bars
 *      always go slightly sharp on impact then settle; without this the note
 *      sounds synthetic no matter what else you do.
 *   2. two quiet inharmonic partials (x2.76, x5.4 — the modes of a struck bar)
 *      that decay much faster than the fundamental. This is the "wood".
 *   3. a felt transient: a few milliseconds of lowpassed noise. This is the
 *      sound of the hammer, not the bar, and it is what makes it feel PLAYED.
 */
export function mallet(opts: MalletOptions): number {
  const ctx = opts.dest.context;
  const t0 = startAt(opts.dest, opts.when);
  const dur = opts.dur ?? 0.9;
  const soft = clamp(opts.softness ?? 0.5, 0, 1);
  const peak = (opts.gain ?? 0.22) * NORM.mallet;
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(panned(ctx, opts.dest, opts.pan));

  let end = t0;

  // 1. fundamental with the impact pitch-drop
  const f = ctx.createOscillator();
  f.type = "sine";
  f.frequency.setValueAtTime(opts.freq * 1.04, t0);
  f.frequency.exponentialRampToValueAtTime(opts.freq, t0 + 0.03);
  const fg = ctx.createGain();
  end = Math.max(
    end,
    shapeGain(fg, t0, dur, {
      attack: lerp(0.002, 0.012, soft),
      decay: dur,
      sustain: 0,
      peak,
    }),
  );
  f.connect(fg);
  fg.connect(out);
  f.start(t0);
  f.stop(end);
  autoDisconnect(f, fg);

  // 2. bar modes — quieter and much shorter, and darker as the mallet softens
  const modes: Array<[number, number, number]> = [
    [2.76, 0.3 * (1 - soft * 0.7), 0.42],
    [5.4, 0.14 * (1 - soft * 0.85), 0.19],
  ];
  if (opts.shimmer && opts.shimmer > 0) modes.push([3.0, 0.22 * opts.shimmer, 0.7]);
  for (const [ratio, amp, life] of modes) {
    if (amp <= 0.001) continue;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = opts.freq * ratio;
    const g = ctx.createGain();
    const e = shapeGain(g, t0, dur * life, {
      attack: 0.001,
      decay: dur * life,
      sustain: 0,
      peak: peak * amp,
    });
    o.connect(g);
    g.connect(out);
    o.start(t0);
    o.stop(e);
    autoDisconnect(o, g);
  }

  // 3. the felt
  const nb = noiseBuffer(ctx, 0.25, 991, "white");
  const n = ctx.createBufferSource();
  n.buffer = nb;
  const nf = ctx.createBiquadFilter();
  nf.type = "bandpass";
  nf.frequency.value = clamp(opts.freq * 3.2, 220, 6000);
  nf.Q.value = 1.1;
  const ng = ctx.createGain();
  const ne = shapeGain(ng, t0, 0.02, {
    attack: 0.0008,
    decay: lerp(0.03, 0.012, soft),
    sustain: 0,
    peak: peak * lerp(0.5, 0.16, soft),
  });
  n.connect(nf);
  nf.connect(ng);
  ng.connect(out);
  n.start(t0);
  n.stop(ne + 0.02);
  autoDisconnect(n, nf, ng);

  // free the summing node once the longest voice has gone
  const cleanup = ctx.createConstantSource();
  cleanup.offset.value = 0;
  cleanup.connect(out);
  cleanup.start(t0);
  cleanup.stop(end + 0.05);
  autoDisconnect(cleanup, out);
  return end;
}

/* ---------------------------------------------------------------- */
/* 5c. pluck — Karplus-Strong, rendered offline                      */
/* ---------------------------------------------------------------- */

export interface PluckOptions extends VoiceBase {
  freq: number;
  /** Seconds of string. 1.6 is a nylon guitar; 0.5 is a muted ukulele. */
  dur?: number;
  /** 0 = wire-bright, 1 = felt-muted. Controls the loop filter. */
  damping?: number;
  /** How bright the initial excitation is. Low = plucked with a thumb. */
  attackBrightness?: number;
  seed?: number;
}

/**
 * KARPLUS-STRONG STRING, RENDERED INTO A BUFFER.
 *
 * WHY OFFLINE AND NOT A LIVE FEEDBACK LOOP: the WebAudio spec requires any
 * cycle in the graph to contain a DelayNode of at least one render quantum
 * (128 samples ~ 2.9ms), so a live delay-feedback string is pitch-limited to
 * about 344 Hz. Everything above that comes out flat and wrong. Rendering the
 * delay line ourselves gives exact pitch at any frequency, is deterministic,
 * and costs about a tenth of a millisecond per new note. Buffers are cached
 * per (rounded) pitch, so a whole song of plucks allocates a handful of them.
 */
export function karplusBuffer(
  ctx: BaseAudioContext,
  freq: number,
  seconds: number,
  damping: number,
  attackBrightness: number,
  seed: number,
): AudioBuffer {
  const f = Math.round(freq * 2) / 2; // 0.5 Hz buckets keeps the cache small
  const key = `ks|${f}|${seconds}|${damping.toFixed(2)}|${attackBrightness.toFixed(2)}|${seed}`;
  return cached(ctx, key, () => {
    const sr = ctx.sampleRate;
    const len = Math.max(64, Math.floor(sr * seconds));
    const buf = ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);

    const N = Math.max(2, Math.round(sr / f));
    const line = new Float32Array(N);
    const r = rng(seed);

    // Excitation: noise, pre-filtered so the pluck has a thumb on it rather
    // than a razor. attackBrightness 1 = pick, 0.15 = fingertip.
    let prev = 0;
    const ab = clamp(attackBrightness, 0.05, 1);
    for (let i = 0; i < N; i++) {
      const w = r() * 2 - 1;
      prev += (w - prev) * ab;
      line[i] = prev;
    }
    // Normalise the excitation so pitch does not change loudness.
    let m = 0;
    for (let i = 0; i < N; i++) m = Math.max(m, Math.abs(line[i]));
    if (m > 0) for (let i = 0; i < N; i++) line[i] /= m;

    // Loop filter: one-pole lowpass. `a` near 1 = bright wire, near 0 = felt.
    const a = lerp(0.92, 0.35, clamp(damping, 0, 1));
    // Overall energy loss per lap, tuned so the note actually dies inside `seconds`.
    const lossPerLap = Math.pow(0.0008, N / (sr * seconds));
    let idx = 0;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const s = line[idx];
      out[i] = s;
      lp += (s - lp) * a;
      line[idx] = lp * lossPerLap;
      idx = (idx + 1) % N;
    }
    // Final 30ms fade so a cut-short string never clicks.
    const fade = Math.floor(sr * 0.03);
    for (let i = 0; i < fade; i++) out[len - fade + i] *= 1 - i / fade;
    return buf;
  });
}

/** Play a plucked string. Warm, handmade, the sound of a porch instrument. */
export function pluck(opts: PluckOptions): number {
  const ctx = opts.dest.context;
  const t0 = startAt(opts.dest, opts.when);
  const dur = opts.dur ?? 1.4;
  const buf = karplusBuffer(
    ctx,
    opts.freq,
    dur,
    opts.damping ?? 0.45,
    opts.attackBrightness ?? 0.4,
    opts.seed ?? 1337,
  );
  const src = ctx.createBufferSource();
  src.buffer = buf;

  // A body resonance: strings are quiet, boxes are loud. This peaking filter is
  // the soundboard, and it is what stops the pluck sounding like a rubber band.
  const body = ctx.createBiquadFilter();
  body.type = "peaking";
  body.frequency.value = 240;
  body.Q.value = 1.1;
  body.gain.value = 5;

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 6200;

  const g = ctx.createGain();
  // Karplus-Strong already lands within a few percent of unity — no norm needed.
  const peak = opts.gain ?? 0.3;
  g.gain.setValueAtTime(peak, t0);
  g.gain.setTargetAtTime(SILENCE, t0 + dur * 0.85, 0.06);

  src.connect(body);
  body.connect(lp);
  lp.connect(g);
  g.connect(panned(ctx, opts.dest, opts.pan));
  src.start(t0);
  src.stop(t0 + dur + 0.05);
  autoDisconnect(src, body, lp, g);
  return t0 + dur;
}

/* ---------------------------------------------------------------- */
/* 5d. bell — 2-operator FM, for chimes and sparkles                 */
/* ---------------------------------------------------------------- */

export interface BellOptions extends VoiceBase {
  freq: number;
  dur?: number;
  /** Inharmonicity. 1.4 = glassy chime, 2.4 = church bell, 3.5 = tubular. */
  ratio?: number;
  /** How much clang at the start. The index envelope is the whole instrument. */
  index?: number;
  /** Strike noise amount, 0..1. */
  strike?: number;
}

/**
 * FM BELL. The modulation index falls from `index` to zero in the first ~15%
 * of the note: bright metallic clang on the strike, pure sine as it rings out.
 * That single envelope is why FM bells sound real and additive ones do not.
 */
export function bell(opts: BellOptions): number {
  const ctx = opts.dest.context;
  const t0 = startAt(opts.dest, opts.when);
  const dur = opts.dur ?? 1.8;
  const ratio = opts.ratio ?? 1.41;
  const index = opts.index ?? 6;
  const peak = (opts.gain ?? 0.16) * NORM.bell;

  const car = ctx.createOscillator();
  car.type = "sine";
  car.frequency.value = opts.freq;

  const mod = ctx.createOscillator();
  mod.type = "sine";
  mod.frequency.value = opts.freq * ratio;

  const modGain = ctx.createGain();
  modGain.gain.setValueAtTime(opts.freq * index, t0);
  modGain.gain.exponentialRampToValueAtTime(Math.max(opts.freq * 0.02, 1), t0 + dur * 0.18);
  mod.connect(modGain);
  modGain.connect(car.frequency);

  const g = ctx.createGain();
  const end = shapeGain(g, t0, dur, {
    attack: 0.003,
    decay: dur,
    sustain: 0,
    peak,
  });

  // Keep bells out of the ice-pick region — this park is warm, not clinical.
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 9000;

  // ONE panner for the whole bell. Built once and shared, because the strike
  // transient below must land in the same place as the body: a bell panned hard
  // left whose strike is dead centre reads as two separate objects.
  const outDest = panned(ctx, opts.dest, opts.pan);

  car.connect(g);
  g.connect(lp);
  lp.connect(outDest);
  car.start(t0);
  mod.start(t0);
  car.stop(end);
  mod.stop(end);
  autoDisconnect(car, g, lp, modGain);
  autoDisconnect(mod, modGain);

  if (opts.strike && opts.strike > 0) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx, 0.2, 6161, "white");
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = clamp(opts.freq * 2.5, 400, 9000);
    bp.Q.value = 2;
    const ng = ctx.createGain();
    const ne = shapeGain(ng, t0, 0.01, {
      attack: 0.0008,
      decay: 0.03,
      sustain: 0,
      peak: peak * opts.strike * 0.7,
    });
    n.connect(bp);
    bp.connect(ng);
    ng.connect(outDest);
    n.start(t0);
    n.stop(ne + 0.02);
    autoDisconnect(n, bp, ng);
  }
  return end;
}

/* ---------------------------------------------------------------- */
/* 5e. woodKnock — the board's own voice                             */
/* ---------------------------------------------------------------- */

export interface WoodKnockOptions extends VoiceBase {
  /** Pitch of the body. This is what makes a pawn a pawn and a rook a rook. */
  freq: number;
  /** How long the body rings. Small pieces ~0.06s, king ~0.22s. */
  dur?: number;
  /** 0 = hollow tick, 1 = dense solid knock with real low end. */
  weight?: number;
  /** Bright surface click on top, 0..1. */
  click?: number;
}

/**
 * A PIECE PUT DOWN ON A WOODEN BOARD.
 *
 * Modal synthesis: a struck wooden bar rings at roughly 1 : 2.76 : 5.40 with
 * each higher mode decaying faster. Add a filtered noise transient (the felt
 * base of the piece meeting the varnish) and a low thump whose amount is the
 * `weight` of the piece. Getting the RATIO of tick-to-thump right per piece is
 * the whole trick: children identify their rook by the sound of it landing.
 */
export function woodKnock(opts: WoodKnockOptions): number {
  const ctx = opts.dest.context;
  const t0 = startAt(opts.dest, opts.when);
  const dur = opts.dur ?? 0.1;
  const weight = clamp(opts.weight ?? 0.5, 0, 1);
  const peak = (opts.gain ?? 0.3) * NORM.wood;
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(panned(ctx, opts.dest, opts.pan));
  let end = t0;

  const modes: Array<[number, number, number]> = [
    [1.0, 1.0, 1.0],
    [2.76, 0.42 * (1 - weight * 0.4), 0.45],
    [5.4, 0.17 * (1 - weight * 0.6), 0.2],
  ];
  for (const [ratio, amp, life] of modes) {
    const o = ctx.createOscillator();
    o.type = "sine";
    // Tiny downward slide: wood loses tension as the strike energy dissipates.
    o.frequency.setValueAtTime(opts.freq * ratio * 1.02, t0);
    o.frequency.exponentialRampToValueAtTime(opts.freq * ratio, t0 + 0.02);
    const g = ctx.createGain();
    const e = shapeGain(g, t0, dur * life, {
      attack: 0.0009,
      decay: dur * life,
      sustain: 0,
      peak: peak * amp,
    });
    end = Math.max(end, e);
    o.connect(g);
    g.connect(out);
    o.start(t0);
    o.stop(e);
    autoDisconnect(o, g);
  }

  // The low thump — this is "solid", and it is almost all of `weight`.
  if (weight > 0.05) {
    const th = ctx.createOscillator();
    th.type = "sine";
    th.frequency.setValueAtTime(opts.freq * 0.5, t0);
    th.frequency.exponentialRampToValueAtTime(opts.freq * 0.34, t0 + 0.05);
    const tg = ctx.createGain();
    const te = shapeGain(tg, t0, dur * 1.4, {
      attack: 0.002,
      decay: dur * 1.6,
      sustain: 0,
      peak: peak * weight * 0.75,
    });
    end = Math.max(end, te);
    th.connect(tg);
    tg.connect(out);
    th.start(t0);
    th.stop(te);
    autoDisconnect(th, tg);
  }

  // The surface transient.
  const click = opts.click ?? 0.55;
  if (click > 0.01) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx, 0.2, 3771, "white");
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = clamp(opts.freq * 4.5, 500, 7000);
    bp.Q.value = 0.9;
    const ng = ctx.createGain();
    const ne = shapeGain(ng, t0, 0.008, {
      attack: 0.0006,
      decay: 0.016 + weight * 0.02,
      sustain: 0,
      peak: peak * click * 0.55,
    });
    end = Math.max(end, ne);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    n.start(t0);
    n.stop(ne + 0.02);
    autoDisconnect(n, bp, ng);
  }

  const cleanup = ctx.createConstantSource();
  cleanup.offset.value = 0;
  cleanup.connect(out);
  cleanup.start(t0);
  cleanup.stop(end + 0.05);
  autoDisconnect(cleanup, out);
  return end;
}

/* ---------------------------------------------------------------- */
/* 5f. noiseHit — thunks, chuffs, flaps, whooshes                    */
/* ---------------------------------------------------------------- */

export interface NoiseHitOptions extends VoiceBase {
  /** Band centre in Hz. */
  freq: number;
  /** Sweep the band to here over the note — this is what makes a whoosh move. */
  freqTo?: number;
  dur?: number;
  q?: number;
  env?: Envelope;
  colour?: NoiseColour;
  seed?: number;
}

/** A band of noise with an envelope. Half the park's texture is made of these. */
export function noiseHit(opts: NoiseHitOptions): number {
  const ctx = opts.dest.context;
  const t0 = startAt(opts.dest, opts.when);
  const dur = opts.dur ?? 0.15;
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx, 1.0, opts.seed ?? 8123, opts.colour ?? "white");
  n.loop = true;
  // Start reading at a seeded offset so repeated hits are not identical takes.
  const offR = rng((opts.seed ?? 8123) + Math.floor(t0 * 1000));
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(opts.freq, t0);
  if (opts.freqTo !== undefined) {
    bp.frequency.exponentialRampToValueAtTime(Math.max(opts.freqTo, 20), t0 + dur);
  }
  bp.Q.value = opts.q ?? 1.2;

  const g = ctx.createGain();
  const end = shapeGain(
    g,
    t0,
    dur,
    resolveEnv((opts.gain ?? 0.2) * NORM.noise, { attack: 0.004, decay: dur, sustain: 0 }, opts.env),
  );
  n.connect(bp);
  bp.connect(g);
  g.connect(panned(ctx, opts.dest, opts.pan));
  n.start(t0, offR() * 0.9);
  n.stop(end + 0.02);
  autoDisconnect(n, bp, g);
  return end;
}

/* ---------------------------------------------------------------- */
/* 5g. organ — the fairground stack                                  */
/* ---------------------------------------------------------------- */

export interface OrganOptions extends VoiceBase {
  freq: number;
  dur?: number;
  /**
   * Drawbar amplitudes for 8', 4', 2 2/3', 2', 1 3/5'. The twelfth (2 2/3) and
   * the tierce (1 3/5) are what make it a FAIRGROUND organ rather than a church
   * organ — those two stops are the smell of candyfloss.
   */
  drawbars?: readonly number[];
  /** Cents of detune between the two ranks. Old organs are never in tune. */
  spread?: number;
  /** Tremulant depth 0..1. */
  tremulant?: number;
  env?: Envelope;
}

const ORGAN_RATIOS = [1, 2, 3, 4, 5] as const;
const DEFAULT_DRAWBARS = [1.0, 0.55, 0.42, 0.26, 0.2] as const;

/**
 * THE CAROUSEL ORGAN.
 *
 * Two ranks of additive pipes detuned against each other so they beat slowly
 * (the "wheeze"), a tremulant on the whole stack, and a resonant lowpass to put
 * a wooden pipe body around it. Triangle waves, not saw: saw is an accordion in
 * a bad mood, triangle is a wooden flue pipe.
 */
export function organNote(opts: OrganOptions): number {
  const ctx = opts.dest.context;
  const t0 = startAt(opts.dest, opts.when);
  const dur = opts.dur ?? 0.5;
  const bars = opts.drawbars ?? DEFAULT_DRAWBARS;
  const spread = opts.spread ?? 7;
  const peak = (opts.gain ?? 0.09) * NORM.organ;

  const out = ctx.createGain();
  const env = shapeGain(
    out,
    t0,
    dur,
    resolveEnv(peak, { attack: 0.03, decay: 0.06, sustain: 0.82, release: 0.16 }, opts.env),
  );

  // The pipe body.
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = clamp(opts.freq * 9, 900, 4200);
  lp.Q.value = 1.4;

  // Tremulant: a shared LFO on the sum, not per-pipe, so the ranks stay locked.
  const trem = ctx.createGain();
  trem.gain.value = 1;
  if ((opts.tremulant ?? 0.14) > 0) {
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 5.4;
    const lg = ctx.createGain();
    lg.gain.value = opts.tremulant ?? 0.14;
    lfo.connect(lg);
    lg.connect(trem.gain);
    lfo.start(t0);
    lfo.stop(env);
    autoDisconnect(lfo, lg);
  }

  for (let rank = 0; rank < 2; rank++) {
    const detune = rank === 0 ? -spread : spread;
    for (let i = 0; i < bars.length; i++) {
      const amp = bars[i];
      if (amp < 0.02) continue;
      const o = ctx.createOscillator();
      o.type = i === 0 ? "triangle" : "sine";
      o.frequency.value = opts.freq * ORGAN_RATIOS[i];
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = amp * 0.5;
      o.connect(g);
      g.connect(lp);
      o.start(t0);
      o.stop(env);
      autoDisconnect(o, g);
    }
  }

  lp.connect(trem);
  trem.connect(out);
  out.connect(panned(ctx, opts.dest, opts.pan));
  // Free the shared nodes with a silent timer source.
  const cleanup = ctx.createConstantSource();
  cleanup.offset.value = 0;
  cleanup.connect(out);
  cleanup.start(t0);
  cleanup.stop(env + 0.05);
  autoDisconnect(cleanup, lp, trem, out);
  return env;
}

/* ---------------------------------------------------------------- */
/* 5h. formantVoice — the "someone is there" timbre                  */
/* ---------------------------------------------------------------- */

export type Vowel = "mm" | "oo" | "oh" | "ah" | "ee";

/**
 * First three formants (Hz) per vowel. These are the resonances of an actual
 * human throat and mouth; putting them on a buzzy source is what makes a
 * synthetic tone read as A PERSON rather than an instrument. ChessPaa's motif
 * and the distant children's laughter both come from here.
 */
const FORMANTS: Record<Vowel, [number, number, number]> = {
  mm: [260, 1080, 2300],
  oo: [310, 870, 2250],
  oh: [450, 800, 2830],
  ah: [730, 1090, 2440],
  ee: [280, 2250, 2980],
};

export interface FormantVoiceOptions extends VoiceBase {
  freq: number;
  dur?: number;
  vowel?: Vowel;
  /** Glide target in Hz — a falling glide is the sound of concern. */
  bendTo?: number;
  /** 0..1 fraction of the note where the glide starts. */
  bendFrom?: number;
  /** Breath noise mixed in at the same envelope, 0..1. */
  breath?: number;
  /** Vibrato depth in cents. Humans are around 20-40; more than 60 is opera. */
  vibrato?: number;
  env?: Envelope;
  /** Shift the formants: >1 is a smaller head (a child), <1 is a bigger one. */
  formantShift?: number;
}

/**
 * A hummed, wordless voice. This is the closest thing to speech in the park
 * that is still MUSIC, which is exactly what we want for a grandfather's
 * "mmhm" — it carries warmth and intent without ever being a recorded line.
 */
export function formantVoice(opts: FormantVoiceOptions): number {
  const ctx = opts.dest.context;
  const t0 = startAt(opts.dest, opts.when);
  const dur = opts.dur ?? 0.45;
  const vowel = opts.vowel ?? "mm";
  const shift = opts.formantShift ?? 1;
  const peak = (opts.gain ?? 0.13) * NORM.formant;

  const out = ctx.createGain();
  const end = shapeGain(
    out,
    t0,
    dur,
    resolveEnv(peak, { attack: 0.045, decay: 0.08, sustain: 0.78, release: 0.16 }, opts.env),
  );
  // Shared by the voice AND the breath below: breath that stays centred while the
  // voice pans is the tell that a person is a synthesiser.
  const outDest = panned(ctx, opts.dest, opts.pan);
  out.connect(outDest);

  // Source: a sawtooth is the classic glottal stand-in, but raw saw is harsh,
  // so it is immediately tilted down. The vocal folds are not a buzzer.
  const src = ctx.createOscillator();
  src.type = "sawtooth";
  src.frequency.setValueAtTime(opts.freq, t0);
  if (opts.bendTo !== undefined) {
    const bStart = t0 + dur * clamp(opts.bendFrom ?? 0.35, 0, 0.95);
    src.frequency.setValueAtTime(opts.freq, bStart);
    src.frequency.exponentialRampToValueAtTime(Math.max(opts.bendTo, 20), t0 + dur * 0.98);
  }
  const tilt = ctx.createBiquadFilter();
  tilt.type = "lowpass";
  tilt.frequency.value = 2600;
  tilt.Q.value = 0.4;
  src.connect(tilt);

  // Vibrato, delayed — see `tone` for why.
  if ((opts.vibrato ?? 26) > 0) {
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 5.1;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t0);
    lg.gain.linearRampToValueAtTime(opts.vibrato ?? 26, t0 + Math.min(0.22, dur * 0.6));
    lfo.connect(lg);
    lg.connect(src.detune);
    lfo.start(t0);
    lfo.stop(end);
    autoDisconnect(lfo, lg);
  }

  const f = FORMANTS[vowel];
  const gains = [1.0, 0.6, 0.28];
  const qs = [9, 11, 12];
  const filters: AudioNode[] = [];
  for (let i = 0; i < 3; i++) {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = f[i] * shift;
    bp.Q.value = qs[i];
    const g = ctx.createGain();
    g.gain.value = gains[i];
    tilt.connect(bp);
    bp.connect(g);
    g.connect(out);
    filters.push(bp, g);
  }
  // A little unfiltered body underneath, or the formants sound like a telephone.
  const bodyG = ctx.createGain();
  bodyG.gain.value = 0.22;
  tilt.connect(bodyG);
  bodyG.connect(out);
  filters.push(bodyG);

  src.start(t0);
  src.stop(end);
  autoDisconnect(src, tilt, ...filters, out);

  if ((opts.breath ?? 0.12) > 0.01) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx, 1.0, 5150, "pink");
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1700 * shift;
    bp.Q.value = 0.8;
    const bg = ctx.createGain();
    const be = shapeGain(bg, t0, dur, {
      attack: 0.06,
      decay: 0.1,
      sustain: 0.7,
      release: 0.2,
      peak: peak * (opts.breath ?? 0.12),
    });
    n.connect(bp);
    bp.connect(bg);
    bg.connect(outDest);
    n.start(t0);
    n.stop(be + 0.02);
    autoDisconnect(n, bp, bg);
  }
  return end;
}

/* ==================================================================== */
/* 6. SUSTAINED TEXTURES                                                 */
/* ==================================================================== */

export interface NoiseBedOptions {
  dest: AudioNode;
  /** Band centre at full intensity. */
  freq?: number;
  q?: number;
  colour?: NoiseColour;
  seed?: number;
  /** Starting level. */
  gain?: number;
  /** Gust LFO rate in Hz. Wind gusts are SLOW — 0.05-0.15 Hz reads as weather. */
  gustHz?: number;
  gustDepth?: number;
}

export interface NoiseBedHandle extends SustainHandle {
  /**
   * 0..1. Louder AND brighter together — wind that only gets louder sounds like
   * someone turning a knob; wind that opens up as it strengthens sounds like air.
   */
  setIntensity(v: number, ramp?: number): void;
}

/** A continuous filtered-noise texture: wind in the pines, canvas, river hiss. */
export function noiseBed(opts: NoiseBedOptions): NoiseBedHandle {
  const ctx = opts.dest.context;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 4.0, opts.seed ?? 271, opts.colour ?? "pink");
  src.loop = true;

  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  const baseFreq = opts.freq ?? 520;
  bp.frequency.value = baseFreq;
  bp.Q.value = opts.q ?? 0.6;

  // Two lazy LFOs on the band centre, at incommensurate rates, so the wind never
  // audibly repeats. One LFO always sounds like a machine.
  const lfoA = ctx.createOscillator();
  lfoA.frequency.value = opts.gustHz ?? 0.07;
  const lfoAG = ctx.createGain();
  lfoAG.gain.value = baseFreq * 0.45;
  lfoA.connect(lfoAG);
  lfoAG.connect(bp.frequency);

  const lfoB = ctx.createOscillator();
  lfoB.frequency.value = (opts.gustHz ?? 0.07) * 2.7;
  const lfoBG = ctx.createGain();
  lfoBG.gain.value = baseFreq * 0.18;
  lfoB.connect(lfoBG);
  lfoBG.connect(bp.frequency);

  const gust = ctx.createGain();
  gust.gain.value = 1;
  const gLfo = ctx.createOscillator();
  gLfo.frequency.value = (opts.gustHz ?? 0.07) * 1.31;
  const gLfoG = ctx.createGain();
  gLfoG.gain.value = opts.gustDepth ?? 0.35;
  gLfo.connect(gLfoG);
  gLfoG.connect(gust.gain);

  const out = ctx.createGain();
  out.gain.value = 0;
  // `target` is the level at FULL intensity. setGain redefines it (see below) so
  // that the two setters cannot disagree about what "intensity 1" means — the
  // rides call both on the same frame.
  let target = (opts.gain ?? 0.05) * NORM.bed;
  out.gain.setTargetAtTime(target, t0, 1.2);

  src.connect(bp);
  bp.connect(gust);
  gust.connect(out);
  out.connect(opts.dest);
  src.start(t0);
  lfoA.start(t0);
  lfoB.start(t0);
  gLfo.start(t0);

  let stopped = false;
  return {
    output: out,
    setGain(v, ramp = 0.6) {
      if (stopped) return;
      target = Math.max(v, 0) * NORM.bed;
      out.gain.setTargetAtTime(target, ctx.currentTime, Math.max(ramp, 0.01) / 3);
    },
    setIntensity(v, ramp = 1.5) {
      if (stopped) return;
      const intensity = clamp(v, 0, 1);
      const t = ctx.currentTime;
      out.gain.setTargetAtTime(target * intensity, t, Math.max(ramp, 0.01) / 3);
      bp.frequency.setTargetAtTime(baseFreq * lerp(0.7, 1.35, intensity), t, 1.0);
      bp.Q.setTargetAtTime(lerp(1.1, 0.5, intensity), t, 1.0);
    },
    stop(fade = 1.2) {
      if (stopped) return;
      stopped = true;
      const t = ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(Math.max(out.gain.value, SILENCE), t);
      out.gain.linearRampToValueAtTime(0, t + fade);
      const at = t + fade + 0.05;
      src.stop(at);
      lfoA.stop(at);
      lfoB.stop(at);
      gLfo.stop(at);
      autoDisconnect(src, bp, gust, out, lfoAG, lfoBG, gLfoG);
      autoDisconnect(lfoA, lfoAG);
      autoDisconnect(lfoB, lfoBG);
      autoDisconnect(gLfo, gLfoG);
    },
  };
}

export interface DroneOptions {
  dest: AudioNode;
  freq: number;
  /** How many detuned partials. 2-3 for a motor, 1 for a pure pad. */
  voices?: number;
  detuneCents?: number;
  type?: OscillatorType;
  cutoff?: number;
  q?: number;
  gain?: number;
  /** Seconds to fade in. Machines start, they do not appear. */
  attack?: number;
  /** Slow wobble on the pitch, in cents — bearings, belts, old machinery. */
  wobbleCents?: number;
  wobbleHz?: number;
}

export interface DroneHandle extends SustainHandle {
  /** Ride motors change pitch with speed. */
  setFreq(f: number, ramp?: number): void;
  setCutoff(f: number, ramp?: number): void;
}

/** A sustained tone stack: ferris motor, music pad, distant machinery. */
export function drone(opts: DroneOptions): DroneHandle {
  const ctx = opts.dest.context;
  const t0 = ctx.currentTime;
  const n = clamp(opts.voices ?? 2, 1, 5);
  const oscs: OscillatorNode[] = [];
  const detune = opts.detuneCents ?? 8;

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = opts.cutoff ?? 520;
  lp.Q.value = opts.q ?? 1.0;

  const out = ctx.createGain();
  out.gain.value = 0;
  out.gain.setTargetAtTime((opts.gain ?? 0.05) * NORM.drone, t0, Math.max(opts.attack ?? 1.0, 0.02) / 3);

  for (let i = 0; i < n; i++) {
    const o = ctx.createOscillator();
    o.type = opts.type ?? "sawtooth";
    o.frequency.value = opts.freq;
    o.detune.value = (i - (n - 1) / 2) * detune * 2;
    const g = ctx.createGain();
    g.gain.value = 1 / n;
    o.connect(g);
    g.connect(lp);
    o.start(t0);
    oscs.push(o);
  }

  let wobble: OscillatorNode | null = null;
  if ((opts.wobbleCents ?? 0) > 0) {
    wobble = ctx.createOscillator();
    wobble.frequency.value = opts.wobbleHz ?? 0.6;
    const wg = ctx.createGain();
    wg.gain.value = opts.wobbleCents ?? 0;
    wobble.connect(wg);
    for (const o of oscs) wg.connect(o.detune);
    wobble.start(t0);
  }

  lp.connect(out);
  out.connect(opts.dest);

  let stopped = false;
  return {
    output: out,
    setGain(v, ramp = 0.4) {
      if (stopped) return;
      out.gain.setTargetAtTime(Math.max(v, 0) * NORM.drone, ctx.currentTime, Math.max(ramp, 0.01) / 3);
    },
    setFreq(f, ramp = 0.3) {
      if (stopped) return;
      const t = ctx.currentTime;
      for (const o of oscs) o.frequency.setTargetAtTime(Math.max(f, 10), t, Math.max(ramp, 0.01) / 3);
    },
    setCutoff(f, ramp = 0.3) {
      if (stopped) return;
      lp.frequency.setTargetAtTime(clamp(f, 40, 18000), ctx.currentTime, Math.max(ramp, 0.01) / 3);
    },
    stop(fade = 0.8) {
      if (stopped) return;
      stopped = true;
      const t = ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(Math.max(out.gain.value, SILENCE), t);
      out.gain.linearRampToValueAtTime(0, t + fade);
      const at = t + fade + 0.05;
      for (const o of oscs) {
        o.stop(at);
        autoDisconnect(o, lp);
      }
      if (wobble) wobble.stop(at);
      autoDisconnect(oscs[0], lp, out);
    },
  };
}

/* ==================================================================== */
/* 7. A LOOK-AHEAD SCHEDULER                                             */
/* ==================================================================== */

/**
 * Everything rhythmic in the park (the score, birdsong, coaster clacks) uses
 * this. setTimeout jitters by tens of milliseconds and is throttled to 1 Hz in
 * a background tab, which would shred any groove; the fix — the standard
 * WebAudio one — is to wake up often, look 2 seconds into the future and book
 * events on the audio clock, which is sample-accurate.
 */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    /** Called for each slot; must return the length of the slot in seconds. */
    private readonly onSlot: (time: number, index: number) => number,
    private readonly tickMs = 250,
    /**
     * How far ahead to book, in seconds.
     *
     * 2s is right for the SCORE: it survives the 1 Hz throttle browsers apply to
     * hidden tabs, and a bar of music is the same bar whenever you book it.
     *
     * It is WRONG for anything whose slot callback reads live world state. The
     * coaster reads `speed` when it books a clack, so a 2s lookahead means the
     * clack rate you hear is the speed the car had two seconds ago — and the
     * whole drop is about three seconds long, so the rattle arrived after the
     * fall. Reactive schedulers pass a short lookahead (~0.3s) and accept that a
     * hidden tab may stutter, which is fine: nobody is riding it in a hidden tab.
     *
     * Must stay comfortably above `tickMs` or the queue runs dry between ticks.
     */
    private readonly lookahead = 2.0,
  ) {}

  private index = 0;

  start(): void {
    if (this.timer !== null) return;
    this.nextTime = this.ctx.currentTime + 0.12;
    const tick = () => {
      try {
        let guard = 0;
        while (this.nextTime < this.ctx.currentTime + this.lookahead && guard++ < 64) {
          const dur = this.onSlot(this.nextTime, this.index++);
          this.nextTime += Math.max(dur, 0.02);
        }
      } catch {
        /* one bad slot must never kill the music */
      }
    };
    tick();
    this.timer = setInterval(tick, this.tickMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Drop everything not yet booked and begin again from slot 0, right now.
   *
   * Only safe when nothing audible is already in the queue, because booked
   * events cannot be un-booked. The score uses it to leave silence on the
   * downbeat instead of waiting out a bar of nothing that was scheduled before
   * the mood changed.
   */
  restart(): void {
    this.stop();
    this.index = 0;
    this.start();
  }

  get running(): boolean {
    return this.timer !== null;
  }
}

/** Deterministic random stream — re-exported so audio modules never reach for Math.random. */
export { rng };
