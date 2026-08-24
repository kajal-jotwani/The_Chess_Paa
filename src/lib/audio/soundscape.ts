"use client";

/**
 * THE PARK, HEARD.
 *
 * Every sound in ChessPaa's Wonderland is computed here from the primitives in
 * synth.ts. There is no audio file anywhere in this project and there never
 * will be. What that buys us, beyond the file size, is that the park's sounds
 * are PARAMETRIC: a rook is a heavier resonant body than a pawn rather than a
 * second recording, the coaster's clack rate is a function of its actual speed,
 * and the carousel organ is genuinely quieter and darker when you walk away
 * from the plaza because we are computing the air between you and it.
 *
 * THE MIX PHILOSOPHY, in order of who wins:
 *   1. ChessPaa's voice. Always. Everything else ducks under him.
 *   2. The board. A child must hear their own move land, instantly, dry and close.
 *   3. The park. Big, soft, and always *slightly* quieter than you expect. This
 *      is dusk: the crowds are thinning, the birds are settling, the organ is
 *      three hundred metres away across the grass.
 *   4. The score, which is mostly not playing at all (see score.ts).
 *
 * NOTHING IN HERE IS EVER HARSH. There is no buzzer, no error tone, no losing
 * sound. The worst thing that can happen to a child in this park is a soft
 * wooden "mm-mm" and a grandfather saying "ooh, careful".
 */

import { ATTRACTIONS } from "@/three/world/coasterSpine";
import type { PieceType } from "@/three/core/geometry/pieces";
import {
  Scheduler,
  bell,
  clamp,
  createPanner,
  drone,
  formantVoice,
  getAudioEngine,
  lerp,
  mallet,
  midiToFreq,
  noiseBed,
  noiseHit,
  organNote,
  pluck,
  rng,
  setListenerPose,
  setPannerPosition,
  tone,
  woodKnock,
  type AudioEngine,
  type NoiseBedHandle,
  type Vec3Like,
} from "./synth";
import { THEME_MOTIF, THEME_TONIC } from "./score";
import { playChessPaaMotif, chessPaaMurmur } from "./chessPaaVoice";

/* ==================================================================== */
/* EMITTERS — a positioned voice in the world                            */
/* ==================================================================== */

interface EmitterOptions {
  pos: Vec3Like;
  bus: "ambience" | "sfx";
  refDistance?: number;
  rolloff?: number;
  hrtf?: boolean;
  /** Multiplier on the distance-muffling. 1 = normal air, 0 = no filtering. */
  air?: number;
}

interface Emitter {
  /** Connect voices here. */
  readonly input: GainNode;
  readonly panner: PannerNode;
  readonly pos: { x: number; y: number; z: number };
  setPosition(p: Vec3Like): void;
  /** Recompute the distance filter. Called from updateListener, throttled. */
  refresh(listener: Vec3Like): void;
  dispose(): void;
}

const emitters = new Set<Emitter>();

/**
 * A spatialised source with AIR IN FRONT OF IT.
 *
 * A PannerNode alone only changes level and stereo position, which is why pure
 * WebAudio 3D always sounds like a small sound rather than a distant one. Real
 * distance eats treble first (air absorption, plus every tree and tent in the
 * way), so each emitter carries its own lowpass driven by distance to the
 * listener. Walking away from the carousel should sound like walking away from
 * a carousel: it goes soft AND it goes woody.
 */
function createEmitter(engine: AudioEngine, opts: EmitterOptions): Emitter {
  const ctx = engine.ctx;
  const input = ctx.createGain();
  input.gain.value = 1;

  const air = ctx.createBiquadFilter();
  air.type = "lowpass";
  air.frequency.value = 16000;
  air.Q.value = 0.4;

  const panner = createPanner(ctx, {
    refDistance: opts.refDistance ?? 10,
    rolloff: opts.rolloff ?? 0.7,
    maxDistance: 400,
    hrtf: opts.hrtf,
  });

  input.connect(air);
  air.connect(panner);
  panner.connect(engine.buses[opts.bus]);

  const pos = { x: opts.pos.x, y: opts.pos.y, z: opts.pos.z };
  setPannerPosition(panner, pos.x, pos.y, pos.z);
  const airAmount = opts.air ?? 1;
  let lastCut = -1;

  const em: Emitter = {
    input,
    panner,
    pos,
    setPosition(p) {
      pos.x = p.x;
      pos.y = p.y;
      pos.z = p.z;
      setPannerPosition(panner, p.x, p.y, p.z);
    },
    refresh(listener) {
      const dx = pos.x - listener.x;
      const dy = pos.y - listener.y;
      const dz = pos.z - listener.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // Halve the bandwidth every 22 metres. Tuned by ear against the park's
      // scale (plaza radius 24, ferris 90m from the gate), not from physics.
      const target = clamp(16000 * Math.pow(0.5, (d * airAmount) / 22), 420, 16000);
      // Only write the param on a meaningful change — this runs every frame.
      if (lastCut < 0 || Math.abs(target - lastCut) / Math.max(lastCut, 1) > 0.04) {
        air.frequency.setTargetAtTime(target, ctx.currentTime, 0.12);
        lastCut = target;
      }
    },
    dispose() {
      try {
        input.disconnect();
        air.disconnect();
        panner.disconnect();
      } catch {
        /* already gone */
      }
      emitters.delete(em);
    },
  };
  emitters.add(em);
  return em;
}

/* ==================================================================== */
/* LISTENER                                                              */
/* ==================================================================== */

const listener = { x: 0, y: 1.6, z: 24 };
let lastEmitterRefresh = 0;

/**
 * Move the ears. Call this every frame from the camera rig:
 *
 *   updateListener(camera.position, camera.getWorldDirection(v), camera.up);
 *
 * THREE.Vector3 satisfies Vec3Like structurally, so nothing in the audio layer
 * has to import three. Cheap enough to call at 60fps: the panner writes are
 * smoothed AudioParam targets and the per-emitter air filters are throttled to
 * ~12Hz, which is far faster than a child can walk.
 */
export function updateListener(pos: Vec3Like, forward?: Vec3Like, up?: Vec3Like): void {
  const engine = getAudioEngine();
  if (!engine) return;
  try {
    listener.x = pos.x;
    listener.y = pos.y;
    listener.z = pos.z;
    setListenerPose(engine.ctx, pos, forward, up);
    const now = engine.ctx.currentTime;
    if (now - lastEmitterRefresh > 0.08) {
      lastEmitterRefresh = now;
      for (const em of emitters) em.refresh(listener);
    }
  } catch {
    /* ignore */
  }
}

/* ==================================================================== */
/* AMBIENCE                                                              */
/* ==================================================================== */

interface AmbienceStream {
  /** Next context time this stream should fire. */
  nextAt: number;
  /** Seconds until the next one, given a 0..1 random. */
  interval(r: number): number;
  play(t: number): void;
}

interface ParkState {
  engine: AudioEngine;
  /** Master trim for the whole living park — hushed during puzzles. */
  ambience: GainNode;
  wind: NoiseBedHandle;
  needles: NoiseBedHandle;
  carouselEmitter: Emitter;
  laughterEmitter: Emitter;
  treeEmitter: Emitter;
  buntingEmitter: Emitter;
  carousel: Scheduler;
  events: Scheduler;
  streams: AmbienceStream[];
  random: () => number;
}

