import { useCallback, useMemo } from "react";

import { useUnreadTracker } from "@/common";

import { useDirectory } from "./dmDirectory";

/**
 * Unread direct messages, counted off the directory rather than off an id
 * prefix, so it follows whatever the server calls a conversation (GRYT-1134).
 */
export function useDirectoryUnread(): {
  /** Every unread direct message on every connected server. */
  total: number;
  /** One conversation's own count. */
  countFor: (host: string, conversationId: string) => number;
} {
  const directory = useDirectory();
  const { channelUnreadCount } = useUnreadTracker();

  const total = useMemo(
    () =>
      directory.reduce(
        (sum, entry) => sum + channelUnreadCount(entry.host, entry.conversation.conversation_id),
        0,
      ),
    [directory, channelUnreadCount],
  );

  const countFor = useCallback(
    (host: string, conversationId: string) => channelUnreadCount(host, conversationId),
    [channelUnreadCount],
  );

  return { total, countFor };
}
