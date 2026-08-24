"use client";

/**
 * THE LANDMARK GEOMETRY API — the five attractions and the fair around them.
 *
 * This module is a FACADE. Every builder, rig, texture and shader listed below
 * is implemented in `./Landmarks`, and re-exported from here so that both
 * spellings of the name resolve to the same module.
 *
 * WHY: `landmarks.ts` and `Landmarks.tsx` differ only in case. Webpack and
 * Turbopack both try `.tsx` before `.ts`, and on a case-insensitive filesystem
 * (default macOS) `"./landmarks"` resolves to `Landmarks.tsx`. If the
 * implementation lived here, the component file importing `"./landmarks"`
 * would import ITSELF — every symbol `undefined`, the park dead on first
 * render. Pointing this way round instead makes the collision harmless: both
 * `"./landmarks"` and `"./Landmarks"` reach the real module on every OS.
 *
 * WHAT YOU GET (all documented at the definitions):
 *
 *   PLACEMENT DATA
 *     PARADE_PLINTHS   six {pos, look} spots where the piece characters stand
 *     PARADE_CENTER · BIG_TOP_CENTER · TRAIN_CENTER
 *     CAROUSEL_CENTER · TICKET_BOOTH · CANDY_STAND · SIGNPOSTS · BALLOON_POSTS
 *     TRAIN_CURVE · TRAIN_PERIOD · trainPoseAt()
 *     ferrisRig() · stationRig()
 *     spineDistanceXZ() · nearestSpineT()   — keep clear of the coaster
 *
 *   BUILDERS  (each returns bags of BufferGeometry keyed by material)
 *     buildPieceParade() · buildTacticsStation() · buildFerrisWheel()
 *     buildPuzzleTrain() · buildBigTop() · buildCarousel() · buildPlazaDressing()
 *
 *   BAG PLUMBING
 *     makeBag() · put() · absorb() · bake()   — MatKey, GeoBag, BakedParts
 *
 *   PAINTED TEXTURES (canvas2D, cached, nothing downloaded)
 *     signAtlasTexture() · signpostAtlasTexture() · clockFaceTexture()
 *
 *   SHADERS + PARTICLE HELPERS
 *     createSteamMaterial() · makeSteamGeometry() · steamJitter()
 *     createGlowPointsMaterial() · makeGlowGeometry()
 *
 *   REACT
 *     default export Landmarks, plus useLandmarkWorld() and the individual
 *     ride components.
 */

export * from "./Landmarks";
export { default } from "./Landmarks";