let park: ParkState | null = null;

/* ---------------- the carousel organ ------------------------------- */

/**
 * THE CAROUSEL PLAYS HIS SONG.
 *
 * A fairground organ oom-pah-pah in 3/4 whose melody is THE CHESSPAA THEME up
 * an octave. A child hears this tune drifting across the plaza for ten minutes
 * before they ever hear ChessPaa hum it at them — so when he does, it lands as
 * recognition. That is the entire reason it is the same tune and not a generic
 * fairground jingle.
 */
const CAROUSEL_BASS: readonly number[] = [41, 46, 48, 41];
const CAROUSEL_CHORDS: readonly (readonly number[])[] = [
  [57, 60, 65],
  [58, 62, 65],
  [55, 60, 64],
  [57, 60, 65],
];
const CAROUSEL_MELODY: readonly (readonly (readonly [number, number, number])[])[] = [
  // [beat, midi, beats]
  [
    [0, THEME_MOTIF[0] + 12, 1],
    [1, THEME_MOTIF[1] + 12, 1],
    [2, THEME_MOTIF[2] + 12, 1],
  ],
  [[0, THEME_MOTIF[3] + 12, 2]],
  [
    [0, THEME_MOTIF[4] + 12, 1],
    [1, THEME_MOTIF[5] + 12, 1],
    [2, THEME_MOTIF[6] + 12, 1],
  ],
  [
    [0, THEME_MOTIF[7] + 12, 1],
    [1, THEME_MOTIF[8] + 12, 2],
  ],
];

function scheduleCarouselBar(s: ParkState, t: number, index: number): number {
  // 96 bpm: jaunty, but a tired-at-dusk jaunty, not a fairground at noon.
  const beat = 60 / 96;
  const bar = index % 4;
  const dest = s.carouselEmitter.input;

  // Oom
  organNote({
    dest,
    when: t,
    freq: midiToFreq(CAROUSEL_BASS[bar]),
    dur: beat * 0.62,
    gain: 0.075,
    drawbars: [1.0, 0.5, 0.12, 0.1, 0.05],
    spread: 9,
    tremulant: 0.1,
  });
  // Pah-pah
  for (let b = 1; b <= 2; b++) {
    for (const midi of CAROUSEL_CHORDS[bar]) {
      organNote({
        dest,
        when: t + b * beat,
        freq: midiToFreq(midi),
        dur: beat * 0.42,
        gain: 0.028,
        drawbars: [1.0, 0.42, 0.3, 0.16, 0.12],
        spread: 11,
        tremulant: 0.16,
      });
    }
  }
  // The tune, on the reedy top stops
  for (const [b, midi, beats] of CAROUSEL_MELODY[bar]) {
    organNote({
      dest,
      when: t + b * beat,
      freq: midiToFreq(midi),
      dur: beats * beat * 0.92,
      gain: 0.05,
      // Tierce and twelfth up loud: this is the candyfloss stop.
      drawbars: [1.0, 0.6, 0.5, 0.34, 0.3],
      spread: 13,
      tremulant: 0.2,
    });
  }
  return beat * 3;
}

/* ---------------- birds -------------------------------------------- */

interface BirdSpecies {
  /** Chirps in a call. */
  count: [number, number];
  /** Start and end pitch of a single chirp, in Hz. */
  from: [number, number];
  to: [number, number];
  chirp: [number, number];
  gap: [number, number];
  gain: number;
}

/**
 * Three little birds, distinguished only by numbers. A bird call is a very fast
 * frequency sweep — that is genuinely all it is — so the species is entirely in
 * the shape of the glide and the rhythm of the repeats.
 */
const BIRDS: readonly BirdSpecies[] = [
  // a chaffinch-ish "tweet-tweet-tweet", rising
  { count: [3, 5], from: [2400, 2900], to: [3600, 4200], chirp: [0.05, 0.08], gap: [0.09, 0.14], gain: 0.055 },
  // a two-note down-slur, the "twee-oo" that means evening
  { count: [2, 3], from: [3800, 4300], to: [2200, 2600], chirp: [0.1, 0.16], gap: [0.16, 0.3], gain: 0.05 },
  // a tiny high tick, almost nothing, the one that makes the wood feel occupied
  { count: [1, 2], from: [4600, 5200], to: [4200, 5000], chirp: [0.03, 0.05], gap: [0.1, 0.16], gain: 0.03 },
];

function playBird(s: ParkState, t: number, r: () => number): void {
  const sp = BIRDS[Math.floor(r() * BIRDS.length)];
  // Scatter it around the treeline behind the listener's general area.
  const angle = r() * Math.PI * 2;
  const dist = 22 + r() * 40;
  s.treeEmitter.setPosition({
    x: listener.x + Math.cos(angle) * dist,
    y: 6 + r() * 5,
    z: listener.z + Math.sin(angle) * dist,
  });
  s.treeEmitter.refresh(listener);

  const n = Math.floor(lerp(sp.count[0], sp.count[1] + 1, r()));
  let at = t;
  for (let i = 0; i < n; i++) {
    const f0 = lerp(sp.from[0], sp.from[1], r());
    const f1 = lerp(sp.to[0], sp.to[1], r());
    const dur = lerp(sp.chirp[0], sp.chirp[1], r());
    tone({
      dest: s.treeEmitter.input,
      when: at,
      freq: f0,
      bendTo: f1,
      bendTime: dur * 0.85,
      dur,
      type: "sine",
      cutoff: 9000,
      // Birds have a fast tremolo inside each note; without it a chirp is a beep.
      vibrato: { cents: 90, hz: 34, delay: 0.005 },
      gain: sp.gain,
      env: { attack: 0.006, decay: dur, sustain: 0 },
    });
    // A quiet second harmonic gives the call a body and stops it whistling.
    tone({
      dest: s.treeEmitter.input,
      when: at,
      freq: f0 * 2,
      bendTo: f1 * 2,
      bendTime: dur * 0.85,
      dur: dur * 0.7,
      type: "sine",
      cutoff: 11000,
      gain: sp.gain * 0.22,
      env: { attack: 0.006, decay: dur * 0.7, sustain: 0 },
    });
    at += dur + lerp(sp.gap[0], sp.gap[1], r());
  }
}

/**
 * THE CROW. Rare — once every minute or two at most — because a crow is a
 * punctuation mark. It is the sound that tells you the day is ending, and it
 * is why the golden hour in this park has a little melancholy under the honey.
 */
function playCrow(s: ParkState, t: number, r: () => number): void {
  const angle = r() * Math.PI * 2;
  s.treeEmitter.setPosition({
    x: listener.x + Math.cos(angle) * (55 + r() * 45),
    y: 12 + r() * 8,
    z: listener.z + Math.sin(angle) * (55 + r() * 45),
  });
  s.treeEmitter.refresh(listener);
  const caws = 2 + Math.floor(r() * 2);
  let at = t;
  for (let i = 0; i < caws; i++) {
    const f = 520 - i * 40 + r() * 60;
    const dur = 0.18 + r() * 0.08;
    // A caw is a rasp: a low sawtooth whose amplitude is being chopped at ~55Hz.
    // That chop is the bird's rough syrinx, and it is the whole character.
    tone({
      dest: s.treeEmitter.input,
      when: at,
      freq: f,
      bendTo: f * 0.72,
      bendTime: dur,
      dur,
      type: "sawtooth",
      cutoff: 1700,
      q: 3,
      vibrato: { cents: 45, hz: 55, delay: 0.0 },
      gain: 0.05,
      env: { attack: 0.012, decay: dur, sustain: 0 },
    });
    noiseHit({
      dest: s.treeEmitter.input,
      when: at,
      freq: 1400,
      freqTo: 900,
      dur: dur * 0.8,
      q: 1.6,
      gain: 0.02,
      seed: 3300 + i,
    });
    at += dur + 0.22 + r() * 0.18;
  }
}

