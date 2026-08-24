"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { PALETTE, mix } from "../core/palette";
import { createToonMaterial, createFlatMaterial } from "../core/materials/ToonMaterial";
import { createOutlineMaterial, smoothNormalsForOutline } from "../core/materials/OutlineMaterial";
import { patchMaterialForBandedFog } from "../core/materials/SkyMaterial";
import { glowSprite, rng } from "../core/textures/procedural";
import { pieceGeometry, type PieceType } from "../core/geometry/pieces";
import { NO_INK_LAYER } from "../core/postfx/effects";
import { buildInstanced } from "../core/instancing";
import { QUALITY_LADDER, particleCount } from "../core/perf";
import { mergeGeometries } from "./terrain";
import {
  walkRoutes, sampleRoute, buildFolk, folkPose, GAITS,
  buildCrows, crowPose, buildGlitterField, glitterSprite,
  duskAt, DUSK_MINUTES, GLITTER_BASE,
  type LifeQuality, type RoutePoint, type FolkPose, type CrowPose,
} from "./parkLifeData";

/**
 * PARK LIFE — everything in the valley that moves on its own.
 *
 * Piece-folk walking their errands, crows lifting out of the pines, glitter
 * hanging over the ice. None of it is playable and none of it asks to be
 * looked at; the whole job is that a child who stands still for ten seconds
 * sees the park go on without them. That is the difference between a set and
 * a place.
 *
 * Every crowd is instanced and everything here sits on NO_INK_LAYER, which is
 * what keeps the bill honest. Counted from the geometry and the cast, main pass
 * plus the shadow pass the folk drag behind them:
 *
 *          cast              main   shadow   total    triangles
 *   high   24 folk 7 crows   13  +  5     = 18       41,532 + 20,206 = 61,738
 *   medium 14 folk 5 crows   11  +  4     = 15        9,752 +  4,476 = 14,228
 *   low     7 folk 3 crows    6  +  0     =  6        2,932 +      0 =  2,932
 *
 * Motes are 1280 / 880 / 480 and cost one call apiece, already counted. "low"
 * wears no ink and casts no shadow, which is where its five calls go. Each
 * mounted BreathFog adds one more. Nothing in this file is allowed to be the
 * reason a frame is late.
 */

export interface ParkLifeProps {
  /** 0 = golden hour, 1 = deep evening. Drives the carried lanterns and glitter. */
  dusk?: number;
  quality?: LifeQuality;
}

/* ================================================================== *
 * SHARED MATERIAL PATCHES                                             *
 * ================================================================== */

/**
 * Teach a lit material that its instances are not all standing at its origin.
 *
 * `createToonMaterial` takes its fresnel rim from `modelMatrix * transformed` —
 * correct for a single mesh, wrong for a crowd, where every instance would then
 * be rimmed as though it stood at the mesh's own origin. Twenty-four folk
 * scattered across the park would wear one identical, badly-placed edge of
 * light, which on pale figures against pale snow is exactly the failure the rim
 * exists to prevent.
 *
 * Folded in by chaining onBeforeCompile rather than by editing the shared
 * material: if that source is ever re-authored, these replaces quietly no-op
 * and we fall back to the old rim instead of failing to compile.
 */
function makeRimInstanceAware(mat: THREE.Material): void {
  const prev = mat.onBeforeCompile?.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        "vec4 _wp = modelMatrix * vec4(transformed, 1.0);",
        `vec4 _lp = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           _lp = instanceMatrix * _lp;
         #endif
         vec4 _wp = modelMatrix * _lp;`
      )
      .replace(
        "vToonNormal = normalize(mat3(modelMatrix) * objectNormal);",
        `vec3 _ln = objectNormal;
         #ifdef USE_INSTANCING
           _ln = mat3(instanceMatrix) * _ln;
         #endif
         vToonNormal = normalize(mat3(modelMatrix) * _ln);`
      );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  // The chained patch is invisible to the shared cache key, so tag it — two
  // materials with identical toon options must not share one program.
  mat.customProgramCacheKey = () => `${prevKey()}|instanced-rim`;
  mat.needsUpdate = true;
}

/**
 * The inverted-hull ink, made instance-aware.
 *
 * `addOutline` builds a plain child Mesh, which cannot follow a crowd: one
 * hull would sit at the mesh origin while two dozen folk walked away from it.
 * The material is the shared one — same warm ink, same constant screen width —
 * with `instanceMatrix` folded into the hull push.
 */
function instancedOutlineMaterial(thickness: number): THREE.ShaderMaterial {
  const mat = createOutlineMaterial({ thickness });
  mat.vertexShader = mat.vertexShader
    .replace(
      "vec4 mv = modelViewMatrix * vec4(position, 1.0);",
      `vec4 _lp = vec4(position, 1.0);
       vec3 _ln = normal;
       #ifdef USE_INSTANCING
         _lp = instanceMatrix * _lp;
         _ln = mat3(instanceMatrix) * _ln;
       #endif
       vec4 mv = modelViewMatrix * _lp;`
    )
    .replace("vec3 n = normalize(normalMatrix * normal);", "vec3 n = normalize(normalMatrix * _ln);");
  return mat;
}

