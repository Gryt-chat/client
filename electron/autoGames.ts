/**
 * Automatic mode's switch, store and IPC, kept out of main.ts. Its consent is its
 * own: this reads every running program, where watched programs never do (GRYT-1310).
 */

import type { BrowserWindow, IpcMain } from "electron";

import { createGameIndex, readGameList } from "./gameList";
import bundledGames from "./games.json";
import { createGameWatcher, type GameWatcher } from "./gameWatcher";
import { loadGlobalStore, setGlobalValue } from "./globalStore";
import { canListProcesses, DEFAULT_INTERVAL_MS, listRunningExecutables } from "./processWatcher";

let gameWatcher: GameWatcher | null = null;
let windowOf: () => BrowserWindow | null = () => null;

function readAutoGamesConsent(): string | null {
  const at = loadGlobalStore()["autoGamesConsent"];
  return typeof at === "string" && at ? at : null;
}

function readHiddenGames(value: unknown = loadGlobalStore()["autoGamesHidden"]): string[] {
  if (!Array.isArray(value)) return [];
  const names = value.filter((n): n is string => typeof n === "string" && n.length > 0 && n.length <= 64);
  return [...new Set(names)].slice(0, 200);
}

export function startAutoGames(getWindow: () => BrowserWindow | null): void {
  windowOf = getWindow;
  if (!canListProcesses || gameWatcher || !readAutoGamesConsent()) return;
  gameWatcher = createGameWatcher({
    index: createGameIndex(readGameList(bundledGames)),
    intervalMs: DEFAULT_INTERVAL_MS,
    list: listRunningExecutables,
    onChange: (names) => windowOf()?.webContents.send("auto-games-changed", names),
  });
  gameWatcher.setHidden(readHiddenGames());
  gameWatcher.start();
}

function stopAutoGames(): void {
  gameWatcher?.stop();
  gameWatcher = null;
}

/** Names of listed games only. The process list itself never crosses to the renderer. */
export function registerAutoGamesIpc(ipcMain: IpcMain): void {
  ipcMain.handle("auto-games-get", () => ({
    supported: canListProcesses,
    consentedAt: readAutoGamesConsent(),
    running: gameWatcher?.current() ?? [],
    seen: gameWatcher?.seen() ?? [],
    hidden: readHiddenGames(),
  }));

  ipcMain.handle("auto-games-set-consent", (_event, allow: unknown) => {
    if (allow === true && canListProcesses) {
      setGlobalValue("autoGamesConsent", new Date().toISOString());
      startAutoGames(windowOf);
    } else {
      setGlobalValue("autoGamesConsent", null);
      stopAutoGames();
    }
    return readAutoGamesConsent();
  });

  ipcMain.handle("auto-games-set-hidden", (_event, names: unknown) => {
    const list = readHiddenGames(names);
    setGlobalValue("autoGamesHidden", list);
    gameWatcher?.setHidden(list);
    return list;
  });
}
