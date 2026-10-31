// Only Discord's own file addresses reach the main process's fetch, and an answer comes back whole.
import assert from "node:assert/strict";

import { fetchDiscordFile, isDiscordFileUrl } from "../electron/discordFile.ts";

const ok = "https://cdn.discordapp.com/attachments/1/2/a.pdf?ex=0&is=0&hm=x";
assert.equal(isDiscordFileUrl(ok), true);
assert.equal(isDiscordFileUrl("https://media.discordapp.net/attachments/1/2/a.png"), true);
for (const bad of [
  "http://cdn.discordapp.com/attachments/1/2/a.pdf",
  "https://cdn.discordapp.com.evil.test/attachments/1/2/a.pdf",
  "https://evil.test/https://cdn.discordapp.com/attachments/1",
  "https://user@cdn.discordapp.com/attachments/1/2/a.pdf",
  "https://cdn.discordapp.com:8443/attachments/1/2/a.pdf",
  "https://cdn.discordapp.com/avatars/1/2.png",
  "file:///etc/passwd",
  "http://127.0.0.1/attachments/",
  42,
  null,
]) assert.equal(isDiscordFileUrl(bad), false, String(bad));

await assert.rejects(fetchDiscordFile("https://evil.test/attachments/1", fetch));

let options: RequestInit | undefined;
const answer = (r: Response): typeof fetch => async (_u, o) => {
  options = o;
  return r;
};
const got = await fetchDiscordFile(ok, answer(new Response(new Uint8Array([1, 2]), { headers: { "content-type": "application/pdf" } })));
assert.deepEqual([got.status, got.type, [...(got.bytes ?? [])]], [200, "application/pdf", [1, 2]]);
assert.equal(options?.redirect, "error");

const limited = await fetchDiscordFile(ok, answer(new Response(null, { status: 429, headers: { "retry-after": "3" } })));
assert.deepEqual([limited.status, limited.retryAfter, limited.bytes], [429, "3", null]);

const big = await fetchDiscordFile(ok, answer(new Response("x", { headers: { "content-length": String(2 * 1024 ** 3) } })));
assert.equal(big.bytes, null);

console.log("discord file: ok");
