import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

import { getServerAccessToken } from "@/common";

import type { ChatMessage } from "../components/chatUtils";

/** A server older than pins never answers, so the list stops waiting (GRYT-1782). */
const PINS_WAIT_MS = 6000;

type PinnedEvent = { conversation_id: string; message_id: string; pinned_at: string | null; pinned_by: string | null };

/** Pinned messages (GRYT-1619). `pinnedAt` overlays what the fetched messages carried,
    so a pin made since the history loaded shows without a refetch. */
export function usePins(socketConnection: Socket | null | undefined, conversationId: string, serverHost?: string) {
  const socket = socketConnection ?? null;
  const [live, setLive] = useState<Record<string, string | null>>({});
  const [list, setList] = useState<ChatMessage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const waiting = useRef<number | null>(null);
  const stopWaiting = useCallback(() => {
    if (waiting.current !== null) window.clearTimeout(waiting.current);
    waiting.current = null;
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onPinned = (e: PinnedEvent) => {
      if (!e?.message_id) return;
      setLive((prev) => ({ ...prev, [e.message_id]: e.pinned_at }));
      // A stale list is worse than a refetch; the next open asks again.
      if (e.conversation_id === conversationId) setList(null);
    };
    const onPins = (p: { conversation_id: string; items: ChatMessage[] }) => {
      if (p?.conversation_id !== conversationId) return;
      stopWaiting();
      setList(p.items ?? []);
    };
    // chat:error has no request id, so it only counts while a fetch is out.
    const onError = () => {
      if (waiting.current === null) return;
      stopWaiting();
      setFailed(true);
    };
    socket.on("chat:pinned", onPinned);
    socket.on("chat:pins", onPins);
    socket.on("chat:error", onError);
    return () => {
      socket.off("chat:pinned", onPinned);
      socket.off("chat:pins", onPins);
      socket.off("chat:error", onError);
    };
  }, [socket, conversationId, stopWaiting]);

  useEffect(() => {
    stopWaiting();
    setList(null);
    setFailed(false);
  }, [conversationId, stopWaiting]);

  useEffect(() => stopWaiting, [stopWaiting]);

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
    if (!socket || !conversationId) return;
    setFailed(false);
    stopWaiting();
    waiting.current = window.setTimeout(() => {
      waiting.current = null;
      setFailed(true);
    }, PINS_WAIT_MS);
    socket.emit("chat:pins", { conversationId });
  }, [socket, conversationId, stopWaiting]);

  return { isPinned, setPinned, list, failed, fetchList };
}
