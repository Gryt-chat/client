/* eslint-env node */

/**
 * The fixture that starts before the socket handler. A source check, the way
 * `check-fake-participants.mjs` is: these modules read `import.meta.env`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const events = read("../src/packages/socket/src/dev/fakeServerEvents.ts");
const chat = read("../src/packages/socket/src/dev/fakeChat.ts");

/* ── Dev only, at every door ─────────────────────────────────────────────── */

// A build that can inject events into its own socket is a build that can be
// made to show somebody a call that is not happening.
for (const entry of ["deliverServerEvent", "readFakeCallOptions", "useFakeCallEvents"]) {
  const start = events.indexOf(`export function ${entry}`);
  assert.notEqual(start, -1, `${entry} is gone`);
  const body = events.slice(start, start + 400);
  assert.match(
    body,
    /import\.meta\.env\.DEV/,
    `${entry} has to refuse to run outside a dev build`,
  );
}

/* ── The peer arrives the way the server actually sends one ──────────────── */

// The blank room is the entire point: the server blanks a conversation id out of
// `server:clients` because that payload goes to every member.
const peer = events.slice(events.indexOf("export function fakeCallPeer"));
assert.match(
  peer.slice(0, 800),
  /voiceChannelId: "",/,
  "fakeCallPeer must leave the room blank — filling it in makes the fixture unable to fail",
);

// And it goes in through the handler rather than around it.
assert.match(
  events,
  /deliverServerEvent\(socket, "server:clients"/,
  "the peer has to arrive through server:clients, which is where the bug lived",
);

/* ── The broken case stays reachable ─────────────────────────────────────── */

// `voice:call:members` is what puts the id back. Turning it off is how somebody
// sees what a client that ignores it looks like.
assert.match(
  events,
  /params\.get\("fakecallmembers"\) !== "0"/,
  "there has to be a way to ask for the call without the members event",
);
assert.match(
  events,
  /if \(options\.members\)/,
  "and the fixture has to honour it",
);

/* ── One delivery, not two ───────────────────────────────────────────────── */

// `fakeChat` had its own copy of this loop. Two ways to deliver a fake event is
// two behaviours to drift.
assert.match(
  chat,
  /deliverServerEvent\(latest\.current\.connection, event, message\)/,
  "fakeChat should deliver through the shared helper",
);
assert.equal(
  /const listeners = latest\.current\.connection\?\.listeners/.test(chat),
  false,
  "fakeChat still has its own delivery loop",
);

console.log("fake server events: dev-gated, delivered through the handler, and able to reproduce the empty call");
