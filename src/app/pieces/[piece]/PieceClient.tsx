"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Chessboard } from "react-chessboard";
import type { PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";

import type { PieceInfo } from "@/lib/data/pieces";
import ChessPaaBubble from "@/Components/chess/ChessPaaBubble";
import Confetti, { fireConfetti } from "@/Components/chess/Confetti";
import { sfx, speak } from "@/lib/sound";
import {
  BOARD_STYLE, DARK_SQ, LIGHT_SQ, SELECTED_STYLE, LEGAL_DOT, STAR_SQ,
} from "@/lib/chess/boardTheme";

/* ---------- a tiny movement engine for lone-piece boards ---------- */

const FILES = "abcdefgh";
function toXY(sq: string): [number, number] { return [FILES.indexOf(sq[0]), parseInt(sq[1], 10) - 1]; }
function toSq(x: number, y: number): string | null {
  return x >= 0 && x < 8 && y >= 0 && y < 8 ? `${FILES[x]}${y + 1}` : null;
}

function pieceMoves(kind: string, from: string): string[] {
  const [x, y] = toXY(from);
  const out: string[] = [];
  const slide = (dirs: [number, number][]) => {
    for (const [dx, dy] of dirs) {
      for (let i = 1; i < 8; i++) {
        const s = toSq(x + dx * i, y + dy * i);
        if (!s) break;
        out.push(s);
      }
    }
  };
  switch (kind) {
    case "p": {
      const s1 = toSq(x, y + 1);
      if (s1) out.push(s1);
      if (y === 1) { const s2 = toSq(x, y + 2); if (s2) out.push(s2); }
      break;
    }
    case "r": slide([[1, 0], [-1, 0], [0, 1], [0, -1]]); break;
    case "b": slide([[1, 1], [1, -1], [-1, 1], [-1, -1]]); break;
    case "q": slide([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]); break;
    case "n":
      for (const [dx, dy] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const) {
        const s = toSq(x + dx, y + dy);
        if (s) out.push(s);
      }
      break;
    case "k":
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const s = toSq(x + dx, y + dy);
        if (s) out.push(s);
      }
      break;
  }
  return out;
}

/* ------------------------------------------------------------------ */

