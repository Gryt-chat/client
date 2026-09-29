#!/usr/bin/env node
/**
 * gryt-helper at login (GRYT-1605): off by default, registered only from the settings switch,
 * and gone at once when turned off. A fresh install or an update leaves no startup entry.
 */

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AGENT_PLIST,
  autostartEntry,
  autostartPath,
  helperOffer,
  isRegistered,
  register,
  RUN_KEY,
  RUN_VALUE,
  syncAtLaunch,
  unregister,
} from "../electron/helperStartup.ts";
import { helperStateLine } from "../src/packages/settings/src/components/presenceHelperCopy.ts";

let failures = 0;
async function check(name, run) {
  try {
    await run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.stack ?? err.message}`);
  }
}

const roots = [];
/** A machine: a home folder, the app's resources with a helper in them, and a fake OS. */
function machine(platform, { env = {}, withHelper = true, withPlist = true, mas = false, windowsStore = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ghs-"));
  roots.push(root);
  const home = join(root, "home");
  const resources = platform === "darwin" ? join(root, "Gryt.app", "Contents", "Resources") : join(root, "app", "resources");
  mkdirSync(join(resources, "helper"), { recursive: true });
  mkdirSync(home, { recursive: true });
  const binary = join(resources, "helper", platform === "win32" ? "gryt-helper.exe" : "gryt-helper");
  if (withHelper) {
    writeFileSync(binary, "#!/bin/sh\n");
    chmodSync(binary, 0o755);
  }
  if (platform === "darwin" && withPlist) {
    mkdirSync(join(resources, "..", "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(join(resources, "..", "Library", "LaunchAgents", AGENT_PLIST), "<plist/>");
  }

  const runKey = new Map();
  const calls = [];
  let loginItem = "not-registered";
  const spawned = [];
  const deps = {
    platform,
    env: { ...env },
    home,
    resourcesPath: resources,
    isPackaged: true,
    devRoot: root,
    mas,
    windowsStore,
    run: async (command, args) => {
      calls.push([command, ...args]);
      assert.equal(command, "reg.exe");
      const [verb, key, , value] = args;
      assert.equal(key, RUN_KEY);
      if (verb === "query") return runKey.has(value) ? 0 : 1;
      if (verb === "add") return runKey.set(value, args[args.indexOf("/d") + 1]), 0;
      if (verb === "delete") return runKey.delete(value) ? 0 : 1;
      return 1;
    },
    setLoginItem: (options) => {
      calls.push(["setLoginItem", options]);
      loginItem = options.openAtLogin ? (env.NEEDS_APPROVAL ? "requires-approval" : "enabled") : "not-registered";
    },
    getLoginItem: () => ({ status: loginItem }),
    spawnDetached: (file) => spawned.push(file),
  };
  const entries = () => {
    if (platform === "win32") return [...runKey.keys()];
    if (platform === "darwin") return loginItem === "not-registered" ? [] : [AGENT_PLIST];
    return existsSync(autostartPath(deps)) ? [autostartPath(deps)] : [];
  };
  return { deps, binary, calls, runKey, entries, spawned, home };
}

const PLATFORMS = ["win32", "darwin", "linux"];
const notRunning = async () => false;

/* ── Install, first launch and update ────────────────────────────────── */

await check("a fresh install's first launch leaves no startup entry", async () => {
  for (const platform of PLATFORMS) {
    const m = machine(platform);
    await syncAtLaunch(m.deps, false, notRunning);
    assert.deepEqual(m.entries(), [], platform);
    assert.deepEqual(m.spawned, [], `${platform}: the helper was started without being turned on`);
    assert.equal(m.calls.some((c) => c[1] === "add" || (c[0] === "setLoginItem" && c[1].openAtLogin)), false, platform);
  }
});

await check("an update that launches with it off removes a stray entry and adds none", async () => {
  for (const platform of PLATFORMS) {
    const m = machine(platform);
    await register(m.deps, m.binary);
    assert.equal(m.entries().length, 1, platform);
    await syncAtLaunch(m.deps, false, notRunning);
    assert.deepEqual(m.entries(), [], platform);
  }
});

await check("an update with it on keeps the entry and starts the helper, without re-adding one the OS removed", async () => {
  for (const platform of ["win32", "linux"]) {
    const m = machine(platform);
    await syncAtLaunch(m.deps, true, notRunning);
    assert.deepEqual(m.entries(), [], `${platform}: re-added an entry nobody asked for`);
    assert.deepEqual(m.spawned, [m.binary], platform);
  }
  const running = machine("win32");
  await syncAtLaunch(running.deps, true, async () => true);
  assert.deepEqual(running.spawned, [], "started a second helper");
});

await check("the installer never writes the startup value, and uninstalling removes it", () => {
  const nsh = readFileSync(new URL("../build/installer.nsh", import.meta.url), "utf8");
  assert.doesNotMatch(nsh, /WriteReg\w*\s+HKCU\s+"Software\\Microsoft\\Windows\\CurrentVersion\\Run"/);
  const uninstall = nsh.match(/!macro customUnInstall[\s\S]*?!macroend/)?.[0] ?? "";
  assert.match(uninstall, new RegExp(`DeleteRegValue HKCU "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run" "${RUN_VALUE}"`));
  assert.match(uninstall, /\$\{IfNot\} \$\{isUpdated\}\s+DeleteRegValue/, "an update would drop the setting");
  assert.match(uninstall, /taskkill \/F \/IM gryt-helper\.exe/);
  const builder = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");
  assert.doesNotMatch(builder, /GrytHelper|CurrentVersion\\\\Run/);
});

await check("only the settings switch registers it", () => {
  const main = readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");
  const registers = [...main.matchAll(/\bregisterHelper\(/g)].length;
  assert.equal(registers, 1, "registerHelper is called from somewhere else in main.ts");
  const on = main.match(/async function turnHelperOn\(\): Promise<void> \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(on, /registerHelper\(/);
  assert.match(on, /if \(!offer\.offered \|\| !readRichPresenceConsent\(\)\) return;/);
  const callers = [...main.matchAll(/turnHelperOn\(\)/g)].map((m) => main.slice(Math.max(0, m.index - 400), m.index));
  assert.equal(callers.length, 2, "turnHelperOn is called from somewhere new");
  assert.match(callers[1], /ipcMain\.handle\("presence-helper-set"/);
  const consent = main.match(/ipcMain\.handle\("rich-presence-set-consent"[\s\S]*?\n {6}\}\);/)?.[0] ?? "";
  assert.match(consent, /await turnHelperOff\(\)/, "turning Rich Presence off leaves the helper registered");
});

/* ── Turning it on and off ───────────────────────────────────────────── */

await check("Windows: an HKCU Run value with the quoted path, gone when turned off", async () => {
  const m = machine("win32");
  await register(m.deps, m.binary);
  assert.equal(m.runKey.get(RUN_VALUE), `"${m.binary}"`);
  assert.equal(await isRegistered(m.deps), true);
  await unregister(m.deps);
  assert.equal(await isRegistered(m.deps), false);
});

await check("macOS: an SMAppService agent, and approval is passed on", async () => {
  const m = machine("darwin");
  assert.equal(await register(m.deps, m.binary), "ok");
  assert.deepEqual(m.calls.at(-1), ["setLoginItem", { openAtLogin: true, type: "agentService", serviceName: AGENT_PLIST }]);
  await unregister(m.deps);
  assert.deepEqual(m.entries(), []);

  const approval = machine("darwin", { env: { NEEDS_APPROVAL: "1" } });
  assert.equal(await register(approval.deps, approval.binary), "needs-approval");
});

await check("Linux: an XDG autostart entry with TryExec, and an AppImage's helper copied somewhere that stays", async () => {
  const m = machine("linux", { env: { XDG_CONFIG_HOME: "" } });
  await register(m.deps, m.binary);
  const entry = readFileSync(join(m.home, ".config", "autostart", "chat.gryt.helper.desktop"), "utf8");
  assert.match(entry, new RegExp(`^TryExec=${m.binary}$`, "m"));
  assert.match(entry, /^NoDisplay=true$/m);
  await unregister(m.deps);
  assert.deepEqual(m.entries(), []);

  const image = machine("linux", { env: { APPIMAGE: "/home/x/Gryt.AppImage" } });
  await register(image.deps, image.binary);
  const copied = join(image.home, ".local", "share", "gryt-helper", "gryt-helper");
  assert.equal(existsSync(copied), true);
  assert.match(readFileSync(autostartPath(image.deps), "utf8"), new RegExp(`^Exec=${copied}$`, "m"));

  assert.match(autostartEntry("/opt/Gryt Chat/gryt-helper"), /^Exec="\/opt\/Gryt Chat\/gryt-helper"$/m);
});

await check("not offered where it can't work", () => {
  assert.deepEqual(helperOffer(machine("darwin", { mas: true }).deps), { offered: false, why: "mas" });
  assert.deepEqual(helperOffer(machine("win32", { windowsStore: true }).deps), { offered: false, why: "store" });
  assert.deepEqual(helperOffer(machine("win32", { env: { PORTABLE_EXECUTABLE_DIR: "C:\\x" } }).deps), { offered: false, why: "portable" });
  assert.deepEqual(helperOffer(machine("linux", { env: { FLATPAK_ID: "chat.gryt.Gryt" } }).deps), { offered: false, why: "flatpak" });
  assert.deepEqual(helperOffer(machine("linux", { env: { SNAP: "/snap/gryt/1" } }).deps), { offered: false, why: "snap" });
  assert.deepEqual(helperOffer(machine("win32", { withHelper: false }).deps), { offered: false, why: "missing" });
  assert.deepEqual(helperOffer(machine("darwin", { withPlist: false }).deps), { offered: false, why: "missing" });
  assert.equal(helperOffer(machine("win32").deps).offered, true);
});

await check("settings says when it's on, when macOS wants it allowed, and when it failed", () => {
  assert.equal(helperStateLine({ enabledAt: null, needsApproval: false, error: null }), null);
  assert.match(helperStateLine({ enabledAt: "x", needsApproval: false, error: null }).text, /starts when you log in/);
  assert.match(helperStateLine({ enabledAt: "x", needsApproval: true, error: null }).text, /Login Items/);
  assert.equal(helperStateLine({ enabledAt: null, needsApproval: false, error: "reg.exe add exited 1" }).warn, true);
});

for (const root of roots) rmSync(root, { recursive: true, force: true });
console.log(failures === 0 ? "\nhelper startup: ok" : `\nhelper startup: ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
