import type { Metadata } from "next";
import Navbar from "@/Components/Navbar";
import Footer from "@/Components/Footer";
import CarouselClient from "./CarouselClient";

export const metadata: Metadata = {
  title: "Opening Carousel — ChessPaa",
  description: "Round and round — learn chess openings move by move with ChessPaa.",
};

export default function OpeningsPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gradient-to-b from-chess-sky/50 via-white to-white pt-28 md:pt-32">
        <header className="mx-auto mb-6 max-w-6xl px-3 text-center md:px-6">
          <h1 className="font-park text-3xl font-extrabold text-chess-text md:text-4xl">
            🎠 Opening <span className="text-chess-blue">Carousel</span>
          </h1>
          <p className="mt-1 text-sm text-slate-600 md:text-base">
            Openings are muscle memory — pick a horse and go round and round until your fingers know the way.
          </p>
        </header>
        <CarouselClient />
      </main>
      <Footer />
    </>
  );
}
