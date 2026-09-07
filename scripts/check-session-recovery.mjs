/* eslint-env node */

/**
 * How a client answers a server that says the session is over.
 *
 * Two things are being pinned here. One is that a session somebody deliberately
 * ended stays ended: rejoining a Gryt server needs no password, only the
 * keypair on this machine, so a client that recovers on its own would sign the
 * person straight back in on the device they just signed out of. The other is
 * that recovering has a budget — a server can send this event as often as it
 * likes, and answering every one immediately is a loop that burns battery and
 * makes the machine sign with its private key on demand.
 *
 * The clock is passed in rather than read, so the backoff is checked without
 * anybody waiting through it.
 */

import assert from "node:assert/strict";

const {
  MAX_RETRIES,
  QUIET_PERIOD_MS,
  idleRecovery,
  isDeliberateRevocation,
  planRecovery,
} = await import("../src/packages/socket/src/utils/sessionRecovery.ts");

// ── a session somebody ended ───────────────────────────────────────

for (const reason of ["signed_out_elsewhere", "user_token_version_mismatch"]) {
  const { plan } = planRecovery(idleRecovery(), reason, 1_000);
  assert.equal(plan.act, "stop", `${reason} must not be recovered from`);
  assert.equal(plan.because, "deliberate");
  assert.equal(isDeliberateRevocation(reason), true);
}

// It stays terminal however much budget is left, because the budget is not the
// point -- somebody asked for this device to be signed out.
{
  const { plan } = planRecovery({ retries: 0, lastRetryAt: 0 }, "signed_out_elsewhere", 500_000);
  assert.equal(plan.act, "stop");
  assert.equal(plan.because, "deliberate");
}

// ── the server having moved on ─────────────────────────────────────

assert.equal(isDeliberateRevocation("token_version_mismatch"), false);
assert.equal(isDeliberateRevocation(undefined), false);

{
  const { plan } = planRecovery(idleRecovery(), "token_version_mismatch", 0);
  assert.equal(plan.act, "retry", "a server-wide rotation is recoverable");
  assert.equal(plan.retry, 1);
}

// A reason this client has never heard of is treated as recoverable rather than
// as an ending. Guessing the other way would sign people out of servers running
// a version that says something new.
{
  const { plan } = planRecovery(idleRecovery(), "something_added_later", 0);
  assert.equal(plan.act, "retry");
}

// ── the backoff ────────────────────────────────────────────────────

/** Walks a run of revocations arriving back to back, and reports each answer. */
function hammer(count, { reason = "token_version_mismatch", gapMs = 0 } = {}) {
  let state = idleRecovery();
  let now = 0;
  const plans = [];
  for (let i = 0; i < count; i += 1) {
    const next = planRecovery(state, reason, now);
    plans.push(next.plan);
    state = next.state;
    now += next.plan.act === "retry" ? next.plan.delayMs + gapMs : gapMs;
  }
  return { plans, state, now };
}

{
  const { plans } = hammer(MAX_RETRIES + 3);
  const delays = plans.filter((p) => p.act === "retry").map((p) => p.delayMs);

  assert.deepEqual(delays, [1_000, 2_000, 4_000, 8_000, 16_000], "each wait doubles");
  assert.equal(delays.length, MAX_RETRIES);

  const stopped = plans.slice(MAX_RETRIES);
  assert.ok(stopped.length > 0);
  for (const plan of stopped) {
    assert.equal(plan.act, "stop", "past the cap it gives up rather than trying again");
    assert.equal(plan.because, "out_of_retries");
  }
}

// Giving up is not permanent. Trouble that has passed leaves the next
// occurrence a full budget, so a server that rotated its counter last week is
// not still being punished for it.
{
  const { state, now } = hammer(MAX_RETRIES + 1);
  const { plan } = planRecovery(state, "token_version_mismatch", now + QUIET_PERIOD_MS);
  assert.equal(plan.act, "retry");
  assert.equal(plan.retry, 1, "the budget is back to full");
  assert.equal(plan.delayMs, 1_000);
}

// And a server that keeps shoving does not get to keep the budget shut by
// shoving: the quiet period runs from the last thing this client actually did,
// so the long-run rate is capped rather than driven to zero.
{
  let { state } = hammer(MAX_RETRIES);
  const lastRetryAt = state.lastRetryAt;

  for (const at of [20_000, 40_000, 80_000, QUIET_PERIOD_MS - 1_000]) {
    const next = planRecovery(state, "token_version_mismatch", lastRetryAt + at);
    assert.equal(next.plan.act, "stop", `still out of retries ${at}ms in`);
    state = next.state;
  }

  assert.equal(state.lastRetryAt, lastRetryAt, "a refused attempt must not push the clock forward");
  const { plan } = planRecovery(state, "token_version_mismatch", lastRetryAt + QUIET_PERIOD_MS);
  assert.equal(plan.act, "retry", "the window opens on schedule regardless of the shoving");
}

// ── recovering, and then trouble again later ───────────────────────

// What the handler does when a retry works: it drops the state, so the next
// revocation is judged on its own.
{
  const { state } = hammer(2);
  assert.equal(state.retries, 2);

  const { plan } = planRecovery(idleRecovery(), "token_version_mismatch", state.lastRetryAt + 5_000);
  assert.equal(plan.retry, 1, "a recovery that worked hands the budget back");
}

console.log("session recovery: ok");
