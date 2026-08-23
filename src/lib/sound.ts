"use client";

/**
 * Tiny sound kit: WebAudio blips for moves (no asset files needed),
 * plus ChessPaa's spoken voice via the browser's speech synthesis.
 */

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

const PREF_SOUND = "chesspaa:sound";
const PREF_VOICE = "chesspaa:voice";

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

export function soundOn(): boolean { return readPref(PREF_SOUND, true); }
export function voiceOn(): boolean { return readPref(PREF_VOICE, true); }
export function setSoundOn(v: boolean) { try { localStorage.setItem(PREF_SOUND, v ? "1" : "0"); } catch {} }
export function setVoiceOn(v: boolean) { try { localStorage.setItem(PREF_VOICE, v ? "1" : "0"); } catch {} if (!v) stopSpeaking(); }

function tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0) {
  const a = audio();
  if (!a || !soundOn()) return;
  const t0 = a.currentTime + when;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sfx = {
  move()    { tone(340, 0.09, "sine", 0.20); },
  capture() { tone(220, 0.10, "triangle", 0.26); tone(160, 0.12, "sine", 0.2, 0.03); },
  check()   { tone(520, 0.10, "square", 0.10); tone(660, 0.12, "square", 0.09, 0.09); },
  right()   { tone(523, 0.10, "sine", 0.22); tone(659, 0.10, "sine", 0.22, 0.09); tone(784, 0.16, "sine", 0.22, 0.18); },
  wrong()   { tone(220, 0.16, "sawtooth", 0.10); tone(180, 0.22, "sawtooth", 0.09, 0.12); },
  win()     { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, "sine", 0.22, i * 0.12)); },
  ticket()  { tone(880, 0.08, "sine", 0.18); tone(1175, 0.12, "sine", 0.16, 0.07); },
  whoosh()  { tone(300, 0.25, "sine", 0.06); tone(600, 0.25, "sine", 0.05, 0.02); },
};

let voiceCache: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  if (voiceCache) return voiceCache;
  const voices = window.speechSynthesis.getVoices();
  const en = voices.filter((v) => v.lang.startsWith("en"));
  voiceCache =
    en.find((v) => /grand|story|friendly|warm/i.test(v.name)) ??
    en.find((v) => v.default) ??
    en[0] ??
    voices[0] ??
    null;
  return voiceCache;
}

/** ChessPaa reads a line aloud (if the voice toggle is on). */
export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (!voiceOn()) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[🌟🎉👍🤔😬🙈♟♞♝♜♛♚]/g, ""));
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 0.98;
    u.pitch = 1.05;
    window.speechSynthesis.speak(u);
  } catch { /* speech is a bonus, never a blocker */ }
}

export function stopSpeaking() {
  try { window.speechSynthesis?.cancel(); } catch {}
}
