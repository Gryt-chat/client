import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import type { ChatMessage } from "../components/chatUtils";

/* Older pages to load looking for a message before giving up: 1,000 messages at 50 a page.
   Paced under the server's chat:fetch limit of 15 in 10 s, so a long search isn't refused. */
const MAX_PAGES = 20;
const PAGE_GAP_MS = 750;
const TOAST_ID = "jump-to-message";

interface Params {
  chatMessages: ChatMessage[];
  conversationKey: string | undefined;
  hasOlderMessages: boolean | undefined;
  isLoadingOlder: boolean | undefined;
  onLoadOlder: (() => void) | undefined;
  scrollToMessage: (messageId: string) => void;
  leaveBottom: () => void;
}

/** Scroll to a message, loading older history until it is there (GRYT-1677). Pins and
    reply quotes both point at messages that can be far above what is loaded. */
export function useJumpToMessage({
  chatMessages,
  conversationKey,
  hasOlderMessages,
  isLoadingOlder,
  onLoadOlder,
  scrollToMessage,
  leaveBottom,
}: Params) {
  const pending = useRef<{ id: string; pages: number; lastAt: number } | null>(null);
  const [tick, setTick] = useState(0);

  const finish = useCallback((found: boolean) => {
    pending.current = null;
    if (found) toast.dismiss(TOAST_ID);
    else toast.error("Couldn't find that message in this conversation's history.", { id: TOAST_ID });
  }, []);

  const jumpToMessage = useCallback(
    (messageId: string) => {
      if (chatMessages.some((m) => m.message_id === messageId)) {
        pending.current = null;
        scrollToMessage(messageId);
        return;
      }
      if (!onLoadOlder || !hasOlderMessages) {
        finish(false);
        return;
      }
      pending.current = { id: messageId, pages: 0, lastAt: 0 };
      toast.loading("Looking further back…", { id: TOAST_ID });
      setTick((t) => t + 1);
    },
    [chatMessages, finish, hasOlderMessages, onLoadOlder, scrollToMessage],
  );

  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    if (chatMessages.some((m) => m.message_id === p.id)) {
      finish(true);
      /* After the render that drew the row. Leaving the bottom in the same frame, or the
         bottom-holding observer puts the view straight back when the new rows resize. */
      requestAnimationFrame(() => {
        leaveBottom();
        document.querySelector(`[data-message-id="${CSS.escape(p.id)}"]`)?.scrollIntoView({ block: "center" });
        scrollToMessage(p.id);
      });
      return;
    }
    if (isLoadingOlder) return;
    if (!hasOlderMessages || !onLoadOlder || p.pages >= MAX_PAGES) {
      finish(false);
      return;
    }
    const wait = Math.max(0, p.lastAt + PAGE_GAP_MS - Date.now());
    const timer = setTimeout(() => {
      if (pending.current !== p) return;
      p.pages += 1;
      p.lastAt = Date.now();
      onLoadOlder();
      // Ask again even if nothing changed, so a load that never started still counts down.
      setTick((t) => t + 1);
    }, wait);
    return () => clearTimeout(timer);
  }, [chatMessages, finish, hasOlderMessages, isLoadingOlder, leaveBottom, onLoadOlder, scrollToMessage, tick]);

  // A search belongs to the conversation it started in.
  useEffect(() => {
    if (!pending.current) return;
    pending.current = null;
    toast.dismiss(TOAST_ID);
  }, [conversationKey]);

  return jumpToMessage;
}
