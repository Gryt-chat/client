// Which preset the settings page shows for a set of switches (voice#53).

import assert from "node:assert/strict";

import { PRESET_SWITCHES, presetOf } from "../src/packages/settings/src/hooks/voicePreset.ts";

const off = { eSportsModeEnabled: false, noiseGate: 0, micVolume: 100, inputMode: "voice_activity" as const };

assert.equal(presetOf({ ...PRESET_SWITCHES.quality, ...off }), "quality", "the defaults didn't read as Best quality");
assert.equal(presetOf({ ...PRESET_SWITCHES.low_latency, ...off }), "low_latency");
assert.equal(presetOf({ ...PRESET_SWITCHES.quality, ...off, eSportsModeEnabled: true }), "esports", "eSports mode lost to the switches");
assert.equal(presetOf({ ...PRESET_SWITCHES.quality, autoGainEnabled: true, ...off }), "custom", "auto gain on still read as a preset");
assert.equal(presetOf({ rnnoiseEnabled: true, autoGainEnabled: false, compressorEnabled: false, ...off }), "custom");

// Low latency is the direct path, so the gate and the volume are part of it; quality doesn't care about either.
assert.equal(presetOf({ ...PRESET_SWITCHES.low_latency, ...off, micVolume: 50 }), "custom", "low latency at half volume isn't the direct path");
assert.equal(presetOf({ ...PRESET_SWITCHES.low_latency, ...off, noiseGate: 5 }), "custom", "a gate in voice activity isn't the direct path");
assert.equal(presetOf({ ...PRESET_SWITCHES.low_latency, ...off, noiseGate: 5, inputMode: "push_to_talk" }), "low_latency", "push to talk has no gate, whatever the slider says");
assert.equal(presetOf({ ...PRESET_SWITCHES.quality, ...off, noiseGate: 5, micVolume: 50 }), "quality");

console.log("voice preset: the defaults are Best quality, all off is Low latency, eSports wins, anything else is Custom");
