import { AlertDialog, Button, Chip, Divider, Surface, Switch } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";

import { Wordmark } from "@/common";

import { FaGithub } from "../../../../lib/brandIcons";
import { getElectronAPI, isElectron, UpdateStatus } from "../../../../lib/electron";
import { PiArrowsClockwiseFill, PiArrowSquareOutFill, PiBugFill, PiChatCircleDotsFill, PiCheckCircleFill, PiClockClockwiseFill, PiDesktopFill, PiDownloadSimpleFill, PiXCircleFill } from "../../../../lib/icons";
import { useReportForm } from "../../../../lib/reports/useReportForm";
import { SettingsContainer } from "./settingsComponents";

const GITHUB_URL = "https://github.com/Gryt-chat/gryt";

/* Both stores want these reachable from inside the app rather than only from
   the listing, and the desktop build has no listing to fall back on at all.
   GRYT-829. */
const TERMS_URL = "https://gryt.chat/terms";
const PRIVACY_URL = "https://gryt.chat/privacy";

/*
 * "Get the desktop app" sent people to GitHub Releases, which is release notes
 * above a collapsed Assets list of a dozen files across three platforms. The
 * reader of that card has asked for the app, not for a file.
 *
 * /download resolves the build for them and starts it. No ?os= here, unlike the
 * server's reminder, because this card only renders in the browser build and
 * the user agent is the right answer.
 */
const DOWNLOAD_URL = "https://gryt.chat/download";

