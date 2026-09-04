import { getElectronAPI } from "./electron";

/**
 * Keep the native window controls in the app's colours (GRYT-288). On Windows
 * and Linux they are drawn by the OS into an overlay strip the stylesheet
 * cannot reach, set once when the window was built — so a light theme left
 * three dark buttons in the corner. macOS ignores this.
 */

/** The two tokens the titlebar itself paints with. Kept in step with titlebar.tsx. */
const BACKGROUND_VAR = "--gryt-neutral-1";
const SYMBOL_VAR = "--gryt-neutral-12";

let probe: CanvasRenderingContext2D | null = null;

function getProbe(): CanvasRenderingContext2D | null {
  if (probe) return probe;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  // `copy` rather than the default, so a value that carries alpha replaces the
  // pixel instead of blending with whatever the last read left behind. Both
  // tokens read here are opaque, but a theme is somebody else's file.
  ctx.globalCompositeOperation = "copy";
  probe = ctx;
  return ctx;
}

/**
 * A CSS custom property as `#rrggbb`.
 *
 * Via a canvas pixel rather than by reading the string back, because the string
 * is whatever the theme author wrote — `oklch()`, `color()` and plain colour
 * names all serialise differently, and Electron throws on anything it cannot
 * parse. Painting one pixel and reading it back gives sRGB bytes.
 */
function resolveToHex(variable: string): string | null {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  if (!raw) return null;

  const ctx = getProbe();
  if (!ctx) return null;

  // fillStyle silently keeps its old value when handed something it cannot
  // parse, so a sentinel is the only way to notice.
  ctx.fillStyle = "#000000";
  ctx.fillStyle = raw;
  if (ctx.fillStyle === "#000000" && raw !== "#000000" && raw !== "black") {
    return null;
  }

  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * Send the current titlebar colours to the main process.
 *
 * Call after the theme variables are on the root element, not before — this
 * reads what they evaluate to right now. Does nothing outside Electron, and
 * nothing on a build whose preload predates the bridge.
 */
export function pushTitlebarOverlay(): void {
  const api = getElectronAPI();
  if (!api?.setTitlebarOverlay) return;

  const color = resolveToHex(BACKGROUND_VAR);
  const symbolColor = resolveToHex(SYMBOL_VAR);
  // Leaving the buttons on their old colours is better than sending half a
  // pair and getting a light background with light symbols on it.
  if (!color || !symbolColor) return;

  api.setTitlebarOverlay({ color, symbolColor });
}
