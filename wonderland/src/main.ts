import "./styles.css";
import * as THREE from "three";
import { Renderer } from "./core/Renderer";
import { loadAssets } from "./core/Assets";
import { World } from "./world/World";
import { CameraRig } from "./app/CameraRig";
import { App } from "./app/App";
import { tweenUpdate } from "./core/Tween";
import { themeFromClock } from "./core/WeatherDetect";
import { Atmosphere } from "./world/Atmosphere";

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
  const saved = localStorage.getItem("cw.theme");
  const theme = (saved && saved !== "auto" ? saved : themeFromClock()) as any;
  const assets = await loadAssets(r.renderer, (frac) => { fill.style.width = `${Math.round(frac * 100)}%`; }, theme);
  const world = new World(r.scene, assets);
  const rig = new CameraRig(r.camera, canvas);
  const atmosphere = new Atmosphere({ scene: r.scene, sun: world.sun, hemi: world.hemi, sunGlow: world.sunGlow, renderer: r.renderer, setBloom: (v) => r.setBloom(v), setSaturation: (v) => r.setSaturation(v), worldGroup: world.group, wetMaterials: world.wetMaterials, lampSpots: world.lampSpots });
  await atmosphere.apply(theme, true);
  const app = new App(r, world, rig, assets, atmosphere);
  (window as any).wonderland = { app, world, rig, renderer: r };
  clearInterval(tipTimer);
  // warm the shaders before revealing (avoids a hitch on first frame)
  r.renderer.compile(r.scene, r.camera);
  document.getElementById("loader")!.classList.add("hidden");
  const intro = document.getElementById("intro")!;
  intro.classList.remove("hidden");
  app.preroll();
  document.getElementById("intro-enter")!.onclick = () => { intro.classList.add("hidden"); app.start(); };

  let last = performance.now();
  let simTime = last / 1000;
  const step = (dt: number, render = true) => {
    simTime += dt;
    tweenUpdate(simTime);
    world.update(dt);
    app.update(dt);
    atmosphere.update(dt, r.camera);
    rig.update(dt);
    if (render) r.render(dt);
  };
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
  }
  // test hook: advance the simulation deterministically (used when the tab is hidden and rAF is paused)
  (window as any).wonderland.tick = (seconds: number, render = false) => { const n = Math.round(seconds * 60); for (let i = 0; i < n; i++) step(1 / 60, render && i === n - 1); last = performance.now(); };
  tweenUpdate(simTime);
  frame();
}

boot().catch((e) => {
  console.error(e);
  const tip = document.getElementById("loader-tip");
  if (tip) tip.textContent = "Oh no — something went wrong loading the park. " + (e?.message ?? e);
});
