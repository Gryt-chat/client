// Every relative import under scripts/, and every script path package.json, electron-builder and CI
// name, points at a file. A rename once left beforeBuild importing one that wasn't there (GRYT-1804).

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The quoted relative specifiers in `from`, a bare `import`, `import()` and `require()`. */
function relativeSpecifiers(source: string): string[] {
  const found = source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["'](\.{1,2}\/[^"'\n]+)["']/gm);
  return [...found].map((m) => m[1]);
}

/** `scripts/…` paths in a config file, but not one under another folder such as `.github/scripts/`. */
function scriptPaths(text: string): string[] {
  return [...text.matchAll(/(?<![\w.-]|\w\/)scripts\/[\w./-]+\.(?:ts|mts|cts|js|mjs|cjs)\b/g)].map((m) => m[0]);
}

assert.deepEqual(
  relativeSpecifiers(`import a from "./a.ts";\nimport "./side.mjs";\nconst b = await import("../b.ts");\nconst c = require('./c.cjs');\nimport x from "node:fs";`),
  ["./a.ts", "./side.mjs", "../b.ts", "./c.cjs"],
);
assert.deepEqual(scriptPaths(`node scripts/x.ts && node .github/scripts/y.mjs; ./scripts/lib/z.mjs`), ["scripts/x.ts", "scripts/lib/z.mjs"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : files(full);
    return /\.(?:ts|mts|cts|mjs|cjs|js)$/.test(name) ? [full] : [];
  });
}

const missing: string[] = [];
const self = fileURLToPath(import.meta.url);
for (const file of [...files(join(root, "scripts")), join(root, "electron-builder.config.cjs")]) {
  if (file === self) continue; // its own fixtures above
  for (const spec of relativeSpecifiers(readFileSync(file, "utf8"))) {
    // Root too: check-helper-packaging requires the builder config inside a `node -e` run from the root.
    if (!existsSync(join(dirname(file), spec)) && !existsSync(join(root, spec))) missing.push(`${relative(root, file)} imports ${spec}`);
  }
}

const workflows = readdirSync(join(root, ".github/workflows")).map((name) => join(".github/workflows", name));
for (const config of ["package.json", "electron-builder.yml", ...workflows]) {
  for (const path of scriptPaths(readFileSync(join(root, config), "utf8"))) {
    if (!existsSync(join(root, path))) missing.push(`${config} names ${path}`);
  }
}

assert.deepEqual(missing, [], `these point at files that don't exist:\n  ${missing.join("\n  ")}`);
console.log("script paths: every import under scripts/ and every script path the configs name is there");
