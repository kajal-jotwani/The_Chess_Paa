"use client";

/**
 * THE AUDIO FACADE — the only file the rest of the game needs to import.
 *
 *   import { initAudio, startParkAudio, playMove, speakAsChessPaa, setMusicMood } from "@/lib/audio";
 *
 * Three promises this file keeps, so that no caller ever has to think about
 * Web Audio again:
 *
 *   1. IT NEVER THROWS. Not on the server, not in a browser with audio
 *      disabled, not in an iframe with no gesture, not in Safari private mode.
 *      Every entry point is wrapped; the worst case is a silent park.
 *   2. THE CONTEXT IS CREATED LAZILY, ON A REAL USER GESTURE. Browsers refuse
 *      to start audio otherwise, and — just as important — building it early
 *      logs a scary autoplay warning and burns a little CPU on a page the child
 *      may never scroll past.
 *   3. MUTE MEANS SILENCE. One switch, on the master gain, in front of the
 *      reverb returns, persisted to localStorage and shared with the existing
 *      sound toggle in the UI.
 */

import {
  BUS_NAMES,
  audioRunning,
  clamp,
  getAudioEngine,
  resumeAudio,
  type BusName,
} from "./synth";
import { setMusicMood, startScore, stopScore } from "./score";
import { setAmbienceIntensity, soundscapeRunning, startSoundscape, stopSoundscape } from "./soundscape";
import { stopNarration } from "./chessPaaVoice";

/* ==================================================================== */
/* PREFERENCES                                                           */
/* ==================================================================== */

/** Shared with the pre-existing UI toggle in @/lib/sound so one switch rules both. */
const PREF_SOUND = "chesspaa:sound";

function readPref(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* private mode — the setting just will not survive a reload */
  }
}

let muted = false;
let masterVolume = 1;
let prefsLoaded = false;

function loadPrefs(): void {
  if (prefsLoaded || typeof window === "undefined") return;
  prefsLoaded = true;
  muted = !readPref(PREF_SOUND, true);
}

/** Push the current mute/volume state onto the master gain, click-free. */
function applyMaster(): void {
  const e = getAudioEngine();
  if (!e) return;
  const target = muted ? 0 : clamp(masterVolume, 0, 1);
  const t = e.ctx.currentTime;
  const g = e.master.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  // 60ms is fast enough to feel instant and slow enough never to click.
  g.linearRampToValueAtTime(target, t + 0.06);
}

/* ==================================================================== */
/* GESTURE UNLOCK                                                        */
/* ==================================================================== */

type ReadyCallback = () => void;

let armed = false;
let readyQueue: ReadyCallback[] = [];
const GESTURES = ["pointerdown", "touchend", "keydown", "click"] as const;

function flushReady(): void {
  const q = readyQueue;
  readyQueue = [];
  for (const cb of q) {
    try {
      cb();
    } catch {
      /* one bad callback must not stop the others */
    }
  }
}

function onGesture(): void {
  // Create + resume INSIDE the gesture handler. Doing it in a promise callback
  // afterwards is exactly the mistake that makes iOS refuse to play anything.
  const e = getAudioEngine();
  if (!e) {
    disarm();
    return;
  }
  loadPrefs();
  applyMaster();
  void resumeAudio().then(() => {
    if (audioRunning()) {
      disarm();
      flushReady();
    }
  });
  // Some browsers report "running" synchronously — take the fast path too.
  if (e.ctx.state === "running") {
    disarm();
    flushReady();
  }
}

function disarm(): void {
  if (!armed || typeof window === "undefined") return;
  armed = false;
  for (const g of GESTURES) {
    window.removeEventListener(g, onGesture);
  }
}

/**
 * Arm the park to wake up on the child's first touch, click or key press.
 * Call this once, high up (a layout or the park client). Safe on the server,
 * safe to call repeatedly.
 */
