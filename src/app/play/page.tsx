import type { Metadata } from "next";
import Navbar from "@/Components/Navbar";
import Footer from "@/Components/Footer";
import PlayClient from "./PlayClient";

export const metadata: Metadata = {
  title: "Play with ChessPaa",
  description: "Play a real game of chess while ChessPaa coaches every single move.",
};

export default function PlayPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gradient-to-b from-chess-sky/50 via-white to-white pt-28 md:pt-32">
        <header className="mx-auto mb-6 max-w-7xl px-3 text-center md:px-6">
          <h1 className="font-park text-3xl font-extrabold text-chess-text md:text-4xl">
            ♟️ Play with <span className="text-chess-blue">ChessPaa</span>
          </h1>
          <p className="mt-1 text-sm text-slate-600 md:text-base">
            A real game at grandpa&apos;s table — and after every move you make, he tells you what he saw.
          </p>
        </header>
        <PlayClient />
      </main>
      <Footer />
    </>
  );
}
