import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import { autoUpdater, UpdateInfo } from "electron-updater";
import {
  appendFileSync,
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { createServer, Server } from "http";
import { dirname, extname, join, resolve } from "path";
import { uIOhook, UiohookKey } from "uiohook-napi";
import { fileURLToPath } from "url";

import {
  getAddons,
  getAddonsDir,
  initAddonManager,
  onAddonsChanged,
  resolveAddonFilePath,
  watchAddons,
} from "./addonManager";
import {
  isNativeAudioCaptureAvailable,
  startNativeAudioCapture,
  stopNativeAudioCapture,
} from "./audioCaptureManager";
import {
  autoStartIfNeeded,
  cleanupOnQuit,
  createAndStartServer,
  dismissEmbeddedServerError,
  getAutoStart,
  getEmbeddedServerInfo,
  getState as getEmbeddedServerState,
  isEmbeddedServerAvailable,
  setAutoStart,
  startExistingServer,
  stopEmbeddedServer,
} from "./embeddedServerManager";
import {
  deleteGlobalValue,
  flushGlobalStore,
  initGlobalStore,
  loadGlobalStore,
  saveGlobalStore,
  setGlobalValue,
} from "./globalStore";
import {
  getDiscoveredLanServers,
  rescanLanServers,
  startLanDiscovery,
} from "./lanDiscovery";
import {
  isNativeScreenCaptureAvailable,
  startNativeScreenCapture,
  stopNativeScreenCapture,
} from "./screenCaptureManager";
import {
  flushUserStore,
  initUserStore,
  loadUser,
  patchUser,
  saveUser,
} from "./userStore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Startup logging ──────────────────────────────────────────────────────

const LOG_PATH = join(app.getPath("userData"), "gryt-startup.log");
const LOG_MAX_BYTES = 50 * 1024;

function startupLog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    if (existsSync(LOG_PATH) && statSync(LOG_PATH).size > LOG_MAX_BYTES) {
      writeFileSync(LOG_PATH, line);
    } else {
      appendFileSync(LOG_PATH, line);
    }
  } catch {
    // Best-effort — never block startup
  }
}

startupLog(
  `App starting (v${app.getVersion()}, ${process.platform} ${process.arch})`
);
// The launch arguments, because they decide which startup path runs and there
// is otherwise no way to tell after the fact. --gryt-update in particular is
// the whole contract between "Update now" and the splash doing the install: if
// it does not survive the relaunch, the update silently does not happen, and
// this line is the difference between knowing that and guessing.
startupLog(`Launch args: ${process.argv.slice(1).join(" ") || "(none)"}`);

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

// A separate asset from the app icon, and it has to be. macOS template images
// are alpha only, so handing it the opaque app icon painted the whole tile
// black — which is exactly what the menu bar was showing. Built by
// scripts/generate-tray-icon.mjs. The @2x file next to it is picked up by name.
const trayIcon = app.isPackaged
  ? join(process.resourcesPath, "trayTemplate.png")
  : join(__dirname, "../build/trayTemplate.png");

/**
 * The Windows and Linux tray, which unlike macOS shows the voice state.
 *
 * Colour assets rather than templates, because neither platform has a template
 * mechanism. Each is a filled disc with its glyph in the logo's ink — see
 * scripts/generate-tray-icon.mjs for why the disc is doing the work and why
 * the muted state is not a slash across the mark.
 *
 * macOS keeps the plain template: a template image is alpha only and cannot
 * carry these colours.
 */
const stateIcon = (name: string) =>
  app.isPackaged
    ? join(process.resourcesPath, `${name}.png`)
    : join(__dirname, `../build/${name}.png`);

const PROTOCOL = "gryt";
const AUTO_START_ARG = "--gryt-autostart";
/**
 * Set on the relaunch that "Update now" triggers.
 *
 * The splash update check is normally skipped for a hidden auto-start, and that
 * is the one launch which must not skip it — someone who starts Gryt minimised
 * with Windows would otherwise never get the update they just asked for.
 */
const UPDATE_ARG = "--gryt-update";
let pendingDeepLinkUrl: string | null = null;
let splashWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let closeToTray = true;

/**
 * What the renderer last told us about voice.
 *
 * The main process has no other way to know any of this — mute and deafen live
 * in the renderer's settings hook, and the SFU connection is a renderer
 * concern. Everything the tray says about voice comes from `set-voice-state`.
 */
type VoiceState = {
  inVoice: boolean;
  muted: boolean;
  deafened: boolean;
  serverName: string | null;
};
let voiceState: VoiceState = {
  inVoice: false,
  muted: false,
  deafened: false,
  serverName: null,
};
let isUserSignedIn = false;
let pttDown = false;
let uiohookRunning = false;
let startHiddenOnLaunch = false;
let localServer: Server | null = null;
let localServerUrl: string | null = null;

// ── Global error handlers ────────────────────────────────────────────────

process.on("uncaughtException", (err) => {
  startupLog(`FATAL uncaughtException: ${err.stack ?? err.message}`);
  dialog.showErrorBox(
    "Gryt — Unexpected Error",
    `${err.message}\n\nThe app will now quit. Check gryt-startup.log in the app data folder for details.`
  );
  app.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const msg =
    reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  startupLog(`unhandledRejection: ${msg}`);
  if (!mainWindow) {
    const short = reason instanceof Error ? reason.message : String(reason);
    dialog.showErrorBox(
      "Gryt — Startup Error",
      `${short}\n\nThe app will now quit. Check gryt-startup.log in the app data folder for details.`
    );
    app.exit(1);
  }
});

// ── Deep link protocol ───────────────────────────────────────────────────

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      resolve(process.argv[1]),
    ]);
  }
} else if (process.platform === "linux" && process.env.APPIMAGE) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.env.APPIMAGE);
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
initGlobalStore(app.getPath("userData"));
initAddonManager(app.getPath("userData"));

