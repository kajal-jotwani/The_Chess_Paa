import * as THREE from "three";

/**
 * Where everything lives in the park (metres, Y up, +Z = south / toward the gate).
 * The coaster is the park's spine: it boards at the main station, then drops
 * children at each learning station in order before flying back over the plaza.
 */
export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export type AttractionId = "grand_match" | "academy" | "tactics" | "endgame" | "train";

export interface Attraction {
  id: AttractionId;
  name: string;
  emoji: string;
  tagline: string;
  /** where the label floats */
  anchor: THREE.Vector3;
  /** giant board centre + which way "white" faces (yaw radians) */
  board: { pos: THREE.Vector3; yaw: number };
  /** hub camera fly-to */
  camera: { pos: THREE.Vector3; look: THREE.Vector3 };
}

export const ATTRACTIONS: Attraction[] = [
  {
    id: "academy", name: "Piece Academy", emoji: "🏰", tagline: "Meet every piece and learn how it moves",
    anchor: V(44, 14, -80), board: { pos: V(44, 0, -66), yaw: Math.PI }, camera: { pos: V(44, 9, -52), look: V(44, 1, -70) },
  },
  {
    id: "tactics", name: "Tactics Coaster", emoji: "🎢", tagline: "Forks, pins, skewers and checkmates",
    anchor: V(28, 12, 36), board: { pos: V(28, 0, 48), yaw: 0 }, camera: { pos: V(28, 9, 64), look: V(28, 1, 44) },
  },
  {
    id: "endgame", name: "Endgame Ferris Wheel", emoji: "🎡", tagline: "Finish the game like a champion",
    anchor: V(-16, 30, -92), board: { pos: V(-16, 0, -64), yaw: Math.PI }, camera: { pos: V(-16, 9, -48), look: V(-16, 1, -68) },
  },
  {
    id: "train", name: "Puzzle Train", emoji: "🚂", tagline: "Puzzle rush! How many carriages can you fill?",
    anchor: V(-51, 8, 26), board: { pos: V(-44, 0, 4), yaw: Math.PI / 2 }, camera: { pos: V(-28, 9, 4), look: V(-46, 1, 4) },
  },
  {
    id: "grand_match", name: "Grand Match", emoji: "♟️", tagline: "Play a real game with ChessPaa",
    anchor: V(0, 9, 8), board: { pos: V(0, 0, 8), yaw: 0 }, camera: { pos: V(0, 9, 26), look: V(0, 1, 6) },
  },
];

export const byId = (id: AttractionId) => ATTRACTIONS.find((a) => a.id === id)!;

export const PARK = {
  gate: V(0, 0, 76),
  ticketBooth: V(-6, 0, 68),
  club: V(-24, 0, 58),
  iceCream: V(12, 0, 62),
  foodTruck: V(26, 0, 60),
  carousel: V(-24, 0, 40),
  bigTop: V(26, 0, -28),
  castle: V(44, 0, -92),
  ferris: V(-16, 0, -92),
  lake: { center: V(-46, 0, -56), rx: 22, rz: 16 },
  // the oval keeps clear of the coaster's Puzzle Train stop (north) and the board plaza (east);
  // the station sits on the long east side where the curve is gentlest, so a straight deck fits
  trainOval: { center: V(-64, 0, 26), rx: 13, rz: 21 },
  trainStation: V(-51, 0, 26),
  umbrella: V(4.5, 0, 3.5),
  sandRadius: 96,
};

/** Cobbled plazas (single source of truth for Details.paving + planting exclusion). */
export const PAVED: { x: number; z: number; r: number }[] = [
  { x: 0, z: 8, r: 24 },
  ...ATTRACTIONS.filter((a) => a.id !== "grand_match").map((a) => ({ x: a.board.pos.x, z: a.board.pos.z, r: 9.5 })),
  { x: PARK.carousel.x, z: PARK.carousel.z, r: 9.5 },
  { x: PARK.gate.x, z: PARK.gate.z - 10, r: 12 },
];

/** The avenue forks around the fountain; its rond-point island is kept clear of planting and fences. */
export const FOUNTAIN = V(0, 0, 36);
const FOUNTAIN_CLEAR = 6.5; // basin r=4.5 + walk-around

