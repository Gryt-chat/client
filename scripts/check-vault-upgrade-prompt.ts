/* eslint-env node */

/**
 * The one-time prompt to save the 24 words and take the password-locked copy off the
 * account (GRYT-1871): who is asked, that "not now" sticks, and what "remove" writes.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* Node has no localStorage. A Map behind the same calls, installed before anything reads it. */
const storage = new Map<string, string>();
let storageBroken = false;
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => {
      if (storageBroken) throw new DOMException("denied", "SecurityError");
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem: (key: string, value: string) => {
      if (storageBroken) throw new DOMException("denied", "SecurityError");
      storage.set(key, String(value));
    },
  },
});

const { dismissRemovalPrompt, removalPromptDismissed, shouldPromptRemoval } = await import(
  "../src/components/vaultUpgradeState.ts"
);

const VAULT = {};

// ── who is asked ────────────────────────────────────────────────────────────
assert.equal(shouldPromptRemoval({ grytUserId: "kari", keyIsHere: true, vault: VAULT }), true);
assert.equal(shouldPromptRemoval({ grytUserId: null, keyIsHere: true, vault: VAULT }), false, "a guest has no copy");
assert.equal(
  shouldPromptRemoval({ grytUserId: "kari", keyIsHere: false, vault: VAULT }),
  false,
  "a device without the key can't show the words, so it isn't asked to remove the copy",
);
assert.equal(shouldPromptRemoval({ grytUserId: "kari", keyIsHere: true, vault: null }), false, "nothing to remove");
assert.equal(shouldPromptRemoval({ grytUserId: "kari", keyIsHere: true, vault: undefined }), false, "still loading");

// ── "not now" sticks, per account ───────────────────────────────────────────
dismissRemovalPrompt("kari");
assert.equal(removalPromptDismissed("kari"), true);
assert.equal(shouldPromptRemoval({ grytUserId: "kari", keyIsHere: true, vault: VAULT }), false);
assert.equal(shouldPromptRemoval({ grytUserId: "ola", keyIsHere: true, vault: VAULT }), true, "another account is still asked");

// ── storage that throws asks again rather than breaking ─────────────────────
storageBroken = true;
assert.equal(removalPromptDismissed("kari"), false);
assert.doesNotThrow(() => dismissRemovalPrompt("kari"));
storageBroken = false;

// ── the component writes null to remove, and only for a signed-in account ───
{
  const prompt = readFileSync(new URL("../src/components/vaultUpgradePrompt.tsx", import.meta.url), "utf8");
  assert.match(prompt, /await writeSealedVault\(null\);/);
  assert.match(prompt, /if \(!isSignedIn\) return;/, "a guest never reads an account");
  assert.match(prompt, /dismissRemovalPrompt\(grytUserId\)/);
  assert.match(prompt, /<AccountWordsReveal keyIsHere/, "the words are offered before the copy goes");
}

console.log("check-vault-upgrade-prompt: asked only with the key and a copy, not now sticks, remove writes null");
