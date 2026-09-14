/* eslint-env node */

// Going from 1.11.9 to 1.11.11 showed 1.11.11 and never 1.11.10. The selection runs
// here as itself, and the dialog and the effect are checked for using it. GRYT-1160.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SINCE = "src/components/whatsNewSince.ts";
const WHATS_NEW = "src/components/whatsNew.tsx";
const DIALOG = "src/packages/socket/src/components/WhatsNewDialog.tsx";

const { compareVersions, releasesToShow, MAX_RELEASES } = await import(pathToFileURL(join(root, SINCE)).href);
const whatsNew = readFileSync(join(root, WHATS_NEW), "utf8");
const dialog = readFileSync(join(root, DIALOG), "utf8");

const rel = (version, extra = {}) => ({ version, date: "2026-09-14", line: `Line for ${version}.`, ...extra });
const versions = (picked) => picked.releases.map((r) => r.version);

/* ── semver order ────────────────────────────────────────────────────────── */
{
  const lt = (a, b) => assert.ok(compareVersions(a, b) < 0 && compareVersions(b, a) > 0, `${a} should sort below ${b}`);
  lt("1.11.9", "1.11.10");
  lt("1.9.24", "1.10.0");
  lt("1.11.99", "1.12.0");
  lt("1.12.0-beta.1", "1.12.0");
  lt("1.12.0-beta.1", "1.12.0-beta.2");
  lt("1.12.0-beta.9", "1.12.0-beta.10");
  lt("1.11.11", "1.12.0-beta.1");
  lt("1.12.0-beta", "1.12.0-beta.1");
  lt("1.12.0-1", "1.12.0-beta");
  assert.equal(compareVersions("1.11.11", "1.11.11"), 0, "a version does not equal itself");
  assert.ok(Number.isNaN(compareVersions("latest", "1.11.11")), "a version that is not semver compared as a number");
}

const APP = ["1.11.11", "1.11.10", "1.11.9", "1.11.8"].map((v) => rel(v));

/* ── the range ───────────────────────────────────────────────────────────── */

// Newer than seen, up to and including running, newest first.
{
  const p = releasesToShow(APP, "1.11.9", "1.11.11", false);
  assert.deepEqual(versions(p), ["1.11.11", "1.11.10"], "the releases between seen and running were not all shown");
  assert.equal(p.since, "1.11.9", "several releases do not say what they are since");
  assert.equal(p.capped, false);
}

// Newest first whatever order the site sends them in.
{
  const shuffled = [APP[2], APP[0], APP[3], APP[1]];
  const p = releasesToShow(shuffled, "1.11.8", "1.11.11", false);
  assert.deepEqual(versions(p), ["1.11.11", "1.11.10", "1.11.9"], "the releases are not newest first");
}

// Compared as versions, not strings: "1.11.10" < "1.11.9" as text.
{
  const p = releasesToShow(APP, "1.11.9", "1.11.10", false);
  assert.deepEqual(versions(p), ["1.11.10"], "1.11.10 was compared as text and sorted below 1.11.9");
  assert.equal(p.since, null, "one release was drawn as a range");
}

// Nothing newer than running, even when the site already has it.
{
  const p = releasesToShow(APP, "1.11.8", "1.11.10", false);
  assert.deepEqual(versions(p), ["1.11.10", "1.11.9"], "a release newer than the running one was shown");
}

/* ── the fallbacks to the running version ────────────────────────────────── */

// Nothing recorded on an install that has joined something (GRYT-1101).
assert.deepEqual(versions(releasesToShow(APP, null, "1.11.11", false)), ["1.11.11"], "seen null did not show just running");

// Already seen, which is what About asks with.
assert.deepEqual(versions(releasesToShow(APP, "1.11.11", "1.11.11", false)), ["1.11.11"], "the seen version showed nothing");

// A downgrade shows the running line and none of the newer ones.
{
  const p = releasesToShow(APP, "1.11.11", "1.11.9", false);
  assert.deepEqual(versions(p), ["1.11.9"], "a downgrade showed releases the install no longer has");
  assert.equal(p.since, null);
}

// Something that is not a version in the store.
assert.deepEqual(versions(releasesToShow(APP, "nonsense", "1.11.11", false)), ["1.11.11"], "a garbage seen value broke the range");

