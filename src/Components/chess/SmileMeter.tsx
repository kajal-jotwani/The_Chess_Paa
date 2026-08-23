"use client";

/**
 * The "Who's smiling?" meter — a kid-friendly eval bar. No numbers, just
 * how happy each side's face is, powered by the engine's real score.
 */
export default function SmileMeter({ scorePawns }: { scorePawns: number }) {
  // map [-8, +8] pawns to [5%, 95%]
  const clamped = Math.max(-8, Math.min(8, scorePawns));
  const pct = 50 + (clamped / 8) * 45;
  const kidFace = clamped > 3 ? "😄" : clamped > 1 ? "🙂" : clamped > -1 ? "😐" : clamped > -3 ? "😟" : "😰";
  const oppFace = clamped < -3 ? "😄" : clamped < -1 ? "🙂" : clamped < 1 ? "😐" : clamped < 3 ? "😟" : "😰";

  return (
    <div className="flex items-center gap-2 w-full" title="Who's smiling? (how the game is going)">
      <span className="text-xl" aria-hidden>{kidFace}</span>
      <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-slate-300/70 ring-1 ring-black/5">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-chess-teal to-chess-yellow transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
        <div className="absolute inset-y-0 left-1/2 w-0.5 bg-white/80" />
      </div>
      <span className="text-xl" aria-hidden>{oppFace}</span>
    </div>
  );
}
