/** Tiny WebAudio synth: no sample files, just oscillators and envelopes. */
export class Sound {
  private ctx: AudioContext | null = null;
  muted = localStorage.getItem("cw.muted") === "1";
  private master: GainNode | null = null;
  private ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.35; this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }
  toggle() { this.muted = !this.muted; localStorage.setItem("cw.muted", this.muted ? "1" : "0"); return this.muted; }
  private tone(freq: number, dur: number, type: OscillatorType = "sine", vol = 0.5, slide = 0) {
    if (this.muted) return;
    const ctx = this.ensure();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), ctx.currentTime + dur);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(this.master!);
    o.start(); o.stop(ctx.currentTime + dur + 0.02);
  }
  click() { this.tone(660, 0.06, "square", 0.15); }
  pick() { this.tone(520, 0.08, "triangle", 0.3, 200); }
  move() { this.tone(300, 0.12, "triangle", 0.35, -120); }
  capture() { this.tone(220, 0.18, "sawtooth", 0.3, -100); setTimeout(() => this.tone(180, 0.15, "square", 0.2), 60); }
  good() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, "sine", 0.35), i * 90)); }
  great() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, "sine", 0.4), i * 80)); }
  oops() { this.tone(300, 0.25, "sine", 0.3, -150); }
  whoosh() { this.tone(180, 0.5, "sawtooth", 0.08, 600); }
  ding() { this.tone(1320, 0.3, "sine", 0.3); }
  fanfare() { [392, 523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, "triangle", 0.35), i * 110)); }
  /** A ticket / star landing in the pill. */
  coin() { this.tone(1046, 0.08, "square", 0.18); setTimeout(() => this.tone(1568, 0.1, "square", 0.18), 80); }
  /** Chain-lift clank: a low thud plus a bright tick (90 Hz alone is inaudible on laptop speakers). */
  clank() { this.tone(140, 0.05, "square", 0.14); this.tone(1900, 0.02, "sine", 0.06); }
  /** The big drop. */
  drop() { this.tone(520, 0.9, "sawtooth", 0.10, -420); }
  /** Steam engine chug. */
  chug() { this.tone(70, 0.07, "square", 0.16); }
  /** One note of the carousel organ. */
  carouselNote(f: number) { this.tone(f, 0.22, "triangle", 0.12); }
  /** Kart bump — throttled by the caller (a pin strike wakes several bodies at once). */
  bump() { this.tone(140, 0.1, "square", 0.25); }
}
