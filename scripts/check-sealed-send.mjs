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

/* ── the message is sealed once, when it is sent ─────────────────────────── */

{
  const body = callback("sendChat");
  assert.match(body, /sealed = await seal\(finalText/, "sendChat no longer seals the message it sends");
  assert.match(
    body,
    /retryQueueRef\.current\.set\(pendingId, \{[\s\S]*?\bsealed,[\s\S]*?\}\);/,
    "the envelope is not kept on the queued send, so an attempt after it would seal again or not at all",
  );
}

/* ── and every attempt sends that envelope ───────────────────────────────── */

{
  const body = callback("emitSend");
  assert.doesNotMatch(body, /seal\(/, "emitSend seals again; after a reconnect that sent DMs in the clear (GRYT-1453)");
  // `payload.text` only in the `else` of an entry with no envelope. Anything else is the leak.
  assert.match(body, /if \(entry\.sealed\) payload\.sealed = entry\.sealed;\s*\n\s*else payload\.text = entry\.text;/);
  assert.doesNotMatch(body.slice(0, body.indexOf("if (entry.sealed)")), /text: [a-zA-Z.]+,/);

  assert.doesNotMatch(callback("performRetry"), /emit\(/, "performRetry emits on its own instead of through the queue");
}

/* ── and nothing emits anywhere else ─────────────────────────────────────── */

{
  const emits = source.split('emit("chat:send"').length - 1;
  assert.equal(emits, 1, `there are ${emits} chat:send emits; each one has to send the sealed envelope, so check the new one`);
}

console.log("sealed send: sealed once when sent, and every attempt sends that envelope");
