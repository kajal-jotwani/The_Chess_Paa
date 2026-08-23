import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Navbar from "@/Components/Navbar";
import Footer from "@/Components/Footer";
import { getPiece, PIECES } from "@/lib/data/pieces";
import PieceClient from "./PieceClient";

export function generateStaticParams() {
  return PIECES.map((p) => ({ piece: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ piece: string }> }): Promise<Metadata> {
  const { piece } = await params;
  const info = getPiece(piece);
  return {
    title: info ? `${info.title} — ChessPaa` : "ChessPaa",
    description: info ? `Meet the ${info.name}: song, rhyme and star game.` : undefined,
  };
}

export default async function PiecePage({ params }: { params: Promise<{ piece: string }> }) {
  const { piece } = await params;
  const info = getPiece(piece);
  if (!info) notFound();

  const idx = PIECES.findIndex((p) => p.slug === info.slug);
  const next = PIECES[(idx + 1) % PIECES.length];

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gradient-to-b from-chess-sky/50 via-white to-white pt-28 md:pt-32">
        <header className="mx-auto mb-6 max-w-6xl px-3 text-center md:px-6">
          <h1 className="font-park text-3xl font-extrabold text-chess-text md:text-4xl">
            {info.glyph} {info.title}
          </h1>
          <p className="mt-1 text-sm text-slate-600 md:text-base">
            Room {idx + 1} of {PIECES.length} in the Castle of Pieces ·{" "}
            <Link href={`/pieces/${next.slug}`} className="font-bold text-chess-teal hover:underline">
              next room: {next.name} →
            </Link>
          </p>
        </header>
        <PieceClient piece={info} />
      </main>
      <Footer />
    </>
  );
}
