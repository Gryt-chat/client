/** GRYT-2112. A report carries the last five minutes of the app log, cut by size, not a fixed line count. */

import assert from "node:assert/strict";

const { windowLines, WINDOW_MS } = await import("../src/lib/reports/logs.ts");

const now = 1_000_000_000;
const at = (secAgo: number, text: string) => ({ at: now - secAgo * 1000, text });
const entries = [at(400, "old"), at(299, "a"), at(120, "b"), at(0, "c")];

assert.equal(WINDOW_MS, 300_000);
assert.deepEqual(windowLines(entries, now), ["a", "b", "c"], "older than five minutes is dropped");
assert.deepEqual(windowLines([], now), []);

const many = Array.from({ length: 1000 }, (_, i) => at(0, `line ${i}`));
assert.equal(windowLines(many, now).length, 1000, "no line-count cap inside the window");
assert.deepEqual(windowLines(many, now, WINDOW_MS, 20).at(-1), "line 999", "the size cap keeps the newest");
assert.ok(windowLines(many, now, WINDOW_MS, 20).join("\n").length <= 20);

console.log("ok");
