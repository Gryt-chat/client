/* eslint-env node */

/**
 * Turning a server's plugin capabilities into something a person can act on
 * (GRYT-942).
 *
 * A server names every plugin it runs and what each may do. It says it in its
 * own vocabulary — `messages:read`, `moderation` — which is the substance of
 * the list and also useless to almost everybody reading it.
 *
 * The case worth guarding is the unrecognised one. A newer server is exactly
 * where a capability worth knowing about arrives, so hiding what this build
 * does not recognise would mean the scarier the capability, the less likely
 * somebody is to see it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { NOTHING_NAMED, describeCapabilities, describeCapability, missingHalves } = await import(
  "../src/packages/socket/src/lib/pluginCapabilityWording.ts"
);

/* ── the ones this build knows ───────────────────────────────────────────── */

/* Worded about the reader, not the plugin: the question somebody has when they
   open this is whether to keep typing here. */
assert.match(describeCapability("messages:read"), /every message you send/i);
assert.match(describeCapability("moderation"), /kick you|ban you/i);
assert.match(describeCapability("members:read"), /join or leave/i);
assert.match(describeCapability("messaging"), /copy of itself/i);

/* None of them says the raw name, or the wording is doing nothing. */
for (const capability of ["messages:read", "members:read", "moderation", "messaging"]) {
  assert.doesNotMatch(
    describeCapability(capability),
    /too old to say/,
    `${capability} fell through to the unknown branch`,
  );
}

/* ── the one that matters ────────────────────────────────────────────────── */

const unknown = describeCapability("reads:your:mind");

/* Shown rather than dropped. */
assert.match(unknown, /reads:your:mind/, "an unrecognised capability was hidden");

/* And marked as unrecognised, so it does not read as Gryt's own wording for
   something — which would be a sentence Gryt did not write, about a capability
   it does not know, presented as if it did. */
assert.match(unknown, /too old to say/);

/* ── lists ───────────────────────────────────────────────────────────────── */

assert.deepEqual(describeCapabilities([]), []);

/* Order is the server's. Sorting would put the alarming one wherever the
   alphabet happens to put it. */
const listed = describeCapabilities(["moderation", "messages:read"]);
assert.match(listed[0], /kick you/i);
assert.match(listed[1], /every message you send/i);

/* Junk in the array is dropped rather than rendered as an empty row — a blank
   line in a list of what a plugin may do reads as a rendering bug. */
assert.deepEqual(describeCapabilities(["", "   "]), []);
for (const junk of [null, undefined, 42, {}, []]) {
  assert.deepEqual(
    describeCapabilities([junk]),
    [],
    `rendered a row for ${JSON.stringify(junk)}`,
  );
}

/* But a real capability alongside junk still shows. Dropping the whole list
   because one entry was wrong is the failure this is checked for. */
assert.equal(describeCapabilities([null, "moderation", 42]).length, 1);

/* Trimmed, because a server that pads a name should not produce a capability
   this build then fails to recognise. */
assert.equal(describeCapability("moderation"), describeCapabilities(["  moderation  "])[0]);

/* ── nothing named ───────────────────────────────────────────────────────── */

/* Not "runs no plugins": a server too old to answer sends the same nothing as
   one running nothing, and there is no way to tell them apart from here. */
assert.doesNotMatch(NOTHING_NAMED, /no plugins\b/i);
assert.match(NOTHING_NAMED, /not named/i);

/* ── the half you do not have ────────────────────────────────────────────── */

/*
 * A server plugin declaring `messaging` has a client half by definition — that
 * capability is exactly "talks to a copy of itself in people's Gryt apps". So
 * naming one with no addon of the same id installed here is something this
 * person is missing.
 *
 * Inferred rather than announced. A manifest field saying "I have a client
 * half" would be a second thing to keep true, and it would be wrong the first
 * time somebody forgot it.
 */
const announced = [
  { id: "presence", capabilities: ["messaging"] },
  { id: "scoreboard", capabilities: ["messaging", "messages:read"] },
  { id: "automod", capabilities: ["messages:read", "moderation"] },
];

assert.deepEqual(
  missingHalves(announced, []).map((p) => p.id),
  ["presence", "scoreboard"],
  "a plugin with a client half was not reported as missing",
);

/* automod never appears: it has no client half, so there is nothing to install
   and telling somebody to go and get one would send them looking for nothing. */
assert.deepEqual(
  missingHalves(announced, ["presence", "scoreboard"]).map((p) => p.id),
  [],
);

assert.deepEqual(
  missingHalves(announced, ["presence"]).map((p) => p.id),
  ["scoreboard"],
);

/* An installed addon that shares no id with anything here changes nothing —
   the pairing is the id, and a coincidence of names is not one. */
assert.deepEqual(
  missingHalves(announced, ["something-else"]).map((p) => p.id),
  ["presence", "scoreboard"],
);

assert.deepEqual(missingHalves([], ["presence"]), []);

/* The whole object comes back, not just the id, because the row that says
   somebody is missing something is the row with the link on it. */
assert.equal(missingHalves(announced, [])[0].capabilities.includes("messaging"), true);

/* ── who can reach it ────────────────────────────────────────────────────── */

/*
 * The list is for the people whose messages a plugin reads, which is everybody
 * on the server. Server settings needs a permission and would put it in front
 * of the one person it is not for.
 *
 * Checked in the source because it is a placement rather than a behaviour, and
 * the way it would break is somebody tidying the menu by folding this row into
 * the `canManage &&` block above it — which type-checks, renders, and quietly
 * hides it from everybody it was written for.
 */
const header = readFileSync(
  new URL("../src/packages/socket/src/components/ServerHeader.tsx", import.meta.url),
  "utf8",
);

const item = header.indexOf("What this server runs");
assert.ok(item > 0, "the menu item is gone — did it move, or lose its label?");

/* The row and the few lines above it, which is where a `canManage` guard would
   have to sit to gate it. */
const around = header.slice(Math.max(0, item - 400), item);
assert.doesNotMatch(
  around,
  /canManage\s*&&[^]*$/,
  "the plugin list ended up behind a manage permission, where the people it is for cannot reach it",
);

/* And it is next to Leave, which is what somebody does about what they read.
   Matched on the menu row rather than on `onLeave`, which also appears in the
   props above and would make this pass wherever the row ended up. */
const leaveRow = header.indexOf("onClick={onLeave}");
assert.ok(leaveRow > 0, "the Leave row is gone — this check needs rewriting");
assert.ok(leaveRow > item, "the plugin list is no longer above Leave");

console.log("check-plugin-wording: ok");