/* ---------------- distant children --------------------------------- */

/**
 * CHILDREN LAUGHING, SOMEWHERE ELSE IN THE PARK.
 *
 * Built from the same formant voice as ChessPaa's motif, but pitched up and
 * with the formants shifted up 30% (a smaller head), then chopped into short
 * bursts on a falling pitch — which is, mechanically, what a laugh is.
 *
 * Kept QUIET and DARK and always at least 30 metres away. Close-up synthetic
 * laughter is uncanny; distant synthetic laughter is a park with other families
 * in it, and that is the feeling we want: you are not the only child here, but
 * this evening belongs to you and your grandfather.
 */
function playLaughter(s: ParkState, t: number, r: () => number): void {
  const angle = r() * Math.PI * 2;
  const dist = 30 + r() * 45;
  s.laughterEmitter.setPosition({
    x: listener.x + Math.cos(angle) * dist,
    y: 1.2,
    z: listener.z + Math.sin(angle) * dist,
  });
  s.laughterEmitter.refresh(listener);

  const kids = 1 + Math.floor(r() * 2);
  for (let k = 0; k < kids; k++) {
    const base = 300 + r() * 170;
    const bursts = 3 + Math.floor(r() * 4);
    const rate = 0.11 + r() * 0.05;
    const startOffset = k * (0.18 + r() * 0.3);
    for (let i = 0; i < bursts; i++) {
      // Each burst is a touch lower than the last: laughter runs downhill.
      const f = base * Math.pow(0.93, i) * (0.97 + r() * 0.06);
      formantVoice({
        dest: s.laughterEmitter.input,
        when: t + startOffset + i * rate,
        freq: f,
        dur: 0.075 + r() * 0.04,
        vowel: r() > 0.5 ? "ah" : "ee",
        formantShift: 1.28,
        breath: 0.35,
        vibrato: 40,
        gain: 0.05 * (1 - i * 0.08),
        env: { attack: 0.008, decay: 0.03, sustain: 0.4, release: 0.06 },
      });
    }
  }
}

/* ---------------- bunting ------------------------------------------ */

/**
 * BUNTING. Triangular flags on a string, snapping in the wind. A flap is a
 * short bright noise burst with a fast pitch drop as the fabric goes slack;
 * three or four of them in quick succession is a gust running down the line,
 * so we schedule them in little runs with a decreasing gap.
 */
function playBunting(s: ParkState, t: number, r: () => number, strength = 1): void {
  const flaps = 2 + Math.floor(r() * 4);
  let at = t;
  for (let i = 0; i < flaps; i++) {
    noiseHit({
      dest: s.buntingEmitter.input,
      when: at,
      freq: 1900 + r() * 1400,
      freqTo: 700 + r() * 400,
      dur: 0.05 + r() * 0.05,
      q: 0.9,
      colour: "pink",
      gain: (0.055 + r() * 0.035) * strength,
      seed: 611 + i,
      env: { attack: 0.003, decay: 0.07, sustain: 0 },
    });
    at += 0.07 + r() * 0.11;
  }
}

/* ---------------- the ambience machine ------------------------------ */

export interface SoundscapeOptions {
  /** Deterministic seed. Same seed, same evening. */
  seed?: number;
  /** Start hushed (e.g. entering straight into a puzzle). Default 1. */
  intensity?: number;
}

/**
 * Bring the park to life. Idempotent — calling it twice does nothing the second
 * time. Requires a running AudioContext, so call it after `unlockAudio()` (the
 * facade in index.ts handles that for you).
 */
export function startSoundscape(opts: SoundscapeOptions = {}): void {
  if (park) return;
  const engine = getAudioEngine();
  if (!engine) return;
  try {
    const ctx = engine.ctx;
    const ambience = ctx.createGain();
    ambience.gain.value = 0;
    ambience.connect(engine.buses.ambience);

    // Two wind layers. The low one is air moving through a valley; the high one
    // is the hiss of pine needles. Together they read as "outdoors, and there
    // are trees" — either one alone reads as "noise floor".
    const wind = noiseBed({
      dest: ambience,
      freq: 380,
      q: 0.55,
      colour: "brown",
      seed: 1201,
      gain: 0.05,
      gustHz: 0.055,
      gustDepth: 0.45,
    });
    const needles = noiseBed({
      dest: ambience,
      freq: 2600,
      q: 0.7,
      colour: "pink",
      seed: 907,
      gain: 0.016,
      gustHz: 0.083,
      gustDepth: 0.55,
    });

    // The organ is far away and behind a lot of canvas: heavy air, wide rolloff.
    const carouselEmitter = createEmitter(engine, {
      pos: { x: ATTRACTIONS.plaza.x, y: 3.4, z: ATTRACTIONS.plaza.z },
      bus: "ambience",
      refDistance: 14,
      rolloff: 0.55,
      hrtf: true,
      air: 1.25,
    });
    const laughterEmitter = createEmitter(engine, {
      pos: { x: ATTRACTIONS.parade.x, y: 1.2, z: ATTRACTIONS.parade.z },
      bus: "ambience",
      refDistance: 12,
      rolloff: 0.8,
      air: 1.5,
    });
    const treeEmitter = createEmitter(engine, {
      pos: { x: listener.x + 20, y: 8, z: listener.z - 20 },
      bus: "ambience",
      refDistance: 14,
      rolloff: 0.7,
      air: 0.8,
    });
    const buntingEmitter = createEmitter(engine, {
      pos: { x: ATTRACTIONS.gate.x, y: 5, z: ATTRACTIONS.gate.z },
      bus: "ambience",
      refDistance: 10,
      rolloff: 0.9,
      air: 1.0,
    });

    const random = rng(opts.seed ?? 20250823);
    const s: ParkState = {
      engine,
      ambience,
      wind,
      needles,
      carouselEmitter,
      laughterEmitter,
      treeEmitter,
      buntingEmitter,
      carousel: null as unknown as Scheduler,
      events: null as unknown as Scheduler,
      streams: [],
      random,
    };

    s.carousel = new Scheduler(ctx, (t, i) => scheduleCarouselBar(s, t, i), 300);

    // Event streams. The intervals are deliberately long: an empty park with
    // one bird every fifteen seconds feels enormous, and a busy one feels like
    // a menu screen.
    const t0 = ctx.currentTime;
    s.streams = [
      {
        nextAt: t0 + 2 + random() * 6,
        interval: (r) => 7 + r * 16,
        play: (t) => playBird(s, t, s.random),
      },
      {
        nextAt: t0 + 25 + random() * 60,
        interval: (r) => 55 + r * 90,
        play: (t) => playCrow(s, t, s.random),
      },
      {
        nextAt: t0 + 12 + random() * 25,
        interval: (r) => 22 + r * 40,
        play: (t) => playLaughter(s, t, s.random),
      },
      {
        nextAt: t0 + 4 + random() * 10,
        interval: (r) => 6 + r * 13,
        play: (t) => playBunting(s, t, s.random, 0.8 + s.random() * 0.5),
      },
    ];

    // One timer drives every ambient stream. Slot length is fixed; each stream
    // decides for itself whether it is due, which keeps the whole living park
    // on a single setInterval.
    s.events = new Scheduler(
      ctx,
      (t) => {
        for (const st of s.streams) {
          if (t >= st.nextAt) {
            st.play(Math.max(t, ctx.currentTime + 0.05));
            st.nextAt = t + st.interval(s.random());
          }
        }
        return 0.75;
      },
      300,
    );

    park = s;
    s.carousel.start();
    s.events.start();
    setAmbienceIntensity(opts.intensity ?? 1, 4.0);
  } catch {
    park = null;
  }
}

