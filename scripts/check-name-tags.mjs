/* eslint-env node */

/** GRYT-1674. Two members called Gold are #1 and #2 by join order; a name nobody shares gets none. */

import assert from "node:assert/strict";

const { nameTags, nameTagsFor } = await import("../src/packages/lib/nameTags.ts");

const first = { serverUserId: "u9", nickname: "Gold", createdAt: "2026-10-01T10:00:00Z" };
const second = { serverUserId: "u1", nickname: " gold ", createdAt: "2026-10-06T08:00:00Z" };
const solo = { serverUserId: "u3", nickname: "Sivert", createdAt: "2026-01-01T00:00:00Z" };

let tags = nameTags([second, solo, first]);
assert.equal(tags.get("u9"), "#1", "whoever joined first is #1");
assert.equal(tags.get("u1"), "#2", "case and edge spaces still count as the same name");
assert.equal(tags.has("u3"), false, "a name nobody shares has no tag");

tags = nameTags([{ serverUserId: "b", nickname: "X" }, { ...first, nickname: "x" }, { serverUserId: "a", nickname: "X" }]);
assert.deepEqual([tags.get("u9"), tags.get("a"), tags.get("b")], ["#1", "#2", "#3"], "no date goes last, by id");

tags = nameTags([{ serverUserId: "a", nickname: "" }, { serverUserId: "b", nickname: "" }]);
assert.equal(tags.size, 0, "empty names are not a collision");

const record = { u1: first, u2: second };
assert.equal(nameTagsFor(record), nameTagsFor(record), "worked out once per record");
assert.equal(nameTagsFor(undefined).size, 0);

console.log("name tags: ok");