/**
 * The factor that turns a size in METRES into a gl_PointSize in pixels:
 *   pixels = metres * uPixelScale / viewDistance
 *
 * Both halves matter. The drawing buffer moves under us whenever the adaptive
 * pixel-ratio governor spends quality, and the projection term (which is what a
 * plain half-height misses) is what stops every mote in the park from changing
 * size the moment a camera rig picks a different field of view.
 */
function pixelScale(gl: THREE.WebGLRenderer, camera: THREE.Camera, out: THREE.Vector2): number {
  gl.getDrawingBufferSize(out);
  const cam = camera as THREE.PerspectiveCamera;
  const fov = cam.isPerspectiveCamera ? cam.fov : 50;
  return (out.y * 0.5) / Math.tan((fov * Math.PI) / 360);
}

/* ================================================================== *
 * 1 · PIECE-FOLK                                                      *
 * ================================================================== */

interface FolkBatch {
  type: PieceType;
  mesh: THREE.InstancedMesh;
  outline: THREE.InstancedMesh | null;
  /** Indices into the folk list, in this batch's instance order. */
  members: number[];
}

interface FolkBuild {
  batches: FolkBatch[];
  lanterns: THREE.Points | null;
  /** Slot in the lantern point cloud for each folk index, or -1. */
  lanternSlot: Int32Array;
  lanternCount: number;
  dispose: () => void;
}

/** One tint per instance, so a crowd of pawns is a crowd and not a copy. */
function folkGeometryPair(type: PieceType, quality: LifeQuality) {
  const body = pieceGeometry(type, quality === "high" ? "high" : "low").clone();
  // Hard lathe/box edges split an inverted hull, so the ink gets its own
  // smoothed copy — same trick the signposts and supports use. "low" wears no
  // ink at all, so it does not pay for the copy either.
  const ink = quality === "low" ? null : smoothNormalsForOutline(body);
  // MeshToonMaterial only reads instanceColor when vertexColors is on, and
  // vertexColors with no `color` attribute makes every vertex black. Give the
  // clone a white one. (The clone matters: pieceGeometry caches, and the
  // carousel rides on the very same geometry.)
  const n = body.getAttribute("position").count;
  body.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return { body, ink };
}

