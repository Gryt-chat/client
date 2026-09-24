/* eslint-env node */

// Runs the effect that ends a call when its server is removed. A call stuck on
// RECONNECTING was skipped and held the microphone open for good. GRYT-1322.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = "src/packages/webRTC/src/adapters/useVoiceLifecycle.tsx";
const hook = readFileSync(join(root, HOOK), "utf8");

const STATES = {
  DISCONNECTED: "disconnected",
  REQUESTING_ACCESS: "requesting_access",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  RECONNECTING: "reconnecting",
  FAILED: "failed",
};

const ANCHOR = "// Leaving a server while in one of its voice channels should end the call.";

/** The body of the `useEffect` callback that follows `anchor`. */
function effectBody(text, anchor) {
  const at = text.indexOf(anchor);
  assert.notEqual(at, -1, `${HOOK} no longer has "${anchor}". Move this check with it.`);
  const arrow = text.indexOf("useEffect(() => {", at);
  assert.notEqual(arrow, -1, `no useEffect after the anchor in ${HOOK}`);
  const start = text.indexOf("{", arrow);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after the anchor in ${HOOK}`);
}

const body = effectBody(hook, ANCHOR);

/** Runs the effect once and says whether it ended the call. */
function endsCall({ state, host = "a.example", servers = {}, viewing = "" }) {
  let ended = 0;
  /* `isConnected` is handed in as well, so this runs against the version of the
     effect that read it and fails on the assertion rather than on a name. */
  new Function(
    "SFUConnectionState",
    "connectionState",
    "isConnected",
    "currentServerConnected",
    "servers",
    "currentlyViewingServer",
    "disconnect",
    "console",
    `return (() => ${body})();`,
  )(
    STATES,
    state,
    state === STATES.CONNECTED,
    host,
    servers,
    viewing ? { host: viewing } : undefined,
    () => { ended += 1; return Promise.resolve(); },
    { error() {} },
  );
  return ended === 1;
}

const GONE = {};
const STILL_THERE = { "a.example": { name: "A" } };

// The call this was written for, which still has to work.
assert.ok(
  endsCall({ state: STATES.CONNECTED, servers: GONE }),
  "removing a server during a live call has to end the call",
);

/* A call whose socket has gone. The engine parks on RECONNECTING waiting for
   signalling, and a removed server never signals again. */
for (const state of [STATES.RECONNECTING, STATES.FAILED, STATES.CONNECTING, STATES.REQUESTING_ACCESS]) {
  assert.ok(
    endsCall({ state, servers: GONE }),
    `a call on ${state} has to end when its server is removed — the microphone stays open otherwise`,
  );
}

// Nothing to end, and calling disconnect would clear a state somebody else set.
assert.ok(
  !endsCall({ state: STATES.DISCONNECTED, servers: GONE }),
  "no call means nothing to hang up",
);

// Removing one server must not touch a call on another.
assert.ok(
  !endsCall({ state: STATES.RECONNECTING, servers: STILL_THERE }),
  "a server that is still in the list is not a removed one",
);

// The server is on screen, so it has not been left.
assert.ok(
  !endsCall({ state: STATES.RECONNECTING, servers: GONE, viewing: "a.example" }),
  "the server being viewed is not a removed one",
);

// No server on the call means no server to compare against the list.
assert.ok(
  !endsCall({ state: STATES.RECONNECTING, host: "", servers: GONE }),
  "a call with no host cannot be matched to a removed server",
);

console.log("voice server removed: a call on any live state ends when its server goes");
