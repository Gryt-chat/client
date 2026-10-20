// Which preset the settings page shows for a set of switches (voice#53).

import assert from "node:assert/strict";

import { PRESET_SWITCHES, presetOf } from "../src/packages/settings/src/hooks/voicePreset.ts";

const off = { eSportsModeEnabled: false };

assert.equal(presetOf({ ...PRESET_SWITCHES.quality, ...off }), "quality", "the defaults didn't read as Best quality");
assert.equal(presetOf({ ...PRESET_SWITCHES.low_latency, ...off }), "low_latency");
assert.equal(presetOf({ ...PRESET_SWITCHES.quality, eSportsModeEnabled: true }), "esports", "eSports mode lost to the switches");
assert.equal(presetOf({ ...PRESET_SWITCHES.quality, autoGainEnabled: true, ...off }), "custom", "auto gain on still read as a preset");
assert.equal(presetOf({ rnnoiseEnabled: true, autoGainEnabled: false, compressorEnabled: false, ...off }), "custom");

console.log("voice preset: the defaults are Best quality, all off is Low latency, eSports wins, anything else is Custom");
