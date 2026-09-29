#!/usr/bin/env node
/**
 * Automatic mode reads every running program. The promise is that only the name
 * of a listed game leaves the main process, and only after somebody turned it on.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createGameIndex } from "../electron/gameList.ts";
import { createGameWatcher } from "../electron/gameWatcher.ts";

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

const settle = () => new Promise((r) => setTimeout(r, 5));
const index = createGameIndex(
  [
    { name: "Factorio", discord: [], exe: { win32: ["factorio.exe"] } },
    { name: "Stardew Valley", discord: [], exe: { win32: ["stardew valley.exe"] } },
  ],
  "win32",
);

function watcher(running) {
  const changes = [];
  const w = createGameWatcher({ index, intervalMs: 60_000, list: async () => running.value, onChange: (n) => changes.push(n) });
  return { w, changes };
}

console.log("auto games");

await check("only listed games come out, never the rest of what's running", async () => {
  const running = { value: ["explorer.exe", "Bank Of Somewhere.exe", "Factorio.exe", "chrome.exe"] };
  const { w, changes } = watcher(running);
  w.start();
  await settle();
  assert.deepEqual(changes, [["Factorio"]]);
  assert.deepEqual(w.seen(), ["Factorio"]);
  w.stop();
});

await check("a poll with the same answer says nothing", async () => {
  const running = { value: ["factorio.exe"] };
  const { w, changes } = watcher(running);
  w.start();
  await settle();
  w.stop();
  w.start();
  await settle();
  assert.deepEqual(changes, [["Factorio"], [], ["Factorio"]]);
  w.stop();
});

await check("a hidden game is never reported, and hiding the shown one clears it", async () => {
  const running = { value: ["factorio.exe", "Stardew Valley.exe"] };
  const { w, changes } = watcher(running);
  w.setHidden(["Stardew Valley"]);
  w.start();
  await settle();
  assert.deepEqual(changes.at(-1), ["Factorio"]);
  w.setHidden(["Stardew Valley", "Factorio"]);
  assert.deepEqual(changes.at(-1), []);
  assert.deepEqual(w.seen(), ["Factorio", "Stardew Valley"], "a hidden game should still be listed for showing again");
  w.stop();
});

await check("turning it off clears what was shown", async () => {
  const running = { value: ["factorio.exe"] };
  const { w, changes } = watcher(running);
  w.start();
  await settle();
  w.stop();
  assert.deepEqual(changes.at(-1), []);
});

const main = readFileSync(new URL("../electron/autoGames.ts", import.meta.url), "utf8");

await check("nothing is read before somebody turns it on, and off stops it", () => {
  const start = main.match(/export function startAutoGames\(getWindow[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(start, /if \(!canListProcesses \|\| gameWatcher \|\| !readAutoGamesConsent\(\)\) return;/);
  const setConsent = main.match(/ipcMain\.handle\("auto-games-set-consent"[\s\S]*?\n {2}\}\);/)?.[0] ?? "";
  assert.match(setConsent, /stopAutoGames\(\)/);
});

await check("the renderer only ever gets game names, not the process list", () => {
  const get = main.match(/ipcMain\.handle\("auto-games-get"[\s\S]*?\}\)\);/)?.[0] ?? "";
  assert.ok(get, "auto-games-get is gone");
  assert.doesNotMatch(get, /listRunning/);
  assert.match(main, /list: listRunningExecutables,/);
  assert.doesNotMatch(main, /auto-games-[a-z-]+"[^\n]*listRunningPrograms/);
});

await check("it has its own consent, apart from watched programs", () => {
  assert.match(main, /loadGlobalStore\(\)\["autoGamesConsent"\]/);
  const start = main.match(/export function startAutoGames\(getWindow[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(start, "startAutoGames is gone");
  assert.doesNotMatch(start, /processScanAllowed|processScanConsent/);
});

console.log(failures === 0 ? "\nauto games: only a listed game's name leaves the main process." : `\nauto games: ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
