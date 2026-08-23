"use client";

import { useCallback, useMemo, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import type { PieceDropHandlerArgs, SquareHandlerArgs, Arrow } from "react-chessboard";

import { OPENINGS, type OpeningRide } from "@/lib/data/openings";
import ChessPaaBubble from "@/Components/chess/ChessPaaBubble";
import Confetti, { fireConfetti } from "@/Components/chess/Confetti";
import { RIDE_WELCOME } from "@/lib/chess/phrases";
import { addTickets, addStars } from "@/lib/progress";
import { sfx, speak } from "@/lib/sound";
import {
  BOARD_STYLE, DARK_SQ, LIGHT_SQ, SELECTED_STYLE, LEGAL_DOT, LEGAL_CAPTURE, LAST_MOVE, HINT_SQ,
} from "@/lib/chess/boardTheme";

export default function CarouselClient() {
  const [ride, setRide] = useState<OpeningRide | null>(null);
  const [fen, setFen] = useState(new Chess().fen());
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [tries, setTries] = useState(0);
  const [bubble, setBubble] = useState(RIDE_WELCOME.carousel);
  const [done, setDone] = useState(false);
  const [shake, setShake] = useState(false);

  const chess = useMemo(() => new Chess(fen), [fen]);
  const expected = ride && !done ? ride.steps[step] : null;

  const board = (ride: OpeningRide) => {
    setRide(ride);
    setFen(new Chess().fen());
    setStep(0);
    setSelected(null);
    setLastMove(null);
    setTries(0);
    setDone(false);
    const line = `${ride.name}! ${ride.intro}`;
    setBubble(line);
    speak(line);
    sfx.whoosh();
  };

  const attempt = useCallback((from: string, to: string): boolean => {
    if (!ride || !expected || done) return false;
    const exp = expected.uci;
    const attempted = from + to;
    if (attempted !== exp.slice(0, 4)) {
      setTries((t) => t + 1);
      setShake(true);
      setTimeout(() => setShake(false), 450);
      sfx.wrong();
      const side = chess.turn() === "w" ? "White" : "Black";
      setBubble(tries >= 1
        ? `Follow the glow! ${side} plays ${expected.san} here — the arrow shows the way.`
        : `Not this one, little rider — on this horse ${side} plays ${expected.san}. Look for the glowing square!`);
      return false;
    }
    const c = new Chess(fen);
    try {
      const mv = c.move({ from: from as Square, to: to as Square, promotion: (exp[4] as "q") ?? undefined });
      setFen(c.fen());
      setLastMove([mv.from, mv.to]);
      setSelected(null);
      setTries(0);
      if (mv.captured) sfx.capture(); else sfx.move();
      setBubble(expected.say);
      speak(expected.say);
      if (step + 1 >= ride.steps.length) {
        setDone(true);
        fireConfetti("big");
        sfx.win();
        addTickets(3);
        addStars("carousel", 3);
        setTimeout(() => { setBubble(ride.outro); speak(ride.outro); }, 1600);
      } else {
        setStep(step + 1);
      }
      return true;
    } catch {
      return false;
    }
  }, [ride, expected, done, fen, step, tries, chess]);

  const onSquareClick = useCallback(({ piece, square }: SquareHandlerArgs) => {
    if (!ride || done) return;
    if (selected && square !== selected) {
      const legal = chess.moves({ square: selected as Square, verbose: true }).some((m) => m.to === square);
      if (legal) { attempt(selected, square); return; }
    }
    if (piece && piece.pieceType[0] === chess.turn()) setSelected(square === selected ? null : square);
    else setSelected(null);
  }, [ride, done, selected, chess, attempt]);

  const onPieceDrop = useCallback(({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
    if (!targetSquare) return false;
    return attempt(sourceSquare, targetSquare);
  }, [attempt]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (lastMove) { styles[lastMove[0]] = LAST_MOVE; styles[lastMove[1]] = { ...LAST_MOVE }; }
    if (expected) {
      styles[expected.uci.slice(0, 2)] = { ...(styles[expected.uci.slice(0, 2)] ?? {}), ...HINT_SQ };
    }
    if (selected) {
      styles[selected] = { ...(styles[selected] ?? {}), ...SELECTED_STYLE };
      for (const m of chess.moves({ square: selected as Square, verbose: true })) {
        styles[m.to] = { ...(styles[m.to] ?? {}), ...(m.captured ? LEGAL_CAPTURE : LEGAL_DOT) };
      }
    }
    return styles;
  }, [lastMove, expected, selected, chess]);

  const arrows = useMemo<Arrow[]>(() => {
    if (expected && tries >= 2) {
      return [{ startSquare: expected.uci.slice(0, 2), endSquare: expected.uci.slice(2, 4), color: "rgba(37,169,180,0.9)" }];
    }
    return [];
  }, [expected, tries]);

  if (!ride) {
    return (
      <div className="mx-auto max-w-6xl px-3 md:px-6 pb-16">
        <Confetti />
        <div className="mx-auto mb-6 max-w-3xl"><ChessPaaBubble text={bubble} autoSpeak={false} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          {OPENINGS.map((o) => (
            <button key={o.slug} onClick={() => board(o)}
              className="group rounded-3xl bg-white/95 p-5 text-left shadow-card ring-1 ring-chess-sand/60 transition hover:-translate-y-1.5 hover:shadow-floating">
              <div className="flex items-center justify-between">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl text-3xl shadow-card" style={{ backgroundColor: `${o.color}22` }}>{o.horse}</span>
                <span className="rounded-full bg-chess-sand px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-chess-text">{o.steps.length} moves</span>
              </div>
              <h4 className="mt-2 text-lg font-extrabold text-chess-text">{o.name}</h4>
              <p className="mt-1 text-sm text-slate-600">{o.tagline}</p>
              <span className="mt-3 inline-block rounded-full bg-chess-teal px-4 py-1.5 text-xs font-bold text-white shadow-sm group-hover:brightness-110">Saddle up →</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const sideToMove = chess.turn() === "w" ? "⚪ White" : "⚫ Black";

  return (
    <div className="mx-auto max-w-6xl px-3 md:px-6 pb-16">
      <Confetti />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button onClick={() => { setRide(null); setBubble(RIDE_WELCOME.carousel); }}
          className="rounded-full bg-white px-4 py-2 text-sm font-bold text-chess-text shadow-card ring-1 ring-chess-sand hover:brightness-105">
          ← All horses
        </button>
        <div className="flex items-center gap-2 text-sm font-bold">
          <span className="rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-chess-sand/60">{ride.horse} {ride.name}</span>
          <span className="rounded-full bg-chess-yellow px-3 py-1 shadow-sm">step {Math.min(step + 1, ride.steps.length)} / {ride.steps.length}</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] items-start">
        <div className={shake ? "chesspaa-shake" : undefined}>
          <div className="mb-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-chess-teal px-4 py-1.5 text-sm font-bold text-white shadow-sm">
              {done ? "🎠 Ride complete!" : <>You play BOTH sides — now move for {sideToMove}: <b>{expected?.san}</b></>}
            </span>
          </div>
          <Chessboard
            options={{
              id: "carousel-board",
              position: fen,
              boardOrientation: "white",
              boardStyle: BOARD_STYLE,
              darkSquareStyle: DARK_SQ,
              lightSquareStyle: LIGHT_SQ,
              squareStyles,
              arrows,
              animationDurationInMs: 250,
              allowDragging: !done,
              canDragPiece: ({ piece }) => !done && piece.pieceType[0] === chess.turn(),
              onPieceDrop,
              onSquareClick,
              allowDrawingArrows: false,
              showNotation: true,
            }}
          />
          {done && (
            <div className="chesspaa-pop mt-4 rounded-3xl bg-white p-6 text-center shadow-floating ring-2 ring-chess-yellow">
              <p className="text-4xl">🎠🏅</p>
              <h3 className="mt-1 text-xl font-extrabold text-chess-text">You know {ride.name} now!</h3>
              <p className="mt-1 text-sm text-chess-text/70">+3 tickets! Ride it a few times until your hands remember it.</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <button onClick={() => board(ride)} className="rounded-full bg-chess-red px-5 py-2 font-bold text-white shadow-card hover:brightness-110">🔄 Ride again</button>
                <button onClick={() => { setRide(null); setBubble(RIDE_WELCOME.carousel); }} className="rounded-full bg-chess-teal px-5 py-2 font-bold text-white shadow-card hover:brightness-110">🎠 Another horse</button>
              </div>
            </div>
          )}
        </div>
        <div className="lg:sticky lg:top-28">
          <ChessPaaBubble text={bubble} autoSpeak={false} />
          <div className="mt-3 space-y-1.5 rounded-2xl bg-white/80 p-4 shadow-card ring-1 ring-chess-sand/60">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-chess-teal">The story so far</p>
            {ride.steps.slice(0, step + (done ? 1 : 0)).map((s, i) => (
              <p key={i} className="text-sm text-chess-text"><b className="text-chess-teal">{i + 1}. {s.san}</b> — {s.say}</p>
            ))}
            {step === 0 && !done && <p className="text-sm text-chess-text/60">Play the glowing move to begin…</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
