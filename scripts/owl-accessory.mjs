/* eslint-env node */

/**
 * Turn a drawing of an owl wearing something into just the something.
 *
 * The workflow this exists for: `--base` writes the bare bird as an SVG, you
 * open it, draw a hat on it, save it into `artwork/`, and this subtracts the
 * bird back out and leaves the hat. No measuring, no anchor point, no scale
 * factor — the hat is already in the coordinates the generator draws in,
 * because you drew it there.
 *
 *   node scripts/owl-accessory.mjs --base
 *   node scripts/owl-accessory.mjs --all
 *   node scripts/owl-accessory.mjs artwork/Winter_Hat.svg --slot head
 *
 * `--all` is the usual one. It rebuilds every accessory listed in
 * `artwork/accessories.json` and writes the registry, so a corrected drawing is
 * one command rather than a hand-edit.
 *
 * The bird it subtracts is generated on the spot from the same code that draws
 * avatars, not read from a file kept beside it. A stored copy is a copy that can
 * go stale, and a stale one fails in the worst way available: it stops matching,
 * every path survives the subtraction, and the accessory you get is an entire
 * second owl.
 *
 * Paths are matched on what they draw, not on how they are written down. A
 * drawing tool rewrites path data on the way out — it rounds numbers, it turns
 * a degenerate curve into `H`, it drops a redundant control point — so
 * comparing strings finds nothing at all. Each path is flattened into a
 * polyline instead and identified by its extent, its length and its area, none
 * of which care how the file spells them.
 *
 * Recolouring part of the bird counts as part of the accessory. A coat covers
 * the owl's arms, so the drawing paints the wings in the background's colour and
 * they disappear. Subtracting that path as "unchanged base" would throw the
 * intent away, so a matched path whose fill has moved is recorded as a repaint
 * instead — see `recolour` on Accessory.
 *
 * Keep the source drawings. They are a few kilobytes each, they are the only
 * record of how an accessory was positioned, and the day one needs a nudge the
 * alternative is redrawing it from the exported result.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import { readShapes } from "./lib/svg-shapes.mjs";
import { simplifyPath } from "./lib/svg-simplify.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const GENERATED = "src/packages/common/src/utils/owl/accessories.generated.ts";

async function load(entry) {
  const built = await esbuild.build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    logLevel: "warning",
  });
  const code = Buffer.from(built.outputFiles[0].contents).toString("base64");
  return import(`data:text/javascript;base64,${code}`);
}

/*
 * The generator imports the file this script writes, so on a clean checkout the
 * two need each other before either exists. Write an empty one first. It costs
 * nothing when the real one is already there, and it is the difference between
 * `--all` working and a new contributor having to hand-create a stub.
 */
if (!existsSync(path.join(root, GENERATED))) {
  writeFileSync(path.join(root, GENERATED), header() + "];\n");
}

const owl = await load("src/packages/common/src/utils/owl/index.ts");

/**
 * The bird the script draws and subtracts.
 *
 * The palette is only there so the drawing is pleasant to work on; the
 * subtraction matches on geometry and ignores colour except where it has
 * changed. `blob` eyes and `tufts` ears because that is the drawn owl, and an
 * accessory positioned against any other expression would sit a little wrong on
 * this one.
 *
 * Every slot is emptied explicitly, and that is not belt and braces. Left to the
 * seed, the bird would wear whatever the accessories already in the registry
 * rolled for it — so the moment the first one landed, the bird being subtracted
 * stopped being bare and every drawing failed to match. It is emptied here so
 * the base cannot depend on what has been added since.
 */
const BARE = { eyes: null, head: null, neck: null, body: null };
const BASE = {
  palette: "teal",
  scheme: "day",
  ears: "tufts",
  eyes: "blob",
  size: 1024,
  wearing: BARE,
};

/**
 * Where each slot lands unless told otherwise.
 *
 * Spectacles go over the eyes, because that is what a drawing of spectacles
 * does — the lens is painted, and it covers the eye behind it. Use `overFace`
 * for a pair drawn as holes only, where the expression should show through.
 *
 * A garment goes on top of everything, collar included. It is drawn over the
 * bird rather than tucked behind it, which is what a coat does.
 */
const DEFAULT_LAYER = { eyes: "overEyes", head: "overAll", neck: "overAll", body: "overAll" };

