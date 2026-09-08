/* The title and its two types moved to `@gryt/core`. This file's version missed
   the empty-group case, so an unnamed group drew a blank row (GRYT-898). */
import { type DirectConversation } from "@gryt/core";

export { conversationTitle, type DirectConversation } from "@gryt/core";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

/**
 * The direct messages open on one server. A DM here has nothing to do with one
 * with the same person elsewhere: the server withholds what would link them.
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
   * Take a conversation out of your own list, or put it back. Yours alone, and a
   * message arriving brings it back — this tidies a sidebar, nothing more.
   */
  setHidden: (conversationId: string, hidden: boolean) => void;
  /**
   * Start a group with these people, optionally named. Never converts a
   * one-to-one: what two people said must not become readable by a third.
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

  // A server from before direct messages answers neither `dm:list` nor
  // `dm:opened`, so the list stays empty and the section never appears.
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

    /* The server's answer, which is also what another device hears. Dropping the
       row on the click would leave it on the phone until a refresh. */
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
 * Move a conversation to the top when something arrives in it. The list is
 * ordered on `last_message_at` but only fetched on connect.
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
