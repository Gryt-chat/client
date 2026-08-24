/* eslint-env node */

/**
 * Reading the drawable things out of an SVG.
 *
 * A drawing tool does not only emit `<path>`. A rounded rectangle stays a
 * `<rect>`, a dot stays a `<circle>`, and a line drawn with the pen tool comes
 * out as a `<path>` with a `stroke` and no fill at all. An extractor that only
 * knows about filled paths drops the first two on the floor and turns the third
 * into a solid blob — all three silently, which is the part that matters. The
 * winter jacket arrived with two stroked seams and a `<rect>` for the zip pull,
 * and every one of those failures happened before this file existed.
 *
 * So: everything is converted to path data, stroke properties are carried
 * through, and anything not understood is reported rather than skipped.
 */

/** Kappa: the handle length that turns four cubics into a circle. */
const K = 0.5522847498307936;

function attr(attrs, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : undefined;
}

function num(attrs, name, fallback = 0) {
  const v = attr(attrs, name);
  return v === undefined ? fallback : Number(v);
}

function round(n) {
  return Number(n.toFixed(3));
}

/**
 * A rectangle as path data, corners included.
 *
 * Cubics rather than arcs, because the simplifier's parser refuses arcs — and
 * it refuses them on purpose, so this converts rather than making it guess.
 */
export function rectPath(attrs) {
  const x = num(attrs, "x");
  const y = num(attrs, "y");
  const w = num(attrs, "width");
  const h = num(attrs, "height");
  let rx = num(attrs, "rx", num(attrs, "ry"));
  let ry = num(attrs, "ry", rx);
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);

  if (rx <= 0 || ry <= 0) {
    return `M${round(x)} ${round(y)}H${round(x + w)}V${round(y + h)}H${round(x)}Z`;
  }
  const cx = rx * K;
  const cy = ry * K;
  const p = (a, b) => `${round(a)} ${round(b)}`;
  return (
    `M${p(x + rx, y)}` +
    `L${p(x + w - rx, y)}` +
    `C${p(x + w - rx + cx, y)} ${p(x + w, y + ry - cy)} ${p(x + w, y + ry)}` +
    `L${p(x + w, y + h - ry)}` +
    `C${p(x + w, y + h - ry + cy)} ${p(x + w - rx + cx, y + h)} ${p(x + w - rx, y + h)}` +
    `L${p(x + rx, y + h)}` +
    `C${p(x + rx - cx, y + h)} ${p(x, y + h - ry + cy)} ${p(x, y + h - ry)}` +
    `L${p(x, y + ry)}` +
    `C${p(x, y + ry - cy)} ${p(x + rx - cx, y)} ${p(x + rx, y)}Z`
  );
}

/** An ellipse as four cubics. `<circle>` is the case where rx and ry agree. */
export function ellipsePath(cx, cy, rx, ry) {
  const hx = rx * K;
  const hy = ry * K;
  const p = (a, b) => `${round(a)} ${round(b)}`;
  return (
    `M${p(cx, cy - ry)}` +
    `C${p(cx + hx, cy - ry)} ${p(cx + rx, cy - hy)} ${p(cx + rx, cy)}` +
    `C${p(cx + rx, cy + hy)} ${p(cx + hx, cy + ry)} ${p(cx, cy + ry)}` +
    `C${p(cx - hx, cy + ry)} ${p(cx - rx, cy + hy)} ${p(cx - rx, cy)}` +
    `C${p(cx - rx, cy - hy)} ${p(cx - hx, cy - ry)} ${p(cx, cy - ry)}Z`
  );
}

function pointsPath(attrs, close) {
  const nums = (attr(attrs, "points") || "").match(/-?\d*\.?\d+/g) || [];
  if (nums.length < 4) return "";
  let d = `M${nums[0]} ${nums[1]}`;
  for (let i = 2; i + 1 < nums.length; i += 2) d += `L${nums[i]} ${nums[i + 1]}`;
  return close ? d + "Z" : d;
}

/** Tags that hold no artwork and should not be walked into. */
const IGNORED = new Set(["svg", "g", "defs", "clippath", "mask", "title", "desc", "style"]);

/**
 * Every drawable thing in an SVG, as path data with its paint.
 *
 * `<defs>` is cut out first, so a clip path's rectangle is never mistaken for a
 * rectangle somebody drew.
 *
 * A missing `fill` means none, which is what the root `<svg fill="none">` these
 * files carry already says. A path with a stroke and no fill is a line, and it
 * has to stay one.
 */
export function readShapes(svg) {
  const body = svg.replace(/<defs\b[\s\S]*?<\/defs>/gi, "");
  const shapes = [];
  const unknown = new Set();

  for (const m of body.matchAll(/<([A-Za-z][\w-]*)\b([^>]*?)\/?>/g)) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    if (IGNORED.has(tag)) continue;

    let d;
    if (tag === "path") d = attr(attrs, "d");
    else if (tag === "rect") d = rectPath(attrs);
    else if (tag === "circle") {
      const r = num(attrs, "r");
      d = ellipsePath(num(attrs, "cx"), num(attrs, "cy"), r, r);
    } else if (tag === "ellipse") {
      d = ellipsePath(num(attrs, "cx"), num(attrs, "cy"), num(attrs, "rx"), num(attrs, "ry"));
    } else if (tag === "polygon") d = pointsPath(attrs, true);
    else if (tag === "polyline") d = pointsPath(attrs, false);
    else if (tag === "line") {
      d =
        `M${num(attrs, "x1")} ${num(attrs, "y1")}` +
        `L${num(attrs, "x2")} ${num(attrs, "y2")}`;
    } else {
      unknown.add(tag);
      continue;
    }
    if (!d) continue;

    const fill = (attr(attrs, "fill") || "none").toLowerCase();
    const stroke = (attr(attrs, "stroke") || "none").toLowerCase();
    shapes.push({
      d,
      fill: fill === "none" ? "" : fill,
      stroke: stroke === "none" ? "" : stroke,
      strokeWidth: stroke === "none" ? 0 : num(attrs, "stroke-width", 1),
      linecap: attr(attrs, "stroke-linecap"),
      linejoin: attr(attrs, "stroke-linejoin"),
      evenodd: /fill-rule="evenodd"/.test(attrs),
    });
  }

  return { shapes, unknown: [...unknown] };
}
