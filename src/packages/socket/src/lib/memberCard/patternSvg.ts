/**
 * Draws a card pattern as one SVG laid over the banner or the card. Pure, so the
 * settings swatches, the card and scripts/check-member-card-style.mjs share it.
 */

import type { PatternFade } from "./cardStyle.ts";
import { cardPattern } from "./patterns.ts";
import type { Tile } from "./patterns/tileTypes.ts";
import { scatter } from "./scatter.ts";

/** A mark to strew: its SVG body, the box it is drawn in, and whether it is one colour already. */
export interface PatternMark {
  viewBox: string;
  body: string;
  clip?: string;
  /** A single-colour mark takes the ink as its fill; a coloured one is turned to the ink by tone. */
  mono: boolean;
}

export interface PatternDraw {
  /** The ink as `#rrggbb`. */
  ink: string;
  /** 0 to 1. */
  alpha: number;
  /** 1 is the pattern's own size. */
  scale: number;
  rotate: number;
  fade: PatternFade;
  seed: number;
  /** Loaded on demand: a tile's paths, or the mark a scatter pattern strews. */
  tile?: Tile;
  mark?: PatternMark;
}

/** CSS background layers. `base` replaces the plain fill, `image` goes over it. */
export interface PatternLayers {
  base?: string;
  image?: string;
}

const n = (v: number) => String(Math.round(v * 1000) / 1000);

