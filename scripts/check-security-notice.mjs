/* eslint-env node */

// Who is told that a server has a known security issue, and when. The list ships empty,
// so everything here runs against made-up notices. GRYT-1243.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fileUrl = (path) => pathToFileURL(join(root, path)).href;
const read = (path) => readFileSync(join(root, path), "utf8");

const FEED = "src/lib/changelogFeed.ts";
const NOTICES = "src/lib/securityNotices.ts";
const BANNER = "src/packages/socket/src/components/SecurityNoticeBanner.tsx";
const VIEW = "src/packages/socket/src/components/serverView.tsx";

/* Node has no localStorage. A Map behind the same three calls, installed before anything reads it. */
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => void storage.set(key, String(value)),
  removeItem: (key) => void storage.delete(key),
};

const feed = await import(fileUrl(FEED));
const notices = await import(fileUrl(NOTICES));
const {
  dismissalSnapshot,
  dismissedNotices,
  dismissNotices,
  managesServer,
  noticeForServer,
  parseSecurityNotices,
  securityNoticeText,
  subscribeDismissals,
} = notices;

const notice = (id, fixedIn, extra = {}) => ({
  id,
  surface: "server",
  fixedIn,
  title: `Fix ${id}`,
  url: `https://gryt.chat/blog/${id}`,
  published: "2026-01-02",
  ...extra,
});

const NONE = new Set();
const shown = (list, version, dismissed = NONE) => noticeForServer(list, version, dismissed);

/* ── versions ────────────────────────────────────────────────────────────── */

{
  const list = [notice("a", "2.3.5")];
  assert.equal(shown(list, "2.3.4")?.fixedIn, "2.3.5", "a server one patch below the fix was not told");
  assert.equal(shown(list, "1.99.99")?.fixedIn, "2.3.5", "an older minor was not told");
  for (const version of ["2.3.5", "2.3.6", "2.4.0", "3.0.0"]) {
    assert.equal(shown(list, version), null, `a server on ${version} was told to update to 2.3.5`);
  }

  // A prerelease sits below its release, so a beta of the fixed version still needs the release.
  assert.equal(shown(list, "2.3.5-beta.2")?.fixedIn, "2.3.5", "2.3.5-beta.2 counted as having the 2.3.5 fix");
  assert.equal(shown(list, "2.3.6-beta.1"), null, "a beta of a later version was told to update");
}

{
  const list = [notice("b", "2.4.0-beta.3")];
  assert.equal(shown(list, "2.4.0-beta.2")?.fixedIn, "2.4.0-beta.3", "beta.2 was not below beta.3");
  assert.equal(shown(list, "2.4.0-beta.3"), null, "the beta with the fix was told to update");
  assert.equal(shown(list, "2.4.0-beta.10"), null, "beta.10 compared as text and came out below beta.3");
  assert.equal(shown(list, "2.4.0"), null, "the release was told to update to one of its own betas");
  assert.equal(shown(list, "2.3.9")?.fixedIn, "2.4.0-beta.3", "the version before was not told");
}

// A server that reports no version, or one this can't read, is told nothing.
for (const version of [undefined, null, "", "latest", "2.3", "v2.3.4", "2.3.4.1", 7]) {
  assert.equal(shown([notice("a", "2.3.5")], version), null, `a server reporting ${JSON.stringify(version)} was told`);
}

// Only server notices are about a server's version. The others number their own releases.
for (const surface of ["voice", "images", "app"]) {
  assert.equal(shown([notice("a", "9.0.0", { surface })], "2.3.4"), null, `a ${surface} notice was shown for a server`);
}

/* ── an empty list, and a file from before the list existed ──────────────── */

assert.deepEqual(parseSecurityNotices([]), []);
assert.deepEqual(parseSecurityNotices(undefined), [], "a changelog without securityNotices broke the parse");
assert.deepEqual(parseSecurityNotices({ id: "a" }), []);
assert.equal(shown(parseSecurityNotices([]), "0.0.1"), null, "an empty list showed something");
assert.equal(shown(parseSecurityNotices(undefined), "0.0.1"), null, "no list showed something");

/* ── what the parse lets through ─────────────────────────────────────────── */

