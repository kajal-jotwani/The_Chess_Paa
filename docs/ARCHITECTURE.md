# Architecture

How ChessPaa's Wonderland is put together: the module map, the render pipeline in the order
it actually runs, the layer convention that keeps the ink off the fireflies, and the path a
child's move takes from their finger to ChessPaa's mouth.

Everything below names real files and real exported symbols. Where something is written but
not yet wired up, it says so — see the Status section of the [README](../README.md) for the
full ledger.

---

## 1 · Module map

```
src/
├── app/                  Next.js routes. /park is the 3D stage; the rest is the legacy 2D game.
├── three/
│   ├── Stage.tsx         Canvas, cameras, prepass, post chain. The top of the 3D world.
│   ├── harnessBridge.ts  window.__park — deterministic camera posing for the harness.
│   ├── core/             The vocabulary everything else speaks.
│   ├── world/            The valley and everything standing in it.
│   ├── characters/       ChessPaa, the grandchildren, the pieces-as-people.
│   ├── board/            The 3D chess board and its interaction model.
│   ├── cameras/          Lens maths, free look, slow motion.
│   ├── ui/               HUD, speech cards, storybook chrome.   (written; not mounted)
│   └── attractions/      (empty — the rides as playable places)
└── lib/
    ├── chess/            Rules, engine, motifs, tutor, voice.
    ├── data/             Puzzles, openings, piece facts, endgame cabins.
    ├── audio/            Synth, soundscape, adaptive score, voice.  (written; not imported)
    ├── a11y.ts           The accessibility surface behind three/ui.
    ├── sound.ts          What actually plays today: 8 WebAudio blips + browser TTS.
    └── progress.ts       localStorage tickets and stars.
```

Directories marked *written; not mounted* contain complete, type-clean modules that no
rendered frame reaches yet. The README's Status section is the authoritative ledger, and it
goes stale fast — confirm with `grep -rn "from .*<module>" src` before relying on either.

### `three/core` — the vocabulary

Nothing in `core` knows about the park. It knows about colour, light, ink and budget.

| File | Exports | What it is |
|---|---|---|
| `palette.ts` | `PALETTE`, `css()`, `mix()`, `towardShadow()`, `towardLight()` | The 28 committed colours as hex ints. Every colour in the park comes from here. |
| `toonRamp.ts` | `getToonRamp(kind)`, `buildWarmLUT(size)`, `SKY`, `RampKind` | Six band-stop gradients baked into 32×1 `NearestFilter` `DataTexture`s, and the code-generated 16³ colour grade. |
| `materials/ToonMaterial.ts` | `createToonMaterial(opts)`, `createFlatMaterial()`, `tickToonMaterial()` | The park's one lit material: `MeshToonMaterial` + an `onBeforeCompile` patch adding the warm fresnel rim and the coloured shadow bounce. |
| `materials/OutlineMaterial.ts` | `addOutline(mesh, {thickness})`, `createOutlineMaterial()`, `smoothNormalsForOutline(geo)` | Inverted-hull silhouettes in warm ink, at constant screen width. |
| `materials/SkyMaterial.ts` | `createSkyMaterial()`, `createCloudMaterial()`, `patchMaterialForBandedFog(mat, bands)`, `BANDED_FOG_BANDS` | The painted dome, the hard-edged cel clouds, and the fog quantiser. |
| `postfx/effects.ts` | `SobelInkEffect`, `WarmLUTEffect`, `createNormalDepthMaterial()`, **`NO_INK_LAYER`** | The interior-line pass, the grade, and the prepass material. |
| `textures/procedural.ts` | `rng(seed)`, `woodTexture`, `snowTexture`, `iceTexture`, `parchmentTexture`, `stripeTexture`, `glowSprite`, `boardTexture`, `disposeTextureCache()` | Everything painted with canvas2D, cached by key. |
| `geometry/pieces.ts` | `pieceGeometry(type, quality)`, `pieceHeight(type)`, `ALL_PIECES`, `PieceType` | Lathe-turned chess pieces from hand-authored profiles. Base sits at `y = 0`; a pawn is ~1.0 tall, a king ~1.75. |
| `instancing.ts` | `buildInstanced()`, `packVisible()`, `getPacker()`, `updateInstances()`, … | Instanced-crowd plumbing with per-frame visibility packing. |
| `lod.ts` | `LodGroup`, `HysteresisLOD`, `makeLodMesh()`, `setGlobalLodBias()`, `snapLods()` | Distance tiers with hysteresis so a mesh at a threshold does not flicker between levels. *(Read only by `perf.ts`, which imports `setGlobalLodBias`. No mesh in the park is an `HysteresisLOD` yet.)* |
| `perf.ts` | `QUALITY_LADDER`, `PerfGovernor`, `applyQuality()`, `estimateDeviceTier()`, `createPerfOverlay()` | Four rungs — `low`/`medium`/`high`/`ultra` — each fixing pixel ratio, shadow map size, particle scale, bloom levels, LOD bias, crowd budget and anisotropy. **`celPipeline: true` at every rung**: quality drops resolution and crowd, never the look. |

