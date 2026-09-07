#!/usr/bin/env node
/**
 * The outage banner (GRYT-982).
 *
 * The failure that matters is a banner appearing when nothing is wrong, so
 * most of this is about staying quiet: an empty announcement list, an archived
 * one, the all-clear, a single failed probe, a machine with no internet.
 *
 * The announcements come from the status page's own API, which is written by a
 * person and could say anything, so what it renders is checked too.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  decideBanner,
  FAILURES_BEFORE_BANNER,
  pickAnnouncement,
  STATUS_API_URL,
} from "../src/lib/serviceStatus.ts";

let failures = 0;
function check(name, run) {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
}

const at = (ts, extra = {}) => ({
  timestamp: ts,
  type: "outage",
  message: `notice ${ts}`,
  ...extra,
});

console.log("service status");

/* ── Silence is the default ──────────────────────────────────────────── */

check("nothing announced means nothing shown", () => {
  assert.equal(pickAnnouncement({ announcements: [] }), null);
  assert.equal(pickAnnouncement({}), null);
});

check("a malformed response announces nothing", () => {
  assert.equal(pickAnnouncement(null), null);
  assert.equal(pickAnnouncement(undefined), null);
  assert.equal(pickAnnouncement("outage"), null);
  assert.equal(pickAnnouncement({ announcements: "outage" }), null);
  assert.equal(pickAnnouncement({ announcements: [null, 7, "x"] }), null);
});

check("an announcement with no message is not shown", () => {
  /* A banner that says something is wrong and refuses to say what is worse
     than no banner. */
  assert.equal(pickAnnouncement({ announcements: [{ type: "outage" }] }), null);
  assert.equal(
    pickAnnouncement({ announcements: [at("2026-09-07T18:00:00Z", { message: "  " })] }),
    null,
  );
});

check("archived announcements are history, not news", () => {
  const raw = { announcements: [at("2026-09-07T18:00:00Z", { archived: true })] };
  assert.equal(pickAnnouncement(raw), null);
});

check("the all-clear does not raise a banner", () => {
  /* `operational` is how an incident is closed out on the status page.
     Interrupting somebody to say nothing is wrong is not an improvement. */
  const raw = {
    announcements: [at("2026-09-07T18:00:00Z", { type: "operational" })],
  };
  assert.equal(pickAnnouncement(raw), null);
});

/* ── What it shows when there is something to say ────────────────────── */

check("a live announcement comes through", () => {
  const a = pickAnnouncement({
    announcements: [
      {
        timestamp: "2026-09-07T18:00:00Z",
        type: "outage",
        message: "An issue has appeared and we are investigating it.",
      },
    ],
  });
  assert.equal(a.message, "An issue has appeared and we are investigating it.");
  assert.equal(a.type, "outage");
});

check("the newest live announcement wins", () => {
  /* An incident that has been updated: the latest word is the true one. */
  const a = pickAnnouncement({
    announcements: [
      at("2026-09-07T18:00:00Z"),
      at("2026-09-07T20:30:00Z"),
      at("2026-09-07T19:00:00Z"),
    ],
  });
  assert.equal(a.timestamp, "2026-09-07T20:30:00Z");
});

check("a resolved incident stops the banner even with history above it", () => {
  const a = pickAnnouncement({
    announcements: [
      at("2026-09-07T18:00:00Z", { archived: true }),
      at("2026-09-07T20:00:00Z", { type: "operational" }),
    ],
  });
  assert.equal(a, null);
});

check("an unknown severity is treated as a plain notice", () => {
  const a = pickAnnouncement({
    announcements: [at("2026-09-07T18:00:00Z", { type: "catastrophe" })],
  });
  assert.equal(a.type, "none");
});

/* ── Which of the two sources wins ───────────────────────────────────── */

const NOTICE = { message: "We're investigating", type: "outage", timestamp: "z" };

check("one failed probe says nothing", () => {
  /* A blip is not an outage, and a banner that flickers teaches people to
     ignore it. */
  assert.equal(decideBanner(null, 0), null);
  assert.equal(decideBanner(null, 1), null);
});

check("repeated failures raise the generic banner", () => {
  assert.equal(decideBanner(null, FAILURES_BEFORE_BANNER).kind, "unreachable");
  assert.equal(decideBanner(null, 9).kind, "unreachable");
});

check("an announcement wins over the generic banner", () => {
  const b = decideBanner(NOTICE, 9);
  assert.equal(b.kind, "announced");
  assert.equal(b.announcement.message, "We're investigating");
});

check("an announcement shows even while everything is reachable", () => {
  /* Warning people before taking something down is what the status page is
     for, and nothing has failed yet at that point. */
  assert.equal(decideBanner(NOTICE, 0).kind, "announced");
});

/* ── The response cannot break the app ───────────────────────────────── */

check("a long message is cut rather than allowed to bury the app", () => {
  const a = pickAnnouncement({
    announcements: [at("2026-09-07T18:00:00Z", { message: "m".repeat(2000) })],
  });
  assert.ok(a.message.length <= 240, `message was ${a.message.length}`);
});

check("a non-string message is not rendered", () => {
  const a = pickAnnouncement({
    announcements: [at("2026-09-07T18:00:00Z", { message: { toString: () => "x" } })],
  });
  assert.equal(a, null);
});

/* ── Where it reads from ─────────────────────────────────────────────── */

check("it reads the status page, on the host that survives the outage", () => {
  /* status.gryt.chat runs on a VPS. Everything it describes is served from
     home through a Cloudflare tunnel, so a notice hosted alongside would be
     unreachable at the one moment anybody wants it. */
  assert.equal(STATUS_API_URL, "https://status.gryt.chat/api/v1/config");
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const banner = readFileSync(`${ROOT}/src/components/serviceStatusBanner.tsx`, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

check("the banner is gated on being signed in", () => {
  assert.ok(banner.includes("isSignedIn"), "the banner no longer checks isSignedIn");
  assert.ok(
    banner.includes("if (!isSignedIn)"),
    "the signed-in check is no longer the first thing the effect does",
  );
});

check("the announcement renders as text, never as markup", () => {
  /* Gatus renders these as markdown. Here the worst a stray asterisk does is
     look like an asterisk. */
  assert.ok(
    !banner.includes("dangerouslySetInnerHTML"),
    "the banner renders an announcement as markup",
  );
});

check("being offline is not reported as an outage", () => {
  /* The OS knows the difference between no wifi and no Gryt. Without this,
     everybody on a train gets told Gryt is down. */
  assert.ok(
    banner.includes("navigator.onLine"),
    "the banner no longer checks whether the machine is online",
  );
});

console.log(
  failures === 0
    ? "\nservice status: says so when it is told to, and stays quiet otherwise."
    : `\nservice status: ${failures} failed.`,
);
process.exit(failures === 0 ? 0 : 1);
