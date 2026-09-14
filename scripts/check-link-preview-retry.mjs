/* eslint-env node */

// A failed link preview: a 429 waits and asks again, a 5xx or a dropped connection gets
// two more tries, and only the other 4xx refuse the URL for the session.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const retry = await import("../src/packages/socket/src/components/linkPreviewRetry.ts");
const { nextPreviewStep, retryAfterHint, RATE_LIMIT_CAP_MS, RATE_LIMIT_FLOOR_MS, RATE_LIMIT_MAX_ATTEMPTS, JITTER_SHARE } = retry;

const NOW = Date.parse("2026-09-14T12:00:00Z");
const noJitter = () => 0;
const fullJitter = () => 1;
const step = (failure, attempt, random = noJitter) => nextPreviewStep(failure, attempt, random, NOW);
const limited = (extra = {}) => ({ kind: "status", status: 429, ...extra });

/* ── 429 waits, and is never a refusal ──────────────────────────────────── */
{
  assert.deepEqual(
    step(limited({ retryAfter: "30" }), 0),
    { action: "retry", delayMs: 30_000 },
    "a 429 with Retry-After: 30 does not wait 30 seconds",
  );
  assert.deepEqual(
    step(limited({ retryAfter: null, retryAfterMs: 42_000 }), 0),
    { action: "retry", delayMs: 42_000 },
    "without a readable Retry-After the body's retryAfterMs is ignored",
  );
  assert.deepEqual(
    step(limited({ retryAfter: "7", retryAfterMs: 42_000 }), 0),
    { action: "retry", delayMs: 7_000 },
    "the body's retryAfterMs wins over a readable Retry-After header",
  );
  assert.deepEqual(
    step(limited({ retryAfter: new Date(NOW + 20_000).toUTCString() }), 0),
    { action: "retry", delayMs: 20_000 },
    "a Retry-After given as a date is not understood",
  );
  assert.deepEqual(
    step(limited(), 0),
    { action: "retry", delayMs: RATE_LIMIT_FLOOR_MS },
    "a 429 that says nothing about when retries on the next tick",
  );
  assert.deepEqual(
    step(limited({ retryAfter: "1", retryAfterMs: 0 }), 0),
    { action: "retry", delayMs: RATE_LIMIT_FLOOR_MS },
    "the ban's Retry-After: 1 has the card hammering a banned endpoint every second",
  );
  assert.ok(
    step(limited(), 2).delayMs > step(limited(), 1).delayMs && step(limited(), 1).delayMs > step(limited(), 0).delayMs,
    "repeated 429s with no hint do not back off",
  );
  for (const bad of ["soon", "-5", ""]) {
    assert.equal(retryAfterHint(bad, undefined, NOW), null, `Retry-After ${JSON.stringify(bad)} was read as a wait`);
  }
  assert.equal(retryAfterHint(null, "42000", NOW), null, "a string retryAfterMs was read as a wait");
  assert.equal(retryAfterHint(null, -1, NOW), null, "a negative retryAfterMs was read as a wait");
}

/* ── the cap, and jitter on top of it ───────────────────────────────────── */
{
  assert.deepEqual(
    step(limited({ retryAfter: "3600" }), 0),
    { action: "retry", delayMs: RATE_LIMIT_CAP_MS },
    "an hour-long Retry-After is not capped",
  );
  assert.equal(step(limited(), 6).delayMs, RATE_LIMIT_CAP_MS, "the growing floor runs past the cap");
  assert.equal(
    step(limited({ retryAfter: "3600" }), 0, fullJitter).delayMs,
    Math.round(RATE_LIMIT_CAP_MS * (1 + JITTER_SHARE)),
    "jitter is unbounded, or missing at the cap",
  );
  const spread = new Set([0, 0.3, 0.7, 0.99].map((r) => step(limited({ retryAfter: "30" }), 0, () => r).delayMs));
  assert.equal(spread.size, 4, "cards limited together all retry on the same tick");
  for (const r of [0, 0.5, 0.99]) {
    const { delayMs } = step(limited({ retryAfter: "30" }), 0, () => r);
    assert.ok(delayMs >= 30_000, `jitter shortened the wait the server asked for: ${delayMs}`);
  }
}

/* ── 5xx and network errors: two more tries, then give up ───────────────── */
{
  for (const failure of [{ kind: "status", status: 502 }, { kind: "status", status: 500 }, { kind: "network" }]) {
    const label = failure.kind === "network" ? "a network error" : `a ${failure.status}`;
    assert.deepEqual(step(failure, 0), { action: "retry", delayMs: 2_000 }, `${label} does not retry after ~2s`);
    assert.deepEqual(step(failure, 1), { action: "retry", delayMs: 8_000 }, `${label} does not retry after ~8s the second time`);
    assert.deepEqual(step(failure, 2), { action: "give-up" }, `${label} keeps retrying past the third try`);
    assert.ok(step(failure, 0, fullJitter).delayMs > 2_000, `${label} retries with no jitter`);
  }
}

