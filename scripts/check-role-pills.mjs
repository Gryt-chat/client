/* eslint-env node */

// Runs the hover card's own pill expression. It used to match the source for a
// `.map`, which passed while the pills drew ids and a guest chip. GRYT-1076.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = "src/packages/socket/src/components/MemberIdentityCard.tsx";
const card = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", SOURCE),
  "utf8",
);

/** Everything after `const rolePills =`, up to the semicolon that ends it. */
function pillExpression(text) {
  const start = text.indexOf("const rolePills =");
  assert.notEqual(
    start,
    -1,
    `${SOURCE} no longer builds rolePills. If it moved, move this check with it.`,
  );

  const from = text.indexOf("=", start) + 1;
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    // A `//` comment in the middle of the chain carries semicolons of its own.
    if (c === "/" && text[i + 1] === "/") i = text.indexOf("\n", i);
    else if (c === '"' || c === "'") i = text.indexOf(c, i + 1);
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === ";" && depth === 0) return text.slice(from, i);
    if (i === -1) break;
  }
  throw new Error(`unterminated rolePills expression in ${SOURCE}`);
}

const pills = new Function(
  "member",
  "roleSummaries",
  `return (${pillExpression(card)});`,
);

/** What a server sends: ids, with the names shown everywhere else. */
const SUMMARIES = [
  { id: "owner", name: "Owner", rank: 100 },
  { id: "admin", name: "Admin", rank: 80 },
  { id: "member", name: "Member", rank: 40 },
  { id: "guest", name: "Guest", rank: 10 },
  { id: "trusted-member", name: "Trusted Member", rank: 50 },
];

const named = (member) => pills(member, SUMMARIES).map((p) => p.name);

// The report this exists for: holding a real role and the joiner default, and
// being shown the joiner default under its id.
assert.deepEqual(
  named({ roles: ["trusted-member", "guest"] }),
  ["Trusted Member"],
  "a member holding a role and the guest default is drawn wrong",
);

// Both joiner defaults are hidden, and neither is special-cased over the other.
assert.deepEqual(named({ roles: ["member"] }), [], "the member default draws a pill");
assert.deepEqual(named({ roles: ["guest"] }), [], "the guest default draws a pill");

// Everything else is drawn, in the order the server ranked it.
assert.deepEqual(
  named({ roles: ["owner", "admin", "trusted-member"] }),
  ["Owner", "Admin", "Trusted Member"],
  "roles are dropped or reordered",
);

// The name, never the id.
assert.deepEqual(
  named({ roles: ["trusted-member"] }),
  ["Trusted Member"],
  "a pill shows the role id rather than its name",
);

// A server that sent no definitions still gets a readable pill rather than none.
assert.deepEqual(
  pills({ roles: ["trusted-member"] }, []).map((p) => p.name),
  ["trusted-member"],
  "with no role definitions the pill disappears instead of falling back to the id",
);

// An older server sends `role` alone, and that still has to draw (GRYT-748).
assert.deepEqual(named({ role: "admin" }), ["Admin"], "the fallback from roles to role is gone");
assert.deepEqual(named({}), [], "a member with no role at all throws or draws something");

// And the chip has to render the name off that list rather than the raw id.
assert.match(
  card,
  /\{rolePills\.map\(\(role\) => \([\s\S]{0,200}?\{role\.name\}/,
  `${SOURCE} no longer renders role.name, so the pills are showing ids again`,
);

console.log("role pills: ok, names not ids, joiner defaults hidden, order kept");
