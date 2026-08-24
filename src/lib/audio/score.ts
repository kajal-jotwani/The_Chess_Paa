"use client";

/**
 * THE SCORE — and it is MOSTLY SILENCE.
 *
 * The brief for this file is unusual and worth stating plainly, because the
 * temptation with generative music is always to write more of it:
 *
 *   The music exists to underline WONDER. It swells on the open plaza and on
 *   the wide reveals, and it gets out of the way the moment a child starts
 *   thinking. A puzzle screen with a tune under it is a puzzle screen a child
 *   solves worse and enjoys less. So "thinking" is a single breath of low pad
 *   and one note every twelve seconds, and "quiet" is nothing at all.
 *
 * Silence here is COMPOSED, not omitted: the plaza cycle is twelve bars long
 * and SIX of them are empty on purpose (bars 6-7 of the theme, plus bars 8-11
 * which are past the end of it), so the theme feels like something you catch on
 * the wind rather than a loop you are trapped in. At 66bpm in 3/4 that is about
 * sixteen seconds of held silence between phrases — long, deliberately, and the
 * first number to change if the park ever feels abandoned rather than calm.
 *
 * THE MATERIAL: one theme, in F major, in a slow 3/4 — a waltz, because every
 * carousel that ever existed is in 3/4 and a child's ear already knows that
 * this rhythm means fairground. It rises a sixth (the "lantern lift" — the F4
 * to D5 in bar 5), leans on the fourth degree, and settles back home. Every other piece of
 * music in the park is a quotation of it: ChessPaa's voice motif, the checkmate
 * fanfare, the ferris chimes. One tune, many costumes — that is how a film
 * score makes a place feel like a place.
 */

import {
  Scheduler,
  clamp,
  getAudioEngine,
  mallet,
  midiToFreq,
  organNote,
  pluck,
  bell,
  rng,
  type AudioEngine,
} from "./synth";

/* ==================================================================== */
/* THE THEME                                                             */
/* ==================================================================== */

/**
 * THE CHESSPAA THEME as a bare NINE-NOTE MELODIC CELL, for quotation:
 *   F4 A4 C5  Bb4  D5 C5 A4  G4 F4
 * Sung as: "come a-long, up... to the top of the hill, and... home."
 *
 * NOTE THIS IS NOT THE FULL TUNE. The arrangement the score actually plays is
 * THEME_BARS below — twelve notes over six bars, ending on C5 rather than
 * turning home to F4. This cell is the closing form, and it is what every
 * stinger quotes (ChessPaa's motifs, the checkmate cadence, the carousel) so
 * that a quotation always resolves even when it is only three notes long.
 */
export const THEME_MOTIF: readonly number[] = [65, 69, 72, 70, 74, 72, 69, 67, 65];

/** The tonic everything resolves to. Exported so stingers can agree with the score. */
export const THEME_TONIC = 65; // F4

interface NoteEvent {
  /** Beat within the bar (3 beats to a bar). */
  beat: number;
  midi: number;
  /** Length in beats. */
  beats: number;
  /** 0..1 — the difference between a melody and a typewriter. */
  vel: number;
}

/**
 * Eight bars of tune. Bars 6 and 7 are deliberately empty: the phrase needs to
 * breathe or the park starts to feel like a shop.
 */
const THEME_BARS: readonly (readonly NoteEvent[])[] = [
  [
    { beat: 0, midi: 65, beats: 1, vel: 0.9 },
    { beat: 1, midi: 69, beats: 1, vel: 0.8 },
    { beat: 2, midi: 72, beats: 1, vel: 0.88 },
  ],
  [{ beat: 0, midi: 70, beats: 2.2, vel: 0.82 }],
  [
    { beat: 0, midi: 74, beats: 1, vel: 0.95 },
    { beat: 1, midi: 72, beats: 1, vel: 0.78 },
    { beat: 2, midi: 69, beats: 1, vel: 0.74 },
  ],
  [{ beat: 0, midi: 67, beats: 2.6, vel: 0.78 }],
  [
    { beat: 0, midi: 65, beats: 1, vel: 0.84 },
    { beat: 1, midi: 69, beats: 1, vel: 0.78 },
    { beat: 2, midi: 74, beats: 1, vel: 0.92 },
  ],
  [{ beat: 0, midi: 72, beats: 3, vel: 0.86 }],
  [],
  [],
];