function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
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

/**
 * How long to give quitAndInstall before deciding it is not going to quit.
 *
 * A real quit tears the process down well inside this. It is only generous
 * enough that a slow machine mid-teardown is not mislabelled as deferred.
 */
const QUIT_GRACE_MS = 4000;

/** Set when an update is downloaded but could not be applied without a quit. */
let updateDeferredVersion: string | null = null;

/**
 * How long a queued install is assumed to still be in progress.
 *
 * ShipIt waits for this app to exit and then copies the whole bundle — 565 MB
 * and about 14,500 files, which measured at roughly 45 seconds. The window only
 * has to outlast that copy; it is not a promise that the install worked. If the
 * install fails, this expires and updating resumes on its own.
 */
const PENDING_INSTALL_WINDOW_MS = 10 * 60 * 1000;

type PendingInstall = { version: string; queuedAt: number };

/**
 * The install we handed to Squirrel and have not seen the result of yet.
 *
 * This is on disk rather than in memory because the collision it prevents is
 * between two *processes*: the one that queued ShipIt and the one running after
 * it quit.
 */
function readPendingInstall(): PendingInstall | null {
  const raw = readConfig().pendingInstall;
  if (!raw || typeof raw !== "object") return null;
  const { version, queuedAt } = raw as Partial<PendingInstall>;
  if (typeof version !== "string" || typeof queuedAt !== "number") return null;
  return { version, queuedAt };
}

/**
 * Whether an install is still in flight, and so whether starting an update
 * would break it.
 *
 * Starting a second update cycle is not merely wasteful — it destroys the first
 * one. electron-updater kicks Squirrel as soon as a download finishes, Squirrel
 * unpacks into a fresh cache directory and removes the previous one, and the
 * ShipIt already queued against that previous directory then fails part-way
 * through its copy with "no such file". The file it names is arbitrary, which
 * is what made this look like a corrupt build rather than a race.
 *
 * That is how updating v1.4.0-beta.7 over beta.6 failed repeatedly: each retry
 * deleted the staging directory of the attempt before it. Quitting and waiting
 * installed it first time.
 */
function installIsPending(): boolean {
  const pending = readPendingInstall();
  if (!pending) return false;
  // We are the version it was fetching, so it landed.
  if (pending.version === app.getVersion()) {
    clearPendingInstall();
    return false;
  }
  if (Date.now() - pending.queuedAt > PENDING_INSTALL_WINDOW_MS) {
    startupLog(`Update: pending install of ${pending.version} expired`);
    clearPendingInstall();
    return false;
  }
  return true;
}

function markInstallPending(version: string): void {
  writeConfig({ pendingInstall: { version, queuedAt: Date.now() } });
  startupLog(`Update: queued install of ${version}`);
}

function clearPendingInstall(): void {
  writeConfig({ pendingInstall: null });
}

/**
 * electron-updater's own account of what it did.
 *
 * Diagnosing the beta.6 to beta.7 failure meant reading Squirrel's log, because
 * ours did not exist: without a logger electron-updater throws all of it away,
 * and the app's side of an update was invisible after the fact.
 */
autoUpdater.logger = {
  info: (m: unknown) => startupLog(`Update: ${String(m)}`),
  warn: (m: unknown) => startupLog(`Update WARN: ${String(m)}`),
  error: (m: unknown) => startupLog(`Update ERROR: ${String(m)}`),
  debug: (m: unknown) => startupLog(`Update debug: ${String(m)}`),
};

// Running at all is the only confirmation an install worked, so the marker is
// reconciled against the running version once, here. It has to sit below
// configPath rather than beside the startup log at the top of the file —
// readConfig would hit the temporal dead zone and throw before the app opened.
installIsPending();

autoUpdater.autoDownload = false;
// Windows only. NSIS runs the installer while the app is still tearing down —
// renderer, GPU helpers, and the two children this app spawns itself (the SFU
// binary and the embedded server) — and waits on all of it. That is the whole
// reason updating from inside the app crawled there while updating at launch
// did not. The splash does it instead, on a process with none of that running.
// See restartForUpdate.
//
// Left on everywhere else, because the problem is NSIS and turning it off costs
// a working fallback. A downloaded update on macOS applied on quit and did not
// apply any other way, which is not something to remove on a hunch: the mac
// install is a zip swap with none of the tear-down NSIS does.
autoUpdater.autoInstallOnAppQuit = process.platform !== "win32";
/**
 * Whether this install is on the beta channel.
 *
 * Defaults to whether the build you are running is itself a prerelease, not to
 * false. That distinction is the whole fix: `betaChannel !== true` cannot tell
 * "the user turned beta off" apart from "this config has no betaChannel key",
 * and a fresh, reset or newly-written config is the second one. Reading it as
 * the first put a beta build on the stable channel, where the newest thing on
 * offer is an older version than the one running — and with allowDowngrade on
 * below, that is an available update.
 *
 * It is not theoretical. A packaged 1.4.0-beta.3 with a fresh user-data-dir
 * downloaded 1.3.1 and restarted into it, twice, unprompted.
 *
 * Someone who actually turns beta off writes `false` and still gets the
 * downgrade the switch promises.
 */
function isOnBetaChannel(): boolean {
  return readBoolConfig("betaChannel", app.getVersion().includes("-"));
}

