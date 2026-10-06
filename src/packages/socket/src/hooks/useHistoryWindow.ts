/* History opened at one message rather than at the present (GRYT-1686). The window is its own list
   over the channel's: the cache is one run ending at the newest message, and a window has a gap. */

import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

import type { ChatMessage } from "../components/chatUtils";
import {
  handleAttachmentsSettled,
  handleMessageDeleted,
  handleMessageEdited,
  handleReactionUpdate,
  type HistoryPayload,
} from "./chatEventHandlers";
import { mergeMessages } from "./mergeMessages";

export type OpenAtResult = "window" | "unsupported" | "missing";

type MessageCache = { [conversationId: string]: ChatMessage[] };

const PAGE = 50;
// An older server answers `around` with the newest page and no `around`; this covers one that answers nothing.
const OPEN_TIMEOUT_MS = 8000;

export interface WindowedHistoryPayload extends HistoryPayload {
  after?: string;
  around?: string;
  anchorFound?: boolean;
  hasNewer?: boolean;
}

/** Whether a `chat:history` belongs to the window, so the channel's own handler leaves it alone. */
export function isWindowPayload(payload: WindowedHistoryPayload, windowOpen: boolean): boolean {
  return !!payload.around || !!payload.after || (!!payload.before && windowOpen);
}

interface Params {
  connection: Socket | null;
  conversationId: string;
  cacheKeyFor: (conversationId: string) => string;
  setMessageCache: Dispatch<SetStateAction<MessageCache>>;
  deletedIdsRef: MutableRefObject<Set<string>>;
  /** DMs over MLS merge an archive into the timeline, which a window would split. */
  disabled: boolean;
}

