import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";
import useSound from "use-sound";

import messageSoundMp3 from "@/audio/src/assets/universfield-computer-mouse-click-02-383961.mp3";
import type { SealDecision } from "@/common";
import { getServerAccessToken, getUploadsFileUrl, markChannelUnread, useUnreadBadge } from "@/common";
import { useSettings } from "@/settings";
import { type ForumTag,serverDetailsList as ServerDetailsList } from "@/settings/src/types/server";

import type { ChatMessage } from "../components/chatUtils";
import {
  fetchSealedAttachment,
  sealedAttachmentMeta,
} from "../utils/sealedAttachments";
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
import { useConversationSealing } from "./useConversationSealing";

interface UseChatParams {
  currentConnection: Socket | null;
  activeConversationId: string;
  currentlyViewingServer: { host: string; name: string } | null;
  currentChannelId: string;
  isConnected: boolean;
  serverDetailsList: ServerDetailsList;
  nickname: string;
  currentUserId?: string;
  /**
   * Everybody in this conversation apart from you, or null for a channel
   * (GRYT-729). Only a conversation can be encrypted.
   */
  conversationMembers?: { server_user_id: string }[] | null;
}

interface UseChatReturn {
  chatMessages: ChatMessage[];
  sealing: SealDecision;
  canSend: boolean;
  /** Whether the open channel allows posting at all, before anything else. */
  canSendHere: boolean;
  sendChat: (text: string, files: File[], replyToMessageId?: string) => void;
  editMessage: (messageId: string, conversationId: string, newText: string) => void;
  isLoadingMessages: boolean;
  isRateLimited: boolean;
  rateLimitCountdown: number;
  isVoiceChannelTextChat: boolean;
  canViewVoiceChannelText: boolean;
  activeChannelName: string;
  activeChannelType: "text" | "voice";
  activeChannelAutomated: boolean;
  activeChannelLayout: "chat" | "forum";
  activeChannelForumTags: ForumTag[];
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
  conversationMembers,
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
  const activeChannel = useMemo(() => {
    if (!currentlyViewingServer) return undefined;
    const channels = serverDetailsList[currentlyViewingServer.host]?.channels || [];
    return channels.find((c) => c.id === activeConversationId);
  }, [currentlyViewingServer, serverDetailsList, activeConversationId]);

  const canSendToVoiceChannel = !isVoiceChannelTextChat || (isConnected && textInVoiceEnabled);
  const canViewVoiceChannelText = !isVoiceChannelTextChat || (isConnected && textInVoiceEnabled);

  /**
   * The server's own token is the credential, not a Keycloak session.
   *
   * This used to require isUserAuthenticated() as well, which is true only when
   * Keycloak says so — and a server that admits the local tier issues a token to
   * somebody who has never seen Keycloak. The join dialog tells them "No account
   * needed", and then the composer took what they typed, cleared it, and sent
   * nothing.
   */
  /*
   * Whether this channel is one they may post in, as the server resolved it.
   *
   * Server-wide `send_messages` is not the whole answer: a channel scope can
   * take it away or hand it out, and those rules are only readable with
   * `manage_channels`. `undefined` means the server is too old to have an
   * opinion, which has to read as yes or every channel on it would look locked.
   */
  const canSendHere = activeChannel?.canSend !== false;

  const canSend = !!currentConnection &&
                  !!activeConversationId &&
                  !!getServerAccessToken(currentlyViewingServer?.host || "") &&
                  canSendToVoiceChannel &&
                  canSendHere &&
                  !isRateLimited;

  const sealing = useConversationSealing({
    serverHost,
    conversationId: activeConversationId,
    myServerUserId: currentUserId,
    members: conversationMembers ?? null,
  });

  /** Blob URLs made for decrypted attachments, revoked on unmount. */
  const objectUrlsRef = useRef<Set<string>>(new Set());

