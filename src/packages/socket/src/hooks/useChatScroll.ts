import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { ChatMessage } from "../components/chatUtils";

const AT_BOTTOM_THRESHOLD = 120;

export function useChatScroll(
  chatMessages: ChatMessage[],
  conversationKey: string | undefined,
  hasOlderMessages: boolean | undefined,
  isLoadingOlder: boolean | undefined,
  onLoadOlder: (() => void) | undefined,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const lastMessageIdRef = useRef<string | undefined>(undefined);
  const forceScrollToBottomRef = useRef(false);

  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const prevConversationForAnimRef = useRef<string | undefined>(undefined);
  const initialLoadDoneRef = useRef(false);

  useMemo(() => {
    const conversationId = chatMessages[0]?.conversation_id;
    if (conversationId !== prevConversationForAnimRef.current) {
      seenMessageIdsRef.current.clear();
      chatMessages.forEach((m) => seenMessageIdsRef.current.add(m.message_id));
      prevConversationForAnimRef.current = conversationId;
      initialLoadDoneRef.current = false;
    } else if (chatMessages.length > 0) {
      initialLoadDoneRef.current = true;
    }
  }, [chatMessages]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const checkAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD;
  }, []);

  const handleScroll = useCallback(() => {
    checkAtBottom();
    const el = scrollRef.current;
    if (el && el.scrollTop < 200 && hasOlderMessages && !isLoadingOlder && onLoadOlder) {
      onLoadOlder();
    }
  }, [checkAtBottom, hasOlderMessages, isLoadingOlder, onLoadOlder]);

  const prevFirstMsgIdRef = useRef<string | undefined>(undefined);
  const prevScrollHeightRef = useRef(0);

  useLayoutEffect(() => {
    prevFirstMsgIdRef.current = undefined;
    prevScrollHeightRef.current = 0;
  }, [conversationKey]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstMsgId = chatMessages[0]?.message_id;
    if (prevFirstMsgIdRef.current && firstMsgId && firstMsgId !== prevFirstMsgIdRef.current) {
      const delta = el.scrollHeight - prevScrollHeightRef.current;
      if (delta > 0) el.scrollTop += delta;
    }
    prevFirstMsgIdRef.current = firstMsgId;
    prevScrollHeightRef.current = el.scrollHeight;
  }, [chatMessages]);

  useEffect(() => {
    lastMessageIdRef.current = undefined;
    forceScrollToBottomRef.current = false;
    prevFirstMsgIdRef.current = undefined;
    prevScrollHeightRef.current = 0;
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [conversationKey, scrollToBottom]);

  useEffect(() => {
    const lastId = chatMessages[chatMessages.length - 1]?.message_id;
    if (!lastId) return;
    const prev = lastMessageIdRef.current;
    lastMessageIdRef.current = lastId;
    if (!prev) {
      requestAnimationFrame(() => scrollToBottom("auto"));
      return;
    }
    if (!isAtBottomRef.current && !forceScrollToBottomRef.current) return;
    requestAnimationFrame(() => {
      scrollToBottom(initialLoadDoneRef.current ? "smooth" : "auto");
    });
    forceScrollToBottomRef.current = false;
  }, [chatMessages, scrollToBottom]);

  useEffect(() => {
    let savedScrollTop = 0;
    const onFullscreenChange = () => {
      const el = scrollRef.current;
      if (!el) return;
      if (document.fullscreenElement) {
        savedScrollTop = el.scrollTop;
      } else {
        const restore = savedScrollTop;
        requestAnimationFrame(() => { el.scrollTop = restore; });
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const windowFocusedRef = useRef(document.hasFocus());
  const [newMessageMarkerId, setNewMessageMarkerId] = useState<string | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevConversationIdRef = useRef<string | undefined>(undefined);
  const prevLastIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const onFocus = () => {
      windowFocusedRef.current = true;
      focusTimerRef.current = setTimeout(() => {
        setNewMessageMarkerId(null);
      }, 2000);
    };
    const onBlur = () => {
      windowFocusedRef.current = false;
      if (focusTimerRef.current) {
        clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    const cleanupElectron = window.electronAPI?.onWindowFocusChange((focused) => {
      if (focused) onFocus();
      else onBlur();
    });
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      cleanupElectron?.();
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const currentConvId = chatMessages[chatMessages.length - 1]?.conversation_id;
    const lastId = chatMessages[chatMessages.length - 1]?.message_id;
    const conversationSwitched =
      currentConvId !== prevConversationIdRef.current && prevConversationIdRef.current !== undefined;

    if (conversationSwitched) {
      setNewMessageMarkerId(null);
    } else if (lastId !== prevLastIdRef.current && prevLastIdRef.current && !windowFocusedRef.current) {
      setNewMessageMarkerId((prev) => prev ?? prevLastIdRef.current!);
    }

    prevConversationIdRef.current = currentConvId;
    prevLastIdRef.current = lastId;
  }, [chatMessages]);

  return {
    scrollRef,
    handleScroll,
    forceScrollToBottomRef,
    seenMessageIdsRef,
    newMessageMarkerId,
  };
}
