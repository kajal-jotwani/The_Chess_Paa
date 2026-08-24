"use client";

/**
 * CHESSPAA'S VOICE — and there is not one audio file in it.
 *
 * THE IDEA: he is voiced the way the best animated grandfathers are scored
 * rather than dubbed. Every time he speaks, a short wordless MOTIF plays
 * underneath the line — a hummed two-or-three-note figure in a warm, breathy
 * timbre. It is always a quotation of THE CHESSPAA THEME (see score.ts), so
 * after ten minutes a child recognises "that's him" before a single word lands.
 * Melodically it does the emotional work:
 *
 *   warm      — the theme's opening lift. "There you are."
 *   delighted — the same lift, faster, higher, with a bell on top. "Oh, LOOK."
 *   caring    — ONE note that FALLS, slowly, with breath in it. "Ooh, careful."
 *               A falling minor third is the universal shape of gentle concern;
 *               it is what a person actually does with their voice when a child
 *               is about to knock over a glass. It is never a buzzer, never
 *               dissonant, and it resolves onto a low warm note so the child is
 *               left held rather than told off.
 *   teaching  — two level notes and a small lift at the end, the shape of a
 *               question. "Here — see?" An invitation, not a correction.
 *
 * The timbre is a formant-filtered voice (real human vowel resonances) with a
 * quiet plucked string an octave below. The string is what makes him feel
 * HANDMADE — like a man who whittles — instead of like a synthesiser.
 *
 * Browser speech synthesis is layered ON TOP as optional narration for children
 * who cannot read yet. It is genuinely optional: on a device with no voices,
 * or with narration switched off, he still "speaks" via the motif and the
 * on-screen bubble, and nothing here throws.
 */

import {
  bell,
  clamp,
  formantVoice,
  getAudioEngine,
  midiToFreq,
  pluck,
  type AudioEngine,
} from "./synth";
import { THEME_MOTIF, THEME_TONIC } from "./score";

export type VoiceTone = "warm" | "delighted" | "caring" | "teaching";

/* ==================================================================== */
/* THE MOTIFS                                                            */
/* ==================================================================== */

interface MotifNote {
  /** MIDI pitch. */
  midi: number;
  /** Seconds from the start of the motif. */
  at: number;
  /** Seconds. */
  dur: number;
  /** Relative loudness 0..1. */
  vel: number;
  /** Optional glide target in MIDI — the whole trick of "caring". */
  bendTo?: number;
  vowel?: "mm" | "oo" | "oh" | "ah" | "ee";
}

interface MotifShape {
  notes: readonly MotifNote[];
  /** Overall level. He murmurs; he does not announce. */
  gain: number;
  /**
   * Formant shift. Below 1 = a larger head and a longer throat = an older,
   * bigger man. 0.84 is a warm grandfather; 1.15 would be a child.
   */
  formantShift: number;
  /** A high bell on the last note — reserved for genuine delight. */
  sparkle: boolean;
  /** Root of the low string that sits under him. */
  stringMidi: number;
  /** How much of the theme's own harmony to leave ringing. */
  stringGain: number;
}

// THEME_MOTIF = F4 A4 C5 Bb4 D5 C5 A4 G4 F4. The motifs below are all cut
// from it, which is why they sound like the same person and the same park.
const T = THEME_MOTIF;

