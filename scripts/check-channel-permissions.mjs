/* eslint-env node */

/**
 * The matrix on a channel scope, and what it sends.
 *
 * Three states per cell where the server stores two, so every case here is
 * about the third. Inherit is the absence of a row: a cell put back to inherit
 * has to delete its row, not write one saying "inherit", or the scope keeps
 * deciding something nobody asked it to decide.
 *
 * The other half is the dropdown. Custom and Everyone are not scope ids, and
 * confusing either for one would point a channel at a template that does not
 * exist.
 */

import assert from "node:assert/strict";

import {
  CUSTOM_VALUE,
  EVERYONE_VALUE,
  cellState,
  describeRules,
  indexRules,
  nextCellState,
  scopeChoiceFromValue,
  scopeChoiceValue,
  scopeOptions,
  scopeSetPayload,
  withCell,
} from "../src/packages/settings/src/channelPermissionRules.ts";

// ── cells ──────────────────────────────────────────────────────────

const RULES = [
  { roleId: "member", permission: "read_messages", effect: "deny" },
  { roleId: "mod", permission: "send_messages", effect: "allow" },
];

const index = indexRules(RULES);
assert.equal(cellState(index, "member", "read_messages"), "deny");
assert.equal(cellState(index, "mod", "send_messages"), "allow");
assert.equal(cellState(index, "member", "send_messages"), "inherit", "no row means inherit");
assert.equal(cellState(index, "nobody", "read_messages"), "inherit");

// Deny is one click from neutral, allow is two. Taking something away is what
// people open this to do.
assert.equal(nextCellState("inherit"), "deny");
assert.equal(nextCellState("deny"), "allow");
assert.equal(nextCellState("allow"), "inherit");

// A full cycle returns the rules to exactly what they were. If inherit wrote a
// row instead of deleting one, this would end up one rule longer.
let cycled = RULES;
for (let i = 0; i < 3; i++) {
  cycled = withCell(cycled, "guest", "add_reactions", nextCellState(cellState(indexRules(cycled), "guest", "add_reactions")));
}
assert.deepEqual(cycled, RULES, "cycling a cell back to inherit must leave no trace");

// Setting a cell replaces rather than duplicates.
const twice = withCell(withCell(RULES, "member", "read_messages", "allow"), "member", "read_messages", "deny");
assert.equal(twice.filter((r) => r.roleId === "member" && r.permission === "read_messages").length, 1);

// Back to inherit removes the row.
const cleared = withCell(RULES, "member", "read_messages", "inherit");
assert.equal(cleared.length, RULES.length - 1);
assert.equal(cellState(indexRules(cleared), "member", "read_messages"), "inherit");

// ── the dropdown ───────────────────────────────────────────────────

assert.equal(scopeChoiceValue(null, false), EVERYONE_VALUE);
assert.equal(scopeChoiceValue("scope_abc", true), "scope_abc", "a template shows as itself");
assert.equal(scopeChoiceValue("scope_abc", false), CUSTOM_VALUE, "a private scope shows as Custom");

// Neither sentinel may be empty, or the Select paints its placeholder over the
// label and a configured channel looks unconfigured.
assert.notEqual(EVERYONE_VALUE, "");
assert.notEqual(CUSTOM_VALUE, "");
assert.ok(scopeOptions([{ id: "t1", name: "Owners only" }]).every((o) => o.value !== ""));

// Everyone first, templates in the middle, Custom last.
assert.deepEqual(
  scopeOptions([{ id: "t1", name: "Owners only" }, { id: "t2", name: "Staff" }]).map((o) => o.value),
  [EVERYONE_VALUE, "t1", "t2", CUSTOM_VALUE],
);

// A template with no name is a private scope that leaked into the list. It must
// not be offered — picking it would point this channel at another channel's
// rules.
assert.deepEqual(
  scopeOptions([{ id: "t1", name: null }, { id: "t2", name: "Staff" }]).map((o) => o.value),
  [EVERYONE_VALUE, "t2", CUSTOM_VALUE],
);

assert.deepEqual(scopeChoiceFromValue(EVERYONE_VALUE), { kind: "everyone" });
assert.deepEqual(scopeChoiceFromValue(CUSTOM_VALUE), { kind: "custom" });
assert.deepEqual(scopeChoiceFromValue("scope_abc"), { kind: "template", templateId: "scope_abc" });
assert.deepEqual(scopeChoiceFromValue(""), { kind: "everyone" }, "an empty value must not read as a template id");

// ── what goes on the wire ──────────────────────────────────────────

// Everyone clears the scope, and says so with null rather than by omission —
// the server reads an absent field as "leave it alone".
assert.deepEqual(scopeSetPayload({ kind: "everyone" }, RULES), { templateId: null });

// A template carries no rules. Sending them would edit the template from a
// screen titled with one channel's name, changing every other channel using it.
assert.deepEqual(scopeSetPayload({ kind: "template", templateId: "t1" }, RULES), { templateId: "t1" });

assert.deepEqual(scopeSetPayload({ kind: "custom" }, RULES), { custom: true, rules: RULES });

// Custom with nothing set still sends an empty list, so clearing every cell
// actually clears the scope rather than leaving the last saved matrix in place.
assert.deepEqual(scopeSetPayload({ kind: "custom" }, []), { custom: true, rules: [] });

// ── the note under the dropdown ────────────────────────────────────

const NAMES = new Map([["member", "Member"], ["guest", "Guest"], ["mod", "Moderator"]]);

assert.match(describeRules([], NAMES), /Everyone/);

// Denying read is called out by name, because its consequence is different:
// the channel is absent, not locked.
assert.match(
  describeRules([{ roleId: "member", permission: "read_messages", effect: "deny" }], NAMES),
  /Member will not see this channel at all/,
);
assert.match(
  describeRules(
    [
      { roleId: "member", permission: "read_messages", effect: "deny" },
      { roleId: "guest", permission: "read_messages", effect: "deny" },
    ],
    NAMES,
  ),
  /Member and Guest will not see this channel at all/,
);

// Changes that are not about reading are counted, not listed.
assert.match(
  describeRules([{ roleId: "mod", permission: "send_messages", effect: "allow" }], NAMES),
  /1 change/,
);

console.log("channel permissions: ok");
