/* eslint-env node */

// A webhook's avatar never saved: the settings tab read `file_id` from an upload reply that
// sends `fileId`, then said "Avatar updated" anyway. GRYT-1183.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const HELPER = "src/packages/socket/src/utils/uploadWebhookAvatar.ts";
const TAB = "src/packages/socket/src/components/ServerWebhooksTab.tsx";

const helperSource = stripTypeScriptTypes(read(HELPER)).replace(/^export /gm, "");
const load = (fetch) => new Function("fetch", `${helperSource}\nreturn { uploadWebhookAvatar };`)(fetch);

function fakeServer(answer) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const { status, body } = answer(url);
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => {
        if (typeof body === "string") throw new SyntaxError("not json");
        return body;
      },
    };
  };
  return { calls, fetch };
}

const picture = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
const headers = { Authorization: "Bearer tok" };

/* ── the reply the attachment route sends ───────────────────────────────── */
{
  const server = fakeServer(() => ({ status: 201, body: { fileId: "f-1", key: "uploads/f-1.png", thumbnailKey: null } }));
  const { uploadWebhookAvatar } = load(server.fetch);

  assert.equal(await uploadWebhookAvatar("http://h", headers, picture, "hook.png"), "f-1");
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].url, "http://h/api/uploads", "it left the attachment route, which keeps your own avatar");
  assert.equal(server.calls[0].init.headers.Authorization, "Bearer tok");
  assert.ok(server.calls[0].init.body.get("file"), "the picture was not in the form");
}

/* ── a reply with no id is a failure, not an empty save ─────────────────── */
{
  const server = fakeServer(() => ({ status: 201, body: { file_id: "f-2" } }));
  const { uploadWebhookAvatar } = load(server.fetch);
  await assert.rejects(uploadWebhookAvatar("http://h", headers, picture, "hook.png"));
}

/* ── a refusal carries the server's message ─────────────────────────────── */
{
  const server = fakeServer(() => ({ status: 413, body: { error: "file_too_large", message: "File too large." } }));
  const { uploadWebhookAvatar } = load(server.fetch);
  await assert.rejects(uploadWebhookAvatar("http://h", headers, picture, "hook.png"), /File too large/);
}

/* ── the tab uses it, and only says it saved when it did ────────────────── */
{
  const tab = read(TAB);
  assert.match(tab, /await uploadWebhookAvatar\(/, "ServerWebhooksTab no longer uploads through uploadWebhookAvatar");
  assert.doesNotMatch(tab, /\bfile_id\b/, "ServerWebhooksTab reads file_id from an upload reply again");
  assert.doesNotMatch(tab, /\/api\/uploads\/avatar/, "ServerWebhooksTab talks to the avatar route, which sets your own avatar");
  assert.match(tab, /if \(await save\(\{ avatar_file_id: fileId \}\)\) toast\.success/, "the success toast no longer waits for the save");
}

console.log("webhook avatar upload: ok");