/** Fade the park out and free everything. */
export function stopSoundscape(fadeSeconds = 1.5): void {
  const s = park;
  if (!s) return;
  park = null;
  try {
    const t = s.engine.ctx.currentTime;
    s.ambience.gain.cancelScheduledValues(t);
    s.ambience.gain.setValueAtTime(Math.max(s.ambience.gain.value, 0.0001), t);
    s.ambience.gain.linearRampToValueAtTime(0, t + fadeSeconds);
    window.setTimeout(() => {
      s.carousel.stop();
      s.events.stop();
      s.wind.stop(0.4);
      s.needles.stop(0.4);
      s.carouselEmitter.dispose();
      s.laughterEmitter.dispose();
      s.treeEmitter.dispose();
      s.buntingEmitter.dispose();
      try {
        s.ambience.disconnect();
      } catch {
        /* ignore */
      }
    }, fadeSeconds * 1000 + 200);
  } catch {
    /* ignore */
  }
}

/**
 * How loud the living park is, 0..1.
 *
 * THIS IS A TUTOR CONTROL, NOT A VOLUME CONTROL. Drop it to ~0.35 the moment a
 * puzzle appears: a child concentrating hears the carousel as clutter, and the
 * park receding is also a lovely bit of implicit staging — the world leans back
 * so the board can lean in. Bring it home to 1 when they solve it.
 */
export function setAmbienceIntensity(v: number, rampSeconds = 2.5): void {
  const s = park;
  if (!s) return;
  try {
    const i = clamp(v, 0, 1);
    const t = s.engine.ctx.currentTime;
    s.ambience.gain.cancelScheduledValues(t);
    s.ambience.gain.setValueAtTime(Math.max(s.ambience.gain.value, 0.0001), t);
    s.ambience.gain.linearRampToValueAtTime(i, t + rampSeconds);
    // The wind stays proportionally louder than the fairground as things hush —
    // silence with a little wind in it is calm; total silence is a bug.
    s.wind.setIntensity(clamp(0.45 + i * 0.55, 0, 1), rampSeconds);
    s.needles.setIntensity(i, rampSeconds);
  } catch {
    /* ignore */
  }
}

/** Is the park currently running? */
export function soundscapeRunning(): boolean {
  return park !== null;
}

/* ==================================================================== */
/* THE RIDES                                                             */
/* ==================================================================== */

export interface RideHandle {
  /** Move the ride's sound (a coaster car, a train). */
  setPosition(p: Vec3Like): void;
  /** 0 = stopped, 1 = full pelt. Drives clack rate, motor pitch, wind. */
  setSpeed(v: number): void;
  /** Fade the whole ride in/out without destroying it. */
  setActive(on: boolean): void;
  stop(): void;
}

interface RideCommon {
  engine: AudioEngine;
  emitter: Emitter;
  gate: GainNode;
  speed: number;
  active: boolean;
}

function rideBase(pos: Vec3Like, refDistance: number, air: number): RideCommon | null {
  const engine = getAudioEngine();
  if (!engine) return null;
  const emitter = createEmitter(engine, {
    pos,
    bus: "ambience",
    refDistance,
    rolloff: 0.65,
    air,
  });
  const gate = engine.ctx.createGain();
  gate.gain.value = 0;
  gate.connect(emitter.input);
  return { engine, emitter, gate, speed: 0, active: false };
}

/**
 * THE COASTER — clack, rumble and whoosh.
 *
 * The clack rate is a genuine function of speed (sleepers pass under the wheels
 * faster), which means the slow terrifying climb really does tick more and more
 * slowly, and the drop really does blur into a rattle. That is the single most
 * important sound in this park after ChessPaa's voice, because it is the sound
 * of the reveal being set up.
 */
export function createCoasterAudio(startPos: Vec3Like = ATTRACTIONS.coaster): RideHandle | null {
  const base = rideBase(startPos, 12, 0.9);
  if (!base) return null;
  const ctx = base.engine.ctx;

  // Wind past the ears — brightens and swells with speed.
  const whoosh = noiseBed({
    dest: base.gate,
    freq: 700,
    q: 0.5,
    colour: "pink",
    seed: 4411,
    gain: 0.0,
    gustHz: 0.6,
    gustDepth: 0.25,
  });
  // The wooden structure taking the load.
  const rumble = drone({
    dest: base.gate,
    freq: 44,
    voices: 2,
    detuneCents: 14,
    type: "sawtooth",
    cutoff: 140,
    q: 1.6,
    gain: 0,
    attack: 0.6,
    wobbleCents: 20,
    wobbleHz: 1.7,
  });

  let seedCounter = 0;
  const clacks = new Scheduler(
    ctx,
    (t) => {
      const sp = base.speed;
      if (!base.active || sp < 0.02) return 0.25;
      // Sleepers are ~2m apart; at "speed 1" the car is doing about 22 m/s.
      const perSecond = clamp(sp * 11, 0.6, 26);
      const jitter = 1 + (rng(9001 + seedCounter++)() - 0.5) * 0.14;
      // Two wheel bogies: a clack is really "ka-clack".
      woodKnock({
        dest: base.gate,
        when: t,
        freq: 430 + sp * 90,
        dur: 0.045,
        weight: 0.55,
        click: 0.75,
        gain: 0.1 + sp * 0.16,
      });
      woodKnock({
        dest: base.gate,
        when: t + 0.028,
        freq: 340 + sp * 70,
        dur: 0.05,
        weight: 0.7,
        click: 0.5,
        gain: 0.08 + sp * 0.13,
      });
      return (1 / perSecond) * jitter;
    },
    120,
    // Short lookahead: this callback reads `base.speed` at BOOKING time, so the
    // default 2s would make the clack rate lag the car by two seconds — most of
    // the drop. 0.3s is two ticks of headroom and near-instant response.
    0.3,
  );
  clacks.start();

  return {
    setPosition(p) {
      base.emitter.setPosition(p);
    },
    setSpeed(v) {
      base.speed = clamp(v, 0, 1.4);
      const s = base.speed;
      whoosh.setIntensity(clamp(s * 1.1, 0, 1), 0.25);
      whoosh.setGain(0.02 + s * s * 0.16, 0.2);
      rumble.setGain(0.02 + s * 0.09, 0.3);
      rumble.setFreq(40 + s * 26, 0.3);
      rumble.setCutoff(120 + s * 200, 0.3);
    },
    setActive(on) {
      base.active = on;
      base.gate.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, on ? 0.3 : 0.6);
    },
    stop() {
      clacks.stop();
      whoosh.stop(0.5);
      rumble.stop(0.5);
      window.setTimeout(() => base.emitter.dispose(), 900);
    },
  };
}