  const { sendChat, editMessage, retryQueueRef, performRetry, markLatestPendingFailed } = useChatSend({
    seal: sealing.seal,
    sealFile: sealing.sealFile,
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

  /*
   * Open whatever arrived sealed (GRYT-729).
   *
   * Here rather than in `onNew` and `onHistory` separately, because both put
   * messages into the same state and opening is asynchronous — doing it at
   * arrival would mean two copies racing each other's `setChatMessages`.
   *
   * `sealedState` is set to `opening` before the work starts, so a second pass
   * over the same list does not start it again.
   */
  useEffect(() => {
    const pending = chatMessages.filter((m) => m.sealed && !m.sealedState);
    if (pending.length === 0) return;

    const ids = new Set(pending.map((m) => m.message_id));
    setChatMessages((prev) =>
      prev.map((m) => (ids.has(m.message_id) ? { ...m, sealedState: "opening" } : m)),
    );

    let live = true;
    void Promise.all(
      pending.map(async (message) => {
        try {
          const opened = await sealing.open(message.sealed!);
          // Null is no wrapped key for us: a message from before we joined the
          // conversation. Permanent, ordinary, and not an error.
          if (!opened) {
            return { id: message.message_id, text: null, state: "locked", enriched: null } as const;
          }

          /*
           * The files, decrypted, in the shape the row already draws
           * (GRYT-761).
           *
           * Fetched here rather than in the row, because the key only exists
           * once the message has opened and a component that fetched on render
           * would do it again on every re-render. One failed attachment does
           * not fail the message.
           */
          const fileIds = message.attachments ?? [];
          const settled = await Promise.allSettled(
            fileIds.map(async (fileId) => {
              const key = opened.attachments[fileId];
              // No key for this one means it went up in the clear, which is
              // every attachment sent before this shipped. The server's own
              // metadata already describes it.
              if (!key) return null;

              const blob = await fetchSealedAttachment({
                url: getUploadsFileUrl(serverHost, fileId),
                key,
                openFile: sealing.openFile,
              });
              const objectUrl = URL.createObjectURL(blob);
              objectUrlsRef.current.add(objectUrl);
              return sealedAttachmentMeta(fileId, key, objectUrl);
            }),
          );

          const enriched = fileIds.map((fileId, i) => {
            const result = settled[i];
            if (result.status === "fulfilled" && result.value) return result.value;
            // Either it was never sealed, or it would not open. Fall back to
            // what the server says, which for a sealed file is an unnamed
            // octet-stream — visibly broken rather than invisibly absent.
            return (
              message.enriched_attachments?.[i] ?? {
                file_id: fileId,
                mime: null,
                size: null,
                original_name: null,
                width: null,
                height: null,
                has_thumbnail: false,
              }
            );
          });

          return {
            id: message.message_id,
            text: opened.text,
            state: "open",
            enriched: enriched.length > 0 ? enriched : null,
          } as const;
        } catch {
          // A key that is there and does not open. Tampering, or the wrong
          // conversation. Drawn as broken rather than as an empty message.
          return { id: message.message_id, text: null, state: "broken", enriched: null } as const;
        }
      }),
    ).then((opened) => {
      if (!live) return;
      const byId = new Map(opened.map((o) => [o.id, o]));
      setChatMessages((prev) =>
        prev.map((m) => {
          const result = byId.get(m.message_id);
          if (!result) return m;
          return {
            ...m,
            text: result.text,
            sealedState: result.state,
            ...(result.enriched ? { enriched_attachments: result.enriched } : null),
          };
        }),
      );
    });

    return () => {
      live = false;
    };
  }, [chatMessages, sealing, setChatMessages, serverHost]);

  /**
   * Every blob URL made for a decrypted attachment, so they can be let go.
   *
   * A blob URL pins its bytes for the lifetime of the document. Scrolling a
   * conversation full of photographs and never revoking them is a leak that
   * grows with the history, and on the desktop the document is the session.
   */
  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

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

  const activeChannelName = activeChannel?.name || "";
  const activeChannelType: "text" | "voice" = activeChannel?.type || "text";
  // Automated is enforced by the server in the send path; the client reads it
  // only to lock the composer and draw the robot icon. GRYT-982.
  const activeChannelAutomated = activeChannel?.automated === true;
  const activeChannelLayout: "chat" | "forum" = activeChannel?.layout === "forum" ? "forum" : "chat";
  const activeChannelForumTags: ForumTag[] = activeChannel?.forumTags ?? [];

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
      const gone = payload.sender_server_user_id;

      /**
       * Their reactions on everybody else's messages, which the purge event
       * does not name.
       *
       * The server has already removed them and works this out the same way,
       * but says nothing per message: someone with a few hundred reactions
       * would otherwise be a few hundred broadcasts. A reaction whose last user
       * was this person is dropped rather than left showing zero.
       */
      const stripReactions = (list: ChatMessage[]): ChatMessage[] =>
        list.map((m) => {
          if (!m.reactions?.some((r) => r.users?.includes(gone))) return m;
          const reactions = m.reactions
            .map((r) =>
              r.users?.includes(gone)
                ? { ...r, users: r.users.filter((u) => u !== gone), amount: r.users.filter((u) => u !== gone).length }
                : r,
            )
            .filter((r) => r.users.length > 0);
          return { ...m, reactions: reactions.length > 0 ? reactions : null };
        });

      setChatMessages((prev) =>
        stripReactions(prev.filter((m) => m.sender_server_id !== gone)),
      );
      setMessageCache((prev) => {
        const next = { ...prev };
        // Their messages only exist in the conversations named, but their
        // reactions can be anywhere, so every cached conversation is swept.
        for (const key of Object.keys(next)) {
          next[key] = stripReactions(next[key].filter((m) => m.sender_server_id !== gone));
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
    /**
     * Whether the next message will be encrypted, and who is stopping it
     * (GRYT-729). A composer that does not draw this sends in the clear
     * without saying so.
     */
    sealing: sealing.decision,
    canSend,
    canSendHere,
    sendChat,
    editMessage,
    isLoadingMessages,
    isRateLimited,
    rateLimitCountdown,
    isVoiceChannelTextChat,
    canViewVoiceChannelText,
    activeChannelName,
    activeChannelType,
    activeChannelAutomated,
    activeChannelLayout,
    activeChannelForumTags,
    restoreText,
    clearRestoreText,
    fetchOlderMessages,
    isLoadingOlder,
    hasOlderMessages,
  };
}
