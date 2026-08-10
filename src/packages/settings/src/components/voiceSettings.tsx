import {
  AlertDialog,
  Button,
  Flex,
  Heading,
  Separator,
} from "@radix-ui/themes";
import { useState } from "react";

import connectMp3 from "@/audio/src/assets/connect.mp3";
import disconnectMp3 from "@/audio/src/assets/disconnect.mp3";
import { useSettings } from "@/settings";

import { SettingsContainer, ToggleSetting } from "./settingsComponents";
import { SoundSettings } from "./SoundSettings";

export function VoiceSettings() {
  const {
    eSportsModeEnabled,
    setESportsModeEnabled,
    connectSoundEnabled,
    setConnectSoundEnabled,
    disconnectSoundEnabled,
    setDisconnectSoundEnabled,
    connectSoundVolume,
    setConnectSoundVolume,
    disconnectSoundVolume,
    setDisconnectSoundVolume,
    customConnectSoundFile,
    setCustomConnectSoundFile,
    customDisconnectSoundFile,
    setCustomDisconnectSoundFile,
  } = useSettings();

  const [alertDialog, setAlertDialog] = useState<{
    open: boolean;
    type: "success" | "error";
    title: string;
    message: string;
  }>({
    open: false,
    type: "success",
    title: "",
    message: "",
  });

  const showAlert = (
    type: "success" | "error",
    title: string,
    message: string,
  ) => {
    setAlertDialog({ open: true, type, title, message });
  };

  return (
    <SettingsContainer>
      <Heading as="h2" size="4">
        Voice
      </Heading>

      <ToggleSetting
        title="eSports mode"
        description="Lowest possible latency. Disables all audio processing, enables push-to-talk, caps bitrate at 128kbps (studio quality), and optimizes Opus packetization (10ms frames)."
        checked={eSportsModeEnabled}
        onCheckedChange={setESportsModeEnabled}
        statusText={eSportsModeEnabled
          ? "Active — RNNoise off, noise gate bypassed, PTT enabled, 128kbps cap, ptime=10ms"
          : undefined
        }
      />

      <Separator size="4" />

      <Flex direction="column" gap="4">
        <SoundSettings
          label="Connect sound"
          description="Play sound when connecting to voice"
          enabled={connectSoundEnabled}
          onEnabledChange={setConnectSoundEnabled}
          volume={connectSoundVolume}
          onVolumeChange={setConnectSoundVolume}
          defaultVolume={10}
          customSoundFile={customConnectSoundFile}
          onCustomSoundFileChange={setCustomConnectSoundFile}
          defaultSoundSrc={connectMp3}
          showAlert={showAlert}
        />
        <SoundSettings
          label="Disconnect sound"
          description="Play sound when disconnecting from voice"
          enabled={disconnectSoundEnabled}
          onEnabledChange={setDisconnectSoundEnabled}
          volume={disconnectSoundVolume}
          onVolumeChange={setDisconnectSoundVolume}
          defaultVolume={10}
          customSoundFile={customDisconnectSoundFile}
          onCustomSoundFileChange={setCustomDisconnectSoundFile}
          defaultSoundSrc={disconnectMp3}
          showAlert={showAlert}
        />
      </Flex>


      {alertDialog.open && (
        <AlertDialog.Root
          open={alertDialog.open}
          onOpenChange={() =>
            setAlertDialog({ ...alertDialog, open: false })
          }
        >
          <AlertDialog.Content maxWidth="450px">
            <AlertDialog.Title>{alertDialog.title}</AlertDialog.Title>
            <AlertDialog.Description size="2">
              {alertDialog.message}
            </AlertDialog.Description>

            <Flex gap="3" mt="4" justify="end">
              <AlertDialog.Action>
                <Button
                  variant="soft"
                  color={alertDialog.type === "error" ? "red" : "green"}
                  onClick={() =>
                    setAlertDialog({ ...alertDialog, open: false })
                  }
                >
                  OK
                </Button>
              </AlertDialog.Action>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>
      )}
    </SettingsContainer>
  );
}
