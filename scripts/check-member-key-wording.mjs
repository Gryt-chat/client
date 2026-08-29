/* eslint-env node */

/**
 * What the card says about a key, and about a key that changed (GRYT-728).
 *
 * Both of these are wrong in ways that look fine. A boundary off by one reads
 * "Same key for 0 days" to somebody who pinned it an hour ago. A sentence that
 * picks a cause tells a person their peer got a new phone, when the same event
 * is what a server substituting a key produces — and that is the reassuring
 * half of a guess this client cannot make.
 *
 * `describePin` takes a timestamp and compares it to now, so every case here is
 * expressed as an offset from `Date.now()` at the moment of the call.
 */

import assert from "node:assert/strict";

import {
  describeChange,
  describePin,
} from "../src/packages/socket/src/utils/memberKeyWording.ts";

const DAY = 86_400_000;
const ago = (ms) => Date.now() - ms;

/* ── the day boundaries ─────────────────────────────────────────────────── */

assert.equal(describePin(ago(0)), "Same key since today");
assert.equal(describePin(ago(DAY - 1000)), "Same key since today",
  "just under a day is still today; rounding up here reads as older than it is");
assert.equal(describePin(ago(DAY)), "Same key since yesterday");
assert.equal(describePin(ago(2 * DAY)), "Same key for 2 days");

/*
 * Never "0 days" and never "1 days". Those are the two the arithmetic produces
 * on its own if the branches above are dropped, and both look like a bug to
 * whoever reads them at exactly the moment they are deciding whether to trust
 * somebody.
 */
for (let ms = 0; ms < 40 * DAY; ms += DAY / 4) {
  const said = describePin(ago(ms));
  assert.ok(!said.includes("for 0 days"), `"${said}" at ${ms / DAY} days`);
  assert.ok(!said.includes("for 1 days"), `"${said}" at ${ms / DAY} days`);
}

/* ── a month over, it becomes a date ────────────────────────────────────── */

assert.equal(describePin(ago(29 * DAY)), "Same key for 29 days");
assert.ok(describePin(ago(30 * DAY)).startsWith("Same key since "),
  "past a month the count stops being the useful part and a date takes over");
assert.ok(!describePin(ago(400 * DAY)).includes("days"),
  "a key held for over a year must not be reported as a number of days");

/* ── every change is described, and each differently ────────────────────── */

{
  const both = describeChange(true, true);
  const identityOnly = describeChange(true, false);
  const keyOnly = describeChange(false, true);

  assert.equal(new Set([both, identityOnly, keyOnly]).size, 3,
    "the three cases mean different things and must not collapse into one sentence");

  for (const said of [both, identityOnly, keyOnly]) {
    assert.ok(said.length > 0);
    assert.ok(said.endsWith("."), `"${said}" is a sentence somebody reads`);

    /*
     * No cause, in either direction. "They probably" and "may have" are the
     * shapes that creep in, and both of them are this client claiming to know
     * something it cannot: a restored seed and a substituted key are the same
     * event from here.
     */
    for (const guess of [
      "probably",
      "likely",
      "may have",
      "might have",
      "new device",
      "new phone",
      "don't worry",
      "attack",
      "malicious",
    ]) {
      assert.ok(!said.toLowerCase().includes(guess),
        `"${said}" guesses at a cause with "${guess}"`);
    }
  }
}

console.log(
  "member-key-wording: no zero-day pins, a date past a month, and three distinct sentences that name no cause",
);
