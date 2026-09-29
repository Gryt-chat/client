#!/usr/bin/env node
/** Lookup order, cache expiry, a bad/huge response, and no fetch while Rich Presence is off. */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDetectableIndex,
  fetchDetectableList,
  isStale,
  maybeRefreshDetectableList,
  readCache,
  readDetectableList,
  REFRESH_INTERVAL_MS,
  resolveGameName,
  writeCache,
} from "../electron/gameListCache.ts";

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

async function checkAsync(name, run) {
  try {
    await run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
}

console.log("game list cache");

/* ── Reading entries off the wire or off disk ───────────────────────── */

check("a bad response is an empty list, not a crash", () => {
  for (const junk of [null, 42, "x", {}, { id: "1" }]) {
    assert.deepEqual(readDetectableList(junk), []);
  }
  assert.deepEqual(readDetectableList([null, 7, { name: "no id" }, { id: "abc", name: "not a snowflake" }]), []);
});

check("a huge array is refused outright", () => {
  const huge = Array.from({ length: 50_001 }, (_, i) => ({ id: String(i + 1), name: `Game ${i}` }));
  assert.deepEqual(readDetectableList(huge), []);
});

check("a valid entry survives, trimmed and with its icon hash", () => {
  const [entry] = readDetectableList([{ id: "123", name: "  Ok  ".padEnd(80, "x"), icon_hash: "abc", extra: "dropped" }]);
  assert.equal(entry.id, "123");
  assert.equal(entry.name.length, 64);
  assert.equal(entry.icon_hash, "abc");
});

check("the first entry for an id wins", () => {
  const index = createDetectableIndex([
    { id: "1", name: "First" },
    { id: "1", name: "Second" },
  ]);
  assert.equal(index.get("1").name, "First");
});

check("lookup order: overrides, then downloaded, then bundled, then unknown", () => {
  const overrides = (id) => (id === "1" ? "Override Game" : null);
  const downloaded = createDetectableIndex([{ id: "1", name: "Downloaded Game" }, { id: "2", name: "Downloaded Only" }]);
  const bundled = createDetectableIndex([{ id: "1", name: "Bundled Game" }, { id: "2", name: "Bundled Fallback" }, { id: "3", name: "Bundled Only" }]);
  const sources = { overrides, downloaded, bundled };
  assert.equal(resolveGameName(sources, "1"), "Override Game");
  assert.equal(resolveGameName(sources, "2"), "Downloaded Only");
  assert.equal(resolveGameName(sources, "3"), "Bundled Only");
  assert.equal(resolveGameName(sources, "999"), null);
});

/* ── The on-disk cache ───────────────────────────────────────────────── */

const dir = mkdtempSync(join(tmpdir(), "gryt-game-list-cache-"));
try {
  check("no cache file yet reads as null, not a crash", () => {
    assert.equal(readCache(dir), null);
  });

  check("a write can be read back", () => {
    writeCache(dir, [{ id: "1", name: "Factorio" }]);
    const cache = readCache(dir);
    assert.ok(cache);
    assert.equal(cache.entries.length, 1);
    assert.equal(cache.entries[0].name, "Factorio");
  });

  check("a fresh cache isn't stale, a day-old one is", () => {
    const cache = readCache(dir);
    assert.equal(isStale(cache, cache.fetchedAt), false);
    assert.equal(isStale(cache, cache.fetchedAt + REFRESH_INTERVAL_MS - 1), false);
    assert.equal(isStale(cache, cache.fetchedAt + REFRESH_INTERVAL_MS), true);
  });

  check("no cache at all is always stale", () => {
    assert.equal(isStale(null, Date.now()), true);
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

/* ── Fetching, with sources that fail in different ways ────────────── */

const okBody = Array.from({ length: 150 }, (_, i) => ({ id: String(i + 1), name: `Game ${i}`, icon_hash: "h" }));

function fakeFetch(script) {
  let call = 0;
  return async () => {
    const behavior = script[Math.min(call, script.length - 1)];
    call += 1;
    return behavior();
  };
}

await checkAsync("the first source that answers with enough entries wins", async () => {
  const fetchImpl = fakeFetch([() => ({ ok: true, json: async () => okBody })]);
  const entries = await fetchDetectableList(fetchImpl, ["https://a.example/detectable.json"]);
  assert.equal(entries.length, 150);
});

await checkAsync("a failing first source falls back to the second", async () => {
  const fetchImpl = fakeFetch([
    async () => {
      throw new Error("network down");
    },
    () => ({ ok: true, json: async () => okBody }),
  ]);
  const entries = await fetchDetectableList(fetchImpl, ["https://a.example/x", "https://b.example/x"]);
  assert.equal(entries.length, 150);
});

await checkAsync("a non-array or too-small body is rejected, not treated as the list shrinking", async () => {
  const fetchImpl = fakeFetch([() => ({ ok: true, json: async () => ({ not: "an array" }) })]);
  const entries = await fetchDetectableList(fetchImpl, ["https://a.example/x"]);
  assert.equal(entries, null);
});

await checkAsync("every source failing gives null, not a throw", async () => {
  const fetchImpl = fakeFetch([
    async () => {
      throw new Error("dns");
    },
  ]);
  const entries = await fetchDetectableList(fetchImpl, ["https://a.example/x", "https://b.example/x"]);
  assert.equal(entries, null);
});

/* ── The refresh policy: cache expiry, and never wiping a good cache ───── */

const dir2 = mkdtempSync(join(tmpdir(), "gryt-game-list-cache-"));
try {
  await checkAsync("no cache yet: fetches, and a good response is written", async () => {
    const fetchImpl = fakeFetch([() => ({ ok: true, json: async () => okBody })]);
    const index = await maybeRefreshDetectableList({ userDataDir: dir2, fetchImpl });
    assert.equal(index.get("1").name, "Game 0");
    assert.ok(readCache(dir2));
  });

  await checkAsync("a fresh cache is used without fetching again", async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      throw new Error("should not be called");
    };
    const index = await maybeRefreshDetectableList({ userDataDir: dir2, fetchImpl });
    assert.equal(called, false);
    assert.equal(index.get("1").name, "Game 0");
  });

  await checkAsync("a stale cache triggers a fetch", async () => {
    let called = false;
    const fetchImpl = fakeFetch([
      () => {
        called = true;
        return { ok: true, json: async () => [{ id: "1", name: "Refreshed" }, ...okBody.slice(1)] };
      },
    ]);
    const index = await maybeRefreshDetectableList({
      userDataDir: dir2,
      fetchImpl,
      now: () => Date.now() + REFRESH_INTERVAL_MS + 1,
    });
    assert.equal(called, true);
    assert.equal(index.get("1").name, "Refreshed");
  });

  await checkAsync("a broken response on a stale cache keeps the old entries, doesn't wipe them", async () => {
    const before = readCache(dir2);
    const fetchImpl = fakeFetch([() => ({ ok: false, status: 500 })]);
    const index = await maybeRefreshDetectableList({
      userDataDir: dir2,
      fetchImpl,
      now: () => Date.now() + 2 * REFRESH_INTERVAL_MS,
    });
    assert.deepEqual([...index.values()], before.entries);
    // The file on disk is untouched too, not just the returned index.
    assert.deepEqual(readCache(dir2).entries, before.entries);
  });
} finally {
  rmSync(dir2, { recursive: true, force: true });
}

await checkAsync("main.ts only refreshes after the consent check, not before it", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("function startRichPresence"));
  const guardAt = fn.indexOf("!readRichPresenceConsent()) return;");
  const refreshAt = fn.indexOf("maybeRefreshDetectableList(");
  assert.ok(guardAt !== -1 && refreshAt !== -1 && guardAt < refreshAt, "the refresh call moved ahead of the consent guard");
});

console.log(failures === 0 ? "\ngame list cache: ok" : `\ngame list cache: ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
