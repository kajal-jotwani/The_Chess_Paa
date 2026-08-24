"use client";

import * as THREE from "three";
import { PALETTE, css, mix } from "../palette";

/**
 * EVERY TEXTURE IN THE PARK, PAINTED IN CODE.
 *
 * Canvas-2D only. No downloaded images, no stock textures, ever.
 * Each generator returns a cached THREE.Texture.
 *
 * These are painted the way a set-dresser would paint a toy: visible grain,
 * hand-wobbled lines, a little wear at the edges. Perfectly even = plastic.
 */

const cache = new Map<string, THREE.Texture>();

function makeCanvas(size = 256): { c: HTMLCanvasElement; x: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d")!;
  return { c, x };
}

function finish(c: HTMLCanvasElement, key: string, repeat = 1): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

/** Deterministic pseudo-random so the park looks identical every run. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* WOOD — the toy-wood everything is carved from                        */
/* ------------------------------------------------------------------ */
export function woodTexture(tint: number = PALETTE.walnut, seed = 7): THREE.Texture {
  const key = `wood-${tint}-${seed}`;
  if (cache.has(key)) return cache.get(key)!;
  const { c, x } = makeCanvas(256);
  const r = rng(seed);

  x.fillStyle = css(tint);
  x.fillRect(0, 0, 256, 256);

  // grain: long wavering lines, warm and cool alternating
  for (let i = 0; i < 46; i++) {
    const y0 = r() * 256;
    const light = r() > 0.5;
    x.strokeStyle = css(mix(tint, light ? PALETTE.walnutLight : PALETTE.cocoa, 0.35 + r() * 0.4));
    x.lineWidth = 0.7 + r() * 2.4;
    x.globalAlpha = 0.18 + r() * 0.3;
    x.beginPath();
    x.moveTo(-10, y0);
    for (let px = 0; px <= 266; px += 16) {
      x.lineTo(px, y0 + Math.sin(px * 0.035 + i) * (2.5 + r() * 3.5));
    }
    x.stroke();
  }
  // knots
  x.globalAlpha = 0.32;
  for (let k = 0; k < 3; k++) {
    const kx = r() * 256, ky = r() * 256;
    for (let ring = 8; ring > 0; ring--) {
      x.strokeStyle = css(mix(tint, PALETTE.cocoa, 0.5));
      x.lineWidth = 1.1;
      x.beginPath();
      x.ellipse(kx, ky, ring * 1.9, ring * 1.2, r() * 3, 0, Math.PI * 2);
      x.stroke();
    }
  }
  x.globalAlpha = 1;
  return finish(c, key, 2);
}

