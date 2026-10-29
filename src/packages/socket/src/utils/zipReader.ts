/* A zip's central directory, read by hand, and entries inflated with the browser's own
   DecompressionStream. Enough for Discord's data package; no Zip64, no encryption. */

export interface ZipFiles {
  names: string[];
  read(name: string): Promise<string>;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

interface Entry {
  method: number;
  compressedSize: number;
  localOffset: number;
}

export async function openZip(file: Blob): Promise<ZipFiles> {
  const tailSize = Math.min(file.size, 65_557);
  const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
  let eocd = -1;
  for (let i = tailSize - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("That file isn't a zip.");
  const count = tail.getUint16(eocd + 10, true);
  const dirSize = tail.getUint32(eocd + 12, true);
  const dirOffset = tail.getUint32(eocd + 16, true);
  if (dirOffset === 0xffffffff) throw new Error("That zip is too big to read here.");

  const dir = new DataView(await file.slice(dirOffset, dirOffset + dirSize).arrayBuffer());
  const decoder = new TextDecoder();
  const entries = new Map<string, Entry>();
  let p = 0;
  for (let n = 0; n < count && dir.getUint32(p, true) === CENTRAL; n++) {
    const nameLength = dir.getUint16(p + 28, true);
    const name = decoder.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLength));
    if (!name.endsWith("/")) {
      entries.set(name, { method: dir.getUint16(p + 10, true), compressedSize: dir.getUint32(p + 20, true), localOffset: dir.getUint32(p + 42, true) });
    }
    p += 46 + nameLength + dir.getUint16(p + 30, true) + dir.getUint16(p + 32, true);
  }

  return {
    names: [...entries.keys()],
    async read(name) {
      const e = entries.get(name);
      if (!e) throw new Error(`${name} isn't in the zip.`);
      const head = new DataView(await file.slice(e.localOffset, e.localOffset + 30).arrayBuffer());
      if (head.getUint32(0, true) !== LOCAL) throw new Error(`${name} is damaged in the zip.`);
      const start = e.localOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
      const data = file.slice(start, start + e.compressedSize);
      if (e.method === 0) return data.text();
      if (e.method !== 8) throw new Error(`${name} is packed in a way this can't read.`);
      return new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
    },
  };
}
