/* eslint-env node */

/**
 * Which of the three kinds of avatar wins, checked against the real generator.
 *
 * There are three, and every one of them can be present at once: a look
 * somebody designed, a picture they uploaded, and the owl their nickname draws.
 * The order they outrank each other in is not obvious — the designed look beats
 * the upload — and it has to be, because saving a design uploads a PNG as well.
 * Get it backwards and the editor appears to do nothing: it saves, the picture
 * it just rendered wins, and the owl is frozen at 256px again, which is the
 * state this whole thing was built to leave behind.
 *
 * Runs against `@gryt/owl` rather than a stub, so a look that stops decoding —
 * a retired key, a registry that moved — fails here rather than in a member
 * list. Node 24 strips the types on import.
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

// An unreadable look costs the look, not the avatar. A string from a client
// newer than this one lands here, and the fallback has to be the picture rather
// than a blank.
assert.equal(resolveAvatarSrc(PICTURE, "sivert", "not a look"), PICTURE);
assert.ok(
  isDrawn(resolveAvatarSrc(undefined, "sivert", "not a look")),
  "an unreadable look should fall back to the seeded owl",
);

// A look overrides the seed for the fields it names, and only those. The editor
// sets every one of them, so two people who design the same owl get the same
// owl — the seed has nothing left to decide. That is the honest consequence of
// letting somebody choose, and it is the same as two people uploading the same
// photograph, but it is worth having written down: a designed avatar is not a
// unique one.
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

// The cache is keyed on the look as well as the seed. Without that, whichever
// look rendered first is the one that keeps coming back for that person, and
// changing your owl appears to do nothing until a reload.
//
// Two palettes rather than two arbitrary looks: the same seed can land on the
// same owl through two different strings — a look that names teal and a seed
// that picks teal anyway draw the same bird — so a weaker pair here would fail
// on a coincidence rather than on a cache bug.
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
