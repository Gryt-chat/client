import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
} from "electron";
import { autoUpdater as defaultAutoUpdater, NsisUpdater } from "electron-updater";
import { DownloadedUpdateHelper } from "electron-updater/out/DownloadedUpdateHelper";
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

import { parseCombo, type ParsedCombo } from "../src/lib/hotkeys";
import {
  checkAddonUpdates,
  getAddons,
  getAddonsDir,
  initAddonManager,
  onAddonsChanged,
  resolveAddonFilePath,
  watchAddons,
} from "./addonManager";
import {
  isNativeAudioCaptureAvailable,
  listAudioCaptureSources,
  setAudioCaptureApplications,
  startNativeAudioCapture,
  stopNativeAudioCapture,
  supportsPerApplicationAudio,
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
  updateServerPortsFor,
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
/* Nothing sets this any more. It survives so the argument an older build
   relaunches with is recognised and ignored rather than carried forward: a
   1.6.x client takes "restart and update now" by relaunching with
   --gryt-update, and the binary that starts next is this one. */
const LEGACY_UPDATE_ARG = "--gryt-update";

let pendingDeepLinkUrl: string | null = null;
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
 * Where the downloaded installer waits between the download and the install.
 *
 * electron-updater stages it in `%LOCALAPPDATA%\<app>-updater\pending` and
 * writes the file's checksum into an `update-info.json` beside it. At install
 * time it reads that back and re-verifies. If the two disagree it decides the
 * download is corrupt, discards it, and downloads again on the next check.
 *
 * That directory is not ours. Antivirus quarantines things in it, disk cleaners
 * empty it, and a download interrupted by a crash leaves a partial file that
 * fails the same check. Every one of those produces the symptom Gryt has had on
 * Windows for months: it downloads every release and installs none of them,
 * because the install step never sees a file it trusts.
 *
 * `sessionData` is inside the app's own data tree, where nothing else has a
 * reason to be. Borrowed from AFFiNE, whose entire Windows updater is this.
 *
 * Windows only — this is the NSIS staging path, and macOS and Linux do not use
 * it.
 */
class WindowsUpdater extends NsisUpdater {
  protected override downloadedUpdateHelper: DownloadedUpdateHelper =
    new DownloadedUpdateHelper(app.getPath("sessionData"));
}

const autoUpdater =
  process.platform === "win32" ? new WindowsUpdater() : defaultAutoUpdater;

/**
 * Whether this copy of Gryt was installed from the MSIX package.
 *
 * Electron sets `process.windowsStore` when the app runs from an .appx or
 * .msix. Nothing else in the build can tell the two apart: `app.isPackaged` is
 * true for the NSIS install as well, and both run the same `Gryt Chat.exe` out
 * of the same tree.
 *
 * It matters because the updater above is an NSIS updater and it does not know
 * it is inside a package. Left alone it finds the next release, downloads the
 * 180MB .exe, and runs the installer on quit — which does not update the
 * package. It installs a *second*, unpackaged Gryt beside it, and the MSIX one
 * stays on the version it was installed at forever. Two entries in the Start
 * menu, one of them permanently stale, and nothing anywhere saying so.
 *
 * Windows owns updates for a packaged app: the Store pushes them, or an
 * .appinstaller file does. Neither route comes through here, so the mechanism
 * is switched off rather than made quieter. GRYT-850.
 */
const updatesAreManagedByWindows = process.windowsStore === true;

autoUpdater.logger = {
  info: (m: unknown) => startupLog(`Update: ${String(m)}`),
  warn: (m: unknown) => startupLog(`Update WARN: ${String(m)}`),
  error: (m: unknown) => startupLog(`Update ERROR: ${String(m)}`),
  debug: (m: unknown) => startupLog(`Update debug: ${String(m)}`),
};

/*
 * Download in the background, the way Bitwarden does.
 *
 * `autoDownload` off meant nothing was fetched until somebody pressed a
 * button, and then they waited for the whole installer while a splash screen
 * counted at them. On means the bytes are already down by the time anyone is
 * told there is an update, and taking it is a restart rather than a download.
 *
 * A user-initiated check turns it off for the length of that check, so
 * "Check for Updates" reports what it found instead of silently fetching it.
 *
 * This is the library's own flag, and it only decides what a check the library
 * ran does next. Whether the background check runs one of those at all is
 * `autoUpdateEnabled` below.
 */
autoUpdater.autoDownload = true;

// Windows is no longer the exception here.
//
// GRYT-67 turned this off because the old NSIS uninstaller could not complete
// an electron-builder upgrade, and installing on quit walked straight into it.
// installer.nsh moves that installation aside in customInit now, so the reason
// is gone — and leaving it off meant the PowerShell helper was the only way a
// Windows install could ever happen. When that helper failed to parse, there
// was no second route, which is how v1.6.6 through v1.6.24 ended up unable to
// update at all.
autoUpdater.autoInstallOnAppQuit = !updatesAreManagedByWindows;

/**
 * Whether Gryt fetches a release on its own.
 *
 * Off, nothing is downloaded until somebody presses the button in the toast:
 * the background check still runs and still says a release exists, because
 * being told is not the part anyone objects to. Installing a downloaded update
 * on quit stays on either way — off, the only way an update is on disk at all
 * is that somebody asked for it, and asking again on the way out would be
 * asking twice.
 */
let autoUpdateEnabled = readBoolConfig("autoUpdate", true);

/*
 * The library's own staged-rollout check, kept so it can be put back.
 *
 * electron-updater compares `stagingPercentage` in the release yml against a
 * stable per-machine id, so a release can be handed to a fraction of people
 * first. Whatever a release does not set, this returns true for, which is why
 * holding on to it costs nothing while no release stages.
 *
 * Bitwarden's shape, apps/desktop/src/main/updater.main.ts: keep the original,
 * swap in an always-true one for a check somebody asked for, put it back
 * afterwards. Somebody who goes looking for an update should get it rather than
 * be told there is none because their id fell outside this release's slice.
 */
const defaultRolloutCheck = autoUpdater.isUserWithinRollout;

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

/* Raised to the front once, then allowed to behave like a window again. */
function showMain(): void {
  if (!mainWindow) return;

  mainWindow.setAlwaysOnTop(true);
  mainWindow.show();
  mainWindow.focus();

  setTimeout(() => {
    mainWindow?.setAlwaysOnTop(false);
  }, 1000);
}

function sendToMain(status: string, info?: Record<string, unknown>) {
  mainWindow?.webContents.send("update-status", {
    status,
    ...info,
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
  ms = 8000,
  headers: Record<string, string> = {}
): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(ms),
      headers: {
        "User-Agent": `Gryt/${app.getVersion()}`,
        ...headers,
      },
    });

    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/** A release the updater could be pointed at. */
type ReleaseRef = {
  tag: string;
  version: string;
};

function releaseDownloadBase(tag: string): string {
  return `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases/download/${tag}`;
}

/**
 * The installer this platform would download, read out of the channel yml.
 *
 * `path:` is the file name electron-updater will ask for. Nothing else in the
 * yml names it, and the name is not derivable from the version — the mac zip,
 * the NSIS exe and the AppImage are spelled three different ways.
 */
function installerFileName(yml: string): string | null {
  const named = yml.match(/^path:\s*(.+)$/m);
  if (!named) return null;

  return named[1]
    .trim()
    .replace(/^["']|["']$/g, "");
}

/**
 * Is this release's installer actually on the asset host yet.
 *
 * Release Client uploads from three runners over several minutes, so a release
 * whose yml is up and whose zip is not is a real state and not a rare one.
 * Pointing the updater at that gets a 404 mid-download.
 *
 * `releaseIsInstallable` answers the same question through `api.github.com`,
 * which the background check cannot spend (see `newestReleaseWithoutApi`).
 * This asks the asset host for one byte instead: free, and it proves the exact
 * URL the updater is about to use rather than an entry in a listing.
 */
async function releaseAssetsReady(tag: string): Promise<boolean> {
  const base = releaseDownloadBase(tag);

  const ymlRes = await fetchWithTimeout(
    `${base}/${channelYmlName()}`
  );

  if (!ymlRes) return false;

  let file: string | null;
  try {
    file = installerFileName(await ymlRes.text());
  } catch {
    return false;
  }

  if (!file) return false;

  const asset = await fetchWithTimeout(
    `${base}/${encodeURIComponent(file)}`,
    8000,
    { Range: "bytes=0-0" }
  );

  if (!asset) return false;

  /* One byte was the whole question. Without this the response body stays open
     and the socket sits there until the timeout. */
  void asset.body?.cancel();

  return true;
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

  const file = installerFileName(await res.text());
  if (!file) return false;

  return release.assets.some(
    (asset) => asset.name === file && asset.size > 0
  );
}

/**
 * Feed options shared by every place that pins the updater at one release.
 *
 * `useMultipleRangeRequest: false` is the whole differential download.
 *
 * A differential download asks for the blocks that changed. electron-updater
 * can do that as one request carrying many ranges, or as a sequence of single
 * range requests, and it decides from the provider: `GitHubProvider` sets
 * `isUseMultipleRangeRequest: false` outright because GitHub's asset host does
 * not support the multi-range form (providers/GitHubProvider.js). Pinning the
 * feed puts us on `generic` instead, and generic turns it *on* for any URL that
 * is not s3.amazonaws.com (providerFactory.js, isUrlProbablySupportMultiRange-
 * Requests). So pinning opted us into the one request shape GitHub refuses:
 *
 *   Range: bytes=0-1023           -> 206
 *   Range: bytes=0-1023,2048-3071 -> 501
 *
 * which surfaced as `Cannot download differentially, fallback to full download:
 * HttpError: 501` and 198 MB downloaded where 84 MB would have done.
 *
 * Off, the sequential path is used, every request is a single range, and GitHub
 * answers all of them. Slower per byte than one multi-range request and far
 * faster than downloading the whole app.
 *
 * This belongs with the URL rather than set once at startup: it is a fact about
 * the host being pointed at, and it has to move if the feed ever does.
 */
const FEED_SUPPORTS_MULTI_RANGE = false;

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
        useMultipleRangeRequest: FEED_SUPPORTS_MULTI_RANGE,
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

/**
 * How often a client that is already running looks for a release.
 *
 * Until GRYT-543 it never did. The three `checkForUpdates()` call sites are all
 * launch-time or the button in settings, so an app left open never saw a
 * release until it was restarted. Six went out on 2026-08-22 and a client open
 * across all of them stayed on the version it started the day with — including
 * through a privacy fix, which is not a thing to make somebody restart for.
 *
 * Affordable at any interval because this check spends no GitHub API quota at
 * all. See `newestReleaseWithoutApi`.
 *
 * It was an hour until GRYT-633, and an hour is long enough to miss a release
 * entirely while looking straight at the app. 1.6.48-beta.1 published fifteen
 * minutes after a client started; that client's next look was due forty-five
 * minutes later, so the person waiting for it gave up and installed from
 * Settings, and concluded the toast had been removed.
 */
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;

/**
 * The soonest two background checks may be, whatever asked for them.
 *
 * Waking from sleep and focusing the window are both moments a machine has
 * plausibly been away long enough for a release to have happened, and both
 * happen far more often than a release does. Without a floor, ten lid-opens or
 * ten alt-tabs is ten checks.
 *
 * **Has to stay below `UPDATE_CHECK_INTERVAL_MS`.** The repeating timer goes
 * through the same floor, so a floor at or above the interval would have the
 * timer cancelling its own every other tick — which is what a 15 minute floor
 * did to a 10 minute interval before this was written down.
 *
 * A check somebody pressed a button for skips this entirely. See `force`.
 */
const UPDATE_CHECK_FLOOR_MS = 5 * 60 * 1000;

/* How long after the window appears to go looking for a release.
   Launch used to do this before showing anything, which is what made starting
   Gryt on Windows take minutes. */
const LAUNCH_UPDATE_CHECK_DELAY_MS = 10 * 1000;

let updateCheckTimer: NodeJS.Timeout | null = null;
let lastUpdateCheckAt = 0;
let updateIsDownloaded = false;

/** The version already announced, so one release is toasted once per run. */
let announcedVersion: string | null = null;

/**
 * The release a download is running for, and nothing else.
 *
 * Set only by `startBackgroundDownload` and `downloadAnnouncedRelease`, so the
 * update events can tell a download nobody asked for from a check somebody
 * pressed a button for. Settings shows its own answer; only the first needs a
 * toast.
 */
let pendingRelease: ReleaseRef | null = null;

/** Whether `pendingRelease` should raise a toast when it starts downloading. */
let announceDownload = false;

/**
 * Is there a newer release, answered without spending API quota.
 *
 * `pinFeedToNewestCompleteRelease` asks `api.github.com`, which is capped at 60
 * an hour **per address** when unauthenticated. That is fine once per launch
 * and wrong every hour: a LAN party is one address, and a hundred clients
 * checking hourly is a hundred calls an hour against a ceiling of sixty — which
 * breaks the check and takes out anything else on that network using the API.
 *
 * Conditional requests do not rescue it. GitHub documents 304s as free, but
 * that is for authenticated calls; measured unauthenticated on 2026-08-23, a
 * 304 still moved `x-ratelimit-remaining` from 54 to 53.
 *
 * So this reads `releases.atom` instead. It is served from the web host rather
 * than the API, carries no rate-limit headers, and lists prereleases. Free at
 * any number of clients.
 *
 * **The feed includes drafts** — v1.6.33 was in it while still unpublished — so
 * the asset check below is not optional. A draft's assets are not
 * downloadable, which is what rejects it.
 *
 * The tag comes back with the version because the caller pins the feed to it.
 * `pinFeedToNewestCompleteRelease` is the same answer through the API, and the
 * background check cannot afford that call.
 */
async function newestReleaseWithoutApi(): Promise<ReleaseRef | null> {
  const res = await fetchWithTimeout(
    `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases.atom`
  );

  if (!res) return null;

  let feed: string;
  try {
    feed = await res.text();
  } catch {
    return null;
  }

  /* The entry title is the release *name*, which is free text and on a draft is
     not the tag. The link is the tag, always. */
  const tags = [
    ...feed.matchAll(/\/releases\/tag\/([^"'<>\s]+)/g),
  ].map((match) => match[1]);

  const current = app.getVersion();
  const wantPrerelease = isOnBetaChannel();

  const candidates = tags
    .map((tag) => ({ tag, version: tag.replace(/^v/, "") }))
    .filter(
      ({ version }) =>
        semver.valid(version) && semver.gt(version, current)
    )
    /* The beta channel ships 1.2.3-beta.N, so the version says whether it is a
       prerelease and the feed does not have to. */
    .filter(
      ({ version }) =>
        wantPrerelease || semver.prerelease(version) === null
    )
    .sort((a, b) => semver.rcompare(a.version, b.version));

  for (const { tag, version } of candidates) {
    /* fetchWithTimeout returns null on any non-2xx, so a draft's 404 lands
       here and the loop moves on to the release below it. */
    if (await releaseAssetsReady(tag)) {
      return { tag, version };
    }

    startupLog(
      `Update: skipping ${version}, assets incomplete`
    );
  }

  return null;
}

/**
 * A check nobody asked for, so it stays quiet and gives up easily.
 *
 * It announces once per version per run. A failure is logged rather than shown:
 * somebody who did not press anything should not get an error about it.
 *
 * **Finding a release is not the end of this.** Until GRYT-625 it was: this
 * announced a version and stopped, and nothing downstream ever fetched
 * anything. `autoDownload` is a flag on a check the library runs, and the
 * library ran no check here — so the toast offered to restart into an update
 * that was not on disk, `restart-for-update` found `updateIsDownloaded` false
 * and did nothing, and the release installed on some later launch that
 * happened to take the settings path. Before GRYT-622 the splash did the
 * download when somebody pressed restart, which is what hid this.
 *
 * So the probe now hands its tag to `startBackgroundDownload`, and the
 * announcement moves to the point where a download is actually running.
 */
/**
 * Put the toast back on screen for a version, whatever state it is in.
 *
 * Used by a check somebody pressed a button for, and by the renderer asking
 * what it missed after a reload. `reannounce` tells the renderer this was
 * asked for, so it redraws even over a toast that had been dismissed — a
 * dismissal means "not now", and pressing Check for Updates is a later now.
 */
function announceDownloaded(version?: string): void {
  if (!version) return;

  announcedVersion = version;

  sendToMain("announced", {
    version,
    from: app.getVersion(),
    autoDownload: true,
    reannounce: true,
  });

  /* Two messages rather than a field on the first: the renderer already turns
     `downloaded` into the restart prompt, and a state the toast can reach only
     one way is a state that cannot drift. */
  if (updateIsDownloaded) {
    sendToMain("downloaded", { version });
  }
}

function checkForUpdatesInBackground(
  reason: string,
  force = false
): void {
  /* Packaged as MSIX, where there is nothing useful this could do. Logged
     rather than dropped silently, because a check that reports nothing is the
     same shape as a broken one, and this is the line somebody will go looking
     for. See `updatesAreManagedByWindows`. */
  if (updatesAreManagedByWindows) {
    startupLog(`Update: skipped (${reason}) — installed from the MSIX package`);
    return;
  }

  /* Already downloaded, so the answer cannot change until this restarts.
     Element hit the same thing on macOS and guards it the same way: re-checking
     while Squirrel is holding a staged update wedges the install
     (element-web#12433). */
  if (updateIsDownloaded) {
    if (force) announceDownloaded(pendingUpdateVersion);
    return;
  }

  /* A download is already running. A release published while one is in flight
     would otherwise start a second `checkForUpdates` over the top of it, and
     electron-updater has one download slot. The next tick picks the newer one
     up once this has finished or failed. */
  if (pendingRelease) {
    if (force) {
      sendToMain("downloading", {
        version: pendingRelease.version,
      });
    }
    return;
  }

  /* A check somebody pressed a button for goes through regardless. The tray
     item used to share this floor with the launch check, which set it ten
     seconds after startup — so for the first fifteen minutes of every run,
     pressing Check for Updates did nothing and said nothing (GRYT-633). */
  if (!force && Date.now() - lastUpdateCheckAt < UPDATE_CHECK_FLOOR_MS) return;

  lastUpdateCheckAt = Date.now();

  void newestReleaseWithoutApi()
    .then((release) => {
      if (!release) {
        /* Somebody asked, so say so. Silence is the same shape as a broken
           button. */
        if (force) {
          sendToMain("up-to-date", {
            version: app.getVersion(),
          });
        }
        return;
      }

      if (release.version === announcedVersion) {
        if (force) announceDownloaded(release.version);
        return;
      }

      startupLog(
        `Update: ${release.version} available (background check, ${reason})`
      );

      if (!autoUpdateEnabled) {
        /* Told, not fetched. The toast's button calls `download-update`, which
           is this same release with the rollout bypassed, because by then
           somebody has asked for it. */
        announcedVersion = release.version;

        sendToMain("announced", {
          version: release.version,
          from: app.getVersion(),
          autoDownload: false,
        });

        return;
      }

      startBackgroundDownload(release, { announce: true });
    })
    .catch((err) => {
      logUpdateFailure(
        "Background update check failed",
        err instanceof Error ? err : undefined
      );
    });
}

/**
 * Point the updater at one release and let it download.
 *
 * The feed is pinned to the exact tag the probe verified rather than left on
 * the provider's own idea of latest, for the reason
 * `pinFeedToNewestCompleteRelease` exists: a release is published across
 * several minutes and the provider will happily hand back one that is halfway
 * up. The difference here is that the tag came from `releases.atom` and a
 * one-byte range request, so it costs no API quota.
 *
 * `announce` is what decides whether the download raises a toast. Only the
 * automatic path sets it: a download somebody pressed a button for is already
 * on a screen that shows it, and a second copy in the corner is telling them
 * what they are looking at.
 */
function startBackgroundDownload(
  release: ReleaseRef,
  { bypassRollout = false, announce = false } = {}
): void {
  pendingRelease = release;
  announceDownload = announce;

  if (updatesAreManagedByWindows) {
    startupLog("Update: not downloading — installed from the MSIX package");
    pendingRelease = null;
    announceDownload = false;
    return;
  }

  autoUpdater.setFeedURL({
    provider: "generic",
    url: releaseDownloadBase(release.tag),
    useMultipleRangeRequest: FEED_SUPPORTS_MULTI_RANGE,
  });

  autoUpdater.autoDownload = true;
  autoUpdater.isUserWithinRollout = bypassRollout
    ? () => true
    : defaultRolloutCheck;

  autoUpdater
    .checkForUpdates()
    .catch((err) => {
      pendingRelease = null;
      announceDownload = false;

      logUpdateFailure(
        "Background update download failed",
        err instanceof Error ? err : undefined
      );
    });
}

/**
 * Start the repeating check. Called once, from `initBackgroundUpdater`.
 *
 * That is the one place both non-dev launch paths pass through — the ordinary
 * one and the hidden auto-start one — and dev passes through neither, which is
 * the behaviour the launch-time check already has.
 */
function startPeriodicUpdateChecks(launchAlreadyChecked: boolean): void {
  if (updateCheckTimer) return;

  /* Only when launch really did check. Seeding the clock stops a resume a
     minute later from checking again — but the ordinary launch path does not
     check any more, and seeding there would make the floor in
     `checkForUpdatesInBackground` swallow the launch check that replaces it,
     leaving the first look an hour away. */
  if (launchAlreadyChecked) lastUpdateCheckAt = Date.now();

  updateCheckTimer = setInterval(
    () => checkForUpdatesInBackground("interval"),
    UPDATE_CHECK_INTERVAL_MS
  );
  updateCheckTimer.unref();

  powerMonitor.on("resume", () =>
    checkForUpdatesInBackground("resume")
  );

  app.on("before-quit", () => {
    if (!updateCheckTimer) return;
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  });
}

/**
 * Undo what a check somebody asked for changed.
 *
 * `check-for-updates` turns background downloading off so the answer is
 * reported rather than silently fetched, and bypasses the rollout slice so the
 * person asking is not told there is nothing. Every path out of a check comes
 * through one of the three events below, including the failing ones, so
 * neither can stay that way.
 *
 * Bitwarden's `reset()`.
 */
function resumeAutoDownload(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.isUserWithinRollout = defaultRolloutCheck;
}

function initBackgroundUpdater(launchAlreadyChecked: boolean) {
  autoUpdater.on(
    "checking-for-update",
    () => sendToMain("checking")
  );

  autoUpdater.on("update-available", (info) => {
    pendingUpdateVersion = info.version;

    sendToMain("available", {
      version: info.version,
    });

    /* The moment the toast is honest: the rollout slice let this machine
       through, the assets are there, and `autoDownload` is about to fetch. A
       release announced before this point is one that might still turn out not
       to be coming. */
    if (announceDownload && info.version !== announcedVersion) {
      announcedVersion = info.version;

      sendToMain("announced", {
        version: info.version,
        from: app.getVersion(),
        autoDownload: true,
      });
    }

    resumeAutoDownload();
  });

  autoUpdater.on("update-not-available", (info) => {
    /* A background download that ends here was held back by the rollout slice
       — the probe found the release, so it exists. Nothing is said: this is
       the one case where being quiet is the whole point of staging. */
    pendingRelease = null;
    announceDownload = false;

    sendToMain("not-available", {
      version: info.version,
    });

    resumeAutoDownload();
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
    updateIsDownloaded = true;
    pendingRelease = null;
    announceDownload = false;

    /* Announced here as well as at `update-available`, because the toast has to
       stop depending on what started the download.
     *
     * GRYT-625 raised it only for downloads nobody asked for, reasoning that
       somebody who pressed Check for Updates is already being shown the answer.
       That holds while they are looking at Settings and stops the moment they
       navigate away — the download finishes into an empty screen and there is
       nothing anywhere saying a restart would help. The rule is now: a finished
       download that has not been announced gets announced. */
    if (info.version !== announcedVersion) {
      announcedVersion = info.version;

      sendToMain("announced", {
        version: info.version,
        from: app.getVersion(),
        autoDownload: true,
      });
    }

    sendToMain("downloaded", {
      version: info.version,
    });
  });

  autoUpdater.on("error", (err) => {
    /* Let the next hourly check try this release again. Without it one dropped
       connection means no further attempt until Gryt restarts, because the
       probe skips a version it has already announced. */
    if (pendingRelease && announceDownload) announcedVersion = null;

    pendingRelease = null;
    announceDownload = false;

    resumeAutoDownload();

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

  startPeriodicUpdateChecks(launchAlreadyChecked);
}

/**
 * Install what has been downloaded, by quitting into it.
 *
 * This is Bitwarden's shape (apps/desktop/src/main/updater.main.ts): set the
 * quit flag, then hand off. There is no relaunch into a second process and no
 * splash — the bytes are already on disk by the time this is reachable,
 * because `autoDownload` fetched them while Gryt was running.
 *
 * The flag first, because `quitAndInstall` does not go through `before-quit`
 * and the main window's close handler reads it. Without it a window that is up
 * cancels the quit and hides, and on macOS Squirrel cannot swap the bundle
 * while the process lives (GRYT-621).
 */
function installDownloadedUpdate(): void {
  isQuitting = true;
  autoUpdater.quitAndInstall(true, true);
}

/**
 * Fetch the release the toast is currently showing, because somebody pressed
 * the button on it.
 *
 * This is the automatic download's other half: with automatic updates off, the
 * background check announces and stops, and this is what the announcement's
 * button reaches. The rollout slice is bypassed for the same reason the
 * Settings check bypasses it — somebody who goes looking should get it.
 *
 * Re-probing rather than trusting a tag from the renderer: the announcement may
 * have been sitting on screen for hours, and a newer release since then is the
 * one to fetch.
 */
function downloadAnnouncedRelease(): void {
  if (updateIsDownloaded) {
    sendToMain("downloaded", {
      version: pendingUpdateVersion,
    });
    return;
  }

  if (pendingRelease) {
    sendToMain("downloading", {
      version: pendingRelease.version,
    });
    return;
  }

  void newestReleaseWithoutApi()
    .then((release) => {
      if (!release) {
        sendToMain("not-available", {
          version: app.getVersion(),
        });
        return;
      }

      startBackgroundDownload(release, { bypassRollout: true });
    })
    .catch((err) => {
      logUpdateFailure(
        "Update download failed",
        err instanceof Error ? err : undefined
      );

      sendToMain("error", {
        message: friendlyUpdateError(
          err instanceof Error ? err : new Error(String(err))
        ),
      });
    });
}

/**
 * Restart Gryt as it is, carrying nothing over.
 *
 * Not an update path. Switching release channel needs a fresh process to pick
 * the new feed up, and that is all this does.
 */
function relaunchApp(): void {
  isQuitting = true;

  app.relaunch({
    args: process.argv
      .slice(1)
      .filter(
        (arg) =>
          arg !== AUTO_START_ARG &&
          arg !== LEGACY_UPDATE_ARG
      ),
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

/**
 * Height of the native window-controls strip on Windows and Linux.
 *
 * Has to match TITLEBAR_HEIGHT in src/components/titlebar.tsx, which is the
 * strip the app draws its own back/forward buttons and title into. The two
 * halves sit side by side, so a disagreement shows up as a step in the middle
 * of the titlebar.
 */
const TITLEBAR_OVERLAY_HEIGHT = 36;

function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 300,
    minHeight: 300,
    show: false,

    titleBarStyle: "hidden",

    // Only what the window opens with, before the renderer has read the
    // theme and sent the real values (GRYT-288). These are the shipped dark
    // palette's --gryt-neutral-1 and --gryt-neutral-12, so somebody on the
    // default theme sees no change at all when the push arrives.
    //
    // The colour used to be #0d0f13, which is not a token and not what the
    // titlebar beside it paints — so the strip was two shades of almost the
    // same dark, with a seam down the middle.
    titleBarOverlay: {
      color: "#111318",
      symbolColor: "#e0e0e6",
      height: TITLEBAR_OVERLAY_HEIGHT,
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
      // The idle default, and only the idle default — a call turns it off,
      // see setRendererThrottling. Left on here because the app spends most of
      // its life in the tray doing nothing, and throttling a renderer that is
      // doing nothing is the behaviour worth having.
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
        showMain();
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

    /* Coming back to the window is the moment somebody is most likely to act on
       a release, and the cheapest signal that they are here. The floor keeps
       alt-tabbing free: at most one check every five minutes however often this
       fires. */
    checkForUpdatesInBackground("focus");
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

// ── Hotkey bindings ─────────────────────────────────────────────────────

type HotkeyAction = "ptt" | "mute" | "deafen" | "disconnect";

interface HotkeyBinding {
  /** uiohook keycode, or null when the binding is a mouse button. */
  keycode: number | null;
  /** Physical mouse button — 3 middle, 4 and 5 the side ones — or null for a key. */
  mouseButton: number | null;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

const hotkeyBindings = new Map<HotkeyAction, HotkeyBinding>();

/**
 * Which bindings are currently held. Keeps key repeat from firing an action
 * twice, and lets a release be matched after the modifiers were let go.
 */
const hotkeyHeld = new Set<HotkeyAction>();

function parseBinding(combo: string): HotkeyBinding | null {
  const parsed = parseCombo(combo);
  if (!parsed) return null;

  // Mouse buttons are numbered physically in the combo grammar, which is how
  // libuiohook reports them, so the number passes straight through.
  if (parsed.code === null) {
    return { keycode: null, mouseButton: parsed.mouseButton, ...modifiersOf(parsed) };
  }

  const keycode = keycodeForDomCode(parsed.code);
  if (keycode == null) {
    console.warn(`No uiohook mapping for hotkey "${parsed.code}"`);
    return null;
  }

  return { keycode, mouseButton: null, ...modifiersOf(parsed) };
}

function modifiersOf(parsed: ParsedCombo) {
  return { ctrl: parsed.ctrl, shift: parsed.shift, alt: parsed.alt, meta: parsed.meta };
}

function registerHotkeys(bindings: Partial<Record<HotkeyAction, string>>): void {
  hotkeyBindings.clear();
  hotkeyHeld.clear();

  for (const [action, combo] of Object.entries(bindings)) {
    const parsed = parseBinding(combo ?? "");
    if (parsed) hotkeyBindings.set(action as HotkeyAction, parsed);
  }
}

interface HookModifiers {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

function matchPress(
  event: HookModifiers,
  keycode: number | null,
  mouseButton: number | null
): HotkeyAction | null {
  for (const [action, binding] of hotkeyBindings) {
    if (binding.keycode !== keycode) continue;
    if (binding.mouseButton !== mouseButton) continue;
    if (binding.ctrl !== event.ctrlKey) continue;
    if (binding.shift !== event.shiftKey) continue;
    if (binding.alt !== event.altKey) continue;
    if (binding.meta !== event.metaKey) continue;

    return action;
  }

  return null;
}

/**
 * A release ignores modifiers. Letting go of Shift before the key itself is
 * normal, and a push-to-talk that only closed on an exact match would leave
 * the microphone open.
 */
function matchRelease(
  keycode: number | null,
  mouseButton: number | null
): HotkeyAction | null {
  for (const action of hotkeyHeld) {
    const binding = hotkeyBindings.get(action);
    if (!binding) continue;
    if (binding.keycode === keycode && binding.mouseButton === mouseButton) {
      return action;
    }
  }

  return null;
}

function onHotkeyPress(
  keycode: number | null,
  mouseButton: number | null,
  event: HookModifiers
): void {
  const action = matchPress(event, keycode, mouseButton);
  if (!action || hotkeyHeld.has(action)) return;

  hotkeyHeld.add(action);
  mainWindow?.webContents.send("hotkey-down", action);
}

function onHotkeyRelease(keycode: number | null, mouseButton: number | null): void {
  const action = matchRelease(keycode, mouseButton);
  if (!action) return;

  hotkeyHeld.delete(action);
  mainWindow?.webContents.send("hotkey-up", action);
}

function ensureUiohook(): boolean {
  if (uiohookRunning) return true;

  const lib = loadUiohook();
  if (!lib) return false;

  const uIOhook = lib.uIOhook;

  if (process.platform === "darwin") {
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);

    if (!trusted) {
      startupLog("macOS Accessibility not granted — skipping uiohook");
      return false;
    }
  }

  uIOhook.on("keydown", (event) => {
    onHotkeyPress(event.keycode, null, event);
  });

  uIOhook.on("keyup", (event) => {
    onHotkeyRelease(event.keycode, null);
  });

  // uiohook listens without swallowing, so every click in the OS arrives here.
  // Left and right click are not bindable (src/lib/hotkeys.ts), which keeps
  // this from keying the microphone on ordinary clicking.
  uIOhook.on("mousedown", (event) => {
    onHotkeyPress(null, Number(event.button), event);
  });

  uIOhook.on("mouseup", (event) => {
    onHotkeyRelease(null, Number(event.button));
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

    ...(updateIsDownloaded
      ? [
          {
            label: `Restart and install ${pendingUpdateVersion ?? "update"}`,
            click: installDownloadedUpdate,
          } as const,

          {
            type: "separator",
          } as const,
        ]
      : []),

    {
      label: "Check for Updates",
      click: () => {
        /* Forced: somebody pressed this, so it skips the floor and answers
           either way. */
        checkForUpdatesInBackground("tray", true);
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

/**
 * Chromium throttles a hidden window's timers. That is right for a chat client
 * sitting in the tray and wrong for one that is in a call.
 *
 * Minimise the window and the renderer's timers slow down; leave it hidden for
 * about five minutes and Chromium's intensive throttling takes over and they
 * fire roughly once a minute. Two things in the voice engine ride on a 15s
 * `setInterval` and both matter:
 *
 *   - the keep-alive that keeps the SFU WebSocket looking alive to whatever is
 *     between us and it, and
 *   - the check that notices the socket is no longer OPEN, which is what starts
 *     a reconnect.
 *
 * At one tick a minute the first is barely a keep-alive and the second means a
 * dropped call can go unnoticed for most of a minute. Audio itself is fine
 * either way — WebRTC runs below the renderer's timers and does not care — so
 * the failure is quiet: the call stays up, the socket does not, and nothing
 * looks wrong until the reconnect that should have happened does not.
 *
 * Off for the duration of a call, back on when it ends. Not off permanently:
 * the app starts hidden for a lot of people and spends most of its life in the
 * tray, and a renderer that is doing nothing should be throttled.
 */
function setRendererThrottling(allowed: boolean): void {
  const contents = mainWindow?.webContents;
  if (!contents || contents.isDestroyed()) return;

  contents.setBackgroundThrottling(allowed);
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
      // macOS will not show the microphone or camera prompt for getUserMedia
      // alone — an Electron app has to ask. Without this the renderer gets
      // NotAllowedError forever and enumerateDevices returns nothing, which
      // reads like broken audio rather than a missing permission.
      //
      // Safe to call every launch: once a decision is recorded, it resolves
      // with that decision instead of prompting again.
      if (process.platform === "darwin") {
        for (const kind of ["microphone", "camera"] as const) {
          try {
            const granted = await systemPreferences.askForMediaAccess(kind);
            startupLog(`${kind} access: ${granted ? "granted" : "denied"}`);
          } catch (error) {
            startupLog(`${kind} access request failed: ${error}`);
          }
        }
      }

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

          relaunchApp();
        }
      );

      ipcMain.handle(
        "get-auto-update",
        () => autoUpdateEnabled
      );

      ipcMain.on(
        "set-auto-update",
        (_event, enabled: boolean) => {
          autoUpdateEnabled = enabled;

          writeConfig({
            autoUpdate: enabled,
          });

          /* Turning it back on should not mean waiting up to an hour for the
             next tick. Turning it off cancels nothing that is already running
             — electron-updater has no cancel that leaves a usable cache, and
             the bytes are half down. */
          if (enabled) {
            lastUpdateCheckAt = 0;
            announcedVersion = null;

            checkForUpdatesInBackground("setting");
          }
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

      /**
       * Repaint the native window controls when the theme changes
       * (GRYT-288).
       *
       * On Windows and Linux the minimise, maximise and close buttons are
       * drawn by the OS into an overlay strip, not by us — so they are the
       * one part of the window the stylesheet cannot reach. They were set
       * once at construction and stayed that colour, which meant picking a
       * light theme left three dark-theme buttons sitting in the corner of
       * a light titlebar.
       *
       * The renderer sends resolved colours rather than a theme name,
       * because it is the only side that can read what the variables
       * currently evaluate to — an imported theme supplies its own.
       *
       * macOS is excluded: the traffic lights belong to the OS and follow
       * the system appearance, and setTitleBarOverlay is not implemented
       * there.
       */
      ipcMain.on(
        "set-titlebar-overlay",
        (
          _event,
          colors: {
            color: string;
            symbolColor: string;
          }
        ) => {
          if (
            process.platform ===
            "darwin"
          )
            return;
          if (
            !mainWindow ||
            mainWindow.isDestroyed()
          )
            return;

          // Anything but a plain hex string is refused rather than passed
          // on. Electron throws on a colour it cannot parse, and the value
          // arrives from the renderer, where a theme could carry oklch or
          // a colour name.
          const isHex = (v: unknown) =>
            typeof v === "string" &&
            /^#[0-9a-f]{6}$/i.test(v);

          if (
            !isHex(colors?.color) ||
            !isHex(colors?.symbolColor)
          )
            return;

          try {
            mainWindow.setTitleBarOverlay(
              {
                color: colors.color,
                symbolColor:
                  colors.symbolColor,
                height:
                  TITLEBAR_OVERLAY_HEIGHT,
              }
            );
          } catch {
            // Not every platform build implements it, and a titlebar that
            // keeps its old colours is not a reason to take anything down.
          }
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

          const joinedOrLeftVoice =
            next.inVoice !==
            voiceState.inVoice;

          voiceState = next;

          if (joinedOrLeftVoice) {
            setRendererThrottling(
              !next.inVoice
            );
          }

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

      // Asked for by the addons page when it opens, rather than on a timer.
      // Nobody needs to know an addon is out of date while they are in a call,
      // and a check that only runs when somebody is looking at the answer
      // cannot spend anybody's rate limit in the background.
      ipcMain.handle(
        "addons:check-updates",
        () => checkAddonUpdates()
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
        "uiohook deferred until a hotkey is set"
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
        "per-application-audio-supported",
        () => {
          return supportsPerApplicationAudio();
        }
      );

      // An empty list puts the share back on everything except Gryt.
      ipcMain.handle(
        "set-audio-capture-applications",
        (
          _event,
          sourceIds: string[]
        ) => {
          if (!mainWindow) {
            return [];
          }

          return setAudioCaptureApplications(
            mainWindow,
            Array.isArray(sourceIds) ? sourceIds : []
          );
        }
      );

      ipcMain.handle(
        "list-audio-capture-sources",
        () => {
          return listAudioCaptureSources();
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
        "embedded-server:update-ports",
        (
          _event,
          id: string,
          ports: { serverPort?: number; sfuPort?: number; mediaPort?: number }
        ) =>
          updateServerPortsFor(
            id,
            ports
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
          "Dev mode — skipping the update check"
        );

        mainWindow?.show();
      } else if (startHiddenOnLaunch) {
        startupLog(
          "Starting hidden (auto-start)"
        );

        initBackgroundUpdater(true);

        if (!updatesAreManagedByWindows) {
          pinFeedToNewestCompleteRelease().finally(
            () => {
              autoUpdater
                .checkForUpdates()
                .catch(() => {});
            }
          );
        }
      } else {
        /* Every launch, now that there is only one. Open the window and look
           for updates behind it.

           An update downloads while Gryt is running and installs on restart,
           so nothing about starting the app waits on the network. There used to
           be a second path here that relaunched into a splash and downloaded
           before showing anything, which is why installing an older build on
           Windows took minutes to reach a login screen. */

        /* Waited for rather than shown immediately. An empty frame that fills
           in a second later is not fast, it just moves the wait somewhere more
           visible — and until now the update check was incidentally giving the
           renderer this time. The 20 second fallback in createMainWindow covers
           a load that never finishes. */
        if (
          mainWindow &&
          !mainWindow.webContents.isLoading()
        ) {
          showMain();
        } else {
          mainWindow?.webContents.once(
            "did-stop-loading",
            () => showMain()
          );
        }

        startupLog(
          "Main window shown"
        );

        initBackgroundUpdater(false);

        /* Late enough to be out of the way of everything else starting, early
           enough that somebody who opens Gryt, reads a message and closes it
           still hears about a release. The periodic timer alone would not look
           for an hour. */
        setTimeout(
          () => checkForUpdatesInBackground("launch"),
          LAUNCH_UPDATE_CHECK_DELAY_MS
        );
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
          if (updateIsDownloaded) {
            sendToMain("downloaded", {
              version: pendingUpdateVersion,
            });
            return;
          }

          /* Somebody asked, so report rather than fetch, and let them past
             this release's rollout slice. Bitwarden does both together:
             `autoDownload` off and `isUserWithinRollout` forced true for the
             length of a check with feedback, both restored in `reset()`.
             Restored on the first event either way, so a failed check cannot
             leave background downloads off or the rollout bypassed. */
          autoUpdater.autoDownload = false;
          autoUpdater.isUserWithinRollout = () => true;

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
        "download-update",
        () => downloadAnnouncedRelease()
      );

      /* What the renderer missed.
       *
       * The toast is React state and the announcement is a one-shot message, so
       * a reload cleared the toast and nothing ever sent it again —
       * `announcedVersion` had already been set, so not even the next check
       * would (GRYT-633). The renderer asks for this on mount instead of being
       * told once and having to keep it. */
      ipcMain.on(
        "replay-update-status",
        () => {
          if (updateIsDownloaded) {
            announceDownloaded(pendingUpdateVersion);
            return;
          }

          if (pendingRelease) {
            announceDownloaded(pendingRelease.version);
            return;
          }

          if (announcedVersion) {
            announceDownloaded(announcedVersion);
          }
        }
      );

      ipcMain.on(
        "restart-for-update",
        () => {
          if (updateIsDownloaded) {
            installDownloadedUpdate();
            return;
          }

          /* Asked for before there is anything to install. Start the
             download rather than restarting into nothing — with automatic
             updates off there is no other way this ever begins, and
             `update-downloaded` raises the prompt again the moment it lands.
             `downloadAnnouncedRelease` reports the progress if one is already
             running. */
          downloadAnnouncedRelease();
        }
      );

      // Answers with whether global capture is actually running. The renderer
      // falls back to its own window listeners when it is not — uiohook is
      // missing on some Linux setups and needs Accessibility on macOS, and a
      // hotkey that works only while Gryt is focused beats one that does
      // nothing.
      ipcMain.handle(
        "hotkeys-set",
        (
          _event,
          bindings: Partial<Record<HotkeyAction, string>>
        ): boolean => {
          registerHotkeys(bindings);

          if (hotkeyBindings.size === 0) return uiohookRunning;
          if (uiohookRunning) return true;

          if (process.platform === "darwin") {
            systemPreferences.isTrustedAccessibilityClient(true);
          }

          try {
            return ensureUiohook();
          } catch (err) {
            console.warn(
              `uiohook start failed: ${
                err instanceof Error ? err.message : String(err)
              }`
            );

            return false;
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