function header() {
  return (
    "/**\n" +
    " * Generated by scripts/owl-accessory.mjs from artwork/ — do not edit.\n" +
    " *\n" +
    " * Each block is one drawing with the bird subtracted out of it. To change an\n" +
    " * accessory, change the drawing or its entry in artwork/accessories.json and\n" +
    " * run `node scripts/owl-accessory.mjs --all`.\n" +
    " */\n\n" +
    'import type { Accessory } from "./accessories";\n\n' +
    "export const GENERATED_ACCESSORIES: readonly Accessory[] = [\n"
  );
}

/* --- geometry ------------------------------------------------------------ */

/**
 * A path, walked and sampled into a polyline.
 *
 * Supports the commands a drawing tool actually emits for this artwork. Arcs
 * are not among them and are rejected rather than approximated — an accessory
 * that is subtly the wrong shape is harder to notice than one that refuses to
 * build.
 */
function flatten(d) {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
  const points = [];
  let subpaths = 0;
  let i = 0;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let command = "";
  const num = () => Number(tokens[i++]);

  /** Eight samples a curve: enough that two spellings of one arc agree. */
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    for (let k = 1; k <= 8; k += 1) {
      const t = k / 8;
      const u = 1 - t;
      points.push([
        u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      ]);
    }
    x = x3;
    y = y3;
  };

  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) command = tokens[i++];
    const rel = command === command.toLowerCase();
    const c = command.toUpperCase();
    if (c === "A") throw new Error("arc commands are not supported");

    if (c === "Z") {
      points.push([sx, sy]);
      x = sx;
      y = sy;
      continue;
    }
    if (c === "M") {
      x = rel ? x + num() : num();
      y = rel ? y + num() : num();
      sx = x;
      sy = y;
      subpaths += 1;
      points.push([x, y]);
      command = rel ? "l" : "L";
      continue;
    }
    if (c === "L") {
      x = rel ? x + num() : num();
      y = rel ? y + num() : num();
      points.push([x, y]);
      continue;
    }
    if (c === "H") {
      x = rel ? x + num() : num();
      points.push([x, y]);
      continue;
    }
    if (c === "V") {
      y = rel ? y + num() : num();
      points.push([x, y]);
      continue;
    }
    if (c === "C") {
      const x1 = rel ? x + num() : num();
      const y1 = rel ? y + num() : num();
      const x2 = rel ? x + num() : num();
      const y2 = rel ? y + num() : num();
      cubic(x1, y1, x2, y2, rel ? x + num() : num(), rel ? y + num() : num());
      continue;
    }
    if (c === "Q") {
      const qx = rel ? x + num() : num();
      const qy = rel ? y + num() : num();
      const ex = rel ? x + num() : num();
      const ey = rel ? y + num() : num();
      cubic(
        x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y),
        ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey),
        ex, ey,
      );
      continue;
    }
    throw new Error(`unsupported path command "${command}"`);
  }
  return { points, subpaths };
}

/**
 * What a path draws, as a string two files can be compared on.
 *
 * Extent, perimeter and area. Serialisation changes none of them, and two
 * genuinely different shapes agreeing on all three is not something that
 * happens by accident.
 */
function shapeKey(d) {
  const { points, subpaths } = flatten(d);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let length = 0;
  let area = 0;
  for (let k = 0; k < points.length; k += 1) {
    const [px, py] = points[k];
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
    const [qx, qy] = points[(k + 1) % points.length];
    length += Math.hypot(qx - px, qy - py);
    area += px * qy - qx * py;
  }
  const r = (n) => Math.round(n * 2) / 2;
  return [
    r(minX), r(minY), r(maxX), r(maxY),
    Math.round(length), Math.round(Math.abs(area) / 2), subpaths,
  ].join("|");
}

/** The frame itself, however it is spelled — a background rather than a hat. */
function isBackground(d) {
  const { points } = flatten(d);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return (
    Math.min(...xs) <= 0.5 && Math.min(...ys) <= 0.5 &&
    Math.max(...xs) >= 1023.5 && Math.max(...ys) >= 1023.5 &&
    points.length <= 12
  );
}

function paths(svg) {
  return readShapes(svg).shapes;
}

/* --- the bird, and what each of its paths is ----------------------------- */

/**
 * Which palette role each of the bird's paths is painted from.
 *
 * Found by drawing the bird once in a palette of sentinel colours and reading
 * the fills back, rather than by hard-coding "the fourth path is a wing". The
 * generator stays free to reorder its own layers.
 */
