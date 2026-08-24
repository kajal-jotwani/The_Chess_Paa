"use client";

import * as THREE from "three";

/**
 * THE HARNESS BRIDGE.
 *
 * Exposes a tiny, deterministic control surface on window.__park so the
 * Playwright screenshot harness can POSE cameras rather than scrub timelines.
 * Every visual claim in this project is checked against a frame captured
 * through here.
 *
 * This is dev/QA scaffolding — it ships inert (no data leaves the device,
 * nothing here is reachable by a child playing the game).
 */

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
  /** Shallow depth of field for the cinematic rigs. */
  focus?: number;
  bokeh?: number;
}

export type RigName =
  | "gate" | "plaza" | "crest" | "drone" | "chesspaa"
  | "parade" | "coaster" | "ferris" | "train" | "board" | "lake" | "free";

export interface ParkBridge {
  ready: boolean;
  pose: (p: { rig?: RigName; camera?: CameraPose; dusk?: number }) => void;
  stats: () => { fps: number; calls: number; tris: number; programs: number } | null;
  rigs: () => RigName[];
  /** Scene introspection for the harness: what is actually being drawn. */
  debug: () => Array<{ name: string; visible: boolean; verts: number; yMin: number; yMax: number; color: string | null; wx: number; wy: number; wz: number; size: number }>;
  /** Hide/show every inverted-hull outline — isolates ink from shading. */
  outlines: (on: boolean) => number;
  /** Current rig, so UI can reflect what the cameras are doing. */
  current: RigName;
}

declare global {
  interface Window {
    __park?: ParkBridge;
  }
}

/**
 * THE CAMERA RIGS.
 *
 * Hand-placed. The crest is THE shot the whole game is built around — a slow
 * climb hides the view, then the whole wonderland opens below in stacked
 * paper-flat haze layers, river a bright ribbon, Ferris wheel turning far off.
 */
export const RIGS: Record<RigName, CameraPose> = {
  // Stepping through the painted gates, ChessPaa waiting beside the car.
  gate: { position: [9, 4.2, 88], target: [1, 4.0, 58], fov: 46 },

  // Almost at lantern height, looking across the plaza to the tent.
  plaza: { position: [13, 3.4, 23], target: [-3, 2.6, -3], fov: 50 },

  // ★ THE CREST. Top of the coaster's first big climb, the reveal.
  crest: { position: [46, 34, -34], target: [-14, 2, 6], fov: 58 },

  // High drone over the whole valley — river, rides and fair all at once.
  drone: { position: [62, 74, 92], target: [-6, 0, -14], fov: 42 },

  // Cozy close-up on ChessPaa when he teaches.
  chesspaa: { position: [4.35, 3.96, 58.05], target: [6.15, 3.42, 60.0], fov: 30, focus: 2.9, bokeh: 0.9 },

  parade:  { position: [-30, 5.4, -6],  target: [-46, 2.2, -24], fov: 48 },
  coaster: { position: [40, 15, -44],   target: [62, 8, -70],    fov: 52 },
  ferris:  { position: [-44, 9, -34],   target: [-70, 14, -60],  fov: 46 },
  train:   { position: [16, 4.6, 44],   target: [35, 2.2, 30],   fov: 48 },

  // Legibility-first board camera. Clear angle, whole board readable.
  board:   { position: [0, 6.4, 7.6],   target: [0, 0.4, 0],     fov: 40 },

  // The one cool passage — the frozen lake.
  lake:    { position: [ 18, 0.6, 35],  target: [-40, -2.4, 46], fov: 54 },

  free:    { position: [10, 4, 24],     target: [0, 2, 0],       fov: 50 },
};

let installed = false;

export function installParkBridge(api: {
  setRig: (r: RigName) => void;
  setCamera: (p: CameraPose) => void;
  setDusk: (d: number) => void;
  getRenderer: () => THREE.WebGLRenderer | null;
  getFps: () => number;
  getScene: () => THREE.Scene | null;
  getSample: () => { calls: number; tris: number };
}) {
  if (typeof window === "undefined") return;
  const bridge: ParkBridge = {
    ready: false,
    current: "free",
    rigs: () => Object.keys(RIGS) as RigName[],
    pose: ({ rig, camera, dusk }) => {
      if (rig) { api.setRig(rig); bridge.current = rig; }
      if (camera) api.setCamera(camera);
      if (typeof dusk === "number") api.setDusk(dusk);
    },
    debug: () => {
      const scene = api.getScene();
      if (!scene) return [];
      const out: ReturnType<ParkBridge["debug"]> = [];
      const wp = new THREE.Vector3();
      const box = new THREE.Box3();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || o.name === "__outline") return;
        if (m.geometry && !m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const bb = m.geometry?.boundingBox;
        const mat = m.material as THREE.MeshToonMaterial;
        o.getWorldPosition(wp);
        let size = 0;
        try { box.setFromObject(m); size = +box.getSize(new THREE.Vector3()).length().toFixed(2); } catch {}
        out.push({
          name: o.name || o.type,
          visible: o.visible,
          verts: m.geometry?.getAttribute("position")?.count ?? 0,
          yMin: bb ? +bb.min.y.toFixed(2) : 0,
          yMax: bb ? +bb.max.y.toFixed(2) : 0,
          color: mat?.color?.getHexString?.() ?? null,
          wx: +wp.x.toFixed(2), wy: +wp.y.toFixed(2), wz: +wp.z.toFixed(2),
          size,
        });
      });
      return out;
    },
    outlines: (on: boolean) => {
      const scene = api.getScene();
      if (!scene) return 0;
      let n = 0;
      scene.traverse((o) => { if (o.name === "__outline") { o.visible = on; n++; } });
      return n;
    },
    stats: () => {
      const r = api.getRenderer();
      if (!r) return null;
      // Counts come from a post-render sample, not from reading renderer.info
      // here — the composer resets it, which made every report say "1 draw".
      const s = api.getSample();
      return {
        fps: Math.round(api.getFps()),
        calls: s.calls,
        tris: s.tris,
        programs: r.info.programs?.length ?? 0,
      };
    },
  };
  window.__park = bridge;
  installed = true;
  return bridge;
}

export function markParkReady() {
  if (typeof window !== "undefined" && window.__park) {
    window.__park.ready = true;
    // eslint-disable-next-line no-console
    console.log("[park] ready");
  }
}

export const bridgeInstalled = () => installed;