function PieceFolk({ quality, duskRef }: { quality: LifeQuality; duskRef: React.RefObject<number> }) {
  const routes = useMemo(() => walkRoutes(), []);
  const folk = useMemo(() => buildFolk(quality), [quality]);

  const build = useMemo<FolkBuild>(() => {
    const byType = new Map<PieceType, number[]>();
    folk.forEach((f, i) => {
      const list = byType.get(f.type);
      if (list) list.push(i); else byType.set(f.type, [i]);
    });

    const disposables: Array<{ dispose: () => void }> = [];
    const batches: FolkBatch[] = [];

    for (const [type, members] of byType) {
      const { body, ink } = folkGeometryPair(type, quality);
      disposables.push(body);
      if (ink) disposables.push(ink);

      const mat = createToonMaterial({
        // The real colour rides on instanceColor; white here so the multiply
        // lands on the authored tint exactly.
        color: 0xffffff,
        ramp: "wood",
        // Set-dressing rim, but not a timid one: these are pale figures on pale
        // snow at the far end of a sightline.
        rim: 0.52, rimPower: 2.9, rimColor: PALETTE.honey, bounce: 0.3,
      });
      mat.vertexColors = true;
      patchMaterialForBandedFog(mat);
      makeRimInstanceAware(mat);
      disposables.push(mat);

      const mesh = buildInstanced(
        body, mat,
        members.map((i) => ({ position: [0, -1000, 0] as const, color: folk[i].tint })),
        {
          name: `folk-${type}`,
          castShadow: quality !== "low",
          receiveShadow: false,
          // NO-INK, AND WHY IT IS THE RIGHT LAYER FOR A CROWD.
          //
          // The Sobel's normal+depth prepass overrides every material with one
          // plain shader that does not apply `instanceMatrix`. In that pass —
          // and only that pass — every instance collapses onto the mesh origin,
          // so two dozen folk pile up at the plaza centre and the Sobel inks the
          // outline of that heap onto the plaza floor. It is invisible in the
          // main render and unmissable in the final frame.
          //
          // Sitting the crowd on NO_INK_LAYER drops it from the prepass, which
          // kills the artefact AND saves fifteen draw calls a frame (ten in the
          // prepass itself, five more in the shadow pass the prepass drags along
          // behind it — measured). The shadows
          // survive: three's shadow pass tests each object against the MAIN
          // camera's layers (WebGLShadowMap.renderObject), and the Stage enables
          // NO_INK_LAYER there — only the prepass camera disables it. So the
          // folk still lay long golden-hour shadows across the snow, which is
          // most of what says these little people are standing ON the park.
          noInk: true,
        }
      );

      let outline: THREE.InstancedMesh | null = null;
      if (ink) {
        const omat = instancedOutlineMaterial(1.5);
        disposables.push(omat);
        outline = new THREE.InstancedMesh(ink, omat, members.length);
        outline.layers.set(NO_INK_LAYER); // same reasoning as the body above
        // Share the body's buffer outright: one write per frame moves both, and
        // the ink can never drift a frame behind the figure it belongs to.
        outline.instanceMatrix = mesh.instanceMatrix;
        outline.count = members.length;
        outline.frustumCulled = false;
        outline.castShadow = false;
        outline.receiveShadow = false;
        outline.renderOrder = -1;
        outline.name = `folk-${type}-ink`;
      }

      batches.push({ type, mesh, outline, members });
    }

    /* ---- the few who carry a lantern ---- */
    const lanternSlot = new Int32Array(folk.length).fill(-1);
    let lanternCount = 0;
    folk.forEach((f, i) => { if (f.lantern) lanternSlot[i] = lanternCount++; });
    let lanterns: THREE.Points | null = null;
    if (lanternCount) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(lanternCount * 3), 3));
      const m = new THREE.PointsMaterial({
        size: 0.5, map: glowSprite(PALETTE.lanternCore), color: PALETTE.lanternCore,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        sizeAttenuation: true, toneMapped: false, fog: false, opacity: 0.4,
      });
      lanterns = new THREE.Points(g, m);
      lanterns.layers.set(NO_INK_LAYER); // a glow the Sobel would turn into a black square
      lanterns.frustumCulled = false;
      lanterns.renderOrder = 5;
      disposables.push(g, m);
    }

    return {
      batches, lanterns, lanternSlot, lanternCount,
      dispose: () => { for (const d of disposables) d.dispose(); },
    };
  }, [folk, quality]);

  useEffect(() => build.dispose, [build]);

  /* ---- per-frame: two dozen matrices, composed from closed-form poses ---- */
  const scratch = useRef({
    pose: { s: 0, moving: 1, dwellPhase: 0 } as FolkPose,
    rp: { x: 0, y: 0, z: 0, yaw: 0, slope: 0, ice: 0 } as RoutePoint,
    m: new THREE.Matrix4(),
    p: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    e: new THREE.Euler(),
    s: new THREE.Vector3(),
    lantern: new Float32Array(Math.max(1, build.lanternCount * 3)),
  });

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const sc = scratch.current;
    // A useRef initialiser runs ONCE, so this buffer is still sized for
    // whatever rung we first mounted at. Change quality and the cast changes
    // with it: too small and the extra lanterns never get written, so they
    // burn at the world origin, in the middle of the board.
    const want = Math.max(1, build.lanternCount * 3);
    if (sc.lantern.length !== want) sc.lantern = new Float32Array(want);
    const dusk = duskRef.current;

    for (const batch of build.batches) {
      const arr = batch.mesh.instanceMatrix.array as Float32Array;
      for (let k = 0; k < batch.members.length; k++) {
        const f = folk[batch.members[k]];
        const route = routes[f.route];
        folkPose(f, route, t, sc.pose);
        sampleRoute(route, sc.pose.s, f.lane, sc.rp);

        const g = GAITS[f.gait];
        const moving = sc.pose.moving;
        // Stride is driven by DISTANCE walked, not by time, so easing into a
        // stop slows the steps with you for free and a stopped folk's feet are
        // still. The one place it does NOT hold is the U-turn caps: this is
        // CENTRELINE distance, and a folk on the outer lane sweeps up to three
        // times as far through the turn as the centreline does. For those few
        // frames, twice a lap, the feet under-step. Fixing it means arc length
        // per lane, which is a whole extra bake.
        const phi = ((sc.pose.s * route.length) / g.stride) * Math.PI;
        const beat = Math.abs(Math.sin(phi));
        const idle = 1 - moving;

        // Out on the frozen river nobody strides. The bob flattens to a shuffle
        // and a slow slide creeps into the step — the gate walk crosses the ice,
        // so this is the first thing a child ever sees a folk do.
        const ice = sc.rp.ice;
        const careful = 1 - ice * 0.72;
        const slip = ice * Math.sin(t * 0.7 + f.seed * 1.7) * 0.13;

        const bob = beat * g.bob * moving * careful
          + Math.sin(t * 0.9 + f.seed) * g.float
          + Math.sin(t * 1.7 + f.seed) * 0.012 * idle; // still breathing while stopped
        const sway = Math.sin(phi) * g.sway * moving * careful + slip;

        // right = (cos yaw, -sin yaw); forward = (sin yaw, cos yaw)
        const cy = Math.cos(sc.rp.yaw), sy = Math.sin(sc.rp.yaw);
        sc.p.set(
          sc.rp.x + cy * sway,
          sc.rp.y + bob,
          sc.rp.z - sy * sway
        );

        // A folk that stops looks around; a folk that climbs leans into it.
        const look = Math.sin(sc.pose.dwellPhase * Math.PI * 2 + f.seed) * 0.6 * idle;
        const pitch = g.lean * moving * careful + beat * g.pitch * moving * careful + sc.rp.slope * 0.42;
        const roll = Math.sin(phi) * g.roll * moving * careful + slip * 0.5;
        sc.e.set(pitch, sc.rp.yaw + look, roll, "YXZ");
        sc.q.setFromEuler(sc.e);
        sc.s.setScalar(f.scale);
        sc.m.compose(sc.p, sc.q, sc.s);
        sc.m.toArray(arr, k * 16);

        const li = build.lanternSlot[batch.members[k]];
        if (li >= 0) {
          // Held out to the side at about chest height, in world space.
          sc.lantern[li * 3] = sc.p.x + cy * 0.30 * f.scale + sy * 0.10;
          sc.lantern[li * 3 + 1] = sc.p.y + 0.62 * f.scale;
          sc.lantern[li * 3 + 2] = sc.p.z - sy * 0.30 * f.scale + cy * 0.10;
        }
      }
      // Every instance moved, so one whole-buffer upload beats a partial range
      // per folk — and the ink shares this exact buffer.
      batch.mesh.instanceMatrix.needsUpdate = true;
      if (batch.outline) batch.outline.count = batch.mesh.count;
    }

    if (build.lanterns) {
      const attr = build.lanterns.geometry.getAttribute("position") as THREE.BufferAttribute;
      (attr.array as Float32Array).set(sc.lantern);
      attr.needsUpdate = true;
      const m = build.lanterns.material as THREE.PointsMaterial;
      // A lantern is pointless at golden hour and the whole point after it.
      m.opacity = 0.18 + dusk * 0.72 + Math.sin(t * 1.9) * 0.04;
      m.size = 0.42 + dusk * 0.22;
    }
  });

  return (
    <>
      <group name="piece-folk">
        {build.batches.map((b) => (
          <group key={b.type}>
            <primitive object={b.mesh} />
            {b.outline && <primitive object={b.outline} />}
          </group>
        ))}
      </group>
      {build.lanterns && <primitive object={build.lanterns} />}
    </>
  );
}

