import { useEffect, useState } from "react";

/** Everything runs this much faster than the numbers in the script say. */
export const TEMPO = 0.85;

export const W = 1920;
export const H = 1080;

export const ease = {
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 4),
  in: (t: number) => t * t * t,
  expo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  // A soft overshoot that settles, for things landing in place.
  spring: (t: number) => (t >= 1 ? 1 : 1 - Math.exp(-6.5 * t) * Math.cos(8.5 * t)),
  linear: (t: number) => t,
};

type Tween = { from: number; to: number; start: number; dur: number; e: (t: number) => number };
const values = new Map<string, number>();
const tweens = new Map<string, Tween>();

export function get(key: string, fallback = 0): number {
  const tw = tweens.get(key);
  if (!tw) return values.get(key) ?? fallback;
  const p = Math.min(1, Math.max(0, (performance.now() - tw.start) / tw.dur));
  const v = tw.from + (tw.to - tw.from) * tw.e(p);
  if (p >= 1) {
    values.set(key, tw.to);
    tweens.delete(key);
  }
  return v;
}

export function set(key: string, v: number) {
  tweens.delete(key);
  values.set(key, v);
}

export function to(key: string, v: number, dur = 900, e = ease.inOut, fallback = 0) {
  tweens.set(key, { from: get(key, fallback), to: v, start: performance.now(), dur: dur * TEMPO, e });
}

export function toMany(target: Record<string, number>, dur = 900, e = ease.inOut) {
  for (const [k, v] of Object.entries(target)) to(k, v, dur, e);
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms * TEMPO));

/** A pause on a result, for the viewer to take it in. Not sped up by TEMPO. */
export const hold = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Re-renders every frame, for anything reading get(). */
export function useFrame() {
  const [, tick] = useState(0);
  useEffect(() => {
    let id = 0;
    const loop = () => {
      tick((x) => x + 1);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
}

// Deterministic jitter, so typing rhythm is the same in every render.
let seed = 7;
export function rand() {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}

let stageScale = 1;
export const setStageScale = (s: number) => (stageScale = s);

/** An element's centre in stage pixels, through every 3D transform above it. */
export type Boxed = { getBoundingClientRect(): DOMRect };

/**
 * Measures with the page's 3D tilt switched off for the moment. The cursor and owl tilt along with everything else,
 * so flat coordinates are the ones they need, and measuring a tilted box would only give its bounding trapezoid.
 */
export function flat<T>(read: () => T): T {
  const b = document.body;
  const was = b.style.transform;
  b.style.transform = "none";
  try { return read(); } finally { b.style.transform = was; }
}

export function centerOf(el: Boxed, dx = 0.5, dy = 0.5) {
  const [r, stage] = flat(() => [el.getBoundingClientRect(), document.getElementById("stage")!.getBoundingClientRect()]);
  return { x: (r.left - stage.left + r.width * dx) / stageScale, y: (r.top - stage.top + r.height * dy) / stageScale };
}

/** Polls until `find` stops throwing, so a step never races the UI it waits on. */
export async function until<T>(find: () => T, ms = 4000): Promise<T> {
  const end = performance.now() + ms;
  for (;;) {
    try { return find(); } catch (e) { if (performance.now() > end) throw e; }
    await new Promise((r) => setTimeout(r, 50));
  }
}

export function $(sel: string, root: ParentNode | null = document): HTMLElement {
  if (!root) throw new Error(`motion: no root for ${sel}`);
  const el = root.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`motion: nothing matches ${sel}`);
  return el;
}

export function byText(text: string, root: ParentNode | null = document, tag = "*"): HTMLElement {
  if (!root) throw new Error(`motion: no root for "${text}"`);
  for (const el of root.querySelectorAll<HTMLElement>(tag)) {
    if (el.childElementCount === 0 && el.textContent?.trim() === text) return el;
  }
  for (const el of root.querySelectorAll<HTMLElement>(tag)) {
    if (el.textContent?.trim() === text) return el;
  }
  throw new Error(`motion: no element reads "${text}"`);
}
