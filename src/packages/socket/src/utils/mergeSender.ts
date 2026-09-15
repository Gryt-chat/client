import type { ChatMessage } from "../components/chatUtils";

/** A guest folded into an account on the server. A row that never named the guest
    comes back as the same object, so nothing re-renders for it. */
export function mergeSender(message: ChatMessage, from: string, to: string): ChatMessage {
  const sent = message.sender_server_id === from;
  const reacted = message.reactions?.some((r) => r.users?.includes(from)) ?? false;
  if (!sent && !reacted) return message;

  return {
    ...message,
    sender_server_id: sent ? to : message.sender_server_id,
    reactions:
      reacted && message.reactions
        ? message.reactions.map((r) => {
            if (!r.users?.includes(from)) return r;
            // Somebody who reacted as both the guest and the account counts once.
            const users = [...new Set(r.users.map((u) => (u === from ? to : u)))];
            return { ...r, users, amount: users.length };
          })
        : message.reactions,
  };
}

export function mergeSenders(messages: ChatMessage[], from: string, to: string): ChatMessage[] {
  let changed = false;
  const next = messages.map((m) => {
    const merged = mergeSender(m, from, to);
    if (merged !== m) changed = true;
    return merged;
  });
  return changed ? next : messages;
}
