/* eslint-env node */

/**
 * The matrix on a channel scope, and what it sends. Inherit is the absence of a
 * row; Custom and Everyone are not scope ids.
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
import {
  describeFolderRules,
  FOLLOW_FOLDER_VALUE,
  folderFollowNote,
  folderMoveAction,
  followFolderLabel,
  followingFolderDescription,
} from "../src/packages/settings/src/folderPermissionRules.ts";

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

// A template with no name is a private scope that leaked into the list. Picking
// it would point this channel at another channel's rules.
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

// ── a folder's note, and a channel's line about its folder ─────────

assert.match(describeFolderRules([], NAMES), /Everyone on the server can see and use the channels in this folder/);
// Reading denied on a folder takes the folder off the sidebar too, so it says so.
assert.equal(
  describeFolderRules(
    [
      { roleId: "member", permission: "read_messages", effect: "deny" },
      { roleId: "guest", permission: "read_messages", effect: "deny" },
      { roleId: "mod", permission: "send_messages", effect: "allow" },
    ],
    NAMES,
  ),
  "Member and Guest won't see this folder or anything in it, and 1 other change.",
);
assert.equal(
  describeFolderRules([{ roleId: "mod", permission: "send_messages", effect: "allow" }], NAMES),
  "1 change to what roles can do in this folder's channels.",
);

assert.equal(folderFollowNote("Staff"), "Has its own permissions instead of the Staff folder's.");
// A folder the server sends without a name still reads as a sentence.
assert.equal(folderFollowNote(null), "Has its own permissions instead of its folder's.");

// ── Follow folder in the picker ────────────────────────────────────

// Not "", which the Select paints over with its placeholder, and not a value
// the other options could have.
assert.notEqual(FOLLOW_FOLDER_VALUE, "");
assert.ok(![EVERYONE_VALUE, CUSTOM_VALUE].includes(FOLLOW_FOLDER_VALUE));
assert.equal(followFolderLabel("Staff"), "Follow the Staff folder");
assert.equal(followFolderLabel(null), "Follow folder");

assert.equal(
  followingFolderDescription("Staff", [], NAMES, null),
  "The Staff folder decides who can use this channel. Everyone on the server can see and use the channels in this folder.",
);
assert.equal(
  followingFolderDescription("Staff", [], NAMES, "Staff only"),
  "The Staff folder decides who can use this channel. It uses the Staff only template.",
);
assert.match(followingFolderDescription(null, [], NAMES, null), /^Its folder decides/);

// ── Moving a channel into a folder ─────────────────────────────────

const topOwn = { permissionScopeId: "scope_1", followsFolder: false };
const topNone = { permissionScopeId: null, followsFolder: false };
const inFollowing = { permissionScopeId: "scope_folder", followsFolder: true };
const inDetached = { permissionScopeId: null, followsFolder: false };

// Nothing of its own, including a top-level channel once set to Everyone: it follows.
assert.equal(folderMoveAction(null, "f", topNone), "follow");
// Its own scope, or detached from the folder it was in: ask before replacing it.
assert.equal(folderMoveAction(null, "f", topOwn), "ask");
assert.equal(folderMoveAction("a", "f", inDetached), "ask");
// Following one folder already means following the next.
assert.equal(folderMoveAction("a", "f", inFollowing), "none");
// Out of a folder, or within one, decides nothing.
assert.equal(folderMoveAction("a", null, inDetached), "none");
assert.equal(folderMoveAction("f", "f", topOwn), "none");
// Not knowing is not a reason to ask: a server too old to say, or no answer.
assert.equal(folderMoveAction(null, "f", undefined), "none");
assert.equal(folderMoveAction(null, "f", { permissionScopeId: "scope_1" }), "none");

console.log("channel permissions: ok");
