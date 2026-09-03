/* eslint-env node */

/**
 * What the mention badge counts, checked without a browser.
 *
 * The store is the whole feature: the badge is one number read out of it, and
 * every way that number can be wrong is a way somebody is told they were asked
 * something when they were not, or not told when they were. The two that would
 * actually happen are here — a server answer that arrives after a mention has
 * already been read somewhere else, and reading a conversation on this machine.
 */

import assert from "node:assert/strict";

const {
  addMention,
  clearMentions,
  clearServerMentions,
  setMentionCounts,
} = await import("../src/packages/common/src/hooks/useMentionTracker.ts");

/** Peek at the store the way the hook does, without rendering anything. */
async function counts(host) {
  const { getMentionSnapshot } = await import(
    "../src/packages/common/src/hooks/useMentionTracker.ts"
  );
  return getMentionSnapshot().get(host) ?? new Map();
}

const HOST = "community.gryt.chat";
const OTHER = "gryt.example";

// ── what the server said ───────────────────────────────────────────

setMentionCounts(HOST, { general: 2, help: 1 });
assert.equal((await counts(HOST)).get("general"), 2);
assert.equal((await counts(HOST)).get("help"), 1);

// Replaces rather than merges. The server has just said what is unseen, so a
// conversation it did not name has been read somewhere else — on a phone, or
// in another window — and merging would keep a badge nothing can clear.
setMentionCounts(HOST, { general: 1 });
assert.equal((await counts(HOST)).has("help"), false, "help was read elsewhere");
assert.equal((await counts(HOST)).get("general"), 1);

// Nothing unseen is nothing held, not an empty map per host.
setMentionCounts(OTHER, {});
assert.equal((await counts(OTHER)).size, 0);

// A zero from the server is the same as an absence. It should not leave a
// badge drawing "0".
setMentionCounts(OTHER, { general: 0 });
assert.equal((await counts(OTHER)).size, 0, "a zero is not a mention");

// ── while connected ────────────────────────────────────────────────

addMention(HOST, "general");
assert.equal((await counts(HOST)).get("general"), 2, "one more on top");

addMention(HOST, "random");
assert.equal((await counts(HOST)).get("random"), 1, "a conversation with none yet");

// Servers are kept apart. Being named on one is not a badge on the other.
addMention(OTHER, "general");
assert.equal((await counts(OTHER)).get("general"), 1);
assert.equal((await counts(HOST)).get("general"), 2);

// ── reading them ───────────────────────────────────────────────────

clearMentions(HOST, "general");
assert.equal((await counts(HOST)).has("general"), false);
assert.equal((await counts(HOST)).get("random"), 1, "the rest stay");

// Clearing something with nothing in it is not an error and changes nothing.
clearMentions(HOST, "general");
assert.equal((await counts(HOST)).get("random"), 1);

clearServerMentions(HOST);
assert.equal((await counts(HOST)).size, 0);
assert.equal((await counts(OTHER)).get("general"), 1, "the other server is untouched");

console.log("mention tracker ok");