const ROLES = [
  "background", "body", "face", "accent", "wing",
  "trimLight", "trim", "trimDeep", "trimSoft", "gold", "goldDeep",
];
const sentinels = Object.fromEntries(
  ROLES.map((role, i) => [role, `#${(i + 1).toString(16).padStart(6, "0")}`]),
);
const roleOf = new Map(
  paths(owl.owlAvatarSvg("base", { ...BASE, palette: sentinels })).map((p) => [
    shapeKey(p.d),
    ROLES[parseInt(p.fill.slice(1), 16) - 1],
  ]),
);
const realPalette = owl.owlPalette(BASE.palette, BASE.scheme);
const roleByColour = new Map(
  Object.entries(realPalette).map(([role, hex]) => [hex.toLowerCase(), role]),
);
// The field is not part of the bird. It is a <rect> here and a <path> in a
// drawing, so it would never match anyway — leaving it in only makes every
// extraction report one path missing.
const baseFills = new Map(
  paths(owl.owlAvatarSvg("base", BASE))
    .filter((p) => !isBackground(p.d))
    .map((p) => [shapeKey(p.d), p.fill]),
);

/* --- extraction ---------------------------------------------------------- */

/** How light a hex is, for sorting. Rough on purpose; it only needs an order. */
function lightness(hex) {
  const int = parseInt(hex.replace("#", ""), 16);
  return (((int >> 16) & 255) * 0.299 + ((int >> 8) & 255) * 0.587 + (int & 255) * 0.114) / 255;
}

/** Lightest first, which is the order the drawn accessories use their tones in. */
const LADDER = ["trimSoft", "trimLight", "trim", "trimDeep", "accent"];

function extract(svg, label, opts) {
  if (/<g\b[^>]*\btransform=/.test(svg)) {
    throw new Error(
      `${label} has a <g transform=...> in it. Flatten the transforms in the drawing ` +
        "tool and export again — this script does not apply them, and an accessory " +
        "that is silently offset is worse than one that fails to build.",
    );
  }
  const viewBox = /viewBox="([^"]*)"/.exec(svg)?.[1];
  if (viewBox && viewBox.trim() !== "0 0 1024 1024") {
    throw new Error(
      `${label} has viewBox "${viewBox}". It has to be "0 0 1024 1024" — that is the ` +
        "frame the generator draws on, and it is the whole reason this works. Run with " +
        "--base to get a bird on the right frame and draw on that.",
    );
  }

  const seen = new Set();
  const recolour = {};
  const unplaceable = new Set();
  const notes = [];

  const { shapes: drawn, unknown } = readShapes(svg);
  for (const tag of unknown) {
    notes.push(`<${tag}> is not something this can read — it was left out`);
  }

  const kept = drawn.filter((p) => {
    if (isBackground(p.d)) return false;
    const key = shapeKey(p.d);
    if (!baseFills.has(key)) return true;
    seen.add(key);

    // The shape is the bird's but the colour is not: a repaint, and it belongs
    // to whatever is being worn rather than to the bird.
    if (p.fill !== baseFills.get(key)) {
      const part = roleOf.get(key);
      const to = roleByColour.get(p.fill);
      if (!part) unplaceable.add(`${p.fill} — could not tell which part that is`);
      else if (!to) unplaceable.add(`${p.fill} — not one of the base owl's colours`);
      else recolour[part] = to;
    }
    return false;
  });

  const missed = [...baseFills.keys()].filter((k) => !seen.has(k)).length;
  if (missed > 0) {
    notes.push(
      `${missed} of the bird's ${baseFills.size} paths were not found — a layer was ` +
        "edited or moved, or this was not drawn on the base",
    );
  }
  for (const f of unplaceable) notes.push(`repainted in a colour this cannot place: ${f}`);
  if (kept.length === 0 && Object.keys(recolour).length === 0) {
    throw new Error(`${label}: nothing left after subtracting the bird`);
  }

  // Shrink after the subtraction, never before it: the bird is matched on its
  // geometry, and rounding the drawing first would move the very numbers being
  // matched on.
  const before = kept.reduce((n, p) => n + p.d.length, 0);
  for (const p of kept) p.d = simplifyPath(p.d, opts.places, opts.tolerance);
  const after = kept.reduce((n, p) => n + p.d.length, 0);

  const distinct = [
    ...new Set(kept.flatMap((p) => [p.fill, p.stroke].filter(Boolean))),
  ].sort((a, b) => lightness(b) - lightness(a));
  const roles = new Map();
  distinct.forEach((hex, i) => {
    roles.set(hex, opts.map.get(hex) ?? LADDER[Math.min(i, LADDER.length - 1)]);
  });

  const layer = opts.layer ?? DEFAULT_LAYER[opts.slot] ?? "overAll";
  const repaints = Object.entries(recolour);
  const literal =
    `  {\n` +
    `    name: "${opts.name}",\n` +
    `    slot: "${opts.slot}",\n` +
    `    layer: "${layer}",\n` +
    `    weight: ${opts.weight},\n` +
    (opts.excludes.length
      ? `    excludes: [${opts.excludes.map((e) => `"${e}"`).join(", ")}],\n`
      : "") +
    (repaints.length
      ? `    recolour: { ${repaints.map(([k, v]) => `${k}: "${v}"`).join(", ")} },\n`
      : "") +
    `    paths: [\n` +
    kept
      .map((p) => {
        const bits = [];
        if (p.fill) bits.push(`fill: "${roles.get(p.fill)}"`);
        if (p.stroke) {
          bits.push(`stroke: "${roles.get(p.stroke)}"`);
          bits.push(`strokeWidth: ${Math.round(p.strokeWidth * 10) / 10}`);
          if (p.linecap) bits.push(`linecap: "${p.linecap}"`);
          if (p.linejoin) bits.push(`linejoin: "${p.linejoin}"`);
        }
        if (p.evenodd) bits.push("evenodd: true");
        return `      { ${bits.join(", ")}, d: "${p.d}" },`;
      })
      .join("\n") +
    `\n    ],\n  },`;

  const pad = " ".repeat(20);
  const guessed = distinct.filter((hex) => !opts.map.has(hex));
  const summary =
    `${opts.name.padEnd(18)} ${String(kept.length).padStart(2)} paths  ` +
    `${(after / 1000).toFixed(1).padStart(5)}kB` +
    (before > after ? ` -${String(Math.round((100 * (before - after)) / before)).padStart(2)}%` : "     ") +
    `  ${opts.slot}/${layer}` +
    (repaints.length ? `  repaints ${repaints.map(([k, v]) => `${k}->${v}`).join(" ")}` : "") +
    (guessed.length
      ? `\n${pad}guessed: ${guessed.map((h) => `${h}->${roles.get(h)}`).join(" ")}`
      : "") +
    notes.map((n) => `\n${pad}warning: ${n}`).join("");

  const paint = (p, colour) =>
    `<path d="${p.d}"${p.evenodd ? ' fill-rule="evenodd" clip-rule="evenodd"' : ""}` +
    ` fill="${p.fill ? colour(p.fill) : "none"}"` +
    (p.stroke
      ? ` stroke="${colour(p.stroke)}" stroke-width="${p.strokeWidth}"` +
        (p.linecap ? ` stroke-linecap="${p.linecap}"` : "") +
        (p.linejoin ? ` stroke-linejoin="${p.linejoin}"` : "")
      : "") +
    "/>";
  const body = kept.map((p) => paint(p, (hex) => hex)).join("");
  const stripped =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" ` +
    `viewBox="0 0 1024 1024" fill="none">${body}</svg>\n`;

  return { literal, summary, stripped, roles, kept, paint };
}

