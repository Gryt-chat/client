import assert from "node:assert/strict";
import { File } from "node:buffer";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

globalThis.File = File;
globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const here = dirname(fileURLToPath(import.meta.url));
const built = await build({
  entryPoints: [join(here, "../src/packages/socket/src/lib/memberCard/cardBannerStore.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
});
const code = Buffer.from(built.outputFiles[0].contents).toString("base64");
const store = await import(`data:text/javascript;base64,${code}`);

const red = { fill: "solid", c1: "#ff0000", pattern: "dots" };
const blue = { fill: "solid", c1: "#0000ff", pattern: "weave" };
const file = new File([new Uint8Array([1, 2, 3])], "banner.webp", { type: "image/webp" });

assert.deepEqual(await store.getCardBanner(red), { found: false, file: null });
await store.setCardBanner(red, file);
const saved = await store.getCardBanner(red);
assert.equal(saved.found, true);
assert.equal(saved.file.name, "banner.webp");
assert.equal(saved.file.type, "image/webp");
assert.deepEqual([...new Uint8Array(await saved.file.arrayBuffer())], [1, 2, 3]);

await store.setCardBanner(blue, null);
assert.deepEqual(await store.getCardBanner(blue), { found: true, file: null });
await store.pruneCardBanners([blue]);
assert.deepEqual(await store.getCardBanner(red), { found: false, file: null });
await store.deleteCardBanner(blue);
assert.deepEqual(await store.getCardBanner(blue), { found: false, file: null });

console.log("card banner store: ok");
