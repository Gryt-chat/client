/* eslint-env node */

// Runs whatsNew's own effect and WhatsNewDialog's own rows: a modal nobody
// sees twice (GRYT-1083), and a kind it drops is a line nobody reads (1088).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "src/components/whatsNew.tsx";
const FEED = "src/lib/changelogFeed.ts";
const DIALOG = "src/packages/socket/src/components/WhatsNewDialog.tsx";
const source = readFileSync(join(root, SOURCE), "utf8");
const dialog = readFileSync(join(root, DIALOG), "utf8");
const { releasesToShow } = await import(pathToFileURL(join(root, "src/components/whatsNewSince.ts")).href);
/* The fetch and its retries are shared with the security notice now, so they run as
   the feed's own code, with the network and the waiting faked. */
const { CHANGELOG_URL, RETRY_DELAYS_MS, loadChangelog, resetChangelogFeed, sleep } = await import(
  pathToFileURL(join(root, FEED)).href
);

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

/** A function body's types stripped by Node. A bare block holding `return` does not parse alone. */
const strip = (braces) => stripTypeScriptTypes(`async () => ${braces}`).slice("async () => ".length);

/* The second useEffect is the one that decides; the first only subscribes. */
const body = strip(
  block(source.slice(source.indexOf("onUserStoreLoaded(setStoreUser)")), "useEffect(() => {", "the deciding useEffect"),
);

/** The module constant the effect closes over. */
const SEEN_KEY = source.match(/const SEEN_KEY = "([^"]+)"/)?.[1];
assert.ok(SEEN_KEY, `${SOURCE} no longer names the key it remembers the version under`);
assert.match(
  CHANGELOG_URL ?? "",
  /^https:\/\/gryt\.chat\/changelog\.json$/,
  "the changelog is fetched from somewhere other than the site's emitted file",
);

assert.ok(Array.isArray(RETRY_DELAYS_MS) && RETRY_DELAYS_MS.length > 0, `${FEED} no longer retries`);
assert.match(source, /from "\.\.\/lib\/changelogFeed"/, `${SOURCE} fetches the changelog some other way than the shared feed`);

/** `new Function` builds a sync function, and findReleases awaits. */
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** findReleases as itself, calling the real feed with the wait and the network faked. */
const findReleasesBody = strip(
  block(
    source,
    "async function findReleases(version: string, signal: AbortSignal): Promise<Release[] | null> {",
    "findReleases",
  ),
).slice(1, -1);

/** One run of the effect, with the store, the network and the waiting faked. */
async function run({ seen, version, app, offline, storeUser, joined, attempts, abortOn, asked, beta }) {
  /* The feed keeps the last copy for everyone, so each run starts from an app that
     has fetched nothing yet. */
  resetChangelogFeed();
  const store = { value: seen };
  const picks = [];
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

  const fakeSleep = (ms) => {
    slept.push(ms);
    return Promise.resolve();
  };
  const findReleases = new AsyncFunction("loadChangelog", "version", "signal", findReleasesBody).bind(
    null,
    (signal, options) => loadChangelog(signal, { ...options, fetch, sleep: fakeSleep }),
  );

  const fn = new Function(
    "getUserValue", "setUserValue", "findReleases", "setShown", "version", "AbortController", "SEEN_KEY", "storeUser", "hasJoinedAnything", "asked", "releasesToShow", "IS_BETA_BUILD",
    `return (async () => {
       const cleanup = (() => ${body})();
       for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 0));
       return cleanup;
     })();`,
  );

  await fn(
    () => store.value,
    (_k, v) => (store.value = v),
    findReleases,
    (picked) => picks.push(picked),
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
    /* How many times the About page has asked. Zero is a launch nobody asked for,
       which is every case below that does not say otherwise. */
    asked ?? 0,
    releasesToShow,
    beta ?? false,
  );

  /* `shown` is every release drawn, across however many dialogs opened. */
  const shown = picks.flatMap((p) => p.releases);
  return { seen: store.value, shown, picks, fetched, slept, urls: fetched.map((f) => f.url) };
}

const LINE = { version: "1.10.3", date: "2026-09-08", line: "Joining voice waits." };

// The ordinary case: updated, a line exists, it is shown once and recorded.
{
  const r = await run({ seen: "1.10.2", version: "1.10.3", app: [LINE] });
  assert.deepEqual(r.shown, [LINE], "the line for the running version was not shown");
  assert.equal(r.seen, "1.10.3", "the version was not recorded, so it would show again");
}

