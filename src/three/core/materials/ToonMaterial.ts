"use client";

import * as THREE from "three";
import { getToonRamp, type RampKind } from "../toonRamp";
import { PALETTE } from "../palette";

/**
 * THE PARK'S ONE LIT MATERIAL.
 *
 * Built on MeshToonMaterial (which gives us real shadows, lights and fog for
 * free, and samples our hand-authored ramp through NearestFilter), then
 * patched via onBeforeCompile to add the thing the stock material cannot do:
 *
 *   A WARM FRESNEL RIM on every character and every chess piece, so a pale
 *   piece NEVER dissolves into a pale board. This is the critical trick.
 *   The lighter the surface a form sits on, the harder that rim works.
 *
 * Also injects a gentle lavender bounce into the shadow side, so shadows are
 * COLOURED, never grey.
 */

export interface ToonOptions {
  color?: number;
  ramp?: RampKind;
  /** Rim strength. Heroes ~1.0; set-dressing ~0.35; flat cut-paper ~0. */
  rim?: number;
  /** Rim tightness — higher = narrower rim. 2.0 is broad, 5.0 is a thin line. */
  rimPower?: number;
  rimColor?: number;
  /** Cool bounce into the shadow side. */
  bounce?: number;
  transparent?: boolean;
  opacity?: number;
  map?: THREE.Texture | null;
  emissive?: number;
  emissiveIntensity?: number;
  side?: THREE.Side;
  flatShading?: boolean;
  /** Slight vertex wobble — hand-carved imperfection. 0 = off. */
  handCarved?: number;
}

export interface ToonMaterial extends THREE.MeshToonMaterial {
  userData: {
    rimUniforms?: {
      uRim: { value: number };
      uRimPower: { value: number };
      uRimColor: { value: THREE.Color };
      uBounce: { value: number };
      uBounceColor: { value: THREE.Color };
      uTime: { value: number };
      uCarve: { value: number };
    };
  };
}

const RIM_PARS = /* glsl */ `
uniform float uRim;
uniform float uRimPower;
uniform vec3  uRimColor;
uniform float uBounce;
uniform vec3  uBounceColor;
varying vec3 vToonViewDir;
varying vec3 vToonNormal;
`;

export function createToonMaterial(opts: ToonOptions = {}): ToonMaterial {
  const {
    color = PALETTE.cream,
    ramp = "hero",
    rim = 0.85,
    rimPower = 3.0,
    rimColor = PALETTE.honey,
    bounce = 0.22,
    transparent = false,
    opacity = 1,
    map = null,
    emissive = 0x000000,
    emissiveIntensity = 1,
    side = THREE.FrontSide,
    flatShading = false,
    handCarved = 0,
  } = opts;

  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: getToonRamp(ramp),
    transparent,
    opacity,
    ...(map ? { map } : {}),
    emissive,
    emissiveIntensity,
    side,
  }) as ToonMaterial;
  // flatShading is supported at runtime; the r185 typings omit it on MeshToonMaterial.
  (mat as unknown as { flatShading: boolean }).flatShading = flatShading;

  const uniforms = {
    uRim: { value: rim },
    uRimPower: { value: rimPower },
    uRimColor: { value: new THREE.Color(rimColor) },
    uBounce: { value: bounce },
    uBounceColor: { value: new THREE.Color(PALETTE.fillLavender) },
    uTime: { value: 0 },
    uCarve: { value: handCarved },
  };
  mat.userData.rimUniforms = uniforms;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    // ---- vertex: carry view dir + normal, optional hand-carved wobble ----
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uTime;
         uniform float uCarve;
         varying vec3 vToonViewDir;
         varying vec3 vToonNormal;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         if (uCarve > 0.0) {
           // low-frequency wobble so edges read as whittled, not machined
           float w = sin(position.y * 7.3 + position.x * 4.1) * 0.5
                   + sin(position.z * 5.7 - position.y * 3.3) * 0.5;
           transformed += normal * w * uCarve;
         }`
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
         {
           vec4 _wp = modelMatrix * vec4(transformed, 1.0);
           vToonViewDir = normalize(cameraPosition - _wp.xyz);
           vToonNormal = normalize(mat3(modelMatrix) * objectNormal);
         }`
      );

    // ---- fragment: warm fresnel rim + coloured shadow bounce ----
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${RIM_PARS}`)
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
         {
           vec3 N = normalize(vToonNormal);
           vec3 V = normalize(vToonViewDir);
           float f = 1.0 - clamp(dot(N, V), 0.0, 1.0);

           // Cool bounce into the shadow side — shadows are coloured, never grey.
           float shadowSide = 1.0 - clamp(dot(N, normalize(vec3(0.45, 0.75, 0.35))), 0.0, 1.0);
           gl_FragColor.rgb += uBounceColor * uBounce * shadowSide * 0.28;

           // THE RIM. Warm honey along the silhouette so pale never eats pale.
           float rimMask = pow(f, uRimPower);
           gl_FragColor.rgb += uRimColor * rimMask * uRim;
         }`
      );
  };

  // force a recompile key so materials with different rims don't share programs
  mat.customProgramCacheKey = () =>
    `toon|${ramp}|${rim}|${rimPower}|${rimColor}|${bounce}|${handCarved}`;

  return mat;
}

/** Unlit flat colour — for cut-paper distant trees and pure graphic shapes. */
export function createFlatMaterial(color: number, opts: { fog?: boolean; side?: THREE.Side } = {}) {
  return new THREE.MeshBasicMaterial({
    color,
    fog: opts.fog ?? true,
    side: opts.side ?? THREE.FrontSide,
  });
}

/** Drive any time-based uniforms (hand-carved wobble is static, but kept live). */
export function tickToonMaterial(mat: ToonMaterial, t: number) {
  const u = mat.userData.rimUniforms;
  if (u) u.uTime.value = t;
}
