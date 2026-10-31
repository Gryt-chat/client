import { historyBatches, type MlsHistoryEntry } from "@gryt/core";

import type { ArchivedMessage, MessageArchive } from "@/common";

import type { ChatMessage } from "../components/chatUtils";
import type { MlsSource } from "./serverMls";

/* `chat:delete` scores 1 and decays one per 3 s (RL_DELETE); `chat:fetch` allows 15 in 10 s. */
const DELETE_GAP_MS = 3_100;
const FETCH_GAP_MS = 700;

export const reencryptedId = (messageId: string) => `re-${messageId}`;

export interface ReencryptDeps {
  source: Pick<MlsSource, "send" | "storeScope">;
  archive: Pick<MessageArchive, "put">;
  fetchOlder: (before: string | undefined) => Promise<{ items: ChatMessage[]; hasMore: boolean }>;
  remove: (messageId: string) => void;
  sleep: (ms: number) => Promise<void>;
  stopped: () => boolean;
  report: (done: number, total: number) => void;
}

/** Plain text only: files, polls, cards and pins can't travel in a history entry, so they stay. */
function canMove(m: ChatMessage, me: string): boolean {
  return m.sender_server_id === me && !!m.text && !m.mls && !m.sealed && !m.mls_placeholder
    && !m.attachments?.length && !m.poll && !m.cards?.length && !m.pinned_at && !m.thread_id;
}

async function plaintextOfMine(deps: ReencryptDeps, me: string): Promise<ChatMessage[]> {
  const out: ChatMessage[] = [];
  let before: string | undefined;
  for (;;) {
    const { items, hasMore } = await deps.fetchOlder(before);
    out.push(...items.filter((m) => canMove(m, me)));
    if (!hasMore || !items.length || deps.stopped()) return out;
    before = items.map((m) => new Date(m.created_at).toISOString()).sort()[0];
    await deps.sleep(FETCH_GAP_MS);
  }
}

/**
 * Sends this person's plaintext as history over MLS, and removes each one only after its
 * batch went. New ids, so re-running repeats nothing and `chat:deleted` can't take the copy.
 */
export async function reencryptMine(deps: ReencryptDeps, me: string, conversationId: string, peer: string): Promise<number> {
  const mine = await plaintextOfMine(deps, me);
  const ids = new Set(mine.map((m) => m.message_id));
  const originals = new Map(mine.map((m) => [reencryptedId(m.message_id), m.message_id]));
  const entries: MlsHistoryEntry[] = mine.map((m) => {
    const reply = m.reply_to_message_id;
    return {
      id: reencryptedId(m.message_id),
      senderId: me,
      sentAt: new Date(m.created_at).getTime(),
      text: m.text ?? "",
      ...(reply ? { replyTo: ids.has(reply) ? reencryptedId(reply) : reply } : {}),
    };
  });
  const batches = historyBatches(entries, () => crypto.randomUUID());
  const total = batches.reduce((n, b) => n + b.entries.length, 0);
  let done = 0;
  deps.report(done, total);
  for (const batch of batches) {
    if (deps.stopped()) return done;
    await deps.source.send(conversationId, peer, batch);
    const receivedAt = Date.now();
    await deps.archive.put(batch.entries.map((e): ArchivedMessage => ({
      scope: deps.source.storeScope, conversationId, messageId: e.id, sentAt: e.sentAt, senderId: me,
      text: e.text, attachments: {}, sharedBy: me, receivedAt, ...(e.replyTo ? { replyTo: e.replyTo } : {}),
    })));
    for (const e of batch.entries) {
      deps.remove(originals.get(e.id) as string);
      deps.report(++done, total);
      await deps.sleep(DELETE_GAP_MS);
    }
  }
  return done;
}
