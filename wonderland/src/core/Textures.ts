import * as THREE from "three";

/** Procedural canvas textures: stripes, signs, glows, clouds, ground masks. */

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function toTexture(c: HTMLCanvasElement, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const cache = new Map<string, THREE.Texture>();
function memo(key: string, make: () => THREE.Texture) {
  let t = cache.get(key);
  if (!t) { t = make(); cache.set(key, t); }
  return t;
}

export function stripes(a: string, b: string, count = 12, vertical = true, size = 512) {
  return memo(`stripes:${a}:${b}:${count}:${vertical}`, () => {
    const [c, ctx] = canvas(size, size);
    const w = size / count;
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = i % 2 ? b : a;
      if (vertical) ctx.fillRect(i * w, 0, w + 1, size); else ctx.fillRect(0, i * w, size, w + 1);
    }
    // gentle fabric noise
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 10; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
    ctx.putImageData(img, 0, 0);
    return toTexture(c);
  });
}

export function checker(a: string, b: string, n = 8, size = 512) {
  return memo(`checker:${a}:${b}:${n}`, () => {
    const [c, ctx] = canvas(size, size);
    const w = size / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { ctx.fillStyle = (x + y) % 2 ? b : a; ctx.fillRect(x * w, y * w, w, w); }
    return toTexture(c);
  });
}

export interface SignOpts { w?: number; h?: number; bg?: string; fg?: string; border?: string; font?: string; size?: number; emoji?: string; sub?: string; }
export function sign(text: string, o: SignOpts = {}) {
  const w = o.w ?? 1024, h = o.h ?? 256;
  return memo(`sign:${text}:${JSON.stringify(o)}`, () => {
    const [c, ctx] = canvas(w, h);
    ctx.fillStyle = o.bg ?? "#fff3d6";
    roundRect(ctx, 0, 0, w, h, h * 0.18); ctx.fill();
    if (o.border) { ctx.lineWidth = h * 0.06; ctx.strokeStyle = o.border; roundRect(ctx, h * 0.03, h * 0.03, w - h * 0.06, h - h * 0.06, h * 0.16); ctx.stroke(); }
    ctx.fillStyle = o.fg ?? "#3b2a1a";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const size = o.size ?? Math.min(h * 0.55, (w * 1.6) / Math.max(4, text.length));
    ctx.font = `800 ${size}px ${o.font ?? '"Baloo 2", "Fredoka", sans-serif'}`;
    const yy = o.sub ? h * 0.42 : h * 0.5;
    ctx.fillText((o.emoji ? o.emoji + " " : "") + text, w / 2, yy);
    if (o.sub) { ctx.font = `600 ${size * 0.45}px ${o.font ?? '"Fredoka", sans-serif'}`; ctx.fillStyle = "#8a6a45"; ctx.fillText(o.sub, w / 2, h * 0.78); }
    const t = toTexture(c, true, false);
    return t;
  });
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function glow(color = "#ffffff", size = 128) {
  return memo(`glow:${color}`, () => {
    const [c, ctx] = canvas(size, size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, color); g.addColorStop(0.35, color + "aa"); g.addColorStop(1, color + "00");
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    return toTexture(c, true, false);
  });
}

export function cloud(size = 256) {
  return memo(`cloud`, () => {
    const [c, ctx] = canvas(size, size);
    ctx.clearRect(0, 0, size, size);
    const puffs = [[0.5, 0.55, 0.28], [0.32, 0.6, 0.2], [0.68, 0.6, 0.22], [0.42, 0.45, 0.2], [0.6, 0.45, 0.18], [0.5, 0.68, 0.22]];
    for (const [x, y, r] of puffs) {
      const g = ctx.createRadialGradient(x * size, y * size, 0, x * size, y * size, r * size);
      g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(0.6, "rgba(255,255,255,0.8)"); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x * size, y * size, r * size, 0, Math.PI * 2); ctx.fill();
    }
    return toTexture(c, true, false);
  });
}

