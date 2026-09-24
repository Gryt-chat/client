import { useCallback, useMemo } from "react";

import { isChannelMuted, useThreadUnread, useUnreadTracker } from "@/common";

import { useDirectory } from "./dmDirectory";

/* Both counts read the same map, keyed by host and conversation. Splitting them
   is what stops one direct message lighting two badges. GRYT-1123. */
export function useServerChannelUnread(): (host: string) => number {
  const directory = useDirectory();
  const { getUnreadCounts } = useUnreadTracker();
  const { getConversationThreadUnreadCounts } = useThreadUnread();

  const directIds = useMemo(() => {
    const byHost = new Map<string, Set<string>>();
    for (const entry of directory) {
      const ids = byHost.get(entry.host) ?? new Set<string>();
      ids.add(entry.conversation.conversation_id);
      byHost.set(entry.host, ids);
    }
    return byHost;
  }, [directory]);

  /* Summed by exclusion rather than by subtracting the direct total, which goes
     wrong the moment the two disagree about what the host holds. */
  return useCallback(
    (host: string): number => {
      const direct = directIds.get(host);
      let total = 0;
      /* A thread reply never reaches the channel's own count, so without this
         the rail says nothing about a thread nobody has read (GRYT-1388). */
      for (const counts of [getUnreadCounts(host), getConversationThreadUnreadCounts(host)]) {
        for (const [id, count] of counts) {
          if (direct?.has(id)) continue;
          // Muted, on the channel itself or inherited: silent in the rail too (GRYT-1465).
          if (isChannelMuted(host, id)) continue;
          total += count;
        }
      }
      return total;
    },
    [directIds, getUnreadCounts, getConversationThreadUnreadCounts],
  );
}

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
