/* eslint-env node */

// Manage server, in the rail's menu and the server header's, for a server this app hosts.
// Only for those, never in a browser, and it lands on that server's card. GRYT-1216.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  hostedServerAt,
  manageServerTab,
  serverToManage,
} from "../src/packages/settings/src/hostedServers.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const RAIL = "src/components/sidebar.tsx";
const HEADER = "src/packages/socket/src/components/ServerHeader.tsx";
const VIEW = "src/packages/socket/src/components/serverView.tsx";
const LAYOUTS = [
  "src/packages/socket/src/components/ServerSidebar.tsx",
  "src/packages/socket/src/components/MobileServerView.tsx",
];
const HOOK = "src/packages/settings/src/hooks/useEmbeddedServer.ts";
const ELECTRON = "src/lib/electron.ts";
const SETTINGS = "src/packages/settings/src/components/settings.tsx";
const MY_SERVERS = "src/packages/settings/src/components/myServersSettings.tsx";
const MANAGER = "electron/embeddedServerManager.ts";

const HOST = "127.0.0.1:5010";
const hostedAs = (status) => ({
  id: "cozy-den-1a2b3c",
  status,
  config: null,
  error: null,
  serverUrl: `http://${HOST}`,
});

/* ── which rail entries get it ───────────────────────────────────────────── */

/* Every status the manager can report, read from its own type. Stopped matters most:
   the rail's menu is the way back to a server that can no longer be opened. */