/**
 * THE FERRIS WHEEL — a big slow motor, a rhythmic creak, and gondola chimes.
 * Machinery in this park is always OLD machinery: nothing hums cleanly, the
 * bearings wobble, and something creaks once per revolution.
 */
export function createFerrisAudio(pos: Vec3Like = ATTRACTIONS.ferris): RideHandle | null {
  const base = rideBase({ x: pos.x, y: 14, z: pos.z }, 18, 1.1);
  if (!base) return null;
  const ctx = base.engine.ctx;

  const motor = drone({
    dest: base.gate,
    freq: 62,
    voices: 3,
    detuneCents: 11,
    type: "sawtooth",
    cutoff: 240,
    q: 2.2,
    gain: 0.05,
    attack: 2.0,
    // The wobble IS the age of the machine. A steady motor sounds like a fridge.
    wobbleCents: 26,
    wobbleHz: 0.42,
  });

  let n = 0;
  const creaks = new Scheduler(
    ctx,
    (t) => {
      if (!base.active) return 0.5;
      const r = rng(7700 + n++);
      // Metal creak: a resonant band sliding upward as the load transfers.
      noiseHit({
        dest: base.gate,
        when: t,
        freq: 620 + r() * 300,
        freqTo: 1500 + r() * 700,
        dur: 0.5 + r() * 0.35,
        q: 9,
        colour: "pink",
        gain: 0.035,
        seed: 7700 + n,
        env: { attack: 0.25, decay: 0.5, sustain: 0 },
      });
      // One gondola passing the top: a small bell, tuned to the theme so the
      // wheel is quietly singing in the same key as everything else.
      if (r() > 0.45) {
        bell({
          dest: base.gate,
          when: t + 0.4 + r() * 0.6,
          freq: midiToFreq(THEME_TONIC + 12 + (r() > 0.5 ? 7 : 4)),
          dur: 2.2,
          ratio: 1.41,
          index: 2.6,
          gain: 0.03,
        });
      }
      const speed = Math.max(base.speed, 0.15);
      return (7 + r() * 5) / speed;
    },
    400,
  );
  creaks.start();

  return {
    setPosition(p) {
      base.emitter.setPosition(p);
    },
    setSpeed(v) {
      base.speed = clamp(v, 0, 1.4);
      motor.setFreq(52 + base.speed * 26, 1.2);
      motor.setGain(0.03 + base.speed * 0.05, 1.2);
    },
    setActive(on) {
      base.active = on;
      base.gate.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, on ? 1.2 : 1.2);
    },
    stop() {
      creaks.stop();
      motor.stop(1.0);
      window.setTimeout(() => base.emitter.dispose(), 1400);
    },
  };
}

/**
 * THE TRAIN — chuff, roll, and a whistle you can trigger.
 *
 * A chuff is four per wheel revolution (two cylinders, double-acting), which is
 * why a steam engine's rhythm is that particular gallop. Each chuff is a noise
 * burst whose band sweeps DOWN as the steam expands and cools.
 */
export function createTrainAudio(
  pos: Vec3Like = ATTRACTIONS.train,
  // The extra `whistle()` is part of the contract: the module-level
  // `trainWhistle()` builds its own emitter at the STATION, so a train halfway
  // round the park that whistles through it sounds its horn from where it
  // parked. This one blows through the engine's own moving emitter.
): (RideHandle & { whistle(): void }) | null {
  const base = rideBase(pos, 14, 0.95);
  if (!base) return null;
  const ctx = base.engine.ctx;

  const roll = noiseBed({
    dest: base.gate,
    freq: 190,
    q: 0.8,
    colour: "brown",
    seed: 5511,
    gain: 0.03,
    gustHz: 0.9,
    gustDepth: 0.2,
  });

  let n = 0;
  const chuffs = new Scheduler(
    ctx,
    (t) => {
      if (!base.active || base.speed < 0.03) return 0.3;
      const r = rng(2200 + n++);
      const sp = base.speed;
      // Chuffs get shorter and brighter as she works harder.
      noiseHit({
        dest: base.gate,
        when: t,
        freq: 900 + sp * 500,
        freqTo: 240 + sp * 120,
        dur: 0.1 + (1 - sp) * 0.12,
        q: 0.75,
        colour: "white",
        gain: 0.055 + sp * 0.05,
        seed: 2200 + n,
        env: { attack: 0.004, decay: 0.16, sustain: 0 },
      });
      // Every fourth chuff is the heavy one — that limp is what makes it read
      // as a real engine rather than a metronome with steam on it.
      if (n % 4 === 0) {
        noiseHit({
          dest: base.gate,
          when: t + 0.01,
          freq: 320,
          freqTo: 150,
          dur: 0.16,
          q: 1.2,
          colour: "brown",
          gain: 0.05,
          seed: 2201 + n,
        });
      }
      const perSecond = clamp(sp * 7.5, 0.5, 12);
      return (1 / perSecond) * (0.94 + r() * 0.12);
    },
    120,
    // Same reason as the coaster: the chuff rate must follow the throttle now,
    // not two seconds from now.
    0.3,
  );
  chuffs.start();

  const handle: RideHandle & { whistle(): void } = {
    setPosition(p) {
      base.emitter.setPosition(p);
    },
    setSpeed(v) {
      base.speed = clamp(v, 0, 1.4);
      roll.setIntensity(clamp(base.speed, 0, 1), 0.4);
      roll.setGain(0.012 + base.speed * 0.05, 0.4);
    },
    setActive(on) {
      base.active = on;
      base.gate.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, on ? 0.5 : 0.8);
    },
    stop() {
      chuffs.stop();
      roll.stop(0.6);
      window.setTimeout(() => base.emitter.dispose(), 1000);
    },
    whistle() {
      trainWhistleAt(base.gate);
    },
  };
  return handle;
}

/**
 * THE WHISTLE. A steam whistle is a CHORD, not a note — several chambers of
 * different lengths blown at once, traditionally a minor triad, which is why
 * train whistles are the saddest happy sound in the world. Add breath noise,
 * a slow swell, and a fall at the end as the driver lets go of the cord.
 */
function trainWhistleAt(dest: AudioNode, gain = 1): void {
  const t0 = dest.context.currentTime + 0.02;
  const root = midiToFreq(THEME_TONIC + 12);
  // Root, minor third, fifth: the classic three-chime.
  const chord = [1, 1.19, 1.5];
  for (let i = 0; i < chord.length; i++) {
    tone({
      dest,
      when: t0,
      freq: root * chord[i],
      // The pitch sags as the boiler pressure drops on release.
      bendTo: root * chord[i] * 0.94,
      bendTime: 1.5,
      dur: 1.15,
      type: "triangle",
      cutoff: 3600,
      vibrato: { cents: 12, hz: 5.5, delay: 0.25 },
      gain: (0.1 - i * 0.022) * gain,
      env: { attack: 0.14, decay: 0.2, sustain: 0.72, release: 0.45 },
      pan: (i - 1) * 0.25,
    });
  }
  // The air in the whistle — without this it is an organ, not steam.
  noiseHit({
    dest,
    when: t0,
    freq: 2400,
    freqTo: 1700,
    dur: 1.4,
    q: 0.6,
    colour: "white",
    gain: 0.02 * gain,
    seed: 8181,
    env: { attack: 0.12, decay: 0.4, sustain: 0.5, release: 0.5 },
  });
}