/* ------------------------------------------------------------------ */
/* SNOW — plush, sparkling, takes the dusk                              */
/* ------------------------------------------------------------------ */
export function snowTexture(seed = 11): THREE.Texture {
  const key = `snow-${seed}`;
  if (cache.has(key)) return cache.get(key)!;
  const { c, x } = makeCanvas(512);
  const r = rng(seed);

  x.fillStyle = css(PALETTE.snow);
  x.fillRect(0, 0, 512, 512);

  // WIND-CARVED RIPPLES. Real snow is never an even sheet — it is combed into
  // long soft ridges. Without these the valley floor reads as blank paper,
  // which is exactly how it read in the first captures.
  for (let i = 0; i < 34; i++) {
    const y0 = r() * 512;
    const warm = r() > 0.42;
    x.strokeStyle = warm ? "rgba(255,246,228,0.5)" : "rgba(150,134,168,0.30)";
    x.lineWidth = 5 + r() * 22;
    x.globalAlpha = 0.16 + r() * 0.2;
    x.beginPath();
    x.moveTo(-20, y0);
    for (let px = 0; px <= 532; px += 26) {
      x.lineTo(px, y0 + Math.sin(px * 0.012 + i * 1.7) * (7 + r() * 12));
    }
    x.stroke();
  }

  // soft drift mottling on top of the ripples
  for (let i = 0; i < 320; i++) {
    const px = r() * 512, py = r() * 512, rad = 10 + r() * 46;
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    const warm = r() > 0.45;
    g.addColorStop(0, warm ? "rgba(255,246,228,0.26)" : "rgba(163,146,180,0.22)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
  }

  // GLITTER — snow at golden hour throws tiny sparks back at the low sun.
  x.globalAlpha = 1;
  for (let i = 0; i < 520; i++) {
    const b = 0.45 + r() * 0.55;
    x.fillStyle = `rgba(255,${Math.round(248 - r() * 20)},${Math.round(230 - r() * 30)},${b})`;
    const sz = r() > 0.9 ? 2.2 : 1.1;
    x.fillRect(r() * 512, r() * 512, sz, sz);
  }
  return finish(c, key, 16);
}

/* ------------------------------------------------------------------ */
/* ICE — the one cool passage, with cracks and banded water beneath     */
/* ------------------------------------------------------------------ */
export function iceTexture(seed = 3): THREE.Texture {
  const key = `ice-${seed}`;
  if (cache.has(key)) return cache.get(key)!;
  const { c, x } = makeCanvas(512);
  const r = rng(seed);

  // banded water beneath the ice
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, css(PALETTE.icePale));
  g.addColorStop(0.35, css(PALETTE.ice));
  g.addColorStop(0.66, css(PALETTE.waterTeal));
  g.addColorStop(1, css(PALETTE.waterDeep));
  x.fillStyle = g; x.fillRect(0, 0, 512, 512);

  // hard bands — quantised, matching the cel language
  for (let b = 0; b < 6; b++) {
    x.globalAlpha = 0.14;
    x.fillStyle = b % 2 ? css(PALETTE.icePale) : css(PALETTE.waterTeal);
    x.fillRect(0, (b / 6) * 512, 512, 512 / 6);
  }
  x.globalAlpha = 1;

  // cracks — branching, drawn in pale ink
  x.strokeStyle = "rgba(255,255,255,0.55)";
  for (let i = 0; i < 16; i++) {
    let px = r() * 512, py = r() * 512;
    let a = r() * Math.PI * 2;
    x.lineWidth = 0.6 + r() * 1.6;
    x.beginPath(); x.moveTo(px, py);
    for (let s = 0; s < 9; s++) {
      a += (r() - 0.5) * 1.1;
      px += Math.cos(a) * (10 + r() * 26);
      py += Math.sin(a) * (10 + r() * 26);
      x.lineTo(px, py);
    }
    x.stroke();
  }
  // frost bloom
  for (let i = 0; i < 70; i++) {
    const px = r() * 512, py = r() * 512, rad = 8 + r() * 30;
    const rg = x.createRadialGradient(px, py, 0, px, py, rad);
    rg.addColorStop(0, "rgba(255,255,255,0.22)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = rg; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
  }
  return finish(c, key, 1);
}

/* ------------------------------------------------------------------ */
/* PARCHMENT — signage, the fold-out map, panels                        */
/* ------------------------------------------------------------------ */
export function parchmentTexture(seed = 5): THREE.Texture {
  const key = `parchment-${seed}`;
  if (cache.has(key)) return cache.get(key)!;
  const { c, x } = makeCanvas(256);
  const r = rng(seed);
  x.fillStyle = css(PALETTE.cream);
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 200; i++) {
    x.globalAlpha = 0.05 + r() * 0.09;
    x.fillStyle = css(mix(PALETTE.cream, PALETTE.walnut, 0.3 + r() * 0.4));
    const px = r() * 256, py = r() * 256;
    x.beginPath(); x.arc(px, py, 2 + r() * 16, 0, Math.PI * 2); x.fill();
  }
  // edge darkening — a page that has been handled
  x.globalAlpha = 1;
  const eg = x.createRadialGradient(128, 128, 60, 128, 128, 180);
  eg.addColorStop(0, "rgba(0,0,0,0)");
  eg.addColorStop(1, "rgba(110,67,38,0.3)");
  x.fillStyle = eg; x.fillRect(0, 0, 256, 256);
  return finish(c, key, 1);
}