autoUpdater.allowPrerelease = isOnBetaChannel();
// Leaving the beta channel is a downgrade — stable is an older version than the
// beta you are running — and electron-updater refuses those by default, taking
// allowDowngrade into account only when the channel differs. Without this,
// turning beta off wrote the setting, restarted, found "no update available"
// and left the user on the beta build permanently, while the confirmation
// dialog had promised it would install the latest stable release.
autoUpdater.allowDowngrade = true;
autoUpdater.logger = console;
closeToTray = (readConfig().closeToTray ?? true) as boolean;
const hardwareAcceleration = readBoolConfig("hardwareAcceleration", true);
if (!hardwareAcceleration) {
  app.disableHardwareAcceleration();
}
let startWithWindows =
  process.platform === "win32"
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
  // An install we already queued may still be copying. Checking now would
  // download again, and the fresh Squirrel staging directory would delete the
  // one that install is reading from — see installIsPending. Doing nothing is
  // what lets it finish.
  if (installIsPending()) {
    const pending = readPendingInstall();
    startupLog(
      `Update: skipping check, install of ${pending?.version} still pending`
    );
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      // Detach here rather than at each exit. Every path used to have to
      // remember, and the timeout path did not — so a check that took longer
      // than the safety timeout left these listeners attached while
      // initBackgroundUpdater added a second set a moment later, and every
      // subsequent update event was handled twice.
      cleanup();
      resolve();
    };

    // Safety timeout on the *check* only. Once a download starts it is
    // cancelled: this path is the only thing that installs an update now, the
    // user is watching a progress bar, and abandoning a 100MB download after
    // 15 seconds would drop them into the app with the update half-fetched and
    // these listeners still attached alongside the ones initBackgroundUpdater
    // adds a moment later.
    let timeout: NodeJS.Timeout | null = setTimeout(done, 15_000);
    const holdOpen = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };

    const onChecking = () => sendToSplash("checking");

    const onAvailable = (info: UpdateInfo) => {
      pendingUpdateVersion = info.version;
      sendToSplash("available", { version: info.version });
      holdOpen();
      autoUpdater.downloadUpdate().catch((err) =>
        onError(err instanceof Error ? err : undefined),
      );
    };

    const onNotAvailable = (info: UpdateInfo) => {
      sendToSplash("not-available", { version: info.version });
      setTimeout(done, 800);
    };

    const onProgress = (progress: {
      percent: number;
      transferred: number;
      total: number;
    }) => {
      holdOpen();
      sendToSplash("downloading", {
        version: pendingUpdateVersion,
        percent: Math.round(progress.percent),
        transferred: progress.transferred,
        total: progress.total,
      });
    };

    const onDownloaded = (info: UpdateInfo) => {
      sendToSplash("downloaded", { version: info.version });
      setTimeout(() => {
        cleanup();
        holdOpen();
        // Let the event loop drain before quitting — improves reliability
        // across platforms (NSIS on Windows, AppImage on Linux).
        setImmediate(() => {
          try {
            // Recorded before the call, not after: quitAndInstall may take the
            // process down immediately, and a marker written after it would
            // never be written at all.
            markInstallPending(info.version);
            autoUpdater.quitAndInstall(false, true);

            // quitAndInstall is not guaranteed to quit, and does not say so.
            //
            // On macOS it is a no-op whenever Squirrel has not finished its own
            // download yet: electron-updater registers an "update-downloaded"
            // listener, skips its checkForUpdates because autoInstallOnAppQuit
            // is true for us, and returns. No quit, no throw. The splash had
            // already promised "Restarting…", so the app walked into the main
            // window still running the old version while Squirrel finished in
            // the background — and the update only landed when the user
            // happened to quit. That is what shipped in v1.4.0-beta.5, and it
            // told the same lie about 1.3.1 before that.
            //
            // If we are still alive a moment later, the quit is not coming.
            // Say what is actually true instead of what we hoped for.
            setTimeout(() => {
              sendToSplash("deferred", { version: info.version });
              updateDeferredVersion = info.version;
              setTimeout(done, 2500);
            }, QUIT_GRACE_MS);
          } catch {
            // If quitAndInstall throws outright, show the main window rather
            // than leaving a blank screen. The update stays downloaded and
            // applies on quit.
            done();
          }
        });
      }, 1500);
    };

    const onError = (err?: Error) => {
      sendToSplash("error", {
        message: err ? friendlyUpdateError(err) : undefined,
      });
      holdOpen();
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

    autoUpdater.checkForUpdates().catch((err) => {
      onError(err instanceof Error ? err : undefined);
    });
  });
}

// ── Background update listeners (after main window is open) ─────────────

