import { Divider } from "@gryt/ui";

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
      <h2>
        Chat
      </h2>

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
