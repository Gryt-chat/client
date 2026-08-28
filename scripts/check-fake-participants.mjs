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

const card = readFileSync(
  new URL("../src/packages/socket/src/components/VoiceParticipantCard.tsx", import.meta.url),
  "utf8",
);

/**
 * The tile, the badge and the ring all come from one tint (GRYT-648).
 *
 * They used to be three separate calls, and two of them disagreed: the avatar
 * and the ring were drawn from the nickname while the tile passed
 * `serverUserId`, which for a fake participant is `fake-0`. So the tile was the
 * colour of an owl belonging to somebody who does not exist, sitting behind the
 * owl of somebody who does — and every one of these checks passed, because the
 * colour maths was right and only the seed was wrong.
 */
assert.match(
  card,
  /const tint = tileTint\(client\.nickname,/,
  "the card must derive one tint, from the nickname the avatar is drawn from",
);

assert.doesNotMatch(
  card,
  /tileGradient\(\s*client\.serverUserId/,
  "the tile is being tinted from the user id again, not from the avatar",
);

assert.match(card, /background: tileGradientFrom\(tint\)/);

console.log(`Fake participant checks passed — ${GRID} distinct colours, ${names.length} names`);
