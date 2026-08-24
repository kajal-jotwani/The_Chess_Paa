"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { PALETTE, css, mix } from "../core/palette";
import { createToonMaterial, type ToonMaterial } from "../core/materials/ToonMaterial";
import { addOutline, smoothNormalsForOutline } from "../core/materials/OutlineMaterial";
import { patchMaterialForBandedFog } from "../core/materials/SkyMaterial";
import { boardTexture, woodTexture, parchmentTexture, glowSprite, rng } from "../core/textures/procedural";
import { mergeGeometries } from "../world/terrain";
import { NO_INK_LAYER } from "../core/postfx/effects";
import { type PieceType } from "../core/geometry/pieces";
import { Spring } from "../characters/chessPaaRig";
import {
  facedPieceGeometry,
  pieceMaterial,
  pieceIdle,
  subStep,
  Sparkles,
  type PieceTone,
} from "../characters/PieceCharacters";

import {
  BOARD,
  CELL,
  FILES,
  RANKS,
  PROMOTION_CHOICES,
  STAND_HEIGHT,
  cellIndexOfSquare,
  checkedKingSquare,
  diffPlacement,
  dragThreshold,
  fileRankCenter,
  highlightToCell,
  isLegalMove,
  needsPromotion,
  nearestSquare,
  pickup,
  sideToMove,
  snapToTarget,
  squareCenter,
  squareToFileRank,
  type Color,
  type HighlightKind,
  type LegalFor,
  type Orientation,
  type PickupInfo,
  type Phase,
  type Square,
  type StandKind,
  type TrackedPiece,
} from "./boardInteraction";

/**
 * THE BOARD.
 *
 * Everything else in this park exists to get a child to this object and make
 * them want to touch it. So it is built as a TOY, not as a diagram: warm
 * carved wood, a raised rim with the coordinates painted on, a little turned
 * plinth to lift it off the snow, and thirty-two small characters standing on
 * it who visibly wake up when it is their turn.
 *
 * THREE RULES THIS FILE KEEPS
 *
 *  1. chess.js is the only rules authority. This component is presentational
 *     plus interaction — it never calls an engine, never calls the tutor, and
 *     never invents a move. Every legality question goes through
 *     boardInteraction.ts, which asks chess.js.
 *
 *  2. TOUCH IS NOT AN AFTERTHOUGHT. Drag and tap-to-move both work, always.
 *     Hit targets are generous invisible boxes standing over each square,
 *     tall where a piece is standing and flat where it is not, so tapping a
 *     king's crown picks the king and not the square behind him. A dropped
 *     piece snaps gently to the nearest legal square within about two thirds
 *     of a square. On touch the carried piece is pushed up-screen so a thumb
 *     never covers the thing it is moving.
 *
 *  3. NO DEAD ENDS. An illegal drop springs home instead of erroring. A piece
 *     with no legal moves cannot be lifted at all, so a child is never shown
 *     an empty ring of hints. The promotion picker is four big pieces you
 *     press, and tapping anywhere else on the board backs out of it.
 */

/* ================================================================== *
 * PUBLIC API
 * ================================================================== */

export interface Board3DProps {
  /** The position, in Forsyth-Edwards notation. The single source of truth. */
  fen: string;
  /** Which way round the board sits. Default "white". */
  orientation?: Orientation;
  /** Accept pointer input at all. Default true. */
  interactive?: boolean;
  /**
   * Whose pieces the local player may lift. "both" for a hotseat game, "w" or
   * "b" when ChessPaa is playing the other side, null for a display board.
   * Only the side to move is ever liftable, whatever this says.
   */
  legalFor?: LegalFor;
  /** [from, to] of the move that just happened — softly framed on the board. */
  lastMove?: [string, string] | null;
  /** Extra glows the tutor asks for: square -> "hint" | "danger" | "good". */
  highlight?: Record<string, HighlightKind>;
  /** Emitted only for moves chess.js has already accepted as legal. */
  onMove?: (from: string, to: string, promotion?: string) => void;
  /** Fired when a piece is lifted / put down. Handy for sound and for the tutor. */
  onSelect?: (square: string | null) => void;
  /** Where the STAND'S FOOT sits — feed it terrainHeight(x, z) and it will not float. */
  position?: [number, number, number];
  scale?: number;

  /* ---- optional dressing, all safely defaulted ---- */
  /** What the board stands on. Default "plinth". */
  stand?: StandKind;
  /** Add a warm key/fill/rim of its own — for menus and shots outside the park. */
  ownLight?: boolean;
  /** Deterministic seed for the wood grain and the hand-wobble. */
  seed?: number;
  /** Ink weight on the pieces. */
  outline?: number;
  /** Piece detail. "low" for distant or background boards. */
  quality?: "high" | "low";
}

/** Distance from the stand's foot up to the playing surface, for placing things. */
export function boardSurfaceY(stand: StandKind = "plinth"): number {
  return STAND_HEIGHT[stand];
}

export { BOARD, STAND_HEIGHT } from "./boardInteraction";
export type { StandKind, Orientation, LegalFor, HighlightKind } from "./boardInteraction";

/* ================================================================== *
 * THE RIM COORDINATES
 * ================================================================== */

const rimCache = new Map<string, THREE.Texture>();

/**
 * The a-h / 1-8 painted around the rim, drawn in code.
 *
 * Two variants, one per orientation. We do NOT rotate the board group to flip
 * sides — a rotated group would leave a child reading "e4" upside down — so
 * the letters have to be repainted instead. Each glyph gets a hair of
 * rotation and offset from rng() so the ring reads as hand-lettered.
 */
function rimLabelTexture(orientation: Orientation, seed: number): THREE.Texture {
  const key = `${orientation}-${seed}`;
  const hit = rimCache.get(key);
  if (hit) return hit;

  const S = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d")!;
  const r = rng(seed * 131 + 7);

  const half = BOARD.OUTER_HALF; // 4.68 board units == S/2 pixels
  const px = (u: number) => ((u + half) / (2 * half)) * S; // board x -> canvas x
  // CanvasTexture uploads with flipY, so the BOTTOM row of the canvas ends up
  // at v = 0, which our quads map to z = +half (the near rail). Get this
  // backwards and the rank numbers count the wrong way up the board — which
  // is precisely what the first render showed.
  const py = (z: number) => ((z + half) / (2 * half)) * S;

  x.clearRect(0, 0, S, S);
  x.fillStyle = css(mix(PALETTE.cream, PALETTE.honey, 0.28));
  x.textAlign = "center";
  x.textBaseline = "middle";
  const size = Math.round((0.42 / (2 * half)) * S);
  x.font = `600 ${size}px Georgia, "Times New Roman", serif`;

  const glyph = (text: string, bx: number, bz: number) => {
    x.save();
    x.translate(px(bx) + (r() - 0.5) * 4, py(bz) + (r() - 0.5) * 4);
    // A hand-painted board never has two letters at the same angle.
    x.rotate((r() - 0.5) * 0.09);
    x.globalAlpha = 0.82 + r() * 0.14;
    x.fillText(text, 0, 0);
    x.restore();
  };

  const rimMid = BOARD.HALF + BOARD.RIM * 0.5; // centre-line of the rim band
  for (let i = 0; i < 8; i++) {
    // fileRankCenter already knows which way the board is facing, so the
    // letters simply follow their own squares out onto both rails.
    glyph(FILES[i], fileRankCenter(i, 0, orientation).x, rimMid);
    glyph(FILES[i], fileRankCenter(i, 0, orientation).x, -rimMid);
    glyph(RANKS[i], -rimMid, fileRankCenter(0, i, orientation).z);
    glyph(RANKS[i], rimMid, fileRankCenter(0, i, orientation).z);
  }

  // Four little carved dots at the corners — the mark of a made object.
  x.globalAlpha = 0.5;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      x.beginPath();
      x.arc(px(sx * (half - 0.34)), py(sz * (half - 0.34)), size * 0.14, 0, Math.PI * 2);
      x.fill();
    }
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  rimCache.set(key, t);
  return t;
}

/* ================================================================== *
 * THE HIGHLIGHT OVERLAY
 *
 * Every dot, ring, frame and glow on this board is drawn by ONE quad running
 * ONE shader, fed by a tiny 8x8 data texture. The alternative — sixty-four
 * pooled meshes appearing and disappearing — is where 3D chess boards
 * traditionally go to die: it churns, it pops, and it costs a draw call per
 * hint. Here a hint costs a byte.
 * ================================================================== */

/**
 * Palette entries for the shader.
 *
 * NOT converted to linear. A raw ShaderMaterial gets neither three's tone
 * mapping nor its sRGB encode chunk, so whatever we write lands in the
 * framebuffer verbatim — which means it has to be written already sRGB.
 * Converting first (the obvious thing, and what the first pass did) drops
 * every marker a stop and a half and the dots all but vanished.
 */
function glslColor(hex: number): string {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return `vec3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`;
}

