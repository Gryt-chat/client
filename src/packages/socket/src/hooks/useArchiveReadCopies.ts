import { useEffect, useRef } from "react";

import { identityScopeFor, openLocalArchive } from "@/common";

import type { ChatMessage } from "../components/chatUtils";

/** Long enough that a page of history lands in one write rather than fifty. */
const SETTLE_MS = 1_000;

/** Readable here, sent by a person, and not an MLS row (those are archived already). */
function copyable(m: ChatMessage): boolean {
  if (m.mls || m.mls_placeholder || m.pending || m.failed || m.text_fallback) return false;
  if (m.sender_server_id === "system" || !m.text) return false;
  return !m.sealed || m.sealedState === "open";
}

/** Keeps this device's copy of the DM and group messages it has read, so search reaches
    conversations that aren't on MLS (GRYT-1760). Sealed at rest like the rest of the archive. */
export function useArchiveReadCopies({
  host,
  conversationId,
  isConversation,
  messages,
  span,
}: {
  host: string | undefined;
  conversationId: string | undefined;
  isConversation: boolean;
  messages: ChatMessage[];
  /** What `messages` covers, or null while it's still loading and can't vouch for anything. */
  span: { toPresent: boolean; fromStart: boolean } | null;
}): void {
  /** `message_id:edited_at`, so a message is written once and again only when edited. */
  const written = useRef(new Set<string>());

  useEffect(() => {
    if (!host || !conversationId || !isConversation) return;
    const fresh = messages.filter(
      (m) => m.conversation_id === conversationId && copyable(m) && !written.current.has(`${m.message_id}:${m.edited_at ?? ""}`),
    );
    const timer = setTimeout(() => {
      void openLocalArchive()
        .then(async (archive) => {
          const scope = identityScopeFor(host);
          if (fresh.length) await archive.messages.put(
            fresh.map((m) => ({
              scope,
              conversationId,
              messageId: m.message_id,
              sentAt: new Date(m.created_at).getTime(),
              senderId: m.sender_server_id,
              text: m.text ?? "",
              attachments: {},
              ...(m.edited_at ? { editedAt: new Date(m.edited_at).getTime() } : {}),
              ...(m.reply_to_message_id ? { replyTo: m.reply_to_message_id } : {}),
              copy: true as const,
            })),
          );
          for (const m of fresh) written.current.add(`${m.message_id}:${m.edited_at ?? ""}`);
          if (span) await pruneDeleted(archive, scope, conversationId, messages, span);
        })
        .catch((e) => console.warn("[Archive] Couldn't keep a copy for search:", e));
    }, SETTLE_MS);
    return () => clearTimeout(timer);
    // `span` is read through the messages it describes; they change together.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, conversationId, isConversation, messages, span === null]);
}

/** Copies inside the span the server just sent that it no longer has were deleted while we
    were away (GRYT-1761). Only that span: outside it, absent just means not loaded. */
async function pruneDeleted(
  archive: Awaited<ReturnType<typeof openLocalArchive>>,
  scope: string,
  conversationId: string,
  messages: ChatMessage[],
  span: { toPresent: boolean; fromStart: boolean },
): Promise<void> {
  const loaded = messages.filter((m) => m.conversation_id === conversationId && !m.pending && !m.failed && !m.mls);
  if (loaded.length === 0 && !(span.toPresent && span.fromStart)) return;
  const times = loaded.map((m) => new Date(m.created_at).getTime());
  const from = span.fromStart ? -Infinity : Math.min(...times);
  const to = span.toPresent ? Infinity : Math.max(...times);
  const present = new Set(loaded.map((m) => m.message_id));
  let before: { sentAt: number; messageId: string } | undefined;
  for (;;) {
    const page = await archive.messages.page(scope, conversationId, { before, limit: 500 });
    if (page.length === 0) return;
    for (const m of page) {
      if (m.copy && m.sentAt >= from && m.sentAt <= to && !present.has(m.messageId)) {
        await archive.messages.remove(scope, conversationId, m.messageId);
      }
    }
    if (page[0].sentAt < from) return;
    before = { sentAt: page[0].sentAt, messageId: page[0].messageId };
  }
}

/** A deleted message leaves search too. */
export function forgetArchivedCopy(host: string, conversationId: string, messageId: string): void {
  void openLocalArchive()
    .then((archive) => archive.messages.remove(identityScopeFor(host), conversationId, messageId))
    .catch(() => {});
}
