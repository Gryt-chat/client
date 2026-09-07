#!/usr/bin/env node
/**
 * What Gryt looks at, and what it passes on (GRYT-931).
 *
 * The whole design is one claim: Gryt reads the process list and reports only
 * the programs somebody wrote down. If that stops being true, the capability a
 * plugin asks for — "see when you are running a program you have listed" —
 * becomes a lie, and nothing else would notice.
 *
 * So this asserts the matching, and then reads the sources to assert the shape
 * of what leaves the main process. The second half is crude and worth it: the
 * failure it exists for is somebody adding a convenient
 * `ipcMain.handle("processes-all")` in six months.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createProcessWatcher,
  MAX_WATCHED,
  matchWatched,
  normaliseExecutable,
  readWatchList,
} from "../electron/processWatcher.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

/* Comments out first. A check a comment can trip is also a check a comment can
   satisfy, and this file is about to search for strings its own neighbours
   describe in prose. */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const read = (p) => withoutComments(readFileSync(`${ROOT}/${p}`, "utf8"));

console.log("watched programs");

/* ── Matching ────────────────────────────────────────────────────────── */

check("an executable is the same however it is written", () => {
  const forms = [
    "C:\\Games\\Factorio.exe",
    "Factorio.EXE",
    "/usr/games/factorio",
    "  factorio  ",
    "/Applications/Factorio.app/Contents/MacOS/factorio",
  ];
  for (const form of forms) {
    assert.equal(normaliseExecutable(form), "factorio", `${form} normalised wrong`);
  }
});

check("only what was asked for comes back", () => {
  const running = ["/usr/bin/firefox", "/Applications/Bank.app/Contents/MacOS/Bank", "factorio"];
  const names = matchWatched(running, [{ match: "factorio", name: "Factorio" }]);
  /* The point of the whole feature: two other things were running and neither
     is in the answer. */
  assert.deepEqual(names, ["Factorio"]);
});

check("nothing watched means nothing reported", () => {
  assert.deepEqual(matchWatched(["factorio", "steam", "discord"], []), []);
});

check("a name is what you called it, not what the binary is", () => {
  assert.deepEqual(
    matchWatched(["Factorio.exe"], [{ match: "factorio", name: "Factorio" }]),
    ["Factorio"],
  );
});

check("two entries for one executable are one answer", () => {
  const names = matchWatched(
    ["factorio"],
    [{ match: "factorio", name: "Factorio" }, { match: "Factorio.exe", name: "Also Factorio" }],
  );
  assert.deepEqual(names, ["Factorio"]);
});

check("an entry with no name falls back to the executable", () => {
  assert.deepEqual(matchWatched(["factorio"], [{ match: "factorio", name: "  " }]), ["factorio"]);
});

/* ── The list off disk ───────────────────────────────────────────────── */

check("a hand-edited list cannot break the next poll", () => {
  for (const junk of [null, undefined, 42, "a list", { match: "x" }]) {
    assert.deepEqual(readWatchList(junk), [], `${JSON.stringify(junk)} was accepted`);
  }

  const mixed = readWatchList([
    null,
    7,
    { name: "no match" },
    { match: 5, name: "not a string" },
    { match: "factorio", name: "Factorio" },
    { match: "Factorio.exe", name: "duplicate" },
  ]);
  assert.deepEqual(mixed, [{ match: "factorio", name: "Factorio" }]);
});

check("the list is capped", () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ match: `game${i}`, name: `Game ${i}` }));
  assert.equal(readWatchList(many).length, MAX_WATCHED);
});

check("a name off disk cannot be a paragraph", () => {
  const [entry] = readWatchList([{ match: "x".repeat(400), name: "y".repeat(400) }]);
  assert.ok(entry.match.length <= 120);
  assert.ok(entry.name.length <= 80);
});

/* ── The watcher ─────────────────────────────────────────────────────── */

/* Awaited rather than timed: `watch` kicks off a poll without waiting for it,
   so the assertions need the microtasks to settle first. */
const settle = () => new Promise((r) => setImmediate(r));

