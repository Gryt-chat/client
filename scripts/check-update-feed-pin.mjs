#!/usr/bin/env node
/**
 * What a pressed Check for Updates points the updater at. Nothing newer and a failed lookup
 * both have to answer before the updater's own github provider is asked (GRYT-1050, GRYT-1170).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  chooseFeedRelease,
  clockTime,
  findFeedRelease,
  lookupFailedMessage,
  rateLimitResetAt,
} from "../electron/updateFeedPin.ts";

let failures = 0;
async function check(name, run) {
  try {
    await run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
}

console.log("update feed pin");

const release = (tag, { draft = false } = {}) => ({
  tag_name: tag,
  draft,
  prerelease: tag.includes("-"),
});

/* Newest first, the way the API lists them. */
const releases = [
  release("v1.11.0-beta.2", { draft: true }),
  release("v1.11.0-beta.1"),
  release("v1.10.1"),
  release("v1.10.0"),
  release("v1.10.0-beta.1"),
  release("v1.9.4"),
];

/* Stands in for the channel yml check: slim and full ship different yml files. */
const installable = (missing = []) => async (r) => !missing.includes(r.tag_name);

const pick = (opts) =>
  chooseFeedRelease(releases, {
    wantPrerelease: false,
    variantSwitchPending: false,
    isInstallable: installable(),
    ...opts,
  });

await check("latest channel on the newest stable has nothing newer", async () => {
  const choice = await pick({ current: "1.10.1" });
  assert.equal(choice.kind, "nothing-newer");
});

await check("beta channel on the newest beta has nothing newer, and a draft does not count", async () => {
  const choice = await pick({ current: "1.11.0-beta.1", wantPrerelease: true });
  assert.equal(choice.kind, "nothing-newer");
});

await check("the reported case: beta.1 on the beta channel, with newer stables filtered by version", async () => {
  const only = [release("v1.10.0-beta.1"), release("v1.9.4")];
  const choice = await chooseFeedRelease(only, {
    current: "1.10.0-beta.1",
    wantPrerelease: true,
    variantSwitchPending: false,
    isInstallable: installable(),
  });
  assert.equal(choice.kind, "nothing-newer");
});

await check("a newer release is pinned on either channel", async () => {
  const stable = await pick({ current: "1.10.0" });
  assert.equal(stable.kind, "pinned");
  assert.equal(stable.release.tag_name, "v1.10.1");

  const beta = await pick({ current: "1.10.1", wantPrerelease: true });
  assert.equal(beta.kind, "pinned");
  assert.equal(beta.release.tag_name, "v1.11.0-beta.1");
});

await check("a newer release without its files is skipped for the next one down", async () => {
  const choice = await pick({ current: "1.9.4", isInstallable: installable(["v1.10.1"]) });
  assert.equal(choice.kind, "pinned");
  assert.equal(choice.release.tag_name, "v1.10.0");
  assert.deepEqual(choice.skipped, ["1.10.1"]);
});

await check("newer releases that are all missing a slim yml pin nothing", async () => {
  const choice = await pick({
    current: "1.10.0",
    isInstallable: installable(["v1.10.1"]),
  });
  assert.equal(choice.kind, "none-installable");
  assert.deepEqual(choice.skipped, ["1.10.1"]);
});

await check("a pending variant switch on the newest version still pins that version", async () => {
  const choice = await pick({ current: "1.10.1", variantSwitchPending: true });
  assert.equal(choice.kind, "pinned");
  assert.equal(choice.release.tag_name, "v1.10.1");
});

await check("leaving beta pins the newest stable, though it is older", async () => {
  const choice = await pick({ current: "1.11.0-beta.1" });
  assert.equal(choice.kind, "pinned");
  assert.equal(choice.release.tag_name, "v1.10.1");
});

/* ── When the release list does not come back (GRYT-1170) ───────────── */

const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);
const utcClock = (at) => new Date(at).toISOString().slice(11, 16);
const couldNot = "Couldn't check GitHub for updates right now.";

/* What api.github.com sends: a 403 or a 429 once the hour's 60 are spent, retry-after
   for the secondary limit, and a thrown fetch for a timeout or no network. */
const lookupFailures = {
  "a 403 with the hour's requests spent": {
    request: async () =>
      new Response('{"message":"API rate limit exceeded"}', {
        status: 403,
        headers: {
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(NOW / 1000 + 25 * 60 + 10),
        },
      }),
    status: 403,
    message: `${couldNot} Try again after 12:26.`,
  },
  "a 429 with retry-after": {
    request: async () =>
      new Response("", { status: 429, headers: { "retry-after": "120" } }),
    status: 429,
    message: `${couldNot} Try again after 12:02.`,
  },
  "a network failure": {
    request: async () => {
      throw new TypeError("fetch failed");
    },
    status: undefined,
    message: `${couldNot} Try again in a few minutes.`,
  },
};

