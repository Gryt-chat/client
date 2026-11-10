import { flat, useFrame, W } from "./stage";

let typedAt = -1e9;
/** Typing holds the caret solid, the way a real one stops blinking under the keys. */
export const typed = () => { typedAt = performance.now(); };

const pad = (cs: CSSStyleDeclaration) => parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
const ruler = document.createElement("canvas").getContext("2d")!;

/** Where the caret is on the page, or null when nothing editable has focus. */
function caretRect(): DOMRect | null {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    ruler.font = cs.font;
    const k = r.width / el.offsetWidth;
    const x = r.left + (pad(cs) + ruler.measureText(el.value.slice(0, el.selectionStart ?? el.value.length)).width - el.scrollLeft) * k;
    const h = parseFloat(cs.fontSize) * 1.25 * k;
    return new DOMRect(Math.min(x, r.right - 4 * k), r.top + (r.height - h) / 2, 0, h);
  }
  if (!(el instanceof HTMLElement) || !el.isContentEditable) return null;
  const sel = getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const rect = range.getClientRects()[0];
  if (rect) return rect;
  // An empty line has no rects; the paragraph it sits in has the line box.
  const host = (range.startContainer instanceof HTMLElement ? range.startContainer : range.startContainer.parentElement)!;
  const r = host.getBoundingClientRect(), cs = getComputedStyle(host);
  const h = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
  return new DOMRect(r.left + pad(cs), r.top, 0, h * (r.width / host.offsetWidth));
}

/** The text caret, drawn on the film clock: the browser's own blinks on wall time, which a render runs far slower than. */
export function Caret() {
  useFrame();
  const t = performance.now();
  const r = flat(caretRect), stage = flat(() => document.getElementById("stage")?.getBoundingClientRect());
  if (!r || !stage) return null;
  const on = t - typedAt < 500 || Math.floor((t - typedAt) / 530) % 2 === 0;
  const k = stage.width / W;
  return <div style={{ position: "absolute", left: (r.left - stage.left) / k, top: (r.top - stage.top) / k, width: 2 / k, height: r.height / k, background: "var(--gryt-text, #fff)", opacity: on ? 1 : 0, zIndex: 46, pointerEvents: "none" }} />;
}
