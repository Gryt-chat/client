/* eslint-env node */

/**
 * The dev fixtures, where being convincing is the whole requirement.
 *
 * Two properties, both of which look like taste until they break and then look
 * like bugs in the product rather than in the fixture.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { avatarSeed, owlAvatarColour } from "@gryt/owl";

const participants = readFileSync(
  new URL("../src/packages/socket/src/dev/fakeParticipants.ts", import.meta.url),
  "utf8",
);

const names = [...participants.matchAll(/^\s{2}"([^"]+)",$/gm)].map((m) => m[1]);
assert.ok(names.length >= 20, `only found ${names.length} fake names`);

/**
 * The front of the list is the voice grid, and the tiles are tinted from these
 * owls. The generator hands six of these names a colour another one already
 * has, so two people in one call can end up with the same bird on the same
 * tile — which reads as the tinting being broken rather than as a coincidence
 * (GRYT-648).
 */
const GRID = 18;
const front = names.slice(0, GRID).map((n) => owlAvatarColour(avatarSeed(n)));

assert.equal(
  new Set(front).size,
  GRID,
  `the first ${GRID} fake names must be ${GRID} different colours — ` +
    `duplicates belong at the back, where nothing sits them side by side`,
);

const chat = readFileSync(
  new URL("../src/packages/socket/src/dev/fakeChat.ts", import.meta.url),
  "utf8",
);

// The layouts the fixture exists to exercise. A conversation that reads better
// and stops covering these is a downgrade, and it is an easy one to make while
// rewriting the scripts.
for (const [what, pattern] of [
  ["a code block", /```ts/],
  ["a link preview", /https:\/\/gryt\.chat/],
  ["a mention", /@\$\{selfNickname\}/],
  ["markdown", /\*\*dette\*\*/],
  ["a wall of text", /lang melding/],
  ["a custom emoji on its own", /customOr\(emoji/],
  ["a reaction", /reactTo:/],
  ["two people at once", /together: true/],
]) {
  assert.match(chat, pattern, `the fake chat no longer covers ${what}`);
}

// Fixed intervals are what it was changed away from: every message landing on
// the same beat is the tell.
assert.doesNotMatch(chat, /setInterval/, "the fake chat is back on a fixed interval");

console.log(`Fake participant checks passed — ${GRID} distinct colours, ${names.length} names`);
