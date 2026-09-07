import { Avatar, Select } from "@gryt/ui";
import { useSyncExternalStore } from "react";

import {
  GeneratedServerIcon,
  getOwnLevel,
  getStoredSnapshot,
  globalOverrules,
  type NotificationLevel,
  serverIconSrc,
  setNotificationLevel,
  subscribeToPrefs,
} from "@/common";
import { useServerManagement, useSockets } from "@/socket";

/**
 * "Default" is a real answer, not a synonym for Everything. A server set back
 * to default hears everything *unless* the global level says otherwise; one set
 * to Everything is asking for everything outright.
 */
const CHOICES: { label: string; value: string }[] = [
  { label: "Default", value: "default" },
  { label: "Everything", value: "all" },
  { label: "Only mentions", value: "mentions" },
  { label: "Nothing", value: "none" },
];

/**
 * Every server in the rail, and how loud each one is.
 *
 * The levels have only ever been reachable by right-clicking a server icon,
 * one at a time, with no way to see the set of them. Somebody who muted four
 * servers over a month had no page that said which four.
 */
export function ServerNotificationList() {
  useSyncExternalStore(subscribeToPrefs, getStoredSnapshot, getStoredSnapshot);

  const { servers, orderedServerHosts } = useServerManagement();
  const { serverDetailsList } = useSockets();
  const global = getStoredSnapshot().global;

  if (orderedServerHosts.length === 0) {
    return (
      <span className="text-xs text-gryt-muted">
        No servers yet. Join one and it will show up here.
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {orderedServerHosts.map((host) => {
        const name = servers[host]?.name || host;
        const own = getOwnLevel(host, { kind: "server" });
        // What the server comes out as before the ceiling, which is what the
        // ceiling is compared against. Unset means everything.
        const overruled = globalOverrules(global, own ?? "all");

        return (
          <div
            key={host}
            className="flex items-center gap-3 rounded-(--gryt-radius-md) px-2 py-1.5"
          >
            <Avatar
              size="small"
              className="rounded-(--gryt-radius-md) p-0"
              fallback={<GeneratedServerIcon seed={name} />}
              src={serverIconSrc(host, servers[host]?.name || "", serverDetailsList)}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">{name}</span>
              {/* Only where it changes the answer. Saying "limited by your
                  global setting" under a server that is already quieter than
                  the ceiling would be noise on every row. */}
              <span className="truncate text-xs text-gryt-muted">
                {overruled
                  ? global === "none"
                    ? "Muted by your global level"
                    : "Limited to mentions by your global level"
                  : host}
              </span>
            </div>
            <Select
              size="small"
              className="w-40 shrink-0"
              value={own ?? "default"}
              onValueChange={(value) =>
                setNotificationLevel(
                  host,
                  { kind: "server" },
                  value === "default" ? null : (value as NotificationLevel),
                )
              }
              options={CHOICES}
            />
          </div>
        );
      })}
    </div>
  );
}
