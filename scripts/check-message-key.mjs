/* eslint-env node */

/**
 * The password rule on the message key (GRYT-783).
 *
 * The floor is four, and it is deliberately not a security control — how much
 * security somebody wants on their own messages is theirs to choose. What it
 * catches is a slip: an empty box, or a stray keystroke landing on Save.
 *
 * So what is worth pinning here is the shape rather than the strength. That an
 * empty password is refused with something a person can act on, that the count
 * is characters and not bytes, and that nothing above the floor is second
 * guessed.
 */

import assert from "node:assert/strict";

import {
  describePasswordProblem,
  MIN_MESSAGE_PASSWORD,
} from "../src/packages/common/src/auth/message-password.ts";

assert.equal(MIN_MESSAGE_PASSWORD, 4);

// ── refused ─────────────────────────────────────────────────────────────────
assert.equal(describePasswordProblem(""), "Choose a password.");
for (const tooShort of ["a", "ab", "abc"]) {
  assert.ok(
    describePasswordProblem(tooShort)?.includes("4"),
    `${tooShort} is under the floor and must say so`,
  );
}

// ── accepted ────────────────────────────────────────────────────────────────
for (const ok of [
  "1234",
  "hunter2!",
  "correct horse battery staple",
  "    ", // four characters, and not our business to judge further
  "🔑🔑🔑🔑",
]) {
  assert.equal(describePasswordProblem(ok), null, `${ok} should be allowed`);
}

// ── the floor is counted in characters, not bytes ───────────────────────────
{
  // An emoji is several bytes and one character. Counting bytes would let a
  // single emoji through a four-byte floor, which is not what the number means.
  assert.ok(describePasswordProblem("🔑")?.includes("4"), "one emoji is not four characters");
}

console.log("check-message-key: ok");
