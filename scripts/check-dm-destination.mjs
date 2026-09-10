/* eslint-env node */

// Direct messages are a place you go, and an empty conversation exists only while you
// are looking at it. Sivert: "I dont want it to be a toggle view". GRYT-1146.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

/* The store, imported as TypeScript and run. It is the whole of the "is this empty
   conversation worth listing" rule, so it is worth running rather than reading. */
const space = await import("../src/packages/socket/src/hooks/dmSpace.ts");

// Clicking somebody records the visit, and going anywhere else forgets it.
{
  space.resetDmSpace();
  assert.equal(space.visitingConversation(), null, "a fresh space already remembers a conversation");

  space.requestConversation("a.example", "dm-1");
  space.setDmSpaceOpen(true);
  assert.equal(space.visitingConversation(), "dm-1", "the conversation just opened is not the one being visited");

  space.setDmSpaceOpen(false);
  assert.equal(
    space.visitingConversation(),
    null,
    "leaving the space kept the empty conversation, so it stays listed on the way back",
  );
}

// Clicking somebody else moves the visit, so the first one drops out.
{
  space.resetDmSpace();
  space.requestConversation("a.example", "dm-1");
  space.requestConversation("a.example", "dm-2");
  assert.equal(space.visitingConversation(), "dm-2", "the second person clicked did not replace the first");
}

/* Where the space was outlives leaving it. The view unmounts on the way to a
   server, so this memory has to live in the store or it is gone. */
{
  space.resetDmSpace();
  assert.equal(space.lastConversation(), null, "a fresh space remembers somewhere");
  space.rememberConversation("a.example", "dm-1");
  space.setDmSpaceOpen(true);
  space.setDmSpaceOpen(false);
  assert.deepEqual(
    space.lastConversation(),
    { host: "a.example", conversationId: "dm-1" },
    "leaving the space forgot where you were",
  );
  space.rememberConversation("b.example", "dm-2");
  assert.deepEqual(space.lastConversation(), { host: "b.example", conversationId: "dm-2" }, "the newer place did not replace the older");

  // A reset forgets it too, or one test's conversation leaks into the next.
  space.resetDmSpace();
  assert.equal(space.lastConversation(), null, "resetting the space kept where it had been");
}

const sidebar = read("src/packages/socket/src/components/DmSpaceSidebar.tsx");
const manage = read("src/packages/socket/src/hooks/useServerManagement.ts");
const rail = read("src/components/sidebar.tsx");
const view = read("src/packages/socket/src/components/serverView.tsx");
const dms = read("src/packages/socket/src/hooks/useDirectMessages.ts");

// The list reads the visit and the messages, not the selection.
{
  assert.ok(
    /last_message_at !== null/.test(sidebar) && /=== visiting/.test(sidebar),
    "the list does not hide a conversation nobody has written in",
  );
  assert.ok(
    /listed\.length === 0/.test(sidebar),
    "the empty state judges on the raw directory, so an unlisted conversation reads as a failed search",
  );
}

/* A destination, not a toggle. Picking a server leaves it, the way it already
   leaves Discovery, and the rail button only ever opens it. */
{
  const switchBody = manage.slice(manage.indexOf("const switchToServer"), manage.indexOf("const viewServerBehindDmSpace"));
  assert.ok(/setDmSpaceOpen\(false\)/.test(switchBody), "picking a server leaves you in the direct messages space");
  assert.ok(!/setDmSpaceOpen\(!dmSpaceOpen\)/.test(rail), "the rail button toggles again");
  assert.ok(/onClick=\{openDmSpace\}/.test(rail), "the rail button does not go through the opener that restores");
}

/* The space changes the server underneath itself without leaving. switchToServer
   now leaves the space, so using it here would drop you out mid-click. */
{
  assert.ok(
    /viewServerBehindDmSpace\(rowHost\)/.test(sidebar),
    "opening a conversation on another server goes through switchToServer, which leaves the space",
  );
  assert.ok(!/switchToServer\(rowHost\)/.test(sidebar), "the space still calls switchToServer to change host");
}

// Clicking somebody goes to the space rather than opening a conversation in place.
{
  assert.ok(
    /requestConversation\(host, conversationId\);\s*setDmSpaceOpen\(true\);/.test(view),
    "clicking somebody opens the conversation beside the channels instead of in the space",
  );
}