/** Root of the bar's harmony. F  Bb  Dm  C  F  Am  (rest) (rest). */
const BASS_BY_BAR: readonly (number | null)[] = [41, 46, 38, 36, 41, 45, null, null];

/** Pad voicing per bar: root + fifth, low and wide, nothing clever. */
const PAD_BY_BAR: readonly (readonly number[] | null)[] = [
  [53, 60],
  [58, 65],
  [50, 57],
  [48, 55],
  [53, 60],
  [57, 64],
  null,
  null,
];

/**
 * A counter-melody that only appears on a REVEAL — a rising line over the last
 * half of the phrase, the musical equivalent of the camera lifting over the
 * crest. Kept out of every other mood so the reveal has something of its own.
 */
const REVEAL_COUNTER: readonly (readonly NoteEvent[])[] = [
  [],
  [],
  [],
  [{ beat: 1, midi: 77, beats: 2, vel: 0.5 }],
  [{ beat: 0, midi: 79, beats: 1.5, vel: 0.55 }],
  [{ beat: 0, midi: 81, beats: 3, vel: 0.6 }],
  [],
  [],
];

/* ==================================================================== */
/* MOODS                                                                 */
/* ==================================================================== */

export type MusicMood = "plaza" | "reveal" | "thinking" | "celebrate" | "quiet";

interface MoodPlan {
  /** Beats per minute. The whole score lives between 58 and 78. */
  bpm: number;
  /** Master level for the arrangement. These are LOW on purpose. */
  gain: number;
  /** Bars in the cycle. Anything past the 8 theme bars is silence. */
  cycleBars: number;
  melody: boolean;
  /** Double the melody an octave up on a music box. */
  melodyOctave: boolean;
  /** 0 = no pad. */
  pad: number;
  bass: boolean;
  counter: boolean;
  /** High bells on off-beats. Celebration only — sparkle is a reward, not wallpaper. */
  sparkle: boolean;
  /** Seconds to cross-fade INTO this mood. */
  fade: number;
}

const PLANS: Record<MusicMood, MoodPlan> = {
  /**
   * PLAZA: the park humming to itself. Twelve-bar cycle, SIX bars of nothing
   * (~16s). Loud enough to notice on the third listen, never loud enough to
   * talk over.
   */
  plaza: {
    bpm: 66,
    gain: 0.5,
    cycleBars: 12,
    melody: true,
    melodyOctave: false,
    pad: 0.5,
    bass: true,
    counter: false,
    sparkle: false,
    fade: 3.0,
  },

  /**
   * REVEAL: the crest of the coaster, the gate opening, the first sight of the
   * valley. Slower, wider, the counter-line lifting over the top. This is the
   * only mood allowed to feel like a film cue.
   */
  reveal: {
    bpm: 58,
    gain: 0.78,
    cycleBars: 8,
    melody: true,
    melodyOctave: true,
    pad: 1.0,
    bass: true,
    counter: true,
    sparkle: false,
    fade: 2.2,
  },

  /**
   * THINKING: NEAR SILENCE. One low pad breath per cycle and nothing else.
   * If you can hum along with this, it is too much music.
   */
  thinking: {
    bpm: 62,
    gain: 0.34,
    cycleBars: 8,
    melody: false,
    melodyOctave: false,
    pad: 0.28,
    bass: false,
    counter: false,
    sparkle: false,
    fade: 1.6,
  },

  /**
   * CELEBRATE: the same tune, brighter and quicker, with bells. Deliberately
   * NOT a new tune — a child should recognise their own park cheering for them.
   */
  celebrate: {
    bpm: 78,
    gain: 0.85,
    cycleBars: 8,
    melody: true,
    melodyOctave: true,
    pad: 0.7,
    bass: true,
    counter: false,
    sparkle: true,
    fade: 0.9,
  },

  /** QUIET: nothing. Ambience and the child's own thoughts. */
  quiet: {
    bpm: 66,
    gain: 0,
    cycleBars: 8,
    melody: false,
    melodyOctave: false,
    pad: 0,
    bass: false,
    counter: false,
    sparkle: false,
    fade: 2.4,
  },
};

