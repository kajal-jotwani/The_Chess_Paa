"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { PALETTE } from "../core/palette";
import { createToonMaterial } from "../core/materials/ToonMaterial";
import { addOutline, smoothNormalsForOutline } from "../core/materials/OutlineMaterial";
import { patchMaterialForBandedFog } from "../core/materials/SkyMaterial";
import { woodTexture } from "../core/textures/procedural";
import { mergeGeometries } from "./terrain";

/**
 * THE LITTLE WOODEN COASTER CAR.
 *
 * Rounded edges worn smooth as a beloved toy. This is the object a child is
 * handed up into at the gate, so it has to read as SAFE and PLUSH first and
 * as a vehicle second: a deep tub, a high back, fat bumpers, no hard corners.
 */
function buildCarGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // The tub. A rounded box (segmented sphere-ish scaling reads plusher than a
  // cube with bevels, and costs fewer verts).
  const tub = new THREE.SphereGeometry(1, 14, 10);
  tub.scale(0.62, 0.42, 1.02);
  tub.translate(0, 0.46, 0);
  parts.push(tub);

  // Hollow it visually with an inset seat well.
  const well = new THREE.SphereGeometry(0.86, 12, 8);
  well.scale(0.52, 0.3, 0.9);
  well.translate(0, 0.66, 0.02);
  parts.push(well);

  // High, comforting back.
  const back = new THREE.SphereGeometry(0.62, 12, 9);
  back.scale(0.62, 0.66, 0.28);
  back.translate(0, 0.72, -0.78);
  parts.push(back);

  // Fat bumpers front and back.
  for (const z of [1.02, -1.02]) {
    const b = new THREE.TorusGeometry(0.36, 0.11, 6, 12);
    b.rotateY(Math.PI / 2);
    b.rotateZ(Math.PI / 2);
    b.scale(1.5, 1, 1);
    b.translate(0, 0.42, z);
    parts.push(b);
  }

  // Chassis and wheels — small, chunky, toy-like.
  const chassis = new THREE.BoxGeometry(0.78, 0.14, 1.7);
  chassis.translate(0, 0.2, 0);
  parts.push(chassis);
  for (const z of [0.62, -0.62]) {
    for (const x of [0.46, -0.46]) {
      const w = new THREE.CylinderGeometry(0.19, 0.19, 0.1, 10);
      w.rotateZ(Math.PI / 2);
      w.translate(x, 0.19, z);
      parts.push(w);
    }
  }

  // A little lantern hook up front — this is where ChessPaa's lantern hangs.
  const hook = new THREE.TorusGeometry(0.09, 0.022, 5, 9, Math.PI * 1.4);
  hook.rotateX(Math.PI / 2);
  hook.translate(0, 0.92, 0.96);
  parts.push(hook);

  return mergeGeometries(parts);
}

export interface CoasterCarProps {
  /** Position along the spine, 0..1. */
  t: number;
  /** Speed, used to tilt the riders and squash the car into the drops. */
  speed?: number;
  showLantern?: boolean;
  children?: React.ReactNode;
}

/**
 * A car riding the spine. Positioned with the stable banked frame from
 * coasterSpine so it never rolls upside-down at an inflection point.
 */
export default function CoasterCar({ t, speed = 0, showLantern = true, children }: CoasterCarProps) {
  const group = useRef<THREE.Group>(null);

  const car = useMemo(() => {
    const geo = smoothNormalsForOutline(buildCarGeometry());
    const mat = createToonMaterial({
      color: PALETTE.scarfRed,
      ramp: "wood",
      map: woodTexture(PALETTE.walnut, 5),
      rim: 0.8,
      rimPower: 2.6,
      bounce: 0.24,
      handCarved: 0.004,   // whittled, not machined
    });
    patchMaterialForBandedFog(mat);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    addOutline(m, { thickness: 2.2 });
    return m;
  }, []);

  const lanternGlass = useMemo(() => {
    const g = new THREE.SphereGeometry(0.12, 10, 8);
    g.scale(1, 1.25, 1);
    return g;
  }, []);
  const glassMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: PALETTE.lanternCore, toneMapped: false, fog: true }),
    []
  );

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    // A gentle plush "give" — the car settles on its springs, and squashes a
    // little through the fast parts so speed is felt in the body.
    const bob = Math.sin(state.clock.elapsedTime * 6.2) * 0.012 * (0.3 + speed);
    g.position.y += bob;
    const squash = 1 - Math.min(0.06, speed * 0.02);
    g.scale.set(1, squash, 1 + (1 - squash) * 0.5);
  });

  return (
    <group ref={group}>
      <primitive object={car} />
      {showLantern && (
        <group position={[0, 0.78, 0.96]}>
          <mesh geometry={lanternGlass} material={glassMat} />
          <pointLight intensity={7} distance={12} decay={2} color={PALETTE.lanternCore} />
        </group>
      )}
      {children}
    </group>
  );
}

export { buildCarGeometry };