/* A message makes a conversation real without waiting for the server to say so,
   which a server older than 1.10.1 never does. */
{
  assert.ok(/socket\.on\("chat:new", onMessage\)/.test(dms), "the client does not watch messages to learn a conversation is real");
  assert.ok(/last_message_at !== null\) return prev/.test(dms), "a conversation already written in is rewritten on every message");
}

/* The opener restores only a conversation somebody has written in. An empty one
   drops out of the list when you leave, and restoring it would undo that. */
{
  const opener = read("src/packages/socket/src/hooks/useOpenDmSpace.ts");
  assert.ok(/lastConversation\(\)/.test(opener), "the opener does not look at where the space was");
  assert.ok(
    /last_message_at !== null/.test(opener),
    "the opener brings back an empty conversation, which the list had dropped",
  );
  assert.ok(/viewServerBehindDmSpace\(was\.host\)/.test(opener), "restoring a conversation on another server leaves the space");
  assert.ok(/rememberConversation\(host, visibleDmId\)/.test(view), "the space never records where it is");
  const mobile = read("src/packages/socket/src/components/MobileServerView.tsx");
  assert.ok(/openDmSpace\(\)/.test(mobile), "the phone opens the space without restoring, so it disagrees with the rail");
}

/* ── surviving a restart ─────────────────────────────────────────────────── */

/* lastView's own functions, with the store import swapped for a fake. The module
   is one import and plain TypeScript, so Node's stripper makes it runnable. */
const { stripTypeScriptTypes } = await import("node:module");
const lastViewSource = read("src/packages/settings/src/hooks/lastView.ts");
function loadLastView(store) {
  const body = stripTypeScriptTypes(
    lastViewSource.replace(/^import .*userStorage";\n/m, ""),
  ).replace(/^export /gm, "");
  return new Function(
    "getUserValue",
    "setUserValue",
    `${body}\nreturn { readLastView, writeLastView, lastViewHost };`,
  )(
    (key, fallback) => (key in store ? store[key] : fallback),
    (key, value) => { store[key] = value; },
  );
}

// Each kind of page goes to disk and comes back the same.
{
  for (const view of [
    { kind: "server", host: "a.example" },
    { kind: "dm", host: "a.example", conversationId: "dm-1" },
    { kind: "dm", host: "a.example", conversationId: null },
    { kind: "discovery" },
  ]) {
    const store = {};
    const lv = loadLastView(store);
    lv.writeLastView(view);
    assert.deepEqual(loadLastView(store).readLastView(), view, `${JSON.stringify(view)} did not survive a restart`);
  }
}

/* Rubbish on disk is nothing, so a launch falls back to the top of the rail rather
   than crashing on, or opening, whatever an older build wrote there. */
{
  for (const bad of [null, "server", 7, {}, { kind: "server" }, { kind: "dm", host: 3 }, { kind: "dm", host: "a", conversationId: 5 }, { kind: "channel", host: "a" }]) {
    assert.equal(loadLastView({ lastView: bad }).readLastView(), null, `${JSON.stringify(bad)} was read as a page`);
  }
}

// The server underneath, for launch focus: a server or a conversation, never Discovery.
{
  const { lastViewHost } = loadLastView({});
  assert.equal(lastViewHost({ kind: "server", host: "a.example" }), "a.example");
  assert.equal(lastViewHost({ kind: "dm", host: "b.example", conversationId: null }), "b.example");
  assert.equal(lastViewHost({ kind: "discovery" }), null, "Discovery named a server to open");
  assert.equal(lastViewHost(null), null);
}

/* Launch focus prefers where you were, and only while that server is still yours.
   A server removed since falls through to the rail rather than opening nothing. */
{
  const settings = read("src/packages/settings/src/hooks/useServerSettings.ts");
  assert.ok(
    /remembered && servers\[remembered\] \? remembered : topHost/.test(settings),
    "launch opens the top of the rail even when it knows where you were, or opens a removed server",
  );
}

/* Read before any write. The launch's own default page would otherwise be saved
   over the one that was open, and every restart would land on the rail's top. */
{
  const remember = read("src/packages/socket/src/hooks/useRememberView.ts");
  assert.ok(
    /if \(!ready \|\| !restored\.current \|\| !host\) return;/.test(remember),
    "the page is written before the last one has been read back",
  );
  assert.ok(
    /conversationId: written \? conversation!\.conversationId : null/.test(remember),
    "an empty conversation is saved to reopen, though the list drops it on the way out",
  );
}

console.log("dm destination: ok, a place you go, and empty only while you are there");
