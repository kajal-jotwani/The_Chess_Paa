"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";

import tacticsPacks from "@/lib/data/puzzles/tactics.json";
import PuzzleRunner, { type PuzzleData, type PuzzleResult } from "@/Components/chess/PuzzleRunner";
import ChessPaaBubble from "@/Components/chess/ChessPaaBubble";
import Confetti, { fireConfetti } from "@/Components/chess/Confetti";
import { cheer, RIDE_WELCOME } from "@/lib/chess/phrases";
import { addTickets, addStars, setBest } from "@/lib/progress";
import { sfx, speak } from "@/lib/sound";

const TRACKS: { key: keyof typeof tacticsPacks; name: string; emoji: string; blurb: string; color: string }[] = [
  { key: "mateIn1", name: "The First Drop", emoji: "🎯", blurb: "Checkmate in ONE move. See it, play it, BOOM!", color: "#ef4444" },
  { key: "hanging", name: "Grab-It Grotto", emoji: "🍿", blurb: "Someone left a piece unguarded. Snack time!", color: "#f59e0b" },
  { key: "fork", name: "The Fork Flip", emoji: "🍴", blurb: "One move, TWO targets. The classic double-attack!", color: "#25A9B4" },
  { key: "pin", name: "The Pin Spin", emoji: "📌", blurb: "Stick a piece to its king so it can't move!", color: "#8b5cf6" },
  { key: "skewer", name: "Skewer Screamer", emoji: "🍡", blurb: "Poke the big piece, win the one hiding behind!", color: "#ec4899" },
  { key: "discovered", name: "Surprise Tunnel", emoji: "🎁", blurb: "Move one piece, ANOTHER one attacks. Sneaky!", color: "#22c55e" },
  { key: "mateIn2", name: "The Double Loop", emoji: "🌀", blurb: "Checkmate in two — plan the whole combo!", color: "#0ea5e9" },
];

const CAR_SEATS = 10; // puzzles per ride session

