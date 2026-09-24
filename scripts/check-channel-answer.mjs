/* eslint-env node */

/**
 * What the client draws per channel: the server's list for that channel where it
 * sent one (GRYT-1416), and the server-wide list where it did not.
 */

import assert from "node:assert/strict";

const { canInChannel, CHANNEL_PERMISSIONS } = await import("../src/packages/socket/src/lib/permissions.ts");

const serverWide = (held) => (permission) => held.includes(permission);
const everything = serverWide([...CHANNEL_PERMISSIONS, "kick_members"]);
const readOnly = serverWide(["read_messages"]);

// ── a server that sends the list ───────────────────────────────────

const noReactions = {
  myPermissions: CHANNEL_PERMISSIONS.filter((p) => p !== "add_reactions" && p !== "attach_files"),
  canSend: true,
  canJoin: true,
};
assert.equal(canInChannel(noReactions, everything, "add_reactions"), false, "a deny in the list is a no");
assert.equal(canInChannel(noReactions, everything, "attach_files"), false);
assert.equal(canInChannel(noReactions, everything, "send_messages"), true);

// An allow opens it for a role without it server-wide (GRYT-1418).
const podium = { myPermissions: ["read_messages", "send_messages", "join_voice"], canSend: true, canJoin: true };
assert.equal(canInChannel(podium, readOnly, "send_messages"), true, "the channel's allow was overruled server-wide");
assert.equal(canInChannel(podium, readOnly, "join_voice"), true);

// Only the thirteen come from the list. The rest stay server-wide.
assert.equal(canInChannel(podium, everything, "kick_members"), true);
assert.equal(canInChannel(podium, readOnly, "kick_members"), false);

// An empty list is a channel where they hold nothing, not an older server.
assert.equal(canInChannel({ myPermissions: [] }, everything, "add_reactions"), false);

// ── an older server ────────────────────────────────────────────────

// canSend and canJoin only, which narrowed the server-wide answer and never widened it.
const older = { canSend: false, canJoin: true };
assert.equal(canInChannel(older, everything, "send_messages"), false);
assert.equal(canInChannel(older, everything, "join_voice"), true);
assert.equal(canInChannel(older, everything, "add_reactions"), true, "today's behaviour: server-wide");
assert.equal(canInChannel({ canSend: true }, readOnly, "send_messages"), false, "an older server refused this server-wide");
assert.equal(canInChannel({ canJoin: true }, readOnly, "join_voice"), false);

// Older still: nothing per channel at all.
assert.equal(canInChannel({}, everything, "send_messages"), true);
assert.equal(canInChannel({}, readOnly, "add_reactions"), false);

// A DM, or a channel the client has not been sent, gets the server-wide answer.
assert.equal(canInChannel(undefined, everything, "add_reactions"), true);
assert.equal(canInChannel(undefined, readOnly, "add_reactions"), false);

console.log("channel answer: ok");
