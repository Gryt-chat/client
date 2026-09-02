/* eslint-env node */

/**
 * The wiring behind reporting a person (GRYT-746).
 *
 * This reads source rather than running anything. It cannot tell you the
 * feature works — the server tests do that, and a browser did the rest. What it
 * catches is the class of breakage that typechecks: a prop dropped somewhere in
 * the four components it passes through, or a button that stops asking for the
 * permission the server asks for.
 *
 * The last one is why this file exists. `manage_reports` is what opens the
 * queue; kicking and banning out of it are separately gated on both sides, and
 * a client that offers a button the server refuses teaches moderators that the
 * panel is broken.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const menu = read("src/packages/socket/src/components/UserContextMenu.tsx");
const sidebar = read("src/packages/socket/src/components/MemberSidebar.tsx");
const panelWrapper = read("src/packages/socket/src/components/MemberSidebarPanel.tsx");
const serverView = read("src/packages/socket/src/components/serverView.tsx");
const reportsPanel = read("src/packages/socket/src/components/ReportsPanel.tsx");
const badge = read("src/packages/socket/src/hooks/useServerReports.ts");
const dialog = read("src/packages/socket/src/components/ReportUserDialog.tsx");
const hook = read("src/packages/socket/src/hooks/useReportUser.ts");

/* ── the menu item ──────────────────────────────────────────────────────── */

assert.match(
  menu,
  /\{onReport && has\("report_messages"\) && \(/,
  "the Report item must be gated on report_messages, the same permission the server checks",
);

/*
 * Not `can`. `has` is false unless the server said so, and a server old enough
 * to send no permission list is also old enough not to have `user:report` —
 * offering it there produces a report that goes nowhere.
 */
assert.doesNotMatch(
  menu,
  /onReport && can\("report_messages"\)/,
  "can() would offer Report on a server that cannot take one",
);

/* ── the four components it passes through ──────────────────────────────── */

for (const [name, source] of [
  ["MemberSidebar", sidebar],
  ["MemberSidebarPanel", panelWrapper],
]) {
  assert.match(source, /onReport/, `${name} dropped onReport`);
}

assert.match(
  sidebar,
  /onReport\s*&&\s*!isSelf/,
  "Report must be left off your own row — the server refuses it, so the item would always fail",
);

assert.match(
  serverView,
  /onReport=\{setReportTarget\}/,
  "serverView must open the dialog from the member list",
);
assert.match(
  serverView,
  /reportUser\(\{ serverUserId, reason \}\)/,
  "the dialog's submit must reach useReportUser",
);

/* ── the reason ─────────────────────────────────────────────────────────── */

assert.match(
  dialog,
  /export const REPORT_REASON_MAX = 1000;/,
  "the cap must match the server's REASON_MAX, which is 1000",
);
assert.match(
  dialog,
  /const canSubmit = trimmed\.length > 0/,
  "an empty reason must not be submittable: the server refuses it, and a report with nothing on it cannot be acted on",
);

/* ── the answer, or the absence of one ──────────────────────────────────── */

assert.match(
  hook,
  /report:user_submitted/,
  "the hook must wait for the server's answer rather than firing and forgetting",
);
assert.match(
  hook,
  /too old to take reports/,
  "a server that never answers must say so; silence reads as a report that landed",
);

/* ── the moderator side ─────────────────────────────────────────────────── */

assert.match(
  reportsPanel,
  /canKick=\{has\("kick_members"\)\}/,
  "kicking from the queue must ask for kick_members, as the server does",
);
assert.match(
  reportsPanel,
  /canBan=\{has\("ban_members"\)\}/,
  "banning from the queue must ask for ban_members, as the server does",
);
assert.match(
  reportsPanel,
  /reports:resolve_user/,
  "the queue must resolve user reports through their own event",
);

assert.match(
  badge,
  /payload\.userReports\?\.length \?\? 0/,
  "the badge must count reported people as well as reported messages, or a queue with only people in it looks empty",
);

console.log("report-user wiring: ok");
