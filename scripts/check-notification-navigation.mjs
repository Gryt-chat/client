/* eslint-env node */

// A desktop notification is a destination, not only a way to focus the window.
// The native bridge and the browser path both have to keep the channel identity.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const notifications = read("src/packages/lib/desktopNotification.ts");
const electronMain = read("electron/main.ts");
const preload = read("electron/preload.ts");
const app = read("src/components/mainApp.tsx");
const view = read("src/packages/socket/src/components/serverView.tsx");
const chat = read("src/packages/socket/src/hooks/useChat.ts");
const socketEvents = read("src/packages/socket/src/hooks/useSocketEvents.ts");

assert.match(
  notifications,
  /destination\?: NotificationDestination/,
  "desktop notifications no longer carry their channel destination",
);
assert.match(
  notifications,
  /bridge\(\{ title, body, destination \}\)/,
  "Electron notifications drop the destination before IPC",
);
assert.match(
  notifications,
  /if \(destination\) dispatchNotificationOpen\(destination\)/,
  "browser notification clicks only focus the window",
);

assert.match(
  electronMain,
  /webContents\.send\("notification-click", destination\)/,
  "the native notification click is not sent back to the renderer",
);
assert.match(
  preload,
  /ipcRenderer\.on\("notification-click", handler\)/,
  "the preload bridge does not expose native notification clicks",
);

assert.match(
  app,
  /onDesktopNotificationOpen\(\(\{ host, channelId \}\) =>/,
  "the app shell does not listen for notification destinations",
);
assert.match(
  app,
  /setLastSelectedChannelForServer\(host, channelId\);\s*switchToServer\(host\)/,
  "cross-server notification clicks do not preserve the destination channel",
);

assert.match(
  view,
  /NOTIFICATION_CHANNEL_OPEN_EVENT/,
  "the server view does not listen for an already-open server's notification click",
);
assert.match(
  view,
  /setSelectedDmId\(null\);\s*setSelectedChannelId\(channelId\)/,
  "a notification click does not actually select the notified channel",
);

assert.match(
  chat,
  /isChannel \? \{ host: serverHost, channelId: msg\.conversation_id \} : undefined/,
  "foreground-server notifications do not distinguish channels from DMs",
);
assert.match(
  socketEvents,
  /\? \{ host, channelId: msg\.conversation_id \}\s*: undefined/,
  "background-server notifications do not carry channel destinations",
);

console.log("notification navigation: ok");
