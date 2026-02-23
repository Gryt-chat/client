import { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { ChatMessage } from "../components/chatUtils";
import { handleRateLimitError } from "../utils/rateLimitHandler";

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
): void {
  if (!msg || !msg.conversation_id) return;
  const key = getCacheKey(msg.conversation_id);
  if (!key) return;

  const isPendingMatch = (m: ChatMessage) =>
    m.pending && m.conversation_id === msg.conversation_id &&
    (msg.nonce ? m.nonce === msg.nonce : m.text === msg.text);

  setMessageCache((prev) => {
    const existing = prev[key] || [];
    const filtered = existing.filter((m) => !isPendingMatch(m));
    const existingIds = new Set(filtered.map((m) => m.message_id));
    const merged = existingIds.has(msg.message_id) ? filtered : [...filtered, msg];
    const bounded = merged.length > 200 ? merged.slice(merged.length - 200) : merged;
    return { ...prev, [key]: bounded };
  });

  if (msg.conversation_id === activeConversationId) {
    setChatMessages((prev) => {
      const filtered = prev.filter((m) => !isPendingMatch(m));
      const existingIds = new Set(filtered.map((m) => m.message_id));
      return existingIds.has(msg.message_id) ? filtered : [...filtered, msg];
    });
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

  setMessageCache((prev) => {
    const existing = prev[key] || [];
    const existingIds = new Set(existing.map((m) => m.message_id));
    const newItems = payload.items.filter((it) => !existingIds.has(it.message_id));
    const merged = isPrepend ? [...newItems, ...existing] : [...existing, ...newItems];
    const bounded = merged.length > 200 ? merged.slice(merged.length - 200) : merged;
    return { ...prev, [key]: bounded };
  });

  if (payload.conversation_id !== activeConversationId) return;

  setChatMessages((prev) => {
    const existingIds = new Set(prev.map((m) => m.message_id));
    const newItems = payload.items.filter((it) => !existingIds.has(it.message_id));
    return isPrepend ? [...newItems, ...prev] : [...prev, ...newItems];
  });

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
): void {
  if (!payload || !payload.conversation_id || !payload.message_id) return;
  const key = getCacheKey(payload.conversation_id);
  if (!key) return;

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
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setChatText: (text: string) => void;
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

function getLatestRetryableEntry(queue: Map<string, RetryQueueEntry>): RetryQueueEntry | null {
  let latest: RetryQueueEntry | null = null;
  for (const entry of queue.values()) {
    if (entry.retryCount < 1) latest = entry;
  }
  return latest;
}

function isNonRetryableError(error: ChatErrorPayload): boolean {
  const msg = typeof error === "string" ? error : error.message || error.error || "";
  return NON_RETRYABLE_ERRORS.some((e) => msg.includes(e));
}

export function handleChatErrorEvent(
  error: ChatErrorPayload,
  activeConversationId: string,
  activeCacheKey: string,
  deps: ChatErrorDeps,
): void {
  const canRetry = !!getLatestRetryableEntry(deps.retryQueueRef.current);

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

    if (!canRetry) {
      deps.setChatMessages((prev) => {
        const pendingMessages = prev.filter(msg => msg.pending);
        if (pendingMessages.length > 0) {
          const latestPending = pendingMessages[pendingMessages.length - 1];
          if (latestPending.text) {
            deps.setChatText(latestPending.text);
          }
        }
        return prev.filter(msg => !msg.pending);
      });
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
            if (canRetry) deps.onRetry();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    };

    if (error.retryAfterMs && error.retryAfterMs > 0) {
      startCountdown(Math.ceil(error.retryAfterMs / 1000));
    } else {
      startCountdown(5);
    }
  } else if (!isNonRetryableError(error) && canRetry) {
    handleRateLimitError(error, "Chat");
    const entry = getLatestRetryableEntry(deps.retryQueueRef.current);
    if (entry) {
      entry.timeoutId = setTimeout(() => {
        deps.onRetry();
      }, 3000);
    }
  } else {
    handleRateLimitError(error, "Chat");
    if (canRetry) {
      deps.onFail();
    }
  }
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
