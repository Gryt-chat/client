/* eslint-env node */

/**
 * The cross-server conversation store, run as itself. One row per conversation,
 * never merged across hosts, newest first (GRYT-1134).
 */

import assert from "node:assert/strict";

import {
  directoryHostCount,
  forgetHost,
  getDirectorySnapshot,
  listedConversations,
  resetDirectory,
  setHostConversations,
} from "../src/packages/socket/src/hooks/dmDirectory.ts";

const conv = (id, at) => ({ conversation_id: id, last_message_at: at });
const ids = () => getDirectorySnapshot().map((e) => `${e.host}/${e.conversation.conversation_id}`);

resetDirectory();

// ── one server ─────────────────────────────────────────────────────────────
setHostConversations("a:1", [conv("dm_1", "2026-09-09T10:00:00Z")]);
assert.deepEqual(ids(), ["a:1/dm_1"]);

/* Two servers, two rows: the client cannot tell whether they are one person. */
setHostConversations("b:2", [conv("dm_9", "2026-09-09T12:00:00Z")]);
assert.deepEqual(ids(), ["b:2/dm_9", "a:1/dm_1"], "not newest first across hosts");
assert.equal(getDirectorySnapshot().length, 2, "two hosts collapsed into one row");

// ── newest first, whichever server it came from ─────────────────────────────
setHostConversations("a:1", [
  conv("dm_1", "2026-09-09T10:00:00Z"),
  conv("dm_2", "2026-09-09T23:00:00Z"),
]);
assert.deepEqual(ids(), ["a:1/dm_2", "b:2/dm_9", "a:1/dm_1"]);

/* A conversation with nothing in it sorts last rather than vanishing. */
setHostConversations("c:3", [conv("dm_new", null)]);
assert.equal(ids().at(-1), "c:3/dm_new", "an empty conversation was dropped or floated");

// ── a server's answer replaces its own rows and touches nobody else's ───────
setHostConversations("a:1", [conv("dm_2", "2026-09-09T23:00:00Z")]);
assert.deepEqual(ids(), ["a:1/dm_2", "b:2/dm_9", "c:3/dm_new"]);

// ── an empty answer removes the host entirely ──────────────────────────────
setHostConversations("c:3", []);
assert.deepEqual(ids(), ["a:1/dm_2", "b:2/dm_9"]);

/* Saying it again changes nothing: a host holding nothing and a host that was
   never there are the same answer. */
{
  const before = getDirectorySnapshot();
  setHostConversations("c:3", []);
  assert.equal(getDirectorySnapshot(), before, "a repeated empty answer rebuilt the list");
  setHostConversations("never-seen:9", []);
  assert.equal(getDirectorySnapshot(), before, "an empty answer from a new host rebuilt the list");

  /* Invisible in the list either way, so the count is the only thing that can
     say the map is not growing per server that answered with nothing. */
  assert.equal(directoryHostCount(), 2, "a host holding nothing is still in the map");
}

// ── disconnecting stops a host contributing ────────────────────────────────
forgetHost("b:2");
assert.deepEqual(ids(), ["a:1/dm_2"]);
forgetHost("b:2");
assert.deepEqual(ids(), ["a:1/dm_2"], "forgetting twice changed something");

/* ── the snapshot is stable when nothing changed ────────────────────────────
   useSyncExternalStore compares by identity, so a fresh array per read is an
   infinite render. This is the assertion that pins that. */
{
  const before = getDirectorySnapshot();
  assert.equal(getDirectorySnapshot(), before, "two reads gave two arrays");
  setHostConversations("a:1", [conv("dm_2", "2026-09-09T23:00:00Z")]);
  assert.equal(getDirectorySnapshot(), before, "an identical answer rebuilt the list");
}

