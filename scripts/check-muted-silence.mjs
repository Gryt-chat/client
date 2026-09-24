/* eslint-env node */

/**
 * A muted channel, folder or server shows nothing: no unread count, no badge.
 * The global ceiling is a different question and does not count as "muted".
 */

import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  isChannelMuted,
  rememberPlacements,
  setGlobalLevel,
  setNotificationLevel,
  visibleCounts,
} = await import("../src/packages/common/src/hooks/notificationPrefs.ts");

const HOST = "gryt.test:5001";

rememberPlacements(
  HOST,
  [
    { kind: "channel", channelId: "general", parentItemId: null },
    { kind: "channel", channelId: "off-topic", parentItemId: "f1" },
  ],
  [],
);

// ── Nothing muted yet ────────────────────────────────────────────────────────

assert.equal(isChannelMuted(HOST, "general"), false);
assert.equal(isChannelMuted(HOST, "off-topic"), false);
// A channel this client has no placement for reads as unmuted rather than
// guessed at.
assert.equal(isChannelMuted(HOST, "nowhere"), false);

// ── Set on the channel itself ───────────────────────────────────────────────

setNotificationLevel(HOST, { kind: "channel", id: "general" }, "none");
assert.equal(isChannelMuted(HOST, "general"), true);
assert.equal(isChannelMuted(HOST, "off-topic"), false, "a sibling channel is unaffected");
setNotificationLevel(HOST, { kind: "channel", id: "general" }, null);

// ── Inherited from a muted folder ───────────────────────────────────────────

setNotificationLevel(HOST, { kind: "folder", id: "f1" }, "none");
assert.equal(isChannelMuted(HOST, "off-topic"), true);
assert.equal(isChannelMuted(HOST, "general"), false, "outside the folder");
setNotificationLevel(HOST, { kind: "folder", id: "f1" }, null);

// ── Inherited from a muted server ───────────────────────────────────────────

setNotificationLevel(HOST, { kind: "server" }, "none");
assert.equal(isChannelMuted(HOST, "general"), true);
assert.equal(isChannelMuted(HOST, "off-topic"), true);

// A channel turned up on purpose stays that way even under a muted server —
// the same rule `resolveLevel` already applies to sound and toasts.
setNotificationLevel(HOST, { kind: "channel", id: "general" }, "all");
assert.equal(isChannelMuted(HOST, "general"), false);
setNotificationLevel(HOST, { kind: "channel", id: "general" }, null);
setNotificationLevel(HOST, { kind: "server" }, null);

// ── The global ceiling does not count as "muted" here ───────────────────────
//
// It quietens sound and toasts everywhere (resolveAnnounceLevel), but a
// channel nobody muted should not read as muted just because of it.

setGlobalLevel("none");
assert.equal(isChannelMuted(HOST, "general"), false);
setGlobalLevel("all");

// ── visibleCounts ────────────────────────────────────────────────────────────

setNotificationLevel(HOST, { kind: "channel", id: "general" }, "none");

const counts = new Map([
  ["general", 3],
  ["off-topic", 1],
]);
const visible = visibleCounts(HOST, counts);
assert.equal(visible.has("general"), false, "the muted channel is left out");
assert.equal(visible.get("off-topic"), 1, "the rest comes through unchanged");
assert.equal(counts.get("general"), 3, "the original map is untouched");

// Nothing to remove: the same map comes back, not a copy.
const untouched = new Map([["off-topic", 1]]);
assert.equal(visibleCounts(HOST, untouched), untouched);

setNotificationLevel(HOST, { kind: "channel", id: "general" }, null);

console.log("muted silence: ok");
