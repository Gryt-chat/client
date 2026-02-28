import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, nativeImage, screen, session, shell, Tray } from "electron";
import { autoUpdater, UpdateInfo } from "electron-updater";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { createServer, Server } from "http";
import { dirname, extname, join, resolve } from "path";
import { uIOhook, UiohookKey } from "uiohook-napi";
import { fileURLToPath } from "url";

import { isNativeAudioCaptureAvailable, startNativeAudioCapture, stopNativeAudioCapture } from "./audioCaptureManager";
import { flushUserStore, initUserStore, loadUser, patchUser, saveUser } from "./userStore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Test a URL against an Electron URL-filter pattern (e.g. "https://*.foo.com/*"). */
function matchUrlPattern(pattern: string, url: string): boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(url);
}

const appIcon = app.isPackaged
  ? join(process.resourcesPath, "icon.png")
  : join(__dirname, "../build/icon.png");

const PROTOCOL = "gryt";
const AUTO_START_ARG = "--gryt-autostart";
let pendingDeepLinkUrl: string | null = null;
let splashWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let closeToTray = true;
let pttDown = false;
let startHiddenOnLaunch = false;
let localServer: Server | null = null;
let localServerUrl: string | null = null;

// ── Deep link protocol ───────────────────────────────────────────────────

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

function handleDeepLink(url: string): void {
  if (!url.startsWith(`${PROTOCOL}://`)) return;

  if (mainWindow) {
    if (url.startsWith(`${PROTOCOL}://invite`)) {
      const parsed = new URL(url);
      const host = parsed.searchParams.get("host") || "";
      const code = parsed.searchParams.get("code") || "";
      if (host && code) {
        mainWindow.webContents.send("deep-link-invite", { host, code });
      }
    } else {
      mainWindow.webContents.send("auth-callback", url);
    }
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    pendingDeepLinkUrl = url;
  }
}

// ── Persistent config (userData/gryt-config.json) ───────────────────────

const configPath = join(app.getPath("userData"), "gryt-config.json");
initUserStore(app.getPath("userData"));

function readConfig(): Record<string, unknown> {
  try { return JSON.parse(readFileSync(configPath, "utf8")); }
  catch { return {}; }
}

function writeConfig(patch: Record<string, unknown>) {
  const config = { ...readConfig(), ...patch };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function readBoolConfig(key: string, defaultValue: boolean): boolean {
  const v = readConfig()[key];
  return typeof v === "boolean" ? v : defaultValue;
}

// ── Auto-updater config ─────────────────────────────────────────────────

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = readConfig().betaChannel === true;
autoUpdater.logger = console;
closeToTray = (readConfig().closeToTray ?? true) as boolean;
const hardwareAcceleration = readBoolConfig("hardwareAcceleration", true);
if (!hardwareAcceleration) {
  app.disableHardwareAcceleration();
}
let startWithWindows = process.platform === "win32"
  ? readBoolConfig("startWithWindows", true)
  : false;
let startMinimizedOnLogin = readBoolConfig("startMinimizedOnLogin", false);

function applyStartWithWindowsSetting(enabled: boolean) {
  if (process.platform !== "win32") return;
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, args: [AUTO_START_ARG] });
  } catch {
    // Best-effort: some environments (portable/dev) may not support this.
  }
}

function sendToSplash(status: string, info?: Record<string, unknown>) {
  splashWindow?.webContents.send("update-status", { status, ...info });
}

function sendToMain(status: string, info?: Record<string, unknown>) {
  mainWindow?.webContents.send("update-status", { status, ...info });
}

// ── Splash window ───────────────────────────────────────────────────────

function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 320,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    icon: appIcon,
    backgroundColor: "#111318",
    webPreferences: {
      preload: join(__dirname, "splash-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "Gryt — Updating",
  });

  splashWindow.loadFile(join(__dirname, "../electron/splash.html"));

  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function closeSplashAndShowMain(): void {
  if (splashWindow) {
    splashWindow.close();
    splashWindow = null;
  }
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(true);
    mainWindow.show();
    mainWindow.focus();
    setTimeout(() => {
      mainWindow?.setAlwaysOnTop(false);
    }, 1000);
  }
}

// ── Splash update flow ──────────────────────────────────────────────────
// Returns a promise that resolves once we should show the main window.

