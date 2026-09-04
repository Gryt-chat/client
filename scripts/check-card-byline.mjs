/* eslint-env node */

/**
 * The attribution line under a link card (GRYT-913).
 *
 * The server has carried `author` and `publishedAt` since the card existed and
 * nothing drew either. Drawing them is easy; the part worth a test is what
 * happens when they are not there, because `article:published_time` is free
 * text as far as this app is concerned. Pages ship empty strings, Unix epochs
 * out of a broken template, and dates a century out, and every one of those has
 * to come back as a line that is not drawn rather than "Invalid Date".
 *
 * Run against the real module rather than a copy — Node strips the types on
 * import, which is why this lives in .mjs and the source stays .ts.
 */

import assert from "node:assert/strict";

import { cardByline } from "../src/packages/socket/src/components/embedUtils.ts";

/* Fixed, so a date near a year boundary cannot make this pass on one day and
   fail on another. */
const NOW = new Date("2026-09-04T12:00:00Z");

const on = (author, published) => cardByline(author, published, NOW);

/* ── both halves ─────────────────────────────────────────────────────────── */

const both = on("Mr. Anderson", "2025-07-26T19:24:08Z");
assert.ok(both?.startsWith("Mr. Anderson · "), `unexpected byline: ${both}`);
assert.ok(both.includes("2025"), `the year should be in it: ${both}`);

/* ── one half ────────────────────────────────────────────────────────────── */

assert.equal(on("Mr. Anderson", null), "Mr. Anderson");
assert.ok(!on(null, "2025-07-26T19:24:08Z")?.includes("·"), "a lone date needs no separator");
assert.ok(on(null, "2025-07-26T19:24:08Z")?.includes("2025"));

/* ── neither, which is most of the web ───────────────────────────────────── */

for (const [author, published] of [
  [null, null],
  [undefined, undefined],
  ["", ""],
  ["   ", "   "],
]) {
  assert.equal(on(author, published), null, `expected no line for ${JSON.stringify([author, published])}`);
}

/*
 * ── a date that is not one ───────────────────────────────────────────────
 *
 * Each of these is something a real page has put in `article:published_time`.
 * The line still draws when there is an author; what must never appear is the
 * date half.
 */
for (const bad of [
  "not a date",
  "0000-00-00",
  "1970-01-01T00:00:00Z", // a template that filled in the epoch
  "1899-01-01",
  "2199-01-01", // and one that filled in nothing useful either
  "",
  "   ",
]) {
  assert.equal(on(null, bad), null, `a bad date alone should draw nothing: ${bad}`);
  assert.equal(
    on("Someone", bad),
    "Someone",
    `a bad date should not reach the card beside an author: ${bad}`,
  );
}

/* Next year is allowed — an embargoed post dated ahead is a real thing, and a
   card refusing to show it would be the odd one out. The century is not. */
assert.ok(on(null, "2027-01-01")?.includes("2027"));
assert.equal(on(null, "2099-01-01"), null);

/* ── whitespace is not an author ─────────────────────────────────────────── */

assert.equal(on("  Mr. Anderson  ", null), "Mr. Anderson");

console.log("check-card-byline: ok");
