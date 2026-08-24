"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { PALETTE } from "../core/palette";
import { createToonMaterial, createFlatMaterial } from "../core/materials/ToonMaterial";
import { addOutline, smoothNormalsForOutline } from "../core/materials/OutlineMaterial";
import { patchMaterialForBandedFog } from "../core/materials/SkyMaterial";
import { woodTexture, snowTexture, iceTexture, glowSprite, stripeTexture } from "../core/textures/procedural";
import {
  buildTerrainGeometry, buildIceGeometry, buildSnowBanks, terrainHeight,
} from "./terrain";
import {
  buildRailGeometry, buildSleeperGeometry, buildSupportGeometry, ATTRACTIONS,
} from "./coasterSpine";
import {
  buildForest, lanternPositions, buildLanternPoleGeometry, buildLanternGlassGeometry,
  buntingRuns, buildBuntingGeometry, buildBuntingCordGeometry, fairyLightPositions,
  buildPlazaGeometry,
} from "./props";
import { SkyDome, CelClouds, Atmosphere } from "./Sky";
import { buildPathGeometry, buildSignpostGeometry, signposts } from "./paths";
import Landmarks from "./Landmarks";
import ParkLife from "./ParkLife";
import Gate from "./Gate";
import ChessPaa from "../characters/ChessPaa";
import Grandchildren from "../characters/Grandchildren";
import { NO_INK_LAYER } from "../core/postfx/effects";

/**
 * THE PARK.
 *
 * One real, coherent place: a warm valley cupped between pine-dark hills,
 * a frozen river through its heart, a lantern-lit plaza where the paths meet,
 * and the coaster spine threading every attraction together.
 *
 * Everything here is generated in code and merged aggressively — the whole
 * valley is a couple of dozen draw calls so we can hold 60fps at retina.
 */

