import { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { ChatMessage } from "../components/chatUtils";
import { handleRateLimitError } from "../utils/rateLimitHandler";
import { mergeMessages } from "./mergeMessages";

export const CHAT_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

type MessageCache = { [conversationId: string]: ChatMessage[] };
type MessageCacheMeta = { [conversationId: string]: { lastFetchedAtMs?: number; rateLimitedUntilMs?: number } };
type CacheKeyFn = (conversationId: string) => string;

export type ChatErrorPayload = string | {
  error: string;
  message?: string;
  retryAfterMs?: number;
  currentScore?: number;
  maxScore?: number;
};

// ── chat:new ────────────────────────────────────────────────────────

export function handleNewMessage(
  msg: ChatMessage,
  activeConversationId: string,
  getCacheKey: CacheKeyFn,
  setMessageCache: Dispatch<SetStateAction<MessageCache>>,
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  deleted?: ReadonlySet<string>,
): void {
  if (!msg || !msg.conversation_id) return;
  // A thread reply carries a thread_id and belongs in the thread panel, not the
  // channel's main flow. useThreads listens for it separately. GRYT-981.
  if (msg.thread_id) return;
  const key = getCacheKey(msg.conversation_id);
  if (!key) return;

  const isPendingMatch = (m: ChatMessage) =>
    m.pending && m.conversation_id === msg.conversation_id &&
    (msg.nonce ? m.nonce === msg.nonce : m.text === msg.text);

  setMessageCache((prev) => {
    const existing = (prev[key] || []).filter((m) => !isPendingMatch(m));
    return { ...prev, [key]: mergeMessages(existing, [msg], deleted) };
  });

  if (msg.conversation_id === activeConversationId) {
    setChatMessages((prev) => mergeMessages(prev.filter((m) => !isPendingMatch(m)), [msg], deleted));
  }
}

// ── chat:history ────────────────────────────────────────────────────

export interface HistoryPayload {
  conversation_id: string;
  items: ChatMessage[];
  hasMore?: boolean;
  before?: string;
}

export function handleHistoryPayload(
  payload: HistoryPayload,
  activeConversationId: string,
  getCacheKey: CacheKeyFn,
  inFlightFetchRef: MutableRefObject<Set<string>>,
  setMessageCache: Dispatch<SetStateAction<MessageCache>>,
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  setIsLoadingMessages: (v: boolean) => void,
  setHasOlderMessages?: (v: boolean) => void,
  setIsLoadingOlder?: (v: boolean) => void,
  deleted?: ReadonlySet<string>,
): void {
  if (!payload || !payload.conversation_id || !Array.isArray(payload.items)) return;
  const key = getCacheKey(payload.conversation_id);
  if (!key) return;

  const isPrepend = !!payload.before;

  inFlightFetchRef.current.delete(key);

  if (isPrepend) {
    setIsLoadingOlder?.(false);
  }

  if (payload.hasMore !== undefined) {
    setHasOlderMessages?.(payload.hasMore);
  }

  // One order however they arrived: live messages can be cached before the first page,
  // and appending the page after them drew the history below them (GRYT-1217).
  setMessageCache((prev) => ({ ...prev, [key]: mergeMessages(prev[key] || [], payload.items, deleted) }));

  if (payload.conversation_id !== activeConversationId) return;

  setChatMessages((prev) => mergeMessages(prev, payload.items, deleted));

  if (!isPrepend) {
    setIsLoadingMessages(false);
  }
}

// ── chat:reaction ───────────────────────────────────────────────────

export function handleReactionUpdate(
  updatedMessage: ChatMessage,
  activeConversationId: string,
  getCacheKey: CacheKeyFn,
  setMessageCache: Dispatch<SetStateAction<MessageCache>>,
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
): void {
  if (!updatedMessage || !updatedMessage.conversation_id) return;
  const key = getCacheKey(updatedMessage.conversation_id);
  if (!key) return;

  setMessageCache((prev) => {
    const existing = prev[key] || [];
    const updated = existing.map((msg) =>
      msg.message_id === updatedMessage.message_id
        ? { ...msg, reactions: updatedMessage.reactions }
        : msg
    );
    return { ...prev, [key]: updated };
  });

  if (updatedMessage.conversation_id === activeConversationId) {
    setChatMessages((prev) =>
      prev.map((msg) =>
        msg.message_id === updatedMessage.message_id
          ? { ...msg, reactions: updatedMessage.reactions }
          : msg
      )
    );
  }
}

// ── chat:edited ─────────────────────────────────────────────────────

export function handleMessageEdited(
  updatedMessage: ChatMessage,
  activeConversationId: string,
  getCacheKey: CacheKeyFn,
  setMessageCache: Dispatch<SetStateAction<MessageCache>>,
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
): void {
  if (!updatedMessage || !updatedMessage.conversation_id) return;
  const key = getCacheKey(updatedMessage.conversation_id);
  if (!key) return;

  const applyEdit = (msg: ChatMessage) =>
    msg.message_id === updatedMessage.message_id
      ? { ...msg, text: updatedMessage.text, edited_at: updatedMessage.edited_at }
      : msg;

  setMessageCache((prev) => {
    const existing = prev[key] || [];
    return { ...prev, [key]: existing.map(applyEdit) };
  });

  if (updatedMessage.conversation_id === activeConversationId) {
    setChatMessages((prev) => prev.map(applyEdit));
  }
}

// ── chat:deleted ─────────────────────────────────────────────────────

export function handleMessageDeleted(
  payload: { conversation_id: string; message_id: string },
  activeConversationId: string,
  getCacheKey: CacheKeyFn,
  setMessageCache: Dispatch<SetStateAction<MessageCache>>,
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  deleted?: Set<string>,
): void {
  if (!payload || !payload.conversation_id || !payload.message_id) return;
  const key = getCacheKey(payload.conversation_id);
  if (!key) return;
  // Remembered, so a history page the server read before the delete can't bring it back.
  deleted?.add(payload.message_id);

  setMessageCache((prev) => {
    const existing = prev[key] || [];
    return { ...prev, [key]: existing.filter((m) => m.message_id !== payload.message_id) };
  });

  if (payload.conversation_id === activeConversationId) {
    setChatMessages((prev) => prev.filter((m) => m.message_id !== payload.message_id));
  }
}

// ── chat:error ──────────────────────────────────────────────────────

interface RetryQueueEntry {
  retryCount: number;
  timeoutId?: ReturnType<typeof setTimeout>;
}

export interface ChatErrorDeps {
  setIsRateLimited: (v: boolean) => void;
  setMessageCacheMeta: Dispatch<SetStateAction<MessageCacheMeta>>;
  rateLimitIntervalRef: MutableRefObject<NodeJS.Timeout | null>;
  setRateLimitCountdown: Dispatch<SetStateAction<number>>;
  onRetry: () => void;
  onFail: () => void;
  retryQueueRef: MutableRefObject<Map<string, RetryQueueEntry>>;
}

const NON_RETRYABLE_ERRORS = [
  "Invalid payload",
  "Identity verification failed",
  "Message is empty",
  "User not found",
  "You must be connected",
];

/** How long before a refused send goes out again, when the server named no wait. */
const RETRY_AFTER_MS = 3000;

/* The send a refusal is about. chat:error names no message, so it is the last
   one queued — whatever its retry count, because a spent entry has to fail. */
function latestEntry(queue: Map<string, RetryQueueEntry>): RetryQueueEntry | null {
  let latest: RetryQueueEntry | null = null;
  for (const entry of queue.values()) latest = entry;
  return latest;
}

/** Exported for the thread panel, which queues its replies the same way. */
export function isNonRetryableError(error: ChatErrorPayload): boolean {
  const msg = typeof error === "string" ? error : error.message || error.error || "";
  return NON_RETRYABLE_ERRORS.some((e) => msg.includes(e));
}

export function handleChatErrorEvent(
  error: ChatErrorPayload,
  activeConversationId: string,
  activeCacheKey: string,
  deps: ChatErrorDeps,
): void {
  const entry = latestEntry(deps.retryQueueRef.current);
  /* One automatic retry, and if that is refused too the row fails and the text
     goes back in the composer. The thread panel does the same (GRYT-1387). */
  const canRetry = !!entry && entry.retryCount < 1 && !isNonRetryableError(error);

  if (typeof error === 'object' && error.error === 'rate_limited') {
    deps.setIsRateLimited(true);

    try {
      const retryAfterMs = typeof error.retryAfterMs === "number" ? error.retryAfterMs : 0;
      if (activeConversationId && activeCacheKey && retryAfterMs > 0) {
        const until = Date.now() + retryAfterMs;
        deps.setMessageCacheMeta((prev) => ({
          ...prev,
          [activeCacheKey]: {
            ...(prev[activeCacheKey] || {}),
            rateLimitedUntilMs: until,
          },
        }));
      }
    } catch {
      // ignore
    }

    handleRateLimitError(error, "Chat");

    if (deps.rateLimitIntervalRef.current) {
      clearInterval(deps.rateLimitIntervalRef.current);
      deps.rateLimitIntervalRef.current = null;
    }

    const startCountdown = (totalSeconds: number) => {
      deps.setRateLimitCountdown(totalSeconds);
      deps.rateLimitIntervalRef.current = setInterval(() => {
        deps.setRateLimitCountdown((prev) => {
          if (prev <= 1) {
            if (deps.rateLimitIntervalRef.current) {
              clearInterval(deps.rateLimitIntervalRef.current);
              deps.rateLimitIntervalRef.current = null;
            }
            deps.setIsRateLimited(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    };

    const waitMs = error.retryAfterMs && error.retryAfterMs > 0 ? error.retryAfterMs : 0;
    startCountdown(waitMs > 0 ? Math.ceil(waitMs / 1000) : 5);

    /* On the entry rather than on the countdown above, which is cleared by any
       re-render — so the one retry never went out at all (GRYT-1393). */
    settle(entry, canRetry, deps, waitMs || RETRY_AFTER_MS);
    return;
  }

  handleRateLimitError(error, "Chat");
  settle(entry, canRetry, deps, RETRY_AFTER_MS);
}

/** Send it again, or give up on it: the two ends of a refusal. */
function settle(
  entry: RetryQueueEntry | null,
  canRetry: boolean,
  deps: ChatErrorDeps,
  waitMs: number,
): void {
  // A refusal with nothing queued is a fetch's, not a send's.
  if (!entry) return;
  if (!canRetry) {
    deps.onFail();
    return;
  }
  entry.timeoutId = setTimeout(() => deps.onRetry(), waitMs);
}

// ── Fetch decision ──────────────────────────────────────────────────

export function shouldFetchHistory(
  cacheKey: string,
  conversationId: string,
  currentConnection: unknown,
  messageCache: MessageCache,
  messageCacheMeta: MessageCacheMeta,
): boolean {
  const now = Date.now();
  const meta = messageCacheMeta[cacheKey];
  const hasCache = Object.prototype.hasOwnProperty.call(messageCache, cacheKey);
  const isStale = !meta?.lastFetchedAtMs || now - meta.lastFetchedAtMs > CHAT_CACHE_TTL_MS;
  const rateLimitedUntil = meta?.rateLimitedUntilMs || 0;
  const blockedByBackoff = rateLimitedUntil > now;
  return !!conversationId && !!cacheKey && !!currentConnection && (!hasCache || isStale) && !blockedByBackoff;
}
