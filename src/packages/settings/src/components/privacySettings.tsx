import { Divider, Toggle, ToggleGroup } from "@gryt/ui";
import { useSyncExternalStore } from "react";

import {
  type ContactRule,
  getContactPrefsSnapshot,
  setGlobalContactRule,
  subscribeToContactPrefs,
} from "@/common";

import { useLocale } from "../../../../lib/localeContext";
import { SettingGroup, SettingsContainer } from "./settingsComponents";

const MESSAGE_CHOICES: { label: string; value: ContactRule }[] = [
  { label: "Anyone on the server", value: "everyone" },
  { label: "Friends", value: "friends" },
  { label: "Nobody", value: "nobody" },
];

const CALL_CHOICES: { label: string; value: ContactRule }[] = [
  { label: "Anyone who can message me", value: "everyone" },
  { label: "Friends", value: "friends" },
  { label: "Nobody", value: "nobody" },
];

/** GRYT-1470. Saved as it's picked, like every setting. */
export function PrivacySettings() {
  const { t } = useLocale();
  const { global } = useSyncExternalStore(subscribeToContactPrefs, getContactPrefsSnapshot, getContactPrefsSnapshot);

  return (
    <SettingsContainer>
      <h2>{t("settings.privacy")}</h2>

      <SettingGroup
        title="Who can send me messages"
        description={t("settings.friendsArePeopleYouVeAddedOnThatServerUntil")}
      >
        <ToggleGroup
          className="max-[439px]:flex-wrap"
          value={[global.messages]}
          onValueChange={(next) => {
            const picked = next[0];
            if (picked) setGlobalContactRule("messages", picked as ContactRule);
          }}
          multiple={false}
        >
          {MESSAGE_CHOICES.map((choice) => (
            <Toggle key={choice.value} value={choice.value} size="small">
              {t(choice.label)}
            </Toggle>
          ))}
        </ToggleGroup>
      </SettingGroup>

      <Divider />

      <SettingGroup
        title="Who can call me"
        description={t("settings.somebodyWhoCanTMessageYouCanTCallYou")}
      >
        <ToggleGroup
          className="max-[439px]:flex-wrap"
          value={[global.messages === "nobody" ? "nobody" : global.calls]}
          onValueChange={(next) => {
            const picked = next[0];
            if (picked) setGlobalContactRule("calls", picked as ContactRule);
          }}
          multiple={false}
        >
          {CALL_CHOICES.map((choice) => (
            <Toggle
              key={choice.value}
              value={choice.value}
              size="small"
              // Nobody can message you, so nobody can be ringing you from a conversation.
              disabled={global.messages === "nobody" && choice.value !== "nobody"}
            >
              {t(choice.label)}
            </Toggle>
          ))}
        </ToggleGroup>
      </SettingGroup>
    </SettingsContainer>
  );
}
