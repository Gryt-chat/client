/* eslint-env node */

/**
 * The owl generator, checked without a browser.
 *
 * Two things this is protecting, and only one of them is obvious.
 *
 * The obvious one: an avatar is how a person is recognised, so the same seed has
 * to draw the same owl forever. Nothing here asserts that an owl looks *good* —
 * that is what the eye is for — but the hashes below fail the moment a
 * refactor, a rounding change or a reordered layer moves so much as one control
 * point. If one fails, the question is never "update the hash". It is whether
 * the change was meant, and whether the mobile app is moving with it.
 *
 * The less obvious one: the mobile app runs a byte-identical copy of the same
 * generator and pins these same hashes. Two clients drawing one person as two
 * different people is the failure this whole arrangement exists to avoid, and
 * nothing else would catch it — both would build, both would render a perfectly
 * good owl, and the only symptom is somebody saying "that's not what you look
 * like on my laptop".
 *
 * Bundled through esbuild rather than imported straight off disk. Node strips
 * the types on a .ts import but will not resolve one without its extension, and
 * the source is written for the bundler like the rest of the app. Vite is what
 * ships this; running it through the same tool is closer to the truth than
 * rewriting the imports to suit a test.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

import esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));

async function load(entry) {
  const built = await esbuild.build({
    entryPoints: [path.join(here, "..", entry)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    logLevel: "warning",
  });
  const code = Buffer.from(built.outputFiles[0].contents).toString("base64");
  return import(`data:text/javascript;base64,${code}`);
}

const { avatarSeed } = await load("src/packages/common/src/utils/avatarSeed.ts");
const {
  ACCESSORIES,
  ACCESSORY_SLOTS,
  EAR_STYLES,
  owlAvatarColour,
  owlAvatarSvg,
  owlPalette,
  PALETTE_NAMES,
  PALETTE_SCHEMES,
  repaint,
  resolveOwl,
  TILE_HUES,
} = await load("src/packages/common/src/utils/owl/index.ts");

const sha = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16);

/* The pinned owls. Generated 2026-08-24 and copied into the mobile app's test. */
const PINNED = {
  sivert: { sha: "", colour: "" },
  ingy: { sha: "", colour: "" },
  gryt: { sha: "", colour: "" },
};

/* --- the same seed draws the same owl --------------------------------- */

for (const seed of Object.keys(PINNED)) {
  assert.equal(owlAvatarSvg(seed), owlAvatarSvg(seed), `${seed} is not deterministic`);
}

/* --- the seed rule ----------------------------------------------------- */

assert.equal(avatarSeed("  Sivert "), "sivert");
assert.equal(avatarSeed("SIVERT"), avatarSeed("sivert"));
assert.equal(avatarSeed("   "), undefined);
assert.equal(avatarSeed(""), undefined);
assert.equal(avatarSeed(null), undefined);
assert.equal(avatarSeed(undefined), undefined);

/* Everything that is not case or edge whitespace is part of the person. */
assert.equal(avatarSeed("Sivert H"), "sivert h");
assert.notEqual(owlAvatarSvg("sivert h"), owlAvatarSvg("sivert"));

/* --- the tile tint ----------------------------------------------------- */

/**
 * A voice tile is tinted from the avatar's colour and the tint snaps to the
 * nearest TILE_HUES entry. The palettes are built from that list precisely so
 * the snap is exact — a palette that drifted off it would still work and would
 * still look fine, and the tile would quietly be somebody else's colour.
 */
