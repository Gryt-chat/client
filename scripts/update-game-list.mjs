#!/usr/bin/env node
/** Refreshes games.json and detectable-snapshot.json from the rich-presence repo. Run before a release. */

const SOURCES = {
  overrides: [
    "https://cdn.jsdelivr.net/gh/Gryt-chat/rich-presence@main/overrides.json",
    "https://raw.githubusercontent.com/Gryt-chat/rich-presence/main/overrides.json",
  ],
  detectable: [
    "https://cdn.jsdelivr.net/gh/Gryt-chat/rich-presence@main/detectable.json",
    "https://raw.githubusercontent.com/Gryt-chat/rich-presence/main/detectable.json",
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
    await writeFile(new URL("../electron/games.json", import.meta.url), JSON.stringify(overrides));
    console.log(`games.json: wrote ${overrides.games.length} entries`);
  } else {
    console.error("games.json: fetch failed or looked empty, keeping the committed file");
  }

  const detectable = await fetchJson(SOURCES.detectable);
  if (Array.isArray(detectable) && detectable.length > 1000) {
    await writeFile(new URL("../electron/detectable-snapshot.json", import.meta.url), JSON.stringify(detectable));
    console.log(`detectable-snapshot.json: wrote ${detectable.length} entries`);
  } else {
    console.error("detectable-snapshot.json: fetch failed or looked too small, keeping the committed file");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
