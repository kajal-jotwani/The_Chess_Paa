/** Tiny promise-based tween helper — no dependency needed. */
export type Ease = (t: number) => number;
export const Easing = {
  linear: (t: number) => t,
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  in: (t: number) => t * t * t,
  outBack: (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2),
  outBounce: (t: number) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

interface Active { start: number; dur: number; ease: Ease; fn: (k: number) => void; done: () => void; cancelled: boolean; }
const active: Active[] = [];
let now = 0;

export function tweenUpdate(time: number) {
  now = time;
  for (let i = active.length - 1; i >= 0; i--) {
    const a = active[i];
    if (a.cancelled) { active.splice(i, 1); continue; }
    const k = Math.min(1, (time - a.start) / a.dur);
    a.fn(a.ease(k));
    if (k >= 1) { active.splice(i, 1); a.done(); }
  }
}

export interface TweenHandle { cancel(): void; promise: Promise<void>; }

export function tween(dur: number, fn: (k: number) => void, ease: Ease = Easing.inOut): TweenHandle {
  let entry!: Active;
  const promise = new Promise<void>((resolve) => {
    entry = { start: now, dur: Math.max(0.001, dur), ease, fn, done: resolve, cancelled: false };
    active.push(entry);
  });
  return { cancel: () => { entry.cancelled = true; }, promise };
}

export const wait = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt));
