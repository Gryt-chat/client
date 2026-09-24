import type { WebhookCardData } from "@gryt/ui";

import { massMentionHits, type MentionViewer } from "../../../lib/mentionTokens.ts";
import type { StoredWebhookCard } from "../components/chatUtils";

type MessageText = {
  text: string | null;
  text_fallback?: boolean;
};

/** Whether the row draws `text`. A fallback line is for clients that cannot draw the cards. */
export function drawsMessageText(message: MessageText): boolean {
  return message.text_fallback !== true;
}

/** Whether this message names the viewer. Only `text` can, and a fallback line never does.
    `mass` is passed in a channel, where @everyone, @here and roles can ping. */
export function mentionsViewer(
  message: MessageText & { sender_server_id?: string | null },
  viewerId: string | undefined,
  mass?: MentionViewer,
): boolean {
  if (!viewerId || !message.text || message.text_fallback === true) return false;
  if (message.text.includes(`mention:${viewerId}`)) return true;
  const sender = message.sender_server_id;
  const person = !!sender && sender !== "system" && !sender.startsWith("webhook:");
  return !!mass && person && massMentionHits(message.text, mass);
}

/** Icons draw at 16px, so they can load a thumbnail. The pictures a person can open cannot. */
export type CardFileKind = "icon" | "picture";

/** A stored card with each file id turned into a URL the component can load. */
export function toWebhookCardData(
  card: StoredWebhookCard,
  fileUrl: (fileId: string, kind: CardFileKind) => string,
): WebhookCardData {
  const url = (fileId: string | undefined, kind: CardFileKind) => (fileId ? fileUrl(fileId, kind) : undefined);
  return {
    title: card.title,
    url: card.url,
    description: card.description,
    color: card.color,
    author: card.author
      ? { name: card.author.name, url: card.author.url, iconUrl: url(card.author.icon_file_id, "icon") }
      : undefined,
    fields: card.fields?.map((field) => ({ name: field.name, value: field.value, inline: field.inline })),
    imageUrl: url(card.image_file_id, "picture"),
    thumbnailUrl: url(card.thumbnail_file_id, "picture"),
    footer: card.footer ? { text: card.footer.text, iconUrl: url(card.footer.icon_file_id, "icon") } : undefined,
    timestamp: card.timestamp,
  };
}
