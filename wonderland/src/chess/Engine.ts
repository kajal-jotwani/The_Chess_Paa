/**
 * Stockfish 18 (WASM, single-threaded) in a Web Worker, driven over UCI.
 * One request at a time; every call is a promise.  ChessPaa never guesses —
 * every evaluation and every reply move comes from here.
 */
export interface EngineLine { multipv: number; move: string; pv: string[]; cp: number | null; mate: number | null; depth: number; }
export interface EvalResult { lines: EngineLine[]; bestMove: string | null; depth: number; }

type Pending = { onLine: (l: string) => void; resolve: (v: any) => void; reject: (e: any) => void };

export class Engine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private queue: (() => Promise<void>)[] = [];
  private busy = false;
  private pending: Pending | null = null;
  private lines: string[] = [];

  constructor() {}

  /** Start the worker (idempotent). */
  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      try {
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        this.worker = new Worker(`${base}/stockfish/stockfish-18-lite-single.js`);
      } catch (e) { reject(e); return; }
      const w = this.worker;
      w.onmessage = (e: MessageEvent) => {
        const line: string = typeof e.data === "string" ? e.data : String(e.data);
        if (line === "uciok") resolve();
        this.pending?.onLine(line);
      };
      w.onerror = (e) => { console.error("engine error", e); reject(e); };
      w.postMessage("uci");
    }).then(async () => {
      this.send("setoption name Hash value 16");
      this.send("setoption name UCI_ShowWDL value false");
      await this.command("isready", (l) => l === "readyok");
    });
    return this.ready;
  }

  private send(cmd: string) { this.worker?.postMessage(cmd); }

  /** Send a command and wait until `done(line)` matches; collects all output lines. */
  private command(cmd: string, done: (line: string) => boolean): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const run = () => new Promise<void>((next) => {
        this.lines = [];
        this.pending = {
          onLine: (l) => { this.lines.push(l); if (done(l)) { this.pending = null; resolve(this.lines); next(); } },
          resolve, reject,
        };
        this.send(cmd);
      });
      this.queue.push(run);
      this.drain();
    });
  }

  private async drain() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) { const job = this.queue.shift()!; await job(); }
    this.busy = false;
  }

  async waitReady() { await this.start(); }

  async setSkill(skill: number) {
    await this.start();
    this.send(`setoption name Skill Level value ${Math.max(0, Math.min(20, Math.round(skill)))}`);
  }

  /** Evaluate a position; scores are from the side-to-move's point of view. */
  async evaluate(fen: string, opts: { depth?: number; multipv?: number; movetime?: number } = {}): Promise<EvalResult> {
    await this.start();
    const depth = opts.depth ?? 12, multipv = opts.multipv ?? 1;
    this.send(`setoption name MultiPV value ${multipv}`);
    this.send(`position fen ${fen}`);
    const go = opts.movetime ? `go movetime ${opts.movetime}` : `go depth ${depth}`;
    const out = await this.command(go, (l) => l.startsWith("bestmove"));
    const best = out.find((l) => l.startsWith("bestmove"))?.split(" ")[1] ?? null;
    const byPv = new Map<number, EngineLine>();
    let maxDepth = 0;
    for (const l of out) {
      if (!l.startsWith("info") || !l.includes(" pv ") || l.includes("lowerbound") || l.includes("upperbound")) continue;
      const m = l.match(/depth (\d+).*?multipv (\d+).*?score (cp|mate) (-?\d+).*? pv (.+)$/);
      if (!m) continue;
      const d = +m[1], pvN = +m[2];
      const prev = byPv.get(pvN);
      if (prev && prev.depth > d) continue;
      const pv = m[5].trim().split(/\s+/);
      byPv.set(pvN, { multipv: pvN, move: pv[0], pv, cp: m[3] === "cp" ? +m[4] : null, mate: m[3] === "mate" ? +m[4] : null, depth: d });
      maxDepth = Math.max(maxDepth, d);
    }
    const lines = [...byPv.values()].sort((a, b) => a.multipv - b.multipv);
    return { lines, bestMove: best && best !== "(none)" ? best : null, depth: maxDepth };
  }

  /** Pick a move for ChessPaa at a given skill; movetime keeps replies snappy. */
  async bestMove(fen: string, skill: number, movetime = 400): Promise<string | null> {
    await this.setSkill(skill);
    const r = await this.evaluate(fen, { movetime, multipv: 1 });
    return r.bestMove;
  }

  stop() { this.send("stop"); }
  dispose() { this.worker?.terminate(); this.worker = null; }
}

/** Convert an engine score to a single number from White's view (pawns), mates saturate. */
export function scoreToPawns(cp: number | null, mate: number | null, sideToMoveIsWhite: boolean): number {
  let v: number;
  if (mate !== null) v = mate > 0 ? 50 - Math.min(40, mate) : -50 + Math.min(40, -mate);
  else v = (cp ?? 0) / 100;
  return sideToMoveIsWhite ? v : -v;
}
