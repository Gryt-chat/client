#!/usr/bin/env node
/**
 * What a pressed Check for Updates points the updater at. Nothing newer has to
 * read as up to date, not as an error from a provider we never meant to use (GRYT-1050).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chooseFeedRelease } from "../electron/updateFeedPin.ts";

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

/* ── The wiring in main.ts ──────────────────────────────────────────── */

const main = readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");

function bodyOf(marker) {
  const start = main.indexOf(marker);
  assert.notEqual(start, -1, `${marker} is gone`);
  return main.slice(start, main.indexOf("\n}\n", start));
}

await check("the pin passes everything the choice depends on", () => {
  const pin = bodyOf("async function pinFeedToNewestCompleteRelease(");
  assert.match(pin, /chooseFeedRelease\(releases, \{/);
  assert.match(pin, /wantPrerelease: isOnBetaChannel\(\)/);
  assert.match(pin, /variantSwitchPending: variantSwitchPending\(\)/);
  assert.match(pin, /isInstallable: releaseIsInstallable/);
  assert.match(pin, /if \(choice\.kind !== "pinned"\) \{[\s\S]{0,120}return "nothing-to-install";/);
});

await check("a failed fetch still falls through to a real check, so its error shows", () => {
  const pin = bodyOf("async function pinFeedToNewestCompleteRelease(");
  assert.equal(pin.match(/return "unknown";/g)?.length, 3);
});

await check("a pressed check with nothing to install says up to date without checking", () => {
  const start = main.indexOf('"check-for-updates",');
  assert.notEqual(start, -1, "the check-for-updates handler is gone");
  const handler = main.slice(start, main.indexOf('"download-update"', start));

  assert.match(
    handler,
    /if \(pin === "nothing-to-install"\) \{\s*resumeAutoDownload\(\);\s*sendToMain\("not-available"[\s\S]{0,160}return;\s*\}/,
  );
  assert.ok(
    handler.indexOf('pin === "nothing-to-install"') < handler.indexOf(".checkForUpdates()"),
    "the up-to-date answer has to come before the check",
  );
  assert.match(handler, /sendToMain\(\s*"error"/);
});

await check("the hidden launch does not run a check with nothing to install", () => {
  const start = main.indexOf("initBackgroundUpdater(true);");
  const launch = main.slice(start, main.indexOf("} else {", start));
  assert.match(launch, /if \(pin === "nothing-to-install"\) return;\s*autoUpdater\s*\.checkForUpdates\(\)/);
});

await check("the settings panel reads not-available as up to date", () => {
  const about = readFileSync(
    new URL("../src/packages/settings/src/components/aboutSettings.tsx", import.meta.url),
    "utf8",
  );
  assert.match(about, /case "not-available":\s*return "Gryt is up to date";/);
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}

console.log("\nupdate feed pin checks passed");
