import { Box, Dialog, Flex, IconButton, Tabs } from "@radix-ui/themes";
import { MdChat, MdClose, MdDesktopWindows, MdExtension, MdFavorite, MdInfoOutline, MdKey, MdKeyboard, MdMic, MdNotifications, MdPalette, MdPerson, MdTune, MdVideocam, MdVolumeUp } from "react-icons/md";

import { useSettings } from "@/settings";

import { isElectron } from "../../../../lib/electron";
import { AboutSettings } from "./aboutSettings";
import { AddonsSettings } from "./addonsSettings";
import { AdvancedSettings } from "./advancedSettings";
import { AudioSettings } from "./audioSettings";
import { CameraSettings } from "./cameraSettings";
import { ChatSettings } from "./chatSettings";
import { DesktopSettings } from "./desktopSettings";
import { HotkeySettings } from "./hotkeySettings";
import { NotificationSettings } from "./notificationSettings";
import { ProfileSettings } from "./profileSettings";
import { SecuritySettings } from "./securitySettings";
import { SupportSettings } from "./supportSettings";
import { AppearanceSettings } from "./theme/appearanceSettings";
import { VoiceSettings } from "./voiceSettings";

const TAB_CONFIG = [
  {
    value: "profile",
    label: "Profile",
    icon: MdPerson,
    content: <ProfileSettings />,
  },
  {
    value: "security",
    label: "Security",
    icon: MdKey,
    content: <SecuritySettings />,
  },
  {
    value: "appearance",
    label: "Appearance",
    icon: MdPalette,
    content: <AppearanceSettings />,
  },
  {
    value: "addons",
    label: "Addons",
    icon: MdExtension,
    content: <AddonsSettings />,
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
    value: "voice",
    label: "Voice",
    icon: MdVolumeUp,
    content: <VoiceSettings />,
  },
  {
    value: "chat",
    label: "Chat",
    icon: MdChat,
    content: <ChatSettings />,
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
    value: "desktop",
    label: "Desktop",
    icon: MdDesktopWindows,
    content: <DesktopSettings />,
    conditional: true,
    electronOnly: true,
  },
  {
    value: "advanced",
    label: "Advanced",
    icon: MdTune,
    content: <AdvancedSettings />,
  },
  {
    value: "support",
    label: "Support Gryt",
    icon: MdFavorite,
    content: <SupportSettings />,
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

  const inElectron = isElectron();
  const visibleTabs = TAB_CONFIG.filter((tab) => !tab.electronOnly || inElectron);

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
      <Dialog.Content data-gryt="settings" maxWidth="900px" style={{ height: "700px", minWidth: "600px" }}>
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
                <Box style={{ minWidth: "200px", flexShrink: 0, overflowY: "auto" }}>
                  <Tabs.List
                    style={{
                      flexDirection: "column",
                      alignItems: "stretch",
                      height: "fit-content",
                      gap: "4px",
                    }}
                  >
                    {visibleTabs.map(({ value, label, icon: Icon }) => (
                      <Tabs.Trigger key={value} value={value}>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Icon size={16} />
                          {label}
                        </span>
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>
                </Box>

                <Box style={{ flex: 1, overflowY: "auto", overflowX: "hidden", minWidth: 0 }}>
                  {visibleTabs.map(({ value, content, conditional }) => (
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
