import { historyBatches, type MlsHistoryEntry } from "@gryt/core";

import type { ArchiveCursor, ArchivedMessage, MessageArchive } from "@/common";

import type { MlsSource } from "./serverMls";

/** Every MLS message this device has in one DM, oldest first. Server-held copies stay out. */
async function wholeConversation(archive: Pick<MessageArchive, "page">, scope: string, conversationId: string): Promise<ArchivedMessage[]> {
  const out: ArchivedMessage[] = [];
  let before: ArchiveCursor | undefined;
  for (;;) {
    const page = await archive.page(scope, conversationId, { before, limit: 500 });
    if (!page.length) break;
    out.unshift(...page.filter((m) => !m.copy));
    before = { sentAt: page[0].sentAt, messageId: page[0].messageId };
  }
  return out;
}

/** "Send them your copy" (GRYT-1875): this DM's history, in batches over MLS. Returns how many went. */
export async function shareHistory(
  source: Pick<MlsSource, "send" | "storeScope">,
  archive: Pick<MessageArchive, "page">,
  conversationId: string,
  peer: string,
): Promise<number> {
  const entries: MlsHistoryEntry[] = (await wholeConversation(archive, source.storeScope, conversationId)).map((m) => ({
    id: m.messageId,
    senderId: m.senderId,
    sentAt: m.sentAt,
    text: m.text,
    ...(m.replyTo ? { replyTo: m.replyTo } : {}),
    ...(Object.keys(m.attachments).length ? { attachments: m.attachments } : {}),
  }));
  const batches = historyBatches(entries, () => crypto.randomUUID());
  for (const batch of batches) await source.send(conversationId, peer, batch);
  return batches.reduce((n, b) => n + b.entries.length, 0);
}
