import { Box, Dialog, Flex, IconButton, Tabs } from "@radix-ui/themes";
import { MdClose, MdInfoOutline, MdKeyboard, MdMic, MdNotifications, MdPalette, MdPerson, MdTune, MdVideocam, MdVolumeUp } from "react-icons/md";

import { useSettings } from "@/settings";

import { AboutSettings } from "./aboutSettings";
import { AdvancedSettings } from "./advancedSettings";
import { AudioSettings } from "./audioSettings";
import { CameraSettings } from "./cameraSettings";
import { HotkeySettings } from "./hotkeySettings";
import { NotificationSettings } from "./notificationSettings";
import { ProfileSettings } from "./profileSettings";
import { AppearanceSettings } from "./theme/appearanceSettings";
import { VoiceCallSettings } from "./voiceCallSettings";

const TAB_CONFIG = [
  {
    value: "profile",
    label: "Profile",
    icon: MdPerson,
    content: <ProfileSettings />,
  },
  {
    value: "appearance",
    label: "Appearance",
    icon: MdPalette,
    content: <AppearanceSettings />,
  },
  {
    value: "audio",
    label: "Audio",
    icon: MdMic,
    content: <AudioSettings />,
    conditional: true,
  },
  {
    value: "camera",
    label: "Camera",
    icon: MdVideocam,
    content: <CameraSettings />,
    conditional: true,
  },
  {
    value: "voice-calls",
    label: "Voice & Chat",
    icon: MdVolumeUp,
    content: <VoiceCallSettings />,
  },
  {
    value: "hotkeys",
    label: "Hotkeys",
    icon: MdKeyboard,
    content: <HotkeySettings />,
  },
  {
    value: "notifications",
    label: "Notifications",
    icon: MdNotifications,
    content: <NotificationSettings />,
  },
  {
    value: "advanced",
    label: "Advanced",
    icon: MdTune,
    content: <AdvancedSettings />,
  },
  {
    value: "about",
    label: "About",
    icon: MdInfoOutline,
    content: <AboutSettings />,
  },
];

export function Settings() {
  const {
    setLoopbackEnabled,
    setShowSettings,
    showSettings,
    settingsTab,
    setSettingsTab,
  } = useSettings();

  function handleDialogChange(isOpen: boolean) {
    setShowSettings(isOpen);
    setLoopbackEnabled(false);
  }

  function handleTabChange(value: string) {
    setLoopbackEnabled(false);
    setSettingsTab(value);
  }

  return (
    <Dialog.Root open={showSettings} onOpenChange={handleDialogChange}>
      <Dialog.Content maxWidth="900px" style={{ height: "700px", minWidth: "600px" }}>
        <Dialog.Close
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
          }}
        >
          <IconButton variant="soft" color="gray">
            <MdClose size={16} />
          </IconButton>
        </Dialog.Close>

        <Flex direction="column" gap="4" height="100%">
          <Dialog.Title as="h1" weight="bold" size="6">
            Settings
          </Dialog.Title>

          {showSettings && (
            <Tabs.Root
              value={settingsTab}
              onValueChange={handleTabChange}
              orientation="vertical"
              style={{ flex: 1, minHeight: 0 }}
            >
              <Flex gap="4" height="100%">
                {/* Vertical Tab List */}
                <Box style={{ minWidth: "200px", flexShrink: 0, overflowY: "auto" }}>
                  <Tabs.List
                    style={{
                      flexDirection: "column",
                      alignItems: "stretch",
                      height: "fit-content",
                      gap: "4px",
                    }}
                  >
                    {TAB_CONFIG.map(({ value, label, icon: Icon }) => (
                      <Tabs.Trigger key={value} value={value}>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Icon size={16} />
                          {label}
                        </span>
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>
                </Box>

                {/* Tab Content */}
                <Box style={{ flex: 1, overflowY: "auto", overflowX: "hidden", minWidth: 0 }}>
                  {TAB_CONFIG.map(({ value, content, conditional }) => (
                    <Tabs.Content key={value} value={value}>
                      {conditional
                        ? settingsTab === value && showSettings && content
                        : content}
                    </Tabs.Content>
                  ))}
                </Box>
              </Flex>
            </Tabs.Root>
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
