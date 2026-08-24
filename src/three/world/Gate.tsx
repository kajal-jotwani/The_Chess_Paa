"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { PALETTE, mix } from "../core/palette";
import { createToonMaterial, type ToonMaterial } from "../core/materials/ToonMaterial";
import { createOutlineMaterial, smoothNormalsForOutline } from "../core/materials/OutlineMaterial";
import { patchMaterialForBandedFog } from "../core/materials/SkyMaterial";
import { woodTexture, snowTexture, stripeTexture } from "../core/textures/procedural";
import { NO_INK_LAYER } from "../core/postfx/effects";

import {
  buildGate, signFaceTexture, mapBoardTexture, ticketBoardTexture, paletteChipTexture,
  GATE_ANCHOR, GATE_YAW, GATE_BASE_Y,
  type GateMat, type GateGlow, type GateBuild,
} from "./gateGeometry";

/**
 * THE PAINTED GATES — the arrival.
 *
 * "A child steps through the painted gates of ChessPaa's Wonderland into
 * light the colour of warm honey… strung between the lantern-poles are fairy
 * lights that haven't quite decided to glow."
 *
 * Everything structural is baked in `gateGeometry.ts` and merged down to one
 * mesh per material. What lives here is the part that has to breathe: the
 * hesitant fairy-lights, the balloons tugging on their strings, and the warm
 * pool on the snow that pulls the eye through the opening and into the park.
 */

/* ================================================================== */
/* MATERIALS                                                           */
/* ================================================================== */

/**
 * Ink weights for the inverted hulls. Keys absent from this map wear no hull
 * — the screen-space Sobel still finds their creases, and a second draw call
 * per material is a real cost. Bright surfaces (honey, glass, the painted
 * faces) separate themselves and look tarred if you outline them.
 */
const OUTLINE: Partial<Record<GateMat, number>> = {
  timber: 2.0,
  timberPale: 1.7,
  cream: 1.9,
  iron: 1.4,
  chip: 1.5,
};

type MatBank = Record<GateMat, THREE.Material>;

