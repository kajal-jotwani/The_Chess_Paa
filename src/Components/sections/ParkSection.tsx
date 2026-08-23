"use client";

import { useEffect, useState } from "react";
import ParkMap from "@/Components/park/ParkMap";
import ChessPaaBubble from "@/Components/chess/ChessPaaBubble";
import lessons from "@/lib/data/lessons.json";

const WELCOMES = [
  "Welcome to my Wonderland! Every ride teaches you real chess. Tap the castle to meet your team, or hop on any ride — the coaster is extra bouncy today!",
  "Hello hello! The Ferris wheel is spinning, the train is chugging, and the chessboard is set. Where shall we ride first?",
  "Ah, you're back! The ponies on the carousel were just asking about you. Pick a ride — I'll be coaching right beside you.",
];

export default function ParkSection() {
  const [line, setLine] = useState(WELCOMES[0]);

  useEffect(() => {
    // after the welcome, ChessPaa drops a lesson-of-the-day now and then
    const t = setTimeout(() => {
      const pool = (lessons as { text: string }[]).map((l) => `Grandpa wisdom: ${l.text}`);
      setLine(pool[Math.floor(Math.random() * pool.length)]);
    }, 16000);
    setLine(WELCOMES[Math.floor(Math.random() * WELCOMES.length)]);
    return () => clearTimeout(t);
  }, []);

  return (
    <section id="park" className="relative overflow-hidden pt-28 md:pt-36 pb-6 bg-gradient-to-b from-chess-sky/60 via-white to-white">
      <div className="mx-auto max-w-7xl px-3 md:px-6">
        <header className="mb-4 text-center">
          <h1 className="font-park text-3xl md:text-5xl font-extrabold tracking-tight text-chess-text">
            ChessPaa&apos;s <span className="text-chess-blue">Wonderland</span>
          </h1>
          <p className="mt-2 text-sm md:text-base text-slate-600">
            A whole theme park where every ride teaches you chess. Tap an attraction to hop on!
          </p>
        </header>

        <div className="rounded-[2rem] border-4 border-white bg-white/60 p-1.5 md:p-3 shadow-floating backdrop-blur-sm">
          <div className="overflow-hidden rounded-[1.6rem]">
            <ParkMap />
          </div>
        </div>

        <div className="mx-auto mt-5 max-w-3xl">
          <ChessPaaBubble text={line} autoSpeak={false} size="sm" />
        </div>
      </div>
    </section>
  );
}
