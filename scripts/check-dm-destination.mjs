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

/* Coming back through the rail is a fresh visit with nothing asked for, which is
   the overview. Opening again must not resurrect the last conversation. */
{
  space.resetDmSpace();
  space.requestConversation("a.example", "dm-1");
  space.setDmSpaceOpen(true);
  space.setDmSpaceOpen(false);
  space.setDmSpaceOpen(true);
  assert.equal(space.visitingConversation(), null, "reopening from the rail brought the old conversation back");
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
  assert.ok(/setDmSpaceOpen\(true\)/.test(rail), "the rail button no longer opens the space");
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

console.log("dm destination: ok, a place you go, and empty only while you are there");
