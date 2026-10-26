/**
 * The screen-share audio copy in src/lib/screenShareAudio.ts. Somebody in another
 * app's voice chat has to be able to tell, before sharing, what goes out.
 */

import assert from "node:assert/strict";

import { shareSoundHint } from "../src/lib/screenShareAudio.ts";

// Windows captures per process, so only a window share can promise the narrow capture.
assert.match(shareSoundHint("win32", false), /only ever comes from the windows you pick/);

// A whole screen on Windows, and macOS and Linux for anything, take every sound but Gryt's.
for (const hint of [shareSoundHint("win32", true), shareSoundHint("darwin", false), shareSoundHint("linux", false)]) {
  assert.match(hint, /except Gryt/);
  assert.doesNotMatch(hint, /only ever comes from the windows/);
}

console.log("screen-share audio copy ok");
