/* eslint-env node */

/**
 * The embedded server can be built from a worktree. Sibling resolution is false in
 * `.claude/worktrees/<name>`, and failed as `spawnSync /bin/sh ENOENT` (GRYT-650).
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const clientDir = join(here, "..");

const source = readFileSync(join(here, "build-embedded-server.mjs"), "utf8");

// The sibling lookup has to stay first: a plain checkout has no superproject to
// read, and that is where this has always worked.
assert.match(source, /const sibling = join\(CLIENT_DIR, "\.\.", name\)/);
assert.match(source, /function superprojectRoot\(\)/);
assert.match(source, /join\(root, "packages", name\)/);

// Resolved against the checkout before slicing. A submodule writes `gitdir:`
// relative, and slicing that raw gives `../..`, which moves with the cwd.
assert.match(source, /resolve\(CLIENT_DIR, named\[1\]\)/);

// A cwd that does not exist must name itself rather than the shell.
assert.match(source, /does not exist\./);

function superprojectRoot(dir) {
  try {
    const pointer = readFileSync(join(dir, ".git"), "utf8").trim();
    const named = /^gitdir:\s*(.+)$/.exec(pointer);
    if (!named) return null;
    const gitDir = resolve(dir, named[1]);
    const marker = `${sep}.git${sep}`;
    const index = gitDir.indexOf(marker);
    return index === -1 ? null : gitDir.slice(0, index);
  } catch {
    return null;
  }
}

function packageDir(dir, name) {
  const sibling = join(dir, "..", name);
  if (existsSync(sibling)) return sibling;
  const root = superprojectRoot(dir);
  if (root) {
    const inSuperproject = join(root, "packages", name);
    if (existsSync(inSuperproject)) return inSuperproject;
  }
  return sibling;
}

/*
 * Whether this checkout has the other packages anywhere at all. A branch rather
 * than an assertion: this repo's own CI clones the client alone (GRYT-650).
 */
const attached =
  existsSync(join(clientDir, "..", "server")) || superprojectRoot(clientDir) !== null;

if (attached) {
  // Whichever of the two this checkout is, all three have to resolve to somewhere
  // that exists. That is the property the build actually needs.
  for (const name of ["server", "sfu", "image-worker"]) {
    const found = packageDir(clientDir, name);
    assert.ok(
      existsSync(found),
      `${name} resolved to ${found}, which does not exist — ` +
        `the embedded server cannot be built from ${clientDir}`,
    );
  }
} else {
  // A checkout on its own. Nothing to resolve to, so the rule is the fallback:
  // name the sibling path, so whoever hits this looks where they would have.
  for (const name of ["server", "sfu", "image-worker"]) {
    assert.equal(packageDir(clientDir, name), join(clientDir, "..", name));
  }
}

// Nothing to go on: no siblings and no superproject. It falls back to the sibling
// path so the error names where somebody would look first.
assert.equal(
  packageDir("/tmp/gryt-not-a-checkout", "server"),
  join("/tmp/gryt-not-a-checkout", "..", "server"),
);

console.log(
  attached
    ? `Embedded server path checks passed — resolved from ${clientDir}`
    : `Embedded server path checks passed — ${clientDir} is a standalone checkout, ` +
        `so the fallback was checked rather than the packages`,
);
