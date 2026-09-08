/* eslint-env node */

// The hover card lists every role, not only the one a name is coloured by.
// GRYT-748 added `roles` and this caller kept reading `role`. GRYT-1065.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const card = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src/packages/socket/src/components/MemberIdentityCard.tsx",
  ),
  "utf8",
);

assert.match(
  card,
  /member\.roles \?\? \(member\.role \? \[member\.role\] : \[\]\)/,
  "the hover card no longer falls back from roles to role, so an older server shows nothing",
);

assert.match(
  card,
  /rolePills\.map\(/,
  "the hover card no longer renders every role",
);

// A single chip straight off `role` is the bug this replaced.
assert.doesNotMatch(
  card,
  /<Chip[^>]*>\s*\{member\.role\}/,
  "the hover card renders member.role directly again, so lower-ranked roles vanish",
);

console.log("role pills: ok, the card lists every role");
