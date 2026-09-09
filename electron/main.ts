import { execFile } from "child_process";
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
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
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
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
  appImageState,
  APPS_DIR,
  restoreFromTrash,
} from "./appImageLocation";
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
  createProcessWatcher,
  listRunningPrograms,
  type ProcessWatcher,
  readWatchList,
} from "./processWatcher";
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
/* Nothing sets this any more. Kept so a 1.6.x client relaunching with it is
   recognised and ignored rather than carried forward. */
const LEGACY_UPDATE_ARG = "--gryt-update";

let pendingDeepLinkUrl: string | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let closeToTray = true;

/* Null until the first window exists, since the only thing it does with an
   answer is send it to a renderer. */
let processWatcher: ProcessWatcher | null = null;

/** When the person allowed the process list to be read, or null. */
function readScanConsent(): string | null {
  const at = loadGlobalStore()["processScanConsent"];
  return typeof at === "string" && at ? at : null;
}

function processScanAllowed(): boolean {
  return readScanConsent() !== null;
}

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
  // Electron points xdg-mime at a .desktop file inside the mounted AppImage, so
  // the query comes back empty and the browser cannot hand back the sign-in.
  ensureLinuxAppImageProtocolHandler(process.env.APPIMAGE);
  app.setAsDefaultProtocolClient(PROTOCOL, process.env.APPIMAGE);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// A cold protocol launch on Linux and Windows delivers the URL in argv, so it is
// captured here for the pending-link flush after the window loads.
if (process.platform !== "darwin") {
  const argvDeepLink = process.argv.find((arg) =>
    arg.startsWith(`${PROTOCOL}://`)
  );
  if (argvDeepLink) pendingDeepLinkUrl = argvDeepLink;
}

/** True unless the AppImage moved from the path its `gryt://` handler names.
    The offer to fix it is only made when it can be honoured. */
