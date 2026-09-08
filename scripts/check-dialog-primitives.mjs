/* eslint-env node */

/**
 * Confirmations are drawn by one component, alerts by one other. Twenty-two
 * hand-rolled copies drifted; each new one is where it starts again.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/**
 * The ones allowed to reach for AlertDialog, being what it is for. The third
 * draws a shape the other two cannot carry, not another notice (GRYT-1088).
 */
const PRIMITIVES = [
  "packages/socket/src/components/ConfirmDialog.tsx",
  "packages/socket/src/components/NoticeDialog.tsx",
  "packages/socket/src/components/WhatsNewDialog.tsx",
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const offenders = walk(src)
  .filter((file) => readFileSync(file, "utf8").includes("AlertDialog.Root"))
  .map((file) => relative(src, file).split("\\").join("/"))
  .filter((file) => !PRIMITIVES.includes(file));

assert.deepEqual(
  offenders,
  [],
  `these build a dialog by hand instead of using ConfirmDialog or NoticeDialog:\n  ${offenders.join("\n  ")}`,
);

// And the primitives themselves are still there to be used.
for (const file of PRIMITIVES) {
  const body = readFileSync(join(src, file), "utf8");
  assert.ok(body.includes("AlertDialog.Root"), `${file} no longer renders a dialog`);
}

console.log(`dialog primitives: ok, ${PRIMITIVES.length} of them and nothing else`);
