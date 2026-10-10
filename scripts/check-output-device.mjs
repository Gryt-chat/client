/* eslint-env node */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const revision = process.env.OUTPUT_DEVICE_TEST_REV;
const read = (path) => revision
  ? execFileSync("git", ["show", `${revision}:${path}`], { cwd: root, encoding: "utf8" })
  : readFileSync(join(root, path), "utf8");
const quiet = { log() {}, warn() {}, error() {} };
const values = new Map([
  ["outputDeviceID", "legacy-speaker"],
  ["user:alice:outputDeviceID", JSON.stringify("alice-headset")],
  ["user:bob:outputDeviceID", JSON.stringify("bob-headset")],
]);
const storage = {
  get length() { return values.size; },
  key: (index) => [...values.keys()][index] ?? null,
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};
let effectCleanup;
const react = {
  useState: (initial) => [initial, () => {}],
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useEffect: (fn) => {
    effectCleanup?.();
    effectCleanup = fn();
  },
};
const contexts = [];
const played = [];
let decodeFails = false;
let deviceMissing = true;
const mediaDevices = new EventTarget();
mediaDevices.enumerateDevices = async () => [];

class FakeOutput {
  sinkId = "";
  calls = [];
  async setSinkId(id) {
    this.calls.push(id);
    if (id === "unplugged" && deviceMissing) throw new DOMException("Device removed", "NotFoundError");
    this.sinkId = id;
  }
}

class FakeContext extends FakeOutput {
  state = "running";
  destination = {};
  constructor() {
    super();
    contexts.push(this);
  }
  async resume() { this.state = "running"; }
  async decodeAudioData() {
    if (decodeFails) throw new Error("Undecodable sound");
    return {};
  }
  createGain() { return { gain: {}, connect() {} }; }
  createBufferSource() {
    return { connect() {}, start: () => played.push(this.sinkId) };
  }
}

class FakeAudio extends FakeOutput {
  async play() { played.push(this.sinkId); }
}

const modules = new Map();
let settings;
let voiceContext;
const load = (path, overrides = {}) => {
  if (modules.has(path)) return modules.get(path);
  const module = { exports: {} };
  const source = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    react,
    "@gryt/voice": { useSpeakers: () => ({ audioContext: voiceContext }) },
    "@/settings": { useSettings: () => settings },
    "@/lib/notificationSound": () => load("src/packages/lib/notificationSound.ts"),
    "@/lib/outputDevice": () => load("src/packages/lib/outputDevice.ts"),
    "@/lib/desktopNotification": { requestNotificationPermission: async () => "granted" },
    "../../../../lib/electron": { isElectron: () => false, getElectronAPI: () => null },
    "./deviceId": { isDeviceId: () => true, getDeviceId: () => "guest" },
    ...overrides,
  };
  runInNewContext(source, {
    exports: module.exports, module, console: quiet, localStorage: storage,
    AudioContext: FakeContext, Audio: FakeAudio, DOMException,
    navigator: { mediaDevices },
    fetch: async () => ({ arrayBuffer: async () => new ArrayBuffer(1) }),
    require: (name) => {
      if (name in dependencies) {
        const dependency = dependencies[name];
        return typeof dependency === "function" ? dependency() : dependency;
      }
      return load(join(dirname(path), `${name}.ts`).replaceAll("\\", "/"));
    },
  });
  modules.set(path, module.exports);
  return module.exports;
};
const flush = () => new Promise((done) => setImmediate(done));
const userStore = load("src/packages/settings/src/hooks/userStorage.ts");
const audioSettings = load("src/packages/settings/src/hooks/useAudioSettings.ts");
const sounds = load("src/packages/lib/notificationSound.ts");
const hookPath = "src/packages/webRTC/src/adapters/useOutputDevice.ts";
const hasHook = revision
  ? execFileSync("git", ["ls-tree", revision, "--", hookPath], { cwd: root }).length > 0
  : existsSync(join(root, hookPath));
const sync = hasHook ? load(hookPath).useOutputDevice : () => {};

