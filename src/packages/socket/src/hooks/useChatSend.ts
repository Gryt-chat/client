import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";

import type { SealDecision, SealedAttachmentKey } from "@/common";
import { getServerAccessToken, getServerRefreshToken } from "@/common";

import type { AttachmentMeta, ChatMessage } from "../components/chatUtils";
import { getMediaDimensions } from "../utils/imageUtils";
import { shouldRefreshToken } from "../utils/tokenManager";
import { draftKey, returnDraft } from "./returnedDrafts";
import { type EmitResult, SendQueue } from "./sendQueue";
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
  /**
   * Sealed once, when it was sent, and the same envelope on every attempt. Sealed
   * again after a reconnect it went out in the clear while the keys reloaded.
   */
  sealed: string | null;
  /** Where its row is cached and whose composer gets it back, fixed when it was sent. */
  cacheKey: string;
  returnTo: string;
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
  performRetry: (pendingId?: string) => void;
  markLatestPendingFailed: (pendingId?: string) => void;
  /** Refused with a retry to come, so it stops going again on its own meanwhile. */
  holdSend: (pendingId: string) => void;
  /** Confirmed: the queue lets go of it. */
  forgetSend: (pendingId: string) => void;
  /**
   * Set when a send was held back because the conversation would go out in the
   * clear, and carries who is blocking it. Null the rest of the time.
   */
  plaintextPrompt: SealDecision | null;
  /** Send it unencrypted, and stop asking for this conversation. */
  confirmPlaintextSend: () => void;
  /** Do not send it. The text and files go back in the composer. */
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
  const sealDecisionRef = useRef(sealDecision);
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;

  const retryQueueRef = useRef<Map<string, RetryEntry>>(new Map());
  const queueRef = useRef<SendQueue | null>(null);

  const pendingIdFor = useCallback((nonce: string): string | null => {
    for (const [id, entry] of retryQueueRef.current) if (entry.nonce === nonce) return id;
    return null;
  }, []);

  /** A ref, so the queue made once per socket always fails a row the current way. */
  const markLatestPendingFailedRef = useRef<(pendingId?: string) => void>(() => {});

  /** The named send, or with none the last one not yet retried. */
  const performRetry = useCallback((pendingId?: string) => {
    const queue = retryQueueRef.current;
    let target: { pendingId: string; entry: RetryEntry } | null = null;
    for (const [id, entry] of queue) {
      if (entry.retryCount < 1 && (!pendingId || id === pendingId)) {
        target = { pendingId: id, entry };
      }
    }
    if (!target) return;
    target.entry.retryCount++;
    queueRef.current?.resend(target.entry.nonce);
  }, []);

  /** The named send, or with none the last one queued. */
  const markLatestPendingFailed = useCallback((pendingId?: string) => {
    const queue = retryQueueRef.current;
    let latestPendingId: string | null = null;
    for (const [id] of queue) {
      if (!pendingId || id === pendingId) latestPendingId = id;
    }
    if (!latestPendingId) return;

    const entry = queue.get(latestPendingId);
    if (entry?.timeoutId) clearTimeout(entry.timeoutId);
    queue.delete(latestPendingId);
    if (entry) queueRef.current?.settle(entry.nonce);

    const failId = latestPendingId;
    const failed = (m: ChatMessage) => (m.message_id === failId ? { ...m, pending: false, waiting: false, failed: true } : m);
    setChatMessages((prev) => prev.map(failed));
    const key = entry?.cacheKey ?? cacheKeyFor(activeConversationId);
    setMessageCache((prev) => (prev[key] ? { ...prev, [key]: prev[key].map(failed) } : prev));

    // Into the box it came from: after a long wait that may no longer be the open one.
    if (!entry) return;
    if (entry.conversationId !== activeConversationIdRef.current) returnDraft(entry.returnTo, { text: entry.text, files: [] });
    else if (entry.text) setRestoreText(entry.text);
  }, [activeConversationId, cacheKeyFor, setChatMessages, setMessageCache, setRestoreText]);

  /** Drawn on the row, so a send held for the connection does not look lost. */
  const markWaiting = useCallback((nonce: string, waiting: boolean) => {
    const id = pendingIdFor(nonce);
    const entry = id ? retryQueueRef.current.get(id) : undefined;
    if (!id || !entry) return;
    const apply = (list: ChatMessage[]) =>
      list.some((m) => m.message_id === id && !!m.waiting !== waiting)
        ? list.map((m) => (m.message_id === id ? { ...m, waiting } : m))
        : list;
    setChatMessages(apply);
    setMessageCache((prev) => (prev[entry.cacheKey] ? { ...prev, [entry.cacheKey]: apply(prev[entry.cacheKey]) } : prev));
  }, [pendingIdFor, setChatMessages, setMessageCache]);

  /** A fresh token on every attempt, and the envelope made when it was sent (GRYT-765). */
  const emitSend = useCallback(async (nonce: string): Promise<EmitResult> => {
    const id = pendingIdFor(nonce);
    const entry = id ? retryQueueRef.current.get(id) : undefined;
    if (!entry || !currentConnection) return "failed";
    if (!currentConnection.connected) return "offline";

    const freshToken = getServerAccessToken(currentlyViewingServer?.host || "");
    if (freshToken) entry.accessToken = freshToken;
    const payload: Record<string, unknown> = {
      conversationId: entry.conversationId,
      accessToken: entry.accessToken,
      nonce: entry.nonce,
    };
    if (entry.attachments?.length) payload.attachments = entry.attachments;
    if (entry.replyToMessageId) payload.replyToMessageId = entry.replyToMessageId;

    if (entry.sealed) payload.sealed = entry.sealed;
    else payload.text = entry.text;
    currentConnection.emit("chat:send", payload);
    return "sent";
  }, [currentConnection, currentlyViewingServer?.host, pendingIdFor]);

  const emitSendRef = useRef(emitSend);
  emitSendRef.current = emitSend;
  const markWaitingRef = useRef(markWaiting);
  markWaitingRef.current = markWaiting;

  /* One queue per socket, which socket.io keeps across a reconnect. Replaced when
     the server changes, and what the old one still held fails with its text back. */
  useEffect(() => {
    if (!currentConnection) return;
    const queue = new SendQueue(currentConnection as unknown as ConstructorParameters<typeof SendQueue>[0], {
      emit: (nonce) => emitSendRef.current(nonce),
      onGiveUp: (nonce) => {
        const id = pendingIdFor(nonce);
        if (id) markLatestPendingFailedRef.current(id);
      },
      onWaiting: (nonce, waiting) => markWaitingRef.current(nonce, waiting),
    });
    queueRef.current = queue;
    return () => {
      queueRef.current = null;
      queue.dispose();
    };
  }, [currentConnection, pendingIdFor]);

  const holdSend = useCallback((pendingId: string) => {
    const entry = retryQueueRef.current.get(pendingId);
    if (entry) queueRef.current?.hold(entry.nonce);
  }, []);

  const forgetSend = useCallback((pendingId: string) => {
    const entry = retryQueueRef.current.get(pendingId);
    if (!entry) return;
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    retryQueueRef.current.delete(pendingId);
    queueRef.current?.settle(entry.nonce);
  }, []);

  markLatestPendingFailedRef.current = markLatestPendingFailed;

  const canSendRef = useRef(canSend);
  sealDecisionRef.current = sealDecision;
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
  const pendingSendRef = useRef<{ text: string; files: File[]; replyToMessageId?: string; returnTo: string } | null>(null);
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
    // The composer this came from, if it has to go back.
    const returnTo = draftKey(serverHost, activeConversationId);

    const gateKey = plaintextGateKey();
    if (gateKey && !plaintextOkRef.current.has(gateKey)) {
      pendingSendRef.current = { text, files, replyToMessageId, returnTo };
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
        const dims = await Promise.all(files.map((f) => getMediaDimensions(f)));
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
          // Nothing will confirm this row now, so it fails, and the files go back.
          const failed = (m: ChatMessage) => (m.message_id === pendingId ? { ...m, pending: false, failed: true } : m);
          const key = cacheKeyFor(activeConversationId);
          setChatMessages((prev) => prev.map(failed));
          setMessageCache((prev) => (prev[key] ? { ...prev, [key]: prev[key].map(failed) } : prev));
          returnDraft(returnTo, { text: body, files });
          return;
        }
      }

      const finalText = body;

      /*
       * Sealed or in the clear, never both — the server refuses a payload carrying
       * each. With the same file keys, or the files draw broken (GRYT-729, GRYT-761).
       */
      let sealed: string | null = null;
      let sealFailed = false;
      try {
        sealed = await seal(finalText, attachmentKeys ?? undefined);
        sealFailed = !sealed && sealDecisionRef.current?.kind === "seal";
      } catch {
        sealFailed = true;
      }

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
          sealed,
          cacheKey: cacheKeyFor(activeConversationId),
          returnTo,
        });
        // A seal that did not happen sends nothing: the composer called this encrypted.
        if (queueRef.current && !sealFailed) queueRef.current.add(nonce);
        else markLatestPendingFailed(pendingId);
      }
    };

    doSend();
    // `sealFile` is in here rather than behind a ref: a stale one is not a stale
    // flag — a newly sealable conversation sends the file in the clear (GRYT-761).
  }, [currentConnection, currentlyViewingServer?.host, activeConversationId, serverHost, cacheKeyFor, seal, sealFile, markLatestPendingFailed, setChatMessages, setMessageCache, plaintextGateKey]);

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

  /** Backed out: the text and files go back in the composer. */
  const cancelPlaintextSend = useCallback(() => {
    const pending = pendingSendRef.current;
    pendingSendRef.current = null;
    setPlaintextPrompt(null);
    if (pending) returnDraft(pending.returnTo, { text: pending.text, files: pending.files });
  }, []);
  return { sendChat, editMessage, retryQueueRef, performRetry, markLatestPendingFailed, holdSend, forgetSend, plaintextPrompt, confirmPlaintextSend, cancelPlaintextSend };
}
