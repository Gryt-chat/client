/* eslint-env node */

// Runs the rail's own status lines for a server this machine hosts. Starting follows the
// embedded manager alone, so a call anywhere cannot hide a server that is booting. GRYT-1139.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SIDEBAR = "src/components/sidebar.tsx";
const MANAGER = "electron/embeddedServerManager.ts";
const PRESENCE = "src/packages/webRTC/src/adapters/useVoicePresence.ts";
const read = (p) => readFileSync(join(root, p), "utf8");
const sidebar = read(SIDEBAR);
const manager = read(MANAGER);
const presence = read(PRESENCE);

const HOST = "127.0.0.1:5010";

/* Every status the manager can hand the rail, read from its own type, so a new one
   fails here until somebody decides whether it counts as booting. */
const LIFECYCLE = (() => {
  const union = manager.match(/export type ServerStatus = ([^;]+);/);
  assert.ok(union, `${MANAGER} no longer declares ServerStatus. Move this check with it.`);
  return [...union[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
})();
assert.deepEqual(
  [...LIFECYCLE].sort(),
  ["error", "running", "starting", "stopped"],
  `${MANAGER} has a lifecycle status this check has not decided about`,
);

// What useSockets can set for a host, and no entry at all for one it has not reached.
const SOCKET = [undefined, "connecting", "connected", "reconnecting", "disconnected", "refused"];

const CALLS = {
  "no call": { inCall: false, transmitting: false, live: false, muted: false, host: "", channelId: "", state: "disconnected" },
  "a call up on this server": { inCall: true, transmitting: true, live: true, muted: false, host: HOST, channelId: "c1", state: "connected" },
  "a call up on another server": { inCall: true, transmitting: true, live: true, muted: false, host: "a.example", channelId: "c1", state: "connected" },
  "a muted call": { inCall: true, transmitting: false, live: true, muted: true, host: "a.example", channelId: "c1", state: "connected" },
  "a call coming up": { inCall: true, transmitting: false, live: false, muted: false, host: "a.example", channelId: "c1", state: "connecting" },
};

/* Every field the hook returns, so a status line that starts reading a new one is not
   quietly handed undefined. */
{
  const type = presence.match(/export type VoicePresence = \{([\s\S]*?)\n\};/);
  assert.ok(type, `${PRESENCE} no longer declares VoicePresence. Move this check with it.`);
  const fields = [...type[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
  for (const [call, voice] of Object.entries(CALLS)) {
    assert.deepEqual(Object.keys(voice).sort(), fields, `the "${call}" fixture no longer matches VoicePresence`);
  }
}

/* ServerItem's own lines, from the status it reads to the ring it draws, with the
   component's inputs handed in. The settle effect is not run; its result is. */
const statusLines = (() => {
  const start = sidebar.indexOf("const rawStatus = serverConnectionStatus[host];");
  assert.notEqual(start, -1, `${SIDEBAR} no longer reads rawStatus. Move this check with it.`);
  const ring = sidebar.indexOf("const ringState", start);
  assert.notEqual(ring, -1, `${SIDEBAR} no longer declares ringState after rawStatus. Move this check with it.`);
  return sidebar.slice(start, sidebar.indexOf(";", ring) + 1).replace(/: ServerRingState/g, "");
})();

function rail({ embedded, voice, socket, settleExpired = false }) {
  return new Function(
    "serverConnectionStatus",
    "host",
    "embeddedStatus",
    "voice",
    "useState",
    "useEffect",
    "UNKNOWN_SETTLE_MS",
    `${statusLines}\nreturn { isStarting, isSettling, ringState, isUnavailable };`,
  )(
    socket === undefined ? {} : { [HOST]: socket },
    HOST,
    embedded,
    voice,
    () => [settleExpired, () => {}],
    () => {},
    10_000,
  );
}

// The reported shape: a server booting while you are in a call reads as booting.
for (const [call, voice] of Object.entries(CALLS)) {
  for (const socket of [undefined, "connecting", "disconnected", "reconnecting"]) {
    const got = rail({ embedded: "starting", voice, socket });
    assert.equal(got.isStarting, true, `a booting server with ${call} and socket ${socket ?? "unset"} is not starting`);
    assert.equal(got.ringState, "starting", `a booting server with ${call} draws "${got.ringState}", not the starting ring`);
    assert.equal(got.isSettling, false, `a booting server with ${call} is given the settle deadline`);
  }
}

// Running, stopped and error are the manager saying it is not booting, whatever voice is doing.
for (const embedded of ["running", "stopped", "error"]) {
  for (const [call, voice] of Object.entries(CALLS)) {
    const got = rail({ embedded, voice, socket: "reconnecting" });
    assert.equal(got.isStarting, false, `a ${embedded} server with ${call} reads as starting`);
    assert.equal(got.ringState, "reconnecting", `a ${embedded} server with ${call} lost its socket's ring`);
  }
}

// Not a server this machine runs: never starting, and a new one still gets the settle clock.
for (const [call, voice] of Object.entries(CALLS)) {
  const fresh = rail({ embedded: undefined, voice, socket: undefined });
  assert.equal(fresh.isStarting, false, `a remote server with ${call} reads as starting`);
  assert.equal(fresh.ringState, "settling", `a remote server with no answer yet and ${call} draws "${fresh.ringState}"`);
}

// The whole grid. Starting follows the manager exactly, and voice changes nothing at all.
for (const embedded of [...LIFECYCLE, undefined]) {
  for (const socket of SOCKET) {
    for (const settleExpired of [false, true]) {
      const quiet = rail({ embedded, voice: CALLS["no call"], socket, settleExpired });
      const where = `embedded ${embedded ?? "(not ours)"}, socket ${socket ?? "unset"}${settleExpired ? ", settle expired" : ""}`;
      assert.equal(quiet.isStarting, embedded === "starting", `${where}: starting does not follow the manager`);
      if (quiet.isStarting) assert.equal(quiet.ringState, "starting", `${where}: starting draws another ring`);
      for (const [call, voice] of Object.entries(CALLS)) {
        assert.deepEqual(rail({ embedded, voice, socket, settleExpired }), quiet, `${where}: ${call} changes the rail`);
      }
    }
  }
}

// The prop is the manager's status for that host, and the ring drawn is the one computed above.
{
  assert.match(sidebar, /map\[normalizeHost\([^\]]*\)\] = server\.status;/, "the rail's embedded status is no longer the manager's status");
  assert.match(sidebar, /embeddedStatus=\{embeddedStatusByHost\[host\]\}/, "ServerItem is not handed the embedded status for its own host");
  assert.match(sidebar, /<ServerStatusRing state=\{ringState\}/, "the rail draws a ring other than the one this check runs");
  assert.equal(sidebar.match(/const isStarting\b/g)?.length, 1, `${SIDEBAR} declares isStarting more than once`);
}

console.log("embedded starting: the rail says a server is booting when the manager does, call or no call");
