import { useCallback, useEffect, useState } from "react";
import type { Socket } from "socket.io-client";

import { getServerAccessToken } from "@/common";

import type { ChatMessage } from "../components/chatUtils";

type PinnedEvent = { conversation_id: string; message_id: string; pinned_at: string | null; pinned_by: string | null };

/** Pinned messages (GRYT-1619). `pinnedAt` overlays what the fetched messages carried,
    so a pin made since the history loaded shows without a refetch. */
export function usePins(socketConnection: unknown, conversationId: string, serverHost?: string) {
  const socket = (socketConnection as Socket | undefined) ?? null;
  const [live, setLive] = useState<Record<string, string | null>>({});
  const [list, setList] = useState<ChatMessage[] | null>(null);

  useEffect(() => {
    if (!socket) return;
    const onPinned = (e: PinnedEvent) => {
      if (!e?.message_id) return;
      setLive((prev) => ({ ...prev, [e.message_id]: e.pinned_at }));
      // A stale list is worse than a refetch; the next open asks again.
      if (e.conversation_id === conversationId) setList(null);
    };
    const onPins = (p: { conversation_id: string; items: ChatMessage[] }) => {
      if (p?.conversation_id === conversationId) setList(p.items ?? []);
    };
    socket.on("chat:pinned", onPinned);
    socket.on("chat:pins", onPins);
    return () => {
      socket.off("chat:pinned", onPinned);
      socket.off("chat:pins", onPins);
    };
  }, [socket, conversationId]);

  useEffect(() => setList(null), [conversationId]);

  const isPinned = useCallback(
    (m: ChatMessage) => (m.message_id in live ? !!live[m.message_id] : !!m.pinned_at),
    [live],
  );

  const setPinned = useCallback((m: ChatMessage, pinned: boolean) => {
    const accessToken = getServerAccessToken(serverHost || "");
    if (!socket || !accessToken) return;
    socket.emit("chat:pin", { conversationId: m.conversation_id, messageId: m.message_id, pinned, accessToken });
  }, [socket, serverHost]);

  const fetchList = useCallback(() => {
    if (socket && conversationId) socket.emit("chat:pins", { conversationId });
  }, [socket, conversationId]);

  return { isPinned, setPinned, list, fetchList };
}
