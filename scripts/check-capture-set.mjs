/* eslint-env node */

/**
 * The capture-set planning in electron/captureSet.ts. Stop one too many and the
 * share goes silent; keep one too many and a deselected application still goes out.
 */

import assert from "node:assert/strict";

import { planCaptureChange, SYSTEM_AUDIO_SOURCE_ID } from "../electron/captureSet.ts";

const SYSTEM = SYSTEM_AUDIO_SOURCE_ID;

// A share starts on the machine-wide capture. Picking the first application
// drops it, because that application is already inside it.
assert.deepEqual(planCaptureChange([SYSTEM], ["window:1:0"]), {
  kill: [SYSTEM],
  spawn: ["window:1:0"],
  system: false,
});

// Adding a second leaves the first alone.
assert.deepEqual(planCaptureChange(["window:1:0"], ["window:1:0", "window:2:0"]), {
  kill: [],
  spawn: ["window:2:0"],
  system: false,
});

// Deselecting one stops only that one.
assert.deepEqual(planCaptureChange(["window:1:0", "window:2:0"], ["window:1:0"]), {
  kill: ["window:2:0"],
  spawn: [],
  system: false,
});

// Deselecting the last one is not silence: it is the share going back to
// everything except Gryt.
assert.deepEqual(planCaptureChange(["window:1:0"], []), {
  kill: ["window:1:0"],
  spawn: [],
  system: true,
});

// Already on the machine and asked for the machine: nothing to do, and in
// particular the running capture is not restarted.
assert.deepEqual(planCaptureChange([SYSTEM], []), {
  kill: [],
  spawn: [],
  system: true,
});

// Asking for what is already running changes nothing.
assert.deepEqual(planCaptureChange(["window:1:0"], ["window:1:0"]), {
  kill: [],
  spawn: [],
  system: false,
});

// A duplicate in the request is not a second process.
assert.deepEqual(planCaptureChange([], ["window:1:0", "window:1:0"]), {
  kill: [],
  spawn: ["window:1:0"],
  system: false,
});

// Swapping the whole set out.
assert.deepEqual(planCaptureChange(["window:1:0", "window:2:0"], ["window:3:0"]), {
  kill: ["window:1:0", "window:2:0"],
  spawn: ["window:3:0"],
  system: false,
});

console.log("capture set ok");
