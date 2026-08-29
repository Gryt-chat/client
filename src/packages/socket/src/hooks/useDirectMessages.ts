import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

/**
 * The direct messages open on one server.
 *
 * One server. A DM here has nothing to do with a DM with the same person on a
 * different server — they are separate conversations with separate history, and
 * the client cannot tell that the two members are the same person anyway. The
 * server withholds what would make that knowable, on purpose, so that two
 * servers cannot work out they share a member.
 *
 * So this hook is per-socket and the list it holds is per-server. There is
 * deliberately no merged view across servers, and adding one would mean asking
 * for the identifier that exists to not be handed out.
 */

export interface DirectConversation {
  conversation_id: string;
  created_at: string;
  last_message_at: string | null;
  other: {
    server_user_id: string;
    nickname: string;
    avatar_file_id: string | null;
    /** The owl look, so a DM row draws the same avatar the member list does. */
    avatar_worn: string | null;
  };
}

interface DmErrorPayload {
  error?: string;
  message?: string;
  retryAfterMs?: number;
}

interface UseDirectMessagesParams {
  socket: Socket | null;
  accessToken: string | null;
  isConnected: boolean;
}

interface UseDirectMessagesResult {
  conversations: DirectConversation[];
  /** Open one, or bring the existing one forward. Resolves when the server answers. */
  openDm: (targetServerUserId: string) => void;
  /** Whether the server will take a new one at all. */
  dmsDisabled: boolean;
}

export function useDirectMessages({
  socket,
  accessToken,
  isConnected,
}: UseDirectMessagesParams): UseDirectMessagesResult {
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [dmsDisabled, setDmsDisabled] = useState(false);

  // A server from before direct messages existed answers neither `dm:list` nor
  // `dm:opened`, so the list simply stays empty and the section never appears.
  // Nothing here needs to know the server's version.
  useEffect(() => {
    if (!socket || !accessToken || !isConnected) return;

    const onList = (payload: { items?: DirectConversation[] }) => {
      setConversations(Array.isArray(payload?.items) ? payload.items : []);
    };

    const onOpened = (conversation: DirectConversation) => {
      if (!conversation?.conversation_id) return;
      setConversations((prev) => {
        const rest = prev.filter((c) => c.conversation_id !== conversation.conversation_id);
        return [conversation, ...rest];
      });
    };

    const onError = (payload: DmErrorPayload) => {
      if (payload?.error === "dms_disabled") {
        setDmsDisabled(true);
        toast.error(payload.message || "Direct messages are turned off on this server");
        return;
      }
      // Rate limiting already carries its own wait in the message.
      if (payload?.message) toast.error(payload.message);
    };

    socket.on("dm:list", onList);
    socket.on("dm:opened", onOpened);
    socket.on("dm:error", onError);
    socket.emit("dm:list", { accessToken });

    return () => {
      socket.off("dm:list", onList);
      socket.off("dm:opened", onOpened);
      socket.off("dm:error", onError);
    };
  }, [socket, accessToken, isConnected]);

  // A different server, or a signed-out one, must not show the previous
  // server's conversations while the new list is in flight.
  useEffect(() => {
    setConversations([]);
    setDmsDisabled(false);
  }, [socket]);

  const openDm = useCallback(
    (targetServerUserId: string) => {
      if (!socket || !accessToken) return;
      socket.emit("dm:open", { accessToken, targetServerUserId });
    },
    [socket, accessToken],
  );

  return { conversations, openDm, dmsDisabled };
}

/**
 * Move a conversation to the top when something arrives in it.
 *
 * The server stamps `last_message_at` and the list is ordered on it, but the
 * list is only fetched on connect — without this a conversation would stay
 * wherever it was until the next reconnect.
 */
export function withConversationTouched(
  conversations: DirectConversation[],
  conversationId: string,
  at: string,
): DirectConversation[] {
  const found = conversations.find((c) => c.conversation_id === conversationId);
  if (!found) return conversations;
  const rest = conversations.filter((c) => c.conversation_id !== conversationId);
  return [{ ...found, last_message_at: at }, ...rest];
}
