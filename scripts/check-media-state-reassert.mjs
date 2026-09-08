/* eslint-env node */

/**
 * The client says the camera and the screen share are still on, after a reconnect
 * that did not move either. A source check: the failure is an effect (GRYT-612).
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

// Waited for, not raced: a just-reconnected socket holds no cached permissions
// until session:restore finishes, so sending early is answered `forbidden`.
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

// Filtered to the server that reconnected. A client can hold sockets to several,
// so an unfiltered listener would tell every one about a camera on one.
assert.match(
  listener,
  /detail\?\.host && detail\.host !== host/,
  "the reconnect listener has to be filtered to the server that reconnected",
);

console.log("Media state re-assert checks passed");
