"use client";

import * as THREE from "three";
import { PALETTE } from "../palette";

/**
 * SILHOUETTE LINES — inverted-hull outlines.
 *
 * Duplicate the mesh, push vertices out along SMOOTHED normals, render
 * side: BackSide in the warm brown-plum ink (never pure black — pure black
 * reads as a hole punched in the picture; warm ink reads as drawn).
 *
 * The push scales with view distance so the line holds a CONSTANT WIDTH in
 * screen space: a pawn ten metres away and one right against the camera wear
 * the same weight of ink.
 */

export interface OutlineOptions {
  /** Screen-space thickness in ~pixels at 1080p. */
  thickness?: number;
  color?: number;
  /** Fade the ink out with distance so the far haze stays soft. */
  fadeStart?: number;
  fadeEnd?: number;
}

export function createOutlineMaterial(opts: OutlineOptions = {}): THREE.ShaderMaterial {
  const {
    thickness = 2.4,
    color = PALETTE.ink,
    fadeStart = 60,
    fadeEnd = 150,
  } = opts;

  return new THREE.ShaderMaterial({
    uniforms: {
      uThickness: { value: thickness },
      uColor: { value: new THREE.Color(color) },
      uFadeStart: { value: fadeStart },
      uFadeEnd: { value: fadeEnd },
    },
    vertexShader: /* glsl */ `
      uniform float uThickness;
      varying float vFade;

      void main() {
        // Use the (smoothed) normal to push the hull outward.
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);

        // Constant screen-space width: scale the push by view depth and by
        // the projection's vertical scale.
        float dist = -mv.z;
        float pxScale = uThickness * dist / 900.0;

        mv.xyz += n * pxScale;
        vFade = clamp(dist, 0.0, 1e6);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uFadeStart;
      uniform float uFadeEnd;
      varying float vFade;

      void main() {
        float a = 1.0 - smoothstep(uFadeStart, uFadeEnd, vFade);
        if (a < 0.02) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: true,
  });
}

/**
 * Attach an inverted-hull outline to a mesh.
 * Returns the outline mesh (already added as a child, so it inherits transforms).
 */
export function addOutline(
  mesh: THREE.Mesh,
  opts: OutlineOptions = {}
): THREE.Mesh {
  const outline = new THREE.Mesh(mesh.geometry, createOutlineMaterial(opts));
  outline.name = "__outline";
  // Outlines never cast or receive shadows — they are ink, not matter.
  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.renderOrder = (mesh.renderOrder ?? 0) - 1;
  mesh.add(outline);
  return outline;
}

/**
 * Smooth a geometry's normals so the hull push doesn't split at hard edges.
 * Essential for anything with sharp corners (crates, signage, planks).
 */
export function smoothNormalsForOutline(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const merged = geo.clone();
  const pos = merged.getAttribute("position");
  const map = new Map<string, THREE.Vector3>();
  const key = (x: number, y: number, z: number) =>
    `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;

  merged.computeVertexNormals();
  const nrm = merged.getAttribute("normal");

  for (let i = 0; i < pos.count; i++) {
    const k = key(pos.getX(i), pos.getY(i), pos.getZ(i));
    const acc = map.get(k) ?? new THREE.Vector3();
    acc.add(new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i)));
    map.set(k, acc);
  }
  for (const v of map.values()) v.normalize();
  for (let i = 0; i < pos.count; i++) {
    const k = key(pos.getX(i), pos.getY(i), pos.getZ(i));
    const v = map.get(k)!;
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  nrm.needsUpdate = true;
  return merged;
}
