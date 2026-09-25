import { Divider, Toggle, ToggleGroup } from "@gryt/ui";
import { useSyncExternalStore } from "react";

import {
  type ContactRule,
  getContactPrefsSnapshot,
  setGlobalContactRule,
  subscribeToContactPrefs,
} from "@/common";

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
  const { global } = useSyncExternalStore(subscribeToContactPrefs, getContactPrefsSnapshot, getContactPrefsSnapshot);

  return (
    <SettingsContainer>
      <h2>Privacy</h2>

      <SettingGroup
        title="Who can send me messages"
        description="Friends are people you've added on that server. Until you add your first one there, anybody you've written to one-to-one counts. Nobody also stops friend requests. This counts for every server, and you can right-click a server to give it its own answer. A server finds out the next time you connect to it. Your app checks every message too, so a server that ignores this still can't get them to you."
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
              {choice.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </SettingGroup>

      <Divider />

      <SettingGroup
        title="Who can call me"
        description="Somebody who can't message you can't call you either. Your app checks every ring too, and one it wouldn't let through never rings."
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
              {choice.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </SettingGroup>
    </SettingsContainer>
  );
}
