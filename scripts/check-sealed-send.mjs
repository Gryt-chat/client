/* eslint-env node */

/**
 * Every path that sends a message goes through the seal. `performRetry` did not,
 * so a retried message went out in the clear and looked identical (GRYT-765).
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

  // `payload.text` only inside the `else` of a seal that answered null. One
  // carrying only text, in a sealed conversation, is the leak.
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
