import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";
import useSound from "use-sound";

import messageSoundMp3 from "@/audio/src/assets/universfield-computer-mouse-click-02-383961.mp3";
import { getServerAccessToken, isUserAuthenticated, markChannelUnread, useUnreadBadge } from "@/common";
import { useSettings } from "@/settings";
import { serverDetailsList as ServerDetailsList } from "@/settings/src/types/server";

import type { ChatMessage } from "../components/chatUtils";
import {
  ChatErrorPayload,
  handleChatErrorEvent,
  handleHistoryPayload,
  handleMessageDeleted,
  handleMessageEdited,
  handleNewMessage,
  handleReactionUpdate,
  type HistoryPayload,
  shouldFetchHistory,
} from "./chatEventHandlers";
import { useChatSend } from "./useChatSend";

interface UseChatParams {
  currentConnection: Socket | null;
  activeConversationId: string;
  currentlyViewingServer: { host: string; name: string } | null;
  currentChannelId: string;
  isConnected: boolean;
  serverDetailsList: ServerDetailsList;
  nickname: string;
  currentUserId?: string;
}

interface UseChatReturn {
  chatMessages: ChatMessage[];
  canSend: boolean;
  sendChat: (text: string, files: File[], replyToMessageId?: string) => void;
  editMessage: (messageId: string, conversationId: string, newText: string) => void;
  isLoadingMessages: boolean;
  isRateLimited: boolean;
  rateLimitCountdown: number;
  isVoiceChannelTextChat: boolean;
  canViewVoiceChannelText: boolean;
  activeChannelName: string;
  activeChannelType: "text" | "voice";
  restoreText: string | null;
  clearRestoreText: () => void;
  fetchOlderMessages: () => void;
  isLoadingOlder: boolean;
  hasOlderMessages: boolean;
}

