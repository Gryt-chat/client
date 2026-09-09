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
        description="A YouTube, Spotify, Twitch, SoundCloud, TikTok, Instagram, Vimeo or X embed is that company's own page running inside Gryt, and it can see that you opened it. Off, they wait for you to press Load."
        checked={autoLoadEmbeds}
        onCheckedChange={setAutoLoadEmbeds}
      />

      <Divider />

      <SmileySettings />
    </SettingsContainer>
  );
}
