#!/usr/bin/env node
/**
 * The games list Gryt ships. A name that matches the wrong program tells people
 * somebody is playing a game they aren't, so the list and the matching are checked here.
 */

import assert from "node:assert/strict";

import games from "../electron/games.json" with { type: "json" };
import { createGameIndex, readGameList } from "../electron/gameList.ts";

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

console.log("game list");

const shipped = readGameList(games);

check("every shipped entry survives the reader", () => {
  assert.equal(shipped.length, games.games.length);
  assert.ok(shipped.length > 50, "the list is suspiciously short");
});

check("no executable belongs to two games", () => {
  const owner = new Map();
  for (const game of shipped) {
    for (const [os, names] of Object.entries(game.exe)) {
      for (const name of names) {
        const key = `${os}:${name}`;
        assert.ok(!owner.has(key), `${key} is both ${owner.get(key)} and ${game.name}`);
        owner.set(key, game.name);
      }
    }
  }
});

check("no executable is something every machine runs", () => {
  const generic = /^(java|javaw|python|node|electron|steam|launcher|game|client|start|setup|update|updater|hl2|hl2_osx)(\.exe|\.app)?$/;
  for (const game of shipped) {
    for (const names of Object.values(game.exe)) {
      for (const name of names) assert.ok(!generic.test(name), `${game.name} matches on ${name}`);
    }
  }
});

check("no two games share a name or an application id", () => {
  const names = new Set();
  const ids = new Set();
  for (const game of shipped) {
    assert.ok(!names.has(game.name), `${game.name} twice`);
    names.add(game.name);
    for (const id of game.discord) {
      assert.ok(!ids.has(id), `${id} twice`);
      ids.add(id);
    }
  }
});

check("a hand-edited file can't break anything", () => {
  for (const junk of [null, 42, "x", { games: "x" }, { games: [null, 7, { name: "" }, { name: 5 }] }]) {
    assert.deepEqual(readGameList(junk), []);
  }
  const [entry] = readGameList({ games: [{ name: "Ok", discord: ["12", "abc", 3], exe: { win32: ["OK.EXE", 4], beos: ["x"] } }] });
  assert.deepEqual(entry, { name: "Ok", discord: ["12"], exe: { win32: ["ok.exe"] } });
});

/* ── Matching ────────────────────────────────────────────────────────── */

const list = [
  { name: "Factorio", discord: ["358422126602223616"], exe: { win32: ["factorio.exe"], darwin: ["factorio.app"], linux: ["factorio"] } },
  { name: "Terraria", discord: ["1"], exe: { win32: ["terraria.exe"], linux: ["terraria.bin.x86"] } },
  { name: "Cyberpunk 2077", discord: ["2"], exe: { win32: ["cyberpunk2077.exe"] } },
];

check("a Rich Presence application id gives the game's name", () => {
  const index = createGameIndex(list, "win32");
  assert.equal(index.nameForApp("358422126602223616"), "Factorio");
  assert.equal(index.nameForApp("999"), null);
});

check("Windows matches the image name, whatever its case", () => {
  const index = createGameIndex(list, "win32");
  assert.deepEqual(index.matchRunning(["explorer.exe", "Factorio.exe", "chrome.exe"]), ["Factorio"]);
});

check("macOS matches the app bundle in the path ps gives", () => {
  const index = createGameIndex(list, "darwin");
  assert.deepEqual(index.matchRunning(["/Applications/Factorio.app/Contents/MacOS/factorio", "/usr/sbin/cfprefsd"]), ["Factorio"]);
});

check("Linux matches native names, and Windows names under Proton", () => {
  const index = createGameIndex(list, "linux");
  assert.deepEqual(index.matchRunning(["factorio"]), ["Factorio"]);
  /* /proc/<pid>/comm stops at fifteen characters. */
  assert.deepEqual(index.matchRunning(["Cyberpunk2077.e"]), ["Cyberpunk 2077"]);
  assert.deepEqual(index.matchRunning(["terraria.bin.x8"]), ["Terraria"]);
});

check("a program that only starts like a game is not that game", () => {
  const index = createGameIndex(list, "win32");
  assert.deepEqual(index.matchRunning(["factorio-server.exe", "notfactorio.exe", "factorio"]), []);
});

check("one game running twice is one answer", () => {
  const index = createGameIndex(list, "win32");
  assert.deepEqual(index.matchRunning(["factorio.exe", "Factorio.exe"]), ["Factorio"]);
});

console.log(failures === 0 ? "\ngame list: ok" : `\ngame list: ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
