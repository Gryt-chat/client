/* eslint-env node */

// A conversation that can be sealed is never sent in the clear. GRYT-729 said
// so and the code did the opposite; Carlo's DMs arrived readable. GRYT-1066.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const send = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src/packages/socket/src/hooks/useChatSend.ts"),
  "utf8",
);

// Both paths emit, so both have to refuse.
const emits = [...send.matchAll(/\.then\(\(sealed\) => \{[\s\S]*?\n {6}\}\)/g)].map((m) => m[0]);

assert.equal(emits.length, 2, `expected the two send paths, found ${emits.length}`);

for (const [i, body] of emits.entries()) {
  assert.match(
    body,
    /else if \(sealDecisionRef\.current\?\.kind === "seal"\)/,
    `send path ${i + 1} falls back to plaintext without checking the decision`,
  );
  assert.match(
    body,
    /markLatestPendingFailed(Ref\.current)?\(\);\s*\n\s*return;/,
    `send path ${i + 1} does not stop when a sealable conversation failed to seal`,
  );
}

// The plaintext branch has to stay for channels, which are never sealable.
for (const [i, body] of emits.entries()) {
  assert.match(
    body,
    /else payload\.text =/,
    `send path ${i + 1} no longer sends a channel message at all`,
  );
}

console.log("sealed fallback: ok, both send paths refuse to downgrade");
