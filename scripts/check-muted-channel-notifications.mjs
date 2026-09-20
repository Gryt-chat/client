/* eslint-env node */

// Muting a channel means no interruption from it. Messages still become unread,
// but the active-server path must use the same notification resolver as every
// background server instead of firing sound/OS notifications directly.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chat = readFileSync(
  join(root, "src/packages/socket/src/hooks/useChat.ts"),
  "utf8",
);

const onNew = chat.slice(
  chat.indexOf("const onNew = (msg: ChatMessage) =>"),
  chat.indexOf("const onHistory", chat.indexOf("const onNew = (msg: ChatMessage) =>")),
);

assert.match(
  onNew,
  /markChannelUnread\(serverHost, msg\.conversation_id\)/,
  "muting a channel stopped messages from becoming unread",
);
assert.match(
  onNew,
  /resolveAnnounceLevel\(\s*serverHost,\s*getPlacement\(serverHost, msg\.conversation_id\),\s*\)/,
  "active-server messages bypass the per-channel notification level",
);
assert.match(
  onNew,
  /if \(!shouldAnnounceMessage\(level\)\) return;[\s\S]*incrementUnread\(\)[\s\S]*showDesktopNotification[\s\S]*messageSoundRef\.current\(\)/,
  "mute does not gate the badge, OS notification and sound together",
);

console.log("muted channel notifications: ok");