export default function PieceClient({ piece }: { piece: PieceInfo }) {
  const [square, setSquare] = useState(piece.starGame.start);
  const [stars, setStars] = useState<string[]>(piece.starGame.stars);
  const [collected, setCollected] = useState<string[]>([]);
  const [moves, setMoves] = useState(0);
  const [showMoves, setShowMoves] = useState(true);
  const [won, setWon] = useState(false);
  const [bubble, setBubble] = useState(
    `This is the ${piece.name}'s room! ${piece.secret} Try the Star Game: catch all ${piece.starGame.stars.length} stars using only real ${piece.name} moves!`
  );

  const legal = useMemo(() => new Set(pieceMoves(piece.fenChar, square)), [piece.fenChar, square]);

  const position = useMemo(() => ({ [square]: { pieceType: `w${piece.fenChar.toUpperCase()}` } }), [square, piece.fenChar]);

  const reset = useCallback(() => {
    setSquare(piece.starGame.start);
    setStars(piece.starGame.stars);
    setCollected([]);
    setMoves(0);
    setWon(false);
    setBubble(`Fresh board! Catch the ${piece.starGame.stars.length} stars — par is ${piece.starGame.parMoves} moves. Off you go, little ${piece.name}!`);
  }, [piece]);

  const moveTo = useCallback((to: string): boolean => {
    if (won || !legal.has(to)) return false;
    setSquare(to);
    setMoves((m) => m + 1);
    sfx.move();
    if (stars.includes(to)) {
      const left = stars.filter((s) => s !== to);
      setStars(left);
      setCollected((c) => [...c, to]);
      sfx.ticket();
      if (left.length === 0) {
        setWon(true);
        fireConfetti("big");
        sfx.win();
        const m = moves + 1;
        const line = m <= piece.starGame.parMoves
          ? `ALL STARS in ${m} moves — that's par or better! You move like a true ${piece.name} now!`
          : `All stars caught in ${m} moves! Can you do it in ${piece.starGame.parMoves}? The ${piece.name} believes in you!`;
        setBubble(line);
        speak(line);
      } else {
        setBubble(`⭐ Got one! ${left.length} star${left.length === 1 ? "" : "s"} to go…`);
      }
    }
    return true;
  }, [won, legal, stars, moves, piece]);

  const onSquareClick = useCallback(({ square: sq }: SquareHandlerArgs) => {
    if (sq === square) { setShowMoves((s) => !s); return; }
    moveTo(sq);
  }, [square, moveTo]);

  const onPieceDrop = useCallback(({ targetSquare }: PieceDropHandlerArgs): boolean => {
    if (!targetSquare) return false;
    return moveTo(targetSquare);
  }, [moveTo]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    styles[square] = SELECTED_STYLE;
    if (showMoves) for (const s of legal) styles[s] = { ...(styles[s] ?? {}), ...LEGAL_DOT };
    for (const s of stars) styles[s] = { ...(styles[s] ?? {}), ...STAR_SQ };
    return styles;
  }, [square, legal, showMoves, stars]);

  return (
    <div className="mx-auto max-w-6xl px-3 md:px-6 pb-16">
      <Confetti />
      <div className="grid gap-6 lg:grid-cols-2 items-start">

        {/* --------- song & rhyme --------- */}
        <div className="space-y-4">
          <div className="rounded-3xl bg-white/95 p-6 shadow-card ring-1 ring-chess-sand/60">
            <div className="flex items-center gap-4">
              <span className="flex h-20 w-20 items-center justify-center rounded-3xl text-6xl shadow-card"
                style={{ backgroundColor: `${piece.color}22`, color: piece.color }} aria-hidden>
                {piece.glyph}
              </span>
              <div>
                <h2 className="text-2xl font-extrabold text-chess-text">{piece.name}</h2>
                <p className="font-semibold" style={{ color: piece.color }}>{piece.title}</p>
              </div>
            </div>

            {piece.song ? (
              <div className="mt-4 rounded-2xl bg-chess-sky/60 p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-chess-teal">🎵 ChessPaa sings: {piece.title}</p>
                <audio controls preload="none" className="w-full" src={piece.song}>
                  Your browser can&apos;t play this song.
                </audio>
                {piece.songAlt && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-bold text-chess-teal">🎶 bonus version</summary>
                    <audio controls preload="none" className="mt-1 w-full" src={piece.songAlt} />
                  </details>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border-2 border-dashed border-chess-sand bg-chess-sky/40 p-4">
                <p className="text-sm font-semibold text-chess-text">
                  🎤 ChessPaa is still humming this one in the shower — the song arrives soon!
                  For now, tap the speaker and he&apos;ll read the rhyme aloud.
                </p>
                <button
                  onClick={() => speak(piece.rhyme.join(" "))}
                  className="mt-2 rounded-full bg-chess-teal px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:brightness-110">
                  🔊 Read the rhyme to me
                </button>
              </div>
            )}

            <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-chess-sand/60">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-chess-teal">📜 Sing along</p>
              {piece.rhyme.map((line, i) => (
                <p key={i} className="text-[15px] font-medium leading-7 text-chess-text">{line}</p>
              ))}
            </div>

            <p className="mt-4 rounded-2xl bg-chess-yellow/30 p-3 text-sm text-chess-text">
              <b>🤫 ChessPaa&apos;s secret:</b> {piece.secret}
            </p>
          </div>
        </div>

        {/* --------- star game --------- */}
        <div className="lg:sticky lg:top-28 space-y-4">
          <ChessPaaBubble text={bubble} autoSpeak={false} size="sm" />

          <div className="rounded-3xl bg-white/95 p-4 shadow-card ring-1 ring-chess-sand/60">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-extrabold text-chess-text">⭐ The Star Game</p>
              <div className="flex items-center gap-2 text-xs font-bold">
                <span className="rounded-full bg-chess-sky px-3 py-1 text-chess-text">🚶 {moves} moves · par {piece.starGame.parMoves}</span>
                <span className="rounded-full bg-chess-yellow px-3 py-1 text-chess-text">⭐ {collected.length}/{piece.starGame.stars.length}</span>
              </div>
            </div>
            <Chessboard
              options={{
                id: `piece-${piece.slug}`,
                position,
                boardOrientation: "white",
                boardStyle: BOARD_STYLE,
                darkSquareStyle: DARK_SQ,
                lightSquareStyle: LIGHT_SQ,
                squareStyles,
                animationDurationInMs: 200,
                allowDragging: !won,
                onPieceDrop,
                onSquareClick,
                allowDrawingArrows: false,
                showNotation: true,
              }}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => setShowMoves((s) => !s)} className="rounded-full bg-chess-sky px-4 py-1.5 text-xs font-bold text-chess-text shadow-sm hover:brightness-105">
                {showMoves ? "🙈 Hide move glow" : "✨ Show move glow"}
              </button>
              <button onClick={reset} className="rounded-full bg-chess-red px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:brightness-110">
                🔄 New round
              </button>
            </div>
            {won && (
              <div className="chesspaa-pop mt-3 rounded-2xl bg-chess-yellow/40 p-3 text-center text-sm font-bold text-chess-text">
                🌟 Star Champion! Try to beat par, or visit the next room of the castle!
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <Link href="/pieces" className="rounded-full bg-white px-4 py-2 text-sm font-bold text-chess-text shadow-card ring-1 ring-chess-sand hover:brightness-105">
              ← Castle hall
            </Link>
            <Link href="/play" className="rounded-full bg-chess-teal px-4 py-2 text-sm font-bold text-white shadow-card hover:brightness-110">
              Ready to play a real game? →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
