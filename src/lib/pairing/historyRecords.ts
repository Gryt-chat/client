import type { HistoryRecord } from "@gryt/crypto";

import type { ArchivedMessage } from "@/common";

/* Archive records as they cross in a pairing's history (GRYT-1484). The phone uses the same
   shape, so either app can send to the other. */

type Body = Omit<ArchivedMessage, "scope" | "conversationId" | "messageId" | "sentAt">;

export function toHistoryRecord(m: ArchivedMessage): HistoryRecord {
  const { scope, conversationId, messageId, sentAt, ...rest } = m;
  const message: Body = { senderId: rest.senderId, text: rest.text, attachments: rest.attachments };
  if (rest.senderDeviceId !== undefined) message.senderDeviceId = rest.senderDeviceId;
  if (rest.editedAt !== undefined) message.editedAt = rest.editedAt;
  if (rest.replyTo !== undefined) message.replyTo = rest.replyTo;
  if (rest.reactions?.length) message.reactions = rest.reactions;
  return { scope, conversationId, messageId, sentAt, message };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function reactionsOf(v: unknown): ArchivedMessage["reactions"] {
  if (!Array.isArray(v)) return undefined;
  const ok = v.filter(
    (r): r is { src: string; amount: number; users: string[] } =>
      isObject(r) && typeof r.src === "string" && typeof r.amount === "number" &&
      Array.isArray(r.users) && r.users.every((u) => typeof u === "string"),
  );
  return ok.length ? ok.map(({ src, amount, users }) => ({ src, amount, users })) : undefined;
}

// An attachment that can't be opened is dropped, not the message it came with.
function attachmentsOf(v: Record<string, unknown>): ArchivedMessage["attachments"] {
  const out: ArchivedMessage["attachments"] = {};
  for (const [fileId, key] of Object.entries(v)) {
    if (isObject(key) && typeof key.id === "string" && typeof key.key === "string") out[fileId] = key as unknown as ArchivedMessage["attachments"][string];
  }
  return out;
}

/** Null for a record that isn't a message this app can show. Bad optional fields are dropped. */
export function fromHistoryRecord(r: HistoryRecord): ArchivedMessage | null {
  const m = r.message;
  if (!isObject(m) || typeof m.senderId !== "string" || typeof m.text !== "string" || !isObject(m.attachments)) return null;
  const out: ArchivedMessage = {
    scope: r.scope,
    conversationId: r.conversationId,
    messageId: r.messageId,
    sentAt: r.sentAt,
    senderId: m.senderId,
    text: m.text,
    attachments: attachmentsOf(m.attachments),
  };
  if (typeof m.senderDeviceId === "string") out.senderDeviceId = m.senderDeviceId;
  if (typeof m.editedAt === "number") out.editedAt = m.editedAt;
  if (typeof m.replyTo === "string") out.replyTo = m.replyTo;
  const reactions = reactionsOf(m.reactions);
  if (reactions) out.reactions = reactions;
  return out;
}
