/* eslint-env node */

/**
 * The macOS screen-share audio fault rules in electron/captureHealth.ts and the copy
 * they lead to. Miss one and the share goes out silent with nobody told.
 */

import assert from "node:assert/strict";

import { NO_AUDIO_TIMEOUT_MS, problemFromExit, problemFromSilence } from "../electron/captureHealth.ts";
import { screenAudioProblemMessage } from "../src/lib/screenShareAudio.ts";

const refused =
  "Error: The user declined TCCs for application, window, display capture [com.apple.ScreenCaptureKit.SCStreamErrorDomain -3801]\n";

const exit = (over) => ({ platform: "darwin", code: 1, chunks: 0, stderr: "", unexpected: true, ...over });

// A refused permission is named, whatever the exit code.
assert.equal(problemFromExit(exit({ stderr: refused })), "permission");
assert.equal(problemFromExit(exit({ stderr: refused, code: 0 })), "permission");

// Any other early death, a crash by signal included, is a plain failure.
assert.equal(problemFromExit(exit({ stderr: "Error: No display found\n" })), "failed");
assert.equal(problemFromExit(exit({ code: null })), "failed");

// Gryt stopping it, a clean exit, or a capture that already sent audio are not faults.
assert.equal(problemFromExit(exit({ unexpected: false })), null);
assert.equal(problemFromExit(exit({ unexpected: false, stderr: refused })), null);
assert.equal(problemFromExit(exit({ code: 0 })), null);
assert.equal(problemFromExit(exit({ chunks: 3 })), null);

// Windows and Linux keep their behaviour.
assert.equal(problemFromExit(exit({ platform: "win32", stderr: refused })), null);
assert.equal(problemFromExit(exit({ platform: "linux" })), null);

// No chunks by the deadline on macOS is the silent share this exists to catch.
assert.equal(problemFromSilence("darwin", 0, NO_AUDIO_TIMEOUT_MS), "no-audio");
assert.equal(problemFromSilence("darwin", 0, NO_AUDIO_TIMEOUT_MS + 1000), "no-audio");
assert.equal(problemFromSilence("darwin", 0, NO_AUDIO_TIMEOUT_MS - 1), null);
assert.equal(problemFromSilence("darwin", 1, NO_AUDIO_TIMEOUT_MS), null);

// WASAPI process loopback sends nothing while the app is quiet, so Windows is never judged.
assert.equal(problemFromSilence("win32", 0, NO_AUDIO_TIMEOUT_MS * 10), null);

// Long enough for ScreenCaptureKit to start, short enough to catch it while sharing.
assert.ok(NO_AUDIO_TIMEOUT_MS >= 2000 && NO_AUDIO_TIMEOUT_MS <= 10000);

// Every problem has copy, the permission one says where to fix it, and unknown ones stay quiet.
for (const problem of ["permission", "failed", "no-audio"]) {
  assert.match(screenAudioProblemMessage(problem), /no sound/);
}
assert.match(screenAudioProblemMessage("permission"), /Privacy & Security/);
assert.match(screenAudioProblemMessage("permission"), /Screen & System Audio Recording/);
assert.equal(screenAudioProblemMessage("something-new"), null);

console.log("capture health ok");
