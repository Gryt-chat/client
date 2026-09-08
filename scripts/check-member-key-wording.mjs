/* eslint-env node */

/**
 * What the card says about a key, and about a key that changed. Both are wrong in
 * ways that look fine — an off-by-one boundary, or a guessed cause (GRYT-728).
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
 * Never "0 days" and never "1 days" — the two the arithmetic produces on its own,
 * read at exactly the moment somebody is deciding whether to trust a person.
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
     * No cause, in either direction. "They probably" and "may have" both claim
     * something this client cannot know.
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
