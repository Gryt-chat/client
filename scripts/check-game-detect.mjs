#!/usr/bin/env node
/**
 * Known games spotted by their program (GRYT-1636). Nothing shows before a yes,
 * and a game that reports for itself always wins over "it's running".
 */

import assert from "node:assert/strict";

import { appKey, buildProgramIndex, createGameDetector, readAnswers, runningApps } from "../electron/gameDetector.ts";
import { readGamesFile } from "../electron/gameListCache.ts";
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
const list = readGamesFile([
  { id: CS2, name: "Counter-Strike 2", programs: { win32: ["win64/cs2.exe"] } },
  { id: "111111111111111111", name: "One", programs: { win32: ["bin/game.exe"], linux: ["shared"] } },
  { id: "222222222222222222", name: "Two", programs: { win32: ["x/shared.exe"], linux: ["shared"] } },
  { id: "bad", name: "Bad id", programs: { win32: ["x.exe"] } },
  { id: "333333333333333333", programs: { win32: ["no-name.exe"] } },
]);

await check("the list keeps only well-formed entries", () => {
  assert.deepEqual(list.map((e) => e.id), [CS2, "111111111111111111", "222222222222222222"]);
});

await check("a program name matches whatever path and case it runs from", () => {
  const { byProgram } = buildProgramIndex(list, "win32");
  assert.deepEqual(runningApps(["C:\\Steam\\game\\bin\\win64\\CS2.EXE", "explorer.exe"], byProgram), [CS2]);
});

await check("a generic name like game.exe never matches", () => {
  assert.equal(buildProgramIndex(list, "win32").byProgram.has("game"), false);
});

await check("a name two games share is dropped rather than guessed", () => {
  assert.equal(buildProgramIndex(list, "linux").byProgram.has("shared"), false);
});

await check("stored answers drop anything that isn't an id and show or hide", () => {
  assert.deepEqual(readAnswers({ [CS2]: "show", "12": "maybe", nope: "show", "34": "hide" }), { [CS2]: "show", "34": "hide" });
  assert.deepEqual(readAnswers(["x"]), {});
});

const index = buildProgramIndex(list, "win32").byProgram;

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

const FIGMA = appKey("Figma");
const curated = [
  { name: "Figma", kind: "app", ids: [], exe: { win32: ["figma.exe"], darwin: ["figma.app"] } },
  { name: "VS Code", kind: "app", ids: ["383226320970055681"], exe: { win32: ["code.exe"] } },
];

await check("an app with no Discord id gets an app: key, a name and the app kind", () => {
  const { byProgram, known } = buildProgramIndex(list, "win32", curated);
  assert.equal(FIGMA, "app:figma");
  assert.deepEqual(runningApps(["C:\\Figma\\Figma.exe"], byProgram), [FIGMA]);
  assert.deepEqual(known.get(FIGMA), { name: "Figma", kind: "app", rpcIds: [] });
});

await check("on macOS an app is known by its .app bundle", () => {
  const { byProgram } = buildProgramIndex(list, "darwin", curated);
  assert.deepEqual(runningApps(["/Applications/Figma.app/Contents/MacOS/Figma"], byProgram, "darwin"), [FIGMA]);
});

await check("on Linux a Windows game under Proton is still spotted", () => {
  const { byProgram } = buildProgramIndex(list, "linux");
  assert.deepEqual(runningApps(["cs2.exe"], byProgram, "linux"), [CS2]);
});

await check("an answer for an app key is kept", () => {
  assert.deepEqual(readAnswers({ [FIGMA]: "show", "app:": "show" }), { [FIGMA]: "show" });
});

await check("an app whose plugin is reporting isn't asked about or shown", async () => {
  const { byProgram } = buildProgramIndex(list, "win32", curated);
  let shown = null;
  const d = createGameDetector({
    list: async () => ["code.exe"],
    index: () => byProgram,
    answers: () => ({}),
    reporting: () => new Set(["383226320970055681"]),
    onAsk: () => assert.fail("asked while the plugin reports"),
    onChange: (s) => (shown = s),
  });
  await d.poll();
  d.stop();
  assert.deepEqual(shown, []);
});

await check("a detected app reads using, with our name", () => {
  const cards = [];
  const board = createPresenceBoard({ nameForApp: () => null, onChange: (c) => cards.push(c), minIntervalMs: 0 });
  board.setDetected([{ appId: FIGMA, since: 1_700_000_000_000, name: "Figma", type: "using" }]);
  assert.equal(cards.at(-1)?.name, "Figma");
  assert.equal(cards.at(-1)?.type, "using");
  assert.equal(cards.at(-1)?.appId, undefined);
  board.stop();
});

await check("the board says which apps are reporting", () => {
  const board = createPresenceBoard({ nameForApp: () => "x", onChange: () => {}, minIntervalMs: 0 });
  board.update({ connection: 3, clientId: "383226320970055681", activity: { details: "Editing" } });
  assert.deepEqual([...board.liveAppIds()], ["383226320970055681"]);
  board.stop();
});

if (failures) {
  console.error(`\ngame detection: ${failures} failed`);
  process.exit(1);
}
console.log("\ngame detection: ok");