const OVERLAY_FRAG = /* glsl */ `
uniform sampler2D uCells;
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;

const vec3 C_HONEY   = ${glslColor(PALETTE.honey)};
const vec3 C_LANTERN = ${glslColor(PALETTE.lanternCore)};
const vec3 C_RED     = ${glslColor(PALETTE.scarfRed)};
const vec3 C_TEAL    = ${glslColor(PALETTE.teal)};
const vec3 C_CREAM   = ${glslColor(PALETTE.creamPale)};
const vec3 C_INK     = ${glslColor(PALETTE.ink)};

float sdCircle(vec2 p, float r) { return length(p) - r; }

/** Signed distance to a rounded square — the shape of a painted marker. */
float sdRound(vec2 p, float b, float rr) {
  vec2 d = abs(p) - vec2(b) + rr;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - rr;
}

/** Solid inside. Softness is a CONSTANT, not fwidth: no derivative extension
    needed, and a constant soft edge is what a painted marker looks like. */
float solid(float d, float s) { return 1.0 - smoothstep(-s, s, d); }

/** A stroke of width w centred on the zero-crossing. */
float stroke(float d, float w, float s) { return 1.0 - smoothstep(w - s, w + s, abs(d)); }

/** Paint one colour over what is already there. */
void put(inout vec3 col, inout float a, vec3 c, float na) {
  na = clamp(na, 0.0, 1.0);
  float outA = na + a * (1.0 - na);
  col = (c * na + col * a * (1.0 - na)) / max(outA, 1e-4);
  a = outA;
}

vec4 marker(float codeF, float amp, vec2 p) {
  if (amp <= 0.004) return vec4(0.0);
  int code = int(codeF + 0.5);
  float t = uTime;
  vec3 col = vec3(0.0);
  float a = 0.0;

  if (code == 1) {
    // YOU MAY GO HERE. A fat honey dot with an INK CONTOUR — honey on a cream
    // square is nearly no contrast at all, and the drawn line is what makes
    // the dot survive on both colours of square. It is also just how you
    // would draw it by hand.
    float s = 0.5 + 0.5 * sin(t * 2.6);
    float d = sdCircle(p, 0.170 + s * 0.012);
    put(col, a, C_HONEY,   solid(sdCircle(p, 0.36), 0.17) * 0.22);   // halo
    put(col, a, C_HONEY,   solid(d, 0.018) * 0.98);                  // gold body
    put(col, a, C_LANTERN, solid(sdCircle(p, 0.082), 0.055) * 0.85); // hot core
    put(col, a, C_INK,     stroke(d, 0.020, 0.012) * 0.85);          // drawn edge
  } else if (code == 2) {
    // SOMETHING OF THEIRS IS STANDING HERE. A ring around the square, never a
    // fill: a fill would hide the piece you are about to take.
    float s = 0.5 + 0.5 * sin(t * 3.0);
    float d = sdCircle(p, 0.392);
    float w = 0.058 + s * 0.012;
    put(col, a, C_RED, solid(d, 0.22) * 0.12);
    put(col, a, C_RED, stroke(d, w, 0.016) * 0.98);
    put(col, a, C_INK, stroke(d, w + 0.026, 0.012) * 0.55);
  } else if (code == 3) {
    // WHERE THE LAST MOVE CAME FROM AND WENT TO. Quiet: it is history, not an
    // instruction, so it never pulses and never shouts.
    float d = sdRound(p, 0.420, 0.11);
    put(col, a, C_HONEY, solid(d, 0.030) * 0.16);
    put(col, a, C_HONEY, stroke(d, 0.034, 0.016) * 0.72);
  } else if (code == 4) {
    // THE PIECE YOU HAVE PICKED UP.
    float d = sdRound(p, 0.442, 0.13);
    put(col, a, C_HONEY,   solid(d, 0.030) * 0.34);
    put(col, a, C_LANTERN, stroke(d, 0.050, 0.016) * 1.0);
    put(col, a, C_INK,     stroke(d, 0.082, 0.013) * 0.55);
  } else if (code == 5) {
    // TUTOR: "have a look over here". A slow warm breath.
    float s = 0.5 + 0.5 * sin(t * 1.8);
    float d = sdRound(p, 0.400 + s * 0.022, 0.17);
    put(col, a, C_LANTERN, solid(d, 0.120) * (0.16 + s * 0.13));
    put(col, a, C_LANTERN, stroke(d, 0.030, 0.016) * 0.70);
  } else if (code == 6) {
    // TUTOR: "careful". Faster breath, warmer red. Still not a scolding.
    float s = 0.5 + 0.5 * sin(t * 3.4);
    float d = sdRound(p, 0.400 + s * 0.020, 0.17);
    put(col, a, C_RED, solid(d, 0.120) * (0.15 + s * 0.15));
    put(col, a, C_RED, stroke(d, 0.034, 0.016) * 0.85);
  } else if (code == 7) {
    // TUTOR: "yes, that one".
    float s = 0.5 + 0.5 * sin(t * 2.1);
    float d = sdRound(p, 0.400 + s * 0.020, 0.17);
    put(col, a, C_TEAL, solid(d, 0.120) * (0.16 + s * 0.13));
    put(col, a, C_TEAL, stroke(d, 0.034, 0.016) * 0.82);
  } else if (code == 8) {
    // THE KING IS IN CHECK. The one thing on this board allowed to be loud.
    float s = 0.5 + 0.5 * sin(t * 4.2);
    put(col, a, C_RED, solid(sdCircle(p, 0.300 + s * 0.130), 0.300) * (0.34 + s * 0.28));
    put(col, a, C_RED, stroke(sdCircle(p, 0.440), 0.050, 0.020) * (0.60 + s * 0.35));
  } else if (code == 9) {
    // THE SQUARE UNDER THE PIECE IN YOUR HAND. Bright, thick, unmissable.
    float d = sdRound(p, 0.452, 0.13);
    put(col, a, C_CREAM, solid(d, 0.030) * 0.34);
    put(col, a, C_CREAM, stroke(d, 0.060, 0.016) * 1.0);
    put(col, a, C_INK,   stroke(d, 0.090, 0.014) * 0.45);
  }

  return vec4(col, a * amp);
}

void main() {
  vec2 g = vUv * 8.0;
  vec2 cell = (floor(g) + 0.5) / 8.0;
  vec2 p = fract(g) - 0.5;
  vec4 c = texture2D(uCells, cell);

  // Two slots per square: the persistent one (last move, tutor glow, check)
  // sits UNDER the interaction one (dots, rings, selection), so picking a
  // piece up never hides where the last move went.
  vec4 under = marker(c.b * 255.0, c.a, p);
  vec4 over  = marker(c.r * 255.0, c.g, p);

  float outA = over.a + under.a * (1.0 - over.a);
  vec3 outC = (over.rgb * over.a + under.rgb * under.a * (1.0 - over.a)) / max(outA, 1e-4);
  if (outA < 0.003) discard;
  gl_FragColor = vec4(outC, outA * uOpacity);
}
`;

const OVERLAY_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

interface Overlay {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  texture: THREE.DataTexture;
  data: Uint8Array;
  /** live code + amplitude per slot, per square */
  code: [Uint8Array, Uint8Array];
  amp: [Float32Array, Float32Array];
  want: [Uint8Array, Uint8Array];
  wantAmp: [Float32Array, Float32Array];
  /** ripple: a cell is held at zero until this timestamp */
  hold: Float32Array;
}

function buildOverlay(): Overlay {
  const data = new Uint8Array(64 * 4);
  const texture = new THREE.DataTexture(data, 8, 8, THREE.RGBAFormat, THREE.UnsignedByteType);
  // NEAREST and NO colour space: these bytes are codes and amplitudes, not
  // colour. Let three convert them and every hint lands on the wrong square.
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uCells: { value: texture },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: OVERLAY_VERT,
    fragmentShader: OVERLAY_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
  });

  const geo = new THREE.PlaneGeometry(BOARD.SPAN, BOARD.SPAN);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  // Just above the wood — high enough not to z-fight, low enough that a piece
  // standing on the square still hides the middle of its own dot.
  mesh.position.y = 0.012;
  mesh.renderOrder = 6;
  mesh.raycast = () => {};
  // Glow, therefore no ink: the Sobel pass would draw a hard black square
  // around every dot.
  mesh.layers.set(NO_INK_LAYER);

  return {
    mesh,
    material,
    texture,
    data,
    code: [new Uint8Array(64), new Uint8Array(64)],
    amp: [new Float32Array(64), new Float32Array(64)],
    want: [new Uint8Array(64), new Uint8Array(64)],
    wantAmp: [new Float32Array(64), new Float32Array(64)],
    hold: new Float32Array(64),
  };
}

/* ================================================================== *
 * THE FURNITURE — board, rim, plinth, table
 * ================================================================== */

/** Re-derive a flat quad's UVs from its position, in the whole-board frame. */
function remapUV(geo: THREE.BufferGeometry, half: number) {
  const pos = geo.getAttribute("position");
  const uv = geo.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) + half) / (2 * half), (half - pos.getZ(i)) / (2 * half));
  }
  uv.needsUpdate = true;
}

function flatQuad(x0: number, x1: number, z0: number, z1: number, y: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  return g;
}

/** A turned toy table leg — foot at y=0, attachment at y=len. */
function turnedLeg(len: number, radial = 10): THREE.BufferGeometry {
  const profile: Array<[number, number]> = [
    [0.00, 0.000], [0.19, 0.000], [0.21, 0.035], [0.14, 0.075],
    [0.115, 0.16], [0.125, 0.30], [0.155, 0.40], [0.135, 0.46],
    [0.115, 0.56], [0.14, 0.66], [0.185, 0.74], [0.165, 0.80],
    [0.20, 0.90], [0.225, 1.00], [0.00, 1.00],
  ];
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y * len));
  return new THREE.LatheGeometry(pts, radial);
}

interface Furniture {
  group: THREE.Group;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
}

/**
 * Build the physical object: slab, playing surface, raised rim, painted
 * coordinates, and whatever it is standing on. Everything is merged down to
 * a handful of meshes — the board is one object in a park that has to hold
 * sixty frames a second at retina.
 */