export function useHistoryWindow({ connection, conversationId, cacheKeyFor, setMessageCache, deletedIdsRef, disabled }: Params) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const openRef = useRef<{ id: string; resolve: (r: OpenAtResult) => void; timer: number } | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const close = useCallback(() => {
    setMessages(null);
    setHasNewer(false);
    setLoadingOlder(false);
    setLoadingNewer(false);
  }, []);

  // A window that reaches the present joins the channel's list, which then runs unbroken.
  const settle = useCallback(
    (list: ChatMessage[]) => {
      const key = cacheKeyFor(conversationId);
      if (key) setMessageCache((prev) => ({ ...prev, [key]: mergeMessages(prev[key] || [], list, deletedIdsRef.current) }));
      close();
    },
    [cacheKeyFor, close, conversationId, deletedIdsRef, setMessageCache],
  );

  useEffect(() => {
    close();
    const pending = openRef.current;
    if (pending) {
      window.clearTimeout(pending.timer);
      openRef.current = null;
      pending.resolve("unsupported");
    }
  }, [conversationId, connection, close]);

  useEffect(() => {
    if (!connection) return;
    const noCache: Dispatch<SetStateAction<MessageCache>> = () => {};
    const setWindow: Dispatch<SetStateAction<ChatMessage[]>> = (u) =>
      setMessages((prev) => (prev ? (typeof u === "function" ? u(prev) : u) : prev));
    const key = () => cacheKeyFor(conversationId);

    const onHistory = (payload: WindowedHistoryPayload) => {
      if (!payload || payload.conversation_id !== conversationId || !Array.isArray(payload.items)) return;
      const pending = openRef.current;

      if (payload.around && pending && payload.around === pending.id) {
        window.clearTimeout(pending.timer);
        openRef.current = null;
        if (!payload.anchorFound) {
          pending.resolve("missing");
          return;
        }
        if (!payload.hasNewer) {
          settle(payload.items);
        } else {
          setMessages(mergeMessages([], payload.items, deletedIdsRef.current));
          setHasOlder(!!payload.hasMore);
          setHasNewer(true);
        }
        pending.resolve("window");
        return;
      }

      // A server without `around` sends the newest page back as if asked for nothing.
      if (pending && !payload.around && !payload.after && !payload.before) {
        window.clearTimeout(pending.timer);
        openRef.current = null;
        pending.resolve("unsupported");
        return;
      }

      if (!messagesRef.current) return;
      if (payload.after) {
        setLoadingNewer(false);
        const joined = mergeMessages(messagesRef.current, payload.items, deletedIdsRef.current);
        if (payload.hasNewer) {
          setMessages(joined);
        } else {
          settle(joined);
        }
      } else if (payload.before) {
        setLoadingOlder(false);
        setMessages((prev) => (prev ? mergeMessages(prev, payload.items, deletedIdsRef.current) : prev));
        if (payload.hasMore !== undefined) setHasOlder(payload.hasMore);
      }
    };

    const onReaction = (m: ChatMessage) => handleReactionUpdate(m, conversationId, key, noCache, setWindow);
    const onEdited = (m: ChatMessage) => handleMessageEdited(m, conversationId, key, noCache, setWindow);
    const onDeleted = (p: { conversation_id: string; message_id: string }) =>
      handleMessageDeleted(p, conversationId, key, noCache, setWindow);
    const onAttachments = (p: Parameters<typeof handleAttachmentsSettled>[0]) =>
      handleAttachmentsSettled(p, conversationId, key, noCache, setWindow);

    connection.on("chat:history", onHistory);
    connection.on("chat:reaction", onReaction);
    connection.on("chat:edited", onEdited);
    connection.on("chat:deleted", onDeleted);
    connection.on("chat:attachments", onAttachments);
    return () => {
      connection.off("chat:history", onHistory);
      connection.off("chat:reaction", onReaction);
      connection.off("chat:edited", onEdited);
      connection.off("chat:deleted", onDeleted);
      connection.off("chat:attachments", onAttachments);
    };
  }, [cacheKeyFor, connection, conversationId, deletedIdsRef, settle]);

  const openAt = useCallback(
    (messageId: string): Promise<OpenAtResult> => {
      if (!connection || !conversationId || disabled) return Promise.resolve("unsupported");
      const prior = openRef.current;
      if (prior) {
        window.clearTimeout(prior.timer);
        prior.resolve("unsupported");
      }
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          if (openRef.current?.id !== messageId) return;
          openRef.current = null;
          resolve("unsupported");
        }, OPEN_TIMEOUT_MS);
        openRef.current = { id: messageId, resolve, timer };
        connection.emit("chat:fetch", { conversationId, limit: PAGE, around: messageId });
      });
    },
    [connection, conversationId, disabled],
  );

  const loadNewer = useCallback(() => {
    const list = messagesRef.current;
    if (!connection || !list?.length || loadingNewer || !hasNewer) return;
    setLoadingNewer(true);
    const after = new Date(list[list.length - 1].created_at).toISOString();
    connection.emit("chat:fetch", { conversationId, limit: PAGE, after });
  }, [connection, conversationId, hasNewer, loadingNewer]);

  const loadOlder = useCallback(() => {
    const list = messagesRef.current;
    if (!connection || !list?.length || loadingOlder || !hasOlder) return;
    setLoadingOlder(true);
    const before = new Date(list[0].created_at).toISOString();
    connection.emit("chat:fetch", { conversationId, limit: PAGE, before });
  }, [connection, conversationId, hasOlder, loadingOlder]);

  return {
    /** Null while the channel shows its own list, which ends at the present. */
    messages,
    hasOlder,
    hasNewer,
    loadingOlder,
    loadingNewer,
    openAt,
    loadOlder,
    loadNewer,
    returnToPresent: close,
  };
}

/** What the chat view gets: enough to page down, open a window and leave it. */
export interface HistoryWindowControls {
  open: boolean;
  hasNewer: boolean;
  loadingNewer: boolean;
  loadNewer: () => void;
  openAt: (messageId: string) => Promise<OpenAtResult>;
  returnToPresent: () => void;
}
