import { Divider } from "@gryt/ui";
import { Heading } from "@radix-ui/themes";

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
      <Heading as="h2">
        Chat
      </Heading>

      <ToggleSetting
        title="Blur profanity"
        description="Blurs profane words when the server has profanity filtering set to flag. Click a blurred word to reveal it."
        checked={blurProfanity}
        onCheckedChange={setBlurProfanity}
      />

      <Divider />

      <SmileySettings />
    </SettingsContainer>
  );
}
