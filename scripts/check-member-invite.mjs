/* eslint-env node */

/**
 * How a member's invite reads on the Members tab (GRYT-923).
 *
 * The row answers "how did this person get in, and is that door still open",
 * and somebody acts on the answer by revoking. So the failure that matters is
 * not a wrong label — it is a shut invite drawn as live, which puts a Revoke
 * button on a code the server no longer has, or a live one drawn as shut, which
 * leaves the actual door open.
 *
 * Run against the real module rather than a copy — Node strips the types on
 * import, which is why this lives in .mjs and the source stays .ts.
 */

import assert from "node:assert/strict";

import { inviteState } from "../src/packages/socket/src/components/memberInvite.ts";

const base = {
  serverUserId: "u1",
  code: "abc123",
  note: null,
  revoked: false,
  usesConsumed: 2,
  maxUses: 5,
};

/* ── live ────────────────────────────────────────────────────────────────── */

{
  const s = inviteState(base);
  assert.equal(s.dead, false);
  assert.equal(s.reason, null, "a live invite has nothing to explain");
  assert.equal(s.label, "abc123", "with no note, the code is the label");
  assert.ok(s.hint.includes("2 of 5 used"));
}

/* The note is what an operator recognises; the code stays reachable. */
{
  const s = inviteState({ ...base, note: "Kari's friends" });
  assert.equal(s.label, "Kari's friends");
  assert.ok(s.hint.startsWith("abc123"), "the code belongs in the hint whatever the label");
}

/* An empty note is not a label. Falling back to it would draw a blank row. */
for (const note of ["", "   ".trim()]) {
  assert.equal(inviteState({ ...base, note }).label, "abc123");
}

/* ── revoked ─────────────────────────────────────────────────────────────── */

{
  const s = inviteState({ ...base, revoked: true });
  assert.equal(s.dead, true);
  assert.equal(s.reason, "revoked");
}

/* ── deleted, which is the one a two-state version gets wrong ────────────── */

/*
 * `revoked: null` means the invite row is gone — somebody deleted it after this
 * member arrived. Testing `revoked === true` would leave it drawn as live, with
 * a Revoke button acting on a code the server does not have.
 */
{
  const s = inviteState({ ...base, revoked: null, note: null, usesConsumed: null, maxUses: null });
  assert.equal(s.dead, true, "a deleted invite is not a live one");
  assert.equal(s.reason, "deleted");
  assert.equal(s.label, "abc123", "it still names the code they came in on");
  assert.equal(s.hint, "abc123", "no invented use count for an invite that is gone");
}

/* And the two dead states stay distinct — they are different sentences. */
assert.notEqual(
  inviteState({ ...base, revoked: true }).reason,
  inviteState({ ...base, revoked: null }).reason,
);

/* ── the use count ───────────────────────────────────────────────────────── */

/* An unlimited invite has no denominator to show. "3 of 0 used" is worse than
   saying nothing. */
{
  const s = inviteState({ ...base, maxUses: 0, usesConsumed: 3 });
  assert.equal(s.hint, "abc123");
}

/* A live invite whose count never arrived still counts from zero rather than
   printing "null of 5". */
{
  const s = inviteState({ ...base, usesConsumed: null });
  assert.ok(s.hint.includes("0 of 5 used"), s.hint);
}

console.log("check-member-invite: ok");