/** Ground blend mask: R = sand/plaza, painted via a callback with the canvas in world metres. */
export function groundMask(sizeM: number, px: number, paint: (ctx: CanvasRenderingContext2D, toPx: (x: number, z: number) => [number, number], scale: number) => void) {
  const [c, ctx] = canvas(px, px);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, px, px);
  const scale = px / sizeM;
  const toPx = (x: number, z: number): [number, number] => [(x + sizeM / 2) * scale, (z + sizeM / 2) * scale];
  paint(ctx, toPx, scale);
  const t = toTexture(c, false, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function boardLabels(size = 1024) {
  return memo("boardLabels", () => {
    const [c, ctx] = canvas(size, size);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "rgba(255,240,210,0.9)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `700 ${size * 0.035}px "Fredoka", sans-serif`;
    const files = "abcdefgh"; const cell = size * 0.8 / 8; const m = size * 0.1;
    for (let i = 0; i < 8; i++) {
      ctx.fillText(files[i], m + cell * (i + 0.5), size - m * 0.5);
      ctx.fillText(String(8 - i), m * 0.5, m + cell * (i + 0.5));
    }
    return toTexture(c, true, false);
  });
}

/** A plaid/gingham for ChessPaa's shirt if we ever need it on the JS side. */
export function plaid(base = "#d6ec9f", line = "#6bab4c") {
  return memo(`plaid:${base}`, () => {
    const [c, ctx] = canvas(256, 256);
    ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = line;
    for (let i = 0; i < 256; i += 40) { ctx.fillRect(i, 0, 5, 256); ctx.fillRect(0, i, 256, 5); }
    ctx.fillStyle = "#f3fbe6";
    for (let i = 20; i < 256; i += 40) { ctx.fillRect(i, 0, 2, 256); ctx.fillRect(0, i, 256, 2); }
    return toTexture(c);
  });
}

/** Tileable water normal map from summed sine waves (no download needed). */
export function waterNormals(size = 512) {
  return memo("waterNormals", () => {
    const [c, ctx] = canvas(size, size);
    const img = ctx.createImageData(size, size);
    const waves = [[3, 1, 0.9, 0.3], [-2, 4, 0.7, 1.9], [6, -3, 0.35, 4.1], [-8, -7, 0.25, 2.7], [11, 5, 0.18, 0.4], [-14, 9, 0.12, 5.2]];
    const h = (x: number, y: number) => {
      let v = 0;
      for (const [fx, fy, a, ph] of waves) v += a * Math.sin((fx * x + fy * y) * Math.PI * 2 + ph);
      return v;
    };
    const eps = 1 / size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const dx = (h(u + eps, v) - h(u - eps, v)) / (2 * eps) * 0.02;
      const dy = (h(u, v + eps) - h(u, v - eps)) / (2 * eps) * 0.02;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c, false, true);
  });
}

/** Low-frequency value noise (tileable) to break up texture repetition. */
export function macroNoise(size = 256) {
  return memo("macroNoise", () => {
    const [c, ctx] = canvas(size, size);
    const img = ctx.createImageData(size, size);
    const grid = 8; const cells: number[] = [];
    for (let i = 0; i < grid * grid; i++) cells.push(Math.random());
    const at = (gx: number, gy: number) => cells[((gy + grid) % grid) * grid + ((gx + grid) % grid)];
    const sm = (t: number) => t * t * (3 - 2 * t);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = (x / size) * grid, fy = (y / size) * grid;
      const gx = Math.floor(fx), gy = Math.floor(fy), tx = sm(fx - gx), ty = sm(fy - gy);
      const v = (at(gx, gy) * (1 - tx) + at(gx + 1, gy) * tx) * (1 - ty) + (at(gx, gy + 1) * (1 - tx) + at(gx + 1, gy + 1) * tx) * ty;
      const i = (y * size + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c, false, true);
  });
}

/** A cluster of painted leaves with alpha, for tree canopy cards. */
export function leafCluster(hue = 0.3, size = 256) {
  return memo(`leaf:${hue}`, () => {
    const [c, ctx] = canvas(size, size);
    ctx.clearRect(0, 0, size, size);
    const r = rnd(hue * 1000 + 7);
    for (let i = 0; i < 170; i++) {
      const x = size * (0.5 + (r() - 0.5) * 0.92), y = size * (0.5 + (r() - 0.5) * 0.92);
      const d = Math.hypot(x - size / 2, y - size / 2) / (size / 2);
      if (d > 0.98) continue;
      const len = 10 + r() * 16, w = 5 + r() * 6, a = r() * Math.PI * 2;
      const l = 0.28 + r() * 0.26 - d * 0.1;
      ctx.fillStyle = `hsl(${(hue + (r() - 0.5) * 0.06) * 360}, ${52 + r() * 25}%, ${l * 100}%)`;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len / 2, -w, len, 0); ctx.quadraticCurveTo(len / 2, w, 0, 0); ctx.fill();
      ctx.restore();
    }
    const t = toTexture(c, true, false);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}
function rnd(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
