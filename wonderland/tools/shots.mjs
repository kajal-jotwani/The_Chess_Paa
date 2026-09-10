// Headless screenshots of the park (uses the parent project's Playwright).
import { createRequire } from "node:module";
const require = createRequire("/Users/kajaljotwani/Developer/The_Chess_Paa/package.json");
const { chromium } = require("playwright");
const out = process.argv[2] || "/tmp/shots";
import fs from "node:fs"; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto("http://localhost:5173", { waitUntil: "load" });
await page.waitForFunction(() => window.wonderland && !document.getElementById("loader").classList.contains("hidden") === false, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/01-intro.png` });
await page.click("#intro-enter");
await page.waitForTimeout(4500);
await page.screenshot({ path: `${out}/02-hub-day.png` });
for (const t of ["dusk", "night", "rain"]) {
  await page.evaluate(async (t) => { await window.wonderland.app.setTheme(t, true); }, t);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/03-hub-${t}.png` });
}
await page.evaluate(() => window.wonderland.app.setTheme("day", true));
await page.evaluate(() => window.wonderland.app.enter("grand_match"));
await page.waitForTimeout(3000);
await page.evaluate(() => { const c = document.querySelector('.card[data-l="bunny"]'); if (c) c.click(); });
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/04-grand-match.png` });
await browser.close();
console.log("done");
