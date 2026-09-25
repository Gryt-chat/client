import { ContextMenu } from "@gryt/ui";
import { useSyncExternalStore } from "react";

import {
  type ContactPrefs,
  type ContactRule,
  getContactPrefsSnapshot,
  setServerContactRule,
  subscribeToContactPrefs,
} from "../hooks/contactPrefs";

const WORDS: Record<keyof ContactPrefs, Record<ContactRule, string>> = {
  messages: { everyone: "Anyone on the server", friends: "Friends", nobody: "Nobody" },
  calls: { everyone: "Anyone who can message me", friends: "Friends", nobody: "Nobody" },
};

const TITLES: Record<keyof ContactPrefs, string> = {
  messages: "Who can send me messages",
  calls: "Who can call me",
};

/** One server's own answer, or Default to follow Settings → Privacy (GRYT-1470). */
function ContactRuleSubmenu({ host, kind }: { host: string; kind: keyof ContactPrefs }) {
  const stored = useSyncExternalStore(subscribeToContactPrefs, getContactPrefsSnapshot, getContactPrefsSnapshot);
  const own = stored.servers[host]?.[kind] ?? null;
  const inherited = stored.global[kind];
  const words = WORDS[kind];

  return (
    <ContextMenu.SubmenuRoot>
      <ContextMenu.SubmenuTrigger>{TITLES[kind]}</ContextMenu.SubmenuTrigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup>
            <ContextMenu.RadioGroup
              value={own ?? "default"}
              onValueChange={(value) =>
                setServerContactRule(host, kind, value === "default" ? null : (value as ContactRule))
              }
            >
              {(["everyone", "friends", "nobody"] as const).map((rule) => (
                <ContextMenu.RadioItem key={rule} value={rule}>
                  {words[rule]}
                </ContextMenu.RadioItem>
              ))}
              <ContextMenu.RadioItem value="default">
                {`Default (${words[inherited].toLowerCase()})`}
              </ContextMenu.RadioItem>
            </ContextMenu.RadioGroup>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.SubmenuRoot>
  );
}

/** Both settings, for a server's right-click menus. */
export function ContactPrivacyMenu({ host }: { host: string }) {
  return (
    <>
      <ContactRuleSubmenu host={host} kind="messages" />
      <ContactRuleSubmenu host={host} kind="calls" />
    </>
  );
}
