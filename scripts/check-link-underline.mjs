/* eslint-env node */

// A link in running text is underlined at rest. Underlining on hover alone
// leaves it reading as coloured text, and on a touch screen it never resolves.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** The one class every link in running text wears. */
const css = readFileSync(join(src, "style.css"), "utf8");
assert.ok(
  css.includes(".gryt-link {") && /\.gryt-link\s*\{[^}]*text-decoration:\s*underline/.test(css),
  "style.css no longer underlines .gryt-link, so every link wearing it is bare",
);
assert.ok(
  /\.gryt-link:hover\s*\{/.test(css),
  ".gryt-link has no hover state, so a link gives no feedback under the pointer",
);

/* Tailwind's `hover:underline` with nothing at rest. `underline-offset-2` is
   not an underline — it only says where one would sit. */
const offenders = [];
for (const file of walk(src)) {
  const body = readFileSync(file, "utf8");
  for (const [, classes] of body.matchAll(/className="([^"]*)"/g)) {
    if (!classes.includes("hover:underline")) continue;
    const names = classes.split(/\s+/);
    if (names.includes("underline") || names.includes("gryt-link")) continue;
    offenders.push(`${relative(root, file).split("\\").join("/")} — ${classes}`);
  }
}

assert.deepEqual(
  offenders,
  [],
  `links that only underline on hover:\n  ${offenders.join("\n  ")}`,
);

// And the class is actually reached for, so this does not pass by nobody using it.
const wearing = walk(src).filter((f) => readFileSync(f, "utf8").includes("gryt-link"));
assert.ok(wearing.length > 0, "nothing in src wears .gryt-link");

console.log(`link underline: ok, ${wearing.length} files use .gryt-link, none underline on hover alone`);
