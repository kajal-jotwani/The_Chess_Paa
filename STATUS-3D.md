# ChessPaa's Wonderland — 3D build status

Written against the build bible's own standard: *"Track the bar honestly. If the
tutor is at seventy percent, say so, and say why."* Every claim below was
checked against the code or against a captured frame.

## Run it

```bash
npm install      # adds three, @react-three/fiber, drei, postprocessing
npm run dev      # → http://localhost:3000/park
```

`npx next build` passes. `npx tsc --noEmit` is clean across ~35,000 lines.
Offline-capable: the webfont dependency was removed, so nothing is fetched.

The **2D park from the previous session still works and is still playable** at
`/`, `/play`, `/pieces`, `/adventure/*`. The 3D world lives at `/park`. They do
not yet share a front door.

---

## BUILT, VERIFIED IN A FRAME

**The cel pipeline.** Hand-authored toon ramps sampled through `NearestFilter`;
a warm fresnel rim on every character and piece so pale never dissolves into
pale; two cooperating line systems (inverted-hull silhouettes + a screen-space
Sobel over a normal/depth prepass for interior creases); quantised banded fog;
a colour-grading LUT generated in code. Committed palette throughout.

**Everything generated in code — no exceptions.** Every mesh is procedural
`BufferGeometry`. Every texture is canvas-2D or shader noise (wood grain, snow
with wind-carved ripples and glitter, ice with cracks, parchment, stripes, the
board). Every sound is Web Audio. The LUT is code. **Even the gate's
hand-lettered "ChessPaa's Wonderland" sign and the painted valley map board are
drawn stroke-by-stroke in code** — there is not one font file or image asset.

**The world.** A cupped valley with a carved channel holding a frozen river;
620 pines that refuse to stand on steep ground; a coaster spine with rails,
sleepers and trestles that crosses the river on a bridge; lanterns as real
practical lights; bunting, fairy-lights, trodden walkways, carved signposts.

**The five attraction structures.** Endgame Ferris Wheel (turning, gondolas
counter-rotated upright — the park's skyline icon), the Grand Match big top
with a scalloped valance and interior glow, a plaza carousel, the Puzzle Train
station with engine and carriages, the Piece Parade canopy, the Tactics
station. Plus the painted gate, ticket kiosk and map board.

**ChessPaa himself.** ~1,400 lines of rig: critically-damped springs, verlet
chains for beard and scarf with cone limits, two-bone IK that never locks, a
lantern pendulum on a gimbal, a breathing idle, breath fog in the cold. He
renders, he reads as a warm grandfather, and his lantern pools light on snow.

**Also built:** the grandchildren, pieces-as-characters, wandering piece-folk,
crows, drifting snow-glitter, a slow dusk drift, 12 camera rigs, and a
Playwright screenshot harness that poses cameras deterministically.

Measured budget: **~400–900 draw calls, ~1.0–1.3M triangles** per frame across
both passes, depending on the rig.

---

## BUILT AND TYPE-CLEAN, BUT NOT YET WIRED INTO THE EXPERIENCE

These are complete modules with documented APIs that nothing currently mounts.
This is the single biggest gap between what exists and what a child could play.

| Module | State |
|---|---|
| `three/board/Board3D.tsx` | 3D board, drag + tap, legal dots, promotion picker. Not mounted in any scene. |
| `lib/chess/tutorEngine.ts` + `motifs.ts` + `levels.ts` + `voiceLibrary.ts` | The Living Tutor. Not connected to a board. |
| `lib/audio/*` (5 modules) | Whole soundscape, synthesised. Never initialised. |
| `three/ui/*` + `lib/a11y.ts` | HUD, speech card, storybook skin, fold-out map, TTS. Not rendered. |
| `three/cameras/cinematic.ts`, `slowmo.ts` | Rigs and slow-motion. No key binding; **no depth-of-field pass exists**, so their focus/bokeh outputs have no consumer. |
| `three/world/RideController.tsx`, `CoasterCar.tsx` | The on-rails ride with the crest choreography. Not driving the camera. |
| `three/core/perf.ts`, `lod.ts`, `instancing.ts` | Perf governor and LOD. Not installed in `Stage.tsx`. |

## NOT DONE

- **The five attractions are scenery, not rides.** You can see them; you cannot
  ride them. There is no ride loop, no puzzle gating, no gondola lesson.
- **ChessPaa's moods are a prop nothing drives.** Five of his six moods, his
  pointing IK and his belly chuckle are dead code today. His mouth animates to
  a private metronome with **no link to the audio** — no lip-sync, no visemes.
- **60fps is unverified.** The harness renders through SwiftShader, which
  cannot measure it. Draw-call and triangle counts are healthy; frame time on
  real hardware is unmeasured.
- One stretch of valley rim still reads as a cliff in the crest shot.

## Verified independently (not taken on an agent's word)

- All six piece rhymes are the bible text **verbatim**.
- All 48 rhyme demo FENs load in chess.js; all 26 demo/try-it moves are legal;
  all 256 highlight squares are real squares. **0 defects.**
- The 1,060 curated Lichess puzzles replay cleanly through chess.js.

## Licensing

Stockfish is **GPLv3**. chess.js BSD-2, react-chessboard MIT, three.js MIT,
Lichess puzzles CC0.
