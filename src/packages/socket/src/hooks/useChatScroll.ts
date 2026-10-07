import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { ChatMessage } from "../components/chatUtils";

const AT_BOTTOM_THRESHOLD = 120;
/** How many screens above the bottom before "Jump to present" shows (GRYT-1691). */
const FAR_SCREENS = 2;

interface ScrollAnchor {
  id: string;
  offset: number;
}

const GLIDE_MS = 220;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function useChatScroll(
  chatMessages: ChatMessage[],
  conversationKey: string | undefined,
  hasOlderMessages: boolean | undefined,
  isLoadingOlder: boolean | undefined,
  onLoadOlder: (() => void) | undefined,
  /** Below an old window, where scrolling down loads newer pages until the present (GRYT-1686). */
  newer?: { hasNewer: boolean; loading: boolean; load: () => void },
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const glideRef = useRef<number | null>(null);
  const detachedRef = useRef(false);
  detachedRef.current = !!newer?.hasNewer;
  const isAtBottomRef = useRef(true);
  const [farFromBottom, setFarFromBottom] = useState(false);
  const lastMessageIdRef = useRef<string | undefined>(undefined);
  const forceScrollToBottomRef = useRef(false);

  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const prevConversationForAnimRef = useRef<string | undefined>(undefined);
  const initialLoadDoneRef = useRef(false);

  useMemo(() => {
    const conversationId = chatMessages[0]?.conversation_id;
    if (conversationId !== prevConversationForAnimRef.current) {
      seenMessageIdsRef.current.clear();
      chatMessages.forEach((m) => seenMessageIdsRef.current.add(m.nonce ?? m.message_id));
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

  const lastScrollTopRef = useRef(0);
  /* Scrolled down a frame at a time to wherever the bottom is that frame, so a row or picture
     that grows meanwhile is taken in. A transform glide grew the scroll area and got clamped. */
  const glideToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (glideRef.current !== null) cancelAnimationFrame(glideRef.current);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      glideRef.current = null;
      el.scrollTop = el.scrollHeight;
      return;
    }
    const from = el.scrollTop;
    let start: number | null = null;
    let last = from;
    const step = (now: number) => {
      // Somebody scrolled up: the glide gives way rather than pulling them back down.
      if (el.scrollTop < last - 1) {
        glideRef.current = null;
        return;
      }
      start ??= now;
      const t = Math.min(1, (now - start) / GLIDE_MS);
      const target = el.scrollHeight - el.clientHeight;
      el.scrollTop = from + (target - from) * easeOut(t);
      last = el.scrollTop;
      glideRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    glideRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => {
    if (glideRef.current !== null) cancelAnimationFrame(glideRef.current);
  }, []);

  /* Leaving the bottom takes scrolling up. A tall row landing fires a scroll before the pin runs,
     with the view suddenly far from the end, and reading that as leaving stopped the pin. */
  const checkAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD;
    const movedUp = el.scrollTop < lastScrollTopRef.current - 1;
    isAtBottomRef.current = near || (isAtBottomRef.current && !movedUp);
    lastScrollTopRef.current = el.scrollTop;
  }, []);

  // Anchor-based: track the first visible message and its offset, so a prepend of
  // older messages can be undone. Their combined height is not known in advance.
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
    if (el) {
      const far = el.scrollHeight - el.scrollTop - el.clientHeight > el.clientHeight * FAR_SCREENS;
      setFarFromBottom((prev) => (prev === far ? prev : far));
    }
    if (el && el.scrollTop < 200 && hasOlderMessages && !isLoadingOlder && onLoadOlder) {
      onLoadOlder();
    }
    if (el && newer?.hasNewer && !newer.loading && el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      newer.load();
    }
  }, [checkAtBottom, updateAnchor, hasOlderMessages, isLoadingOlder, onLoadOlder, newer]);

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
    } else if (prevFirstMsgIdRef.current && firstMsgId !== prevFirstMsgIdRef.current && isAtBottomRef.current && !detachedRef.current) {
      // A page landing above somebody who just jumped to the present keeps them there (GRYT-1691).
      el.scrollTop = el.scrollHeight;
    }
    prevFirstMsgIdRef.current = firstMsgId;
  }, [chatMessages]);

  useEffect(() => {
    lastMessageIdRef.current = undefined;
    forceScrollToBottomRef.current = false;
    setFarFromBottom(false);
    prevFirstMsgIdRef.current = undefined;
    anchorRef.current = null;
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [conversationKey, scrollToBottom]);

  // In the commit, so the glide starts from the frame the new row is first drawn in.
  useLayoutEffect(() => {
    const lastId = chatMessages[chatMessages.length - 1]?.message_id;
    if (!lastId) return;
    const prev = lastMessageIdRef.current;
    lastMessageIdRef.current = lastId;
    if (!prev) {
      requestAnimationFrame(() => scrollToBottom("auto"));
      return;
    }
    // Only for a new last message. A prepend of older pages pulled a jump back down (GRYT-1677).
    if (lastId === prev && !forceScrollToBottomRef.current) return;
    // A window's bottom is not the present, so a page arriving there is not a new message.
    if (detachedRef.current && !forceScrollToBottomRef.current) return;
    if (!isAtBottomRef.current && !forceScrollToBottomRef.current) return;
    glideToBottom();
    forceScrollToBottomRef.current = false;
  }, [chatMessages, scrollToBottom, glideToBottom]);

  /**
   * Hold the bottom while the content is still settling — an image the server
   * stored no dimensions for, so the row it is in grows once it loads.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (!isAtBottomRef.current || detachedRef.current || glideRef.current !== null) return;
      const drift = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (drift > 1) el.scrollTop = el.scrollHeight;
    });

    // The container itself, not only the rows: anything appearing between the
    // messages and the composer shrinks it without resizing one. GRYT-1067.
    observer.observe(el);
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

  /* For a jump up the history: the bottom-holding observer fires for new rows before the
     scroll event says we left, and would put the view straight back (GRYT-1677). */
  const leaveBottom = useCallback(() => {
    isAtBottomRef.current = false;
  }, []);

  /* Instant, two frames on so the present's rows are drawn. A smooth scroll from the top crossed
     the load-older line on the way and the prepend that followed stopped it short. */
  const jumpToPresent = useCallback(() => {
    forceScrollToBottomRef.current = true;
    isAtBottomRef.current = true;
    anchorRef.current = null;
    setFarFromBottom(false);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }),
    );
  }, []);

  return {
    scrollRef,
    handleScroll,
    farFromBottom,
    jumpToPresent,
    leaveBottom,
    forceScrollToBottomRef,
    seenMessageIdsRef,
    newMessageMarkerId,
  };
}