{
  const good = notice("GHSA-aaaa-bbbb-cccc", "2.3.5");
  assert.deepEqual(parseSecurityNotices([good]), [good], "a well-formed notice was changed on the way in");

  const bad = [
    null,
    "a",
    { ...good, url: "http://gryt.chat/blog/a" },
    { ...good, url: "javascript:alert(1)" },
    { ...good, url: undefined },
    { ...good, fixedIn: "2.3" },
    { ...good, fixedIn: "v2.3.5" },
    { ...good, fixedIn: undefined },
    { ...good, id: "" },
    { ...good, id: "has spaces" },
    { ...good, id: 7 },
    { ...good, surface: undefined },
  ];
  assert.deepEqual(parseSecurityNotices([...bad, good]), [good], "a malformed notice got through the parse");
  assert.equal(parseSecurityNotices([{ ...good, title: undefined }])[0]?.title, "", "a notice without a title was dropped");
}

/* ── several notices at once ─────────────────────────────────────────────── */

{
  // Newest first, as the site writes them. The older notice has the lower fix.
  const newer = notice("newer", "2.3.5");
  const older = notice("older", "2.1.0");

  const both = shown([newer, older], "2.0.9");
  assert.equal(both?.fixedIn, "2.3.5", "the version to update to is not the highest fix");
  assert.equal(both?.url, newer.url, "the link is not the highest fix");
  assert.deepEqual(both?.ids, ["newer", "older"], "dismissing would not cover every notice the server is below");

  // One dismissed: still shown, still asking for the highest fix, linking to the one not dismissed.
  const afterNewer = shown([newer, older], "2.0.9", new Set(["newer"]));
  assert.equal(afterNewer?.fixedIn, "2.3.5", "dismissing one notice lowered the version it asks for");
  assert.equal(afterNewer?.url, older.url, "the link still points at the dismissed notice");
  assert.deepEqual(afterNewer?.ids, ["newer", "older"], "dismissing again would not cover the notice dismissed before");

  assert.equal(shown([newer, older], "2.0.9", new Set(["newer", "older"])), null, "both dismissed and still shown");

  // A server above the older fix is only below the newer one.
  assert.deepEqual(shown([newer, older], "2.2.0")?.ids, ["newer"], "a fix this server already has is listed");
  assert.equal(shown([newer, older], "2.2.0", new Set(["newer"])), null, "a notice it already has the fix for came back");
}

/* ── who sees it ─────────────────────────────────────────────────────────── */

assert.equal(managesServer({ role: "owner" }), true, "the owner role is not told");
assert.equal(managesServer({ role: "admin" }), true, "the admin role is not told");
assert.equal(managesServer({ is_owner: true, role: "member" }), true, "the owner holding another role is not told");
assert.equal(managesServer({ is_owner: true }), true, "an owner on a server too old to send a role is not told");
for (const info of [{ role: "member" }, { role: "mod" }, { role: "guest" }, { role: "Admin" }, { is_owner: false }, {}, undefined]) {
  assert.equal(managesServer(info), false, `${JSON.stringify(info)} is told`);
}

/* ── dismissing ──────────────────────────────────────────────────────────── */

{
  let heard = 0;
  const stop = subscribeDismissals(() => heard++);

  dismissNotices("chat.example.com", ["newer"]);
  assert.deepEqual([...dismissedNotices("chat.example.com")], ["newer"]);
  assert.equal(heard, 1, "dismissing told nobody, so the banner stays up");
  assert.deepEqual([...dismissedNotices("127.0.0.1:5003")], [], "a dismissal on one server hid it on another");

  // Stored rather than held in memory, so it outlives a reload.
  const stored = dismissalSnapshot();
  assert.deepEqual(JSON.parse(stored), { "chat.example.com": ["newer"] }, "the dismissal was not stored");
  assert.deepEqual([...dismissedNotices("chat.example.com", stored)], ["newer"]);

  dismissNotices("chat.example.com", ["older"]);
  assert.deepEqual([...dismissedNotices("chat.example.com")], ["newer", "older"], "a second dismissal lost the first");
  dismissNotices("chat.example.com", ["newer"]);
  assert.deepEqual([...dismissedNotices("chat.example.com")], ["newer", "older"], "dismissing twice stored the id twice");
  assert.equal(JSON.parse(dismissalSnapshot())["chat.example.com"].length, 2, "dismissing twice stored the id twice");

  // And a notice published after the dismissal shows again.
  const later = notice("later", "2.4.0");
  const back = shown([later, notice("newer", "2.3.5"), notice("older", "2.1.0")], "2.0.9", dismissedNotices("chat.example.com"));
  assert.equal(back?.url, later.url, "a new notice stayed hidden behind an old dismissal");

  storage.set("gryt.dismissedSecurityNotices", "{not json");
  assert.deepEqual([...dismissedNotices("chat.example.com")], [], "a broken store threw instead of reading as nothing");
  dismissNotices("chat.example.com", ["later"]);
  assert.deepEqual([...dismissedNotices("chat.example.com")], ["later"], "a broken store could not be written over");

  stop();
  storage.clear();
}

