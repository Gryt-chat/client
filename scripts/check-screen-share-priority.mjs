/* eslint-env node */

// When camera and desktop video compete, keep desktop high priority and let
// the webcam give up resolution first. The engine writes them; controls.tsx hands it these.

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
  /priority: screenShareActive \? "low" : "medium"/,
  "camera does not yield bandwidth while screen sharing",
);
assert.match(
  camera,
  /degradationPreference: "maintain-framerate"/,
  "camera no longer sacrifices resolution before frame rate",
);
assert.match(
  camera,
  /\[cameraEnabled, cameraStream, isConnected, screenShareActive,/,
  "camera priority does not update when screen sharing starts or stops",
);

assert.match(
  screen,
  /priority: "high"/,
  "screen share is not the high-priority video sender",
);
assert.match(
  screen,
  /degradationPreference: screenShareGamingMode\s*\? "maintain-framerate"\s*: "maintain-resolution"/,
  "desktop sharing does not preserve resolution outside gaming mode",
);

console.log("screen share priority: ok");
