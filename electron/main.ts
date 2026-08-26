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
autoUpdater.autoInstallOnAppQuit = true;

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

/**
 * How often a client that is already running looks for a release.
 *
 * Until GRYT-543 it never did. The three `checkForUpdates()` call sites are all
 * launch-time or the button in settings, so an app left open never saw a
 * release until it was restarted. Six went out on 2026-08-22 and a client open
 * across all of them stayed on the version it started the day with — including
 * through a privacy fix, which is not a thing to make somebody restart for.
 *
 * An hour is affordable because this check spends no GitHub API quota at all.
 * See `newestReleaseWithoutApi`.
 */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The soonest two background checks may be, whatever asked for them.
 *
 * Waking from sleep is the other moment a machine has plausibly been away long
 * enough for a release to have happened, and a laptop lid opens far more often
 * than once an hour. Without a floor, ten lid-opens is ten checks.
 */
const UPDATE_CHECK_FLOOR_MS = 15 * 60 * 1000;

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
 * the yml check below is not optional. A draft's assets are not downloadable,
 * which is what rejects it.
 *
 * This deliberately does not pin the feed or download anything. Both of those
 * happen at the next launch, on purpose, where the installer has an idle app to
 * work with. All this does is notice.
 */
async function newestReleaseWithoutApi(): Promise<string | null> {
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
    const yml = await fetchWithTimeout(
      `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases/download/${tag}/${channelYmlName()}`
    );

    /* fetchWithTimeout returns null on any non-2xx, so a draft's 404 lands
       here and the loop moves on to the release below it. */
    if (yml) return version;
  }

  return null;
}

/**
 * A check nobody asked for, so it stays quiet and gives up easily.
 *
 * It announces once per version per run. A failure is logged rather than shown:
 * somebody who did not press anything should not get an error about it.
 */
