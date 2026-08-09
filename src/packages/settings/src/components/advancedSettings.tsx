import { Box, Flex, Heading, Separator, Switch, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";

import { getAccessTokenStorageMode, migrateAccessTokensToMode } from "@/common";
import { useSettings } from "@/settings";

import { LatencyPanel } from "./latencyPanel";
import { SettingsContainer } from "./settingsComponents";

export function AdvancedSettings() {
  const {
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
      <Heading size="4">Advanced</Heading>

      <LatencyPanel />

      <Separator size="4" />

      <Text size="3" weight="bold" color="gray">Diagnostics</Text>

      <Box>
        <Flex align="center" gap="3">
          <Text size="2" weight="medium">Show Peer Latency</Text>
          <Switch
            checked={showPeerLatency}
            onCheckedChange={setShowPeerLatency}
          />
        </Flex>
        <Text size="1" color="gray" mt="1">
          Display latency (ping) next to each user in the voice view
        </Text>
      </Box>

      <Box>
        <Flex align="center" gap="3">
          <Text size="2" weight="medium">Show Microphone Debug Overlay</Text>
          <Switch
            checked={showDebugOverlay}
            onCheckedChange={setShowDebugOverlay}
          />
        </Flex>
        <Text size="1" color="gray" mt="1">
          Display a floating debug overlay with real-time microphone information
        </Text>
      </Box>

      <Box>
        <Flex align="center" gap="3">
          <Text size="2" weight="medium">Show Video Debug Overlay</Text>
          <Switch
            checked={showVideoDebugOverlay}
            onCheckedChange={setShowVideoDebugOverlay}
          />
        </Flex>
        <Text size="1" color="gray" mt="1">
          Display a floating debug overlay with real-time video codec, resolution, and bitrate information
        </Text>
      </Box>

      <Box>
        <Flex align="center" gap="3">
          <Text size="2" weight="medium">Persist server access tokens</Text>
          <Switch
            checked={persistTokens}
            onCheckedChange={(v) => {
              const next = !!v;
              setPersistTokens(next);
              migrateAccessTokensToMode(next ? "local" : "session");
            }}
          />
        </Flex>
        <Text size="1" color="gray" mt="1">
          Turn off to keep server access tokens in session storage (cleared when you close the browser).
        </Text>
      </Box>
    </SettingsContainer>
  );
}
