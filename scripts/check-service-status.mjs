#!/usr/bin/env node
/**
 * The outage banner. The failure that matters is a banner appearing when nothing
 * is wrong, so most of this is about staying quiet (GRYT-982).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkAccountsAtLaunch,
  checkAccountServices,
  classifyReach,
  decideBanner,
  FAILURES_BEFORE_BANNER,
  fetchAnnouncement,
  getLaunchTrouble,
  INTERNET_CHECK_URLS,
  pickAnnouncement,
  resetLaunchCheck,
  settleLaunchTrouble,
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

/** `check` for the ones that have to await something. */
async function checkAsync(name, run) {
  try {
    await run();
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
  /* status.gryt.chat runs on a VPS. A notice hosted alongside what it describes
     would be unreachable at the one moment anybody wants it. */
  assert.equal(STATUS_API_URL, "https://status.gryt.chat/api/v1/config");
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const banner = readFileSync(`${ROOT}/src/components/serviceStatusBanner.tsx`, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

check("the banner is gated on being signed in or on trouble at launch", () => {
  /* A guest on a normal day gets nothing. A launch that couldn't check the account is not a normal day. */
  assert.match(
    banner,
    /const watching = !!isSignedIn \|\| launchTrouble !== null;/,
    "the banner watches for somebody other than the signed in or the launched-into-an-outage",
  );
  assert.ok(
    banner.includes("if (!watching)"),
    "the watching check is no longer the first thing the effect does",
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

/* ── A broken feed is not a quiet one ────────────────────────────────── */

/* The feed answered without a CORS header, so every fetch threw — and a throw
   came back as the `null` that also means "nothing announced" (GRYT-1052). */

const realFetch = globalThis.fetch;

await checkAsync("a rejected request does not read as silence", async () => {
  /* What CORS looks like from inside fetch: a TypeError, no status to inspect. */
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  const result = await fetchAnnouncement(STATUS_API_URL);
  assert.equal(result.ok, false, "a failed read reported success");
  assert.match(result.reason, /Failed to fetch/);
});

await checkAsync("a 5xx does not read as silence", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  const result = await fetchAnnouncement(STATUS_API_URL);
  assert.equal(result.ok, false, "a 503 reported success");
});

await checkAsync("an empty feed is a success with nothing to say", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ announcements: [] }),
  });
  const result = await fetchAnnouncement(STATUS_API_URL);
  assert.equal(result.ok, true, "a feed that answered reported failure");
  assert.equal(result.announcement, null);
});

await checkAsync("a live notice comes back through the result", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ announcements: [at("2026-09-08T12:00:00Z")] }),
  });
  const result = await fetchAnnouncement(STATUS_API_URL);
  assert.equal(result.ok && result.announcement?.type, "outage");
});

globalThis.fetch = realFetch;

check("a feed that cannot be read is logged", () => {
  /* Silence is what hid this for a day. */
  assert.ok(
    banner.includes("console.warn"),
    "the banner no longer says anything when the feed cannot be read",
  );
});

/* ── The glyph agrees with the severity ──────────────────────────────── */

check("the icon is chosen per severity, not hardcoded", () => {
  /* An `information` notice used to arrive as an accent-coloured warning
     triangle: the colour said one thing and the shape said another. */
  assert.ok(
    banner.includes("ICON"),
    "the banner draws one icon whatever the notice says",
  );
  assert.ok(
    banner.includes("PiInfoFill"),
    "information has no icon of its own",
  );
});

/* ── Accounts down, offline, or fine (the 2026-09-14 PSU swap) ────────── */

const ISSUER = "https://auth.gryt.chat/realms/gryt";

/** A fetch that answers per host: "ok", "502", "throw", or "hang" until aborted. */
function network(hosts) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(String(url));
    const host = new URL(url).host;
    const behaviour = hosts[host] ?? "throw";
    if (behaviour === "ok") return { ok: true, status: init.mode === "no-cors" ? 0 : 200 };
    if (behaviour === "502") {
      /* Cloudflare's 502 carries no CORS header, so a cors fetch throws and a no-cors one resolves. */
      if (init.mode === "no-cors") return { ok: false, status: 0 };
      throw new TypeError("Failed to fetch");
    }
    if (behaviour === "hang") {
      return new Promise((_, reject) =>
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
      );
    }
    throw new TypeError("Failed to fetch");
  };
  return { calls, fetchImpl };
}

