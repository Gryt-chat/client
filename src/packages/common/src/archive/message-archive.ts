import type { SealedAttachmentKey } from "@gryt/crypto";

import { openBytes, sealBytes, type SealedBytes } from "../auth/archive-key.ts";
import { committed, MESSAGE_BY_TIME, MESSAGE_STORE, request } from "./archive-db.ts";

/** A message this device decrypted. MLS deletes the key after use, so this copy is the only one. */
export interface ArchivedMessage {
  /** The server, as `identityScopeFor` names it. Conversation ids are only unique per server. */
  scope: string;
  conversationId: string;
  messageId: string;
  /** The server's timestamp in ms. Paging orders by it, then by `messageId`. */
  sentAt: number;
  senderId: string;
  senderDeviceId?: string;
  text: string;
  attachments: Record<string, SealedAttachmentKey>;
  editedAt?: number;
  /** The message this one answers, by `messageId`. */
  replyTo?: string;
  /** Reactions sent over MLS, in the server's shape. Left off when there are none. */
  reactions?: { src: string; amount: number; users: string[] }[];
}

type MessageBody = Pick<ArchivedMessage, "senderId" | "senderDeviceId" | "text" | "attachments" | "editedAt" | "replyTo" | "reactions">;

/** Ids and time stay readable for the indexes; the server already knows all four. */
interface StoredMessage {
  scope: string;
  conversationId: string;
  messageId: string;
  sentAt: number;
  plain?: MessageBody;
  sealed?: SealedBytes;
}

export interface ArchiveCursor {
  sentAt: number;
  messageId: string;
}

export interface ArchiveChange {
  scope: string;
  /** Null when the whole server's history was wiped. */
  conversationId: string | null;
}

const CHANNEL = "gryt-archive";

function context(m: Pick<StoredMessage, "scope" | "conversationId" | "messageId" | "sentAt">): string {
  return `message:${JSON.stringify([m.scope, m.conversationId, m.messageId, m.sentAt])}`;
}

function conversationRange(scope: string, conversationId: string, before?: ArchiveCursor): IDBKeyRange {
  // An empty array sorts after every string and number, so it closes the range.
  const upper = before ? [scope, conversationId, before.sentAt, before.messageId] : [scope, conversationId, []];
  return IDBKeyRange.bound([scope, conversationId], upper, false, !!before);
}

export class MessageArchive {
  private readonly db: IDBDatabase;
  private readonly key: CryptoKey | null;
  private readonly listeners = new Set<(change: ArchiveChange) => void>();
  private readonly channel: BroadcastChannel | null;

