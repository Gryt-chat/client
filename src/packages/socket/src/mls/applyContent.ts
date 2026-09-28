import type { MlsDmContent } from "@gryt/core";

import type { ArchivedMessage, MessageArchive } from "@/common";

/**
 * One decrypted message into the archive. Only the sender can edit or delete a message, and
 * a peer can't overwrite one of your messages by reusing its id.
 */
export async function applyMlsContent(
  messages: Pick<MessageArchive, "get" | "put" | "remove">,
  {
    scope,
    conversationId,
    senderId,
    senderDeviceId,
    content,
    at,
  }: {
    scope: string;
    conversationId: string;
    senderId: string;
    senderDeviceId?: string;
    content: MlsDmContent;
    /** The server's time for it, in ms. */
    at: number;
  },
): Promise<void> {
  const existing = await messages.get(scope, conversationId, content.id);
  if (existing && existing.senderId !== senderId) return;

  if (content.type === "message") {
    const record: ArchivedMessage = {
      scope,
      conversationId,
      messageId: content.id,
      // A repeat after a crash keeps its first time, so it doesn't jump down the list.
      sentAt: existing?.sentAt ?? at,
      senderId,
      text: content.text,
      attachments: content.attachments ?? {},
    };
    if (senderDeviceId) record.senderDeviceId = senderDeviceId;
    if (content.replyTo) record.replyTo = content.replyTo;
    await messages.put([record]);
  } else if (!existing) {
    // An edit or delete for something this phone never had.
  } else if (content.type === "edit") {
    await messages.put([{ ...existing, text: content.text, editedAt: at }]);
  } else {
    await messages.remove(scope, conversationId, content.id);
  }
}