**`rng(seed)` is not optional.** It is a 32-bit LCG returning `() => 0..1`. Nothing in the
park may call `Math.random()` at build time. The reason is the harness: a park that reshuffles
itself each run makes a regression indistinguishable from a coin flip.

*One known violation, recorded so it gets fixed rather than copied:* `Atmosphere` in
`world/Sky.tsx` seeds its motes with `Math.random()`. It is mounted.

### `three/world` — the valley

- **`terrain.ts`** — `terrainHeight(x, z)` is the ground truth for placement; *always* use it
  or the prop floats. `riverDistance()`, `groundAt()`, `isOnIce()`, `VALLEY`, `RIVER_POINTS`,
  `riverCurve`, the builders `buildTerrainGeometry` / `buildIceGeometry` / `buildSnowBanks`,
  and the shared `mergeGeometries(list)` that most of the repo imports from here.
- **`coasterSpine.ts`** — `ATTRACTIONS` (gate · plaza · parade · ferris · coaster · train as
  `Vector3`), `SPINE_CURVE`, `STOP_T`, `frameAt(t)` → `{pos, tangent, normal, binormal}`
  (banked and stable — it never flips), `stopFrame(name)`, and the rail/sleeper/support
  builders.
- **`props.ts`** — the pine wall (`buildForest`, 620 trees plus a flat far band), lanterns,
  bunting runs, fairy-light positions, the plaza disc.
- **`paths.ts`** — authored walkway ribbons and signposts. Composition beats convenience:
  the five routes are hand-written, not generated, because a child should always be able to
  *see* where the next thing is.
- **`Sky.tsx`** — `SkyDome`, `CelClouds`, `Atmosphere`.
- **`Landmarks.tsx`** — the fair. Builders return *bags* of `BufferGeometry` keyed by
  `MatKey`; `absorb()` merges bags and `bake()` collapses each key into one geometry, so six
  attractions cost roughly one draw call per material rather than one per object.
  `landmarks.ts` is a deliberate re-export facade — the two filenames differ only in case,
  and on a case-insensitive filesystem the component would otherwise import itself. The
  reasoning is written at the top of that file.
- **`ParkLife.tsx`** + **`parkLifeData.ts`** — ambient life. Two rules hold it together:
  it is deterministic, and **pose is a pure function of time** — nothing integrates, nothing
  accumulates. Ask where a wanderer is at `t = 812.4s` and you get the same answer whether
  the tab was backgrounded for ten minutes or not. *(Written; not mounted.)*
- **`Park.tsx`** — assembles all of the above plus the lighting rig. Owns the scene graph.
- **`Gate.tsx`/`gateGeometry.ts`**, **`RideController.tsx`/`CoasterCar.tsx`** — *(written;
  not mounted.)*

### `three/characters`

- **`chessPaaRig.ts`** — the animation maths, deliberately kept free of three.js scene
  objects: `Spring`, `SpringVec3`, `VerletChain` (beard, scarf, coat hem), `Pendulum` (the
  lantern), `solveTwoBoneIK()`, `omegaFromHalfLife()`, `fbmSin()`, `easeOutBack()`,
  `CHESSPAA_SKELETON`, `createChessPaaRig(seed)`, `parkWind(t)`.
- **`ChessPaa.tsx`** — the grandfather, plus the plush geometry vocabulary the whole family
  shares: `plushCapsule`, `blob`, `lathe`, `strut`, `paunch`, `waveHem`, `toonPart`,
  `plushMaterial`, `smoothed`, `buildBreath`.
- **`Grandchildren.tsx`** — two riders built from that same vocabulary, so the three of them
  read as carved by one hand. Reactions: `idle` · `lean` · `clap` · `gasp`.
- **`PieceCharacters.tsx`** — two ways out: `<PieceCharacter>` for a hero piece with live
  eyes, blinks and sparkles (~8 draw calls), and `facedPieceGeometry(type, tone)` which
  **bakes the eyes in as vertex colours** so thirty-two pieces on a board stay one mesh each.

### `three/board`

