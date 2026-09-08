import { useCallback, useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";

export interface TypingUser {
  serverUserId: string;
  nickname: string;
  avatarFileId: string | null;
  /** Optional: a server older than the field does not send one. */
  avatarWorn?: string | null;
}

interface TypingEntry extends TypingUser {
  timeout: ReturnType<typeof setTimeout>;
}

interface TypingEventPayload {
  serverUserId: string;
  nickname: string;
  avatarFileId: string | null;
  avatarWorn?: string | null;
  conversationId: string;
  /** Absent from a server older than GRYT-1020, which means the channel. */
  threadId?: string | null;
}

interface StopTypingEventPayload {
  serverUserId: string;
  conversationId: string;
  threadId?: string | null;
}

const TYPING_THROTTLE_MS = 3_000;
const CLIENT_TIMEOUT_MS = 8_000;

/**
 * Who is typing in one place, and telling the room you are. Called twice where a
 * thread can be open, and each instance keeps the events addressed to it.
 */
export function useTypingIndicator(
  socket: Socket | null,
  activeConversationId: string,
  activeThreadId?: string | null,
) {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const entriesRef = useRef(new Map<string, TypingEntry>());
  const lastEmitRef = useRef(0);
  const isTypingRef = useRef(false);
  const activeConvRef = useRef(activeConversationId);
  activeConvRef.current = activeConversationId;
  const activeThreadRef = useRef(activeThreadId ?? null);
  activeThreadRef.current = activeThreadId ?? null;

  const clearEntry = useCallback((serverUserId: string) => {
    const entries = entriesRef.current;
    const entry = entries.get(serverUserId);
    if (entry) {
      clearTimeout(entry.timeout);
      entries.delete(serverUserId);
      setTypingUsers(Array.from(entries.values()).map(({ serverUserId: id, nickname, avatarFileId, avatarWorn }) => ({ serverUserId: id, nickname, avatarFileId, avatarWorn })));
    }
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handleTyping = (payload: TypingEventPayload) => {
      if (payload.conversationId !== activeConvRef.current) return;
      if ((payload.threadId ?? null) !== activeThreadRef.current) return;

      const entries = entriesRef.current;
      const existing = entries.get(payload.serverUserId);
      if (existing) clearTimeout(existing.timeout);

      const timeout = setTimeout(() => clearEntry(payload.serverUserId), CLIENT_TIMEOUT_MS);
      entries.set(payload.serverUserId, {
        serverUserId: payload.serverUserId,
        nickname: payload.nickname,
        avatarFileId: payload.avatarFileId,
        avatarWorn: payload.avatarWorn ?? null,
        timeout,
      });

      setTypingUsers(Array.from(entries.values()).map(({ serverUserId, nickname, avatarFileId, avatarWorn }) => ({ serverUserId, nickname, avatarFileId, avatarWorn })));
    };

    const handleStopTyping = (payload: StopTypingEventPayload) => {
      if (payload.conversationId !== activeConvRef.current) return;
      if ((payload.threadId ?? null) !== activeThreadRef.current) return;
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
  }, [activeConversationId, activeThreadId]);

  const emitTyping = useCallback(() => {
    if (!socket) return;
    const now = Date.now();
    if (now - lastEmitRef.current < TYPING_THROTTLE_MS && isTypingRef.current) return;
    lastEmitRef.current = now;
    isTypingRef.current = true;
    socket.emit("chat:typing", {
      conversationId: activeConvRef.current,
      threadId: activeThreadRef.current,
    });
  }, [socket]);

  const emitStopTyping = useCallback(() => {
    if (!socket || !isTypingRef.current) return;
    isTypingRef.current = false;
    lastEmitRef.current = 0;
    socket.emit("chat:stop_typing", {
      conversationId: activeConvRef.current,
      threadId: activeThreadRef.current,
    });
  }, [socket]);

  return { typingUsers, emitTyping, emitStopTyping };
}