const MOTIFS: Record<VoiceTone, MotifShape> = {
  /** The theme's first lift, unhurried. His "hello" and his default. */
  warm: {
    notes: [
      { midi: T[0], at: 0.0, dur: 0.3, vel: 0.85, vowel: "mm" },
      { midi: T[1], at: 0.22, dur: 0.52, vel: 1.0, vowel: "oh" },
    ],
    gain: 0.127,
    formantShift: 0.84,
    sparkle: false,
    stringMidi: THEME_TONIC - 24,
    stringGain: 0.075,
  },

  /** The lift, faster and a fifth higher, with one bell. Pure grandfather joy. */
  delighted: {
    notes: [
      { midi: T[1], at: 0.0, dur: 0.19, vel: 0.8, vowel: "oh" },
      { midi: T[2], at: 0.15, dur: 0.2, vel: 0.9, vowel: "ah" },
      { midi: T[4] + 3, at: 0.3, dur: 0.62, vel: 1.0, vowel: "ah" },
    ],
    gain: 0.089,
    formantShift: 0.88,
    sparkle: true,
    stringMidi: THEME_TONIC - 12,
    stringGain: 0.07,
  },

  /**
   * "OOH, CAREFUL." One long note that sags a minor third, breath audible,
   * landing on a low warm string. NOTHING about this is a fail state — it is
   * the sound of someone catching your elbow, not slapping your hand.
   */
  caring: {
    notes: [
      { midi: T[2], at: 0.0, dur: 0.78, vel: 1.0, bendTo: T[1], vowel: "oo" },
      { midi: T[1] - 12, at: 0.5, dur: 0.72, vel: 0.42, vowel: "mm" },
    ],
    gain: 0.13,
    formantShift: 0.8,
    sparkle: false,
    stringMidi: THEME_TONIC - 24,
    stringGain: 0.085,
  },

  /**
   * "HERE — SEE?" Two level notes and a small rise: the intonation of an
   * invitation. Ends UP, because a question keeps a child leaning in and a
   * full stop makes them wait to be told.
   */
  teaching: {
    notes: [
      { midi: T[2], at: 0.0, dur: 0.22, vel: 0.72, vowel: "mm" },
      { midi: T[2], at: 0.19, dur: 0.22, vel: 0.68, vowel: "mm" },
      { midi: T[3], at: 0.38, dur: 0.54, vel: 0.9, bendTo: T[4], vowel: "oh" },
    ],
    gain: 0.18,
    formantShift: 0.84,
    sparkle: false,
    stringMidi: THEME_TONIC - 19,
    stringGain: 0.06,
  },
};

/* ==================================================================== */
/* THE MOTIF PLAYER                                                      */
/* ==================================================================== */

export interface MotifOptions {
  /** Scale the motif's level, 1 = normal. */
  gain?: number;
  /** Absolute context time; defaults to now. */
  when?: number;
}

/**
 * Play the wordless motif on its own. Use this for moments with no line at all
 * — he tilts his head, he notices something — where a sound is worth more than
 * a sentence. Returns the context time it finishes (0 when audio is off).
 */
export function playChessPaaMotif(tone: VoiceTone, opts: MotifOptions = {}): number {
  const engine = getAudioEngine();
  if (!engine) return 0;
  try {
    return renderMotif(engine, tone, opts);
  } catch {
    return 0;
  }
}

function renderMotif(engine: AudioEngine, tone: VoiceTone, opts: MotifOptions): number {
  const shape = MOTIFS[tone];
  const dest = engine.buses.voice;
  const t0 = opts.when ?? engine.ctx.currentTime + 0.02;
  const level = shape.gain * (opts.gain ?? 1);
  let end = t0;

  // The whittled-wood underlay: one soft, heavily damped string. It arrives a
  // hair BEFORE the voice, the way a real person's chest moves before the sound.
  pluck({
    dest,
    when: t0 - 0.012,
    freq: midiToFreq(shape.stringMidi),
    dur: 2.1,
    damping: 0.86,
    attackBrightness: 0.16,
    gain: shape.stringGain * (opts.gain ?? 1),
    seed: 611,
  });

  for (let i = 0; i < shape.notes.length; i++) {
    const n = shape.notes[i];
    const when = t0 + n.at;
    const e = formantVoice({
      dest,
      when,
      freq: midiToFreq(n.midi),
      dur: n.dur,
      vowel: n.vowel ?? "mm",
      bendTo: n.bendTo !== undefined ? midiToFreq(n.bendTo) : undefined,
      // Start the sag late and let it take the whole tail — a fast glide sounds
      // like a slide whistle; a slow one sounds like a sigh.
      bendFrom: 0.45,
      breath: tone === "caring" ? 0.3 : 0.16,
      vibrato: tone === "caring" ? 14 : 24,
      formantShift: shape.formantShift,
      gain: level * n.vel,
      env: {
        attack: tone === "delighted" ? 0.03 : 0.055,
        decay: 0.09,
        sustain: 0.8,
        release: tone === "caring" ? 0.34 : 0.2,
      },
      pan: -0.06 + i * 0.05,
    });
    end = Math.max(end, e);
  }

  if (shape.sparkle) {
    const last = shape.notes[shape.notes.length - 1];
    bell({
      dest,
      when: t0 + last.at + 0.05,
      freq: midiToFreq(last.midi + 24),
      dur: 1.5,
      ratio: 1.41,
      index: 3.6,
      gain: 0.05 * (opts.gain ?? 1),
      pan: 0.3,
    });
  }
  return end;
}