function runSplashUpdateCheck(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    // Safety timeout — never block the user longer than 15 s
    const timeout = setTimeout(done, 15_000);

    const onChecking = () => sendToSplash("checking");

    const onAvailable = (info: UpdateInfo) => {
      sendToSplash("available", { version: info.version });
      autoUpdater.downloadUpdate().catch(() => onError());
    };

    const onNotAvailable = (info: UpdateInfo) => {
      sendToSplash("not-available", { version: info.version });
      // Brief pause so the user sees "Up to date!"
      setTimeout(done, 800);
    };

    const onProgress = (progress: { percent: number; transferred: number; total: number }) => {
      sendToSplash("downloading", {
        percent: Math.round(progress.percent),
        transferred: progress.transferred,
        total: progress.total,
      });
    };

    const onDownloaded = (info: UpdateInfo) => {
      sendToSplash("downloaded", { version: info.version });
      setTimeout(() => {
        cleanup();
        clearTimeout(timeout);
        // Let the event loop drain before quitting — improves reliability
        // across platforms (NSIS on Windows, AppImage on Linux).
        setImmediate(() => {
          try {
            autoUpdater.quitAndInstall(false, true);
          } catch {
            // If quitAndInstall fails, show the main window so the user
            // isn't stuck with a blank screen. The update will apply on
            // next restart via autoInstallOnAppQuit.
            done();
          }
        });
      }, 1500);
    };

    const onError = () => {
      sendToSplash("error");
      setTimeout(done, 1200);
    };

    function cleanup() {
      autoUpdater.off("checking-for-update", onChecking);
      autoUpdater.off("update-available", onAvailable);
      autoUpdater.off("update-not-available", onNotAvailable);
      autoUpdater.off("download-progress", onProgress);
      autoUpdater.off("update-downloaded", onDownloaded);
      autoUpdater.off("error", onError);
    }

    autoUpdater.on("checking-for-update", onChecking);
    autoUpdater.on("update-available", onAvailable);
    autoUpdater.on("update-not-available", onNotAvailable);
    autoUpdater.on("download-progress", onProgress);
    autoUpdater.on("update-downloaded", onDownloaded);
    autoUpdater.on("error", onError);

    autoUpdater.checkForUpdates().catch(() => {
      onError();
    });
  });
}

// ── Background update listeners (after main window is open) ─────────────

function friendlyUpdateError(err: Error): string {
  const msg = err.message;
  if (msg.includes("latest.yml") || msg.includes("latest-linux.yml") || msg.includes("latest-mac.yml")) {
    return "No update available for this channel yet. The release may still be building — try again in a few minutes.";
  }
  if (msg.includes("net::ERR_") || msg.includes("ENOTFOUND") || msg.includes("ETIMEDOUT")) {
    return "Could not reach the update server. Check your internet connection and try again.";
  }
  if (msg.includes("HttpError: 403") || msg.includes("HttpError: 401")) {
    return "Access denied while checking for updates. The release may be private or your token has expired.";
  }
  if (msg.includes("sha512 checksum mismatch")) {
    return "Downloaded update failed integrity check. Try checking for updates again.";
  }
  return msg;
}

let userInitiatedCheck = false;

function initBackgroundUpdater() {
  autoUpdater.on("checking-for-update", () => sendToMain("checking"));
  autoUpdater.on("update-available", (info) => {
    sendToMain("available", { version: info.version });
    if (!userInitiatedCheck) {
      autoUpdater.downloadUpdate().catch(() => {});
    }
  });
  autoUpdater.on("update-not-available", (info) => sendToMain("not-available", { version: info.version }));
  autoUpdater.on("download-progress", (p) =>
    sendToMain("downloading", { percent: Math.round(p.percent), transferred: p.transferred, total: p.total })
  );
  autoUpdater.on("update-downloaded", (info) => sendToMain("downloaded", { version: info.version }));
  autoUpdater.on("error", (err) => sendToMain("error", { message: friendlyUpdateError(err) }));
}

// ── Local static server (production only) ────────────────────────────────
// Serves the Vite-built dist/ folder over HTTP so iframe embeds (YouTube,
// Twitch, etc.) see a real HTTP origin instead of file://.

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wasm": "application/wasm",
  ".map": "application/json",
  ".txt": "text/plain",
};

