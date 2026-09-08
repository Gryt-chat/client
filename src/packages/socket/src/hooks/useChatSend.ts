import { Dispatch, MutableRefObject, SetStateAction, useCallback, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";

import type { SealDecision, SealedAttachmentKey } from "@/common";
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
  /**
   * The file keys, by the id the server gave each upload. Carried on the retry
   * entry so a resend seals the same message with the same files (GRYT-761).
   */
  attachmentKeys?: Record<string, SealedAttachmentKey> | null;
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
  /** Whether the next message can be sealed, and who is stopping it. */
  sealDecision: SealDecision;
  canSend: boolean;
  isRateLimited: boolean;
  isVoiceChannelTextChat: boolean;
  textInVoiceEnabled: boolean;
  isConnected: boolean;
  nickname: string;
  currentUserId?: string;
  /**
   * Seal a message for this conversation, or null for "send it as text". Passed
   * in so the composer can draw the same answer this uses (GRYT-729).
   */
  seal: (
    plaintext: string,
    attachments?: Record<string, SealedAttachmentKey>,
  ) => Promise<string | null>;
  /**
   * Encrypt one file, or null for "send it as it is". Has to agree with `seal`:
   * a file sealed for a plaintext message is an upload nobody can open (GRYT-761).
   */
  sealFile: (
    bytes: Uint8Array,
    about?: { name?: string; mime?: string; width?: number; height?: number },
  ) => { ciphertext: Uint8Array; meta: SealedAttachmentKey } | null;
}