/* ================================================================== *
 * 2 · CROWS                                                           *
 * ================================================================== */

/**
 * One crow: a cut-paper silhouette, chunky enough to read at sixty metres.
 *
 * The wings are flat planes laid out in the horizontal, and the flap is a
 * vertex rotation about the body's forward axis driven by a per-instance phase
 * — so the whole flock is one draw call and no two birds beat together.
 */
function buildCrowGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const body = new THREE.SphereGeometry(0.13, 8, 6);
  body.scale(0.82, 0.76, 1.85);
  parts.push(body);

  const head = new THREE.SphereGeometry(0.085, 7, 5);
  head.scale(1, 0.96, 1.1);
  head.translate(0, 0.07, 0.21);
  parts.push(head);

  const beak = new THREE.ConeGeometry(0.036, 0.14, 4);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, 0.055, 0.31);
  parts.push(beak);

  // Tail: a flat fan, the counterweight that makes a crow a crow.
  const tail = new THREE.BoxGeometry(0.15, 0.02, 0.30);
  tail.translate(0, -0.01, -0.31);
  parts.push(tail);

  for (const side of [-1, 1]) {
    const g = new THREE.BufferGeometry();
    const rootF = 0.13, rootB = -0.15, tipF = 0.02, tipB = -0.17;
    const xi = side * 0.07, xo = side * 0.47;
    g.setAttribute("position", new THREE.Float32BufferAttribute([
      xi, 0.02, rootF, xo, 0.05, tipF, xo, 0.05, tipB, xi, 0.02, rootB,
    ], 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    g.setIndex(side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
    g.computeVertexNormals();
    parts.push(g);
  }

  const geo = mergeGeometries(parts);

  // How much of the flap each vertex takes: nothing on the body, everything at
  // the tips. Derived from x, so no vertex needs tagging by hand.
  const pos = geo.getAttribute("position");
  const wing = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    wing[i] = Math.sign(x) * THREE.MathUtils.smoothstep(Math.abs(x), 0.085, 0.34);
  }
  geo.setAttribute("aWing", new THREE.BufferAttribute(wing, 1));
  geo.computeBoundingSphere();
  return geo;
}

function crowMaterial(): THREE.MeshBasicMaterial {
  // Near-black, but never black: warm ink pushed toward the pine wall it lives
  // in, so a crow sits in the same palette as the trees it launches from.
  const mat = createFlatMaterial(mix(PALETTE.ink, PALETTE.forest, 0.42), { side: THREE.DoubleSide });
  patchMaterialForBandedFog(mat);
  const prev = mat.onBeforeCompile?.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         attribute float aWing;
         attribute vec3 aWingDrive; // x: phase (radians), y: flap amplitude, z: fold`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         {
           float w = abs(aWing);
           // TUCK. A sitting crow folds its wings along its back; leaving them
           // spread turns every perched bird into a weathervane.
           float fold = aWingDrive.z * w;
           transformed.x = mix(transformed.x, sign(aWing) * 0.10, fold);
           transformed.z -= fold * 0.09;
           transformed.y -= fold * 0.02;
           // Rotate each wing about the body's forward axis. sign(aWing) sends
           // both wings UP together instead of rolling the whole bird over.
           float ang = sin(aWingDrive.x) * aWingDrive.y * 1.15 * w * sign(aWing);
           float c = cos(ang), s = sin(ang);
           transformed.xy = mat2(c, s, -s, c) * transformed.xy;
         }`
      );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}|crow-flap`;
  return mat;
}