function startLocalServer(): Promise<string> {
  const distDir = join(__dirname, "../dist");
  const indexPath = join(distDir, "index.html");

  return new Promise((resolveUrl, reject) => {
    const server = createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      const safePath = resolve(distDir, pathname.replace(/^\/+/, ""));

      if (!safePath.startsWith(distDir)) {
        res.writeHead(403);
        res.end();
        return;
      }

      const filePath = existsSync(safePath) && statSync(safePath).isFile() ? safePath : indexPath;
      const ext = extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

      res.writeHead(200, { "Content-Type": contentType });
      createReadStream(filePath).pipe(res);
    });

    server.listen(15738, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to start local server"));
        return;
      }
      localServer = server;
      const url = `http://127.0.0.1:${addr.port}`;
      resolveUrl(url);
    });

    server.on("error", reject);
  });
}

// ── Main window ─────────────────────────────────────────────────────────

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 300,
    minHeight: 300,
    show: false,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0d0f13",
      symbolColor: "#e0e0e6",
      height: 36,
    },
    icon: appIcon,
    backgroundColor: "#111318",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
    autoHideMenuBar: true,
    title: "Gryt",
  });

  mainWindow.loadURL(localServerUrl ?? process.env.VITE_DEV_SERVER_URL ?? "about:blank");

  if (!startHiddenOnLaunch) {
    // Safety: if splash flow hasn't shown us within 20s, show anyway
    setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) {
        closeSplashAndShowMain();
      }
    }, 20_000);
  }

  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.key === "F12" && input.type === "keyDown") {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === "about:blank") {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting && closeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("focus", () => {
    mainWindow?.webContents.send("window-focus-change", true);
  });

  mainWindow.on("blur", () => {
    mainWindow?.webContents.send("window-focus-change", false);
  });
}

// ── PTT helpers (uiohook – passive, does NOT consume key events) ────────

const DOM_CODE_TO_UIOHOOK: Record<string, number> = {
  KeyA: UiohookKey.A, KeyB: UiohookKey.B, KeyC: UiohookKey.C,
  KeyD: UiohookKey.D, KeyE: UiohookKey.E, KeyF: UiohookKey.F,
  KeyG: UiohookKey.G, KeyH: UiohookKey.H, KeyI: UiohookKey.I,
  KeyJ: UiohookKey.J, KeyK: UiohookKey.K, KeyL: UiohookKey.L,
  KeyM: UiohookKey.M, KeyN: UiohookKey.N, KeyO: UiohookKey.O,
  KeyP: UiohookKey.P, KeyQ: UiohookKey.Q, KeyR: UiohookKey.R,
  KeyS: UiohookKey.S, KeyT: UiohookKey.T, KeyU: UiohookKey.U,
  KeyV: UiohookKey.V, KeyW: UiohookKey.W, KeyX: UiohookKey.X,
  KeyY: UiohookKey.Y, KeyZ: UiohookKey.Z,
  Digit0: UiohookKey["0"], Digit1: UiohookKey["1"], Digit2: UiohookKey["2"],
  Digit3: UiohookKey["3"], Digit4: UiohookKey["4"], Digit5: UiohookKey["5"],
  Digit6: UiohookKey["6"], Digit7: UiohookKey["7"], Digit8: UiohookKey["8"],
  Digit9: UiohookKey["9"],
  Space: UiohookKey.Space, Backspace: UiohookKey.Backspace,
  Tab: UiohookKey.Tab, Enter: UiohookKey.Enter,
  CapsLock: UiohookKey.CapsLock, Escape: UiohookKey.Escape,
  Insert: UiohookKey.Insert, Delete: UiohookKey.Delete,
  Home: UiohookKey.Home, End: UiohookKey.End,
  PageUp: UiohookKey.PageUp, PageDown: UiohookKey.PageDown,
  ArrowUp: UiohookKey.ArrowUp, ArrowDown: UiohookKey.ArrowDown,
  ArrowLeft: UiohookKey.ArrowLeft, ArrowRight: UiohookKey.ArrowRight,
  F1: UiohookKey.F1, F2: UiohookKey.F2, F3: UiohookKey.F3,
  F4: UiohookKey.F4, F5: UiohookKey.F5, F6: UiohookKey.F6,
  F7: UiohookKey.F7, F8: UiohookKey.F8, F9: UiohookKey.F9,
  F10: UiohookKey.F10, F11: UiohookKey.F11, F12: UiohookKey.F12,
  Numpad0: UiohookKey.Numpad0, Numpad1: UiohookKey.Numpad1,
  Numpad2: UiohookKey.Numpad2, Numpad3: UiohookKey.Numpad3,
  Numpad4: UiohookKey.Numpad4, Numpad5: UiohookKey.Numpad5,
  Numpad6: UiohookKey.Numpad6, Numpad7: UiohookKey.Numpad7,
  Numpad8: UiohookKey.Numpad8, Numpad9: UiohookKey.Numpad9,
  NumpadMultiply: UiohookKey.NumpadMultiply, NumpadAdd: UiohookKey.NumpadAdd,
  NumpadSubtract: UiohookKey.NumpadSubtract, NumpadDecimal: UiohookKey.NumpadDecimal,
  NumpadDivide: UiohookKey.NumpadDivide,
  Semicolon: UiohookKey.Semicolon, Equal: UiohookKey.Equal,
  Comma: UiohookKey.Comma, Minus: UiohookKey.Minus,
  Period: UiohookKey.Period, Slash: UiohookKey.Slash,
  Backquote: UiohookKey.Backquote, BracketLeft: UiohookKey.BracketLeft,
  Backslash: UiohookKey.Backslash, BracketRight: UiohookKey.BracketRight,
  Quote: UiohookKey.Quote,
};

