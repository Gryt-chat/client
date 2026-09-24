/* eslint-env node */

// The server version chip opens that server's release notes (GRYT-1413). The range and
// the dialog run as their own code; the chip and the dialog it opens are read off source.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SINCE = "src/components/whatsNewSince.ts";
const DIALOG = "src/packages/socket/src/components/WhatsNewDialog.tsx";
const NOTES = "src/packages/socket/src/components/ServerReleaseNotes.tsx";
const MODAL = "src/packages/socket/src/components/ServerSettingsModal.tsx";
const read = (path) => readFileSync(join(root, path), "utf8");

const { releasesAhead, MAX_RELEASES } = await import(pathToFileURL(join(root, SINCE)).href);

const rel = (version, extra = {}) => ({ version, date: "2026-09-22", line: `Line for ${version}.`, ...extra });
const versions = (picked) => picked.releases.map((r) => r.version);

/* ── the range ───────────────────────────────────────────────────────────── */

const SERVER = [
  rel("1.10.23"),
  rel("1.10.22"),
  rel("1.10.21", { changes: [{ kind: "fixed", text: "A fix." }, { kind: "security", text: "A hole closed." }] }),
  rel("1.10.20"),
  rel("1.10.19"),
  rel("1.10.24-beta.1", { channel: "beta" }),
];

// After the one it runs, up to and including the newest, newest first.
{
  const p = releasesAhead(SERVER, "1.10.20", "1.10.23", false);
  assert.deepEqual(versions(p), ["1.10.23", "1.10.22", "1.10.21"], "not every release between running and latest");
  assert.equal(p.capped, false);
}

// Nothing when it already runs the newest, so there is no list to draw.
assert.deepEqual(versions(releasesAhead(SERVER, "1.10.23", "1.10.23", false)), [], "an up-to-date server has notes ahead");

// A beta line only for a server on beta, and compared as versions rather than as text.
assert.ok(!versions(releasesAhead(SERVER, "1.10.9", "1.10.23", false)).includes("1.10.24-beta.1"), "a beta reached stable");
assert.deepEqual(
  versions(releasesAhead(SERVER, "1.10.22", "1.10.24-beta.1", true)),
  ["1.10.24-beta.1", "1.10.23"],
  "a server on beta does not see the beta line, or the release before it",
);

// Capped like the app's own, and a line the site lists twice is shown once.
{
  const many = Array.from({ length: MAX_RELEASES + 4 }, (_, i) => rel(`1.10.${i + 1}`));
  const p = releasesAhead([...many, many[3]], "1.10.0", `1.10.${MAX_RELEASES + 4}`, false);
  assert.equal(p.releases.length, MAX_RELEASES, "the list was not capped");
  assert.equal(p.releases[0].version, `1.10.${MAX_RELEASES + 4}`, "the cap kept the oldest rather than the newest");
  assert.equal(p.capped, true);
  assert.equal(new Set(versions(p)).size, p.releases.length, "a release was listed twice");
}

/* ── the dialog and the notes, run as their own code ─────────────────────── */

// Compiled as check-whats-new does it: @gryt/ui drawn inline, icons as marks, and the
// notes' own imports pointed at stubs so the feed and the hosted list are what we say.
const ts = (await import("typescript")).default;
const react = JSON.stringify(import.meta.resolve("react"));
const moduleUrl = (text) => `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const compile = (source, stubs) =>
  ts
    .transpileModule(source, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(/from "([^"]+)"/g, (_, spec) => `from "${stubs[spec] ?? import.meta.resolve(spec)}"`);

const icons = moduleUrl(`
  import { createElement as h } from ${react};
  ${[...new Set([...read(DIALOG).matchAll(/\bPi[A-Z]\w+/g), ...read(NOTES).matchAll(/\bPi[A-Z]\w+/g)].map((m) => m[0]))]
    .map((name) => `export const ${name} = ({ className }) => h("i", { className, "data-icon": ${JSON.stringify(name)} });`)
    .join("\n  ")}