function Crows({ quality }: { quality: LifeQuality }) {
  const crows = useMemo(() => buildCrows(quality), [quality]);

  const build = useMemo(() => {
    const geo = buildCrowGeometry();
    const mat = crowMaterial();
    const mesh = buildInstanced(
      geo, mat,
      crows.map((c) => ({ position: c.perch, scale: c.scale })),
      {
        name: "crows",
        // Silhouettes want no interior ink at all — and a vertex-animated wing
        // would smear the normal+depth prepass across the sky behind it.
        noInk: true,
        castShadow: false, receiveShadow: false,
      }
    );
    const drive = new THREE.InstancedBufferAttribute(new Float32Array(crows.length * 3), 3);
    drive.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aWingDrive", drive);
    return {
      mesh, drive,
      dispose: () => { geo.dispose(); mat.dispose(); },
    };
  }, [crows]);

  useEffect(() => build.dispose, [build]);

  const scratch = useRef({
    pose: { x: 0, y: 0, z: 0, yaw: 0, roll: 0, pitch: 0, flap: 0, fold: 1, perched: true } as CrowPose,
    m: new THREE.Matrix4(),
    p: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    e: new THREE.Euler(),
    s: new THREE.Vector3(),
    phase: new Float32Array(crows.length),
  });

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const sc = scratch.current;
    // Same trap as the folk's lantern buffer: the ref initialiser ran once, at
    // whatever rung we mounted at. Read past the end of a Float32Array and you
    // get undefined, `undefined + x` is NaN, and a NaN wing phase collapses the
    // bird's triangles — the extra crows would simply not be there.
    if (sc.phase.length !== crows.length) sc.phase = new Float32Array(crows.length);
    const arr = build.mesh.instanceMatrix.array as Float32Array;
    const drive = build.drive.array as Float32Array;
    // A long stall must not spin the wings a hundred times in one frame.
    const step = Math.min(dt, 0.05);

    for (let i = 0; i < crows.length; i++) {
      const c = crows[i];
      crowPose(c, t, sc.pose);

      sc.p.set(sc.pose.x, sc.pose.y, sc.pose.z);
      sc.e.set(sc.pose.pitch, sc.pose.yaw, sc.pose.roll, "YXZ");
      sc.q.setFromEuler(sc.e);
      sc.s.setScalar(c.scale);
      sc.m.compose(sc.p, sc.q, sc.s);
      sc.m.toArray(arr, i * 16);

      // Integrate the wingbeat instead of sampling sin(t * rate): the rate
      // changes with effort, and sampling it would jump the phase every time.
      //
      // THE ONE THING IN THIS SLICE THAT IS NOT A PURE FUNCTION OF TIME.
      // `parkLifeData` promises a harness it can pose the whole park at a
      // chosen instant; this cannot deliver that, because where a wing is
      // depends on how many frames got us here. Position, heading and fold all
      // still come from `crowPose(c, t)`, so a capture only ever differs in
      // where in its beat a wing happens to be — never in where a bird is.
      sc.phase[i] += step * (5 + 26 * sc.pose.flap);
      drive[i * 3] = sc.phase[i];
      drive[i * 3 + 1] = sc.pose.flap;
      drive[i * 3 + 2] = sc.pose.fold;
    }
    build.mesh.instanceMatrix.needsUpdate = true;
    build.drive.needsUpdate = true;
  });

  return <primitive object={build.mesh} />;
}

