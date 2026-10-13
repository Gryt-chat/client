import type { WebhookCardData } from "@gryt/ui";

import { massMentionHits, type MentionViewer } from "../../../lib/mentionTokens.ts";
import type { StoredWebhookCard } from "../components/chatUtils";

type MessageText = {
  text: string | null;
  text_fallback?: boolean;
  kind?: string;
  poll?: unknown;
};

/** The kinds of message this app draws. Anything else gets a line saying to update. */
export const KNOWN_KINDS: readonly string[] = ["poll"];

/** A message of a kind added after this version. Its `text` is for apps from before kinds existed. */
export function isUnknownKind(message: MessageText): boolean {
  return !!message.kind && !KNOWN_KINDS.includes(message.kind);
}

/** What the row says in place of a message it can't draw. Plugin kinds are `plugin:<id>:<name>`. */
export function unknownKindNotice(kind: string): string {
  const plugin = /^plugin:([^:]+):/.exec(kind)?.[1];
  return plugin
    ? `This message is from the ${plugin} plugin, which this app doesn't have.`
    : "This message needs a newer version of Gryt. Update to see it.";
}

/** Whether the row draws `text`. Cards, polls and unknown kinds stand in for it. */
export function drawsMessageText(message: MessageText): boolean {
  return message.text_fallback !== true && !message.kind && !message.poll;
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