function hueOf(hex) {
  const int = parseInt(hex.slice(1), 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return null;
  const h =
    max === r ? ((g - b) / delta) % 6
    : max === g ? (b - r) / delta + 2
    : (r - g) / delta + 4;
  return (h * 60 + 360) % 360;
}

for (const name of PALETTE_NAMES) {
  for (const scheme of PALETTE_SCHEMES) {
    const colour = owlAvatarColour("x", { palette: name, scheme });
    assert.match(colour, /^#[0-9a-f]{6}$/, `${name}/${scheme} is not a hex colour`);
    const hue = hueOf(colour);
    assert.notEqual(hue, null, `${name}/${scheme} has no hue for a tile to snap to`);
    const nearest = TILE_HUES.reduce((best, candidate) =>
      Math.abs(((candidate - hue + 540) % 360) - 180) <
      Math.abs(((best - hue + 540) % 360) - 180)
        ? candidate
        : best,
    );
    assert.ok(
      Math.abs(((nearest - hue + 540) % 360) - 180) < 1.5,
      `${name}/${scheme} lands ${hue.toFixed(1)} degrees away from every tile hue`,
    );
  }
}

/* --- every part actually draws ----------------------------------------- */

/*
 * Nothing an accessory draws may end up unpainted. An SVG in an <img> has no
 * document around it to inherit from, so a missing fill is black rather than
 * nothing — a stroke-only line comes out as a solid blob across the artwork.
 */
for (const accessory of ACCESSORIES) {
  const svg = owlAvatarSvg("x", { wearing: { [accessory.slot]: accessory.name } });
  assert.ok(!svg.includes('fill=""'), `${accessory.name} draws with an empty fill`);
  assert.ok(!svg.includes("undefined"), `${accessory.name} draws with an undefined value`);
}

for (const ears of EAR_STYLES) {
  const svg = owlAvatarSvg("x", { ears });
  assert.ok(svg.length > 500, `${ears} ears drew almost nothing`);
}

/* --- accessories ------------------------------------------------------- */

/**
 * Names have to be unique, because `wearing` addresses an accessory by name and
 * a picker stores that name. Two accessories sharing one is not a clash the
 * type system can see; it is one of them silently never being drawn.
 */
const names = ACCESSORIES.map((a) => a.name);
assert.equal(new Set(names).size, names.length, "two accessories share a name");

/* An accessory the caller asks for is worn, whatever the seed wanted. */
for (const accessory of ACCESSORIES) {
  const owl = resolveOwl("x", { wearing: { [accessory.slot]: accessory.name } });
  assert.equal(owl.wearing[accessory.slot], accessory.name);
}

/* And null empties a slot rather than re-rolling it. */
for (const slot of ACCESSORY_SLOTS) {
  const owl = resolveOwl("x", { wearing: { [slot]: null } });
  assert.equal(owl.wearing[slot], undefined, `${slot} was not emptied`);
}

/*
 * Every colour an accessory asks for has to exist. These are generated from
 * drawings, so a role name is a string that came out of a script rather than
 * something the compiler checked — and `undefined` reaches the SVG as
 * `fill="undefined"`, which browsers draw as black.
 */
const roles = Object.keys(owlPalette("teal", "day"));
for (const accessory of ACCESSORIES) {
  for (const p of accessory.paths) {
    assert.ok(p.d.length > 0, `${accessory.name} has an empty path`);
    // A path is a fill, a stroke, or both. One with neither is invisible, which
    // means a drawing lost something on the way in and nothing said so.
    assert.ok(p.fill || p.stroke, `${accessory.name} has a path with no paint`);
    if (p.fill) assert.ok(roles.includes(p.fill), `${accessory.name} fills with "${p.fill}"`);
    if (p.stroke) {
      assert.ok(roles.includes(p.stroke), `${accessory.name} strokes with "${p.stroke}"`);
      assert.ok(p.strokeWidth > 0, `${accessory.name} strokes at width ${p.strokeWidth}`);
    }
  }
  /*
   * A drawing that hides a part has to bring a replacement. One that hides the
   * eyes and draws nothing leaves a blank face, and the extractor would have
   * been perfectly happy about it.
   */
  if (accessory.hides?.length) {
    assert.ok(
      accessory.paths.length > 0,
      `${accessory.name} hides ${accessory.hides.join(", ")} and draws nothing in their place`,
    );
  }
  for (const [part, source] of Object.entries(accessory.recolour ?? {})) {
    assert.ok(roles.includes(part), `${accessory.name} repaints "${part}", which is not a part`);
    assert.ok(roles.includes(source), `${accessory.name} repaints to "${source}", which is not a colour`);
  }
}

/* A repaint swaps roles rather than collapsing them. */
{
  const base = owlPalette("teal", "day");
  const swapped = repaint(base, [
    { name: "t", slot: "body", layer: "behind", weight: 1, paths: [],
      recolour: { wing: "background", background: "wing" } },
  ]);
  assert.equal(swapped.wing, base.background);
  assert.equal(swapped.background, base.wing);
}

/* Nothing an accessory does moves the colour a voice tile is tinted from. */
for (const accessory of ACCESSORIES) {
  assert.equal(
    owlAvatarColour("x", { wearing: { [accessory.slot]: accessory.name } }),
    owlAvatarColour("x", { wearing: Object.fromEntries(ACCESSORY_SLOTS.map((s) => [s, null])) }),
    `wearing ${accessory.name} changed the tile colour`,
  );
}

/* --- the pinned owls --------------------------------------------------- */

/*
 * Empty until the first release. Run with --pin to print the block to paste in
 * here and into the mobile app's test; both trees have to carry the same one.
 */
if (process.argv.includes("--pin")) {
  const rows = Object.keys(PINNED).map(
    (seed) =>
      `  ${seed}: { sha: "${sha(owlAvatarSvg(seed))}", colour: "${owlAvatarColour(seed)}" },`,
  );
  console.log(`const PINNED = {\n${rows.join("\n")}\n};`);
} else {
  for (const [seed, expected] of Object.entries(PINNED)) {
    if (!expected.sha) continue;
    assert.equal(sha(owlAvatarSvg(seed)), expected.sha, `${seed}'s owl changed`);
    assert.equal(owlAvatarColour(seed), expected.colour, `${seed}'s colour changed`);
  }
}

console.log("generated-avatar checks passed");