- **`boardInteraction.ts`** — pure, testable, zero three.js. Square ↔ world-position maths,
  `pickup()`, `isLegalMove()`, `needsPromotion()`, `moveFlavour()`, `checkedKingSquare()`,
  `snapToTarget()`, `diffPlacement()` (which piece moved where, for the animation), and the
  `CELL` highlight codes. **Every legality question in the 3D world goes through this file,
  and this file asks chess.js.**
- **`Board3D.tsx`** — presentation and interaction only. It never calls an engine, never
  calls the tutor, and never invents a move; it emits `onMove(from, to, promotion)` only for
  moves chess.js has already accepted.

### `three/cameras` — *(written; not wired to `Stage.tsx`)*

`cinematic.ts` (real lens maths — `focalToFov`, `hyperfocalM`, `bokehScaleFor`, named cine
rigs), `freeLook.ts` (`FreeLookController`), `slowmo.ts` (a `SlowMo` swell for brilliancies
and checkmates, with bloom and exposure gains).

### `lib/chess`

| File | Role |
|---|---|
| `engine.ts` | `EngineClient` — a queue-based UCI client for the Stockfish WASM worker. `getEngine()` returns the shared one. `Score` is `{type:"cp"|"mate", value}`; `scoreToCp()` flattens it for comparison. |
| `motifs.ts` | Board-level sight. Forks, pins, skewers, discovered attacks, hanging pieces, back-rank, `findMateInOne()`, and a real static exchange evaluation in `seeCapture()`. Motifs carry **confidence**. |
| `levels.ts` | The learner. `AgeBand` (`little`/`middle`/`big`), `Tier` (`careful` → `brilliant`), `LearnerProfile` with per-concept familiarity, `noteMove()`, `voiceSettings()`, `recommendedEngineLevel()`. Persisted to `localStorage`. |
| `voiceLibrary.ts` | ~1,600 lines of ChessPaa's actual words, banked per lesson per age band, with recency memory so he does not repeat himself. The five tier labels top out at `careful`; "blunder", "mistake", "wrong" and "bad" appear nowhere in the file. |
| `tutorEngine.ts` | The Living Tutor. Assembles everything into one `TutorResponse`. |
| `coach.ts` / `phrases.ts` | The older, shallower path the 2D pages use: `analyzeKidMove()` → `CoachFacts` → `chessPaaSays()`. |

---

## 2 · The render pipeline, in order

Owned by `src/three/Stage.tsx`. The order is deliberate and load-bearing.

```
                 ┌──────────────────────────────────────────────┐
   per frame ──► │ 0. FrameCounters        gl.info.reset()       │  priority −1
                 ├──────────────────────────────────────────────┤
                 │ 1. NORMAL + DEPTH PREPASS                    │  priority 0
                 │    camera.layers.disable(NO_INK_LAYER)       │
                 │    scene.overrideMaterial = normalDepthMat   │
                 │    → rt.texture:  rgb = world normal         │
                 │                     a = linear view depth    │
                 ├──────────────────────────────────────────────┤
                 │ 2. SCENE RENDER (the composer's own pass)    │  priority 1
                 │    toon ramps · fresnel rim · banded fog     │
                 │    · inverted-hull outlines · sky · glows    │
                 ├──────────────────────────────────────────────┤
                 │ 3. SOBEL INTERIOR INK    reads rt from (1)   │
                 │ 4. BLOOM                 restrained          │
                 │ 5. VIGNETTE                                  │
                 │ 6. WARM LUT              always last         │
                 ├──────────────────────────────────────────────┤
                 │ 7. AdaptiveQuality      samples gl.info      │  priority 2
                 └──────────────────────────────────────────────┘
```

**0 · Frame counters.** `gl.info.autoReset = false` is set in `onCreated`, and a
`useFrame(…, -1)` zeroes the counters once before anything draws. Without this the
composer's internal passes clobber the counts and every performance report says "1 draw".

**1 · Normal + depth prepass.** `createNormalDepthMaterial()` renders world-space normals
into `rgb` and linear view depth into `a`, into a full-size `WebGLRenderTarget` resized with
the canvas. The background is cleared to `0x8080ff` — a flat forward-facing normal at far
depth — so empty sky produces no gradient and therefore no edges. The camera's
`layers.mask` is saved and restored around the pass.

*Known wrinkle:* the prepass linearises against `uNear = 0.1`, `uFar = 400` while the camera's
far plane is 600. Anything past 400 clamps to `1.0` in the alpha channel. Benign in practice —
the Sobel's own distance falloff kills interior ink at 0.80 of that range — but the two numbers
should be made to agree.