/** Blow the whistle from anywhere — spatialised at the train station by default. */
export function trainWhistle(at: Vec3Like = ATTRACTIONS.train): void {
  const engine = getAudioEngine();
  if (!engine) return;
  try {
    const em = createEmitter(engine, { pos: at, bus: "ambience", refDistance: 20, rolloff: 0.5, air: 0.7 });
    em.refresh(listener);
    trainWhistleAt(em.input, 1.2);
    window.setTimeout(() => em.dispose(), 4000);
  } catch {
    /* ignore */
  }
}

/* ==================================================================== */
/* THE BOARD                                                             */
/* ==================================================================== */

interface PieceVoice {
  /** Body resonance in Hz — small piece, small box, high note. */
  freq: number;
  /** How long it rings. */
  dur: number;
  /** 0 = hollow tick, 1 = dense knock with low end. */
  weight: number;
  /** Bright surface contact. */
  click: number;
  gain: number;
}

/**
 * EVERY PIECE HAS ITS OWN VOICE.
 *
 * This table is the most-heard twenty lines in the whole project. A child makes
 * hundreds of moves and hears these hundreds of times, so the differences are
 * tuned to be identifiable but never fussy:
 *
 *   pawn   — a light, high tick. Almost nothing. A little wooden bead.
 *   knight — mid, slightly hollow: it is a horse's head, it wobbles.
 *   bishop — a touch higher and cleaner than the knight, with a longer ring
 *            (that tall smooth mitre is a better resonator).
 *   rook   — a SOLID KNOCK. Low, dense, real weight in it. Castles are heavy.
 *   queen  — low-mid, the longest ring of the lot: the piece with presence.
 *   king   — the deepest and slowest. When the king moves, you hear it.
 */
const PIECE_VOICES: Record<PieceType, PieceVoice> = {
  p: { freq: 880, dur: 0.055, weight: 0.16, click: 0.62, gain: 0.24 },
  n: { freq: 610, dur: 0.085, weight: 0.42, click: 0.5, gain: 0.27 },
  b: { freq: 720, dur: 0.095, weight: 0.32, click: 0.46, gain: 0.25 },
  r: { freq: 320, dur: 0.145, weight: 0.88, click: 0.4, gain: 0.32 },
  q: { freq: 430, dur: 0.17, weight: 0.66, click: 0.42, gain: 0.29 },
  k: { freq: 255, dur: 0.21, weight: 1.0, click: 0.34, gain: 0.32 },
};

export interface BoardSoundOptions {
  /**
   * Spatialise it on the board. Omit for a flat, close, always-audible sound.
   *
   * HONOURED BY the per-square sounds only: playPieceLift, playMove, playCapture
   * and playCastle. The whole-game moments — check, checkmate, stalemate,
   * promotion, brilliant, not-that-one — IGNORE IT ON PURPOSE and always play
   * flat and close, because they are addressed to the child rather than emitted
   * by a square, and a checkmate fanfare that gets quieter when the camera pulls
   * back is a checkmate fanfare that has missed the point.
   */
  at?: Vec3Like;
  /** Scale the level. Honoured by every function here. */
  gain?: number;
  /** Absolute context time. */
  when?: number;
}

/** Route a board sound either flat on the sfx bus or through a one-shot emitter. */
function boardDest(opts: BoardSoundOptions | undefined, engine: AudioEngine): AudioNode {
  if (!opts?.at) return engine.buses.sfx;
  const em = createEmitter(engine, {
    pos: opts.at,
    bus: "sfx",
    refDistance: 6,
    rolloff: 0.5,
    air: 0.5,
  });
  em.refresh(listener);
  window.setTimeout(() => em.dispose(), 6000);
  return em.input;
}

/** The tiny felt sound of a piece being lifted off the board. Barely there. */
export function playPieceLift(piece: PieceType, opts?: BoardSoundOptions): void {
  const engine = getAudioEngine();
  if (!engine) return;
  try {
    const v = PIECE_VOICES[piece];
    const dest = boardDest(opts, engine);
    const g = opts?.gain ?? 1;
    // Bandpassed noise loses most of its energy in the filter, so the number
    // here is much larger than it looks — measured, this lands about -26dB.
    noiseHit({
      dest,
      when: opts?.when,
      freq: v.freq * 1.6,
      freqTo: v.freq * 0.9,
      dur: 0.045,
      q: 1.4,
      colour: "pink",
      gain: 0.22 * g,
      seed: 4004,
    });
    // A trace of the piece's own body, so you can hear WHICH piece you picked up.
    woodKnock({
      dest,
      when: opts?.when,
      freq: v.freq * 0.9,
      dur: 0.035,
      weight: 0.3,
      click: 0,
      gain: 0.035 * g,
    });
  } catch {
    /* ignore */
  }
}

/** A piece put down. THE sound of this game. */
export function playMove(piece: PieceType, opts?: BoardSoundOptions): void {
  const engine = getAudioEngine();
  if (!engine) return;
  try {
    const v = PIECE_VOICES[piece];
    const dest = boardDest(opts, engine);
    woodKnock({
      dest,
      when: opts?.when,
      freq: v.freq,
      dur: v.dur,
      weight: v.weight,
      click: v.click,
      gain: v.gain * (opts?.gain ?? 1),
    });
  } catch {
    /* ignore */
  }
}

/**
 * A CAPTURE. The captured piece's own body knocked down a fifth (something got
 * bigger and lower — it was displaced), plus a felt "thunk" of the two pieces
 * meeting. Warm and soft: taking a piece in this park is a satisfying woodblock
 * sound, not a violent one. Nobody gets hurt at ChessPaa's.
 */
export function playCapture(
  piece: PieceType,
  captured: PieceType = "p",
  opts?: BoardSoundOptions,
): void {
  const engine = getAudioEngine();
  if (!engine) return;
  try {
    const dest = boardDest(opts, engine);
    const mover = PIECE_VOICES[piece];
    const taken = PIECE_VOICES[captured];
    const t = opts?.when ?? engine.ctx.currentTime + 0.008;
    const g = opts?.gain ?? 1;

    // The soft collision first — cloth-bottomed pieces meeting.
    noiseHit({
      dest,
      when: t,
      freq: 420,
      freqTo: 170,
      dur: 0.1,
      q: 0.7,
      colour: "brown",
      gain: 0.15 * g,
      seed: 5005,
      env: { attack: 0.002, decay: 0.12, sustain: 0 },
    });
    // Then the mover landing, with more weight than usual.
    woodKnock({
      dest,
      when: t + 0.012,
      freq: mover.freq * 0.94,
      dur: mover.dur * 1.25,
      weight: clamp(mover.weight + 0.2, 0, 1),
      click: mover.click * 0.8,
      gain: mover.gain * 1.3 * g,
    });
    // And the taken piece rolling off — a low, short, receding tumble.
    woodKnock({
      dest,
      when: t + 0.07,
      freq: taken.freq * 0.66,
      dur: taken.dur * 0.8,
      weight: 0.5,
      click: 0.25,
      gain: taken.gain * 0.45 * g,
      pan: 0.3,
    });
  } catch {
    /* ignore */
  }
}