// The published engine's initialization runs before the client adapter.
const engineSource = readFileSync(join(root, "node_modules/@gryt/voice/dist/audio/hooks/useSpeakers.js"), "utf8");
const engine = { exports: {} };
runInNewContext(ts.transpileModule(engineSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports: engine.exports, console: quiet, localStorage: storage,
  navigator: { mediaDevices },
  require: (name) => {
    if (name === "react") return { ...react, useEffect: (fn) => fn() };
    if (name.endsWith("config/index.js")) return { useVoiceConfig: () => ({ audio: {} }) };
    if (name.endsWith("singletonHook.js")) return { singletonHook: (_initial, body) => body };
    if (name.endsWith("useAudioContext.js")) return { useSharedAudioContext: () => ({ audioContext: voiceContext }) };
    throw new Error(`Unexpected voice dependency: ${name}`);
  },
});
async function selectUser(id) {
  userStore.clearUserCache();
  await userStore.loadForUser(id);
  settings = audioSettings.loadAudioFromCache();
  sync();
  await flush();
}

await selectUser("alice");
assert.equal(contexts.length, 0, "loading settings must not create a notification context");
voiceContext = new FakeContext();
engine.exports.useSpeakers();
sync();
await flush();
assert.equal(voiceContext.sinkId, "alice-headset", "voice restart must use the current user's headset, not the legacy global speaker");
console.log("ok - cold voice context restores the loaded user's output");

sounds.playNotificationSound("connect", 30);
await flush();
sounds.warmNotificationContext();
await flush();
assert.equal(played.at(-1), "alice-headset");
assert.equal(contexts.at(-1).sinkId, "alice-headset", "warming cannot restore a stale global choice");
console.log("ok - first notification and warm use the loaded user's output");

await selectUser("bob");
assert.equal(voiceContext.sinkId, "bob-headset");
sounds.playNotificationSound("connect", 30);
await flush();
assert.equal(played.at(-1), "bob-headset");
console.log("ok - switching users reroutes both existing contexts");

audioSettings.useAudioSettings().setOutputDeviceID("");
assert.equal(values.get("user:bob:outputDeviceID"), JSON.stringify(""));
await selectUser("bob");
assert.equal(voiceContext.sinkId, "");
sounds.playNotificationSound("connect", 30);
await flush();
assert.equal(played.at(-1), "");
assert.equal(values.get("outputDeviceID"), "legacy-speaker");
console.log("ok - choosing default survives a reload without changing legacy storage");

audioSettings.useAudioSettings().setOutputDeviceID("unplugged");
await selectUser("bob");
assert.equal(voiceContext.sinkId, "");
assert.equal(userStore.getUserValue("outputDeviceID", ""), "unplugged");
assert.equal(contexts.at(-1).sinkId, "");
console.log("ok - a missing device falls back without overwriting the saved choice");

deviceMissing = false;
mediaDevices.dispatchEvent(new Event("devicechange"));
await flush();
assert.equal(voiceContext.sinkId, "unplugged");
assert.equal(contexts.at(-1).sinkId, "unplugged");
console.log("ok - reconnecting the saved device retries both output routes");

await selectUser("alice");
voiceContext = new FakeContext();
engine.exports.useSpeakers();
sync();
await flush();
assert.equal(voiceContext.sinkId, "alice-headset");
console.log("ok - replacement voice contexts receive the current setting");

decodeFails = true;
sounds.playNotificationSound("broken", 30);
await flush();
assert.equal(played.at(-1), "alice-headset");
console.log("ok - HTML Audio fallback follows the selected output");

const { routeOutputDevice } = load("src/packages/lib/outputDevice.ts");
const delayed = new FakeOutput();
let release;
delayed.setSinkId = async (id) => {
  delayed.calls.push(id);
  if (id === "slow") await new Promise((done) => { release = done; });
  delayed.sinkId = id;
};
const first = routeOutputDevice(delayed, "slow");
await flush();
const second = routeOutputDevice(delayed, "skipped");
const last = routeOutputDevice(delayed, "latest");
release();
await first;
assert.equal(delayed.sinkId, "latest", "a playback waiting on an older request must also wait for the new choice");
await Promise.all([second, last]);
assert.deepEqual(delayed.calls, ["slow", "latest"]);
assert.equal(delayed.sinkId, "latest");
console.log("ok - delayed selections are serialized and obsolete queued choices skipped");

await routeOutputDevice({}, "unsupported");
await routeOutputDevice({ setSinkId: async () => { throw new Error("Denied"); } }, "denied");
console.log("ok - unsupported sinks and default-route failures settle without rejection");

const provider = read("src/packages/webRTC/src/adapters/VoiceProvider.tsx");
assert.match(provider, /useOutputDevice\(\)/);
assert.ok(existsSync(join(root, hookPath)));
console.log("output device: all headless checks passed; no real media devices or profiles used");
