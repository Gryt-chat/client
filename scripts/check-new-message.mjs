/* eslint-env node */

// The + next to Messages, run as itself: who it offers, and which conversation answers
// it. New group used to make a group nobody could see or open (GRYT-1342).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { listedConversations } from "../src/packages/socket/src/hooks/dmDirectory.ts";
import { leftOver } from "../src/packages/socket/src/hooks/dmSpace.ts";
import {
  candidatesFor,
  createdGroup,
  directWith,
  matching,
} from "../src/packages/socket/src/lib/newMessage.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const person = (serverUserId, nickname, extra = {}) => ({ serverUserId, nickname, ...extra });
const server = (host, members, extra = {}) => ({
  host,
  selfId: "me",
  members: [person("me", "Me"), ...members],
  canMessage: true,
  canGroup: true,
  ...extra,
});
const names = (list) => list.map((c) => `${c.nickname}@${c.host}`);

// ── who it offers ──────────────────────────────────────────────────────────
{
  const servers = [
    server("one", [person("u-bob", "bob"), person("u-carol", "Carol"), person("u-bot", "Helper", { isBot: true })]),
    server("two", [person("u-bob2", "Bob")]),
  ];

  assert.deepEqual(
    names(candidatesFor(servers, "message")),
    ["bob@one", "Bob@two", "Carol@one"],
    "not sorted by name then server, or you or a bot is offered",
  );

  /* Without your own id every member could be you, so that server offers nobody
     rather than offering you to yourself. */
  assert.deepEqual(
    names(candidatesFor([server("one", [person("u-bob", "Bob")], { selfId: undefined })], "message")),
    [],
    "a server that has not said who you are offered you anyway",
  );

  // send_direct_messages, or allow_dms, takes a server out of both lists.
  const noDms = [server("one", [person("u-bob", "Bob")], { canMessage: false }), servers[1]];
  assert.deepEqual(names(candidatesFor(noDms, "message")), ["Bob@two"], "a server that refuses DMs was offered");
  assert.deepEqual(names(candidatesFor(noDms, "group")), ["Bob@two"], "a server that refuses DMs was offered for a group");

  // create_groups takes it out of the group list only.
  const noGroups = [server("one", [person("u-bob", "Bob")], { canGroup: false }), servers[1]];
  assert.deepEqual(names(candidatesFor(noGroups, "message")), ["Bob@one", "Bob@two"]);
  assert.deepEqual(names(candidatesFor(noGroups, "group")), ["Bob@two"], "a server without create_groups was offered for a group");
}

// ── search matches the name or the server ──────────────────────────────────
{
  const list = candidatesFor([server("one", [person("u-bob", "Bob")]), server("two", [person("u-bob2", "Bob")])], "message");
  const nameOf = (host) => (host === "one" ? "Repro One" : "Repro Two");
  assert.deepEqual(names(matching(list, "  BO ", nameOf)), ["Bob@one", "Bob@two"], "the query is not trimmed and case-folded");
  assert.deepEqual(names(matching(list, "two", nameOf)), ["Bob@two"], "the server's name does not match");
  assert.deepEqual(names(matching(list, "", nameOf)), names(list), "an empty query filtered something");
}

// ── which conversation answers ─────────────────────────────────────────────
{
  const dm = (id, other) => ({ conversation_id: id, kind: "dm", other: { server_user_id: other }, members: [{ server_user_id: other }] });
  const group = (id, members) => ({
    conversation_id: id,
    kind: "group",
    other: { server_user_id: members[0] },
    members: members.map((m) => ({ server_user_id: m })),
  });
  const entries = [
    { host: "one", conversation: group("g-old", ["u-bob", "u-carol"]) },
    { host: "one", conversation: dm("dm-bob", "u-bob") },
    { host: "two", conversation: dm("dm-bob2", "u-bob") },
  ];

  assert.equal(directWith(entries, "one", "u-bob")?.conversation_id, "dm-bob");
  assert.equal(directWith(entries, "two", "u-bob")?.conversation_id, "dm-bob2", "a DM on another server answered");
  assert.equal(directWith(entries, "one", "u-carol"), undefined, "a group answered for a one-to-one");

  /* The same people as a group that already existed: only the new id is the one
     this create made, so the old group is never opened by mistake. */
  const before = new Set(["g-old", "dm-bob"]);
  assert.equal(createdGroup(entries, "one", before, ["u-carol", "u-bob"]), undefined, "an old group was taken for the new one");
  const after = [...entries, { host: "one", conversation: group("g-new", ["u-carol", "u-bob"]) }];
  assert.equal(createdGroup(after, "one", before, ["u-bob", "u-carol"])?.conversation_id, "g-new");
  assert.equal(createdGroup(after, "one", before, ["u-bob"]), undefined, "a group with other people answered");
  assert.equal(createdGroup(after, "two", before, ["u-bob", "u-carol"]), undefined, "a group on another server answered");
}

// ── a new group is listed before anybody writes in it ─────────────────────
{
  const entries = [
    { host: "one", conversation: { conversation_id: "g-empty", kind: "group", last_message_at: null, created_at: "2026-09-21T10:00:00Z" } },
    { host: "one", conversation: { conversation_id: "dm-empty", kind: "dm", last_message_at: null, created_at: "2026-09-21T11:00:00Z" } },
    { host: "one", conversation: { conversation_id: "dm-old", kind: "dm", last_message_at: "2026-09-20T10:00:00Z" } },
  ];
  assert.deepEqual(
    listedConversations(entries, null).map((e) => e.conversation.conversation_id),
    ["g-empty", "dm-old"],
    "an empty group is hidden, so nobody can open it to write the first message",
  );
  assert.equal(leftOver(entries[0].conversation, null), false, "an empty group left selected was dropped");
  assert.equal(leftOver(entries[1].conversation, null), true, "an empty DM left selected stayed");
}

// ── the dialog is the way in, and the old one is gone ──────────────────────
{
  const sidebar = read("src/packages/socket/src/components/DmSpaceSidebar.tsx");
  assert.match(sidebar, /aria-label="New message"/, "Messages has no + to start a conversation");
  assert.match(sidebar, /setNewMessageOpen\(true\)/, "the + does not open the dialog");

  const app = read("src/components/mainApp.tsx");
  assert.match(app, /<NewMessageDialog \/>/, "the dialog is not mounted above the server view");

  const view = read("src/packages/socket/src/components/serverView.tsx");
  assert.doesNotMatch(view, />\s*New group\s*</, "the chat header still has New group");
  assert.match(view, /aria-label="Group settings"/, "a group's header lost its way into Group settings");

  const permissions = read("src/packages/socket/src/lib/permissions.ts");
  assert.match(permissions, /id: "create_groups", label: "[^"]+", description: "[^"]+"/, "create_groups has no words");
}

console.log("new message: offers the right people, answers with the right conversation, lists new groups");
