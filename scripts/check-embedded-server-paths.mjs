/* eslint-env node */

/**
 * The embedded server can be built from a worktree.
 *
 * `build-embedded-server.mjs` used to find the server, SFU and worker as
 * siblings of the client directory. That is true in `packages/client` and false
 * in `.claude/worktrees/<name>`, which has no siblings — so every client
 * worktree started without an embedded server, and said so as
 * `spawnSync /bin/sh ENOENT`, which names a shell rather than the missing
 * directory. CLAUDE.md tells everybody to work in worktrees, so that was the
 * normal case (GRYT-650).
 *
 * The resolution is reimplemented here rather than imported, because the module
 * runs the whole build on import. What is tested is the rule, against real
 * paths on this machine, plus the source keeping the parts the rule needs.
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

// Resolved against the checkout before slicing. A submodule in a normal clone
// writes `gitdir:` relative — `../../.git/modules/client` — and slicing that raw
// gives `../..`, which means nothing once the working directory moves.
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

// Whichever of the two this checkout is, all three have to resolve to somewhere
// that exists. This is the property the build actually needs.
for (const name of ["server", "sfu", "image-worker"]) {
  const found = packageDir(clientDir, name);
  assert.ok(
    existsSync(found),
    `${name} resolved to ${found}, which does not exist — ` +
      `the embedded server cannot be built from ${clientDir}`,
  );
}

// Nothing to go on: no siblings and no superproject. It falls back to the
// sibling path so the error names where somebody would look first, rather than
// throwing somewhere less obvious.
assert.equal(
  packageDir("/tmp/gryt-not-a-checkout", "server"),
  join("/tmp/gryt-not-a-checkout", "..", "server"),
);

console.log(`Embedded server path checks passed — resolved from ${clientDir}`);
