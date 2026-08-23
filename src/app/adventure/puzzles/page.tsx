import type { Metadata } from "next";
import Navbar from "@/Components/Navbar";
import Footer from "@/Components/Footer";
import TrainClient from "./TrainClient";

export const metadata: Metadata = {
  title: "Puzzle Train — ChessPaa",
  description: "All aboard! Solve as many puzzles as you can before the steam runs out.",
};

export default function TrainPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gradient-to-b from-chess-sky/50 via-white to-white pt-28 md:pt-32">
        <header className="mx-auto mb-6 max-w-6xl px-3 text-center md:px-6">
          <h1 className="font-park text-3xl font-extrabold text-chess-text md:text-4xl">
            🚂 The Puzzle <span className="text-chess-blue">Train</span>
          </h1>
          <p className="mt-1 text-sm text-slate-600 md:text-base">
            Puzzle rush, wonderland style — every solve adds a carriage, every miss costs steam!
          </p>
        </header>
        <TrainClient />
      </main>
      <Footer />
    </>
  );
}