export function useChat({
  currentConnection,
  activeConversationId,
  currentlyViewingServer,
  currentChannelId,
  isConnected,
  serverDetailsList,
  nickname,
  currentUserId,
}: UseChatParams): UseChatReturn {
  const serverHost = currentlyViewingServer?.host || "";
  const { incrementUnread } = useUnreadBadge();
  const { notificationBadgeEnabled, messageSoundEnabled, messageSoundVolume, customMessageSoundFile } = useSettings();
  const notificationBadgeEnabledRef = useRef(notificationBadgeEnabled);
  useEffect(() => { notificationBadgeEnabledRef.current = notificationBadgeEnabled; }, [notificationBadgeEnabled]);

  const [playMessageSound] = useSound(customMessageSoundFile || messageSoundMp3, {
    volume: messageSoundVolume / 100,
    soundEnabled: messageSoundEnabled,
  });
  const messageSoundRef = useRef(playMessageSound);
  const messageSoundEnabledRef = useRef(messageSoundEnabled);
  useEffect(() => { messageSoundRef.current = playMessageSound; }, [playMessageSound]);
  useEffect(() => { messageSoundEnabledRef.current = messageSoundEnabled; }, [messageSoundEnabled]);

  const [restoreText, setRestoreText] = useState<string | null>(null);
  const clearRestoreText = useCallback(() => setRestoreText(null), []);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [messageCache, setMessageCache] = useState<{ [conversationId: string]: ChatMessage[] }>({});
  const [messageCacheMeta, setMessageCacheMeta] = useState<{
    [conversationId: string]: { lastFetchedAtMs?: number; rateLimitedUntilMs?: number };
  }>({});
  const fetchDebounceRef = useRef<number | null>(null);
  const inFlightFetchRef = useRef<Set<string>>(new Set());
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasOlderMap, setHasOlderMap] = useState<Record<string, boolean>>({});
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);
  const rateLimitIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const cacheKeyFor = useCallback((conversationId: string): string => {
    if (!conversationId) return "";
    return serverHost ? `${serverHost}::${conversationId}` : conversationId;
  }, [serverHost]);

  const activeCacheKey = cacheKeyFor(activeConversationId);
  const hasOlderMessages = hasOlderMap[activeCacheKey] ?? true;

  const getCachedMessages = useCallback(
    (conversationId: string): ChatMessage[] => messageCache[cacheKeyFor(conversationId)] || [],
    [messageCache, cacheKeyFor]
  );

  // Voice channel text chat permission checks
  const isVoiceChannelTextChat = activeConversationId === currentChannelId;
  const activeVoiceChannel = isVoiceChannelTextChat && currentlyViewingServer
    ? serverDetailsList[currentlyViewingServer.host]?.channels?.find((c) => c.id === currentChannelId)
    : undefined;
  const textInVoiceEnabled = activeVoiceChannel?.textInVoice === true;
  const canSendToVoiceChannel = !isVoiceChannelTextChat || (isConnected && textInVoiceEnabled);
  const canViewVoiceChannelText = !isVoiceChannelTextChat || (isConnected && textInVoiceEnabled);

  const canSend = !!currentConnection &&
                  !!activeConversationId &&
                  !!getServerAccessToken(currentlyViewingServer?.host || "") &&
                  isUserAuthenticated() &&
                  canSendToVoiceChannel &&
                  !isRateLimited;

  const { sendChat, editMessage, retryQueueRef, performRetry, markLatestPendingFailed } = useChatSend({
    currentConnection,
    activeConversationId,
    serverHost,
    currentlyViewingServer,
    cacheKeyFor,
    setChatMessages,
    setMessageCache,
    setRestoreText,
    canSend,
    isRateLimited,
    isVoiceChannelTextChat,
    textInVoiceEnabled,
    isConnected,
    nickname,
    currentUserId,
  });

  // Handle chat errors (including rate limiting)
  useEffect(() => {
    if (!currentConnection) return;

    const onError = (error: ChatErrorPayload) => {
      handleChatErrorEvent(error, activeConversationId, cacheKeyFor(activeConversationId), {
        setIsRateLimited,
        setMessageCacheMeta,
        setChatMessages,
        setChatText: setRestoreText,
        rateLimitIntervalRef,
        setRateLimitCountdown,
        onRetry: performRetry,
        onFail: markLatestPendingFailed,
        retryQueueRef,
      });
    };

    currentConnection.on("chat:error", onError);

    return () => {
      currentConnection.off("chat:error", onError);
      if (rateLimitIntervalRef.current) {
        clearInterval(rateLimitIntervalRef.current);
        rateLimitIntervalRef.current = null;
      }
    };
  }, [currentConnection, activeConversationId, cacheKeyFor, performRetry, markLatestPendingFailed, retryQueueRef]);

  // Clear rate limiting state and retry queue when switching servers
  useEffect(() => {
    setIsRateLimited(false);
    setRateLimitCountdown(0);
    setRestoreText(null);

    if (rateLimitIntervalRef.current) {
      clearInterval(rateLimitIntervalRef.current);
      rateLimitIntervalRef.current = null;
    }

    for (const entry of retryQueueRef.current.values()) {
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
    }
    retryQueueRef.current.clear();
  }, [currentlyViewingServer?.host, retryQueueRef]);

  useEffect(() => {
    setRestoreText(null);
  }, [activeConversationId]);

  const activeChannel = useMemo(() => {
    if (!currentlyViewingServer) return undefined;
    const channels = serverDetailsList[currentlyViewingServer.host]?.channels || [];
    return channels.find((c) => c.id === activeConversationId);
  }, [currentlyViewingServer, serverDetailsList, activeConversationId]);

  const activeChannelName = activeChannel?.name || "";
  const activeChannelType: "text" | "voice" = activeChannel?.type || "text";

  // Chat event listeners
  useEffect(() => {
    if (!currentConnection) return;

    const onNew = (msg: ChatMessage) => {
      for (const [pendingId, entry] of retryQueueRef.current) {
        const matchByNonce = msg.nonce && entry.nonce === msg.nonce;
        const matchByText = msg.text && entry.text === msg.text.trim();
        if (matchByNonce || matchByText) {
          if (entry.timeoutId) clearTimeout(entry.timeoutId);
          retryQueueRef.current.delete(pendingId);
          break;
        }
      }
      handleNewMessage(msg, activeConversationId, cacheKeyFor, setMessageCache, setChatMessages);
      if (msg.conversation_id !== activeConversationId && msg.sender_server_id !== currentUserId) {
        markChannelUnread(serverHost, msg.conversation_id);
      }
      if (msg.sender_server_id !== currentUserId && !document.hasFocus()) {
        if (notificationBadgeEnabledRef.current) incrementUnread();
        if (messageSoundEnabledRef.current) {
          try { messageSoundRef.current(); } catch { /* ignore playback errors */ }
        }
      }
    };

    const onHistory = (payload: HistoryPayload) => {
      const setHasOlder = (v: boolean) => {
        const key = cacheKeyFor(payload.conversation_id);
        if (key) setHasOlderMap((prev) => ({ ...prev, [key]: v }));
      };
      handleHistoryPayload(payload, activeConversationId, cacheKeyFor, inFlightFetchRef, setMessageCache, setChatMessages, setIsLoadingMessages, setHasOlder, setIsLoadingOlder);
    };

    const onReaction = (updatedMessage: ChatMessage) =>
      handleReactionUpdate(updatedMessage, activeConversationId, cacheKeyFor, setMessageCache, setChatMessages);

    const onDeleted = (payload: { conversation_id: string; message_id: string }) =>
      handleMessageDeleted(payload, activeConversationId, cacheKeyFor, setMessageCache, setChatMessages);

    const onEdited = (updatedMessage: ChatMessage) =>
      handleMessageEdited(updatedMessage, activeConversationId, cacheKeyFor, setMessageCache, setChatMessages);

    const onReportSubmitted = () => {
      toast.success("Report submitted");
    };

    const onAlreadyReported = () => {
      toast("You've already reported this message", { icon: "ℹ️" });
    };

    const onPurgeUser = (payload: { sender_server_user_id: string; affected_conversations: string[] }) => {
      setChatMessages((prev) =>
        prev.filter((m) => m.sender_server_id !== payload.sender_server_user_id),
      );
      setMessageCache((prev) => {
        const next = { ...prev };
        for (const convId of payload.affected_conversations) {
          const key = cacheKeyFor(convId);
          if (next[key]) {
            next[key] = next[key].filter(
              (m) => m.sender_server_id !== payload.sender_server_user_id,
            );
          }
        }
        return next;
      });
    };

    currentConnection.on("chat:new", onNew);
    currentConnection.on("chat:history", onHistory);
    currentConnection.on("chat:reaction", onReaction);
    currentConnection.on("chat:deleted", onDeleted);
    currentConnection.on("chat:edited", onEdited);
    currentConnection.on("report:submitted", onReportSubmitted);
    currentConnection.on("report:already_reported", onAlreadyReported);
    currentConnection.on("chat:purge_user", onPurgeUser);
    return () => {
      currentConnection.off("chat:new", onNew);
      currentConnection.off("chat:history", onHistory);
      currentConnection.off("chat:reaction", onReaction);
      currentConnection.off("chat:deleted", onDeleted);
      currentConnection.off("chat:edited", onEdited);
      currentConnection.off("report:submitted", onReportSubmitted);
      currentConnection.off("report:already_reported", onAlreadyReported);
      currentConnection.off("chat:purge_user", onPurgeUser);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentConnection, activeConversationId, cacheKeyFor]);

  // Reset chat list when conversation changes and load history
  useEffect(() => {
    setIsLoadingOlder(false);

    const cachedMessages = getCachedMessages(activeConversationId);
    if (cachedMessages.length > 0) {
      setChatMessages(cachedMessages);
      setIsLoadingMessages(false);
    } else if (cachedMessages.length === 0 && messageCache[cacheKeyFor(activeConversationId)]) {
      setChatMessages([]);
      setIsLoadingMessages(false);
    } else {
      setChatMessages([]);
      setIsLoadingMessages(true);
    }

    if (!currentConnection || !activeConversationId) return;

    const isVoiceChat = activeConversationId === currentChannelId;
    const canViewVoice = !isVoiceChat || isConnected;

    if (isVoiceChat && !canViewVoice) {
      if (currentlyViewingServer) {
        const channels = serverDetailsList[currentlyViewingServer.host]?.channels || [];
        const textChannels = channels.filter((channel) => channel.type === 'text');
        if (textChannels.length > 0) {
          return;
        } else {
          return;
        }
      }
    }

    const scopedKey = cacheKeyFor(activeConversationId);
    if (!shouldFetchHistory(scopedKey, activeConversationId, currentConnection, messageCache, messageCacheMeta)) {
      setIsLoadingMessages(false);
      return;
    }

    if (inFlightFetchRef.current.has(scopedKey)) {
      return;
    }

    if (fetchDebounceRef.current) {
      window.clearTimeout(fetchDebounceRef.current);
      fetchDebounceRef.current = null;
    }

    fetchDebounceRef.current = window.setTimeout(() => {
      if (!currentConnection || !activeConversationId) return;
      const scopedKey = cacheKeyFor(activeConversationId);
      if (!scopedKey) return;
      if (inFlightFetchRef.current.has(scopedKey)) return;

      inFlightFetchRef.current.add(scopedKey);
      setMessageCacheMeta((prev) => ({
        ...prev,
        [scopedKey]: {
          ...(prev[scopedKey] || {}),
          lastFetchedAtMs: Date.now(),
        },
      }));

      currentConnection.emit("chat:fetch", { conversationId: activeConversationId, limit: 50 });
    }, 250);

    return () => {
      if (fetchDebounceRef.current) {
        window.clearTimeout(fetchDebounceRef.current);
        fetchDebounceRef.current = null;
      }
    };
  }, [
    activeConversationId,
    currentConnection,
    currentChannelId,
    isConnected,
    currentlyViewingServer,
    serverDetailsList,
    getCachedMessages,
    cacheKeyFor,
    messageCache,
    messageCacheMeta,
  ]);

  const fetchOlderMessages = useCallback(() => {
    if (!currentConnection || !activeConversationId || isLoadingOlder || !hasOlderMessages) {
      return;
    }
    const oldest = chatMessages[0];
    if (!oldest) return;
    const before = new Date(oldest.created_at).toISOString();
    setIsLoadingOlder(true);
    const scopedKey = cacheKeyFor(activeConversationId);
    inFlightFetchRef.current.add(scopedKey);
    currentConnection.emit("chat:fetch", { conversationId: activeConversationId, limit: 50, before });
  }, [currentConnection, activeConversationId, isLoadingOlder, hasOlderMessages, chatMessages, cacheKeyFor]);

  return {
    chatMessages,
    canSend,
    sendChat,
    editMessage,
    isLoadingMessages,
    isRateLimited,
    rateLimitCountdown,
    isVoiceChannelTextChat,
    canViewVoiceChannelText,
    activeChannelName,
    activeChannelType,
    restoreText,
    clearRestoreText,
    fetchOlderMessages,
    isLoadingOlder,
    hasOlderMessages,
  };
}