let pttKeycode: number | null = null;
let pttNeedsCtrl = false;
let pttNeedsShift = false;
let pttNeedsAlt = false;
let pttNeedsMeta = false;

function registerPttShortcut(pttKey: string): void {
  pttDown = false;
  pttKeycode = null;
  pttNeedsCtrl = false;
  pttNeedsShift = false;
  pttNeedsAlt = false;
  pttNeedsMeta = false;

  if (!pttKey) return;

  const parts = pttKey.split("+");
  const baseKey = parts[parts.length - 1];
  const keycode = DOM_CODE_TO_UIOHOOK[baseKey];
  if (keycode == null) {
    console.warn(`No uiohook mapping for PTT key "${baseKey}"`);
    return;
  }

  pttKeycode = keycode;
  pttNeedsCtrl = parts.includes("Ctrl");
  pttNeedsShift = parts.includes("Shift");
  pttNeedsAlt = parts.includes("Alt");
  pttNeedsMeta = parts.includes("Meta");
}

function initUiohook(): void {
  uIOhook.on("keydown", (e) => {
    if (pttKeycode == null) return;
    if (e.keycode !== pttKeycode) return;
    if (e.ctrlKey !== pttNeedsCtrl) return;
    if (e.shiftKey !== pttNeedsShift) return;
    if (e.altKey !== pttNeedsAlt) return;
    if (e.metaKey !== pttNeedsMeta) return;

    if (!pttDown) {
      pttDown = true;
      mainWindow?.webContents.send("ptt-down");
    }
  });

  uIOhook.on("keyup", (e) => {
    if (!pttDown || pttKeycode == null) return;
    if (e.keycode !== pttKeycode) return;

    pttDown = false;
    mainWindow?.webContents.send("ptt-up");
  });

  uIOhook.start();
}

// ── System tray ─────────────────────────────────────────────────────────

function buildTrayContextMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: "Show/Hide",
      click: () => {
        if (mainWindow?.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow?.show();
          mainWindow?.focus();
        }
      },
    },
    {
      label: "Check for Updates",
      click: () => {
        isQuitting = true;
        app.relaunch();
        app.quit();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray(): void {
  const icon = nativeImage.createFromPath(appIcon);
  tray = new Tray(icon.resize({ width: 24, height: 24 }));
  tray.setToolTip("Gryt");

  tray.on("click", () => {
    if (mainWindow?.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });

  tray.on("right-click", () => {
    tray?.setContextMenu(buildTrayContextMenu());
    tray?.popUpContextMenu();
  });
}

// ── App lifecycle ───────────────────────────────────────────────────────

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const deepLink = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (deepLink) {
      handleDeepLink(deepLink);
    } else if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.whenReady().then(async () => {
    ipcMain.handle("get-app-version", () => app.getVersion());
    ipcMain.handle("get-beta-channel", () => readConfig().betaChannel === true);
    ipcMain.on("set-beta-channel", (_event, enabled: boolean) => {
      writeConfig({ betaChannel: enabled });
      autoUpdater.allowPrerelease = enabled;
    });

    ipcMain.on("switch-update-channel", (_event, enabled: boolean) => {
      writeConfig({ betaChannel: enabled });
      autoUpdater.allowPrerelease = enabled;
      isQuitting = true;
      app.relaunch();
      app.quit();
    });

    ipcMain.handle("get-close-to-tray", () => closeToTray);
    ipcMain.on("set-close-to-tray", (_event, enabled: boolean) => {
      closeToTray = enabled;
      writeConfig({ closeToTray: enabled });
    });

    ipcMain.handle("get-start-with-windows-supported", () => process.platform === "win32");
    ipcMain.handle("get-start-with-windows", () => startWithWindows);
    ipcMain.on("set-start-with-windows", (_event, enabled: boolean) => {
      startWithWindows = !!enabled;
      writeConfig({ startWithWindows });
      applyStartWithWindowsSetting(startWithWindows);
    });

    ipcMain.handle("get-start-minimized-on-login", () => startMinimizedOnLogin);
    ipcMain.on("set-start-minimized-on-login", (_event, enabled: boolean) => {
      startMinimizedOnLogin = !!enabled;
      writeConfig({ startMinimizedOnLogin });
    });

    ipcMain.handle("get-hardware-acceleration", () => hardwareAcceleration);
    ipcMain.on("set-hardware-acceleration", (_event, enabled: boolean) => {
      writeConfig({ hardwareAcceleration: enabled });
      isQuitting = true;
      app.relaunch();
      app.quit();
    });

    // ── Per-user file store ───────────────────────────────────────────
    ipcMain.handle("user-store:load", (_event, userId: string) => loadUser(userId));
    ipcMain.on("user-store:set", (_event, userId: string, key: string, value: unknown) => {
      patchUser(userId, key, value);
    });
    ipcMain.on("user-store:save", (_event, userId: string, data: Record<string, unknown>) => {
      saveUser(userId, data);
    });

    // Apply at startup (default enabled on Windows).
    applyStartWithWindowsSetting(startWithWindows);

    const launchedFromAutoStart = process.argv.includes(AUTO_START_ARG) || (() => {
      try {
        return app.getLoginItemSettings().wasOpenedAtLogin === true;
      } catch {
        return false;
      }
    })();
    startHiddenOnLaunch = launchedFromAutoStart && startMinimizedOnLogin;

    if (!process.env.VITE_DEV_SERVER_URL) {
      localServerUrl = await startLocalServer();
    }

    initUiohook();
    createMainWindow();
    createTray();

    if (startHiddenOnLaunch) {
      initBackgroundUpdater();
      autoUpdater.checkForUpdates().catch(() => {});
    } else {
      try {
        createSplashWindow();
        await runSplashUpdateCheck();
      } catch (_) {
        // Ensure main window shows even if splash/updater fails
      }
      closeSplashAndShowMain();
      initBackgroundUpdater();
    }

    // Background updates auto-download and install on quit
    // (autoDownload + autoInstallOnAppQuit are both true).

    // ── Embed origin fix ────────────────────────────────────────────
    // Third-party embed players (YouTube, Vimeo, Spotify, etc.) reject
    // iframes whose parent is file://.  Spoof valid HTTP Referer/Origin
    // so the embed players accept playback in packaged Electron.
    const embedOriginMap: [string[], string][] = [
      [["https://*.youtube.com/*", "https://*.youtube-nocookie.com/*",
        "https://*.googlevideo.com/*", "https://*.ytimg.com/*"],
        "https://www.youtube-nocookie.com"],
      [["https://*.vimeo.com/*", "https://*.vimeocdn.com/*"],
        "https://player.vimeo.com"],
      [["https://clips.twitch.tv/*"],
        "https://clips.twitch.tv"],
      [["https://*.twitch.tv/*", "https://*.twitchcdn.net/*", "https://*.jtvnw.net/*"],
        "https://player.twitch.tv"],
      [["https://*.spotify.com/*", "https://*.spotifycdn.com/*"],
        "https://open.spotify.com"],
      [["https://*.tiktok.com/*", "https://*.tiktokcdn.com/*"],
        "https://www.tiktok.com"],
      [["https://*.instagram.com/*", "https://*.cdninstagram.com/*"],
        "https://www.instagram.com"],
      [["https://*.soundcloud.com/*", "https://*.sndcdn.com/*"],
        "https://w.soundcloud.com"],
    ];
    const allEmbedPatterns = embedOriginMap.flatMap(([patterns]) => patterns);
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: allEmbedPatterns },
      (details, callback) => {
        const existingOrigin = details.requestHeaders["Origin"];
        if (existingOrigin && existingOrigin.startsWith("https://")) {
          callback({ requestHeaders: details.requestHeaders });
          return;
        }
        for (const [patterns, origin] of embedOriginMap) {
          if (patterns.some((p) => matchUrlPattern(p, details.url))) {
            details.requestHeaders["Referer"] = origin + "/";
            details.requestHeaders["Origin"] = origin;
            break;
          }
        }
        callback({ requestHeaders: details.requestHeaders });
      },
    );

    // Strip Content-Security-Policy from embed provider responses so
    // frame-ancestors doesn't block embedding inside Electron.
    session.defaultSession.webRequest.onHeadersReceived(
      { urls: allEmbedPatterns },
      (details, callback) => {
        const headers = { ...details.responseHeaders };
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === "content-security-policy") {
            delete headers[key];
          }
        }
        callback({ responseHeaders: headers });
      },
    );

    // ── Screen capture ────────────────────────────────────────────────
    // Allow getDisplayMedia by providing a default handler.
    // Our renderer uses a custom picker via get-desktop-sources instead.
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
        callback({ video: sources[0], audio: "loopback" });
      });
    });

    ipcMain.handle("get-desktop-sources", async () => {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 320, height: 180 },
      });
      const displays = screen.getAllDisplays();
      return sources.map((s) => {
        const isScreen = s.id.startsWith("screen:");
        let width: number | undefined;
        let height: number | undefined;
        if (isScreen) {
          const displayIndex = parseInt(s.id.split(":")[1], 10);
          const display = displays[displayIndex];
          if (display) {
            width = display.size.width * display.scaleFactor;
            height = display.size.height * display.scaleFactor;
          }
        }
        return {
          id: s.id,
          name: s.name,
          thumbnail: s.thumbnail.toDataURL(),
          appIcon: s.appIcon ? s.appIcon.toDataURL() : "",
          sourceType: isScreen ? "screen" as const : "window" as const,
          width,
          height,
        };
      });
    });

    // ── Native audio capture ──────────────────────────────────────────

    ipcMain.handle("native-audio-capture-available", () => {
      return isNativeAudioCaptureAvailable();
    });

    ipcMain.handle("start-native-audio-capture", () => {
      if (!mainWindow) return false;
      return startNativeAudioCapture(mainWindow);
    });

    ipcMain.on("stop-native-audio-capture", () => {
      stopNativeAudioCapture();
    });

    // ── IPC handlers ──────────────────────────────────────────────────

    ipcMain.on("auth:open-external", (_event, url: string) => {
      shell.openExternal(url);
    });

    // Send any deep link URL that arrived before the renderer was ready
    if (pendingDeepLinkUrl) {
      handleDeepLink(pendingDeepLinkUrl);
      pendingDeepLinkUrl = null;
    }

    ipcMain.on("check-for-updates", () => {
      userInitiatedCheck = true;
      autoUpdater.checkForUpdates().catch((err) => {
        sendToMain("error", { message: friendlyUpdateError(err) });
      });
    });

    ipcMain.on("download-update", () => {
      userInitiatedCheck = false;
      autoUpdater.downloadUpdate().catch((err) => {
        sendToMain("error", { message: friendlyUpdateError(err) });
      });
    });

    ipcMain.on("install-update", () => {
      autoUpdater.quitAndInstall(false, true);
    });

    ipcMain.on("ptt-set-key", (_event, pttKey: string) => {
      registerPttShortcut(pttKey);
    });

    ipcMain.on("set-badge-count", (_event, count: number) => {
      app.setBadgeCount(count);
      if (mainWindow) {
        mainWindow.flashFrame(count > 0);
      }
    });

    ipcMain.on("toggle-always-on-top", (event, pinned: boolean) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
        win.setAlwaysOnTop(pinned, "floating");
      }
    });

    app.on("activate", () => {
      if (mainWindow) {
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
      } else {
        createMainWindow();
        mainWindow?.show();
      }
    });
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("will-quit", () => {
    console.log("[Main] will-quit: flushing user store and cleaning up");
    flushUserStore();
    uIOhook.stop();
    localServer?.close();
    localServer = null;
  });
}
