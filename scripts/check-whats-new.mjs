/* eslint-env node */

// Runs whatsNew's own effect and WhatsNewDialog's own grouping: a modal nobody
// sees twice (GRYT-1083), and a kind it drops is a line nobody reads (1088).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "src/components/whatsNew.tsx";
const DIALOG = "src/packages/socket/src/components/WhatsNewDialog.tsx";
const source = readFileSync(join(root, SOURCE), "utf8");
const dialog = readFileSync(join(root, DIALOG), "utf8");

/** Everything from `opener` to the brace that closes the block it opens. */
function block(text, opener, what) {
  const at = text.indexOf(opener);
  assert.ok(at >= 0, `no longer has ${what}`);
  const start = at + opener.length - 1;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${what}`);
}

/* The second useEffect is the one that decides; the first only subscribes. */
const body = block(source.slice(source.indexOf("onUserStoreLoaded(setStoreUser)")), "useEffect(() => {", "the deciding useEffect")
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

/** The delays between attempts, which the fake sleep records rather than waits. */
const RETRY_DELAYS_MS = JSON.parse(
  source.match(/const RETRY_DELAYS_MS = (\[[^\]]*\])/)?.[1].replaceAll("_", "") ?? "null",
);
assert.ok(Array.isArray(RETRY_DELAYS_MS) && RETRY_DELAYS_MS.length > 0, `${SOURCE} no longer retries`);

/** `new Function` builds a sync function, and findEntry awaits. */
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** findEntry as itself: the real loop, with the wait and the network faked. */
const findEntryBody = block(
  source,
  "async function findEntry(version: string, signal: AbortSignal): Promise<Entry | null> {",
  "findEntry",
)
  .slice(1, -1)
  .replace(" as { app?: Entry[] } | null", "");

/** One run of the effect, with the store, the network and the waiting faked. */
async function run({ seen, version, app, offline, storeUser, joined, attempts, abortOn }) {
  const store = { value: seen };
  const shown = [];
  const fetched = [];
  const slept = [];
  const controller = new AbortController();

  /* Each attempt's answer in turn, the last one repeating. `app`/`offline`
     describe a site that always says the same thing. */
  const answers = attempts ?? [offline ? { offline: true } : { app }];

  const fetch = (url, init) => {
    fetched.push({ url, cache: init?.cache, aborted: init?.signal?.aborted });
    if (fetched.length === abortOn) controller.abort();
    const answer = answers[Math.min(fetched.length - 1, answers.length - 1)];
    if (answer.offline) return Promise.reject(new Error("offline"));
    if (answer.ok === false) return Promise.resolve({ ok: false });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ app: answer.app }) });
  };

  const findEntry = new AsyncFunction(
    "fetch", "sleep", "CHANGELOG_URL", "RETRY_DELAYS_MS", "version", "signal",
    findEntryBody,
  ).bind(null, fetch, (ms) => {
    slept.push(ms);
    return Promise.resolve();
  }, CHANGELOG_URL, RETRY_DELAYS_MS);

  const fn = new Function(
    "getUserValue", "setUserValue", "findEntry", "setEntry", "version", "AbortController", "SEEN_KEY", "storeUser", "hasJoinedAnything",
    `return (async () => {
       const cleanup = (() => ${body})();
       for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 0));
       return cleanup;
     })();`,
  );

  await fn(
    () => store.value,
    (_k, v) => (store.value = v),
    findEntry,
    (e) => shown.push(e),
    version,
    class {
      signal = controller.signal;
      abort() {
        controller.abort();
      }
    },
    SEEN_KEY,
    storeUser === undefined ? "user_1" : storeUser,
    () => joined ?? false,
  );

  return { seen: store.value, shown, fetched, slept, urls: fetched.map((f) => f.url) };
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
  assert.deepEqual(r.urls, [], "it fetches the changelog for a version already seen");
}

// A fresh install announces nothing, and records so the next update does.
{
  const r = await run({ seen: null, version: "1.10.3", app: [LINE], joined: false });
  assert.deepEqual(r.shown, [], "a fresh install is greeted with a what's-new modal");
  assert.deepEqual(r.urls, [], "a fresh install fetches the changelog for nothing");
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

/* ── it asks again, and asks the server ──────────────────────────────────── */

// nginx sends max-age=600 and Chromium's disk cache outlives a restart, so the
// default cache mode reads a copy fetched before the release (GRYT-1110).
{
  const r = await run({ seen: "1.10.2", version: "1.10.3", app: [LINE] });
  assert.deepEqual(
    r.fetched.map((f) => f.cache),
    ["no-cache"],
    "the changelog is fetched from the cache, so a just-updated app reads the copy from before the release",
  );
}

// The wifi is not up yet at launch. The next attempt finds it.
{
  const r = await run({
    seen: "1.10.2",
    version: "1.10.3",
    attempts: [{ offline: true }, { app: [LINE] }],
  });
  assert.deepEqual(r.shown, [LINE], "a first attempt that failed was the only attempt");
  assert.equal(r.seen, "1.10.3");
}

// The site rebuilt between attempts, so the line appeared late.
{
  const r = await run({
    seen: "1.10.2",
    version: "1.10.3",
    attempts: [{ app: [] }, { ok: false }, { app: [LINE] }],
  });
  assert.deepEqual(r.shown, [LINE], "it stopped asking before the line was published");
  assert.deepEqual(r.slept, RETRY_DELAYS_MS.slice(0, 2), "it did not wait between attempts");
}

// And it stops, rather than asking forever.
{
  const r = await run({ seen: "1.10.2", version: "1.10.3", app: [] });
  assert.equal(
    r.fetched.length,
    RETRY_DELAYS_MS.length + 1,
    "it asks a different number of times than the delays allow for",
  );
  assert.deepEqual(r.slept, RETRY_DELAYS_MS, "the waits are not the ones written down");
  assert.equal(r.seen, "1.10.2", "it recorded the version after giving up, so the line is lost");
}

// Delays climb, so a site that is down is not asked four times in a row.
assert.deepEqual(
  [...RETRY_DELAYS_MS].sort((a, b) => a - b),
  RETRY_DELAYS_MS,
  "the retry delays do not climb",
);
assert.ok(RETRY_DELAYS_MS[0] >= 1000, "the first retry is immediate enough to be a second request");

// A closed window stops it, rather than fetching on into a dead component.
{
  const r = await run({ seen: "1.10.2", version: "1.10.3", app: [], abortOn: 1 });
  assert.equal(r.fetched.length, 1, "it kept fetching after the component had gone");
  assert.deepEqual(r.shown, [], "it showed a dialog for a component that had gone");
}

// And an answer that arrives after the window closed is dropped, rather than
// recorded as seen by a component that never drew it.
{
  const r = await run({ seen: "1.10.2", version: "1.10.3", app: [LINE], abortOn: 1 });
  assert.deepEqual(r.shown, [], "a line found after the component had gone was still shown");
  assert.equal(r.seen, "1.10.2", "the version was recorded by a dialog nobody saw");
}

// The wait itself ends on abort. Left out, a closed window holds a two-minute
// timer and the loop only stops when it fires.
{
  const sleepFn = new Function(
    "ms",
    "signal",
    block(source, "function sleep(ms: number, signal: AbortSignal): Promise<void> {", "sleep").slice(1, -1),
  );
  const controller = new AbortController();
  const started = Date.now();
  const waiting = sleepFn(60_000, controller.signal);
  controller.abort();
  await waiting;
  assert.ok(Date.now() - started < 1_000, "aborting does not cut the wait short");
}

/* ── the grouping, run as the component's own code ───────────────────────── */

/** The two helpers as themselves. `block` hands back the braces, so drop them. */
const bodyOf = (opener, what) => block(dialog, opener, what).slice(1, -1);

const KIND_ORDER = JSON.parse(dialog.match(/const KIND_ORDER = (\[[^\]]*\])/)?.[1] ?? "null");

const grouper = new Function(
  "changes",
  "KIND_ORDER",
  bodyOf(
    "function group(changes: WhatsNewChange[]): [string, string[]][] {",
    "a group function",
  ),
);
/** The component closes over KIND_ORDER; here it is handed in. */
const group = (changes) => grouper(changes, KIND_ORDER);

const readableDate = new Function(
  "iso",
  bodyOf("function readableDate(iso: string): string {", "a readableDate function"),
);

assert.deepEqual(
  KIND_ORDER,
  ["security", "new", "changed", "fixed"],
  "the kinds are drawn in a different order — security below the features is the half people scroll past",
);

// Security leads however the release was written, and each kind appears once.
{
  const g = group([
    { kind: "fixed", text: "b" },
    { kind: "security", text: "a" },
    { kind: "fixed", text: "c" },
  ]);
  assert.deepEqual(
    g,
    [
      ["security", ["a"]],
      ["fixed", ["b", "c"]],
    ],
    "changes are not gathered under one heading per kind in KIND_ORDER",
  );
}

// Order inside a kind is the order somebody wrote them in.
{
  const g = group([
    { kind: "new", text: "first" },
    { kind: "new", text: "second" },
  ]);
  assert.deepEqual(g, [["new", ["first", "second"]]], "a kind's own changes were reordered");
}

// A kind the site emits that this build has never heard of. Kept, on the end,
// rather than filtered away — dropping it loses a line nobody would notice.
{
  const g = group([
    { kind: "deprecated", text: "going away" },
    { kind: "new", text: "here now" },
  ]);
  assert.deepEqual(
    g,
    [
      ["new", ["here now"]],
      ["deprecated", ["going away"]],
    ],
    "an unknown kind was dropped, so a change the site published never reaches anybody",
  );
}

// Every change survives whatever the kinds are.
{
  const changes = ["security", "fixed", "new", "changed", "odd", "fixed"].map((kind, i) => ({
    kind,
    text: `change ${i}`,
  }));
  const flat = group(changes).flatMap(([, items]) => items);
  assert.equal(flat.length, changes.length, "grouping lost or duplicated a change");
  assert.deepEqual(
    [...flat].sort(),
    changes.map((c) => c.text).sort(),
    "grouping changed the text of something",
  );
}

/* `new Date("2026-09-08")` is UTC midnight, so west of Greenwich a release is
   dated the day before it happened. */
{
  const withTZ = (tz, run) => {
    const before = process.env.TZ;
    process.env.TZ = tz;
    try {
      return run();
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  };

  for (const tz of ["America/Los_Angeles", "Pacific/Kiritimati", "Europe/Oslo"]) {
    const shown = withTZ(tz, () => readableDate("2026-09-08"));
    assert.match(shown, /8/, `the date reads as ${shown} in ${tz}, and the release was the 8th`);
  }

  // Nothing usable in, the string back out, rather than "Invalid Date".
  assert.equal(readableDate("not-a-date"), "not-a-date", "a bad date renders as Invalid Date");
}

/* An install that has joined a server and has nothing recorded ran a build
   where the recording never happened. It is not new. GRYT-1102. */
{
  const r = await run({ seen: null, version: "1.10.3", app: [LINE], joined: true });
  assert.deepEqual(
    r.shown,
    [LINE],
    "an install that has joined servers was treated as fresh, so the release that fixed this says nothing",
  );
  assert.equal(r.seen, "1.10.3", "it showed the line without recording the version");
}

// And the two cases are told apart by what the helper actually reads.
{
  const fn = new Function(
    "getUserValue",
    block(source, "function hasJoinedAnything(): boolean {", "hasJoinedAnything")
      .slice(1, -1)
      .replace("<Record<string, unknown> | null>", ""),
  );
  assert.equal(fn(() => null), false, "no servers entry reads as having joined something");
  assert.equal(fn(() => ({})), false, "an empty servers entry reads as having joined something");
  assert.equal(fn(() => ({ "host:1": {} })), true, "a joined server reads as a fresh install");
}

/* ── it waits for the per-user store ─────────────────────────────────────── */

// Read on mount, the store is empty every launch: a fresh install that says
// nothing, and a write with no user loaded to write against. GRYT-1101.
{
  const r = await run({ seen: "1.10.2", version: "1.11.0", app: [LINE], storeUser: null });
  assert.deepEqual(r.shown, [], "it decided before the user store had loaded");
  assert.deepEqual(r.urls, [], "it fetched the changelog before the store had loaded");
  assert.equal(r.seen, "1.10.2", "it wrote a version before there was a user to write it against");
}

// And the component subscribes rather than reading once.
assert.match(
  source,
  /useEffect\(\(\) => onUserStoreLoaded\(setStoreUser\), \[\]\)/,
  `${SOURCE} no longer subscribes to the user store loading`,
);
assert.match(
  source,
  /\}, \[version, storeUser\]\)/,
  `${SOURCE}'s effect no longer re-runs when the store loads`,
);

/* ── and the store actually says so ──────────────────────────────────────── */

/* Half the fix lives in userStorage. Without it the dialog waits forever. */
const STORE = "src/packages/settings/src/hooks/userStorage.ts";
const store = readFileSync(join(root, STORE), "utf8");

assert.match(
  block(store, "export async function loadForUser(userId: string): Promise<UserData> {", "loadForUser"),
  /markLoaded\(userId\)/,
  `${STORE} fills the cache without telling anybody, so the dialog waits forever`,
);

// And markLoaded does the telling, rather than only being called.
const notified = [];
new Function(
  "userId", "loadedListeners", "setLoadedFor",
  block(store, "function markLoaded(userId: string): void {", "markLoaded")
    .slice(1, -1)
    .replace("loadedFor = userId;", "setLoadedFor(userId);"),
)("user_1", [(id) => notified.push(id)], () => {});
assert.deepEqual(notified, ["user_1"], "markLoaded does not tell its listeners");

console.log(
  "what's new: ok, waits for the store, once per version, quiet on a fresh " +
    "install and with no line; revalidates and retries " +
    `${RETRY_DELAYS_MS.length} times; security first, unknown kinds kept, dates local`,
);
