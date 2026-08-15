import { spawn } from "child_process";
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import { autoUpdater, UpdateDownloadedEvent, UpdateInfo } from "electron-updater";
import {
  appendFileSync,
  createReadStream,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { createServer, Server } from "http";
import { dirname, extname, join, resolve } from "path";
import semver from "semver";
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
  clearEmbeddedServerLogs,
  createAndStartServer,
  deleteServer,
  dismissEmbeddedServerError,
  getAllStates,
  getAutoStart,
  getEmbeddedServerInfo,
  getEmbeddedServerLogs,
  isEmbeddedServerAvailable,
  isPortAvailable,
  prepareEmbeddedServerRuntime,
  setAutoStart,
  startExistingServer,
  stopServer,
  suggestServerPort,
  updateServerAdvertisedAddresses,
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

const trayIcon = app.isPackaged
  ? join(process.resourcesPath, "trayTemplate.png")
  : join(__dirname, "../build/trayTemplate.png");

const stateIcon = (name: string) =>
  app.isPackaged
    ? join(process.resourcesPath, `${name}.png`)
    : join(__dirname, `../build/${name}.png`);

const PROTOCOL = "gryt";
const AUTO_START_ARG = "--gryt-autostart";
const UPDATE_ARG = "--gryt-update";

let pendingDeepLinkUrl: string | null = null;
let splashWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let closeToTray = true;

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

const INSTALL_WAIT_MS = 5 * 60 * 1000;

let updateDeferredVersion: string | null = null;

const PENDING_INSTALL_WINDOW_MS = 10 * 60 * 1000;

type PendingInstall = {
  version: string;
  queuedAt: number;
};

function readPendingInstall(): PendingInstall | null {
  const raw = readConfig().pendingInstall;
  if (!raw || typeof raw !== "object") return null;

  const { version, queuedAt } = raw as Partial<PendingInstall>;

  if (typeof version !== "string" || typeof queuedAt !== "number") {
    return null;
  }

  return { version, queuedAt };
}

function installIsPending(): boolean {
  const pending = readPendingInstall();
  if (!pending) return false;

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
  writeConfig({
    pendingInstall: {
      version,
      queuedAt: Date.now(),
    },
  });

  startupLog(`Update: queued install of ${version}`);
}

function clearPendingInstall(): void {
  writeConfig({ pendingInstall: null });
}

/**
 * Remove the rollback directory left behind by the one-time Windows NSIS
 * migration.
 *
 * The migration installer deliberately renames:
 *
 *   gryt-chat -> gryt-chat.old
 *
 * instead of deleting the old installation. If the new installer fails,
 * those files remain recoverable.
 *
 * Reaching this code in the new packaged Gryt process means the replacement
 * installation itself has successfully started. At that point the rollback
 * copy is no longer needed.
 *
 * User data lives under Electron's userData directory and is never touched.
 */
function cleanupLegacyWindowsInstallBackup(): void {
  if (process.platform !== "win32" || !app.isPackaged) return;

  const installDir = dirname(process.execPath);
  const backupDir = `${installDir}.old`;
  const previousBackupDir = `${installDir}.old.previous`;

  try {
    if (existsSync(backupDir)) {
      startupLog(`Windows migration: removing rollback backup ${backupDir}`);
      rmSync(backupDir, {
        recursive: true,
        force: true,
      });
    }

    if (existsSync(previousBackupDir)) {
      startupLog(
        `Windows migration: removing previous rollback backup ${previousBackupDir}`
      );
      rmSync(previousBackupDir, {
        recursive: true,
        force: true,
      });
    }
  } catch (err) {
    startupLog(
      `Windows migration cleanup failed: ${
        err instanceof Error ? err.stack ?? err.message : String(err)
      }`
    );
  }
}

/**
 * Start NSIS only after every process belonging to the currently installed
 * Gryt application has gone away.
 *
 * The detached helper runs from powershell.exe, outside $INSTDIR, so it
 * survives Electron shutting down and can safely launch the downloaded
 * installer afterwards.
 *
 * Waiting only for the Electron main PID is not enough: renderers, GPU
 * processes, utility processes, or native Gryt helpers can outlive it briefly.
 */
function launchWindowsInstallerAfterExit(installerPath: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";

    const powershell = join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );

    const installDir = dirname(process.execPath);

    const command = [
      "$parentId = [int]$args[0]",
      "$installer = $args[1]",
      "$installDir = $args[2]",

      // First wait for Electron's main process.
      "Wait-Process -Id $parentId -ErrorAction SilentlyContinue",

      // Then wait for every process whose executable belongs to this Gryt
      // installation. Electron renderer/GPU/utility processes all use the same
      // executable path and may disappear slightly after the main process.
      "$deadline = (Get-Date).AddSeconds(20)",
      "$running = @()",

      "do {",
      "  $running = @(Get-CimInstance Win32_Process | Where-Object {",
      "    $_.ExecutablePath -and",
      "    $_.ExecutablePath.StartsWith(",
      "      $installDir,",
      "      [System.StringComparison]::OrdinalIgnoreCase",
      "    )",
      "  })",

      "  if ($running.Count -eq 0) { break }",
      "  Start-Sleep -Milliseconds 250",
      "} while ((Get-Date) -lt $deadline)",

      // If something genuinely got stuck, terminate only processes whose
      // executable lives under this Gryt installation.
      "if ($running.Count -gt 0) {",
      "  $running | ForEach-Object {",
      "    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue",
      "  }",
      "  Start-Sleep -Milliseconds 500",
      "}",

      // The installer contains the one-time legacy migration. --force-run
      // ensures the newly installed Gryt starts again afterwards.
      "Start-Process -FilePath $installer -ArgumentList '--updated','--force-run'",
    ].join("; ");

    const helper = spawn(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        command,
        String(process.pid),
        installerPath,
        installDir,
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }
    );

    helper.once("error", rejectPromise);

    helper.once("spawn", () => {
      helper.unref();
      resolvePromise();
    });
  });
}

autoUpdater.logger = {
  info: (m: unknown) => startupLog(`Update: ${String(m)}`),
  warn: (m: unknown) => startupLog(`Update WARN: ${String(m)}`),
  error: (m: unknown) => startupLog(`Update ERROR: ${String(m)}`),
  debug: (m: unknown) => startupLog(`Update debug: ${String(m)}`),
};

