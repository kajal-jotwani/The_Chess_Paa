import type { Metadata } from "next";
import Navbar from "@/Components/Navbar";
import Footer from "@/Components/Footer";
import TacticsClient from "./TacticsClient";

export const metadata: Metadata = {
  title: "Tactics Rollercoaster — ChessPaa",
  description: "Forks, pins, skewers and checkmates — ride the tactics rollercoaster!",
};

export default function TacticsPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gradient-to-b from-chess-sky/50 via-white to-white pt-28 md:pt-32">
        <header className="mx-auto mb-6 max-w-6xl px-3 text-center md:px-6">
          <h1 className="font-park text-3xl font-extrabold text-chess-text md:text-4xl">
            🎢 Tactics <span className="text-chess-blue">Rollercoaster</span>
          </h1>
          <p className="mt-1 text-sm text-slate-600 md:text-base">
            Pick a track, buckle up, and solve your way up the hill — forks, pins, and sneaky checkmates!
          </p>
        </header>
        <TacticsClient />
      </main>
      <Footer />
    </>
  );
}
