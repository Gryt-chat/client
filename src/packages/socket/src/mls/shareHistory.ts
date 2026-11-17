import { historyBatches, type MlsHistoryEntry, type ReencryptCandidate } from "@gryt/core";

import type { ArchiveCursor, ArchivedMessage, MessageArchive, OpenedMessage } from "@/common";

import type { MlsSource } from "./serverMls";

/** Every MLS message this device has in one DM, oldest first. Server-held copies stay out. */
async function wholeConversation(archive: Pick<MessageArchive, "page">, scope: string, conversationId: string): Promise<ArchivedMessage[]> {
  const out: ArchivedMessage[] = [];
  let before: ArchiveCursor | undefined;
  for (;;) {
    const page = await archive.page(scope, conversationId, { before, limit: 500 });
    if (!page.length) break;
    out.unshift(...page.filter((m) => !m.copy && !m.outbox));
    before = { sentAt: page[0].sentAt, messageId: page[0].messageId };
  }
  return out;
}

/* `chat:fetch` allows 15 in 10 s. */
const FETCH_GAP_MS = 700;

/** The server's sealed messages this device can still open, for a peer whose own key is gone (GRYT-2139). */
export async function openedSealedHistory(
  fetchOlder: (before: string | undefined) => Promise<{ items: ReencryptCandidate[]; hasMore: boolean }>,
  open: (sealed: string) => Promise<OpenedMessage | null>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<MlsHistoryEntry[]> {
  const out: MlsHistoryEntry[] = [];
  let before: string | undefined;
  for (;;) {
    const { items, hasMore } = await fetchOlder(before);
    for (const m of items) {
      if (!m.sealed) continue;
      const opened = await open(m.sealed).catch(() => null);
      if (!opened) continue;
      out.push({
        id: m.message_id,
        senderId: m.sender_server_id,
        sentAt: new Date(m.created_at).getTime(),
        text: opened.text,
        ...(m.reply_to_message_id ? { replyTo: m.reply_to_message_id } : {}),
        ...(Object.keys(opened.attachments).length ? { attachments: opened.attachments } : {}),
      });
    }
    if (!hasMore || !items.length) return out;
    before = items.map((m) => new Date(m.created_at).toISOString()).sort()[0];
    await sleep(FETCH_GAP_MS);
  }
}

/** "Send them your copy" (GRYT-1875): this DM's history, in batches over MLS. Returns how many went. */
export async function shareHistory(
  source: Pick<MlsSource, "send" | "storeScope">,
  archive: Pick<MessageArchive, "page">,
  conversationId: string,
  peer: string,
  older: MlsHistoryEntry[] = [],
): Promise<number> {
  const archived: MlsHistoryEntry[] = (await wholeConversation(archive, source.storeScope, conversationId)).map((m) => ({
    id: m.messageId,
    senderId: m.senderId,
    sentAt: m.sentAt,
    text: m.text,
    ...(m.replyTo ? { replyTo: m.replyTo } : {}),
    ...(Object.keys(m.attachments).length ? { attachments: m.attachments } : {}),
  }));
  const have = new Set(archived.map((e) => e.id));
  const entries = [...older.filter((e) => !have.has(e.id)), ...archived].sort((a, b) => a.sentAt - b.sentAt);
  if (!entries.length) return 0;
  const batches = historyBatches(entries, () => crypto.randomUUID());
  for (const batch of batches) await source.send(conversationId, peer, batch);
  return batches.reduce((n, b) => n + b.entries.length, 0);
}
