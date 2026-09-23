/* eslint-env node */

/**
 * Which conversations are hidden, given what this device stored and what the
 * server last sent. Hiding never leaves the device, so nothing else checks it.
 */

import assert from "node:assert/strict";

/* A store, since the module reads and writes one at import time and node has
   none. Kept deliberately dumb: the point is the rules above it. */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  hideConversation,
  hiddenFor,
  isBackFromHiding,
  resetHiddenConversations,
  showConversation,
  splitHidden,
} = await import("../src/packages/socket/src/hooks/hiddenConversations.ts");

const HOST = "a:5001";
const ME = "server-user-me";

const entry = (id, at, host = HOST) => ({
  host,
  conversation: { conversation_id: id, last_message_at: at },
});

const split = (entries, now) =>
  splitHidden(entries, (host) => hiddenFor(host, ME), now);
const idsOf = (rows) => rows.map((r) => r.conversation.conversation_id);

// ── nothing hidden ─────────────────────────────────────────────────────────
resetHiddenConversations();
store.clear();
{
  const rows = [entry("dm_1", "2026-09-20T10:00:00Z"), entry("dm_2", null)];
  const { listed, hidden, returned } = split(rows, Date.parse("2026-09-21T00:00:00Z"));
  assert.deepEqual(idsOf(listed), ["dm_1", "dm_2"]);
  assert.deepEqual(hidden, []);
  assert.deepEqual(returned, []);
}

// ── hidden, and still hidden ───────────────────────────────────────────────
{
  const hiddenAt = Date.parse("2026-09-21T00:00:00Z");
  hideConversation(HOST, ME, "dm_1", hiddenAt);

  const rows = [entry("dm_1", "2026-09-20T10:00:00Z"), entry("dm_2", null)];
  const { listed, hidden } = split(rows, hiddenAt + 1000);
  assert.deepEqual(idsOf(listed), ["dm_2"], "the hidden row stayed in the list");
  assert.deepEqual(idsOf(hidden), ["dm_1"]);
}

// ── a message after it was hidden brings it back ───────────────────────────
{
  const hiddenAt = Date.parse("2026-09-21T00:00:00Z");
  const rows = [entry("dm_1", "2026-09-21T09:00:00Z")];
  const { listed, hidden, returned } = split(rows, hiddenAt + 1000);
  assert.deepEqual(idsOf(listed), ["dm_1"], "a newer message did not bring it back");
  assert.deepEqual(hidden, []);
  assert.deepEqual(idsOf(returned), ["dm_1"], "the stored entry was not offered up for dropping");
}

/* The same instant is not "after": the message the conversation was hidden on
   would otherwise put it straight back. */
{
  const hiddenAt = Date.parse("2026-09-21T00:00:00Z");
  assert.equal(isBackFromHiding(hiddenAt, "2026-09-21T00:00:00Z", hiddenAt + 1000), false);
  assert.equal(isBackFromHiding(hiddenAt, "2026-09-21T00:00:00.001Z", hiddenAt + 1000), true);
}

// ── a conversation nobody has written in ───────────────────────────────────
{
  // Nothing to compare against, so it stays hidden until somebody writes.
  assert.equal(isBackFromHiding(Date.parse("2026-09-21T00:00:00Z"), null), false);
  assert.equal(isBackFromHiding(Date.parse("2026-09-21T00:00:00Z"), undefined), false);
  assert.equal(isBackFromHiding(Date.parse("2026-09-21T00:00:00Z"), "not a date"), false);
}

/* ── a clock that went backwards ────────────────────────────────────────────
   Hidden at a time that is now in the future. Without the clamp the stored
   moment beats every message ever sent, and the row never comes back. */
{
  const now = Date.parse("2026-09-21T00:00:00Z");
  const hiddenAt = Date.parse("2027-01-01T00:00:00Z");
  assert.equal(
    isBackFromHiding(hiddenAt, "2026-09-21T00:00:01Z", now),
    true,
    "a clock that went backwards left it hidden for good",
  );
  // A message from before now still leaves it hidden, clock or no clock.
  assert.equal(isBackFromHiding(hiddenAt, "2026-09-20T23:59:59Z", now), false);
}

