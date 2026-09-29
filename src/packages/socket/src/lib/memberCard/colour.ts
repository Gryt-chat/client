/**
 * The member card's colours, worked out from what the member picked. Ported from the
 * approved B4b mockup, so the numbers match it; scripts/check-card-colour.mjs checks them.
 */

export interface CardColourPick {
  mode: "solid" | "gradient";
  c1: string;
  c2: string;
  angle: number;
}

export interface Oklch {
  L: number;
  C: number;
  H: number;
}

/** sRGB hex to OKLCH. */
export function oklch(hex: string): Oklch {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
  const m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
  const s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C: Math.sqrt(A * A + B * B), H };
}

/** OKLCH to sRGB, clipped to the gamut, each channel 0 to 1 and still linear. */
export function okToRgb(L: number, C: number, H: number): [number, number, number] {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));
  return [rgb[0], rgb[1], rgb[2]];
}

/** WCAG relative luminance of a linear sRGB triple. */
export const lum = (rgb: readonly number[]): number => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

export const contrast = (y1: number, y2: number): number => (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05);

export function hexOf(rgb: readonly number[]): string {
  return (
    "#" +
    rgb
      .map((v) => {
        const x = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
        return Math.round(Math.min(1, Math.max(0, x)) * 255)
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}

/** sRGB hex to gamma-encoded channels, 0 to 1. */
const gamma = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** `top` over `under` at `alpha`, blended in sRGB the way a browser composites it. */
export function blend(under: string, top: string, alpha: number): string {
  const a = gamma(under);
  const b = gamma(top);
  return hexOf(a.map((v, i) => toLinear(v * (1 - alpha) + b[i] * alpha)));
}

/** Luminance of a hex colour. */
export const lumOf = (hex: string): number => lum(gamma(hex).map(toLinear));

/** The game band lays the ink over the card at this strength; muted text sits on it. */
export const BAND_OVERLAY = 0.07;

/** Moves one colour's lightness a step at a time until `ok` passes. */
function settle(k: Oklch, dark: boolean, ok: (hex: string) => boolean, from = k.L) {
  let L = from;
  const C = Math.min(k.C, 0.2);
  for (let i = 0; i < 100; i++) {
    if (ok(hexOf(okToRgb(L, C, k.H)))) break;
    L = dark ? Math.min(0.995, L + 0.01) : Math.max(0.02, L - 0.01);
  }
  const rgb = okToRgb(L, C, k.H);
  return { hex: hexOf(rgb), L, moved: Math.abs(L - k.L), y: lum(rgb) };
}

/** The ink pairs a card can carry, as OKLCH lightness and chroma at the card's hue. */
export const CARD_INKS = {
  dark: { ink: [0.2, 0.02], muted: [0.38, 0.03] },
  light: { ink: [0.99, 0.005], muted: [0.86, 0.02] },
} as const;

/** Muted small text at 4.5:1, with room for a pattern laid over the card. */
export const CARD_CONTRAST_TARGET = 5;

/** Muted text on the game band, which has no pattern under it. */
export const BAND_CONTRAST_TARGET = 4.6;

export interface FullCardColours {
  /** Dark ink on a light card. */
  dark: boolean;
  hue: number;
  ink: string;
  muted: string;
  bg: string;
  mid: string;
  raw: string;
  /** The lowest contrast of muted text on either end of the card. */
  worst: number;
  /** The settled ends, as hex, for tests and the preview. */
  ends: [string, string];
  inkHex: string;
  mutedHex: string;
}

/** The whole card in the member's colours: picks the ink that moves the pick least. */
export function fullColours(col: CardColourPick): FullCardColours {
  const k1 = oklch(col.c1);
  const k2 = oklch(col.mode === "gradient" ? col.c2 : col.c1);
  const H = k1.C < 0.02 && k2.C >= 0.02 ? k2.H : k1.H;
  const tryInk = (dark: boolean) => {
    const d = CARD_INKS[dark ? "dark" : "light"];
    const inkHex = hexOf(okToRgb(d.ink[0], d.ink[1], H));
    const mutedY = lum(okToRgb(d.muted[0], d.muted[1], H));
    // The card and the game band on it, which lays the ink over the card and costs contrast.
    const ok = (hex: string) =>
      contrast(lumOf(hex), mutedY) >= CARD_CONTRAST_TARGET &&
      contrast(lumOf(blend(hex, inkHex, BAND_OVERLAY)), mutedY) >= BAND_CONTRAST_TARGET;
    let a = settle(k1, dark, ok);
    let b = settle(k2, dark, ok);
    // A gradient's middle is a colour too, and text lands on it; nudge both ends until it passes.
    for (let i = 0; i < 100 && !ok(blend(a.hex, b.hex, 0.5)); i++) {
      const step = dark ? 0.01 : -0.01;
      a = settle(k1, dark, () => true, Math.min(0.995, Math.max(0.02, a.L + step)));
      b = settle(k2, dark, () => true, Math.min(0.995, Math.max(0.02, b.L + step)));
    }
    a = { ...a, moved: Math.abs(a.L - k1.L) };
    b = { ...b, moved: Math.abs(b.L - k2.L) };
    return { dark, a, b, cost: a.moved + b.moved, d };
  };
  const pickD = tryInk(true);
  const pickL = tryInk(false);
  const r = pickD.cost <= pickL.cost ? pickD : pickL;
  const css = (v: readonly number[]) => "oklch(" + (v[0] * 100).toFixed(1) + "% " + v[1] + " " + H.toFixed(1) + ")";
  const grad = col.mode === "gradient";
  const mutedY = lum(okToRgb(r.d.muted[0], r.d.muted[1], H));
  const mid = blend(r.a.hex, r.b.hex, 0.5);
  return {
    dark: r.dark,
    hue: Math.round(H),
    ink: css(r.d.ink),
    muted: css(r.d.muted),
    bg: grad ? "linear-gradient(" + col.angle + "deg, " + r.a.hex + ", " + r.b.hex + ")" : r.a.hex,
    mid: grad ? mid : r.a.hex,
    raw: grad
      ? "linear-gradient(" + col.angle + "deg, " + col.c1 + ", " + col.c2 + ")"
      : "linear-gradient(" + col.c1 + ", " + col.c1 + ")",
    worst: Math.min(contrast(r.a.y, mutedY), contrast(r.b.y, mutedY), contrast(lumOf(mid), mutedY)),
    ends: [r.a.hex, r.b.hex],
    inkHex: hexOf(okToRgb(r.d.ink[0], r.d.ink[1], H)),
    mutedHex: hexOf(okToRgb(r.d.muted[0], r.d.muted[1], H)),
  };
}

const bandCss = (k: Oklch, L: number) =>
  "oklch(" + (L * 100).toFixed(1) + "% " + Math.min(k.C, 0.2).toFixed(3) + " " + k.H.toFixed(1) + ")";

export interface BandColours {
  hue: number;
  base: string;
  bandBg: string;
  band: string;
  ink: string;
  btnInk: string;
  pat: string;
  /** The clamped band ends, as OKLCH lightness, for tests. */
  bandL: [number, number];
  darkInk: boolean;
}

/** Colour on the banner and band only. Dark ink from L 0.62, the band held about 4.5:1. */
export function bandColours(col: CardColourPick): BandColours {
  const c1 = col.c1;
  const c2 = col.mode === "gradient" ? col.c2 : col.c1;
  const k1 = oklch(c1);
  const k2 = oklch(c2);
  const dark = (k1.L + k2.L) / 2 >= 0.62;
  const clamp = (L: number) => (dark ? Math.max(L, 0.74) : Math.min(L, 0.5));
  const b1 = bandCss(k1, clamp(k1.L));
  const b2 = bandCss(k2, clamp(k2.L));
  const ink = dark ? "oklch(20% 0.02 " + k1.H.toFixed(1) + ")" : "oklch(98.5% 0.008 " + k1.H.toFixed(1) + ")";
  const grad = col.mode === "gradient";
  const rawDark = (k1.L + k2.L) / 2 >= 0.6;
  return {
    hue: Math.round(k1.C < 0.02 && k2.C >= 0.02 ? k2.H : k1.H),
    base: grad ? "linear-gradient(" + col.angle + "deg, " + c1 + ", " + c2 + ")" : "linear-gradient(" + c1 + ", " + c1 + ")",
    bandBg: grad ? "linear-gradient(" + col.angle + "deg, " + b1 + ", " + b2 + ")" : b1,
    band: grad ? "color-mix(in oklab, " + b1 + ", " + b2 + ")" : b1,
    ink,
    btnInk: b1,
    pat: rawDark ? "oklch(20% 0.02 " + k1.H.toFixed(1) + " / 0.28)" : "oklch(98% 0.01 " + k1.H.toFixed(1) + " / 0.3)",
    bandL: [clamp(k1.L), clamp(k2.L)],
    darkInk: dark,
  };
}

/** The owl's colour as a gentle gradient: its own tile colour into a darker step of it. */
export function owlGradient(hex: string): CardColourPick {
  const k = oklch(hex);
  return { mode: "gradient", c1: hex, c2: hexOf(okToRgb(Math.max(0.05, k.L - 0.14), k.C, k.H)), angle: 160 };
}