/** Helper: build a mesh with the toon material, outline, and banded fog. */
function toonMesh(
  geo: THREE.BufferGeometry,
  opts: Parameters<typeof createToonMaterial>[0] & { outline?: number | false } = {}
): THREE.Mesh {
  const { outline = 2.2, ...matOpts } = opts as typeof opts & { outline?: number | false };
  const mat = createToonMaterial(matOpts);
  patchMaterialForBandedFog(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (outline !== false) {
    addOutline(mesh, { thickness: outline as number });
  }
  return mesh;
}

export function Park({ dusk = 0 }: { dusk?: number }) {
  /* ---------------- terrain, ice, banks ---------------- */
  const ground = useMemo(() => {
    const geo = buildTerrainGeometry();
    const m = toonMesh(geo, {
      color: PALETTE.snow,
      ramp: "snow",
      map: snowTexture(),
      rim: 0.14,
      rimPower: 4.5,
      bounce: 0.34,
      outline: false,           // the ground has no silhouette to ink
    });
    m.castShadow = false;
    return m;
  }, []);

  const ice = useMemo(() => {
    const geo = buildIceGeometry();
    const m = toonMesh(geo, {
      color: PALETTE.ice,
      ramp: "ice",
      map: iceTexture(),
      rim: 0.42,
      rimPower: 2.6,
      rimColor: 0xd6f4ff,
      bounce: 0.05,
      outline: false,
    });
    m.castShadow = false;
    return m;
  }, []);

  const banks = useMemo(() => {
    const m = toonMesh(buildSnowBanks(), {
      color: PALETTE.snow,
      ramp: "snow",
      map: snowTexture(),
      rim: 0.72,
      rimPower: 2.4,
      bounce: 0.34,
      outline: 1.6,
    });
    m.castShadow = false;
    return m;
  }, []);

  const plaza = useMemo(() => {
    const m = toonMesh(buildPlazaGeometry(), {
      color: PALETTE.creamPale,
      ramp: "soft",
      rim: 0.1,
      bounce: 0.28,
      outline: false,
    });
    m.castShadow = false;
    return m;
  }, []);

  /* ---------------- walkways + signposts ---------------- */
  // Trodden paths are the oldest, warmest wayfinding there is: a child should
  // always be able to SEE where the next thing is.
  const paths = useMemo(() => {
    const m = toonMesh(buildPathGeometry(), {
      color: 0xe6d6c2,
      ramp: "snow",
      map: snowTexture(),
      rim: 0.1,
      bounce: 0.24,
      outline: false,
    });
    m.castShadow = false;
    return m;
  }, []);

  const signGeo = useMemo(() => smoothNormalsForOutline(buildSignpostGeometry()), []);
  const signMat = useMemo(() => {
    const m = createToonMaterial({
      color: PALETTE.walnutLight, ramp: "wood", map: woodTexture(PALETTE.walnutLight, 9), rim: 0.55,
    });
    patchMaterialForBandedFog(m);
    return m;
  }, []);
  const posts = useMemo(() => signposts(), []);

  /* ---------------- the pine wall ---------------- */
  const forest = useMemo(() => buildForest(), []);
  const trees = useMemo(() => {
    const m = toonMesh(forest.trees, {
      color: 0x35543c,
      ramp: "foliage",
      rim: 0.28,
      rimPower: 3.4,
      rimColor: 0xd9a25e,
      bounce: 0.18,
      outline: 1.7,
      flatShading: true,
    });
    return m;
  }, [forest]);

  const treeSnow = useMemo(
    () => toonMesh(forest.snow, {
      color: PALETTE.snow, ramp: "snow", rim: 0.35, bounce: 0.3, outline: false, flatShading: true,
    }),
    [forest]
  );

  /** The far band: flat cut-paper billboards, graphic in the haze. */
  const farTrees = useMemo(() => {
    if (!forest.far.length) return null;
    const geo = new THREE.ConeGeometry(1, 2.2, 5);
    const mat = createFlatMaterial(0x2c4433);
    patchMaterialForBandedFog(mat);
    const inst = new THREE.InstancedMesh(geo, mat, forest.far.length);
    const dummy = new THREE.Object3D();
    forest.far.forEach((t, i) => {
      dummy.position.set(t.x, t.y + t.s * 0.5, t.z);
      dummy.scale.set(t.s * 0.42, t.s, t.s * 0.42);
      dummy.rotation.y = (i % 7) * 0.9;
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = false;
    return inst;
  }, [forest]);

  /* ---------------- the coaster spine ---------------- */
  const rails = useMemo(
    () => toonMesh(buildRailGeometry(), {
      color: PALETTE.honeyDeep, ramp: "wood", rim: 0.6, rimPower: 2.6, outline: 1.5,
    }),
    []
  );
  const sleepers = useMemo(
    () => toonMesh(buildSleeperGeometry(), {
      color: PALETTE.walnut, ramp: "wood", map: woodTexture(), rim: 0.35, outline: 1.2,
    }),
    []
  );
  const supports = useMemo(() => {
    const geo = smoothNormalsForOutline(buildSupportGeometry());
    return toonMesh(geo, {
      color: PALETTE.walnutLight, ramp: "wood", map: woodTexture(PALETTE.walnutLight, 3),
      rim: 0.4, outline: 1.5,
    });
  }, []);

  /* ---------------- lanterns ---------------- */
  const lanternSpots = useMemo(() => lanternPositions(), []);
  const poleGeo = useMemo(() => smoothNormalsForOutline(buildLanternPoleGeometry()), []);
  const glassGeo = useMemo(() => buildLanternGlassGeometry(), []);

  const poleMat = useMemo(() => {
    const m = createToonMaterial({ color: PALETTE.walnut, ramp: "wood", rim: 0.5, map: woodTexture() });
    patchMaterialForBandedFog(m);
    return m;
  }, []);
  const glassMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: PALETTE.lanternCore, fog: true, toneMapped: false }),
    []
  );

  /* ---------------- bunting + fairy lights ---------------- */
  const runs = useMemo(() => buntingRuns(), []);
  const bunting = useMemo(() => {
    const geo = buildBuntingGeometry(runs);
    const mat = createToonMaterial({
      color: 0xffffff, ramp: "soft", rim: 0.5, side: THREE.DoubleSide,
      map: stripeTexture(PALETTE.plum, PALETTE.cream, 2),
    });
    patchMaterialForBandedFog(mat);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false;
    return m;
  }, [runs]);

  const cord = useMemo(
    () => toonMesh(buildBuntingCordGeometry(runs), {
      color: PALETTE.cocoa, ramp: "wood", rim: 0.2, outline: false,
    }),
    [runs]
  );

  const fairy = useMemo(() => {
    const pos = fairyLightPositions();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      size: 0.34, map: glowSprite(PALETTE.honey), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, color: PALETTE.honey, sizeAttenuation: true,
      toneMapped: false, fog: false,
    });
    const pts = new THREE.Points(g, m);
    pts.layers.set(NO_INK_LAYER); // never inked
    return pts;
  }, []);

  const fairyRef = useRef<THREE.Points>(null);
  useFrame((s) => {
    // fairy-lights breathe; they haven't quite decided to glow
    const mat = fairy.material as THREE.PointsMaterial;
    mat.opacity = 0.72 + Math.sin(s.clock.elapsedTime * 1.4) * 0.16;
  });

  return (
    <group>
      <SkyDome dusk={dusk} />
      <CelClouds />

      {/* ---- LIGHTING: one low golden key, cool lavender fill ---- */}
      <hemisphereLight args={[0xffd9bd, 0x8f7fb4, 0.72]} />
      <directionalLight
        position={[46, 22, 58]}
        intensity={1.15}
        color={0xffe3c2}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-near={1}
        shadow-camera-far={220}
        shadow-camera-left={-78}
        shadow-camera-right={78}
        shadow-camera-top={78}
        shadow-camera-bottom={-78}
        shadow-bias={-0.0012}
        shadow-normalBias={0.03}
      />
      {/* cool bounce from the opposite side so shadows are coloured, not grey */}
      <directionalLight position={[-40, 16, -30]} intensity={0.55} color={0xa294cc} />
      <ambientLight intensity={0.42} color={0xb0a0c4} />

      <primitive object={ground} />
      <primitive object={plaza} />
      <primitive object={paths} />
      <primitive object={ice} />
      <primitive object={banks} />
      <primitive object={trees} />
      <primitive object={treeSnow} />
      {farTrees && <primitive object={farTrees} />}

      <primitive object={rails} />
      <primitive object={sleepers} />
      <primitive object={supports} />

      {posts.map((sp, i) => (
        <group key={`sign-${i}`} position={sp.pos} rotation={[0, sp.facing, 0]}>
          <mesh geometry={signGeo} material={signMat} castShadow receiveShadow />
        </group>
      ))}

      {lanternSpots.map((s, i) => (
        <group key={i} position={[s.x, s.y, s.z]} rotation={[0, (i * 1.3) % (Math.PI * 2), 0]}>
          <mesh geometry={poleGeo} material={poleMat} castShadow receiveShadow />
          <mesh geometry={glassGeo} material={glassMat} layers-mask={1 << NO_INK_LAYER} />
          {/* a real practical light pooling warmth on the snow beneath */}
          <pointLight position={[0.36, 3.34, 0]} intensity={9} distance={16} decay={2} color={PALETTE.lanternCore} />
        </group>
      ))}

      <primitive object={bunting} />
      <primitive object={cord} />
      <primitive object={fairy} ref={fairyRef} />

      {/* The five attractions and the plaza dressing. */}
      <Landmarks dusk={dusk} />

      {/* The painted gates — the first thing a child ever sees. */}
      <Gate dusk={dusk} />

      {/* The park is never still: piece-folk on the paths, crows in the pines,
          breath in the cold, snow-glitter drifting over the ice. */}
      <ParkLife dusk={dusk} quality="high" />

      {/* ChessPaa waiting at the gate, lantern swinging. He is the warmest
          point on screen, so the eye always finds him. */}
      <ChessPaa
        position={[6.2, terrainHeight(6.2, 60), 60]}
        rotation={[0, -2.05, 0]}
        mood="idle"
        // A decay-2 point light at 14 sitting ~0.3m off his own coat resolves to
        // ~150 units of irradiance on him: he blew out to a flat green blob and
        // the snow under him went pure white. He should GLOW, not incinerate.
        lanternIntensity={3.2}
      />

      {/* Two small riders waiting by the car, ready to lean into the first drop. */}
      <Grandchildren
        position={[3.1, terrainHeight(3.1, 62.4), 62.4]}
        rotation={[0, -2.2, 0]}
        reaction="idle"
      />

      <Atmosphere />
    </group>
  );
}

export { ATTRACTIONS, terrainHeight };
