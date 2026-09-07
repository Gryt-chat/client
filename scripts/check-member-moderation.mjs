/* eslint-env node */

/**
 * The two things standing between a click in the members list and a ban.
 *
 * Rank decides who may be acted on. Permissions decide what the action is. Both
 * are enforced again by the server, so neither of these is the last line — but
 * a menu that offers a click the server refuses is a red toast at best, and one
 * that hides a click somebody is entitled to is a moderator who cannot moderate.
 *
 * And the typing gate, which is the whole of what makes the ban dialog more
 * than a confirm with a text box in it. Getting it wrong in the permissive
 * direction is silent: the button simply enables when it should not.
 */

import assert from "node:assert/strict";

const { BUILT_IN_RANK, formatJoined, makeRankOf, outranks, TIER_LABEL } = await import(
  "../src/packages/socket/src/lib/memberFacts.ts"
);
const { phraseMatches } = await import(
  "../src/packages/socket/src/lib/confirmPhrase.ts"
);

// ── who outranks whom ──────────────────────────────────────────────

/** A server that defines its own roles, the way most do now. */
const ROLES = [
  { id: "owner", name: "Owner", color: null, rank: 100, permissions: [], isSystem: true },
  { id: "admin", name: "Admin", color: null, rank: 80, permissions: [], isSystem: true },
  { id: "helper", name: "Helper", color: null, rank: 50, permissions: [], isSystem: false },
  { id: "member", name: "Member", color: null, rank: 40, permissions: [], isSystem: true },
];

assert.equal(outranks(ROLES, "admin", "member"), true);
assert.equal(outranks(ROLES, "member", "admin"), false);
assert.equal(outranks(ROLES, "admin", "admin"), false, "equal rank is not outranking");
assert.equal(outranks(ROLES, "owner", "admin"), true);

// Nobody is named, so nobody is outranked. A member list drawn before
// `server:roles` has answered must not offer a ban on everybody in it.
assert.equal(outranks(ROLES, undefined, "member"), false);
assert.equal(outranks(ROLES, "admin", undefined), false);

// A server too old to send ranks still has to sort the built-ins.
const rankOfBare = makeRankOf([]);
assert.ok(rankOfBare("owner") > rankOfBare("admin"));
assert.ok(rankOfBare("admin") > rankOfBare("mod"));
assert.ok(rankOfBare("mod") > rankOfBare("member"));
assert.ok(rankOfBare("member") > rankOfBare("guest"));
assert.equal(rankOfBare("something-a-server-invented"), -1);
assert.equal(BUILT_IN_RANK.owner, 100);

// The server's own rank wins over the built-in guess, which is the point of
// editable roles: a server may decide its admins sit below its moderators.
const odd = makeRankOf([
  { id: "admin", name: "Admin", color: null, rank: 5, permissions: [], isSystem: true },
]);
assert.equal(odd("admin"), 5);

// Roles stack, so somebody is ranked by the highest they hold. Ranking them by
// whichever the server listed first would let a moderator ban an admin who is
// also a contributor -- the same shape the members list computes per row.
{
  const rankOf = makeRankOf(ROLES);
  const held = ["member", "admin"];
  const top = held.reduce((best, r) => Math.max(best, rankOf(r)), -1);
  assert.equal(top, 80, "the highest role decides, not the first one listed");
  assert.ok(rankOf("helper") < top, "a helper must not outrank an admin's second role");
}

// Somebody holding nothing sits below everybody, which is what "same as a new
// member" means on that row.
assert.equal([].reduce((best, r) => Math.max(best, makeRankOf(ROLES)(r)), -1), -1);

// ── what is behind a member ────────────────────────────────────────

assert.equal(TIER_LABEL.local.amber, true, "no account is the one worth noticing");
assert.equal(TIER_LABEL.account.amber, false);
assert.ok(TIER_LABEL.bot, "a bot used to render no tier at all");
assert.equal(TIER_LABEL.bot.amber, false, "amber marks no account and nothing else");
assert.equal(TIER_LABEL["something-newer"], undefined, "an unknown tier draws nothing");

// ── when they joined ───────────────────────────────────────────────

assert.equal(formatJoined(undefined), null, "a server that did not say draws no date");
assert.equal(formatJoined("not a date"), null);
assert.equal(formatJoined(""), null);
assert.ok(formatJoined("2026-03-04T10:00:00Z"), "a real timestamp formats");
assert.equal(
  formatJoined(new Date("2026-03-04T10:00:00Z")),
  formatJoined("2026-03-04T10:00:00Z"),
  "a Date and its string have to agree, since members:list may send either",
);

// ── typing the name back ───────────────────────────────────────────

assert.equal(phraseMatches("Kari", "Kari"), true);
assert.equal(phraseMatches("kari", "Kari"), true, "case is not the check");
assert.equal(phraseMatches("  Kari  ", "Kari"), true, "nor is a stray space");
assert.equal(phraseMatches("Karl", "Kari"), false);
assert.equal(phraseMatches("Kari2", "Kari"), false, "a near miss is a different person");
assert.equal(phraseMatches("", "Kari"), false, "an empty box must never unlock the button");
assert.equal(phraseMatches("   ", "Kari"), false);

// No phrase means the dialog was not asking. That is not the same as an empty
// answer satisfying one that was, and confusing the two turns every typed
// confirmation into a plain one.
assert.equal(phraseMatches("", undefined), true);
assert.equal(phraseMatches("", ""), true);
assert.equal(phraseMatches("", "   "), true);

console.log("member moderation: ok");
