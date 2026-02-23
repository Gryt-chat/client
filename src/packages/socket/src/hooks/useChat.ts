import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";
import useSound from "use-sound";
import { v4 as uuidv4 } from "uuid";

import messageSoundMp3 from "@/audio/src/assets/universfield-computer-mouse-click-02-383961.mp3";
import { getServerAccessToken, getServerHttpBase, getServerRefreshToken, getValidIdentityToken, isUserAuthenticated, useUnreadBadge } from "@/common";
import { useSettings } from "@/settings";
import { serverDetailsList as ServerDetailsList } from "@/settings/src/types/server";

import { ChatMessage } from "../components/ChatView";
import { shouldRefreshToken } from "../utils/tokenManager";
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
  const retryQueueRef = useRef<Map<string, {
    nonce: string;
    retryCount: number;
    accessToken: string;
    conversationId: string;
    text: string;
    attachments: string[] | null;
    replyToMessageId?: string;
    timeoutId?: ReturnType<typeof setTimeout>;
  }>>(new Map());

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

  const performRetry = useCallback(() => {
    const queue = retryQueueRef.current;
    let target: { pendingId: string; entry: (typeof queue extends Map<string, infer V> ? V : never) } | null = null;
    for (const [pendingId, entry] of queue) {
      if (entry.retryCount < 1) {
        target = { pendingId, entry };
      }
    }
    if (!target || !currentConnection) return;

    target.entry.retryCount++;
    const freshToken = getServerAccessToken(currentlyViewingServer?.host || "");
    if (freshToken) target.entry.accessToken = freshToken;

    const payload: Record<string, unknown> = {
      conversationId: target.entry.conversationId,
      accessToken: target.entry.accessToken,
      text: target.entry.text,
      nonce: target.entry.nonce,
    };
    if (target.entry.attachments?.length) payload.attachments = target.entry.attachments;
    if (target.entry.replyToMessageId) payload.replyToMessageId = target.entry.replyToMessageId;
    currentConnection.emit("chat:send", payload);
  }, [currentConnection, currentlyViewingServer?.host]);

  const markLatestPendingFailed = useCallback(() => {
    const queue = retryQueueRef.current;
    let latestPendingId: string | null = null;
    for (const [pendingId] of queue) {
      latestPendingId = pendingId;
    }
    if (!latestPendingId) return;

    const entry = queue.get(latestPendingId);
    if (entry?.timeoutId) clearTimeout(entry.timeoutId);
    queue.delete(latestPendingId);

    const failId = latestPendingId;
    setChatMessages((prev) => {
      const msg = prev.find((m) => m.message_id === failId);
      if (msg?.text) setRestoreText(msg.text);
      return prev.map((m) =>
        m.message_id === failId ? { ...m, pending: false, failed: true } : m
      );
    });
    setMessageCache((prev) => {
      const key = cacheKeyFor(activeConversationId);
      const existing = prev[key] || [];
      return {
        ...prev,
        [key]: existing.map((m) =>
          m.message_id === failId ? { ...m, pending: false, failed: true } : m
        ),
      };
    });
  }, [activeConversationId, cacheKeyFor]);

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
  }, [currentConnection, activeConversationId, cacheKeyFor, performRetry, markLatestPendingFailed]);

  // Clear rate limiting state and retry queue when switching servers (but not channels)
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
  }, [currentlyViewingServer?.host]);

  // Clear restore text when switching channels
  useEffect(() => {
    setRestoreText(null);
  }, [activeConversationId]);

  const activeChannelName = useMemo(() => {
    if (!currentlyViewingServer) return "";
    const channels = serverDetailsList[currentlyViewingServer.host]?.channels || [];
    const found = channels.find((c) => c.id === activeConversationId);
    return found?.name || "";
  }, [currentlyViewingServer, serverDetailsList, activeConversationId]);

  // Chat event listeners (chat:new, chat:history, chat:reaction)
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

  const sendMessageWithToken = useCallback((accessToken: string, messageText: string, attachments: string[] | null, replyToMessageId?: string, nonce?: string) => {
    const payload: Record<string, unknown> = {
      conversationId: activeConversationId,
      accessToken,
      text: messageText,
    };
    if (attachments && attachments.length > 0) payload.attachments = attachments;
    if (replyToMessageId) payload.replyToMessageId = replyToMessageId;
    if (nonce) payload.nonce = nonce;
    currentConnection!.emit("chat:send", payload);
  }, [activeConversationId, currentConnection]);

  const uploadFile = useCallback(async (file: File): Promise<string> => {
    const accessToken = getServerAccessToken(serverHost);
    if (!accessToken) throw new Error("Not authenticated with this server");
    const base = getServerHttpBase(serverHost);
    const form = new FormData();
    form.append("file", file);
    const resp = await fetch(`${base}/api/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
    if (!resp.ok) {
      const raw = await resp.text().catch(() => "");
      let msg = `Upload failed (${resp.status})`;
      try {
        const err = raw ? JSON.parse(raw) : {};
        if (err.message) msg = err.message;
        else if (err.error) msg = err.error;
      } catch { /* ignored */ }
      console.error("[Upload] Failed:", { status: resp.status, url: `${base}/api/uploads`, body: raw });
      throw new Error(msg);
    }
    const data = await resp.json();
    return data.fileId as string;
  }, [serverHost]);

  const canSendRef = useRef(canSend);
  canSendRef.current = canSend;
  const isRateLimitedRef = useRef(isRateLimited);
  isRateLimitedRef.current = isRateLimited;
  const isVoiceChannelTextChatRef = useRef(isVoiceChannelTextChat);
  isVoiceChannelTextChatRef.current = isVoiceChannelTextChat;
  const textInVoiceEnabledRef = useRef(textInVoiceEnabled);
  textInVoiceEnabledRef.current = textInVoiceEnabled;
  const isConnectedRef = useRef(isConnected);
  isConnectedRef.current = isConnected;
  const nicknameRef = useRef(nickname);
  nicknameRef.current = nickname;
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;

  const sendChat = useCallback((text: string, files: File[], replyToMessageId?: string) => {
    const body = text.trim();
    if (!body && files.length === 0) return;

    if (!canSendRef.current) {
      if (isRateLimitedRef.current) return;
      if (isVoiceChannelTextChatRef.current && !textInVoiceEnabledRef.current) {
        toast.error("Text chat is disabled in this voice channel");
      } else if (isVoiceChannelTextChatRef.current && !isConnectedRef.current) {
        toast.error("You must be connected to this voice channel to send messages");
      }
      return;
    }

    let accessToken = getServerAccessToken(currentlyViewingServer?.host || "");

    if (!accessToken) {
      if (currentConnection && nicknameRef.current) {
        setTimeout(() => {
          (async () => {
            const identityToken = await getValidIdentityToken().catch(() => undefined);
            currentConnection.emit("server:join", {
              password: "",
              nickname: nicknameRef.current,
              identityToken,
            });
          })();
        }, 250);
      }
      return;
    }

    const pendingId = `pending-${uuidv4()}`;
    const nonce = uuidv4();
    const optimistic: ChatMessage = {
      conversation_id: activeConversationId,
      message_id: pendingId,
      sender_server_id: currentUserIdRef.current || "temp",
      text: body || null,
      attachments: null,
      created_at: new Date(),
      reactions: null,
      reply_to_message_id: replyToMessageId || null,
      pending: true,
      nonce,
      sender_nickname: nicknameRef.current || undefined,
    };
    setChatMessages((prev) => [...prev, optimistic]);
    setMessageCache((prev) => ({
      ...prev,
      [cacheKeyFor(activeConversationId)]: [...(prev[cacheKeyFor(activeConversationId)] || []), optimistic],
    }));

    const doSend = async () => {
      if (shouldRefreshToken(accessToken!)) {
        const host = currentlyViewingServer?.host || "";
        const refreshToken = getServerRefreshToken(host);
        const identityToken = await getValidIdentityToken().catch(() => undefined);
        if (refreshToken && identityToken) {
          currentConnection!.emit("token:refresh", { refreshToken, identityToken });
        } else {
          currentConnection!.emit("token:refresh", { accessToken });
        }
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 100));
          const fresh = getServerAccessToken(host);
          if (fresh && fresh !== accessToken) {
            accessToken = fresh;
            break;
          }
        }
      }

      if (!accessToken) return;

      let fileIds: string[] | null = null;
      if (files.length > 0) {
        try {
          fileIds = await Promise.all(files.map(uploadFile));
        } catch (err) {
          const msg = err instanceof Error && err.message ? err.message : "Failed to upload file(s)";
          toast.error(msg);
          return;
        }
      }

      const finalText = body;

      if (accessToken) {
        retryQueueRef.current.set(pendingId, {
          nonce,
          retryCount: 0,
          accessToken,
          conversationId: activeConversationId,
          text: finalText,
          attachments: fileIds,
          replyToMessageId,
        });
        sendMessageWithToken(accessToken, finalText, fileIds, replyToMessageId, nonce);
      }
    };

    doSend();
  }, [currentConnection, currentlyViewingServer?.host, activeConversationId, cacheKeyFor, sendMessageWithToken, uploadFile]);

  const fetchOlderMessages = useCallback(() => {
    if (!currentConnection || !activeConversationId || isLoadingOlder || !hasOlderMessages) return;
    const oldest = chatMessages[0];
    if (!oldest) return;
    const before = new Date(oldest.created_at).toISOString();
    setIsLoadingOlder(true);
    const scopedKey = cacheKeyFor(activeConversationId);
    inFlightFetchRef.current.add(scopedKey);
    currentConnection.emit("chat:fetch", { conversationId: activeConversationId, limit: 50, before });
  }, [currentConnection, activeConversationId, isLoadingOlder, hasOlderMessages, chatMessages, cacheKeyFor]);

  const editMessage = useCallback((messageId: string, conversationId: string, newText: string) => {
    const text = newText.trim();
    if (!text || !currentConnection) return;
    const accessToken = getServerAccessToken(currentlyViewingServer?.host || "");
    if (!accessToken) return;
    currentConnection.emit("chat:edit", { conversationId, messageId, text, accessToken });
  }, [currentConnection, currentlyViewingServer?.host]);

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
    restoreText,
    clearRestoreText,
    fetchOlderMessages,
    isLoadingOlder,
    hasOlderMessages,
  };
}
