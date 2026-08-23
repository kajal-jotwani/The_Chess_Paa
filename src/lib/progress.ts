"use client";

/**
 * Park progress, kept simply in the browser: tickets earned on rides,
 * stars per attraction. (A future version can sync this to the database —
 * the auth + Prisma plumbing already exists.)
 */

const TICKETS = "chesspaa:tickets";

function read(key: string): number {
  try { return parseInt(localStorage.getItem(key) ?? "0", 10) || 0; } catch { return 0; }
}
function write(key: string, v: number) {
  try { localStorage.setItem(key, String(v)); } catch {}
  try { window.dispatchEvent(new CustomEvent("chesspaa:progress")); } catch {}
}

export function tickets(): number { return read(TICKETS); }
export function addTickets(n: number): number {
  const t = read(TICKETS) + n;
  write(TICKETS, t);
  return t;
}

export function stars(ride: string): number { return read(`chesspaa:stars:${ride}`); }
export function addStars(ride: string, n: number): number {
  const s = read(`chesspaa:stars:${ride}`) + n;
  write(`chesspaa:stars:${ride}`, s);
  return s;
}

export function best(ride: string): number { return read(`chesspaa:best:${ride}`); }
export function setBest(ride: string, v: number): boolean {
  if (v > best(ride)) { write(`chesspaa:best:${ride}`, v); return true; }
  return false;
}
