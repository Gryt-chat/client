/* eslint-env node */

// Delete on an unverified report (a reporter's own encrypted-DM copy) only
// closes the report — the server never had the message (server#250, GRYT-1569).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PANEL = "src/packages/socket/src/components/ReportsPanel.tsx";
const panel = readFileSync(join(root, PANEL), "utf8");

/* The icon-button tooltip on a report card's delete action. */
assert.match(
  panel,
  /Tooltip title=\{report\.unverified \? "Close this report" : "Delete this message"\}/,
  `${PANEL}: the delete tooltip must branch on report.unverified`,
);

/* Title, body and confirm label all have to branch, or the old
   "permanently deletes" wording survives on a card where nothing is deleted. */
assert.match(
  panel,
  /const closeOrDelete = confirmAction\?\.report\.unverified \? "close" : "delete";/,
  `${PANEL}: the confirm dialog must pick its copy on confirmAction.report.unverified`,
);
for (const part of ["title", "label", "description"]) {
  assert.match(panel, new RegExp(`CONFIRM\\[confirmKind\\]\\.${part}`), `${PANEL}: the confirm dialog's ${part} doesn't come from the chosen copy`);
}
assert.match(
  panel,
  /close: \{\s*title: "Close this report\?",\s*label: "Close Report",\s*description: "This closes the report\./,
  `${PANEL}: closing an unverified report lost its own title, label or description`,
);

/* A normal (verified) report keeps saying the delete is permanent. */
assert.match(
  panel,
  /"This will permanently delete this reported message\. This cannot be undone\."/,
  `${PANEL}: a verified report lost its permanent-delete wording`,
);

/* The toast after resolving "delete": closing an unverified report is not the
   same event as deleting a message, so it needs its own success toast. */
assert.match(
  panel,
  /toast\.success\(wasUnverified \? "Report closed" : "Message deleted"\)/,
  `${PANEL}: the delete toast must branch on whether the closed report was unverified`,
);

console.log("unverified report copy: delete on an unverified card says close, not delete");
