import { Badge, Box, Button, Card, Flex, Heading, Link, Progress, Separator, Switch, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
import {
  MdCancel,
  MdCheckCircle,
  MdDesktopWindows,
  MdDownload,
  MdFeedback,
  MdOpenInNew,
  MdRefresh,
} from "react-icons/md";
import { FaGithub } from "react-icons/fa";

import { getElectronAPI, isElectron, UpdateStatus } from "../../../../lib/electron";
import { SettingsContainer } from "./settingsComponents";

const GITHUB_URL = "https://github.com/Gryt-chat/gryt";
const FEEDBACK_URL = "https://feedback.gryt.chat";
const RELEASES_URL = `${GITHUB_URL}/releases/latest`;

function UpdateControls() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [appVersion, setAppVersion] = useState<string>("…");
  const [betaChannel, setBetaChannel] = useState(false);

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

  const handleInstallUpdate = useCallback(() => {
    getElectronAPI()?.installUpdate();
  }, []);

  const handleBetaToggle = useCallback((enabled: boolean) => {
    const api = getElectronAPI();
    if (!api) return;
    setBetaChannel(enabled);
    api.setBetaChannel(enabled);
    api.checkForUpdates();
  }, []);

  const statusText = (() => {
    if (!status) return null;
    switch (status.status) {
      case "checking":
        return "Checking for updates…";
      case "available":
        return `Update available: v${status.version}`;
      case "downloading":
        return `Downloading update… ${status.percent ?? 0}%`;
      case "downloaded":
        return `Update v${status.version} ready to install`;
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

        <Box>
          <Flex align="center" gap="3">
            <Text size="2" weight="medium">Beta updates</Text>
            <Switch checked={betaChannel} onCheckedChange={handleBetaToggle} />
          </Flex>
          <Text size="1" color="gray" mt="1">
            Receive early beta releases. Beta builds may be less stable.
          </Text>
        </Box>

        {statusText && (
          <Flex direction="column" gap="1">
            <Flex align="center" gap="2">
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

        <Flex gap="3">
          {!isReady && (
            <Button
              variant="soft"
              onClick={handleCheckForUpdates}
              disabled={isChecking || isDownloading}
            >
              <MdRefresh size={16} />
              {isChecking ? "Checking…" : "Check for Updates"}
            </Button>
          )}

          {isReady && (
            <Button
              variant="solid"
              color="green"
              onClick={handleInstallUpdate}
            >
              <MdDownload size={16} />
              Restart & Install Update
            </Button>
          )}
        </Flex>
      </Flex>
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
        <Text size="5" weight="bold">Gryt.chat</Text>
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
