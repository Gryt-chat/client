import { Select } from "@gryt/ui";
import { useSyncExternalStore } from "react";

import {
  getStoredSnapshot,
  type NotificationLevel,
  setNotificationLevel,
  subscribeToPrefs,
} from "@/common";
import { useServerManagement, useSockets } from "@/socket";

const CHOICES: { label: string; value: string }[] = [
  { label: "Default", value: "default" },
  { label: "Everything", value: "all" },
  { label: "Only mentions", value: "mentions" },
  { label: "Nothing", value: "none" },
];

interface Override {
  host: string;
  kind: "channel" | "folder";
  id: string;
  level: NotificationLevel;
}

/**
 * Every channel and folder set to something of its own, across servers (GRYT-1771).
 * Set one back to Default and it leaves the list.
 */
export function NotificationOverrideList() {
  const stored = useSyncExternalStore(subscribeToPrefs, getStoredSnapshot, getStoredSnapshot);
  const { servers, orderedServerHosts } = useServerManagement();
  const { serverDetailsList } = useSockets();

  const overrides: Override[] = orderedServerHosts.flatMap((host) => {
    const prefs = stored.servers[host];
    if (!prefs) return [];
    return [
      ...Object.entries(prefs.folders ?? {}).map(([id, level]) => ({ host, kind: "folder" as const, id, level })),
      ...Object.entries(prefs.channels ?? {}).map(([id, level]) => ({ host, kind: "channel" as const, id, level })),
    ];
  });

  if (overrides.length === 0) {
    return (
      <span className="text-xs text-gryt-muted">
        None yet. Right-click a channel or folder to set it differently from its server.
      </span>
    );
  }

  /* A server that hasn't answered this session has no channel list yet, so a name can be missing. */
  const nameOf = ({ host, kind, id }: Override) => {
    const details = serverDetailsList[host];
    if (kind === "channel") {
      const channel = details?.channels.find((c) => c.id === id);
      return channel ? `#${channel.name}` : "A channel";
    }
    return details?.sidebar_items?.find((i) => i.id === id)?.label || "A folder";
  };

  return (
    <div className="flex flex-col gap-1">
      {overrides.map((o) => (
        <div
          key={`${o.host} ${o.kind} ${o.id}`}
          className="flex flex-wrap items-center gap-3 rounded-(--gryt-radius-md) px-2 py-1.5"
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm">{nameOf(o)}</span>
            <span className="truncate text-xs text-gryt-muted">
              {o.kind === "folder" ? "Folder on " : ""}
              {servers[o.host]?.name || o.host}
            </span>
          </div>
          <Select
            size="small"
            className="w-40 shrink-0 max-[339px]:w-full"
            value={o.level}
            onValueChange={(value) =>
              setNotificationLevel(
                o.host,
                { kind: o.kind, id: o.id },
                value === "default" ? null : (value as NotificationLevel),
              )
            }
            options={CHOICES}
          />
        </div>
      ))}
    </div>
  );
}
