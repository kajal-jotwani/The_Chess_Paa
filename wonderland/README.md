# ChessPaa's Chess Wonderland

A 3D theme park where a grandfather — **ChessPaa** — teaches children chess.
Ride the Rating Roller-Coaster to every learning station, spin the Endgame
Ferris Wheel, fill the Puzzle Train with solved puzzles, drive the Rook Rover
into the pawn bowling pins, and play a real game where ChessPaa explains every
move you make.

```bash
cd wonderland
npm install
npm run dev        # → http://localhost:5173
```

`npm run build` type-checks and produces a static `dist/` you can host anywhere.

## What's inside

| Layer | Where | Notes |
|---|---|---|
| Models | `blender/*.py` → `public/models/*.glb` | Built headless in **Blender 5.2**: six Staunton pieces turned on a virtual lathe, the knight as a rounded silhouette sweep, piece-folk with faces and arms, ChessPaa (posable joints), two grandchildren. `blender --background --python blender/build_pieces.py` etc. |
| Textures / HDRI | `public/textures`, `public/hdr` | CC0 from [Poly Haven](https://polyhaven.com) via `tools/fetch_assets.py` (grass, sand, ash & walnut veneers, bark, castle brick, cobbles, a partly-cloudy sky). |
| Renderer | `src/core/Renderer.ts` | three.js, ACES tone mapping, PCF soft shadows, `postprocessing` (SMAA, bloom, vignette) + N8AO ambient occlusion. Three quality tiers with an adaptive governor; pixel ratio is capped so laptops stay cool. |
| Park | `src/world/*` | Blended grass/sand terrain with a lake, coaster (parallel-transport frames, banking, loop, chain-lift physics, stations), Ferris wheel, puzzle train, knight carousel, spire castle, big top, shops, gate, fountain, instanced trees/flowers/fences/hedges, clouds, balloons, birds, wandering piece-folk. |
| Physics | `src/world/Kart.ts` | cannon-es raycast vehicle + pawn bowling pins, beach balls, letter blocks and toppling giant pieces. Drive into any attraction to enter it. |
| Chess | `src/chess/*` | chess.js rules, Stockfish 18 (WASM worker), a 3D board with animated moves, and the **coach**: engine-graded verdicts + motif detection (hanging pieces, forks, missed mates, early queen…) told in ChessPaa's voice. |
| Modes | `src/modes/*` | Piece Academy (rhymes acted out on the board + try-it), Tactics Coaster (8 themed tracks), Endgame Ferris Wheel (with gondola rides every 3 solves), Puzzle Train (rush: 3 hearts, 5 minutes), Grand Match (5 strength levels), coaster tour, free driving. |
| Puzzles | `src/data/puzzles.json` | Curated from the CC0 [Lichess puzzle database](https://database.lichess.org/#puzzles) by `tools/curate_puzzles.py`; every puzzle replays through chess.js. |

Progress (stars, tickets, best rush) is stored in `localStorage` only. No accounts, no network calls while playing.

## Licences
three.js (MIT), chess.js (BSD-2), cannon-es (MIT), postprocessing (Zlib), N8AO (MIT), Stockfish (**GPLv3**), Poly Haven assets (CC0), Lichess puzzles (CC0).
