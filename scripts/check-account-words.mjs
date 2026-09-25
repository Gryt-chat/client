/* eslint-env node */

/**
 * "Show my 24 words" for a signed-in account: asked first, read only after yes, and only
 * where this device holds the message key. The words are that key (GRYT-1498).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { HIDDEN, nextWordsView } from "../src/packages/settings/src/components/recoveryWordsStep.ts";

const WORDS = "abandon amount liar amount expire adjust cage candy arch gather drum bullet";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function context(keyIsHere) {
  const ctx = { reads: 0, keyIsHere, readWords: async () => { ctx.reads++; return WORDS; } };
  return ctx;
}

// ── the ordinary path: ask, confirm, shown ──────────────────────────────────
{
  const ctx = context(true);
  const asking = await nextWordsView(HIDDEN, "show", ctx);
  assert.deepEqual(asking, { step: "confirming" }, "the first press asks");
  assert.equal(ctx.reads, 0, "and reads nothing yet");

  const shown = await nextWordsView(asking, "confirm", ctx);
  assert.deepEqual(shown, { step: "shown", words: WORDS });
  assert.equal(ctx.reads, 1);

  assert.deepEqual(await nextWordsView(shown, "hide", ctx), HIDDEN);
  assert.deepEqual(await nextWordsView(asking, "hide", ctx), HIDDEN, "cancel at the question");
  assert.equal(ctx.reads, 1);
}

// ── no way round the question ───────────────────────────────────────────────
{
  const ctx = context(true);
  assert.deepEqual(await nextWordsView(HIDDEN, "confirm", ctx), HIDDEN, "confirming what was never asked shows nothing");
  assert.equal(ctx.reads, 0);
}

// ── a device without the key never reads them ───────────────────────────────
{
  const ctx = context(false);
  for (const view of [HIDDEN, { step: "confirming" }, { step: "shown", words: WORDS }]) {
    for (const action of ["show", "confirm", "hide"]) {
      assert.deepEqual(await nextWordsView(view, action, ctx), HIDDEN, `${view.step} + ${action}`);
    }
  }
  assert.equal(ctx.reads, 0);
}

// ── where it is drawn ───────────────────────────────────────────────────────
{
  const reveal = read("src/packages/settings/src/components/recoveryWords.tsx");
  assert.match(reveal, /if \(!keyIsHere\) return null;/, "nothing at all without the key");
  assert.match(reveal, /nextWordsView\(view, action, \{ keyIsHere, readWords: getIdentityWords \}\)/);
  assert.match(reveal, /Anyone with these words can read your direct messages and become you/);

  const section = read("src/packages/settings/src/components/messageKeySection.tsx");
  assert.match(section, /\{keyIsHere && !open && \(/, "the account section gates it on the key");
  assert.equal((section.match(/<SaveWordsFirst /g) ?? []).length, 2, "both reset warnings link to it");

  const guest = read("src/packages/settings/src/components/localIdentitySection.tsx");
  assert.match(guest, /<RecoveryWordsPanel/, "the guest section shares the panel rather than a copy");
  assert.doesNotMatch(guest, /navigator\.clipboard/);

  const security = read("src/packages/settings/src/components/securitySettings.tsx");
  assert.match(security, /\{!isSignedIn && <LocalIdentitySection \/>\}/, "guests keep their own section");
}

console.log("check-account-words: asked first, read only after yes, never without the key");