/* ------------------------------------------------------------------ */
/* CANVAS STRIPE — awnings, tents, the Piece Parade canopy              */
/* ------------------------------------------------------------------ */
export function stripeTexture(a: number = PALETTE.teal, b: number = PALETTE.cream, bands = 8, seed = 2): THREE.Texture {
  const key = `stripe-${a}-${b}-${bands}`;
  if (cache.has(key)) return cache.get(key)!;
  const { c, x } = makeCanvas(256);
  const r = rng(seed);
  const w = 256 / bands;
  for (let i = 0; i < bands; i++) {
    x.fillStyle = css(i % 2 ? a : b);
    // hand-wobbled stripe edges — not a machine print
    x.beginPath();
    x.moveTo(i * w + (r() - 0.5) * 3, 0);
    x.lineTo((i + 1) * w + (r() - 0.5) * 3, 0);
    x.lineTo((i + 1) * w + (r() - 0.5) * 3, 256);
    x.lineTo(i * w + (r() - 0.5) * 3, 256);
    x.closePath(); x.fill();
  }
  // weave
  x.globalAlpha = 0.07;
  for (let y = 0; y < 256; y += 3) {
    x.fillStyle = y % 6 ? "#000" : "#fff";
    x.fillRect(0, y, 256, 1);
  }
  x.globalAlpha = 1;
  return finish(c, key, 1);
}

/* ------------------------------------------------------------------ */
/* LANTERN GLOW — the warm sprite for lights, fireflies, motes          */
/* ------------------------------------------------------------------ */
export function glowSprite(color: number = PALETTE.lanternCore): THREE.Texture {
  const key = `glow-${color}`;
  if (cache.has(key)) return cache.get(key)!;
  const { c, x } = makeCanvas(128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  const col = css(color);
  g.addColorStop(0, col);
  g.addColorStop(0.18, col + "cc");
  g.addColorStop(0.45, col + "55");
  g.addColorStop(1, col + "00");
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

/* ------------------------------------------------------------------ */
/* BOARD — the chess board top, cream and walnut with painted edges     */
/* ------------------------------------------------------------------ */
export function boardTexture(seed = 13): THREE.Texture {
  const key = `board-${seed}`;
  if (cache.has(key)) return cache.get(key)!;
  const S = 1024, sq = S / 8;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d")!;
  const r = rng(seed);

  for (let ry = 0; ry < 8; ry++) {
    for (let cx = 0; cx < 8; cx++) {
      const light = (cx + ry) % 2 === 0;
      x.fillStyle = css(light ? PALETTE.cream : PALETTE.walnut);
      x.fillRect(cx * sq, ry * sq, sq, sq);
      // per-square grain so the board reads as carved wood, not a checker gif
      x.globalAlpha = 0.09;
      for (let i = 0; i < 14; i++) {
        x.strokeStyle = css(light ? PALETTE.walnutLight : PALETTE.cocoa);
        x.lineWidth = 0.8 + r() * 1.6;
        const gy = ry * sq + r() * sq;
        x.beginPath(); x.moveTo(cx * sq, gy);
        x.lineTo(cx * sq + sq, gy + (r() - 0.5) * 6);
        x.stroke();
      }
      x.globalAlpha = 1;
    }
  }
  // painted ink border around the playing field
  x.strokeStyle = css(PALETTE.ink);
  x.globalAlpha = 0.5; x.lineWidth = 5;
  x.strokeRect(2.5, 2.5, S - 5, S - 5);
  x.globalAlpha = 1;

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

/** Clear every cached texture (used on hot reload). */
export function disposeTextureCache() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
