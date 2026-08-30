/* eslint-env node */

/**
 * Every path that sends a message goes through the seal (GRYT-765).
 *
 * `sendMessageWithToken` has sealed since GRYT-729. `performRetry` did not: it
 * put `text` straight on the payload and emitted, so a message the composer
 * said was encrypted went to the server in the clear the moment it was retried.
 *
 * Nothing looked different. The row was already on screen, the retry succeeded,
 * and the sender was looking at the words they typed either way — which is the
 * same reason the rest of this feature is checked the way it is. Being
 * rate-limited while sending a direct message was enough to reach it:
 * `chatEventHandlers` calls `onRetry` when the countdown ends, and again on a
 * 3s timer for any retryable `chat:error`.
 *
 * A source check, because `useChatSend.ts` imports React, socket.io, a toast
 * library and `@/common` through a Vite alias, so none of it loads in Node.
 * That is also why the bug lasted: nothing in this file has ever had a test.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/packages/socket/src/hooks/useChatSend.ts", import.meta.url),
  "utf8",
);

/** The body of one `const <name> = useCallback(` up to its closing line. */
function callback(name) {
  const start = source.indexOf(`const ${name} = useCallback(`);
  assert.notEqual(start, -1, `${name} is gone — check this file still describes it`);

  const end = source.indexOf("\n  }, [", start);
  assert.notEqual(end, -1, `could not find the end of ${name}`);
  return source.slice(start, end);
}

/* ── both senders seal ───────────────────────────────────────────────────── */

for (const name of ["sendMessageWithToken", "performRetry"]) {
  const body = callback(name);

  assert.match(
    body,
    /seal\(/,
    `${name} emits without sealing. That is the bug: a conversation the composer says is encrypted sends plaintext, and nothing on screen says so.`,
  );

  // `payload.text` only inside the `else` of a seal that answered null, never
  // unconditionally. A payload carrying both is refused by the server anyway;
  // one carrying only text, in a sealed conversation, is the leak.
  const emits = body.slice(body.indexOf("seal("));
  assert.match(
    emits,
    /else payload\.text =/,
    `${name} sets payload.text outside the "not sealing this conversation" branch`,
  );
  assert.doesNotMatch(
    body.slice(0, body.indexOf("seal(")),
    /text: [a-zA-Z.]+,/,
    `${name} puts text on the payload before it knows whether this conversation seals`,
  );
}

/* ── and neither emits anywhere else ─────────────────────────────────────── */

{
  // An `emit("chat:send")` outside a `.then` on `seal` is a path that skipped
  // it. Counting them is crude and it is exactly the shape the bug had.
  const emits = source.split('emit("chat:send"').length - 1;
  assert.equal(
    emits,
    2,
    `there are ${emits} chat:send emits; each one has to seal, so check the new one`,
  );
}

console.log(
  "sealed send: the first attempt and the retry both go through the seal, and neither writes text unless it answered null",
);
