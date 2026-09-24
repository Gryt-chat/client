/* eslint-env node */

// A refused send got one automatic retry and then nothing: the second refusal
// matched no queue entry, so the row stayed pending for good. GRYT-1393.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "src/packages/socket/src/hooks/chatEventHandlers.ts";

/* The refusal half of the file, cut out rather than imported: the module pulls
   in react-hot-toast, which wants a DOM. */
const plain = stripTypeScriptTypes(readFileSync(join(root, SOURCE), "utf8"));
const from = plain.indexOf("const NON_RETRYABLE_ERRORS");
const to = plain.indexOf("// ── Fetch decision");
assert.ok(from !== -1 && to > from, `${SOURCE} no longer has a chat:error section to check.`);
const section = plain.slice(from, to).replaceAll("export function", "function").replaceAll("export const", "const");

/** The handler with its timers and its toast in hand, so a test can drive them. */
function load() {
  const timeouts = [];
  const intervals = [];
  const make = new Function(
    "handleRateLimitError",
    "setTimeout",
    "setInterval",
    "clearInterval",
    `${section}\nreturn handleChatErrorEvent;`,
  );
  const handle = make(
    () => {},
    (fn, ms) => {
      timeouts.push({ fn, ms });
      return timeouts.length;
    },
    (fn, ms) => {
      intervals.push({ fn, ms });
      return intervals.length;
    },
    () => {},
  );
  return { handle, timeouts, intervals };
}

/** One queued send and the two things a refusal can do with it. */
function refuse(error, retryCount) {
  const { handle, timeouts, intervals } = load();
  const entry = retryCount === null ? null : { retryCount };
  const queue = new Map(entry ? [["pending-1", entry]] : []);
  const calls = { retried: 0, failed: 0, rateLimited: [], countdown: 0, muted: [] };
  handle(error, "conversation-1", "key-1", {
    onMuted: (expiresAt) => calls.muted.push(expiresAt),
    setIsRateLimited: (v) => calls.rateLimited.push(v),
    setMessageCacheMeta: () => {},
    rateLimitIntervalRef: { current: null },
    setRateLimitCountdown: (v) => {
      calls.countdown = typeof v === "function" ? v(calls.countdown) : v;
    },
    onRetry: () => calls.retried++,
    onFail: () => calls.failed++,
    retryQueueRef: { current: queue },
  });
  for (const t of timeouts) t.fn();
  return { ...calls, get count() { return calls.countdown; }, tick: () => intervals.forEach((i) => i.fn()), timeouts, intervals, calls };
}

const RATE_LIMITED = { error: "rate_limited", retryAfterMs: 30_000, message: "Too fast. Wait 30s." };

// A first refusal is worth another go.
const firstRateLimit = refuse(RATE_LIMITED, 0);
assert.equal(firstRateLimit.retried, 1, "a rate-limited send should be tried again");
assert.equal(firstRateLimit.failed, 0, "the first refusal should not fail the row");
assert.equal(firstRateLimit.timeouts[0].ms, 30_000, "the retry should wait as long as the server said");

// The second is not, and this is the one that used to leave the row pending.
const secondRateLimit = refuse(RATE_LIMITED, 1);
assert.equal(secondRateLimit.retried, 0, "a send that has already been retried should not go again");
assert.equal(secondRateLimit.failed, 1, "a second refusal should fail the row and hand the text back");

// The same two strikes for anything else the server refuses.
const firstOther = refuse("Failed to send message", 0);
assert.equal(firstOther.retried, 1, "an ordinary refusal should be tried again");
assert.equal(firstOther.timeouts[0].ms, 3000, "that retry waits three seconds");
const secondOther = refuse("Failed to send message", 1);
assert.equal(secondOther.failed, 1, "a second ordinary refusal should fail the row");

