# Art Direction

**Warm storybook toy-carnival at golden-hour dusk.** Cel-shaded, plush, handmade.
Never cold, never clinical, never flat-plastic, never default-grey, never physically based.

The whole look serves one image: a child steps through painted gates into light the colour
of warm honey, and somewhere ahead a grandfather is holding a lantern. If a decision makes
that picture warmer and more legible, it is right. If it makes it more accurate, it is
probably wrong.

Every value below is committed and lives in code, and every number here was read out of the
file it lives in. This document explains *why* those numbers are those numbers — especially
the ones that were expensive to learn.

Three places where the intent and the captured frames still disagree are marked ⚠️ in the
sections that own them: the shadows (§4), the banded-fog reveal (§5), and the hand-carved
wobble (§4). Everything else here matches both the code and the frames in `shots/`.

---

## 1 · The committed palette

`src/three/core/palette.ts`. Twenty-eight colours, authored as hex ints so they drop straight
into three.js. **If a surface in this park reads cold or grey, it is not using this file
correctly.**

### Warm light — the sun and everything that glows

| Token | Hex | Governs |
|---|---|---|
| `honey` | `#f4b24a` | The dusk sun, lantern light, fairy-lights, ChessPaa's glow. **Also the default fresnel rim colour** — this hue is doing two jobs at once, which is why the park holds together. |
| `honeyDeep` | `#e89a3c` | Coaster rails, the warmer half of any honey gradient. |
| `lanternCore` | `#ffd27a` | The warmest point on screen. Lantern glass, and the only thing bloom is really meant to catch. |

### Parchment and paper

| Token | Hex | Governs |
|---|---|---|
| `cream` | `#f3e4c6` | Signage, bunting, light board squares, tent canvas. |
| `creamPale` | `#faf1de` | The plaza floor, the palest lit surfaces. |

### Toy-wood — the material almost everything is carved from

| Token | Hex | Governs |
|---|---|---|
| `walnut` | `#6e4326` | Ride frames, sleepers, lantern poles, jetty planks, dark board squares. |
| `cocoa` | `#53321c` | Bunting cord, deep wood shadow, the darkest carved edges. |
| `walnutLight` | `#8b5a37` | Supports, signposts, sun-bleached wood facing the key. |

### The carnival accent pair

| Token | Hex | Governs |
|---|---|---|
| `teal` | `#2fa69a` | Booths, awnings, gondolas, bunting flags. |
| `tealDeep` | `#1f7d74` | Their shadow side and trim. |
| `plum` | `#9c3f72` | The opposite accent — striped canvas, painted panels, carousel. |
| `plumDeep` | `#74294f` | Its shadow side. Also the hue every shadow band leans toward. |

Two accents, not five. A carnival with a full rainbow is noise; a carnival with one warm
ground, one cool accent and one hot accent is a **poster**.

### Reserved

| Token | Hex | Governs |
|---|---|---|
| `scarfRed` | `#c6402f` | ChessPaa's scarf, and almost nothing else in the entire park. |

That reservation is a composition tool, not a preference. It is the only strongly saturated
red in the valley, so wherever it appears, the eye goes there. It is how a five-year-old finds
the grandfather from across the plaza without being told to.

### The frame

| Token | Hex | Governs |
|---|---|---|
| `forest` | `#1b2a20` | The near-black pine wall that cups the valley. |
| `forestMid` | `#27392c` | Mid-distance pines before they flatten into haze. |

### The one cool passage

| Token | Hex | Governs |
|---|---|---|
| `ice` | `#4d8ea6` | The frozen river surface. |
| `icePale` | `#9fcede` | Its lit edge and cracks. |
| `waterTeal` | `#2f6b7d` | Open water and deep ice. |
| `waterDeep` | `#2d5f6d` | The darkest channel. |

Used **sparingly, on purpose**. In a park this warm, cool is a spice. One frozen river across
a valley of honey reads as *cold* to a viewer; cool scattered everywhere reads as nothing at
all.

### Snow — never white

| Token | Hex | Governs |
|---|---|---|
| `snow` | `#f6ecdc` | All lit snow. Note it is a warm cream, not `#ffffff`. |
| `snowShadow` | `#c9bcd0` | Snow in shade — mauve, because a shadow on snow at dusk *is* mauve. |

White snow at golden hour is a lie, and worse, it is a hole: pure white takes no light, so it
kills every band the ramp is trying to draw.

