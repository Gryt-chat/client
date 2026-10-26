import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";

import { toPlainNotificationText } from "@/lib/desktopNotification";

import type { ChatMessage } from "../components/chatUtils";

export interface CallBubble {
  id: string;
  text: string;
}

export interface CallBubbleState {
  /** Newest last; only the last two are kept. */
  bubbles: Record<string, CallBubble[]>;
  typing: Set<string>;
}

const BUBBLE_MS = 10_000;
const TYPING_MS = 8_000;
const KEEP = 2;

/** The call chat's live layer: who is typing in it, and what each person just said (GRYT-1911). */
export function useCallBubbles(socket: Socket | null | undefined, conversationId: string | undefined): CallBubbleState {
  const [state, setState] = useState<CallBubbleState>({ bubbles: {}, typing: new Set() });

  useEffect(() => {
    setState({ bubbles: {}, typing: new Set() });
    if (!socket || !conversationId) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const later = (ms: number, fn: () => void) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
      return t;
    };

    const setTyping = (userId: string, on: boolean) => {
      const old = typingTimers.get(userId);
      if (old) clearTimeout(old);
      typingTimers.delete(userId);
      if (on) typingTimers.set(userId, setTimeout(() => setTyping(userId, false), TYPING_MS));
      setState((s) => {
        if (s.typing.has(userId) === on) return s;
        const typing = new Set(s.typing);
        if (on) typing.add(userId);
        else typing.delete(userId);
        return { ...s, typing };
      });
    };

    const onMessage = (msg: ChatMessage) => {
      if (msg.conversation_id !== conversationId || msg.thread_id || !msg.text || msg.text_fallback) return;
      const userId = msg.sender_server_id;
      const bubble = { id: msg.message_id, text: toPlainNotificationText(msg.text) };
      setTyping(userId, false);
      setState((s) => ({ ...s, bubbles: { ...s.bubbles, [userId]: [...(s.bubbles[userId] ?? []), bubble].slice(-KEEP) } }));
      later(BUBBLE_MS, () => setState((s) => ({
        ...s,
        bubbles: { ...s.bubbles, [userId]: (s.bubbles[userId] ?? []).filter((b) => b.id !== bubble.id) },
      })));
    };
    const onTyping = (p: { serverUserId: string; conversationId: string; threadId?: string | null }) => {
      if (p.conversationId === conversationId && !p.threadId) setTyping(p.serverUserId, true);
    };
    const onStopTyping = (p: { serverUserId: string; conversationId: string; threadId?: string | null }) => {
      if (p.conversationId === conversationId && !p.threadId) setTyping(p.serverUserId, false);
    };

    socket.on("chat:new", onMessage);
    socket.on("chat:typing", onTyping);
    socket.on("chat:stop_typing", onStopTyping);
    return () => {
      socket.off("chat:new", onMessage);
      socket.off("chat:typing", onTyping);
      socket.off("chat:stop_typing", onStopTyping);
      timers.forEach(clearTimeout);
      typingTimers.forEach(clearTimeout);
    };
  }, [socket, conversationId]);

  return state;
}
