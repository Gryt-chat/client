/* eslint-env node */

/**
 * The client says the camera and the screen share are still on, after a reconnect
 * that did not move either. A source check: the failure is an effect (GRYT-612).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { roleSender, senderStreamId } from "../src/packages/webRTC/src/utils/senderStreamIds.ts";

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

/* ── A Controls mounted mid-call announces the senders' own streams ─── */

// Focusing a tile mounts a new Controls. The ids live per connection, so the new one
// still names the streams the far side receives (GRYT-1319).
const pc = {};
assert.equal(senderStreamId(pc, "camera", "camera-1"), "camera-1");
// replaceTrack keeps the first stream's id, so a camera restart doesn't rename it.
assert.equal(senderStreamId(pc, "camera", "camera-2"), "camera-1");

// A second share goes out on the first one's paused sender.
assert.equal(senderStreamId(pc, "screenVideo", "share-1"), "share-1");
assert.equal(senderStreamId(pc, "screenVideo", "share-2"), "share-1");
assert.equal(senderStreamId(pc, "screenAudio", "share-2-audio"), "share-2-audio");

// Turning the camera off only pauses its sender (GRYT-1329), so it comes back under the first id.
assert.equal(senderStreamId(pc, "camera", "camera-3"), "camera-1");
assert.equal(senderStreamId(pc, "screenVideo", "share-3"), "share-1");

// A new connection has new senders. With no connection at all, the stream's own id.
assert.equal(senderStreamId({}, "screenVideo", "share-4"), "share-4");
assert.equal(senderStreamId(null, "camera", "camera-5"), "camera-5");

for (const role of ["camera", "screenVideo", "screenAudio"]) {
  assert.match(
    controls,
    new RegExp(`StreamId\\.current = senderStreamId\\([^\\n]*"${role}"`),
    `Controls doesn't take the ${role} id from senderStreamIds`,
  );
}
// A ref that fills itself on first use is empty again after a remount.
assert.doesNotMatch(controls, /if \(!webrtc\w+StreamId\.current\)/, "Controls keeps sender ids in refs of its own");

/* ── The camera's encoding settings reach a resumed sender ───────────── */

// A resumed camera gets its track from replaceTrack a task later, so a lookup by track misses it
// and the camera kept whatever priority it had before a share started (GRYT-1329).
{
  const sender = { track: "camera-track-1" };
  const connection = { getSenders: () => [sender] };
  assert.equal(roleSender(connection, "camera", "camera-track-1"), sender);
  sender.track = null;
  assert.equal(roleSender(connection, "camera", "camera-track-2"), sender, "a resumed camera's sender wasn't found");
  assert.equal(roleSender({ getSenders: () => [] }, "camera", "camera-track-2"), null, "another connection got this one's sender");
}
assert.match(controls, /const cameraSender = roleSender\(pc, "camera", videoTrack\)/, "Controls looks the camera's sender up by its track alone");

console.log("Media state re-assert checks passed");
