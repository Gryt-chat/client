import { AlertDialog, Badge, Button, Card, Flex, Heading, Link, Separator, Switch, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
import { FaGithub } from "react-icons/fa";
import { PiArrowsClockwiseFill, PiArrowSquareOutFill, PiChatCircleDotsFill, PiCheckCircleFill, PiClockClockwiseFill, PiDesktopFill, PiDownloadSimpleFill, PiXCircleFill } from "react-icons/pi";

import { Wordmark } from "@/common";

import { getElectronAPI, isElectron, UpdateStatus } from "../../../../lib/electron";
import { SettingsContainer } from "./settingsComponents";

const GITHUB_URL = "https://github.com/Gryt-chat/gryt";
const FEEDBACK_URL = "https://feedback.gryt.chat";
const RELEASES_URL = `${GITHUB_URL}/releases/latest`;

function UpdateControls() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [appVersion, setAppVersion] = useState<string>("…");
  const [betaChannel, setBetaChannel] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<boolean | null>(null);

  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;

    api.getAppVersion().then(setAppVersion);
    api.getBetaChannel().then(setBetaChannel);
    return api.onUpdateStatus(setStatus);
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
      <Separator size="4" />

      <Heading size="3">Updates</Heading>

      <Flex direction="column" gap="4">
        <Flex align="center" gap="3">
          <Text size="2" weight="medium">Running</Text>
          <Badge variant="soft" color="gray">v{appVersion}</Badge>
          {betaChannel && <Badge variant="soft" color="orange">Beta</Badge>}
        </Flex>

        <Flex align="center" justify="between">
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">Beta releases</Text>
            <Text size="1" color="gray">
              {betaChannel
                ? "You get new versions early. They break more often."
                : "Get new versions early, before they have been tested as much."}
            </Text>
          </Flex>
          <Switch checked={betaChannel} onCheckedChange={(enabled) => setPendingSwitch(enabled)} />
        </Flex>

        {/* Something is always said here. The panel used to lead with a version
            badge and show nothing else until a check finished, so a version
            that had not moved was the only thing to read, and it reads as
            failure. It cannot move without a restart: updates install while
            Gryt starts, never from the running app. */}
        {!statusText && (
          <Text size="1" color="gray">
            Updates install while Gryt starts, so the version above only changes
            after a restart.
          </Text>
        )}

        {statusText && (
          <Flex direction="column" gap="1">
            <Flex align="center" gap="2">
              {isReady && <PiClockClockwiseFill size={16} color="var(--green-9)" />}
              {status?.status === "not-available" && <PiCheckCircleFill size={16} color="var(--green-9)" />}
              {status?.status === "error" && <PiXCircleFill size={16} color="var(--red-9)" />}
              <Text size="2" color={statusColor}>{statusText}</Text>
            </Flex>
            {status?.status === "error" && (
              <Text size="1" color="gray">
                This often happens right after a new version is released. Wait a few minutes and try again.
              </Text>
            )}
          </Flex>
        )}

        <Flex gap="2" wrap="wrap">
          {!isAvailable && !isReady && !isPending && (
            <Button
              variant="soft"
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
            <Button variant="solid" color="green" onClick={handleUpdateNow}>
              <PiClockClockwiseFill size={16} />
              Restart and update to v{status?.version}
            </Button>
          )}
        </Flex>
      </Flex>

      <AlertDialog.Root open={pendingSwitch !== null} onOpenChange={(open) => { if (!open) setPendingSwitch(null); }}>
        <AlertDialog.Content maxWidth="480px">
          <AlertDialog.Title>
            {switchingToBeta ? "Turn on beta releases?" : "Turn off beta releases?"}
          </AlertDialog.Title>
          <AlertDialog.Description size="2">
            {switchingToBeta
              ? "Gryt will close and reopen to install the latest beta. Beta builds can have bugs and unfinished features."
              : "Gryt will close and reopen to install the latest stable version. That is older than the beta you are on now, so anything added since will be gone until it reaches stable."}
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                variant="solid"
                color={switchingToBeta ? "orange" : "blue"}
                onClick={confirmChannelSwitch}
              >
                {switchingToBeta ? "Turn on beta" : "Turn off beta"}
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}

function DesktopAppCard() {
  return (
    <>
      <Separator size="4" />

      <Card size="2">
        <Flex direction="column" gap="3">
          <Flex align="center" gap="2">
            <PiDesktopFill size={18} />
            <Text size="3" weight="medium">Get the desktop app</Text>
          </Flex>
          <Text size="2" color="gray">
            The desktop app includes auto-updates, system tray integration,
            push-to-talk hotkeys, and native notifications.
          </Text>
          <Text size="2" color="gray">
            Available for Windows, macOS, and Linux.
          </Text>
          <Button variant="solid" size="2" asChild>
            <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
              <PiDownloadSimpleFill size={16} />
              Download Gryt Desktop
              <PiArrowSquareOutFill size={14} />
            </a>
          </Button>
        </Flex>
      </Card>
    </>
  );
}

export function AboutSettings() {
  return (
    <SettingsContainer>
      <Heading size="4">About</Heading>

      <Flex direction="column" gap="1">
        <Wordmark size="5" />
        <Text size="2" color="gray" style={{ fontFamily: "var(--code-font-family)" }}>
          v{__APP_VERSION__}
        </Text>
      </Flex>

      <Flex direction="column" gap="1">
        <Text size="1" color="gray">&copy; 2022–2026 Sivert Gullberg Hansen</Text>
        <Text size="1" color="gray">
          Licensed under{" "}
          <Link
            href={`${GITHUB_URL}/blob/main/LICENSE`}
            target="_blank"
            rel="noopener noreferrer"
          >
            AGPL-3.0-or-later
          </Link>
        </Text>
      </Flex>

      <Flex gap="3" wrap="wrap">
        <Button variant="soft" color="gray" asChild>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <FaGithub size={16} />
            GitHub
          </a>
        </Button>
        <Button variant="soft" color="gray" asChild>
          <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
            <PiChatCircleDotsFill size={16} />
            Give feedback
          </a>
        </Button>
      </Flex>

    </SettingsContainer>
  );
}

/**
 * Updates as a destination of its own, first in the sidebar.
 *
 * It used to sit at the bottom of About, which is where you look last. Checking
 * for an update is something people come to settings to do deliberately, so it
 * gets its own entry rather than being reference material's footer.
 *
 * In the browser there is no updater, so this offers the desktop app instead —
 * the same swap About was already making.
 */
export function UpdatesSettings() {
  const inElectron = isElectron();

  return (
    <SettingsContainer>
      {inElectron ? <UpdateControls /> : <DesktopAppCard />}
    </SettingsContainer>
  );
}
