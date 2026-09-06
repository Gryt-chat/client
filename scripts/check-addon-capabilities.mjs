/* eslint-env node */

/**
 * What a plugin may do, and what it may not (GRYT-928).
 *
 * **This is not a sandbox and the module says so at length.** A plugin runs in
 * the app's own page and could go around all of it. What is checked here is
 * that the polite path answers correctly — so a plugin ignoring the answer has
 * to do it on purpose rather than by accident, and a grant somebody made means
 * what they thought it meant.
 *
 * The cases that matter are the ones where a grant should *not* apply: an
 * addon that stopped declaring a capability, a manifest that lists something
 * this build has never heard of, and storage that cannot be read.
 *
 * Run against the real module rather than a copy — Node strips the types on
 * import, which is why this lives in .mjs and the source stays .ts.
 */

import assert from "node:assert/strict";

/* The module reaches for localStorage at call time, not at import time, so a
   stand-in defined here is enough — and defining it is the only way to run this
   outside a browser at all. */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  // `pruneGrants` walks the keys, which is the only way to find grants left by
  // an addon that is no longer installed.
  get length() {
    return store.size;
  },
  key: (i) => [...store.keys()][i] ?? null,
};

const {
  ADDON_CAPABILITIES,
  CAPABILITY_LABELS,
  addonMay,
  declaredCapabilities,
  grantedCapabilities,
  pruneGrants,
  setGrantedCapabilities,
} = await import("../src/packages/addons/src/capabilities.ts");

/* ── the catalogue ───────────────────────────────────────────────────────── */

assert.ok(ADDON_CAPABILITIES.length > 0);
for (const capability of ADDON_CAPABILITIES) {
  assert.ok(
    CAPABILITY_LABELS[capability],
    `${capability} has no label, so nobody would know what they were agreeing to`,
  );
}

/* ── what a manifest asked for ───────────────────────────────────────────── */

assert.deepEqual(declaredCapabilities(["status"]), ["status"]);

/* Unknown names are dropped rather than refused, so a manifest written against
   a newer Gryt still loads here and simply does not get the new part. */
assert.deepEqual(declaredCapabilities(["status", "read-your-email"]), ["status"]);
assert.deepEqual(declaredCapabilities(["read-your-email"]), []);

for (const junk of [undefined, null, "status", 42, {}, [null], [{}], [["status"]]]) {
  assert.deepEqual(
    declaredCapabilities(junk),
    [],
    `expected nothing from ${JSON.stringify(junk)}`,
  );
}

/* Deduplicated, so a manifest cannot pad its list with repeats. */
assert.deepEqual(declaredCapabilities(["status", "status"]), ["status"]);

/*
 * And in catalogue order whatever order it was written in.
 *
 * **This one cannot fail while there is a single capability**, which is worth
 * saying out loud rather than leaving as a test that looks like it covers
 * something. It is written against the catalogue rather than against "status"
 * so it starts being a real check the moment a second one is added — which is
 * exactly when two manifests listing the same pair in different orders could
 * start producing different strings.
 */
assert.deepEqual(
  declaredCapabilities([...ADDON_CAPABILITIES].reverse()),
  [...ADDON_CAPABILITIES],
  "capabilities should come back in catalogue order",
);

/* ── granting ────────────────────────────────────────────────────────────── */

store.clear();

assert.deepEqual(grantedCapabilities("nowplaying"), [], "nothing is granted by default");
assert.equal(
  addonMay("nowplaying", "status", ["status"]),
  false,
  "declaring a capability is not the same as being given it",
);

setGrantedCapabilities("nowplaying", ["status"]);
assert.deepEqual(grantedCapabilities("nowplaying"), ["status"]);
assert.equal(addonMay("nowplaying", "status", ["status"]), true);

/* A grant is per addon and does not leak to the next one. */
assert.equal(addonMay("something-else", "status", ["status"]), false);

/*
 * ── the case a two-sided check exists for ────────────────────────────────
 *
 * An addon that drops `status` from its manifest in an update, while keeping
 * the grant somebody made when it was there, would be using a permission
 * nobody agreed to for the version they are actually running.
 */
assert.equal(
  addonMay("nowplaying", "status", []),
  false,
  "a grant must not outlive the declaration it was made against",
);

