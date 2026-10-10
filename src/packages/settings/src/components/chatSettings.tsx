import { Button, Divider } from "@gryt/ui";

import { useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { forgetEmbedHost, useTrustedEmbedHosts } from "../../../socket/src/lib/trustedEmbedHosts";
import { SettingsContainer, ToggleSetting } from "./settingsComponents";
import { SmileySettings } from "./SmileySettings";

export function ChatSettings() {
  const { t: tr } = useTranslation();
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
        {tr("ui.chat")}
      </h2>

      <ToggleSetting
        anchorId="blur-profanity"
        title={tr("ui.blurProfanity")}
        description={tr("ui.blursProfaneWordsWhenTheServerHasProfanity")}
        checked={blurProfanity}
        onCheckedChange={setBlurProfanity}
      />

      <ToggleSetting
        anchorId="load-link-embeds-automatically"
        title={tr("ui.loadLinkEmbedsAutomatically")}
        description={tr("ui.playersFromYoutubeSpotifyTwitchAndTheLike")}
        checked={autoLoadEmbeds}
        onCheckedChange={setAutoLoadEmbeds}
      />

      {!autoLoadEmbeds && trustedHosts.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-gryt-muted">{tr("ui.sitesYouChoseToAlwaysLoadFrom")}</span>
          <div className="flex flex-wrap gap-2">
            {trustedHosts.map((host) => (
              <span key={host} className="flex items-center gap-1 rounded-(--gryt-radius-md) border border-gryt-border px-2 py-1 text-xs">
                {host}
                <Button size="xsmall" tone="ghost" onClick={() => forgetEmbedHost(host)} aria-label={`Stop always loading from ${host}`}>
                  {tr("ui.forget")}
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
