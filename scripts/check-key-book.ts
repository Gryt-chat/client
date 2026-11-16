import assert from "node:assert/strict";

import { foreignKeyDay, type KeyBookEntry, keyBookId } from "../src/packages/common/src/auth/key-book.ts";

const mine = "mine";
const book: KeyBookEntry[] = [{ day: "2026-10-01", thumb: mine, how: "first" }];
assert.equal(foreignKeyDay(book, mine, null), null, "the first look only remembers");

const seen = new Set(book.map(keyBookId));
assert.equal(foreignKeyDay(book, mine, seen), null, "nothing new");

const later = [...book, { day: "2026-11-16", thumb: "theirs", how: "reset" } as KeyBookEntry];
assert.equal(foreignKeyDay(later, mine, seen), "2026-11-16", "a key none of your devices made");

const retired = [...book, { day: "2026-11-16", thumb: "old", how: "retired" } as KeyBookEntry];
assert.equal(foreignKeyDay(retired, mine, seen), null, "a key leaving is not news");

const ownAgain = [...book, { day: "2026-11-16", thumb: mine, how: "kept" } as KeyBookEntry];
assert.equal(foreignKeyDay(ownAgain, mine, seen), null, "this device's own key");

console.log("key book: ok");