/* ── the feed both readers share ─────────────────────────────────────────── */

const { getChangelog, loadChangelog, resetChangelogFeed, subscribeChangelog, RETRY_DELAYS_MS } = feed;

/** A site that answers with `body`, counting how often it is asked. */
function site(body) {
  const calls = [];
  const fetch = (url, init) => {
    calls.push({ url, cache: init?.cache });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };
  return { calls, fetch };
}

const noWait = () => Promise.resolve();

{
  resetChangelogFeed();
  const { calls, fetch } = site({ app: [], securityNotices: [notice("a", "2.3.5")] });
  let heard = 0;
  const stop = subscribeChangelog(() => heard++);

  const signal = new AbortController().signal;
  const [one, two] = await Promise.all([loadChangelog(signal, { fetch }), loadChangelog(signal, { fetch })]);
  assert.equal(calls.length, 1, "two readers at once made two requests");
  assert.equal(one, two);
  assert.equal(getChangelog(), one, "the copy was not kept for the next reader");
  assert.equal(heard, 1, "subscribers were not told a copy arrived");
  assert.equal(calls[0].cache, "no-cache", "the changelog is read from the HTTP cache");

  await loadChangelog(signal, { fetch, maxAgeMs: 60_000 });
  assert.equal(calls.length, 1, "a copy a moment old was fetched again");

  await loadChangelog(signal, { fetch, maxAgeMs: 0 });
  assert.equal(calls.length, 2, "a reader asking for a fresh copy was given the old one");

  // A copy that doesn't have what a reader waits for is asked for again, on the delays.
  const slept = [];
  const waited = await loadChangelog(signal, {
    fetch,
    maxAgeMs: Infinity,
    accept: (data) => data.app.length > 0,
    sleep: (ms) => (slept.push(ms), Promise.resolve()),
  });
  assert.equal(waited, null);
  assert.deepEqual(slept, RETRY_DELAYS_MS, "it did not retry on the delays written down");

  // An answer that isn't a changelog doesn't replace the one there is.
  const kept = getChangelog();
  for (const body of [null, [1, 2], "changelog"]) {
    await loadChangelog(signal, { fetch: site(body).fetch, sleep: noWait });
    assert.equal(getChangelog(), kept, `an answer of ${JSON.stringify(body)} replaced the changelog`);
  }

  // Gone before the first answer: no second request.
  const gone = new AbortController();
  const count = site({ app: [] });
  const pending = loadChangelog(gone.signal, { fetch: count.fetch, accept: () => false, sleep: noWait });
  gone.abort();
  assert.equal(await pending, null);
  assert.equal(count.calls.length, 1, "it kept asking after the reader had gone");

  stop();
  resetChangelogFeed();
}

/* ── the banner, run as its own code ─────────────────────────────────────── */