const LIFECYCLE = (() => {
  const union = read(MANAGER).match(/export type ServerStatus = ([^;]+);/);
  assert.ok(union, `${MANAGER} no longer declares ServerStatus. Move this check with it.`);
  return [...union[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
})();
assert.ok(LIFECYCLE.includes("stopped"), `${MANAGER} has no stopped status, so this reads nothing`);

for (const status of LIFECYCLE) {
  const server = hostedAs(status);
  assert.equal(hostedServerAt(HOST, [server]), server, `a ${status} server this app hosts gets no Manage server`);
}

{
  const hosted = [hostedAs("running"), { ...hostedAs("running"), id: "other-4d5e6f", serverUrl: "http://127.0.0.1:5020" }];
  for (const remote of ["gryt.chat", "ws1.sivert.io", "127.0.0.1:5011", "192.168.1.20:5010", "localhost:5010", ""]) {
    assert.equal(hostedServerAt(remote, hosted), null, `"${remote}" is not a server this app hosts, and got Manage server`);
  }
  assert.equal(hostedServerAt("127.0.0.1:5020", hosted)?.id, "other-4d5e6f", "the second hosted server was matched to the wrong card");
  assert.equal(hostedServerAt("", [{ ...hostedAs("stopped"), serverUrl: null }]), null, "a server with no address matched an empty host");
}

/* ── never in a browser ──────────────────────────────────────────────────── */

/* useEmbeddedServer as written, with just enough React to mount it: state, callbacks
   and effects that rerun when their deps change. */
const useEmbeddedServerWith = new Function(
  "useState",
  "useEffect",
  "useCallback",
  "getElectronAPI",
  `${stripTypeScriptTypes(read(HOOK))
    .replace(/^import[\s\S]*?from "[^"]+";$/gm, "")
    .replace(/^export /gm, "")}\nreturn useEmbeddedServer;`,
);

function mount(api) {
  const slots = [];
  let slot = 0;
  let effects = [];
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

  const useState = (init) => {
    const i = slot++;
    if (!(i in slots)) slots[i] = typeof init === "function" ? init() : init;
    return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
  };
  const useCallback = (fn, deps) => {
    const i = slot++;
    if (!(i in slots) || !same(slots[i].deps, deps)) slots[i] = { fn, deps };
    return slots[i].fn;
  };
  const useEffect = (fn, deps) => {
    const i = slot++;
    if (i in slots && same(slots[i].deps, deps)) return;
    const previous = slots[i];
    slots[i] = { deps, cleanup: undefined };
    effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
  };

  const hook = useEmbeddedServerWith(useState, useEffect, useCallback, () => api);
  const render = () => {
    slot = 0;
    effects = [];
    const result = hook();
    for (const run of effects) run();
    return result;
  };
  return { render };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

{
  const electron = read(ELECTRON);
  assert.match(
    electron,
    /export function getElectronAPI\(\): ElectronAPI \| null \{\s*return window\.electronAPI \?\? null;\s*\}/,
    `${ELECTRON} getElectronAPI no longer answers null without the preload's API, so a browser's answer is unknown`,
  );
  assert.match(read(HOOK), /\bgetElectronAPI,?\s[\s\S]*?from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/electron";/, `${HOOK} gets its API from somewhere else`);
}

{
  const browser = mount(null);
  browser.render();
  await settle();
  const { servers, isAvailable } = browser.render();
  assert.deepEqual(servers, [], "useEmbeddedServer lists servers in a browser");
  assert.equal(isAvailable, false);
  assert.equal(hostedServerAt(HOST, servers), null, "a browser offered Manage server");
}

{
  let pushStatus;
  const desktop = mount({
    getEmbeddedServerInfo: async () => ({ available: true, hasExisting: true, lanIp: "192.168.1.20", servers: [hostedAs("running")] }),
    getEmbeddedServerAutoStart: async () => false,
    onEmbeddedServerStatusChanged: (callback) => {
      pushStatus = callback;
      return () => {};
    },
  });
  desktop.render();
  await settle();
  assert.equal(hostedServerAt(HOST, desktop.render().servers)?.id, "cozy-den-1a2b3c", "the desktop app got no Manage server for its own server");

  pushStatus([hostedAs("stopped")]);
  await settle();
  assert.equal(hostedServerAt(HOST, desktop.render().servers)?.status, "stopped", "Manage server went away when the server stopped");
}

/* ── both menus ask, and nothing else hides it ───────────────────────────── */

{
  const rail = read(RAIL);
  assert.match(rail, /const \{ servers: embeddedServers \} = useEmbeddedServer\(\);/, `${RAIL} no longer reads the hosted servers from useEmbeddedServer`);
  assert.match(rail, /const hosted = hostedServerAt\(host, embeddedServers\);\s*return hosted \? \(\) => openSettings\(manageServerTab\(hosted\.id\)\) : undefined;/, `${RAIL} decides Manage server some other way`);
  assert.match(rail, /onManageServer=\{manageServerFor\(host\)\}/, `${RAIL} does not hand each server its Manage server`);

  const popup = rail.slice(rail.indexOf("<ContextMenu.Popup>"), rail.indexOf("</ContextMenu.Popup>"));
  assert.ok(popup.length > 0, `${RAIL} no longer has a right-click menu, so this reads nothing`);
  assert.match(popup, /\{onManageServer && \(\s*<ContextMenu\.Item onClick=\{onManageServer\}>Manage server<\/ContextMenu\.Item>\s*\)\}/, "the rail's menu gates Manage server on something besides being hosted here");
  assert.equal(rail.match(/Manage server<\//g)?.length, 1, `${RAIL} draws Manage server more than once`);
  const trigger = rail.slice(rail.indexOf("<ContextMenu.Trigger"), rail.indexOf(">", rail.indexOf("<ContextMenu.Trigger")) + 1);
  assert.equal(trigger, "<ContextMenu.Trigger>", "the rail's menu trigger takes props now, and one could stop it opening on a stopped server");
}

{
  const header = read(HEADER);
  assert.match(header, /\{onManageServer && \(\s*<Menu\.Item onClick=\{onManageServer\}>Manage server<\/Menu\.Item>\s*\)\}/, "the header menu gates Manage server on role or something else besides being hosted here");
  assert.equal(header.match(/Manage server<\//g)?.length, 1, `${HEADER} draws Manage server more than once`);

  const view = read(VIEW);
  const hook = view.indexOf("const { servers: hostedServers } = useEmbeddedServer();");
  assert.notEqual(hook, -1, `${VIEW} no longer reads the hosted servers from useEmbeddedServer`);
  assert.ok(hook < view.indexOf("if (!currentlyViewingServer) return null;"), `${VIEW} calls useEmbeddedServer below an early return`);
  assert.match(view, /const hostedHere = hostedServerAt\(host, hostedServers\);\s*const onManageServer = hostedHere\s*\? \(\) => openSettings\(manageServerTab\(hostedHere\.id\)\)\s*: undefined;/, `${VIEW} decides Manage server some other way`);
  assert.equal(view.match(/onManageServer=\{onManageServer\}/g)?.length, 2, `${VIEW} does not pass Manage server to both layouts`);
  for (const layout of LAYOUTS) {
    assert.match(read(layout), /<ServerHeader[\s\S]*?onManageServer=\{(?:props\.)?onManageServer\}[\s\S]*?\/>/, `${layout} drops Manage server on the way to the header`);
  }
}

/* ── where it lands ─────────────────────────────────────────────────────── */

assert.equal(serverToManage(manageServerTab("cozy-den-1a2b3c")), "cozy-den-1a2b3c");
for (const tab of ["my-servers", "profile", "sound-video/audio", "audio", ""]) {
  assert.equal(serverToManage(tab), null, `the "${tab}" tab asks My servers to bring a card into view`);
}

/* Settings' own reading of a tab, run against the destinations it declares. */
{
  const settings = read(SETTINGS);
  const list = settings.slice(settings.indexOf("const DESTINATIONS"), settings.indexOf("const MAIN_DESTINATIONS"));
  const destinations = [];
  const declarations = [...list.matchAll(/value: "([a-z-]+)"/g)];
  for (const [i, match] of declarations.entries()) {
    const chunk = list.slice(match.index, declarations[i + 1]?.index ?? list.length);
    if (/\bicon:/.test(chunk)) destinations.push({ value: match[1] });
    else (destinations.at(-1).pages ??= []).push({ value: match[1] });
  }
  assert.ok(destinations.some((d) => d.value === "my-servers"), `${SETTINGS} has no My servers destination`);
  assert.match(list, /\.\.\.\(isElectron\(\)\s*\?\s*\[\s*\{\s*value: "my-servers"/, "My servers is no longer Electron only");

  const start = settings.indexOf("const [active, activePage] = useMemo(() => {");
  assert.notEqual(start, -1, `${SETTINGS} no longer resolves the tab in a useMemo. Move this check with it.`);
  const body = settings.slice(settings.indexOf("{", start) + 1, settings.indexOf("}, [settingsTab]);", start));
  const resolve = new Function(
    "DESTINATIONS",
    "DEFAULT_DESTINATION",
    "settingsTab",
    stripTypeScriptTypes(`function resolve() {${body}}`) + "\nreturn resolve();",
  );
  assert.deepEqual(resolve(destinations, "profile", manageServerTab("cozy-den-1a2b3c")), ["my-servers", null], "Manage server's tab does not open My servers");
  assert.deepEqual(resolve(destinations, "profile", "sound-video/audio"), ["sound-video", "audio"], "the resolver run here is not the one settings uses");
}

{
  const page = read(MY_SERVERS);
  assert.match(page, /const managing = serverToManage\(settingsTab\);/, `${MY_SERVERS} does not read which server was asked for`);
  assert.match(page, /managing=\{server\.id === managing\}/, `${MY_SERVERS} does not tell the asked-for card`);
  assert.match(page, /useCallback\(\(\) => setSettingsTab\("my-servers"\), \[setSettingsTab\]\)/, `${MY_SERVERS} leaves the request in place, so reopening settings flashes the card again`);

  const target = page.slice(page.indexOf("function ManageTarget"), page.indexOf("function railEntriesFor"));
  assert.ok(target.length > 0, `${MY_SERVERS} no longer has ManageTarget, so this reads nothing`);
  assert.match(target, /if \(!managing\) return;\s*ref\.current\?\.scrollIntoView\(/, "the asked-for card is not brought into view");
  assert.match(target, /className=\{flash \? "gryt-setting-hit" : undefined\}/, "the asked-for card is not flashed");
  assert.match(target, /data-setting=\{/, "the flash is keyed on data-setting, and the card no longer has one");
  assert.match(read(SETTINGS), /\[data-setting\]\.gryt-setting-hit \{/, `${SETTINGS} no longer draws the flash`);
}

console.log("manage server: offered for servers this app hosts, stopped ones too, never in a browser, and it lands on the card");
