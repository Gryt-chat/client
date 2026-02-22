import { Box, Dialog, Flex, IconButton, Tabs, Text } from "@radix-ui/themes";
import { X as FiX } from "lucide-react";
import { Keyboard as MdKeyboard, Mic as MdMic, Bell as MdNotifications, Palette as MdPalette, User as MdPerson, RefreshCw as MdSystemUpdate, SlidersHorizontal as MdTune, Volume2 as MdVolumeUp } from "lucide-react";

import { useSettings } from "@/settings";

import { AdvancedSettings } from "./advancedSettings";
import { AudioSettings } from "./audioSettings";
import { HotkeySettings } from "./hotkeySettings";
import { NotificationSettings } from "./notificationSettings";
import { ProfileSettings } from "./profileSettings";
import { AppearanceSettings } from "./theme/appearanceSettings";
import { UpdateSettings } from "./updateSettings";
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
    value: "updates",
    label: "Updates",
    icon: MdSystemUpdate,
    content: <UpdateSettings />,
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
            <FiX size={16} />
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
                      <Tabs.Trigger
                        key={value}
                        value={value}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-start",
                          padding: "12px 16px",
                          gap: "8px",
                        }}
                      >
                        <Icon size={16} style={{ flexShrink: 0 }} />
                        {label}
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>
                  <Text
                    size="1"
                    color="gray"
                    style={{ fontFamily: "var(--code-font-family)", padding: "12px 16px", opacity: 0.5 }}
                  >
                    v{__APP_VERSION__}
                  </Text>
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