/* --- arguments ----------------------------------------------------------- */

/** Flags that take a value. Everything else is a switch or a file name. */
const VALUED = new Set([
  "name", "slot", "layer", "weight", "map", "out", "excludes", "places", "tolerance",
]);

const options = new Map();
const positional = [];
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) {
    positional.push(arg);
    continue;
  }
  const key = arg.slice(2);
  if (VALUED.has(key)) {
    options.set(key, process.argv[i + 1]);
    i += 1;
  } else {
    options.set(key, true);
  }
}
const flag = (name, fallback) => options.get(name) ?? fallback;
const has = (name) => options.get(name) === true;

/* --- writing the bird ---------------------------------------------------- */

if (has("base")) {
  const out = flag("out", root);
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "owl-base.svg"), owl.owlAvatarSvg("base", BASE) + "\n");
  writeFileSync(
    path.join(out, "owl-base-no-background.svg"),
    owl.owlAvatarSvg("base", { ...BASE, background: false }) + "\n",
  );
  const m = owl.OWL;
  console.log(`wrote owl-base.svg and owl-base-no-background.svg to ${out}`);
  console.log(`  eyes    (${m.cx - m.eyeGap / 2}, ${m.eyeY}) and (${m.cx + m.eyeGap / 2}, ${m.eyeY}), r ${m.eyeR}`);
  console.log(`  plate   x ${m.cx - m.faceHalf}..${m.cx + m.faceHalf}  y ${m.faceTop}..${m.faceTop + m.faceHeight}`);
  console.log(`  crown   y ${m.crown}`);
  console.log(`  widest  +/-${m.half} at y ${m.shoulder}`);
  process.exit(0);
}

