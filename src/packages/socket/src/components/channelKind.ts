import type { NotificationLevel } from "@/common";

/**
 * The four things a channel can be, and the fields they map to. Out of the picker
 * so both dialogs and the sidebar editor can import the mapping.
 */
export type ChannelKind = "chat" | "voice" | "forum" | "automated";

/** What a kind starts at: an automated channel is quiet until somebody says otherwise. */
export function defaultLevelForKind(kind: ChannelKind): NotificationLevel {
  return kind === "automated" ? "none" : "all";
}

/** The same three words as the member's own menu, so the two read alike. */
export const NOTIFICATION_LEVEL_OPTIONS: { label: string; value: NotificationLevel }[] = [
  { label: "Everything", value: "all" },
  { label: "Only mentions", value: "mentions" },
  { label: "Nothing", value: "none" },
];

export function kindToFields(kind: ChannelKind): {
  type: "text" | "voice";
  layout: "chat" | "forum";
  automated: boolean;
} {
  switch (kind) {
    case "voice": return { type: "voice", layout: "chat", automated: false };
    case "forum": return { type: "text", layout: "forum", automated: false };
    case "automated": return { type: "text", layout: "chat", automated: true };
    default: return { type: "text", layout: "chat", automated: false };
  }
}

export function fieldsToKind(fields: {
  type?: "text" | "voice";
  layout?: "chat" | "forum";
  automated?: boolean;
}): ChannelKind {
  if (fields.type === "voice") return "voice";
  if (fields.automated) return "automated";
  if (fields.layout === "forum") return "forum";
  return "chat";
}
