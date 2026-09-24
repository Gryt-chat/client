/* eslint-env node */

/**
 * The floor on a typed message password: twelve characters, where it used to be four.
 * Only where a password is chosen; an old short one still opens (GRYT-1473).
 */

import assert from "node:assert/strict";

import {
  describePasswordProblem,
  generateVaultPassword,
  MIN_VAULT_PASSWORD,
} from "../src/packages/common/src/auth/message-password.ts";

assert.equal(MIN_VAULT_PASSWORD, 12);

// ── refused ─────────────────────────────────────────────────────────────────
assert.equal(describePasswordProblem(""), "Choose a password.");
for (const tooShort of ["a", "abcd", "hunter2!", "eleven char"]) {
  assert.ok(
    describePasswordProblem(tooShort)?.includes("12"),
    `${tooShort} is under the floor and must say so`,
  );
}

// ── accepted ────────────────────────────────────────────────────────────────
for (const ok of ["twelve chars", "correct horse battery staple", "🔑".repeat(12)]) {
  assert.equal(describePasswordProblem(ok), null, `${ok} should be allowed`);
}

// ── the floor is counted in characters, not bytes or UTF-16 units ──────────
{
  // Six emoji are twelve UTF-16 units. Counting those would let them through.
  assert.ok(describePasswordProblem("🔑".repeat(6))?.includes("12"), "six emoji are not twelve characters");
}

// ── the default clears it every time ────────────────────────────────────────
for (let i = 0; i < 100; i++) {
  assert.equal(describePasswordProblem(generateVaultPassword()), null);
}

console.log("check-message-key: ok");
