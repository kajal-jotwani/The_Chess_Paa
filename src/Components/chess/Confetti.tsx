"use client";

import { useEffect, useRef } from "react";

/** Fire the park confetti cannon from anywhere. */
export function fireConfetti(power: "small" | "big" = "big") {
  try {
    window.dispatchEvent(new CustomEvent("chesspaa:confetti", { detail: { power } }));
  } catch {}
}

const COLORS = ["#facc15", "#ef4444", "#25A9B4", "#ec4899", "#8b5cf6", "#22c55e", "#f59e0b"];

interface Bit {
  x: number; y: number; vx: number; vy: number;
  w: number; h: number; rot: number; vr: number;
  color: string; life: number;
}

/** Full-screen, pointer-transparent confetti layer. Mount once per page. */
export default function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bitsRef = useRef<Bit[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth * devicePixelRatio;
      canvas.height = window.innerHeight * devicePixelRatio;
    };
    resize();
    window.addEventListener("resize", resize);

    const spawn = (e: Event) => {
      const power = (e as CustomEvent).detail?.power === "small" ? 60 : 160;
      const W = canvas.width;
      for (let i = 0; i < power; i++) {
        bitsRef.current.push({
          x: W / 2 + (Math.random() - 0.5) * W * 0.6,
          y: canvas.height + 10,
          vx: (Math.random() - 0.5) * 14 * devicePixelRatio,
          vy: -(12 + Math.random() * 14) * devicePixelRatio,
          w: (6 + Math.random() * 6) * devicePixelRatio,
          h: (8 + Math.random() * 8) * devicePixelRatio,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          life: 140 + Math.random() * 60,
        });
      }
      if (!rafRef.current) tick();
    };

    const tick = () => {
      const bits = bitsRef.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const b of bits) {
        b.x += b.vx;
        b.y += b.vy;
        b.vy += 0.35 * devicePixelRatio;
        b.vx *= 0.99;
        b.rot += b.vr;
        b.life -= 1;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.globalAlpha = Math.max(0, Math.min(1, b.life / 60));
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      }
      bitsRef.current = bits.filter((b) => b.life > 0 && b.y < canvas.height + 60);
      if (bitsRef.current.length) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        rafRef.current = 0;
      }
    };

    window.addEventListener("chesspaa:confetti", spawn);
    return () => {
      window.removeEventListener("chesspaa:confetti", spawn);
      window.removeEventListener("resize", resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 90,
      }}
    />
  );
}
