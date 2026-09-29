/**
 * Starting gryt-helper at login, only once somebody turns it on (GRYT-1605). Nothing here
 * runs at install, first launch or update; the settings switch is the only way in.
 */

import { execFile, spawn } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";

export const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
/** Kept in step with build/installer.nsh, which removes it on uninstall. */
export const RUN_VALUE = "GrytHelper";
/** In Contents/Library/LaunchAgents, where SMAppService looks. */
export const AGENT_PLIST = "chat.gryt.helper.plist";
export const AUTOSTART_FILE = "chat.gryt.helper.desktop";

type Env = Record<string, string | undefined>;

export interface LoginItemStatus {
  status?: string;
}

export interface StartupDeps {
  platform: NodeJS.Platform;
  env: Env;
  home: string;
  /** process.resourcesPath when packaged. */
  resourcesPath: string;
  isPackaged: boolean;
  /** The client checkout in development, where scripts/build-helper.mjs puts helper/dist. */
  devRoot: string;
  mas: boolean;
  /** process.windowsStore: MSIX keeps its registry writes to itself, so a Run value would never be seen. */
  windowsStore: boolean;
  /** Runs a program and reports its exit code. Never a shell. */
  run: (command: string, args: string[]) => Promise<number>;
  /** Electron's app.setLoginItemSettings and getLoginItemSettings, which use SMAppService on macOS. */
  setLoginItem: (options: { openAtLogin: boolean; type: "agentService"; serviceName: string }) => void;
  getLoginItem: (options: { type: "agentService"; serviceName: string }) => LoginItemStatus;
  spawnDetached: (file: string) => void;
}

export function helperFileName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "gryt-helper.exe" : "gryt-helper";
}

/** Where the build put the helper, whether or not it is there. */
export function bundledHelper(deps: StartupDeps): string {
  const name = helperFileName(deps.platform);
  return deps.isPackaged ? join(deps.resourcesPath, "helper", name) : join(deps.devRoot, "helper", "dist", name);
}

/** The sandboxed builds can't start anything at login, and a game outside the sandbox can't see their socket anyway. */
export type Unoffered = "mas" | "store" | "portable" | "flatpak" | "snap" | "missing";

export function helperOffer(deps: StartupDeps): { offered: true; binary: string } | { offered: false; why: Unoffered } {
  if (deps.mas) return { offered: false, why: "mas" };
  if (deps.platform === "win32" && deps.windowsStore) return { offered: false, why: "store" };
  // The portable exe unpacks to a new temp folder each run, so a Run value would point at nothing.
  if (deps.platform === "win32" && deps.env.PORTABLE_EXECUTABLE_DIR) return { offered: false, why: "portable" };
  if (deps.platform === "linux" && (deps.env.FLATPAK_ID || existsSync("/.flatpak-info"))) return { offered: false, why: "flatpak" };
  if (deps.platform === "linux" && deps.env.SNAP) return { offered: false, why: "snap" };
  const binary = bundledHelper(deps);
  if (!existsSync(binary)) return { offered: false, why: "missing" };
  if (deps.platform === "darwin" && deps.isPackaged && !existsSync(agentPlistPath(deps))) return { offered: false, why: "missing" };
  return { offered: true, binary };
}

export function agentPlistPath(deps: StartupDeps): string {
  return join(deps.resourcesPath, "..", "Library", "LaunchAgents", AGENT_PLIST);
}

export function autostartPath(deps: StartupDeps): string {
  return join(deps.env.XDG_CONFIG_HOME || join(deps.home, ".config"), "autostart", AUTOSTART_FILE);
}

/** An AppImage's files vanish when it exits, so its helper is copied somewhere that stays. */
export function linuxHelperPath(deps: StartupDeps, binary: string): string {
  if (!deps.env.APPIMAGE) return binary;
  return join(deps.env.XDG_DATA_HOME || join(deps.home, ".local", "share"), "gryt-helper", "gryt-helper");
}

function copyIfChanged(from: string, to: string): void {
  const same = existsSync(to) && statSync(to).size === statSync(from).size && readFileSync(to).equals(readFileSync(from));
  if (same) return;
  mkdirSync(join(to, ".."), { recursive: true });
  rmSync(to, { force: true });
  copyFileSync(from, to);
}

