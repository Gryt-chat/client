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
  /confirmAction\?\.report\.unverified\s*\n\s*\? "Close this report\?"/,
  `${PANEL}: the confirm dialog title must branch on confirmAction.report.unverified`,
);
assert.match(
  panel,
  /confirmAction\?\.report\.unverified \? \(\s*\n\s*"This closes the report\./,
  `${PANEL}: the confirm dialog description must branch on confirmAction.report.unverified`,
);
assert.match(
  panel,
  /confirmAction\?\.report\.unverified\s*\n\s*\? "Close Report"/,
  `${PANEL}: the confirm dialog's confirm label must branch on confirmAction.report.unverified`,
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