installIsPending();

autoUpdater.autoDownload = false;

autoUpdater.autoInstallOnAppQuit = process.platform !== "win32";

function isOnBetaChannel(): boolean {
  return readBoolConfig("betaChannel", app.getVersion().includes("-"));
}

autoUpdater.allowPrerelease = isOnBetaChannel();

autoUpdater.allowDowngrade = true;

// IMPORTANT:
// Do not overwrite autoUpdater.logger with console here. The persistent
// startup log above is what lets update failures survive process restarts.

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
    app.setLoginItemSettings({
      openAtLogin: enabled,
      args: [AUTO_START_ARG],
    });
  } catch {
    // Best-effort: some environments (portable/dev) may not support this.
  }
}

function sendToSplash(status: string, info?: Record<string, unknown>) {
  splashWindow?.webContents.send("update-status", {
    status,
    ...info,
  });
}

function sendToMain(status: string, info?: Record<string, unknown>) {
  mainWindow?.webContents.send("update-status", {
    status,
    ...info,
  });
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

function runSplashUpdateCheck(): Promise<void> {
  if (installIsPending()) {
    const pending = readPendingInstall();

    startupLog(
      `Update: skipping check, install of ${pending?.version} still pending`
    );

    return Promise.resolve();
  }

  return new Promise((resolvePromise) => {
    let settled = false;

    const done = () => {
      if (settled) return;

      settled = true;
      cleanup();
      resolvePromise();
    };

    let timeout: NodeJS.Timeout | null = setTimeout(done, 15_000);

    const holdOpen = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };

    const onChecking = () => {
      sendToSplash("checking");
    };

    const onAvailable = (info: UpdateInfo) => {
      pendingUpdateVersion = info.version;

      sendToSplash("available", {
        version: info.version,
      });

      holdOpen();

      autoUpdater
        .downloadUpdate()
        .then(async (downloadedFiles) => {
          markInstallPending(info.version);

          sendToSplash("installing", {
            version: info.version,
          });

          if (process.platform === "win32") {
            const installerPath = downloadedFiles[0];

            if (!installerPath) {
              throw new Error(
                "The downloaded Windows installer path is missing"
              );
            }

            await launchWindowsInstallerAfterExit(installerPath);

            isQuitting = true;
            app.quit();
            return;
          }

          autoUpdater.quitAndInstall(false, true);

          setTimeout(() => {
            updateDeferredVersion = info.version;

            sendToSplash("deferred", {
              version: info.version,
            });

            setTimeout(done, 2500);
          }, INSTALL_WAIT_MS);
        })
        .catch((err) => {
          onError(err instanceof Error ? err : undefined);
        });
    };

    const onNotAvailable = (info: UpdateInfo) => {
      sendToSplash("not-available", {
        version: info.version,
      });

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

    const onDownloaded = (info: UpdateDownloadedEvent) => {
      sendToSplash("downloaded", {
        version: info.version,
      });
    };

    const onError = (err?: Error) => {
      logUpdateFailure("Update failed", err);

      if (err && isReleaseNotReadyYet(err)) {
        sendToSplash("not-available", {
          version: app.getVersion(),
        });

        setTimeout(done, 600);
        return;
      }

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

    pinFeedToNewestCompleteRelease().finally(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        onError(err instanceof Error ? err : undefined);
      });
    });
  });
}

// ── Background update listeners ─────────────────────────────────────────

function isReleaseNotReadyYet(err: Error): boolean {
  const msg = err.message;

  return (
    msg.includes("status 404") ||
    msg.includes("HttpError: 404") ||
    msg.includes("latest.yml") ||
    msg.includes("latest-linux.yml") ||
    msg.includes("latest-mac.yml")
  );
}

const UPDATE_OWNER = "Gryt-chat";
const UPDATE_REPO = "gryt";

type GhAsset = {
  name: string;
  size: number;
  browser_download_url: string;
};

type GhRelease = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: GhAsset[];
};

function channelYmlName(): string {
  if (process.platform === "darwin") return "latest-mac.yml";
  if (process.platform === "win32") return "latest.yml";
  return "latest-linux.yml";
}

async function fetchWithTimeout(
  url: string,
  ms = 8000
): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(ms),
      headers: {
        "User-Agent": `Gryt/${app.getVersion()}`,
      },
    });

    return res.ok ? res : null;
  } catch {
    return null;
  }
}

