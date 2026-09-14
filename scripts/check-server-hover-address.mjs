/* eslint-env node */

// Hovering a server in the rail showed its address, and a stream shows whatever the
// cursor is resting on. A private server's address is not for the audience.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const RAIL = "src/components/sidebar.tsx";
const rail = read(RAIL);

/* The hover card, from its portal to its close. The right-click menu and the merge
   dialog sit outside it and keep the address: those you open on purpose. */
const card = (() => {
  const at = rail.indexOf("<PreviewCard.Portal>");
  assert.notEqual(at, -1, `${RAIL} no longer renders a hover card, so this check reads nothing`);
  const end = rail.indexOf("</PreviewCard.Portal>", at);
  assert.notEqual(end, -1, `${RAIL} has an unclosed hover card`);
  return rail.slice(at, end);
})();

{
  assert.ok(/servers\[host\]\.name/.test(card), "the hover card lost the server's name, so the slice is reading the wrong thing");
  assert.ok(!/\{host\}/.test(card), "the hover card shows the server's address");
  assert.ok(!/duplicateHosts\.join/.test(card), "the hover card lists the other addresses a duplicate is reached at");
  assert.ok(!/\$\{host\}/.test(card), "the hover card puts the server's address in a string");
  assert.ok(
    /Also in your list under another address/.test(card),
    "the hover card stopped saying a server is in the list twice, which is why two identical icons exist",
  );
}

// The deliberate places keep it: copying the address and merging duplicates.
{
  assert.ok(/copyServerAddress\(host\)/.test(rail), "the right-click menu lost Copy address");
  assert.ok(/title=\{`Merge into \$\{host\}\?`\}/.test(rail), "the merge dialog stopped naming the address it keeps");
}

console.log("server hover address: the rail's hover card names a server without its address");