/* main.ts builds these from isOnBetaChannel() and channelYmlName(). */
const channels = {
  latest: { current: "1.10.0", wantPrerelease: false },
  beta: { current: "1.10.0", wantPrerelease: true },
};
const variants = { full: "latest-mac.yml", slim: "slim-mac.yml" };

const listed = [
  { ...release("v1.11.0-beta.1"), assets: ["latest-mac.yml"] },
  { ...release("v1.10.2"), assets: ["latest-mac.yml"] },
  { ...release("v1.10.1"), assets: ["latest-mac.yml", "slim-mac.yml"] },
];

const find = (request, channel, yml, consulted = []) =>
  findFeedRelease(request, {
    ...channel,
    variantSwitchPending: false,
    isInstallable: async (r) => {
      consulted.push(r.tag_name);
      return r.assets.includes(yml);
    },
    now: () => NOW,
  });

for (const [failureName, failure] of Object.entries(lookupFailures)) {
  for (const [channelName, channel] of Object.entries(channels)) {
    for (const [variantName, yml] of Object.entries(variants)) {
      await check(`${failureName} on ${channelName}, ${variantName}: a failed lookup that says so`, async () => {
        const consulted = [];
        const choice = await find(failure.request, channel, yml, consulted);

        assert.equal(choice.kind, "lookup-failed");
        assert.equal(choice.status, failure.status);
        assert.deepEqual(consulted, [], "a failed lookup must not reach the asset check");
        assert.equal(lookupFailedMessage(choice, NOW, utcClock), failure.message);
      });
    }
  }
}

await check("the same harness with the list served pins by channel and variant", async () => {
  const served = async () => Response.json(listed);
  const pinned = {};

  for (const [channelName, channel] of Object.entries(channels)) {
    for (const [variantName, yml] of Object.entries(variants)) {
      const choice = await find(served, channel, yml);
      assert.equal(choice.kind, "pinned", `${channelName}, ${variantName}`);
      pinned[`${channelName}, ${variantName}`] = choice.release.tag_name;
    }
  }

  assert.deepEqual(pinned, {
    "latest, full": "v1.10.2",
    "latest, slim": "v1.10.1",
    "beta, full": "v1.11.0-beta.1",
    "beta, slim": "v1.10.1",
  });
});

await check("a 200 whose body is not a list is a failed lookup too", async () => {
  for (const body of ['{"message":"Not Found"}', "<html>", ""]) {
    const choice = await find(async () => new Response(body), channels.beta, variants.full);
    assert.equal(choice.kind, "lookup-failed", JSON.stringify(body));
  }
});

await check("a 403 that is not the rate limit names no time", async () => {
  const request = async () =>
    new Response("", {
      status: 403,
      headers: { "x-ratelimit-remaining": "59", "x-ratelimit-reset": String(NOW / 1000 + 600) },
    });
  const choice = await find(request, channels.latest, variants.slim);

  assert.equal(choice.kind, "lookup-failed");
  assert.equal(choice.retryAt, undefined);
  assert.equal(lookupFailedMessage(choice, NOW, utcClock), `${couldNot} Try again in a few minutes.`);
});

await check("the later of retry-after and x-ratelimit-reset wins", () => {
  const both = (retryAfter, resetInSeconds) =>
    rateLimitResetAt(
      new Headers({
        "retry-after": String(retryAfter),
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(NOW / 1000 + resetInSeconds),
      }),
      NOW,
    );

  assert.equal(both(60, 600), NOW + 600_000);
  assert.equal(both(900, 600), NOW + 900_000);
  assert.equal(rateLimitResetAt(new Headers({ "retry-after": "soon" }), NOW), undefined);
});

await check("a reset time already past names no time", () => {
  const message = lookupFailedMessage({ kind: "lookup-failed", status: 403, retryAt: NOW - 1000 }, NOW, utcClock);
  assert.equal(message, `${couldNot} Try again in a few minutes.`);
});

await check("the clock time is hours and minutes, and survives a locale tag ICU rejects", () => {
  const at = Date.UTC(2026, 8, 15, 9, 5);
  assert.match(clockTime(at, "nb"), /^\d{1,2}:05$/);
  assert.match(clockTime(at, "en-US"), /^\d{1,2}:05\s(AM|PM)$/);

  for (const locale of ["", "C.UTF-8", "en_US"]) {
    assert.match(clockTime(at, locale), /^\d{1,2}:05(\s(AM|PM))?$/, JSON.stringify(locale));
  }
});

