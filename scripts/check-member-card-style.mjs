#!/usr/bin/env node
/**
 * The member card's colours, style codes and fields (GRYT-1611). The colours are
 * swept through the real functions, so a clamp deleted from the module fails here.
 */

import assert from "node:assert/strict";

import { EGG_PATTERNS } from "@gryt/owl";

import { BUILTIN_CARD_STYLES } from "../src/packages/socket/src/lib/memberCard/builtinStyles.ts";
import {
  BIO_MAX,
  cardProfileOf,
  cardStyleForWire,
  cardText,
  decodeCardStyle,
  DEFAULT_CARD_STYLE,
  encodeCardStyle,
  normalizeCardStyle,
  PRONOUNS_MAX,
  STATUS_LINE_MAX,
} from "../src/packages/socket/src/lib/memberCard/cardStyle.ts";
import { cardVars } from "../src/packages/socket/src/lib/memberCard/cardVars.ts";
import { bandColours, blend, contrast, fullColours, lum, lumOf, oklch, okToRgb, owlGradient } from "../src/packages/socket/src/lib/memberCard/colour.ts";
import { CARD_PATTERNS, patternId } from "../src/packages/socket/src/lib/memberCard/patterns.ts";
import { TILES } from "../src/packages/socket/src/lib/memberCard/patterns/tiles.generated.ts";
import { patternLayers } from "../src/packages/socket/src/lib/memberCard/patternSvg.ts";
import { scatter, seedFromId } from "../src/packages/socket/src/lib/memberCard/scatter.ts";

let failures = 0;
function check(name, run) {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
}

const AA = 4.5;
const linear = (hex) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
const y = (hex) => lum(linear(hex));
/** `a` laid over `b` at `alpha`, blended in sRGB as a browser composites it. */
const over = (a, b, alpha) => {
  const g = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return g(b)
    .map((v, i) => v * (1 - alpha) + g(a)[i] * alpha)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
};

/** Every six-step sRGB colour, and the ones most likely to break a clamp. */
const STEPS = ["00", "33", "66", "99", "cc", "ff"];
const SWEEP = STEPS.flatMap((r) => STEPS.flatMap((g) => STEPS.map((b) => `#${r}${g}${b}`)));
const EXTREMES = ["#000000", "#ffffff", "#ffff00", "#00ffff", "#ff00ff", "#0000ff", "#00ff00", "#ff0000", "#0b0b0f", "#777777", "#7f7f7f", "#808080", "#8a8a8a", "#fefefe", "#010101"];
const PARTNERS = ["#000000", "#ffffff", "#ffff00", "#0000ff", "#808080", "#0b0b0f"];

/** The worst text contrast on a whole-card pick: ink and muted, on both ends, the middle and the band. */
function worstOnCard(pick) {
  const f = fullColours(pick);
  let worst = Infinity;
  for (const end of [...f.ends, f.mid]) {
    for (const text of [f.inkHex, f.mutedHex]) worst = Math.min(worst, contrast(y(end), y(text)));
    // The band is the ink at 7% over the card; muted text sits on it.
    worst = Math.min(worst, contrast(lum(over(f.inkHex, end, 0.07)), y(f.mutedHex)));
  }
  return { worst, f };
}

function everyPick() {
  const picks = [];
  for (const c1 of [...SWEEP, ...EXTREMES]) {
    picks.push({ mode: "solid", c1, c2: c1, angle: 135 });
    for (const c2 of PARTNERS) picks.push({ mode: "gradient", c1, c2, angle: 135 });
    picks.push(owlGradient(c1));
  }
  return picks;
}

check("whole-card colours keep small text at 4.5:1 or better, for every pick swept", () => {
  let worst = { worst: Infinity };
  for (const pick of everyPick()) {
    const r = worstOnCard(pick);
    if (r.worst < worst.worst) worst = { ...r, pick };
  }
  assert.ok(worst.worst >= AA, `${JSON.stringify(worst.pick)} gives ${worst.worst.toFixed(2)}:1`);
  console.log(`        worst of ${everyPick().length}: ${worst.worst.toFixed(2)}:1`);
});