**2 · Scene.** Everything lit runs `createToonMaterial()`; everything lit is also passed
through `patchMaterialForBandedFog()`. Silhouette outlines are inverted hulls added as
*children* of their mesh, so they inherit every transform for free.

**3 · Sobel interior ink.** A 3×3 Sobel over the prepass target. Tuned at
`normalStrength: 0.95`, `depthStrength: 0.30`, `threshold: 0.44`, `falloff: 0.80`. The
normal term is dominant on purpose: creases and folds live in the normal gradient, and depth
edges are exactly what the inverted hull has already drawn. See
[ART_DIRECTION.md](ART_DIRECTION.md#the-two-line-systems) for why the two systems are tuned
against each other rather than stacked.

**4 · Bloom.** `intensity 0.62`, `luminanceThreshold 0.72`, `luminanceSmoothing 0.28`,
`mipmapBlur`, `radius 0.62`. A halo on lantern cores and the low sun, and nothing else — a
hazy wash would eat the crisp toon bands the ramps work so hard to produce.

**5 · Vignette.** `offset 0.30`, `darkness 0.42`.

**6 · The warm LUT, always last.** `WarmLUTEffect(buildWarmLUT(16), 0.62)`. It is what makes
the gate, the crest and the board feel like pages of one book. Anything inserted after it
would sit outside the grade and look pasted on.

### Renderer settings that matter

Set once in `Stage.tsx`'s `onCreated`:

- **`toneMapping = NeutralToneMapping`, not ACES.** Filmic tone mapping desaturates and
  rolls off exactly the flat, saturated bands the toon ramp exists to produce. This is a
  deliberate reversal of the usual default.
- **`antialias: false`.** The cel pipeline supplies its own edges; MSAA would soften them and
  cost fill rate for the privilege. The composer runs `multisampling={0}` for the same reason.
- `outputColorSpace = SRGBColorSpace`, `shadowMap.type = PCFShadowMap`, `dpr={[1, 2]}`.
- `scene.fog = new THREE.Fog(PALETTE.fogNear, 96, 340)`; background `PALETTE.skyHorizon`.

**Adaptive pixel ratio** (`AdaptiveQuality`) samples FPS over 0.5s windows and steps
`setPixelRatio` down toward 0.75 below 52fps, back up toward the device maximum above 58fps,
with a cooldown so it cannot oscillate. Resolution is the first thing to go and the look is
the last — the same principle `QUALITY_LADDER` encodes.

---

## 3 · The layer convention

```ts
import { NO_INK_LAYER } from "@/three/core/postfx/effects";  // === 2
```

**Layer 2 is the no-ink layer, and it is not a style choice — it is a bug fix.**

The Sobel pass finds edges in the *normal buffer*. A particle, a glow sprite, an additively
blended point or a billboard has a normal that bears no relation to its silhouette. Ink it and
the filter finds a discontinuity across the whole quad and fills it with warm ink — a firefly
becomes a **black square**. This happened. It was fixed by excluding those objects from the
prepass entirely, which is what layer 2 does.

The contract has exactly two halves:

- The **main camera enables** layer 2 (`CameraRig`'s `useEffect`), so it draws everything.
- The **prepass disables** it before rendering, so those objects contribute no normals and no
  depth, and the Sobel can never find an edge on them.

**Everything on this list must be on layer 2:** particles, glows, sprites, additive points,
billboards, the sky dome, the cel clouds, atmosphere motes, lantern glass, sparkles, steam.

Two ways to put an object there, both meaning *replace the mask*, not add to it:

```ts
// imperative — Park.tsx's fairy lights
pts.layers.set(NO_INK_LAYER);

// declarative in JSX — R3F cannot call .set(), so set the mask directly
<mesh geometry={glassGeo} material={glassMat} layers-mask={1 << NO_INK_LAYER} />
```

Outlines are handled separately: `addOutline()` names its mesh `__outline`, disables shadow
casting and receiving on it (it is ink, not matter), and gives it `renderOrder - 1`. The
harness's `debug()` skips anything named `__outline` so outline meshes never pollute a scene
listing.

---

## 4 · The chess and tutor data flow

### The rule that makes everything else safe

> **The engine finds. ChessPaa explains. ChessPaa never invents a chess fact.**

Every warm sentence in the park is downstream of something chess.js or Stockfish actually
reported. The warmth is added on top of the truth; it never replaces it.

### The path a move takes

```
  finger / mouse
        │
        ▼
  Board3D.tsx ──────────► boardInteraction.ts ──────────► chess.js
  (presentation only)      pickup / isLegalMove /          (the only rules authority)
        │                  needsPromotion / snapToTarget
        │  onMove(from, to, promotion)   ← emitted ONLY for moves chess.js accepted
        ▼
  the game loop  (── this connection is the piece that is not built yet ──)
        │
        ▼
  tutorEngine.tutorMove({ fenBefore, playedUci, kidColor, engine, profile, budgetMs })
        │
        ├─► engine.ts ──► Stockfish 18 WASM worker      bestMove + eval, before and after
        │        (raced against budgetMs — see "never stall" below)
        │
        ├─► motifs.ts   detectMotifs / scanPosition / seeCapture / findMateInOne
        │               → Motif[] with confidence scores
        │
        ├─► levels.ts   the child: age band, familiarity per concept, recency
        │
        └─► voiceLibrary.ts  the words, chosen for this band and not used lately
                │
                ▼
        TutorResponse {
          tier, tierLabel, sticker,     ← how he feels: five warm words, no cold ones
          say,                          ← the ONE sentence. Not three. One.
          lesson, motif,
          pointers { highlightSquares, arrow },
          hints    { invitation, steps[] },   ← a ladder: nudge → highlight → show
          takeback,                     ← offered, never imposed
          mood,                         ← drives the character rig's face
          facts, profile, elapsedMs
        }
```

`pointers.highlightSquares` is deliberately typed as `Record<string, "hint"|"danger"|"good">`
— **the same three words `Board3D`'s `highlight` prop already speaks**, so a caller can pass
the tutor's output straight into the board with no translation layer between them.

### The three rules the tutor is built around

Written at the top of `tutorEngine.ts`, and they explain most of its structure:

1. **Never stall.** Every engine call races `budgetMs` (default 1100ms). If Stockfish is slow,
   the board scan alone still produces a warm, true, useful sentence, and the abandoned engine
   job quietly fills the cache for next time. `facts.engineUsed` records which happened. A
   grandpa who goes silent for two seconds after every move is worse than one who is
   occasionally less precise.
2. **Never scold.** Tier thresholds are tuned kinder than a correct engine would tune them.
   Where the engine and kindness disagree about the *label*, kindness wins; where they
   disagree about the *fact*, the engine wins and the fact gets said gently.
3. **Never cry wolf.** A false "that's a fork!" costs more trust than ten missed ones. Motifs
   carry confidence, and when the engine says the move was fine, board-level "threats" are
   suppressed — a piece that *looks* hanging in a position the engine likes is nearly always
   part of a tactic the child stumbled into correctly.

`primeTutor(fen, engine)` warms the cache for a position before the child has moved, which is
how the response can be both instant and engine-grounded.

### The optional deep explanation

`/api/coach` (`src/app/api/coach/route.ts`) backs the "Ask ChessPaa why 🤔" button. It receives
**engine findings about one position** — never anything about the child. With no
`ANTHROPIC_API_KEY` set it composes the answer offline from those same facts and returns
`{source: "storybook"}`; the app makes no outbound request at all. With a key, a small model is
allowed to *rephrase the supplied facts only* — the system prompt forbids inventing chess
claims — and any error or timeout falls straight back to the offline composer, so the child
always gets an answer.

### Puzzles

`src/lib/data/puzzles/{tactics,train,ferris}.json`, bucketed by theme (7), difficulty band (5),
or endgame kind (2) — 490 + 400 + 170 = 1,060 entries.

Each entry is `{id, fen, moves, rating, themes}`. **`moves` and `themes` are both
space-separated strings, not arrays** — `"b6b7 f3f1"`, `"endgame mateIn1 rookEndgame"`. Split
before you index them; `p.moves[0]` silently gives you the character `"b"`, which chess.js
then rejects with a confusing error. Ratings run 600–1698, median 1107.

Pre-verified: all 1,060 replay cleanly through chess.js from their `fen` along their whole
`moves` line, so no ride can hand a child an unsolvable position. It is a cheap check — re-run
it whenever the packs change.

---

## 5 · The harness bridge

`src/three/harnessBridge.ts` installs `window.__park`:

```ts
pose({ rig?, camera?, dusk? })   // place a camera deterministically
stats()   → { fps, calls, tris, programs } | null
debug()   → [{ name, visible, verts, yMin, yMax, color }]   // what is ACTUALLY drawn
rigs()    → RigName[]                                       // 12 names; the harness shoots 11
ready     // set true by markParkReady(), ~350ms after first render
current   // RigName — the last rig posed, so UI can reflect the cameras
```

`stats()` reads a post-render sample rather than `renderer.info` directly, because the
composer resets `info` and every report used to say "1 draw".

This is dev and QA scaffolding. It ships inert: no data leaves the device, and nothing on it
is reachable by a child playing the game.
