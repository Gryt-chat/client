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
  const calls = { retried: 0, failed: 0, rateLimited: [], countdown: 0 };
  handle(error, "conversation-1", "key-1", {
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

console.log("chat retry: a refused send is tried once and then fails");