interface UseChatSendReturn {
  sendChat: (text: string, files: File[], replyToMessageId?: string) => void;
  editMessage: (messageId: string, conversationId: string, newText: string) => void;
  retryQueueRef: MutableRefObject<Map<string, RetryEntry>>;
  performRetry: () => void;
  markLatestPendingFailed: () => void;
  /**
   * Set when a send was held back because the conversation would go out in the
   * clear, and carries who is blocking it. Null the rest of the time.
   */
  plaintextPrompt: SealDecision | null;
  /** Send it unencrypted, and stop asking for this conversation. */
  confirmPlaintextSend: () => void;
  /** Do not send it. The text goes back in the composer. */
  cancelPlaintextSend: () => void;
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
  sealDecision,
  canSend,
  isRateLimited,
  isVoiceChannelTextChat,
  textInVoiceEnabled,
  isConnected,
  nickname,
  currentUserId,
  seal,
  sealFile,
}: UseChatSendParams): UseChatSendReturn {
  const retryQueueRef = useRef<Map<string, RetryEntry>>(new Map());

  /**
   * A ref because `markLatestPendingFailed` is declared below this and
   * `performRetry` needs it (GRYT-765).
   */
  const markLatestPendingFailedRef = useRef<() => void>(() => {});

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
      nonce: target.entry.nonce,
    };
    if (target.entry.attachments?.length) payload.attachments = target.entry.attachments;
    if (target.entry.replyToMessageId) payload.replyToMessageId = target.entry.replyToMessageId;

    /*
     * Sealed, exactly as the first attempt was. Putting `text` on the payload
     * sent a message the composer called encrypted in the clear (GRYT-765).
     */
    const text = target.entry.text;
    // With the same file keys, so a resend does not name uploads nobody holds the
    // key to, which draws as a broken file rather than a failed send (GRYT-761).
    void seal(text, target.entry.attachmentKeys ?? undefined)
      .then((sealed) => {
        if (sealed) payload.sealed = sealed;
        else payload.text = text;
        currentConnection.emit("chat:send", payload);
      })
      .catch(() => {
        markLatestPendingFailedRef.current();
      });
  }, [currentConnection, currentlyViewingServer?.host, seal]);

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
    attachmentKeys?: Record<string, SealedAttachmentKey> | null,
  ) => {
    const payload: Record<string, unknown> = {
      conversationId: activeConversationId,
      accessToken,
    };
    if (attachments && attachments.length > 0) payload.attachments = attachments;
    if (replyToMessageId) payload.replyToMessageId = replyToMessageId;
    if (nonce) payload.nonce = nonce;

    /*
     * Sealed or in the clear, never both — the server refuses a payload carrying
     * each. A failure to seal sends nothing rather than falling back (GRYT-729).
     */
    void seal(messageText, attachmentKeys ?? undefined)
      .then((sealed) => {
        if (sealed) payload.sealed = sealed;
        else payload.text = messageText;
        currentConnection!.emit("chat:send", payload);
      })
      .catch(() => {
        markLatestPendingFailed();
      });
  }, [activeConversationId, currentConnection, seal, markLatestPendingFailed]);

  markLatestPendingFailedRef.current = markLatestPendingFailed;

  const canSendRef = useRef(canSend);
  const sealDecisionRef = useRef(sealDecision);
  sealDecisionRef.current = sealDecision;
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
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

  /*
   * Asked once per conversation per blocking state, so a peer rotating again asks
   * again. A ref, not storage: asking once more is the safe way to be wrong.
   */
  const plaintextOkRef = useRef<Set<string>>(new Set());
  const pendingSendRef = useRef<{ text: string; files: File[]; replyToMessageId?: string } | null>(null);
  const [plaintextPrompt, setPlaintextPrompt] = useState<SealDecision | null>(null);

  const plaintextGateKey = useCallback(() => {
    const d = sealDecisionRef.current;
    if (!d || d.kind !== "plaintext" || d.blockedBy.length === 0) return null;
    const who = d.blockedBy
      .map((b) => `${b.memberId}:${b.reason}`)
      .sort()
      .join("|");
    return `${activeConversationIdRef.current ?? ""}::${who}`;
  }, []);

  const sendChat = useCallback((text: string, files: File[], replyToMessageId?: string) => {
    const body = text.trim();
    if (!body && files.length === 0) return;

    const gateKey = plaintextGateKey();
    if (gateKey && !plaintextOkRef.current.has(gateKey)) {
      pendingSendRef.current = { text, files, replyToMessageId };
      setPlaintextPrompt(sealDecisionRef.current);
      return;
    }


    if (!canSendRef.current) {
      // Rate limiting has its own countdown on screen. Everything else has to
      // say something: a message that vanishes silently reads as one that sent.
      if (isRateLimitedRef.current) return;
      if (isVoiceChannelTextChatRef.current && !textInVoiceEnabledRef.current) {
        toast.error("Text chat is disabled in this voice channel");
      } else if (isVoiceChannelTextChatRef.current && !isConnectedRef.current) {
        toast.error("You must be connected to this voice channel to send messages");
      } else if (!isConnectedRef.current) {
        toast.error("Not connected to this server");
      } else {
        toast.error("That message could not be sent");
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
      let attachmentKeys: Record<string, SealedAttachmentKey> | null = null;
      if (files.length > 0) {
        try {
          const uploaded = await Promise.all(
            files.map((f, i) => {
              const dim = localEnriched?.[i];
              const dimensions = dim?.width && dim?.height ? { width: dim.width, height: dim.height } : null;
              return uploadChatFile(f, serverHost, dimensions, sealFile);
            }),
          );

          fileIds = uploaded.map((u) => u.fileId);

          // Keyed by the id the server assigned, known only now. The bytes were
          // bound to a value the package chose — see `sealAttachment`.
          const keyed = uploaded.filter((u) => u.meta);
          attachmentKeys = keyed.length
            ? Object.fromEntries(keyed.map((u) => [u.fileId, u.meta!]))
            : null;
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
          attachmentKeys,
          replyToMessageId,
        });
        sendMessageWithToken(accessToken, finalText, fileIds, replyToMessageId, nonce, attachmentKeys);
      }
    };

    doSend();
    // `sealFile` is in here rather than behind a ref: a stale one is not a stale
    // flag — a newly sealable conversation sends the file in the clear (GRYT-761).
  }, [currentConnection, currentlyViewingServer?.host, activeConversationId, serverHost, cacheKeyFor, sealFile, sendMessageWithToken, setChatMessages, setMessageCache, plaintextGateKey]);

  const editMessage = useCallback((messageId: string, conversationId: string, newText: string) => {
    const text = newText.trim();
    if (!text || !currentConnection) return;
    const accessToken = getServerAccessToken(currentlyViewingServer?.host || "");
    if (!accessToken) return;
    currentConnection.emit("chat:edit", { conversationId, messageId, text, accessToken });
  }, [currentConnection, currentlyViewingServer?.host]);


  /** Remembered for this conversation, then sent. */
  const confirmPlaintextSend = useCallback(() => {
    const key = plaintextGateKey();
    if (key) plaintextOkRef.current.add(key);
    setPlaintextPrompt(null);
    const pending = pendingSendRef.current;
    pendingSendRef.current = null;
    if (pending) sendChat(pending.text, pending.files, pending.replyToMessageId);
  }, [plaintextGateKey, sendChat]);

  /** Backed out: the text goes back in the composer. */
  const cancelPlaintextSend = useCallback(() => {
    const pending = pendingSendRef.current;
    pendingSendRef.current = null;
    setPlaintextPrompt(null);
    if (pending?.text) setRestoreText(pending.text);
  }, [setRestoreText]);
  return { sendChat, editMessage, retryQueueRef, performRetry, markLatestPendingFailed, plaintextPrompt, confirmPlaintextSend, cancelPlaintextSend };
}
