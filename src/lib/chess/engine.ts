"use client";

/**
 * EngineClient — a tiny, queue-based UCI client for the Stockfish 18 WASM
 * worker that lives in /public/stockfish/. Single-threaded "lite" build, so
 * it works everywhere with no special cross-origin headers.
 *
 * Everything ChessPaa says about a move is grounded in what this engine
 * reports — ChessPaa never invents chess facts, he only adds the warmth.
 */

export type Score =
  | { type: "cp"; value: number }   // centipawns, from the side to move
  | { type: "mate"; value: number }; // moves to mate, from the side to move

export interface PvLine {
  multipv: number;
  depth: number;
  score: Score;
  moves: string[]; // UCI moves
}

export interface Analysis {
  bestMove: string;            // UCI
  lines: PvLine[];             // best line(s), lines[0] is the top line
  /** Score of the best line, normalized to WHITE's point of view. */
  scoreWhite: Score;
}

type Job = { run: () => void };

const MATE_CP = 100_000;

/** Convert a score to a single comparable centipawn-ish number (white POV given white-POV score). */
export function scoreToCp(s: Score): number {
  if (s.type === "cp") return s.value;
  // Closer mates are more extreme. mate 1 → ±(MATE_CP - 1)
  return s.value > 0 ? MATE_CP - s.value : -MATE_CP - s.value;
}

export function flipScore(s: Score): Score {
  return { type: s.type, value: -s.value } as Score;
}

export class EngineClient {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private queue: Job[] = [];
  private busy = false;
  private listeners: ((line: string) => void)[] = [];
  private disposed = false;