check("every built-in style keeps small text at 4.5:1 or better", () => {
  for (const { id, style } of BUILTIN_CARD_STYLES) {
    const pick = style.fill === "owl" ? owlGradient("#7c5cff") : { mode: style.fill, c1: style.c1, c2: style.c2 ?? style.c1, angle: style.angle };
    const { worst } = worstOnCard(pick);
    assert.ok(worst >= AA, `${id} gives ${worst.toFixed(2)}:1`);
  }
});

check("the card's contrast figure is the muted text's, and never under the target the mockup set", () => {
  for (const hex of EXTREMES) {
    const { attrs, contrast: figure } = cardVars({ ...DEFAULT_CARD_STYLE, fill: "solid", c1: hex, c2: hex }, "#d06274", { appearance: "dark", seed: 1 });
    assert.equal(attrs["data-fc"], "1");
    assert.ok(figure >= 5, `${hex}: ${figure}`);
  }
});

check("colour on the banner only keeps the band's ink at 4.5:1 or better", () => {
  let worst = Infinity;
  let at = null;
  for (const pick of everyPick()) {
    const k = bandColours(pick);
    const m = /oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)/.exec(k.ink);
    const ink = lum(okToRgb(Number(m[1]) / 100, Number(m[2]), Number(m[3])));
    [pick.c1, pick.c2].forEach((hex, i) => {
      const o = oklch(hex);
      const r = contrast(lum(okToRgb(k.bandL[i], Math.min(o.C, 0.2), o.H)), ink);
      if (r < worst) [worst, at] = [r, pick];
    });
  }
  assert.ok(worst >= AA, `${JSON.stringify(at)} gives ${worst.toFixed(2)}:1`);
});

check("dark ink goes on light picks and light ink on dark ones", () => {
  assert.equal(fullColours({ mode: "solid", c1: "#ffff00", c2: "#ffff00", angle: 135 }).dark, true);
  assert.equal(fullColours({ mode: "solid", c1: "#0b0b0f", c2: "#0b0b0f", angle: 135 }).dark, false);
});

/* ── style codes ─────────────────────────────────────────────────────────── */

check("a code carries only what differs, in the mockup's format", () => {
  assert.equal(encodeCardStyle(DEFAULT_CARD_STYLE), "card=b4b");
  assert.equal(
    encodeCardStyle({ ...DEFAULT_CARD_STYLE, fill: "gradient", c1: "#1D4E89", c2: "#3fb6a8", angle: 135, pattern: "contours" }),
    "card=b4b&colour=gradient&c1=1d4e89&c2=3fb6a8&pattern=contours",
  );
  assert.equal(
    encodeCardStyle({ ...DEFAULT_CARD_STYLE, fill: "solid", c1: "#ffd400", pattern: "dots", cover: "card", fade: "banner" }),
    "card=b4b&colour=solid&c1=ffd400&pattern=dots&cover=card&fade=full",
  );
  assert.equal(encodeCardStyle({ ...DEFAULT_CARD_STYLE, colours: "banner", cover: "card" }), "card=b4b&fill=banner");
});

check("every built-in style survives a trip through a code", () => {
  for (const { id, style } of BUILTIN_CARD_STYLES) {
    const back = decodeCardStyle(encodeCardStyle(style));
    assert.deepEqual(cardStyleForWire(back), cardStyleForWire(style), id);
  }
});

check("a code copied from the mockup's playground reads", () => {
  assert.deepEqual(decodeCardStyle("card=b4c&colour=solid&c1=ffd400"), { ...DEFAULT_CARD_STYLE, fill: "solid", c1: "#ffd400", c2: "#ffd400" });
  const night = decodeCardStyle("card=b4b&colour=gradient&c1=0b0b12&c2=5b2a86&angle=160&pattern=weave&fade=full");
  assert.equal(night.angle, 160);
  assert.equal(night.fade, "banner");
  assert.equal(decodeCardStyle("card=b4b&fill=banner").colours, "banner");
});

