/* eslint-env node */

// History and live messages come out in one order. Messages that reached a DM before its
// history loaded were drawn above all of it. GRYT-1217.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS = "src/packages/socket/src/hooks";
const HANDLERS = `${HOOKS}/chatEventHandlers.ts`;

const { mergeMessages } = await import(pathToFileURL(join(root, HOOKS, "mergeMessages.ts")).href);

const T0 = Date.parse("2026-09-15T12:00:00.000Z");
const at = (seconds) => new Date(T0 + seconds * 1000).toISOString();

function message(id, seconds, extra = {}) {
  return {
    conversation_id: "dm",
    message_id: id,
    sender_server_id: "kestrel",
    text: id,
    attachments: null,
    created_at: at(seconds),
    reactions: null,
    ...extra,
  };
}

const ids = (list) => list.map((m) => m.message_id);

// ── mergeMessages ───────────────────────────────────────────────────

// Interleaved: live messages go where their time puts them, whichever side they came from.
{
  const live = [message("order-check-three", 30), message("order-check-four", 40)];
  const page = [message("one", 10), message("two", 20), message("order-check-three", 30), message("three-and-a-half", 35), message("order-check-four", 40)];
  assert.deepEqual(
    ids(mergeMessages(live, page)),
    ["one", "two", "order-check-three", "three-and-a-half", "order-check-four"],
    "a first page merged after live messages draws the history below them",
  );

  const newerThanThePage = [message("after-the-read", 50)];
  assert.deepEqual(
    ids(mergeMessages(newerThanThePage, [message("one", 10), message("two", 20)])),
    ["one", "two", "after-the-read"],
    "a live message newer than the whole page is drawn above it",
  );

  const older = [message("zero", 5), message("half", 7)];
  assert.deepEqual(
    ids(mergeMessages([message("one", 10), message("two", 20)], older)),
    ["zero", "half", "one", "two"],
    "an older page is not put in front",
  );

  const outOfOrder = mergeMessages([], [message("late", 20), message("early", 10)]);
  assert.deepEqual(ids(outOfOrder), ["early", "late"], "a page out of order is not put right");
}

// The same millisecond: the lower id first, as the server's ORDER BY created_at, message_id.
{
  const tie = mergeMessages([message("b-id", 10)], [message("a-id", 10), message("c-id", 10)]);
  assert.deepEqual(ids(tie), ["a-id", "b-id", "c-id"], "a tie is not broken by message id");

  const asDate = message("from-a-date", 15, { created_at: new Date(T0 + 15_000) });
  assert.deepEqual(
    ids(mergeMessages([asDate], [message("before", 10), message("after", 20)])),
    ["before", "from-a-date", "after"],
    "a Date and an ISO string do not sort together",
  );
}

// Duplicates: one row per id, and the held copy keeps what this device worked out.
{
  const opened = message("sealed", 10, { text: "hello", sealed: "envelope", sealedState: "open" });
  const fromPage = message("sealed", 10, { text: null, sealed: "envelope" });
  const merged = mergeMessages([opened, message("live", 20)], [fromPage, message("live", 20), message("older", 5)]);

  assert.deepEqual(ids(merged), ["older", "sealed", "live"], "a message in both lists is drawn twice");
  assert.equal(merged[1], opened, "the page's copy replaced the held one and lost its decrypted text");
}

// Pending: kept, and after everything with a server time, since it has none yet.
{
  const pending = message("pending-1", 15, { pending: true, created_at: new Date(T0 + 15_000) });
  const second = message("pending-2", 16, { pending: true, created_at: new Date(T0 + 16_000) });
  const merged = mergeMessages([second, pending], [message("one", 10), message("two", 20)]);

  assert.deepEqual(ids(merged), ["one", "two", "pending-1", "pending-2"], "pending messages are lost or out of place");
  assert.equal(merged[2], pending, "the pending message is not the same object");

  const failed = message("pending-failed", 15, { failed: true, created_at: new Date(T0 + 15_000) });
  assert.deepEqual(
    ids(mergeMessages([failed], [message("one", 10), message("two", 20)])),
    ["one", "pending-failed", "two"],
    "a failed message does not stay where it was sent",
  );
}