/* ==================================================================== */
/* ENGINE                                                                */
/* ==================================================================== */

interface ScoreState {
  engine: AudioEngine;
  /** Every note in the score passes through here — this is the mood cross-fader. */
  arrangement: GainNode;
  /** Author-level trim, separate from mood, for a settings slider. */
  trim: GainNode;
  scheduler: Scheduler;
  bar: number;
  random: () => number;
}

let state: ScoreState | null = null;
let mood: MusicMood = "quiet";
let returnTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Bumped every time the score is started. stopScore() stops the scheduler on a
 * timer (after its fade), and without this token a start() landing inside that
 * fade would be silently killed a moment later by the old stop.
 */
let generation = 0;

function beatSeconds(plan: MoodPlan): number {
  return 60 / plan.bpm;
}

/**
 * Schedule one bar. Called from the look-ahead scheduler roughly one bar early,
 * so a mood change lands on the NEXT DOWNBEAT rather than instantly.
 *
 * That delay is a feature: the immediate reaction to a checkmate is the fanfare
 * stinger (soundscape.ts), and the score swelling in underneath it a beat later
 * is exactly how a film scores the same moment. Music that changes mid-bar
 * sounds like a bug even when it is intentional.
 */
function scheduleBar(s: ScoreState, t: number, index: number): number {
  const plan = PLANS[mood];
  const beat = beatSeconds(plan);
  const barLen = beat * 3;
  const bar = index % plan.cycleBars;
  const music = s.arrangement;

  // Past the eighth bar we are in the composed silence. Emit nothing.
  if (bar >= THEME_BARS.length) return barLen;
  if (plan.gain <= 0.001) return barLen;

  const r = s.random;

  // ---- pad: a wooden harmonium breath, slow in and slow out ----------
  const padVoicing = PAD_BY_BAR[bar];
  if (plan.pad > 0.01 && padVoicing) {
    for (let i = 0; i < padVoicing.length; i++) {
      organNote({
        dest: music,
        when: t + 0.01 * i,
        freq: midiToFreq(padVoicing[i] - 12),
        dur: barLen * 1.02,
        gain: 0.05 * plan.pad * (i === 0 ? 1 : 0.7),
        // Nearly no upper drawbars: this must be a warm cushion, not an organ solo.
        drawbars: [1.0, 0.34, 0.05, 0.08, 0.0],
        spread: 5,
        tremulant: 0.06,
        env: { attack: barLen * 0.42, decay: 0.2, sustain: 0.85, release: barLen * 0.7 },
      });
    }
  }

  // ---- bass: a felted double-bass pluck on the downbeat ---------------
  const bassNote = BASS_BY_BAR[bar];
  if (plan.bass && bassNote !== null) {
    pluck({
      dest: music,
      when: t,
      freq: midiToFreq(bassNote),
      dur: Math.min(barLen * 1.1, 2.4),
      // Heavy damping = gut strings on a wooden box, not a bright electric.
      damping: 0.82,
      attackBrightness: 0.22,
      gain: 0.16,
      seed: 4001 + bar,
    });
  }

  // ---- melody: soft mallet, and a music box an octave up on the big moods --
  if (plan.melody) {
    for (const n of THEME_BARS[bar]) {
      const when = t + n.beat * beat;
      // Humanise: a few milliseconds of drag and a little velocity wander. A
      // perfectly quantised melody is the fastest way to sound like a phone.
      const drag = (r() - 0.5) * 0.014;
      const vel = n.vel * (0.9 + r() * 0.14);
      mallet({
        dest: music,
        when: when + drag,
        freq: midiToFreq(n.midi),
        dur: clamp(n.beats * beat * 1.4, 0.5, 2.6),
        softness: 0.62,
        shimmer: 0.35,
        gain: 0.17 * vel,
      });
      if (plan.melodyOctave) {
        mallet({
          dest: music,
          when: when + drag + 0.012,
          freq: midiToFreq(n.midi + 12),
          dur: clamp(n.beats * beat, 0.4, 1.8),
          softness: 0.35,
          shimmer: 0.9,
          gain: 0.06 * vel,
          pan: 0.22,
        });
      }
    }
  }

  // ---- reveal counter-line: a slow plucked lift over the top ----------
  if (plan.counter) {
    for (const n of REVEAL_COUNTER[bar]) {
      pluck({
        dest: music,
        when: t + n.beat * beat,
        freq: midiToFreq(n.midi),
        dur: clamp(n.beats * beat * 1.5, 0.8, 3),
        damping: 0.5,
        attackBrightness: 0.3,
        gain: 0.11 * n.vel,
        pan: -0.25,
        seed: 7700 + bar,
      });
    }
  }

  // ---- celebration sparkle: bells on the off-beats of the even bars ----
  if (plan.sparkle && bar % 2 === 0) {
    // Pentatonic above the tune so nothing can clash whatever the harmony does.
    const shimmerNotes = [84, 88, 89, 91];
    const count = 2 + Math.floor(r() * 2);
    for (let i = 0; i < count; i++) {
      bell({
        dest: music,
        when: t + (0.5 + i * 0.75 + r() * 0.2) * beat,
        freq: midiToFreq(shimmerNotes[Math.floor(r() * shimmerNotes.length)]),
        dur: 1.4,
        ratio: 1.41,
        index: 3.2,
        gain: 0.035,
        pan: r() * 1.4 - 0.7,
      });
    }
  }

  // Thinking mood: ONE note, once per cycle, as a place-marker for the ear.
  if (mood === "thinking" && bar === 0) {
    pluck({
      dest: music,
      when: t + beat * 1.5,
      freq: midiToFreq(THEME_TONIC),
      dur: 2.6,
      damping: 0.7,
      attackBrightness: 0.18,
      gain: 0.05,
      seed: 909,
    });
  }

  return barLen;
}

