/* eslint-env node */

/**
 * Which cosmetics read as new, checked without a browser.
 *
 * The whole feature turns on the first-run case rather than on anything about
 * drawing dots: a fresh install has no record, and treating "not in the record"
 * as "new" would light up every cosmetic on the first open. A badge on
 * everything is a badge on nothing, and it teaches somebody to ignore the dot
 * before it has ever meant anything.
 *
 * The code under test ships in @gryt/ui as of GRYT-641; this checks the copy
 * the client actually installs. localStorage is stubbed because that is
 * the only browser API the module touches.
 */

import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { readNewCosmetics, markCosmeticSeen, markAllCosmeticsSeen } = await import("@gryt/ui");

const shipped = ["hat-winter", "glasses-round", "eyes-happy"];

// A fresh install. Nothing is new, and the registry is recorded so that the
// next addition is.
store.clear();
assert.deepEqual([...readNewCosmetics(shipped)], [], "a first run should show nothing as new");

// An update arrives.
const afterUpdate = [...shipped, "hat-bucket", "necklace-pearl"];
assert.deepEqual(
  [...readNewCosmetics(afterUpdate)].sort(),
  ["hat-bucket", "necklace-pearl"],
  "only what was added since should read as new",
);

// Reading does not clear it — the dot survives until the thing is tried on.
assert.equal(readNewCosmetics(afterUpdate).size, 2, "reading should not mark anything seen");

// Trying one on clears that one and leaves the other.
assert.deepEqual([...markCosmeticSeen("hat-bucket", afterUpdate)], ["necklace-pearl"]);
assert.deepEqual([...readNewCosmetics(afterUpdate)], ["necklace-pearl"]);

// And the rest.
assert.deepEqual([...markCosmeticSeen("necklace-pearl", afterUpdate)], []);
assert.deepEqual([...readNewCosmetics(afterUpdate)], []);

// A second update on top of a used install.
const later = [...afterUpdate, "shirt-cape"];
assert.deepEqual([...readNewCosmetics(later)], ["shirt-cape"]);
assert.deepEqual([...markAllCosmeticsSeen(later)], []);
assert.deepEqual([...readNewCosmetics(later)], []);

// A cosmetic that goes away does not resurrect anything.
assert.deepEqual([...readNewCosmetics(["hat-winter"])], []);

// Unreadable storage costs the dots and nothing else. It must not throw, and it
// must not decide that everything is new.
store.clear();
store.set("gryt.owlSeen", "{not json");
assert.deepEqual([...readNewCosmetics(shipped)], [], "garbage should be treated as a first run");

store.set("gryt.owlSeen", JSON.stringify({ not: "an array" }));
assert.deepEqual([...readNewCosmetics(shipped)], []);

// Storage that throws outright — a private window with it disabled.
globalThis.localStorage = {
  getItem() { throw new Error("nope"); },
  setItem() { throw new Error("nope"); },
  removeItem() { throw new Error("nope"); },
};
assert.deepEqual([...readNewCosmetics(shipped)], [], "a broken store should show nothing as new");
assert.deepEqual([...markCosmeticSeen("hat-winter", shipped)], [], "and should not throw");

console.log("owl seen ok");