// Some refusals are pointless to repeat.
const refusedOutright = refuse("Message is empty", 0);
assert.equal(refusedOutright.retried, 0, "an empty message is not worth sending twice");
assert.equal(refusedOutright.failed, 1, "and the row should say so at once");

// A refused fetch carries no queued send, and must not fail somebody else's.
const nothingQueued = refuse(RATE_LIMITED, null);
assert.equal(nothingQueued.failed, 0, "a refusal with nothing queued should fail nothing");
assert.equal(nothingQueued.retried, 0, "and retry nothing");

/* The wait the composer shows is its own. It used to carry the retry as well,
   and it is cleared on the next render, so the retry never went out. */
const countdown = refuse(RATE_LIMITED, 1);
assert.equal(countdown.count, 30, "the composer counts down the wait the server named");
assert.equal(countdown.intervals.length, 1, "on one interval");
assert.deepEqual(countdown.calls.rateLimited, [true], "and the composer locks while it runs");
const retriedBefore = countdown.calls.retried;
for (let i = 0; i < 30; i++) countdown.tick();
assert.equal(countdown.count, 0, "the countdown should reach zero");
assert.equal(countdown.calls.rateLimited.at(-1), false, "and unlock the composer");
assert.equal(countdown.calls.retried, retriedBefore, "without sending anything of its own");

/* A mute lasts minutes or hours, so the retry would only be refused again and
   the composer says so in words instead. GRYT-1400. */
const MUTED = { error: "muted", expiresAt: "2026-09-24T14:30:00.000Z", message: "You are muted on this server until 2026-09-24T14:30:00.000Z." };
const muted = refuse(MUTED, 0);
assert.equal(muted.retried, 0, "a muted send should not be tried again");
assert.equal(muted.failed, 1, "it should fail the row at once");
assert.deepEqual(muted.muted, ["2026-09-24T14:30:00.000Z"], "and hand the composer the expiry the server named");
assert.deepEqual(muted.rateLimited, [], "a mute is not a rate limit, so the countdown stays out of it");

const mutedForever = refuse({ error: "muted", expiresAt: null, message: "You are muted on this server." }, 0);
assert.deepEqual(mutedForever.muted, [null], "a mute with no end reads as no expiry rather than as no mute");
assert.equal(mutedForever.failed, 1, "and still fails the row");

// ── A burst, where each refusal names its send (GRYT-1410) ──────────

/* Four sends refused at once. Without a name, every refusal landed on the last
   row queued, and the three before it stayed pending until a reload. */
function burst(retryCount, refs) {
  const { handle, timeouts } = load();
  const queue = new Map(
    ["a", "b", "c", "d"].map((id) => [`pending-${id}`, { nonce: `nonce-${id}`, retryCount }]),
  );
  const calls = { retried: [], failed: [] };
  const deps = {
    setIsRateLimited: () => {},
    setMessageCacheMeta: () => {},
    rateLimitIntervalRef: { current: null },
    setRateLimitCountdown: () => {},
    onRetry: (id) => calls.retried.push(id),
    onFail: (id) => calls.failed.push(id),
    retryQueueRef: { current: queue },
  };
  for (const ref of refs) handle(RATE_LIMITED, "conversation-1", "key-1", deps, ref);
  for (const t of timeouts) t.fn();
  return calls;
}

const named = ["a", "b", "c", "d"].map((id) => ({ nonce: `nonce-${id}` }));
const firstBurst = burst(0, named);
assert.deepEqual(firstBurst.retried, ["pending-a", "pending-b", "pending-c", "pending-d"], "each refused send should be retried, and only once");
assert.deepEqual(firstBurst.failed, [], "a first refusal fails nothing");

const secondBurst = burst(1, named);
assert.deepEqual(secondBurst.failed, ["pending-a", "pending-b", "pending-c", "pending-d"], "a second refusal fails the row it names, so none is left pending");
assert.deepEqual(secondBurst.retried, [], "and sends nothing again");