// No line for running yet: nothing, so the caller retries rather than showing older lines.
assert.deepEqual(versions(releasesToShow(APP.slice(1), "1.11.8", "1.11.11", false)), [], "older lines shown with no line for running");

/* ── channels ────────────────────────────────────────────────────────────── */
{
  const app = [
    rel("1.12.0"),
    rel("1.12.0-beta.2", { channel: "beta" }),
    rel("1.12.0-beta.1", { channel: "beta" }),
    rel("1.11.11"),
  ];

  const stable = releasesToShow(app, "1.11.10", "1.12.0", false);
  assert.deepEqual(versions(stable), ["1.12.0", "1.11.11"], "a stable build was shown beta lines");

  const beta = releasesToShow(app, "1.11.10", "1.12.0-beta.2", true);
  assert.deepEqual(
    versions(beta),
    ["1.12.0-beta.2", "1.12.0-beta.1", "1.11.11"],
    "a beta build missed the beta lines, or saw the release above it",
  );

  // Off the beta channel onto the release: the release, not the betas again.
  const moved = releasesToShow(app, "1.12.0-beta.1", "1.12.0", false);
  assert.deepEqual(versions(moved), ["1.12.0"], "moving from beta to stable reshowed beta lines");
}

/* ── the cap ─────────────────────────────────────────────────────────────── */
{
  const many = Array.from({ length: MAX_RELEASES + 5 }, (_, i) => rel(`1.10.${i}`));
  const p = releasesToShow(many, "1.9.0", `1.10.${MAX_RELEASES + 4}`, false);
  assert.ok(MAX_RELEASES >= 3 && MAX_RELEASES <= 20, `a cap of ${MAX_RELEASES} is not a sensible number of releases`);
  assert.equal(p.releases.length, MAX_RELEASES, "more releases were drawn than the cap");
  assert.equal(p.releases[0].version, `1.10.${MAX_RELEASES + 4}`, "the cap cut the running version rather than the oldest");
  assert.equal(p.capped, true, "a capped list does not say so, so the link does not point at the full changelog");

  const exact = releasesToShow(many.slice(0, MAX_RELEASES), "1.9.0", `1.10.${MAX_RELEASES - 1}`, false);
  assert.equal(exact.capped, false, "exactly the cap reads as capped");
}

/* ── the effect uses it ──────────────────────────────────────────────────── */
{
  const effect = whatsNew.slice(whatsNew.indexOf("onUserStoreLoaded(setStoreUser)"));
  assert.match(
    effect,
    /releasesToShow\(app, asked \? null : seen, version, IS_BETA_BUILD\)/,
    `${WHATS_NEW} does not pick the releases with releasesToShow, or About no longer asks for the running one alone`,
  );
  assert.match(effect, /if \(!picked\.releases\.length\) return;/, `${WHATS_NEW} opens a dialog with nothing in it`);
}

/* ── the dialog draws a list ─────────────────────────────────────────────── */
{
  assert.match(dialog, /releases: WhatsNewRelease\[\];/, `${DIALOG} takes one release rather than a list`);
  assert.match(
    dialog,
    /releases\.map\(\(release\) => \(\s*<section key=\{release\.version\}/,
    `${DIALOG} does not draw each release`,
  );
  assert.match(dialog, /<h3 className="whats-new-version">\s*\{release\.version\} · \{readableDate\(release\.date\)\}/, `${DIALOG} releases have no heading`);
  assert.match(dialog, /What&rsquo;s new since \{since\}/, `${DIALOG} does not say it covers several releases`);
  assert.match(dialog, /Here&rsquo;s what&rsquo;s new in Gryt Chat/, `${DIALOG} lost the single-release greeting`);
  assert.match(dialog, /several \? "https:\/\/gryt\.chat\/changelog" :/, `${DIALOG} does not link several releases to the full changelog`);
  assert.equal((dialog.match(/<Dialog\.Close/g) ?? []).length, 1, `${DIALOG} should have exactly one way to close`);
}

console.log(
  `what's new since: ok, semver order, betas below releases and only on beta, newest first, capped at ${MAX_RELEASES}, dialog draws a list`,
);
