/* eslint-env node */

/**
 * Confirmations are drawn by one component, alerts by one other.
 *
 * They were hand-rolled twenty-two times, and drifted: Cancel rendered as the
 * primary action in six of them, destructive confirms came out untoned in
 * others, two type-a-phrase gates disagreed about case, and popup widths landed
 * wherever the file happened to leave them. None of that was chosen. Each new
 * copy is a place it starts again, so this fails on the next one.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** The two that are allowed to reach for AlertDialog, being what it is for. */
const PRIMITIVES = [
  "packages/socket/src/components/ConfirmDialog.tsx",
  "packages/socket/src/components/NoticeDialog.tsx",
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
