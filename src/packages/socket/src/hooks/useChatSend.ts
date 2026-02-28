import { Dispatch, MutableRefObject, SetStateAction, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";

import { getServerAccessToken, getServerRefreshToken } from "@/common";

import type { AttachmentMeta, ChatMessage } from "../components/chatUtils";
import { getImageDimensions } from "../utils/imageUtils";
import { shouldRefreshToken } from "../utils/tokenManager";
import { uploadChatFile } from "./uploadChatFile";

export interface RetryEntry {
  nonce: string;
  retryCount: number;
  accessToken: string;
  conversationId: string;
  text: string;
  attachments: string[] | null;
  replyToMessageId?: string;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface UseChatSendParams {
  currentConnection: Socket | null;
  activeConversationId: string;
  serverHost: string;
  currentlyViewingServer: { host: string; name: string } | null;
  cacheKeyFor: (conversationId: string) => string;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setMessageCache: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  setRestoreText: Dispatch<SetStateAction<string | null>>;
  canSend: boolean;
  isRateLimited: boolean;
  isVoiceChannelTextChat: boolean;
  textInVoiceEnabled: boolean;
  isConnected: boolean;
  nickname: string;
  currentUserId?: string;
}

interface UseChatSendReturn {
  sendChat: (text: string, files: File[], replyToMessageId?: string) => void;
  editMessage: (messageId: string, conversationId: string, newText: string) => void;
  retryQueueRef: MutableRefObject<Map<string, RetryEntry>>;
  performRetry: () => void;
  markLatestPendingFailed: () => void;
}

export function useChatSend({
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
}: UseChatSendParams): UseChatSendReturn {
  const retryQueueRef = useRef<Map<string, RetryEntry>>(new Map());

  const performRetry = useCallback(() => {
    const queue = retryQueueRef.current;
    let target: { pendingId: string; entry: RetryEntry } | null = null;
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
  }, [activeConversationId, cacheKeyFor, setChatMessages, setMessageCache, setRestoreText]);

  const sendMessageWithToken = useCallback((
    accessToken: string,
    messageText: string,
    attachments: string[] | null,
    replyToMessageId?: string,
    nonce?: string,
  ) => {
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
          currentConnection.emit("server:join", {
            nickname: nicknameRef.current,
          });
        }, 250);
      }
      return;
    }

    const pendingId = `pending-${uuidv4()}`;
    const nonce = uuidv4();

    const doSend = async () => {
      let localAttachmentIds: string[] | null = null;
      let localEnriched: AttachmentMeta[] | null = null;

      if (files.length > 0) {
        const dims = await Promise.all(files.map((f) => getImageDimensions(f)));
        localAttachmentIds = files.map(() => `local-${uuidv4()}`);
        localEnriched = files.map((f, i) => ({
          file_id: localAttachmentIds![i],
          mime: f.type || null,
          size: f.size,
          original_name: f.name,
          width: dims[i]?.width ?? null,
          height: dims[i]?.height ?? null,
          has_thumbnail: false,
          local_url: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
        }));
      }

      const optimistic: ChatMessage = {
        conversation_id: activeConversationId,
        message_id: pendingId,
        sender_server_id: currentUserIdRef.current || "temp",
        text: body || null,
        attachments: localAttachmentIds,
        enriched_attachments: localEnriched,
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

      if (shouldRefreshToken(accessToken!)) {
        const host = currentlyViewingServer?.host || "";
        const refreshToken = getServerRefreshToken(host);
        if (refreshToken) {
          currentConnection!.emit("token:refresh", { refreshToken });
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
          fileIds = await Promise.all(
            files.map((f, i) => {
              const dim = localEnriched?.[i];
              const dimensions = dim?.width && dim?.height ? { width: dim.width, height: dim.height } : null;
              return uploadChatFile(f, serverHost, dimensions);
            }),
          );
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
  }, [currentConnection, currentlyViewingServer?.host, activeConversationId, serverHost, cacheKeyFor, sendMessageWithToken, setChatMessages, setMessageCache]);

  const editMessage = useCallback((messageId: string, conversationId: string, newText: string) => {
    const text = newText.trim();
    if (!text || !currentConnection) return;
    const accessToken = getServerAccessToken(currentlyViewingServer?.host || "");
    if (!accessToken) return;
    currentConnection.emit("chat:edit", { conversationId, messageId, text, accessToken });
  }, [currentConnection, currentlyViewingServer?.host]);

  return { sendChat, editMessage, retryQueueRef, performRetry, markLatestPendingFailed };
}