function UpdateControls() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [appVersion, setAppVersion] = useState<string>("…");
  const [betaChannel, setBetaChannel] = useState(false);
  const [slimVariant, setSlimVariant] = useState({ preferred: false, installed: false, pending: false });
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [pendingSwitch, setPendingSwitch] = useState<boolean | null>(null);

  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;

    api.getAppVersion().then(setAppVersion);
    api.getBetaChannel().then(setBetaChannel);
    /* Absent on builds older than the setting, which read as the full variant
       — true of every build before this one. */
    api.getSlimVariant?.().then(setSlimVariant);
    api.getAutoUpdate().then(setAutoUpdate);
    return api.onUpdateStatus(setStatus);
  }, []);

  const handleAutoUpdateToggle = useCallback((enabled: boolean) => {
    setAutoUpdate(enabled);
    getElectronAPI()?.setAutoUpdate(enabled);
  }, []);

  const handleCheckForUpdates = useCallback(() => {
    getElectronAPI()?.checkForUpdates();
  }, []);

  const confirmChannelSwitch = useCallback(() => {
    if (pendingSwitch === null) return;
    getElectronAPI()?.switchUpdateChannel(pendingSwitch);
  }, [pendingSwitch]);

  const switchingToBeta = pendingSwitch === true;

  const handleUpdateNow = useCallback(() => {
    getElectronAPI()?.restartForUpdate();
  }, []);

  const statusText = (() => {
    if (!status) return null;
    switch (status.status) {
      case "checking":
        return "Checking for updates…";
      case "available":
        return `Update v${status.version} is available`;
      case "downloading":
        return `Downloading v${status.version}… ${status.percent != null ? `${status.percent}%` : ""}`;
      case "downloaded":
        return `v${status.version} is ready to install`;
      case "not-available":
        return "Gryt is up to date";
      case "pending":
        return `v${status.version} will finish installing when you quit Gryt`;
      case "error":
        return `Update error: ${status.message}`;
      default:
        return null;
    }
  })();

  const statusColor = (() => {
    if (!status) return "gray" as const;
    switch (status.status) {
      case "available":
      case "downloading":
        return "blue" as const;
      case "downloaded":
      case "pending":
        return "green" as const;
      case "error":
        return "red" as const;
      default:
        return "gray" as const;
    }
  })();

  const isChecking = status?.status === "checking";
  const isAvailable = status?.status === "available";
  // "downloaded" can still arrive from a check that ran before this build's
  // change landed, or from the splash on a previous launch. Treat it the same
  // as "available": either way the answer is to restart.
  const isReady = status?.status === "downloaded";
  // Neither button helps while an install is already running. Restarting would
  // start a second update cycle and destroy the first, and checking again can
  // only report the same thing. Quitting is the whole remaining action, and the
  // status line says so.
  const isPending = status?.status === "pending";
  const isBusy = isChecking;

  return (
    <>
      <Divider />

      <h2>Updates</h2>

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="font-medium">Running</span>
          <Chip tone="neutral">v{appVersion}</Chip>
          {betaChannel && <Chip tone="warning" label="Beta" />}
          {/* What is installed, not what has been asked for. A pending switch
              is described by the toggle below; this chip answers "which build
              am I running right now", and until the installer has run the
              answer has not changed. */}
          {slimVariant.installed && <Chip tone="neutral" label="Slim" />}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="font-medium">Automatic updates</span>
            <span className="text-gryt-muted">
              {autoUpdate
                ? "Gryt downloads new versions in the background and installs them when you quit."
                : "Gryt tells you about a new version and waits for you to start it."}
            </span>
          </div>
          <Switch checked={autoUpdate} onCheckedChange={handleAutoUpdateToggle} />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="font-medium">Built-in server</span>
            <span className="text-gryt-muted">
              {slimVariant.pending
                ? slimVariant.preferred
                  ? "Switching to the build without it. Install the update below to finish."
                  : "Switching to the build with it. Install the update below to finish."
                : slimVariant.preferred
                  ? "Off. The download is about 34MB smaller, and you cannot host a server from the app."
                  : "On. You can host a server from this app. It makes the download about 34MB bigger."}
            </span>
            <span className="text-gryt-muted">
              Servers you already host stay where they are either way — their data does not
              live in the app.
            </span>
          </div>
          <Switch
            checked={!slimVariant.preferred}
            onCheckedChange={(enabled) => {
              window.electronAPI?.setSlimVariant?.(!enabled);
              setSlimVariant((prev) => ({ ...prev, preferred: !enabled, pending: !enabled !== prev.installed }));
            }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="font-medium">Beta releases</span>
            <span className="text-gryt-muted">
              {betaChannel
                ? "You get new versions early. They break more often."
                : "Get new versions early, before they have been tested as much."}
            </span>
          </div>
          <Switch checked={betaChannel} onCheckedChange={(enabled) => setPendingSwitch(enabled)} />
        </div>

        {/* Something is always said here. The panel used to lead with a version
            badge and show nothing else until a check finished, so a version
            that had not moved was the only thing to read, and it reads as
            failure. It cannot move without a restart: updates install while
            Gryt starts, never from the running app. */}
        {!statusText && (
          <span className="text-gryt-muted">
            Updates install while Gryt starts, so the version above only changes
            after a restart.
          </span>
        )}

        {statusText && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              {isReady && <PiClockClockwiseFill size={16} color="var(--gryt-success-9)" />}
              {status?.status === "not-available" && <PiCheckCircleFill size={16} color="var(--gryt-success-9)" />}
              {status?.status === "error" && <PiXCircleFill size={16} color="var(--gryt-danger-9)" />}
              <span color={statusColor}>{statusText}</span>
            </div>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          {!isAvailable && !isReady && !isPending && (
            <Button tone="neutral" size="small"
              onClick={handleCheckForUpdates}
              disabled={isBusy}
            >
              <PiArrowsClockwiseFill size={16} />
              {isChecking ? "Checking…" : "Check for Updates"}
            </Button>
          )}

          {/* One step. Downloading and installing both happen on the next
              launch, where the installer has an empty app to work around
              instead of a loaded one. */}
          {(isAvailable || isReady) && !isPending && (
            <Button size="small"
              className="bg-gryt-success text-gryt-bg hover:not-data-disabled:bg-gryt-success/85"
              onClick={handleUpdateNow}
            >
              <PiClockClockwiseFill size={16} />
              Restart and update to v{status?.version}
            </Button>
          )}
        </div>
      </div>

      <AlertDialog.Root open={pendingSwitch !== null} onOpenChange={(open) => { if (!open) setPendingSwitch(null); }}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop />
          <AlertDialog.Popup>
          <AlertDialog.Title>
            {switchingToBeta ? "Turn on beta releases?" : "Turn off beta releases?"}
          </AlertDialog.Title>
          <AlertDialog.Description>
            {switchingToBeta
              ? "Gryt will close and reopen to install the latest beta. Beta builds can have bugs and unfinished features."
              : "Gryt will close and reopen to install the latest stable version. That is older than the beta you are on now, so anything added since will be gone until it reaches stable."}
          </AlertDialog.Description>
          <div className="flex gap-3 mt-4 justify-end">
            <AlertDialog.Close
              render={
                <Button tone="neutral" size="small">Cancel</Button>
              }
            />
            <AlertDialog.Close
              render={
                <Button size="small"
                  onClick={confirmChannelSwitch}
                >
                  {switchingToBeta ? "Turn on beta" : "Turn off beta"}
                </Button>
              }
            />
          </div>
        </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

function DesktopAppCard() {
  return (
    <>
      <Divider />

      <Surface>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <PiDesktopFill size={18} />
            <span className="font-medium">Get the desktop app</span>
          </div>
          <span className="text-gryt-muted">
            The desktop app includes auto-updates, system tray integration,
            push-to-talk hotkeys, and native notifications.
          </span>
          <span className="text-gryt-muted">
            Available for Windows, macOS, and Linux.
          </span>
          <Button size="small"
            render={
              <a href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" />
            }
          >
            <PiDownloadSimpleFill size={16} />
            Download Gryt Desktop
            <PiArrowSquareOutFill size={14} />
          </Button>
        </div>
      </Surface>
    </>
  );
}

export function AboutSettings() {
  const { open: openReport } = useReportForm();

  return (
    <SettingsContainer>
      <h2>About</h2>

      <div className="flex flex-col gap-1">
        <Wordmark size="5" />
        <span className="text-gryt-muted" style={{ fontFamily: "var(--code-font-family)" }}>
          v{__APP_VERSION__}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-gryt-muted">&copy; 2022–2026 Sivert Gullberg Hansen</span>
        <span className="text-gryt-muted">
          Licensed under{" "}
          <a
            className="text-gryt-accent underline-offset-2 hover:underline"
            href={`${GITHUB_URL}/blob/main/LICENSE`}
            target="_blank"
            rel="noopener noreferrer"
          >
            AGPL-3.0-or-later
          </a>
        </span>
        {/* Beside the licence rather than as buttons below. These are the same
            kind of thing — the terms you are already under — and neither is
            something somebody came to this panel to do. */}
        <span className="text-gryt-muted">
          <a
            className="text-gryt-accent underline-offset-2 hover:underline"
            href={TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Terms of use
          </a>
          {" · "}
          <a
            className="text-gryt-accent underline-offset-2 hover:underline"
            href={PRIVACY_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Privacy policy
          </a>
        </span>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Button size="small"
          tone="neutral"
          render={
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" />
          }
        >
          <FaGithub size={16} />
          GitHub
        </Button>
        {/* In the app rather than out to a browser. It used to open the Fider
            board, which asks for a sign-in before it will take a sentence —
            and Fider is for public feature requests people vote on, which is
            not what most of what arrived there was. */}
        <Button size="small" tone="neutral" onClick={() => openReport("feedback")}>
          <PiChatCircleDotsFill size={16} />
          Give feedback
        </Button>
        <Button size="small" tone="neutral" onClick={() => openReport("bug")}>
          <PiBugFill size={16} />
          Report a bug
        </Button>
      </div>

    </SettingsContainer>
  );
}

/**
 * Updates as a destination of its own, first in the sidebar.
 *
 * It used to sit at the bottom of About, which is where you look last. Checking
 * for an update is something people come to settings to do deliberately.
 *
 * In the browser there is no updater, so this offers the desktop app instead.
 */
export function UpdatesSettings() {
  const inElectron = isElectron();

  return (
    <SettingsContainer>
      {inElectron ? <UpdateControls /> : <DesktopAppCard />}
    </SettingsContainer>
  );
}
