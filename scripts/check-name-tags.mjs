/* eslint-env node */

/** GRYT-1674. Two members called Gold get a tag each; a name nobody shares gets none. */

import assert from "node:assert/strict";

const { nameTags, nameTagsFor } = await import("../src/packages/lib/nameTags.ts");

const gold1 = { serverUserId: "u1", nickname: "Gold", identityFingerprint: "3f9aQx" };
const gold2 = { serverUserId: "u2", nickname: " gold ", identityFingerprint: "Zk-_77" };
const solo = { serverUserId: "u3", nickname: "Sivert", identityFingerprint: "abcdef" };
const old = { serverUserId: "u4-uuid", nickname: "Sivert" };

let tags = nameTags([gold1, gold2, solo]);
assert.equal(tags.get("u1"), "3f9a");
assert.equal(tags.get("u2"), "Zk-_", "case and edge spaces still count as the same name");
assert.equal(tags.has("u3"), false, "a name nobody shares has no tag");

tags = nameTags([solo, old]);
assert.equal(tags.get("u4-uuid"), "u4-u", "no fingerprint falls back to the id");

tags = nameTags([{ serverUserId: "a", nickname: "" }, { serverUserId: "b", nickname: "" }]);
assert.equal(tags.size, 0, "empty names are not a collision");

const record = { u1: gold1, u2: gold2 };
assert.equal(nameTagsFor(record), nameTagsFor(record), "worked out once per record");
assert.equal(nameTagsFor(undefined).size, 0);

console.log("name tags: ok");
