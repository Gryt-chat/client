import { ContextMenu } from "@gryt/ui";
import { useSyncExternalStore } from "react";

import {
  getGlobalLevel,
  getOwnLevel,
  getPlacement,
  getStoredSnapshot,
  globalOverrules,
  type NotificationLevel,
  resolveInheritedLevel,
  setNotificationLevel,
  subscribeToPrefs,
} from "../hooks/notificationPrefs";

const LEVEL_WORDS: Record<NotificationLevel, string> = {
  all: "everything",
  mentions: "only mentions",
  none: "nothing",
};

/**
 * A scope somebody can set a level on: the whole server, one folder, or one
 * channel.
 */
export type NotificationScope =
  | { kind: "server" }
  | { kind: "folder" | "channel"; id: string };

/** Where the channel sits, so the inherited answer can be worked out. */
export interface NotificationScopePlacement {
  channelId: string;
  parentItemId?: string | null;
}

/**
 * How loud one scope is, as four choices with the current one marked. "Default" is
 * a real option: a channel set back to it follows its folder again.
 */
export function NotificationLevelMenu({
  host,
  scope,
  placement = null,
}: {
  host: string;
  scope: NotificationScope;
  /**
   * The channel's place in the sidebar, for working out what "Default"
   * currently resolves to. Server and folder scopes do not need it.
   */
  placement?: NotificationScopePlacement | null;
}) {
  /* Subscribed to the whole store rather than the servers map, so picking a
     level and changing the global ceiling both re-render this. */
  useSyncExternalStore(subscribeToPrefs, getStoredSnapshot, getStoredSnapshot);

  const own = getOwnLevel(host, scope);
  const global = getGlobalLevel();

  /* What "Default" comes out as. A channel follows its folder or server, quietened
     by the level the server set for it; a folder follows the server; the server hears everything. */
  const inherited: NotificationLevel =
    scope.kind === "channel"
      ? resolveInheritedLevel(getStoredSnapshot().servers, host, {
          channelId: scope.id,
          parentItemId: placement?.parentItemId ?? null,
          defaultLevel: getPlacement(host, scope.id)?.defaultLevel ?? null,
        })
      : scope.kind === "folder"
        ? (getOwnLevel(host, { kind: "server" }) ?? "all")
        : "all";

  /* What this scope currently comes out as: its own setting, else what it inherits. */
  const resolved: NotificationLevel = own ?? inherited;

  const overruled = globalOverrules(global, resolved);

  const choices: { label: string; value: NotificationLevel | null }[] = [
    { label: "Everything", value: "all" },
    { label: "Only mentions", value: "mentions" },
    { label: "Nothing", value: "none" },
    {
      label: `Default (${LEVEL_WORDS[inherited]})`,
      value: null,
    },
  ];

  return (
    <ContextMenu.SubmenuRoot>
      <ContextMenu.SubmenuTrigger>Notifications</ContextMenu.SubmenuTrigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup>
            <ContextMenu.RadioGroup
              value={own ?? "default"}
              onValueChange={(value) =>
                setNotificationLevel(
                  host,
                  scope,
                  value === "default" ? null : (value as NotificationLevel),
                )
              }
            >
              {choices.map((choice) => (
                <ContextMenu.RadioItem
                  key={choice.label}
                  value={choice.value ?? "default"}
                >
                  {choice.label}
                </ContextMenu.RadioItem>
              ))}
            </ContextMenu.RadioGroup>

            {/* Said here rather than only in settings. A channel reading
                "Everything" and making no sound is a bug report waiting to
                happen, and the menu is where somebody goes to find out why. */}
            {overruled && (
              <>
                <ContextMenu.Separator />
                {/* Inside a Group because Base UI reads the group's id off
                    context to point aria-labelledby at the label, and throws
                    without one. */}
                <ContextMenu.Group>
                  <ContextMenu.GroupLabel>
                    {global === "none"
                      ? "Everything is muted in settings"
                      : "Settings limits this to mentions"}
                  </ContextMenu.GroupLabel>
                </ContextMenu.Group>
              </>
            )}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.SubmenuRoot>
  );
}