/** True when (x, z) lies on a cobbled plaza or the fountain's walk-around — nothing should be planted there. */
export function onPaving(x: number, z: number, margin = 0.8): boolean {
  if (Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) < FOUNTAIN_CLEAR) return true;
  for (const d of PAVED) if (Math.hypot(x - d.x, z - d.z) < d.r + margin) return true;
  return false;
}

let pathCache: THREE.Vector3[][] | null = null;
/** True when (x, z) is within `dist` of any walkway centreline. */
export function nearPath(x: number, z: number, dist: number): boolean {
  const net = pathCache ?? (pathCache = pathNetwork());
  for (const path of net) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const abx = b.x - a.x, abz = b.z - a.z;
      const t = THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz), 0, 1);
      if (Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)) < dist) return true;
    }
  }
  return false;
}

/** Coaster stations in ride order (arc positions are resolved at build time). */
export const COASTER_STATIONS: { id: AttractionId | "main"; name: string; pos: THREE.Vector3 }[] = [
  { id: "main", name: "Wonderland Station", pos: V(30, 1.5, 34) },
  { id: "academy", name: "Piece Academy", pos: V(44, 1.5, -58) },
  { id: "endgame", name: "Endgame Wheel", pos: V(-16, 1.5, -58) },
  { id: "train", name: "Puzzle Train", pos: V(-67, 1.5, -8) },
];

/** Coaster centreline control points (closed loop). Station points sit flat at y=1.5. */
export function coasterControlPoints(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [
    V(30, 1.5, 34), V(44, 1.5, 32), V(58, 2.5, 26),          // main station + run-out
    V(70, 6, 8), V(78, 16, -14), V(76, 30, -34),             // lift hill
    V(66, 12, -48), V(56, 2.5, -56), V(44, 1.5, -58),        // big drop into the academy station
    V(32, 2.5, -60), V(24, 5, -64),                          // toward the loop
  ];
  // loop-the-loop centred at (12, 9.5, -66) radius 8, entering along -X
  const c = V(12, 9.5, -67), R = 8;
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push(V(c.x - R * Math.sin(a), c.y - R * Math.cos(a), c.z + (i / 8) * 5 - 2.5));
  }
  pts.push(V(-2, 2.5, -60), V(-16, 1.5, -58),               // endgame station
    V(-30, 4, -62), V(-42, 14, -70), V(-54, 18, -64), V(-66, 10, -46), // over the lake
    V(-74, 20, -28), V(-75, 8, -18), V(-67, 1.5, -8),       // puzzle-train station (north of the train oval)
    V(-52, 3.5, 3), V(-40, 10, 22), V(-26, 20, 36), V(-10, 16, 34), // swoop past the train board, helix out
    V(0, 12, 16), V(8, 9, 20), V(16, 4, 30));                // fly over the plaza and home
  return pts;
}

/** Walkway centrelines for the ground mask + wandering folk. */
export function pathNetwork(): THREE.Vector3[][] {
  return [
    // main avenue: forks around the fountain rond-point at (0, 36) and rejoins at the plaza
    [V(0, 0, 80), V(0, 0, 58), V(-9, 0, 46), V(-9, 0, 27), V(0, 0, 14)],
    [V(0, 0, 58), V(9, 0, 46), V(9, 0, 27), V(0, 0, 14)],
    [V(9, 0, 27), V(14, 0, 34), V(26, 0, 40)],
    [V(-9, 0, 27), V(-14, 0, 34), V(-24, 0, 40)],
    // to the Puzzle Train: arrives at the queue entrance, skirts the board plaza, ends 4 m short of the rail
    [V(0, 0, 14), V(-20, 0, 7), V(-33, 0, 1), V(-35, 0, 11), V(-42, 0, 20), V(-47, 0, 26)],
    [V(0, 0, 14), V(20, 0, -6), V(30, 0, -30), V(40, 0, -56), V(44, 0, -66)],
    [V(0, 0, 14), V(-4, 0, -14), V(-12, 0, -40), V(-16, 0, -60)],
    [V(-16, 0, -60), V(-30, 0, -40), V(-46, 0, -20), V(-46, 0, -4)],
    [V(26, 0, 40), V(30, 0, 48)],
    // drawbridge → academy board (opens the hedge ring on the castle side)
    [V(44, 0, -78), V(43, 0, -74)],
  ];
}
