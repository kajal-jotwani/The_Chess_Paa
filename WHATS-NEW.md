# 🎡 Welcome to ChessPaa's Wonderland — What Just Got Built

The landing page grew into a full theme park. Here's the tour, how to run it,
and where everything lives.

## Run it

```bash
npm install     # picks up 3 new deps: chess.js, react-chessboard, stockfish
npm run dev     # → http://localhost:3000
```

No database or API key is needed for any of the chess features — everything
runs in the browser. (Auth/Prisma still work exactly as before for sign-in.)

## The park map is the app now

The home page is a hand-drawn, animated SVG wonderland — the Ferris wheel
turns, the coaster car rides the actual track, the train chugs, flags wave.
**Every attraction is a button:**

| Attraction | Route | What happens there |
|---|---|---|
| ♟️ ChessPaa's gazebo | `/play` | Real game vs ChessPaa — he comments on EVERY move you make |
| 🏰 Castle | `/pieces` | Each piece: your Suno song, sing-along rhyme, star game |
| 🎢 Coaster | `/adventure/tactics` | 7 themed puzzle tracks (mate in 1, forks, pins…) |
| 🚂 Train | `/adventure/puzzles` | Puzzle rush: 3 lives, escalating difficulty, carriage per solve |
| 🎡 Ferris wheel | `/adventure/endgames` | 4 scripted "finish the win" cabins + endgame puzzle wheels |
| 🎠 Carousel | `/adventure/openings` | 4 guided openings, move by move, both sides |

## How ChessPaa's brain works (the important part)

1. **Stockfish 18** (WASM, in a web worker, from `/public/stockfish/`) supplies
   the truth: best move + evaluation before and after every kid move.
2. `src/lib/chess/coach.ts` grades the move (🌟 sparkle → 🙈 banana peel) and
   detects patterns with chess.js: hung pieces, missed mates, missed forks,
   castling, early queen, promotions…
3. `src/lib/chess/phrases.ts` wraps those facts in ChessPaa's voice.
4. **"Ask ChessPaa why 🤔"** calls `/api/coach`:
   - No `ANTHROPIC_API_KEY` in `.env.local` → built-in "storybook" explanation
     composed from the engine facts (fully offline, always works).
   - Key present → a small Claude model rewrites the same facts more richly.
     It is instructed to ONLY use the engine facts — it can never invent chess.

ChessPaa never makes up chess claims. The engine finds, ChessPaa explains.

## Songs

Your Suno tracks were copied to `public/music/` (pawn, rook, knight ×2, king).
**Bishop and Queen songs are still missing** — generate them with the same
style prompt and drop them in as `public/music/bishop.mp3` / `queen.mp3`,
then set `song: "/music/bishop.mp3"` in `src/lib/data/pieces.ts`.

## Puzzles — real, free, open

~1,000 curated kid-friendly puzzles in `src/lib/data/puzzles/*.json`, filtered
from the **Lichess open puzzle database (CC0)** — popular, low-rated, verified
solvable (every one replayed with chess.js before shipping). Buckets: 7 tactic
themes, 5 difficulty bands for the train, endgame mates + skills for the wheel.

## Little details worth knowing

- 🔊 ChessPaa can **speak** every comment (browser text-to-speech, toggle in
  his bubble). Move/capture/win sounds are synthesized — no audio files.
- 🎟 Tickets & ⭐ stars are saved in `localStorage` (`src/lib/progress.ts`) —
  the ticket booth on the park map shows the total. (Future: sync to Prisma.)
- 😄 The eval bar is a "Who's smiling?" meter — no scary numbers.
- Grandpa difficulty = 5 moods (Teddy 🧸 → Champ 🏆) using Stockfish skill
  levels plus deliberate wobble at low levels so little kids can win.
- Everything respects `prefers-reduced-motion`.

## Licenses to know about

- **Stockfish is GPLv3** — fine for a personal/open project; if you ever
  distribute this commercially, the GPL applies to the bundled engine.
- Lichess puzzles: **CC0** (no attribution required, we credit them anyway).
- chess.js (BSD-2), react-chessboard (MIT).

Have fun at the park! 🎪
— Built with ChessPaa's favorite helper
