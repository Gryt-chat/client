/* eslint-env node */

/**
 * One decision for the server on screen and the ones in the background. Focus,
 * the channel's own default and this person's levels all meet in it.
 */

import assert from "node:assert/strict";

const {
  rememberPlacements,
  setGlobalLevel,
  setNotificationLevel,
  shouldNotifyForMessage,
} = await import("../src/packages/common/src/hooks/notificationPrefs.ts");

const HOST = "gryt.test:5001";
const ME = "user_me";
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
});
const onScreen = (windowFocused) => ({ myId: ME, viewingThisServer: true, windowFocused });
const background = (windowFocused) => ({ myId: ME, viewingThisServer: false, windowFocused });

// ── The two paths, on a channel nobody has touched ──────────────────────────

// Looking at the server in a focused window: it is on screen or one click away.
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), onScreen(true)), false);
// The same server once the window is in the background.
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), onScreen(false)), true);
// A background server is not on screen, whatever the window is doing.
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), background(true)), true);
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), background(false)), true);

// Your own echo never announces, on either path.
assert.equal(shouldNotifyForMessage(HOST, from(ME, "general"), onScreen(false)), false);
assert.equal(shouldNotifyForMessage(HOST, from(ME, "general"), background(false)), false);

// A thread reply is the thread tracker's, not a notification.
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general", "t1"), onScreen(false)), false);
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general", "t1"), background(true)), false);

// ── The channel's own default ───────────────────────────────────────────────

// An automated feed defaults to quiet, on both paths.
assert.equal(shouldNotifyForMessage(HOST, from("webhook:1", "git-activity"), onScreen(false)), false);
assert.equal(shouldNotifyForMessage(HOST, from("webhook:1", "git-activity"), background(true)), false);
// A channel the server set to mentions is quiet for a plain message.
assert.equal(shouldNotifyForMessage(HOST, from("u2", "announcements"), background(false)), false);
// No level from the server, or one this build does not know, reads as everything.
assert.equal(shouldNotifyForMessage(HOST, from("u2", "old-server"), background(false)), true);
assert.equal(shouldNotifyForMessage(HOST, from("u2", "junk"), background(false)), true);
// A channel this client has never seen listed resolves to the server level.
assert.equal(shouldNotifyForMessage(HOST, from("u2", "unseen"), background(false)), true);

// ── This person's own levels ────────────────────────────────────────────────

// Setting the channel itself overrides the default, either way.
setNotificationLevel(HOST, { kind: "channel", id: "git-activity" }, "all");
assert.equal(shouldNotifyForMessage(HOST, from("webhook:1", "git-activity"), background(false)), true);
assert.equal(shouldNotifyForMessage(HOST, from("webhook:1", "git-activity"), onScreen(false)), true);
// Still quiet while it is on screen in a focused window: the override is about the level, not focus.
assert.equal(shouldNotifyForMessage(HOST, from("webhook:1", "git-activity"), onScreen(true)), false);
setNotificationLevel(HOST, { kind: "channel", id: "general" }, "none");
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), background(false)), false);
setNotificationLevel(HOST, { kind: "channel", id: "general" }, null);
setNotificationLevel(HOST, { kind: "channel", id: "git-activity" }, null);

// Turning the folder or the server up does not un-quiet the feed: the default only quietens.
setNotificationLevel(HOST, { kind: "folder", id: "f1" }, "all");
assert.equal(shouldNotifyForMessage(HOST, from("webhook:1", "git-activity"), background(false)), false);
setNotificationLevel(HOST, { kind: "folder", id: "f1" }, null);
setNotificationLevel(HOST, { kind: "server" }, "all");
assert.equal(shouldNotifyForMessage(HOST, from("webhook:1", "git-activity"), background(false)), false);

// Muting the server silences a channel the server set to everything.
setNotificationLevel(HOST, { kind: "server" }, "none");
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), background(false)), false);
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), onScreen(false)), false);
setNotificationLevel(HOST, { kind: "server" }, null);

// The global ceiling still sits over everything.
setGlobalLevel("mentions");
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), background(false)), false);
setGlobalLevel("all");
assert.equal(shouldNotifyForMessage(HOST, from("u2", "general"), background(false)), true);

// A fresh server:details replaces the defaults rather than merging them.
rememberPlacements(HOST, sidebar, [{ id: "git-activity", defaultNotificationLevel: "all" }]);
assert.equal(shouldNotifyForMessage(HOST, from("webhook:1", "git-activity"), background(false)), true);

console.log("message notification: ok");