/* ==================================================================== */
/* NARRATION (browser speech synthesis — strictly a bonus layer)         */
/* ==================================================================== */

/** Shares the key the existing UI toggle already writes, so one switch rules both. */
const PREF_VOICE = "chesspaa:voice";
/**
 * The MASTER sound switch, read directly rather than imported from the facade —
 * index.ts imports this file, so importing it back would be a cycle.
 *
 * Narration does NOT go through the WebAudio master gain: the operating system
 * speaks it. So the mute button, which silences everything else by pulling one
 * gain node to zero, has no power over it at all unless we check here. Without
 * this a child who mutes the game still gets a talking grandfather, which is
 * exactly the failure a parent hits at bedtime.
 */
const PREF_SOUND = "chesspaa:sound";

let cachedVoice: SpeechSynthesisVoice | null = null;
let voiceListenerArmed = false;
/**
 * The pending `speak` call. Narration starts 200ms after the motif, and that gap
 * has to be cancellable: without this handle, `stopNarration()` (mute, tab
 * hidden, scene change) cancels only what is ALREADY speaking and a line booked
 * a moment earlier still arrives, and two lines fired in quick succession both
 * survive their own `cancel()` and talk over each other.
 */
let pendingSpeak: number | null = null;

function cancelPendingSpeak(): void {
  if (pendingSpeak !== null) {
    clearTimeout(pendingSpeak);
    pendingSpeak = null;
  }
}

function speech(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  try {
    return window.speechSynthesis ?? null;
  } catch {
    return null;
  }
}

/** True when this browser can narrate at all. */
export function narrationAvailable(): boolean {
  return speech() !== null && typeof SpeechSynthesisUtterance !== "undefined";
}

export function narrationEnabled(): boolean {
  if (!narrationAvailable()) return false;
  try {
    // Muted beats everything. See PREF_SOUND above for why this has to be
    // checked here rather than left to the master gain.
    if (localStorage.getItem(PREF_SOUND) === "0") return false;
    const v = localStorage.getItem(PREF_VOICE);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export function setNarrationEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF_VOICE, on ? "1" : "0");
  } catch {
    /* private mode; the setting simply will not persist */
  }
  if (!on) stopNarration();
}

/**
 * Pick the warmest available English voice.
 *
 * Voices load asynchronously in Chrome — getVoices() is famously empty on the
 * first call — so we also listen once for `voiceschanged` and re-pick. Without
 * that, the very first thing ChessPaa ever says comes out in the robot default.
 */
function pickVoice(): SpeechSynthesisVoice | null {
  const s = speech();
  if (!s) return null;
  if (cachedVoice) return cachedVoice;
  if (!voiceListenerArmed) {
    voiceListenerArmed = true;
    try {
      s.addEventListener("voiceschanged", () => {
        cachedVoice = null;
      });
    } catch {
      /* older browsers: onvoiceschanged only. Not worth the branch. */
    }
  }
  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = s.getVoices();
  } catch {
    return null;
  }
  if (voices.length === 0) return null;
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const pool = en.length > 0 ? en : voices;
  cachedVoice =
    // Named voices that tend to be warm rather than clipped and newsreaderish.
    pool.find((v) => /daniel|george|arthur|alex|fred|grand|story|warm/i.test(v.name)) ??
    pool.find((v) => /natural|enhanced|premium/i.test(v.name)) ??
    pool.find((v) => v.default) ??
    pool[0] ??
    null;
  return cachedVoice;
}

/** How his delivery changes with the emotion. Slower and lower is older and kinder. */
const DELIVERY: Record<VoiceTone, { rate: number; pitch: number }> = {
  warm: { rate: 0.92, pitch: 0.92 },
  delighted: { rate: 1.0, pitch: 1.02 },
  // Slow and low: you cannot rush a warning to a five-year-old and be kind.
  caring: { rate: 0.84, pitch: 0.86 },
  teaching: { rate: 0.88, pitch: 0.94 },
};

/** Emoji and chess glyphs are for the eye; they make TTS say "sparkles". */
const STRIP = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2660}-\u{26FF}️]/gu;

function spoken(text: string): string {
  return text.replace(STRIP, " ").replace(/\s+/g, " ").trim();
}

/** Rough spoken length, used to hold the music duck for the right amount of time. */
function estimateSeconds(text: string, rate: number): number {
  const words = Math.max(1, text.split(/\s+/).length);
  // ~2.6 words/second is a comfortable read-aloud pace for a child audience.
  return clamp((words / 2.6) / Math.max(rate, 0.5) + 0.35, 0.6, 12);
}

