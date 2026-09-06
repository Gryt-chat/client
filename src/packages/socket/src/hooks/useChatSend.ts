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
   * The file keys, by the id the server gave each upload (GRYT-761).
   *
   * Carried on the retry entry so a resend seals the same message with the same
   * files. Without it a retry would send a message whose `attachments` name
   * uploads nobody has the key to, which draws as a broken file rather than as
   * a failed send.
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
   * Seal a message for this conversation, or answer null for "send it as text"
   * (GRYT-729).
   *
   * Passed in rather than worked out here, because whether a conversation can
   * be sealed depends on every member's key and the composer has to be able to
   * draw the same answer this uses.
   */
  seal: (
    plaintext: string,
    attachments?: Record<string, SealedAttachmentKey>,
  ) => Promise<string | null>;
  /**
   * Encrypt one file, or answer null for "send it as it is" (GRYT-761).
   *
   * Same reasoning as `seal`, and the two have to agree: a file encrypted for a
   * message that then goes out as plaintext is an upload nobody can open,
   * sitting in the operator's storage forever.
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
   * clear, and carries who is blocking it so the dialog can say. Null the rest
   * of the time.
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
   * `performRetry` needs it (GRYT-765). Reordering the two would work and be a
   * bigger diff in a file where the order is already load-bearing.
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
     * Sealed, exactly as the first attempt was (GRYT-765).
     *
     * This used to put `text` straight on the payload and emit, so a message
     * the composer said was encrypted went to the server in the clear the
     * moment it was retried — and nothing looked different, because the row was
     * already on screen and the retry succeeded. Being rate-limited while
     * sending a direct message was enough to reach it.
     */
    const text = target.entry.text;
    // With the same file keys, so a resend does not produce a message whose
    // `attachments` name uploads nobody holds the key to — which draws as a
    // broken file rather than as a failed send (GRYT-761).
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
     * Sealed or in the clear, never both — the server refuses a payload
     * carrying each, because whichever half it kept the other was already
     * written down (GRYT-729).
     *
     * A failure to seal sends nothing rather than falling back. Somebody typing
     * into a conversation the composer says is encrypted must not have it go
     * out in the open because a derivation threw.
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
   * Sending in the clear is a decision, not a notice (GRYT-729).
   *
   * When a conversation could be sealed and is not, the composer already says
   * so above the box. On 2026-09-06 that line was read, understood, and typed
   * past: five messages went to the server as plaintext in a DM whose whole
   * point is that they would not. A warning that costs nothing to ignore is
   * one people ignore.
   *
   * So the first send after the conversation falls back asks. Once per
   * conversation per blocking state — the state is part of the key, so a peer
   * rotating again asks again rather than riding on an answer about a
   * different key. Held in a ref rather than stored: a new session asking once
   * more is the safe direction to be wrong in.
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
      // Rate limiting has its own countdown on screen, so a toast would be
      // saying it twice. Everything else has to say something: the composer
      // clears either way, and a message that vanishes without a word reads
      // as one that was sent.
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

          // Keyed by the id the server assigned, which is only known now. The
          // bytes were bound to a value the package chose — see
          // `sealAttachment` — so nothing had to be agreed before the upload.
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
    // `sealFile` is in here rather than behind a ref, unlike `canSend` and the
    // others above. It closes over the sealing decision, and a stale one is not
    // a stale flag — a conversation that has just become sealable would hand
    // back null and the file would go up in the clear (GRYT-761).
  }, [currentConnection, currentlyViewingServer?.host, activeConversationId, serverHost, cacheKeyFor, sealFile, sendMessageWithToken, setChatMessages, setMessageCache, plaintextGateKey]);

  const editMessage = useCallback((messageId: string, conversationId: string, newText: string) => {
    const text = newText.trim();
    if (!text || !currentConnection) return;
    const accessToken = getServerAccessToken(currentlyViewingServer?.host || "");
    if (!accessToken) return;
    currentConnection.emit("chat:edit", { conversationId, messageId, text, accessToken });
  }, [currentConnection, currentlyViewingServer?.host]);


  /** They chose to send it anyway. Remember for this conversation and go. */
  const confirmPlaintextSend = useCallback(() => {
    const key = plaintextGateKey();
    if (key) plaintextOkRef.current.add(key);
    setPlaintextPrompt(null);
    const pending = pendingSendRef.current;
    pendingSendRef.current = null;
    if (pending) sendChat(pending.text, pending.files, pending.replyToMessageId);
  }, [plaintextGateKey, sendChat]);

  /** They backed out. The composer text is restored so nothing is lost. */
  const cancelPlaintextSend = useCallback(() => {
    const pending = pendingSendRef.current;
    pendingSendRef.current = null;
    setPlaintextPrompt(null);
    if (pending?.text) setRestoreText(pending.text);
  }, [setRestoreText]);
  return { sendChat, editMessage, retryQueueRef, performRetry, markLatestPendingFailed, plaintextPrompt, confirmPlaintextSend, cancelPlaintextSend };
}
