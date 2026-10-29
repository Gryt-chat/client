// The Discord import (GRYT-1965): our zip reader against a real deflated zip. The job itself is
// @gryt/core's and tested there.

import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

const { openZip } = await import("../src/packages/socket/src/utils/zipReader.ts");

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
  return new Blob([new Uint8Array(Buffer.concat([...parts, ...central, new Uint8Array(end.buffer)]))]);
}

const z = await openZip(zip({ "Messages/index.json": '{"1":"Direct Message with kari#0"}', "README.txt": "hei ".repeat(500) }));
assert.deepEqual(z.names.sort(), ["Messages/index.json", "README.txt"]);
assert.equal(await z.read("Messages/index.json"), '{"1":"Direct Message with kari#0"}');
assert.equal((await z.read("README.txt")).length, 2000);
await assert.rejects(openZip(new Blob(["not a zip"])), /isn't a zip/);
console.log("discord-import: ok");