  /** Lazily boot the worker (browser only). */
  private ensureWorker(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      if (typeof window === "undefined") {
        reject(new Error("EngineClient is browser-only"));
        return;
      }
      try {
        const w = new Worker("/stockfish/stockfish-18-lite-single.js");
        this.worker = w;
        w.onmessage = (e: MessageEvent) => {
          const line = typeof e.data === "string" ? e.data : String(e.data);
          for (const l of [...this.listeners]) l(line);
        };
        w.onerror = (err) => {
          console.error("Stockfish worker error", err);
        };
        const onLine = (line: string) => {
          if (line === "uciok") {
            this.off(onLine);
            this.send("setoption name Threads value 1");
            this.send("setoption name Hash value 32");
            this.waitFor("readyok", () => this.send("isready")).then(() => resolve());
          }
        };
        this.on(onLine);
        this.send("uci");
      } catch (e) {
        reject(e);
      }
    });
    return this.ready;
  }

  private on(fn: (line: string) => void) { this.listeners.push(fn); }
  private off(fn: (line: string) => void) {
    this.listeners = this.listeners.filter((f) => f !== fn);
  }

  private send(cmd: string) {
    this.worker?.postMessage(cmd);
  }

  private waitFor(token: string, kickoff?: () => void): Promise<string> {
    return new Promise((resolve) => {
      const fn = (line: string) => {
        if (line.startsWith(token)) {
          this.off(fn);
          resolve(line);
        }
      };
      this.on(fn);
      kickoff?.();
    });
  }

  /** Serialize engine jobs so UCI streams never interleave. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        run: async () => {
          try {
            resolve(await task());
          } catch (e) {
            reject(e);
          } finally {
            this.busy = false;
            this.pump();
          }
        },
      };
      this.queue.push(job);
      this.pump();
    });
  }

  private pump() {
    if (this.busy || this.disposed) return;
    const next = this.queue.shift();
    if (!next) return;
    this.busy = true;
    next.run();
  }

  /**
   * Analyze a position. Returns best move + top lines with scores
   * normalized to White's perspective (so callers never guess).
   */
  analyze(fen: string, opts?: { movetimeMs?: number; multipv?: number; depth?: number }): Promise<Analysis> {
    const movetime = opts?.movetimeMs ?? 750;
    const multipv = opts?.multipv ?? 2;
    const whiteToMove = fen.split(" ")[1] !== "b";
    return this.enqueue(async () => {
      await this.ensureWorker();
      const lines = new Map<number, PvLine>();
      let bestMove = "";
      await new Promise<void>((resolve) => {
        const fn = (line: string) => {
          if (line.startsWith("info ") && line.includes(" pv ")) {
            const mpv = /multipv (\d+)/.exec(line);
            const depth = /depth (\d+)/.exec(line);
            const cp = / score cp (-?\d+)/.exec(line);
            const mate = / score mate (-?\d+)/.exec(line);
            const pv = / pv (.+)$/.exec(line);
            if (pv && depth) {
              const idx = mpv ? parseInt(mpv[1], 10) : 1;
              const score: Score = mate
                ? { type: "mate", value: parseInt(mate[1], 10) }
                : { type: "cp", value: cp ? parseInt(cp[1], 10) : 0 };
              lines.set(idx, {
                multipv: idx,
                depth: parseInt(depth[1], 10),
                score,
                moves: pv[1].trim().split(/\s+/),
              });
            }
          } else if (line.startsWith("bestmove")) {
            bestMove = line.split(/\s+/)[1] ?? "";
            this.off(fn);
            resolve();
          }
        };
        this.on(fn);
        this.send("setoption name MultiPV value " + multipv);
        this.send("setoption name Skill Level value 20");
        this.send("setoption name UCI_LimitStrength value false");
        this.send("position fen " + fen);
        this.send(opts?.depth ? `go depth ${opts.depth}` : `go movetime ${movetime}`);
      });
      const sorted = [...lines.values()].sort((a, b) => a.multipv - b.multipv);
      const top = sorted[0];
      const rawScore: Score = top ? top.score : { type: "cp", value: 0 };
      const scoreWhite = whiteToMove ? rawScore : flipScore(rawScore);
      return { bestMove, lines: sorted, scoreWhite };
    });
  }

  /**
   * Ask for a deliberately gentle move — this is "ChessPaa going easy".
   * level 0..4 maps to grandpa moods from "Teddy" to "Champ".
   */
  playForKid(fen: string, level: number): Promise<string> {
    const cfg = [
      { skill: 0, movetime: 60, wobble: 4 },   // Teddy — very silly
      { skill: 1, movetime: 120, wobble: 3 },  // Sprout
      { skill: 4, movetime: 220, wobble: 2 },  // Explorer
      { skill: 8, movetime: 350, wobble: 0 },  // Knight
      { skill: 13, movetime: 600, wobble: 0 }, // Champ
    ][Math.max(0, Math.min(4, level))];

    return this.enqueue(async () => {
      await this.ensureWorker();
      const lines = new Map<number, PvLine>();
      let bestMove = "";
      const multipv = cfg.wobble > 0 ? cfg.wobble + 1 : 1;
      await new Promise<void>((resolve) => {
        const fn = (line: string) => {
          if (line.startsWith("info ") && line.includes(" pv ")) {
            const mpv = /multipv (\d+)/.exec(line);
            const pv = / pv (.+)$/.exec(line);
            const depth = /depth (\d+)/.exec(line);
            const cp = / score cp (-?\d+)/.exec(line);
            const mate = / score mate (-?\d+)/.exec(line);
            if (pv && depth) {
              const idx = mpv ? parseInt(mpv[1], 10) : 1;
              lines.set(idx, {
                multipv: idx,
                depth: parseInt(depth[1], 10),
                score: mate
                  ? { type: "mate", value: parseInt(mate[1], 10) }
                  : { type: "cp", value: cp ? parseInt(cp[1], 10) : 0 },
                moves: pv[1].trim().split(/\s+/),
              });
            }
          } else if (line.startsWith("bestmove")) {
            bestMove = line.split(/\s+/)[1] ?? "";
            this.off(fn);
            resolve();
          }
        };
        this.on(fn);
        this.send("setoption name MultiPV value " + multipv);
        this.send("setoption name UCI_LimitStrength value false");
        this.send("setoption name Skill Level value " + cfg.skill);
        this.send("position fen " + fen);
        this.send("go movetime " + cfg.movetime);
      });
      // Wobble: sometimes pick a slightly worse line so little kids can shine.
      if (cfg.wobble > 0 && lines.size > 1) {
        const sorted = [...lines.values()].sort((a, b) => a.multipv - b.multipv);
        // Weight toward the better lines but allow silliness; never pick a line
        // that walks into mate when a safe line exists.
        const safe = sorted.filter(
          (l) => !(l.score.type === "mate" && l.score.value < 0)
        );
        const pool = (safe.length ? safe : sorted).slice(0, cfg.wobble + 1);
        const weights = pool.map((_, i) => Math.pow(0.55, i));
        const total = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        for (let i = 0; i < pool.length; i++) {
          r -= weights[i];
          if (r <= 0) return pool[i].moves[0] ?? bestMove;
        }
      }
      return bestMove;
    });
  }

  dispose() {
    this.disposed = true;
    this.queue = [];
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}

let shared: EngineClient | null = null;
/** One engine for the whole app — boot it once, reuse it on every ride. */
export function getEngine(): EngineClient {
  if (!shared) shared = new EngineClient();
  return shared;
}
