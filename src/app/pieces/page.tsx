import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/Components/Navbar";
import Footer from "@/Components/Footer";
import { PIECES } from "@/lib/data/pieces";

export const metadata: Metadata = {
  title: "Castle of Pieces — ChessPaa",
  description: "Meet every chess piece — each with its own song, rhyme and moves.",
};

export default function PiecesPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gradient-to-b from-chess-sky/50 via-white to-white pt-28 md:pt-32">
        <header className="mx-auto mb-8 max-w-6xl px-3 text-center md:px-6">
          <h1 className="font-park text-3xl font-extrabold text-chess-text md:text-4xl">
            🏰 The Castle of <span className="text-chess-blue">Pieces</span>
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600 md:text-base">
            Every hero on the board lives here. Step inside a room to hear their song,
            learn their moves, and play their star game!
          </p>
        </header>

        <div className="mx-auto grid max-w-6xl gap-4 px-3 sm:grid-cols-2 lg:grid-cols-3 md:px-6 pb-16">
          {PIECES.map((p) => (
            <Link
              key={p.slug}
              href={`/pieces/${p.slug}`}
              className="group rounded-3xl bg-white/95 p-6 shadow-card ring-1 ring-chess-sand/60 transition hover:-translate-y-1.5 hover:shadow-floating"
            >
              <div className="flex items-center justify-between">
                <span
                  className="flex h-16 w-16 items-center justify-center rounded-2xl text-5xl shadow-card transition group-hover:scale-110 group-hover:rotate-6"
                  style={{ backgroundColor: `${p.color}22`, color: p.color }}
                  aria-hidden
                >
                  {p.glyph}
                </span>
                {p.song ? (
                  <span className="rounded-full bg-chess-yellow px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-chess-text shadow-sm">
                    🎵 has a song!
                  </span>
                ) : (
                  <span className="rounded-full bg-chess-sand px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-chess-text/70">
                    🎤 song coming soon
                  </span>
                )}
              </div>
              <h3 className="mt-3 text-xl font-extrabold text-chess-text">{p.name}</h3>
              <p className="mt-0.5 text-sm font-semibold" style={{ color: p.color }}>{p.title}</p>
              <p className="mt-2 text-sm italic text-slate-600">“{p.rhyme[0]}…”</p>
              <span className="mt-4 inline-block rounded-full bg-chess-teal px-4 py-1.5 text-xs font-bold text-white shadow-sm transition group-hover:brightness-110">
                Step inside →
              </span>
            </Link>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
