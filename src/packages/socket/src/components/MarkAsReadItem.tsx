import { ContextMenu } from "@gryt/ui";

import {
  clearConversationThreadMentions,
  clearMentions,
  clearServerMentions,
  clearServerThreadMentions,
  clearServerThreadUnread,
  markChannelRead,
  markConversationThreadsRead,
  markServerRead,
  useMentionTracker,
  useThreadUnread,
  useUnreadTracker,
} from "@/common";

import { useSockets } from "../hooks/useSockets";

/**
 * What a "mark as read" covers.
 *
 * The same three the notification menu offers, plus a direct message, which
 * has a context menu of its own. A folder is its channels — there is nothing
 * to read in the folder itself.
 */
export type MarkReadScope =
  | { kind: "server" }
  | { kind: "folder"; channelIds: string[] }
  | { kind: "conversation"; id: string };

/**
 * Say you are done with a server, a folder, a channel or a DM.
 *
 * Four counts sit behind one badge and they do not all live in the same place.
 * Unread and thread-unread are the client's, counted from when this window
 * connected because no server-side read marker exists; mentions and
 * thread-mentions are the server's, and it has to be told or they come back on
 * the next connect. So each scope clears both sides (GRYT-1030).
 *
 * Disabled when the scope has nothing in it. A row that does nothing when
 * pressed is worse than no row, and this one would otherwise be present on
 * every channel all day, saying nothing about whether it was worth pressing.
 */
export function MarkAsReadItem({ host, scope }: { host: string; scope: MarkReadScope }) {
  const { sockets } = useSockets();
  const { serverUnreadCount, channelUnreadCount } = useUnreadTracker();
  const { serverMentionCount, conversationMentionCount } = useMentionTracker();
  const { conversationThreadUnreadCount, serverThreadUnreadCount } = useThreadUnread();

  /* Thread mentions are not added in: a naming inside a thread counts on its
     channel too, by design, so the channel figure already has it. */
  const conversationCount = (id: string) =>
    channelUnreadCount(host, id) +
    conversationMentionCount(host, id) +
    conversationThreadUnreadCount(host, id);

  const waiting = scope.kind === "server"
    ? serverUnreadCount(host) + serverMentionCount(host) + serverThreadUnreadCount(host)
    : scope.kind === "folder"
      ? scope.channelIds.reduce((n, id) => n + conversationCount(id), 0)
      : conversationCount(scope.id);

  const readConversation = (id: string) => {
    markChannelRead(host, id);
    clearMentions(host, id);
    markConversationThreadsRead(host, id);
    clearConversationThreadMentions(host, id);
    /* Threads and all, which opening the channel deliberately does not do
       (GRYT-1014). This is somebody saying they are finished with it. */
    sockets[host]?.emit("mentions:seen", { conversationId: id, includeThreads: true });
  };

  const onClick = () => {
    if (scope.kind === "server") {
      markServerRead(host);
      clearServerMentions(host);
      clearServerThreadUnread(host);
      clearServerThreadMentions(host);
      // No conversation means all of them, which the server has always read
      // that way — so one emit rather than one per channel.
      sockets[host]?.emit("mentions:seen", {});
      return;
    }

    if (scope.kind === "folder") {
      for (const id of scope.channelIds) readConversation(id);
      return;
    }

    readConversation(scope.id);
  };

  return (
    <ContextMenu.Item disabled={waiting === 0} onClick={onClick}>
      Mark as read
    </ContextMenu.Item>
  );
}
