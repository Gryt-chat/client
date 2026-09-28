/* eslint-env node */

// Upload URLs carried the file token in `?t=`, where history, logs and screenshots kept it and
// no identity proof could hold it back. Now each URL is signed for one file for minutes. GRYT-1549.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = (text) => `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const load = (path, stubs = {}) =>
  moduleUrl(
    ts
      .transpileModule(readFileSync(join(root, path), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      .outputText.replace(/(\bimport\s[^;]*?\bfrom\s*)"([^"]+)"/g, (_, head, spec) => `${head}"${stubs[spec] ?? import.meta.resolve(spec)}"`),
  );

/** Just enough Storage: what older builds left behind has to be found and removed. */
function fakeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    has: (k) => map.has(k),
  };
}
globalThis.localStorage = fakeStorage({ "fileToken_chat.example": "old-token-on-disk", serverSchemeOverrides: "{}" });
globalThis.sessionStorage = fakeStorage({ "fileToken_other.example": "old-token-in-session" });

const FILE_ACCESS = load("src/packages/common/src/utils/fileUrlAuth.ts");
const access = await import(FILE_ACCESS);
const { getUploadsFileUrl, freshUploadsFileUrl } = await import(load("src/packages/common/src/utils/url.ts", { "./fileUrlAuth": FILE_ACCESS }));
const tokens = await import(load("src/packages/common/src/utils/tokenStorage.ts", { "./fileUrlAuth": FILE_ACCESS }));

const HOST = "chat.example";
const FILE = "0f8a3c52-6a8e-4b8e-9d0e-2f7c1b1e4a90";
const params = (url) => Object.fromEntries(new URL(url).searchParams);
const carries = (url) => ["t", "s", "u", "k", "e"].filter((name) => new URL(url).searchParams.has(name));

// The server's own vector (server src/utils/fileUrl.test.ts). Different bytes and every picture 401s.
{
  const key = new Uint8Array(32).fill(7);
  assert.equal(access.signFileUrl(key, FILE, false, 1790000100), "inQYY_jLD5cG4YmQa-Lj6x5PoUM07mxSLe3TYDBpUjY", "the client signs different bytes from the server");
  assert.equal(access.signFileUrl(key, FILE, true, 1790000100), "PsNKwED5XP3kVQzI8Hd9VLIVDSxRGXbQ1xy3yoJYvBg", "a thumbnail is signed differently from the server");
}

// Before the socket has proved itself and handed anything over, a URL carries nothing.
{
  const url = getUploadsFileUrl(HOST, FILE, { thumb: true });
  assert.deepEqual(carries(url), [], `a URL built before the proof carries something: ${url}`);
  assert.equal(params(url).thumb, "1");
  assert.ok(!url.includes("old-token-on-disk"), "the token an older build stored went into a URL before the proof");
}

const nowMs = 1_790_000_000_000;
const key = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
const grant = { fileKey: { key, user: "user-1", until: 1_790_043_200, now: nowMs }, fileToken: "file-token-jwt" };

// A current server: signed, for minutes, and the token it also sent for older clients stays out.
{
  const heard = [];
  const stop = access.subscribeServerFileAccess((host) => heard.push(host));
  tokens.setServerFileAccess(HOST, grant);
  access.holdServerFileAccess(HOST, grant, nowMs);
  stop();
  assert.deepEqual(heard, [HOST, HOST], "nobody was told the key arrived, so a URL built without one stays broken");
  assert.ok(!localStorage.has(`fileToken_${HOST}`), "a server that signs still has its old file token on disk");

  const [[, u], [, k], [, e], [, s]] = access.fileAccessParams(HOST, FILE, false, nowMs);
  assert.equal(u, "user-1");
  assert.equal(k, "1790043200");
  const expires = Number(e);
  assert.ok(expires - nowMs / 1000 >= 300 && expires - nowMs / 1000 <= 600, `expires ${expires - nowMs / 1000}s out, not five to ten minutes`);
  assert.equal(s, access.signFileUrl(new Uint8Array(32).fill(7), FILE, false, expires));

  const url = getUploadsFileUrl(HOST, FILE);
  assert.deepEqual(carries(url).sort(), ["e", "k", "s", "u"], `a signed URL carries the wrong things: ${url}`);
  assert.ok(!url.includes("file-token-jwt"), "the file token went into a URL next to the signature");
}

