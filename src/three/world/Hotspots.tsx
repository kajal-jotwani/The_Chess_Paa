"use client";

import { useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { useRouter } from "next/navigation";
import * as THREE from "three";

import { ATTRACTIONS } from "./coasterSpine";
import { terrainHeight } from "./terrain";
import { PALETTE, css } from "../core/palette";
import { NO_INK_LAYER } from "../core/postfx/effects";
import { glowSprite } from "../core/textures/procedural";

/**
 * THE ATTRACTIONS ARE DOORS.
 *
 * Wayfinding a six-year-old never loses: every attraction carries a warm
 * wooden sign that lifts when you point at it and takes you into the ride.
 * A child must never have to know a URL, and must never look at this park
 * and find that nothing happens when they tap it.
 *
 * The rides these open are the ones that actually play today.
 */

interface Spot {
  key: string;
  label: string;
  icon: string;
  href: string;
  /** World position of the sign, in park coordinates. */
  at: [number, number];
  /** How high the sign floats above the ground there. */
  lift: number;
  tint: number;
}

const SPOTS: Spot[] = [
  {
    key: "play", label: "Play with ChessPaa", icon: "♟️", href: "/play",
    at: [ATTRACTIONS.plaza.x + 1, ATTRACTIONS.plaza.z + 9], lift: 7.4, tint: PALETTE.scarfRed,
  },
  {
    key: "pieces", label: "Meet the Pieces", icon: "🏰", href: "/pieces",
    at: [ATTRACTIONS.parade.x, ATTRACTIONS.parade.z], lift: 8.2, tint: PALETTE.plum,
  },
  {
    key: "tactics", label: "Tactics Coaster", icon: "🎢", href: "/adventure/tactics",
    at: [ATTRACTIONS.coaster.x, ATTRACTIONS.coaster.z], lift: 9.5, tint: PALETTE.honeyDeep,
  },
  {
    key: "endgames", label: "Endgame Wheel", icon: "🎡", href: "/adventure/endgames",
    at: [ATTRACTIONS.ferris.x, ATTRACTIONS.ferris.z], lift: 15.5, tint: PALETTE.teal,
  },
  {
    key: "puzzles", label: "Puzzle Train", icon: "🚂", href: "/adventure/puzzles",
    at: [ATTRACTIONS.train.x, ATTRACTIONS.train.z], lift: 7.0, tint: PALETTE.tealDeep,
  },
  {
    key: "openings", label: "Opening Carousel", icon: "🎠", href: "/adventure/openings",
    at: [ATTRACTIONS.plaza.x + 21, ATTRACTIONS.plaza.z + 3], lift: 7.2, tint: PALETTE.plumDeep,
  },
];

function Hotspot({ spot }: { spot: Spot }) {
  const router = useRouter();
  const [hot, setHot] = useState(false);
  const group = useRef<THREE.Group>(null);
  const y = useMemo(() => terrainHeight(spot.at[0], spot.at[1]) + spot.lift, [spot]);
  const sprite = useMemo(() => glowSprite(PALETTE.lanternCore), []);

  // A soft beacon under each sign so the eye finds the doors at dusk.
  const beacon = useMemo(() => {
    const m = new THREE.SpriteMaterial({
      map: sprite, color: spot.tint, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5, toneMapped: false,
    });
    const s = new THREE.Sprite(m);
    s.scale.setScalar(5);
    s.layers.set(NO_INK_LAYER);
    return s;
  }, [sprite, spot.tint]);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    // A gentle bob so the signs read as alive rather than pinned in space.
    const t = state.clock.elapsedTime;
    g.position.y = y + Math.sin(t * 1.1 + spot.at[0] * 0.2) * 0.16 + (hot ? 0.35 : 0);
    (beacon.material as THREE.SpriteMaterial).opacity =
      (hot ? 0.85 : 0.42) + Math.sin(t * 1.6 + spot.at[1] * 0.3) * 0.08;
  });

  const enter = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    router.push(spot.href);
  };

  return (
    <group ref={group} position={[spot.at[0], y, spot.at[1]]}>
      <primitive object={beacon} />

      {/* A generous invisible target — no small thumb should ever miss. */}
      <mesh
        onClick={enter}
        onPointerOver={(e) => { e.stopPropagation(); setHot(true); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setHot(false); document.body.style.cursor = ""; }}
        visible={false}
      >
        <sphereGeometry args={[3.4, 8, 6]} />
      </mesh>

      <Html center distanceFactor={26} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div
          onClick={() => router.push(spot.href)}
          onPointerEnter={() => setHot(true)}
          onPointerLeave={() => setHot(false)}
          style={{
            pointerEvents: "auto",
            display: "flex", alignItems: "center", gap: 10,
            padding: "12px 20px",
            borderRadius: 999,
            background: `linear-gradient(${css(PALETTE.cream)}, ${css(PALETTE.creamPale)})`,
            border: `4px solid ${css(spot.tint)}`,
            boxShadow: hot
              ? `0 14px 34px rgba(46,30,40,.45), 0 0 0 8px ${css(spot.tint)}33`
              : "0 10px 24px rgba(46,30,40,.35)",
            color: css(PALETTE.ink),
            fontFamily: "var(--font-park)",
            fontWeight: 800,
            fontSize: 26,
            whiteSpace: "nowrap",
            cursor: "pointer",
            transform: hot ? "scale(1.08)" : "scale(1)",
            transition: "transform .18s ease, box-shadow .18s ease",
            userSelect: "none",
          }}
        >
          <span style={{ fontSize: 30 }}>{spot.icon}</span>
          {spot.label}
        </div>
      </Html>
    </group>
  );
}

export default function Hotspots() {
  return (
    <group>
      {SPOTS.map((s) => (
        <Hotspot key={s.key} spot={s} />
      ))}
    </group>
  );
}
