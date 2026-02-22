import { Badge, Box, Button, Flex, Heading, Progress, Switch, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
import { MdCheckCircle, MdDownload, MdError,MdRefresh } from "react-icons/md";

import { getElectronAPI, isElectron, UpdateStatus } from "../../../../lib/electron";
import { SettingsContainer } from "./settingsComponents";

export function UpdateSettings() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [appVersion, setAppVersion] = useState<string>("…");
  const [betaChannel, setBetaChannel] = useState(false);
  const inElectron = isElectron();

  useEffect(() => {
    if (!inElectron) return;
    const api = getElectronAPI();
    if (!api) return;

    api.getAppVersion().then(setAppVersion);
    api.getBetaChannel().then(setBetaChannel);
    return api.onUpdateStatus(setStatus);
  }, [inElectron]);

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

  if (!inElectron) {
    return (
      <SettingsContainer>
        <Heading size="4">Updates</Heading>
        <Box>
          <Text size="2" color="gray">
            Auto-updates are only available in the desktop app.
            Download it from the GitHub releases page.
          </Text>
        </Box>
      </SettingsContainer>
    );
  }

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
    <SettingsContainer>
      <Heading size="4">Updates</Heading>

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
          <Flex align="center" gap="2">
            {status?.status === "not-available" && <MdCheckCircle size={16} color="var(--green-9)" />}
            {status?.status === "error" && <MdError size={16} color="var(--red-9)" />}
            <Text size="2" color={statusColor}>{statusText}</Text>
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
    </SettingsContainer>
  );
}