// A reply in a thread shares chat:error but not this queue, so its refusal is left to the panel.
const elsewhere = burst(1, [{ nonce: "nonce-thread-reply" }]);
assert.deepEqual(elsewhere, { retried: [], failed: [] }, "a nonce this queue does not hold should settle nothing here");

/* A server from before GRYT-1410 names nothing. Then it is the last row, and the
   send hook is handed no id so it picks the row the way it always did. */
const unnamed = burst(1, [undefined, undefined]);
assert.deepEqual(unnamed.failed, [undefined, undefined], "an older server's refusal still fails a row, chosen as before");
const unnamedFirst = burst(0, [undefined]);
assert.deepEqual(unnamedFirst.retried, [undefined], "and still earns the one retry");

// ── The mute the composer draws ─────────────────────────────────────

const STORE = "src/packages/socket/src/hooks/textMute.ts";
const storeSource = stripTypeScriptTypes(readFileSync(join(root, STORE), "utf8"));
const storeFrom = storeSource.indexOf("const mutes = new Map");
const storeTo = storeSource.indexOf("function subscribe");
assert.ok(storeFrom !== -1 && storeTo > storeFrom, `${STORE} no longer has a store to check.`);
const hooksFrom = storeSource.indexOf("export function muteLiftsAt");
assert.ok(hooksFrom > storeTo, `${STORE} no longer exports muteLiftsAt.`);
const storeSlice = (storeSource.slice(storeFrom, storeTo) + storeSource.slice(hooksFrom))
  .replaceAll("export function", "function")
  .replaceAll("export const", "const");

/** The store with its timers in hand, so a lapsing mute can be driven. */
function loadStore() {
  const pending = [];
  const make = new Function(
    "setTimeout",
    "clearTimeout",
    `${storeSlice}\nreturn { setTextMute, noteServerMute, textMuteFor, resetTextMutes, muteLiftsAt, parseMuteExpiry };`,
  );
  const api = make(
    (fn, ms) => {
      pending.push({ fn, ms });
      return pending.length;
    },
    () => {},
  );
  return { ...api, pending };
}

const store = loadStore();
const HOST = "chat.example:5001";

store.setTextMute(HOST, { until: new Date(Date.now() + 60_000) });
assert.ok(store.textMuteFor(HOST), "a mute the server just pushed should be in force");
assert.equal(store.textMuteFor("other.example:5001"), null, "and only on the server that sent it");

store.setTextMute(HOST, { until: new Date(Date.now() - 1000) });
assert.equal(store.textMuteFor(HOST), null, "a mute whose end has passed is over");

/* The member list caches the flag per socket, so it still reads muted after one
   lapses. Believing it would lock the composer again with nothing to lift it. */
store.noteServerMute(HOST, true);
assert.equal(store.textMuteFor(HOST), null, "a stale member list should not restart a mute that has ended");

store.setTextMute(HOST, null);
store.noteServerMute(HOST, true);
const fromList = store.textMuteFor(HOST);
assert.ok(fromList, "a member list is how somebody muted before this session finds out");
assert.equal(fromList.until, null, "and it carries no end, because the list does not send one");

store.noteServerMute(HOST, false);
assert.equal(store.textMuteFor(HOST), null, "an unmute clears it");

assert.equal(store.parseMuteExpiry("not a date"), null, "junk from the wire is no expiry");
assert.equal(store.parseMuteExpiry(null), null, "and neither is a missing one");
assert.ok(store.parseMuteExpiry("2026-09-24T14:30:00.000Z") instanceof Date, "an ISO timestamp is");

const today = new Date();
today.setHours(14, 30, 0, 0);
assert.ok(!/\d{4}/.test(store.muteLiftsAt(today)), "a mute lifting today is named by the time alone");
const later = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
assert.ok(store.muteLiftsAt(later).includes(","), "one lifting another day carries the date too");

console.log("chat retry: a refused send is tried once and then fails, a burst settles every row it names, and a mute is not retried at all");
