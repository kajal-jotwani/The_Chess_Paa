/**
 * SLOW MOTION — the beat where a child gets to feel it.
 *
 * A brilliant move, a checkmate, a tactic solved: the world eases down to a
 * quarter speed, the light swells, and the moment is HELD — just long enough
 * for a seven-year-old to look up and realise that thing they just did was
 * theirs. Then it lets go, gently, and play continues.
 *
 * THE THREE RULES THIS FILE EXISTS TO ENFORCE:
 *
 *   1. THE LIGHT ARRIVES FIRST. The swell attacks faster than the time ramp,
 *      so the glow reads as the CAUSE of the slow motion, not a decoration on
 *      top of it — and it lingers after speed returns, so the moment fades
 *      instead of ending.
 *
 *   2. IT ALWAYS COMES BACK. Every ramp lands on exactly 1.0 and exactly 0 —
 *      never asymptotically near them. A world that runs at 0.997× forever is
 *      a bug you feel for an hour before you find it.
 *
 *   3. NOTHING STACKS INTO A LURCH. A Brilliant landed during a checkmate
 *      beat deepens and extends the beat from wherever it currently is. It
 *      never restarts from full speed, because speeding up in order to slow
 *      down is the one thing that reads as broken.
 *
 * Pure logic. No React, no three, no DOM — unit-testable anywhere.
 */

export type SlowMoKind = "brilliant" | "checkmate" | "solved" | "promotion";

export type SlowMoPhase = "idle" | "fall" | "hold" | "rise";

export interface SlowMoFrame {
  /** Multiply your world's dt by this. UI and audio stay on real time. */
  timeScale: number;
  /** 0..1 lift for bloom and exposure. */
  swell: number;
}

interface Beat {
  /** Deepest time scale. ~0.25 is the pocket: slow enough to read, fast
   *  enough that a child never thinks the game froze. */
  floor: number;
  /** Seconds to ease down. */
  fall: number;
  /** Seconds held at the floor — this is the size of the event. */
  hold: number;
  /** Seconds back to full speed. */
  rise: number;
  /** Peak of the light swell, 0..1. */
  swell: number;
}

/**
 * The beats, sized by how much the moment is worth to the child.
 *
 * Checkmate is the deepest and by far the longest — it is the end of a story.
 * "Solved" is the shortest: it fires often, and a beat that fires often must
 * never become a toll booth between one puzzle and the next.
 */
const BEATS: Record<SlowMoKind, Beat> = {
  brilliant: { floor: 0.25, fall: 0.18, hold: 0.62, rise: 0.42, swell: 0.92 },
  checkmate: { floor: 0.2, fall: 0.22, hold: 1.15, rise: 0.62, swell: 0.95 },
  solved: { floor: 0.32, fall: 0.16, hold: 0.4, rise: 0.34, swell: 0.66 },
  promotion: { floor: 0.26, fall: 0.2, hold: 0.85, rise: 0.5, swell: 0.82 },
};

/** Suggested renderer hookups, so nobody has to invent numbers at the call site:
 *    bloom.intensity      = BASE_BLOOM * (1 + swell * SWELL_BLOOM_GAIN)
 *    gl.toneMappingExposure = 1 + swell * SWELL_EXPOSURE_GAIN
 *  Restrained on purpose: the cel bands are the picture, and a blown-out
 *  frame is not a celebration, it is a mistake. */
export const SWELL_BLOOM_GAIN = 0.85;
export const SWELL_EXPOSURE_GAIN = 0.18;

/** The light breathes while it is held, at roughly a resting heart rate. */
const SHIMMER_HZ = 1.15;
const SHIMMER_DEPTH = 0.05;

/**
 * Light attacks in this fraction of the time ramp — see rule 1. Measured, not
 * guessed: the envelope is shaped by smootherstep, whose slow start eats most
 * of a head start, so anything above ~0.5 leaves the flash arriving LATE. At
 * 0.34 the light is at full brightness while the world is only two-thirds of
 * the way down, which is the order a child reads as cause and effect.
 */