function buildFurniture(orientation: Orientation, stand: StandKind, seed: number): Furniture {
  const group = new THREE.Group();
  group.name = "board-furniture";
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];

  const toon = (o: Parameters<typeof createToonMaterial>[0]): ToonMaterial => {
    const m = createToonMaterial(o);
    patchMaterialForBandedFog(m);
    materials.push(m);
    return m;
  };

  const half = BOARD.OUTER_HALF;

  /* ---- the playing surface ---- */
  const topGeo = new THREE.PlaneGeometry(BOARD.SPAN, BOARD.SPAN);
  topGeo.rotateX(-Math.PI / 2);
  geometries.push(topGeo);
  const topMat = toon({
    // Left at full brightness ON PURPOSE. The first pass knocked the surface
    // down a shade to protect the pale pieces, and the whole board went
    // brown-on-brown: one hue, no light, nothing to look at. Piece legibility
    // is bought instead where it belongs — with the pieces' own colour spread
    // (they sit OUTSIDE both square values) and their fresnel rim.
    color: 0xffffff,
    ramp: "wood",
    map: boardTexture(13),
    rim: 0.1,
    rimPower: 4.5,
    bounce: 0.26,
  });
  const top = new THREE.Mesh(topGeo, topMat);
  top.receiveShadow = true;
  top.castShadow = false;
  top.raycast = () => {};
  group.add(top);

  /* ---- the slab, its lip, and the rim ---- */
  const woodMap = woodTexture(PALETTE.walnut, seed + 3);
  const bodyParts: THREE.BufferGeometry[] = [];

  const slab = new THREE.BoxGeometry(half * 2, BOARD.SLAB, half * 2);
  slab.translate(0, -BOARD.SLAB / 2 - 0.001, 0);
  bodyParts.push(slab);

  const lip = new THREE.BoxGeometry(half * 2 - 0.34, BOARD.LIP, half * 2 - 0.34);
  lip.translate(0, -BOARD.SLAB - BOARD.LIP / 2, 0);
  bodyParts.push(lip);

  // The rim: a square ring, extruded and BEVELLED. The bevel is what makes it
  // read as carved rather than as four boxes glued to a board.
  const shape = new THREE.Shape();
  shape.moveTo(-half, -half);
  shape.lineTo(half, -half);
  shape.lineTo(half, half);
  shape.lineTo(-half, half);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-BOARD.HALF, -BOARD.HALF);
  hole.lineTo(-BOARD.HALF, BOARD.HALF);
  hole.lineTo(BOARD.HALF, BOARD.HALF);
  hole.lineTo(BOARD.HALF, -BOARD.HALF);
  hole.closePath();
  shape.holes.push(hole);
  const rim = new THREE.ExtrudeGeometry(shape, {
    depth: 0.1,
    bevelEnabled: true,
    bevelThickness: 0.032,
    bevelSize: 0.055,
    bevelOffset: 0,
    bevelSegments: 2,
    curveSegments: 1,
  });
  // ExtrudeGeometry grows along +Z; stand it up and sit its top on RIM_TOP.
  rim.rotateX(-Math.PI / 2);
  rim.computeBoundingBox();
  if (rim.boundingBox) rim.translate(0, BOARD.RIM_TOP - rim.boundingBox.max.y, 0);
  // THREE WOODS, not one. A handmade board is never turned from a single
  // board: the frame is a paler wood than the dark squares, and the corners
  // are pegged in brass. Without that the whole object collapses into one
  // brown silhouette — which is exactly what the first render did.
  const rimParts: THREE.BufferGeometry[] = [rim];
  const studParts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const b = new THREE.SphereGeometry(0.12, 10, 7);
      b.scale(1, 0.55, 1);
      b.translate(sx * (half - 0.34), BOARD.RIM_TOP, sz * (half - 0.34));
      studParts.push(b);
    }
  }

  /* ---- what it stands on ---- */
  if (stand !== "none") {
    const under = -BOARD.SLAB - BOARD.LIP; // underside of the board itself
    const plinthTop = under;
    const plinthBot = under - 0.2;
    const base = new THREE.BoxGeometry(half * 2 + 0.5, 0.2, half * 2 + 0.5);
    base.translate(0, (plinthTop + plinthBot) / 2, 0);
    bodyParts.push(base);

    if (stand === "plinth") {
      // Four squat feet so the board sits ON the snow rather than in it.
      const footH = STAND_HEIGHT.plinth + plinthBot;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const f = new THREE.CylinderGeometry(0.4, 0.34, footH, 12);
          f.translate(sx * (half - 0.6), plinthBot - footH / 2, sz * (half - 0.6));
          bodyParts.push(f);
        }
      }
    } else {
      // A proper little table: four turned legs splayed out, and a cross
      // stretcher low down so it does not read as a wobbly card table.
      const legTop = plinthBot;
      const legLen = STAND_HEIGHT.table + legTop;
      const splay = 0.13;
      const inset = half - 0.95;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const leg = turnedLeg(legLen, 10);
          leg.translate(0, -legLen, 0); // hang from the origin
          const d = new THREE.Vector3(sx, 0, sz).normalize();
          const axis = new THREE.Vector3(d.z, 0, -d.x);
          // Negative angle swings the FOOT outward and keeps the top tucked
          // under the board — the other sign gives you a fainting giraffe.
          leg.applyMatrix4(new THREE.Matrix4().makeRotationAxis(axis, -splay));
          leg.translate(sx * inset, legTop, sz * inset);
          bodyParts.push(leg);
        }
      }
      const strY = legTop - legLen * 0.66;
      const spread = inset + Math.sin(splay) * legLen * 0.66;
      for (const along of [0, 1]) {
        const s = new THREE.BoxGeometry(along ? 0.16 : spread * 2, 0.16, along ? spread * 2 : 0.16);
        s.translate(0, strY, 0);
        bodyParts.push(s);
      }
      const knob = new THREE.SphereGeometry(0.26, 12, 9);
      knob.scale(1, 0.8, 1);
      knob.translate(0, strY, 0);
      bodyParts.push(knob);
    }
  }

  /** Merge, shade, ink, and hand back — used once per wood. */
  const woodMesh = (parts: THREE.BufferGeometry[], mat: ToonMaterial, ink: number) => {
    const geo = mergeGeometries(parts);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.raycast = () => {};
    if (ink > 0) {
      const hull = smoothNormalsForOutline(geo);
      geometries.push(hull);
      const line = addOutline(mesh, { thickness: ink, fadeStart: 50, fadeEnd: 160 });
      line.geometry = hull;
      materials.push(line.material as THREE.Material);
    }
    group.add(mesh);
    return mesh;
  };

  woodMesh(
    bodyParts,
    toon({
      color: 0xffffff,
      ramp: "wood",
      map: woodMap,
      // Furniture, not a hero: a modest rim so the board's edge separates from
      // the snow without competing with the pieces standing on it.
      rim: 0.44,
      rimPower: 3.0,
      bounce: 0.24,
    }),
    2.4
  );

  woodMesh(
    rimParts,
    toon({
      color: 0xffffff,
      ramp: "wood",
      map: woodTexture(mix(PALETTE.walnutLight, PALETTE.cream, 0.3), seed + 11),
      rim: 0.5,
      rimPower: 2.8,
      bounce: 0.26,
    }),
    2.2
  );

  woodMesh(
    studParts,
    toon({
      color: PALETTE.honeyDeep,
      ramp: "hero",
      rim: 0.8,
      rimPower: 2.2,
      bounce: 0.16,
    }),
    1.8
  );

  /* ---- the painted coordinates ---- */
  const labelParts: THREE.BufferGeometry[] = [
    flatQuad(-half, half, -half, -BOARD.HALF, 0),
    flatQuad(-half, half, BOARD.HALF, half, 0),
    flatQuad(-half, -BOARD.HALF, -BOARD.HALF, BOARD.HALF, 0),
    flatQuad(BOARD.HALF, half, -BOARD.HALF, BOARD.HALF, 0),
  ];
  for (const q of labelParts) remapUV(q, half);
  const labelGeo = mergeGeometries(labelParts);
  geometries.push(labelGeo);
  const labelMat = new THREE.MeshBasicMaterial({
    map: rimLabelTexture(orientation, seed),
    transparent: true,
    depthWrite: false,
    // Unlit, but knocked well down so the letters read as PAINT soaked into
    // the wood rather than as glowing decals stuck on top.
    color: 0xb08c5e,
    toneMapped: true,
  });
  materials.push(labelMat);
  const labels = new THREE.Mesh(labelGeo, labelMat);
  labels.position.y = BOARD.RIM_TOP + 0.006;
  labels.renderOrder = 4;
  labels.raycast = () => {};
  labels.layers.set(NO_INK_LAYER); // painted, not carved: nothing to ink
  group.add(labels);

  return { group, materials, geometries };
}

/* ================================================================== *
 * PIECE VIEWS
 * ================================================================== */

interface PieceView {
  id: number;
  type: PieceType;
  color: Color;
  tone: PieceTone;
  square: Square;
  mesh: THREE.Mesh;
  /** cached height of this piece — drives its collider box */
  top: number;
  /** live position on the board plane */
  x: number;
  z: number;
  /**
   * An in-flight slide (or, for a knight, a hop). `bowZ` swings the path
   * sideways off the straight line — used by exactly one move in chess, and
   * left at 0 for every other, so it cannot affect anything else.
   */
  travel: {
    fx: number;
    fz: number;
    tx: number;
    tz: number;
    t: number;
    dur: number;
    arc: number;
    bowZ: number;
  } | null;
  lift: Spring;
  tiltX: Spring;
  tiltZ: Spring;
  grow: Spring;
  /** Which way it is turned. See lookTargetFor() for who it is looking at. */
  look: Spring;
  phase: number;
  born: number;
  /** seconds into the leaving-the-board animation, or -1 while alive */
  retire: number;
}

class PiecePool {
  private free = new Map<string, THREE.Mesh[]>();
  constructor(
    private readonly parent: THREE.Group,
    private readonly outline: number,
    private readonly quality: "high" | "low"
  ) {}

  acquire(type: PieceType, tone: PieceTone): THREE.Mesh {
    const key = `${type}${tone}`;
    const bucket = this.free.get(key);
    const reused = bucket && bucket.pop();
    if (reused) {
      reused.visible = true;
      return reused;
    }
    const pair = facedPieceGeometry(type, tone, this.quality);
    const mesh = new THREE.Mesh(pair.shade, pieceMaterial(tone));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.raycast = () => {}; // hit testing happens on the square colliders
    if (this.outline > 0) {
      const ink = addOutline(mesh, { thickness: this.outline, fadeStart: 34, fadeEnd: 110 });
      // Hard edges (crenels, muzzle, the king's cross) tear the hull open
      // unless it is built from smoothed normals.
      ink.geometry = pair.hull;
      ink.raycast = () => {};
    }
    this.parent.add(mesh);
    return mesh;
  }

  release(mesh: THREE.Mesh, type: PieceType, tone: PieceTone) {
    mesh.visible = false;
    const key = `${type}${tone}`;
    const bucket = this.free.get(key) ?? [];
    bucket.push(mesh);
    this.free.set(key, bucket);
  }
}

/* ================================================================== *
 * THE PROMOTION PICKER
 * ================================================================== */

interface PromoRig {
  group: THREE.Group;
  choices: THREE.Group[];
  dispose(): void;
}

/**
 * Four big pieces on a parchment tray, on little honey plinths, turning
 * slowly. No text, no dropdown, no letter codes — a five-year-old points at
 * the one they want.
 */
