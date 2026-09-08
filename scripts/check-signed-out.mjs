/* eslint-env node */

/**
 * The note that keeps a signed-out device signed out across a restart. The
 * chokepoint that reads it is JSX and is called out in the PR instead.
 */

import assert from "node:assert/strict";

// A localStorage good enough for the module, and for the ways it can fail.
let store = new Map();
let throwing = false;
globalThis.localStorage = {
  getItem: (k) => {
    if (throwing) throw new Error("site data blocked");
    return store.has(k) ? store.get(k) : null;
  },
  setItem: (k, v) => {
    if (throwing) throw new Error("site data blocked");
    store.set(k, String(v));
  },
  removeItem: (k) => store.delete(k),
};

const { clearSignedOut, isSignedOut, markSignedOut, signedOutAt } = await import(
  "../src/packages/common/src/utils/signedOut.ts"
);

const HOST = "community.gryt.chat";
const OTHER = "gryt.example:5001";

// ── it remembers ───────────────────────────────────────────────────

assert.equal(isSignedOut(HOST), false, "a device nobody signed out starts clean");

markSignedOut(HOST);
assert.equal(isSignedOut(HOST), true);
assert.ok(signedOutAt(HOST), "and records when, for a device list to show later");

// The point of the whole thing: it is on disk, not in a component. A fresh
// import with the same storage still knows.
const reloaded = await import(
  "../src/packages/common/src/utils/signedOut.ts?restart"
);
assert.equal(reloaded.isSignedOut(HOST), true, "restarting the app must not undo it");

// ── it is about one server ─────────────────────────────────────────

assert.equal(isSignedOut(OTHER), false, "signing out of one server is not signing out of all");
markSignedOut(OTHER);
assert.equal(isSignedOut(HOST), true, "and marking a second must not drop the first");
assert.equal(isSignedOut(OTHER), true);

// Keyed the way the rest of the client keys servers, or the guard reads a
// different entry than the sign-out wrote and lets the device straight back in.
assert.equal(isSignedOut(HOST.toUpperCase()), true, "case must not matter");
assert.equal(isSignedOut(`  ${HOST} `), true, "nor should surrounding space");

// ── only a deliberate clear lifts it ───────────────────────────────

clearSignedOut(HOST);
assert.equal(isSignedOut(HOST), false);
assert.equal(isSignedOut(OTHER), true, "clearing one must leave the other standing");
assert.equal(signedOutAt(HOST), null);

clearSignedOut("never-signed-out.example");
assert.equal(isSignedOut(OTHER), true, "clearing something absent must not disturb the rest");

// Empty and blank hosts are nobody. Writing one would put a key in that no
// lookup matches; reading one must not answer yes and strand a real server.
markSignedOut("");
markSignedOut("   ");
assert.equal(isSignedOut(""), false);
assert.equal(isSignedOut("   "), false);
// The record itself, not just the lookup: `isSignedOut` refuses a blank host on
// its own, which would hide a `markSignedOut` that had written one.
assert.equal(signedOutAt(""), null, "a blank host must not reach the record");
assert.equal(signedOutAt("   "), null);

// ── storage that will not cooperate ────────────────────────────────

// A private window, a browser blocking site data, a thumbnail render. A device
// that cannot remember must start, and must not claim to be signed out.
throwing = true;
assert.equal(isSignedOut(OTHER), false, "unreadable storage means no note, not every note");
// Including the empty key, because a fallback that invents one entry is a
// fallback that can invent any entry.
assert.equal(isSignedOut(""), false);
assert.equal(signedOutAt(""), null, "the fallback has to be empty, not merely unhelpful");
assert.equal(signedOutAt(OTHER), null);
assert.doesNotThrow(() => markSignedOut("somewhere.example"));
assert.doesNotThrow(() => clearSignedOut("somewhere.example"));
throwing = false;

// Rubbish in the key is the same situation: ignore it rather than throwing on
// the way through a start-up path.
store.set("gryt.signedOutServers", "not json at all");
assert.equal(isSignedOut(OTHER), false);
// An array has keys of its own -- "0", "1", "length" -- and reading one as a
// record makes those answer yes to a host lookup.
store.set("gryt.signedOutServers", JSON.stringify(["a", "b"]));
assert.equal(isSignedOut(OTHER), false, "an array is not the shape this writes");
assert.equal(isSignedOut("0"), false, "an array index must not read as a host");
assert.equal(isSignedOut("length"), false);
assert.equal(signedOutAt("0"), null);

// And it recovers: a mark after rubbish gives a readable record again.
markSignedOut(HOST);
assert.equal(isSignedOut(HOST), true);

console.log("signed out: ok");