/* --- the whole set, from the manifest ------------------------------------ */

if (has("all")) {
  const dir = flag("out", path.join(root, "artwork"));
  const manifest = JSON.parse(readFileSync(path.join(dir, "accessories.json"), "utf8"));
  const blocks = [];
  for (const entry of manifest) {
    const built = extract(readFileSync(path.join(dir, entry.file), "utf8"), entry.file, {
      name: entry.name,
      slot: entry.slot,
      layer: entry.layer,
      weight: entry.weight,
      excludes: entry.excludes ?? [],
      places: entry.places ?? Number(flag("places", "1")),
      tolerance: entry.tolerance ?? Number(flag("tolerance", "0.4")),
      map: new Map(Object.entries(entry.map ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
    });
    blocks.push(built.literal);
    console.log(built.summary);
  }
  const content = header() + blocks.join("\n") + "\n];\n";

  /*
   * `--check` is for CI. The build regenerates this file, so a forgotten run is
   * harmless locally — but a stale one committed alongside a changed drawing
   * means the repository and the app disagree about what an owl is wearing, and
   * a build that quietly rewrites a tracked file is not where anyone should find
   * that out.
   */
  if (has("check")) {
    const target = path.join(root, GENERATED);
    const onDisk = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (onDisk !== content) {
      console.error(
        `\n${GENERATED} is out of date.\n` +
          "Run `node scripts/owl-accessory.mjs --all` and commit the result.",
      );
      process.exit(1);
    }
    console.log(`\n${GENERATED} is up to date — ${manifest.length} accessories`);
    process.exit(0);
  }

  writeFileSync(path.join(root, GENERATED), content);
  console.log(`\nwrote ${GENERATED} — ${manifest.length} accessories`);
  process.exit(0);
}

/* --- one drawing --------------------------------------------------------- */

const input = positional[0];
if (!input) {
  console.error(
    "usage: owl-accessory.mjs <drawing.svg> [--name n] [--slot eyes|head|neck|body]\n" +
      "                        [--layer behind|underFace|overFace|overEyes|overAll]\n" +
      "                        [--weight n] [--excludes neck,head]\n" +
      "                        [--map '#aabbcc=trim,...'] [--places n] [--tolerance n]\n" +
      "                        [--out dir] [--preview]\n" +
      "       owl-accessory.mjs --all     rebuild every accessory from the manifest\n" +
      "       owl-accessory.mjs --all --check  fail if that result is not committed\n" +
      "       owl-accessory.mjs --base    write the bird to draw on",
  );
  process.exit(1);
}

const slot = flag("slot", "head");
const name = flag("name", path.basename(input, ".svg").toLowerCase().replace(/[_\s]+/g, "-"));
const built = extract(readFileSync(path.resolve(input), "utf8"), path.basename(input), {
  name,
  slot,
  layer: flag("layer", undefined),
  weight: Number(flag("weight", "10")),
  excludes: (flag("excludes", "") || "").split(",").filter(Boolean),
  places: Number(flag("places", "1")),
  tolerance: Number(flag("tolerance", "0.4")),
  map: new Map(
    (flag("map", "") || "")
      .split(",")
      .filter(Boolean)
      .map((pair) => {
        const [hex, role] = pair.split("=");
        return [hex.trim().toLowerCase(), role.trim()];
      }),
  ),
});

const outDir = flag("out", path.dirname(path.resolve(input)));
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, `${name}.accessory.svg`), built.stripped);
writeFileSync(path.join(outDir, `${name}.accessory.ts.txt`), built.literal + "\n");
console.log(built.summary);
console.log(`  ${path.join(outDir, `${name}.accessory.svg`)}`);
console.log(`  ${path.join(outDir, `${name}.accessory.ts.txt`)}`);

if (has("preview")) {
  const bird = owl.owlAvatarSvg("preview", { ...BASE, size: 320 });
  const inner = bird.slice(bird.indexOf(">") + 1, bird.lastIndexOf("</svg>"));
  const recoloured = built.kept
    .map((p) => built.paint(p, (hex) => realPalette[built.roles.get(hex)]))
    .join("");
  writeFileSync(
    path.join(outDir, `${name}.preview.html`),
    `<meta charset="utf-8"><body style="background:#1a1a22;margin:0;padding:16px">` +
      `<svg width="320" height="320" viewBox="0 0 1024 1024">${inner}${recoloured}</svg></body>\n`,
  );
  console.log(`  ${path.join(outDir, `${name}.preview.html`)}`);
}
