/* eslint-env node */

// Unknown Rich Presence app ids go to the game list's job: only the number, each id once.

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { createUnknownAppQueue } = await import(pathToFileURL(join(root, "electron/unknownApps.ts")).href);

const calls = [];
let fail = false;
const fetchImpl = async (url, init) => {
  calls.push({ url, init });
  return { ok: !fail };
};
const queue = createUnknownAppQueue({ fetchImpl, url: "https://reports.test/v1/unknown-apps", everyMs: 1e9 });
const WOW = "805124430774272000";

queue.note(WOW);
queue.note(WOW);
queue.note("not-an-id");
await queue.flush();
assert.equal(calls.length, 1);
assert.deepEqual(JSON.parse(calls[0].init.body), { ids: [WOW] }, "only the id goes, once");
assert.equal(calls[0].init.headers["x-gryt-app"], "desktop");

queue.note(WOW);
await queue.flush();
assert.equal(calls.length, 1, "an id already sent is not sent again");

fail = true;
queue.note("1008017436016410644");
await queue.flush();
fail = false;
await queue.flush();
assert.equal(calls.length, 3, "a failed send is tried again");
queue.stop();

console.log("unknown apps: ok");
