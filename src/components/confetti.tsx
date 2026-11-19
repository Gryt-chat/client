import type { CSSProperties } from "react";

const COLORS = ["var(--gryt-accent-9)", "var(--gryt-warning-11)", "var(--gryt-danger-11)", "var(--gryt-success-11)", "var(--gryt-accent-11)", "#7dd3fc"];
const PIECES = Array.from({ length: 28 }, (_, i) => {
  const r = (n: number) => (Math.sin(i * 97.13 + n * 13.7) + 1) / 2;
  return { dx: Math.round(r(1) * 440 - 220), dy: Math.round(-40 - r(2) * 150), rot: Math.round(r(3) * 1000 - 500), w: [6, 8, 10][i % 3], h: [6, 10, 14][(i * 7) % 3], c: COLORS[i % COLORS.length], delay: (r(4) * 0.25).toFixed(2) };
});

/** A burst behind whatever sits next to it; place it inside a relatively positioned box. */
export function Confetti() {
  return (
    <span className="gryt-confetti" aria-hidden>
      {PIECES.map((p, i) => (
        <i key={i} style={{ "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, "--r": `${p.rot}deg`, width: p.w, height: p.h, background: p.c, animationDelay: `${p.delay}s` } as CSSProperties} />
      ))}
    </span>
  );
}
