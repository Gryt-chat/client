/** The voice view's grip: the stops a click cycles through and where a drag lands. */

import assert from "node:assert/strict";

import {
  draggedVoiceStop,
  nextVoiceStop,
  VOICE_MIN_WIDTH,
  VOICE_PRESET_1,
  voicePresets,
  voiceStopWidth,
} from "../src/packages/socket/src/lib/voiceGrip.ts";

// The board's 1440 window: the middle runs from 288 to 1352.
const room = 1352 - 288;
const [p1, p2] = voicePresets(room) ?? assert.fail("1440 has room for both presets");
assert.equal(p1, VOICE_PRESET_1);
assert.equal(p2, 658);

// Preset 2 follows the middle: folding the member list to avatars widens it.
assert.equal(voiceStopWidth("preset2", room), p2);
assert.equal(voiceStopWidth("preset2", room + 144), Math.round((room + 144) * 0.618));
assert.equal(voiceStopWidth(p1, room + 144), p1);

/* ── A click cycles hidden → 1 → 2 → full → hidden ─────────────────── */

assert.equal(nextVoiceStop("hidden", room), p1);
assert.equal(nextVoiceStop(p1, room), "preset2");
assert.equal(nextVoiceStop("preset2", room), "full");
assert.equal(nextVoiceStop("full", room), "hidden");
// A width you dragged to goes to the next stop up.
assert.equal(nextVoiceStop(500, room), "preset2");
assert.equal(nextVoiceStop(800, room), "full");

/* ── A drag snaps within 8px of a stop, and stays put between ──────── */

assert.equal(draggedVoiceStop(p1 + 8, room), p1);
assert.equal(draggedVoiceStop(p1 - 8, room), p1);
assert.equal(draggedVoiceStop(p1 + 9, room), p1 + 9);
assert.equal(draggedVoiceStop(p2 - 5, room), "preset2");
assert.equal(draggedVoiceStop(4, room), "hidden");
assert.equal(draggedVoiceStop(VOICE_MIN_WIDTH / 2 + 1, room), VOICE_MIN_WIDTH);
assert.equal(draggedVoiceStop(room - 4, room), "full");

// Never a width that leaves the chat under 200px.
for (let x = 0; x <= room; x++) {
  const stop = draggedVoiceStop(x, room);
  if (typeof stop === "number") assert.ok(stop >= VOICE_MIN_WIDTH && stop <= room - 200, `${x} → ${stop}`);
}

/* ── Too narrow for both: hidden and full only ─────────────────────── */

const narrow = 520;
assert.equal(voicePresets(narrow), null);
assert.equal(nextVoiceStop("hidden", narrow), "full");
assert.equal(nextVoiceStop("full", narrow), "hidden");
assert.equal(draggedVoiceStop(100, narrow), "hidden");
assert.equal(draggedVoiceStop(400, narrow), "full");

// The Narrow board's 820 step: a preset needs 360px of chat beside it, or the call is full or hidden.
assert.ok(voicePresets(VOICE_PRESET_1 + 16 + 360), "a 360px chat beside preset 1 lost its presets");
assert.equal(voicePresets(VOICE_PRESET_1 + 16 + 359), null);

console.log("voice grip: ok");