function friendlyUpdateError(err: Error): string {
  const msg = err.message;
  if (msg.includes("status 404") || msg.includes("HttpError: 404")) {
    return "The update file was not found. A new release may not have all artifacts uploaded yet — try again in a few minutes.";
  }
  if (
    msg.includes("latest.yml") ||
    msg.includes("latest-linux.yml") ||
    msg.includes("latest-mac.yml")
  ) {
    return "No update available for this channel yet. The release may still be building — try again in a few minutes.";
  }
  if (
    msg.includes("net::ERR_") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("ETIMEDOUT")
  ) {
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

let pendingUpdateVersion: string | undefined;

function initBackgroundUpdater() {
  autoUpdater.on("checking-for-update", () => sendToMain("checking"));
  autoUpdater.on("update-available", (info) => {
    pendingUpdateVersion = info.version;
    sendToMain("available", { version: info.version });
    // Deliberately no download. A running app cannot install one any more, so
    // fetching it here only spends the user's bandwidth on a file the splash
    // will ask for again. It also used to mean anyone who simply closed Gryt
    // after a background check got the heavy install on the way out, without
    // ever clicking anything.
  });
  autoUpdater.on("update-not-available", (info) =>
    sendToMain("not-available", { version: info.version })
  );
  autoUpdater.on("download-progress", (p) =>
    sendToMain("downloading", {
      version: pendingUpdateVersion,
      percent: Math.round(p.percent),
      transferred: p.transferred,
      total: p.total,
    })
  );
  autoUpdater.on("update-downloaded", (info) =>
    sendToMain("downloaded", { version: info.version })
  );
  autoUpdater.on("error", (err) =>
    sendToMain("error", { message: friendlyUpdateError(err) })
  );
}

/**
 * Quit and come straight back, with the splash told to do an update.
 *
 * The installer's job is the same wherever it runs, but from here it would have
 * a loaded app to tear down around itself — renderer, GPU helpers, the SFU
 * binary, the embedded server — and on Windows it waits for all of it. The
 * relaunched process has none of that.
 *
 * AUTO_START_ARG is dropped deliberately: this relaunch is something the user
 * just asked for and is watching, so it must not come back hidden and skip the
 * splash that does the work.
 */
function relaunchForUpdate(): void {
  isQuitting = true;
  const args = process.argv
    .slice(1)
    .filter((a) => a !== AUTO_START_ARG && a !== UPDATE_ARG);
  app.relaunch({ args: [...args, UPDATE_ARG] });
  app.quit();
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

  function tryListen(port: number): Promise<string> {
    return new Promise((resolveUrl, reject) => {
      const server = createServer((req, res) => {
        const pathname = decodeURIComponent(
          new URL(req.url ?? "/", "http://localhost").pathname
        );

        if (pathname.startsWith("/addons/")) {
          const addonFile = resolveAddonFilePath(pathname);
          if (!addonFile) {
            res.writeHead(404);
            res.end();
            return;
          }
          const ext = extname(addonFile).toLowerCase();
          const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
          res.writeHead(200, { "Content-Type": contentType });
          createReadStream(addonFile).pipe(res);
          return;
        }

        const safePath = resolve(distDir, pathname.replace(/^\/+/, ""));

        if (!safePath.startsWith(distDir)) {
          res.writeHead(403);
          res.end();
          return;
        }

        const filePath =
          existsSync(safePath) && statSync(safePath).isFile()
            ? safePath
            : indexPath;
        const ext = extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

        res.writeHead(200, { "Content-Type": contentType });
        createReadStream(filePath).pipe(res);
      });

      server.listen(port, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("Failed to start local server"));
          return;
        }
        localServer = server;
        resolveUrl(`http://127.0.0.1:${addr.port}`);
      });

      server.on("error", reject);
    });
  }

  return tryListen(15738).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      startupLog("Port 15738 in use, falling back to OS-assigned port");
      return tryListen(0);
    }
    throw err;
  });
}

// ── Main window ─────────────────────────────────────────────────────────

function createMainWindow(): BrowserWindow {
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
      backgroundThrottling: true,
    },
    autoHideMenuBar: true,
    title: "Gryt",
  });

  mainWindow.loadURL(
    localServerUrl ?? process.env.VITE_DEV_SERVER_URL ?? "about:blank"
  );

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
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          frame: false,
          backgroundColor: "#111318",
          minWidth: 320,
          minHeight: 180,
        },
      };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting && closeToTray && isUserSignedIn) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Keeps the attached macOS menu's first item honest — without this it still
  // reads "Show Gryt" while the window is up.
  mainWindow.on("show", refreshTrayMenu);
  mainWindow.on("hide", refreshTrayMenu);

  mainWindow.on("focus", () => {
    mainWindow?.webContents.send("window-focus-change", true);
  });

  mainWindow.on("blur", () => {
    mainWindow?.webContents.send("window-focus-change", false);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    startupLog(
      `Render process gone: ${details.reason} (exit code ${details.exitCode})`
    );
    if (details.reason !== "clean-exit") {
      dialog
        .showMessageBox({
          type: "error",
          title: "Gryt — Renderer Crashed",
          message: "The app encountered an error and needs to restart.",
          detail:
            "If this keeps happening, try disabling hardware acceleration in Settings.",
          buttons: ["Restart", "Quit"],
        })
        .then(({ response }) => {
          if (response === 0) {
            app.relaunch();
          }
          isQuitting = true;
          app.quit();
        });
    }
  });

  return mainWindow;
}

// ── PTT helpers (uiohook – passive, does NOT consume key events) ────────

