"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { PALETTE, mix } from "../core/palette";
import {
  createToonMaterial,
  type ToonOptions,
  type ToonMaterial,
} from "../core/materials/ToonMaterial";
import { addOutline, smoothNormalsForOutline } from "../core/materials/OutlineMaterial";
import { patchMaterialForBandedFog } from "../core/materials/SkyMaterial";
import { glowSprite, stripeTexture, woodTexture, rng } from "../core/textures/procedural";
import { mergeGeometries } from "../world/terrain";
import { NO_INK_LAYER } from "../core/postfx/effects";
import type { RampKind } from "../core/toonRamp";

import {
  CHESSPAA_SKELETON as SKEL,
  Spring,
  SpringVec3,
  VerletChain,
  Pendulum,
  solveTwoBoneIK,
  createChessPaaRig,
  parkWind,
  type ChessPaaMood,
} from "./chessPaaRig";

/**
 * CHESSPAA.
 *
 * A twinkly grandfather with a lantern, standing in the snow at golden hour.
 * He is the warmest point on screen and the eye is meant to find him first —
 * everything below serves that: the honey lantern, the one red scarf in the
 * whole park, the white beard catching the rim light, and a face built so a
 * five-year-old can read his mood from across the plaza.
 *
 * He is made of lathes, capsules, spheres and boxes. Nothing is downloaded;
 * nothing is imported; every curve here is a list of numbers.
 *
 * The animation lives in `chessPaaRig.ts`. This file's job is to build a good
 * body and then get out of the way — read the rig each frame and copy it onto
 * transforms.
 */

export type { ChessPaaMood } from "./chessPaaRig";

/* ================================================================== *
 * PLUSH GEOMETRY KIT
 *
 * Shared with Grandchildren.tsx so the whole family is carved from the
 * same toy-shop vocabulary. Every form is rounded — there is not a sharp
 * corner on any character in this park.
 * ================================================================== */

const UP = /* @__PURE__ */ new THREE.Vector3(0, 1, 0);

/** Four cel-friendly material recipes. Keeping to four keeps shader programs down. */
export const TOON: Record<
  "hero" | "plush" | "woody" | "deep",
  { ramp: RampKind; rim: number; rimPower: number; bounce: number }
> = {
  /** Skin, coat — the forms whose silhouette must survive a pale background. */
  hero: { ramp: "hero", rim: 0.85, rimPower: 3.0, bounce: 0.24 },
  /** Wool, fur, beard — soft ramp, hard rim, so white never dissolves in snow. */
  plush: { ramp: "soft", rim: 0.95, rimPower: 2.5, bounce: 0.3 },
  /** Boots, lantern frame. */
  woody: { ramp: "wood", rim: 0.5, rimPower: 3.2, bounce: 0.18 },
  /** Eyes, spectacles, the inside of a laughing mouth. */
  deep: { ramp: "soft", rim: 0.3, rimPower: 4.0, bounce: 0.12 },
};

/** A toon material with banded fog already patched in. */
export function plushMaterial(
  color: number,
  recipe = TOON.hero,
  extra: Partial<ToonOptions> = {}
): ToonMaterial {
  const m = createToonMaterial({ color, ...recipe, ...extra });
  patchMaterialForBandedFog(m);
  return m;
}

/** Smooth a merged geometry's normals and dispose the original. */
export function smoothed(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const s = smoothNormalsForOutline(geo);
  geo.dispose();
  return s;
}

/**
 * A tapered capsule whose ORIGIN IS ITS TOP, hanging down -Y.
 *
 * Every limb, beard segment and scarf segment in this project uses that
 * convention, because it is the one the IK solver and the verlet chain both
 * expect — a joint is a point, and the meat hangs off it.
 */
export function plushCapsule(
  rTop: number,
  rBot: number,
  len: number,
  radial = 10,
  cap = 4
): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  // dome over the joint
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * Math.PI * 0.5;
    pts.push(new THREE.Vector2(Math.max(1e-4, Math.sin(a) * rTop), Math.cos(a) * rTop));
  }
  // the shaft
  pts.push(new THREE.Vector2(Math.max(1e-4, rBot), -len));
  // dome under the far end
  for (let i = 1; i <= cap; i++) {
    const a = (i / cap) * Math.PI * 0.5;
    pts.push(
      new THREE.Vector2(Math.max(1e-4, Math.cos(a) * rBot), -len - Math.sin(a) * rBot)
    );
  }
  return new THREE.LatheGeometry(pts, radial);
}

/** A squashed, positioned, optionally tilted sphere. The atom of a plush toy. */
export function blob(
  r: number,
  scale: [number, number, number] = [1, 1, 1],
  pos: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0],
  seg = 12
): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.75)));
  g.scale(scale[0], scale[1], scale[2]);
  if (rot[0] || rot[1] || rot[2]) {
    g.rotateX(rot[0]);
    g.rotateY(rot[1]);
    g.rotateZ(rot[2]);
  }
  g.translate(pos[0], pos[1], pos[2]);
  return g;
}

/** Revolve a hand-authored [radius, height] profile — the same way the pieces are turned. */
export function lathe(profile: Array<[number, number]>, segments = 20, phiStart = 0, phiLength = Math.PI * 2) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y)),
    segments,
    phiStart,
    phiLength
  );
}

