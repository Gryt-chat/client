#!/usr/bin/env node
/** Refreshes curated-games.json and games-snapshot.json from the rich-presence repo. Run before a release. */

const SOURCES = {
  overrides: [
    "https://raw.githubusercontent.com/Gryt-chat/rich-presence/main/overrides.json",
    "https://cdn.jsdelivr.net/gh/Gryt-chat/rich-presence@main/overrides.json",
  ],
  games: [
    "https://raw.githubusercontent.com/Gryt-chat/rich-presence/main/games.json",
    "https://cdn.jsdelivr.net/gh/Gryt-chat/rich-presence@main/games.json",
  ],
};

async function fetchJson(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      return await res.json();
    } catch {
      // Try the next source.
    }
  }
  return null;
}

async function main() {
  const { writeFile } = await import("node:fs/promises");

  const overrides = await fetchJson(SOURCES.overrides);
  if (overrides && Array.isArray(overrides.games) && overrides.games.length > 0) {
    await writeFile(new URL("../electron/curated-games.json", import.meta.url), JSON.stringify(overrides));
    console.log(`curated-games.json: wrote ${overrides.games.length} entries`);
  } else {
    console.error("curated-games.json: fetch failed or looked empty, keeping the committed file");
  }

  // Names only in the snapshot: program names come with the daily download when detection is on.
  const list = await fetchJson(SOURCES.games);
  const games = Array.isArray(list?.games) ? list.games.map(({ id, name }) => ({ id, name })) : [];
  if (games.length > 1000) {
    await writeFile(new URL("../electron/games-snapshot.json", import.meta.url), JSON.stringify(games));
    console.log(`games-snapshot.json: wrote ${games.length} entries`);
  } else {
    console.error("games-snapshot.json: fetch failed or looked too small, keeping the committed file");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