function buildPromoRig(tone: PieceTone, quality: "high" | "low"): PromoRig {
  const group = new THREE.Group();
  const owned: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const SPACING = 1.55;
  const half = ((PROMOTION_CHOICES.length - 1) * SPACING) / 2;

  const trayGeo = new THREE.BoxGeometry(PROMOTION_CHOICES.length * SPACING + 0.5, 0.26, 1.8);
  geos.push(trayGeo);
  const trayMat = createToonMaterial({
    color: 0xfff2d8,
    ramp: "soft",
    map: parchmentTexture(5),
    rim: 0.7,
    rimPower: 2.4,
    bounce: 0.3,
    emissive: PALETTE.honey,
    emissiveIntensity: 0.14,
  });
  patchMaterialForBandedFog(trayMat);
  owned.push(trayMat);
  const tray = new THREE.Mesh(trayGeo, trayMat);
  tray.castShadow = true;
  tray.raycast = () => {};
  // Every addOutline() here mints its own material; the picker is built and
  // torn down once per promotion, so each one has to be owned and released.
  owned.push(addOutline(tray, { thickness: 2.6, fadeStart: 40, fadeEnd: 120 }).material as THREE.Material);
  group.add(tray);

  // A warm pool of light under the tray so it reads as lit from within — the
  // tray should feel like something ChessPaa just set down, glowing.
  const glowGeo = new THREE.PlaneGeometry(PROMOTION_CHOICES.length * SPACING + 3.2, 4.2);
  geos.push(glowGeo);
  const glowMat = new THREE.MeshBasicMaterial({
    map: glowSprite(PALETTE.lanternCore),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.5,
  });
  owned.push(glowMat);
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(0, -0.02, 0.2);
  glow.renderOrder = 3;
  glow.raycast = () => {};
  glow.layers.set(NO_INK_LAYER);
  group.add(glow);

  const plinthMat = createToonMaterial({
    color: PALETTE.honey,
    ramp: "hero",
    rim: 0.75,
    rimPower: 2.6,
    bounce: 0.2,
  });
  patchMaterialForBandedFog(plinthMat);
  owned.push(plinthMat);

  const choices: THREE.Group[] = [];
  PROMOTION_CHOICES.forEach((p, i) => {
    const slot = new THREE.Group();
    slot.position.set(i * SPACING - half, 0.13, 0);

    const plinthGeo = new THREE.CylinderGeometry(0.56, 0.64, 0.16, 16);
    geos.push(plinthGeo);
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.y = 0.08;
    plinth.castShadow = true;
    plinth.raycast = () => {};
    owned.push(addOutline(plinth, { thickness: 2.2, fadeStart: 40, fadeEnd: 120 }).material as THREE.Material);
    slot.add(plinth);

    const pair = facedPieceGeometry(p as PieceType, tone, quality);
    const mesh = new THREE.Mesh(pair.shade, pieceMaterial(tone));
    mesh.position.y = 0.16;
    // Bigger than life. This is the moment the piece is the star.
    mesh.scale.setScalar(1.15);
    mesh.castShadow = true;
    mesh.raycast = () => {};
    const ink = addOutline(mesh, { thickness: 3.0, fadeStart: 34, fadeEnd: 110 });
    ink.geometry = pair.hull; // the cached hull — shared, never disposed here
    owned.push(ink.material as THREE.Material);
    slot.add(mesh);

    group.add(slot);
    choices.push(slot);
  });

  return {
    group,
    choices,
    dispose() {
      for (const m of owned) m.dispose();
      for (const g of geos) g.dispose();
    },
  };
}

function PromotionPicker({
  tone,
  quality,
  position,
  onPick,
}: {
  tone: PieceTone;
  quality: "high" | "low";
  position: [number, number, number];
  onPick: (piece: string) => void;
}) {
  const rig = useMemo(() => buildPromoRig(tone, quality), [tone, quality]);
  useEffect(() => () => rig.dispose(), [rig]);
  const root = useRef<THREE.Group>(null);
  const hover = useRef(-1);
  const born = useRef(-1);
  const camera = useThree((s) => s.camera);

  useFrame((state, dtRaw) => {
    const g = root.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const dt = Math.min(0.05, dtRaw);
    if (born.current < 0) born.current = t;
    const age = t - born.current;

    // Always face the player, upright. Yaw only — a tray that tips toward the
    // camera in pitch looks like a bug, not like a presentation.
    const cam = camera.getWorldPosition(_v1);
    const here = g.getWorldPosition(_v2);
    g.rotation.y = Math.atan2(cam.x - here.x, cam.z - here.z);

    // Arrive with a small pop; then breathe.
    const pop = Math.min(1, age / 0.34);
    const ease = 1 - Math.pow(1 - pop, 3);
    g.scale.setScalar(ease * (1 + Math.sin(pop * Math.PI) * 0.08));
    g.position.y = position[1] + (1 - ease) * -0.5 + Math.sin(t * 1.4) * 0.03;

    rig.choices.forEach((slot, i) => {
      const up = hover.current === i ? 1 : 0;
      const stagger = Math.max(0, Math.min(1, (age - i * 0.05) / 0.3));
      const target = 0.13 + up * 0.22 + Math.sin(t * 1.7 + i * 1.2) * 0.035;
      slot.position.y += (target - slot.position.y) * (1 - Math.exp(-dt * 14));
      slot.scale.setScalar(Math.max(0.001, stagger) * (1 + up * 0.1));
      // Each piece turns on its plinth, out of step with its neighbours, so
      // the row reads as four characters rather than one four-headed thing.
      const spin = slot.children[1];
      if (spin) spin.rotation.y = t * 0.7 + i * 0.9;
    });
  });

  return (
    <group ref={root} position={position}>
      <primitive object={rig.group} />
      {PROMOTION_CHOICES.map((p, i) => {
        const SPACING = 1.55;
        const half = ((PROMOTION_CHOICES.length - 1) * SPACING) / 2;
        return (
          <mesh
            key={p}
            position={[i * SPACING - half, 1.1, 0]}
            onPointerDown={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              onPick(p);
            }}
            onPointerOver={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              hover.current = i;
            }}
            onPointerOut={() => {
              if (hover.current === i) hover.current = -1;
            }}
          >
            {/* Deliberately far bigger than the piece it covers. */}
            <boxGeometry args={[1.5, 2.6, 1.6]} />
            <meshBasicMaterial visible={false} />
          </mesh>
        );
      })}
    </group>
  );
}

/* ================================================================== *
 * THE BOARD'S OWN GOLDEN HOUR
 * ================================================================== */

/**
 * A key/fill/bounce rig that travels WITH the board, for menus, shot rigs and
 * anywhere outside the park's own lighting.
 *
 * Built by hand rather than as JSX because two defaults are wrong here and
 * both are silent:
 *
 *  1. three aims a directional light from its position at `light.target`, and
 *     the default target is a loose Object3D whose world matrix is the
 *     identity — i.e. the WORLD ORIGIN. A board standing anywhere else in the
 *     park (the gate is at 4,46) was therefore lit from a direction with
 *     nothing to do with the board, and its shadows were cast off into the
 *     snow. The target here is a child of the deck, so the rig rides along.
 *  2. the default shadow camera is a 10-unit box. The board is 9.36 across and
 *     13.2 on the diagonal, so the corners fell outside it and the shadows
 *     were clipped square.
 */
function buildOwnLight(): THREE.Group {
  const g = new THREE.Group();
  g.name = "board-own-light";

  // Everything aims here, and "here" is the middle of the playing surface.
  const target = new THREE.Object3D();
  g.add(target);

  const key = new THREE.DirectionalLight(PALETTE.honey, 2.1);
  key.position.set(6, 9, 7);
  key.target = target;
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const cam = key.shadow.camera;
  cam.left = -8;
  cam.right = 8;
  cam.top = 8;
  cam.bottom = -8;
  cam.near = 0.5;
  cam.far = 34;
  cam.updateProjectionMatrix(); // nothing else ever will
  // Thirty-two thin turned pieces on a flat board is the worst case for shadow
  // acne; a normal bias beats a depth bias here because it does not detach the
  // contact shadow from the foot of the piece.
  key.shadow.normalBias = 0.024;
  key.shadow.bias = -0.0008;
  g.add(key);

  const fill = new THREE.DirectionalLight(PALETTE.fillLavender, 0.5);
  fill.position.set(-7, 4, -5);
  fill.target = target;
  g.add(fill);

  g.add(new THREE.HemisphereLight(PALETTE.skyMid, PALETTE.honeyDeep, 0.75));
  return g;
}

/* ================================================================== *
 * SCRATCH — module-level so the hot path allocates nothing
 * ================================================================== */

const _v1 = /* @__PURE__ */ new THREE.Vector3();
const _v2 = /* @__PURE__ */ new THREE.Vector3();
const _v3 = /* @__PURE__ */ new THREE.Vector3();
const _hold = /* @__PURE__ */ new THREE.Vector3();
const _ndc = /* @__PURE__ */ new THREE.Vector2();
const _ray = /* @__PURE__ */ new THREE.Ray();
const _mat = /* @__PURE__ */ new THREE.Matrix4();
const _raycaster = /* @__PURE__ */ new THREE.Raycaster();
const _q = /* @__PURE__ */ new THREE.Quaternion();
/** Reused so the hot path never allocates a Map per frame. */
const _occupancy = /* @__PURE__ */ new Map<string, number>();

/** Wrap an angle into -PI..PI so "turn to look" never takes the long way round. */
function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Yaw that turns a piece's +Z (its face) toward a point on the board plane. */
function yawToward(fromX: number, fromZ: number, toX: number, toZ: number, fallback: number): number {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  // Directly overhead, or standing on the target: keep whatever we had.
  if (dx * dx + dz * dz < 1e-6) return fallback;
  return Math.atan2(dx, dz);
}

/**
 * THE PIECES LOOK AT THE CHILD.
 *
 * The obvious thing is to have each army face the other, and the first render
 * showed exactly why that is wrong: the camera sits on White's side, so half
 * the cast were characters with faces and half were the backs of heads. In
 * every animated film the toys turn and look at you — so they do here.
 *
 * The exception is the moment it matters most: a piece in flight turns to
 * face WHERE IT IS GOING, which is when a child is actually watching it, and
 * everybody else turns to watch the piece in your hand.
 */
function lookTargetFor(
  v: PieceView,
  camX: number,
  camZ: number,
  held: boolean,
  hold: THREE.Vector3 | null
): number {
  if (v.travel && !held) {
    const dx = v.travel.tx - v.travel.fx;
    const dz = v.travel.tz - v.travel.fz;
    if (dx * dx + dz * dz > 1e-6) return Math.atan2(dx, dz);
  }
  if (hold && !held) return yawToward(v.x, v.z, hold.x, hold.z, v.look.value);
  return yawToward(v.x, v.z, camX, camZ, v.look.value);
}

/**
 * Pieces are turned a hair smaller than their square so a rank of eight has
 * air in it. At 1.0 they touch, and a crowded board reads as a spreadsheet.
 */
const PIECE_FIT = 0.86;

