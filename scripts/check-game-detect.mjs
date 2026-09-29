#!/usr/bin/env node
/**
 * Known games spotted by their program (GRYT-1636). Nothing shows before a yes,
 * and a game that reports for itself always wins over "it's running".
 */

import assert from "node:assert/strict";

import { buildProgramIndex, createGameDetector, readAnswers, readExecutablesList, runningApps } from "../electron/gameDetector.ts";
import { createPresenceBoard } from "../electron/richPresence.ts";

let failures = 0;
async function check(name, run) {
  try {
    await run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.stack ?? err.message}`);
  }
}

console.log("game detection");

const CS2 = "1158877933042143272";
const list = readExecutablesList([
  { id: CS2, programs: { win32: ["win64/cs2.exe"] } },
  { id: "111111111111111111", programs: { win32: ["bin/game.exe"], linux: ["shared"] } },
  { id: "222222222222222222", programs: { win32: ["x/shared.exe"], linux: ["shared"] } },
  { id: "bad", programs: { win32: ["x.exe"] } },
  { id: "333333333333333333", programs: "nope" },
]);

await check("the list keeps only well-formed entries", () => {
  assert.deepEqual(list.map((e) => e.id), [CS2, "111111111111111111", "222222222222222222"]);
});

await check("a program name matches whatever path and case it runs from", () => {
  const index = buildProgramIndex(list, "win32");
  assert.deepEqual(runningApps(["C:\\Steam\\game\\bin\\win64\\CS2.EXE", "explorer.exe"], index), [CS2]);
});

await check("a generic name like game.exe never matches", () => {
  const index = buildProgramIndex(list, "win32");
  assert.equal(index.has("game"), false);
});

await check("a name two games share is dropped rather than guessed", () => {
  const index = buildProgramIndex(list, "linux");
  assert.equal(index.has("shared"), false);
});

await check("stored answers drop anything that isn't an id and show or hide", () => {
  assert.deepEqual(readAnswers({ [CS2]: "show", "12": "maybe", nope: "show", "34": "hide" }), { [CS2]: "show", "34": "hide" });
  assert.deepEqual(readAnswers(["x"]), {});
});

const index = buildProgramIndex(list, "win32");

await check("an unanswered game is asked about and not shown", async () => {
  const asked = [];
  const shown = [];
  const d = createGameDetector({
    list: async () => ["cs2.exe"],
    index: () => index,
    answers: () => ({}),
    onAsk: (id) => asked.push(id),
    onChange: (s) => shown.push(s),
  });
  await d.poll();
  d.stop();
  assert.deepEqual(asked, [CS2]);
  assert.deepEqual(shown, [[]]);
});

await check("a yes shows it, with when it was first seen", async () => {
  let shown = null;
  const d = createGameDetector({
    list: async () => ["cs2.exe"],
    index: () => index,
    answers: () => ({ [CS2]: "show" }),
    onAsk: () => assert.fail("asked after a yes"),
    onChange: (s) => (shown = s),
    now: () => 5000,
  });
  await d.poll();
  d.stop();
  assert.deepEqual(shown, [{ appId: CS2, since: 5000 }]);
});

await check("a no never shows and never asks again", async () => {
  let shown = null;
  const d = createGameDetector({
    list: async () => ["cs2.exe"],
    index: () => index,
    answers: () => ({ [CS2]: "hide" }),
    onAsk: () => assert.fail("asked after a no"),
    onChange: (s) => (shown = s),
  });
  await d.poll();
  d.stop();
  assert.deepEqual(shown, []);
});

await check("the board shows a detected game only when no game reports for itself", () => {
  const cards = [];
  const board = createPresenceBoard({ nameForApp: (id) => (id === CS2 ? "Counter-Strike 2" : "Osu"), onChange: (c) => cards.push(c), minIntervalMs: 0 });
  board.setDetected([{ appId: CS2, since: 1_700_000_000_000 }]);
  assert.equal(cards.at(-1)?.name, "Counter-Strike 2");
  assert.equal(cards.at(-1)?.appId, CS2);
  board.update({ connection: 1, clientId: "999999999999999999", activity: { details: "Ranked" } });
  assert.equal(cards.at(-1)?.name, "Osu");
  board.update({ connection: 1, clientId: "999999999999999999", activity: null });
  assert.equal(cards.at(-1)?.name, "Counter-Strike 2");
  board.stop();
});

await check("hiding a detected game in Rich Presence hides it here too", () => {
  const cards = [];
  const board = createPresenceBoard({ nameForApp: () => "Counter-Strike 2", onChange: (c) => cards.push(c), minIntervalMs: 0 });
  board.setHidden([CS2]);
  board.setDetected([{ appId: CS2, since: 1 }]);
  assert.equal(cards.length, 0);
  board.stop();
});

if (failures) {
  console.error(`\ngame detection: ${failures} failed`);
  process.exit(1);
}
console.log("\ngame detection: ok");
