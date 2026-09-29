#!/usr/bin/env node
/**
 * The words on somebody's game card. The fields come from a game on another
 * person's machine, so the links are checked again here before they're drawn.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buttonLink, cardHeading, elapsed, gameIconUrl, partyText } from "../src/packages/socket/src/lib/gameCard.ts";

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

console.log("game card");

check("the heading follows the activity type", () => {
  assert.equal(cardHeading({ type: "playing", name: "x" }), "Playing");
  assert.equal(cardHeading({ type: "listening", name: "x" }), "Listening to");
  assert.equal(cardHeading({ type: "watching", name: "x" }), "Watching");
  assert.equal(cardHeading({ type: "competing", name: "x" }), "Competing in");
  assert.equal(cardHeading({ type: "streaming", name: "x" }), "Playing");
});

check("the timer counts up in minutes and seconds, then hours", () => {
  const now = 10_000_000;
  assert.equal(elapsed(now - 86_000, now), "1:26");
  assert.equal(elapsed(now - 5_000, now), "0:05");
  assert.equal(elapsed(now - (3600 + 62) * 1000, now), "1:01:02");
});

check("no timer without a start, or with one in the future", () => {
  assert.equal(elapsed(undefined, 1000), null);
  assert.equal(elapsed(2000, 1000), null);
  assert.equal(elapsed(NaN, 1000), null);
});

check("party size reads as a count", () => {
  assert.equal(partyText({ size: 2, max: 5 }), "2 of 5");
  assert.equal(partyText({ size: 3 }), "3 in party");
  assert.equal(partyText(undefined), null);
});

check("a button shows where it goes", () => {
  assert.deepEqual(buttonLink("https://www.example.com/join?x=1"), { href: "https://www.example.com/join?x=1", host: "example.com" });
});

check("a button that isn't a plain web link is not drawn", () => {
  for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "gryt://invite/x", "steam://run/1", "https://gryt.chat@evil.example/", "nonsense"]) {
    assert.equal(buttonLink(bad), null, bad);
  }
});

check("the member card only draws the card for somebody who's here", () => {
  const source = readFileSync(new URL("../src/packages/socket/src/components/MemberIdentityCard.tsx", import.meta.url), "utf8");
  assert.match(source, /game=\{offline \? null : member\.richActivity\}/);
});

check("the icon URL is the mirrored repo, never Discord's CDN", () => {
  assert.equal(gameIconUrl("1137125502985961543"), "https://cdn.jsdelivr.net/gh/Gryt-chat/rich-presence@main/icons/1137125502985961543.avif");
});

check("no URL without a usable id", () => {
  for (const bad of [undefined, "", "not-digits", "1".repeat(33)]) assert.equal(gameIconUrl(bad), null, JSON.stringify(bad));
});

console.log(failures === 0 ? "\ngame card: ok" : `\ngame card: ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
