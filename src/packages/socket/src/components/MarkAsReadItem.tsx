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
 * What a "mark as read" covers: the same three the notification menu offers,
 * plus a direct message. A folder is its channels.
 */
export type MarkReadScope =
  | { kind: "server" }
  | { kind: "folder"; channelIds: string[] }
  | { kind: "conversation"; id: string };

/**
 * Say you are done with a server, folder, channel or DM. Four counts sit behind
 * one badge, two the client's and two the server's, so each scope clears both.
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