check("a link, a bare query and the JSON form all read", () => {
  const want = decodeCardStyle("colour=solid&c1=ffd400");
  assert.deepEqual(decodeCardStyle("https://gryt.chat/card?colour=solid&c1=ffd400"), want);
  assert.deepEqual(decodeCardStyle('{"colour":"solid","c1":"#FFD400"}'), want);
});

check("nothing, garbage and half a colour are not a style", () => {
  for (const bad of ["", "   ", "hello", "{not json", "[1,2]", "colour=solid", "colour=gradient&c1=ffd400", "c1=zzzzzz", null, undefined]) {
    assert.equal(decodeCardStyle(bad), null, JSON.stringify(bad));
  }
});

check("an unknown pattern in a code reads as none", () => {
  assert.equal(decodeCardStyle("card=b4b&pattern=stars").pattern, "none");
  assert.equal(decodeCardStyle("pattern=stars"), null);
});

/* ── fields ──────────────────────────────────────────────────────────────── */

check("each bad field falls back to its default and leaves the rest", () => {
  assert.deepEqual(normalizeCardStyle(null), DEFAULT_CARD_STYLE);
  assert.deepEqual(normalizeCardStyle("nope"), DEFAULT_CARD_STYLE);
  const s = normalizeCardStyle({ fill: "solid", c1: "red", pattern: "dots", cover: "sideways", fade: "banner", angle: 999 });
  assert.equal(s.fill, "owl");
  assert.equal(s.pattern, "dots");
  assert.equal(s.cover, "banner");
  assert.equal(s.fade, "banner");
  assert.equal(s.angle, 135);
});

check("a gradient missing its second colour is still the colour they picked", () => {
  const s = normalizeCardStyle({ fill: "gradient", c1: "#ABCDEF" });
  assert.equal(s.fill, "solid");
  assert.equal(s.c1, "#abcdef");
});

check("the server's sparse shape reads, and what is sent back matches it", () => {
  assert.deepEqual(normalizeCardStyle({}), DEFAULT_CARD_STYLE);
  const server = { fill: "gradient", c1: "#1d4e89", c2: "#3fb6a8", pattern: "contours", colours: "banner" };
  assert.deepEqual(cardStyleForWire(normalizeCardStyle(server)), server);
  assert.equal(cardStyleForWire(DEFAULT_CARD_STYLE), null);
  assert.deepEqual(cardStyleForWire({ ...DEFAULT_CARD_STYLE, fill: "gradient", c1: "#000000", c2: "#ffffff", angle: 90 }), {
    fill: "gradient",
    c1: "#000000",
    c2: "#ffffff",
    angle: 90,
  });
});

check("text is one line, cut to its limit, with nothing that reorders it", () => {
  assert.equal(cardText("  Mostly on\nafter   nine. ", BIO_MAX), "Mostly on after nine.");
  assert.equal(cardText("‮evil", PRONOUNS_MAX), "evil");
  assert.equal(cardText("   ", STATUS_LINE_MAX), null);
  assert.equal(cardText(42, STATUS_LINE_MAX), null);
  assert.equal(cardText("x".repeat(500), BIO_MAX).length, BIO_MAX);
  // Cut by characters, so an emoji at the edge is kept whole or dropped, never halved.
  assert.equal(Array.from(cardText("🦉".repeat(50), PRONOUNS_MAX)).length, PRONOUNS_MAX);
});

check("a member from before cards has the default card and no words", () => {
  assert.deepEqual(cardProfileOf({}), { cardStyle: DEFAULT_CARD_STYLE, bio: null, pronouns: null, statusLine: null });
});

/* ── registries ─────────────────────────────────────────────────────────── */

check("pattern ids are unique, stable, and an unknown one draws as none", () => {
  const ids = CARD_PATTERNS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["none", "gradient", "dots", "contours", "weave", "dusk", "gryt-faces", "my-owl", "icon"]) assert.ok(ids.includes(id), id);
  for (const id of ids) assert.match(id, /^[a-z0-9-]{1,32}$/, `${id} is not an id the server keeps`);
  assert.equal(patternId("sparkles"), "none");
  assert.equal(patternId(7), "none");
});