// Edited: whichever copy has the later edit wins.
{
  const editedLive = message("edited", 10, { text: "after", edited_at: at(60) });
  const stalePage = message("edited", 10, { text: "before", edited_at: null });
  assert.equal(mergeMessages([editedLive], [stalePage])[0].text, "after", "a page read before an edit undid it");

  const heldBefore = message("edited", 10, { text: "before" });
  const editedAway = message("edited", 10, { text: "after", edited_at: at(60) });
  assert.equal(mergeMessages([heldBefore], [editedAway])[0].text, "after", "an edit made while away never showed");

  const twice = mergeMessages([message("edited", 10, { text: "second", edited_at: at(90) })], [message("edited", 10, { text: "first", edited_at: at(60) })]);
  assert.equal(twice[0].text, "second", "an older edit replaced a newer one");
}

// Deleted: an id in `deleted` stays out, from either side.
{
  const deleted = new Set(["gone"]);
  const merged = mergeMessages([message("one", 10), message("gone", 15)], [message("gone", 15), message("two", 20)], deleted);
  assert.deepEqual(ids(merged), ["one", "two"], "a deleted message came back");
}

// Neither input is changed.
{
  const held = [message("b", 20), message("a", 10)];
  const incoming = [message("c", 5)];
  mergeMessages(held, incoming);
  assert.deepEqual(ids(held), ["b", "a"]);
  assert.deepEqual(ids(incoming), ["c"]);
}

// ── the socket handlers ─────────────────────────────────────────────

/* Run from source with the real mergeMessages in scope, so a handler that merges
   some other way fails here and not only in the list above. */
const plain = stripTypeScriptTypes(readFileSync(join(root, HANDLERS), "utf8"));

function declaration(name) {
  const signature = `export function ${name}(`;
  const found = plain.indexOf(signature);
  assert.notEqual(found, -1, `${HANDLERS} no longer has ${name}. Move this check with it.`);
  const start = plain.indexOf("{", found + signature.length);
  let depth = 0;
  for (let i = start; i < plain.length; i++) {
    if (plain[i] === "{") depth++;
    else if (plain[i] === "}" && --depth === 0) return plain.slice(found + "export ".length, i + 1);
  }
  throw new Error(`unbalanced braces after ${name} in ${HANDLERS}`);
}

const NAMES = ["handleNewMessage", "handleHistoryPayload", "handleMessageEdited", "handleMessageDeleted"];
const handlers = new Function("mergeMessages", `${NAMES.map(declaration).join("\n")}\nreturn { ${NAMES.join(", ")} };`)(
  mergeMessages,
);

const KEY = (conversationId) => `host::${conversationId}`;

/** React's state for one useChat, with updaters applied as they come. */
function chat(activeConversationId) {
  const state = { active: activeConversationId, cache: {}, list: [], deleted: new Set(), inFlight: { current: new Set() } };
  const apply = (field) => (update) => {
    state[field] = typeof update === "function" ? update(state[field]) : update;
  };
  const setCache = apply("cache");
  const setList = apply("list");
  return {
    state,
    live: (msg) => handlers.handleNewMessage(msg, state.active, KEY, setCache, setList, state.deleted),
    history: (conversationId, items, before) =>
      handlers.handleHistoryPayload(
        { conversation_id: conversationId, items, hasMore: false, ...(before ? { before } : {}) },
        state.active, KEY, state.inFlight, setCache, setList, () => {}, () => {}, () => {}, state.deleted,
      ),
    edited: (msg) => handlers.handleMessageEdited(msg, state.active, KEY, setCache, setList),
    removed: (conversationId, messageId) =>
      handlers.handleMessageDeleted({ conversation_id: conversationId, message_id: messageId }, state.active, KEY, setCache, setList, state.deleted),
    /** What useChat's conversation effect does: the list starts as the cache. */
    open: (conversationId) => {
      state.active = conversationId;
      state.list = state.cache[KEY(conversationId)] ?? [];
    },
    /** What useChatSend does with the optimistic copy: onto the end of both. */
    sent: (msg) => {
      state.list = [...state.list, msg];
      state.cache = { ...state.cache, [KEY(state.active)]: [...(state.cache[KEY(state.active)] ?? []), msg] };
    },
  };
}