  /** A null key keeps records in the clear, which is what the web client does. */
  constructor(db: IDBDatabase, key: CryptoKey | null) {
    this.db = db;
    this.key = key;
    this.channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL) : null;
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent<ArchiveChange>) => this.emit(event.data);
    }
  }

  get sealed(): boolean {
    return this.key !== null;
  }

  /** Writes in one transaction, replacing any record with the same ids (an edit). */
  async put(messages: ArchivedMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const rows = await Promise.all(messages.map((m) => this.toStored(m)));

    const tx = this.db.transaction(MESSAGE_STORE, "readwrite");
    const store = tx.objectStore(MESSAGE_STORE);
    for (const row of rows) store.put(row);
    await committed(tx);

    const seen = new Set<string>();
    for (const m of messages) {
      const id = JSON.stringify([m.scope, m.conversationId]);
      if (seen.has(id)) continue;
      seen.add(id);
      this.announce({ scope: m.scope, conversationId: m.conversationId });
    }
  }

  async get(scope: string, conversationId: string, messageId: string): Promise<ArchivedMessage | null> {
    const tx = this.db.transaction(MESSAGE_STORE, "readonly");
    const row = await request<StoredMessage | undefined>(
      tx.objectStore(MESSAGE_STORE).get([scope, conversationId, messageId]),
    );
    return row ? this.fromStored(row) : null;
  }

  /**
   * Up to `limit` messages sent before `before`, oldest first. Pass the first one
   * back as `before` to page further up. Records that fail to open are skipped.
   */
  async page(
    scope: string,
    conversationId: string,
    { before, limit = 50 }: { before?: ArchiveCursor; limit?: number } = {},
  ): Promise<ArchivedMessage[]> {
    const tx = this.db.transaction(MESSAGE_STORE, "readonly");
    const index = tx.objectStore(MESSAGE_STORE).index(MESSAGE_BY_TIME);
    const rows: StoredMessage[] = [];

    await new Promise<void>((resolve, reject) => {
      const cursor = index.openCursor(conversationRange(scope, conversationId, before), "prev");
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at || rows.length >= limit) return resolve();
        rows.push(at.value as StoredMessage);
        at.continue();
      };
    });

    const opened = await Promise.all(rows.reverse().map((row) => this.fromStored(row)));
    return opened.filter((m): m is ArchivedMessage => m !== null);
  }

  /** Every conversation with anything in it, and how many messages it holds. For pairing's history. */
  async conversations(): Promise<{ scope: string; conversationId: string; count: number }[]> {
    const tx = this.db.transaction(MESSAGE_STORE, "readonly");
    const store = tx.objectStore(MESSAGE_STORE);
    const found: { scope: string; conversationId: string; count: number }[] = [];

    await new Promise<void>((resolve, reject) => {
      const cursor = store.openKeyCursor();
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at) return resolve();
        const [scope, conversationId] = at.key as [string, string, string];
        const entry = { scope, conversationId, count: 0 };
        found.push(entry);
        const counted = store.count(IDBKeyRange.bound([scope, conversationId], [scope, conversationId, []]));
        counted.onsuccess = () => void (entry.count = counted.result);
        // Skip the rest of this conversation: an empty array sorts after every message id.
        at.continue([scope, conversationId, []]);
      };
    });
    // Requests in one transaction run in order, so every count is in before the cursor ends.
    return found;
  }

  async remove(scope: string, conversationId: string, messageId: string): Promise<void> {
    const tx = this.db.transaction(MESSAGE_STORE, "readwrite");
    tx.objectStore(MESSAGE_STORE).delete([scope, conversationId, messageId]);
    await committed(tx);
    this.announce({ scope, conversationId });
  }

  async removeConversation(scope: string, conversationId: string): Promise<void> {
    const tx = this.db.transaction(MESSAGE_STORE, "readwrite");
    tx.objectStore(MESSAGE_STORE).delete(IDBKeyRange.bound([scope, conversationId], [scope, conversationId, []]));
    await committed(tx);
    this.announce({ scope, conversationId });
  }

  /** After `wipeServer`, which deletes the rows itself alongside the MLS state. */
  announceWiped(scope: string): void {
    this.announce({ scope, conversationId: null });
  }

  /** Fires for writes from this tab and from any other tab on the same archive. */
  onChange(listener: (change: ArchiveChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.channel?.close();
    this.listeners.clear();
  }

  private announce(change: ArchiveChange): void {
    this.emit(change);
    this.channel?.postMessage(change);
  }

  private emit(change: ArchiveChange): void {
    for (const listener of this.listeners) listener(change);
  }

  private async toStored(m: ArchivedMessage): Promise<StoredMessage> {
    const row: StoredMessage = {
      scope: m.scope,
      conversationId: m.conversationId,
      messageId: m.messageId,
      sentAt: m.sentAt,
    };
    const body: MessageBody = { senderId: m.senderId, text: m.text, attachments: m.attachments };
    if (m.senderDeviceId !== undefined) body.senderDeviceId = m.senderDeviceId;
    if (m.editedAt !== undefined) body.editedAt = m.editedAt;
    if (m.replyTo !== undefined) body.replyTo = m.replyTo;
    if (m.reactions?.length) body.reactions = m.reactions;

    if (!this.key) {
      row.plain = body;
    } else {
      const bytes = new TextEncoder().encode(JSON.stringify(body));
      row.sealed = await sealBytes(this.key, context(row), bytes);
    }
    return row;
  }

  private async fromStored(row: StoredMessage): Promise<ArchivedMessage | null> {
    const ids = { scope: row.scope, conversationId: row.conversationId, messageId: row.messageId, sentAt: row.sentAt };
    if (row.plain) return { ...ids, ...row.plain };
    // A sealed record with no key is one this archive can't read, not one that isn't there.
    if (!row.sealed || !this.key) return null;
    try {
      const bytes = await openBytes(this.key, context(row), row.sealed);
      return { ...ids, ...(JSON.parse(new TextDecoder().decode(bytes)) as MessageBody) };
    } catch (e) {
      console.warn("[Archive] Skipped a message that didn't open:", row.conversationId, row.messageId, e);
      return null;
    }
  }
}
