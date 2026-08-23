"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import type { PieceDropHandlerArgs, SquareHandlerArgs, Arrow } from "react-chessboard";
import Image from "next/image";

import { getEngine } from "@/lib/chess/engine";
import { analyzeKidMove, type CoachFacts } from "@/lib/chess/coach";
import { chessPaaSays, gradeMeta, RIDE_WELCOME } from "@/lib/chess/phrases";
import {
  BOARD_STYLE, DARK_SQ, LIGHT_SQ, SELECTED_STYLE, LEGAL_DOT, LEGAL_CAPTURE,
  LAST_MOVE, CHECK_SQ,
} from "@/lib/chess/boardTheme";
import { sfx, speak } from "@/lib/sound";
import Confetti, { fireConfetti } from "@/Components/chess/Confetti";
import SmileMeter from "@/Components/chess/SmileMeter";
import ChessPaaBubble from "@/Components/chess/ChessPaaBubble";
import { addTickets } from "@/lib/progress";

const MOODS = [
  { name: "Teddy", emoji: "🧸", blurb: "ChessPaa plays super silly" },
  { name: "Sprout", emoji: "🌱", blurb: "very gentle" },
  { name: "Explorer", emoji: "🧭", blurb: "a fair little challenge" },
  { name: "Knight", emoji: "🐴", blurb: "grandpa tries properly" },
  { name: "Champ", emoji: "🏆", blurb: "bring your best!" },
];

interface FeedEntry {
  id: number;
  kind: "kid" | "paa" | "system";
  san?: string;
  moveNo?: number;
  text: string;
  facts?: CoachFacts;
  why?: string;
  whyLoading?: boolean;
}

let entryId = 1;

