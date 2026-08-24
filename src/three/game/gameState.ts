"use client";

import * as THREE from "three";
import { STOP_T, stopFrame, type StopName } from "../world/coasterSpine";

/**
 * THE GAME DIRECTOR.
 *
 * One small store that owns what kind of moment the child is in:
 *
 *   explore — walking the park as a kid, free camera, prompts near doors
 *   riding  — seated behind ChessPaa on the train, on rails, stations ahead
 *   lesson  — hopped off at a level; a 3D board owns the screen
 *   cine    — a posed camera (harness/screenshots); any input returns control
 *
 * Everything else (player rig, ride, HUD, lessons) reads and writes THIS,
 * never each other — that is what keeps a park full of systems feeling like
 * one game instead of five demos taped together.
 */

export type GameMode = "explore" | "riding" | "lesson" | "cine";

export type LessonKind = "pieces" | "tactics" | "match";

export interface StationDef {
  stop: StopName;
  /** Order along the ride, 1-based; scenic stops have level: null. */
  level: 1 | 2 | 3 | null;
  name: string;
  icon: string;
  lesson: LessonKind | null;
  /** ChessPaa's line as the train pulls in. */
  arrive: string;
  /** ChessPaa's line as the train sets off toward it. */
  depart: string;
}

/** The ride visits these in spine order, starting from the gate. */
export const STATIONS: StationDef[] = [
  {
    stop: "plaza", level: 3, name: "The Grand Match", icon: "⛺", lesson: "match",
    arrive: "The Grand Match tent — Level three, the finale! You and I will play a whole game here one day soon. Shall we ride on to Level one first?",
    depart: "Off we roll! Hold the rail, little one.",
  },
  {
    stop: "parade", level: 1, name: "The Piece Parade", icon: "🏇", lesson: "pieces",
    arrive: "Level one — the Piece Parade! Every piece has a song and a secret. Shall we meet your team?",
    depart: "Next stop, the Piece Parade — my favourite little theatre.",
  },
  {
    stop: "ferris", level: null, name: "The Endgame Wheel", icon: "🎡", lesson: null,
    arrive: "The great slow wheel! The gondola lessons are still being polished — but isn't she lovely against the sky?",
    depart: "Round the bend now — look at the wheel turning!",
  },
  {
    stop: "coaster", level: 2, name: "The Tactics Summit", icon: "⚡", lesson: "tactics",
    arrive: "Level two — the Tactics Summit! Forks and pins and sneaky checks. Puzzles make the cart go fast!",
    depart: "Now we CLIMB. Don't peek… don't peek… the whole wonderland is about to say hello.",
  },
  {
    stop: "train", level: null, name: "The Puzzle Depot", icon: "🚂", lesson: null,
    arrive: "The little depot! The puzzle express will run from here soon. Smell that? Cocoa and coal smoke.",
    depart: "Down the hill we go — wheee!",
  },
  {
    stop: "gate", level: null, name: "The Gate", icon: "🏮", lesson: null,
    arrive: "And home again to the gates. Ride once more, or wander wherever you like — the park is yours.",
    depart: "One last bend and we're home.",
  },
];

export function stationFor(stop: StopName): StationDef | undefined {
  return STATIONS.find((s) => s.stop === stop);
}

/** Stations sorted by their parametric position going FORWARD from the gate. */
export function rideOrderFrom(t0: number): StationDef[] {
  return [...STATIONS].sort(
    (a, b) => (((STOP_T[a.stop] - t0) % 1) + 1) % 1 - ((((STOP_T[b.stop] - t0) % 1) + 1) % 1)
  );
}

/* ------------------------------------------------------------------ */
/* progression — local only, no accounts, nothing leaves the device    */
/* ------------------------------------------------------------------ */

export function starsFor(kind: LessonKind): number {
  try { return parseInt(localStorage.getItem(`cp3d:stars:${kind}`) ?? "0", 10) || 0; } catch { return 0; }
}
export function grantStars(kind: LessonKind, n: number): number {
  const v = Math.max(starsFor(kind), n);
  try { localStorage.setItem(`cp3d:stars:${kind}`, String(v)); } catch {}
  director.emit();
  return v;
}

/* ------------------------------------------------------------------ */
/* the input bus — HUD writes, rigs read                               */
/* ------------------------------------------------------------------ */

export const input = {
  /** -1..1 camera-relative move (x = strafe, y = forward). */
  move: new THREE.Vector2(0, 0),
  /** Accumulated look delta in px since last frame; rigs consume + clear. */
  look: new THREE.Vector2(0, 0),
  zoomDelta: 0,
  /** Set true for one read when the interact button/key fires. */
  interact: false,
  consumeInteract(): boolean { const v = this.interact; this.interact = false; return v; },
  consumeLook(out: THREE.Vector2): THREE.Vector2 { out.copy(this.look); this.look.set(0, 0); return out; },
  consumeZoom(): number { const v = this.zoomDelta; this.zoomDelta = 0; return v; },
};

/* ------------------------------------------------------------------ */
/* the director                                                        */
/* ------------------------------------------------------------------ */

