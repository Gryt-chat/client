import {
  AlertDialog,
  Button,
  Flex,
  Heading,
  SegmentedControl,
  Separator,
} from "@radix-ui/themes";
import { useState } from "react";

import connectMp3 from "@/audio/src/assets/connect.mp3";
import disconnectMp3 from "@/audio/src/assets/disconnect.mp3";
import { useSettings } from "@/settings";

import { SettingGroup, SettingsContainer, SliderSetting } from "./settingsComponents";
import { SoundSettings } from "./SoundSettings";

export function VoiceSettings() {
  const {
    inputMode,
    setInputMode,
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
    afkTimeoutMinutes,
    setAfkTimeoutMinutes,
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

      <SettingGroup
        title="Input Mode"
        description="Voice Activity transmits whenever you speak above the noise gate. Push to Talk requires holding a key."
      >
        <SegmentedControl.Root
          value={inputMode}
          onValueChange={(v) => setInputMode(v as "voice_activity" | "push_to_talk")}
        >
          <SegmentedControl.Item value="voice_activity">
            Voice Activity
          </SegmentedControl.Item>
          <SegmentedControl.Item value="push_to_talk">
            Push to Talk
          </SegmentedControl.Item>
        </SegmentedControl.Root>
      </SettingGroup>

      <Separator size="4" />

      <Flex direction="column" gap="4">
        <SoundSettings
          label="Connect Sound"
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
          label="Disconnect Sound"
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

      <Separator size="4" />

      <SliderSetting
        title={`AFK Timeout: ${afkTimeoutMinutes} minutes`}
        description="You'll be marked as AFK after this many minutes of silence. Only applies when connected to voice channels."
        value={afkTimeoutMinutes}
        onChange={setAfkTimeoutMinutes}
        min={1}
        max={30}
      />

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
