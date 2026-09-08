/* eslint-env node */

/**
 * The screen-share audio copy in src/lib/screenShareAudio.ts. Somebody in another
 * app's voice chat has to be able to tell, before sharing, what goes out.
 */

import assert from "node:assert/strict";

import { audioScopeHint } from "../src/lib/screenShareAudio.ts";

// Windows captures per process, so a window share is the narrow one.
assert.match(audioScopeHint("win32", "window:1234:0"), /this window's audio only/);

// A whole screen takes everything but Gryt, and Windows can do better, so it
// is told how.
const winScreen = audioScopeHint("win32", "screen:1:0");
assert.match(winScreen, /except Gryt/);
assert.match(winScreen, /Pick a single window/);

// macOS ignores the source it is handed, so it must not promise the narrow
// capture for a window.
const macWindow = audioScopeHint("darwin", "window:1234:0");
assert.match(macWindow, /except Gryt/);
assert.doesNotMatch(macWindow, /this window's audio only/);
assert.doesNotMatch(macWindow, /Pick a single window/);

assert.equal(audioScopeHint("darwin", "screen:1:0"), macWindow);

// No source picked yet, and the browser path, where there is no source id at
// all: still true, still not promising per-application capture.
assert.match(audioScopeHint("linux", null), /except Gryt/);
assert.doesNotMatch(audioScopeHint("", null), /Pick a single window/);

console.log("screen-share audio copy ok");