export interface CinePose {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

export interface Prompt {
  id: string;
  label: string;
  icon: string;
}

class Director {
  mode: GameMode = "explore";

  /** Where the walking kid is. The rig owns it; others may read. */
  readonly playerPos = new THREE.Vector3(6.5, 0, 68);
  playerYaw = Math.PI; // facing into the park

  /** Ride state. */
  rideT = STOP_T.gate;
  rideSpeed = 0;
  /** Station we are currently stopped at (riding, speed 0), else null. */
  atStation: StationDef | null = null;
  /** Next station the car is heading toward. */
  nextStation: StationDef | null = null;

  lesson: LessonKind | null = null;
  lessonStation: StationDef | null = null;

  /** The line on ChessPaa's speech card right now. */
  speech = "";
  speechTone: "warm" | "delighted" | "caring" | "teaching" = "warm";
  private speechSeq = 0;

  /** Interaction prompt currently offered (explore mode). */
  prompt: Prompt | null = null;

  cine: CinePose | null = null;

  private listeners = new Set<() => void>();
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() { for (const fn of this.listeners) fn(); }

  say(text: string, tone: Director["speechTone"] = "warm") {
    this.speech = text;
    this.speechTone = tone;
    this.speechSeq++;
    this.emit();
  }
  get speechKey() { return this.speechSeq; }

  setPrompt(p: Prompt | null) {
    const changed = (p?.id ?? null) !== (this.prompt?.id ?? null);
    this.prompt = p;
    if (changed) this.emit();
  }

  /** Board the train at the gate platform. */
  startRide() {
    if (this.mode === "riding") return;
    this.mode = "riding";
    this.cine = null;
    this.rideT = STOP_T.gate;
    this.rideSpeed = 0;
    this.atStation = null;
    // +0.002: the gate itself sits at delta zero and must not count as the
    // first stop of the journey it is the start of.
    this.nextStation = rideOrderFrom(STOP_T.gate + 0.002)[0] ?? null;
    this.emit();
  }

  /** Jump the car along the spine (harness/QA) and re-aim at the next stop. */
  jumpRide(t: number) {
    if (this.mode !== "riding") this.startRide();
    this.rideT = ((t % 1) + 1) % 1;
    this.atStation = null;
    this.nextStation = rideOrderFrom(this.rideT + 0.002)[0] ?? null;
    this.emit();
  }

  /** Pull away from the current stop toward the next one. */
  keepRiding() {
    if (this.mode !== "riding") return;
    const from = this.atStation ? STOP_T[this.atStation.stop] : this.rideT;
    this.atStation = null;
    this.nextStation = rideOrderFrom(from + 0.002)[0] ?? null;
    this.emit();
  }

  /** Step off at the current station onto its platform. */
  hopOff() {
    const st = this.atStation;
    if (!st) return;
    const f = stopFrame(st.stop);
    this.playerPos.set(
      f.pos.x + f.binormal.x * 2.4,
      f.pos.y,
      f.pos.z + f.binormal.z * 2.4
    );
    this.playerYaw = Math.atan2(-f.binormal.x, -f.binormal.z);
    this.mode = "explore";
    this.atStation = null;
    this.emit();
  }

  openLesson(kind: LessonKind, station: StationDef | null) {
    this.lesson = kind;
    this.lessonStation = station;
    this.mode = "lesson";
    this.emit();
  }

  closeLesson() {
    this.lesson = null;
    this.mode = this.atStation ? "riding" : "explore";
    this.emit();
  }

  /** Harness/cinematic override; any real input clears it. */
  setCine(pose: CinePose | null) {
    this.cine = pose;
    this.mode = pose ? "cine" : "explore";
    this.emit();
  }
  cancelCine() {
    if (this.mode === "cine") { this.cine = null; this.mode = "explore"; this.emit(); }
  }
}

export const director = new Director();

/* ------------------------------------------------------------------ */
/* walkable-world helpers                                              */
/* ------------------------------------------------------------------ */

/** Round things a small rider cannot walk through. [x, z, radius] */
export const COLLIDERS: Array<[number, number, number]> = [
  [0, 0, 6.8],        // the Grand Match tent
  [21, 3, 6.2],       // plaza carousel
  [-46, -24, 8.5],    // piece parade canopy
  [-70, -60, 7.5],    // ferris wheel base
  [64, -74, 7.5],     // tactics station house
  [36, 30, 6.5],      // puzzle depot
  [12.8, 64, 1.6],    // gate arch post (east)
  [-0.6, 64, 1.6],    // gate arch post (west)
  [10.5, 70.5, 2.2],  // ticket kiosk
];

export function resolveCollisions(p: THREE.Vector3, radius = 0.55): void {
  for (const [cx, cz, cr] of COLLIDERS) {
    const dx = p.x - cx, dz = p.z - cz;
    const min = cr + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 < min * min && d2 > 1e-8) {
      const d = Math.sqrt(d2);
      p.x = cx + (dx / d) * min;
      p.z = cz + (dz / d) * min;
    }
  }
  // stay inside the valley bowl
  const r = Math.hypot(p.x, p.z);
  if (r > 96) { p.x *= 96 / r; p.z *= 96 / r; }
}
