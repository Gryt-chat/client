/* eslint-env node */

// Clicks a desktop notification from another server and follows it to the channel on screen.
// e2e/tests/navigation.spec.ts does the same in a browser against two real servers. GRYT-1318.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* ── just enough window for the notification module ─────────────────────── */

globalThis.window = new EventTarget();
window.focus = () => {};
const raised = [];
globalThis.Notification = class {
  static permission = "granted";
  constructor(title, options = {}) {
    this.title = title;
    this.body = options.body ?? "";
    this.onclick = null;
    this.closed = false;
    raised.push(this);
  }
  close() {
    this.closed = true;
  }
};

const { onDesktopNotificationOpen, showDesktopNotification } = await import("../src/packages/lib/desktopNotification.ts");
const { NO_CHANNEL, selectChannel } = await import("../src/packages/socket/src/utils/channelSelection.ts");

/* ── the app: mainApp's click handler, the rail, and the server view's pick ─ */

const ALPHA = "alpha.example:5000";
const BRAVO = "bravo.example:5000";

function channels(...rows) {
  return rows.map(([id, type = "text"]) => ({ id, type }));
}

function app(serverChannels) {
  const saved = {};
  let viewing = null;
  let selection = NO_CHANNEL;
  const shown = () => {
    selection = selectChannel(selection, viewing, viewing ? serverChannels[viewing] : undefined, viewing ? saved[viewing] ?? null : null);
    return selection.channelId;
  };
  return {
    saved,
    shown,
    viewing: () => viewing,
    /** Clicking a server in the rail. */
    view(host) {
      viewing = host;
      return shown();
    },
    /** Clicking a text channel: picked here, and saved as this server's last. */
    pick(channelId) {
      selection = { host: viewing, channelId };
      saved[viewing] = channelId;
      return shown();
    },
    /** What mainApp does with a notification click. */
    opened({ host, channelId }) {
      if (!serverChannels[host]) return shown();
      saved[host] = channelId;
      viewing = host;
      return shown();
    },
    load(host, list) {
      serverChannels[host] = list;
      return shown();
    },
  };
}

/* ── a notification from Bravo, clicked while reading a channel on Alpha ─── */

{
  const gryt = app({
    [ALPHA]: channels(["general"], ["alpha-notes"], ["lounge", "voice"]),
    [BRAVO]: channels(["general"], ["bravo-notes"], ["lounge", "voice"]),
  });
  gryt.view(BRAVO);
  assert.equal(gryt.pick("general"), "general");
  gryt.view(ALPHA);
  assert.equal(gryt.pick("alpha-notes"), "alpha-notes");

  const stop = onDesktopNotificationOpen(gryt.opened);
  showDesktopNotification("Sender", "ping", { host: BRAVO, channelId: "bravo-notes" });
  assert.equal(raised.length, 1, "no browser notification was raised");
  raised[0].onclick();
  stop();

  assert.ok(raised[0].closed, "the notification stayed open after its click");
  assert.equal(gryt.viewing(), BRAVO, "the click did not switch servers");
  assert.equal(gryt.shown(), "bravo-notes", "the click landed on another channel than the notified one");

  // The same race broke remembering the last channel in both directions.
  assert.equal(gryt.view(ALPHA), "alpha-notes", "Alpha forgot its channel on the way back");
  assert.equal(gryt.view(BRAVO), "bravo-notes", "Bravo forgot the notified channel on the way back");
}

/* ── the Electron bridge carries the destination both ways ──────────────── */

{
  let sent = null;
  let clicked = null;
  window.electronAPI = {
    showNotification: (payload) => {
      sent = payload;
    },
    onNotificationClick: (callback) => {
      clicked = callback;
      return () => {
        clicked = null;
      };
    },
  };
  const gryt = app({ [ALPHA]: channels(["general"], ["alpha-notes"]), [BRAVO]: channels(["general"], ["bravo-notes"]) });
  gryt.view(ALPHA);
  gryt.pick("alpha-notes");

  const stop = onDesktopNotificationOpen(gryt.opened);
  showDesktopNotification("Sender", "ping", { host: BRAVO, channelId: "bravo-notes" });
  assert.deepEqual(sent?.destination, { host: BRAVO, channelId: "bravo-notes" }, "the destination did not reach the main process");
  assert.equal(typeof clicked, "function", "nothing listens for the main process's click");
  clicked(sent.destination);
  assert.equal(gryt.shown(), "bravo-notes");
  stop();
  assert.equal(clicked, null, "the click listener outlived its unsubscribe");
  delete window.electronAPI;

  // The main process and the preload can't run here, so only their wiring is checked: both ends name one channel.
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const channel = /webContents\.send\("([^"]+)", destination\)/.exec(read("electron/main.ts"))?.[1];
  assert.ok(channel, "electron/main.ts no longer sends a clicked notification's destination back");
  assert.ok(read("electron/preload.ts").includes(`ipcRenderer.on("${channel}", handler)`), `the preload doesn't listen on "${channel}"`);
}

/* ── what arriving on a server shows ─────────────────────────────────────── */

{
  // A channel both servers have under one id is not carried across.
  const gryt = app({ [ALPHA]: channels(["general"]), [BRAVO]: channels(["general"], ["bravo-notes"]) });
  gryt.view(BRAVO);
  gryt.pick("bravo-notes");
  gryt.view(ALPHA);
  gryt.pick("general");
  assert.equal(gryt.view(BRAVO), "bravo-notes", "Alpha's #general stood in for Bravo's saved channel");
}

{
  // A saved voice channel is not reopened as a text view.
  const gryt = app({ [ALPHA]: channels(["lounge", "voice"], ["general"]) });
  gryt.saved[ALPHA] = "lounge";
  assert.equal(gryt.view(ALPHA), "general");
}

{
  // Nothing until the channels arrive, then the saved one.
  const gryt = app({});
  gryt.saved[ALPHA] = "alpha-notes";
  assert.equal(gryt.view(ALPHA), null);
  assert.equal(gryt.load(ALPHA, channels(["general"], ["alpha-notes"])), "alpha-notes");
}

{
  // A picked channel that goes away falls back to the first text channel, then to anything.
  const gryt = app({ [ALPHA]: channels(["lounge", "voice"], ["general"], ["alpha-notes"]) });
  gryt.view(ALPHA);
  gryt.pick("alpha-notes");
  assert.equal(gryt.load(ALPHA, channels(["lounge", "voice"], ["general"])), "general");
  assert.equal(gryt.load(ALPHA, channels(["lounge", "voice"])), "lounge");
}

{
  // A pick on this server beats the saved channel, which a text click keeps in step anyway.
  const gryt = app({ [ALPHA]: channels(["general"], ["alpha-notes"], ["lounge", "voice"]) });
  gryt.view(ALPHA);
  gryt.pick("alpha-notes");
  gryt.saved[ALPHA] = "general";
  assert.equal(gryt.shown(), "alpha-notes");
}

{
  // Settled in one step: the answer comes back as the same object, so a render stops there.
  const list = channels(["general"], ["alpha-notes"]);
  const first = selectChannel({ host: BRAVO, channelId: "bravo-notes" }, ALPHA, list, "alpha-notes");
  assert.deepEqual(first, { host: ALPHA, channelId: "alpha-notes" });
  assert.equal(selectChannel(first, ALPHA, list, "alpha-notes"), first);
  assert.equal(selectChannel(first, null, undefined, null), NO_CHANNEL);
  assert.equal(selectChannel(NO_CHANNEL, null, undefined, null), NO_CHANNEL);
}

console.log("notification navigation: ok, a click from another server lands on its channel, and each server keeps its own");