const DOM_CODE_TO_UIOHOOK: Record<string, number> = {
  KeyA: UiohookKey.A,
  KeyB: UiohookKey.B,
  KeyC: UiohookKey.C,
  KeyD: UiohookKey.D,
  KeyE: UiohookKey.E,
  KeyF: UiohookKey.F,
  KeyG: UiohookKey.G,
  KeyH: UiohookKey.H,
  KeyI: UiohookKey.I,
  KeyJ: UiohookKey.J,
  KeyK: UiohookKey.K,
  KeyL: UiohookKey.L,
  KeyM: UiohookKey.M,
  KeyN: UiohookKey.N,
  KeyO: UiohookKey.O,
  KeyP: UiohookKey.P,
  KeyQ: UiohookKey.Q,
  KeyR: UiohookKey.R,
  KeyS: UiohookKey.S,
  KeyT: UiohookKey.T,
  KeyU: UiohookKey.U,
  KeyV: UiohookKey.V,
  KeyW: UiohookKey.W,
  KeyX: UiohookKey.X,
  KeyY: UiohookKey.Y,
  KeyZ: UiohookKey.Z,
  Digit0: UiohookKey["0"],
  Digit1: UiohookKey["1"],
  Digit2: UiohookKey["2"],
  Digit3: UiohookKey["3"],
  Digit4: UiohookKey["4"],
  Digit5: UiohookKey["5"],
  Digit6: UiohookKey["6"],
  Digit7: UiohookKey["7"],
  Digit8: UiohookKey["8"],
  Digit9: UiohookKey["9"],
  Space: UiohookKey.Space,
  Backspace: UiohookKey.Backspace,
  Tab: UiohookKey.Tab,
  Enter: UiohookKey.Enter,
  CapsLock: UiohookKey.CapsLock,
  Escape: UiohookKey.Escape,
  Insert: UiohookKey.Insert,
  Delete: UiohookKey.Delete,
  Home: UiohookKey.Home,
  End: UiohookKey.End,
  PageUp: UiohookKey.PageUp,
  PageDown: UiohookKey.PageDown,
  ArrowUp: UiohookKey.ArrowUp,
  ArrowDown: UiohookKey.ArrowDown,
  ArrowLeft: UiohookKey.ArrowLeft,
  ArrowRight: UiohookKey.ArrowRight,
  F1: UiohookKey.F1,
  F2: UiohookKey.F2,
  F3: UiohookKey.F3,
  F4: UiohookKey.F4,
  F5: UiohookKey.F5,
  F6: UiohookKey.F6,
  F7: UiohookKey.F7,
  F8: UiohookKey.F8,
  F9: UiohookKey.F9,
  F10: UiohookKey.F10,
  F11: UiohookKey.F11,
  F12: UiohookKey.F12,
  Numpad0: UiohookKey.Numpad0,
  Numpad1: UiohookKey.Numpad1,
  Numpad2: UiohookKey.Numpad2,
  Numpad3: UiohookKey.Numpad3,
  Numpad4: UiohookKey.Numpad4,
  Numpad5: UiohookKey.Numpad5,
  Numpad6: UiohookKey.Numpad6,
  Numpad7: UiohookKey.Numpad7,
  Numpad8: UiohookKey.Numpad8,
  Numpad9: UiohookKey.Numpad9,
  NumpadMultiply: UiohookKey.NumpadMultiply,
  NumpadAdd: UiohookKey.NumpadAdd,
  NumpadSubtract: UiohookKey.NumpadSubtract,
  NumpadDecimal: UiohookKey.NumpadDecimal,
  NumpadDivide: UiohookKey.NumpadDivide,
  Semicolon: UiohookKey.Semicolon,
  Equal: UiohookKey.Equal,
  Comma: UiohookKey.Comma,
  Minus: UiohookKey.Minus,
  Period: UiohookKey.Period,
  Slash: UiohookKey.Slash,
  Backquote: UiohookKey.Backquote,
  BracketLeft: UiohookKey.BracketLeft,
  Backslash: UiohookKey.Backslash,
  BracketRight: UiohookKey.BracketRight,
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

function ensureUiohook(): boolean {
  if (uiohookRunning) return true;

  if (process.platform === "darwin") {
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    if (!trusted) {
      startupLog("macOS Accessibility not granted — skipping uiohook");
      return false;
    }
  }

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
  uiohookRunning = true;
  return true;
}

// ── System tray ─────────────────────────────────────────────────────────

function buildTrayContextMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      // Says which way it goes rather than "Show/Hide". On macOS this menu is
      // attached to the tray and is the primary way in, so an ambiguous label
      // is the first thing a user reads.
      label: mainWindow?.isVisible() ? "Hide Gryt" : "Show Gryt",
      click: toggleMainWindow,
    },
    // Voice, but only while there is a call to act on. Mute and deafen with no
    // connection would be toggling something invisible.
    ...(voiceState.inVoice
      ? [
          { type: "separator" } as const,
          {
            label: voiceState.serverName
              ? `Voice — ${voiceState.serverName}`
              : "Voice",
            enabled: false,
          } as const,
          {
            label: "Mute",
            type: "checkbox" as const,
            checked: voiceState.muted,
            // Deafened implies muted, and un-muting without un-deafening would
            // leave you talking to people you cannot hear.
            enabled: !voiceState.deafened,
            click: () => sendVoiceCommand("toggle-mute"),
          },
          {
            label: "Deafen",
            type: "checkbox" as const,
            checked: voiceState.deafened,
            click: () => sendVoiceCommand("toggle-deafen"),
          },
          { type: "separator" } as const,
        ]
      : []),
    // Only while an update is sitting downloaded and unapplied. Quitting is
    // what actually installs it, so the menu offers exactly that rather than
    // making the user guess why the version never changed.
    ...(updateDeferredVersion
      ? [
          {
            label: `Quit and install ${updateDeferredVersion}`,
            click: () => {
              isQuitting = true;
              app.quit();
            },
          } as const,
          { type: "separator" } as const,
        ]
      : []),
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

/**
 * Show the window if it is hidden, hide it if it is already in front.
 *
 * Hiding only when the window is actually focused matters: activating the tray
 * while another app is in front should bring Gryt forward, not dismiss it.
 */