// ── but a real change does produce a new snapshot ──────────────────────────
{
  const before = getDirectorySnapshot();
  setHostConversations("a:1", [conv("dm_2", "2026-09-10T01:00:00Z")]);
  assert.notEqual(getDirectorySnapshot(), before, "a newer message did not update the list");
}

/* ── ties go by server and id, not by which host answered first ─────────────
   Arrival order moves whenever a host drops and answers again. */
{
  resetDirectory();
  const same = "2026-09-11T08:00:00Z";
  setHostConversations("b:2", [conv("dm_b", same)]);
  setHostConversations("a:1", [conv("dm_z", same), conv("dm_a", same)]);
  assert.deepEqual(ids(), ["a:1/dm_a", "a:1/dm_z", "b:2/dm_b"], "a tie sorted by arrival");
  forgetHost("a:1");
  setHostConversations("a:1", [conv("dm_a", same), conv("dm_z", same)]);
  assert.deepEqual(ids(), ["a:1/dm_a", "a:1/dm_z", "b:2/dm_b"], "a host that answered again moved its tied rows");
  resetDirectory();
}

/* ── what the space lists ───────────────────────────────────────────────────
   Newest message on top. An empty conversation only while it is the open one,
   and then above everything, since it is where you are. */
{
  const entry = (host, id, at) => ({ host, conversation: conv(id, at) });
  const listed = (entries, visiting) =>
    listedConversations(entries, visiting).map((e) => `${e.host}/${e.conversation.conversation_id}`);

  const entries = [
    entry("a:1", "dm_old", "2026-09-01T10:00:00Z"),
    entry("b:2", "dm_empty", null),
    entry("a:1", "dm_new", "2026-09-12T10:00:00Z"),
    entry("c:3", "dm_other_empty", null),
    entry("b:2", "dm_mid", "2026-09-05T10:00:00Z"),
  ];
  assert.deepEqual(listed(entries, null), ["a:1/dm_new", "b:2/dm_mid", "a:1/dm_old"], "not newest first, or an empty conversation nobody has open is listed");
  assert.deepEqual(
    listed(entries, "dm_empty"),
    ["b:2/dm_empty", "a:1/dm_new", "b:2/dm_mid", "a:1/dm_old"],
    "the empty conversation you have open is not on top",
  );
  assert.deepEqual(listed(entries, "dm_mid"), ["a:1/dm_new", "b:2/dm_mid", "a:1/dm_old"], "visiting a written conversation moved it");

  const tied = [entry("b:2", "dm_1", "2026-09-12T10:00:00Z"), entry("a:1", "dm_9", "2026-09-12T10:00:00Z"), entry("a:1", "dm_2", "2026-09-12T10:00:00Z")];
  assert.deepEqual(listed(tied, null), ["a:1/dm_2", "a:1/dm_9", "b:2/dm_1"], "a tie is not broken by server and id");
  assert.deepEqual(listed([...tied].reverse(), null), listed(tied, null), "a tie depends on the order rows came in");

  const input = entries.map((e) => e);
  listedConversations(entries, "dm_empty");
  assert.deepEqual(entries, input, "listing sorted the directory's own array in place");
}

/* ── a new message moves a conversation that was already written in ─────────
   The server only says so for the first one, so the client bumps it. */
{
  const { isNewer } = await import("../src/packages/socket/src/hooks/useDirectMessages.ts");
  assert.equal(isNewer("2026-09-12T10:00:00Z", null), true, "a first message did not make the conversation real");
  assert.equal(isNewer("2026-09-12T10:00:01Z", "2026-09-12T10:00:00Z"), true, "a later message did not move the conversation");
  assert.equal(isNewer("2026-09-12T09:00:00Z", "2026-09-12T10:00:00Z"), false, "an older message, say a late echo, moved it back");
  assert.equal(isNewer("2026-09-12T10:00:00Z", "2026-09-12T10:00:00Z"), false, "the same message twice rewrote the conversation");
}

console.log("dm directory: one row per conversation per host, newest first, stable when unchanged");
