/* eslint-env node */

// Search snippets come back with the match between \u0002 and \u0003 (GRYT-1738).
// The palette draws them as text, so a message containing HTML can't become markup.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const plain = stripTypeScriptTypes(readFileSync(join(root, "src/packages/socket/src/utils/messageSearch.ts"), "utf8"));
const { snippetParts, activeFilterToken, parseSearchDate, groupByDay } = await import(`data:text/javascript,${encodeURIComponent(plain)}`);

assert.deepEqual(snippetParts("who is up for \u0002deep\u0003 rock"), [
  { text: "who is up for ", match: false },
  { text: "deep", match: true },
  { text: " rock", match: false },
]);
assert.deepEqual(snippetParts("\u0002a\u0003\u0002b\u0003"), [
  { text: "a", match: true },
  { text: "b", match: true },
]);
// A mark cut off by the snippet's length shows as plain text, never a stray control character.
assert.deepEqual(snippetParts("…the \u0002lau"), [{ text: "…the lau", match: false }]);
assert.deepEqual(snippetParts("<img src=x onerror=alert(1)>"), [{ text: "<img src=x onerror=alert(1)>", match: false }]);
assert.deepEqual(snippetParts(""), []);

// A filter being typed at the end of the box is picked, not searched for.
assert.deepEqual(activeFilterToken("haz 5 from:al"), { key: "from", partial: "al", start: 6 });
assert.deepEqual(activeFilterToken("in:"), { key: "in", partial: "", start: 0 });
assert.equal(activeFilterToken("from:al haz"), null);
assert.equal(activeFilterToken("x-from:al"), null);

const now = new Date(2026, 9, 14, 15, 0);
assert.equal(parseSearchDate("2026-10-01", now).getTime(), new Date(2026, 9, 1).getTime());
assert.equal(parseSearchDate("yesterday", now).getTime(), new Date(2026, 9, 13).getTime());
assert.equal(parseSearchDate("2026-02-31", now), null);
assert.equal(parseSearchDate("soon", now), null);

const at = (d, h) => new Date(2026, 9, d, h).toISOString();
assert.deepEqual(groupByDay([{ created_at: at(14, 20) }, { created_at: at(14, 9) }, { created_at: at(3, 23) }]).map((g) => g.hits.length), [2, 1]);
console.log("search snippet: ok");