/** A cylinder stretched between two points — spectacle arms, lantern posts. */
export function strut(radius: number, from: THREE.Vector3, to: THREE.Vector3, seg = 6) {
  const d = new THREE.Vector3().subVectors(to, from);
  const len = Math.max(1e-4, d.length());
  const g = new THREE.CylinderGeometry(radius, radius, len, seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  return g;
}

/**
 * Push the FRONT of a lathed form outward in a soft vertical band.
 *
 * A lathe is radially symmetric and a belly is not — a good paunch hangs
 * forward over a belt, and no profile curve can express that. This adds one
 * gaussian of forward push weighted by how front-facing each vertex is.
 */
export function paunch(
  geo: THREE.BufferGeometry,
  centreY: number,
  sigma: number,
  amount: number
): THREE.BufferGeometry {
  const p = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z) || 1e-6;
    const front = Math.max(0, z / r); // 1 dead ahead, 0 at the sides, 0 behind
    const w = Math.exp(-((y - centreY) ** 2) / (2 * sigma * sigma));
    p.setZ(i, z + front * front * w * amount);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Wobble a hem up and down around its circumference.
 *
 * A perfectly level hem is a machine-cut hem. This is the difference between
 * a coat that was sewn and a coat that was extruded.
 */
export function waveHem(
  geo: THREE.BufferGeometry,
  belowY: number,
  amp: number,
  lobes: number
): THREE.BufferGeometry {
  const p = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > belowY) continue;
    const w = Math.min(1, (belowY - y) / 0.12);
    const th = Math.atan2(p.getX(i), p.getZ(i));
    p.setY(i, y + Math.sin(th * lobes) * amp * w);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Mesh + material + ink outline, shadows on. */
/**
 * Reference feature radius. A part this big or bigger wears the full ink
 * weight; anything smaller wears proportionally less.
 */
const INK_REFERENCE_RADIUS = 0.26;

export function toonPart(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  outline: number | false = 2.6
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  if (outline !== false) {
    // INK MUST SCALE WITH THE FEATURE, NOT JUST WITH DISTANCE.
    //
    // The outline shader holds a constant SCREEN-SPACE width, which is right
    // for a coat or a lantern. But ChessPaa's face is built from parts about
    // 0.05 units across — a brow, a moustache lobe, a spectacle rim, a beard
    // link. Give each of those the same 2.4px border as his torso and, because
    // a dozen of them overlap, the ink merges into one solid black mass across
    // his face. (It did exactly that, and survived every material dye test
    // precisely because it was never a material.)
    //
    // So: taper the ink by the part's own radius. His torso keeps its full
    // drawn weight; his whiskers get a hairline.
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const r = geo.boundingSphere?.radius ?? INK_REFERENCE_RADIUS;
    // Quadratic, with no floor: ink falls away fast below the reference size.
    // Linear tapering still left his whiskers stacking into a blot, because a
    // dozen sub-pixel-thin parts each keeping ~40% of full ink still sums to a
    // solid mass where they overlap.
    const k = Math.min(1, r / INK_REFERENCE_RADIUS);
    const taper = k * k;
    addOutline(m, { thickness: outline * taper, fadeStart: 40, fadeEnd: 130 });
  }
  return m;
}

/* ================================================================== *
 * BREATH FOG
 * ================================================================== */

const BREATH_VERT = /* glsl */ `
attribute vec3 aDir;
attribute float aSeed;
uniform float uAge;
uniform float uLife;
uniform float uPixelScale;
varying float vAlpha;

void main() {
  // Each mote is born a fraction of a beat after the last, so a puff BLOOMS
  // out of him instead of appearing as a finished ball of fog.
  float life = clamp((uAge - aSeed * 0.22) / uLife, 0.0, 1.0);
  // Fast expansion that quickly runs out of push — warm air meeting cold air.
  float grow = 1.0 - exp(-life * 3.2);

  vec3 p = position
    + aDir * (0.02 + grow * 0.17)
    + vec3(0.0, 0.0, 1.0) * grow * 0.26
    + vec3(0.0, 1.0, 0.0) * (grow * 0.15 + life * life * 0.12)
    + vec3(sin(aSeed * 9.1 + life * 4.0), 0.0, cos(aSeed * 7.3 + life * 3.4)) * grow * 0.035;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);

  // In fast, hang, then thin away. A hard pop-out reads as a bug, not breath.
  vAlpha = smoothstep(0.0, 0.10, life) * (1.0 - smoothstep(0.30, 1.0, life));
  // Fade with distance so a far-off ChessPaa does not sparkle with fog.
  vAlpha *= 1.0 - smoothstep(22.0, 55.0, -mv.z);

  gl_PointSize = (0.030 + grow * 0.085) * uPixelScale / max(0.001, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const BREATH_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;

void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export interface BreathBits {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
}

/**
 * One puff of visible breath. Shared with the grandchildren, so three plumes
 * of cold air rise from the same family at the same dusk.
 *
 * Drive it by setting `material.uniforms.uAge` to seconds since the exhale
 * and `uPixelScale` to half the drawing-buffer height.
 */
export function buildBreath(seed: number): BreathBits {
  const N = 18;
  const r = rng(seed + 991);
  const pos = new Float32Array(N * 3);
  const dir = new Float32Array(N * 3);
  const sd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    // Spread over a forward-leaning half-shell — a mouth is not a sphere.
    const th = r() * Math.PI * 2;
    const ph = Math.acos(1 - r() * 1.3);
    const d = new THREE.Vector3(
      Math.sin(ph) * Math.cos(th) * 0.9,
      Math.sin(ph) * Math.sin(th) * 0.6,
      Math.cos(ph) * 0.5 + 0.35
    ).normalize();
    dir[i * 3] = d.x;
    dir[i * 3 + 1] = d.y;
    dir[i * 3 + 2] = d.z;
    pos[i * 3] = d.x * 0.012;
    pos[i * 3 + 1] = d.y * 0.012;
    pos[i * 3 + 2] = d.z * 0.012;
    sd[i] = r();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aDir", new THREE.BufferAttribute(dir, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(sd, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uAge: { value: 99 },
      uLife: { value: 2.1 },
      uPixelScale: { value: 540 },
      uMap: { value: glowSprite(0xffffff) },
      // Cool against a warm dusk — the contrast is the whole point of breath.
      uColor: { value: new THREE.Color(mix(PALETTE.creamPale, PALETTE.icePale, 0.65)) },
      uOpacity: { value: 0.4 },
    },
    vertexShader: BREATH_VERT,
    fragmentShader: BREATH_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const points = new THREE.Points(geo, material);
  // MUST be on the no-ink layer: the Sobel pass would otherwise find edges in
  // the sprite alpha and stamp a black square on every mote.
  points.layers.set(NO_INK_LAYER);
  points.frustumCulled = false;
  points.renderOrder = 6;
  points.visible = false;
  return { points, material };
}

/* ================================================================== *
 * THE BODY
 * ================================================================== */

interface Built {
  root: THREE.Group;
  body: THREE.Group;
  hips: THREE.Group;
  hem: THREE.Group;
  spine: THREE.Group;
  chest: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;

  legL: THREE.Group;
  legR: THREE.Group;

  shoulderL: THREE.Group;
  shoulderR: THREE.Group;
  upperL: THREE.Group;
  upperR: THREE.Group;
  foreL: THREE.Group;
  foreR: THREE.Group;
  mittenL: THREE.Group;
  mittenR: THREE.Group;
  finger: THREE.Mesh;

  coatBody: THREE.Mesh;
  coatSkirt: THREE.Mesh;

  eyeRig: THREE.Group;
  eyeBalls: THREE.Mesh;
  lids: THREE.Mesh;
  catchlights: THREE.Mesh;
  browL: THREE.Group;
  browR: THREE.Group;
  smileMesh: THREE.Mesh;
  mouthMesh: THREE.Mesh;
  ruddyMat: ToonMaterial;

  beardAnchor: THREE.Object3D;
  scarfAnchor: THREE.Object3D;
  beardSegs: THREE.Object3D[];
  scarfSegs: THREE.Object3D[];

  mouthAnchor: THREE.Object3D;
  breath: BreathBits;

  lanternRoot: THREE.Group;
  lanternGimbal: THREE.Group;
  lanternSwing: THREE.Group;
  lanternLight: THREE.PointLight;
  lanternGlow: THREE.Sprite;

  dispose(): void;
}

/** His coat: a deep pine-teal that lets the one red scarf sing. */
const COAT = mix(PALETTE.tealDeep, PALETTE.cocoa, 0.35);
const COAT_LIT = mix(COAT, PALETTE.teal, 0.22);
const SKIN = mix(PALETTE.cream, PALETTE.honey, 0.22);
const RUDDY = mix(SKIN, PALETTE.scarfRed, 0.34);
const BOOT = mix(PALETTE.cocoa, PALETTE.walnut, 0.22);
const DARK = mix(PALETTE.ink, PALETTE.cocoa, 0.3);

function buildChessPaa(seed: number): Built {
  const disposables: Array<{ dispose(): void }> = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  /* ---------------- materials ---------------- */
  const knitMap = stripeTexture(PALETTE.scarfRed, mix(PALETTE.scarfRed, PALETTE.cream, 0.30), 5);
  const capMap = stripeTexture(COAT_LIT, mix(COAT, PALETTE.cream, 0.18), 6);

  const mCoat = keep(plushMaterial(COAT, TOON.hero));
  const mSkin = keep(plushMaterial(SKIN, TOON.hero, { rimColor: PALETTE.honey }));
  const mRuddy = keep(
    plushMaterial(RUDDY, TOON.hero, {
      rim: 0.6,
      emissive: PALETTE.scarfRed,
      emissiveIntensity: 0.06,
    })
  );
  // The beard is white on snow. Without a hard warm rim it disappears, and a
  // grandfather without a beard-shaped silhouette is just a coat.
  const mHair = keep(plushMaterial(PALETTE.creamPale, TOON.plush, { rimColor: PALETTE.honey }));
  const mTrim = keep(plushMaterial(PALETTE.cream, TOON.plush));
  const mWool = keep(plushMaterial(0xffffff, TOON.plush, { map: knitMap, rim: 0.8, rimColor: PALETTE.honey, emissive: PALETTE.scarfRed, emissiveIntensity: 0.09 }));
  const mKnit = keep(plushMaterial(0xffffff, TOON.plush, { map: capMap, rim: 0.75 }));
  const mBoot = keep(plushMaterial(BOOT, TOON.woody));
  const mWood = keep(plushMaterial(PALETTE.walnut, TOON.woody, { map: woodTexture() }));
  const mSpecs = keep(plushMaterial(mix(PALETTE.cocoa, PALETTE.ink, 0.35), TOON.deep));
  const mDark = keep(plushMaterial(DARK, TOON.deep));
  const mEye = keep(plushMaterial(mix(PALETTE.ink, PALETTE.walnut, 0.18), TOON.deep, { rim: 0.45 }));

  const mGlass = keep(
    new THREE.MeshBasicMaterial({ color: PALETTE.lanternCore, toneMapped: false, fog: true })
  );
  const mCatch = keep(
    new THREE.MeshBasicMaterial({ color: 0xfff6de, toneMapped: false, fog: false })
  );
  const mLens = keep(
    new THREE.MeshBasicMaterial({
      color: PALETTE.icePale,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    })
  );

  /* ---------------- skeleton ---------------- */
  const root = new THREE.Group();
  root.name = "chesspaa";

  const body = new THREE.Group();
  root.add(body);

  const hips = new THREE.Group();
  hips.position.y = SKEL.hipY;
  body.add(hips);

  // The skirt lives on its own group so it can TRAIL the hips by a beat.
  const hem = new THREE.Group();
  hips.add(hem);

  const spine = new THREE.Group();
  spine.position.y = SKEL.spineY;
  hips.add(spine);

  const chest = new THREE.Group();
  chest.position.y = SKEL.chestY;
  spine.add(chest);

  const neck = new THREE.Group();
  neck.position.y = SKEL.neckY;
  chest.add(neck);

  const head = new THREE.Group();
  head.position.y = SKEL.headY;
  neck.add(head);

  /* ---------------- legs + boots ---------------- */
  // Merged into one dark form per side: only 0.08 of leg shows below the coat
  // hem, and two extra draw calls to show a trouser cuff no one will ever see
  // is not a trade worth making.
  const legGeo = (side: -1 | 1) =>
    smoothed(
      mergeGeometries([
        plushCapsule(0.105, 0.092, 0.2, 8),
        (() => {
          const g = plushCapsule(0.092, 0.078, 0.16, 8);
          g.translate(0, -0.22, 0);
          return g;
        })(),
        // boot: heel mass, toe bulge (turned very slightly outward, because a
        // person standing at ease does not aim their feet), sole plate
        blob(0.098, [1.0, 0.82, 1.25], [0, -0.5, 0.028], [0, side * 0.14, 0], 10),
        blob(0.082, [1.0, 0.62, 0.95], [side * 0.016, -0.535, 0.115], [0, 0, 0], 10),
        blob(0.086, [1.12, 0.3, 1.4], [0, -0.575, 0.035], [0, side * 0.14, 0], 10),
        // a chunky rolled boot cuff so the ankle reads as felt, not a stick
        blob(0.086, [1.15, 0.55, 1.1], [0, -0.395, 0.012], [0, 0, 0], 10),
      ])
    );

  const legL = new THREE.Group();
  legL.position.set(-SKEL.hipX, 0, 0);
  legL.add(toonPart(legGeo(-1), mBoot, 2.2));
  hips.add(legL);

  const legR = new THREE.Group();
  legR.position.set(SKEL.hipX, 0, 0);
  legR.add(toonPart(legGeo(1), mBoot, 2.2));
  hips.add(legR);

  /* ---------------- the coat ---------------- */
  // Skirt: hips-local, so world Y = local + 0.60. Widest at the rolled hem,
  // which gives him the A-line silhouette of a long winter coat.
  // NOTE: paunch() and waveHem() both recompute vertex normals, which splits
  // the lathe's phi seam into a visible crease. smoothed() heals it back.
  const skirtGeo = smoothed(
    waveHem(
      paunch(
        lathe(
          [
            [0.001, -0.302],
            [0.24, -0.306],
            [0.352, -0.312],
            [0.404, -0.29],
            [0.412, -0.252],
            [0.396, -0.19],
            [0.376, -0.1],
            [0.362, 0.0],
            [0.354, 0.09],
            [0.342, 0.17],
            [0.318, 0.25],
            [0.272, 0.32],
            [0.001, 0.335],
          ],
          22
        ),
        0.14, // belly centre, hips-local (world 0.74)
        0.15,
        0.05
      ),
      -0.24,
      0.014,
      7
    )
  );
  const coatSkirt = toonPart(skirtGeo, mCoat, 2.9);
  hem.add(coatSkirt);

  // Chest: chest-local, world Y = local + 0.94. Always narrower than the skirt
  // through the overlap so the two lathes never fight at the waist.
  const coatBodyGeo = smoothed(
    mergeGeometries([
      lathe(
        [
          [0.001, -0.09],
          [0.2, -0.088],
          [0.262, -0.075],
          [0.288, -0.02],
          [0.296, 0.04],
          [0.288, 0.1],
          [0.262, 0.16],
          [0.212, 0.21],
          [0.166, 0.25],
          [0.15, 0.275],
          [0.001, 0.282],
        ],
        22
      ),
      // shoulder caps, so the arms grow out of the coat instead of stabbing it
      blob(0.098, [1, 0.9, 1], [-0.235, 0.145, 0], [0, 0, 0], 10),
      blob(0.098, [1, 0.9, 1], [0.235, 0.145, 0], [0, 0, 0], 10),
      // three toggle buttons down the front
      blob(0.026, [1, 1, 0.6], [0, 0.03, 0.29], [0, 0, 0], 8),
      blob(0.026, [1, 1, 0.6], [0, -0.05, 0.288], [0, 0, 0], 8),
    ])
  );
  const coatBody = toonPart(coatBodyGeo, mCoat, 2.9);
  chest.add(coatBody);

  // Shearling collar standing up inside the scarf.
  const collar = toonPart(
    smoothed(
      (() => {
        const g = new THREE.TorusGeometry(0.15, 0.055, 8, 20);
        g.rotateX(Math.PI / 2);
        g.scale(1, 1, 0.94);
        g.translate(0, 0.265, 0);
        return g;
      })()
    ),
    mTrim,
    2.0
  );
  chest.add(collar);

  /* ---------------- arms ---------------- */
  function buildArm(side: -1 | 1) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * SKEL.shoulderX, SKEL.shoulderYOff, 0);

    const upper = new THREE.Group();
    upper.add(toonPart(plushCapsule(0.098, 0.086, SKEL.upperArm, 9), mCoat, 2.4));
    shoulder.add(upper);

    const fore = new THREE.Group();
    fore.position.y = -SKEL.upperArm;
    // Flares at the wrist — that flare is the coat cuff, and it stops the arm
    // reading as a sausage.
    fore.add(toonPart(plushCapsule(0.086, 0.098, SKEL.foreArm, 9), mCoat, 2.4));
    upper.add(fore);

    const mitten = new THREE.Group();
    mitten.position.y = -SKEL.foreArm;
    const mittenGeo = smoothed(
      mergeGeometries([
        blob(SKEL.mittenR, [1.0, 1.12, 0.92], [0, -0.055, 0.006], [0, 0, 0], 10),
        // thumb, on the inboard side of each hand
        blob(0.046, [1, 1.15, 1], [side * -0.072, -0.028, 0.032], [0.3, 0, 0], 8),
      ])
    );
    mitten.add(toonPart(mittenGeo, mWool, 2.3));
    fore.add(mitten);

    return { shoulder, upper, fore, mitten };
  }

  const armL = buildArm(-1);
  const armR = buildArm(1);
  chest.add(armL.shoulder);
  chest.add(armR.shoulder);

  // THE POINTING FINGER. Three knuckles of decreasing size on a slight curve,
  // because a straight cone reads as a spike and a grandfather's forefinger is
  // knobbly. It lives inside the mitten until he actually points.
  const finger = toonPart(
    smoothed(
      mergeGeometries([
        blob(0.042, [1, 1.05, 1], [0, -0.1, 0.012], [0, 0, 0], 8),
        blob(0.034, [1, 1.05, 1], [0.002, -0.146, 0.02], [0, 0, 0], 8),
        blob(0.027, [1, 1.1, 1], [0.004, -0.186, 0.024], [0, 0, 0], 8),
      ])
    ),
    mWool,
    1.9
  );
  finger.scale.setScalar(0.34);
  armR.mitten.add(finger);

  /* ---------------- head ---------------- */
  const skinGeo = smoothed(
    mergeGeometries([
      blob(SKEL.headR, [1.03, 1.09, 1.02], [0, 0.15, 0], [0, 0, 0], 18),
      // jaw and a soft second chin
      blob(0.155, [1.0, 0.82, 0.98], [0, 0.055, 0.03], [0, 0, 0], 14),
      blob(0.052, [0.5, 1.0, 0.85], [-0.208, 0.14, -0.005], [0, 0, 0], 10),
      blob(0.052, [0.5, 1.0, 0.85], [0.208, 0.14, -0.005], [0, 0, 0], 10),
    ])
  );
  head.add(toonPart(skinGeo, mSkin, 2.7));

  // The big soft nose and two apple cheeks, in their own warmer material.
  // A ruddy nose does more for "kind old man" than any amount of geometry.
  const ruddyGeo = smoothed(
    mergeGeometries([
      blob(0.052, [1, 1, 1], [0, 0.155, 0.168], [0, 0, 0], 12),
      blob(0.062, [0.95, 0.88, 1.0], [0, 0.115, 0.198], [0, 0, 0], 14),
      blob(0.062, [1.05, 0.78, 0.62], [-0.132, 0.095, 0.16], [0, 0, 0], 12),
      blob(0.062, [1.05, 0.78, 0.62], [0.132, 0.095, 0.16], [0, 0, 0], 12),
    ])
  );
  head.add(toonPart(ruddyGeo, mRuddy, false));

  /* eyes — the whole game's most-looked-at pixels */
  const eyeRig = new THREE.Group();
  eyeRig.position.set(0, 0.175, 0);
  head.add(eyeRig);

  const eyeBalls = new THREE.Mesh(
    mergeGeometries([
      blob(0.037, [1, 1, 1], [-0.078, 0, 0.164], [0, 0, 0], 12),
      blob(0.037, [1, 1, 1], [0.078, 0, 0.164], [0, 0, 0], 12),
    ]),
    mEye
  );
  eyeBalls.castShadow = false;
  eyeRig.add(eyeBalls);

  // Catchlights ride INSIDE the eyeball group so a blink swallows them.
  const catchlights = new THREE.Mesh(
    mergeGeometries([
      blob(0.0135, [1, 1, 1], [-0.07, 0.019, 0.194], [0, 0, 0], 8),
      blob(0.0135, [1, 1, 1], [0.07, 0.019, 0.194], [0, 0, 0], 8),
    ]),
    mCatch
  );
  catchlights.layers.set(NO_INK_LAYER); // never ink a highlight
  catchlights.castShadow = false;
  catchlights.renderOrder = 4;
  eyeBalls.add(catchlights);

  // Lids scale DOWN from the top edge of the eye, so a blink closes from
  // above like a real one instead of squashing symmetrically.
  const lids = new THREE.Mesh(
    mergeGeometries([
      blob(0.046, [1.06, 0.95, 0.62], [-0.078, -0.0437, 0.166], [0, 0, 0], 12),
      blob(0.046, [1.06, 0.95, 0.62], [0.078, -0.0437, 0.166], [0, 0, 0], 12),
    ]),
    mSkin
  );
  lids.position.y = 0.038;
  lids.scale.y = 0.02;
  lids.castShadow = false;
  eyeRig.add(lids);

  /* spectacles — round, wire, resting on that nose */
  const specGeo = smoothed(
    mergeGeometries([
      (() => {
        const g = new THREE.TorusGeometry(0.062, 0.0085, 6, 18);
        g.translate(-0.078, 0.175, 0.222);
        return g;
      })(),
      (() => {
        const g = new THREE.TorusGeometry(0.062, 0.0085, 6, 18);
        g.translate(0.078, 0.175, 0.222);
        return g;
      })(),
      strut(0.0075, new THREE.Vector3(-0.03, 0.19, 0.216), new THREE.Vector3(0.03, 0.19, 0.216)),
      strut(0.0065, new THREE.Vector3(-0.138, 0.18, 0.215), new THREE.Vector3(-0.192, 0.196, 0.028)),
      strut(0.0065, new THREE.Vector3(0.138, 0.18, 0.215), new THREE.Vector3(0.192, 0.196, 0.028)),
    ])
  );
  head.add(toonPart(specGeo, mSpecs, false));

  const lensGeo = mergeGeometries([
    (() => {
      const g = new THREE.CircleGeometry(0.058, 16);
      g.translate(-0.078, 0.175, 0.2195);
      return g;
    })(),
    (() => {
      const g = new THREE.CircleGeometry(0.058, 16);
      g.translate(0.078, 0.175, 0.2195);
      return g;
    })(),
  ]);
  const lenses = new THREE.Mesh(lensGeo, mLens);
  lenses.layers.set(NO_INK_LAYER);
  lenses.castShadow = false;
  lenses.renderOrder = 3;
  head.add(lenses);

  /* brows — bushy, and pivoted at their INNER end so worry tilts them */
  function buildBrow(side: -1 | 1) {
    const g = new THREE.Group();
    g.position.set(side * 0.036, 0.225, 0.188);
    const geo = smoothed(
      mergeGeometries([
        blob(0.03, [1, 0.62, 0.75], [0, 0, 0], [0, 0, 0], 8),
        blob(0.034, [1, 0.6, 0.75], [side * 0.052, 0.01, -0.014], [0, 0, 0], 8),
        blob(0.028, [1, 0.55, 0.72], [side * 0.104, 0.004, -0.042], [0, 0, 0], 8),
      ])
    );
    g.add(toonPart(geo, mHair, 1.8));
    return g;
  }
  const browL = buildBrow(-1); // his left
  const browR = buildBrow(1);
  head.add(browL);
  head.add(browR);

  /* mouth — sits proud of the beard so it always reads through the whiskers */
  const mouthGroup = new THREE.Group();
  mouthGroup.position.set(0, 0.055, 0.235);
  head.add(mouthGroup);

  const smileGeo = new THREE.TorusGeometry(0.048, 0.0125, 6, 14, Math.PI);
  smileGeo.rotateZ(Math.PI); // flip the half-torus into a ∪
  const smileMesh = new THREE.Mesh(smileGeo, mDark);
  smileMesh.castShadow = false;
  mouthGroup.add(smileMesh);

  const mouthMesh = new THREE.Mesh(blob(0.06, [1.15, 0.9, 0.45], [0, -0.012, -0.02], [0, 0, 0], 12), mDark);
  mouthMesh.castShadow = false;
  mouthMesh.scale.y = 0.02;
  mouthGroup.add(mouthMesh);

  /* hair, moustache, the fixed part of the beard */
  const hairPieces: THREE.BufferGeometry[] = [
    // moustache, sweeping down and out over the mouth
    blob(0.055, [1.75, 0.62, 0.85], [-0.058, 0.098, 0.202], [0, 0.18, 0.32], 10),
    blob(0.055, [1.75, 0.62, 0.85], [0.058, 0.098, 0.202], [0, -0.18, -0.32], 10),
    // beard mass: two jaw lobes, an under-chin, and sideburns up to the cap
    blob(0.1, [0.95, 1.1, 0.95], [-0.095, -0.01, 0.145], [0, 0, 0], 12),
    blob(0.1, [0.95, 1.1, 0.95], [0.095, -0.01, 0.145], [0, 0, 0], 12),
    blob(0.115, [1.05, 1.0, 1.0], [0, -0.075, 0.16], [0, 0, 0], 14),
    blob(0.09, [0.8, 1.15, 0.95], [-0.145, 0.055, 0.06], [0, 0, 0], 10),
    blob(0.09, [0.8, 1.15, 0.95], [0.145, 0.055, 0.06], [0, 0, 0], 10),
  ];
  // white tufts escaping from under the cap
  const tufts: Array<[number, number, number]> = [
    [2.05, 0.155, 0.2],
    [2.55, 0.185, 0.196],
    [-2.05, 0.155, 0.2],
    [-2.55, 0.185, 0.196],
    [Math.PI, 0.2, 0.19],
    [1.62, 0.128, 0.205],
    [-1.62, 0.128, 0.205],
  ];
  for (const [ang, y, r] of tufts) {
    hairPieces.push(
      blob(0.05, [1.25, 0.72, 1.0], [Math.sin(ang) * r, y, Math.cos(ang) * r], [0, ang, 0], 8)
    );
  }
  head.add(toonPart(smoothed(mergeGeometries(hairPieces)), mHair, 2.4));

  /* the knitted cap */
  const cap = new THREE.Group();
  cap.rotation.x = -0.06; // worn a touch back off the brows
  cap.position.z = 0.008;
  head.add(cap);

  const capDome = lathe(
    [
      [0.15, 0.238],
      [0.198, 0.256],
      [0.214, 0.292],
      [0.21, 0.33],
      [0.192, 0.366],
      [0.156, 0.394],
      [0.108, 0.412],
      [0.001, 0.42],
    ],
    20
  );
  cap.add(toonPart(capDome, mKnit, 2.6));

  const capTrim = smoothed(
    mergeGeometries([
      (() => {
        const g = new THREE.TorusGeometry(0.19, 0.04, 8, 22);
        g.rotateX(Math.PI / 2);
        g.translate(0, 0.268, 0);
        return g;
      })(),
      // bobble, with a short knitted stalk so it does not float
      blob(0.022, [1, 1, 1], [0, 0.412, -0.008], [0, 0, 0], 8),
      blob(0.048, [1, 0.94, 1], [0, 0.44, -0.012], [0, 0, 0], 12),
    ])
  );
  cap.add(toonPart(capTrim, mTrim, 2.4));

  /* ---------------- scarf ---------------- */
  // Two wraps around the neck, over the shearling collar, the way a scarf
  // actually sits. This is the only scarfRed in the park.
  const scarfWrap = smoothed(
    mergeGeometries([
      (() => {
        const g = new THREE.TorusGeometry(0.172, 0.058, 8, 22);
        g.rotateX(Math.PI / 2);
        g.scale(1, 1, 0.9);
        g.translate(0, 0.2, 0);
        return g;
      })(),
      (() => {
        const g = new THREE.TorusGeometry(0.16, 0.05, 8, 20);
        g.rotateX(Math.PI / 2);
        g.scale(1, 1, 0.9);
        g.rotateY(0.5);
        g.translate(0, 0.252, 0);
        return g;
      })(),
    ])
  );
  chest.add(toonPart(scarfWrap, mWool, 2.6));

  /* ---------------- chains: beard + scarf tail ---------------- */
  // Anchors are empties on the real bones, so the chains inherit every head
  // turn and every shoulder shake.
  const beardAnchor = new THREE.Object3D();
  beardAnchor.position.set(0, -0.05, 0.2);
  head.add(beardAnchor);

  const scarfAnchor = new THREE.Object3D();
  scarfAnchor.position.set(-0.115, 0.19, 0.185);
  chest.add(scarfAnchor);

  const mouthAnchor = new THREE.Object3D();
  mouthAnchor.position.set(0, 0.05, 0.26);
  head.add(mouthAnchor);

  const BEARD_SEGS = 3;
  const beardSegs: THREE.Object3D[] = [];
  // The taper has to be CONTINUOUS across the links: each segment must end at
  // exactly the radius the next one begins at. Where it does not, the next
  // segment's shoulder pokes out through this one and the inverted-hull
  // outline draws a ring of ink straight across his beard at every joint.
  const beardR = (i: number) => 0.115 * (1 - i * 0.16);
  for (let i = 0; i < BEARD_SEGS; i++) {
    const g = new THREE.Group();
    const seg = plushCapsule(beardR(i), beardR(i + 1), SKEL.beardLength / BEARD_SEGS, 10);
    seg.scale(1.06, 1, 0.92);
    g.add(toonPart(seg, mHair, false));
    root.add(g);
    beardSegs.push(g);
  }

  const SCARF_SEGS = 3;
  const scarfSegs: THREE.Object3D[] = [];
  for (let i = 0; i < SCARF_SEGS; i++) {
    const g = new THREE.Group();
    const seg = plushCapsule(0.052, 0.05, SKEL.scarfLength / SCARF_SEGS, 8);
    // flattened into a ribbon — a knitted scarf is not a rope
    seg.scale(1.45, 1, 0.55);
    g.add(toonPart(seg, mWool, 2.2));
    root.add(g);
    scarfSegs.push(g);
  }
  // A fringed end, so the tail terminates in something rather than stopping.
  const fringe = toonPart(
    smoothed(
      mergeGeometries([
        blob(0.03, [1.6, 0.5, 0.6], [0, -0.155, 0], [0, 0, 0], 8),
        blob(0.014, [1, 2.2, 1], [-0.045, -0.19, 0], [0, 0, 0], 6),
        blob(0.014, [1, 2.2, 1], [0, -0.198, 0.006], [0, 0, 0], 6),
        blob(0.014, [1, 2.2, 1], [0.045, -0.19, 0], [0, 0, 0], 6),
      ])
    ),
    mWool,
    1.8
  );
  scarfSegs[SCARF_SEGS - 1].add(fringe);

  /* ---------------- the lantern ---------------- */
  const lanternRoot = new THREE.Group();
  lanternRoot.position.set(0, -0.05, 0.062);
  armL.mitten.add(lanternRoot);

  // A gimbal that cancels the hand's rotation, so the pendulum always swings
  // about world-vertical. A lantern that tips with the wrist reads as glued on.
  const lanternGimbal = new THREE.Group();
  lanternRoot.add(lanternGimbal);

  const lanternSwing = new THREE.Group();
  lanternGimbal.add(lanternSwing);

  const lanternFrame = smoothed(
    mergeGeometries([
      // bail
      (() => {
        const g = new THREE.TorusGeometry(0.052, 0.007, 5, 14, Math.PI * 1.05);
        g.rotateY(Math.PI / 2);
        g.translate(0, -0.022, 0);
        return g;
      })(),
      // cap and finial
      lathe(
        [
          [0.001, -0.052],
          [0.03, -0.058],
          [0.052, -0.072],
          [0.064, -0.088],
          [0.05, -0.094],
          [0.001, -0.094],
        ],
        10
      ),
      // four corner posts
      ...[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return strut(
          0.008,
          new THREE.Vector3(Math.cos(a) * 0.046, -0.088, Math.sin(a) * 0.046),
          new THREE.Vector3(Math.cos(a) * 0.046, -0.202, Math.sin(a) * 0.046),
          5
        );
      }),
      // base
      lathe(
        [
          [0.001, -0.196],
          [0.056, -0.198],
          [0.066, -0.208],
          [0.058, -0.224],
          [0.001, -0.226],
        ],
        10
      ),
    ])
  );
  lanternSwing.add(toonPart(lanternFrame, mWood, 2.0));

  // The glass — flat honey, tone-mapping off, so bloom finds it and it stays
  // the brightest thing in frame no matter how the grade moves.
  const lanternGlass = new THREE.Mesh(
    lathe(
      [
        [0.001, -0.096],
        [0.05, -0.1],
        [0.054, -0.14],
        [0.05, -0.19],
        [0.001, -0.194],
      ],
      12
    ),
    mGlass
  );
  lanternGlass.layers.set(NO_INK_LAYER);
  lanternGlass.castShadow = false;
  lanternSwing.add(lanternGlass);

  const lanternGlow = new THREE.Sprite(
    keep(
      new THREE.SpriteMaterial({
        map: glowSprite(PALETTE.lanternCore),
        color: PALETTE.lanternCore,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: false,
      })
    )
  );
  lanternGlow.position.set(0, -0.145, 0);
  lanternGlow.scale.setScalar(0.78);
  lanternGlow.layers.set(NO_INK_LAYER);
  lanternGlow.renderOrder = 8;
  lanternSwing.add(lanternGlow);

  // A REAL light. This is what makes the glow sway across the snow.
  const lanternLight = new THREE.PointLight(PALETTE.lanternCore, 14, 20, 2);
  lanternLight.position.set(0, -0.145, 0);
  lanternLight.castShadow = false; // a shadow-casting point light is not worth 6 extra passes
  lanternSwing.add(lanternLight);

  /* ---------------- breath ---------------- */
  const breath = buildBreath(seed);
  root.add(breath.points);

  /* ---------------- rest pose ----------------
   * Authored so that if the frame loop never runs he still stands well:
   * weight settled, arms down and slightly forward, never a T-pose.        */
  armL.upper.rotation.set(0.18, 0, 0.2);
  armL.fore.rotation.set(-0.5, 0, 0.1);
  armR.upper.rotation.set(0.12, 0, -0.16);
  armR.fore.rotation.set(-0.22, 0, -0.06);

  return {
    root, body, hips, hem, spine, chest, neck, head,
    legL, legR,
    shoulderL: armL.shoulder, shoulderR: armR.shoulder,
    upperL: armL.upper, upperR: armR.upper,
    foreL: armL.fore, foreR: armR.fore,
    mittenL: armL.mitten, mittenR: armR.mitten,
    finger,
    coatBody, coatSkirt,
    eyeRig, eyeBalls, lids, catchlights, browL, browR,
    smileMesh, mouthMesh, ruddyMat: mRuddy,
    beardAnchor, scarfAnchor, beardSegs, scarfSegs,
    mouthAnchor, breath,
    lanternRoot, lanternGimbal, lanternSwing, lanternLight, lanternGlow,
    dispose() {
      // Outlines share their parent's geometry, so this disposes some things
      // twice. three tolerates that; a leaked buffer on every hot reload is
      // what actually hurts.
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
      for (const d of disposables) d.dispose();
      breath.material.dispose();
    },
  };
}

/* ================================================================== *
 * THE COMPONENT
 * ================================================================== */

export interface ChessPaaProps {
  /** World position of the soles of his boots. */
  position?: [number, number, number];
  /** Euler XYZ, radians. He faces +Z at rotation 0. */
  rotation?: [number, number, number];
  /** Drives his whole performance. Transitions are sprung, never cut. */
  mood?: ChessPaaMood;
  /**
   * A WORLD-SPACE point. He always follows it with his eyes and head;
   * with `mood="pointing"` he also reaches for it with his forefinger.
   */
  pointAt?: [number, number, number] | null;
  /** Uniform scale. 1 puts his cap crown at 1.70 units. */
  scale?: number;
  /** Show the lantern and its practical light. Default true. */
  lantern?: boolean;
  /** Peak intensity of the lantern's point light. Default 14. */
  lanternIntensity?: number;
  /** Visible breath in the cold. Default true. */
  breathFog?: boolean;
  /** Deterministic seed for blink/gaze/fidget timing. */
  seed?: number;
}

/* frame-loop scratch */
const _w = new THREE.Vector3();
const _w2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _rq = new THREE.Quaternion();
const _bufSize = new THREE.Vector2();
const BEARD_REST = /* @__PURE__ */ new THREE.Vector3(0, -1, 0.45).normalize();
const SCARF_REST = /* @__PURE__ */ new THREE.Vector3(-0.1, -1, 0.5).normalize();

/**
 * Everything mutable about one ChessPaa: the object graph, the pose rig and
 * the physics state.
 *
 * Held in a ref rather than a useMemo on purpose. A character is an
 * imperative, stateful thing that a frame loop writes to sixty times a second
 * — a ref is React's sanctioned home for exactly that, and it keeps the
 * compiler's immutability analysis honest about what is going on here.
 */
interface ChessPaaStore {
  built: Built;
  rig: ReturnType<typeof createChessPaaRig>;
  beard: VerletChain;
  scarf: VerletChain;
  lantern: Pendulum;
  hemX: Spring;
  hemZ: Spring;
  rootPos: SpringVec3;
  pointLocal: THREE.Vector3;
  poleL: THREE.Vector3;
  poleR: THREE.Vector3;
  primed: boolean;
  dispose(): void;
}

function createChessPaaStore(seed: number): ChessPaaStore {
  const built = buildChessPaa(seed);

  const beard = new VerletChain({
    segments: 3,
    length: SKEL.beardLength,
    gravity: 6.5,
    damping: 0.93,
    restPull: 8.5,
    maxAngle: 0.42,
  });
  const scarf = new VerletChain({
    segments: 3,
    length: SKEL.scarfLength,
    gravity: 8.5,
    damping: 0.95,
    restPull: 5.0,
    maxAngle: 0.75,
  });
  // Both ride on the outside of his coat instead of sawing through it.
  beard.collider = SKEL.torsoCollider;
  scarf.collider = SKEL.torsoCollider;

  return {
    built,
    rig: createChessPaaRig(seed),
    beard,
    scarf,
    lantern: new Pendulum({
      length: 0.16, gravity: 9.0, drive: 0.9, damping: 0.3, maxAngle: 0.7, idle: 0.05,
    }),
    // The coat hem trails the hips and overshoots a touch on the way back.
    hemX: new Spring(0, 0.2, 0.72),
    hemZ: new Spring(0, 0.2, 0.72),
    rootPos: new SpringVec3(0.22, 0.9),
    pointLocal: new THREE.Vector3(),
    // Elbow hints: down, out and back, so his arms never invert.
    poleL: new THREE.Vector3(-0.78, 0.5, -0.5),
    poleR: new THREE.Vector3(0.78, 0.5, -0.5),
    primed: false,
    dispose() {
      built.dispose();
    },
  };
}

export default function ChessPaa({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  mood = "idle",
  pointAt = null,
  scale = 1,
  lantern = true,
  lanternIntensity = 14,
  breathFog = true,
  seed = 41,
}: ChessPaaProps) {
  const hostRef = useRef<THREE.Group>(null);
  const storeRef = useRef<ChessPaaStore | null>(null);

  // Built on mount and attached imperatively, rather than handed to React as
  // a <primitive>. He is a self-contained object graph the frame loop owns;
  // React only needs to know where to hang him.
  //
  // `seed` is read once here — pass a `key` if you ever need a rebuild.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const s = createChessPaaStore(seed);
    storeRef.current = s;

    // He must never RECEIVE the park's shadow map. It spans ~180 world units
    // at 2048px, so one texel is ~9cm — wider than his beard segments. Self-
    // shadowing at that ratio painted a blocky black mask across his face and
    // chest. He still CASTS (his shadow on the snow is the whole point of the
    // lantern); he is lit by the toon ramp and his warm rim instead, which is
    // exactly the cel language anyway.
    s.built.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.receiveShadow = false;
    });

    host.add(s.built.root);
    return () => {
      host.remove(s.built.root);
      s.dispose();
      storeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const s = storeRef.current;
    if (!s) return;
    s.built.lanternRoot.visible = lantern;
    s.built.lanternLight.visible = lantern;
    // Light radius is a world quantity; three does not scale it for us.
    s.built.lanternLight.distance = 20 * scale;
  }, [lantern, scale]);

  useFrame((state, dtRaw) => {
    const sim = storeRef.current;
    if (!sim) return;
    const dt = Math.min(0.05, dtRaw);
    const t = state.clock.elapsedTime;
    const b = sim.built;
    const rig = sim.rig;
    const root = b.root;

    root.updateWorldMatrix(true, false);

    /* ---- point target into root space ---- */
    let point: THREE.Vector3 | null = null;
    if (pointAt) {
      sim.pointLocal.set(pointAt[0], pointAt[1], pointAt[2]);
      root.worldToLocal(sim.pointLocal);
      point = sim.pointLocal;
    }

    const p = rig.update(dt, t, { mood, pointAt: point });
    const wind = parkWind(t, 0.55);

    /* ---- torso: one long S-curve from boots to cap ---- */
    b.body.position.y = p.bob;
    b.hips.position.y = SKEL.hipY - Math.abs(p.weight) * 0.006;
    b.hips.rotation.set(p.lean * 0.3, p.twist * 0.3, p.side * 0.5 + p.weight * 0.018);
    b.spine.rotation.set(p.lean * 0.4 + p.bellyBounce * 0.012, p.twist * 0.3, -p.side * 0.25);
    b.chest.rotation.set(
      p.lean * 0.3 - p.bellyBounce * 0.02,
      p.twist * 0.4,
      p.side * 0.35 - p.weight * 0.026 + p.shoulderShake * 0.018
    );
    b.neck.rotation.set(p.lean * 0.12, p.twist * 0.15, 0);
    b.head.rotation.set(p.headPitch, p.headYaw, p.headRoll + p.weight * 0.01);

    // Contrapposto. The pelvis has to SHIFT over the loaded hip — a weight
    // change expressed only as a tilt reads as a wobble, not as weight moving.
    // Both legs then counter-rotate by exactly the angle that returns the
    // soles to where they were (pivot-to-sole is 0.6), so he sways over his
    // feet instead of skating them sideways across the snow.
    const hipShift = p.weight * 0.017;
    b.hips.position.x = hipShift;
    b.legL.rotation.z = -hipShift / 0.6;
    b.legR.rotation.z = -hipShift / 0.6;

    /* ---- breathing ---- */
    const cs = p.chestScale;
    b.coatBody.scale.set(1 + (cs - 1) * 0.55, cs, cs);
    const bs = p.bellyScale - 1 + p.bellyBounce * 0.02;
    b.coatSkirt.scale.set(1 + bs * 0.7, 1 - bs * 0.2, 1 + bs);
    b.shoulderL.position.y = SKEL.shoulderYOff + p.breath * 0.008 + p.shoulderShake * 0.011;
    b.shoulderR.position.y = SKEL.shoulderYOff + p.breath * 0.008 - p.shoulderShake * 0.011;

    /* ---- the coat hem arrives a beat late ---- */
    // Chase the hips' current rotation with a lagging spring; the DIFFERENCE
    // between where the hips are and where the spring has got to is exactly
    // how far the skirt has yet to catch up. Counter-rotate by it and the
    // coat swings.
    sim.hemX.to(b.hips.rotation.x);
    sim.hemZ.to(b.hips.rotation.z);
    sim.hemX.step(dt);
    sim.hemZ.step(dt);

    // Same trick for translation: track where he WAS and lean the hem against
    // the direction he has just moved.
    root.getWorldPosition(_w);
    if (!sim.primed) {
      sim.rootPos.snap(_w);
      sim.primed = true;
    }
    sim.rootPos.to(_w);
    sim.rootPos.step(dt);
    _w2.subVectors(_w, sim.rootPos.value);
    root.getWorldQuaternion(_rq);
    _w2.applyQuaternion(_rq.invert()); // travel, expressed in his own frame

    b.hem.rotation.x = THREE.MathUtils.clamp(
      (b.hips.rotation.x - sim.hemX.value) * -1.3 + _w2.z * 1.6 - wind.z * 0.035,
      -0.3,
      0.3
    );
    b.hem.rotation.z = THREE.MathUtils.clamp(
      (b.hips.rotation.z - sim.hemZ.value) * -1.3 - _w2.x * 1.6 + wind.x * 0.035,
      -0.3,
      0.3
    );

    /* ---- arms ---- */
    _w.copy(p.handL);
    root.localToWorld(_w);
    _w2.copy(sim.poleL);
    root.localToWorld(_w2);
    solveTwoBoneIK(b.upperL, b.foreL, _w, _w2, {
      upperLength: SKEL.upperArm,
      lowerLength: SKEL.foreArm,
      maxExtend: 0.97,
    });

    _w.copy(p.handR);
    root.localToWorld(_w);
    _w2.copy(sim.poleR);
    root.localToWorld(_w2);
    solveTwoBoneIK(b.upperR, b.foreR, _w, _w2, {
      upperLength: SKEL.upperArm,
      lowerLength: SKEL.foreArm,
      maxExtend: 0.97,
    });

    b.finger.scale.setScalar(0.34 + 0.66 * p.fingerPoint);

    /* ---- face ---- */
    b.eyeRig.position.set(p.eyeShiftX, 0.175 + p.eyeShiftY, 0);
    const open = THREE.MathUtils.clamp(p.eyeOpen, 0.05, 1.3);
    b.eyeBalls.scale.set(1 + (open - 1) * 0.22, open, 1);
    b.lids.scale.y = THREE.MathUtils.clamp(1.04 - open, 0.02, 1.1);

    // The twinkle is carried by SIZE alone. `mCatch` is an opaque basic
    // material, so writing `.opacity` on it every frame did nothing at all.
    b.catchlights.scale.setScalar(0.75 + p.twinkle * 0.45);

    b.browL.position.y = 0.225 + p.browL * 0.03 + p.browTilt * 0.012;
    b.browR.position.y = 0.225 + p.browR * 0.03 + p.browTilt * 0.012;
    // Pivoted at the inner end, so a positive tilt drops each OUTER end —
    // the classic worried brow.
    b.browL.rotation.z = p.browTilt * 0.5 - p.browRaise * 0.05;
    b.browR.rotation.z = -p.browTilt * 0.5 + p.browRaise * 0.05;

    b.smileMesh.scale.set(0.62 + p.smile * 0.5, 0.45 + p.smile * 0.75, 1);
    b.mouthMesh.scale.set(0.8 + p.mouthOpen * 0.28, 0.02 + p.mouthOpen * 1.0, 1);
    // Cheeks flush when he laughs. Cheaper and warmer than any blush texture.
    b.ruddyMat.emissiveIntensity = 0.04 + p.cheek * 0.14;

    /* ---- beard + scarf: simulated, in root space ---- */
    b.beardAnchor.getWorldPosition(_w);
    root.worldToLocal(_w);
    b.beardAnchor.getWorldQuaternion(_q);
    root.getWorldQuaternion(_rq);
    _dir.copy(BEARD_REST).applyQuaternion(_q).applyQuaternion(_rq.invert());
    sim.beard.step(dt, _w, _dir, wind);
    sim.beard.applyToSegments(b.beardSegs);

    b.scarfAnchor.getWorldPosition(_w);
    root.worldToLocal(_w);
    b.scarfAnchor.getWorldQuaternion(_q);
    root.getWorldQuaternion(_rq);
    _dir.copy(SCARF_REST).applyQuaternion(_q).applyQuaternion(_rq.invert());
    sim.scarf.step(dt, _w, _dir, wind);
    sim.scarf.applyToSegments(b.scarfSegs);

    /* ---- lantern ---- */
    if (lantern) {
      // Cancel the wrist so the pendulum hangs about world-vertical.
      b.mittenL.getWorldQuaternion(_q);
      root.getWorldQuaternion(_rq);
      b.lanternGimbal.quaternion.copy(_q).invert().multiply(_rq);

      b.lanternRoot.getWorldPosition(_w);
      root.worldToLocal(_w);
      sim.lantern.step(dt, _w, t);
      sim.lantern.applyTo(b.lanternSwing);

      // Flame flicker, lifted a touch by how hard it is being swung.
      const fl = p.lanternFlicker + Math.min(0.12, sim.lantern.speed * 0.05);
      b.lanternLight.intensity = lanternIntensity * fl;
      b.lanternGlow.scale.setScalar((0.7 + fl * 0.16) * (1 + p.twinkle * 0.05));
    }

    /* ---- breath fog ---- */
    if (breathFog) {
      const u = b.breath.material.uniforms;
      if (p.exhaled) {
        // Freeze the emitter frame at the instant of the exhale: the puff
        // must hang in the air where it was made, not ride his jaw around.
        b.mouthAnchor.getWorldPosition(_w);
        root.worldToLocal(_w);
        b.breath.points.position.copy(_w);
        b.mouthAnchor.getWorldQuaternion(_q);
        root.getWorldQuaternion(_rq);
        b.breath.points.quaternion.copy(_rq.invert()).multiply(_q);
      }
      state.gl.getDrawingBufferSize(_bufSize);
      u.uPixelScale.value = _bufSize.y * 0.5;
      u.uAge.value = p.exhaleAge;
      u.uLife.value = p.puffLife;
      b.breath.points.visible = p.exhaleAge < p.puffLife;
    } else {
      b.breath.points.visible = false;
    }
  });

  return <group ref={hostRef} position={position} rotation={rotation} scale={scale} />;
}
