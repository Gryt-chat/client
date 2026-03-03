import { useCallback, useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";

export interface TypingUser {
  serverUserId: string;
  nickname: string;
  avatarFileId: string | null;
}

interface TypingEntry extends TypingUser {
  timeout: ReturnType<typeof setTimeout>;
}

interface TypingEventPayload {
  serverUserId: string;
  nickname: string;
  avatarFileId: string | null;
  conversationId: string;
}

interface StopTypingEventPayload {
  serverUserId: string;
  conversationId: string;
}

const TYPING_THROTTLE_MS = 3_000;
const CLIENT_TIMEOUT_MS = 8_000;

export function useTypingIndicator(
  socket: Socket | null,
  activeConversationId: string,
) {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const entriesRef = useRef(new Map<string, TypingEntry>());
  const lastEmitRef = useRef(0);
  const isTypingRef = useRef(false);
  const activeConvRef = useRef(activeConversationId);
  activeConvRef.current = activeConversationId;

  const clearEntry = useCallback((serverUserId: string) => {
    const entries = entriesRef.current;
    const entry = entries.get(serverUserId);
    if (entry) {
      clearTimeout(entry.timeout);
      entries.delete(serverUserId);
      setTypingUsers(Array.from(entries.values()).map(({ serverUserId: id, nickname, avatarFileId }) => ({ serverUserId: id, nickname, avatarFileId })));
    }
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handleTyping = (payload: TypingEventPayload) => {
      if (payload.conversationId !== activeConvRef.current) return;

      const entries = entriesRef.current;
      const existing = entries.get(payload.serverUserId);
      if (existing) clearTimeout(existing.timeout);

      const timeout = setTimeout(() => clearEntry(payload.serverUserId), CLIENT_TIMEOUT_MS);
      entries.set(payload.serverUserId, {
        serverUserId: payload.serverUserId,
        nickname: payload.nickname,
        avatarFileId: payload.avatarFileId,
        timeout,
      });

      setTypingUsers(Array.from(entries.values()).map(({ serverUserId, nickname, avatarFileId }) => ({ serverUserId, nickname, avatarFileId })));
    };

    const handleStopTyping = (payload: StopTypingEventPayload) => {
      if (payload.conversationId !== activeConvRef.current) return;
      clearEntry(payload.serverUserId);
    };

    socket.on("chat:typing", handleTyping);
    socket.on("chat:stop_typing", handleStopTyping);

    const entries = entriesRef.current;
    return () => {
      socket.off("chat:typing", handleTyping);
      socket.off("chat:stop_typing", handleStopTyping);
      for (const entry of entries.values()) clearTimeout(entry.timeout);
      entries.clear();
      setTypingUsers([]);
    };
  }, [socket, clearEntry]);

  useEffect(() => {
    for (const entry of entriesRef.current.values()) clearTimeout(entry.timeout);
    entriesRef.current.clear();
    setTypingUsers([]);
    lastEmitRef.current = 0;
    isTypingRef.current = false;
  }, [activeConversationId]);

  const emitTyping = useCallback(() => {
    if (!socket) return;
    const now = Date.now();
    if (now - lastEmitRef.current < TYPING_THROTTLE_MS && isTypingRef.current) return;
    lastEmitRef.current = now;
    isTypingRef.current = true;
    socket.emit("chat:typing", { conversationId: activeConvRef.current });
  }, [socket]);

  const emitStopTyping = useCallback(() => {
    if (!socket || !isTypingRef.current) return;
    isTypingRef.current = false;
    lastEmitRef.current = 0;
    socket.emit("chat:stop_typing", { conversationId: activeConvRef.current });
  }, [socket]);

  return { typingUsers, emitTyping, emitStopTyping };
}