/* ================================================================== *
 * 3 · SNOW-GLITTER OVER THE ICE                                       *
 * ================================================================== */

const GLITTER_VERT = /* glsl */ `
attribute float aSeed;
attribute float aScale;
attribute float aCold;
uniform float uTime;
uniform float uPixelScale;
varying float vTw;
varying float vCold;
varying float vFade;

void main() {
  float ph = aSeed * 6.28318;

  // A BOUNDED wander — two slow sines an axis, never a stream that has to wrap.
  // Airborne glitter hangs and turns over; it does not fly past you, and a
  // recycling particle field pops exactly where the eye is already looking.
  vec3 p = position;
  p.x += sin(uTime * 0.13 + ph) * 1.5 + sin(uTime * 0.41 + ph * 2.7) * 0.34;
  p.z += cos(uTime * 0.11 + ph * 1.3) * 1.5 + cos(uTime * 0.37 + ph * 3.1) * 0.31;
  p.y += sin(uTime * 0.23 + ph * 1.9) * 0.40;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = -mv.z;

  // THE SPARK. A mote catches the low sun for an instant and is dark the rest
  // of the time — that hard power curve is the whole difference between
  // glitter and fog.
  float tw = sin(uTime * (1.35 + fract(aSeed * 7.3) * 1.9) + ph * 5.0) * 0.5 + 0.5;
  vTw = pow(tw, 5.5);
  vCold = aCold;

  // Nothing sparkles in the lens, and nothing sparkles out in the haze.
  vFade = smoothstep(3.0, 10.0, d) * (1.0 - smoothstep(70.0, 155.0, d));

  // uPixelScale carries the projection's vertical scale, so these numbers are
  // METRES: a mote is six millimetres across at rest and flares to four
  // centimetres. Size it in pixels instead and it vanishes on a small window
  // and turns into confetti on a retina one.
  gl_PointSize = clamp((0.008 + vTw * 0.034) * aScale * uPixelScale / max(d, 0.001), 0.7, 8.0);
  gl_Position = projectionMatrix * mv;
}
`;

const GLITTER_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uCool;
uniform vec3 uWarm;
uniform float uOpacity;
uniform float uDusk;
varying float vTw;
varying float vCold;
varying float vFade;

void main() {
  float a = texture2D(uMap, gl_PointCoord).a;
  vec3 col = mix(uCool, uWarm, vTw);
  // Denser and brighter over the ice; a thin scatter everywhere else.
  float alpha = a * vFade * (0.12 + vTw * 0.85) * uOpacity * (0.24 + vCold * 0.76);
  // When the sun goes, the sparks go with it. The cold stays.
  alpha *= 1.0 - uDusk * 0.45;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

function SnowGlitter({ quality, duskRef }: { quality: LifeQuality; duskRef: React.RefObject<number> }) {
  const build = useMemo(() => {
    const field = buildGlitterField(particleCount(GLITTER_BASE, QUALITY_LADDER[quality]));

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(field.position.subarray(0, field.count * 3), 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(field.seed.subarray(0, field.count), 1));
    geo.setAttribute("aScale", new THREE.BufferAttribute(field.scale.subarray(0, field.count), 1));
    geo.setAttribute("aCold", new THREE.BufferAttribute(field.cold.subarray(0, field.count), 1));
    // The field covers the whole valley, so whole-object culling could only ever
    // cull it by mistake — `frustumCulled = false` below is what turns the test
    // off. This sphere is for anything that asks the geometry its own extent
    // (raycasts, bounds queries) and would otherwise walk 1280 motes to answer.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 200);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelScale: { value: 540 },
        uMap: { value: glitterSprite() },
        uCool: { value: new THREE.Color(mix(PALETTE.icePale, PALETTE.creamPale, 0.35)) },
        uWarm: { value: new THREE.Color(PALETTE.lanternCore) },
        uOpacity: { value: 0.85 },
        uDusk: { value: 0 },
      },
      vertexShader: GLITTER_VERT,
      fragmentShader: GLITTER_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geo, mat);
    points.name = "snow-glitter";
    points.layers.set(NO_INK_LAYER); // inked motes come back as black squares
    points.renderOrder = 4;
    points.frustumCulled = false;
    return { points, mat, dispose: () => { geo.dispose(); mat.dispose(); } };
  }, [quality]);

  useEffect(() => build.dispose, [build]);

  const size = useRef(new THREE.Vector2());
  useFrame((state) => {
    const u = build.mat.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uDusk.value = duskRef.current ?? 0;
    u.uPixelScale.value = pixelScale(state.gl, state.camera, size.current);
  });

  return <primitive object={build.points} />;
}

/* ================================================================== *
 * 4 · BREATH FOG                                                      *
 * ================================================================== */