/* Asked for from the About page. The version already seen is the only one that
   button is ever pressed on, so this is the case it exists for (GRYT-1145). */
{
  const r = await run({ seen: "1.10.3", version: "1.10.3", app: [LINE], asked: 1 });
  assert.deepEqual(r.shown, [LINE], "asking to see the note again showed nothing, on the version already seen");
}

// Asked on a fresh install, which otherwise stays quiet on purpose.
{
  const r = await run({ seen: null, version: "1.10.3", app: [LINE], joined: false, asked: 1 });
  assert.deepEqual(r.shown, [LINE], "asking to see the note on a fresh install showed nothing");
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
  const controller = new AbortController();
  const started = Date.now();
  const waiting = sleep(60_000, controller.signal);
  controller.abort();
  await waiting;
  assert.ok(Date.now() - started < 1_000, "aborting does not cut the wait short");
}

/* ── every release since the last one seen (GRYT-1160) ───────────────────── */

const R9 = { version: "1.11.9", date: "2026-09-10", line: "Nine." };
const R10 = { version: "1.11.10", date: "2026-09-14", line: "Ten." };
const R11 = { version: "1.11.11", date: "2026-09-14", line: "Eleven." };
const BETA = { version: "1.12.0-beta.1", date: "2026-09-15", line: "Beta.", channel: "beta" };

// Two updates at once: both releases, newest first, and the running one recorded.
{
  const r = await run({ seen: "1.11.9", version: "1.11.11", app: [R11, R10, R9] });
  assert.deepEqual(r.shown, [R11, R10], "skipping a version hid the release in between");
  assert.equal(r.picks[0].since, "1.11.9", "the dialog is not told which version it covers since");
  assert.equal(r.seen, "1.11.11", "the running version was not recorded after showing the range");
}

// From About it is the running version alone, even with older ones unseen.
{
  const r = await run({ seen: "1.11.9", version: "1.11.11", app: [R11, R10, R9], asked: 1 });
  assert.deepEqual(r.shown, [R11], "asking from About showed a range instead of the running version");
}

// A stable build is not told about beta lines.
{
  const r = await run({ seen: "1.11.11", version: "1.12.0", app: [{ ...R11, version: "1.12.0" }, BETA, R11] });
  assert.deepEqual(r.shown.map((e) => e.version), ["1.12.0"], "a stable build was shown a beta line");
}

// A beta build is told what the beta brought.
{
  const running = { ...BETA, version: "1.12.0-beta.2" };
  const r = await run({ seen: "1.11.10", version: "1.12.0-beta.2", app: [running, BETA, R11, R10], beta: true });
  assert.deepEqual(
    r.shown.map((e) => e.version),
    ["1.12.0-beta.2", "1.12.0-beta.1", "1.11.11"],
    "a beta build did not see the beta lines since its last version",
  );
}

// The older lines are there but the running one is not: still nothing, still unrecorded.
{
  const r = await run({ seen: "1.11.9", version: "1.11.11", app: [R10, R9] });
  assert.deepEqual(r.shown, [], "the older lines were shown before the running version had one");
  assert.equal(r.seen, "1.11.9", "the range was recorded as seen before any of it was shown");
  assert.equal(r.fetched.length, RETRY_DELAYS_MS.length + 1, "it stopped retrying once older lines arrived");
}

/* ── the dialog, run as its own code ─────────────────────────────────────── */

