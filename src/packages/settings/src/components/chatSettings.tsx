import { Button, Divider } from "@gryt/ui";

import { useSettings } from "@/settings";

import { forgetEmbedHost, useTrustedEmbedHosts } from "../../../socket/src/lib/trustedEmbedHosts";
import { SettingsContainer, ToggleSetting } from "./settingsComponents";
import { SmileySettings } from "./SmileySettings";

export function ChatSettings() {
  const {
    blurProfanity,
    setBlurProfanity,
    autoLoadEmbeds,
    setAutoLoadEmbeds,
  } = useSettings();
  const trustedHosts = useTrustedEmbedHosts();

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

      {!autoLoadEmbeds && trustedHosts.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-gryt-muted">Sites you chose to always load from:</span>
          <div className="flex flex-wrap gap-2">
            {trustedHosts.map((host) => (
              <span key={host} className="flex items-center gap-1 rounded-(--gryt-radius-md) border border-gryt-border px-2 py-1 text-xs">
                {host}
                <Button size="xsmall" tone="ghost" onClick={() => forgetEmbedHost(host)} aria-label={`Stop always loading from ${host}`}>
                  Forget
                </Button>
              </span>
            ))}
          </div>
        </div>
      )}

      <Divider />

      <SmileySettings />
    </SettingsContainer>
  );
}
