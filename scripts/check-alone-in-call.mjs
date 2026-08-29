/* eslint-env node */

/**
 * The countdown that ends a call nobody else is in (GRYT-711).
 *
 * The boundaries are the whole of this. A notice that appears a second late is
 * invisible against a thirty-second window; one that ends at one instead of
 * zero hangs up while the screen still says there is a second left; one that
 * never reaches `ended` leaves the call up until the SFU drops the socket,
 * which is the behaviour this was written to replace. None of those fail to
 * compile and none of them look wrong in the source.
 *
 * The rest of the hook is React and a `setInterval`. What is asserted here is
 * the part that decides, driven a second at a time.
 */

import assert from "node:assert/strict";

import {
  ALONE_SECONDS,
  callCountdown,
  WARN_SECONDS,
} from "../src/packages/socket/src/hooks/useAloneInCall.ts";

/* ── Nothing is said until the last WARN_SECONDS ─────────────────────────── */

assert.equal(callCountdown(0).secondsLeft, null, "a call that just emptied says nothing yet");
assert.equal(callCountdown(0).ended, false);

const lastQuietSecond = ALONE_SECONDS - WARN_SECONDS - 1;
assert.equal(
  callCountdown(lastQuietSecond).secondsLeft,
  null,
  "the second before the window opens is still quiet",
);

/* ── Then it counts, and the first thing it says is the full warning ─────── */

assert.equal(
  callCountdown(ALONE_SECONDS - WARN_SECONDS).secondsLeft,
  WARN_SECONDS,
  `the notice has to open on ${WARN_SECONDS}, not on ${WARN_SECONDS - 1} — a window that opens late is a window nobody reads`,
);

for (let alone = ALONE_SECONDS - WARN_SECONDS; alone < ALONE_SECONDS; alone += 1) {
  const { secondsLeft, ended } = callCountdown(alone);
  assert.equal(secondsLeft, ALONE_SECONDS - alone, `at ${alone}s alone the countdown is wrong`);
  assert.equal(ended, false, `the call must not end at ${alone}s alone`);
}

/* ── It reaches zero, and zero is when it ends ───────────────────────────── */

assert.equal(callCountdown(ALONE_SECONDS - 1).secondsLeft, 1, "one second left has to be shown");
assert.deepEqual(
  callCountdown(ALONE_SECONDS),
  { secondsLeft: 0, ended: true },
  "the call ends on zero, and zero is drawn — ending at 1 hangs up while the screen says otherwise",
);

/* ── And it stays ended rather than going negative ───────────────────────── */

const late = callCountdown(ALONE_SECONDS + 45);
assert.equal(late.ended, true, "a tick that arrived late must still end the call");
assert.equal(
  late.secondsLeft,
  0,
  "a backgrounded tab whose timers were throttled must not render a negative countdown",
);

console.log(
  `alone-in-call: quiet for ${ALONE_SECONDS - WARN_SECONDS}s, counts ${WARN_SECONDS} down to 0, ends on 0, never goes negative`,
);
