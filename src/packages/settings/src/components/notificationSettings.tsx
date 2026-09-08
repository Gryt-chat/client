import { Divider, Toggle, ToggleGroup } from "@gryt/ui";
import { useState, useSyncExternalStore } from "react";

import messageSoundMp3 from "@/audio/src/assets/universfield-computer-mouse-click-02-383961.mp3";
import {
  getStoredSnapshot,
  type NotificationLevel,
  setGlobalLevel,
  subscribeToPrefs,
} from "@/common";
import { useSettings } from "@/settings";

import { NoticeDialog } from "../../../socket/src/components/NoticeDialog";
import { ServerNotificationList } from "./serverNotificationList";
import { SettingGroup, SettingsContainer, ToggleSetting } from "./settingsComponents";
import { SoundSettings } from "./SoundSettings";

const GLOBAL_LEVELS: { label: string; value: NotificationLevel }[] = [
  { label: "Everything", value: "all" },
  { label: "Only mentions", value: "mentions" },
  { label: "Nothing", value: "none" },
];

export function NotificationSettings() {
  const {
    notificationBadgeEnabled,
    desktopNotificationsEnabled,
    setDesktopNotificationsEnabled,
    setNotificationBadgeEnabled,
    messageSoundEnabled,
    setMessageSoundEnabled,
    messageSoundVolume,
    setMessageSoundVolume,
    customMessageSoundFile,
    setCustomMessageSoundFile,
  } = useSettings();

  /* The global level and the per-server rules share a store, and this reads
     the whole thing so the toggles move when either changes. */
  const globalLevel = useSyncExternalStore(
    subscribeToPrefs,
    getStoredSnapshot,
    getStoredSnapshot,
  ).global;

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

      {/* First, because it is the one that decides what the rest can do. */}
      <SettingGroup
        title="Notification level"
        description="Applies to every server. It can only quieten one, never make one louder — a server you have already muted stays muted."
      >
        <ToggleGroup
          value={[globalLevel]}
          onValueChange={(next) => {
            // Base UI hands back an array and clears it when the pressed one is
            // pressed again. There is always a level, so an empty answer means
            // "no change" rather than "none".
            const picked = next[0];
            if (picked) setGlobalLevel(picked as NotificationLevel);
          }}
          multiple={false}
        >
          {GLOBAL_LEVELS.map((level) => (
            <Toggle key={level.value} value={level.value} size="small">
              {level.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </SettingGroup>

      <Divider />

      <SettingGroup
        title="Per server"
        description="How loud each server is on its own. Set from the right-click menu too — this is the same setting, in one place."
      >
        <ServerNotificationList />
      </SettingGroup>

      <Divider />

      <ToggleSetting
        title="Desktop notifications"
        description="Show a notification when a message arrives somewhere you are not looking. Never plays its own sound — the message sound below does that."
        checked={desktopNotificationsEnabled}
        onCheckedChange={setDesktopNotificationsEnabled}
      />

      <Divider />

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

      <NoticeDialog
        open={alertDialog.open}
        onClose={() => setAlertDialog({ ...alertDialog, open: false })}
        title={alertDialog.title}
        message={alertDialog.message}
      />
    </SettingsContainer>
  );
}
