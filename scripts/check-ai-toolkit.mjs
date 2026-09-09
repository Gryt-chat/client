/* eslint-env node */

// The dev toolkit hands anybody who can run JS in the page the ability to become
// a different identity, so a release build must not carry it (GRYT-1115).

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const MAIN = "src/main.tsx";
const TOOLKIT = "src/devtools/aiToolkit.ts";
const VIEW = "src/packages/socket/src/components/serverView.tsx";

const main = read(MAIN);

/* One call, guarded on the same line. Vite replaces `import.meta.env.DEV` with a
   literal in a build, so the branch and its import fold away. */
const calls = [...main.matchAll(/^.*installAiToolkit\(\).*$/gm)].map((m) => m[0]);
assert.equal(calls.length, 1, `${MAIN} should call installAiToolkit once, found ${calls.length}`);
assert.match(
  calls[0],
  /if \(import\.meta\.env\.DEV\)\s*installAiToolkit\(\)/,
  `${MAIN} calls installAiToolkit outside an import.meta.env.DEV guard, so it ships`,
);

/* The listener the toolkit talks to is in a component that always renders, so the
   guard has to be inside the effect rather than around the component. */
const view = read(VIEW);
const at = view.indexOf('window.addEventListener("dev_open_dm"');
assert.ok(at > 0, `${VIEW} no longer listens for dev_open_dm`);
const effect = view.slice(view.lastIndexOf("useEffect(() => {", at), at);
assert.match(
  effect,
  /if \(!import\.meta\.env\.DEV\) return;/,
  `${VIEW}'s dev_open_dm effect is not guarded, so a release build listens for it`,
);

/* Nothing else may pull the module in, since a second import is a second way in
   that this check does not read. */
const importers = [];
for (const file of walk(join(root, "src"))) {
  if (file.endsWith("aiToolkit.ts")) continue;
  if (/from "[^"]*devtools\/aiToolkit"/.test(readFileSync(file, "utf8"))) {
    importers.push(file.slice(root.length + 1));
  }
}
assert.deepEqual(importers, [MAIN], `only ${MAIN} may import the toolkit`);

/* It reaches for the identity functions directly rather than being handed them,
   so the names it imports are the list of what it can do. */
const toolkit = read(TOOLKIT);
assert.match(toolkit, /restoreIdentityFromWords/, `${TOOLKIT} no longer swaps identity`);
assert.doesNotMatch(
  toolkit,
  /fetch\(|XMLHttpRequest|navigator\.sendBeacon/,
  `${TOOLKIT} sends something somewhere, which a dev handle has no reason to do`,
);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

console.log("ai toolkit: dev-gated, imported once, and it only reads and dispatches");
