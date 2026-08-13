import { Divider, Switch } from "@gryt/ui";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";

import { getAccessTokenStorageMode, migrateAccessTokensToMode } from "@/common";
import { useSettings } from "@/settings";

import { LatencyPanel } from "./latencyPanel";
import { SettingsContainer } from "./settingsComponents";

export function AdvancedSettings() {
  const {
    showAdvanced,
    setShowAdvanced,
    showDebugOverlay,
    setShowDebugOverlay,
    showVideoDebugOverlay,
    setShowVideoDebugOverlay,
    showPeerLatency,
    setShowPeerLatency,
  } = useSettings();

  const [persistTokens, setPersistTokens] = useState(true);

  useEffect(() => {
    const mode = getAccessTokenStorageMode();
    setPersistTokens(mode === "local");
  }, []);

  return (
    <SettingsContainer>
      <Heading color="cyan">Advanced</Heading>

      {/*
        The toggle stays visible; what it reveals does not. Everything below is
        diagnostics and internals — useful when something is wrong, noise the
        rest of the time, and previously sitting between settings people
        actually needed.

        Advanced settings are titled in cyan wherever they appear, so once this
        is on it is obvious which of the things now on screen arrived with it.
      */}
      <Box>
        <Flex align="center" gap="3">
          <Text weight="medium">Show advanced settings</Text>
          <Switch
            checked={showAdvanced}
            onCheckedChange={setShowAdvanced}
          />
        </Flex>
        <Text color="gray" mt="1">
          Reveals diagnostics and internals across every section. They appear in
          a different colour so you can tell them apart.
        </Text>
      </Box>

      {!showAdvanced ? null : (
      <>
      <LatencyPanel />

      <Divider />

      <Text weight="bold" color="gray">Diagnostics</Text>

      <Box>
        <Flex align="center" gap="3">
          <Text weight="medium">Show Peer Latency</Text>
          <Switch
            checked={showPeerLatency}
            onCheckedChange={setShowPeerLatency}
          />
        </Flex>
        <Text color="gray" mt="1">
          Display latency (ping) next to each user in the voice view
        </Text>
      </Box>

      <Box>
        <Flex align="center" gap="3">
          <Text weight="medium">Show Microphone Debug Overlay</Text>
          <Switch
            checked={showDebugOverlay}
            onCheckedChange={setShowDebugOverlay}
          />
        </Flex>
        <Text color="gray" mt="1">
          Display a floating debug overlay with real-time microphone information
        </Text>
      </Box>

      <Box>
        <Flex align="center" gap="3">
          <Text weight="medium">Show Video Debug Overlay</Text>
          <Switch
            checked={showVideoDebugOverlay}
            onCheckedChange={setShowVideoDebugOverlay}
          />
        </Flex>
        <Text color="gray" mt="1">
          Display a floating debug overlay with real-time video codec, resolution, and bitrate information
        </Text>
      </Box>

      <Box>
        <Flex align="center" gap="3">
          <Text weight="medium">Persist server access tokens</Text>
          <Switch
            checked={persistTokens}
            onCheckedChange={(v) => {
              const next = !!v;
              setPersistTokens(next);
              migrateAccessTokensToMode(next ? "local" : "session");
            }}
          />
        </Flex>
        <Text color="gray" mt="1">
          Turn off to keep server access tokens in session storage (cleared when you close the browser).
        </Text>
      </Box>
      </>
      )}
    </SettingsContainer>
  );
}
