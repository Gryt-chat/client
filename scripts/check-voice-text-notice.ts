// A voice channel's text chat said it was unavailable three times at once: two notice
// blocks on the same condition, plus the editor placeholder. One notice now.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const chatView = read("src/packages/socket/src/components/ChatView.tsx");
const chatSend = read("src/packages/socket/src/hooks/useChatSend.ts");

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

console.log("voice text notice");

check("one notice in the body, not two", () => {
  const rendered = [...chatView.matchAll(/\{showVoiceDisabled && \(/g)].length;
  assert.equal(rendered, 1, `${rendered} blocks render on showVoiceDisabled`);
  /* The second block spelled the same condition out instead of using the variable, which
     is why two identical notices drew without it being obvious. */
  const spelledOut = [...chatView.matchAll(/\{isVoiceChannelTextChat && !canViewVoiceChannelText && \(/g)].length;
  assert.equal(spelledOut, 0, "a notice block spells out showVoiceDisabled again");
});

check("the notice says why, and does not blame a setting it cannot check", () => {
  const block = chatView.slice(chatView.indexOf("{showVoiceDisabled && ("));
  const text = block.slice(0, block.indexOf("</div>"));
  assert.match(text, /join the call/i, "the notice no longer mentions joining the call");
  assert.match(text, /switched off/i, "the notice no longer mentions the channel setting");
});

check("the editor placeholder stays short", () => {
  const placeholder = chatView.match(/if \(s\.voiceTextHidden\) return "([^"]+)"/)?.[1];
  assert.ok(placeholder, "the voiceTextHidden placeholder is gone");
  assert.ok(placeholder.length <= 40, `the placeholder is ${placeholder.length} characters: "${placeholder}"`);
});

check("sending still tells the two reasons apart", () => {
  /* The send path knows which it is, unlike the body notice, so it says the exact one. */
  const off = chatSend.match(/!textInVoiceEnabledRef\.current\) \{\s*toast\.error\("([^"]+)"\)/)?.[1];
  const away = chatSend.match(/!isConnectedRef\.current\) \{\s*toast\.error\("([^"]+)"\)/)?.[1];
  assert.ok(off, "the switched-off branch no longer says anything");
  assert.ok(away, "the not-connected branch no longer says anything");
  assert.notEqual(off, away, "both reasons give the same message");
});

check("none of the old wording is left anywhere", () => {
  for (const gone of [
    "Text chat is not available in this voice channel",
    "Text chat is disabled in this voice channel",
    "You must be connected to this voice channel to send messages",
  ]) {
    assert.ok(!chatView.includes(gone) && !chatSend.includes(gone), `still says: ${gone}`);
  }
});

console.log(failures === 0 ? "\nvoice text notice: ok" : `\nvoice text notice: ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