export default function TacticsClient() {
  const [trackKey, setTrackKey] = useState<keyof typeof tacticsPacks | null>(null);
  const [idx, setIdx] = useState(0);
  const [solvedCount, setSolvedCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bubble, setBubble] = useState(RIDE_WELCOME.tactics);
  const [rideDone, setRideDone] = useState(false);

  const puzzles = useMemo<PuzzleData[]>(() => {
    if (!trackKey) return [];
    const all = (tacticsPacks[trackKey] as PuzzleData[]) ?? [];
    // easiest first, one carful at a time, rotating start so replays differ
    const offset = Math.floor(Math.random() * Math.max(1, all.length - CAR_SEATS));
    return all.slice(offset, offset + CAR_SEATS);
  }, [trackKey]);

  const track = TRACKS.find((t) => t.key === trackKey);

  const startTrack = (key: keyof typeof tacticsPacks) => {
    setTrackKey(key);
    setIdx(0);
    setSolvedCount(0);
    setStreak(0);
    setRideDone(false);
    const t = TRACKS.find((x) => x.key === key)!;
    const line = `${t.name}! ${t.blurb} Buckle up — ${CAR_SEATS} puzzles ahead!`;
    setBubble(line);
    speak(line);
    sfx.whoosh();
  };

  const onSolved = useCallback((r: PuzzleResult) => {
    const gained = r.usedHint || r.wrongTries > 0 ? 1 : 3;
    addStars("tactics", gained);
    addTickets(1);
    setSolvedCount((s) => s + 1);
    setStreak((s) => s + 1);
    const line = cheer("right") + (gained === 3 ? " Three stars — first try, no hints!" : " Ticket earned!");
    setBubble(line);
    speak(line);
    setTimeout(() => {
      setIdx((i) => {
        if (i + 1 >= puzzles.length) {
          setRideDone(true);
          fireConfetti("big");
          sfx.win();
          setBest("tactics", solvedCount + 1);
          const done = "WOOHOO! The car rolled all the way home — you finished the whole ride!";
          setBubble(done);
          speak(done);
          return i;
        }
        return i + 1;
      });
    }, 900);
  }, [puzzles.length, solvedCount]);

  const onWrong = useCallback(() => {
    setStreak(0);
    setBubble(cheer("wrong"));
  }, []);

  /* ---------------- track picker ---------------- */
  if (!trackKey || !track) {
    return (
      <div className="mx-auto max-w-6xl px-3 md:px-6 pb-16">
        <Confetti />
        <div className="mx-auto mb-6 max-w-3xl"><ChessPaaBubble text={bubble} autoSpeak={false} /></div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TRACKS.map((t) => (
            <button
              key={t.key}
              onClick={() => startTrack(t.key)}
              className="group rounded-3xl bg-white/95 p-5 text-left shadow-card ring-1 ring-chess-sand/60 transition hover:-translate-y-1.5 hover:shadow-floating"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl text-2xl shadow-card" style={{ backgroundColor: `${t.color}22` }}>
                  {t.emoji}
                </span>
                <span className="rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-white" style={{ backgroundColor: t.color }}>
                  {(tacticsPacks[t.key] as PuzzleData[]).length} puzzles
                </span>
              </div>
              <h3 className="text-lg font-extrabold text-chess-text">{t.name}</h3>
              <p className="mt-1 text-sm text-slate-600">{t.blurb}</p>
              <span className="mt-3 inline-block rounded-full bg-chess-teal px-4 py-1.5 text-xs font-bold text-white shadow-sm transition group-hover:brightness-110">
                Ride it →
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  /* ---------------- riding a track ---------------- */
  const progress = rideDone ? puzzles.length : idx;

  return (
    <div className="mx-auto max-w-6xl px-3 md:px-6 pb-16">
      <Confetti />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => setTrackKey(null)} className="rounded-full bg-white px-4 py-2 text-sm font-bold text-chess-text shadow-card ring-1 ring-chess-sand hover:brightness-105">
          ← All tracks
        </button>
        <div className="flex items-center gap-2 text-sm font-bold text-chess-text">
          <span className="rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-chess-sand/60">{track.emoji} {track.name}</span>
          <span className="rounded-full bg-chess-yellow px-3 py-1 shadow-sm">🔥 streak {streak}</span>
        </div>
      </div>

      {/* coaster hill progress */}
      <div className="mb-4 rounded-2xl bg-white/90 p-3 shadow-card ring-1 ring-chess-sand/60">
        <svg viewBox="0 0 560 84" className="w-full" aria-label={`Progress: ${progress} of ${puzzles.length} puzzles`}>
          <path d="M 10 70 Q 90 68 150 52 T 290 34 T 430 22 T 550 12" fill="none" stroke="#e8cf9d" strokeWidth="7" strokeLinecap="round" />
          <path d="M 10 70 Q 90 68 150 52 T 290 34 T 430 22 T 550 12" fill="none" stroke="#f4a83a" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="2 9" />
          {puzzles.map((_, i) => {
            const t = i / Math.max(1, puzzles.length - 1);
            const x = 10 + t * 540;
            const y = 70 - t * 58 + Math.sin(t * Math.PI * 2) * 4;
            return <circle key={i} cx={x} cy={y} r={i < progress ? 7 : 5} fill={i < progress ? "#facc15" : "#e2e8f0"} stroke={i < progress ? "#d9a406" : "#cbd5e1"} strokeWidth="2" />;
          })}
          {(() => {
            const t = Math.min(1, progress / Math.max(1, puzzles.length - 1));
            const x = 10 + t * 540;
            const y = 70 - t * 58 + Math.sin(t * Math.PI * 2) * 4;
            return (
              <g transform={`translate(${x - 14} ${y - 22})`}>
                <rect width="28" height="14" rx="5" fill="#ef4444" stroke="#b91c1c" strokeWidth="2" />
                <circle cx="7" cy="16" r="4" fill="#334155" />
                <circle cx="21" cy="16" r="4" fill="#334155" />
                <circle cx="9" cy="-1" r="5" fill="#fcd9b8" />
                <circle cx="19" cy="-1" r="5" fill="#f8c890" />
              </g>
            );
          })()}
        </svg>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] items-start">
        <div>
          {!rideDone && puzzles[idx] && (
            <PuzzleRunner
              key={puzzles[idx].id}
              puzzle={puzzles[idx]}
              onSolved={onSolved}
              onWrong={onWrong}
            />
          )}
          {rideDone && (
            <div className="chesspaa-pop rounded-3xl bg-white p-8 text-center shadow-floating ring-2 ring-chess-yellow">
              <p className="text-5xl">🎢🏁</p>
              <h3 className="mt-2 text-2xl font-extrabold text-chess-text">Ride complete!</h3>
              <p className="mt-1 text-chess-text/70">You solved {solvedCount} of {puzzles.length} on {track.name}.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button onClick={() => startTrack(track.key)} className="rounded-full bg-chess-red px-5 py-2 font-bold text-white shadow-card hover:brightness-110">
                  🔄 Ride again (new puzzles)
                </button>
                <button onClick={() => setTrackKey(null)} className="rounded-full bg-chess-teal px-5 py-2 font-bold text-white shadow-card hover:brightness-110">
                  🎢 Pick another track
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="lg:sticky lg:top-28">
          <ChessPaaBubble text={bubble} autoSpeak={false} />
          <p className="mt-3 rounded-2xl bg-white/70 p-3 text-xs text-chess-text/60 ring-1 ring-chess-sand/50">
            Puzzle {Math.min(idx + 1, puzzles.length)} of {puzzles.length} · every puzzle is a real position from a real game
            (thank you, Lichess open database! 💛)
          </p>
        </div>
      </div>
    </div>
  );
}