### Ink

| Token | Hex | Governs |
|---|---|---|
| `ink` | `#2e1e28` | Every line in the park — both line systems. A warm brown-plum. |

**Never pure black.** Pure black is not a line, it is a hole punched in the picture. Warm ink
reads as *drawn* — as a pen that was held by a hand.

### Sky and atmosphere

| Token | Hex | Governs |
|---|---|---|
| `skyTop` | `#6c5c8a` | The lavender crown. |
| `skyMid` | `#a87f8b` | The mauve middle band. |
| `skyHorizon` | `#e8a97e` | The peach horizon where the sun just went. Also the scene clear colour. |
| `fillLavender` | `#8b7aa8` | The cool bounce light, and the shadow tint injected by every toon material. |
| `fogNear` | `#dcb69d` | Near haze. |
| `fogFar` | `#dfa98c` | Far haze — slightly warmer, so distance goes *toward* the sun. |

### Helpers

`css(hex)` for canvas2D painting · `mix(a, b, t)` · `towardShadow(hex, amount)` pushes toward
`#3a2740` · `towardLight(hex, amount)` pushes toward `honey`.

---

## 2 · The toon ramp

`src/three/core/toonRamp.ts`. Six ramps, each a 32×1 `DataTexture` with
`NearestFilter` and `generateMipmaps = false`. Thirty-two pixels is enough to place a
threshold precisely and small enough that NEAREST guarantees the steps stay hard.

### Band structure

Bottom of the ramp is unlit, top is fully lit. Every ramp walks the same four stations:

1. **Deep shadow**, tinted toward plum
2. **A mid band** carrying the local colour
3. **A warm lit band** pushed toward honey
4. **A narrow near-white kiss** at the very top

Stops are `[position, colour]` where position is where the band *begins*, and the lookup does
a hard band selection with **no interpolation between bands**. That hard selection is the
entire point of a toon ramp.

| Ramp | Bands | Used for | Character |
|---|---|---|---|
| `hero` | 5 | ChessPaa, the chess pieces, the grandchildren | Two shadow bands, hard steps, a tight bright kiss. Carved, not shiny. |
| `soft` | 6 | Big rounded forms, tent canvas, the plaza | More bands, so the steps read as gentle. |
| `wood` | 5 | All toy-wood | Warm even in the deepest shadow — never muddy. |
| `snow` | 5 | Snow, ground, banks, paths | Lavender in shade, honey at the top. Plush. |
| `ice` | 5 | The frozen river | The one ramp that keeps its chill. It barely warms even at the top band. |
| `foliage` | 4 | Pines | Almost no highlight at all. Flat cut-paper. |

Note how little of any ramp the top kiss occupies — the last 5–7% on five of the six
(`hero` 0.93, `soft` 0.95, `wood` 0.94, `ice` 0.95, `foliage` 0.93). **A narrow highlight is
what makes a form read as carved rather than plastic.** Widen it and the whole park turns to
vinyl. The exception is `snow`, whose kiss starts at 0.88 and so occupies 12% — deliberately
broader, because a snowbank is one big soft form and a pinprick highlight on it reads as a
speck of dirt rather than a lit crown.

### Why the ramps are luminance-dominant — the hard-won lesson

> `MeshToonMaterial` **multiplies** the gradient map against the surface's own colour.

This is the single most expensive thing anyone on this project learned, and the comment
recording it sits at the top of the `RAMPS` table so nobody re-learns it.

The intuitive move is to author beautiful, colourful ramps — a rich amber lit band, a saturated
plum shadow — because that is what the reference art looks like. Do that and every ramp in the
park multiplies its own strong hue over every surface's hue. Teal booths, plum canvas, green
pines, blue ice, red scarf: **all of them collapse into one monochrome amber wash.** The entire
valley becomes a single colour. It happened, and it looked like a sepia photograph of a
theme park rather than a theme park.

So the ramps carry **luminance, and only a whisper of hue** — plum-cool at the bottom, honey-warm
at the top, and near-neutral through the middle where the local colour has to speak. Look at
the `hero` ramp: `#574a63 → #8e7f88 → #c4b3ac → #efe0cb → #fff8ec`. That is a greyscale
staircase with a temperature gradient laid over it. It is almost neutral, which is exactly what
lets a teal booth stay teal, a plum tent stay plum, and the one red scarf stay the reddest thing
on screen.

