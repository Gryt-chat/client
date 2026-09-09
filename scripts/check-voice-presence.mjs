/* eslint-env node */

// Runs the presence hook and the label beside it. Sivert was in a call with an open
// microphone and nothing on screen saying so, so nothing here may go dark. GRYT-1136.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = "src/packages/webRTC/src/adapters/useVoicePresence.ts";
const SIDEBAR = "src/components/sidebar.tsx";
const hook = readFileSync(join(root, HOOK), "utf8");
const sidebar = readFileSync(join(root, SIDEBAR), "utf8");

const STATES = {
  DISCONNECTED: "disconnected",
  REQUESTING_ACCESS: "requesting_access",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  RECONNECTING: "reconnecting",
  FAILED: "failed",
};

/** A function declaration's body, from its brace to the one that closes it. */
function bodyOf(text, signature, where) {
  const at = text.indexOf(signature);
  assert.notEqual(at, -1, `${where} no longer has "${signature}". Move this check with it.`);
  const start = text.indexOf("{", at);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after "${signature}" in ${where}`);
}

/* The hook's own body, with the two hooks it calls handed to it. useMemo runs the
   factory, which is what it does on the render this stands in for. */
const presenceBody = bodyOf(hook, "export function useVoicePresence()", HOOK)
  .replace(/: VoicePresence/g, "");
/** The states the hook counts as being in a call, read out of its own declaration. */
function inCallSource() {
  const at = hook.indexOf("const IN_CALL");
  assert.notEqual(at, -1, `${HOOK} no longer declares IN_CALL. Move this check with it.`);
  const start = hook.indexOf("[", at);
  const end = hook.indexOf("]", start);
  assert.ok(start !== -1 && end !== -1, `IN_CALL is not a list in ${HOOK}`);
  return hook.slice(start, end + 1);
}

function presence({ state, host = "", channelId = "", isMuted = false, isServerMuted = false }) {
  return new Function(
    "SFUConnectionState",
    "useSFU",
    "useSettings",
    "useMemo",
    `const IN_CALL = new Set(${inCallSource()});
     return (() => ${presenceBody})();`,
  )(
    STATES,
    () => ({
      connectionState: state,
      currentServerConnected: host,
      currentChannelConnected: channelId,
    }),
    () => ({ isMuted, isServerMuted }),
    (factory) => factory(),
  );
}

const label = (voice) =>
  new Function("SFUConnectionState", "voice", `return (${bodyOf(sidebar, "function voiceLabel", SIDEBAR)
    .replace(/^\{/, "(() => {")
    .replace(/\}$/, "})()")})`)(STATES, voice);

// A call that is up: in a call, live, and sound is leaving the machine.
{
  const voice = presence({ state: STATES.CONNECTED, host: "a.example", channelId: "c1" });
  assert.equal(voice.inCall, true, "a connected call does not read as a call");
  assert.equal(voice.live, true);
  assert.equal(voice.transmitting, true, "a connected, unmuted call does not read as transmitting");
  assert.equal(voice.host, "a.example");
  assert.equal(voice.channelId, "c1");
  assert.equal(label(voice), "Connected to voice");
}

/* The reported bug's shape. The engine used to sit at CONNECTING with live audio,
   and everything on screen was gated on CONNECTED, so all of it went dark. */
for (const state of [STATES.CONNECTING, STATES.RECONNECTING, STATES.REQUESTING_ACCESS]) {
  const voice = presence({ state, host: "a.example" });
  assert.equal(voice.inCall, true, `a call in ${state} shows nothing, which is how this bug hid`);
  assert.equal(voice.live, false, `a call in ${state} claims to be up`);
  assert.equal(voice.transmitting, false, `a call in ${state} claims to be transmitting`);
  assert.notEqual(label(voice), "Connected to voice", `a call in ${state} says it is connected`);
}

assert.equal(label(presence({ state: STATES.RECONNECTING })), "Reconnecting to voice");
assert.equal(label(presence({ state: STATES.CONNECTING })), "Joining voice");

// Muted is a call you are in and not heard on. Saying only "connected" hides that.
for (const muted of [{ isMuted: true }, { isServerMuted: true }]) {
  const voice = presence({ state: STATES.CONNECTED, host: "a.example", ...muted });
  assert.equal(voice.inCall, true);
  assert.equal(voice.transmitting, false, "a muted call reads as transmitting");
  assert.equal(label(voice), "In voice, muted", "a muted call reads the same as an open microphone");
}

// No call. Nothing may claim otherwise.
for (const state of [STATES.DISCONNECTED, STATES.FAILED]) {
  const voice = presence({ state });
  assert.equal(voice.inCall, false, `${state} reads as being in a call`);
  assert.equal(voice.transmitting, false, `${state} reads as transmitting`);
}

/* Every voice mark on a server reads presence rather than a single boolean, which
   is what made one wrong value take all of them down together. */
{
  const gates = sidebar.match(/voice\.inCall && voice\.host === host/g) ?? [];
  assert.equal(gates.length, 2, "the mic pill and the voice line no longer share one gate");
  assert.equal(
    sidebar.includes("isConnected && currentServerConnected"),
    false,
    "a voice mark still hangs on isConnected",
  );
}

console.log("voice presence: ok, a call that is coming up still shows, and muted says so");
