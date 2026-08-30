/* eslint-env node */

/**
 * A returning member says what key to encrypt to them (GRYT-758).
 *
 * `publishDmKey` ran from one place: the `server:joined` handler. The server
 * emits that from one place too — inside `server:verify` — and a client holding
 * a token never goes near it, because `useSockets` sends `session:restore` on
 * connect instead.
 *
 * So encrypted DMs worked for anybody who joined a server after the feature
 * shipped and for nobody who was already a member. Nothing errored, no key ever
 * left the device, and the composer correctly said the other side had published
 * nothing. It was found by wiring the same feature into the mobile app and
 * asking where the phone should publish.
 *
 * Two halves, checked two ways. The guard is arithmetic and is imported. The
 * wiring is in a module that pulls in React, a toast library and `@/common`
 * through a Vite alias, none of which load here — which is most of why this went
 * out — so it is read as source.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { firstTimeOnThisSocket } from "../src/packages/socket/src/utils/publishedOnce.ts";

/* ── once per socket, and per socket rather than globally ────────────────── */

{
  const a = {};
  const b = {};

  assert.equal(firstTimeOnThisSocket(a, "dm-key"), true);
  assert.equal(firstTimeOnThisSocket(a, "dm-key"), false,
    "a second ask on the same socket has to be refused; the server allows five a minute and server:details arrives on every change");

  assert.equal(firstTimeOnThisSocket(b, "dm-key"), true,
    "a different server is a different socket and has to publish for itself");

  assert.equal(firstTimeOnThisSocket(a, "something-else"), true,
    "two tasks on one socket are two answers, or adding a second one silently disables the first");
  assert.equal(firstTimeOnThisSocket(a, "dm-key"), false);
}

/* ── and publishDmKey actually publishes ─────────────────────────────────── */

{
  /*
   * The half this check missed the first time (GRYT-759).
   *
   * It asserted that both handlers *call* `publishDmKey`, which they did, and
   * stopped there. `publishDmKey` then returned early unless
   * `identitySourceUsedFor(host)` had something — an in-memory map filled by
   * answering a challenge. A returning member restores a session instead of
   * answering one, so the map was empty and nothing was published: the event
   * was fixed and the guard behind it was not.
   *
   * Asserting a call reaches a function is not the same as asserting the
   * function does the thing. This reads the function.
   */
  const publisherFile = readFileSync(
    new URL("../src/packages/socket/src/utils/dmKeys.ts", import.meta.url),
    "utf8",
  );

  // Comments stripped, because the file explains at length why the guard below
  // is gone — and naming a thing in prose is not the same as calling it.
  const publisher = publisherFile
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  assert.match(publisher, /socket\.emit\("dm:key:publish"/,
    "publishDmKey does not publish anything");

  assert.doesNotMatch(publisher, /identitySourceUsedFor/,
    "publishDmKey asks which identity joined again. That map is empty after a reload, so a returning member publishes nothing — which is the bug GRYT-758 was supposed to close.");

  // Any early return before the emit is a member who silently publishes
  // nothing, and every one of those has looked reasonable so far.
  const beforeEmit = publisher.slice(
    publisher.indexOf("export async function publishDmKey"),
    publisher.indexOf('socket.emit("dm:key:publish"'),
  );
  assert.doesNotMatch(beforeEmit, /^\s*if \(![a-zA-Z]+\) return;/m,
    "publishDmKey returns early on something. If that is deliberate, say which members it drops and why.");
}

/* ── both routes into a server publish ───────────────────────────────────── */

const source = readFileSync(
  new URL("../src/packages/socket/src/hooks/registerServerSocketEvents.ts", import.meta.url),
  "utf8",
);

/** The body of one `socket.on("<event>", ...)` handler, to its closing line. */
function handlerBody(event) {
  const opener = `socket.on("${event}"`;
  const start = source.indexOf(opener);
  assert.notEqual(start, -1, `there is no ${event} handler any more`);

  // Handlers here are written at one indent level and closed with `});` at
  // that level, which is what ends the slice.
  const end = source.indexOf("\n  });", start);
  assert.notEqual(end, -1, `could not find the end of the ${event} handler`);
  return source.slice(start, end);
}

for (const event of ["server:joined", "server:details"]) {
  assert.match(
    handlerBody(event),
    /publishDmKey\(socket, host\)/,
    `${event} does not publish the DM key. That is the bug: a first join produces server:joined and a returning member produces only server:details, so leaving either one out turns encrypted DMs off for half the users with nothing to show for it.`,
  );
}

for (const event of ["server:joined", "server:details"]) {
  assert.match(
    handlerBody(event),
    /firstTimeOnThisSocket\(socket, DM_KEY\)/,
    `${event} publishes without the guard, so a reconnect or a server change republishes into a five-a-minute rate limit`,
  );
}

console.log(
  "dm key: published on a first join and on a restore, once per socket, and publishDmKey drops nobody",
);