/**
 * How long "this one is stuck right now" plays for.
 *
 * Not shorter: the overlay cross-fade takes about 0.2 s to bring a marker up
 * and 0.23 s to take it away, so anything under ~0.6 s never reaches full
 * brightness before it starts leaving and reads as a glitch rather than as an
 * answer. A second tap on another piece cancels it outright, so it is never
 * something an impatient child has to wait out.
 */
const REFUSE_TIME = 0.7;

/* ================================================================== *
 * THE COMPONENT
 * ================================================================== */

export default function Board3D({
  fen,
  orientation = "white",
  interactive = true,
  legalFor = "both",
  lastMove = null,
  highlight,
  onMove,
  onSelect,
  position = [0, 0, 0],
  scale = 1,
  stand = "plinth",
  ownLight = false,
  seed = 13,
  outline = 2.7,
  quality = "high",
}: Board3DProps) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  /* ---------------- the object ---------------- */

  const build = useMemo(() => {
    const deck = new THREE.Group();
    deck.name = "board-deck";
    const furniture = buildFurniture(orientation, stand, seed);
    // The furniture is authored with the playing surface at y = 0; the whole
    // deck is then lifted by the stand's height in JSX, so the component's
    // `position` prop can be a point on the GROUND.
    deck.add(furniture.group);

    const overlay = buildOverlay();
    deck.add(overlay.mesh);

    const pieces = new THREE.Group();
    pieces.name = "board-pieces";
    deck.add(pieces);
    const pool = new PiecePool(pieces, outline, quality);

    // Contact shadows for all thirty-two pieces in one instanced draw call.
    // Without these the pieces hover; the park's real shadow map is too soft
    // at this scale to sell contact on its own.
    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: glowSprite(mix(PALETTE.ink, PALETTE.plumDeep, 0.35)),
      transparent: true,
      // Light enough to sit UNDER the real shadow map rather than fight it.
      opacity: 0.20,
      depthWrite: false,
    });
    const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, 40);
    shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    shadows.frustumCulled = false;
    shadows.renderOrder = 5;
    shadows.raycast = () => {};
    shadows.layers.set(NO_INK_LAYER);
    shadows.count = 0;
    deck.add(shadows);

    // THE CHECK GLOW: a pool of red light spilling across the squares around
    // the king in trouble. It lies FLAT on the board rather than billboarding
    // upright — an upright card reads as a lens flare floating behind the
    // piece, which is what the first pass looked like.
    const checkGeo = new THREE.PlaneGeometry(2.8, 2.8);
    checkGeo.rotateX(-Math.PI / 2);
    const checkMat = new THREE.MeshBasicMaterial({
      map: glowSprite(PALETTE.scarfRed),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.0,
    });
    const checkGlow = new THREE.Mesh(checkGeo, checkMat);
    checkGlow.visible = false;
    checkGlow.renderOrder = 7;
    checkGlow.raycast = () => {};
    checkGlow.layers.set(NO_INK_LAYER);
    deck.add(checkGlow);

    // One shared burst of sparks, moved to wherever something just happened.
    const sparkles = new Sparkles(18, seed * 31 + 5, 0.9);
    deck.add(sparkles.points);

    return {
      deck,
      furniture,
      overlay,
      pieces,
      pool,
      shadows,
      shadowGeo,
      shadowMat,
      checkGlow,
      checkGeo,
      checkMat,
      sparkles,
    };
  }, [orientation, stand, seed, outline, quality]);

  useEffect(() => {
    return () => {
      for (const m of build.furniture.materials) m.dispose();
      for (const g of build.furniture.geometries) g.dispose();
      build.overlay.material.dispose();
      build.overlay.texture.dispose();
      build.overlay.mesh.geometry.dispose();
      build.shadowGeo.dispose();
      build.shadowMat.dispose();
      build.checkGeo.dispose();
      build.checkMat.dispose();
      build.sparkles.dispose();
      // addOutline() mints a FRESH inverted-hull material for every mesh it is
      // given, so the pool's thirty-two pieces carry thirty-two of them.
      // Flipping the board or changing quality throws this whole deck away;
      // without this the ink materials would quietly pile up, one set per
      // flip. Their geometry is the shared cache and must NOT be touched.
      build.pieces.traverse((o) => {
        if (o.name !== "__outline") return;
        const m = (o as THREE.Mesh).material;
        if (m && !Array.isArray(m)) m.dispose();
      });
    };
  }, [build]);

  /* ---------------- live state (refs: this must not re-render per frame) --- */

  const views = useRef(new Map<number, PieceView>());
  const nextId = useRef(1);
  const mintId = useCallback(() => nextId.current++, []);
  const deckRef = useRef<THREE.Group>(null);
  const clockRef = useRef(0);

  const ix = useRef<{
    phase: Phase;
    pointerId: number | null;
    pointerType: string;
    startX: number;
    startY: number;
    dragging: boolean;
    at: THREE.Vector2;
    vel: THREE.Vector2;
    hover: Square | null;
    /** hold the dropped piece still for a beat so it cannot flinch */
    holdUntil: number;
    cursor: string;
    /** the square that just answered "not me, not right now" */
    refuse: Square | null;
    /** which view is shaking its head, and until when */
    refuseId: number;
    refuseUntil: number;
  }>({
    phase: { kind: "idle" },
    pointerId: null,
    pointerType: "mouse",
    startX: 0,
    startY: 0,
    dragging: false,
    at: new THREE.Vector2(),
    vel: new THREE.Vector2(),
    hover: null,
    holdUntil: 0,
    cursor: "",
    refuse: null,
    refuseId: -1,
    refuseUntil: 0,
  });

  const [promo, setPromo] = useState<{ from: Square; to: Square; tone: PieceTone } | null>(null);

  // The window listeners below outlive any single render, so the current
  // props have to be reachable through a ref or they go stale mid-drag.
  const propsRef = useRef({ fen, orientation, interactive, legalFor, onMove, onSelect, lastMove, highlight });
  propsRef.current = { fen, orientation, interactive, legalFor, onMove, onSelect, lastMove, highlight };

  /* ---------------- FEN -> tracked pieces ---------------- */

  // Rebuilding the board (flipping it, changing quality) throws away the deck
  // every mesh was parented to. Declared BEFORE the diff effect so React runs
  // it first and the diff repopulates into the new deck.
  useEffect(() => {
    views.current.clear();
    nextId.current = 1;
  }, [build]);

  useEffect(() => {
    const prev: TrackedPiece[] = [...views.current.values()]
      .filter((v) => v.retire < 0)
      .map((v) => ({ id: v.id, type: v.type, color: v.color, square: v.square }));

    const diff = diffPlacement(prev, fen, lastMove, mintId);
    const t = clockRef.current;
    const keep = new Set<number>();

    /**
     * CASTLING: THE ROOK HOPS THE KING.
     *
     * The two halves of a castle cross each other on the same rank, over the
     * same distance, in the same number of milliseconds, on the same shallow
     * arc — so about six tenths of the way through they arrive at the same
     * point at the same height and the two pieces briefly become one lump of
     * wood. (Measured: the gap closes to 0.024 of a square, against bodies
     * about 0.8 of a square wide.)
     *
     * Lifting the rook over the king fixes the collision and happens to be
     * exactly the right thing to show a child about the only move in chess
     * where two of your own pieces trade places.
     */
    const castledRookId = (() => {
      const kind = new Map(diff.pieces.map((p) => [p.id, p.type]));
      const kingJumped = diff.moved.some((m) => {
        if (kind.get(m.id) !== "k") return false;
        const a = squareToFileRank(m.from);
        const b = squareToFileRank(m.to);
        return !!a && !!b && Math.abs(b.file - a.file) === 2;
      });
      if (!kingJumped) return -1;
      // Only one piece moves in a ply, so the one rook that also moved is
      // necessarily the one the king dragged along.
      return diff.moved.find((m) => kind.get(m.id) === "r")?.id ?? -1;
    })();

    for (const p of diff.pieces) {
      keep.add(p.id);
      const tone: PieceTone = p.color === "w" ? "light" : "dark";
      let v = views.current.get(p.id);

      if (v && v.type !== p.type) {
        // A promotion: the pawn becomes something else on the spot. Swap the
        // mesh, keep the identity, and throw sparks.
        build.pool.release(v.mesh, v.type, v.tone);
        v.mesh = build.pool.acquire(p.type, tone);
        v.type = p.type;
        v.tone = tone;
        v.top = facedPieceGeometry(p.type, tone, quality).top;
        v.grow.snap(0.25);
        build.sparkles.points.position.set(v.x, 0.5, v.z);
        build.sparkles.burst();
      }

      if (!v) {
        const c = squareCenter(p.square, orientation);
        v = {
          id: p.id,
          type: p.type,
          color: p.color,
          tone,
          square: p.square,
          mesh: build.pool.acquire(p.type, tone),
          top: facedPieceGeometry(p.type, tone, quality).top,
          x: c.x,
          z: c.z,
          travel: null,
          lift: new Spring(0, 0.1),
          tiltX: new Spring(0, 0.09),
          tiltZ: new Spring(0, 0.09),
          // Pieces pop into being rather than blinking on.
          grow: new Spring(0.2, 0.12, 0.62),
          look: new Spring(0, 0.3),
          phase: rng(p.id * 7919 + 11)(),
          born: t,
          retire: -1,
        };
        views.current.set(p.id, v);
      } else if (v.square !== p.square) {
        const to = squareCenter(p.square, orientation);
        // Start from where the piece VISUALLY is, not from its old square —
        // otherwise a piece you just dragged snaps back before it slides.
        const dist = Math.hypot(to.x - v.x, to.z - v.z);
        const castling = v.id === castledRookId;
        v.travel = {
          fx: v.x,
          fz: v.z,
          tx: to.x,
          tz: to.z,
          t: 0,
          dur: Math.min(0.52, 0.2 + dist * 0.045),
          // A knight JUMPS. Teaching that it goes over things costs one
          // number here and saves a paragraph of explanation later.
          arc: v.type === "n" ? 0.62 : castling ? 0.35 : 0.13,
          /**
           * ...and the castling rook goes AROUND, not through.
           *
           * Hopping over was the obvious answer and it does not work: a rook
           * would have to lob 2.2 squares straight up to clear the king's
           * crown, which on a toy board this size looks like it was fired out
           * of a mortar. Swinging out sideways needs only 0.9 of a square.
           *
           * Outward, away from the middle. Castling only ever happens on rank
           * 1 or rank 8, so "outward" is over the rim — where there is never
           * anything standing — while inward would drag the rook straight
           * through its own pawns. The 0.35 arc is what lifts it over the
           * rim's lip on the way past. Measured clearance from the king at
           * the closest point: 0.85 of a square against the 0.80 the two
           * bodies need.
           */
          bowZ: castling ? (to.z >= 0 ? 0.9 : -0.9) : 0,
        };
      }

      v.square = p.square;
      v.color = p.color;
      v.grow.to(1);
    }

    // Anything that fell off the board leaves with a comic little pop.
    for (const v of views.current.values()) {
      if (v.retire >= 0.55) {
        // Belt and braces: if a pop was ever left half-played (a backgrounded
        // tab, a stalled frame loop), clear it now rather than leave a ghost
        // piece lying on the board.
        build.pool.release(v.mesh, v.type, v.tone);
        views.current.delete(v.id);
        continue;
      }
      if (v.retire < 0 && !keep.has(v.id)) {
        v.retire = 0;
        build.sparkles.points.position.set(v.x, 0.5, v.z);
        build.sparkles.burst();
      }
    }

    // A new position means anything half-picked-up is no longer meaningful.
    if (ix.current.phase.kind !== "idle") {
      ix.current.phase = { kind: "idle" };
      ix.current.dragging = false;
      // onSelect has to be told, or the tutor and the sound layer go on
      // believing a piece is still in the child's hand after the opponent has
      // already moved — a stuck highlight and a lift sound that never lands.
      propsRef.current.onSelect?.(null);
    }
    setPromo(null);
    // `orientation` deliberately included: flipping the board re-homes everyone.
  }, [fen, lastMove, orientation, quality, build, mintId]);

  /* ---------------- pointer plumbing ---------------- */

  /** Project a screen point onto a horizontal plane in DECK space. */
  const pointOnDeck = useCallback(
    (clientX: number, clientY: number, planeY: number): THREE.Vector3 | null => {
      const deck = deckRef.current;
      if (!deck) return null;
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      _raycaster.setFromCamera(_ndc, camera);
      deck.updateWorldMatrix(true, false);
      _mat.copy(deck.matrixWorld).invert();
      _ray.copy(_raycaster.ray).applyMatrix4(_mat);
      // Solving in deck space means any parent transform (scale, the park's
      // own placement, a moving camera rig) is handled for free.
      const dy = _ray.direction.y;
      if (Math.abs(dy) < 1e-6) return null;
      const t = (planeY - _ray.origin.y) / dy;
      if (t <= 0) return null;
      return _v3.copy(_ray.direction).multiplyScalar(t).add(_ray.origin);
    },
    [gl, camera]
  );

  /** How high the carried piece rides, and how far up-screen it is nudged. */
  const carryOffsets = useCallback(
    (pointerType: string) => {
      const touch = pointerType === "touch";
      // On touch the finger sits ON the piece, so the piece is pushed AWAY
      // from the camera (which is up-screen) far enough to stay visible.
      const push = touch ? 0.62 : 0;
      return { lift: touch ? 0.8 : 0.56, push };
    },
    []
  );

  const setPhase = useCallback((p: Phase) => {
    const before = ix.current.phase;
    ix.current.phase = p;
    const beforeSq = before.kind === "idle" ? null : before.pick.from;
    const afterSq = p.kind === "idle" ? null : p.pick.from;
    // onSelect is for sound and for the tutor; it must not fire on every
    // pointer wiggle, only when the SELECTED SQUARE actually changes.
    if (beforeSq !== afterSq) propsRef.current.onSelect?.(afterSq);
  }, []);

  const beginPickup = useCallback(
    (pick: PickupInfo, t: number) => {
      setPhase({ kind: "armed", pick });
      // Something IS liftable, so any head-shake still playing is stale.
      ix.current.refuse = null;
      ix.current.refuseId = -1;
      // Stagger the dots outward from the piece so they arrive as a RIPPLE.
      // It is one line of code and it is the difference between a UI turning
      // on and a board waking up.
      const ov = build.overlay;
      const from = squareCenter(pick.from, propsRef.current.orientation);
      ov.hold.fill(0);
      for (const sq of pick.all) {
        const c = squareCenter(sq, propsRef.current.orientation);
        const d = Math.hypot(c.x - from.x, c.z - from.z);
        ov.hold[cellIndexOfSquare(sq, propsRef.current.orientation)] = t + d * 0.028;
      }
    },
    [build, setPhase]
  );

  const commit = useCallback(
    (from: Square, to: Square) => {
      const p = propsRef.current;
      if (!isLegalMove(p.fen, from, to)) return false;
      if (needsPromotion(p.fen, from, to)) {
        const pick = pickup(p.fen, from, p.legalFor);
        if (pick) {
          setPhase({ kind: "promoting", pick, to });
          setPromo({ from, to, tone: pick.piece.color === "w" ? "light" : "dark" });
        } else {
          // The move is legal but the piece is no longer liftable — `legalFor`
          // changed under us mid-drag. Without this the board would sit there
          // showing dots for a piece it will never let go of again.
          setPhase({ kind: "idle" });
        }
        return true;
      }
      p.onMove?.(from, to);
      setPhase({ kind: "idle" });
      return true;
    },
    [setPhase]
  );

  const onColliderDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const p = propsRef.current;
      if (!p.interactive) return;
      const first = (e.object.userData.square as Square | undefined) ?? null;
      if (!first) return;
      e.stopPropagation();

      const t = clockRef.current;
      const st = ix.current.phase;

      // Tapping the board while the picker is open backs out of it — no dead
      // ends, and no modal a child cannot escape.
      if (st.kind === "promoting") {
        setPromo(null);
        setPhase({ kind: "idle" });
        return;
      }

      /**
       * THE FORGIVING TAP.
       *
       * From any camera low enough to see the pieces as pieces, a piece
       * OCCLUDES the square behind it — a pawn on f2 covers most of f3. So
       * the nearest thing the ray hits is often not the thing the child aimed
       * at, and a tap on a knight lands on the blocked pawn in front of it and
       * does nothing at all. That dead tap is the single most common way a 3D
       * board feels broken.
       *
       * So we do not take the nearest hit and give up. We walk the whole
       * intersection list, nearest first, and take the first square that has
       * something to SAY: a legal destination while a piece is in hand, or a
       * piece that can actually be lifted. Only if none of them do anything
       * does the tap clear the selection.
       */
      const candidates: Square[] = [];
      for (const hit of e.intersections) {
        const s2 = hit.object.userData.square as Square | undefined;
        if (s2 && !candidates.includes(s2)) candidates.push(s2);
        if (candidates.length >= 4) break;
      }
      if (candidates.length === 0) candidates.push(first);

      // Second tap of a tap-to-move: a legal destination always wins.
      if (st.kind === "armed") {
        for (const sq of candidates) {
          if (st.pick.all.includes(sq)) {
            commit(st.pick.from, sq);
            return;
          }
        }
      }

      let pick: PickupInfo | null = null;
      for (const sq of candidates) {
        pick = pickup(p.fen, sq, p.legalFor);
        if (pick) break;
      }

      // Tapping the piece already in hand puts it back down.
      if (st.kind === "armed" && pick && pick.from === st.pick.from) {
        setPhase({ kind: "idle" });
        return;
      }

      if (!pick) {
        /**
         * A TAP IS NEVER ALLOWED TO BE SILENT.
         *
         * A piece with no legal move is deliberately unliftable — an empty
         * ring of hints teaches nothing. But the first version then did
         * NOTHING AT ALL, and a child who taps their own pinned knight and
         * gets no answer does not conclude "that one is stuck", they conclude
         * the board is broken. That is the dead end this file swore it had
         * none of.
         *
         * So if the tap landed on one of the child's OWN pieces, the piece
         * rocks side to side — a head-shake, not a buzzer — and its square
         * blinks once. The rock has to be a ROLL rather than a turn: these
         * pieces are lathe-turned, so spinning one about its own axis is
         * completely invisible.
         */
        const turn = sideToMove(p.fen);
        if (turn) {
          for (const sq of candidates) {
            let standing: PieceView | null = null;
            for (const v of views.current.values()) {
              if (v.retire < 0 && v.square === sq) {
                standing = v;
                break;
              }
            }
            if (standing && standing.color === turn) {
              ix.current.refuse = sq;
              ix.current.refuseId = standing.id;
              ix.current.refuseUntil = t + REFUSE_TIME;
              break;
            }
          }
        }
        // Empty squares, wrong colour, or pieces with nowhere to go.
        if (st.kind !== "idle") setPhase({ kind: "idle" });
        return;
      }

      beginPickup(pick, t);
      ix.current.pointerId = e.pointerId;
      ix.current.pointerType = e.pointerType ?? "mouse";
      ix.current.startX = e.clientX;
      ix.current.startY = e.clientY;
      ix.current.dragging = false;
      ix.current.vel.set(0, 0);
      const c = squareCenter(pick.from, p.orientation);
      ix.current.at.set(c.x, c.z);
      try {
        gl.domElement.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety; the window listeners are the guarantee */
      }
    },
    [beginPickup, commit, gl, setPhase]
  );

  const onColliderMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    // Mouse hover only — during a drag the window listener owns the pointer.
    if (ix.current.pointerId !== null) return;
    ix.current.hover = (e.object.userData.square as Square | undefined) ?? null;
  }, []);

  const onColliderOut = useCallback(() => {
    if (ix.current.pointerId === null) ix.current.hover = null;
  }, []);

  useEffect(() => {
    const onMovePointer = (e: PointerEvent) => {
      const s = ix.current;
      if (s.pointerId === null || e.pointerId !== s.pointerId) return;
      const p = propsRef.current;
      const phase = s.phase;
      if (phase.kind !== "armed" && phase.kind !== "dragging") return;

      if (!s.dragging) {
        const moved = Math.hypot(e.clientX - s.startX, e.clientY - s.startY);
        if (moved < dragThreshold(s.pointerType)) return;
        s.dragging = true;
      }

      const { lift, push } = carryOffsets(s.pointerType);
      const hit = pointOnDeck(e.clientX, e.clientY, lift);
      if (!hit) return;

      let hx = hit.x;
      let hz = hit.z;
      if (push > 0) {
        // Push the piece away from the camera along the board plane, which on
        // screen means UP — out from under the thumb holding it.
        camera.getWorldDirection(_v1);
        _v1.y = 0;
        if (_v1.lengthSq() > 1e-6) {
          _v1.normalize();
          // The deck may be rotated or scaled by the park; convert the world
          // direction into deck space before using it.
          const deck = deckRef.current;
          if (deck) {
            deck.getWorldQuaternion(_q);
            _v1.applyQuaternion(_q.invert());
            _v1.y = 0;
            if (_v1.lengthSq() > 1e-6) _v1.normalize();
          }
          hx += _v1.x * push;
          hz += _v1.z * push;
        }
      }

      s.vel.set(hx - s.at.x, hz - s.at.y);
      s.at.set(hx, hz);
      const pick = phase.pick;
      const over = snapToTarget(hx, hz, pick.all, p.orientation) ?? nearestSquare(hx, hz, p.orientation);
      // Straight assignment, not setPhase: the selected square has not
      // changed, so the tutor does not need waking on every pixel.
      s.phase = { kind: "dragging", pick, over };
      s.hover = over;
    };

    const onUpPointer = (e: PointerEvent) => {
      const s = ix.current;
      if (s.pointerId === null || e.pointerId !== s.pointerId) return;
      s.pointerId = null;
      try {
        gl.domElement.releasePointerCapture(e.pointerId);
      } catch {
        /* it may already be gone */
      }
      if (!s.dragging) return; // a tap: stay armed, dots keep showing
      s.dragging = false;
      const phase = s.phase;
      if (phase.kind !== "dragging") return;

      const p = propsRef.current;
      const pick = phase.pick;
      // GENTLE SNAPPING: a drop that lands near a legal square counts.
      const target = snapToTarget(s.at.x, s.at.y, pick.all, p.orientation);
      s.holdUntil = clockRef.current + 0.12; // no flinch while React catches up
      if (target && commit(pick.from, target)) return;
      // Nothing legal under the finger: the piece simply springs home. Never
      // an error, never a shake, never a noise that says "wrong".
      setPhase({ kind: "idle" });
    };

    window.addEventListener("pointermove", onMovePointer, { passive: true });
    window.addEventListener("pointerup", onUpPointer);
    window.addEventListener("pointercancel", onUpPointer);
    return () => {
      window.removeEventListener("pointermove", onMovePointer);
      window.removeEventListener("pointerup", onUpPointer);
      window.removeEventListener("pointercancel", onUpPointer);
    };
  }, [carryOffsets, pointOnDeck, camera, gl, commit, setPhase]);

  /* ---------------- the collider grid ---------------- */

  /**
   * TWO TIERS OF HIT TARGET, and the split matters.
   *
   *  - the SLAB is a wide, flat pad over every square. It is what a thumb
   *    lands on, it is bigger than the square itself, and because it is only
   *    a finger thick it can never steal a tap meant for the square behind.
   *  - the BODY is a tall, narrower box standing only where a piece stands.
   *    It claims taps on the piece's own silhouette — its head included — so
   *    tapping a king's crown picks up the king.
   *
   * The first version used one tall wide box per square, and a tall piece
   * then swallowed taps aimed at its neighbour: the ray from a raised camera
   * passes THROUGH the king's airspace on its way to the square behind him.
   * Narrowing the tall box to the piece's own width makes the volume match
   * what is actually drawn, which is the only rule a player can predict.
   */
  const colliderGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const colliderMat = useMemo(() => new THREE.MeshBasicMaterial({ visible: false }), []);
  useEffect(() => {
    return () => {
      colliderGeo.dispose();
      colliderMat.dispose();
    };
  }, [colliderGeo, colliderMat]);

  const squares = useMemo(() => {
    const out: Array<{ sq: Square; x: number; z: number }> = [];
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const c = fileRankCenter(f, r, orientation);
        out.push({ sq: (FILES[f] + RANKS[r]) as Square, x: c.x, z: c.z });
      }
    }
    return out;
  }, [orientation]);

  const bodyRefs = useRef<Array<THREE.Mesh | null>>([]);

  /* ---------------- the frame ---------------- */

  useEffect(() => {
    // Highlights live on the no-ink layer. Stage's camera already sees it;
    // enabling it here means the board also works in a menu or a shot rig
    // that never went through Stage.
    camera.layers.enable(NO_INK_LAYER);
  }, [camera]);

  useFrame((state, dtRaw) => {
    const t = state.clock.elapsedTime;
    const dt = Math.min(0.05, dtRaw);
    clockRef.current = t;
    const p = propsRef.current;
    const s = ix.current;
    const ov = build.overlay;
    ov.material.uniforms.uTime.value = t;

    const turn = sideToMove(p.fen);
    const check = checkedKingSquare(p.fen);

    /* ---- what should each square be showing? ---- */
    ov.want[0].fill(0);
    ov.want[1].fill(0);
    ov.wantAmp[0].fill(0);
    ov.wantAmp[1].fill(0);

    const setCell = (slot: 0 | 1, sq: string, code: number, amp = 1) => {
      const i = cellIndexOfSquare(sq, p.orientation);
      ov.want[slot][i] = code;
      ov.wantAmp[slot][i] = amp;
    };

    // Persistent slot, weakest first so the important thing wins the square.
    if (p.lastMove) {
      setCell(1, p.lastMove[0], CELL.last, 0.9);
      setCell(1, p.lastMove[1], CELL.last, 1);
    }
    if (p.highlight) {
      for (const sq of Object.keys(p.highlight)) setCell(1, sq, highlightToCell(p.highlight[sq]), 1);
    }
    if (check) setCell(1, check, CELL.check, 1);

    // Interaction slot.
    const phase = s.phase;
    // Asked ONCE per frame and shared by the hover glow and the cursor below.
    // pickup() builds four arrays every call, and asking it the same question
    // twice a frame was pure garbage for the collector to sweep back up.
    const hoverLiftable =
      s.hover !== null && p.interactive && s.pointerId === null && pickup(p.fen, s.hover, p.legalFor) !== null;
    const active: PickupInfo | null = phase.kind === "idle" ? null : phase.pick;
    if (active) {
      setCell(0, active.from, CELL.select, 1);
      for (const sq of active.quiet) setCell(0, sq, CELL.move, 1);
      for (const sq of active.captures) setCell(0, sq, CELL.capture, 1);
      if (phase.kind === "dragging" && phase.over && active.all.includes(phase.over)) {
        setCell(0, phase.over, CELL.drop, 1);
      }
      if (phase.kind === "promoting") setCell(0, phase.to, CELL.drop, 1);
    } else if (s.refuse && t < s.refuseUntil) {
      // "Not this one, not right now." Red is this board's only word for no,
      // and it breathes rather than flashes, so it reads as a shrug.
      setCell(0, s.refuse, CELL.danger, 1);
    } else if (s.hover && hoverLiftable) {
      // Mouse hover over a liftable piece: the faintest possible "yes, this one".
      setCell(0, s.hover, CELL.select, 0.42);
    }

    /* ---- cross-fade every cell toward what it should be ---- */
    const k = 1 - Math.exp(-dt * 15);
    for (let slot = 0; slot < 2; slot++) {
      const cur = ov.code[slot];
      const amp = ov.amp[slot];
      const want = ov.want[slot];
      const wantAmp = ov.wantAmp[slot];
      for (let i = 0; i < 64; i++) {
        if (cur[i] !== want[i]) {
          // Fade the old marker out completely before swapping, so a square
          // never blinks from one shape straight into another.
          amp[i] += (0 - amp[i]) * k;
          if (amp[i] < 0.03) {
            cur[i] = want[i];
            amp[i] = 0;
          }
        } else {
          const gated = slot === 0 && t < ov.hold[i] ? 0 : wantAmp[i];
          amp[i] += (gated - amp[i]) * k;
        }
        const o = i * 4 + (slot === 0 ? 0 : 2);
        ov.data[o] = cur[i];
        ov.data[o + 1] = Math.max(0, Math.min(255, Math.round(amp[i] * 255)));
      }
    }
    ov.texture.needsUpdate = true;

    /* ---- pieces ---- */
    const { lift: carryLift } = carryOffsets(s.pointerType);

    // Which view is in the player's hand right now? The FEN has not changed
    // yet, so the carried piece is still standing on the square it came from.
    let heldId: number | null = null;
    if (phase.kind === "dragging" && s.dragging) {
      for (const v of views.current.values()) {
        if (v.retire < 0 && v.square === phase.pick.from) {
          heldId = v.id;
          break;
        }
      }
    }
    const holdPos = heldId !== null ? _hold.set(s.at.x, 0, s.at.y) : null;

    // Where the child is sitting, in the board's own frame. One conversion
    // per frame serves all thirty-two pieces.
    let camX = 0;
    let camZ = 12;
    const deckObj = deckRef.current;
    if (deckObj) {
      deckObj.updateWorldMatrix(true, false);
      camera.getWorldPosition(_v1);
      deckObj.worldToLocal(_v1);
      camX = _v1.x;
      camZ = _v1.z;
    }

    let shadowCount = 0;
    const dead: number[] = [];

    for (const v of views.current.values()) {
      const mesh = v.mesh;

      /* -- leaving the board -- */
      if (v.retire >= 0) {
        v.retire += dt;
        const u = v.retire / 0.55;
        if (u >= 1) {
          build.pool.release(mesh, v.type, v.tone);
          dead.push(v.id);
          continue;
        }
        // Up, over, and out: a friendly pop, never a death.
        const e = 1 - Math.pow(1 - u, 2);
        mesh.position.set(v.x, e * 0.85, v.z);
        mesh.rotation.set(u * 1.5, v.look.value + u * 4.2, u * 0.9);
        const sc = Math.max(0.001, (1 - u * u) * (1 + Math.sin(u * Math.PI) * 0.28));
        mesh.scale.setScalar(sc * PIECE_FIT);
        continue;
      }

      /* -- where does it want to be? -- */
      const home = squareCenter(v.square, p.orientation);
      const held = v.id === heldId;

      if (held && holdPos) {
        v.travel = null;
        v.x = holdPos.x;
        v.z = holdPos.z;
      } else if (t < s.holdUntil && v.travel === null) {
        // JUST DROPPED. Hold everyone perfectly still for a beat while React
        // round-trips the move: without this the piece takes a visible step
        // back toward its old square before the new FEN arrives.
      } else if (v.travel) {
        v.travel.t += dt;
        const u = Math.min(1, v.travel.t / v.travel.dur);
        // easeInOutCubic: a piece leaves slowly, crosses fast, arrives softly.
        const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        v.x = v.travel.fx + (v.travel.tx - v.travel.fx) * e;
        v.z = v.travel.fz + (v.travel.tz - v.travel.fz) * e;
        // Zero for every move but one: the castling rook, swinging out around
        // the king rather than through him.
        if (v.travel.bowZ !== 0) v.z += Math.sin(u * Math.PI) * v.travel.bowZ;
        if (u >= 1) v.travel = null;
      } else {
        const kk = 1 - Math.exp(-dt * 16);
        v.x += (home.x - v.x) * kk;
        v.z += (home.z - v.z) * kk;
      }

      /* -- lift, tilt, grow -- */
      v.lift.to(held ? carryLift : 0);
      const arc = v.travel ? Math.sin(Math.min(1, v.travel.t / v.travel.dur) * Math.PI) * v.travel.arc : 0;

      if (held) {
        // Lean into the direction of travel, like a toy being swooshed along.
        const kx = Math.max(-0.34, Math.min(0.34, s.vel.y * 3.4));
        const kz = Math.max(-0.34, Math.min(0.34, -s.vel.x * 3.4));
        v.tiltX.to(kx + Math.sin(t * 6.4) * 0.018);
        v.tiltZ.to(kz + Math.cos(t * 5.1) * 0.018);
        v.grow.to(1.07);
      } else {
        v.tiltX.to(0);
        v.tiltZ.to(0);
        v.grow.to(1);
      }


      /* -- personality, at the right volume -- */
      // Held: full character. Your turn: awake. Their turn: nearly still.
      // A child can tell whose move it is from across the room without a
      // single word of UI, which is exactly the point.
      //
      // THE NUMBERS ARE MEASURED, NOT GUESSED. At the board camera one board
      // unit is ~130 screen px, and the first pass used 0.3 / 0.11: a pawn's
      // whole sway came to 3.0 px on its own turn and 1.1 px on the
      // opponent's. Both are below the ~3 px it takes to notice motion in a
      // scene that is already moving, so the tell did not exist — eight pawns
      // a side stood perfectly still either way, and only the knight and the
      // bishop's bow read at all. Widening the RATIO rather than just raising
      // the volume is what fixes it: the resting side drops to genuinely
      // asleep (0.6 px) while the side to move comes up to 5 px, an 8x
      // contrast instead of 2.7x, with the busiest piece on the board — the
      // knight — still only at 19 px of slow lean.
      const amp = held ? 1 : v.color === turn ? 0.5 : 0.06;
      const pose = pieceIdle(v.type, t, v.phase);

      /* -- who is it looking at? -- */
      // Spring on the SHORT way round: a raw angle spring takes the scenic
      // route through three radians whenever a target crosses +/-PI.
      const want = lookTargetFor(v, camX, camZ, held, holdPos);
      v.look.to(v.look.value + wrapAngle(want - v.look.value));

      // Every spring on this piece advances together, in sub-steps, so a
      // hitched frame cannot fling a piece off the board. See subStep().
      subStep(dt, (h) => {
        v.lift.step(h);
        v.tiltX.step(h);
        v.tiltZ.step(h);
        v.grow.step(h);
        v.look.step(h);
      });

      /**
       * THE HEAD-SHAKE for a piece that was tapped and has nowhere to go.
       *
       * Added STRAIGHT to the mesh, alongside the pose, rather than pushed
       * through the tilt spring. Three shakes in seven tenths of a second is
       * about 4 Hz, and a spring with a 0.09 s half-life attenuates that by
       * roughly ninety per cent — the first version of this went in through
       * `tiltZ` and came out the far end as one degree, which is no answer at
       * all. It is a ROLL rather than a turn on purpose: these pieces are
       * lathe-turned, so spinning one about its own axis is invisible.
       */
      let shake = 0;
      if (v.id === s.refuseId && t < s.refuseUntil) {
        const left = s.refuseUntil - t; // REFUSE_TIME down to 0
        shake = Math.sin((REFUSE_TIME - left) * 26) * 0.14 * (left / REFUSE_TIME);
      }

      const yBase = v.lift.value + arc + pose.y * amp;
      mesh.position.set(v.x, yBase, v.z);
      mesh.rotation.set(
        v.tiltX.value + pose.pitch * amp,
        v.look.value + pose.yaw * amp * 0.6,
        v.tiltZ.value + pose.roll * amp + shake
      );
      const sq = Math.max(0.4, 1 + (pose.squash - 1) * amp);
      const wide = 1 / Math.sqrt(sq);
      const g = v.grow.value * PIECE_FIT;
      mesh.scale.set(g * wide, g * sq, g * wide);

      /* -- contact shadow -- */
      if (shadowCount < build.shadows.instanceMatrix.count) {
        // It spreads and fades as the piece rises. That is the only depth cue
        // a drag really needs.
        const h = Math.max(0, yBase);
        const spread = 0.92 + h * 0.85;
        _mat.makeScale(spread, 1, spread);
        _mat.setPosition(v.x, 0.006, v.z);
        build.shadows.setMatrixAt(shadowCount, _mat);
        shadowCount++;
      }
    }

    for (const id of dead) views.current.delete(id);
    build.shadows.count = shadowCount;
    build.shadows.instanceMatrix.needsUpdate = true;

    /* ---- the check glow ---- */
    if (check) {
      const c = squareCenter(check, p.orientation);
      build.checkGlow.visible = true;
      build.checkGlow.position.set(c.x, 0.014, c.z);
      const pulse = 0.5 + 0.5 * Math.sin(t * 4.2);
      build.checkMat.opacity = 0.16 + pulse * 0.2;
      build.checkGlow.scale.set(0.92 + pulse * 0.1, 1, 0.92 + pulse * 0.1);
    } else {
      build.checkGlow.visible = false;
    }

    build.sparkles.update(dt);

    /* ---- collider heights ---- */
    // Tall where a piece is standing, flat where it is not. A tall box on an
    // empty square would swallow taps meant for the square behind it; a flat
    // box on an occupied square makes a king's crown unclickable.
    _occupancy.clear();
    for (const v of views.current.values()) {
      if (v.retire < 0) _occupancy.set(v.square, v.top * PIECE_FIT);
    }
    for (let i = 0; i < squares.length; i++) {
      const body = bodyRefs.current[i];
      if (!body) continue;
      const h = _occupancy.get(squares[i].sq) ?? 0;
      if (h > 0) {
        body.scale.set(0.9, h + 0.06, 0.9);
        body.position.y = (h + 0.06) / 2;
      } else {
        // Parked below the world rather than hidden: an invisible object is
        // still raycast, a zero-scale one is not, and this is both.
        body.scale.set(0.0001, 0.0001, 0.0001);
        body.position.y = -6;
      }
    }

    /* ---- cursor ---- */
    // Deliberately NOT skipped when `interactive` is false. The cursor is a
    // property of the shared canvas, not of this board: a board that goes
    // read-only while the pointer is resting on a piece used to leave the
    // WHOLE APP wearing a grabbing hand until something else overwrote it.
    const cursor = !p.interactive
      ? ""
      : s.dragging
        ? "grabbing"
        : phase.kind === "armed" || phase.kind === "promoting"
          ? "pointer"
          : hoverLiftable
            ? "grab"
            : "";
    if (cursor !== s.cursor) {
      s.cursor = cursor;
      gl.domElement.style.cursor = cursor;
    }
  });

  // ...and the same applies on the way out: unmounting mid-hover must hand the
  // canvas back exactly as it was found.
  useEffect(() => {
    const canvas = gl.domElement;
    // Captured here rather than read in the cleanup: `ix.current` is set once
    // and never reassigned, so this IS the live state object, and taking it
    // now is what tells the linter so.
    const state = ix.current;
    return () => {
      if (state.cursor) {
        state.cursor = "";
        canvas.style.cursor = "";
      }
    };
  }, [gl]);

  /* ---------------- promotion placement ---------------- */

  // Built only when asked for, and torn down with the board — a shadow map is
  // a real texture and the park may raise and drop many of these.
  const ownRig = useMemo(() => (ownLight ? buildOwnLight() : null), [ownLight]);
  useEffect(() => {
    if (!ownRig) return;
    return () => {
      ownRig.traverse((o) => {
        if ((o as THREE.Light).isLight) (o as THREE.Light).dispose();
      });
    };
  }, [ownRig]);

  const promoPos = useMemo<[number, number, number]>(() => {
    if (!promo) return [0, 2.3, 0];
    const c = squareCenter(promo.to, orientation);
    // Hover it over the promoting square but keep the whole tray on the board
    // so it never floats off into the snow.
    return [Math.max(-1.9, Math.min(1.9, c.x)), 1.95, Math.max(-2.4, Math.min(2.4, c.z))];
  }, [promo, orientation]);

  const standH = STAND_HEIGHT[stand];

  return (
    <group position={position} scale={scale}>
      <group position={[0, standH, 0]} ref={deckRef}>
        <primitive object={build.deck} />

        {/* THE HIT TARGETS. Generous, invisible, two per square.
            Not mounted at all on a display board: a hundred and twenty-eight
            invisible boxes that can never be tapped still cost a ray test
            each, on every pointer move, for every OTHER thing in the park. */}
        {interactive && (
          <group onPointerDown={onColliderDown} onPointerMove={onColliderMove} onPointerOut={onColliderOut}>
            {squares.map((sq) => (
              <mesh
                key={`slab-${sq.sq}`}
                geometry={colliderGeo}
                material={colliderMat}
                scale={[1.06, 0.18, 1.06]}
                position={[sq.x, 0.09, sq.z]}
                userData={{ square: sq.sq }}
              />
            ))}
            {squares.map((sq, i) => (
              <mesh
                key={`body-${sq.sq}`}
                ref={(m) => {
                  bodyRefs.current[i] = m;
                }}
                geometry={colliderGeo}
                material={colliderMat}
                scale={[0.0001, 0.0001, 0.0001]}
                position={[sq.x, -6, sq.z]}
                userData={{ square: sq.sq }}
              />
            ))}
          </group>
        )}

        {promo && (
          <PromotionPicker
            tone={promo.tone}
            quality={quality}
            position={promoPos}
            onPick={(piece) => {
              const target = promo;
              setPromo(null);
              setPhase({ kind: "idle" });
              propsRef.current.onMove?.(target.from, target.to, piece);
            }}
          />
        )}

        {ownRig && <primitive object={ownRig} />}
      </group>
    </group>
  );
}