export function initAudio(): void {
  if (typeof window === "undefined" || armed) return;
  loadPrefs();
  armed = true;
  for (const g of GESTURES) {
    // `passive` so we never delay a scroll or a tap on a touch device.
    window.addEventListener(g, onGesture, { passive: true });
  }
  armVisibilityHandling();
}

/**
 * Force the audio awake right now. MUST be called from inside a real user
 * gesture handler (a button's onClick) or the browser will ignore it. Resolves
 * either way; check `isAudioReady()` afterwards if you care.
 */
export async function unlockAudio(): Promise<void> {
  loadPrefs();
  const e = getAudioEngine();
  if (!e) return;
  applyMaster();
  await resumeAudio();
  if (audioRunning()) {
    disarm();
    flushReady();
  }
}

/** True once sound can actually be heard. */
export function isAudioReady(): boolean {
  return audioRunning();
}

/**
 * Run `cb` as soon as audio is genuinely playable — immediately if it already
 * is. Use it to start ambience without having to care whether the child has
 * touched the screen yet.
 */
export function whenAudioReady(cb: ReadyCallback): void {
  if (audioRunning()) {
    try {
      cb();
    } catch {
      /* ignore */
    }
    return;
  }
  readyQueue.push(cb);
  initAudio();
}

/* ==================================================================== */
/* TAB VISIBILITY                                                        */
/* ==================================================================== */

let visibilityArmed = false;

/**
 * A park humming away in a background tab is a battery drain and, worse, a
 * mystery noise for a parent who has switched to their email. Fade out and
 * genuinely suspend the context when hidden; fade back in on return.
 */
function armVisibilityHandling(): void {
  if (visibilityArmed || typeof document === "undefined") return;
  visibilityArmed = true;
  document.addEventListener("visibilitychange", () => {
    const e = getAudioEngine();
    if (!e) return;
    try {
      if (document.hidden) {
        stopNarration();
        const t = e.ctx.currentTime;
        e.master.gain.cancelScheduledValues(t);
        e.master.gain.setValueAtTime(e.master.gain.value, t);
        e.master.gain.linearRampToValueAtTime(0, t + 0.25);
        window.setTimeout(() => {
          if (document.hidden) void e.ctx.suspend().catch(() => undefined);
        }, 320);
      } else {
        void e.ctx.resume().catch(() => undefined);
        applyMaster();
      }
    } catch {
      /* ignore */
    }
  });
}

/* ==================================================================== */
/* VOLUME + MUTE                                                         */
/* ==================================================================== */

/** Global mute. Kills reverb tails too — silence means silence. Persisted. */
export function setMuted(m: boolean): void {
  loadPrefs();
  muted = m;
  writePref(PREF_SOUND, !m);
  if (m) stopNarration();
  applyMaster();
}

export function isMuted(): boolean {
  loadPrefs();
  return muted;
}

/** Flip mute and return the new state — handy straight off a button. */
export function toggleMuted(): boolean {
  setMuted(!isMuted());
  return muted;
}

/** Master volume 0..1, independent of mute. */
export function setMasterVolume(v: number): void {
  masterVolume = clamp(v, 0, 1);
  applyMaster();
}

export function getMasterVolume(): number {
  return masterVolume;
}

/**
 * Per-family volume: "music" | "sfx" | "ambience" | "voice".
 * Useful for an accessibility panel — some children want the park loud and the
 * music off, and some want only ChessPaa's voice.
 */
export function setBusVolume(bus: BusName, v: number): void {
  const e = getAudioEngine();
  if (!e) return;
  try {
    e.buses[bus].gain.setTargetAtTime(clamp(v, 0, 1.5), e.ctx.currentTime, 0.05);
  } catch {
    /* ignore */
  }
}

/* ==================================================================== */
/* ONE-CALL LIFECYCLE                                                    */
/* ==================================================================== */

