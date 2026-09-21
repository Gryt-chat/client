/* eslint-env node */

/**
 * One decision for the server on screen and the ones in the background. Focus,
 * a mention, the channel's own default and this person's levels all meet in it.
 */

import assert from "node:assert/strict";

const {
  mentionsMember,
  rememberPlacements,
  setGlobalLevel,
  setNotificationLevel,
  shouldNotifyForMessage,
} = await import("../src/packages/common/src/hooks/notificationPrefs.ts");

const HOST = "gryt.test:5001";
const ME = "user_me";
const me = { serverUserId: ME, nickname: "Sivert" };
const sidebar = [
  { kind: "folder", id: "f1" },
  { kind: "channel", channelId: "general", parentItemId: null },
  { kind: "channel", channelId: "git-activity", parentItemId: "f1" },
];
const channels = [
  { id: "general", defaultNotificationLevel: "all" },
  { id: "git-activity", defaultNotificationLevel: "none" },
  { id: "announcements", defaultNotificationLevel: "mentions" },
  // An older server sends no level, and a broken one sends a word this build does not know.
  { id: "old-server" },
  { id: "junk", defaultNotificationLevel: "loud" },
];
rememberPlacements(HOST, sidebar, channels);

const from = (sender, conversation_id, thread_id = null) => ({
  conversation_id,
  sender_server_id: sender,
  thread_id,
  text: "hello everyone",
});
const naming = (sender, conversation_id, thread_id = null) => ({
  ...from(sender, conversation_id, thread_id),
  text: "@Sivert can you look at this",
});
const onScreen = (windowFocused, mentionsMe = false) => ({ myId: ME, viewingThisServer: true, windowFocused, mentionsMe });
const background = (windowFocused, mentionsMe = false) => ({ myId: ME, viewingThisServer: false, windowFocused, mentionsMe });
const level = (id, value) => setNotificationLevel(HOST, { kind: "channel", id }, value);

// ── The two paths, on a channel nobody has touched ──────────────────────────

// Looking at the server in a focused window: it is on screen or one click away.
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), onScreen(true)), false);
// The same server once the window is in the background.
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), onScreen(false)), true);
// A background server is not on screen, whatever the window is doing.
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), background(true)), true);
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), background(false)), true);

// Your own echo never announces, on either path, named or not.
assert.equal(shouldNotifyForMessage(HOST, from(ME, "general"), onScreen(false)), false);
assert.equal(shouldNotifyForMessage(HOST, from(ME, "general"), background(false)), false);
assert.equal(shouldNotifyForMessage(HOST, naming(ME, "general"), background(false, true)), false);

// A plain thread reply is the thread tracker's, not a notification.
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general", "t1"), onScreen(false)), false);
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general", "t1"), background(true)), false);

// ── Being named ─────────────────────────────────────────────────────────────

// The rule the server pings on: @nickname on its own, any case, or the composer's link.
assert.equal(mentionsMember({ text: "hey @Sivert look", sender_server_id: "u2" }, me), true);
assert.equal(mentionsMember({ text: "hey @sivert look", sender_server_id: "u2" }, me), true);
assert.equal(mentionsMember({ text: "@Sivert", sender_server_id: "u2" }, me), true);
assert.equal(mentionsMember({ text: "(@Sivert)", sender_server_id: "u2" }, me), true);
assert.equal(mentionsMember({ text: "[@Sivert](mention:user_me) look", sender_server_id: "u2" }, me), true);
// Named under an old nickname: the link still carries the id.
assert.equal(mentionsMember({ text: "[@Siv](mention:user_me)", sender_server_id: "u2" }, me), true);
// An email address, a longer name, the bare name, and nothing to read.
assert.equal(mentionsMember({ text: "mail me at a@sivert.io", sender_server_id: "u2" }, me), false);
assert.equal(mentionsMember({ text: "@Sivert2 is somebody else", sender_server_id: "u2" }, me), false);
assert.equal(mentionsMember({ text: "email@Sivert", sender_server_id: "u2" }, me), false);
assert.equal(mentionsMember({ text: "no at sign, Sivert", sender_server_id: "u2" }, me), false);
assert.equal(mentionsMember({ text: null, sender_server_id: "u2" }, me), false);
assert.equal(mentionsMember({ text: "@Sivert", sender_server_id: "u2" }, { serverUserId: ME, nickname: "" }), false);
assert.equal(mentionsMember({ text: "@Sivert", sender_server_id: "u2" }, { serverUserId: null, nickname: null }), false);
// Somebody else's mention, and a second @ before the real one.
assert.equal(mentionsMember({ text: "@Carlo and @Sivert", sender_server_id: "u2" }, me), true);
assert.equal(mentionsMember({ text: "[@Carlo](mention:user_c)", sender_server_id: "u2" }, me), false);
// The server's own notices and webhook posts never record a mention, so neither counts here.
assert.equal(mentionsMember({ text: "[@Sivert](mention:user_me) joined the server", sender_server_id: "system" }, me), false);
assert.equal(mentionsMember({ text: "@Sivert pushed to main", sender_server_id: "webhook:1" }, me), false);