async function watcherCheck(name, run) {
  try {
    await run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
}

await watcherCheck("adding a program you already have open says so at once", async () => {
  const changes = [];
  const watcher = createProcessWatcher({
    onChange: (running) => changes.push(running),
    list: async () => ["factorio", "firefox"],
  });

  watcher.watch([{ match: "factorio", name: "Factorio" }]);
  await settle();

  assert.deepEqual(changes, [["Factorio"]], "waited for the interval instead of looking now");
  assert.deepEqual(watcher.current(), ["Factorio"]);
  watcher.stop();
});

await watcherCheck("nothing is announced when nothing changed", async () => {
  const changes = [];
  const watcher = createProcessWatcher({
    intervalMs: 5,
    onChange: (running) => changes.push(running),
    list: async () => ["factorio"],
  });

  watcher.watch([{ match: "factorio", name: "Factorio" }]);
  await settle();
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(changes.length, 1, "the same answer was announced more than once");
  watcher.stop();
});

await watcherCheck("emptying the list stops the polling and clears the answer", async () => {
  let polls = 0;
  const changes = [];
  const watcher = createProcessWatcher({
    intervalMs: 5,
    onChange: (running) => changes.push(running),
    list: async () => {
      polls += 1;
      return ["factorio"];
    },
  });

  watcher.watch([{ match: "factorio", name: "Factorio" }]);
  await settle();

  watcher.watch([]);
  const after = polls;
  await new Promise((r) => setTimeout(r, 40));

  assert.deepEqual(changes.at(-1), [], "the last answer was left standing");
  assert.equal(polls, after, "still polling with nothing to look for");
  watcher.stop();
});

await watcherCheck("a failed read is one empty poll, not a dead watcher", async () => {
  const changes = [];
  let call = 0;
  const watcher = createProcessWatcher({
    intervalMs: 5,
    onChange: (running) => changes.push(running),
    list: async () => (++call === 1 ? [] : ["factorio"]),
  });

  watcher.watch([{ match: "factorio", name: "Factorio" }]);
  await settle();
  await new Promise((r) => setTimeout(r, 40));

  assert.deepEqual(watcher.current(), ["Factorio"], "the watcher gave up after one empty read");
  watcher.stop();
});

/* ── What a plugin gets ──────────────────────────────────────────────── */

const { mayCall, METHOD_CAPABILITY } = await import(
  "../src/packages/addons/src/workerProtocol.ts"
);

check("looking costs `processes`, and both calls do", () => {
  assert.equal(METHOD_CAPABILITY["processes.running"], "processes");
  assert.equal(METHOD_CAPABILITY["processes.subscribe"], "processes");
});

check("a plugin needs the capability declared and granted", () => {
  assert.equal(mayCall(["processes"], ["processes"], "processes.running").allowed, true);
  assert.equal(mayCall(["status"], ["processes"], "processes.running").allowed, false);
  assert.equal(mayCall(["processes"], [], "processes.subscribe").allowed, false);
});

check("the capability is worded as the list, not the machine", () => {
  /* "Read what you are running" would be the wrong sentence: Gryt reads the
     process list, a plugin is told about the person's own list, and somebody
     agreeing to this should not think they agreed to the first thing. */
  const capabilities = readFileSync(`${ROOT}/src/packages/addons/src/capabilities.ts`, "utf8");
  const label = capabilities.match(/processes:\s*"([^"]+)"/)?.[1] ?? "";
  assert.ok(label, "the processes capability has no label");
  assert.ok(
    /listed|you have listed|your list/i.test(label),
    `the label stopped saying the list is the scope: "${label}"`,
  );
});

check("a plugin is handed the matched names and nothing else", () => {
  const host = read("src/packages/addons/src/pluginHost.ts");
  const branch = host.slice(host.indexOf('case "processes.running"'));
  assert.ok(
    branch.includes("return [...runningPrograms]"),
    "processes.running no longer returns the matched list",
  );
  /* The host holds what the app pushed it. If it ever reaches for the preload
     directly it could ask for the unfiltered list instead. */
  assert.ok(
    !host.includes("listRunningPrograms"),
    "the plugin host reached for the picker list",
  );
});

check("a stopped plugin stops hearing about programs", () => {
  const host = read("src/packages/addons/src/pluginHost.ts");
  const stop = host.slice(host.indexOf("export function stopPlugin"));
  assert.ok(
    stop.includes("processListeners.delete(addonId)"),
    "a stopped plugin is left subscribed",
  );
});

/* ── What leaves the main process ────────────────────────────────────── */

const watcher = read("electron/processWatcher.ts");
const main = read("electron/main.ts");
const preload = read("electron/preload.ts");

check("the watcher reports matches, never the list it read", () => {
  /* `onChange` is the only thing the watcher pushes, and it is handed the
     result of `matchWatched`. If that ever becomes the raw list, every plugin
     with the capability gets everything somebody has open. */
  const poll = watcher.slice(watcher.indexOf("async function poll"));
  assert.ok(
    /announce\(matchWatched\(await list\(\), watched\)\)/.test(poll),
    "poll no longer filters through matchWatched",
  );
});

check("only the settings screen can ask what is running", () => {
  /* One handler hands over a list of programs, and the renderer calls it from
     the settings screen. Anything else exposing the same thing would need a
     line here saying why. */
  const handlers = [...main.matchAll(/ipcMain\.handle\(\s*"(processes-[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    handlers.sort(),
    ["processes-get-watched", "processes-list-running", "processes-running", "processes-set-watched"],
    "the processes IPC surface changed",
  );
});

check("what is pushed to the renderer is the matched list", () => {
  const send = main.slice(main.indexOf("createProcessWatcher"));
  assert.ok(
    /onChange:\s*\(running\)\s*=>\s*\{\s*mainWindow\?\.webContents\.send\("processes-changed", running\)/.test(
      send.replace(/\s+/g, " ").replace(/ \{ /g, " { "),
    ) || send.includes('send("processes-changed", running)'),
    "the change event no longer sends the matched list",
  );
});

check("the preload exposes no way to read the raw process list", () => {
  /* `listRunningPrograms` is the filtered, deduplicated picker list and is the
     only one of these that hands over programs at all. `listRunningExecutables`
     is the raw read and must stay inside the main process. */
  assert.ok(!preload.includes("listRunningExecutables"), "the raw read reached the preload");
  assert.ok(preload.includes("processes-list-running"), "the picker list went missing");
});

check("a poll cannot hold the app open", () => {
  assert.ok(watcher.includes("timer.unref?.()"), "the interval is no longer unref'd");
});

check("Windows never flashes a console", () => {
  assert.ok(watcher.includes("windowsHide: true"), "windowsHide went missing from the spawn");
});

console.log(
  failures === 0
    ? "\nwatched programs: only what somebody listed leaves the main process."
    : `\nwatched programs: ${failures} failed.`,
);
process.exit(failures === 0 ? 0 : 1);
