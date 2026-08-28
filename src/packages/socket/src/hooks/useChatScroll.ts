import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { ChatMessage } from "../components/chatUtils";

const AT_BOTTOM_THRESHOLD = 120;

interface ScrollAnchor {
  id: string;
  offset: number;
}

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

  // Anchor-based scroll preservation: track the first visible message and
  // its pixel offset from the scroll container top so we can restore position
  // after older messages are prepended. This is more reliable than the
  // scrollHeight-delta approach because content-visibility:auto makes
  // scrollHeight estimates unreliable for off-screen elements.
  const anchorRef = useRef<ScrollAnchor | null>(null);

  const updateAnchor = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    const nodes = el.querySelectorAll<HTMLElement>("[data-message-id]");
    for (const node of nodes) {
      if (node.offsetTop + node.offsetHeight > scrollTop) {
        const id = node.dataset.messageId;
        if (id) anchorRef.current = { id, offset: scrollTop - node.offsetTop };
        return;
      }
    }
  }, []);

  const handleScroll = useCallback(() => {
    checkAtBottom();
    updateAnchor();
    const el = scrollRef.current;
    if (el && el.scrollTop < 200 && hasOlderMessages && !isLoadingOlder && onLoadOlder) {
      onLoadOlder();
    }
  }, [checkAtBottom, updateAnchor, hasOlderMessages, isLoadingOlder, onLoadOlder]);

  const prevFirstMsgIdRef = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    prevFirstMsgIdRef.current = undefined;
    anchorRef.current = null;
  }, [conversationKey]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstMsgId = chatMessages[0]?.message_id;
    if (
      prevFirstMsgIdRef.current &&
      firstMsgId &&
      firstMsgId !== prevFirstMsgIdRef.current &&
      anchorRef.current
    ) {
      const anchorEl = el.querySelector<HTMLElement>(
        `[data-message-id="${anchorRef.current.id}"]`,
      );
      if (anchorEl) {
        el.scrollTop = anchorEl.offsetTop + anchorRef.current.offset;
      }
    }
    prevFirstMsgIdRef.current = firstMsgId;
  }, [chatMessages]);

  useEffect(() => {
    lastMessageIdRef.current = undefined;
    forceScrollToBottomRef.current = false;
    prevFirstMsgIdRef.current = undefined;
    anchorRef.current = null;
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

  /**
   * Hold the bottom while the content is still settling.
   *
   * Opening a channel scrolls to the bottom once, in the effect above. Anything
   * that grows the list after that frame leaves the reader stranded partway up,
   * and two things reliably do:
   *
   * **Images.** An attachment without stored dimensions gets no `aspect-ratio`,
   * so its wrapper is `width: fit-content` with no height until the file
   * arrives. It occupies nothing, then jumps to its full size.
   *
   * **`content-visibility: auto`.** Every message row carries it with
   * `contain-intrinsic-size: auto 60px`, so off-screen messages are 60px tall
   * until the browser actually renders them. A message with an image in it is
   * several hundred. This one fires even when every image has correct
   * dimensions, which is why fixing the images alone would not have been
   * enough.
   *
   * So the fix watches the rows rather than the images: any row changing height
   * re-pins, whatever caused it.
   *
   * Two things keep this from fighting anybody. It does nothing unless the
   * reader is already at the bottom — scrolling up sets `isAtBottomRef` false
   * and this goes quiet. And it only writes when the position has actually
   * drifted, which is what stops it looping: pinning realises more rows under
   * `content-visibility`, those resize, the observer fires again, and without
   * the drift check it would write every time round.
   *
   * `scrollTop` is set in the observer callback rather than inside a
   * `requestAnimationFrame`. ResizeObserver already runs after layout and
   * before paint, and rAF is throttled to nothing in a window that is not being
   * painted — which is exactly the case when somebody opens Gryt, tabs away,
   * and comes back to a channel that loaded while they were gone.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (!isAtBottomRef.current) return;
      const drift = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (drift > 1) el.scrollTop = el.scrollHeight;
    });

    for (const row of el.querySelectorAll<HTMLElement>("[data-message-id]")) {
      observer.observe(row);
    }
    return () => observer.disconnect();
  }, [chatMessages]);

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
