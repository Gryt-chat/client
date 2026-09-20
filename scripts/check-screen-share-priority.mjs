/* eslint-env node */

// When camera and desktop video compete, the desktop share is the thing people
// are trying to read/watch. Keep that sender high priority and let the webcam
// give up resolution first.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const controls = readFileSync(
  join(root, "src/packages/webRTC/src/components/controls.tsx"),
  "utf8",
);

const camera = controls.slice(
  controls.indexOf("// Sync camera stream to WebRTC peer connection"),
  controls.indexOf("// Sync screen share video track to WebRTC"),
);
const screen = controls.slice(
  controls.indexOf("// Sync screen share video track to WebRTC"),
  controls.indexOf("// Attach Encoded Transform"),
);

assert.match(
  camera,
  /params\.encodings\[0\]\.priority = screenShareActive \? "low" : "medium"/,
  "camera does not yield bandwidth while screen sharing",
);
assert.match(
  camera,
  /params\.degradationPreference = "maintain-framerate"/,
  "camera no longer sacrifices resolution before frame rate",
);
assert.match(
  camera,
  /\[cameraEnabled, cameraStream, isConnected, screenShareActive,/,
  "camera priority does not update when screen sharing starts or stops",
);

assert.match(
  screen,
  /params\.encodings\[0\]\.priority = "high"/,
  "screen share is not the high-priority video sender",
);
assert.match(
  screen,
  /screenShareGamingMode\s*\? "maintain-framerate"\s*: "maintain-resolution"/,
  "desktop sharing does not preserve resolution outside gaming mode",
);

console.log("screen share priority: ok");
