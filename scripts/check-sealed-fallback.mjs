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

// The one place the seal happens has to refuse when it did not.
assert.match(
  send,
  /sealFailed = !sealed && sealDecisionRef\.current\?\.kind === "seal";/,
  "sendChat falls back to plaintext without checking the decision",
);
assert.match(
  send,
  /if \(queueRef\.current && !sealFailed\) queueRef\.current\.add\(nonce\);\s*\n\s*else markLatestPendingFailed\(pendingId\);/,
  "sendChat does not stop when a sealable conversation failed to seal",
);
// A seal that threw is a failure too, not a quiet plaintext send.
assert.match(send, /\} catch \{\s*\n\s*sealFailed = true;/);

// The plaintext branch has to stay for channels, which are never sealable.
assert.match(send, /else payload\.text = entry\.text;/, "a channel message is no longer sent at all");

console.log("sealed fallback: ok, the send refuses to downgrade");