async function withNetwork(hosts, run) {
  const { calls, fetchImpl } = network(hosts);
  globalThis.fetch = fetchImpl;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

check("offline, down and fine are three different answers", () => {
  assert.equal(classifyReach(true, false, false), "offline");
  assert.equal(classifyReach(true, true, true), "offline", "the OS saying offline is believed");
  assert.equal(classifyReach(false, true, false), "reachable");
  assert.equal(classifyReach(false, false, true), "unreachable");
  assert.equal(classifyReach(false, false, false), "offline", "nothing answering is this machine's connection");
});

check("the internet check does not lean on the box that runs Keycloak", () => {
  /* dev.lan went down with Keycloak, ws1, reports and Vikunja on it. */
  for (const url of INTERNET_CHECK_URLS) {
    const host = new URL(url).host;
    assert.ok(!/auth\.gryt\.chat|sivert\.io|reports\./.test(host), `${host} is on the box that goes down with accounts`);
  }
  assert.ok(INTERNET_CHECK_URLS.length >= 2, "one host is a single point of failure for telling offline from down");
});

await checkAsync("a Cloudflare 502 from the issuer, with the internet up, is accounts down", async () => {
  const reach = await withNetwork(
    { "auth.gryt.chat": "502", "status.gryt.chat": "ok", "gryt.chat": "ok" },
    () => checkAccountServices(ISSUER, 200),
  );
  assert.equal(reach, "unreachable");
});

await checkAsync("an issuer that never answers, with the internet up, is accounts down", async () => {
  const reach = await withNetwork(
    { "auth.gryt.chat": "hang", "status.gryt.chat": "ok", "gryt.chat": "hang" },
    () => checkAccountServices(ISSUER, 200),
  );
  assert.equal(reach, "unreachable");
});

await checkAsync("nothing answering is offline, not an outage", async () => {
  const reach = await withNetwork({}, () => checkAccountServices(ISSUER, 200));
  assert.equal(reach, "offline");
});

await checkAsync("a normal start asks the issuer and nothing else", async () => {
  await withNetwork({ "auth.gryt.chat": "ok" }, async (calls) => {
    assert.equal(await checkAccountServices(ISSUER, 200), "reachable");
    assert.deepEqual(calls, [ISSUER], "a healthy launch paid for an internet check it didn't need");
  });
});

await checkAsync("the launch check runs once, and trouble clears when accounts come back", async () => {
  resetLaunchCheck();
  await withNetwork({ "auth.gryt.chat": "502", "gryt.chat": "ok" }, async (calls) => {
    const [a, b] = await Promise.all([checkAccountsAtLaunch(ISSUER), checkAccountsAtLaunch(ISSUER)]);
    assert.equal(a, "unreachable");
    assert.equal(b, "unreachable");
    assert.equal(calls.filter((c) => c === ISSUER).length, 1, "the issuer was probed twice at launch");
  });
  assert.equal(getLaunchTrouble(), "unreachable");
  assert.equal(decideBanner(null, 0, getLaunchTrouble()).kind, "unreachable", "launch trouble waited for a second failure");

  settleLaunchTrouble("offline");
  assert.equal(decideBanner(null, 0, getLaunchTrouble()).kind, "offline", "losing the connection still reads as down");

  settleLaunchTrouble("reachable");
  assert.equal(getLaunchTrouble(), null);
  assert.equal(decideBanner(null, 0, getLaunchTrouble()), null, "the banner outlived the outage");

  settleLaunchTrouble("unreachable");
  assert.equal(getLaunchTrouble(), null, "a later check invented launch trouble after it had cleared");
  resetLaunchCheck();
});

await checkAsync("a healthy launch leaves nothing behind", async () => {
  resetLaunchCheck();
  await withNetwork({ "auth.gryt.chat": "ok" }, () => checkAccountsAtLaunch(ISSUER));
  assert.equal(getLaunchTrouble(), null);
  settleLaunchTrouble("unreachable");
  assert.equal(getLaunchTrouble(), null, "launch trouble appeared on a launch that went fine");
  resetLaunchCheck();
});

check("an announcement still wins over launch trouble", () => {
  assert.equal(decideBanner(NOTICE, 0, "unreachable").kind, "announced");
});

const splash = readFileSync(`${ROOT}/src/components/AuthLoadingOverlay.tsx`, "utf8");

check("the splash names an accounts outage and offline, not just a slow start", () => {
  assert.ok(splash.includes("checkAccountsAtLaunch"), "the splash no longer checks the account services");
  assert.match(splash, /Can't reach Gryt accounts right now/, "the splash has no words for accounts being down");
  assert.match(splash, /You're offline/, "the splash has no words for being offline");
});

check("the banner has words for offline that don't claim an outage", () => {
  assert.match(banner, /You're offline/);
  assert.ok(banner.includes('banner.kind !== "offline"'), "the offline banner links a status page it can't open");
});

console.log(
  failures === 0
    ? "\nservice status: says so when it is told to, and stays quiet otherwise."
    : `\nservice status: ${failures} failed.`,
);
process.exit(failures === 0 ? 0 : 1);
