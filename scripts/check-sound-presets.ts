// A preset is stored as `preset:<id>` in the same setting as an uploaded file (GRYT-2010).
// An unknown id falls back to the default rather than playing nothing.

import assert from "node:assert/strict";

import { presetIdOf, presetValue, resolveSound } from "../src/packages/lib/soundPresetValue.ts";

const presets = [
  { id: "click", label: "Click", src: "/click.mp3" },
  { id: "chime", label: "Chime", src: "/chime.mp3" },
];

assert.equal(resolveSound(null, presets), "/click.mp3", "nothing chosen plays the default");
assert.equal(resolveSound(presetValue("chime"), presets), "/chime.mp3");
assert.equal(resolveSound(presetValue("gone"), presets), "/click.mp3", "a removed preset plays the default");
assert.equal(resolveSound("data:audio/mpeg;base64,AAAA", presets), "data:audio/mpeg;base64,AAAA", "an upload plays as it is");
assert.equal(presetIdOf("data:audio/mpeg;base64,AAAA"), null);
assert.equal(presetIdOf(presetValue("chime")), "chime");

console.log("sound presets: default, preset, unknown preset and upload all resolve");