`);
const dialogUrl = moduleUrl(
  compile(read(DIALOG), {
    "@gryt/ui": moduleUrl(`
      import { createElement as h, Fragment } from ${react};
      const pass = ({ children }) => h(Fragment, null, children);
      export const Chip = ({ tone, className, children }) => h("span", { className, "data-tone": tone }, children);
      export const Button = pass;
      export const Dialog = { Root: pass, Portal: pass, Backdrop: () => null, Popup: pass, Title: ({ children }) => h("h2", null, children), Close: () => null };
    `),
    "@/common": moduleUrl("export const LogoIcon = () => null;"),
    "../../../../lib/icons": icons,
  }),
);

globalThis.__feed = null;
globalThis.__hosted = [];
const notesSource = read(NOTES);
const { ServerReleaseNotes } = await import(
  moduleUrl(
    compile(notesSource, {
      "@/settings/src/hooks/useEmbeddedServer": moduleUrl("export const useEmbeddedServer = () => ({ servers: globalThis.__hosted });"),
      "@/settings/src/hostedServers": pathToFileURL(join(root, "src/packages/settings/src/hostedServers.ts")).href,
      "../../../../components/whatsNewSince": pathToFileURL(join(root, SINCE)).href,
      "../../../../lib/changelogFeed": moduleUrl(`
        export const getChangelog = () => globalThis.__feed;
        export const subscribeChangelog = () => () => {};
        export const loadChangelog = () => new Promise(() => {});
      `),
      "../../../../lib/icons": icons,
      "./WhatsNewDialog": dialogUrl,
    }),
  )
);

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const text = (html) => html.replace(/<br\/?>/g, "\n").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;|&rsquo;|’/g, "'").replace(/\s+/g, " ");
const notes = (props) =>
  renderToStaticMarkup(createElement(ServerReleaseNotes, { host: "chat.example.org", running: "1.10.20", latest: "1.10.23", beta: false, onClose() {}, ...props }));

// Three behind: three versions under "not on this server yet", security in its own block.
{
  globalThis.__feed = { app: [rel("1.11.39")], server: SERVER };
  const html = notes();
  const said = text(html);
  assert.match(said, /This server runs 1\.10\.20/, "the dialog does not say what the server runs");
  assert.match(said, /3 newer releases, up to 1\.10\.23/, "the dialog does not say how far behind it is");
  assert.match(said, /None of this is on the server yet/, "the notes read as what the server already has");
  assert.match(html, /data-whats-new-ahead[^>]*>\s*<h3 class="whats-new-area">[\s\S]*Not on this server yet/, "the list has no heading saying it is ahead");
  const listed = [...html.matchAll(/<h3 class="whats-new-version">([^<·]+)·/g)].map((m) => m[1].trim());
  assert.deepEqual(listed, ["1.10.23", "1.10.22", "1.10.21"], "the versions between are not all listed, newest first");
  assert.match(html, /whats-new-security[\s\S]*A hole closed\./, "a security fix in range lost its block");
  assert.doesNotMatch(said, /Line for 1\.11\.39|Line for 1\.10\.20 /, "an app line, or the running version's, was listed");
}

// How to update: all three ways when this app does not host it, with the commands the docs give.
{
  const said = text(notes());
  assert.match(said, /Gryt CLI gryt pull <server>/, "the CLI route lost gryt pull");
  assert.match(said, /Docker Compose .*docker compose pull docker compose up -d/, "the Compose route is not pull, then up -d");
  assert.match(said, /Gryt desktop app Nothing to do/, "the desktop app route is missing");
}

// Hosted by this app: just that there is nothing to do.
{
  globalThis.__hosted = [{ id: "s1", status: "running", config: null, error: null, serverUrl: "http://127.0.0.1:5003" }];
  const said = text(notes({ host: "127.0.0.1:5003" }));
  assert.match(said, /This app hosts the server, so there's nothing to do/, "a server this app hosts is told to run a command");
  assert.doesNotMatch(said, /gryt pull|docker compose/, "a server this app hosts is shown commands");
  globalThis.__hosted = [];
}

// No list, never an empty one: loading before the feed, a plain line when the site has none yet.
{
  globalThis.__feed = null;
  assert.match(text(notes()), /Loading the release notes/, "no feed yet draws an empty dialog");
  assert.doesNotMatch(notes(), /Not on this server yet/, "a heading over nothing");
}

/* ── the chip opens it, and only while there is an update ────────────────── */

const modal = read(MODAL);
assert.match(
  modal,
  /\{versionStatus\?\.server\.updateAvailable && \(\s*<button[\s\S]*?onClick=\{\(\) => setNotesOpen\(true\)\}[\s\S]*?<Chip tone="warning">/,
  `${MODAL}: the server chip no longer opens the notes`,
);
assert.match(modal, /serverUpdate = versionStatus\?\.server\.updateAvailable \? versionStatus\.server : null/, `${MODAL}: the notes can open without an update`);
assert.match(modal, /\{notesOpen && serverUpdate && \(\s*<ServerReleaseNotes/, `${MODAL}: the notes render without an update to describe`);
assert.match(notesSource, /<WhatsNewDialog\b/, `${NOTES} draws something other than the app's own dialog`);
assert.match(notesSource, /feed\.server/, `${NOTES} reads a surface other than the server's`);

console.log("server release notes: ok, the range after running up to latest, betas only on beta, capped; ahead framing, security block, three routes or none when hosted here, no empty list, opened only from an update chip");