// Signed for one file: another file, or the full size from a thumbnail link, gets another signature.
{
  const a = access.fileAccessParams(HOST, "file-a", false, nowMs);
  const b = access.fileAccessParams(HOST, "file-b", false, nowMs);
  const aThumb = access.fileAccessParams(HOST, "file-a", true, nowMs);
  assert.notEqual(a[3][1], b[3][1]);
  assert.notEqual(a[3][1], aThumb[3][1]);
}

// Steady inside a five-minute step, so a re-render does not reload every picture; new after it.
{
  const at = (ms) => access.fileAccessParams(HOST, FILE, false, ms)[2][1];
  const stepStart = Math.floor(nowMs / 300_000) * 300_000;
  assert.equal(at(stepStart), at(stepStart + 299_000), "the URL changed inside one step");
  assert.notEqual(at(stepStart), at(stepStart + 300_000), "the URL never moves on, so it would expire in place");
}

// The server's clock, not ours: a client an hour fast still signs what the server accepts.
{
  const fastBy = 60 * 60 * 1000;
  access.holdServerFileAccess(HOST, grant, nowMs + fastBy);
  const expires = Number(access.fileAccessParams(HOST, FILE, false, nowMs + fastBy)[2][1]);
  assert.ok(expires - nowMs / 1000 <= 600, "a fast clock signs an expiry the server refuses");
  access.holdServerFileAccess(HOST, grant, nowMs);
}

// An older server sends only the token, and it goes in `?t=` as before, until GRYT-1586.
{
  tokens.setServerFileAccess("old.example", { fileToken: "legacy" });
  assert.deepEqual(access.fileAccessParams("old.example", FILE, false, nowMs), [["t", "legacy"]]);
  assert.equal(localStorage.getItem("fileToken_old.example"), "legacy", "an older server's token is not kept for the next launch");
  tokens.setServerFileAccess("old.example", { fileKey: { key: "junk", user: "u", until: 1, now: 1 }, fileToken: "legacy-2" });
  assert.deepEqual(access.fileAccessParams("old.example", FILE, false, nowMs), [["t", "legacy-2"]], "a malformed key was taken");

  // Next launch: nothing until the proof, then the stored token, since this server sends no key.
  access.forgetAllServerFileAccess();
  assert.deepEqual(carries(getUploadsFileUrl("old.example", FILE)), []);
  tokens.restoreServerFileToken("old.example");
  assert.deepEqual(access.fileAccessParams("old.example", FILE, false, nowMs), [["t", "legacy-2"]]);
}

// A held link is signed again at the moment of use, keeping its thumbnail flag.
{
  access.holdServerFileAccess(HOST, grant);
  const stale = `http://${HOST}/api/uploads/files/${FILE}?thumb=1&u=user-1&k=1&e=1&s=${"x".repeat(43)}`;
  const fresh = freshUploadsFileUrl(stale);
  assert.equal(params(fresh).thumb, "1");
  assert.notEqual(params(fresh).s, "x".repeat(43), "a held link was used as it was, expired or not");
  assert.equal(freshUploadsFileUrl("https://elsewhere.example/a.png"), "https://elsewhere.example/a.png");
  assert.equal(freshUploadsFileUrl(`http://nobody.example/api/uploads/files/${FILE}`), `http://nobody.example/api/uploads/files/${FILE}`);
}

// Forgotten on a refusal, a kick or a removal: nothing signs for that server again.
{
  tokens.removeServerFileToken(HOST);
  assert.deepEqual(carries(getUploadsFileUrl(HOST, FILE)), [], "a forgotten server still gets signed URLs");
  tokens.clearAllServerTokens();
  assert.equal(access.hasServerFileAccess("old.example"), false, "signing out left a server's file access in memory");
  assert.ok(!localStorage.has("fileToken_old.example") && !sessionStorage.has("fileToken_other.example"), "signing out left a file token on disk");
}

process.stdout.write("signed file URLs: one file, a few minutes, and nothing before the server proves itself\n");