function ensureStarted(): ScoreState | null {
  if (state) return state;
  const engine = getAudioEngine();
  if (!engine) return null;
  const ctx = engine.ctx;

  const trim = ctx.createGain();
  trim.gain.value = 1;
  trim.connect(engine.buses.music);

  const arrangement = ctx.createGain();
  // Start silent: the score fades UP into whatever mood is set, so audio
  // starting mid-phrase never slaps the child with a chord.
  arrangement.gain.value = 0;
  arrangement.connect(trim);

  const s: ScoreState = {
    engine,
    arrangement,
    trim,
    scheduler: null as unknown as Scheduler,
    bar: 0,
    random: rng(0x5c04e),
  };
  s.scheduler = new Scheduler(ctx, (t, i) => scheduleBar(s, t, i), 250);
  state = s;
  return s;
}

/* ==================================================================== */
/* PUBLIC API                                                            */
/* ==================================================================== */

export interface MoodOptions {
  /** Override the cross-fade length in seconds. */
  fadeSeconds?: number;
  /** Drop back to this mood automatically — use for one-off celebrations. */
  returnTo?: MusicMood;
  /** How long to stay in the mood before returning. Default 14s. */
  holdSeconds?: number;
}

/**
 * THE ONE KNOB THE REST OF THE GAME TOUCHES.
 *
 *   setMusicMood("reveal")                         // the crest, the gate, the valley
 *   setMusicMood("thinking")                       // a puzzle is on screen
 *   setMusicMood("celebrate", { returnTo: "plaza" }) // they solved it
 *   setMusicMood("quiet")                          // cut-scene, or ChessPaa is talking a lot
 *
 * Safe to call every frame — repeating the current mood does nothing. Never
 * throws, and silently does nothing when audio is unavailable.
 */