const ATTACK_OF_FALL = 0.34;
/** ...and decays over this multiple of the rise — see rule 1. */
const DECAY_OF_RISE = 1.55;

/**
 * A single frame can never advance the beat by more than this. A tab that was
 * backgrounded for four seconds must not skip a child's whole moment; it
 * should pick it up where it left off.
 */
const MAX_DT = 0.1;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Grabby on the way in, soft onto the floor: exponent > 2 is the impact. */
const easeDown = (u: number): number => 1 - Math.pow(1 - u, 2.4);

/** Zero velocity at BOTH ends, so full speed is resumed without a pop. */
const easeUp = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * u);

/** Zero first derivative at both ends — the light has no corners in it. */
const smootherstep = (u: number): number => u * u * u * (u * (u * 6 - 15) + 10);

export class SlowMo {
  private phase: SlowMoPhase = "idle";

  private ts = 1;
  private floor = 1;
  private fallFrom = 1;
  private fallDur = 0.18;
  private fallT = 0;
  private holdLeft = 0;
  private riseFrom = 1;
  private riseDur = 0.42;
  private riseT = 0;

  /** Raw 0..1 light envelope; `swell` is its shaped, shimmering read-out. */
  private env = 0;
  private peak = 0;
  private attackDur = 0.12;
  private decayDur = 0.65;
  private shimmerT = 0;
  private swellOut = 0;
  private kindNow: SlowMoKind | null = null;

  /**
   * Reused every frame so the frame loop allocates nothing. READ the fields;
   * do not stash the object and expect it to hold still.
   */
  private readonly frame: SlowMoFrame = { timeScale: 1, swell: 0 };

  /** Fire a beat. Safe to call while one is already running. */
  trigger(kind: SlowMoKind): void {
    const b = BEATS[kind];

    // A beat that is still running is DEEPENED and EXTENDED. A beat that is
    // over starts clean — otherwise a checkmate's long tail would quietly
    // stretch every quick "solved" that followed it for the rest of the game.
    const running = this.phase !== "idle";
    if (!running || b.floor < this.floor) this.kindNow = kind;
    const floor = running ? Math.min(this.floor, b.floor) : b.floor;
    this.riseDur = running ? Math.max(this.riseDur, b.rise) : b.rise;
    this.holdLeft = running ? Math.max(this.holdLeft, b.hold) : b.hold;
    // The glow always takes the max, even across a fading tail: a swell that
    // dips as a second piece of good news lands would read as disappointment.
    this.peak = Math.max(this.peak, b.swell);
    this.attackDur = Math.max(0.02, b.fall * ATTACK_OF_FALL);
    this.decayDur = Math.max(0.05, this.riseDur * DECAY_OF_RISE);

    if (this.phase !== "rise" && this.ts <= floor + 1e-4) {
      // Already at least this slow — just deepen the hold, do not re-ramp.
      this.floor = floor;
      this.phase = "hold";
    } else {
      // Re-enter the fall from the CURRENT speed (rule 3), and shorten the
      // ramp by however much of the distance we have already covered.
      const span = clamp01((this.ts - floor) / Math.max(1e-4, 1 - floor));
      this.floor = floor;
      this.fallFrom = this.ts;
      this.fallDur = Math.max(0.04, b.fall * span);
      this.fallT = 0;
      this.phase = "fall";
    }
  }