const BREATH_VERT = /* glsl */ `
attribute vec3 aDir;
attribute float aSeed;
attribute float aPuff;
uniform float uTime;
uniform float uPeriod;
uniform float uPuffs;
uniform float uLife;
uniform float uPixelScale;
uniform float uScale;
varying float vA;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

void main() {
  float span = uPuffs * uPeriod;
  float since = uTime - aPuff * uPeriod;
  float age = mod(since, span);
  // Which breath this is, so no two puffs come out the same size.
  float vary = 0.72 + hash11(floor(since / span) * 1.7 + aPuff * 13.3) * 0.6;

  // Each mote is born a beat after the last, so a puff BLOOMS out of a mouth
  // rather than appearing as a finished ball of fog.
  float life = clamp((age - aSeed * 0.20) / (uLife * vary), 0.0, 1.0);
  // Fast out, then quickly out of push: warm air meeting cold air.
  float grow = 1.0 - exp(-life * 3.1);

  vec3 p = position
    + aDir * (grow * 0.15 * vary)
    + vec3(0.0, 0.0, 1.0) * grow * 0.22
    + vec3(0.0, 1.0, 0.0) * (grow * 0.14 + life * life * 0.15)
    + vec3(sin(aSeed * 9.1 + life * 4.0), 0.0, cos(aSeed * 7.3 + life * 3.4)) * grow * 0.04;
  p *= uScale;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);

  // In fast, hang, thin away. A hard pop-out reads as a bug, not as breath.
  vA = smoothstep(0.0, 0.10, life) * (1.0 - smoothstep(0.30, 1.0, life));
  vA *= 1.0 - smoothstep(24.0, 58.0, -mv.z);
  if (age > uLife * vary) vA = 0.0;

  // Metres, like the glitter: a mote opens from three to twelve centimetres.
  gl_PointSize = clamp((0.016 + grow * 0.062) * uScale * uPixelScale / max(0.001, -mv.z), 0.8, 30.0);
  gl_Position = projectionMatrix * mv;
}
`;

const BREATH_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;

void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vA * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

/**
 * FOUR PUFFS IN FLIGHT, and the number is not free choice.
 *
 * Puff j is emitted every `BREATH_PUFFS * uPeriod` seconds, so a puff has that
 * long to finish before it is re-emitted from the start. The longest a mote
 * lives is aSeed*0.20 + uLife*varyMax = 0.20 + 2.2*1.32 = 3.10s, so the ceiling
 * on breath rate is 60 * BREATH_PUFFS / 3.10 per minute. At three puffs that is
 * 58/min and the clamp below would happily accept 90, cutting the biggest puffs
 * off mid-fade; at four it is 77, and with the alpha already down to a tenth by
 * life 0.85 the last of the range is invisible rather than wrong.
 */
const BREATH_PUFFS = 4;
const BREATH_MOTES = 20;

export interface BreathFogProps {
  /** World position of the mouth. */
  position: [number, number, number];
  /** Breaths per minute. A calm adult is ~12; a child who has been running, ~26. */
  rate?: number;
  /** Which way the breath goes, radians of yaw. Defaults to facing +Z. */
  facing?: number;
  /** Puff size multiplier. */
  scale?: number;
}

/**
 * VISIBLE BREATH — a self-driving emitter you can hang anywhere.
 *
 * ChessPaa and the grandchildren already breathe from their own rigs, one puff
 * driven by hand off an exhale. This is the other half: a placeable emitter for
 * everything that has no rig — the folk waiting by the gate, a snow-lump with a
 * scarf on it, the spot where a child stands to play.
 *
 * The whole cycle lives in the vertex shader off a single clock, so a dozen of
 * these cost a dozen tiny draw calls and no CPU at all — eighty points each,
 * one call, nothing per frame but four uniforms. Four staggered puffs overlap,
 * which carries the whole 2..90 breaths-a-minute range the clamp accepts (see
 * BREATH_PUFFS).
 *
 * NOT YET TESTED ON A MOVING PARENT. Every puff is emitted in the emitter's
 * local space and carried by it, so a folk who walks away drags its own breath
 * along instead of leaving it behind in the air. On a walking parent that will
 * read as wrong; hang it on things that stand still until someone fixes it.
 */