/** Castling: king, then rook, a beat apart. Two knocks that mean "safe". */
export function playCastle(opts?: BoardSoundOptions): void {
  const engine = getAudioEngine();
  if (!engine) return;
  try {
    const t = opts?.when ?? engine.ctx.currentTime + 0.008;
    playMove("k", { ...opts, when: t });
    playMove("r", { ...opts, when: t + 0.16, gain: (opts?.gain ?? 1) * 0.9 });
    // A tiny warm confirmation underneath — the castle gate closing.
    mallet({
      dest: boardDest(opts, engine),
      when: t + 0.16,
      freq: midiToFreq(THEME_TONIC - 12),
      dur: 1.1,
      softness: 0.8,
      gain: 0.07 * (opts?.gain ?? 1),
    });
  } catch {
    /* ignore */
  }
}

/**
 * CHECK. A bright two-note chime, up a fifth — an alert that is unmistakably
 * an ALERT and unmistakably not a telling-off. Wet with hall so it rings out
 * over the board and the child looks up.
 */
export function playCheck(opts?: BoardSoundOptions): void {
  const engine = getAudioEngine();
  if (!engine) return;
  try {
    const t = opts?.when ?? engine.ctx.currentTime + 0.01;
    const dest = engine.buses.sfx;
    const g = opts?.gain ?? 1;
    for (let i = 0; i < 2; i++) {
      bell({
        dest,
        when: t + i * 0.12,
        freq: midiToFreq(THEME_TONIC + 12 + i * 7),
        dur: 1.9,
        ratio: 1.41,
        index: 4.2,
        strike: 0.4,
        gain: 0.23 * g,
      });
      // Extra hall on the second chime so it hangs in the air.
      if (i === 1) {
        bell({
          dest: engine.hallSends.sfx,
          when: t + 0.12,
          freq: midiToFreq(THEME_TONIC + 19),
          dur: 2.4,
          ratio: 1.41,
          index: 3,
          gain: 0.12 * g,
        });
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * CHECKMATE — a warm little fanfare, about two seconds, in the park's own key.
 *
 * Deliberately NOT triumphal brass. This is a grandfather saying "well now,
 * would you look at that" — a plagal lift, mallets, one bell, and the theme's
 * final cadence underneath. It sounds the same whoever won, because a child who
 * just lost still deserves a nice noise.
 */
export function playCheckmate(opts?: BoardSoundOptions): void {
  const engine = getAudioEngine();
  if (!engine) return;
  try {
    const t = opts?.when ?? engine.ctx.currentTime + 0.02;
    const dest = engine.buses.sfx;
    const g = opts?.gain ?? 1;
    const beat = 0.3;

    // The cadence: Bb -> F (a plagal "amen" — the warmest ending in music).
    const chords: Array<[number, number[]]> = [
      [0, [58, 62, 65]],
      [beat * 2, [53, 60, 65, 69]],
    ];
    for (const [off, notes] of chords) {
      for (let i = 0; i < notes.length; i++) {
        organNote({
          dest,
          when: t + off + i * 0.012,
          freq: midiToFreq(notes[i]),
          dur: off === 0 ? beat * 1.9 : 2.2,
          gain: 0.08 * g,
          drawbars: [1.0, 0.5, 0.22, 0.16, 0.1],
          spread: 6,
          tremulant: 0.08,
          env: { attack: 0.03, decay: 0.12, sustain: 0.8, release: off === 0 ? 0.3 : 1.4 },
        });
      }
    }
    // The tune on top: the theme's last three notes, landing home.
    const tail = [THEME_MOTIF[6], THEME_MOTIF[7], THEME_MOTIF[8]];
    tail.forEach((midi, i) => {
      mallet({
        dest,
        when: t + i * beat,
        freq: midiToFreq(midi + 12),
        dur: i === 2 ? 2.6 : 0.7,
        softness: 0.5,
        shimmer: 0.7,
        gain: 0.26 * g,
      });
    });
    bell({
      dest: engine.hallSends.sfx,
      when: t + beat * 2,
      freq: midiToFreq(THEME_TONIC + 24),
      dur: 3.2,
      ratio: 1.41,
      index: 3.4,
      gain: 0.1 * g,
    });
    // And the bass arriving underneath, so it feels like it lands on something.
    pluck({
      dest,
      when: t + beat * 2,
      freq: midiToFreq(THEME_TONIC - 24),
      dur: 2.8,
      damping: 0.8,
      attackBrightness: 0.2,
      gain: 0.26 * g,
      seed: 31,
    });
  } catch {
    /* ignore */
  }
}

/** Stalemate: not a loss, just a shrug. Warm, unresolved, and short. */
export function playStalemate(opts?: BoardSoundOptions): void {
  const engine = getAudioEngine();
  if (!engine) return;
  try {
    const t = opts?.when ?? engine.ctx.currentTime + 0.02;
    // A suspended chord that never resolves — the sound of "well, that's that".
    for (const midi of [65, 70, 72]) {
      organNote({
        dest: engine.buses.sfx,
        when: t,
        freq: midiToFreq(midi),
        dur: 1.6,
        gain: 0.15 * (opts?.gain ?? 1),
        drawbars: [1.0, 0.4, 0.1, 0.08, 0.04],
        tremulant: 0.1,
        env: { attack: 0.08, decay: 0.2, sustain: 0.7, release: 0.9 },
      });
    }
  } catch {
    /* ignore */
  }
}

/** A pawn becoming a queen: a rising run and a bell. Pure escalation. */
export function playPromotion(opts?: BoardSoundOptions): void {
  const engine = getAudioEngine();
  if (!engine) return;
  try {
    const t = opts?.when ?? engine.ctx.currentTime + 0.02;
    const g = opts?.gain ?? 1;
    const notes = [65, 69, 72, 77, 81];
    notes.forEach((midi, i) => {
      mallet({
        dest: engine.buses.sfx,
        when: t + i * 0.075,
        freq: midiToFreq(midi),
        dur: i === notes.length - 1 ? 2.2 : 0.5,
        softness: 0.42,
        shimmer: 0.8,
        gain: (0.13 + i * 0.012) * g,
      });
    });
    bell({
      dest: engine.hallSends.sfx,
      when: t + notes.length * 0.075,
      freq: midiToFreq(89),
      dur: 2.6,
      ratio: 1.41,
      index: 4,
      gain: 0.06 * g,
    });
  } catch {
    /* ignore */
  }
}

/**
 * BRILLIANT. The sparkle.
 *
 * Seven tiny bells climbing a pentatonic scale with seeded jitter, over a soft
 * swell. Pentatonic because no two notes of it can ever clash, so this can fire
 * over any harmony in the park and always sound like magic. This is the single
 * most rewarding noise in the game and it is used sparingly on purpose.
 */
export function playBrilliant(opts?: BoardSoundOptions): void {
  const engine = getAudioEngine();
  if (!engine) return;
  try {
    const t = opts?.when ?? engine.ctx.currentTime + 0.02;
    const dest = engine.buses.sfx;
    const g = opts?.gain ?? 1;
    const r = rng(0xb111a7);
    // F major pentatonic, two octaves up where sparkle lives.
    const scale = [77, 79, 81, 84, 86, 89, 91, 93];
    for (let i = 0; i < 7; i++) {
      bell({
        dest,
        when: t + i * 0.055 + r() * 0.02,
        freq: midiToFreq(scale[i]),
        dur: 1.6 - i * 0.09,
        ratio: 1.41,
        index: 2.6 + r() * 1.2,
        gain: (0.22 - i * 0.012) * g,
        pan: r() * 1.6 - 0.8,
      });
    }
    // The swell underneath — the reason it feels like a rush rather than a jingle.
    noiseHit({
      dest,
      when: t,
      freq: 1200,
      freqTo: 6000,
      dur: 0.5,
      q: 0.5,
      colour: "pink",
      gain: 0.14 * g,
      seed: 777,
      env: { attack: 0.35, decay: 0.25, sustain: 0 },
    });
    // And a long tail in the hall so the moment hangs.
    bell({
      dest: engine.hallSends.sfx,
      when: t + 0.2,
      freq: midiToFreq(96),
      dur: 3.4,
      ratio: 1.41,
      index: 2,
      gain: 0.18 * g,
    });
  } catch {
    /* ignore */
  }
}

/**
 * NOT-THAT-ONE. Fired when a move is illegal or a square is not a legal target.
 *
 * THIS IS NOT A BUZZER AND IT NEVER WILL BE. It is two soft, low, muted wooden
 * taps — the sound of a hand gently blocking a piece — with a tiny downward
 * hum. It says "mm-mm, not there" the way a person does, and a child can
 * trigger it fifty times in a row without ever feeling told off.
 */
export function playNotThatOne(opts?: BoardSoundOptions): void {
  const engine = getAudioEngine();
  if (!engine) return;
  try {
    const t = opts?.when ?? engine.ctx.currentTime + 0.008;
    const dest = engine.buses.sfx;
    const g = opts?.gain ?? 1;
    for (let i = 0; i < 2; i++) {
      woodKnock({
        dest,
        when: t + i * 0.11,
        freq: 200 - i * 18,
        dur: 0.07,
        weight: 0.85,
        click: 0.12,
        gain: 0.17 * g,
      });
    }
    formantVoice({
      dest: engine.buses.voice,
      when: t,
      freq: midiToFreq(THEME_TONIC - 17),
      bendTo: midiToFreq(THEME_TONIC - 20),
      bendFrom: 0.5,
      dur: 0.34,
      vowel: "mm",
      breath: 0.2,
      formantShift: 0.82,
      gain: 0.07 * g,
      env: { attack: 0.05, decay: 0.08, sustain: 0.6, release: 0.18 },
    });
  } catch {
    /* ignore */
  }
}

/** A soft UI tick for hovers, selections and page turns. Deliberately tiny. */
export function playTick(gain = 1): void {
  const engine = getAudioEngine();
  if (!engine) return;
  try {
    woodKnock({
      dest: engine.buses.sfx,
      freq: 1250,
      dur: 0.03,
      weight: 0.1,
      click: 0.5,
      gain: 0.075 * gain,
    });
  } catch {
    /* ignore */
  }
}

/** A camera move, a scene change, a ride launching. Air, not a laser. */
export function playWhoosh(gain = 1): void {
  const engine = getAudioEngine();
  if (!engine) return;
  try {
    noiseHit({
      dest: engine.buses.sfx,
      freq: 380,
      freqTo: 2600,
      dur: 0.55,
      q: 0.5,
      colour: "pink",
      gain: 0.22 * gain,
      seed: 1234,
      env: { attack: 0.22, decay: 0.34, sustain: 0 },
    });
  } catch {
    /* ignore */
  }
}

/* ==================================================================== */
/* CHESSPAA'S REACTIONS                                                  */
/* ==================================================================== */

/**
 * Mirrors the `Grade` union in @/lib/chess/coach so a grade can be passed
 * straight through. Kept as its own type so the audio layer never has to import
 * the chess engine.
 */
export type Reaction = "sparkle" | "great" | "good" | "okay" | "oops" | "blunder";

/**
 * HOW THE PARK REACTS TO A MOVE.
 *
 * These are EXPRESSIONS, not scores. There is no ding for right and no buzz for
 * wrong, because a child who is being marked stops experimenting. What changes
 * between a brilliant move and a blunder is only how DELIGHTED or how CONCERNED
 * the grandfather sounds — the same warm voice, the same wooden park, the same
 * key. The two "bad" reactions are the gentlest sounds in the whole file, and
 * both of them end on a warm major note so the last thing a child hears after a
 * mistake is reassurance.
 */
export function playReaction(r: Reaction, gain = 1): void {
  const engine = getAudioEngine();
  if (!engine) return;
  try {
    const dest = engine.buses.sfx;
    const t = engine.ctx.currentTime + 0.01;
    switch (r) {
      case "sparkle":
        playBrilliant({ gain });
        playChessPaaMotif("delighted", { gain: 0.9 * gain, when: t + 0.18 });
        break;

      case "great":
        // A quick two-note lift on the music box, then his delighted hum.
        mallet({ dest, when: t, freq: midiToFreq(THEME_TONIC + 12), dur: 0.5, softness: 0.45, shimmer: 0.8, gain: 0.13 * gain });
        mallet({ dest, when: t + 0.1, freq: midiToFreq(THEME_TONIC + 16), dur: 1.4, softness: 0.45, shimmer: 0.9, gain: 0.14 * gain });
        playChessPaaMotif("delighted", { gain: 0.7 * gain, when: t + 0.16 });
        break;

      case "good":
        // One warm note and a murmur of approval. Small praise, freely given.
        mallet({ dest, when: t, freq: midiToFreq(THEME_TONIC + 9), dur: 1.1, softness: 0.62, shimmer: 0.4, gain: 0.11 * gain });
        chessPaaMurmur(0.85 * gain);
        break;

      case "okay":
        // Almost nothing: a thinking noise. Most moves in a game are just moves.
        chessPaaMurmur(0.7 * gain);
        break;

      case "oops":
        // The soft "oh?" — a caring falling note and one low wooden tap.
        playChessPaaMotif("caring", { gain: 0.85 * gain, when: t });
        woodKnock({ dest, when: t + 0.05, freq: 230, dur: 0.09, weight: 0.8, click: 0.15, gain: 0.07 * gain });
        break;

      case "blunder":
        // The biggest mistake in the game gets the SOFTEST sound in the park:
        // his caring motif, and then a low warm string resolving upward — the
        // musical equivalent of a hand on the shoulder and "never mind, look."
        playChessPaaMotif("caring", { gain: 1.0 * gain, when: t });
        pluck({
          dest,
          when: t + 0.75,
          freq: midiToFreq(THEME_TONIC - 12),
          dur: 2.4,
          damping: 0.85,
          attackBrightness: 0.15,
          gain: 0.11 * gain,
          seed: 4242,
        });
        mallet({
          dest,
          when: t + 1.0,
          freq: midiToFreq(THEME_TONIC + 4),
          dur: 1.8,
          softness: 0.75,
          shimmer: 0.3,
          gain: 0.075 * gain,
        });
        break;
    }
  } catch {
    /* ignore */
  }
}

/** The park's own applause for finishing something: bells, wind and a whistle. */
export function playCelebration(): void {
  const engine = getAudioEngine();
  if (!engine) return;
  try {
    playBrilliant();
    window.setTimeout(() => trainWhistle(), 700);
    playChessPaaMotif("delighted", { when: engine.ctx.currentTime + 0.35 });
  } catch {
    /* ignore */
  }
}