// Compiled with the client's TypeScript. @gryt/ui and the icons are stubbed; the two lib modules are the real ones.
const ts = (await import("typescript")).default;
const moduleUrl = (text) => `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const react = import.meta.resolve("react");
const STUBS = {
  "@gryt/ui": moduleUrl(`
    import { createElement as h } from ${JSON.stringify(react)};
    export const IconButton = ({ children, onClick, ...rest }) =>
      h("button", { "aria-label": rest["aria-label"] }, children);
  `),
  "../../../../lib/icons": moduleUrl("export const PiShieldWarningFill = () => null; export const PiX = () => null;"),
  "../../../../lib/changelogFeed": fileUrl(FEED),
  "../../../../lib/securityNotices": fileUrl(NOTICES),
};
const compiled = ts
  .transpileModule(read(BANNER), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  .outputText.replace(/from "([^"]+)"/g, (_, spec) => `from "${STUBS[spec] ?? import.meta.resolve(spec)}"`);
const { SecurityNoticeBanner } = await import(moduleUrl(compiled));
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

assert.equal(
  securityNoticeText("2.3.5", false),
  "This server has a known security issue. Update it to 2.3.5 or later.",
  "the notice for a server somebody runs elsewhere says something else",
);
assert.match(securityNoticeText("2.3.5", true), /^This server has a known security issue\. Update Gryt\b.*2\.3\.5 or later\.$/);

/** Loads a changelog into the shared feed the way the site would serve it. */
async function serve(body) {
  resetChangelogFeed();
  await loadChangelog(new AbortController().signal, { fetch: site(body).fetch });
}

const draw = (props) =>
  renderToStaticMarkup(
    createElement(SecurityNoticeBanner, { host: "chat.example.com", hostedHere: false, ...props }),
  );

{
  const a = notice("a", "2.3.5");
  await serve({ app: [], securityNotices: [a] });

  const owner = draw({ serverInfo: { role: "owner", is_owner: true, version: "2.3.4" } });
  assert.match(owner, /role="status"/);
  assert.match(owner, /This server has a known security issue\. Update it to 2\.3\.5 or later\./, "the owner was not told");
  assert.match(owner, new RegExp(`<a [^>]*href="${a.url}"[^>]*>Details</a>`), "the link is not the notice's");
  assert.match(owner, /target="_blank"/);
  assert.match(owner, /rel="noopener noreferrer"/);

  assert.match(draw({ serverInfo: { role: "admin", version: "2.3.4" } }), /Update it to 2\.3\.5/, "an admin was not told");
  assert.equal(draw({ serverInfo: { role: "member", version: "2.3.4" } }), "", "a member was told");
  assert.equal(draw({ serverInfo: { role: "mod", version: "2.3.4" } }), "", "a moderator was told");
  assert.equal(draw({ serverInfo: undefined }), "", "a server with no details yet drew a notice");
  assert.equal(draw({ serverInfo: { role: "owner", version: "2.3.5" } }), "", "a server with the fix was told");
  assert.equal(draw({ serverInfo: { role: "owner" } }), "", "a server with no version was told");

  const hosted = draw({ serverInfo: { role: "owner", version: "2.3.4" }, hostedHere: true });
  assert.ok(hosted.includes(securityNoticeText("2.3.5", true)), "a server this app hosts was not told to update Gryt");

  // Dismissed on this server only, and a new notice brings it back.
  dismissNotices("chat.example.com", ["a"]);
  assert.equal(draw({ serverInfo: { role: "owner", version: "2.3.4" } }), "", "a dismissed notice is still drawn");
  assert.match(draw({ host: "other.example.com", serverInfo: { role: "owner", version: "2.3.4" } }), /Update it to 2\.3\.5/);
  await serve({ app: [], securityNotices: [notice("b", "2.3.6"), a] });
  assert.match(draw({ serverInfo: { role: "owner", version: "2.3.4" } }), /Update it to 2\.3\.6/, "a newer notice stayed hidden");
  storage.clear();

  await serve({ app: [], securityNotices: [] });
  assert.equal(draw({ serverInfo: { role: "owner", version: "0.0.1" } }), "", "the empty list drew a notice");
  await serve({ app: [] });
  assert.equal(draw({ serverInfo: { role: "owner", version: "0.0.1" } }), "", "a changelog from before the list drew a notice");
  resetChangelogFeed();
}

/* ── wiring the render above can't see ──────────────────────────────────── */

{
  const banner = read(BANNER);
  // Only an owner or admin causes a request to gryt.chat; everybody else never asks.
  assert.match(banner, /const feed = useChangelog\(manages\);/, `${BANNER} fetches the changelog for everybody`);
  assert.match(banner, /if \(!wanted\) return;\s*const abort = new AbortController\(\);/, `${BANNER} fetches before checking the role`);
  assert.match(banner, /onClick=\{\(\) => dismissNotices\(host, notice\.ids\)\}/, `${BANNER} dismisses something other than every notice shown`);

  const view = read(VIEW);
  assert.match(
    view,
    /\{!dmSpace && currentConnectionStatus === "connected" && \(\s*<SecurityNoticeBanner host=\{host\} serverInfo=\{serverDetails\.server_info\} hostedHere=\{!!hostedHere\} \/>/,
    `${VIEW} no longer draws the security notice for a connected server, with its details and whether this app hosts it`,
  );
}

console.log(
  "security notice: ok, versions and betas, owners and admins only, dismissed per server and id, " +
    "one request shared with what's new, nothing for an empty list",
);