check("every egg pattern in @gryt/owl is a card pattern under the same id", () => {
  const ids = new Set(CARD_PATTERNS.map((p) => p.id));
  assert.deepEqual(EGG_PATTERNS.map((p) => p.name).filter((name) => !ids.has(name)), []);
});

check("every tile draws, and a drawing is plain SVG with the ink in it", () => {
  const draw = { ink: "#123456", alpha: 0.2, scale: 1, rotate: 0, fade: "none", seed: 7 };
  for (const t of TILES) {
    const { image } = patternLayers(t.id, { ...draw, tile: t }, { owl: "red", accent: "blue", surface: "white" });
    assert.ok(image?.startsWith('url("data:image/svg+xml,'), t.id);
    const svg = decodeURIComponent(image.slice(26, -2));
    assert.ok(svg.includes("#123456"), `${t.id} lost its ink`);
    assert.ok(!/<script|on[a-z]+=|href='http/i.test(svg), `${t.id} carries something that is not a drawing`);
  }
});

check("a scatter is the same for the same seed and spreads its marks out", () => {
  const a = scatter(4242, 34, 0);
  assert.deepEqual(scatter(4242, 34, 0), a);
  assert.notDeepEqual(scatter(4243, 34, 0), a);
  assert.ok(a.length > 30, `only ${a.length} marks`);
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++)
      assert.ok(Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y) > (a[i].size + a[j].size) * 0.5, "two marks overlap");
  assert.equal(seedFromId("user_1"), seedFromId("user_1"));
  assert.ok(seedFromId("user_1") >= 0 && seedFromId("user_1") <= 65535);
});

check("a pattern colour and strength never take small text under 4.5:1", () => {
  for (const hex of ["#ffff00", "#0b0b0f", "#808080", "#d06274", "#ffffff"]) {
    for (const pInk of ["#000000", "#ffffff", "#ff0000"]) {
      for (const cover of ["banner", "card"]) {
        const style = { ...DEFAULT_CARD_STYLE, fill: "solid", c1: hex, c2: hex, pattern: "dots", pOpacity: 40, pInk, cover };
        const v = cardVars(style, "#d06274", { appearance: "light", seed: 1 });
        const f = fullColours({ mode: "solid", c1: hex, c2: hex, angle: 135 });
        for (const end of [...f.ends, f.mid]) {
          const r = contrast(lumOf(blend(end, v.patternInk, v.patternAlpha)), lumOf(f.mutedHex));
          assert.ok(r >= 4.5, `${hex} with ${pInk} at ${v.patternAlpha}: ${r.toFixed(2)}:1`);
        }
      }
    }
  }
});

check("tuning is read key by key and only what differs is kept", () => {
  const s = normalizeCardStyle({ pattern: "waves-1", pScale: 250, pRotate: 400, pOpacity: 12, pFade: "radial", pSeed: 70000, pInk: "#ABCDEF", pIcon: "coffee" });
  assert.equal(s.pScale, 250);
  assert.equal(s.pRotate, 0);
  assert.equal(s.pOpacity, 12);
  assert.equal(s.pFade, "radial");
  assert.equal(s.pSeed, undefined);
  assert.equal(s.pInk, "#abcdef");
  assert.equal(s.pIcon, "coffee");
  assert.deepEqual(cardStyleForWire(s), { pattern: "waves-1", pScale: 250, pOpacity: 12, pFade: "radial", pInk: "#abcdef", pIcon: "coffee" });
  const code = encodeCardStyle(s);
  assert.equal(code, "card=b4b&pattern=waves-1&pScale=250&pOpacity=12&pFade=radial&pInk=abcdef&pIcon=coffee");
  assert.deepEqual(decodeCardStyle(code), s);
});

check("built-in style ids are unique and each is already a valid style", () => {
  const ids = BUILTIN_CARD_STYLES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const { id, style } of BUILTIN_CARD_STYLES) assert.deepEqual(normalizeCardStyle(style), style, id);
});

console.log(failures === 0 ? "\nmember card style: ok" : `\nmember card style: ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