export function setMusicMood(m: MusicMood, opts: MoodOptions = {}): void {
  try {
    if (returnTimer !== null) {
      clearTimeout(returnTimer);
      returnTimer = null;
    }
    const s = ensureStarted();
    if (!s) {
      mood = m;
      return;
    }
    if (!s.scheduler.running) {
      generation++;
      s.scheduler.start();
    }

    const plan = PLANS[m];
    /*
     * Was the score silent a moment ago? If so, nothing audible is sitting in
     * the scheduler's queue and we are free to restart the phrase from bar 0
     * immediately.
     *
     * WHY THIS MATTERS: the natural way to boot the park is
     * `startScore(); setMusicMood("plaza")`, and the scheduler books a bar
     * ahead. Without this the very first bar of the theme was always booked
     * under the default "quiet" plan and came out as silence — the park lost
     * its opening bar every single time, and a "reveal" cued at the crest
     * arrived up to 2.7 seconds after the view did. Measured, then fixed.
     */
    const wasSilent = PLANS[mood].gain <= 0.001 || s.arrangement.gain.value <= 0.002;
    const fade = opts.fadeSeconds ?? plan.fade;
    const t = s.engine.ctx.currentTime;
    const g = s.arrangement.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(g.value, 0.0001), t);
    // Linear, not exponential: a linear fade on a MUSIC bus is the one place a
    // straight line is right, because we are cross-fading arrangements rather
    // than ending a note.
    g.linearRampToValueAtTime(plan.gain, t + Math.max(fade, 0.05));
    mood = m;
    if (wasSilent && plan.gain > 0.001) s.scheduler.restart();

    if (opts.returnTo) {
      const hold = (opts.holdSeconds ?? 14) * 1000;
      returnTimer = setTimeout(() => {
        returnTimer = null;
        setMusicMood(opts.returnTo as MusicMood);
      }, hold);
    }
  } catch {
    /* audio is a bonus, never a blocker */
  }
}

/** What the score is currently doing. */
export function currentMusicMood(): MusicMood {
  return mood;
}

/**
 * Start the score engine. Idempotent, and normally you do not need to call it —
 * `setMusicMood` starts it. Begins in whatever mood is already set (default
 * "quiet"), so the park can start in silence and swell in when it is ready.
 */
export function startScore(): void {
  try {
    const s = ensureStarted();
    if (!s) return;
    generation++;
    if (!s.scheduler.running) s.scheduler.start();
  } catch {
    /* ignore */
  }
}

/** Fade the score out and stop scheduling. The mood setting is remembered. */
export function stopScore(fadeSeconds = 1.5): void {
  try {
    // Drop any pending "…and then go back to plaza". Without this, stopping the
    // park during a celebration lets that timer fire up to 14 seconds later and
    // restart the music on a screen that is supposed to be silent — a ghost
    // score playing over the next scene.
    if (returnTimer !== null) {
      clearTimeout(returnTimer);
      returnTimer = null;
    }
    if (!state) return;
    const t = state.engine.ctx.currentTime;
    const g = state.arrangement.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(g.value, 0.0001), t);
    g.linearRampToValueAtTime(0, t + fadeSeconds);
    const sched = state.scheduler;
    const mine = generation;
    setTimeout(() => {
      if (mine === generation) sched.stop();
    }, fadeSeconds * 1000 + 120);
  } catch {
    /* ignore */
  }
}

/** Settings-slider trim for music only, 0..1. Independent of mood. */
export function setMusicVolume(v: number): void {
  try {
    if (!state) return;
    const t = state.engine.ctx.currentTime;
    state.trim.gain.setTargetAtTime(clamp(v, 0, 1), t, 0.08);
  } catch {
    /* ignore */
  }
}

/**
 * Play the theme's opening gesture as a one-off flourish — for a gate opening
 * or a first-visit title card, where you want the tune stated once and then
 * silence. Returns the context time it ends (0 if there is no audio).
 */
export function playThemeFlourish(gain = 0.22): number {
  const engine = getAudioEngine();
  if (!engine) return 0;
  try {
    const t0 = engine.ctx.currentTime + 0.03;
    const beat = 0.42;
    let end = t0;
    THEME_MOTIF.slice(0, 4).forEach((midi, i) => {
      end = mallet({
        dest: engine.buses.music,
        when: t0 + i * beat,
        freq: midiToFreq(midi),
        dur: i === 3 ? 2.4 : 0.9,
        softness: 0.55,
        shimmer: 0.6,
        gain: gain * (i === 3 ? 1 : 0.85),
      });
    });
    return end;
  } catch {
    return 0;
  }
}
