/* eslint-env node */

/**
 * Which of the three kinds of avatar wins, checked against the real generator.
 * The designed look beats the upload, because saving a design uploads a PNG too.
 */

import assert from "node:assert/strict";

import { encodeWorn } from "@gryt/owl";

import { resolveAvatarSrc } from "../src/packages/common/src/utils/owlAvatar.ts";

const PICTURE = "https://example.invalid/uploads/avatar.png";

const look = encodeWorn({
  palette: "teal",
  scheme: "day",
  ears: "tufts",
  wearing: {},
});

const isDrawn = (src) => typeof src === "string" && src.startsWith("data:image/svg+xml");

// A designed look outranks an uploaded picture. Both are set at once whenever
// somebody saves from the editor, so this is the ordinary case, not an edge one.
assert.ok(isDrawn(resolveAvatarSrc(PICTURE, "sivert", look)), "a designed look should be drawn");

// With no look, the picture wins over the owl the nickname draws.
assert.equal(resolveAvatarSrc(PICTURE, "sivert", null), PICTURE);
assert.equal(resolveAvatarSrc(PICTURE, "sivert", undefined), PICTURE);
assert.equal(resolveAvatarSrc(PICTURE, "sivert"), PICTURE);

// Clearing the look is what puts a photograph back. If this ever fails,
// "upload a picture" stops taking for anybody who has used the editor.
assert.equal(resolveAvatarSrc(PICTURE, "sivert", ""), PICTURE);

// No picture and no look: the owl the nickname draws.
assert.ok(isDrawn(resolveAvatarSrc(undefined, "sivert")), "a nickname alone should draw an owl");

// An unreadable look costs the look, not the avatar. A string from a newer client
// lands here, and the fallback has to be the picture.
assert.equal(resolveAvatarSrc(PICTURE, "sivert", "not a look"), PICTURE);
assert.ok(
  isDrawn(resolveAvatarSrc(undefined, "sivert", "not a look")),
  "an unreadable look should fall back to the seeded owl",
);

// A look overrides the seed for the fields it names, and only those. The editor
// sets every one, so a designed avatar is not a unique one.
const mine = resolveAvatarSrc(undefined, "sivert", look);
const theirs = resolveAvatarSrc(undefined, "someone-else", look);
assert.equal(mine, theirs, "a fully specified look leaves the seed nothing to decide");

// A look that leaves a field empty leaves it to the seed. `--` in the palette
// field means "not chosen", which is what makes a partial look still personal.
const partial = encodeWorn({ ears: "tufts", wearing: {} });
assert.notEqual(
  resolveAvatarSrc(undefined, "sivert", partial),
  resolveAvatarSrc(undefined, "someone-else", partial),
  "a look with no palette should still take its colour from the seed",
);

// The cache is keyed on the look as well as the seed, or changing your owl does
// nothing until a reload. Two palettes, so a coincidence cannot pass it.
const teal = encodeWorn({ palette: "teal", scheme: "day", ears: "tufts", wearing: {} });
const pink = encodeWorn({ palette: "pink", scheme: "day", ears: "tufts", wearing: {} });
assert.notEqual(
  resolveAvatarSrc(undefined, "sivert", teal),
  resolveAvatarSrc(undefined, "sivert", pink),
  "one person's two looks should not share a cache entry",
);
// And asking again gives the same answer, which is what the cache is for.
assert.equal(
  resolveAvatarSrc(undefined, "sivert", teal),
  resolveAvatarSrc(undefined, "sivert", teal),
);

// Nothing to draw from at all.
assert.equal(resolveAvatarSrc(undefined, "", look), undefined);

console.log("avatar precedence ok");