/* Revoking works, and goes back to nothing rather than to a default. */
setGrantedCapabilities("nowplaying", []);
assert.equal(addonMay("nowplaying", "status", ["status"]), false);

/* A capability that is not in the catalogue cannot be granted by writing it. */
setGrantedCapabilities("nowplaying", ["read-your-email"]);
assert.deepEqual(grantedCapabilities("nowplaying"), []);

/* ── storage that will not answer ────────────────────────────────────────── */

const broken = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
  removeItem() {},
};
const good = globalThis.localStorage;
globalThis.localStorage = broken;

assert.deepEqual(grantedCapabilities("nowplaying"), [], "an unreadable store grants nothing");
assert.doesNotThrow(() => setGrantedCapabilities("nowplaying", ["status"]));
assert.equal(
  addonMay("nowplaying", "status", ["status"]),
  false,
  "failing to store a grant must fail closed",
);

globalThis.localStorage = good;

/* Corrupt JSON is not a grant either. */
store.set("addons.capabilities.nowplaying", "{not json");
assert.deepEqual(grantedCapabilities("nowplaying"), []);

/*
 * ── what is already in storage, which the setter never saw ───────────────
 *
 * Everything above went in through `setGrantedCapabilities`, which cleans on
 * the way in — so it cannot tell whether reading is checked at all. These
 * write the key directly, the way another tab, an older build, or somebody
 * with the devtools open would.
 */
for (const [written, expected] of [
  [JSON.stringify(["read-your-email"]), []],
  [JSON.stringify(["status", "read-your-email"]), ["status"]],
  [JSON.stringify("status"), []],
  [JSON.stringify([1, 2, 3]), []],
  [JSON.stringify({ status: true }), []],
  [JSON.stringify(null), []],
]) {
  store.set("addons.capabilities.seeded", written);
  assert.deepEqual(
    grantedCapabilities("seeded"),
    expected,
    `a grant read straight from storage was not checked: ${written}`,
  );
}

/* And the same through the door that actually matters. */
store.set("addons.capabilities.seeded", JSON.stringify(["read-your-email"]));
assert.equal(
  addonMay("seeded", "status", ["status"]),
  false,
  "a capability nobody catalogued must not be usable however it got into storage",
);

/*
 * The write side is checked separately rather than being taken on trust from
 * the read side. Both clean, deliberately: either one alone would make the
 * other's mutation survive, and a capability that only exists because one of
 * two guards is present is a guard nobody knows they are relying on.
 */
store.clear();
setGrantedCapabilities("writecheck", ["status", "read-your-email"]);
assert.equal(
  store.get("addons.capabilities.writecheck"),
  JSON.stringify(["status"]),
  "the setter must not write a capability that is not in the catalogue",
);

/*
 * ── a grant must not outlive the addon ───────────────────────────────────
 *
 * An id is a folder name. A grant left behind after somebody deletes an addon
 * would be inherited by the next one to call itself the same thing — which is
 * the exact substitution these switches exist to prevent. Found by writing the
 * docs for this and trying to state what deleting a folder does.
 */
store.clear();
setGrantedCapabilities("stillhere", ["status"]);
setGrantedCapabilities("deleted", ["status"]);

pruneGrants(["stillhere"]);

assert.deepEqual(grantedCapabilities("stillhere"), ["status"], "pruned an installed addon");
assert.deepEqual(grantedCapabilities("deleted"), [], "kept a grant for an addon that is gone");
assert.equal(
  addonMay("deleted", "status", ["status"]),
  false,
  "an addon reusing a deleted addon's id must not inherit its permission",
);

/*
 * An empty list means "not known yet", not "nothing installed".
 *
 * The installed set is empty for a moment at startup and while it is being
 * read. Pruning against that would wipe every grant on the device, which is a
 * far worse failure than the one orphaned key it would have cleaned up.
 */
setGrantedCapabilities("stillhere", ["status"]);
pruneGrants([]);
assert.deepEqual(
  grantedCapabilities("stillhere"),
  ["status"],
  "an empty installed list wiped the grants",
);

/* Nothing else in storage is touched. */
store.set("something.else", "leave me alone");
pruneGrants(["stillhere"]);
assert.equal(store.get("something.else"), "leave me alone");

console.log("check-addon-capabilities: ok");