export interface ParkAudioOptions {
  /** Deterministic seed for the ambience. Same seed, same evening. */
  seed?: number;
  /** Mood to open on. Default "plaza". Pass "quiet" to start in silence. */
  mood?: Parameters<typeof setMusicMood>[0];
  /** 0..1 ambience level to start at. */
  intensity?: number;
}

/**
 * START THE WHOLE PARK. Waits for a user gesture on its own, so it is safe to
 * call from a `useEffect` on mount:
 *
 *   useEffect(() => { initAudio(); startParkAudio(); return stopParkAudio; }, []);
 */
export function startParkAudio(opts: ParkAudioOptions = {}): void {
  initAudio();
  whenAudioReady(() => {
    applyMaster();
    startSoundscape({ seed: opts.seed, intensity: opts.intensity });
    startScore();
    setMusicMood(opts.mood ?? "plaza");
  });
}

/** Fade everything out and free the graph. The AudioContext itself is kept. */
export function stopParkAudio(): void {
  try {
    stopNarration();
    stopScore();
    stopSoundscape();
  } catch {
    /* ignore */
  }
}

/** True when the living park is currently running. */
export function parkAudioRunning(): boolean {
  return soundscapeRunning();
}

/**
 * THE CONCENTRATION SWITCH — one call for "a child is now thinking".
 *
 * Hushes the park to a third and drops the score to near-silence; `false`
 * brings the evening back. This pairing is deliberate and is the most important
 * mix move in the game: puzzles are quiet, the world is loud, and the contrast
 * between them is what makes coming back out onto the plaza feel like relief.
 */
export function setConcentrating(on: boolean): void {
  try {
    setAmbienceIntensity(on ? 0.32 : 1, on ? 1.6 : 3.5);
    setMusicMood(on ? "thinking" : "plaza");
  } catch {
    /* ignore */
  }
}

/* ==================================================================== */
/* PUBLIC SURFACE                                                        */
/* ==================================================================== */

export type { BusName };
export { BUS_NAMES };

// --- the instrument kit, for anyone building a new sound --------------
export {
  bell,
  dbToGain,
  drone,
  formantVoice,
  getAudioEngine,
  karplusBuffer,
  mallet,
  midiToFreq,
  noiseBed,
  noiseHit,
  organNote,
  pluck,
  renderImpulse,
  Scheduler,
  tone,
  woodKnock,
  type AudioEngine,
  type DroneHandle,
  type Envelope,
  type NoiseBedHandle,
  type SustainHandle,
  type Vec3Like,
  type Vowel,
} from "./synth";

// --- the park ---------------------------------------------------------
export {
  createCoasterAudio,
  createFerrisAudio,
  createTrainAudio,
  playBrilliant,
  playCapture,
  playCastle,
  playCelebration,
  playCheck,
  playCheckmate,
  playMove,
  playNotThatOne,
  playPieceLift,
  playPromotion,
  playReaction,
  playStalemate,
  playTick,
  playWhoosh,
  setAmbienceIntensity,
  soundscapeRunning,
  startSoundscape,
  stopSoundscape,
  trainWhistle,
  updateListener,
  type BoardSoundOptions,
  type Reaction,
  type RideHandle,
  type SoundscapeOptions,
} from "./soundscape";

// --- the score --------------------------------------------------------
export {
  currentMusicMood,
  playThemeFlourish,
  setMusicMood,
  setMusicVolume,
  startScore,
  stopScore,
  THEME_MOTIF,
  THEME_TONIC,
  type MoodOptions,
  type MusicMood,
} from "./score";

// --- ChessPaa ---------------------------------------------------------
export {
  chessPaaMurmur,
  narrationAvailable,
  narrationEnabled,
  playChessPaaMotif,
  setNarrationEnabled,
  speakAsChessPaa,
  stopChessPaa,
  stopNarration,
  type SpeakOptions,
  type VoiceTone,
} from "./chessPaaVoice";