function toggleMainWindow(): void {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

/**
 * The tray, wired the way each platform expects rather than one behaviour
 * everywhere.
 *
 * macOS treats this as a menu bar extra, and Apple's guidance is that one
 * reveals a menu when clicked — there is no left/right split, and a Mac user
 * does not expect a menu bar icon to hide a window. So the menu is attached and
 * either button opens it, with Show/Hide as its first item.
 *
 * Windows and Linux treat it as a notification area icon, where left-click is
 * the primary action and right-click opens the context menu. Attaching the menu
 * there would take the left-click away, so it is popped up on demand instead.
 */
function createTray(): void {
  // Not resized. Every one of these files is already 16px with a 32px @2x
  // beside it, and resizing blurs the detail that makes them legible at all.
  // The app icon used to be resized to 18px here, which is what made the
  // Windows tray a smudge.
  tray = new Tray(nativeImage.createFromPath(currentTrayIconPath()));
  tray.setToolTip(trayTooltip());

  if (process.platform === "darwin") {
    refreshTrayMenu();
  } else {
    tray.on("click", toggleMainWindow);
    tray.on("right-click", () => {
      tray?.popUpContextMenu(buildTrayContextMenu());
    });
  }
}

/**
 * macOS gets the template; everywhere else gets the state.
 *
 * Deafened wins over muted when both are true, which they usually are —
 * deafening mutes you as well, and the speaker-slash is the more complete
 * statement of what is happening.
 */
function currentTrayIconPath(): string {
  if (process.platform === "darwin") return trayIcon;
  if (!voiceState.inVoice) return stateIcon("tray-idle");
  if (voiceState.deafened) return stateIcon("tray-deafened");
  if (voiceState.muted) return stateIcon("tray-muted");
  return stateIcon("tray-live");
}

function trayTooltip(): string {
  if (!voiceState.inVoice) return "Gryt";
  const where = voiceState.serverName ? ` — ${voiceState.serverName}` : "";
  if (voiceState.deafened) return `Gryt — deafened${where}`;
  if (voiceState.muted) return `Gryt — muted${where}`;
  return `Gryt — in voice${where}`;
}

/**
 * Point the tray at whatever the state now says.
 *
 * The icon is set on every platform because the menu is not the only thing
 * that changes, but on macOS `currentTrayIconPath` returns the same template
 * every time, so it is a no-op there rather than a special case here.
 */
function refreshTray(): void {
  if (!tray) return;
  tray.setImage(nativeImage.createFromPath(currentTrayIconPath()));
  tray.setToolTip(trayTooltip());
  refreshTrayMenu();
}

function sendVoiceCommand(command: "toggle-mute" | "toggle-deafen"): void {
  mainWindow?.webContents.send("tray-voice-command", command);
}

/**
 * Rebuilds the attached menu so its first item still says the right thing.
 *
 * Only macOS keeps a menu attached; everywhere else it is built fresh each time
 * it is popped up, so there is nothing to refresh.
 */
function refreshTrayMenu(): void {
  if (process.platform !== "darwin") return;
  tray?.setContextMenu(buildTrayContextMenu());
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

  app
    .whenReady()
    .then(async () => {
      ipcMain.handle("get-app-version", () => app.getVersion());
      // Same default as the updater uses, or the switch in settings would read
      // "off" on a beta build whose config has never been written.
      ipcMain.handle("get-beta-channel", () => isOnBetaChannel());
      ipcMain.on("set-beta-channel", (_event, enabled: boolean) => {
        writeConfig({ betaChannel: enabled });
        autoUpdater.allowPrerelease = enabled;
      });

      ipcMain.on("switch-update-channel", (_event, enabled: boolean) => {
        writeConfig({ betaChannel: enabled });
        autoUpdater.allowPrerelease = enabled;
        // Changing channel is an update request too — moving to beta means
        // fetching a newer build, moving off it means the one you are on is no
        // longer the right one. It used to relaunch bare, which reuses the
        // current argv: for anyone started with --gryt-autostart that meant the
        // relaunch skipped the splash and the channel switch quietly did
        // nothing until the next manual launch.
        relaunchForUpdate();
      });

      ipcMain.handle("get-close-to-tray", () => closeToTray);
      ipcMain.on("set-close-to-tray", (_event, enabled: boolean) => {
        closeToTray = enabled;
        writeConfig({ closeToTray: enabled });
      });

      ipcMain.on("set-signed-in", (_event, signedIn: boolean) => {
        isUserSignedIn = signedIn;
      });

      // The renderer publishes this whenever voice changes. Redrawing the tray
      // on an unchanged state would repaint the icon on every settings write,
      // so the comparison is worth the four lines.
      ipcMain.on("set-voice-state", (_event, next: VoiceState) => {
        const changed =
          next.inVoice !== voiceState.inVoice ||
          next.muted !== voiceState.muted ||
          next.deafened !== voiceState.deafened ||
          next.serverName !== voiceState.serverName;
        if (!changed) return;
        voiceState = next;
        refreshTray();
      });

      ipcMain.handle(
        "get-start-with-windows-supported",
        () => process.platform === "win32"
      );
      ipcMain.handle("get-start-with-windows", () => startWithWindows);
      ipcMain.on("set-start-with-windows", (_event, enabled: boolean) => {
        startWithWindows = !!enabled;
        writeConfig({ startWithWindows });
        applyStartWithWindowsSetting(startWithWindows);
      });

      ipcMain.handle(
        "get-start-minimized-on-login",
        () => startMinimizedOnLogin
      );
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
      ipcMain.handle("user-store:load", (_event, userId: string) =>
        loadUser(userId)
      );
      ipcMain.on(
        "user-store:set",
        (_event, userId: string, key: string, value: unknown) => {
          patchUser(userId, key, value);
        }
      );
      ipcMain.on(
        "user-store:save",
        (_event, userId: string, data: Record<string, unknown>) => {
          saveUser(userId, data);
        }
      );

      // ── Global file store (backs localStorage) ───────────────────────
      ipcMain.handle("global-store:load", () => loadGlobalStore());
      ipcMain.on("global-store:set", (_event, key: string, value: unknown) => {
        setGlobalValue(key, value);
      });
      ipcMain.on("global-store:delete", (_event, key: string) => {
        deleteGlobalValue(key);
      });
      ipcMain.on(
        "global-store:save",
        (_event, data: Record<string, unknown>) => {
          saveGlobalStore(data);
        }
      );

      // ── Addons ─────────────────────────────────────────────────────
      ipcMain.handle("addons:list", () => getAddons());

      ipcMain.handle("addons:open-folder", () =>
        shell.openPath(getAddonsDir())
      );

      ipcMain.handle(
        "addons:resolve-asset",
        (_event, addonId: string, relativePath: string) => {
          if (
            !addonId ||
            !relativePath ||
            addonId.includes("..") ||
            relativePath.includes("..") ||
            relativePath.startsWith("/") ||
            relativePath.startsWith("\\")
          ) {
            throw new Error("Invalid addon asset path");
          }

          const normalizedRelativePath = relativePath.replace(/\\/g, "/");
          const normalizedPath = `/addons/${addonId}/${normalizedRelativePath}`;
          const resolvedPath = resolveAddonFilePath(normalizedPath);

          if (
            !resolvedPath ||
            !existsSync(resolvedPath) ||
            !statSync(resolvedPath).isFile()
          ) {
            throw new Error(
              `Addon asset not found: ${addonId}/${relativePath}`
            );
          }

          if (process.env.VITE_DEV_SERVER_URL) {
            const devBase = process.env.VITE_DEV_SERVER_URL.replace(/\/$/, "");
            return `${devBase}${normalizedPath}`;
          }

          if (!localServerUrl) {
            throw new Error("Local addon asset server is not running");
          }

          return `${localServerUrl}${normalizedPath}`;
        }
      );

      onAddonsChanged((addons) => {
        mainWindow?.webContents.send("addons-changed", addons);
      });

      watchAddons();

      // Apply at startup (default enabled on Windows).
      applyStartWithWindowsSetting(startWithWindows);

      const launchedFromAutoStart =
        process.argv.includes(AUTO_START_ARG) ||
        (() => {
          try {
            return app.getLoginItemSettings().wasOpenedAtLogin === true;
          } catch {
            return false;
          }
        })();
      startHiddenOnLaunch = launchedFromAutoStart && startMinimizedOnLogin;

      if (!process.env.VITE_DEV_SERVER_URL) {
        localServerUrl = await startLocalServer();
        startupLog(`Local server started: ${localServerUrl}`);
      }

      try {
        ensureUiohook();
        startupLog(
          uiohookRunning
            ? "uiohook initialized"
            : "uiohook deferred (no accessibility or not needed yet)"
        );
      } catch (err) {
        startupLog(
          `uiohook failed (PTT disabled): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      // ── Native audio capture IPC ──────────────────────────────────────
      // Registered before createMainWindow to avoid a race: the renderer
      // probes availability in a useEffect on mount, and if the handler
      // isn't ready yet the invoke silently fails → nativeAvailable=false.
      ipcMain.handle("native-audio-capture-available", () => {
        return isNativeAudioCaptureAvailable();
      });
      ipcMain.handle(
        "start-native-audio-capture",
        (_event, sourceId?: string) => {
          if (!mainWindow) return false;
          return startNativeAudioCapture(mainWindow, sourceId);
        }
      );
      ipcMain.on("stop-native-audio-capture", () => {
        stopNativeAudioCapture();
      });

      ipcMain.handle("native-screen-capture:available", () => {
        return isNativeScreenCaptureAvailable();
      });
      ipcMain.handle(
        "native-screen-capture:start",
        async (
          _event,
          monitorIndex: number,
          fps: number,
          maxWidth?: number,
          maxHeight?: number,
          bitrate?: number,
          codec?: string
        ) => {
          if (!mainWindow) return { success: false };
          return startNativeScreenCapture(
            mainWindow,
            monitorIndex,
            fps,
            maxWidth,
            maxHeight,
            bitrate,
            codec
          );
        }
      );
      ipcMain.on("native-screen-capture:stop", () => {
        stopNativeScreenCapture();
      });

      // ── Embedded server ─────────────────────────────────────────────────
      ipcMain.handle("embedded-server:available", () =>
        isEmbeddedServerAvailable()
      );

      ipcMain.handle("embedded-server:info", () => getEmbeddedServerInfo());

      ipcMain.handle(
        "embedded-server:create",
        async (_event, serverName: string, lanDiscoverable: boolean) => {
          if (!mainWindow) return getEmbeddedServerState();
          return createAndStartServer(mainWindow, serverName, lanDiscoverable);
        }
      );

      ipcMain.handle("embedded-server:start", async () => {
        if (!mainWindow) return getEmbeddedServerState();
        return startExistingServer(mainWindow);
      });

      ipcMain.handle("embedded-server:stop", () => {
        stopEmbeddedServer();
        return getEmbeddedServerState();
      });

      ipcMain.handle("embedded-server:dismiss-error", () =>
        dismissEmbeddedServerError()
      );

      ipcMain.handle("embedded-server:status", () => getEmbeddedServerState());

      ipcMain.handle("embedded-server:get-auto-start", () => getAutoStart());

      ipcMain.on(
        "embedded-server:set-auto-start",
        (_event, enabled: boolean) => {
          setAutoStart(enabled);
        }
      );

      createMainWindow();
      startupLog("Main window created");
      createTray();
      startupLog("Tray created");

      if (process.env.VITE_DEV_SERVER_URL) {
        startupLog("Dev mode — skipping splash/update check");
        mainWindow?.show();
      } else if (startHiddenOnLaunch && !process.argv.includes(UPDATE_ARG)) {
        startupLog("Starting hidden (auto-start)");
        initBackgroundUpdater();
        if (!installIsPending()) {
          autoUpdater.checkForUpdates().catch(() => {});
        }
      } else {
        try {
          createSplashWindow();
          await runSplashUpdateCheck();
        } catch (_) {
          // Ensure main window shows even if splash/updater fails
        }
        closeSplashAndShowMain();
        startupLog("Main window shown");
        initBackgroundUpdater();
      }

      // ── Embedded server auto-start ────────────────────────────────
      if (mainWindow) {
        autoStartIfNeeded(mainWindow).catch((err) => {
          startupLog(`Embedded server auto-start failed: ${err}`);
        });
      }

      // Background checks only report that an update exists. Downloading and
      // installing happen on the next launch, from the splash — see
      // restart-for-update.

      // ── Embed origin fix ────────────────────────────────────────────
      // Third-party embed players (YouTube, Vimeo, Spotify, etc.) reject
      // iframes whose parent is file://.  Spoof valid HTTP Referer/Origin
      // so the embed players accept playback in packaged Electron.
      const embedOriginMap: [string[], string][] = [
        [
          [
            "https://*.youtube.com/*",
            "https://*.youtube-nocookie.com/*",
            "https://*.googlevideo.com/*",
            "https://*.ytimg.com/*",
          ],
          "https://www.youtube-nocookie.com",
        ],
        [
          ["https://*.vimeo.com/*", "https://*.vimeocdn.com/*"],
          "https://player.vimeo.com",
        ],
        [["https://clips.twitch.tv/*"], "https://clips.twitch.tv"],
        [
          [
            "https://*.twitch.tv/*",
            "https://*.twitchcdn.net/*",
            "https://*.jtvnw.net/*",
          ],
          "https://player.twitch.tv",
        ],
        [
          ["https://*.spotify.com/*", "https://*.spotifycdn.com/*"],
          "https://open.spotify.com",
        ],
        [
          ["https://*.tiktok.com/*", "https://*.tiktokcdn.com/*"],
          "https://www.tiktok.com",
        ],
        [
          ["https://*.instagram.com/*", "https://*.cdninstagram.com/*"],
          "https://www.instagram.com",
        ],
        [
          ["https://*.soundcloud.com/*", "https://*.sndcdn.com/*"],
          "https://w.soundcloud.com",
        ],
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
        }
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
        }
      );

      // ── Screen capture ────────────────────────────────────────────────
      // Allow getDisplayMedia by providing a default handler.
      // Our renderer uses a custom picker via get-desktop-sources instead.
      session.defaultSession.setDisplayMediaRequestHandler(
        (_request, callback) => {
          desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
            callback({ video: sources[0], audio: "loopback" });
          });
        }
      );

      ipcMain.handle("get-screen-capture-access", () => {
        if (process.platform !== "darwin") return "granted";
        return systemPreferences.getMediaAccessStatus("screen");
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
            sourceType: isScreen ? ("screen" as const) : ("window" as const),
            width,
            height,
          };
        });
      });

      // ── Native audio capture ──────────────────────────────────────────
      // (Handlers registered before createMainWindow — see above)

      // ── IPC handlers ──────────────────────────────────────────────────

      ipcMain.on("auth:open-external", (_event, url: string) => {
        shell.openExternal(url);
      });

      // Send any deep link URL that arrived before the renderer was ready
      if (pendingDeepLinkUrl) {
        handleDeepLink(pendingDeepLinkUrl);
        pendingDeepLinkUrl = null;
      }

      // ── LAN server discovery (mDNS) ────────────────────────────────
      if (mainWindow) {
        const stopLanDiscovery = startLanDiscovery(mainWindow, startupLog);
        app.on("before-quit", stopLanDiscovery);

        // Discovery announces a server once, when it first appears. A renderer
        // that mounts or reloads afterwards has nothing to react to, so it asks
        // for the current list instead of waiting for an event that will not
        // come.
        ipcMain.handle("lan:get-servers", () => getDiscoveredLanServers());
        ipcMain.on("lan:rescan", () => rescanLanServers());
      }

      ipcMain.on("check-for-updates", () => {
        // Report the install we already have rather than looking for another
        // one. The check itself is harmless, but it ends with the settings
        // panel offering "Restart and update", and taking that offer starts the
        // second update cycle that destroys the first.
        if (installIsPending()) {
          sendToMain("pending", { version: readPendingInstall()?.version });
          return;
        }
        autoUpdater.checkForUpdates().catch((err) => {
          sendToMain("error", { message: friendlyUpdateError(err) });
        });
      });

      ipcMain.on("restart-for-update", () => {
        if (installIsPending()) {
          sendToMain("pending", { version: readPendingInstall()?.version });
          return;
        }
        relaunchForUpdate();
      });

      ipcMain.on("ptt-set-key", (_event, pttKey: string) => {
        registerPttShortcut(pttKey);
        if (pttKey && !uiohookRunning) {
          if (process.platform === "darwin") {
            systemPreferences.isTrustedAccessibilityClient(true);
          }
          try {
            ensureUiohook();
          } catch (err) {
            console.warn(
              `uiohook start failed: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
      });

      ipcMain.on("set-badge-count", (_event, count: number) => {
        app.setBadgeCount(count);
        if (mainWindow) {
          mainWindow.flashFrame(count > 0);
        }
      });

      ipcMain.on(
        "toggle-always-on-top",
        (event, pinned: boolean, windowTitle?: string) => {
          let win: BrowserWindow | null = null;
          if (windowTitle) {
            win =
              BrowserWindow.getAllWindows().find(
                (w) => w.getTitle() === windowTitle
              ) ?? null;
          }
          if (!win) {
            win = BrowserWindow.fromWebContents(event.sender);
          }
          if (win) {
            win.setAlwaysOnTop(pinned, "floating");
          }
        }
      );

      app.on("activate", () => {
        if (mainWindow) {
          if (!mainWindow.isVisible()) mainWindow.show();
          mainWindow.focus();
        } else {
          const createdWindow = createMainWindow();
          createdWindow.show();
        }
      });
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      startupLog(
        `FATAL startup error: ${
          err instanceof Error ? err.stack ?? err.message : msg
        }`
      );
      dialog.showErrorBox(
        "Gryt — Failed to Start",
        `${msg}\n\nCheck gryt-startup.log in the app data folder for details.`
      );
      app.exit(1);
    });

  app.on("child-process-gone", (_event, details) => {
    startupLog(
      `Child process gone: type=${details.type} reason=${details.reason}`
    );
    if (details.type === "GPU" && details.reason !== "clean-exit") {
      startupLog(
        "GPU process crashed — consider disabling hardware acceleration"
      );
    }
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("will-quit", () => {
    console.log("[Main] will-quit: flushing stores and cleaning up");
    flushUserStore();
    flushGlobalStore();
    if (uiohookRunning) {
      uIOhook.stop();
      uiohookRunning = false;
    }
    localServer?.close();
    localServer = null;
    cleanupOnQuit();
  });
}
