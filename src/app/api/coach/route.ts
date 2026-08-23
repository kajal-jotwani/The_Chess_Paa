import { NextRequest, NextResponse } from "next/server";

/**
 * "Ask ChessPaa why 🤔" — the deep-explanation endpoint.
 *
 * Hybrid design: if ANTHROPIC_API_KEY is set, a small Claude model rewrites
 * the ENGINE'S findings in ChessPaa's voice (it may only rephrase the facts
 * we pass in — never invent chess claims). Without a key, a built-in
 * "storybook" composer produces a solid explanation from the same facts,
 * fully offline. Either way, Stockfish remains the source of truth.
 */

interface CoachRequest {
  playedSan: string;
  bestSan: string;
  grade: string;
  lossPawns: number;
  kidScoreAfterPawns: number;
  patterns: string[];
  missedMateIn?: number;
  mateForKidIn?: number;
  mateAgainstKidIn?: number;
  hangs?: { piece: string; square: string; capturedBy: string };
  missedCapture?: { piece: string; square: string };
  fork?: { from: string; targets: string[] };
  fenBefore: string;
  ageMode?: "little" | "big";
}

function storybookExplanation(f: CoachRequest): string {
  const bits: string[] = [];
  const gentle = f.ageMode !== "big";

  if (f.grade === "sparkle" || f.grade === "great") {
    bits.push(
      `${f.playedSan} was a strong choice. The computer inside my megaphone agrees with you!`
    );
    if (f.mateForKidIn)
      bits.push(`Even better: you now have a forced checkmate in ${f.mateForKidIn}. Keep asking "can I check the king?" each turn and you'll find it.`);
    if (f.patterns.includes("castled"))
      bits.push(`Castling tucks your king behind a wall of pawns and wakes up your rook — two good deeds in one move.`);
    return bits.join(" ");
  }

  bits.push(
    `Here's what my magnifying glass sees. You played ${f.playedSan}, but ${f.bestSan} was stronger.`
  );

  if (f.missedMateIn) {
    bits.push(
      `The big secret: ${f.bestSan} starts a checkmate in ${f.missedMateIn}! When you feel the enemy king is stuck, pause and hunt for checks first — checks are the loudest moves on the board.`
    );
  }
  if (f.missedCapture) {
    bits.push(
      `There was a free ${f.missedCapture.piece} sitting on ${f.missedCapture.square}. Before each move, do grandpa's checklist: checks, captures, threats — in that order.`
    );
  }
  if (f.fork) {
    bits.push(
      `${f.bestSan} would have made a fork from ${f.fork.from} — one piece attacking two targets (${f.fork.targets.join(" and ")}). Two attacked, only one can run away!`
    );
  }
  if (f.hangs) {
    bits.push(
      `After ${f.playedSan}, your ${f.hangs.piece} on ${f.hangs.square} can be captured by their ${f.hangs.capturedBy} — and no friend of yours is guarding that square. Before you let go of a piece, ask: "who protects it there?"`
    );
  }
  if (f.mateAgainstKidIn) {
    bits.push(
      `Extra careful now: the other side threatens checkmate in ${f.mateAgainstKidIn}, so the very next job is defending your king.`
    );
  }
  if (bits.length === 1) {
    bits.push(
      f.lossPawns >= 1
        ? `The move gives away about ${Math.round(f.lossPawns)} pawn${Math.round(f.lossPawns) === 1 ? "" : "s"} of goodness. ${f.bestSan} keeps your pieces working as a team — pieces are happiest when they defend each other.`
        : `The difference is small — this one is more about habit than danger. ${f.bestSan} follows the golden rules: control the middle, keep pieces protected, keep the king safe.`
    );
  }
  if (gentle) bits.push(`You're doing wonderfully. Mistakes are just the park map showing us where to ride next!`);
  return bits.join(" ");
}

export async function POST(req: NextRequest) {
  let body: CoachRequest;
  try {
    body = (await req.json()) as CoachRequest;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const book = storybookExplanation(body);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json({ text: book, source: "storybook" });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.CHESSPAA_COACH_MODEL || "claude-haiku-4-5",
        max_tokens: 260,
        system:
          "You are ChessPaa, a warm, funny chess grandfather teaching a child in his chess theme park. " +
          "You will receive VERIFIED ENGINE FACTS about one move. Explain the move to the child using ONLY those facts. " +
          "Never invent chess analysis, never contradict the facts, never mention engines or evaluations in numbers of centipawns. " +
          "2-4 short sentences, playful and encouraging, simple words" +
          (body.ageMode === "big" ? " (child is 8-11, a bit more chess vocabulary is fine)." : " (child is 5-7, very simple words)."),
        messages: [
          {
            role: "user",
            content:
              "ENGINE FACTS (the only truth you may use):\n" +
              JSON.stringify(body, null, 2) +
              "\n\nExplain to the child why their move was good or not, and what the better idea was.",
          },
        ],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((c) => c.type === "text")?.text?.trim();
    if (!text) throw new Error("empty");
    return NextResponse.json({ text, source: "ai" });
  } catch {
    // Any AI hiccup falls back to the storybook — the child always gets an answer.
    return NextResponse.json({ text: book, source: "storybook" });
  }
}