export default function PlayClient() {
  const engine = useMemo(() => getEngine(), []);
  const [fen, setFen] = useState(new Chess().fen());
  const fenRef = useRef(fen);
  fenRef.current = fen;

  const [kidColor, setKidColor] = useState<"w" | "b">("w");
  const [level, setLevel] = useState(1);
  const [ageMode, setAgeMode] = useState<"little" | "big">("little");
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [busy, setBusy] = useState(false); // engine thinking / coaching
  const [selected, setSelected] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [evalPawns, setEvalPawns] = useState(0);
  const [hintArrow, setHintArrow] = useState<Arrow | null>(null);
  const [gameOver, setGameOver] = useState<null | { result: "win" | "loss" | "draw"; text: string }>(null);
  const [bubble, setBubble] = useState(RIDE_WELCOME.play);
  const [started, setStarted] = useState(false);
  const historyRef = useRef<string[]>([]); // fen stack for takebacks
  const feedBox = useRef<HTMLDivElement | null>(null);

  const chess = useMemo(() => new Chess(fen), [fen]);

  useEffect(() => {
    feedBox.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [feed.length]);

  const pushFeed = useCallback((e: Omit<FeedEntry, "id">) => {
    setFeed((f) => [{ ...e, id: entryId++ }, ...f].slice(0, 40));
  }, []);

  /** ChessPaa (the engine) makes his reply move. */
  const grandpaMoves = useCallback(async (fromFen: string) => {
    const c = new Chess(fromFen);
    if (c.isGameOver()) return;
    const uci = await engine.playForKid(fromFen, level);
    const c2 = new Chess(fromFen);
    let mv;
    try {
      mv = c2.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: (uci[4] as "q") ?? "q" });
    } catch { return; }
    await new Promise((r) => setTimeout(r, 350));
    setFen(c2.fen());
    setLastMove([mv.from, mv.to]);
    if (mv.captured) sfx.capture(); else sfx.move();
    if (c2.inCheck()) sfx.check();

    if (c2.isCheckmate()) {
      setGameOver({ result: "loss", text: "ChessPaa got checkmate this time!" });
      const line = "Checkmate for grandpa this round! Chin up — every game plants a seed in your chess garden. One more ride?";
      setBubble(line);
      pushFeed({ kind: "system", text: `ChessPaa played ${mv.san} — checkmate. Rematch time! 🌱` });
      return;
    }
    if (c2.isDraw()) {
      setGameOver({ result: "draw", text: "A draw — the friendliest result!" });
      setBubble("A draw! We shook hands like true sportsfolk. Shall we ride again?");
      return;
    }
    // light meter refresh while the kid thinks
    engine.analyze(c2.fen(), { movetimeMs: 320, multipv: 1 }).then((a) => {
      const cp = a.scoreWhite.type === "cp" ? a.scoreWhite.value : (a.scoreWhite.value > 0 ? 4000 : -4000);
      setEvalPawns((kidColor === "w" ? cp : -cp) / 100);
    }).catch(() => {});
  }, [engine, level, kidColor, pushFeed]);

  /** Handle a kid move attempt. */
  const attempt = useCallback((from: string, to: string): boolean => {
    if (busy || gameOver) return false;
    if (chess.turn() !== kidColor) return false;
    const before = fenRef.current;
    const c = new Chess(before);
    let mv;
    try {
      mv = c.move({ from: from as Square, to: to as Square, promotion: "q" });
    } catch { return false; }

    historyRef.current.push(before);
    setStarted(true);
    setFen(c.fen());
    setLastMove([mv.from, mv.to]);
    setSelected(null);
    setHintArrow(null);
    if (mv.captured) sfx.capture(); else sfx.move();
    if (c.inCheck()) sfx.check();
    setBusy(true);

    (async () => {
      try {
        const facts = await analyzeKidMove({
          fenBefore: before,
          playedUci: mv.from + mv.to + (mv.promotion ?? ""),
          engine,
          kidColor,
          budgetMs: 650,
        });
        const text = chessPaaSays(facts);
        pushFeed({ kind: "kid", san: facts.playedSan, moveNo: Math.ceil(c.moveNumber() - (kidColor === "w" ? 1 : 0)), text, facts });
        setBubble(text);
        speak(text);
        setEvalPawns(facts.kidScoreAfterPawns);

        if (facts.mate) {
          setGameOver({ result: "win", text: "CHECKMATE — you beat ChessPaa!" });
          fireConfetti("big");
          sfx.win();
          addTickets(5);
          pushFeed({ kind: "system", text: "🎟 +5 tickets for the win! The ticket booth is cheering." });
          return;
        }
        if (facts.stalemate || c.isDraw()) {
          setGameOver({ result: "draw", text: "It's a draw!" });
          return;
        }
        await grandpaMoves(c.fen());
      } catch (err) {
        console.error(err);
        pushFeed({ kind: "system", text: "ChessPaa polished his glasses and missed that one. Keep playing!" });
        await grandpaMoves(c.fen());
      } finally {
        setBusy(false);
      }
    })();

    return true;
  }, [busy, gameOver, chess, kidColor, engine, pushFeed, grandpaMoves]);

  const onSquareClick = useCallback(({ piece, square }: SquareHandlerArgs) => {
    if (busy || gameOver) return;
    if (selected && square !== selected) {
      const legal = chess.moves({ square: selected as Square, verbose: true }).some((m) => m.to === square);
      if (legal) { attempt(selected, square); return; }
    }
    if (piece && piece.pieceType[0] === kidColor && chess.turn() === kidColor) {
      setSelected(square === selected ? null : square);
    } else setSelected(null);
  }, [busy, gameOver, selected, chess, kidColor, attempt]);

  const onPieceDrop = useCallback(({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
    if (!targetSquare) return false;
    return attempt(sourceSquare, targetSquare);
  }, [attempt]);

  const askWhy = useCallback(async (entry: FeedEntry) => {
    if (!entry.facts || entry.why || entry.whyLoading) return;
    setFeed((f) => f.map((e) => (e.id === entry.id ? { ...e, whyLoading: true } : e)));
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...entry.facts, ageMode }),
      });
      const data = (await res.json()) as { text?: string };
      const why = data.text || "Hmm, my megaphone crackled. Try asking again!";
      setFeed((f) => f.map((e) => (e.id === entry.id ? { ...e, why, whyLoading: false } : e)));
      speak(why);
    } catch {
      setFeed((f) => f.map((e) => (e.id === entry.id ? { ...e, why: "My megaphone crackled — ask me again in a moment!", whyLoading: false } : e)));
    }
  }, [ageMode]);

  const hint = useCallback(async () => {
    if (busy || gameOver || chess.turn() !== kidColor) return;
    setBusy(true);
    try {
      const a = await engine.analyze(fenRef.current, { movetimeMs: 550, multipv: 1 });
      if (a.bestMove) {
        setHintArrow({ startSquare: a.bestMove.slice(0, 2), endSquare: a.bestMove.slice(2, 4), color: "rgba(37,169,180,0.9)" });
        const line = "Grandpa whisper: look at the piece I circled… follow the arrow!";
        setBubble(line);
        speak(line);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, gameOver, chess, kidColor, engine]);

  const takeback = useCallback(() => {
    if (busy || historyRef.current.length === 0) return;
    const prev = historyRef.current.pop()!;
    setFen(prev);
    setLastMove(null);
    setSelected(null);
    setHintArrow(null);
    setGameOver(null);
    const line = "Time-turner! We rewound one move. Even grandmasters wish they could do this.";
    setBubble(line);
    pushFeed({ kind: "system", text: "⏪ Took back a move." });
  }, [busy, pushFeed]);

  const newGame = useCallback((side: "w" | "b" = kidColor) => {
    historyRef.current = [];
    const start = new Chess();
    setFen(start.fen());
    setKidColor(side);
    setFeed([]);
    setSelected(null);
    setLastMove(null);
    setHintArrow(null);
    setGameOver(null);
    setEvalPawns(0);
    setStarted(false);
    setBubble(side === "w"
      ? "Fresh board! You're White — you go first. Remember: center, develop, castle!"
      : "Fresh board! You're Black this time. I'll start us off…");
    if (side === "b") {
      setBusy(true);
      grandpaMoves(start.fen()).finally(() => setBusy(false));
    }
  }, [kidColor, grandpaMoves]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
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
  }, [lastMove, chess, selected]);

  const kidsTurn = !busy && !gameOver && chess.turn() === kidColor;

  return (
    <div className="mx-auto max-w-7xl px-3 md:px-6 pb-16">
      <Confetti />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] items-start">

        {/* ------- board column ------- */}
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold shadow-sm ${
              gameOver
                ? gameOver.result === "win" ? "bg-chess-yellow text-chess-text" : "bg-white text-chess-text"
                : kidsTurn ? "bg-chess-teal text-white" : "bg-white/90 text-chess-text"
            }`}>
              {gameOver
                ? (gameOver.result === "win" ? "🏆 " : gameOver.result === "draw" ? "🤝 " : "🌱 ") + gameOver.text
                : kidsTurn
                  ? `${kidColor === "w" ? "⚪" : "⚫"} Your turn, little master!`
                  : busy ? "🧓 ChessPaa strokes his beard…" : "…"}
            </span>
            <SmileMeter scorePawns={evalPawns} />
          </div>

          <Chessboard
            options={{
              id: "play-board",
              position: fen,
              boardOrientation: kidColor === "w" ? "white" : "black",
              boardStyle: BOARD_STYLE,
              darkSquareStyle: DARK_SQ,
              lightSquareStyle: LIGHT_SQ,
              squareStyles,
              arrows: hintArrow ? [hintArrow] : [],
              animationDurationInMs: 250,
              allowDragging: kidsTurn,
              canDragPiece: ({ piece }) => kidsTurn && piece.pieceType[0] === kidColor,
              onPieceDrop,
              onSquareClick,
              allowDrawingArrows: false,
              showNotation: true,
            }}
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={hint} disabled={!kidsTurn}
              className="rounded-full bg-chess-sky px-4 py-2 text-sm font-bold text-chess-text shadow-card hover:brightness-105 disabled:opacity-40">
              💡 Hint
            </button>
            <button onClick={takeback} disabled={busy || historyRef.current.length === 0}
              className="rounded-full bg-chess-sky px-4 py-2 text-sm font-bold text-chess-text shadow-card hover:brightness-105 disabled:opacity-40">
              ⏪ Oops, take it back
            </button>
            <button onClick={() => newGame(kidColor)}
              className="rounded-full bg-chess-red px-4 py-2 text-sm font-bold text-white shadow-card hover:brightness-110">
              🔄 New game
            </button>
            <button onClick={() => newGame(kidColor === "w" ? "b" : "w")} disabled={busy}
              className="rounded-full bg-white px-4 py-2 text-sm font-bold text-chess-text shadow-card ring-1 ring-chess-sand hover:brightness-105 disabled:opacity-40">
              {kidColor === "w" ? "⚫ Switch to Black" : "⚪ Switch to White"}
            </button>
          </div>

          {/* grandpa mood */}
          <div className="mt-4 rounded-2xl bg-white/90 p-3 shadow-card ring-1 ring-chess-sand/60">
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-chess-teal">ChessPaa&apos;s mood (how hard he tries)</p>
            <div className="flex flex-wrap gap-2">
              {MOODS.map((m, i) => (
                <button key={m.name} onClick={() => setLevel(i)} disabled={started && !gameOver}
                  title={started && !gameOver ? "Finish this game first!" : m.blurb}
                  className={`rounded-full px-3 py-1.5 text-sm font-bold shadow-sm transition ${
                    level === i ? "bg-chess-teal text-white scale-105" : "bg-chess-sky text-chess-text hover:brightness-105"
                  } disabled:opacity-50`}>
                  {m.emoji} {m.name}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-chess-teal">Words for</span>
              {(["little", "big"] as const).map((m) => (
                <button key={m} onClick={() => setAgeMode(m)}
                  className={`rounded-full px-3 py-1 text-xs font-bold shadow-sm ${
                    ageMode === m ? "bg-chess-yellow text-chess-text" : "bg-chess-sky text-chess-text/70"
                  }`}>
                  {m === "little" ? "🐣 Little kids" : "🚀 Big kids"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ------- ChessPaa column ------- */}
        <div className="lg:sticky lg:top-28">
          <ChessPaaBubble text={bubble} autoSpeak={false} mood={gameOver?.result === "win" ? "🥳" : "😊"} />

          <div ref={feedBox} className="mt-4 max-h-[26rem] space-y-3 overflow-y-auto pr-1">
            {feed.map((e) => (
              <div key={e.id} className={`chesspaa-pop rounded-2xl p-3 shadow-card ring-1 ring-chess-sand/60 ${
                e.kind === "kid" ? "bg-white" : "bg-chess-sky/70"
              }`}>
                {e.kind === "kid" && e.facts ? (
                  <>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded-full px-2 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: gradeMeta(e.facts.grade).color }}>
                        {gradeMeta(e.facts.grade).sticker} {gradeMeta(e.facts.grade).label}
                      </span>
                      <span className="text-xs font-bold text-chess-text/70">you played {e.san}</span>
                    </div>
                    <p className="text-sm leading-relaxed text-chess-text">{e.text}</p>
                    <div className="mt-2">
                      {e.why ? (
                        <p className="rounded-xl bg-chess-sky/60 p-2 text-sm leading-relaxed text-chess-text">
                          🧓 {e.why}
                        </p>
                      ) : (
                        <button onClick={() => askWhy(e)} disabled={e.whyLoading}
                          className="rounded-full bg-chess-yellow px-3 py-1 text-xs font-bold text-chess-text shadow-sm hover:brightness-105 disabled:opacity-60">
                          {e.whyLoading ? "🤔 ChessPaa is thinking…" : "🤔 Ask ChessPaa why"}
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-sm leading-relaxed text-chess-text">{e.text}</p>
                )}
              </div>
            ))}
            {feed.length === 0 && (
              <div className="rounded-2xl bg-white/80 p-4 text-sm text-chess-text/70 shadow-card ring-1 ring-chess-sand/50">
                Your moves will appear here with ChessPaa&apos;s coaching — every single one gets a comment. Make your first move!
              </div>
            )}
          </div>

          {gameOver && (
            <div className="chesspaa-pop mt-4 rounded-2xl bg-white p-4 text-center shadow-floating ring-2 ring-chess-yellow">
              <p className="text-lg font-extrabold text-chess-text">
                {gameOver.result === "win" ? "🏆 You beat ChessPaa!" : gameOver.result === "draw" ? "🤝 A friendly draw!" : "🌱 ChessPaa wins this one!"}
              </p>
              <p className="mt-1 text-sm text-chess-text/70">
                {gameOver.result === "win" ? "+5 tickets earned! Try a stronger mood next!" : "Every game makes you stronger. Ride again?"}
              </p>
              <button onClick={() => newGame(kidColor)} className="mt-3 rounded-full bg-chess-red px-5 py-2 font-bold text-white shadow-card hover:brightness-110">
                🔄 Play again
              </button>
            </div>
          )}

          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-white/70 p-3 text-xs text-chess-text/60 ring-1 ring-chess-sand/50">
            <Image src="/logo1.png" alt="" width={28} height={28} className="rounded-full" />
            ChessPaa&apos;s coaching is powered by a real chess engine (Stockfish) running right in your browser — he never makes up chess facts.
          </div>
        </div>
      </div>
    </div>
  );
}
