"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/Components/ui/card";
import lessons from "@/lib/data/lessons.json";

type Lesson = {
  id: number;
  text: string;
  author?: string;
};

const ZONES = [
  {
    id: "openings",
    label: "Start Here",
    title: "Opening Carousel",
    emoji: "♟️",
    description:
      "Learn fun, kid-friendly opening ideas and how to bring your team into the game quickly.",
    cta: "Spin the Openings",
    href: "/adventure/openings",
    accent: "bg-chess-yellow"
  },
  {
    id: "tactics",
    label: "Brain Gym",
    title: "Tactics Rollercoaster",
    emoji: "⚡",
    description:
      "Solve bite-sized puzzles with pins, forks, and sneaky checks. Every move is a surprise!",
    cta: "Ride the Rollercoaster",
    href: "/adventure/tactics",
    accent: "bg-chess-red"
  },
  {
    id: "endgames",
    label: "Finish Strong",
    title: "Endgame Ferris Wheel",
    emoji: "🎯",
    description:
      "Turn tricky endgames into easy wins. Learn how a tiny pawn can become a mighty queen.",
    cta: "Go to the Top",
    href: "/adventure/endgames",
    accent: "bg-chess-teal"
  },
  {
    id: "puzzles",
    label: "Mini Missions",
    title: "Puzzle Train",
    emoji: "🧩",
    description:
      "Hop on board for daily mini-missions that test everything you’ve learned so far.",
    cta: "Hop Aboard",
    href: "/adventure/puzzles",
    accent: "bg-chess-blue"
  }
];

export default function AdventureZones() {
  const [currentLessonIndex, setCurrentLessonIndex] = useState(0);

  const typedLessons = lessons as Lesson[];

  // pick a random lesson once on mount (so each refresh is different)
  useEffect(() => {
    if (!typedLessons.length) return;
    const randomIndex = Math.floor(Math.random() * typedLessons.length);
    setCurrentLessonIndex(randomIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNextLesson = () => {
    if (typedLessons.length <= 1) return;

    setCurrentLessonIndex((prev) => {
      let next = Math.floor(Math.random() * typedLessons.length);
      // avoid showing the same lesson twice in a row
      if (next === prev) {
        next = (next + 1) % typedLessons.length;
      }
      return next;
    });
  };

  const currentLesson = typedLessons[currentLessonIndex];

  return (
    <section
      id="adventure-zones"
      className="relative w-full bg-chess-sand/70 py-16 md:py-24"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 md:px-6">
        {/* Heading */}
        <header className="text-center">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-chess-teal shadow-card">
            <span className="text-base">🚂</span>
            Adventure Zones
          </p>
          <h2 className="mt-6 text-3xl font-extrabold tracking-tight text-chess-text md:text-4xl">
            Every chess skill has its own ride.
          </h2>
          <p className="mt-3 max-w-2xl mx-auto text-sm md:text-base text-slate-600">
            Pick a zone, hop in, and level up one tiny move at a time.
          </p>
        </header>

        {/* Zone cards */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {ZONES.map((zone) => (
            <Card key={zone.id} className="group relative">
              {/* Accent bar */}
              <div
                className={`absolute inset-x-4 -top-3 h-2 rounded-full ${zone.accent} blur-[1px]`}
              />

              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-chess-sky text-2xl shadow-card">
                  <span aria-hidden="true">{zone.emoji}</span>
                </div>
                <span className="inline-flex items-center rounded-full bg-chess-sand px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-chess-text">
                  {zone.label}
                </span>
              </div>

              <h3 className="text-lg font-bold text-chess-text">{zone.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                {zone.description}
              </p>

              <Link
                href={zone.href}
                className="mt-6 inline-flex items-center justify-center rounded-full bg-chess-teal px-4 py-2 text-xs font-semibold text-white shadow-floating transition duration-200 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chess-teal/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                {zone.cta}
                <span className="ml-1 text-sm transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
            </Card>
          ))}
        </div>

        {/* Lesson of the Day card */}
        {currentLesson && (
          <Card className="mt-4 border border-dashed border-chess-sand bg-white/90 md:flex md:items-center md:gap-6">
            <div className="mb-4 flex items-center gap-3 md:mb-0">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-chess-teal text-2xl shadow-floating">
                📜
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-chess-teal">
                  ChessPaa&apos;s Lesson of the Day
                </p>
                <p className="mt-1 text-sm font-semibold text-chess-text">
                  “{currentLesson.text}”
                </p>
                {currentLesson.author && (
                  <p className="mt-1 text-xs text-slate-500">
                    — {currentLesson.author}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleNextLesson}
              className="inline-flex rounded-full bg-chess-sky px-4 py-2 text-xs font-semibold text-chess-text shadow-card hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chess-blue/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              Get another lesson
            </button>
          </Card>
        )}
      </div>
    </section>
  );
}
