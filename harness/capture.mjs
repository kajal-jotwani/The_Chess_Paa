/**
 * THE SCREENSHOT HARNESS.
 *
 * Built before anything else, per the build bible: every visual claim gets
 * checked against a REAL CAPTURED FRAME, never against an assumption about
 * what the code does.
 *
 * Drives a scripted run through the plaza, each ride, the coaster crest
 * reveal, and a full tutored game, capturing retina frames from every camera.
 *
 * Usage:  node harness/capture.mjs [--url http://localhost:3000] [--out shots]
 *         node harness/capture.mjs --only crest
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = arg("--url", "http://localhost:3000");
const OUT = arg("--out", "shots");
const ONLY = arg("--only", null);
const DPR = Number(arg("--dpr", "2"));           // retina
const W = Number(arg("--w", "1440"));
const H = Number(arg("--h", "900"));

mkdirSync(OUT, { recursive: true });

// Headless Chromium needs real GL. SwiftShader gives us a correct (if slow)
// rasteriser, which is exactly right for capturing frames deterministically.
const GL_FLAGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--enable-webgl",
  "--ignore-gpu-blocklist",
  "--disable-gpu-sandbox",
  "--force-color-profile=srgb",
  "--disable-lcd-text",
];

const log = (...m) => console.log("[harness]", ...m);

/**
 * A "shot" is a named camera state the game can be driven into.
 * The game exposes window.__park (see src/three/harness-bridge.ts) so the
 * harness can pose cameras deterministically instead of scrubbing timelines.
 */
const SHOTS = [
  { name: "01-gate",        go: "/park", pose: { rig: "gate" },        settle: 2600 },
  { name: "02-plaza",       go: "/park", pose: { rig: "plaza" },       settle: 2200 },
  { name: "03-crest",       go: "/park", pose: { rig: "crest" },       settle: 2600 },
  { name: "04-drone",       go: "/park", pose: { rig: "drone" },       settle: 2400 },
  { name: "05-chesspaa",    go: "/park", pose: { rig: "chesspaa" },    settle: 2200 },
  { name: "06-parade",      go: "/park", pose: { rig: "parade" },      settle: 2400 },
  { name: "07-coaster",     go: "/park", pose: { rig: "coaster" },     settle: 2400 },
  { name: "08-ferris",      go: "/park", pose: { rig: "ferris" },      settle: 2400 },
  { name: "09-train",       go: "/park", pose: { rig: "train" },       settle: 2400 },
  { name: "10-board",       go: "/park", pose: { rig: "board" },       settle: 2600 },
  { name: "11-lake",        go: "/park", pose: { rig: "lake" },        settle: 2200 },
];

async function main() {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium",
    args: GL_FLAGS,
  }).catch(() => chromium.launch({ args: GL_FLAGS }));

  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: DPR,
    reducedMotion: "no-preference",
  });
  const page = await ctx.newPage();

  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message.slice(0, 300)));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error") errors.push("CONSOLE " + t.slice(0, 300));
    if (t.startsWith("[park]")) log("page:", t);
  });

  const shots = ONLY ? SHOTS.filter((s) => s.name.includes(ONLY)) : SHOTS;
  const report = [];

  for (const shot of shots) {
    const url = BASE + shot.go;
    log("→", shot.name, url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });

    // Wait for the park bridge to announce the scene is live.
    const ready = await page.waitForFunction(
      () => window.__park && window.__park.ready === true,
      null,
      { timeout: 90_000 }
    ).catch(() => null);

    if (!ready) {
      log("  !! park bridge never became ready");
      report.push({ shot: shot.name, ok: false, reason: "bridge-not-ready" });
      await page.screenshot({ path: join(OUT, shot.name + "-FAILED.png") });
      continue;
    }

    if (shot.pose) {
      await page.evaluate((p) => window.__park.pose(p), shot.pose);
    }
    await page.waitForTimeout(shot.settle);

    // Let a couple of frames render after the pose so animations settle.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const path = join(OUT, shot.name + ".png");
    await page.screenshot({ path });

    const stats = await page.evaluate(() => window.__park.stats?.() ?? null);
    log("  ✓", shot.name, stats ? `fps~${stats.fps} draws=${stats.calls} tris=${stats.tris}` : "");
    report.push({ shot: shot.name, ok: true, stats });
  }

  writeFileSync(join(OUT, "report.json"), JSON.stringify({ report, errors }, null, 2));
  log("errors:", errors.length ? errors.slice(0, 10).join("\n") : "none");
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