async function warnIfAppImageMoved(): Promise<boolean> {
  const state = appImageState(process.env.APPIMAGE);
  if (state.kind === "not-applicable" || state.kind === "present") return true;

  const parent = mainWindow ?? undefined;

  if (state.kind === "trashed") {
    const { response } = await dialog.showMessageBox(parent!, {
      type: "warning",
      title: "Gryt is in the Trash",
      message: "Gryt is running from the Trash.",
      detail:
        "An AppImage is the app itself rather than an installer, so deleting it " +
        "leaves nothing to come back to. Signing in opens your browser, and the " +
        "browser hands you back to Gryt — which it cannot do from here.\n\n" +
        `Gryt can move itself to ${APPS_DIR} and carry on.`,
      buttons: ["Move Gryt and continue", "Sign in anyway", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });

    if (response === 2) return false;
    if (response === 1) return true;

    try {
      const restored = restoreFromTrash(state);
      /* Re-register against the new path straight away, so the handler is
         right before the browser is ever opened rather than on next launch. */
      ensureLinuxAppImageProtocolHandler(restored);
      startupLog(`Recovered AppImage from Trash to ${restored}`);

      await dialog.showMessageBox(parent!, {
        type: "info",
        title: "Gryt moved",
        message: `Gryt now lives in ${APPS_DIR}.`,
        detail:
          "Sign-in will work from here on. This copy is still the one that was " +
          "in the Trash, so launch Gryt from its new home next time rather than " +
          "from wherever you started it.",
        buttons: ["Sign in"],
        noLink: true,
      });
      return true;
    } catch (error) {
      startupLog(`Could not recover AppImage: ${error}`);
      await dialog.showMessageBox(parent!, {
        type: "error",
        title: "Could not move Gryt",
        message: "Gryt could not move itself out of the Trash.",
        detail:
          `Move ${state.trashedAt} to ${APPS_DIR} yourself, then start Gryt from ` +
          "there. Sign-in will work once it is running from a permanent home.",
        buttons: ["OK"],
        noLink: true,
      });
      return false;
    }
  }

  /* Gone, and not in the Trash. There is nothing to put back — say what is
     wrong and what fixes it, rather than offering a button that cannot work. */
  const { response } = await dialog.showMessageBox(parent!, {
    type: "warning",
    title: "Gryt has moved",
    message: "Gryt is not where it was when it started.",
    detail:
      `It was launched from ${state.path}, which is no longer there. An AppImage ` +
      "is the app itself rather than an installer, so moving or deleting it " +
      "breaks the link your browser uses to hand sign-in back.\n\n" +
      `Put the AppImage somewhere permanent — ${APPS_DIR} is a good home — and ` +
      "start Gryt from there.",
    buttons: ["Sign in anyway", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });

  return response === 0;
}

/** An AppImage was never installed, so nothing told xdg-mime about the scheme.
    Rewritten each run, so it follows a move. */
function ensureLinuxAppImageProtocolHandler(appImagePath: string): void {
  try {
    const home = app.getPath("home");
    const appsDir = join(home, ".local", "share", "applications");
    mkdirSync(appsDir, { recursive: true });

    // resourcesPath is inside the mount and changes every launch, so the icon is
    // copied somewhere stable. Cosmetic; a failure falls back to a theme name.
    let icon = "gryt-chat";
    try {
      const stableIcon = join(home, ".local", "share", "icons", "gryt-chat.png");
      mkdirSync(dirname(stableIcon), { recursive: true });
      copyFileSync(join(process.resourcesPath, "icon.png"), stableIcon);
      icon = stableIcon;
    } catch {
      // Leave `icon` as the theme name.
    }

    // %U passes the gryt:// URL through as an argument on launch.
    const entry =
      [
        "[Desktop Entry]",
        "Type=Application",
        "Name=Gryt Chat",
        `Exec=${appImagePath} %U`,
        `Icon=${icon}`,
        "Terminal=false",
        "Categories=Network;",
        "MimeType=x-scheme-handler/gryt;",
        // Handler-only: the AppImage has its own launcher entry, so keep this
        // one out of the app menu rather than showing a second "Gryt Chat".
        "NoDisplay=true",
      ].join("\n") + "\n";

    const desktopFile = join(appsDir, "gryt-chat.desktop");
    if (!existsSync(desktopFile) || readFileSync(desktopFile, "utf8") !== entry) {
      writeFileSync(desktopFile, entry);
    }

    /* execFile, not a shell, so a spaced path is never word-split. Best-effort,
       but the outcome is logged: a broken `xdg-mime` was silent before. */
    execFile("update-desktop-database", [appsDir], (error) => {
      if (error) startupLog(`update-desktop-database did not run: ${error.message}`);
    });

    execFile(
      "xdg-mime",
      ["default", "gryt-chat.desktop", "x-scheme-handler/gryt"],
      (error) => {
        /* This one is the association: without it the browser has nowhere to
           hand the sign-in callback. */
        if (error) {
          startupLog(`xdg-mime failed, so gryt:// is not associated: ${error.message}`);
        } else {
          startupLog(`Registered gryt:// handler at ${desktopFile}`);
        }
      }
    );

    /* Not "Registered": logged here it runs before either command returns, so
       the one artefact somebody reads was the thing lying to them. */
    startupLog(`Wrote gryt:// desktop entry at ${desktopFile}`);
  } catch (error) {
    startupLog(`Could not register gryt:// handler: ${error}`);
  }
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

/** The migration installer renames the old install aside. Reaching this means
    the replacement started, so the copy is no longer needed. */
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

/** electron-updater stages into a directory antivirus and disk cleaners empty,
    and a failed checksum there downloads every release and installs none. */
class WindowsUpdater extends NsisUpdater {
  protected override downloadedUpdateHelper: DownloadedUpdateHelper =
    new DownloadedUpdateHelper(app.getPath("sessionData"));
}

const autoUpdater =
  process.platform === "win32" ? new WindowsUpdater() : defaultAutoUpdater;

/** `process.windowsStore` is the only thing telling MSIX from NSIS, and the NSIS
    updater installs a second, unpackaged Gryt beside the packaged one. */
const updatesAreManagedByWindows = process.windowsStore === true;

autoUpdater.logger = {
  info: (m: unknown) => startupLog(`Update: ${String(m)}`),
  warn: (m: unknown) => startupLog(`Update WARN: ${String(m)}`),
  error: (m: unknown) => startupLog(`Update ERROR: ${String(m)}`),
  debug: (m: unknown) => startupLog(`Update debug: ${String(m)}`),
};

/* On, so taking an update is a restart rather than a download. A user-initiated
   check turns it off for its own length. */
autoUpdater.autoDownload = true;

// On for Windows too now that installer.nsh moves the old install aside: while
// it was off the PowerShell helper was the only route, and it did not parse.
autoUpdater.autoInstallOnAppQuit = !updatesAreManagedByWindows;

/** Off, the check still runs and still says a release exists; nothing is
    downloaded until somebody presses the button. */
let autoUpdateEnabled = readBoolConfig("autoUpdate", true);

/* Kept so it can be put back: a check somebody asked for swaps in an always-true
   one, or a machine id outside the slice hides the release. */
const defaultRolloutCheck = autoUpdater.isUserWithinRollout;

/** Only a `beta` identifier means beta, or `-rc.1` puts somebody on the channel
    silently. The variant lives in the update channel, not in the version. */
function isOnBetaChannel(): boolean {
  const identifiers = semver.prerelease(app.getVersion()) ?? [];
  return readBoolConfig("betaChannel", identifiers.includes("beta"));
}

/** Read off disk, because the missing `embedded-server.tar.gz` is what differs.
    check-extra-resources.mjs catches a full build that lost it. */
function isSlimInstall(): boolean {
  if (!app.isPackaged) return false;
  return !existsSync(join(process.resourcesPath, "embedded-server.tar.gz"));
}

/** Defaults to what was installed, so a first launch changes nothing. */
function prefersSlim(): boolean {
  return readBoolConfig("slimVariant", isSlimInstall());
}

/** Both variants share a release, so separate channel files stop a slim install
    downloading the full installer. Beta picks the release; this picks the file. */
function updateChannel(): string {
  return prefersSlim() ? "slim" : "latest";
}

autoUpdater.allowPrerelease = isOnBetaChannel();
autoUpdater.channel = updateChannel();

/** Derived, so it clears itself once the installer has run. */
function variantSwitchPending(): boolean {
  return app.isPackaged && prefersSlim() !== isSlimInstall();
}

/** electron-updater returns false on `eq(latest, current)` before it looks at
    the channel, so a variant switch is invisible without this. */
function applyVariantSwitchSpoof(): void {
  (autoUpdater as unknown as { currentVersion: semver.SemVer }).currentVersion =
    new semver.SemVer(variantSwitchPending() ? "0.0.0" : app.getVersion());
}

applyVariantSwitchSpoof();

autoUpdater.allowDowngrade = true;

// Do not overwrite autoUpdater.logger with console: the persistent startup log
// above is what lets update failures survive a restart.

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

/* No setAlwaysOnTop: it cleared the splash window, which is gone, and it is
   the part that lands on top of a fullscreen game (GRYT-1105). */
function showMain(): void {
  if (!mainWindow) return;

  mainWindow.show();
  mainWindow.focus();
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
  // Same name electron-updater derives from autoUpdater.channel, spelled out
  // here because this code reads the file before the updater does.
  const channel = updateChannel();
  if (process.platform === "darwin") return `${channel}-mac.yml`;
  if (process.platform === "win32") return `${channel}.yml`;
  return `${channel}-linux.yml`;
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

/** `path:` is the name electron-updater asks for, and nothing else in the yml
    names it: the three platforms spell it three different ways. */
function installerFileName(yml: string): string | null {
  const named = yml.match(/^path:\s*(.+)$/m);
  if (!named) return null;

  return named[1]
    .trim()
    .replace(/^["']|["']$/g, "");
}

/** Three runners upload over minutes, so a yml without its zip is a real state.
    One byte off the asset host proves the exact URL, for free. */
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

/** GitHub's asset host answers 501 to a multi-range request, and pinning the
    feed moves us to `generic`, which turns them on. */
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

/** Affordable at any interval, since this spends no API quota. An hour was long
    enough to miss a release while looking straight at the app. */
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;

/** Waking and focusing happen far more often than a release does. Stay below
    `UPDATE_CHECK_INTERVAL_MS`, or the timer cancels its own tick. */
const UPDATE_CHECK_FLOOR_MS = 5 * 60 * 1000;

/* Launch used to check before showing anything, which is what made starting
   Gryt on Windows take minutes. */
const LAUNCH_UPDATE_CHECK_DELAY_MS = 10 * 1000;

let updateCheckTimer: NodeJS.Timeout | null = null;
let lastUpdateCheckAt = 0;
let updateIsDownloaded = false;

/** The version already announced, so one release is toasted once per run. */
let announcedVersion: string | null = null;

/** Set only by the two download starters, so the update events can tell one
    nobody asked for from one somebody pressed a button for. */
let pendingRelease: ReleaseRef | null = null;

/** Whether `pendingRelease` should raise a toast when it starts downloading. */
let announceDownload = false;

/** `releases.atom`, not the API, which is 60 an hour per address. The feed lists
    drafts, so the asset check below is not optional. */
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

/** Puts the toast back for a version. `reannounce` says this was asked for, so
    it redraws over one that had been dismissed. */
function announceDownloaded(version?: string): void {
  if (!version) return;

  announcedVersion = version;

  sendToMain("announced", {
    version,
    from: app.getVersion(),
    autoDownload: true,
    reannounce: true,
  });

  /* Two messages rather than a field: the renderer already turns `downloaded`
     into the restart prompt, and one route cannot drift. */
  if (updateIsDownloaded) {
    sendToMain("downloaded", { version });
  }
}

function checkForUpdatesInBackground(
  reason: string,
  force = false
): void {
  /* MSIX, where there is nothing useful to do. Logged rather than dropped: a
     check reporting nothing is the same shape as a broken one. */
  if (updatesAreManagedByWindows) {
    startupLog(`Update: skipped (${reason}) — installed from the MSIX package`);
    return;
  }

  /* Already downloaded, so the answer cannot change until a restart: re-checking
     while Squirrel holds a staged update wedges the install. */
  if (updateIsDownloaded) {
    if (force) announceDownloaded(pendingUpdateVersion);
    return;
  }

  /* electron-updater has one download slot, so a release published mid-flight
     would start a second check over the top of this one. */
  if (pendingRelease) {
    if (force) {
      sendToMain("downloading", {
        version: pendingRelease.version,
      });
    }
    return;
  }

  /* A pressed button goes through regardless: sharing this floor with the launch
     check made Check for Updates do nothing for the first fifteen minutes. */
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
        /* Told, not fetched: the toast's button calls `download-update`, which is
           this release with the rollout bypassed. */
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

/** Pinned to the verified tag, since the provider hands back releases that are
    halfway up. `announce` decides whether a toast is raised. */
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

/** Called once from `initBackgroundUpdater`, the one place both non-dev launch
    paths pass through and dev passes through neither. */
function startPeriodicUpdateChecks(launchAlreadyChecked: boolean): void {
  if (updateCheckTimer) return;

  /* Only when launch really did check: seeding otherwise makes the floor swallow
     the launch check that replaces it, leaving the first look an hour away. */
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

/** `check-for-updates` turns downloading off and bypasses the rollout slice, and
    every path out of a check comes through the three events below. */
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

    /* The first honest moment: the slice let this machine through, the assets
       are there, and a fetch is about to start. */
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
    /* Held back by the rollout slice, since the probe found the release. Being
       quiet is the whole point of staging. */
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

    /* A finished download that has not been announced gets announced: raising it
       only for automatic ones lost the toast the moment somebody navigated away. */
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
    /* Let the next check try this release again: the probe skips a version it
       has announced, so one dropped connection would end it until a restart. */
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

/** The flag first: `quitAndInstall` skips `before-quit`, so an open window
    cancels the quit and hides, and Squirrel cannot swap the bundle. */
function installDownloadedUpdate(): void {
  isQuitting = true;
  autoUpdater.quitAndInstall(true, true);
}

/** With automatic updates off the check announces and stops, and this is what
    the button reaches. Re-probes, since a toast may be hours old. */
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

/** Not an update path: switching release channel needs a fresh process to pick
    the new feed up, and that is all this does. */
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

// This server is the renderer's origin, and Keycloak's gryt-web client accepts
// only this one. Another port serves a window that cannot sign in. GRYT-1057.
const AUTH_ORIGIN_PORT = 15738;

/** Attempts before giving up on the port, and the gap between them. */
const PORT_RETRIES = 5;
const PORT_RETRY_MS = 300;

export class AuthPortUnavailableError extends Error {
  constructor(readonly port: number) {
    super(
      `Port ${port} is already in use. Gryt has to serve itself on this exact ` +
        `port for signing in to work, so it cannot start on another one.`
    );
    this.name = "AuthPortUnavailableError";
  }
}

async function startLocalServer(): Promise<string> {
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

  // Retried rather than swapped for another port. The usual holder is a copy of
  // Gryt that has not finished exiting, and that clears in well under a second.
  for (
    let attempt = 1;
    attempt <= PORT_RETRIES;
    attempt++
  ) {
    try {
      return await tryListen(
        AUTH_ORIGIN_PORT
      );
    } catch (err) {
      const code = (
        err as NodeJS.ErrnoException
      ).code;

      if (code !== "EADDRINUSE") {
        throw err;
      }

      if (attempt === PORT_RETRIES) {
        throw new AuthPortUnavailableError(
          AUTH_ORIGIN_PORT
        );
      }

      startupLog(
        `Port ${AUTH_ORIGIN_PORT} in use, retrying (${attempt}/${PORT_RETRIES})`
      );

      await new Promise((r) =>
        setTimeout(r, PORT_RETRY_MS)
      );
    }
  }

  throw new AuthPortUnavailableError(
    AUTH_ORIGIN_PORT
  );
}

// ── Main window ─────────────────────────────────────────────────────────

/** Has to match TITLEBAR_HEIGHT in src/components/titlebar.tsx: the two halves
    sit side by side, so a disagreement is a step in the titlebar. */
const TITLEBAR_OVERLAY_HEIGHT = 36;

// Desktops that place windows themselves, where Electron's minimise and maximise
// do nothing. XDG_CURRENT_DESKTOP is a colon-separated list by spec. GRYT-1060.
const NO_WINDOW_CHROME_FLAG = "--gryt-no-window-chrome";

const TILING_DESKTOPS = new Set([
  "hyprland",
  "sway",
  "i3",
  "river",
  "niri",
  "bspwm",
  "awesome",
  "dwm",
  "xmonad",
  "qtile",
  "wayfire",
]);

function drawsWindowButtons(): boolean {
  if (process.platform !== "linux") return true;

  return !(process.env.XDG_CURRENT_DESKTOP ?? "")
    .toLowerCase()
    .split(":")
    .some((name) => TILING_DESKTOPS.has(name.trim()));
}

function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 300,
    minHeight: 300,
    show: false,

    titleBarStyle: "hidden",

    // What the window opens with, before the renderer sends the real values.
    // The shipped dark palette's tokens, so the default theme sees no change.
    ...(drawsWindowButtons()
      ? {
          titleBarOverlay: {
            color: "#111318",
            symbolColor: "#e0e0e6",
            height: TITLEBAR_OVERLAY_HEIGHT,
          },
        }
      : {}),

    icon: appIcon,

    backgroundColor: "#111318",

    webPreferences: {
      preload: join(
        __dirname,
        "preload.cjs"
      ),
      // Read off argv in preload rather than fetched over IPC: the titlebar has
      // to know before its first paint, or it renders and then vanishes.
      additionalArguments: drawsWindowButtons()
        ? []
        : [NO_WINDOW_CHROME_FLAG],
      contextIsolation: true,
      nodeIntegration: false,
      // The idle default only; a call turns it off. See setRendererThrottling.
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

  /* Here rather than at app start, since a match only reaches a renderer. Once,
     or a second window means two pollers asking the same question. */
  if (!processWatcher) {
    processWatcher = createProcessWatcher({
      onChange: (running) => {
        mainWindow?.webContents.send("processes-changed", running);
      },
    });
    processWatcher.watch(
      processScanAllowed()
        ? readWatchList(loadGlobalStore()["watchedPrograms"])
        : [],
    );
  }

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

    /* The cheapest signal that somebody is here. The floor keeps alt-tabbing
       free at one check every five minutes. */
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

/** Keeps key repeat from firing twice, and lets a release be matched after the
    modifiers were let go. */
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

/** A release ignores modifiers: letting go of Shift first is normal, and an
    exact match would leave the microphone open. */
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
  // Left and right are not bindable, which keeps ordinary clicking out.
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
 * A hidden window's timers fall to roughly one a minute, which starves the voice
 * engine's 15s keep-alive and its dropped-socket check. Off for a call only.
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
      // macOS will not prompt for getUserMedia alone, so without this the renderer
      // gets NotAllowedError forever. Safe every launch; a decision sticks.
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
        // It returns early when there is no archive, which is every slim build,
        // and saying "ready" sends somebody looking for a runtime that is not there.
        startupLog(
          isSlimInstall()
            ? "Embedded server runtime: not in this build"
            : "Embedded server runtime ready"
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
        "get-slim-variant",
        () => ({
          /** What they have asked for. */
          preferred: prefersSlim(),
          /** What is actually on disk right now. */
          installed: isSlimInstall(),
          /** Asked for one thing, running the other. */
          pending: variantSwitchPending(),
        })
      );

      /* No relaunch: channel and version are properties, and the check that
         follows is what the person is waiting for. */
      ipcMain.on(
        "set-slim-variant",
        (_event, slim: boolean) => {
          writeConfig({
            slimVariant: slim,
          });

          autoUpdater.channel = updateChannel();
          applyVariantSwitchSpoof();

          void autoUpdater.checkForUpdates().catch(() => {
            /* The renderer hears about failures through update-status; a
               rejection here is the same event twice. */
          });
        }
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

          /* Turning it back on should not mean waiting for the next tick. Off
             cancels nothing running: there is no cancel that leaves a cache. */
          if (enabled) {
            lastUpdateCheckAt = 0;
            announcedVersion = null;

            checkForUpdatesInBackground("setting");
          }
        }
      );

      /* The list is per machine rather than per user, since it names executables.
         Only `listRunningPrograms` hands over what is open, on demand. */

      /* Gated here, not only in the panel, which used to read every running
         process from an effect on mount. GRYT-1063. */
      ipcMain.handle("processes-list-running", () =>
        processScanAllowed() ? listRunningPrograms() : [],
      );

      ipcMain.handle("processes-get-consent", () => readScanConsent());

      /* Withdrawing takes the list with it. Emptying the list already stops the
         watcher, so this is the same off switch under one name. */
      ipcMain.handle("processes-set-consent", (_event, allow: unknown) => {
        if (allow === true) {
          const at = new Date().toISOString();
          setGlobalValue("processScanConsent", at);
          return at;
        }

        setGlobalValue("processScanConsent", null);
        setGlobalValue("watchedPrograms", []);
        processWatcher?.watch([]);
        return null;
      });

      ipcMain.handle("processes-get-watched", () =>
        readWatchList(loadGlobalStore()["watchedPrograms"]),
      );

      ipcMain.handle(
        "processes-set-watched",
        (_event, programs: unknown) => {
          const list = readWatchList(programs);
          setGlobalValue("watchedPrograms", list);
          processWatcher?.watch(list);
          return list;
        },
      );

      /** What is running right now, out of the list. Never the whole list. */
      ipcMain.handle("processes-running", () => processWatcher?.current() ?? []);

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

      /** The OS draws these, so the stylesheet cannot reach them. Resolved
          colours, since only the renderer reads the variables. Not macOS. */
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

          // Electron throws on a colour it cannot parse, and a theme in the
          // renderer could carry oklch or a colour name.
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

      // On open rather than on a timer: a check that only runs when somebody is
      // looking cannot spend a rate limit in the background.
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
        try {
          localServerUrl =
            await startLocalServer();
        } catch (err) {
          // Said here rather than left to fail later. Carrying on without the
          // port produces a window that opens, looks right and cannot sign in.
          if (
            err instanceof
            AuthPortUnavailableError
          ) {
            dialog.showErrorBox(
              "Gryt is already running",
              `${err.message}\n\nClose the other copy of Gryt and open it ` +
                `again. If none is open, something else on this machine is ` +
                `using port ${err.port}.`
            );

            app.quit();
            return;
          }

          throw err;
        }

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
        /* Open the window and look for updates behind it: a second path used to
           relaunch into a splash and download before showing anything. */

        /* Waited for: an empty frame that fills in a second later just moves the
           wait somewhere more visible. createMainWindow has a 20s fallback. */
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

        /* Late enough to be out of the way, early enough that somebody who opens
           Gryt and closes it still hears about a release. */
        setTimeout(
          () => checkForUpdatesInBackground("launch"),
          LAUNCH_UPDATE_CHECK_DELAY_MS
        );
      }

      /** After the startup branching on purpose: a process that quits to install
          another update never reaches here, and a healthy one does. */
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
                /* Wayland can return nothing, and calling back with an undefined
                   source fails the request silently. */
                if (sources.length === 0) {
                  console.warn(
                    "[screen] no capture sources; session is",
                    process.env.XDG_SESSION_TYPE ?? "unknown"
                  );
                  callback({});
                  return;
                }

                callback({
                  video: sources[0],
                  /* Windows only: elsewhere it is a second capture request, and
                     under xdg-desktop-portal a second permission dialog. */
                  ...(process.platform === "win32"
                    ? { audio: "loopback" as const }
                    : {}),
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
          /* Sign-in comes back through `gryt://`, so a moved AppImage makes this
             one-way. Asked here, since at startup the handler is fresh. */
          void warnIfAppImageMoved().then((proceed) => {
            if (proceed) shell.openExternal(url);
          });
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

          /* Somebody asked, so report rather than fetch and let them past the
             rollout slice. Both restored on the first event, failure included. */
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

      /* The toast is React state and the announcement a one-shot message, so a
         reload cleared it for good. The renderer asks on mount instead. */
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

          /* Asked for before there is anything to install, so start the download
             rather than restart into nothing. */
          downloadAnnouncedRelease();
        }
      );

      // uiohook is missing on some Linux setups and needs Accessibility on macOS,
      // so the renderer falls back to its own window listeners.
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

      /* `silent` always, since the app plays its own sound from the same event.
         The icon is explicit because an unregistered AppImage has no entry. */
      ipcMain.on(
        "show-notification",
        (
          _event,
          payload: { title?: string; body?: string }
        ) => {
          if (!Notification.isSupported()) return;
          if (!payload?.title) return;

          const notification = new Notification({
            title: payload.title,
            body: payload.body || "",
            icon: appIcon,
            silent: true,
          });

          notification.on("click", () => {
            if (!mainWindow) return;
            if (!mainWindow.isVisible()) mainWindow.show();
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
          });

          notification.show();
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