function checkForUpdatesInBackground(reason: string): void {
  /* Already downloaded, so the answer cannot change until this restarts.
     Element hit the same thing on macOS and guards it the same way: re-checking
     while Squirrel is holding a staged update wedges the install
     (element-web#12433). */
  if (updateIsDownloaded) return;

  if (Date.now() - lastUpdateCheckAt < UPDATE_CHECK_FLOOR_MS) return;
  lastUpdateCheckAt = Date.now();

  void newestReleaseWithoutApi()
    .then((version) => {
      if (!version || version === announcedVersion) return;

      announcedVersion = version;
      startupLog(
        `Update: ${version} available (background check, ${reason})`
      );

      sendToMain("announced", {
        version,
        from: app.getVersion(),
      });
    })
    .catch((err) => {
      logUpdateFailure(
        "Background update check failed",
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

    resumeAutoDownload();
  });

  autoUpdater.on("update-not-available", (info) => {
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

    sendToMain("downloaded", {
      version: info.version,
    });
  });

  autoUpdater.on("error", (err) => {
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
 * What the renderer needs in order to draw the frame.
 *
 * The corners have to square off while maximised or full screen. A rounded
 * window at the edge of the screen leaves four notches with the desktop
 * showing through them, because there is nothing behind the window to fill
 * the curve.
 */
function readWindowState(): {
  maximized: boolean;
  fullScreen: boolean;
  flush: boolean;
} {
  if (
    !mainWindow ||
    mainWindow.isDestroyed()
  )
    return {
      maximized: false,
      fullScreen: false,
      flush: false,
    };

  const maximized =
    mainWindow.isMaximized();
  const fullScreen =
    mainWindow.isFullScreen();

  return {
    maximized,
    fullScreen,
    flush:
      fullScreen || fillsWorkArea(),
  };
}

/**
 * Whether the window is actually covering its display, rather than merely
 * having been maximised at some point.
 *
 * isMaximized is not the same question. Drag a maximised window off the top of
 * the screen and macOS un-zooms it without emitting unmaximize, so the corners
 * stayed square on a window that was no longer filling anything. Snapping made
 * it worse: a half-screen window is not maximised and never was, and it should
 * be round.
 *
 * So the frame asks about geometry instead. A pixel of slack each way absorbs
 * the rounding between a display's work area and the bounds Electron reports
 * back for a window put in it.
 */
function fillsWorkArea(): boolean {
  if (
    !mainWindow ||
    mainWindow.isDestroyed()
  )
    return false;

  const b = mainWindow.getBounds();
  const { workArea } =
    screen.getDisplayMatching(b);
  const slack = 1;

  return (
    b.x <= workArea.x + slack &&
    b.y <= workArea.y + slack &&
    b.x + b.width >=
      workArea.x + workArea.width - slack &&
    b.y + b.height >=
      workArea.y + workArea.height - slack
  );
}

/**
 * Put the window in a fraction of the display it is currently on.
 *
 * Our own, on every platform (GRYT-626). Neither OS gives this away with the
 * frame drawn by us: the Windows 11 Snap Layouts flyout hangs off a native
 * caption button through WM_NCHITTEST, and the macOS tiling menu hangs off the
 * native zoom button with no hook at all. Rather than chase two different
 * native mechanisms, one of which cannot be chased, the zones are computed
 * here and the same menu opens on all three platforms.
 *
 * workArea rather than bounds, so the dock, the menu bar and the taskbar keep
 * their space. getDisplayMatching rather than the primary display, so snapping
 * lands on the screen the window is already on.
 *
 * There is no unsnap. A snapped window is an ordinary window at new bounds —
 * the same as Magnet or macOS tiling — so getting out of it is dragging or
 * resizing, not a mode to leave.
 */
type SnapZone =
  | "fill"
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

function snapWindow(zone: SnapZone): void {
  if (
    !mainWindow ||
    mainWindow.isDestroyed()
  )
    return;

  // Full screen has to be left before bounds mean anything, and a maximised
  // window ignores setBounds until it is restored.
  if (mainWindow.isFullScreen())
    mainWindow.setFullScreen(false);

  // Fill is the native maximise rather than bounds covering the work area.
  // It is a real maximised state, so the restore button knows what to undo
  // and the frame squares its corners off the existing maximize event.
  if (zone === "fill") {
    if (!mainWindow.isMaximized())
      mainWindow.maximize();
    return;
  }

  if (mainWindow.isMaximized())
    mainWindow.unmaximize();

  const { workArea } =
    screen.getDisplayMatching(
      mainWindow.getBounds()
    );
  const { x, y, width, height } =
    workArea;

  // Rounded once and subtracted, so two halves always add back up to the
  // whole on an odd number of pixels rather than leaving a seam.
  const halfW = Math.round(width / 2);
  const halfH = Math.round(height / 2);
  const right = x + halfW;
  const lower = y + halfH;
  const restW = width - halfW;
  const restH = height - halfH;

  const zones: Record<
    Exclude<SnapZone, "fill">,
    Electron.Rectangle
  > = {
    left: { x, y, width: halfW, height },
    right: {
      x: right,
      y,
      width: restW,
      height,
    },
    top: { x, y, width, height: halfH },
    bottom: {
      x,
      y: lower,
      width,
      height: restH,
    },
    "top-left": {
      x,
      y,
      width: halfW,
      height: halfH,
    },
    "top-right": {
      x: right,
      y,
      width: restW,
      height: halfH,
    },
    "bottom-left": {
      x,
      y: lower,
      width: halfW,
      height: restH,
    },
    "bottom-right": {
      x: right,
      y: lower,
      width: restW,
      height: restH,
    },
  };

  const next = zones[zone];
  if (!next) return;

  // Electron clamps to minWidth/minHeight on its own, so a quarter of a small
  // display comes back oversized rather than unusable.
  mainWindow.setBounds(next, true);
}

let lastWindowState = "";

function sendWindowState(): void {
  const next = readWindowState();
  const key = JSON.stringify(next);
  if (key === lastWindowState) return;
  lastWindowState = key;

  mainWindow?.webContents.send(
    "window-state-change",
    next
  );
}

function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 300,
    minHeight: 300,
    show: false,

    // The frame is ours on every platform (GRYT-626).
    //
    // A window's corner radius belongs to whoever draws the frame, and no OS
    // hands the number out: macOS 26 rounds at 16px, Windows 11 at 8 through
    // DWM, Windows 10 not at all. Electron's roundedCorners is a boolean and
    // DwmSetWindowAttribute takes ROUND, ROUNDSMALL or DONOTROUND, so there
    // is nothing to set the three to. They can only agree by none of them
    // doing it.
    //
    // roundedCorners: false stops macOS and Windows 11 clipping, transparent
    // lets the pixels outside our own curve fall away, and the renderer draws
    // the radius, the hairline border and the buttons. macOS still shadows a
    // transparent window along its alpha, so the drop shadow survives there;
    // Windows does not shadow one at all, which is GRYT-628.
    //
    // macOS keeps a titlebar rather than losing the frame outright, and it is
    // worth being clear about why, because "hidden" sounds like the weaker
    // option. A -webkit-app-region: drag element hands mousedown to the OS
    // drag loop, so no click or dblclick is ever generated for it — a
    // double-click handler on the titlebar cannot fire, whatever it is
    // attached to. Double-click to zoom therefore has to come from AppKit,
    // and AppKit only offers it to a window that has a titlebar. Keeping one
    // and hiding it buys that back, along with drag and edge tiling, and
    // costs nothing: transparent already stops the native traffic lights
    // being drawn, which is measured rather than assumed — of four windows
    // differing only in these options, the lights appear on the opaque one
    // and on none of the transparent ones.
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hidden" as const }
      : { frame: false }),
    roundedCorners: false,
    transparent: true,

    icon: appIcon,

    // A transparent window cannot have an opaque backdrop, and a colour here
    // would square off the corners it sits behind. The app's background is
    // painted by the frame in the renderer instead.
    backgroundColor: "#00000000",

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

  if (process.platform === "darwin") {
    // Transparency already stops these being drawn. Saying so explicitly means
    // the drawn ones stay the only set if that ever stops being true.
    try {
      mainWindow.setWindowButtonVisibility(
        false
      );
    } catch {
      // Not implemented off macOS, and a visible native button is not a
      // reason to fail starting up.
    }
  }

  // resize and move are in here because the answer is geometric now: dragging
  // a maximised window off the top of the screen un-zooms it without emitting
  // unmaximize, and the corners have to come back. sendWindowState only emits
  // on an actual change, so a drag does not flood the channel.
  mainWindow.on("resize", sendWindowState);
  mainWindow.on("move", sendWindowState);
  mainWindow.on(
    "maximize",
    sendWindowState
  );
  mainWindow.on(
    "unmaximize",
    sendWindowState
  );
  mainWindow.on(
    "restore",
    sendWindowState
  );
  mainWindow.on(
    "enter-full-screen",
    sendWindowState
  );
  mainWindow.on(
    "leave-full-screen",
    sendWindowState
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
        checkForUpdatesInBackground("tray");
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

      // ── Window controls (GRYT-626) ───────────────────────────────
      //
      // The frame is drawn by the renderer on every platform now, so the
      // buttons in it are ordinary DOM and the window actions behind them
      // have to be reachable from there. The actions stay native — this is
      // Electron's own minimise, maximise and close — and closing still runs
      // the close-to-tray handler on mainWindow rather than going around it.

      ipcMain.on(
        "window-minimize",
        () => {
          if (
            !mainWindow ||
            mainWindow.isDestroyed()
          )
            return;
          mainWindow.minimize();
        }
      );

      ipcMain.on(
        "window-toggle-maximize",
        () => {
          if (
            !mainWindow ||
            mainWindow.isDestroyed()
          )
            return;

          // Full screen is checked first. On macOS this button is the green
          // one, and unmaximise on a full-screen window does nothing at all,
          // so the click would be swallowed.
          if (
            mainWindow.isFullScreen()
          ) {
            mainWindow.setFullScreen(
              false
            );
            return;
          }

          if (mainWindow.isMaximized())
            mainWindow.unmaximize();
          else mainWindow.maximize();
        }
      );

      ipcMain.on(
        "window-toggle-fullscreen",
        () => {
          if (
            !mainWindow ||
            mainWindow.isDestroyed()
          )
            return;
          mainWindow.setFullScreen(
            !mainWindow.isFullScreen()
          );
        }
      );

      ipcMain.on(
        "window-close",
        () => {
          if (
            !mainWindow ||
            mainWindow.isDestroyed()
          )
            return;
          mainWindow.close();
        }
      );

      ipcMain.on(
        "window-snap",
        (_event, zone: SnapZone) => {
          snapWindow(zone);
        }
      );

      ipcMain.handle(
        "window-get-state",
        () => readWindowState()
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

        pinFeedToNewestCompleteRelease().finally(
          () => {
            autoUpdater
              .checkForUpdates()
              .catch(() => {});
          }
        );
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
        "restart-for-update",
        () => {
          if (updateIsDownloaded) {
            installDownloadedUpdate();
            return;
          }

          /* Asked for before the download finished. Say so rather than
             restarting into nothing: `update-downloaded` raises the prompt
             again the moment it lands. */
          sendToMain("downloading", {
            version: pendingUpdateVersion,
          });
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