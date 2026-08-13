import { AlertDialog, Button, Divider } from "@gryt/ui";
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
      <h2>Notifications</h2>

      <ToggleSetting
        title="Unread message badge"
        description="Show an unread message count on the taskbar icon when the app is not focused."
        checked={notificationBadgeEnabled}
        onCheckedChange={setNotificationBadgeEnabled}
      />

      <Divider />

      <SoundSettings
        label="Message sound"
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
          <AlertDialog.Portal>
            <AlertDialog.Backdrop />
            <AlertDialog.Popup className="max-w-112">
            <AlertDialog.Title>{alertDialog.title}</AlertDialog.Title>
            <AlertDialog.Description>
              {alertDialog.message}
            </AlertDialog.Description>

            <div className="flex gap-3 mt-4 justify-end">
              <AlertDialog.Close render={<span />}>
                <Button tone="neutral" size="small"
                  onClick={() =>
                    setAlertDialog({ ...alertDialog, open: false })
                  }
                >
                  OK
                </Button>
              </AlertDialog.Close>
            </div>
          </AlertDialog.Popup>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      )}
    </SettingsContainer>
  );
}