export function BreathFog({ position, rate = 12, facing = 0, scale = 1 }: BreathFogProps) {
  const build = useMemo(() => {
    const N = BREATH_PUFFS * BREATH_MOTES;
    const pos = new Float32Array(N * 3);
    const dir = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const puff = new Float32Array(N);
    const r = rng(20261);   // the park's own deterministic stream, never Math.random

    for (let i = 0; i < N; i++) {
      // A forward-leaning half-shell: a mouth is not a sphere.
      const th = r() * Math.PI * 2;
      const ph = Math.acos(1 - r() * 1.3);
      const dx = Math.sin(ph) * Math.cos(th) * 0.9;
      const dy = Math.sin(ph) * Math.sin(th) * 0.6;
      const dz = Math.cos(ph) * 0.5 + 0.35;
      const len = Math.hypot(dx, dy, dz) || 1;
      dir[i * 3] = dx / len; dir[i * 3 + 1] = dy / len; dir[i * 3 + 2] = dz / len;
      pos[i * 3] = (dx / len) * 0.012;
      pos[i * 3 + 1] = (dy / len) * 0.012;
      pos[i * 3 + 2] = (dz / len) * 0.012;
      seed[i] = r();
      puff[i] = Math.floor(i / BREATH_MOTES);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aDir", new THREE.BufferAttribute(dir, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    geo.setAttribute("aPuff", new THREE.BufferAttribute(puff, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPeriod: { value: 5 },
        uPuffs: { value: BREATH_PUFFS },
        uLife: { value: 2.2 },
        uPixelScale: { value: 540 },
        uScale: { value: scale },
        uMap: { value: glowSprite(0xffffff) },
        // Cool against a warm dusk — that contrast IS the cold.
        uColor: { value: new THREE.Color(mix(PALETTE.creamPale, PALETTE.icePale, 0.62)) },
        uOpacity: { value: 0.52 },
      },
      vertexShader: BREATH_VERT,
      fragmentShader: BREATH_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const points = new THREE.Points(geo, mat);
    points.name = "breath-fog";
    // MUST be no-ink: the Sobel finds edges in sprite alpha and stamps a black
    // square on every mote. This is a bug we have already shipped once.
    points.layers.set(NO_INK_LAYER);
    // The shader expands the puff well past the geometry's own bounds.
    points.frustumCulled = false;
    points.renderOrder = 6;
    return { points, mat, dispose: () => { geo.dispose(); mat.dispose(); } };
    // No deps: `scale` only seeds the uniform, which the frame loop drives
    // anyway, and rebuilding sixty motes because a puff grew would dispose the
    // emitter mid-breath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => build.dispose, [build]);

  const size = useRef(new THREE.Vector2());
  useFrame((state) => {
    const u = build.mat.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uPeriod.value = 60 / Math.min(90, Math.max(2, rate));
    u.uScale.value = scale;
    u.uPixelScale.value = pixelScale(state.gl, state.camera, size.current);
  });

  return <primitive object={build.points} position={position} rotation-y={facing} />;
}

/* ================================================================== *
 * 5 · THE SLOW DUSK DRIFT                                             *
 * ================================================================== */

/**
 * A 0..1 dusk value that creeps forward across a session.
 *
 * Exposed, never applied: the sky, the lanterns, the fairy-lights and the grade
 * all want to read the same number, and the one place that owns them is the
 * Stage. Hand this to it.
 *
 *   const dusk = useDuskDrift();      // ~14 minutes to full evening
 *   <Park dusk={dusk} />
 *
 * Two deliberate properties:
 *
 *   IT IS QUANTISED. The value only changes in 1/128ths, so a caller that puts
 *   it in React state re-renders about ten times a minute instead of sixty
 *   times a second for a change nobody could see.
 *
 *   IT RUNS ON requestAnimationFrame, so it stops while the tab is hidden. A
 *   child who wanders off for lunch comes back to the same evening they left,
 *   not to midnight.
 */
export function useDuskDrift(minutesToFull: number = DUSK_MINUTES): number {
  const [dusk, setDusk] = useState(0);

  useEffect(() => {
    let raf = 0;
    let live = true;
    let last = -1;
    const t0 = performance.now();

    const tick = () => {
      if (!live) return;
      const v = duskAt((performance.now() - t0) / 1000, minutesToFull);
      const q = Math.round(v * 128) / 128;
      if (q !== last) { last = q; setDusk(q); }
      // Full dusk is the end of the drift; stop asking.
      if (q < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => { live = false; cancelAnimationFrame(raf); };
  }, [minutesToFull]);

  return dusk;
}

/* ================================================================== *
 * THE WHOLE OF PARK LIFE                                              *
 * ================================================================== */

export default function ParkLife({ dusk = 0, quality = "high" }: ParkLifeProps) {
  // Read through a ref so a dusk change never re-mounts a crowd — building the
  // folk means cloning geometry and compiling shaders, which is a visible hitch.
  //
  // Written in an effect, not in the render body: React may render a component
  // and throw the result away, and a ref written during that render is a side
  // effect that escapes. The cost is that a new dusk lands one frame late, and
  // dusk moves in 1/128ths about ten times a minute.
  const duskRef = useRef(dusk);
  useEffect(() => { duskRef.current = dusk; }, [dusk]);

  return (
    <group name="park-life">
      <PieceFolk quality={quality} duskRef={duskRef} />
      <Crows quality={quality} />
      <SnowGlitter quality={quality} duskRef={duskRef} />
    </group>
  );
}
