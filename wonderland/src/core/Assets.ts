import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { waterNormals } from "./Textures";

export interface PBRSet { map: THREE.Texture; normalMap: THREE.Texture; armMap: THREE.Texture; }
export interface Assets {
  models: { pieces: THREE.Group; pieces_lod: THREE.Group; chesspaa: THREE.Group; kids: THREE.Group; piecefolk: THREE.Group };
  tex: Record<"grass" | "sand" | "wood_light" | "wood_dark" | "wood_frame" | "bark" | "castle" | "cobble", PBRSet>;
  envMap: THREE.Texture;
  skyMap: THREE.Texture;
  waterNormals: THREE.Texture;
}

const TEX_NAMES = ["grass", "sand", "wood_light", "wood_dark", "wood_frame", "bark", "castle", "cobble"] as const;

export async function loadAssets(renderer: THREE.WebGLRenderer, onProgress: (frac: number, label: string) => void, sky = "day"): Promise<Assets> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const total = 5 + TEX_NAMES.length * 3 + 2;
  let done = 0;
  const tick = (label: string) => { done++; onProgress(done / total, label); };
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const gltf = new GLTFLoader();
  gltf.setMeshoptDecoder(MeshoptDecoder);
  const texLoader = new THREE.TextureLoader();
  const loadTex = (url: string, srgb: boolean) => new Promise<THREE.Texture>((res, rej) => {
    texLoader.load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = maxAniso;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      res(t);
    }, undefined, rej);
  });

  const modelsP = Promise.all((["pieces", "pieces_lod", "chesspaa", "kids", "piecefolk"] as const).map(async (name) => {
    const g = await gltf.loadAsync(`${base}/models/${name}.glb`);
    tick(name);
    return [name, g.scene] as const;
  }));

  const texP = Promise.all(TEX_NAMES.map(async (name) => {
    const [map, normalMap, armMap] = await Promise.all([
      loadTex(`${base}/textures/${name}/diff.jpg`, true).then((t) => { tick(name); return t; }),
      loadTex(`${base}/textures/${name}/nor.jpg`, false).then((t) => { tick(name); return t; }),
      loadTex(`${base}/textures/${name}/arm.jpg`, false).then((t) => { tick(name); return t; }),
    ]);
    return [name, { map, normalMap, armMap }] as const;
  }));

  const hdrP = loadSky(renderer, sky).then((hdr) => {
    tick("sky");
    return hdr;
  });

  const waterP = Promise.resolve(waterNormals()).then((t) => { tick("water"); return t; });

  const [models, tex, hdr, water] = await Promise.all([modelsP, texP, hdrP, waterP]);
  return {
    models: Object.fromEntries(models) as Assets["models"],
    tex: Object.fromEntries(tex) as Assets["tex"],
    envMap: hdr.envMap,
    skyMap: hdr.skyMap,
    waterNormals: water,
  };
}

/** Standard PBR material from a texture set (arm = ao/roughness/metalness). */
export function pbr(set: PBRSet, opts: { repeat?: number | [number, number]; color?: THREE.ColorRepresentation; roughness?: number; metalness?: number; normalScale?: number; envMapIntensity?: number; clone?: boolean } = {}) {
  const rep = typeof opts.repeat === "number" ? [opts.repeat, opts.repeat] : (opts.repeat ?? [1, 1]);
  const mk = (t: THREE.Texture) => { const c = t.clone(); c.repeat.set(rep[0], rep[1]); c.needsUpdate = true; return c; };
  const m = new THREE.MeshStandardMaterial({
    map: mk(set.map), normalMap: mk(set.normalMap), aoMap: mk(set.armMap), roughnessMap: mk(set.armMap), metalnessMap: mk(set.armMap),
    color: opts.color ?? 0xffffff, roughness: opts.roughness ?? 1.0, metalness: opts.metalness ?? 1.0,
    normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1), envMapIntensity: opts.envMapIntensity ?? 0.9,
  });
  return m;
}

/** Load one of the sky domes and prefilter it for reflections. */
export async function loadSky(renderer: THREE.WebGLRenderer, name: string): Promise<{ envMap: THREE.Texture; skyMap: THREE.Texture }> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const hdr = await new HDRLoader().loadAsync(`${base}/hdr/${name}.hdr`);
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envMap = pmrem.fromEquirectangular(hdr).texture;
  pmrem.dispose();
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  return { envMap, skyMap: hdr };
}
