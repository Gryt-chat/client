/* eslint-env node */

/**
 * The screen-share audio copy in src/lib/screenShareAudio.ts.
 *
 * The picker tells people what "include audio" is about to capture, and the
 * answer differs by platform and by whether a window or a whole screen is
 * selected. Getting it wrong is worse than saying nothing: the whole point is
 * that somebody sitting in another app's voice chat can tell, before they
 * share, whether that app's audio is going out with it.
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
