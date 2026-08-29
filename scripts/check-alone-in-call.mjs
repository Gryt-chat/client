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

/* ── The SFU's number, when it sent one (GRYT-715) ───────────────────────── */

/**
 * `ALONE_SECONDS` is now the fallback rather than the timeout. An SFU that
 * carries GRYT-715 sends its own in `room_joined`, and an operator who raised
 * `SFU_CALL_ALONE_TIMEOUT` used to get a client that hung up early on a call
 * the SFU was still keeping.
 */
const FIVE_MINUTES = 300;

assert.equal(
  callCountdown(FIVE_MINUTES - WARN_SECONDS - 1, FIVE_MINUTES).secondsLeft,
  null,
  "the window opens relative to the SFU's timeout, not to the fallback",
);
assert.equal(
  callCountdown(FIVE_MINUTES - WARN_SECONDS, FIVE_MINUTES).secondsLeft,
  WARN_SECONDS,
  `a five-minute SFU has to open its notice at ${WARN_SECONDS}s left`,
);
assert.deepEqual(
  callCountdown(FIVE_MINUTES, FIVE_MINUTES),
  { secondsLeft: 0, ended: true },
  "and end on its own zero",
);
assert.equal(
  callCountdown(ALONE_SECONDS, FIVE_MINUTES).ended,
  false,
  "two minutes into a five-minute timeout the call is not over — this is the operator who raised it",
);

/* ── And when the operator turned the sweep off ──────────────────────────── */

/**
 * `SFU_CALL_ALONE_TIMEOUT=0`. Nothing is counting on the other end, so nothing
 * counts here. A client that hung up after two minutes anyway ended a call the
 * SFU was happy to keep, for a reason nobody watching could see.
 */
for (const alone of [0, WARN_SECONDS, ALONE_SECONDS, ALONE_SECONDS * 10]) {
  assert.deepEqual(
    callCountdown(alone, 0),
    { secondsLeft: null, ended: false },
    `with the sweep off, ${alone}s alone must say nothing and end nothing`,
  );
}

/* ── An SFU that said nothing falls back ─────────────────────────────────── */

assert.deepEqual(
  callCountdown(ALONE_SECONDS),
  callCountdown(ALONE_SECONDS, ALONE_SECONDS),
  "no timeout given has to behave exactly like the fallback given explicitly",
);

console.log(
  `alone-in-call: the SFU's timeout drives it when it sends one, 0 turns it off, and ${ALONE_SECONDS} is the fallback`,
);
