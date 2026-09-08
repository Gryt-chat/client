/* eslint-env node */

// Runs whatsNew's own effect. It fires once per version, so getting it wrong is
// a modal nobody sees again, or one that greets a fresh install. GRYT-1083.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = "src/components/whatsNew.tsx";
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", SOURCE), "utf8");

/** The effect body, from its arrow's brace to the brace that closes it. */
function effectBody(text) {
  const OPENER = "useEffect(() => {";
  const start = text.indexOf(OPENER) + OPENER.length - 1;
  assert.ok(start > OPENER.length - 1, `${SOURCE} no longer has a useEffect`);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in the effect in ${SOURCE}`);
}

const body = effectBody(source)
  // Two bits of TypeScript: a generic on the read, and the fetch callback's type.
  .replace("getUserValue<string | null>(", "getUserValue(")
  .replace(/: \{ app\?: Entry\[\] \} \| null/, "");

/** The two module constants the effect closes over. */
const SEEN_KEY = source.match(/const SEEN_KEY = "([^"]+)"/)?.[1];
const CHANGELOG_URL = source.match(/const CHANGELOG_URL = "([^"]+)"/)?.[1];
assert.ok(SEEN_KEY, `${SOURCE} no longer names the key it remembers the version under`);
assert.match(
  CHANGELOG_URL ?? "",
  /^https:\/\/gryt\.chat\/changelog\.json$/,
  "the changelog is fetched from somewhere other than the site's emitted file",
);

/** One run of the effect, with the store and the network faked. */
async function run({ seen, version, app, offline }) {
  const store = { value: seen };
  const shown = [];
  const fetched = [];

  const fn = new Function(
    "getUserValue", "setUserValue", "fetch", "setEntry", "version", "AbortController", "SEEN_KEY", "CHANGELOG_URL",
    `return (async () => { const cleanup = (() => ${body})(); await new Promise(r => setTimeout(r, 0)); return cleanup; })();`,
  );

  await fn(
    () => store.value,
    (_k, v) => (store.value = v),
    (url) => {
      fetched.push(url);
      return offline
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ ok: true, json: () => Promise.resolve({ app }) });
    },
    (e) => shown.push(e),
    version,
    class {
      signal = null;
      abort() {}
    },
    SEEN_KEY,
    CHANGELOG_URL,
  );

  return { seen: store.value, shown, fetched };
}

const LINE = { version: "1.10.3", date: "2026-09-08", line: "Joining voice waits." };

// The ordinary case: updated, a line exists, it is shown once and recorded.
{
  const r = await run({ seen: "1.10.2", version: "1.10.3", app: [LINE] });
  assert.deepEqual(r.shown, [LINE], "the line for the running version was not shown");
  assert.equal(r.seen, "1.10.3", "the version was not recorded, so it would show again");
}

// Same version again: nothing fetched, nothing shown.
{
  const r = await run({ seen: "1.10.3", version: "1.10.3", app: [LINE] });
  assert.deepEqual(r.shown, [], "the modal opens again on a version already seen");
  assert.deepEqual(r.fetched, [], "it fetches the changelog for a version already seen");
}

// A fresh install announces nothing, and records so the next update does.
{
  const r = await run({ seen: null, version: "1.10.3", app: [LINE] });
  assert.deepEqual(r.shown, [], "a fresh install is greeted with a what's-new modal");
  assert.deepEqual(r.fetched, [], "a fresh install fetches the changelog for nothing");
  assert.equal(r.seen, "1.10.3", "a fresh install did not record its version");
}

// The line is not written yet. Say nothing, and do not burn the version —
// it lands twenty minutes later and the next launch should still show it.
{
  const r = await run({ seen: "1.10.2", version: "1.10.3", app: [] });
  assert.deepEqual(r.shown, [], "an empty changelog still opened a modal");
  assert.equal(r.seen, "1.10.2", "the version was recorded with no line, so it is lost for good");
}

// Offline is not an error worth telling anybody about, and not worth recording.
{
  const r = await run({ seen: "1.10.2", version: "1.10.3", offline: true });
  assert.deepEqual(r.shown, [], "a failed fetch showed something");
  assert.equal(r.seen, "1.10.2", "a failed fetch recorded the version anyway");
}

// It matches on the exact version rather than taking whatever is newest.
{
  const newer = { version: "1.11.0", date: "2026-09-09", line: "Something else." };
  const r = await run({ seen: "1.10.2", version: "1.10.3", app: [newer, LINE] });
  assert.deepEqual(r.shown, [LINE], "it showed a release that is not the one running");
}

console.log("what's new: ok, once per version, quiet on a fresh install and with no line");
