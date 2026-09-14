/* eslint-env node */

// The audio stream id in voice:screen:state. Naming a stream whose capture has died
// leaves viewers waiting on audio that never arrives.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { screenAudioStreamId } from "../src/lib/screenShareAudio.ts";

const stream = { id: "stream-now" };

// Capture stopped mid-share: the transceiver id is still set, and must not be sent.
assert.equal(screenAudioStreamId(true, null, "stream-first"), "");
assert.equal(screenAudioStreamId(true, undefined, "stream-first"), "");
assert.equal(screenAudioStreamId(true, null, null), "");

// No share, even with a stream lying around.
assert.equal(screenAudioStreamId(false, stream, "stream-first"), "");
assert.equal(screenAudioStreamId(false, stream, null), "");

// Live audio keeps the transceiver's id after replaceTrack, else the stream's own.
assert.equal(screenAudioStreamId(true, stream, "stream-first"), "stream-first");
assert.equal(screenAudioStreamId(true, stream, null), "stream-now");
assert.equal(screenAudioStreamId(true, stream, ""), "stream-now");

// The emit uses it with the live stream, and re-runs when that stream changes.
const controls = readFileSync(new URL("../src/packages/webRTC/src/components/controls.tsx", import.meta.url), "utf8");
assert.match(
  controls,
  /audioStreamId: screenAudioStreamId\(screenShareActive, screenAudioStream, webrtcScreenAudioStreamId\.current\),/,
);
const emit = controls.slice(controls.indexOf("audioStreamId: screenAudioStreamId("));
const deps = emit.match(/\}, \[([^\]]*)\]\);/);
assert.ok(deps, "emit effect deps not found");
assert.ok(deps[1].split(",").map((d) => d.trim()).includes("screenAudioStream"));
assert.ok(deps[1].split(",").map((d) => d.trim()).includes("screenShareActive"));

console.log("screen audio state ok");
