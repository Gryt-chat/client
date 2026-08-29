/* eslint-env node */

/**
 * The client says the camera and the screen share are still on, after a
 * reconnect that did not move either (GRYT-612).
 *
 * `clientsInfo` on the server is keyed by socket id, so a reconnect hands the
 * client a fresh entry with `cameraEnabled` and `screenShareEnabled` back at
 * their defaults. The two effects that would correct that are keyed on the
 * camera and screen streams, the connection flag and the sockets map, and a
 * reconnect moves none of them — socket.io reuses the same Socket instance, so
 * even the map holds. The media itself never stopped either, because the
 * signalling socket is not the media path. So the room saw a camera that was
 * still sending as off.
 *
 * GRYT-644 fixed the same shape for mute, deafen and AFK, and that half had a
 * grace-period stash on the server behind it. Camera and screen share are never
 * stashed, so the client re-asserting them is the only thing that puts them
 * back. `check-voice-state-reassert.mjs` covers the other half.
 *
 * A source check, for the same reason that one is: the failure is an effect
 * that does not re-run, which no test of a pure function can see.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const controls = readFileSync(
  new URL("../src/packages/webRTC/src/components/controls.tsx", import.meta.url),
  "utf8",
);

/* ── The payloads survive outside the effect that sent them ─────────── */

// A listener wired once reads these. Reading the state straight out of its
// closure would pin it to whatever it was when the listener was created.
assert.match(
  controls,
  /const lastCameraStateRef = useRef</,
  "the last camera payload has to outlive the effect that sent it",
);
assert.match(
  controls,
  /const lastScreenStateRef = useRef</,
  "the last screen payload has to outlive the effect that sent it",
);

// Kept current where the emit happens, rather than in a second effect that
// could drift from it.
assert.match(
  controls,
  /lastCameraStateRef\.current = payload;[\s\S]{0,200}emit\("voice:camera:state", payload\)/,
  "the camera ref has to be set from the same payload that is emitted",
);
assert.match(
  controls,
  /lastScreenStateRef\.current = payload;[\s\S]{0,400}emit\("voice:screen:state", payload\)/,
  "the screen ref has to be set from the same payload that is emitted",
);

/* ── Both are re-sent on the reconnect ──────────────────────────────── */

assert.match(
  controls,
  /addEventListener\("server_socket_reconnected"/,
  "controls has to hear the reconnect — it is the only signal that the server's copy is gone",
);

const listener = controls.slice(
  controls.indexOf("const onReconnected = "),
  controls.indexOf('window.addEventListener("server_socket_reconnected"'),
);
assert.ok(listener.length > 0, "could not find the reconnect listener — this check needs rewriting");

// Waited for, not raced. Both handlers are permission-gated and a socket that
// has just reconnected holds no cached permissions until session:restore
// finishes, so sending on the reconnect itself is answered `forbidden` — the
// one error the client does not retry. The grant cannot be issued without
// join_voice, so it is proof the permissions are there.
assert.match(
  listener,
  /once\("voice:room:granted"/,
  "the re-assert has to wait for the room grant, or it races session:restore and is refused",
);

assert.match(
  listener,
  /emit\("voice:camera:state", lastCameraStateRef\.current\)/,
  "the camera state is not re-sent on reconnect",
);
assert.match(
  listener,
  /emit\("voice:screen:state", lastScreenStateRef\.current\)/,
  "the screen state is not re-sent on reconnect",
);

// Filtered to the server that reconnected. The event carries a host and a
// client can hold sockets to several servers at once, so an unfiltered
// listener would tell every one of them about a camera on one.
assert.match(
  listener,
  /detail\?\.host && detail\.host !== host/,
  "the reconnect listener has to be filtered to the server that reconnected",
);

console.log("Media state re-assert checks passed");
