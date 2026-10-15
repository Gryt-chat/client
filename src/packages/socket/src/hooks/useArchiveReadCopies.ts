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
}: {
  host: string | undefined;
  conversationId: string | undefined;
  isConversation: boolean;
  messages: ChatMessage[];
}): void {
  /** `message_id:edited_at`, so a message is written once and again only when edited. */
  const written = useRef(new Set<string>());

  useEffect(() => {
    if (!host || !conversationId || !isConversation) return;
    const fresh = messages.filter(
      (m) => m.conversation_id === conversationId && copyable(m) && !written.current.has(`${m.message_id}:${m.edited_at ?? ""}`),
    );
    if (fresh.length === 0) return;
    const timer = setTimeout(() => {
      void openLocalArchive()
        .then(async (archive) => {
          const scope = identityScopeFor(host);
          await archive.messages.put(
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
        })
        .catch((e) => console.warn("[Archive] Couldn't keep a copy for search:", e));
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [host, conversationId, isConversation, messages]);
}

/** A deleted message leaves search too. */
export function forgetArchivedCopy(host: string, conversationId: string, messageId: string): void {
  void openLocalArchive()
    .then((archive) => archive.messages.remove(identityScopeFor(host), conversationId, messageId))
    .catch(() => {});
}