/** Desktop entry spec: an Exec argument with a space or quote in it goes in double quotes. */
export function autostartEntry(file: string): string {
  const exec = /[\s"\\`$]/.test(file) ? `"${file.replace(/(["\\`$])/g, "\\$1")}"` : file;
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Gryt helper",
    "Comment=Lets games tell Gryt what you're playing",
    `Exec=${exec}`,
    `TryExec=${file}`,
    "NoDisplay=true",
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

export async function isRegistered(deps: StartupDeps): Promise<boolean> {
  if (deps.platform === "win32") return (await deps.run("reg.exe", ["query", RUN_KEY, "/v", RUN_VALUE])) === 0;
  if (deps.platform === "darwin") {
    const status = deps.getLoginItem({ type: "agentService", serviceName: AGENT_PLIST }).status;
    return status === "enabled" || status === "requires-approval";
  }
  return existsSync(autostartPath(deps));
}

/** What register leaves the person to do, if anything. macOS may want the login item approved in System Settings. */
export type Registered = "ok" | "needs-approval";

export async function register(deps: StartupDeps, binary: string): Promise<Registered> {
  if (deps.platform === "win32") {
    const code = await deps.run("reg.exe", ["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", `"${binary}"`, "/f"]);
    if (code !== 0) throw new Error(`reg.exe add exited ${code}`);
    return "ok";
  }
  if (deps.platform === "darwin") {
    deps.setLoginItem({ openAtLogin: true, type: "agentService", serviceName: AGENT_PLIST });
    const status = deps.getLoginItem({ type: "agentService", serviceName: AGENT_PLIST }).status;
    if (status === "requires-approval") return "needs-approval";
    if (status !== "enabled") throw new Error(`login item is ${status ?? "unknown"}`);
    return "ok";
  }
  const target = linuxHelperPath(deps, binary);
  if (target !== binary) copyIfChanged(binary, target);
  const entry = autostartPath(deps);
  mkdirSync(join(entry, ".."), { recursive: true });
  writeFileSync(entry, autostartEntry(target), { mode: 0o644 });
  return "ok";
}

/** Also what each launch with the switch off runs, so a stray entry doesn't outlive the setting. */
export async function unregister(deps: StartupDeps): Promise<void> {
  if (deps.platform === "win32") {
    if (await isRegistered(deps)) await deps.run("reg.exe", ["delete", RUN_KEY, "/v", RUN_VALUE, "/f"]);
    return;
  }
  if (deps.platform === "darwin") {
    if (deps.mas) return;
    const status = deps.getLoginItem({ type: "agentService", serviceName: AGENT_PLIST }).status;
    if (status === "enabled" || status === "requires-approval") {
      deps.setLoginItem({ openAtLogin: false, type: "agentService", serviceName: AGENT_PLIST });
    }
    return;
  }
  rmSync(autostartPath(deps), { force: true });
}

/** Where a running Linux helper was started from, for launching it now rather than at the next login. */
export function launchTarget(deps: StartupDeps, binary: string): string {
  return deps.platform === "linux" ? linuxHelperPath(deps, binary) : binary;
}

/** SMAppService starts it on macOS. Elsewhere, or if that didn't happen, it's started here. */
export async function startNow(
  deps: StartupDeps,
  binary: string,
  running: () => Promise<boolean>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  if (await running()) return;
  if (deps.platform === "darwin") {
    await sleep(1_500);
    if (await running()) return;
  }
  deps.spawnDetached(launchTarget(deps, binary));
}

/** Each launch: off means no entry, whatever left one behind. On means running, without re-adding an entry the OS removed. */
export async function syncAtLaunch(deps: StartupDeps, optedIn: boolean, running: () => Promise<boolean>): Promise<void> {
  const offer = helperOffer(deps);
  if (!optedIn || !offer.offered) {
    if (!deps.mas) await unregister(deps).catch(() => {});
    return;
  }
  if (deps.platform === "linux" && deps.env.APPIMAGE && (await isRegistered(deps))) {
    await register(deps, offer.binary).catch(() => {});
  }
  await startNow(deps, offer.binary, running).catch(() => {});
}

export const runQuietly = (command: string, args: string[]): Promise<number> =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: 10_000, windowsHide: true }, (err) => {
      const code = (err as { code?: unknown } | null)?.code;
      resolve(err ? (typeof code === "number" ? code : 1) : 0);
    });
  });

export function spawnDetachedHelper(file: string): void {
  const child = spawn(file, [], { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
}
