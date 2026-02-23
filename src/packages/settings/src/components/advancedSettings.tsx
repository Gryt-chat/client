import { Box, Flex, Heading, Separator, Switch, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";

import { getAccessTokenStorageMode, migrateAccessTokensToMode } from "@/common";
import { useSettings } from "@/settings";

import { getElectronAPI, isElectron } from "../../../../lib/electron";
import { LatencyPanel } from "./latencyPanel";
import { SettingsContainer, ToggleSetting } from "./settingsComponents";

export function AdvancedSettings() {
  const {
    eSportsModeEnabled,
    setESportsModeEnabled,
    showDebugOverlay,
    setShowDebugOverlay,
    showPeerLatency,
    setShowPeerLatency,
    experimentalScreenShare,
    setExperimentalScreenShare,
  } = useSettings();

  const inElectron = isElectron();
  const [closeToTray, setCloseToTray] = useState(true);
  const [persistTokens, setPersistTokens] = useState(true);

  useEffect(() => {
    const mode = getAccessTokenStorageMode();
    setPersistTokens(mode === "local");
  }, []);

  useEffect(() => {
    if (!inElectron) return;
    getElectronAPI()?.getCloseToTray().then(setCloseToTray);
  }, [inElectron]);

  const handleCloseToTrayToggle = useCallback((enabled: boolean) => {
    setCloseToTray(enabled);
    getElectronAPI()?.setCloseToTray(enabled);
  }, []);

  return (
    <SettingsContainer>
      <Heading size="4">Advanced</Heading>

      {inElectron && (
        <>
          <ToggleSetting
            title="Minimize to Tray on Close"
            description="When enabled, closing the window minimizes to the system tray instead of quitting the app."
            checked={closeToTray}
            onCheckedChange={handleCloseToTrayToggle}
          />
          <Separator size="4" />
        </>
      )}

      {/* ── eSports Mode ── */}
      <ToggleSetting
        title="eSports Mode"
        description="Lowest possible latency. Disables all audio processing, enables push-to-talk, caps bitrate at 128kbps (studio quality), and optimizes Opus packetization (10ms frames)."
        checked={eSportsModeEnabled}
        onCheckedChange={setESportsModeEnabled}
        statusText={eSportsModeEnabled
          ? "Active — RNNoise off, noise gate bypassed, PTT enabled, 128kbps cap, ptime=10ms"
          : undefined
        }
      />

      <Separator size="4" />

      {/* ── Latency ── */}
      <LatencyPanel />

      <Separator size="4" />

      {/* ── Experimental Screen Share ── */}
      <ToggleSetting
        title="Experimental Screen Share"
        description="Unlock high frame rate options (144, 165, 240 FPS) for screen sharing. These require significant bandwidth and may not work on all hardware."
        checked={experimentalScreenShare}
        onCheckedChange={setExperimentalScreenShare}
        statusText={experimentalScreenShare
          ? "High FPS options (144, 165, 240) are available in the screen share picker"
          : undefined
        }
      />

      <Separator size="4" />

      {/* ── Diagnostics ── */}
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
