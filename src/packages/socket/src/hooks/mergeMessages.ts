import type { ChatMessage } from "../components/chatUtils";

/** Milliseconds, with nothing or an unreadable date counting as the epoch, as the server reads one. */
function millis(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const ms = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * The server's order: oldest first, and the lower id first on the same millisecond.
 * A pending message has no server time yet, so it goes after everything that does.
 */
function compareMessages(a: ChatMessage, b: ChatMessage): number {
  if (!!a.pending !== !!b.pending) return a.pending ? 1 : -1;
  const diff = millis(a.created_at) - millis(b.created_at);
  if (diff !== 0) return diff;
  return a.message_id < b.message_id ? -1 : a.message_id > b.message_id ? 1 : 0;
}

/**
 * What is held and what just arrived, as one list in that order. The held copy of a
 * message wins unless the arriving one was edited later, and `deleted` ids stay out.
 */
export function mergeMessages(
  held: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
  deleted?: ReadonlySet<string>,
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of held) {
    if (!deleted?.has(message.message_id)) byId.set(message.message_id, message);
  }
  for (const message of incoming) {
    if (deleted?.has(message.message_id)) continue;
    const kept = byId.get(message.message_id);
    if (!kept || millis(message.edited_at) > millis(kept.edited_at)) byId.set(message.message_id, message);
  }
  return [...byId.values()].sort(compareMessages);
}