function buildMaterials(): MatBank {
  const mk = (o: Parameters<typeof createToonMaterial>[0]): ToonMaterial => {
    const m = createToonMaterial(o);
    // every lit surface must stack into the same banded haze as the valley
    patchMaterialForBandedFog(m);
    return m;
  };

  const chip = paletteChipTexture();

  /**
   * WHY THE TIMBER IS NOT `PALETTE.walnut`.
   *
   * `MeshToonMaterial` multiplies THREE things together: the material colour,
   * the map, and the ramp. `woodTexture(walnut)` is ALREADY walnut, so setting
   * the colour to walnut as well squares a 15%-luminance brown and then the
   * ramp's mid band takes another 40% off it. The result is near-black — you
   * can see it on every post in the first park captures.
   *
   * So the map carries the hue, the colour stays white, and the tint the map
   * is painted with is lifted toward cream until the wood reads the way toy
   * wood reads at golden hour. Warm, not muddy. This is the gate: it is the
   * first thing a child sees, and it must GLOW.
   */
  const OAK = mix(PALETTE.walnutLight, PALETTE.cream, 0.42);
  const PLANED = mix(PALETTE.walnutLight, PALETTE.creamPale, 0.62);

  return {
    timber: mk({
      color: 0xffffff, ramp: "wood", map: woodTexture(OAK, 7),
      rim: 0.52, rimPower: 2.8, bounce: 0.38,
    }),
    timberPale: mk({
      color: 0xffffff, ramp: "wood", map: woodTexture(PLANED, 3),
      rim: 0.56, rimPower: 2.6, bounce: 0.40,
    }),
    // Ironwork is the one place a near-black IS right — but it still takes a
    // hard warm rim, or the brackets vanish into the posts behind them.
    iron: mk({
      color: mix(PALETTE.cocoa, PALETTE.walnutLight, 0.45), ramp: "soft",
      rim: 0.68, rimPower: 3.0, bounce: 0.34,
    }),
    honey: mk({ color: PALETTE.honey, ramp: "hero", rim: 0.62, rimPower: 2.6, bounce: 0.18 }),

    // THE FINIALS. A knight and a rook are the first shapes a child looks up
    // at here, so they get hero treatment: the hardest rim in the gate, which
    // is the only thing that keeps pale carved wood off a pale dusk sky.
    cream: mk({
      color: mix(PALETTE.creamPale, PALETTE.honey, 0.20), ramp: "hero",
      rim: 0.72, rimPower: 2.6, rimColor: PALETTE.honey, bounce: 0.26,
    }),

    // white, not PALETTE.snow — the snow map is already snow-coloured
    snow: mk({
      color: 0xffffff, ramp: "snow", map: snowTexture(11),
      rim: 0.46, rimPower: 3.4, bounce: 0.36,
    }),

    // The painted faces carry their own art, so they take almost no rim (a
    // fresnel across a sign washes the lettering out) and a little emissive
    // lift so they still read once the sun is gone.
    // Emissive is a LIFT, not a wash: past ~0.12 the honey eats the plum and
    // the whole board turns to gingerbread.
    signFace: mk({
      color: 0xffffff, ramp: "soft", map: signFaceTexture(), side: THREE.DoubleSide,
      rim: 0.12, rimPower: 4.2, bounce: 0.20,
      emissive: PALETTE.lanternCore, emissiveIntensity: 0.055,
    }),
    mapFace: mk({
      color: 0xffffff, ramp: "soft", map: mapBoardTexture(),
      rim: 0.10, rimPower: 4.2, bounce: 0.22,
      emissive: PALETTE.honey, emissiveIntensity: 0.14,
    }),
    ticketFace: mk({
      color: 0xffffff, ramp: "soft", map: ticketBoardTexture(),
      rim: 0.12, rimPower: 4.0, bounce: 0.22,
      emissive: PALETTE.honey, emissiveIntensity: 0.16,
    }),

    awning: mk({
      color: 0xf0e6d6, ramp: "soft", side: THREE.DoubleSide,
      map: stripeTexture(PALETTE.honeyDeep, PALETTE.creamPale, 20),
      rim: 0.15, rimPower: 4.2, rimColor: PALETTE.lanternCore, bounce: 0.26,
      emissive: PALETTE.honey, emissiveIntensity: 0.05,
    }),

    // Balloons and bunting share one painted chip strip — six dyes, one call.
    chip: mk({
      color: 0xffffff, ramp: "soft", map: chip, side: THREE.DoubleSide,
      rim: 0.5, rimPower: 2.4, rimColor: PALETTE.lanternCore, bounce: 0.22,
      emissive: PALETTE.honey, emissiveIntensity: 0.06,
    }),
    cord: mk({ color: PALETTE.cocoa, ramp: "wood", rim: 0.22, bounce: 0.3 }),

    glass: new THREE.MeshBasicMaterial({
      color: PALETTE.lanternCore, fog: true, toneMapped: false,
    }),
  };
}

/* ================================================================== */
/* THE GLOW POINTS — every bulb at the gate in one additive draw call  */
/* ================================================================== */

