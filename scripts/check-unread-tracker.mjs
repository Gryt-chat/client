/* eslint-env node */

/**
 * What the unread badge counts, checked without a browser. It replaced a flag, so
 * a second message in one channel now adds rather than doing nothing.
 */

import assert from "node:assert/strict";

const {
  getUnreadSnapshot,
  markChannelRead,
  markChannelUnread,
  markServerRead,
} = await import("../src/packages/common/src/hooks/useUnreadTracker.ts");

const counts = (host) => getUnreadSnapshot().get(host) ?? new Map();
const total = (host) => [...counts(host).values()].reduce((a, b) => a + b, 0);

const HOST = "community.gryt.chat";
const OTHER = "gryt.test:5001";

// Nothing has happened yet.
assert.equal(total(HOST), 0);

// One message, then a second in the same channel. The second is the whole
// point: under the flag it was a no-op.
markChannelUnread(HOST, "general");
assert.equal(counts(HOST).get("general"), 1);
markChannelUnread(HOST, "general");
assert.equal(counts(HOST).get("general"), 2);

// A different channel counts separately, and the server totals both.
markChannelUnread(HOST, "random");
assert.equal(counts(HOST).get("random"), 1);
assert.equal(total(HOST), 3);

// Another server's messages are not this one's.
markChannelUnread(OTHER, "general");
assert.equal(total(HOST), 3);
assert.equal(total(OTHER), 1);

// Opening a channel clears it outright, and leaves the rest of the server.
markChannelRead(HOST, "general");
assert.equal(counts(HOST).get("general"), undefined);
assert.equal(total(HOST), 1);

// Reading a channel that has nothing waiting changes nothing, and does not
// leave an empty entry behind for the next reader to trip over.
const before = getUnreadSnapshot();
markChannelRead(HOST, "general");
assert.equal(getUnreadSnapshot(), before);

// The last channel read takes the server out of the map rather than leaving an
// empty count map, so "does this server have anything" is one lookup.
markChannelRead(HOST, "random");
assert.equal(getUnreadSnapshot().has(HOST), false);

// Marking a whole server read takes everything in it.
markChannelUnread(HOST, "general");
markChannelUnread(HOST, "random");
assert.equal(total(HOST), 2);
markServerRead(HOST);
assert.equal(total(HOST), 0);
// And leaves the other server alone.
assert.equal(total(OTHER), 1);

console.log("unread tracker: ok");