async function releaseIsInstallable(
  release: GhRelease
): Promise<boolean> {
  const yml = release.assets.find(
    (asset) => asset.name === channelYmlName() && asset.size > 0
  );

  if (!yml) return false;

  const res = await fetchWithTimeout(yml.browser_download_url);
  if (!res) return false;

  const named = (await res.text()).match(/^path:\s*(.+)$/m);
  if (!named) return false;

  const file = named[1]
    .trim()
    .replace(/^["']|["']$/g, "");

  return release.assets.some(
    (asset) => asset.name === file && asset.size > 0
  );
}

async function pinFeedToNewestCompleteRelease(): Promise<void> {
  const res = await fetchWithTimeout(
    `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases?per_page=20`
  );

  if (!res) return;

  let releases: GhRelease[];

  try {
    releases = (await res.json()) as GhRelease[];
  } catch {
    return;
  }

  if (!Array.isArray(releases)) return;

  const current = app.getVersion();
  const wantPrerelease = isOnBetaChannel();

  const candidates = releases
    .filter(
      (release) =>
        !release.draft &&
        (wantPrerelease || !release.prerelease)
    )
    .map((release) => ({
      release,
      version: (release.tag_name || "").replace(/^v/, ""),
    }))
    .filter(
      ({ version }) =>
        semver.valid(version) &&
        semver.gt(version, current)
    )
    .sort((a, b) =>
      semver.rcompare(a.version, b.version)
    );

  for (const { release, version } of candidates) {
    if (await releaseIsInstallable(release)) {
      autoUpdater.setFeedURL({
        provider: "generic",
        url: `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases/download/${release.tag_name}`,
      });

      startupLog(`Update: feed pinned to ${release.tag_name}`);
      return;
    }

    startupLog(
      `Update: skipping ${version}, assets incomplete`
    );
  }
}

let lastUpdateFailure = {
  message: "",
  at: 0,
};

function logUpdateFailure(
  context: string,
  err?: Error
): void {
  const message = err
    ? err.stack || err.message
    : "unknown";

  const now = Date.now();

  if (
    message === lastUpdateFailure.message &&
    now - lastUpdateFailure.at < 10_000
  ) {
    return;
  }

  lastUpdateFailure = {
    message,
    at: now,
  };

  startupLog(`${context}: ${message}`);
}

function friendlyUpdateError(err: Error): string {
  const msg = err.message;

  if (
    msg.includes("status 404") ||
    msg.includes("HttpError: 404")
  ) {
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
    msg.includes("HttpError: 429") ||
    msg.toLowerCase().includes("rate limit")
  ) {
    return "GitHub is rate limiting this machine, so the update could not be fetched. It clears on its own, so try again in a few minutes.";
  }

  if (
    msg.includes("ERR_HTTP2_SERVER_REFUSED_STREAM") ||
    msg.includes("ERR_HTTP2_PROTOCOL_ERROR") ||
    msg.includes("ERR_CONNECTION_CLOSED") ||
    msg.includes("ERR_CONNECTION_RESET") ||
    msg.includes("ERR_EMPTY_RESPONSE")
  ) {
    return "The update could not be fetched. The connection to GitHub closed before it finished. This is usually temporary, so try again in a few minutes.";
  }

  if (
    msg.includes("net::ERR_") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("ETIMEDOUT")
  ) {
    return "Could not reach the update server. Check your internet connection and try again.";
  }

  if (
    msg.includes("HttpError: 403") ||
    msg.includes("HttpError: 401")
  ) {
    return "Access denied while checking for updates. The release may be private or your token has expired.";
  }

  if (msg.includes("sha512 checksum mismatch")) {
    return "Downloaded update failed integrity check. Try checking for updates again.";
  }

  return msg;
}

let pendingUpdateVersion: string | undefined;

function initBackgroundUpdater() {
  autoUpdater.on(
    "checking-for-update",
    () => sendToMain("checking")
  );

  autoUpdater.on("update-available", (info) => {
    pendingUpdateVersion = info.version;

    sendToMain("available", {
      version: info.version,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    sendToMain("not-available", {
      version: info.version,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendToMain("downloading", {
      version: pendingUpdateVersion,
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    sendToMain("downloaded", {
      version: info.version,
    });
  });

  autoUpdater.on("error", (err) => {
    logUpdateFailure("Update failed", err);

    if (isReleaseNotReadyYet(err)) {
      sendToMain("not-available", {
        version: app.getVersion(),
      });
      return;
    }

    sendToMain("error", {
      message: friendlyUpdateError(err),
    });
  });
}

function relaunchForUpdate(): void {
  isQuitting = true;

  const args = process.argv
    .slice(1)
    .filter(
      (arg) =>
        arg !== AUTO_START_ARG &&
        arg !== UPDATE_ARG
    );

  app.relaunch({
    args: [...args, UPDATE_ARG],
  });

  app.quit();
}

// ── Local static server ──────────────────────────────────────────────────

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
          new URL(
            req.url ?? "/",
            "http://localhost"
          ).pathname
        );

        if (pathname.startsWith("/addons/")) {
          const addonFile =
            resolveAddonFilePath(pathname);

          if (!addonFile) {
            res.writeHead(404);
            res.end();
            return;
          }

          const ext =
            extname(addonFile).toLowerCase();

          const contentType =
            MIME_TYPES[ext] ??
            "application/octet-stream";

          res.writeHead(200, {
            "Content-Type": contentType,
          });

          createReadStream(addonFile).pipe(res);
          return;
        }

        const safePath = resolve(
          distDir,
          pathname.replace(/^\/+/, "")
        );

        if (!safePath.startsWith(distDir)) {
          res.writeHead(403);
          res.end();
          return;
        }

        const filePath =
          existsSync(safePath) &&
          statSync(safePath).isFile()
            ? safePath
            : indexPath;

        const ext =
          extname(filePath).toLowerCase();

        const contentType =
          MIME_TYPES[ext] ??
          "application/octet-stream";

        res.writeHead(200, {
          "Content-Type": contentType,
        });

        createReadStream(filePath).pipe(res);
      });

      server.listen(
        port,
        "127.0.0.1",
        () => {
          const addr = server.address();

          if (
            !addr ||
            typeof addr === "string"
          ) {
            reject(
              new Error(
                "Failed to start local server"
              )
            );
            return;
          }

          localServer = server;

          resolveUrl(
            `http://127.0.0.1:${addr.port}`
          );
        }
      );

      server.on("error", reject);
    });
  }

  return tryListen(15738).catch(
    (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        startupLog(
          "Port 15738 in use, falling back to OS-assigned port"
        );
        return tryListen(0);
      }

      throw err;
    }
  );
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
      preload: join(
        __dirname,
        "preload.cjs"
      ),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true,
    },

    autoHideMenuBar: true,
    title: "Gryt",
  });

  mainWindow.loadURL(
    localServerUrl ??
      process.env.VITE_DEV_SERVER_URL ??
      "about:blank"
  );

  if (!startHiddenOnLaunch) {
    setTimeout(() => {
      if (
        mainWindow &&
        !mainWindow.isVisible()
      ) {
        closeSplashAndShowMain();
      }
    }, 20_000);
  }

  mainWindow.webContents.on(
    "before-input-event",
    (_event, input) => {
      if (
        input.key === "F12" &&
        input.type === "keyDown"
      ) {
        mainWindow?.webContents.toggleDevTools();
      }
    }
  );

  mainWindow.webContents.setWindowOpenHandler(
    ({ url }) => {
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

      return {
        action: "deny",
      };
    }
  );

  mainWindow.on("close", (event) => {
    if (
      !isQuitting &&
      closeToTray &&
      isUserSignedIn
    ) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on(
    "show",
    refreshTrayMenu
  );

  mainWindow.on(
    "hide",
    refreshTrayMenu
  );

  mainWindow.on("focus", () => {
    mainWindow?.webContents.send(
      "window-focus-change",
      true
    );
  });

  mainWindow.on("blur", () => {
    mainWindow?.webContents.send(
      "window-focus-change",
      false
    );
  });

  mainWindow.webContents.on(
    "render-process-gone",
    (_event, details) => {
      startupLog(
        `Render process gone: ${details.reason} (exit code ${details.exitCode})`
      );

      if (
        details.reason !== "clean-exit"
      ) {
        dialog
          .showMessageBox({
            type: "error",
            title:
              "Gryt — Renderer Crashed",
            message:
              "The app encountered an error and needs to restart.",
            detail:
              "If this keeps happening, try disabling hardware acceleration in Settings.",
            buttons: [
              "Restart",
              "Quit",
            ],
          })
          .then(({ response }) => {
            if (response === 0) {
              app.relaunch();
            }

            isQuitting = true;
            app.quit();
          });
      }
    }
  );

  return mainWindow;
}

// ── PTT helpers ─────────────────────────────────────────────────────────

type UiohookLib =
  typeof import("uiohook-napi");

let uiohookLib:
  | UiohookLib
  | null
  | undefined;

function loadUiohook(): UiohookLib | null {
  if (uiohookLib !== undefined) {
    return uiohookLib;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require("uiohook-napi") as UiohookLib;
    uiohookLib = loaded;
  } catch (err) {
    startupLog(
      `uiohook unavailable: ${
        err instanceof Error
          ? err.message
          : String(err)
      }`
    );

    uiohookLib = null;
  }

  return uiohookLib;
}

let domCodeToKeycode:
  | Record<string, number>
  | null = null;

function keycodeForDomCode(
  code: string
): number | undefined {
  if (!domCodeToKeycode) {
    const lib = loadUiohook();
    if (!lib) return undefined;

    const UiohookKey =
      lib.UiohookKey;

    domCodeToKeycode = {
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

      NumpadMultiply:
        UiohookKey.NumpadMultiply,
      NumpadAdd:
        UiohookKey.NumpadAdd,
      NumpadSubtract:
        UiohookKey.NumpadSubtract,
      NumpadDecimal:
        UiohookKey.NumpadDecimal,
      NumpadDivide:
        UiohookKey.NumpadDivide,

      Semicolon:
        UiohookKey.Semicolon,
      Equal:
        UiohookKey.Equal,
      Comma:
        UiohookKey.Comma,
      Minus:
        UiohookKey.Minus,
      Period:
        UiohookKey.Period,
      Slash:
        UiohookKey.Slash,
      Backquote:
        UiohookKey.Backquote,
      BracketLeft:
        UiohookKey.BracketLeft,
      Backslash:
        UiohookKey.Backslash,
      BracketRight:
        UiohookKey.BracketRight,
      Quote:
        UiohookKey.Quote,
    };
  }

  return domCodeToKeycode[code];
}

let pttKeycode: number | null = null;
let pttNeedsCtrl = false;
let pttNeedsShift = false;
let pttNeedsAlt = false;
let pttNeedsMeta = false;

function registerPttShortcut(
  pttKey: string
): void {
  pttDown = false;
  pttKeycode = null;
  pttNeedsCtrl = false;
  pttNeedsShift = false;
  pttNeedsAlt = false;
  pttNeedsMeta = false;

  if (!pttKey) return;

  const parts = pttKey.split("+");
  const baseKey =
    parts[parts.length - 1];

  const keycode =
    keycodeForDomCode(baseKey);

  if (keycode == null) {
    console.warn(
      `No uiohook mapping for PTT key "${baseKey}"`
    );
    return;
  }

  pttKeycode = keycode;
  pttNeedsCtrl =
    parts.includes("Ctrl");
  pttNeedsShift =
    parts.includes("Shift");
  pttNeedsAlt =
    parts.includes("Alt");
  pttNeedsMeta =
    parts.includes("Meta");
}

function ensureUiohook(): boolean {
  if (uiohookRunning) return true;

  const lib = loadUiohook();
  if (!lib) return false;

  const uIOhook = lib.uIOhook;

  if (process.platform === "darwin") {
    const trusted =
      systemPreferences.isTrustedAccessibilityClient(
        false
      );

    if (!trusted) {
      startupLog(
        "macOS Accessibility not granted — skipping uiohook"
      );
      return false;
    }
  }

  uIOhook.on("keydown", (event) => {
    if (pttKeycode == null) return;
    if (event.keycode !== pttKeycode)
      return;
    if (
      event.ctrlKey !==
      pttNeedsCtrl
    )
      return;
    if (
      event.shiftKey !==
      pttNeedsShift
    )
      return;
    if (
      event.altKey !==
      pttNeedsAlt
    )
      return;
    if (
      event.metaKey !==
      pttNeedsMeta
    )
      return;

    if (!pttDown) {
      pttDown = true;
      mainWindow?.webContents.send(
        "ptt-down"
      );
    }
  });

  uIOhook.on("keyup", (event) => {
    if (
      !pttDown ||
      pttKeycode == null
    ) {
      return;
    }

    if (
      event.keycode !==
      pttKeycode
    ) {
      return;
    }

    pttDown = false;

    mainWindow?.webContents.send(
      "ptt-up"
    );
  });

  uIOhook.start();
  uiohookRunning = true;

  return true;
}

// ── System tray ─────────────────────────────────────────────────────────

function buildTrayContextMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: mainWindow?.isVisible()
        ? "Hide Gryt"
        : "Show Gryt",
      click: toggleMainWindow,
    },

    ...(voiceState.inVoice
      ? [
          {
            type: "separator",
          } as const,

          {
            label: voiceState.serverName
              ? `Voice — ${voiceState.serverName}`
              : "Voice",
            enabled: false,
          } as const,

          {
            label: "Mute",
            type: "checkbox" as const,
            checked:
              voiceState.muted,
            enabled:
              !voiceState.deafened,
            click: () =>
              sendVoiceCommand(
                "toggle-mute"
              ),
          },

          {
            label: "Deafen",
            type: "checkbox" as const,
            checked:
              voiceState.deafened,
            click: () =>
              sendVoiceCommand(
                "toggle-deafen"
              ),
          },

          {
            type: "separator",
          } as const,
        ]
      : []),

    ...(updateDeferredVersion
      ? [
          {
            label:
              `Quit and install ${updateDeferredVersion}`,
            click: () => {
              isQuitting = true;
              app.quit();
            },
          } as const,

          {
            type: "separator",
          } as const,
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

    {
      type: "separator",
    },

    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function toggleMainWindow(): void {
  if (!mainWindow) {
    createMainWindow();
    return;
  }

  if (
    mainWindow.isVisible() &&
    mainWindow.isFocused()
  ) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray(): void {
  tray = new Tray(
    nativeImage.createFromPath(
      currentTrayIconPath()
    )
  );

  tray.setToolTip(
    trayTooltip()
  );

  if (
    process.platform === "darwin"
  ) {
    refreshTrayMenu();
  } else {
    tray.on(
      "click",
      toggleMainWindow
    );

    tray.on(
      "right-click",
      () => {
        tray?.popUpContextMenu(
          buildTrayContextMenu()
        );
      }
    );
  }
}

function currentTrayIconPath(): string {
  if (
    process.platform === "darwin"
  ) {
    return trayIcon;
  }

  if (!voiceState.inVoice) {
    return stateIcon("tray-idle");
  }

  if (voiceState.deafened) {
    return stateIcon(
      "tray-deafened"
    );
  }

  if (voiceState.muted) {
    return stateIcon("tray-muted");
  }

  return stateIcon("tray-live");
}

function trayTooltip(): string {
  if (!voiceState.inVoice) {
    return "Gryt";
  }

  const where =
    voiceState.serverName
      ? ` — ${voiceState.serverName}`
      : "";

  if (voiceState.deafened) {
    return `Gryt — deafened${where}`;
  }

  if (voiceState.muted) {
    return `Gryt — muted${where}`;
  }

  return `Gryt — in voice${where}`;
}

function refreshTray(): void {
  if (!tray) return;

  tray.setImage(
    nativeImage.createFromPath(
      currentTrayIconPath()
    )
  );

  tray.setToolTip(
    trayTooltip()
  );

  refreshTrayMenu();
}

function sendVoiceCommand(
  command:
    | "toggle-mute"
    | "toggle-deafen"
): void {
  mainWindow?.webContents.send(
    "tray-voice-command",
    command
  );
}

function refreshTrayMenu(): void {
  if (
    process.platform !== "darwin"
  ) {
    return;
  }

  tray?.setContextMenu(
    buildTrayContextMenu()
  );
}

// ── App lifecycle ───────────────────────────────────────────────────────

const gotSingleInstanceLock =
  app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on(
    "second-instance",
    (_event, argv) => {
      const deepLink = argv.find(
        (arg) =>
          arg.startsWith(
            `${PROTOCOL}://`
          )
      );

      if (deepLink) {
        handleDeepLink(deepLink);
      } else if (mainWindow) {
        if (
          !mainWindow.isVisible()
        ) {
          mainWindow.show();
        }

        if (
          mainWindow.isMinimized()
        ) {
          mainWindow.restore();
        }

        mainWindow.focus();
      }
    }
  );

  app.on(
    "open-url",
    (event, url) => {
      event.preventDefault();
      handleDeepLink(url);
    }
  );

  app
    .whenReady()
    .then(async () => {
      try {
        await prepareEmbeddedServerRuntime();
        startupLog(
          "Embedded server runtime ready"
        );
      } catch (error) {
        startupLog(
          `Embedded server runtime extraction failed: ${error}`
        );
      }

      ipcMain.handle(
        "get-app-version",
        () => app.getVersion()
      );

      ipcMain.handle(
        "get-beta-channel",
        () => isOnBetaChannel()
      );

      ipcMain.on(
        "set-beta-channel",
        (_event, enabled: boolean) => {
          writeConfig({
            betaChannel: enabled,
          });

          autoUpdater.allowPrerelease =
            enabled;
        }
      );

      ipcMain.on(
        "switch-update-channel",
        (_event, enabled: boolean) => {
          writeConfig({
            betaChannel: enabled,
          });

          autoUpdater.allowPrerelease =
            enabled;

          relaunchForUpdate();
        }
      );

      ipcMain.handle(
        "get-close-to-tray",
        () => closeToTray
      );

      ipcMain.on(
        "set-close-to-tray",
        (_event, enabled: boolean) => {
          closeToTray = enabled;

          writeConfig({
            closeToTray: enabled,
          });
        }
      );

      ipcMain.on(
        "set-signed-in",
        (_event, signedIn: boolean) => {
          isUserSignedIn =
            signedIn;
        }
      );

      ipcMain.on(
        "set-voice-state",
        (_event, next: VoiceState) => {
          const changed =
            next.inVoice !==
              voiceState.inVoice ||
            next.muted !==
              voiceState.muted ||
            next.deafened !==
              voiceState.deafened ||
            next.serverName !==
              voiceState.serverName;

          if (!changed) return;

          voiceState = next;

          refreshTray();
        }
      );

      ipcMain.handle(
        "get-start-with-windows-supported",
        () =>
          process.platform ===
          "win32"
      );

      ipcMain.handle(
        "get-start-with-windows",
        () => startWithWindows
      );

      ipcMain.on(
        "set-start-with-windows",
        (_event, enabled: boolean) => {
          startWithWindows =
            !!enabled;

          writeConfig({
            startWithWindows,
          });

          applyStartWithWindowsSetting(
            startWithWindows
          );
        }
      );

      ipcMain.handle(
        "get-start-minimized-on-login",
        () =>
          startMinimizedOnLogin
      );

      ipcMain.on(
        "set-start-minimized-on-login",
        (_event, enabled: boolean) => {
          startMinimizedOnLogin =
            !!enabled;

          writeConfig({
            startMinimizedOnLogin,
          });
        }
      );

      ipcMain.handle(
        "get-hardware-acceleration",
        () =>
          hardwareAcceleration
      );

      ipcMain.on(
        "set-hardware-acceleration",
        (_event, enabled: boolean) => {
          writeConfig({
            hardwareAcceleration:
              enabled,
          });

          isQuitting = true;
          app.relaunch();
          app.quit();
        }
      );

      // ── Per-user file store ────────────────────────────────────────

      ipcMain.handle(
        "user-store:load",
        (_event, userId: string) =>
          loadUser(userId)
      );

      ipcMain.on(
        "user-store:set",
        (
          _event,
          userId: string,
          key: string,
          value: unknown
        ) => {
          patchUser(
            userId,
            key,
            value
          );
        }
      );

      ipcMain.on(
        "user-store:save",
        (
          _event,
          userId: string,
          data: Record<
            string,
            unknown
          >
        ) => {
          saveUser(
            userId,
            data
          );
        }
      );

      // ── Secrets at rest ────────────────────────────────────────────

      ipcMain.handle(
        "secret:available",
        () => {
          try {
            return safeStorage.isEncryptionAvailable();
          } catch {
            return false;
          }
        }
      );

      ipcMain.handle(
        "secret:seal",
        (_event, plain: string) => {
          return safeStorage
            .encryptString(plain)
            .toString("base64");
        }
      );

      ipcMain.handle(
        "secret:unseal",
        (_event, sealed: string) => {
          return safeStorage.decryptString(
            Buffer.from(
              sealed,
              "base64"
            )
          );
        }
      );

      ipcMain.handle(
        "global-store:load",
        () => loadGlobalStore()
      );

      ipcMain.on(
        "global-store:set",
        (
          _event,
          key: string,
          value: unknown
        ) => {
          setGlobalValue(
            key,
            value
          );
        }
      );

      ipcMain.on(
        "global-store:delete",
        (_event, key: string) => {
          deleteGlobalValue(key);
        }
      );

      ipcMain.on(
        "global-store:save",
        (
          _event,
          data: Record<
            string,
            unknown
          >
        ) => {
          saveGlobalStore(data);
        }
      );

      // ── Addons ────────────────────────────────────────────────────

      ipcMain.handle(
        "addons:list",
        () => getAddons()
      );

      ipcMain.handle(
        "addons:open-folder",
        () =>
          shell.openPath(
            getAddonsDir()
          )
      );

      ipcMain.handle(
        "addons:resolve-asset",
        (
          _event,
          addonId: string,
          relativePath: string
        ) => {
          if (
            !addonId ||
            !relativePath ||
            addonId.includes("..") ||
            relativePath.includes(
              ".."
            ) ||
            relativePath.startsWith(
              "/"
            ) ||
            relativePath.startsWith(
              "\\"
            )
          ) {
            throw new Error(
              "Invalid addon asset path"
            );
          }

          const normalizedRelativePath =
            relativePath.replace(
              /\\/g,
              "/"
            );

          const normalizedPath =
            `/addons/${addonId}/${normalizedRelativePath}`;

          const resolvedPath =
            resolveAddonFilePath(
              normalizedPath
            );

          if (
            !resolvedPath ||
            !existsSync(
              resolvedPath
            ) ||
            !statSync(
              resolvedPath
            ).isFile()
          ) {
            throw new Error(
              `Addon asset not found: ${addonId}/${relativePath}`
            );
          }

          if (
            process.env
              .VITE_DEV_SERVER_URL
          ) {
            const devBase =
              process.env.VITE_DEV_SERVER_URL.replace(
                /\/$/,
                ""
              );

            return `${devBase}${normalizedPath}`;
          }

          if (!localServerUrl) {
            throw new Error(
              "Local addon asset server is not running"
            );
          }

          return `${localServerUrl}${normalizedPath}`;
        }
      );

      onAddonsChanged(
        (addons) => {
          mainWindow?.webContents.send(
            "addons-changed",
            addons
          );
        }
      );

      watchAddons();

      applyStartWithWindowsSetting(
        startWithWindows
      );

      const launchedFromAutoStart =
        process.argv.includes(
          AUTO_START_ARG
        ) ||
        (() => {
          try {
            return (
              app.getLoginItemSettings()
                .wasOpenedAtLogin ===
              true
            );
          } catch {
            return false;
          }
        })();

      startHiddenOnLaunch =
        launchedFromAutoStart &&
        startMinimizedOnLogin;

      if (
        !process.env
          .VITE_DEV_SERVER_URL
      ) {
        localServerUrl =
          await startLocalServer();

        startupLog(
          `Local server started: ${localServerUrl}`
        );
      }

      startupLog(
        "uiohook deferred until a push-to-talk key is set"
      );

      // ── Native audio capture IPC ──────────────────────────────────

      ipcMain.handle(
        "native-audio-capture-available",
        () => {
          return isNativeAudioCaptureAvailable();
        }
      );

      ipcMain.handle(
        "start-native-audio-capture",
        (
          _event,
          sourceId?: string
        ) => {
          if (!mainWindow) {
            return false;
          }

          return startNativeAudioCapture(
            mainWindow,
            sourceId
          );
        }
      );

      ipcMain.on(
        "stop-native-audio-capture",
        () => {
          stopNativeAudioCapture();
        }
      );

      ipcMain.handle(
        "native-screen-capture:available",
        () => {
          return isNativeScreenCaptureAvailable();
        }
      );

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
          if (!mainWindow) {
            return {
              success: false,
            };
          }

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

      ipcMain.on(
        "native-screen-capture:stop",
        () => {
          stopNativeScreenCapture();
        }
      );

      // ── Embedded server ───────────────────────────────────────────

      ipcMain.handle(
        "embedded-server:available",
        () =>
          isEmbeddedServerAvailable()
      );

      ipcMain.handle(
        "embedded-server:info",
        () =>
          getEmbeddedServerInfo()
      );

      ipcMain.handle(
        "embedded-server:create",
        async (
          _event,
          serverName: string,
          lanDiscoverable: boolean,
          port?: number
        ) => {
          if (!mainWindow) {
            return null;
          }

          return createAndStartServer(
            mainWindow,
            serverName,
            lanDiscoverable,
            port
          );
        }
      );

      ipcMain.handle(
        "embedded-server:suggest-port",
        () => suggestServerPort()
      );

      ipcMain.handle(
        "embedded-server:check-port",
        (_event, port: number) =>
          isPortAvailable(port)
      );

      ipcMain.handle(
        "embedded-server:start",
        async (
          _event,
          id: string
        ) => {
          if (!mainWindow) {
            return null;
          }

          return startExistingServer(
            mainWindow,
            id
          );
        }
      );

      ipcMain.handle(
        "embedded-server:stop",
        (_event, id: string) =>
          stopServer(id)
      );

      ipcMain.handle(
        "embedded-server:dismiss-error",
        (_event, id: string) =>
          dismissEmbeddedServerError(
            id
          )
      );

      ipcMain.handle(
        "embedded-server:delete",
        async (
          _event,
          id: string
        ) =>
          deleteServer(id)
      );

      ipcMain.handle(
        "embedded-server:status",
        () => getAllStates()
      );

      ipcMain.handle(
        "embedded-server:update-advertised-addresses",
        (
          _event,
          id: string,
          addresses: string[]
        ) =>
          updateServerAdvertisedAddresses(
            id,
            addresses
          )
      );

      ipcMain.handle(
        "embedded-server:logs",
        (_event, id?: string) =>
          getEmbeddedServerLogs(
            id
          )
      );

      ipcMain.handle(
        "embedded-server:clear-logs",
        (_event, id?: string) => {
          clearEmbeddedServerLogs(
            id
          );
        }
      );

      ipcMain.handle(
        "embedded-server:get-auto-start",
        (_event, id: string) =>
          getAutoStart(id)
      );

      ipcMain.on(
        "embedded-server:set-auto-start",
        (
          _event,
          id: string,
          enabled: boolean
        ) => {
          setAutoStart(
            id,
            enabled
          );
        }
      );

      createMainWindow();
      startupLog(
        "Main window created"
      );

      createTray();
      startupLog(
        "Tray created"
      );

      if (
        process.env
          .VITE_DEV_SERVER_URL
      ) {
        startupLog(
          "Dev mode — skipping splash/update check"
        );

        mainWindow?.show();
      } else if (
        startHiddenOnLaunch &&
        !process.argv.includes(
          UPDATE_ARG
        )
      ) {
        startupLog(
          "Starting hidden (auto-start)"
        );

        initBackgroundUpdater();

        if (!installIsPending()) {
          pinFeedToNewestCompleteRelease().finally(
            () => {
              autoUpdater
                .checkForUpdates()
                .catch(() => {});
            }
          );
        }
      } else {
        try {
          createSplashWindow();
          await runSplashUpdateCheck();
        } catch {
          // Ensure the main window still opens if the updater fails.
        }

        closeSplashAndShowMain();

        startupLog(
          "Main window shown"
        );

        initBackgroundUpdater();
      }

      /**
       * If this process is the first healthy launch after the one-time Windows
       * installer migration, remove the rollback copy of the old installation.
       *
       * This is intentionally after the startup/update branching above.
       * A process which immediately quits to install another update never gets
       * here, while a process which reaches its usable startup state does.
       */
      cleanupLegacyWindowsInstallBackup();

      // ── Embedded server auto-start ─────────────────────────────────

      if (mainWindow) {
        autoStartIfNeeded(
          mainWindow
        ).catch((err) => {
          startupLog(
            `Embedded server auto-start failed: ${err}`
          );
        });
      }

      // ── Embed origin fix ───────────────────────────────────────────

      const embedOriginMap:
        [string[], string][] = [
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
          [
            "https://*.vimeo.com/*",
            "https://*.vimeocdn.com/*",
          ],
          "https://player.vimeo.com",
        ],

        [
          [
            "https://clips.twitch.tv/*",
          ],
          "https://clips.twitch.tv",
        ],

        [
          [
            "https://*.twitch.tv/*",
            "https://*.twitchcdn.net/*",
            "https://*.jtvnw.net/*",
          ],
          "https://player.twitch.tv",
        ],

        [
          [
            "https://*.spotify.com/*",
            "https://*.spotifycdn.com/*",
          ],
          "https://open.spotify.com",
        ],

        [
          [
            "https://*.tiktok.com/*",
            "https://*.tiktokcdn.com/*",
          ],
          "https://www.tiktok.com",
        ],

        [
          [
            "https://*.instagram.com/*",
            "https://*.cdninstagram.com/*",
          ],
          "https://www.instagram.com",
        ],

        [
          [
            "https://*.soundcloud.com/*",
            "https://*.sndcdn.com/*",
          ],
          "https://w.soundcloud.com",
        ],
      ];

      const allEmbedPatterns =
        embedOriginMap.flatMap(
          ([patterns]) => patterns
        );

      session.defaultSession.webRequest.onBeforeSendHeaders(
        {
          urls: allEmbedPatterns,
        },
        (
          details,
          callback
        ) => {
          const existingOrigin =
            details.requestHeaders[
              "Origin"
            ];

          if (
            existingOrigin &&
            existingOrigin.startsWith(
              "https://"
            )
          ) {
            callback({
              requestHeaders:
                details.requestHeaders,
            });
            return;
          }

          for (
            const [
              patterns,
              origin,
            ] of embedOriginMap
          ) {
            if (
              patterns.some(
                (pattern) =>
                  matchUrlPattern(
                    pattern,
                    details.url
                  )
              )
            ) {
              details.requestHeaders[
                "Referer"
              ] = origin + "/";

              details.requestHeaders[
                "Origin"
              ] = origin;

              break;
            }
          }

          callback({
            requestHeaders:
              details.requestHeaders,
          });
        }
      );

      session.defaultSession.webRequest.onHeadersReceived(
        {
          urls: allEmbedPatterns,
        },
        (
          details,
          callback
        ) => {
          const headers = {
            ...details.responseHeaders,
          };

          for (
            const key of Object.keys(
              headers
            )
          ) {
            if (
              key.toLowerCase() ===
              "content-security-policy"
            ) {
              delete headers[key];
            }
          }

          callback({
            responseHeaders:
              headers,
          });
        }
      );

      // ── Screen capture ─────────────────────────────────────────────

      session.defaultSession.setDisplayMediaRequestHandler(
        (
          _request,
          callback
        ) => {
          desktopCapturer
            .getSources({
              types: ["screen"],
            })
            .then(
              (sources) => {
                callback({
                  video:
                    sources[0],
                  audio:
                    "loopback",
                });
              }
            );
        }
      );

      ipcMain.handle(
        "get-screen-capture-access",
        () => {
          if (
            process.platform !==
            "darwin"
          ) {
            return "granted";
          }

          return systemPreferences.getMediaAccessStatus(
            "screen"
          );
        }
      );

      ipcMain.handle(
        "get-desktop-sources",
        async () => {
          const sources =
            await desktopCapturer.getSources(
              {
                types: [
                  "screen",
                  "window",
                ],
                thumbnailSize: {
                  width: 320,
                  height: 180,
                },
              }
            );

          const displays =
            screen.getAllDisplays();

          return sources.map(
            (source) => {
              const isScreen =
                source.id.startsWith(
                  "screen:"
                );

              let width:
                | number
                | undefined;

              let height:
                | number
                | undefined;

              if (isScreen) {
                const displayIndex =
                  parseInt(
                    source.id.split(
                      ":"
                    )[1],
                    10
                  );

                const display =
                  displays[
                    displayIndex
                  ];

                if (display) {
                  width =
                    display.size.width *
                    display.scaleFactor;

                  height =
                    display.size.height *
                    display.scaleFactor;
                }
              }

              return {
                id: source.id,
                name: source.name,
                thumbnail:
                  source.thumbnail.toDataURL(),
                appIcon:
                  source.appIcon
                    ? source.appIcon.toDataURL()
                    : "",
                sourceType:
                  isScreen
                    ? ("screen" as const)
                    : ("window" as const),
                width,
                height,
              };
            }
          );
        }
      );

      // ── IPC handlers ───────────────────────────────────────────────

      ipcMain.on(
        "auth:open-external",
        (_event, url: string) => {
          shell.openExternal(url);
        }
      );

      if (pendingDeepLinkUrl) {
        handleDeepLink(
          pendingDeepLinkUrl
        );

        pendingDeepLinkUrl =
          null;
      }

      // ── LAN server discovery ──────────────────────────────────────

      if (mainWindow) {
        const stopLanDiscovery =
          startLanDiscovery(
            mainWindow,
            startupLog
          );

        app.on(
          "before-quit",
          stopLanDiscovery
        );

        ipcMain.handle(
          "lan:get-servers",
          () =>
            getDiscoveredLanServers()
        );

        ipcMain.on(
          "lan:rescan",
          () =>
            rescanLanServers()
        );
      }

      ipcMain.on(
        "check-for-updates",
        () => {
          if (installIsPending()) {
            sendToMain(
              "pending",
              {
                version:
                  readPendingInstall()
                    ?.version,
              }
            );
            return;
          }

          pinFeedToNewestCompleteRelease().finally(
            () => {
              autoUpdater
                .checkForUpdates()
                .catch((err) => {
                  logUpdateFailure(
                    "Update check failed",
                    err
                  );

                  if (
                    isReleaseNotReadyYet(
                      err
                    )
                  ) {
                    sendToMain(
                      "not-available",
                      {
                        version:
                          app.getVersion(),
                      }
                    );
                    return;
                  }

                  sendToMain(
                    "error",
                    {
                      message:
                        friendlyUpdateError(
                          err
                        ),
                    }
                  );
                });
            }
          );
        }
      );

      ipcMain.on(
        "restart-for-update",
        () => {
          if (installIsPending()) {
            sendToMain(
              "pending",
              {
                version:
                  readPendingInstall()
                    ?.version,
              }
            );
            return;
          }

          relaunchForUpdate();
        }
      );

      ipcMain.on(
        "ptt-set-key",
        (
          _event,
          pttKey: string
        ) => {
          registerPttShortcut(
            pttKey
          );

          if (
            pttKey &&
            !uiohookRunning
          ) {
            if (
              process.platform ===
              "darwin"
            ) {
              systemPreferences.isTrustedAccessibilityClient(
                true
              );
            }

            try {
              ensureUiohook();
            } catch (err) {
              console.warn(
                `uiohook start failed: ${
                  err instanceof Error
                    ? err.message
                    : String(err)
                }`
              );
            }
          }
        }
      );

      ipcMain.on(
        "set-badge-count",
        (
          _event,
          count: number
        ) => {
          app.setBadgeCount(count);

          if (mainWindow) {
            mainWindow.flashFrame(
              count > 0
            );
          }
        }
      );

      ipcMain.on(
        "toggle-always-on-top",
        (
          event,
          pinned: boolean,
          windowTitle?: string
        ) => {
          let win:
            | BrowserWindow
            | null = null;

          if (windowTitle) {
            win =
              BrowserWindow.getAllWindows().find(
                (window) =>
                  window.getTitle() ===
                  windowTitle
              ) ?? null;
          }

          if (!win) {
            win =
              BrowserWindow.fromWebContents(
                event.sender
              );
          }

          if (win) {
            win.setAlwaysOnTop(
              pinned,
              "floating"
            );
          }
        }
      );

      app.on(
        "activate",
        () => {
          if (mainWindow) {
            if (
              !mainWindow.isVisible()
            ) {
              mainWindow.show();
            }

            mainWindow.focus();
          } else {
            const createdWindow =
              createMainWindow();

            createdWindow.show();
          }
        }
      );
    })
    .catch((err: unknown) => {
      const msg =
        err instanceof Error
          ? err.message
          : String(err);

      startupLog(
        `FATAL startup error: ${
          err instanceof Error
            ? err.stack ??
              err.message
            : msg
        }`
      );

      dialog.showErrorBox(
        "Gryt — Failed to Start",
        `${msg}\n\nCheck gryt-startup.log in the app data folder for details.`
      );

      app.exit(1);
    });

  app.on(
    "child-process-gone",
    (_event, details) => {
      startupLog(
        `Child process gone: type=${details.type} reason=${details.reason}`
      );

      if (
        details.type === "GPU" &&
        details.reason !==
          "clean-exit"
      ) {
        startupLog(
          "GPU process crashed — consider disabling hardware acceleration"
        );
      }
    }
  );

  app.on(
    "before-quit",
    () => {
      isQuitting = true;
    }
  );

  app.on(
    "window-all-closed",
    () => {
      if (
        process.platform !==
        "darwin"
      ) {
        app.quit();
      }
    }
  );

  app.on(
    "will-quit",
    () => {
      console.log(
        "[Main] will-quit: flushing stores and cleaning up"
      );

      flushUserStore();
      flushGlobalStore();

      if (uiohookRunning) {
        uiohookLib?.uIOhook.stop();
        uiohookRunning = false;
      }

      localServer?.close();
      localServer = null;

      cleanupOnQuit();
    }
  );
}