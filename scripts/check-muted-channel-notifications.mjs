/* eslint-env node */

// Muted messages stay unread, and neither chat:new handler decides on its own
// whether to badge, sound or notify: both ask shouldNotifyForMessage first.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chat = readFileSync(
  join(root, "src/packages/socket/src/hooks/useChat.ts"),
  "utf8",
);
const events = readFileSync(
  join(root, "src/packages/socket/src/hooks/useSocketEvents.ts"),
  "utf8",
);

const onNew = chat.slice(
  chat.indexOf("const onNew = (msg: ChatMessage) =>"),
  chat.indexOf("const onHistory", chat.indexOf("const onNew = (msg: ChatMessage) =>")),
);
const background = events.slice(
  events.indexOf('socket.on("chat:new"'),
  events.indexOf('socket.on("mention:new"', events.indexOf('socket.on("chat:new"')),
);

assert.match(
  onNew,
  /markChannelUnread\(serverHost, msg\.conversation_id\)/,
  "muting a channel stopped messages from becoming unread on the server on screen",
);
assert.match(
  background,
  /markChannelUnread\(host, msg\.conversation_id\)/,
  "muting a channel stopped messages from becoming unread on a background server",
);

// The active path names itself as on screen and hands over the window's focus.
assert.match(
  onNew,
  /shouldNotifyForMessage\(serverHost, msg, \{\s*myId: currentUserId,\s*viewingThisServer: true,\s*windowFocused: document\.hasFocus\(\),\s*\}\)/,
  "the server on screen no longer asks shouldNotifyForMessage with focus and its own id",
);
assert.match(
  onNew,
  /if \(!notify\) return;[\s\S]*incrementUnread\(\)[\s\S]*showDesktopNotification[\s\S]*messageSoundRef\.current\(\)/,
  "on the server on screen the answer does not gate the badge, OS notification and sound together",
);

// The background path says it is not on screen and hands over the same focus.
assert.match(
  background,
  /shouldNotifyForMessage\(host, msg, \{\s*myId,\s*viewingThisServer: false,\s*windowFocused: document\.hasFocus\(\),\s*\}\)/,
  "a background server no longer asks shouldNotifyForMessage",
);
assert.match(
  background,
  /if \(!notify\) return;[\s\S]*playNotificationSound[\s\S]*incrementUnreadRef\.current\(\)[\s\S]*showDesktopNotification/,
  "on a background server the answer does not gate the sound, badge and OS notification together",
);

// Neither handler resolves a level on its own any more.
assert.doesNotMatch(onNew, /resolveAnnounceLevel|shouldAnnounceMessage|document\.hasFocus\(\)\)\s*\{/, "useChat decides on its own again");
assert.doesNotMatch(background, /resolveAnnounceLevel|shouldAnnounceMessage/, "useSocketEvents decides on its own again");

console.log("muted channel notifications: ok");
