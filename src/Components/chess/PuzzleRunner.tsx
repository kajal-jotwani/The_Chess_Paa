"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import type { PieceDropHandlerArgs, SquareHandlerArgs, Arrow } from "react-chessboard";
import {
  BOARD_STYLE, DARK_SQ, LIGHT_SQ, SELECTED_STYLE, LEGAL_DOT, LEGAL_CAPTURE,
  LAST_MOVE, CHECK_SQ, HINT_SQ,
} from "@/lib/chess/boardTheme";
import { sfx } from "@/lib/sound";
import { fireConfetti } from "./Confetti";

export interface PuzzleData {
  id: string;
  fen: string;
  moves: string; // space-separated UCI; moves[0] is the opponent's setup move
  rating?: number;
  themes?: string;
}

export interface PuzzleResult {
  usedHint: boolean;
  wrongTries: number;
}

/**
 * Lichess-style puzzle player with a kid-friendly hint ladder.
 * The parent advances to the next puzzle by passing a new `puzzle`.
 */
export default function PuzzleRunner({
  puzzle,
  onSolved,
  onWrong,
  celebration = true,
  onProgress,
}: {
  puzzle: PuzzleData;
  onSolved: (r: PuzzleResult) => void;
  onWrong?: (wrongTries: number) => void;
  celebration?: boolean;
  onProgress?: (msg: { kind: "setup" | "reply" | "yourTurn" | "solved" | "wrong" }) => void;
}) {
  const solution = useMemo(() => puzzle.moves.split(" "), [puzzle.moves]);
  const setupChess = useMemo(() => new Chess(puzzle.fen), [puzzle.fen]);
  const playerColor: "w" | "b" = setupChess.turn() === "w" ? "b" : "w";

  const [fen, setFen] = useState(puzzle.fen);
  const [idx, setIdx] = useState(0); // next solution move index to play on the board
  const [selected, setSelected] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [hintStage, setHintStage] = useState(0);
  const [wrongTries, setWrongTries] = useState(0);
  const [usedHint, setUsedHint] = useState(false);
  const [solved, setSolved] = useState(false);
  const [shake, setShake] = useState(false);
  const [ready, setReady] = useState(false); // setup move played, player may move
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    timeouts.current.push(setTimeout(fn, ms));
  }, []);

  // reset when the puzzle changes
  useEffect(() => {
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
    setFen(puzzle.fen);
    setIdx(0);
    setSelected(null);
    setLastMove(null);
    setHintStage(0);
    setWrongTries(0);
    setUsedHint(false);
    setSolved(false);
    setReady(false);
    onProgress?.({ kind: "setup" });
    const t = setTimeout(() => {
      // play the opponent's setup move
      const c = new Chess(puzzle.fen);
      const m0 = solution[0];
      try {
        c.move({ from: m0.slice(0, 2) as Square, to: m0.slice(2, 4) as Square, promotion: m0[4] as "q" | undefined });
        setFen(c.fen());
        setLastMove([m0.slice(0, 2), m0.slice(2, 4)]);
        setIdx(1);
        setReady(true);
        sfx.move();
        onProgress?.({ kind: "yourTurn" });
      } catch {
        // malformed puzzle — should not happen (packs are pre-verified)
      }
    }, 650);
    timeouts.current.push(t);
    return () => { timeouts.current.forEach(clearTimeout); timeouts.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id, puzzle.fen, puzzle.moves]);

  const chess = useMemo(() => new Chess(fen), [fen]);

  const attempt = useCallback((from: string, to: string): boolean => {
    if (!ready || solved) return false;
    if (chess.turn() !== playerColor) return false;

    const expected = solution[idx];
    if (!expected) return false;
    const expectedPromo = expected.length > 4 ? expected[4] : undefined;

    // build the attempted move (auto-promote like the solution, else queen)
    const tryChess = new Chess(fen);
    let mv;
    try {
      mv = tryChess.move({
        from: from as Square,
        to: to as Square,
        promotion: (expectedPromo as "q" | "r" | "b" | "n" | undefined) ?? "q",
      });
    } catch {
      mv = null;
    }
    if (!mv) return false; // illegal — just ignore

    const attemptedUci = mv.from + mv.to + (mv.promotion ?? "");
    const isLastStep = idx === solution.length - 1;
    const matches = attemptedUci === expected;
    // Lichess rule: on the final step, any move that gives checkmate counts.
    const altMate = isLastStep && !matches && tryChess.isCheckmate();

    if (matches || altMate) {
      setFen(tryChess.fen());
      setLastMove([mv.from, mv.to]);
      setSelected(null);
      setHintStage(0);
      if (mv.captured) sfx.capture(); else sfx.move();
      if (tryChess.inCheck()) sfx.check();

      if (isLastStep || altMate) {
        setSolved(true);
        setReady(false);
        sfx.right();
        if (celebration) fireConfetti("small");
        onProgress?.({ kind: "solved" });
        later(() => onSolved({ usedHint, wrongTries }), 500);
      } else {
        // opponent's scripted reply
        later(() => {
          const c2 = new Chess(tryChess.fen());
          const reply = solution[idx + 1];
          try {
            const rm = c2.move({
              from: reply.slice(0, 2) as Square,
              to: reply.slice(2, 4) as Square,
              promotion: reply[4] as "q" | undefined,
            });
            setFen(c2.fen());
            setLastMove([reply.slice(0, 2), reply.slice(2, 4)]);
            setIdx(idx + 2);
            if (rm?.captured) sfx.capture(); else sfx.move();
            onProgress?.({ kind: "yourTurn" });
          } catch { /* verified packs — unreachable */ }
        }, 420);
        setIdx(idx + 1); // provisional; corrected in the reply timeout above
        onProgress?.({ kind: "reply" });
      }
      return true;
    }

    // Wrong (but legal) try — bounce it back kindly.
    setWrongTries((w) => w + 1);
    setShake(true);
    later(() => setShake(false), 450);
    sfx.wrong();
    onWrong?.(wrongTries + 1);
    onProgress?.({ kind: "wrong" });
    setSelected(null);
    return false;
  }, [ready, solved, chess, playerColor, solution, idx, fen, usedHint, wrongTries, onSolved, onWrong, onProgress, celebration, later]);

  const onSquareClick = useCallback(({ piece, square }: SquareHandlerArgs) => {
    if (!ready || solved) return;
    if (selected && square !== selected) {
      const legal = chess.moves({ square: selected as Square, verbose: true }).some((m) => m.to === square);
      if (legal) { attempt(selected, square); return; }
    }
    if (piece && piece.pieceType[0] === playerColor) {
      setSelected(square === selected ? null : square);
    } else {
      setSelected(null);
    }
  }, [ready, solved, selected, chess, playerColor, attempt]);

  const onPieceDrop = useCallback(({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
    if (!targetSquare) return false;
    return attempt(sourceSquare, targetSquare);
  }, [attempt]);

  // hint ladder: 1 = glow the piece to move, 2 = draw the full arrow
  const expected = solution[idx];
  const hint = useCallback(() => {
    if (!ready || solved || !expected) return;
    setUsedHint(true);
    setHintStage((h) => Math.min(2, h + 1));
  }, [ready, solved, expected]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (lastMove) { styles[lastMove[0]] = LAST_MOVE; styles[lastMove[1]] = { ...LAST_MOVE }; }
    if (chess.inCheck()) {
      const board = chess.board();
      for (const row of board) for (const sq of row) {
        if (sq && sq.type === "k" && sq.color === chess.turn()) styles[sq.square] = CHECK_SQ;
      }
    }
    if (selected) {
      styles[selected] = { ...(styles[selected] ?? {}), ...SELECTED_STYLE };
      for (const m of chess.moves({ square: selected as Square, verbose: true })) {
        styles[m.to] = { ...(styles[m.to] ?? {}), ...(m.captured ? LEGAL_CAPTURE : LEGAL_DOT) };
      }
    }
    if (hintStage >= 1 && expected) {
      styles[expected.slice(0, 2)] = { ...(styles[expected.slice(0, 2)] ?? {}), ...HINT_SQ };
    }
    return styles;
  }, [lastMove, chess, selected, hintStage, expected]);

  const arrows = useMemo<Arrow[]>(() => {
    if (hintStage >= 2 && expected) {
      return [{ startSquare: expected.slice(0, 2), endSquare: expected.slice(2, 4), color: "rgba(37,169,180,0.85)" }];
    }
    return [];
  }, [hintStage, expected]);

  const yourTurn = ready && !solved && chess.turn() === playerColor;

  return (
    <div className={shake ? "chesspaa-shake" : undefined}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold shadow-sm ${
          solved ? "bg-chess-yellow text-chess-text" : yourTurn ? "bg-chess-teal text-white" : "bg-white/80 text-chess-text"
        }`}>
          {solved ? "⭐ Solved!" : yourTurn ? (playerColor === "w" ? "⚪ Your move — you're White!" : "⚫ Your move — you're Black!") : "👀 Watch closely…"}
        </span>
        <button
          type="button"
          onClick={hint}
          disabled={!yourTurn}
          className="rounded-full bg-chess-sky px-3 py-1 text-xs font-bold text-chess-text shadow-sm hover:brightness-105 disabled:opacity-40"
        >
          💡 {hintStage === 0 ? "Hint" : hintStage === 1 ? "Bigger hint" : "Hint shown"}
        </button>
      </div>
      <Chessboard
        options={{
          id: `puzzle-${puzzle.id}`,
          position: fen,
          boardOrientation: playerColor === "w" ? "white" : "black",
          boardStyle: BOARD_STYLE,
          darkSquareStyle: DARK_SQ,
          lightSquareStyle: LIGHT_SQ,
          squareStyles,
          arrows,
          animationDurationInMs: 250,
          allowDragging: yourTurn,
          canDragPiece: ({ piece }) => yourTurn && piece.pieceType[0] === playerColor,
          onPieceDrop,
          onSquareClick,
          allowDrawingArrows: false,
          showNotation: true,
        }}
      />
    </div>
  );
}
