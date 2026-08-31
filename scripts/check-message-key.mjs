/* eslint-env node */

/**
 * The password rule on the message key (GRYT-783).
 *
 * Only the pure half is checked here. Sealing and adopting reach into IndexedDB
 * through identity-keys, which needs a browser; what can be checked without one
 * is the floor on the secret, and that is worth checking because of where the
 * sealed blob ends up.
 *
 * The blob sits in Keycloak's database and in every backup of it. So a weak
 * message password is not only its owner's problem: anyone holding a copy can
 * attack it offline, in parallel, with no rate limit and nothing watching. That
 * is a different situation from a password guarded by a login form, and it is
 * why there is a floor at all.
 */

import assert from "node:assert/strict";

import {
  describePasswordProblem,
  MIN_MESSAGE_PASSWORD,
} from "../src/packages/common/src/auth/message-password.ts";

assert.equal(MIN_MESSAGE_PASSWORD, 12);

// ── refused ─────────────────────────────────────────────────────────────────
assert.equal(describePasswordProblem(""), "Choose a password.");
for (const tooShort of ["a", "hunter2", "12345678901"]) {
  assert.ok(
    describePasswordProblem(tooShort)?.includes("12"),
    `${tooShort} is under the floor and must say so`,
  );
}

// ── accepted ────────────────────────────────────────────────────────────────
for (const ok of [
  "123456789012",
  "correct horse battery staple",
  "         a  ", // twelve characters, and not our business to judge further
  "🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑",
]) {
  assert.equal(describePasswordProblem(ok), null, `${ok} should be allowed`);
}

// ── the floor is counted in characters, not bytes ───────────────────────────
{
  // An emoji is several bytes and one character. Counting bytes would let a
  // three-emoji password through a twelve-byte floor, which is not what the
  // number is for.
  assert.ok(describePasswordProblem("🔑🔑🔑")?.includes("12"), "three emoji is not twelve characters");
}

console.log("check-message-key: ok");
