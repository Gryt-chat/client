// A camera pick did not stick: the engine reports its fallback before loadForUser has
// resolved, when cameraID is still "", and the fallback was written over the choice.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { adoptDevice } from "../src/packages/webRTC/src/adapters/deviceAdoption.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name: string, run: () => void) {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("device adoption");

check("before the settings are read, a report is held rather than written", () => {
  assert.equal(adoptDevice(false, ""), "hold", "an empty id before the load is not 'nothing chosen'");
  assert.equal(adoptDevice(false, "a-stored-camera"), "hold");
});

check("once read, a stored choice is left alone", () => {
  assert.equal(adoptDevice(true, "a-stored-camera"), "keep");
  /* The case this guard was written for: unplugging a headset makes the engine report a
     fallback, and recording it would replace what the person picked. */
  assert.equal(adoptDevice(true, "default"), "keep");
});

check("once read, nothing stored means the engine's pick is adopted", () => {
  assert.equal(adoptDevice(true, ""), "write");
  assert.equal(adoptDevice(true, null), "write");
  assert.equal(adoptDevice(true, undefined), "write");
});

/* ── The wiring, which the function alone cannot prove ──────────────────── */

const provider = readFileSync(join(root, "src/packages/webRTC/src/adapters/VoiceProvider.tsx"), "utf8");

check("both device callbacks go through adoptDevice", () => {
  for (const cb of ["onAudioDeviceChanged", "onCameraDeviceChanged"]) {
    const body = provider.slice(provider.indexOf(cb), provider.indexOf("}", provider.indexOf(cb)) + 1);
    assert.match(body, /adoptDevice\(/, `${cb} decides for itself again`);
  }
});

check("a held report is flushed when the settings arrive", () => {
  const effect = provider.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[settings\.settingsLoaded\]\);/)?.[0] ?? "";
  assert.match(effect, /held\.current = \{\}/, "the held report is never cleared, so it reapplies");
  assert.match(effect, /setMicID/);
  assert.match(effect, /setCameraID/);
});

check("the callbacks still keep one identity", () => {
  /* A new object per settings change reopens the microphone and the camera, which is why
     the memo has no dependencies and the settings are read through a ref. */
  const memo = provider.slice(provider.indexOf("return useMemo("));
  assert.match(memo, /\}\),\s*\[\],\s*\);/, "the device callbacks memo grew a dependency");
});

console.log(failures === 0 ? "\ndevice adoption: ok" : `\ndevice adoption: ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
