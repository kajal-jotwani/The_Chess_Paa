"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";

import { Park } from "./world/Park";
import { PALETTE } from "./core/palette";
import { buildWarmLUT } from "./core/toonRamp";
import { SobelInkEffect, WarmLUTEffect, createNormalDepthMaterial, NO_INK_LAYER } from "./core/postfx/effects";
import { installParkBridge, markParkReady, RIGS, type RigName, type CameraPose } from "./harnessBridge";
import Game from "./game/Game";
import GameHud from "./game/GameHud";
import { director } from "./game/gameState";

/**
 * THE STAGE — Canvas, cameras, and the post chain.
 *
 * Post order matters and is deliberate:
 *   scene → [normal+depth prepass] → Sobel interior ink → restrained bloom
 *         → vignette → THE WARM LUT (always last, it unifies the page)
 */

/* ------------------------------------------------------------------ */
/* CAMERA RIG CONTROLLER                                               */
/* ------------------------------------------------------------------ */

interface RigState { pose: CameraPose; instant: boolean }

function CameraRig({ state }: { state: React.MutableRefObject<RigState> }) {
  const { camera } = useThree();
  // The main camera sees both ink-able geometry (layer 0) and the no-ink
  // layer (particles, glows, sky). Only the prepass camera drops layer 2.
  useEffect(() => { camera.layers.enable(NO_INK_LAYER); }, [camera]);
  const target = useRef(new THREE.Vector3());
  const desired = useRef(new THREE.Vector3());

  useFrame((_, dt) => {
    const { pose, instant } = state.current;
    desired.current.set(...pose.position);
    const tgt = new THREE.Vector3(...pose.target);

    // Spring-damped follow with a soft, kid-friendly lag.
    const k = instant ? 1 : 1 - Math.exp(-dt * 3.4);
    camera.position.lerp(desired.current, k);
    target.current.lerp(tgt, k);
    camera.lookAt(target.current);

    const cam = camera as THREE.PerspectiveCamera;
    const wantFov = pose.fov ?? 50;
    cam.fov += (wantFov - cam.fov) * k;
    cam.updateProjectionMatrix();

    if (instant) state.current.instant = false;
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* NORMAL + DEPTH PREPASS (feeds the Sobel interior lines)             */
/* ------------------------------------------------------------------ */

/** Zeroes the render counters once per frame, before anything draws. */
function FrameCounters() {
  const { gl } = useThree();
  useFrame(() => { gl.info.reset(); }, -1);
  return null;
}

function NormalDepthPrepass({ rt }: { rt: THREE.WebGLRenderTarget }) {
  const { gl, scene, camera, size } = useThree();
  const mat = useMemo(() => createNormalDepthMaterial(), []);

  useEffect(() => {
    rt.setSize(Math.max(2, size.width), Math.max(2, size.height));
  }, [rt, size]);

  // priority 0 → runs before the composer's priority-1 render each frame
  useFrame(() => {
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    const prevMask = camera.layers.mask;

    // Ink-able geometry only. Particles, glows and the sky sit on NO_INK_LAYER
    // and are excluded here, so the Sobel can never turn a firefly into a
    // black square.
    camera.layers.disable(NO_INK_LAYER);

    scene.overrideMaterial = mat;
    // flat normal + far depth, so empty sky produces no edges at all
    scene.background = new THREE.Color(0x8080ff);
    gl.setRenderTarget(rt);
    gl.clear(true, true, true);
    gl.render(scene, camera);
    gl.setRenderTarget(null);

    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    camera.layers.mask = prevMask;
  }, 0);

  return null;
}

/* ------------------------------------------------------------------ */
/* ADAPTIVE PIXEL RATIO — protects the framerate before the last pixel */
/* ------------------------------------------------------------------ */

function AdaptiveQuality({
  onFps, onSample,
}: {
  onFps: (n: number) => void;
  onSample: (s: { calls: number; tris: number }) => void;
}) {
  const { gl } = useThree();
  const acc = useRef({ t: 0, n: 0, fps: 60, cooldown: 1.5, calls: 0, tris: 0 });

  // Priority 2 → runs AFTER the composer's priority-1 render, so renderer.info
  // still holds this frame's real counts.
  useFrame(() => {
    const a = acc.current;
    a.calls = Math.max(a.calls, gl.info.render.calls);
    a.tris = Math.max(a.tris, gl.info.render.triangles);
  }, 2);

  useFrame((_, dt) => {
    const a = acc.current;
    a.t += dt; a.n++;
    a.cooldown -= dt;
    if (a.t >= 0.5) {
      a.fps = a.n / a.t;
      onFps(a.fps);
      onSample({ calls: a.calls, tris: a.tris });
      a.t = 0; a.n = 0; a.calls = 0; a.tris = 0;

      if (a.cooldown <= 0) {
        const cur = gl.getPixelRatio();
        const max = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1);
        if (a.fps < 52 && cur > 0.75) {
          gl.setPixelRatio(Math.max(0.75, cur - 0.25));
          a.cooldown = 2.0;
        } else if (a.fps > 58 && cur < max) {
          gl.setPixelRatio(Math.min(max, cur + 0.25));
          a.cooldown = 3.0;
        }
      }
    }
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* POST CHAIN                                                          */
/* ------------------------------------------------------------------ */

function PostChain({ rt }: { rt: THREE.WebGLRenderTarget }) {
  const { size } = useThree();
  const lut = useMemo(() => buildWarmLUT(16), []);
  const sobel = useMemo(() => new SobelInkEffect(rt, {
    ink: PALETTE.ink,
    normalStrength: 0.95,
    depthStrength: 0.30,
    threshold: 0.44,
    falloff: 0.80,
  }), [rt]);
  const grade = useMemo(() => new WarmLUTEffect(lut, 0.62), [lut]);

  useEffect(() => { sobel.setSize(size.width, size.height); }, [sobel, size]);

  return (
    <EffectComposer multisampling={0}>
      <primitive object={sobel} />
      {/* Restrained: a gentle halo on lantern cores and the low sun only —
          never a hazy wash that eats the crisp toon bands. */}
      <Bloom intensity={0.62} luminanceThreshold={0.72} luminanceSmoothing={0.28} mipmapBlur radius={0.62} />
      <Vignette offset={0.30} darkness={0.42} />
      <primitive object={grade} />
    </EffectComposer>
  );
}

/* ------------------------------------------------------------------ */
/* SCENE ROOT                                                          */
/* ------------------------------------------------------------------ */

function SceneRoot({
  rigState, duskRef, onFps, onSample, onReady,
}: {
  rigState: React.MutableRefObject<RigState>;
  duskRef: React.MutableRefObject<number>;
  onFps: (n: number) => void;
  onSample: (s: { calls: number; tris: number }) => void;
  onReady: (gl: THREE.WebGLRenderer, scene: THREE.Scene) => void;
}) {
  const { gl, scene } = useThree();
  const rt = useMemo(
    () => new THREE.WebGLRenderTarget(1920, 1080, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    }),
    []
  );
  const [dusk, setDusk] = useState(0);

  useEffect(() => {
    // Banded fog picks up the honey haze; near/far tuned so the crest reveal
    // stacks the valley into flat paper cards.
    scene.fog = new THREE.Fog(PALETTE.fogNear, 96, 340);
    scene.background = new THREE.Color(PALETTE.skyHorizon);
    onReady(gl, scene);
  }, [scene, gl, onReady]);

  useFrame(() => { if (duskRef.current !== dusk) setDusk(duskRef.current); });

  return (
    <>
      <FrameCounters />
      <NormalDepthPrepass rt={rt} />
      <AdaptiveQuality onFps={onFps} onSample={onSample} />
      <Park dusk={dusk} />
      <Game />
      <PostChain rt={rt} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* PUBLIC STAGE                                                        */
/* ------------------------------------------------------------------ */

export default function Stage({ initialRig = "gate" as RigName }) {
  const rigState = useRef<RigState>({ pose: RIGS[initialRig], instant: true });
  const duskRef = useRef(0);
  const fpsRef = useRef(60);
  const sampleRef = useRef({ calls: 0, tris: 0 });
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const [, force] = useState(0);

  const sceneRef = useRef<THREE.Scene | null>(null);

  const handleReady = useCallback((gl: THREE.WebGLRenderer, scene: THREE.Scene) => {
    glRef.current = gl;
    sceneRef.current = scene;
    // The bridge lets the screenshot harness pose cameras deterministically.
    installParkBridge({
      setRig: (r) => {
        const p = RIGS[r];
        director.setCine({ position: p.position, target: p.target, fov: p.fov });
        force((n) => n + 1);
      },
      setCamera: (p) => { director.setCine({ position: p.position, target: p.target, fov: p.fov }); },
      setDusk: (d) => { duskRef.current = d; },
      getRenderer: () => glRef.current,
      getFps: () => fpsRef.current,
      getScene: () => sceneRef.current,
      getSample: () => sampleRef.current,
    });
    // QA/harness hooks for the game itself — poseable, deterministic.
    if (typeof window !== "undefined" && window.__park) {
      Object.assign(window.__park as unknown as Record<string, unknown>, {
        gameMode: () => director.mode,
        ride: () => { director.setCine(null); director.startRide(); },
        keepRiding: () => director.keepRiding(),
        hopOff: () => director.hopOff(),
        atStation: () => director.atStation?.stop ?? null,
        walkTo: (x: number, z: number) => { director.playerPos.set(x, 0, z); },
        rideTo: (t: number) => { director.jumpRide(t); },
      });
    }
    // Give the first frames a moment to compile shaders before we announce.
    setTimeout(() => markParkReady(), 350);
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#e8a97e" }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{
          antialias: false,           // the cel pipeline supplies its own edges
          powerPreference: "high-performance",
          alpha: false,
          stencil: false,
        }}
        camera={{ position: RIGS[initialRig].position, fov: RIGS[initialRig].fov ?? 50, near: 0.1, far: 600 }}
        onCreated={({ gl }) => {
          // NOT ACES: filmic tone mapping desaturates and rolls off exactly
          // the flat, saturated bands the toon ramp works so hard to produce.
          gl.toneMapping = THREE.NeutralToneMapping;
          gl.toneMappingExposure = 1.0;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.shadowMap.type = THREE.PCFShadowMap;
          // We reset these ourselves once per frame (see FrameCounters) so the
          // composer's internal passes accumulate instead of clobbering.
          gl.info.autoReset = false;
        }}
      >
        <SceneRoot
          rigState={rigState}
          duskRef={duskRef}
          onFps={(n) => { fpsRef.current = n; }}
          onSample={(s) => { sampleRef.current = s; }}
          onReady={handleReady}
        />
      </Canvas>
      <GameHud />
    </div>
  );
}
