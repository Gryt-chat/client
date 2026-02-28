import { Heading, Separator } from "@radix-ui/themes";

import { useSettings } from "@/settings";

import { SettingsContainer, ToggleSetting } from "./settingsComponents";
import { SmileySettings } from "./SmileySettings";

export function ChatSettings() {
  const {
    blurProfanity,
    setBlurProfanity,
  } = useSettings();

  return (
    <SettingsContainer>
      <Heading as="h2" size="4">
        Chat
      </Heading>

      <ToggleSetting
        title="Blur Profanity"
        description="Show a blur over profane words if the server has profanity filtering enabled in flag mode. Click a blurred word to reveal it."
        checked={blurProfanity}
        onCheckedChange={setBlurProfanity}
      />

      <Separator size="4" />

      <SmileySettings />
    </SettingsContainer>
  );
}
