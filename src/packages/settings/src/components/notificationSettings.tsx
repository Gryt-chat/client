import {
  AlertDialog,
  Button,
  Flex,
  Heading,
  Separator,
} from "@radix-ui/themes";
import { useState } from "react";

import messageSoundMp3 from "@/audio/src/assets/universfield-computer-mouse-click-02-383961.mp3";
import { useSettings } from "@/settings";

import { SettingsContainer, ToggleSetting } from "./settingsComponents";
import { SoundSettings } from "./SoundSettings";

export function NotificationSettings() {
  const {
    notificationBadgeEnabled,
    setNotificationBadgeEnabled,
    messageSoundEnabled,
    setMessageSoundEnabled,
    messageSoundVolume,
    setMessageSoundVolume,
    customMessageSoundFile,
    setCustomMessageSoundFile,
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
      <Heading size="4">Notifications</Heading>

      <ToggleSetting
        title="Unread Message Badge"
        description="Show an unread message count on the taskbar icon when the app is not focused."
        checked={notificationBadgeEnabled}
        onCheckedChange={setNotificationBadgeEnabled}
      />

      <Separator size="4" />

      <SoundSettings
        label="Message Sound"
        description="Play a sound when a new message arrives while the app is not focused"
        enabled={messageSoundEnabled}
        onEnabledChange={setMessageSoundEnabled}
        volume={messageSoundVolume}
        onVolumeChange={setMessageSoundVolume}
        defaultVolume={30}
        customSoundFile={customMessageSoundFile}
        onCustomSoundFileChange={setCustomMessageSoundFile}
        defaultSoundSrc={messageSoundMp3}
        showAlert={showAlert}
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
