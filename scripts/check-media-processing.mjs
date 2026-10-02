import assert from "node:assert/strict";
import { waitForMedia } from "../src/packages/socket/src/utils/waitForMedia.ts";

const savedFetch = globalThis.fetch;
const savedTimeout = globalThis.setTimeout;
try {
  globalThis.setTimeout = (callback) => { queueMicrotask(callback); return 0; };
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.method, "HEAD");
    assert.equal(options.cache, "no-store");
    calls++;
    return new Response(null, { status: calls === 1 ? 503 : 200 });
  };
  await waitForMedia("https://local.test/file");
  assert.equal(calls, 2);
  globalThis.fetch = async () => new Response(null, { status: 422 });
  await assert.rejects(waitForMedia("https://local.test/file"), /rejected/);
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(waitForMedia("https://local.test/file", 0), /still waiting/);
  await assert.rejects(waitForMedia(""), /Cannot check/);
} finally {
  globalThis.fetch = savedFetch;
  globalThis.setTimeout = savedTimeout;
}
console.log("media processing: pending retries; failures and timeout reject");
