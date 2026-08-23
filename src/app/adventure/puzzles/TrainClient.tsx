"use client";

import { useCallback, useMemo, useState } from "react";

import trainPacks from "@/lib/data/puzzles/train.json";
import PuzzleRunner, { type PuzzleData, type PuzzleResult } from "@/Components/chess/PuzzleRunner";
import ChessPaaBubble from "@/Components/chess/ChessPaaBubble";
import Confetti, { fireConfetti } from "@/Components/chess/Confetti";
import { cheer, RIDE_WELCOME } from "@/lib/chess/phrases";
import { addTickets, best, setBest } from "@/lib/progress";
import { sfx, speak } from "@/lib/sound";

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Build one journey: puzzles get harder as the train picks up speed. */
function buildJourney(): PuzzleData[] {
  const packs = trainPacks as Record<string, PuzzleData[]>;
  return [
    ...shuffled(packs.band1).slice(0, 8),
    ...shuffled(packs.band2).slice(0, 8),
    ...shuffled(packs.band3).slice(0, 8),
    ...shuffled(packs.band4).slice(0, 8),
    ...shuffled(packs.band5).slice(0, 8),
  ];
}

const MAX_LIVES = 3;

export default function TrainClient() {
  const [journey, setJourney] = useState<PuzzleData[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [lives, setLives] = useState(MAX_LIVES);
  const [score, setScore] = useState(0);
  const [bubble, setBubble] = useState(RIDE_WELCOME.train);
  const [over, setOver] = useState(false);
  const [newRecord, setNewRecord] = useState(false);
  const bestScore = useMemo(() => best("train"), []);

  const start = () => {
    setJourney(buildJourney());
    setIdx(0);
    setLives(MAX_LIVES);
    setScore(0);
    setOver(false);
    setNewRecord(false);
    const line = "ALL ABOARD! The Puzzle Train leaves the station — solve to keep us chugging. Three wrong answers and we roll home!";
    setBubble(line);
    speak(line);
    sfx.whoosh();
  };

  const advance = useCallback((nextScore: number, nextLives: number) => {
    setTimeout(() => {
      setIdx((i) => {
        if (!journey) return i;
        if (nextLives <= 0 || i + 1 >= journey.length) {
          setOver(true);
          const rec = setBest("train", nextScore);
          setNewRecord(rec);
          if (rec) fireConfetti("big"); else fireConfetti("small");
          sfx.win();
          const line = rec
            ? `NEW RECORD! ${nextScore} puzzles in one journey! We're framing your picture at the station!`
            : `The train pulls in — ${nextScore} puzzles solved! Hop back on to beat your record of ${Math.max(bestScore, nextScore)}.`;
          setBubble(line);
          speak(line);
          return i;
        }
        return i + 1;
      });
    }, 800);
  }, [journey, bestScore]);

  const onSolved = useCallback((_r: PuzzleResult) => {
    const s = score + 1;
    setScore(s);
    addTickets(1);
    setBubble(cheer("right"));
    advance(s, lives);
  }, [score, lives, advance]);

  const onWrong = useCallback((tries: number) => {
    if (tries === 1) {
      // first wrong try on this puzzle costs a life and skips the puzzle
      const l = lives - 1;
      setLives(l);
      sfx.wrong();
      const line = l > 0
        ? `Bumpy rails! ${l === 2 ? "Two carriages" : "One carriage"} of steam left — next puzzle!`
        : "Out of steam! Let's see how far we travelled…";
      setBubble(line);
      speak(line);
      advance(score, l);
    }
  }, [lives, score, advance]);

  if (!journey) {
    return (
      <div className="mx-auto max-w-4xl px-3 md:px-6 pb-16 text-center">
        <Confetti />
        <div className="mx-auto mb-6 max-w-3xl text-left"><ChessPaaBubble text={bubble} autoSpeak={false} /></div>
        <div className="rounded-3xl bg-white/95 p-8 shadow-card ring-1 ring-chess-sand/60">
          <p className="text-6xl">🚂🧩</p>
          <h3 className="mt-3 text-2xl font-extrabold text-chess-text">Ready for the Puzzle Train?</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
            Puzzles start easy and get harder as the train speeds up. Solve as many as you can —
            a wrong answer costs one of your {MAX_LIVES} steam clouds!
          </p>
          {bestScore > 0 && (
            <p className="mt-2 text-sm font-bold text-chess-teal">Your best journey so far: {bestScore} puzzles</p>
          )}
          <button onClick={start} className="mt-5 rounded-full bg-chess-red px-8 py-3 text-lg font-extrabold text-white shadow-floating hover:brightness-110">
            🚂 All aboard!
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-3 md:px-6 pb-16">
      <Confetti />
      {/* dashboard */}
      <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
        <span className="rounded-full bg-white px-4 py-1.5 text-sm font-extrabold text-chess-text shadow-sm ring-1 ring-chess-sand/60">
          🧩 solved: {score}
        </span>
        <span className="rounded-full bg-white px-4 py-1.5 text-sm font-extrabold text-chess-text shadow-sm ring-1 ring-chess-sand/60">
          {Array.from({ length: MAX_LIVES }).map((_, i) => (
            <span key={i} className={i < lives ? "" : "opacity-25 grayscale"}>💨</span>
          ))}{" "}
          steam
        </span>
        <span className="rounded-full bg-chess-yellow px-4 py-1.5 text-sm font-extrabold text-chess-text shadow-sm">
          🚉 stop {Math.min(idx + 1, journey.length)} / {journey.length}
        </span>
      </div>

      {/* train grows a carriage per solve */}
      <div className="mb-4 overflow-hidden rounded-2xl bg-white/90 p-3 shadow-card ring-1 ring-chess-sand/60">
        <div className="flex items-end gap-1 overflow-x-auto pb-1" aria-label={`Train with ${score} carriages`}>
          <span className="text-4xl">🚂</span>
          {Array.from({ length: score }).map((_, i) => (
            <span key={i} className="chesspaa-pop text-3xl">🚃</span>
          ))}
          {score === 0 && <span className="ml-2 pb-2 text-xs text-chess-text/50">solve puzzles to add carriages!</span>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] items-start">
        <div>
          {!over && journey[idx] && (
            <PuzzleRunner
              key={journey[idx].id}
              puzzle={journey[idx]}
              onSolved={onSolved}
              onWrong={onWrong}
              celebration={false}
            />
          )}
          {over && (
            <div className="chesspaa-pop rounded-3xl bg-white p-8 text-center shadow-floating ring-2 ring-chess-yellow">
              <p className="text-5xl">🚉{newRecord ? "🏆" : "🎫"}</p>
              <h3 className="mt-2 text-2xl font-extrabold text-chess-text">
                {newRecord ? "NEW RECORD!" : "Journey complete!"}
              </h3>
              <p className="mt-1 text-chess-text/70">
                {score} puzzles solved · best ever: {Math.max(bestScore, score)}
              </p>
              <button onClick={start} className="mt-4 rounded-full bg-chess-red px-6 py-2.5 font-bold text-white shadow-card hover:brightness-110">
                🚂 Ride again
              </button>
            </div>
          )}
        </div>
        <div className="lg:sticky lg:top-28">
          <ChessPaaBubble text={bubble} autoSpeak={false} />
          <p className="mt-3 rounded-2xl bg-white/70 p-3 text-xs text-chess-text/60 ring-1 ring-chess-sand/50">
            ⚠️ Train rules: one wrong answer skips the puzzle and costs a steam cloud. Hints are allowed — grandpas
            encourage asking for help!
          </p>
        </div>
      </div>
    </div>
  );
}
