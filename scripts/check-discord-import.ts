// The Discord import (GRYT-1965): our zip reader against a real deflated zip, and the job
// against fakes: text first, files cached then sent, a dead link left as a note, never twice.

import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

const { openZip } = await import("../src/packages/socket/src/utils/zipReader.ts");
const { importId, runDiscordImport } = await import("../src/packages/socket/src/utils/discordImportJob.ts");

function zip(files: Record<string, string>): Blob {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = new TextEncoder().encode(text);
    const data = deflateRawSync(raw);
    const n = new TextEncoder().encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, 8, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, n.length, true);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(10, 8, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, raw.length, true);
    dir.setUint16(28, n.length, true);
    dir.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), n, data);
    central.push(new Uint8Array(dir.buffer), n);
    offset += 30 + n.length + data.length;
  }
  const size = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)]);
}

const z = await openZip(zip({ "Messages/index.json": '{"1":"Direct Message with kari#0"}', "README.txt": "hei ".repeat(500) }));
assert.deepEqual(z.names.sort(), ["Messages/index.json", "README.txt"]);
assert.equal(await z.read("Messages/index.json"), '{"1":"Direct Message with kari#0"}');
assert.equal((await z.read("README.txt")).length, 2000);
await assert.rejects(openZip(new Blob(["not a zip"])), /isn't a zip/);

const sent: { type: string; entries: { id: string; text: string; attachments?: object }[] }[] = [];
const store = new Map<string, Response>();
const fetched: string[] = [];
let uploads = 0;
const result = await runDiscordImport(
  [
    { discordId: "1", sentAt: 1, text: "hei", attachments: [] },
    { discordId: "2", sentAt: 2, text: "pics", attachments: ["https://cdn.discordapp.com/a.png", "https://cdn.discordapp.com/gone.png"] },
    { discordId: "3", sentAt: 3, text: "", attachments: ["https://cdn.discordapp.com/a.png"] },
  ],
  {
    send: async (c) => void sent.push(c as never),
    upload: async (f) => ({ id: `up-${++uploads}`, key: { id: "k", key: Buffer.alloc(32).toString("base64url"), iv: Buffer.alloc(12).toString("base64url"), name: f.name } }),
    fetchFile: async (url) => {
      fetched.push(url);
      return url.endsWith("gone.png") ? new Response(null, { status: 404 }) : new Response(new Blob(["png"], { type: "image/png" }));
    },
    cache: {
      match: async (u) => store.get(String(u)) ?? undefined,
      put: async (u, r) => void store.set(String(u), r),
      delete: async (u) => store.delete(String(u)),
    },
    sleep: async () => {},
  },
  { paused: () => false, stopped: () => false },
  () => {},
);

assert.equal(sent[0].entries[0].id, importId("1"), "text-only messages go first");
const withFiles = sent.slice(1).flatMap((b) => b.entries);
assert.deepEqual(withFiles.map((e) => e.id), [importId("2"), importId("3")]);
assert.equal(Object.keys(withFiles[0].attachments ?? {}).length, 1, "the dead link isn't attached");
assert.match(withFiles[0].text, /^pics\nA file from Discord couldn.t be downloaded\.$/);
assert.equal(fetched.filter((u) => u.endsWith("a.png")).length, 1, "a link two messages share downloads once");
assert.equal(result.missing, 1);
assert.equal(result.messages.done, 3);
console.log("discord-import: ok");
