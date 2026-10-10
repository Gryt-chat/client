/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] || fileURLToPath(new URL("../", import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const code = stripTypeScriptTypes(read("src/packages/lib/receiveAudio.ts"));
const { receiveAudioRoles, applyReceiveAudioRoles, setReceiveAudioGain } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const roles = receiveAudioRoles([{ streamID: "mic", screenShareAudioStreamID: "screen" }, { streamID: "screen" }]);
assert.equal(roles.get("mic"), "microphone");
assert.equal(roles.get("screen"), "screen");
assert.equal(roles.get("unknown"), undefined);
assert.equal(receiveAudioRoles([]).size, 0);
const roleCalls = [];
const makeSource = label => ({ receiveCleanup: { setRole: role => roleCalls.push([label, role]) } });
const sources = { mic: makeSource("first mic"), screen: makeSource("screen"), late: makeSource("late") };
const members = [{ streamID: "mic", screenShareAudioStreamID: "screen" }];
applyReceiveAudioRoles(sources, members);
assert.deepEqual(roleCalls.splice(0), [["first mic", "microphone"], ["screen", "screen"], ["late", "unknown"]]);
sources.mic = makeSource("rebuilt mic");
applyReceiveAudioRoles(sources, [...members, { streamID: "late" }]);
assert.deepEqual(roleCalls.splice(0), [["rebuilt mic", "microphone"], ["screen", "screen"], ["late", "microphone"]]);
applyReceiveAudioRoles(sources, []);
assert.deepEqual(roleCalls.splice(0), [["rebuilt mic", "unknown"], ["screen", "unknown"], ["late", "unknown"]]);
const calls = [];
const source = { receiveCleanup: { setMuted: value => calls.push(["muted", value]) },
  gain: { gain: { setValueAtTime: (...args) => calls.push(["gain", ...args]) } } };
for (const [value, time] of [[0, 42], [1.5, 43], [NaN, 44], [-1, 45], [Infinity, 46]]) setReceiveAudioGain(source, value, time);
assert.deepEqual(calls, [["muted", true], ["gain", 0, 42], ["muted", false], ["gain", 1.5, 43],
  ["muted", true], ["gain", 0, 44], ["muted", true], ["gain", 0, 45], ["muted", true], ["gain", 0, 46]]);
setReceiveAudioGain(undefined, 1, 0);
const legacyCalls = [];
setReceiveAudioGain({ gain: { gain: { setValueAtTime: (...args) => legacyCalls.push(args) } } }, 2, 5);
assert.deepEqual(legacyCalls, [[2, 5]]);
const settings = read("src/packages/settings/src/hooks/useAudioSettings.ts");
assert.match(settings, /receiveLevelingEnabled: false/);
assert.match(settings, /setUserValue\("receiveLevelingEnabled", enabled\)/);
assert.match(read("src/packages/webRTC/src/adapters/voiceConfig.ts"), /receiveLevelingEnabled: s.receiveLevelingEnabled/);
const adapter = read("src/packages/webRTC/src/adapters/useReceiveAudioRoles.ts");
assert.match(adapter, /applyReceiveAudioRoles\(streamSources, members\)/);
assert.match(adapter, /\[clients, currentServerConnected, streamSources\]/);
for (const file of ["hooks/useServerState.ts", "components/VoiceView.tsx", "components/FocusedVideoView.tsx", "hooks/usePopoutStreams.ts"]) {
  const source = read(`src/packages/socket/src/${file}`);
  assert.ok(source.includes("setReceiveAudioGain("), file);
  assert.ok(!source.includes(".gain.gain.setValueAtTime("), file);
}
console.log("Receive leveling: explicit roles, mute-before-gain, finite manual gain, safe default and config wiring passed.");
