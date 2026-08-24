"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { createSkyMaterial, createCloudMaterial } from "../core/materials/SkyMaterial";
import { PALETTE } from "../core/palette";
import { glowSprite } from "../core/textures/procedural";
import { NO_INK_LAYER } from "../core/postfx/effects";

/** The painted dusk dome — the one place we wash instead of band. */
export function SkyDome({ dusk = 0 }: { dusk?: number }) {
  const mat = useMemo(() => createSkyMaterial(), []);
  const geo = useMemo(() => new THREE.SphereGeometry(420, 32, 20), []);
  useFrame((_, dt) => {
    mat.uniforms.uTime.value += dt;
    // ease toward the requested dusk so harness poses don't pop
    mat.uniforms.uDusk.value += (dusk - mat.uniforms.uDusk.value) * Math.min(1, dt * 2);
  });
  return (
    <mesh
      geometry={geo}
      material={mat}
      frustumCulled={false}
      renderOrder={-1000}
      layers-mask={1 << NO_INK_LAYER}
    />
  );
}

/** Two layers of hard-edged cel clouds at different parallax speeds. */
export function CelClouds() {
  const a = useMemo(() => createCloudMaterial(0, 0xf7dfc6), []);
  const b = useMemo(() => createCloudMaterial(1, 0xe9c3ba), []);
  useFrame((_, dt) => {
    a.uniforms.uTime.value += dt;
    b.uniforms.uTime.value += dt;
  });
  const g1 = useMemo(() => new THREE.CylinderGeometry(345, 345, 62, 64, 1, true), []);
  const g2 = useMemo(() => new THREE.CylinderGeometry(300, 300, 48, 64, 1, true), []);
  const mask = 1 << NO_INK_LAYER;
  return (
    <>
      <mesh geometry={g1} material={a} position={[0, 132, 0]} frustumCulled={false} renderOrder={-900} layers-mask={mask} />
      <mesh geometry={g2} material={b} position={[0, 104, 0]} frustumCulled={false} renderOrder={-899} layers-mask={mask} />
    </>
  );
}

/**
 * THE THINGS IN THE AIR.
 * Fireflies lifting off the grass, dust motes, snow-glitter over the lake.
 * All instanced points so the near air is full of life for almost nothing.
 */
export function Atmosphere({ count = 700 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const sprite = useMemo(() => glowSprite(PALETTE.lanternCore), []);

  const { geometry, seeds } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const sd = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // cluster the motes where the lanterns are, so light has something to catch
      const a = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.6) * 60;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0.6 + Math.random() * 7.5;
      pos[i * 3 + 2] = Math.sin(a) * r;
      sd[i * 3] = Math.random() * Math.PI * 2;
      sd[i * 3 + 1] = 0.35 + Math.random() * 0.9;
      sd[i * 3 + 2] = 0.4 + Math.random() * 1.4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return { geometry: g, seeds: sd };
  }, [count]);

  const mat = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 0.30,
        map: sprite,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: PALETTE.lanternCore,
        sizeAttenuation: true,
        fog: false,
      }),
    [sprite]
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const p = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      const ph = seeds[i * 3], sp = seeds[i * 3 + 1], amp = seeds[i * 3 + 2];
      // slow lift and drift — fireflies rising off the grass
      p.setY(i, p.getY(i) + Math.sin(t * sp + ph) * 0.0016 * amp + 0.0009);
      if (p.getY(i) > 9) p.setY(i, 0.5);
      p.setX(i, p.getX(i) + Math.cos(t * sp * 0.6 + ph) * 0.004);
    }
    p.needsUpdate = true;
    mat.opacity = 0.55 + Math.sin(t * 0.6) * 0.12;
  });

  return <points ref={ref} geometry={geometry} material={mat} frustumCulled={false} layers-mask={1 << NO_INK_LAYER} />;
}
