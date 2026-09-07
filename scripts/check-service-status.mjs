#!/usr/bin/env node
/**
 * The outage banner, and the two ways it could go wrong (GRYT-982).
 *
 * It has to appear when Sivert says there is an outage, and it has to stay
 * silent otherwise — including when the status file cannot be fetched at all,
 * because a client with no internet must not invent an outage.
 *
 * The parser is where both live, so that is what this exercises.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  decideBanner,
  FAILURES_BEFORE_BANNER,
  parseStatus,
  STATUS_URL,
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

console.log("service status");

/* ── Silence is the default ──────────────────────────────────────────── */

check("nothing is announced unless active is exactly true", () => {
  assert.equal(parseStatus({ title: "Down" }), null);
  assert.equal(parseStatus({ active: false, title: "Down" }), null);
  assert.equal(parseStatus({ active: "true", title: "Down" }), null);
  assert.equal(parseStatus({ active: 1, title: "Down" }), null);
});

check("a malformed file announces nothing", () => {
  assert.equal(parseStatus(null), null);
  assert.equal(parseStatus(undefined), null);
  assert.equal(parseStatus("outage"), null);
  assert.equal(parseStatus([]), null);
});

check("an active notice with no title announces nothing", () => {
  /* Rendering an empty banner would be worse than rendering none: it tells
     somebody something is wrong and refuses to say what. */
  assert.equal(parseStatus({ active: true }), null);
  assert.equal(parseStatus({ active: true, title: "   " }), null);
});

/* ── What it renders when there is something to say ──────────────────── */

check("an active notice comes through", () => {
  const s = parseStatus({
    active: true,
    title: "Sign-in is temporarily unavailable",
    body: "You can keep using Gryt until your session expires.",
    link: "https://discord.gg/Q3JKUGsnHE",
    linkLabel: "What's going on?",
  });
  assert.equal(s.title, "Sign-in is temporarily unavailable");
  assert.equal(s.body, "You can keep using Gryt until your session expires.");
  assert.equal(s.link, "https://discord.gg/Q3JKUGsnHE");
  assert.equal(s.linkLabel, "What's going on?");
});

/* ── Which of the two sources wins ───────────────────────────────────── */

const NOTICE = { title: "We're investigating", body: "", linkLabel: "More" };

check("one failed probe says nothing", () => {
  /* A blip is not an outage, and a banner that flickers teaches people to
     ignore it. */
  assert.equal(decideBanner(null, 0), null);
  assert.equal(decideBanner(null, 1), null);
});

check("repeated failures raise the generic banner", () => {
  const b = decideBanner(null, FAILURES_BEFORE_BANNER);
  assert.equal(b.kind, "unreachable");
  assert.equal(decideBanner(null, 9).kind, "unreachable");
});

check("a posted notice wins over the generic one", () => {
  const b = decideBanner(NOTICE, 9);
  assert.equal(b.kind, "declared");
  assert.equal(b.status.title, "We're investigating");
});

check("a posted notice shows even while everything is reachable", () => {
  /* Warning people before taking something down is the reason the file
     exists, and nothing has failed yet at that point. */
  const b = decideBanner(NOTICE, 0);
  assert.equal(b.kind, "declared");
});

check("a notice without a link still shows", () => {
  const s = parseStatus({ active: true, title: "Maintenance" });
  assert.equal(s.title, "Maintenance");
  assert.equal(s.body, "");
  assert.equal(s.link, undefined);
});

/* ── The file cannot break the app ───────────────────────────────────── */

check("only https links are rendered", () => {
  const bad = (link) => parseStatus({ active: true, title: "x", link }).link;

  /* The banner renders this as something somebody clicks, so a status file
     must not become a way to run anything in the app. */
  assert.equal(bad("javascript:alert(1)"), undefined);
  assert.equal(bad("http://example.com"), undefined);
  assert.equal(bad("data:text/html,hi"), undefined);
  assert.equal(bad("file:///etc/passwd"), undefined);
  assert.equal(bad("not a url"), undefined);
  assert.equal(bad(""), undefined);
  assert.equal(bad(42), undefined);
});

check("long strings are cut rather than allowed to break the layout", () => {
  const s = parseStatus({
    active: true,
    title: "t".repeat(500),
    body: "b".repeat(1000),
    linkLabel: "l".repeat(200),
    link: "https://gryt.chat",
  });
  assert.ok(s.title.length <= 80, `title was ${s.title.length}`);
  assert.ok(s.body.length <= 200, `body was ${s.body.length}`);
  assert.ok(s.linkLabel.length <= 40, `linkLabel was ${s.linkLabel.length}`);
});

check("non-string fields do not reach the banner", () => {
  const s = parseStatus({
    active: true,
    title: "Down",
    body: { toString: () => "nope" },
    linkLabel: 7,
  });
  assert.equal(s.body, "");
  assert.equal(s.linkLabel, "More");
});

/* ── Where it reads from ─────────────────────────────────────────────── */

check("the status file is on the host that survives the outage", () => {
  /* gryt.chat runs on the Pi. Keycloak, the identity service and the Gryt
     servers run on a different machine, which is the one that goes down — so
     the notice explaining the outage is not hosted on the thing that is out. */
  assert.equal(STATUS_URL, "https://gryt.chat/status.json");
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

check("the banner renders text, never markup from the file", () => {
  assert.ok(
    !banner.includes("dangerouslySetInnerHTML"),
    "the banner renders the status file as markup",
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