/* ── the other 4xx are a verdict ────────────────────────────────────────── */
{
  for (const status of [400, 401, 403, 404, 410, 422]) {
    assert.deepEqual(step({ kind: "status", status }, 0), { action: "refuse" }, `a ${status} is not a refusal`);
  }
}

/* ── attempts run out ───────────────────────────────────────────────────── */
{
  assert.equal(step(limited(), RATE_LIMIT_MAX_ATTEMPTS - 2).action, "retry", "429 gives up an attempt early");
  assert.deepEqual(step(limited(), RATE_LIMIT_MAX_ATTEMPTS - 1), { action: "give-up" }, "429 retries forever");
  assert.notEqual(step(limited(), RATE_LIMIT_MAX_ATTEMPTS + 5).action, "refuse", "a 429 that ran out refuses the URL for the session");
}

/* ── the card goes through the module ───────────────────────────────────── */
{
  const card = readFileSync(join(root, "src/packages/socket/src/components/LinkPreviewCard.tsx"), "utf8");
  const start = card.indexOf("if (previewRefused.has(url)) { setFailed(true); return; }");
  const end = card.indexOf("}, [url, serverHost, data]);");
  assert.ok(start !== -1 && end > start, "the fetch effect in LinkPreviewCard moved; update this check");
  const effect = card.slice(start, end);

  assert.ok(/nextPreviewStep\(failure, attempt\)/.test(effect), "the card decides retries itself instead of asking nextPreviewStep");
  assert.ok(!/status\s*(>=|<)\s*(400|500)/.test(effect), "the card still sorts statuses itself, which is how a 429 got refused");
  assert.equal(effect.match(/previewRefused\.add\(/g)?.length, 1, "the card adds to previewRefused somewhere other than the refuse step");
  assert.ok(
    /if \(step\.action === "refuse"\) previewRefused\.add\(url\);/.test(effect),
    "previewRefused is filled on something other than a refusal",
  );
  assert.ok(
    /if \(step\.action === "retry"\) \{\s*timer = setTimeout\(/.test(effect),
    "a retry does not wait, or does not keep its timer to clear",
  );
  assert.ok(/retryAfterMs: \(body as/.test(effect) && /res\.headers\.get\("Retry-After"\)/.test(effect), "the card does not pass the server's wait along");
  assert.ok(/clearTimeout\(timer\)/.test(effect) && /cancelled = true/.test(effect), "unmounting leaves a retry timer running");

  const settle = effect.slice(effect.indexOf("const settle"), effect.indexOf("const request"));
  assert.ok(
    /if \(step\.action === "retry"\) \{\s*timer = setTimeout\([^\n]*\n\s*return;\s*\}/.test(settle)
      && settle.indexOf("setFailed(true)") > settle.indexOf("return;"),
    "the card hides itself while a retry is pending, so it vanishes and pops back",
  );
}

/* ── XEmbed's oembed fetch goes through it too ──────────────────────────── */
{
  const embeds = readFileSync(join(root, "src/packages/socket/src/components/EmbedRenderers.tsx"), "utf8");
  const x = embeds.slice(embeds.indexOf("export const XEmbed"));
  const start = x.indexOf("if (html || failed) return;");
  const end = x.indexOf("}, [url, serverHost, html, failed, resolvedAppearance]);");
  assert.ok(start !== -1 && end > start, "the fetch effect in XEmbed moved; update this check");
  const effect = x.slice(start, end);

  assert.ok(/\/api\/oembed\?/.test(effect), "the XEmbed block no longer holds the oembed fetch");
  assert.ok(/nextPreviewStep\(failure, attempt\)/.test(effect), "XEmbed hides on any failure instead of asking nextPreviewStep");
  assert.ok(!/r\.ok \? r\.json\(\) : Promise\.reject/.test(effect), "XEmbed still turns every non-ok answer into a failure");
  assert.ok(!/status\s*(>=|<|===)\s*(400|500)/.test(effect), "XEmbed sorts statuses itself instead of asking the module");
  assert.ok(/settle\(attempt, \{ kind: "network" \}\)/.test(effect), "a dropped connection in XEmbed skips the module");
  const settle = effect.slice(effect.indexOf("const settle"), effect.indexOf("const request"));
  assert.ok(
    /if \(step\.action === "retry"\) \{\s*timer = setTimeout\([^\n]*\n\s*return;\s*\}/.test(settle)
      && settle.indexOf("setFailed(true)") > settle.indexOf("return;"),
    "XEmbed hides its skeleton while a retry is pending",
  );
  assert.ok(/retryAfterMs: \(body as/.test(effect) && /res\.headers\.get\("Retry-After"\)/.test(effect), "XEmbed does not pass the server's wait along");
  assert.ok(/clearTimeout\(timer\)/.test(effect) && /cancelled = true/.test(effect), "unmounting XEmbed leaves a retry timer running");
}

console.log("link preview retry: ok, a 429 waits and a 502 tries again, for link cards and X embeds");
