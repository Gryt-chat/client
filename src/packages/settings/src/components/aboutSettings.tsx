import { AlertDialog, Badge, Button, Card, Flex, Heading, Link, Progress, Separator, Switch, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
import { FaGithub } from "react-icons/fa";
import {
  MdCancel,
  MdCheckCircle,
  MdDesktopWindows,
  MdDownload,
  MdFeedback,
  MdOpenInNew,
  MdRefresh,
  MdUpdate,
} from "react-icons/md";

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

  const statusText = (() => {
    if (!status) return null;
    switch (status.status) {
      case "checking":
        return "Checking for updates…";
      case "available":
      case "downloading":
        return `Downloading v${status.version}… ${status.percent != null ? `${status.percent}%` : ""}`;
      case "downloaded":
        return `v${status.version} will be installed on next restart`;
      case "not-available":
        return "You're on the latest version";
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
        return "green" as const;
      case "error":
        return "red" as const;
      default:
        return "gray" as const;
    }
  })();

  const isChecking = status?.status === "checking";
  const isDownloading = status?.status === "downloading";
  const isReady = status?.status === "downloaded";
  const isBusy = isChecking || isDownloading;

  return (
    <>
      <Separator size="4" />

      <Heading size="3">Updates</Heading>

      <Flex direction="column" gap="4">
        <Flex align="center" gap="3">
          <Text size="2" weight="medium">Current version</Text>
          <Badge variant="soft" color="gray">v{appVersion}</Badge>
          {betaChannel && <Badge variant="soft" color="orange">Beta</Badge>}
        </Flex>

        <Flex align="center" justify="between">
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">
              {betaChannel ? "Beta channel" : "Stable channel"}
            </Text>
            <Text size="1" color="gray">
              {betaChannel
                ? "You are receiving early beta releases. Toggle to switch back to stable."
                : "Toggle to switch to the beta channel for early releases."}
            </Text>
          </Flex>
          <Switch checked={betaChannel} onCheckedChange={(enabled) => setPendingSwitch(enabled)} />
        </Flex>

        {statusText && (
          <Flex direction="column" gap="1">
            <Flex align="center" gap="2">
              {isReady && <MdUpdate size={16} color="var(--green-9)" />}
              {status?.status === "not-available" && <MdCheckCircle size={16} color="var(--green-9)" />}
              {status?.status === "error" && <MdCancel size={16} color="var(--red-9)" />}
              <Text size="2" color={statusColor}>{statusText}</Text>
            </Flex>
            {status?.status === "error" && (
              <Text size="1" color="gray">
                This often happens right after a new version is released. Wait a few minutes and try again.
              </Text>
            )}
          </Flex>
        )}

        {isDownloading && status?.percent != null && (
          <Progress value={status.percent} size="2" />
        )}

        <Button
          variant="soft"
          onClick={handleCheckForUpdates}
          disabled={isBusy}
          style={{ alignSelf: "flex-start" }}
        >
          <MdRefresh size={16} />
          {isChecking ? "Checking…" : "Check for Updates"}
        </Button>
      </Flex>

      <AlertDialog.Root open={pendingSwitch !== null} onOpenChange={(open) => { if (!open) setPendingSwitch(null); }}>
        <AlertDialog.Content maxWidth="480px">
          <AlertDialog.Title>
            Switch to {switchingToBeta ? "beta" : "stable"} channel?
          </AlertDialog.Title>
          <AlertDialog.Description size="2">
            {switchingToBeta
              ? "The app will restart and download the latest beta release. Beta builds may contain bugs or incomplete features."
              : "The app will restart and download the latest stable release. You will no longer receive beta updates."}
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
                Switch & Restart
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
            <MdDesktopWindows size={18} />
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
              <MdDownload size={16} />
              Download Gryt Desktop
              <MdOpenInNew size={14} />
            </a>
          </Button>
        </Flex>
      </Card>
    </>
  );
}

export function AboutSettings() {
  const inElectron = isElectron();

  return (
    <SettingsContainer>
      <Heading size="4">About</Heading>

      <Flex direction="column" gap="1">
        <Text size="5" weight="bold">Gryt</Text>
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
            <MdFeedback size={16} />
            Give feedback
          </a>
        </Button>
      </Flex>

      {inElectron ? <UpdateControls /> : <DesktopAppCard />}
    </SettingsContainer>
  );
}
