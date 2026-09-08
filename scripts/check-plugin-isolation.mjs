/* eslint-env node */

/**
 * That a plugin runs somewhere it cannot reach the app. Two things hold it up:
 * the loader must not put a plugin on the page, and the worker imports nothing.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../src/packages/addons/src/${p}`, import.meta.url), "utf8");

/* The comments in these files name the things a plugin no longer has. Checking
   the prose for them finds the explanation rather than the code. */
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/* ── the loader must not put a plugin on the page ────────────────────────── */

const loader = read("useAddonLoader.ts");

assert.ok(
  loader.includes("startPlugin("),
  "the loader no longer starts plugins in a worker",
);

/*
 * Themes are still elements in the head — CSS cannot call anything. So the
 * assertion is not "no script tags"; it is that nothing creates a script.
 */
assert.doesNotMatch(
  codeOnly(loader),
  /createElement\(\s*["']script["']\s*\)/,
  "something creates a <script>; a plugin on the app's own page is the thing this replaced",
);

assert.doesNotMatch(
  codeOnly(loader),
  /injectPluginScript/,
  "the old script injection is still here",
);

/* ── the worker must stay empty of the app ───────────────────────────────── */

const worker = read("addonWorker.ts");
const workerImportsSource = worker;

const imports = [...workerImportsSource.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
assert.deepEqual(
  imports,
  ["./workerProtocol"],
  `the worker imports ${JSON.stringify(imports)}; anything but the protocol pulls the app in with it`,
);

/* And the protocol itself has to stay a leaf, or the line above buys nothing. */
const protocol = read("workerProtocol.ts");
assert.deepEqual(
  [...protocol.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]),
  [],
  "workerProtocol imports something; it is imported by the worker and must stay a leaf",
);

/*
 * The things a plugin used to have. Naming them is the point: somebody reading
 * this should be able to see what changed hands.
 */
const workerCode = codeOnly(worker);
for (const forbidden of ["localStorage", "document.", "window."]) {
  assert.ok(
    !workerCode.includes(forbidden),
    `the worker reaches for ${forbidden}, which does not exist in one`,
  );
}

/*
 * A worker has no DOM but does have origin storage, and that is the app's.
 * `Worker` is the one that matters: starting one gets a fresh global back.
 */
for (const global of ["indexedDB", "caches", "Worker", "SharedWorker"]) {
  assert.match(
    workerCode,
    new RegExp(`["']${global}["']`),
    `the worker no longer takes ${global} away before importing a plugin`,
  );
}

/* Off the prototype chain, not off `globalThis`. These are getters on the worker
   global's prototype, so deleting from the object does nothing at all. */
assert.match(
  workerCode,
  /getPrototypeOf/,
  "the worker deletes from globalThis rather than walking the prototype chain, which does nothing",
);

/* And the network stays. A plugin that cannot reach Spotify is not a now-playing
   plugin, and pretending otherwise here would be a lie the docs repeat. */
assert.doesNotMatch(
  workerCode,
  /["'](fetch|WebSocket)["']/,
  "the worker takes the network away; that is not what was decided",
);

/* ── the capability decision ─────────────────────────────────────────────── */

/* Both leaves, so this runs without a browser: the protocol holds the decision
   and the catalogue holds what somebody granted. */
const { METHOD_CAPABILITY, mayCall } = await import("../src/packages/addons/src/workerProtocol.ts");

/* Every method says what it costs. A method with no entry is one that quietly
   needs nothing, which is the failure this map exists to make impossible. */
assert.ok(Object.keys(METHOD_CAPABILITY).length > 0);
for (const [method, capability] of Object.entries(METHOD_CAPABILITY)) {
  assert.ok(capability, `${method} has no capability`);
}

const both = ["status", "messaging"];

assert.deepEqual(mayCall(["status"], ["status"], "setActivity"), { allowed: true });
assert.deepEqual(mayCall(both, both, "messaging.send"), { allowed: true });

/* Declared but not granted, and granted but not declared, are both no. The second
   is an addon that dropped a capability while keeping the agreement. */
assert.deepEqual(mayCall(["status"], [], "setActivity"), { allowed: false, needs: "status" });
assert.deepEqual(mayCall([], ["status"], "setActivity"), { allowed: false, needs: "status" });
assert.deepEqual(mayCall(["status"], ["status"], "messaging.send"), { allowed: false, needs: "messaging" });

/* A method nobody serves is refused rather than allowed: the worker is the only
   caller, so refusing turns a typo into an error rather than a hung promise. */
for (const method of ["", "eval", "setActivity ", "messaging", "__proto__", "constructor", "toString"]) {
  assert.deepEqual(
    mayCall(both, both, method),
    { allowed: false, needs: null },
    `${JSON.stringify(method)} was not refused`,
  );
}

console.log("check-plugin-isolation: ok");
