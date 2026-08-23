import type { Metadata } from "next";
import Navbar from "@/Components/Navbar";
import Footer from "@/Components/Footer";
import FerrisClient from "./FerrisClient";

export const metadata: Metadata = {
  title: "Endgame Ferris Wheel — ChessPaa",
  description: "Tricky endgames, easy wins — finish winning positions like a champion.",
};

export default function FerrisPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gradient-to-b from-chess-sky/50 via-white to-white pt-28 md:pt-32">
        <header className="mx-auto mb-6 max-w-6xl px-3 text-center md:px-6">
          <h1 className="font-park text-3xl font-extrabold text-chess-text md:text-4xl">
            🎡 Endgame <span className="text-chess-blue">Ferris Wheel</span>
          </h1>
          <p className="mt-1 text-sm text-slate-600 md:text-base">
            Nice and slow up here — learn the classic wins every champion knows by heart.
          </p>
        </header>
        <FerrisClient />
      </main>
      <Footer />
    </>
  );
}