**The colour comes from the surface. The ramp supplies the light.** Where warmth needs to be
*added* rather than multiplied, it is added additively in the fragment shader — the rim and the
bounce — never folded into the ramp.

### The colour-grading LUT

`buildWarmLUT(size = 16)` in the same file generates a 16³ `Data3DTexture` at boot — a
colourist's grade written as arithmetic instead of bought as a `.cube` file. Four moves, in
order:

1. **Shadows** deepened and plum-tinted, weighted by `(1 − luminance)²`.
2. **Midtones** lifted toward amber, blue pulled back — the widest-weighted move, and the one
   that does most of the storybook feeling.
3. **Highlights** warmed slightly and rolled off, so nothing clips to clinical white.
4. **A gentle S-curve** for contrast that protects both ends.

Applied last in the post chain at `amount = 0.62` — a grade, not a filter. It is what makes
the gate, the crest and the board feel like pages of the same book.

---

## 3 · The two line systems

The park is drawn twice, by two different pens, and **they are tuned against each other rather
than stacked**. Doubling them produces muddy doubled strokes, which is the failure mode this
section exists to prevent.

### System one — silhouettes: inverted hull

`src/three/core/materials/OutlineMaterial.ts`

Duplicate the mesh, push its vertices out along **smoothed** normals, render `side: BackSide`
in warm `ink`. Added as a *child* of the mesh, so it inherits every transform for free.

The push scales with view depth (`pxScale = uThickness * dist / 900.0`), which gives a
**constant screen-space width**: a pawn ten metres away and one right against the camera wear
the same weight of ink. That is what a drawn line does; it is not what a scaled 3D object does.
The ink also fades between `fadeStart 60` and `fadeEnd 150` so the far haze stays soft and papery
rather than turning into a wire-frame thicket.

Two rules that are easy to get wrong:

- **`smoothNormalsForOutline(geo)` before `addOutline()` on any hard-edged geometry.** Crates,
  planks, signage. Without it the hull splits at every hard corner and the outline tears open.
- **Outlines never cast or receive shadows.** They are ink, not matter. `addOutline()` enforces
  this and sets `renderOrder − 1`.

Weights in use: the board's own furniture 2.2–3.0 (plinth 2.2, tray 2.6, pieces 3.0) ·
`Park.tsx`'s default and the coaster car 2.2 · set-dressing 1.5–1.7 · fine detail (sleepers)
1.2 · ground, plaza, paths, ice, bunting, bunting cord, tree snow and anything bright:
**none**. Bright surfaces — honey, glass, painted faces — separate themselves already, and
outlining them makes them look *tarred*.

The fade distances are per-call and they matter as much as the weight: near work uses
`fadeStart 34–50 / fadeEnd 110–130`, mid-ground 40–70 / 120–190, so ink thins out at roughly
the distance each subject is meant to be read from rather than at one global range.

### System two — interiors: screen-space Sobel

`src/three/core/postfx/effects.ts`, fed by the normal+depth prepass.

The hull cannot draw the lines *inside* a form: the fold of ChessPaa's coat, the seam of a
plank, the crease of a smile. Those come from a 3×3 Sobel run over world normals and linear
depth.

### How they cooperate

**The hull owns silhouettes. The Sobel owns creases.** So the Sobel is biased hard toward the
normal gradient (`normalStrength 0.95`) and its depth term is kept deliberately weak
(`depthStrength 0.30`) — because depth discontinuities are exactly the edges the hull has
*already eaten*, and turning that term up just re-draws every silhouette a second time, half a
pixel off, in a slightly different weight. That reads as smudge, not as ink.

The threshold (`0.44`) is set high enough that gentle curvature does not trip it — only real
folds do — and interior ink fades out past `falloff 0.80` of the depth range so distant forms
keep their silhouette but lose their detail lines, exactly as a painter would thin them out.

Both systems draw in the same warm `ink`, so the eye reads one pen.

### And the thing that must not be inked