/* ==================================================================== */
/* THE ONE CALL THE GAME MAKES                                           */
/* ==================================================================== */

export interface SpeakOptions {
  /** Play the motif but skip narration even if it is enabled. */
  silentNarration?: boolean;
  /** Scale the motif level. */
  gain?: number;
  /** Skip the automatic music/ambience duck (rarely right). */
  noDuck?: boolean;
}

/**
 * CHESSPAA SPEAKS.
 *
 *   speakAsChessPaa("There you are! Shall we find your rook?", "warm");
 *   speakAsChessPaa("Ooh — careful. Your queen is standing in the open.", "caring");
 *
 * What actually happens, in order:
 *   1. the park leans back: music and ambience duck ~40% for the length of the line;
 *   2. his motif starts immediately — this is the part that IS his voice;
 *   3. narration (if available and switched on) starts ~200ms later, so the
 *      motif is heard UNDER the words rather than as a beep before them.
 *
 * Never throws. Safe with no audio, no speech synthesis, no user gesture yet.
 */
export function speakAsChessPaa(
  text: string,
  tone: VoiceTone = "warm",
  opts: SpeakOptions = {},
): void {
  const line = spoken(text ?? "");
  const engine = getAudioEngine();
  const delivery = DELIVERY[tone];
  const willNarrate =
    !opts.silentNarration && narrationEnabled() && line.length > 0 && narrationAvailable();
  const holdFor = willNarrate ? estimateSeconds(line, delivery.rate) : 0.7;

  if (engine) {
    try {
      // Duck to 42%: enough that a small laptop speaker gives the words room,
      // not so much that the park seems to switch off when he opens his mouth.
      if (!opts.noDuck) engine.duck(0.42, holdFor);
      renderMotif(engine, tone, { gain: opts.gain });
    } catch {
      /* motif failed; narration below may still work */
    }
  }

  if (!willNarrate) return;
  const s = speech();
  if (!s) return;
  try {
    // One voice at a time — overlapping grandfathers are a nightmare. Cancelling
    // the SPEAKING line is only half of it; a line still waiting out its 200ms
    // lead has to be dropped too, or two taps in quick succession queue two
    // utterances that both start after the cancels have already run.
    cancelPendingSpeak();
    s.cancel();
    const u = new SpeechSynthesisUtterance(line);
    u.rate = delivery.rate;
    u.pitch = delivery.pitch;
    u.volume = 0.95;
    // The 200ms lead lets the motif establish him before the words arrive — and
    // it is also the only chance Chrome gets to finish loading its voice list,
    // so PICK THE VOICE HERE rather than above. Picking early is why the very
    // first line ChessPaa ever spoke came out in the robot default: getVoices()
    // is reliably empty on the first synchronous call.
    pendingSpeak = window.setTimeout(() => {
      pendingSpeak = null;
      try {
        const v = pickVoice();
        if (v) u.voice = v;
        s.speak(u);
      } catch {
        /* the browser refused; the motif already carried the beat */
      }
    }, 200);
  } catch {
    /* narration is a bonus, never a blocker */
  }
}

/** Cut narration short (a child skipping ahead, a scene change, mute). */
export function stopNarration(): void {
  cancelPendingSpeak();
  try {
    speech()?.cancel();
  } catch {
    /* ignore */
  }
}

/** Alias kept for symmetry with `speakAsChessPaa`. */
export function stopChessPaa(): void {
  stopNarration();
}

/**
 * A tiny wordless acknowledgement — the "mm" a grandfather makes when he is
 * listening and has not decided what to say yet. Use it on hover, on pick-up,
 * on any beat where a whole line would be too much. Deliberately quieter and
 * shorter than the full motif.
 */
export function chessPaaMurmur(gain = 0.6): number {
  const engine = getAudioEngine();
  if (!engine) return 0;
  try {
    return formantVoice({
      dest: engine.buses.voice,
      freq: midiToFreq(THEME_TONIC - 12),
      dur: 0.33,
      vowel: "mm",
      breath: 0.26,
      vibrato: 18,
      formantShift: 0.8,
      gain: 0.06 * gain,
      env: { attack: 0.07, decay: 0.08, sustain: 0.7, release: 0.22 },
    });
  } catch {
    return 0;
  }
}