/* ── The wiring in main.ts ──────────────────────────────────────────── */

const main = readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");

function bodyOf(marker) {
  const start = main.indexOf(marker);
  assert.notEqual(start, -1, `${marker} is gone`);
  return main.slice(start, main.indexOf("\n}\n", start));
}

await check("the pin passes everything the choice depends on", () => {
  const pin = bodyOf("async function pinFeedToNewestCompleteRelease(");
  assert.match(pin, /findFeedRelease<GhRelease>\(\s*\(\) =>\s*requestWithTimeout\(\s*`https:\/\/api\.github\.com\//);
  assert.match(pin, /wantPrerelease: isOnBetaChannel\(\)/);
  assert.match(pin, /variantSwitchPending: variantSwitchPending\(\)/);
  assert.match(pin, /isInstallable: releaseIsInstallable/);
  assert.match(pin, /if \(choice\.kind !== "pinned"\) \{[\s\S]{0,120}return \{ kind: "nothing-to-install" \};/);
});

await check("a failed lookup leaves the pin before any feed is set", () => {
  const pin = bodyOf("async function pinFeedToNewestCompleteRelease(");
  const failed = pin.match(/if \(choice\.kind === "lookup-failed"\) \{[\s\S]{0,400}?return choice;\s*\}/);
  assert.ok(failed, "the lookup-failed branch has to return what it found");
  assert.ok(failed.index < pin.indexOf("setFeedURL("), "the failure has to return before the feed is pinned");
});

await check("the list request keeps the status that says why", () => {
  const request = bodyOf("function requestWithTimeout(");
  assert.doesNotMatch(request, /\.ok\b|null|catch/);
});

await check("a throw while pinning is a failed lookup, on both paths", () => {
  assert.match(bodyOf("function pinFailed("), /return \{ kind: "lookup-failed" \};/);
  assert.equal(main.match(/pinFeedToNewestCompleteRelease\(\)\s*\.catch\(pinFailed\)/g)?.length, 2);
});

await check("a pressed check answers every unpinned result and only checks a pinned feed", () => {
  const start = main.indexOf('"check-for-updates",');
  assert.notEqual(start, -1, "the check-for-updates handler is gone");
  const handler = main.slice(start, main.indexOf('"download-update"', start));

  const guard = handler.match(/if \(pin\.kind !== "pinned"\) \{([\s\S]*?)\n\s*return;\s*\}\s*autoUpdater\s*\.checkForUpdates\(\)/);
  assert.ok(guard, "an unpinned result has to return before the check");

  const unpinned = guard[1];
  assert.match(unpinned, /^\s*resumeAutoDownload\(\);/);
  assert.match(unpinned, /if \(pin\.kind === "nothing-to-install"\) \{\s*sendToMain\("not-available"/);
  assert.match(unpinned, /\} else \{\s*sendToMain\("error", \{\s*message: lookupFailedMessage\(pin, Date\.now\(\), \(at\) =>\s*clockTime\(at, app\.getLocale\(\)\)/);
  assert.equal(handler.match(/\.checkForUpdates\(\)/g)?.length, 1);
});

await check("an error from the pinned feed itself still shows", () => {
  const start = main.indexOf('"check-for-updates",');
  const handler = main.slice(start, main.indexOf('"download-update"', start));
  const afterCheck = handler.slice(handler.indexOf(".checkForUpdates()"));

  assert.match(afterCheck, /\.catch\(\(err\) => \{[\s\S]*isReleaseNotReadyYet\([\s\S]*sendToMain\(\s*"error",\s*\{\s*message:\s*friendlyUpdateError\(/);
});

await check("the hidden launch only checks a pinned feed", () => {
  const start = main.indexOf("initBackgroundUpdater(true);");
  const launch = main.slice(start, main.indexOf("} else {", start));
  assert.match(launch, /if \(pin\.kind !== "pinned"\) return;\s*autoUpdater\s*\.checkForUpdates\(\)/);
});

await check("the settings panel reads not-available as up to date and shows an error's message", () => {
  const about = readFileSync(
    new URL("../src/packages/settings/src/components/aboutSettings.tsx", import.meta.url),
    "utf8",
  );
  assert.match(about, /case "not-available":\s*return "Gryt is up to date";/);
  assert.match(about, /case "error":\s*return `Update error: \$\{status\.message\}`;/);
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}

console.log("\nupdate feed pin checks passed");