  /**
   * Advance by REAL seconds. Returns the (reused) frame.
   *
   * The caller multiplies its own world dt by `timeScale`; this method must
   * keep getting the unscaled dt or the beat would slow itself down and never
   * finish.
   */
  update(dt: number): SlowMoFrame {
    const d = dt > MAX_DT ? MAX_DT : dt > 0 ? dt : 0;

    switch (this.phase) {
      case "fall": {
        this.fallT += d;
        const u = this.fallDur > 0 ? clamp01(this.fallT / this.fallDur) : 1;
        this.ts = this.fallFrom + (this.floor - this.fallFrom) * easeDown(u);
        if (u >= 1) {
          this.ts = this.floor;
          this.phase = "hold";
        }
        break;
      }
      case "hold": {
        this.ts = this.floor;
        this.holdLeft -= d;
        if (this.holdLeft <= 0) {
          this.holdLeft = 0;
          this.riseFrom = this.ts;
          this.riseT = 0;
          this.phase = "rise";
        }
        break;
      }
      case "rise": {
        this.riseT += d;
        const u = this.riseDur > 0 ? clamp01(this.riseT / this.riseDur) : 1;
        this.ts = this.riseFrom + (1 - this.riseFrom) * easeUp(u);
        if (u >= 1) {
          // Exactly 1.0, exactly idle. See rule 2.
          this.ts = 1;
          this.floor = 1;
          this.phase = "idle";
        }
        break;
      }
      default:
        this.ts = 1;
        break;
    }

    // The light runs on its own envelope so it can lead the ramp in and
    // outlive it on the way out.
    const wantLight = this.phase === "fall" || this.phase === "hold";
    if (wantLight) {
      this.env = clamp01(this.env + d / this.attackDur);
    } else if (this.env > 0) {
      this.env = clamp01(this.env - d / this.decayDur);
    }
    // One guard, checked every frame, rather than a reset hung off a phase
    // transition the envelope is allowed to finish before or after.
    if (this.phase === "idle" && this.env === 0) {
      this.peak = 0;
      this.kindNow = null;
    }

    this.shimmerT += d;
    const shimmer = 1 + SHIMMER_DEPTH * Math.sin(this.shimmerT * Math.PI * 2 * SHIMMER_HZ);
    // smootherstep on a linear envelope buys a corner-free attack and decay
    // without tracking a single extra phase.
    const live = this.env > 0 ? clamp01(smootherstep(this.env) * this.peak * shimmer) : 0;
    // ONCE IT IS FADING, IT ONLY FADES. smootherstep's derivative is zero at
    // the top, so early in the tail the shimmer can outrun the envelope and
    // the glow climbs BACK UP — up to +1.9% of peak on checkmate, depending
    // where the shimmer's free-running clock happens to be. Small, but on a
    // bloom pass an unprompted brightening reads as a second, smaller event
    // landing, which is a lie about what just happened.
    // Ratcheting (rather than killing the shimmer outright) keeps the breath
    // through the hold, where it is doing real work, and cannot introduce a
    // step: it only ever holds the level until the true curve catches down.
    this.swellOut = wantLight ? live : Math.min(this.swellOut, live);

    this.frame.timeScale = this.ts;
    this.frame.swell = this.swellOut;
    return this.frame;
  }

  /** True while the beat is still doing anything visible — glow tail included. */
  get active(): boolean {
    return this.phase !== "idle" || this.env > 0;
  }

  /** True only while the world is actually running slow. */
  get slowing(): boolean {
    return this.ts < 1;
  }

  get timeScale(): number {
    return this.ts;
  }

  get swell(): number {
    return this.swellOut;
  }

  get kind(): SlowMoKind | null {
    return this.kindNow;
  }

  /** For tests and debug overlays. */
  get phaseName(): SlowMoPhase {
    return this.phase;
  }

  /**
   * A child who taps to move on gets to move on. Eases out from here rather
   * than cutting — kid-safe means no dead ends, not no manners.
   */
  skip(): void {
    if (this.phase === "idle" || this.phase === "rise") return;
    this.holdLeft = 0;
    this.riseFrom = this.ts;
    this.riseT = 0;
    this.riseDur = Math.max(0.18, this.riseDur * 0.5);
    this.decayDur = Math.max(0.05, this.riseDur * DECAY_OF_RISE);
    this.phase = "rise";
  }

  /** Hard stop, no easing. For scene changes, not for gameplay. */
  reset(): void {
    this.phase = "idle";
    this.ts = 1;
    this.floor = 1;
    this.holdLeft = 0;
    this.fallT = 0;
    this.riseT = 0;
    this.env = 0;
    this.peak = 0;
    // The shimmer's clock too, or a reset instance quietly disagrees with a
    // fresh one about the brightness of the very next beat.
    this.shimmerT = 0;
    this.swellOut = 0;
    this.kindNow = null;
    this.frame.timeScale = 1;
    this.frame.swell = 0;
  }
}
