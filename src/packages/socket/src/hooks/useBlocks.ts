import { useCallback, useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";

/**
 * Who you have blocked on this server.
 *
 * A block is enforced entirely by the server — their messages are not
 * delivered, history comes back without them, and a conversation between the
 * two cannot be opened from either side. This list is not a filter: it exists
 * so a menu can say Unblock rather than offering Block on somebody who already
 * is.
 *
 * **Per server.** Dropped when the socket changes rather than merged: showing
 * the previous server's blocks while a new list is in flight would be wrong
 * about both.
 */

export interface BlockedPerson {
  /** The account behind them, which is what the block is keyed on. */
  grytUserId: string;
  /** Null once they have left: the block outlives the member row. */
  serverUserId: string | null;
  nickname: string | null;
  createdAt: string;
}

export interface UseBlocksResult {
  blocked: BlockedPerson[];
  isBlocked: (serverUserId: string | null | undefined) => boolean;
  block: (serverUserId: string) => void;
  unblock: (serverUserId: string) => void;
}

export function useBlocks({
  socket,
  accessToken,
  isConnected,
}: {
  socket: Socket | null;
  accessToken: string | null;
  isConnected: boolean;
}): UseBlocksResult {
  const [blocked, setBlocked] = useState<BlockedPerson[]>([]);

  useEffect(() => {
    setBlocked([]);
  }, [socket]);

  useEffect(() => {
    if (!socket || !accessToken || !isConnected) return;

    const onList = (payload: { blocked?: BlockedPerson[] }) => {
      if (Array.isArray(payload?.blocked)) setBlocked(payload.blocked);
    };

    /* The server answers a block or an unblock with the id it acted on rather
     * than a whole list, so the list is asked for again. One round trip on
     * something somebody does rarely, against keeping two copies of the same
     * truth in step by hand. */
    const refetch = () => socket.emit("user:blocks:list", { accessToken });

    socket.on("user:blocks", onList);
    socket.on("user:blocked", refetch);
    socket.on("user:unblocked", refetch);

    /* A server from before blocking existed answers none of these, which is
     * why nothing here waits on a reply: the list stays empty, every row says
     * Block, and pressing it is ignored. That is the same way `useDirectMessages`
     * treats a server too old for conversations. */
    socket.emit("user:blocks:list", { accessToken });

    return () => {
      socket.off("user:blocks", onList);
      socket.off("user:blocked", refetch);
      socket.off("user:unblocked", refetch);
    };
  }, [socket, accessToken, isConnected]);

  const block = useCallback(
    (serverUserId: string) => {
      if (!socket || !accessToken) return;
      socket.emit("user:block", { accessToken, serverUserId });
    },
    [socket, accessToken],
  );

  const unblock = useCallback(
    (serverUserId: string) => {
      if (!socket || !accessToken) return;
      socket.emit("user:unblock", { accessToken, serverUserId });
    },
    [socket, accessToken],
  );

  return useMemo(() => {
    /* Built once per list rather than scanned per row. The member sidebar asks
       this for everybody on the server on every render. */
    const ids = new Set(
      blocked.map((b) => b.serverUserId).filter((id): id is string => !!id),
    );

    return {
      blocked,
      isBlocked: (serverUserId) => !!serverUserId && ids.has(serverUserId),
      block,
      unblock,
    };
  }, [blocked, block, unblock]);
}
