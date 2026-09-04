/* The title and its two types moved to `@gryt/core` (GRYT-898). This file's
   version was missing the empty-group case, so an unnamed group whose members
   had not arrived drew a blank row. Core keeps the phone's, which has it. */
import { type DirectConversation } from "@gryt/core";

export { conversationTitle, type DirectConversation } from "@gryt/core";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  /** Everything, both kinds. Most callers want one of the two below. */
  conversations: DirectConversation[];
  /** The one-to-ones. */
  directMessages: DirectConversation[];
  /** The groups, which get their own section rather than sharing one. */
  groups: DirectConversation[];
  /** Open one, or bring the existing one forward. Resolves when the server answers. */
  openDm: (targetServerUserId: string) => void;
  /**
   * Take a conversation out of your own list, or put it back.
   *
   * Yours alone — the other person's list does not change and they are not
   * told. A message arriving brings it back, which is why this tidies a
   * sidebar rather than stopping somebody talking to you.
   */
  setHidden: (conversationId: string, hidden: boolean) => void;
  /**
   * Start a group with these people, optionally named.
   *
   * Never converts a one-to-one. The pair conversation those people already
   * had stays exactly as it is — what two people said should not become
   * readable by a third because somebody made a group.
   */
  createGroup: (memberIds: string[], name?: string, iconFileId?: string | null) => void;
  /** Change a group's name, its picture, or both. `null` means the drawn one. */
  updateGroup: (conversationId: string, changes: { name?: string | null; iconFileId?: string | null }) => void;
  /** Put somebody into a group. Anybody in it may. */
  addToGroup: (conversationId: string, targetServerUserId: string) => void;
  /** Leave for good. Not hiding — nothing brings this one back. */
  leaveGroup: (conversationId: string) => void;
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

    /* The server's answer, which is also what another device hears. Dropping
       the row on the click would look right here and leave it on the phone
       until something else refreshed the list. */
    const onHidden = (payload: { conversation_id?: string; hidden?: boolean }) => {
      if (!payload?.conversation_id || payload.hidden !== true) return;
      setConversations((prev) =>
        prev.filter((c) => c.conversation_id !== payload.conversation_id),
      );
    };

    /* Left for good, so it goes without waiting for a fresh list. */
    const onLeft = (payload: { conversation_id?: string }) => {
      if (!payload?.conversation_id) return;
      setConversations((prev) => prev.filter((c) => c.conversation_id !== payload.conversation_id));
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
    socket.on("dm:hidden", onHidden);
    socket.on("dm:left", onLeft);
    socket.on("dm:error", onError);
    socket.emit("dm:list", { accessToken });

    return () => {
      socket.off("dm:list", onList);
      socket.off("dm:opened", onOpened);
      socket.off("dm:hidden", onHidden);
      socket.off("dm:left", onLeft);
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

  const setHidden = useCallback(
    (conversationId: string, hidden: boolean) => {
      if (!socket || !accessToken) return;
      socket.emit("dm:setHidden", { accessToken, conversationId, hidden });
    },
    [socket, accessToken],
  );

  const emit = useCallback(
    (event: string, payload: Record<string, unknown>) => {
      if (!socket || !accessToken) return;
      socket.emit(event, { accessToken, ...payload });
    },
    [socket, accessToken],
  );

  const createGroup = useCallback(
    (memberIds: string[], name?: string, iconFileId?: string | null) =>
      emit("dm:group:create", { memberIds, name, iconFileId: iconFileId ?? undefined }),
    [emit],
  );
  const updateGroup = useCallback(
    (conversationId: string, changes: { name?: string | null; iconFileId?: string | null }) =>
      emit("dm:group:update", { conversationId, ...changes }),
    [emit],
  );
  const addToGroup = useCallback(
    (conversationId: string, targetServerUserId: string) =>
      emit("dm:group:add", { conversationId, targetServerUserId }),
    [emit],
  );
  const leaveGroup = useCallback(
    (conversationId: string) => emit("dm:group:leave", { conversationId }),
    [emit],
  );

  const directMessages = useMemo(
    () => conversations.filter((c) => c.kind !== "group"),
    [conversations],
  );
  const groups = useMemo(() => conversations.filter((c) => c.kind === "group"), [conversations]);

  return {
    conversations,
    directMessages,
    groups,
    openDm,
    setHidden,
    createGroup,
    updateGroup,
    addToGroup,
    leaveGroup,
    dmsDisabled,
  };
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