/** A CSS url() for SVG markup. Quotes are escaped too, since the paths use them. */
export function svgUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29")}")`;
}

const FADE_VECTOR: Record<Exclude<PatternFade, "none" | "radial">, [number, number, number, number]> = {
  // From where it is solid to the edge it disappears into.
  top: [0, 1, 0, 0],
  bottom: [0, 0, 0, 1],
  left: [1, 0, 0, 0],
  right: [0, 0, 1, 0],
};

function fadeDefs(fade: PatternFade): string {
  if (fade === "none") return "";
  const stops = "<stop offset='0' stop-color='white'/><stop offset='1' stop-color='black'/>";
  const gradient =
    fade === "radial"
      ? `<radialGradient id='fg' cx='0.5' cy='0.5' r='0.6'>${stops}</radialGradient>`
      : `<linearGradient id='fg' x1='${FADE_VECTOR[fade][0]}' y1='${FADE_VECTOR[fade][1]}' x2='${FADE_VECTOR[fade][2]}' y2='${FADE_VECTOR[fade][3]}'>${stops}</linearGradient>`;
  return `${gradient}<mask id='fm'><rect width='100%' height='100%' fill='url(#fg)'/></mask>`;
}

function wrap(defs: string, content: string, fade: PatternFade): string {
  const mask = fade === "none" ? "" : " mask='url(#fm)'";
  return `<svg xmlns='http://www.w3.org/2000/svg'><defs>${defs}${fadeDefs(fade)}</defs><g${mask}>${content}</g></svg>`;
}

const fillAll = (id: string) => `<rect width='100%' height='100%' fill='url(#${id})'/>`;

function classic(id: string, d: PatternDraw): string | null {
  const paint = `fill='${d.ink}' fill-opacity='${n(d.alpha)}'`;
  if (id === "dots") {
    const defs =
      `<pattern id='p' patternUnits='userSpaceOnUse' width='11' height='11' patternTransform='rotate(${n(d.rotate)}) scale(${n(d.scale)})'>` +
      `<circle cx='5.5' cy='5.5' r='1.7' ${paint}/></pattern>`;
    return wrap(defs, fillAll("p"), d.fade);
  }
  if (id === "weave") {
    const band = (pid: string, turn: number) =>
      `<pattern id='${pid}' patternUnits='userSpaceOnUse' width='12' height='12' patternTransform='rotate(${n(turn + d.rotate)}) scale(${n(d.scale)})'>` +
      `<rect width='2' height='12' ${paint}/></pattern>`;
    return wrap(band("a", 45) + band("b", -45), fillAll("a") + fillAll("b"), d.fade);
  }
  if (id === "contours") {
    const step = 10.5 * d.scale;
    const rings = Array.from({ length: 70 }, (_, i) => `<circle cx='78%' cy='130%' r='${n(9.75 * d.scale + i * step)}'/>`).join("");
    const content = `<g fill='none' stroke='${d.ink}' stroke-opacity='${n(d.alpha)}' stroke-width='${n(1.5 * d.scale)}'>${rings}</g>`;
    return wrap("", content, d.fade);
  }
  return null;
}

function tile(t: Tile, d: PatternDraw): string {
  const scale = (t.tile / t.width) * d.scale;
  const body = t.layers
    .map((path, i) => {
      // A second layer is the figure's shadow upstream, so it is drawn quieter.
      const a = n(d.alpha * (i === 0 ? 1 : 0.6));
      const paint =
        t.mode === "fill"
          ? `fill='${d.ink}' fill-opacity='${a}' stroke='none'`
          : `fill='none' stroke='${d.ink}' stroke-opacity='${a}' stroke-width='${t.stroke}'` +
            (t.mode === "round" ? ` stroke-linejoin='round' stroke-linecap='round'` : "");
      return path.replace(/\/>\s*$/, ` ${paint}/>`);
    })
    .join("");
  const defs =
    `<pattern id='p' patternUnits='userSpaceOnUse' width='${t.width}' height='${t.height}' ` +
    `patternTransform='rotate(${n(d.rotate)}) scale(${n(scale)})'>${body}</pattern>`;
  return wrap(defs, fillAll("p"), d.fade);
}

/** The ink as three channels, 0 to 1, for the tone filter. */
function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** How big a scattered mark is drawn at 100%, in CSS pixels. */
export const MARK_SIZE = 34;

function strew(mark: PatternMark, d: PatternDraw): string {
  const [r, g, b] = channels(d.ink);
  // Every pixel takes the ink; light parts come through strongest, so eyes and beak still read.
  const tone = mark.mono
    ? ""
    : `<filter id='t' color-interpolation-filters='sRGB'><feColorMatrix type='matrix' values='0 0 0 0 ${n(r)} 0 0 0 0 ${n(g)} 0 0 0 0 ${n(b)} 0.45 0.9 0.15 0.3 -0.2'/></filter>`;
  const clip = mark.clip ? `<clipPath id='c'>${mark.clip}</clipPath>` : "";
  const symbol = `<symbol id='m' viewBox='${mark.viewBox}'><g${mark.clip ? " clip-path='url(#c)'" : ""}>${mark.body}</g></symbol>`;
  const uses = scatter(d.seed, MARK_SIZE * d.scale, d.rotate)
    .map(
      (m) =>
        `<use href='#m' width='${n(m.size)}' height='${n(m.size)}' ` +
        `transform='translate(${n(m.x - m.size / 2)} ${n(m.y - m.size / 2)}) rotate(${n(m.turn)} ${n(m.size / 2)} ${n(m.size / 2)})'/>`,
    )
    .join("");
  const paint = mark.mono ? ` fill='${d.ink}'` : " filter='url(#t)'";
  return wrap(`${tone}${clip}${symbol}`, `<g opacity='${n(d.alpha)}'${paint}>${uses}</g>`, d.fade);
}

/** The layers for pattern `id`, with CSS variables standing in for the card's own colours. */
export function patternLayers(id: string, d: PatternDraw, css: { owl: string; accent: string; surface: string }): PatternLayers {
  const pattern = cardPattern(id);
  if (pattern.kind === "base") {
    if (pattern.id === "gradient") return { base: `linear-gradient(135deg, ${css.owl} 10%, color-mix(in oklch, ${css.accent} 60%, ${css.surface}))` };
    return {
      base: `linear-gradient(180deg, ${css.owl} 0%, color-mix(in oklch, ${css.owl} 45%, ${css.surface}) 72%, ${css.surface} 100%)`,
    };
  }
  if (pattern.kind === "svg") {
    const svg = classic(pattern.id, d);
    return svg ? { image: svgUrl(svg) } : {};
  }
  if (pattern.kind === "tile" && d.tile?.id === pattern.id) return { image: svgUrl(tile(d.tile, d)) };
  if (pattern.kind === "scatter" && d.mark) return { image: svgUrl(strew(d.mark, d)) };
  return {};
}