Particles, glows, sprites and the sky have normals that bear no relation to their silhouettes.
Ink them and the Sobel fills the whole quad — a firefly becomes a black square. They live on
`NO_INK_LAYER`. See [ARCHITECTURE.md § 3](ARCHITECTURE.md#3--the-layer-convention).

---

## 4 · The lighting rig

`src/three/world/Park.tsx`. Four lights for the whole valley, plus one practical per lantern.

| Light | Setting | Job |
|---|---|---|
| **Key** — directional | `[46, 22, 58]`, intensity `1.25`, `#ffe3c2` | The low golden sun. **Warm white, not saturated amber** — the ramp and the LUT supply the colour; a strongly tinted key would multiply on top of both and re-create the monochrome wash. Casts shadows: 2048² map, ortho ±90, `bias −0.0012`, `normalBias 0.03`. |
| **Fill** — directional | `[−40, 16, −30]`, intensity `0.38`, `#9d8fc4` | Cool lavender, from the opposite side, **no shadow**. This is what makes shadows *coloured* rather than grey. |
| **Sky bounce** — hemisphere | sky `#ffdcc0`, ground `fillLavender`, `0.42` | Warm from above, lavender from below — the ambient temperature gradient of dusk. |
| **Ambient** | `0.22`, `#a494b8` | A mauve floor under everything, so nothing ever reaches true black. |
| **Practicals** — point, one per lantern | `intensity 9`, `distance 16`, `decay 2`, `lanternCore` | Real pools of warmth on the snow. These are what make the plaza feel *inhabited* rather than lit. |

### The warm fresnel rim — the critical trick

The most important light in the park is not in that table. It is in the material.

`createToonMaterial()` patches `MeshToonMaterial` through `onBeforeCompile` to add a fresnel
term in the fragment shader:

```glsl
float f       = 1.0 - clamp(dot(N, V), 0.0, 1.0);
float rimMask = pow(f, uRimPower);
gl_FragColor.rgb += uRimColor * rimMask * uRim;      // default uRimColor = honey
```

**Why it has to exist:** a pale cream chess piece standing on a pale cream board, at dusk, in
warm haze, *dissolves*. The value difference between figure and ground is nearly zero, and no
amount of ramp tuning fixes it because both surfaces are on the same part of the ramp. The rim
solves it structurally — it draws a warm honey edge along the silhouette of the form itself, so
the figure separates from the ground by **hue and by a hard light edge**, not by value.

The rule of thumb: **the lighter the surface a form sits on, the harder that rim works.**

| Subject | `rim` | `rimPower` |
|---|---|---|
| Heroes — ChessPaa, chess pieces, characters | `0.85` (default) | `3.0` |
| Snow banks, forms against pale ground | `0.72` | `2.4` |
| Coaster rails, wood, mid-ground structure | `0.35 – 0.6` | `2.6 – 3.4` |
| Ice | `0.42` | `2.6`, with a cool rim colour `#d6f4ff` |
| Ground | `0.14` | `4.5` — the tightest rim in the park |
| Plaza, paths | `0.10` | `3.0` (the default; never tuned) |
| Flat cut-paper, distant billboards | `0` | — (they use `createFlatMaterial`, which has no rim at all) |

`rimPower` is tightness: `2.0` is a broad wrap, `5.0` is a thin drawn line.

### The coloured shadow bounce

The same shader patch injects lavender into the shadow side:

```glsl
float shadowSide = 1.0 - clamp(dot(N, normalize(vec3(0.45, 0.75, 0.35))), 0.0, 1.0);
gl_FragColor.rgb += uBounceColor * uBounce * shadowSide * 0.28;   // fillLavender
```

Default `bounce = 0.22`; ground and snow banks push to `0.34`, the plaza to `0.28` and the
paths to `0.24`, because a big pale surface has the most shadow area to colour; ice drops to
`0.05` because it is the one thing allowed to stay cold. **Shadows in this park are lavender.
They are never grey.**

> ⚠️ That last sentence is the rule, and the shipped frames do not obey it. In
> `shots/01-gate.png` and `shots/05-chesspaa.png` the cast shadows read as large, hard,
> near-black shapes across the snow. The bounce term only lifts the *shading* side of a normal
> — it does nothing inside a shadow map's occluded region, which is where the darkness
> actually is. Fixing this needs the shadow itself tinted (a lighter `shadow.intensity`, or a
> lavender-tinted shadow in the material patch), not more bounce. Until then, the park's
> shadows are grey-black and the rule above is aspirational.

*(This term uses a fixed light-direction constant rather than the real key vector — a
deliberate simplification, since the key never moves and a uniform per material would cost
more than the effect is worth. If the sun ever animates, this becomes a uniform.)*

### The `handCarved` wobble

`createToonMaterial({ handCarved })` adds a low-frequency sine displacement along the normal in
the vertex shader. Nothing in this park should look milled. A whisper of wobble on an edge is
the difference between *manufactured* and *whittled by a grandfather over a winter*. Values are
tiny — `CoasterCar.tsx` uses `0.004`, and it is the **only** call site in the repo. `CoasterCar`
is not mounted, so as of today the wobble has never appeared on screen at all. Badly under-used.

---

## 5 · Atmosphere: the banded-fog rule

> **Distance is stepped, not continuous.**

`patchMaterialForBandedFog(mat, bands = 5)` in `SkyMaterial.ts` rewrites the standard
`fog_fragment` chunk to quantise the fog factor before mixing:

```glsl
float _q = floor(_fogF * _bands + 0.5) / _bands;
gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, _q);
```

Five bands. `scene.fog = new THREE.Fog(PALETTE.fogNear, 96, 340)`.

**Call it on every lit material.** A single unbanded material in a wide shot is instantly
visible — it is the one object that recedes smoothly while everything around it steps.

This is what is *meant* to make the reveal from the crest of the coaster look like a
**painted matte** rather than a 3D render with fog on it: the river's far bends, the pine
ridges and the far attractions stacking as flat paper cards receding into honey haze. Smooth
fog says *atmosphere simulation*. Quantised fog says *someone cut these out of paper and laid
them one behind the other*, which is the entire feeling this park is chasing.

> ⚠️ **Stated as intent, not as a captured result.** The mechanism is correct in code and you
> can see it working on the far hills of `shots/01-gate.png`. The crest itself does not yet
> deliver it: `shots/03-crest.png` shows the near valley boxed in by two near-vertical terrain
> walls, with no far river bends, no distant attractions and the banding barely registering.
> The `crest` rig is not framing a depth the fog can act on, and the valley wall behind it is
> broken geometry. Until that shot is re-taken and this paragraph is true of it, treat this
> section as the target.

Note that `fogFar` is *warmer* than `fogNear`, so distance goes toward the sun rather than
toward grey.

### The one deliberate exception: the sky

`createSkyMaterial()` is the only place in the park where we **paint instead of band**. A
smooth vertical wash — `skyTop` lavender at the crown, `skyMid` through the middle, `skyHorizon`
peach low and wide — plus a warm bloom sitting right on the horizon where the sun just went, and
a barely-there hash grain (0.012 wide, so ±0.006) so the gradient never reads as a CSS ramp.

**Do not band the sky.** The tension between the sharp-stepped world and the soft-washed sky is
precisely what makes the world read as painted foreground against a watercolour backdrop. Band
it and the whole image flattens into one material.

The clouds go back the other way: `createCloudMaterial()` uses `step(0.62, n)` for a **hard**
edge — cut paper, not volumetric puff — with a second tighter `step(0.66, n)` giving each bank
a lit top edge. Two layers at different parallax speeds, both on `NO_INK_LAYER`.

### Dusk drift

The sky's `uDusk` uniform runs `0` (golden) → `1` (late), easing rather than snapping so harness
poses do not pop. As it rises, the whole sky cools and deepens, the horizon bloom fades, and the
lanterns become the dominant light source. `parkLifeData.duskAt()` drives it over
`DUSK_MINUTES = 14` — long enough that a child never sees it move, short enough that a session
visibly ends later than it began.

---

## 6 · The short version

If you are about to add something to this park, check it against these:

1. **Generated in code.** No downloaded models, textures, samples or LUTs. Ever.
2. **Colour from `PALETTE`.** If it reads grey, you are not using the palette.
3. **Ramps carry light, surfaces carry colour.** Never put strong hue in a ramp.
4. **Ink is `#2e1e28`, never black.** Hull for silhouettes, Sobel for creases, never both
   fighting over the same edge.
5. **Rim strength rises with how pale the ground is.** Pale must never eat pale.
6. **Shadows are lavender.**
7. **`patchMaterialForBandedFog()` on every lit material.** Band the world; paint the sky.
8. **Particles, glows, sprites and sky go on `NO_INK_LAYER`.**
9. **`rng(seed)`, never `Math.random()`.** The park looks identical every run or the harness
   is worthless.
10. **`terrainHeight(x, z)` for placement,** so nothing floats.