// ── put back by hand ───────────────────────────────────────────────────────
{
  resetHiddenConversations();
  store.clear();
  const hiddenAt = Date.parse("2026-09-21T00:00:00Z");
  hideConversation(HOST, ME, "dm_1", hiddenAt);
  assert.deepEqual(Object.keys(hiddenFor(HOST, ME)), ["dm_1"]);

  showConversation(HOST, ME, "dm_1");
  assert.deepEqual(hiddenFor(HOST, ME), {}, "putting it back left the entry behind");

  const { listed, hidden } = split([entry("dm_1", null)], hiddenAt + 1000);
  assert.deepEqual(idsOf(listed), ["dm_1"]);
  assert.deepEqual(hidden, []);
}

/* ── one account's list is its own ──────────────────────────────────────────
   Two servers, and the same person signed in twice. Neither reads the other. */
{
  resetHiddenConversations();
  store.clear();
  const hiddenAt = Date.parse("2026-09-21T00:00:00Z");
  hideConversation(HOST, ME, "dm_1", hiddenAt);

  assert.deepEqual(hiddenFor("b:5001", ME), {}, "another host saw this host's list");
  assert.deepEqual(hiddenFor(HOST, "somebody-else"), {}, "another account on the same host saw it");

  const rows = [entry("dm_1", null), entry("dm_1", null, "b:5001")];
  const { listed, hidden } = split(rows, hiddenAt + 1000);
  assert.deepEqual(idsOf(hidden), ["dm_1"]);
  assert.equal(listed.length, 1, "the same id on another server went with it");
  assert.equal(listed[0].host, "b:5001");
}

// ── what was hidden survives a restart ─────────────────────────────────────
{
  const hiddenAt = Date.parse("2026-09-21T00:00:00Z");
  resetHiddenConversations();
  assert.deepEqual(Object.keys(hiddenFor(HOST, ME)), ["dm_1"], "it was not read back from storage");
  assert.equal(hiddenFor(HOST, ME).dm_1, hiddenAt, "the moment it was hidden did not survive");
}

/* ── storage that throws ────────────────────────────────────────────────────
   A private window, or a browser with site data blocked. The list has to draw. */
{
  const kept = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  };

  resetHiddenConversations();
  assert.deepEqual(hiddenFor(HOST, ME), {}, "a reading failure was not survivable");

  const now = Date.parse("2026-09-21T00:00:00Z");
  hideConversation(HOST, ME, "dm_1", now);
  assert.deepEqual(Object.keys(hiddenFor(HOST, ME)), ["dm_1"], "a write that threw lost the session");
  const { hidden } = split([entry("dm_1", null)], now + 1000);
  assert.deepEqual(idsOf(hidden), ["dm_1"]);

  globalThis.localStorage = kept;
}

/* ── stored nonsense ────────────────────────────────────────────────────────
   Somebody else's key, or a half-written one. Read as nothing hidden. */
{
  resetHiddenConversations();
  store.clear();
  store.set(`gryt:hiddenConversations:${HOST}:${ME}`, "[not json");
  assert.deepEqual(hiddenFor(HOST, ME), {});

  resetHiddenConversations();
  store.set(`gryt:hiddenConversations:${HOST}:${ME}`, '["dm_1"]');
  assert.deepEqual(hiddenFor(HOST, ME), {}, "an array was read as a hidden list");

  resetHiddenConversations();
  store.set(`gryt:hiddenConversations:${HOST}:${ME}`, '{"dm_1":"yesterday","dm_2":5}');
  assert.deepEqual(hiddenFor(HOST, ME), { dm_2: 5 }, "a value that is not a number was kept");
}

console.log(
  "hidden conversations: hidden per host and account, back on a newer message, and safe without storage",
);
