import { Divider } from "@gryt/ui";

import { useSettings } from "@/settings";

import { SettingsContainer, ToggleSetting } from "./settingsComponents";
import { SmileySettings } from "./SmileySettings";

export function ChatSettings() {
  const {
    blurProfanity,
    setBlurProfanity,
    autoLoadEmbeds,
    setAutoLoadEmbeds,
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

      <ToggleSetting
        title="Load link embeds automatically"
        description="Players from YouTube, Spotify, Twitch and the like, pictures and videos linked from other sites, and the pictures on link previews all load from those sites, which can see that you opened them. Off, players and files wait for you to press Load, and previews show text only."
        checked={autoLoadEmbeds}
        onCheckedChange={setAutoLoadEmbeds}
      />

      <Divider />

      <SmileySettings />
    </SettingsContainer>
  );
}
