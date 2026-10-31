import { acceptImport, applyMlsReaction, type MlsDmContent, type MlsHistoryReaction } from "@gryt/core";

import type { ArchivedMessage, MessageArchive } from "@/common";

/** A shared copy's reactions in the shape the archive keeps. */
export function archivedReactions(reactions: MlsHistoryReaction[]): NonNullable<ArchivedMessage["reactions"]> {
  return reactions.map((r) => ({ src: r.emoji, amount: r.users.length, users: r.users }));
}

/**
 * One decrypted message into the archive. Only the sender can edit or delete a message, and
 * a peer can't overwrite one of your messages by reusing its id. Anyone in it can react.
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
  if (content.type === "import") {
    // Every entry is filed under whoever sent the batch, never a sender it claims.
    const fresh: ArchivedMessage[] = [];
    for (const e of acceptImport(content, { senderId, at })) {
      if (await messages.get(scope, conversationId, e.id)) continue;
      fresh.push({ scope, conversationId, messageId: e.id, sentAt: e.sentAt, senderId, text: e.text, attachments: e.attachments ?? {}, importedFrom: content.source, receivedAt: at });
    }
    if (fresh.length) await messages.put(fresh);
    return;
  }
  if (content.type === "history") {
    // Their record, kept as theirs: it never replaces a message this device already has.
    const fresh: ArchivedMessage[] = [];
    for (const e of content.entries) {
      if (await messages.get(scope, conversationId, e.id)) continue;
      const record: ArchivedMessage = {
        scope, conversationId, messageId: e.id, sentAt: e.sentAt, senderId: e.senderId,
        text: e.text, attachments: e.attachments ?? {}, sharedBy: senderId, receivedAt: at,
      };
      if (e.replyTo) record.replyTo = e.replyTo;
      if (e.reactions) record.reactions = archivedReactions(e.reactions);
      fresh.push(record);
    }
    if (fresh.length) await messages.put(fresh);
    return;
  }
  const existing = await messages.get(scope, conversationId, content.id);
  if (content.type === "reaction") {
    // A reaction to something this device never had has nothing to go on.
    if (!existing) return;
    const reactions = applyMlsReaction(existing.reactions, { emoji: content.emoji, userId: senderId, action: content.action });
    const next: ArchivedMessage = { ...existing, reactions };
    if (!reactions.length) delete next.reactions;
    await messages.put([next]);
    return;
  }
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
    if (existing?.reactions?.length) record.reactions = existing.reactions;
    await messages.put([record]);
  } else if (!existing) {
    // An edit or delete for something this phone never had.
  } else if (content.type === "edit") {
    await messages.put([{ ...existing, text: content.text, editedAt: at }]);
  } else {
    await messages.remove(scope, conversationId, content.id);
  }
}
