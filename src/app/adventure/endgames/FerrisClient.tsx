"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import type { PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";

import ferrisPacks from "@/lib/data/puzzles/ferris.json";
import { CABINS, type Cabin } from "@/lib/data/cabins";
import { getEngine } from "@/lib/chess/engine";
import { analyzeKidMove } from "@/lib/chess/coach";
import PuzzleRunner, { type PuzzleData, type PuzzleResult } from "@/Components/chess/PuzzleRunner";
import ChessPaaBubble from "@/Components/chess/ChessPaaBubble";
import Confetti, { fireConfetti } from "@/Components/chess/Confetti";
import { cheer, RIDE_WELCOME } from "@/lib/chess/phrases";
import { addTickets, addStars } from "@/lib/progress";
import { sfx, speak } from "@/lib/sound";
import {
  BOARD_STYLE, DARK_SQ, LIGHT_SQ, SELECTED_STYLE, LEGAL_DOT, LEGAL_CAPTURE, LAST_MOVE, CHECK_SQ,
} from "@/lib/chess/boardTheme";

type Mode = { kind: "menu" } | { kind: "cabin"; cabin: Cabin } | { kind: "mates" } | { kind: "skills" };

export default function FerrisClient() {
  const engine = useMemo(() => getEngine(), []);
  const [mode, setMode] = useState<Mode>({ kind: "menu" });
  const [bubble, setBubble] = useState(RIDE_WELCOME.ferris);

  /* ---------- cabin game state ---------- */
  const [fen, setFen] = useState("");
  const fenRef = useRef(fen);
  fenRef.current = fen;
  const [selected, setSelected] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [busy, setBusy] = useState(false);
  const [kidMoves, setKidMoves] = useState(0);
  const [cabinOver, setCabinOver] = useState<null | { win: boolean; stars: number; text: string }>(null);

  const chess = useMemo(() => (fen ? new Chess(fen) : null), [fen]);

  const enterCabin = (cabin: Cabin) => {
    setMode({ kind: "cabin", cabin });
    setFen(cabin.fen);
    setSelected(null);
    setLastMove(null);
    setKidMoves(0);
    setCabinOver(null);
    setBubble(`${cabin.name}! ${cabin.lesson}`);
    speak(`${cabin.name}! ${cabin.lesson}`);
  };

  const finishCabin = useCallback((cabin: Cabin, moves: number, win: boolean, why: string) => {
    if (win) {
      const stars = moves <= cabin.parMoves ? 3 : moves <= cabin.parMoves + 6 ? 2 : 1;
      setCabinOver({ win, stars, text: why });
      addStars("ferris", stars);
      addTickets(stars);
      fireConfetti("big");
      sfx.win();
      const line = `CHECKMATE in ${moves} moves! ${"⭐".repeat(stars)} ${stars === 3 ? "Under par — perfect technique!" : "Wonderful! Try again to beat par!"}`;
      setBubble(line);
      speak(line);
    } else {
      setCabinOver({ win, stars: 0, text: why });
      setBubble(why + " Tap retry and we'll go again — this is exactly how endgames are learned!");
      speak(why);
    }
  }, []);

  const cabinAttempt = useCallback((from: string, to: string): boolean => {
    if (mode.kind !== "cabin" || busy || cabinOver) return false;
    const cabin = mode.cabin;
    const before = fenRef.current;
    const c = new Chess(before);
    if (c.turn() !== "w") return false;
    let mv;
    try {
      mv = c.move({ from: from as Square, to: to as Square, promotion: "q" });
    } catch { return false; }

    const nKid = kidMoves + 1;
    setKidMoves(nKid);
    setFen(c.fen());
    setLastMove([mv.from, mv.to]);
    setSelected(null);
    if (mv.captured) sfx.capture(); else sfx.move();
    if (c.inCheck()) sfx.check();
    setBusy(true);

    (async () => {
      try {
        if (c.isCheckmate()) { finishCabin(cabin, nKid, true, "Checkmate!"); return; }
        if (c.isStalemate()) {
          finishCabin(cabin, nKid, false,
            "Oh no — STALEMATE! Their king had no moves but was NOT in check, so it's a draw. Grandpa's rule: always leave the cornered king one little square to shuffle in… until you strike!");
          return;
        }
        if (c.isDraw()) { finishCabin(cabin, nKid, false, "It fizzled into a draw. Watch out for losing your big pieces!"); return; }

        // quick coach check — warn only on real trouble, keep the ride calm
        const facts = await analyzeKidMove({ fenBefore: before, playedUci: mv.from + mv.to + (mv.promotion ?? ""), engine, kidColor: "w", budgetMs: 420 });
        if (facts.patterns.includes("promoted")) {
          const line = "PROMOTION! The little pawn's dream came true — now finish like a champion!";
          setBubble(line); speak(line);
        } else if (facts.grade === "blunder" && facts.hangs) {
          const line = `Careful, careful — your ${facts.hangs.piece} can be captured on ${facts.hangs.square}! In endgames, your big piece is the whole toolbox. You may want to take that back… I mean, learn from it!`;
          setBubble(line); speak(line);
        } else if (facts.mateForKidIn && facts.mateForKidIn <= 3) {
          const line = `Ooh, mate in ${facts.mateForKidIn} is on the table — look for the final squeeze!`;
          setBubble(line); speak(line);
        } else if (facts.grade === "sparkle" && nKid % 2 === 1) {
          setBubble(cheer("right"));
        }

        // defender replies
        const uci = await engine.playForKid(c.fen(), cabin.engineLevel);
        const c2 = new Chess(c.fen());
        try {
          const rm = c2.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: (uci[4] as "q") ?? "q" });
          await new Promise((r) => setTimeout(r, 300));
          setFen(c2.fen());
          setLastMove([rm.from, rm.to]);
          sfx.move();
          if (c2.isCheckmate()) finishCabin(cabin, nKid, false, "Goodness — the tables turned into checkmate against us! Let's ride this cabin again.");
          else if (c2.isDraw()) finishCabin(cabin, nKid, false, "A draw sneaked in. Keep your pieces safe and try once more!");
        } catch { /* defender out of moves */ }
      } finally {
        setBusy(false);
      }
    })();
    return true;
  }, [mode, busy, cabinOver, kidMoves, engine, finishCabin]);

  const onSquareClick = useCallback(({ piece, square }: SquareHandlerArgs) => {
    if (!chess || busy || cabinOver) return;
    if (selected && square !== selected) {
      const legal = chess.moves({ square: selected as Square, verbose: true }).some((m) => m.to === square);
      if (legal) { cabinAttempt(selected, square); return; }
    }
    if (piece && piece.pieceType[0] === "w" && chess.turn() === "w") setSelected(square === selected ? null : square);
    else setSelected(null);
  }, [chess, busy, cabinOver, selected, cabinAttempt]);

  const onPieceDrop = useCallback(({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
    if (!targetSquare) return false;
    return cabinAttempt(sourceSquare, targetSquare);
  }, [cabinAttempt]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (!chess) return styles;
    if (lastMove) { styles[lastMove[0]] = LAST_MOVE; styles[lastMove[1]] = { ...LAST_MOVE }; }
    if (chess.inCheck()) {
      for (const row of chess.board()) for (const sq of row) {
        if (sq && sq.type === "k" && sq.color === chess.turn()) styles[sq.square] = CHECK_SQ;
      }
    }
    if (selected) {
      styles[selected] = { ...(styles[selected] ?? {}), ...SELECTED_STYLE };
      for (const m of chess.moves({ square: selected as Square, verbose: true })) {
        styles[m.to] = { ...(styles[m.to] ?? {}), ...(m.captured ? LEGAL_CAPTURE : LEGAL_DOT) };
      }
    }
    return styles;
  }, [chess, lastMove, selected]);

  /* ---------- puzzle wheels ---------- */
  const [puzzleIdx, setPuzzleIdx] = useState(0);
  const puzzles = useMemo<PuzzleData[]>(() => {
    if (mode.kind === "mates") return (ferrisPacks.mates as PuzzleData[]);
    if (mode.kind === "skills") return (ferrisPacks.skills as PuzzleData[]);
    return [];
  }, [mode.kind]);

  const onPuzzleSolved = useCallback((_r: PuzzleResult) => {
    addTickets(1);
    addStars("ferris", 1);
    setBubble(cheer("right"));
    setTimeout(() => setPuzzleIdx((i) => (i + 1) % Math.max(1, puzzles.length)), 900);
  }, [puzzles.length]);

  /* ================= render ================= */

  if (mode.kind === "menu") {
    return (
      <div className="mx-auto max-w-6xl px-3 md:px-6 pb-16">
        <Confetti />
        <div className="mx-auto mb-6 max-w-3xl"><ChessPaaBubble text={bubble} autoSpeak={false} /></div>

        <h3 className="mb-3 text-center font-park text-xl font-extrabold text-chess-text">🎡 Pick a cabin — finish the win!</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {CABINS.map((cab) => (
            <button key={cab.slug} onClick={() => enterCabin(cab)}
              className="group rounded-3xl bg-white/95 p-5 text-left shadow-card ring-1 ring-chess-sand/60 transition hover:-translate-y-1.5 hover:shadow-floating">
              <div className="flex items-center justify-between">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl text-2xl shadow-card" style={{ backgroundColor: `${cab.color}22` }}>{cab.emoji}</span>
                <span className="rounded-full bg-chess-sand px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-chess-text">par {cab.parMoves} moves</span>
              </div>
              <h4 className="mt-2 text-lg font-extrabold text-chess-text">{cab.name}</h4>
              <p className="mt-1 text-sm text-slate-600">{cab.goal}</p>
              <span className="mt-3 inline-block rounded-full bg-chess-teal px-4 py-1.5 text-xs font-bold text-white shadow-sm group-hover:brightness-110">Hop in →</span>
            </button>
          ))}
        </div>

        <h3 className="mb-3 mt-10 text-center font-park text-xl font-extrabold text-chess-text">🌙 Or spin the puzzle wheels</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <button onClick={() => { setMode({ kind: "mates" }); setPuzzleIdx(Math.floor(Math.random() * (ferrisPacks.mates as PuzzleData[]).length)); setBubble("Endgame checkmates — quiet boards, one perfect strike. Eyes sharp!"); }}
            className="rounded-3xl bg-white/95 p-5 text-left shadow-card ring-1 ring-chess-sand/60 transition hover:-translate-y-1.5 hover:shadow-floating">
            <span className="text-3xl">🌟</span>
            <h4 className="mt-2 text-lg font-extrabold text-chess-text">Wheel of Mates</h4>
            <p className="mt-1 text-sm text-slate-600">Real endgame checkmates from real games — find the winning move!</p>
          </button>
          <button onClick={() => { setMode({ kind: "skills" }); setPuzzleIdx(Math.floor(Math.random() * (ferrisPacks.skills as PuzzleData[]).length)); setBubble("Endgame skills — pawns, rooks and clever kings. Slow and thoughtful now…"); }}
            className="rounded-3xl bg-white/95 p-5 text-left shadow-card ring-1 ring-chess-sand/60 transition hover:-translate-y-1.5 hover:shadow-floating">
            <span className="text-3xl">🧠</span>
            <h4 className="mt-2 text-lg font-extrabold text-chess-text">Wheel of Skills</h4>
            <p className="mt-1 text-sm text-slate-600">Tricky endgame ideas: promotion races, rook tricks, king power.</p>
          </button>
        </div>
      </div>
    );
  }

  if (mode.kind === "cabin") {
    const cab = mode.cabin;
    const kidsTurn = !busy && !cabinOver && chess?.turn() === "w";
    return (
      <div className="mx-auto max-w-6xl px-3 md:px-6 pb-16">
        <Confetti />
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <button onClick={() => { setMode({ kind: "menu" }); setBubble(RIDE_WELCOME.ferris); }}
            className="rounded-full bg-white px-4 py-2 text-sm font-bold text-chess-text shadow-card ring-1 ring-chess-sand hover:brightness-105">
            ← All cabins
          </button>
          <div className="flex items-center gap-2 text-sm font-bold">
            <span className="rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-chess-sand/60">{cab.emoji} {cab.name}</span>
            <span className="rounded-full bg-chess-yellow px-3 py-1 shadow-sm">🚶 {kidMoves} moves · par {cab.parMoves}</span>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] items-start">
          <div>
            <div className="mb-2">
              <span className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold shadow-sm ${kidsTurn ? "bg-chess-teal text-white" : "bg-white/90 text-chess-text"}`}>
                {cabinOver ? (cabinOver.win ? `🏆 ${"⭐".repeat(cabinOver.stars)} Cabin conquered!` : "🔁 Let's try that again!") : kidsTurn ? "⚪ Your move — you're winning, finish it!" : "🧓 ChessPaa's king shuffles…"}
              </span>
            </div>
            {fen && (
              <Chessboard
                options={{
                  id: "cabin-board",
                  position: fen,
                  boardOrientation: "white",
                  boardStyle: BOARD_STYLE,
                  darkSquareStyle: DARK_SQ,
                  lightSquareStyle: LIGHT_SQ,
                  squareStyles,
                  animationDurationInMs: 250,
                  allowDragging: kidsTurn,
                  canDragPiece: ({ piece }) => !!kidsTurn && piece.pieceType[0] === "w",
                  onPieceDrop,
                  onSquareClick,
                  allowDrawingArrows: false,
                  showNotation: true,
                }}
              />
            )}
            <div className="mt-3 flex gap-2">
              <button onClick={() => enterCabin(cab)} className="rounded-full bg-chess-red px-4 py-2 text-sm font-bold text-white shadow-card hover:brightness-110">
                🔄 Restart cabin
              </button>
            </div>
          </div>
          <div className="lg:sticky lg:top-28">
            <ChessPaaBubble text={bubble} autoSpeak={false} />
            <div className="mt-3 rounded-2xl bg-white/80 p-4 text-sm leading-relaxed text-chess-text shadow-card ring-1 ring-chess-sand/60">
              <p className="mb-1 font-extrabold">🎯 Goal: {cab.goal}</p>
              <p className="text-chess-text/70">{cab.lesson}</p>
            </div>
            {cabinOver && (
              <div className="chesspaa-pop mt-4 rounded-2xl bg-white p-4 text-center shadow-floating ring-2 ring-chess-yellow">
                <p className="text-3xl">{cabinOver.win ? "🎡" + "⭐".repeat(cabinOver.stars) : "🌱"}</p>
                <p className="mt-1 font-bold text-chess-text">{cabinOver.text}</p>
                <div className="mt-3 flex justify-center gap-2">
                  <button onClick={() => enterCabin(cab)} className="rounded-full bg-chess-red px-4 py-2 text-sm font-bold text-white shadow-card">🔄 Again</button>
                  <button onClick={() => { setMode({ kind: "menu" }); setBubble(RIDE_WELCOME.ferris); }} className="rounded-full bg-chess-teal px-4 py-2 text-sm font-bold text-white shadow-card">🎡 Other cabins</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* puzzle wheels */
  const label = mode.kind === "mates" ? "🌟 Wheel of Mates" : "🧠 Wheel of Skills";
  return (
    <div className="mx-auto max-w-6xl px-3 md:px-6 pb-16">
      <Confetti />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button onClick={() => { setMode({ kind: "menu" }); setBubble(RIDE_WELCOME.ferris); }}
          className="rounded-full bg-white px-4 py-2 text-sm font-bold text-chess-text shadow-card ring-1 ring-chess-sand hover:brightness-105">
          ← Ferris wheel
        </button>
        <span className="rounded-full bg-white px-3 py-1 text-sm font-bold shadow-sm ring-1 ring-chess-sand/60">{label} · puzzle {puzzleIdx + 1} of {puzzles.length}</span>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] items-start">
        <div>
          {puzzles[puzzleIdx] && (
            <PuzzleRunner key={puzzles[puzzleIdx].id} puzzle={puzzles[puzzleIdx]} onSolved={onPuzzleSolved} onWrong={() => setBubble(cheer("wrong"))} />
          )}
        </div>
        <div className="lg:sticky lg:top-28">
          <ChessPaaBubble text={bubble} autoSpeak={false} />
        </div>
      </div>
    </div>
  );
}