// Compiled with the TypeScript the client already has. @gryt/ui and the owl are
// stubbed, so a Chip shows its tone as an attribute and the portal draws inline.
const ts = (await import("typescript")).default;
const moduleUrl = (text) => `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const STUBS = {
  "@gryt/ui": moduleUrl(`
    import { createElement as h, Fragment } from ${JSON.stringify(import.meta.resolve("react"))};
    const pass = ({ children }) => h(Fragment, null, children);
    export const Chip = ({ tone, className, children }) => h("span", { className, "data-tone": tone }, children);
    export const Button = pass;
    export const Dialog = { Root: pass, Portal: pass, Backdrop: () => null, Popup: pass, Title: pass, Close: () => null };
  `),
  "@/common": moduleUrl("export const LogoIcon = () => null;"),
};
const compiled = ts
  .transpileModule(dialog, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  .outputText.replace(/from "([^"]+)"/g, (_, spec) => `from "${STUBS[spec] ?? import.meta.resolve(spec)}"`);
const { AREAS, KIND_ORDER, ReleaseBody, WhatsNewDialog, grouped, ordered, readableDate } = await import(
  moduleUrl(`${compiled}\nexport { AREAS, KIND_ORDER, ReleaseBody, grouped, ordered, readableDate };`)
);
const c = (kind, text) => ({ kind, text });

assert.deepEqual(
  KIND_ORDER,
  ["security", "new", "changed", "fixed"],
  "the kinds are drawn in a different order — security below the features is the half people scroll past",
);

// Security leads however the release was written.
assert.deepEqual(
  ordered([c("fixed", "b"), c("security", "a"), c("fixed", "c")]),
  [c("security", "a"), c("fixed", "b"), c("fixed", "c")],
  "the changes are not in KIND_ORDER",
);

// Order inside a kind is the order somebody wrote them in.
assert.deepEqual(
  ordered([c("new", "first"), c("fixed", "x"), c("new", "second")]),
  [c("new", "first"), c("new", "second"), c("fixed", "x")],
  "a kind's own changes were reordered",
);

// A kind the site emits that this build has never heard of. Kept, on the end,
// rather than filtered away — dropping it loses a line nobody would notice.
assert.deepEqual(
  ordered([c("deprecated", "going away"), c("new", "here now")]),
  [c("new", "here now"), c("deprecated", "going away")],
  "an unknown kind was dropped, so a change the site published never reaches anybody",
);

// Two unknown kinds each stay together, in the order they first appear.
assert.deepEqual(
  ordered([c("odd", "1"), c("removed", "2"), c("odd", "3")]),
  [c("odd", "1"), c("odd", "3"), c("removed", "2")],
  "an unknown kind's changes were split up around another one",
);

// Every change survives whatever the kinds are, still paired with its own kind.
{
  const changes = ["security", "fixed", "new", "changed", "odd", "fixed"].map((kind, i) => c(kind, `change ${i}`));
  const out = ordered(changes);
  assert.equal(out.length, changes.length, "ordering lost or duplicated a change");
  const pairs = (list) => list.map((x) => `${x.kind}:${x.text}`).sort();
  assert.deepEqual(pairs(out), pairs(changes), "ordering changed a change, or gave its text another kind");
}

/* ── a pill on every change (GRYT-1214) ──────────────────────────────────── */

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

/** Each list row drawn: the pills in it, and the text beside them. */
function rows(html) {
  const pill = /<span class="whats-new-kind" data-tone="([^"]*)">([^<]*)<\/span>/g;
  return [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, row]) => ({
    pills: [...row.matchAll(pill)].map(([, tone, label]) => `${label}/${tone}`),
    text: row.replace(pill, "").replace(/<[^>]+>/g, ""),
  }));
}

const SEVERAL_FIXES = {
  version: "1.11.22",
  date: "2026-09-15",
  line: "Six things.",
  changes: [
    c("fixed", "Updates said there were none"),
    c("fixed", "A hosted server said reconnecting"),
    c("changed", "Webhook avatars are resized"),
    c("fixed", "The desktop entry listed gryt five times"),
    c("new", "Webhooks post cards"),
    c("security", "Uploads are checked"),
  ],
};

// Three fixes are three rows with three Fixed pills, not one pill over three lines.
{
  const html = renderToStaticMarkup(
    createElement(WhatsNewDialog, { releases: [SEVERAL_FIXES], since: null, capped: false, onClose() {} }),
  );
  assert.deepEqual(
    rows(html),
    [
      { pills: ["Security/warning"], text: "Uploads are checked" },
      { pills: ["New/primary"], text: "Webhooks post cards" },
      { pills: ["Changed/neutral"], text: "Webhook avatars are resized" },
      { pills: ["Fixed/neutral"], text: "Updates said there were none" },
      { pills: ["Fixed/neutral"], text: "A hosted server said reconnecting" },
      { pills: ["Fixed/neutral"], text: "The desktop entry listed gryt five times" },
    ],
    "a change is not its own row with its own pill, in KIND_ORDER with its label and tone",
  );
  assert.doesNotMatch(html, /whats-new-plain/, "a release with changes also drew its one-sentence line");
}

// A kind this build cannot name is labelled with the kind itself, and stays neutral.
{
  const html = renderToStaticMarkup(createElement(ReleaseBody, { line: "x", changes: [c("deprecated", "Going away")] }));
  assert.deepEqual(rows(html), [{ pills: ["deprecated/neutral"], text: "Going away" }], "an unknown kind lost its pill");
}

// Several releases: every release's changes get their pills, and an old release keeps its sentence.
{
  const OLD = { version: "1.9.4", date: "2026-08-20", line: "Joining voice waits for the microphone." };
  const html = renderToStaticMarkup(
    createElement(WhatsNewDialog, { releases: [SEVERAL_FIXES, OLD], since: "1.9.3", capped: false, onClose() {} }),
  );
  const drawn = rows(html);
  assert.equal(drawn.length, SEVERAL_FIXES.changes.length, "the rows across several releases do not match their changes");
  assert.ok(drawn.every((row) => row.pills.length === 1), "a row across several releases has other than one pill");
  assert.match(
    html,
    /<p class="whats-new-plain">Joining voice waits for the microphone\.<\/p>/,
    "a release from before 1.10 lost its one sentence",
  );
}

// The rows share one pill column, so every change's text starts at the same place.
{
  const style = readFileSync(join(root, "src/style.css"), "utf8");
  const rule = (selector) => {
    const at = style.indexOf(`\n${selector} {`);
    assert.notEqual(at, -1, `src/style.css no longer has ${selector}. Move this check with it.`);
    return style.slice(at, style.indexOf("}", at));
  };
  assert.match(rule(".whats-new-changes"), /grid-template-columns:\s*max-content minmax\(0, 1fr\)/, "the pill column is not sized to the widest pill");
  assert.match(rule(".whats-new-change"), /grid-template-columns:\s*subgrid/, "a row sizes its own pill column, so the text no longer lines up");
}

/* ── a heading over each area (GRYT-1339) ────────────────────────────────── */

const at = (area, kind, text) => ({ kind, area, text });

// The same seven as the site's AREAS, in the same order. An eighth there lands under its own id here.
assert.deepEqual(
  [...AREAS],
  [
    ["voice", "Voice & video"],
    ["chat", "Chat"],
    ["notifications", "Notifications"],
    ["servers", "Servers & invites"],
    ["settings", "Settings & app"],
    ["phone", "Phone"],
    ["self-hosting", "Self-hosting"],
  ],
  "the areas are named or ordered differently from the site's AREAS",
);

/** Each group's heading and its changes' text, for comparing. */
const byArea = (changes) => grouped(changes).map(([heading, list]) => [heading, list.map((x) => x.text)]);

// AREAS order however the release was written, as written inside an area, and no area last.
assert.deepEqual(
  byArea([c("fixed", "loose"), at("chat", "new", "c1"), at("voice", "fixed", "v1"), at("chat", "fixed", "c2")]),
  [
    ["Voice & video", ["v1"]],
    ["Chat", ["c1", "c2"]],
    ["Other", ["loose"]],
  ],
  "changes are not under one heading per area in AREAS order, with Other last",
);

// An area the site added after this build keeps its own name, before Other rather than dropped.
assert.deepEqual(
  byArea([c("fixed", "loose"), at("bots", "new", "b"), at("phone", "fixed", "p")]),
  [
    ["Phone", ["p"]],
    ["bots", ["b"]],
    ["Other", ["loose"]],
  ],
  "an unknown area was dropped or put somewhere other than before Other",
);

// Anything that isn't a string is no area, rather than a heading reading 7 or null.
assert.deepEqual(
  byArea([at(7, "fixed", "seven"), at(null, "fixed", "none")]),
  [["Other", ["seven", "none"]]],
  "an area that isn't a string became a heading of its own",
);

/** What the list draws, in order: each heading as `# name` and each row as `pill: text`. */
function drawn(html) {
  const parts = /<(h[34]) class="whats-new-area">([^<]*)<\/h[34]>|<li\b[^>]*>([\s\S]*?)<\/li>/g;
  return [...html.matchAll(parts)].map(([, level, heading, row]) =>
    heading !== undefined
      ? `${level} ${heading.replace(/&amp;/g, "&")}`
      : row.replace(/<span class="whats-new-kind" data-tone="[^"]*">([^<]*)<\/span>/, "$1: ").replace(/<[^>]+>/g, ""),
  );
}

const SPREAD = {
  version: "1.11.32",
  date: "2026-09-21",
  line: "Five things in three places.",
  changes: [
    at("servers", "new", "Copy an invite link"),
    at("voice", "fixed", "A call reconnects to its own server"),
    at("chat", "changed", "Long pastes become a file"),
    at("voice", "changed", "The screen share gets the upload first"),
    c("fixed", "Something nobody filed"),
  ],
};

// One release across areas: a heading over each, in AREAS order, with the kinds ordered inside it.
{
  const html = renderToStaticMarkup(
    createElement(WhatsNewDialog, { releases: [SPREAD], since: null, capped: false, onClose() {} }),
  );
  assert.deepEqual(
    drawn(html),
    [
      "h3 Voice & video",
      "Changed: The screen share gets the upload first",
      "Fixed: A call reconnects to its own server",
      "h3 Chat",
      "Changed: Long pastes become a file",
      "h3 Servers & invites",
      "New: Copy an invite link",
      "h3 Other",
      "Fixed: Something nobody filed",
    ],
    "a release across areas is not drawn as a heading per area, AREAS first and Other last",
  );
}

// Every change in one area, or a feed with no areas at all: no headings, and the rows as they always were.
for (const changes of [
  SEVERAL_FIXES.changes.map((change) => ({ ...change, area: "settings" })),
  SEVERAL_FIXES.changes,
]) {
  const html = renderToStaticMarkup(createElement(ReleaseBody, { line: "x", changes }));
  assert.doesNotMatch(html, /whats-new-area/, "a release whose changes share one area, or have none, got headings");
  assert.deepEqual(
    drawn(html),
    [
      "Security: Uploads are checked",
      "New: Webhooks post cards",
      "Changed: Webhook avatars are resized",
      "Fixed: Updates said there were none",
      "Fixed: A hosted server said reconnecting",
      "Fixed: The desktop entry listed gryt five times",
    ],
    "a release with one area or none is not the plain list of rows it was before areas",
  );
}

// Several releases: headings one level under the version, only where a release spans areas.
{
  const OLD = { version: "1.9.4", date: "2026-08-20", line: "Joining voice waits for the microphone." };
  const html = renderToStaticMarkup(
    createElement(WhatsNewDialog, { releases: [SPREAD, SEVERAL_FIXES, OLD], since: "1.9.3", capped: false, onClose() {} }),
  );
  const [spread, fixes, old] = html.split('<section class="whats-new-release">').slice(1);
  assert.deepEqual(
    drawn(spread).filter((part) => part.startsWith("h")),
    ["h4 Voice & video", "h4 Chat", "h4 Servers & invites", "h4 Other"],
    "the headings in a range of releases are not one level under the version's",
  );
  assert.doesNotMatch(fixes, /whats-new-area/, "a release with no areas got headings in a range");
  assert.equal(drawn(fixes).length, SEVERAL_FIXES.changes.length, "a release with no areas lost rows in a range");
  assert.match(old, /whats-new-plain/, "a release from before 1.10 lost its one sentence in a range");
}

// The areas share the release's pill column too, and it stacks with the rest on a narrow card.
{
  const style = readFileSync(join(root, "src/style.css"), "utf8");
  const rule = (selector) => {
    const found = style.indexOf(`\n${selector} {`);
    assert.notEqual(found, -1, `src/style.css no longer has ${selector}. Move this check with it.`);
    return style.slice(found, style.indexOf("}", found));
  };
  assert.match(rule(".whats-new-areas"), /grid-template-columns:\s*max-content minmax\(0, 1fr\)/, "the areas don't share one pill column");
  assert.match(rule(".whats-new-areas > .whats-new-changes"), /grid-template-columns:\s*subgrid/, "an area sizes its own pill column");
  assert.match(style, /\.whats-new-release > \.whats-new-areas \{\s*display: grid;[^}]*subgrid/, "a release's areas size their own pill column in a range");
  assert.match(
    style.slice(style.indexOf("@container (max-width: 380px)")),
    /^[^}]*\.whats-new-areas,[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    "the areas keep a pill column on a card too narrow for one",
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
/* That storeUser is a dependency, not that it is the only one. The About page's
   request is one too (GRYT-1145), and an exact list broke when it arrived. */
assert.match(
  source,
  /\}, \[version, storeUser(, [a-zA-Z]+)*\]\)/,
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
    `${RETRY_DELAYS_MS.length} times; a pill on every change, security first, unknown kinds kept, ` +
    "a heading per area only when there are two, dates local",
);