const olderHistory = () => [message("check-one", 10), message("check-two", 20)];

// The report: two live messages into a DM nobody had open, then its first page.
{
  const blizzard = chat("general");
  blizzard.live(message("check-three", 30));
  blizzard.live(message("check-four", 40));
  blizzard.open("dm");
  blizzard.history("dm", [...olderHistory(), message("check-three", 30), message("check-four", 40)]);

  const expected = ["check-one", "check-two", "check-three", "check-four"];
  assert.deepEqual(ids(blizzard.state.list), expected, "the live messages are drawn above the history");
  assert.deepEqual(ids(blizzard.state.cache[KEY("dm")]), expected, "the cache holds the live messages above the history");
}

// A channel takes the same path, and a page that arrives for a closed one still sorts.
{
  const member = chat("general");
  member.live(message("live-in-random", 30, { conversation_id: "random" }));
  member.history("random", [message("old-in-random", 10, { conversation_id: "random" })]);
  assert.deepEqual(ids(member.state.cache[KEY("random")]), ["old-in-random", "live-in-random"]);
  assert.deepEqual(member.state.list, [], "a closed conversation's page reached the open list");
}

// Scrolling back: an older page goes in front of what is held.
{
  const member = chat("dm");
  member.history("dm", olderHistory());
  member.history("dm", [message("check-zero", 5)], at(10));
  assert.deepEqual(ids(member.state.list), ["check-zero", "check-one", "check-two"]);
}

// Pending: sent before the first page came back, it survives the page and its confirmation sorts.
{
  const member = chat("dm");
  member.open("dm");
  member.sent(message("pending-x", 25, { pending: true, nonce: "n1", sender_server_id: "me", created_at: new Date(T0 + 25_000) }));
  member.history("dm", olderHistory());
  assert.deepEqual(ids(member.state.list), ["check-one", "check-two", "pending-x"], "the first page dropped or moved a pending message");

  member.live(message("from-kestrel", 26));
  assert.deepEqual(ids(member.state.list), ["check-one", "check-two", "from-kestrel", "pending-x"]);
  assert.deepEqual(ids(member.state.cache[KEY("dm")]), ids(member.state.list), "the cache and the list disagree on order");

  member.live(message("confirmed-x", 27, { nonce: "n1", sender_server_id: "me" }));
  assert.deepEqual(
    ids(member.state.list),
    ["check-one", "check-two", "from-kestrel", "confirmed-x"],
    "the confirmation left the pending copy behind or went in out of order",
  );
  assert.deepEqual(ids(member.state.cache[KEY("dm")]), ids(member.state.list), "the cache and the list disagree on order");

  member.live(message("confirmed-x", 27, { nonce: "n1", sender_server_id: "me" }));
  assert.equal(ids(member.state.list).filter((id) => id === "confirmed-x").length, 1, "a repeated chat:new drew the message twice");
}

// Edited: an edit that reached the cache first survives a page read before it.
{
  const member = chat("general");
  member.live(message("check-three", 30));
  member.edited(message("check-three", 30, { text: "fixed", edited_at: at(45) }));
  member.open("dm");
  member.history("dm", [...olderHistory(), message("check-three", 30)]);
  assert.equal(member.state.list.at(-1).text, "fixed", "a stale page undid an edit");
  assert.equal(member.state.cache[KEY("dm")].at(-1).text, "fixed");
}

// Deleted: a page the server read before a delete doesn't bring the message back.
{
  const member = chat("dm");
  member.history("dm", olderHistory());
  member.live(message("check-three", 30));
  member.removed("dm", "check-three");
  member.history("dm", [...olderHistory(), message("check-three", 30)]);
  assert.deepEqual(ids(member.state.list), ["check-one", "check-two"], "a page read before the delete brought the message back");

  const closed = chat("general");
  closed.removed("dm", "check-two");
  closed.open("dm");
  closed.history("dm", olderHistory());
  assert.deepEqual(ids(closed.state.list), ["check-one"], "a delete in a closed conversation came back with its first page");
}

console.log("history merge: one order, no duplicates, pending, edits and deletes kept");