function makeGlowGeometry(glows: GateGlow[]): THREE.BufferGeometry {
  const n = glows.length;
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const col = new Float32Array(n * 3);
  const phase = new Float32Array(n);
  const hes = new Float32Array(n);
  const c = new THREE.Color();
  glows.forEach((g, i) => {
    pos[i * 3] = g.pos[0]; pos[i * 3 + 1] = g.pos[1]; pos[i * 3 + 2] = g.pos[2];
    size[i] = g.size;
    c.set(g.color);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    phase[i] = g.phase;
    hes[i] = g.hesitate;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  geo.setAttribute("aHesitate", new THREE.BufferAttribute(hes, 1));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * LIGHTS THAT HAVEN'T QUITE DECIDED TO GLOW.
 *
 * A steady lantern gets a two-rate twinkle so a row never pulses in lockstep.
 * A fairy-light gets something better: `aHesitate` blends in a SLOW swell —
 * eight seconds from dim to bright and back — with a nervous flicker riding
 * on top and a floor low enough that some bulbs are genuinely almost out at
 * any moment. That is the difference between "fairy lights" and a string of
 * LEDs, and it is the first thing a child notices at the gate.
 */
function createGlowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      /** Rises with dusk and with the arrival's gateFade. */
      uBoost: { value: 1 },
      /** metres → pixels; see `pixelScale`. 1158 ≈ 1080p at fov 50. */
      uPixelScale: { value: 1158 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute vec3  aColor;
      attribute float aPhase;
      attribute float aHesitate;
      uniform float uTime;
      uniform float uPixelScale;
      varying vec3 vColor;
      varying float vLevel;

      void main() {
        vColor = aColor;

        // a steady lamp: two incommensurate beats, barely moving
        float steady = 0.86 + 0.10 * sin(uTime * 1.6 + aPhase * 6.283)
                            + 0.05 * sin(uTime * 0.57 + aPhase * 2.7);

        // an undecided bulb: a long swell, a nervous flicker, a low floor
        float swell  = sin(uTime * 0.78 + aPhase * 6.283);
        float nerves = sin(uTime * 9.1 + aPhase * 17.0) * 0.5
                     + sin(uTime * 5.3 - aPhase * 11.0) * 0.5;
        float unsure = 0.16 + 0.84 * smoothstep(-0.55, 0.75, swell) * (0.80 + 0.20 * nerves);

        vLevel = mix(steady, unsure, aHesitate);

        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // The size breathes with the brightness — a dim bulb is also smaller.
        //
        // uPixelScale carries the drawing buffer AND the projection, so 0.173
        // is a real MEASUREMENT: aSize 1.0 is a bulb about seventeen centimetres
        // across, and it stays seventeen centimetres whatever the pixel ratio or
        // the rig's field of view. A bare pixel constant here (what this was)
        // halves every bulb the moment the Stage goes to dpr 2 — which is the
        // retina target and the harness default — and swells them again the
        // moment a rig pulls to a wider fov.
        gl_PointSize = clamp(
          aSize * 0.173 * (0.55 + 0.45 * vLevel) * uPixelScale / max(-mv.z, 0.001),
          0.8, 90.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uBoost;
      varying vec3 vColor;
      varying float vLevel;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d) * 2.0;
        if (r > 1.0) discard;
        // hot core, wide soft halo — a lantern seen through cold air
        float core = pow(max(0.0, 1.0 - r), 3.0);
        float halo = pow(max(0.0, 1.0 - r), 1.35) * 0.45;
        gl_FragColor = vec4(vColor * (core + halo) * vLevel * uBoost, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
}

/**
 * The factor that turns a size in METRES into a `gl_PointSize` in pixels:
 *   pixels = metres * pixelScale / viewDistance
 *
 * Same helper the crowd motes and ChessPaa's sparks use. The buffer height
 * moves under us whenever the Stage's adaptive pixel-ratio governor spends or
 * refunds quality, and the projection term is what stops the bulbs changing
 * size when a rig picks a different field of view.
 */
function pixelScale(gl: THREE.WebGLRenderer, camera: THREE.Camera, out: THREE.Vector2): number {
  gl.getDrawingBufferSize(out);
  const cam = camera as THREE.PerspectiveCamera;
  const fov = cam.isPerspectiveCamera ? cam.fov : 50;
  return (out.y * 0.5) / Math.tan((fov * Math.PI) / 360);
}

/* ================================================================== */
/* THE POOL OF WARM LIGHT ON THE SNOW                                  */
/* ================================================================== */

/**
 * The single most important shot in the park is the one where a child looks
 * through the arch and WANTS to walk in. This is what does that work: a warm
 * pool laid over the real snow, brightest under the opening and reaching
 * further in than out, so the composition leans the eye through the gate.
 *
 * It is BANDED, not smoothly feathered — a soft radial gradient would be the
 * only un-quantised thing in a park built entirely from hard steps, and it
 * would read instantly as a CG glow rather than as painted light. Three steps
 * with a hand-wobbled edge read as paint.
 *
 * Lives on NO_INK_LAYER: an inked glow is a black square, which is a bug this
 * project has already paid for once.
 */
function createPoolMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWarm: { value: new THREE.Color(PALETTE.honey) },
      uCore: { value: new THREE.Color(PALETTE.lanternCore) },
      uStrength: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;                       // u = normalised radius, v = angle
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uStrength;
      uniform vec3 uWarm, uCore;
      varying vec2 vUv;

      void main() {
        float a = vUv.y * 6.2831853;
        // the edge of the pool is scuffed, the way lamplight on snow always is
        float edge = 1.0 - 0.075 * sin(a * 7.0 + 0.6) - 0.045 * sin(a * 13.0 - 1.1);
        float r = clamp(vUv.x / edge, 0.0, 1.0);

        // A long, gentle falloff. The first pass used 1-r and read as a puddle
        // of yellow paint; light on snow is nearly all penumbra.
        float f = pow(1.0 - r, 2.1);
        // the lantern breathes, so the pool does too — very slightly
        f *= 0.94 + 0.06 * sin(uTime * 0.9);

        // QUANTISE. Four warm steps, matching the toon ramp everything else in
        // the valley is shaded with — but only in the BRIGHT part. Banding the
        // faint tail as well drops a hard contour ring on the snow and the
        // whole thing stops reading as light and starts reading as a spill.
        float band = floor(f * 4.0 + 0.35) / 4.0;
        float q = mix(f, band, 0.6 * smoothstep(0.04, 0.34, f));

        vec3 col = mix(uWarm, uCore, smoothstep(0.35, 0.95, f));
        gl_FragColor = vec4(col * q * uStrength, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    fog: false,
    toneMapped: false,
  });
}

/* ================================================================== */
/* THE COMPONENT                                                       */
/* ================================================================== */

export interface GateProps {
  /**
   * 0 = golden hour, 1 = deep dusk. Drives how hard the lanterns burn, how
   * much the painted faces lift, and how wide the pool of light reaches.
   * Rebuilds no geometry, so it is safe to animate every frame.
   */
  dusk?: number;
}

/** One mesh per material, with a smoothed ink hull where the policy asks. */
function meshFor(geo: THREE.BufferGeometry, mat: THREE.Material, ink: number | undefined): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (ink) {
    // The hull is pushed along SMOOTHED normals, which a merged bag of boxes
    // and lathes does not have — without this the ink splits at every corner.
    const hull = new THREE.Mesh(smoothNormalsForOutline(geo), createOutlineMaterial({
      thickness: ink, fadeStart: 70, fadeEnd: 190,
    }));
    hull.name = "__outline";
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.renderOrder = -1;
    mesh.add(hull);
  }
  return mesh;
}

export default function Gate({ dusk = 0 }: GateProps = {}) {
  const world: GateBuild = useMemo(() => buildGate(), []);
  const mats = useMemo(() => buildMaterials(), []);

  const meshes = useMemo(() => {
    const out: THREE.Mesh[] = [];
    (Object.keys(world.parts) as GateMat[]).forEach((key) => {
      const geo = world.parts[key];
      if (!geo) return;
      const m = meshFor(geo, mats[key], OUTLINE[key]);
      if (key === "glass") {
        // emissive panes never take interior ink, or they turn to soot
        m.layers.set(NO_INK_LAYER);
        m.castShadow = false;
        m.receiveShadow = false;
      }
      if (key === "signFace" || key === "mapFace" || key === "ticketFace") {
        m.castShadow = false;
      }
      out.push(m);
    });
    return out;
  }, [world, mats]);

  const glowPoints = useMemo(() => {
    const pts = new THREE.Points(makeGlowGeometry(world.glows), createGlowMaterial());
    pts.layers.set(NO_INK_LAYER);   // never inked
    pts.frustumCulled = false;
    pts.renderOrder = 4;
    return pts;
  }, [world]);

  const pool = useMemo(() => {
    const m = new THREE.Mesh(world.pool, createPoolMaterial());
    m.layers.set(NO_INK_LAYER);     // never inked
    m.renderOrder = 3;
    m.castShadow = false;
    m.receiveShadow = false;
    return m;
  }, [world]);

  const balloonMeshes = useMemo(
    () => world.balloons.map((b) => ({
      tie: b.tie,
      sway: b.sway,
      phase: b.phase,
      skins: meshFor(b.skins, mats.chip, OUTLINE.chip),
      strings: meshFor(b.strings, mats.cord, undefined),
    })),
    [world, mats]
  );

  const bunchRefs = useRef<Array<THREE.Group | null>>([]);
  const bufSize = useRef(new THREE.Vector2(1920, 1080));

  useFrame((s) => {
    const t = s.clock.elapsedTime;

    const gm = glowPoints.material as THREE.ShaderMaterial;
    gm.uniforms.uTime.value = t;
    gm.uniforms.uBoost.value = 0.80 + dusk * 0.55;
    gm.uniforms.uPixelScale.value = pixelScale(s.gl, s.camera, bufSize.current);

    const pm = pool.material as THREE.ShaderMaterial;
    pm.uniforms.uTime.value = t;
    pm.uniforms.uStrength.value = 0.62 + dusk * 0.7;

    // BALLOONS TUG. Two rates that never line up, so the bunch nods and
    // circles instead of ticking like a metronome — helium on a string is
    // never doing just one thing.
    for (let i = 0; i < bunchRefs.current.length; i++) {
      const g = bunchRefs.current[i];
      if (!g) continue;
      const b = balloonMeshes[i];
      g.rotation.z = Math.sin(t * 0.62 + b.phase) * b.sway
        + Math.sin(t * 1.43 + b.phase * 2.1) * b.sway * 0.35;
      g.rotation.x = Math.cos(t * 0.49 + b.phase * 1.7) * b.sway * 0.85;
      g.rotation.y = t * 0.06 + b.phase;
    }
  });

  return (
    <group
      name="gate"
      position={[GATE_ANCHOR.x, GATE_BASE_Y, GATE_ANCHOR.z]}
      rotation={[0, GATE_YAW, 0]}
    >
      {meshes.map((m, i) => <primitive key={`gate-${i}`} object={m} />)}

      <primitive object={pool} />
      <primitive object={glowPoints} />

      {balloonMeshes.map((b, i) => (
        <group
          key={`bunch-${i}`}
          position={b.tie}
          ref={(el: THREE.Group | null) => { bunchRefs.current[i] = el; }}
        >
          <primitive object={b.skins} />
          <primitive object={b.strings} />
        </group>
      ))}

      {/*
        TWO real lights, and only two. Forward rendering pays for every light
        on every lit fragment, and the park already runs a lantern per pole —
        so the gate spends its budget where a child actually looks: the warm
        wash under the arch that catches ChessPaa and the waiting car, and a
        small one at the kiosk so the ticket window reads as OPEN.
      */}
      <pointLight
        position={[0, 3.4, 1.4]}
        color={PALETTE.lanternCore}
        intensity={13 * (0.62 + dusk * 0.6)}
        distance={26}
        decay={2}
      />
      <pointLight
        position={[-8.6, 2.5, 5.6]}
        color={PALETTE.honey}
        intensity={6 * (0.6 + dusk * 0.6)}
        distance={13}
        decay={2}
      />
    </group>
  );
}

/**
 * The opening beat, re-exported so a scene can drive the arrival without
 * needing to know where the geometry lives. See `gateGeometry.ts` for what
 * each curve means and for `ARRIVAL_BEATS` / `GATE_FRAMING` / the world marks
 * (`buildGate().marks`) that go with it.
 */
export { arrivalTimeline, ARRIVAL_BEATS, GATE_FRAMING } from "./gateGeometry";
