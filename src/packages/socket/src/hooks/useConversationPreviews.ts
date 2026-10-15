import { useEffect, useState } from "react";

import { getOwnServerUserId, identityScopeFor, openLocalArchive } from "@/common";

import type { DirectoryEntry } from "./dmDirectory";

/** The last message this device holds for a conversation, as one line for its row. */
export interface ConversationPreview {
  text: string;
  sentAt: number;
}

function key(host: string, conversationId: string): string {
  return `${host}/${conversationId}`;
}

/** "You: …" for yours, "Name: …" in a group, the bare text from the other person in a 1:1. */
export function previewLine(
  entry: DirectoryEntry,
  message: { senderId: string; text: string; attachments: Record<string, unknown> },
  ownId: string | undefined,
): string {
  const body = message.text.trim().replace(/\s+/g, " ") || (Object.keys(message.attachments).length > 0 ? "Sent a file" : "");
  if (!body) return "";
  if (ownId && message.senderId === ownId) return `You: ${body}`;
  if (entry.conversation.kind !== "group") return body;
  const who = entry.conversation.members.find((m) => m.server_user_id === message.senderId)?.nickname;
  return who ? `${who}: ${body}` : body;
}

/**
 * Previews read from this device's message archive and nowhere else, so a
 * conversation from before this device joined has none (the footer says so).
 */
export function useConversationPreviews(entries: DirectoryEntry[]): ReadonlyMap<string, ConversationPreview> {
  const [previews, setPreviews] = useState<ReadonlyMap<string, ConversationPreview>>(new Map());
  const wanted = entries.map((e) => key(e.host, e.conversation.conversation_id)).join("\n");

  useEffect(() => {
    let live = true;
    let off = () => {};
    const byScope = new Map(entries.map((e) => [key(identityScopeFor(e.host), e.conversation.conversation_id), e]));

    void openLocalArchive()
      .then((archive) => {
        if (!live) return;
        const load = async (only?: DirectoryEntry[]) => {
          const found = await Promise.all(
            (only ?? entries).map(async (entry) => {
              const [last] = await archive.messages.page(identityScopeFor(entry.host), entry.conversation.conversation_id, { limit: 1 });
              const text = last ? previewLine(entry, last, getOwnServerUserId(entry.host)) : "";
              return [key(entry.host, entry.conversation.conversation_id), last && text ? { text, sentAt: last.sentAt } : null] as const;
            }),
          );
          if (!live) return;
          setPreviews((prev) => {
            const next = new Map(only ? prev : []);
            for (const [k, p] of found) {
              if (p) next.set(k, p);
              else next.delete(k);
            }
            return next;
          });
        };
        void load();
        off = archive.messages.onChange((change) => {
          if (change.conversationId === null) return void load();
          const entry = byScope.get(key(change.scope, change.conversationId));
          if (entry) void load([entry]);
        });
      })
      .catch(() => {
        // No archive on this device (locked, or never set up): rows go without previews.
      });

    return () => {
      live = false;
      off();
    };
    // `wanted` is the identity of `entries`; the array itself is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  return previews;
}

export { key as previewKey };
