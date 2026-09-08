/* eslint-env node */

// Changing the identity invalidates every session and derived key, so both
// paths that do it have to offer the restart rather than mention it. GRYT-1068.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const section = readFileSync(
  join(root, "src/packages/settings/src/components/messageKeySection.tsx"),
  "utf8",
);

// Both identity changes: adopting the account's key, and resetting to a new one.
const calls = [...section.matchAll(/showAdoptedToast\(/g)];

assert.equal(
  calls.length,
  3,
  `expected the helper and both call sites, found ${calls.length} mentions`,
);

assert.match(
  section,
  /onClick=\{\(\) => window\.location\.reload\(\)\}/,
  "the toast no longer offers a restart, so somebody has to know to do it themselves",
);

assert.match(
  section,
  /send or read encrypted/,
  "the toast no longer says sending breaks too, which is the half people miss",
);

// The identity path really does drop the sessions this toast exists for.
const identity = readFileSync(
  join(root, "src/packages/common/src/auth/identity-keys.ts"),
  "utf8",
);

const restore = identity.match(
  /export async function restoreIdentityFromWords[\s\S]*?\n\}/,
);

assert.ok(restore, "restoreIdentityFromWords is gone");
assert.match(
  restore[0],
  /discardServerSessions\(\)/,
  "restoreIdentityFromWords no longer drops sessions; if that changed on purpose, this toast may no longer be needed",
);

console.log("identity restart: ok, both paths offer it");