// A channel set to mentions: quiet for a message, loud for a mention, on both paths.
level("general", "mentions");
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), onScreen(false)), false);
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), background(false)), false);
assert.equal(shouldNotifyForMessage(HOST, naming("u2", "general"), onScreen(false, true)), true);
assert.equal(shouldNotifyForMessage(HOST, naming("u2", "general"), background(false, true)), true);
assert.equal(shouldNotifyForMessage(HOST, naming("u2", "general"), background(true, true)), true);
// Still nothing while the server is on screen in a focused window: the mention is in view.
assert.equal(shouldNotifyForMessage(HOST, naming("u2", "general"), onScreen(true, true)), false);
// A mention inside a thread is a mention, at mentions and at everything.
assert.equal(shouldNotifyForMessage(HOST, naming("u2", "general", "t1"), background(false, true)), true);
assert.equal(shouldNotifyForMessage(HOST, naming("u2", "general", "t1"), onScreen(false, true)), true);
level("general", "all");
assert.equal(shouldNotifyForMessage(HOST, naming("u2", "general", "t1"), background(false, true)), true);
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general", "t1"), background(false)), false);
// Muted is muted, mention or not, on both paths.
level("general", "none");
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), onScreen(false)), false);
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), background(false)), false);
assert.equal(shouldNotifyForMessage(HOST, naming("u2", "general"), onScreen(false, true)), false);
assert.equal(shouldNotifyForMessage(HOST, naming("u2", "general"), background(false, true)), false);
level("general", null);
// The server's channel default of mentions works the same way.
assert.equal(shouldNotifyForMessage(HOST, from("u2", "announcements"), background(false)), false);
assert.equal(shouldNotifyForMessage(HOST, naming("u2", "announcements"), background(false, true)), true);

// ── The channel's own default ───────────────────────────────────────────────

// An automated feed defaults to quiet, on both paths.
assert.equal(shouldNotifyForMessage(HOST, from("webhook:1", "git-activity"), onScreen(false)), false);
assert.equal(shouldNotifyForMessage(HOST, from("webhook:1", "git-activity"), background(true)), false);
// No level from the server, or one this build does not know, reads as everything.
assert.equal(shouldNotifyForMessage(HOST, from("u2", "old-server"), background(false)), true);
assert.equal(shouldNotifyForMessage(HOST, from("u2", "junk"), background(false)), true);
// A channel this client has never seen listed resolves to the server level.
assert.equal(shouldNotifyForMessage(HOST, from("u2", "unseen"), background(false)), true);

// ── This person's own levels ────────────────────────────────────────────────

// Setting the channel itself overrides the default, either way.
level("git-activity", "all");
assert.equal(shouldNotifyForMessage(HOST, from("webhook:1", "git-activity"), background(false)), true);
assert.equal(shouldNotifyForMessage(HOST, from("webhook:1", "git-activity"), onScreen(false)), true);
// Still quiet while it is on screen in a focused window: the override is about the level, not focus.
assert.equal(shouldNotifyForMessage(HOST, from("webhook:1", "git-activity"), onScreen(true)), false);
level("git-activity", null);

// Turning the folder or the server up does not un-quiet the feed: the default only quietens.
setNotificationLevel(HOST, { kind: "folder", id: "f1" }, "all");
assert.equal(shouldNotifyForMessage(HOST, from("webhook:1", "git-activity"), background(false)), false);
setNotificationLevel(HOST, { kind: "folder", id: "f1" }, null);
setNotificationLevel(HOST, { kind: "server" }, "all");
assert.equal(shouldNotifyForMessage(HOST, from("webhook:1", "git-activity"), background(false)), false);

// Muting the server silences a channel the server set to everything, and a mention in it.
setNotificationLevel(HOST, { kind: "server" }, "none");
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), background(false)), false);
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), onScreen(false)), false);
assert.equal(shouldNotifyForMessage(HOST, naming("u2", "general"), background(false, true)), false);
// A server at mentions still lets a mention through.
setNotificationLevel(HOST, { kind: "server" }, "mentions");
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), background(false)), false);
assert.equal(shouldNotifyForMessage(HOST, naming("u2", "general"), background(false, true)), true);
setNotificationLevel(HOST, { kind: "server" }, null);

// The global ceiling still sits over everything, and a mention passes a ceiling of mentions.
setGlobalLevel("mentions");
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), background(false)), false);
assert.equal(shouldNotifyForMessage(HOST, naming("u2", "general"), background(false, true)), true);
setGlobalLevel("none");
assert.equal(shouldNotifyForMessage(HOST, naming("u2", "general"), background(false, true)), false);
setGlobalLevel("all");
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), background(false)), true);

// A fresh server:details replaces the defaults rather than merging them.
rememberPlacements(HOST, sidebar, [{ id: "git-activity", defaultNotificationLevel: "all" }]);
assert.equal(shouldNotifyForMessage(HOST, from("webhook:1", "git-activity"), background(false)), true);

console.log("message notification: ok");
