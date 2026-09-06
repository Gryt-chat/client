/**
 * The four things a channel can be, as the person making one thinks of them,
 * and the mapping to the fields actually stored: `type` (text/voice) plus
 * `layout` and `automated` on a text channel. Kept out of the picker component
 * so both dialogs and the sidebar editor can import the mapping without
 * dragging a component along. GRYT-981 / GRYT-982 / GRYT-983.
 */
export type ChannelKind = "chat" | "voice" | "forum" | "automated";

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
