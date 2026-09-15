/* eslint-env node */

// A group's picture went through the avatar upload, which also made it the uploader's
// own avatar. It has its own route now, and an older server without it gets no picture. GRYT-1182.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const HELPER = "src/packages/socket/src/utils/uploadGroupPicture.ts";
const DIALOG = "src/packages/socket/src/components/GroupDialog.tsx";

const helperSource = stripTypeScriptTypes(read(HELPER)).replace(/^export /gm, "");
const load = (fetch) =>
  new Function("fetch", `${helperSource}\nreturn { uploadGroupPicture, GROUP_PICTURE_NEEDS_UPDATE };`)(fetch);

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

/* ── a current server ───────────────────────────────────────────────────── */
{
  const server = fakeServer(() => ({ status: 201, body: { fileId: "f-1", processing: false } }));
  const { uploadGroupPicture } = load(server.fetch);

  assert.equal(await uploadGroupPicture("http://h", "tok", picture, "g.png"), "f-1");
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].url, "http://h/api/uploads/group-icon");
  assert.equal(server.calls[0].init.headers.Authorization, "Bearer tok");
  assert.ok(server.calls[0].init.body.get("file"), "the picture was not in the form");
}

/* ── a refusal carries the server's message ─────────────────────────────── */
{
  const server = fakeServer(() => ({ status: 413, body: { error: "file_too_large", message: "Group picture too large. Max 5.0MB." } }));
  const { uploadGroupPicture } = load(server.fetch);
  await assert.rejects(uploadGroupPicture("http://h", "tok", picture, "g.png"), /Group picture too large/);
}

/* ── an older server: no route, and no second try at the avatar one ─────── */
{
  const server = fakeServer((url) =>
    url.endsWith("/api/uploads/avatar")
      ? { status: 201, body: { avatarFileId: "would-be-your-avatar" } }
      : { status: 404, body: "<pre>Cannot POST /api/uploads/group-icon</pre>" },
  );
  const { uploadGroupPicture, GROUP_PICTURE_NEEDS_UPDATE } = load(server.fetch);

  await assert.rejects(uploadGroupPicture("http://h", "tok", picture, "g.png"), (e) => e.message === GROUP_PICTURE_NEEDS_UPDATE);
  assert.deepEqual(server.calls.map((c) => c.url), ["http://h/api/uploads/group-icon"], "it fell back to the avatar route");
}

/* ── the dialog uses it ─────────────────────────────────────────────────── */
{
  const dialog = read(DIALOG);
  assert.match(dialog, /await uploadGroupPicture\(/, "GroupDialog no longer uploads through uploadGroupPicture");
  assert.doesNotMatch(dialog, /\/api\/uploads\/avatar/, "GroupDialog talks to the avatar route again");
}

console.log("group picture upload: ok");
