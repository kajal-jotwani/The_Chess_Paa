import "./styles.css";
import * as THREE from "three";
import { Renderer } from "./core/Renderer";
import { loadAssets } from "./core/Assets";
import { World } from "./world/World";
import { CameraRig } from "./app/CameraRig";
import { App } from "./app/App";
import { tweenUpdate } from "./core/Tween";

const TIPS = [
  "Warming up the roller coaster…", "Polishing the knights…", "Filling the balloons…", "ChessPaa is finding his monocle…",
  "Waking the puzzle train…", "Counting all sixty-four squares…", "Oiling the Ferris wheel…",
];

async function boot() {
  const canvas = document.getElementById("scene") as HTMLCanvasElement;
  const fill = document.getElementById("loader-fill")!;
  const tip = document.getElementById("loader-tip")!;
  let tipIdx = 0;
  const tipTimer = setInterval(() => { tip.textContent = TIPS[++tipIdx % TIPS.length]; }, 1400);

  const r = new Renderer(canvas);
  const assets = await loadAssets(r.renderer, (frac) => { fill.style.width = `${Math.round(frac * 100)}%`; });
  const world = new World(r.scene, assets);
  const rig = new CameraRig(r.camera, canvas);
  const app = new App(r, world, rig, assets);
  (window as any).wonderland = { app, world, rig, renderer: r };
  clearInterval(tipTimer);
  // warm the shaders before revealing (avoids a hitch on first frame)
  r.renderer.compile(r.scene, r.camera);
  document.getElementById("loader")!.classList.add("hidden");
  app.start();

  const clock = new THREE.Clock();
  let last = performance.now();
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tweenUpdate(now / 1000);
    world.update(dt);
    app.update(dt);
    rig.update(dt);
    r.render(dt);
  }
  clock.start();
  // start the tween clock at the same reference
  tweenUpdate(performance.now() / 1000);
  frame();
}

boot().catch((e) => {
  console.error(e);
  const tip = document.getElementById("loader-tip");
  if (tip) tip.textContent = "Oh no — something went wrong loading the park. " + (e?.message ?? e);
});
