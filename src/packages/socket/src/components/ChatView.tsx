import { AlertDialog, Avatar, Box, Button, Flex, ScrollArea, Text, Tooltip } from "@radix-ui/themes";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MdCloudUpload } from "react-icons/md";

import { getServerAccessToken, getUploadsFileUrl } from "@/common";
import { useSettings } from "@/settings";

import { fetchCustomEmojis, getCustomEmojis, onCustomEmojisChange, setCustomEmojis } from "../utils/emojiData";
import { recordReaction } from "../utils/recentReactions";
import type { CustomEmojiEntry } from "../utils/remarkEmoji";
import { ChatEditor, type ChatEditorHandle } from "./ChatEditor";
import { ChatMediaPlayer } from "./ChatMediaPlayer";
import { MessageContextMenu, MessageHoverToolbar, MessageSkeleton, WelcomeMessage } from "./ChatMessage";
import { type AttachmentMeta, type ChatMessage, DateSeparator, MessageTimestamp, NewMessagesDivider, toDate } from "./chatUtils";
import { EmojiText } from "./EmojiText";
import { FileCard } from "./FileCard";
import { ImageLightbox } from "./ImageLightbox";
import { MessageEmbeds } from "./LinkEmbed";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { MediaContextMenu } from "./MediaContextMenu";

function getAttachmentPreview(msg: ChatMessage): string {
  const enriched = msg.enriched_attachments;
  if (enriched && enriched.length > 0) {
    const names = enriched.map((a) => a.original_name).filter(Boolean) as string[];
    if (names.length > 0) return names.join(", ");
  }
  return "Attachment";
}

function getReplyPreview(msg: ChatMessage | null | undefined, maxLen: number): string {
  if (!msg) return "Original message";
  if (msg.text) return msg.text.length > maxLen ? msg.text.slice(0, maxLen) + "..." : msg.text;
  return getAttachmentPreview(msg);
}

export type { AttachmentMeta,ChatMessage, Reaction } from "./chatUtils";

export const ChatView = memo(({
  chatMessages,
  canSend,
  sendChat,
  editMessage,
  currentUserId,
  currentUserNickname,
  socketConnection,
  serverHost,
  memberList,
  channelName,
  isRateLimited,
  rateLimitCountdown,
  canViewVoiceChannelText,
  isVoiceChannelTextChat,
  isLoadingMessages,
  restoreText,
  clearRestoreText,
  canDeleteAny,
  maxFileSize,
  onLoadOlder,
  isLoadingOlder,
  hasOlderMessages,
}: {
  chatMessages: ChatMessage[];
  canSend: boolean;
  sendChat: (text: string, files: File[], replyToMessageId?: string) => void;
  editMessage?: (messageId: string, conversationId: string, newText: string) => void;
  currentUserId?: string;
  currentUserNickname?: string;
  socketConnection?: unknown;
  serverHost?: string;
  memberList?: Record<string, { nickname: string; serverUserId: string; avatarFileId?: string | null; [key: string]: unknown }>;
  channelName?: string;
  isRateLimited?: boolean;
  rateLimitCountdown?: number;
  canViewVoiceChannelText?: boolean;
  isVoiceChannelTextChat?: boolean;
  isLoadingMessages?: boolean;
  restoreText?: string | null;
  clearRestoreText?: () => void;
  canDeleteAny?: boolean;
  maxFileSize?: number | null;
  onLoadOlder?: () => void;
  isLoadingOlder?: boolean;
  hasOlderMessages?: boolean;
}) => {
  const { chatMediaVolume, setChatMediaVolume, blurProfanity } = useSettings();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<ChatEditorHandle>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevMessageCountRef = useRef(chatMessages.length);
  const prevLastMessageIdRef = useRef(chatMessages[chatMessages.length - 1]?.message_id);
  const prevFirstMessageIdRef = useRef(chatMessages[0]?.message_id);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt?: string } | null>(null);
  const dragCounterRef = useRef(0);

  const windowFocusedRef = useRef(document.hasFocus());
  const [newMessageMarkerId, setNewMessageMarkerId] = useState<string | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevConversationIdRef = useRef<string | undefined>(undefined);

  const [customEmojiList, setCustomEmojiList] = useState<CustomEmojiEntry[]>([]);

  const syncCustomEmojiList = useCallback(() => {
    const emojis = getCustomEmojis();
    setCustomEmojiList(
      emojis.filter((e) => e.url).map((e) => ({ name: e.name, url: e.url! })),
    );
  }, []);

  useEffect(() => {
    if (!serverHost) return;
    let cancelled = false;
    fetchCustomEmojis(serverHost).then((emojis) => {
      if (cancelled) return;
      setCustomEmojis(emojis, serverHost);
    });
    return () => { cancelled = true; };
  }, [serverHost]);

  useEffect(() => {
    return onCustomEmojisChange(syncCustomEmojiList);
  }, [syncCustomEmojiList]);

  useEffect(() => {
    const onFocus = () => {
      windowFocusedRef.current = true;
      focusTimerRef.current = setTimeout(() => {
        setNewMessageMarkerId(null);
      }, 2000);
    };
    const onBlur = () => {
      windowFocusedRef.current = false;
      if (focusTimerRef.current) {
        clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    const cleanupElectron = window.electronAPI?.onWindowFocusChange((focused) => {
      if (focused) onFocus();
      else onBlur();
    });
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      cleanupElectron?.();
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    };
  }, []);

  const handleViewDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true);
    }
  }, []);

  const handleViewDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleViewDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleViewDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    editorRef.current?.addFiles(files);
  }, []);

  const prevScrollHeightRef = useRef(0);

  useLayoutEffect(() => {
    const viewport = messagesEndRef.current?.closest<HTMLElement>('[data-radix-scroll-area-viewport]');

    const lastId = chatMessages[chatMessages.length - 1]?.message_id;
    const firstId = chatMessages[0]?.message_id;
    const currentConvId = chatMessages[chatMessages.length - 1]?.conversation_id;
    const previousLastId = prevLastMessageIdRef.current;
    const isNewMessage =
      chatMessages.length !== prevMessageCountRef.current ||
      lastId !== prevLastMessageIdRef.current;

    const wasBulkLoad = prevMessageCountRef.current === 0 && chatMessages.length > 1;
    const wasOlderPrepend = firstId !== prevFirstMessageIdRef.current
      && lastId === prevLastMessageIdRef.current
      && prevMessageCountRef.current > 0;

    const conversationSwitched =
      currentConvId !== prevConversationIdRef.current &&
      prevConversationIdRef.current !== undefined;

    prevMessageCountRef.current = chatMessages.length;
    prevLastMessageIdRef.current = lastId;
    prevFirstMessageIdRef.current = firstId;
    prevConversationIdRef.current = currentConvId;

    if (conversationSwitched) {
      setNewMessageMarkerId(null);
    }

    if (wasOlderPrepend && viewport) {
      const delta = viewport.scrollHeight - prevScrollHeightRef.current;
      viewport.scrollTop += delta;
      prevScrollHeightRef.current = viewport.scrollHeight;
      return;
    }

    if (isNewMessage && !wasBulkLoad && !wasOlderPrepend && !conversationSwitched
        && !windowFocusedRef.current && previousLastId) {
      setNewMessageMarkerId((prev) => prev ?? previousLastId);
    }

    if (isNewMessage || conversationSwitched) {
      if (wasBulkLoad || conversationSwitched) {
        if (viewport) {
          viewport.scrollTop = viewport.scrollHeight;
        } else {
          messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
        }
      } else {
        const isNearBottom = viewport
          ? viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 150
          : true;
        if (isNearBottom) {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
      }
    }

    if (viewport) {
      prevScrollHeightRef.current = viewport.scrollHeight;
    }
  }, [chatMessages]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !onLoadOlder) return;

    const viewport = sentinel.closest<HTMLElement>('[data-radix-scroll-area-viewport]');
    if (!viewport) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasOlderMessages && !isLoadingOlder) {
          onLoadOlder();
        }
      },
      { root: viewport, rootMargin: "200px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onLoadOlder, hasOlderMessages, isLoadingOlder]);

  const scrollToMessage = useCallback((messageId: string) => {
    const el = messageRefs.current.get(messageId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.background = "var(--accent-4)";
    setTimeout(() => { el.style.background = "transparent"; }, 1500);
  }, []);

  useEffect(() => {
    if (restoreText && editorRef.current) {
      editorRef.current.focus();
      clearRestoreText?.();
    }
  }, [restoreText, clearRestoreText]);

  const getSenderName = useCallback((msg: ChatMessage): string => {
    if (msg.sender_nickname) return msg.sender_nickname;
    if (!memberList) return 'Unknown User';
    return memberList[msg.sender_server_id]?.nickname || 'Unknown User';
  }, [memberList]);

  const getSenderAvatarUrl = useCallback((msg: ChatMessage): string | undefined => {
    const fileId = msg.sender_avatar_file_id
      || memberList?.[msg.sender_server_id]?.avatarFileId;
    if (fileId && serverHost) return getUploadsFileUrl(serverHost, fileId);
    return undefined;
  }, [memberList, serverHost]);

  const mentionMembers = useMemo(() => {
    if (!memberList) return [];
    return Object.values(memberList).map((m) => ({
      nickname: m.nickname,
      serverUserId: m.serverUserId,
      avatarUrl: m.avatarFileId && serverHost ? getUploadsFileUrl(serverHost, m.avatarFileId) : null,
    }));
  }, [memberList, serverHost]);

  const memberNicknames = useMemo(
    () => mentionMembers.map((m) => m.nickname),
    [mentionMembers],
  );

  const findMessage = useCallback((messageId: string): ChatMessage | undefined => {
    return chatMessages.find((m) => m.message_id === messageId);
  }, [chatMessages]);

  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [emojiPickerMessageId, setEmojiPickerMessageId] = useState<string | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    message: ChatMessage;
    position: { x: number; y: number };
  } | null>(null);

  const handleMessageRightClick = (event: React.MouseEvent, message: ChatMessage) => {
    event.preventDefault();
    setEmojiPickerMessageId(null);
    setContextMenu({
      message,
      position: { x: event.clientX, y: event.clientY }
    });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  const handleReaction = (reactionSrc: string, message?: ChatMessage) => {
    const targetMessage = message || contextMenu?.message;
    if (!targetMessage || !socketConnection || !currentUserId) return;
    const accessToken = getServerAccessToken(serverHost || "");
    if (!accessToken) return;

    recordReaction(reactionSrc);

    (socketConnection as { emit: (event: string, data: unknown) => void }).emit("chat:react", {
      conversationId: targetMessage.conversation_id,
      messageId: targetMessage.message_id,
      reactionSrc: reactionSrc,
      accessToken,
    });
  };

  const handleReply = useCallback((message?: ChatMessage) => {
    const targetMessage = message || contextMenu?.message;
    if (!targetMessage) return;
    setReplyingTo(targetMessage);
    editorRef.current?.focus();
  }, [contextMenu]);

  const handleReport = useCallback(() => {
    const targetMessage = contextMenu?.message;
    if (!targetMessage || !socketConnection || !currentUserId) return;
    const accessToken = getServerAccessToken(serverHost || "");
    if (!accessToken) return;

    (socketConnection as { emit: (event: string, data: unknown) => void }).emit("chat:report", {
      conversationId: targetMessage.conversation_id,
      messageId: targetMessage.message_id,
      accessToken,
    });
  }, [contextMenu, socketConnection, currentUserId, serverHost]);

  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<ChatMessage | null>(null);

  const requestDelete = (message?: ChatMessage) => {
    const targetMessage = message || contextMenu?.message;
    if (!targetMessage || !socketConnection || !currentUserId) return;
    if (targetMessage.sender_server_id !== currentUserId && !canDeleteAny) return;
    setPendingDeleteMessage(targetMessage);
  };

  const confirmDelete = () => {
    if (!pendingDeleteMessage || !socketConnection) return;
    const accessToken = getServerAccessToken(serverHost || "");
    if (!accessToken) return;

    (socketConnection as { emit: (event: string, data: unknown) => void }).emit("chat:delete", {
      conversationId: pendingDeleteMessage.conversation_id,
      messageId: pendingDeleteMessage.message_id,
      accessToken,
    });
    setPendingDeleteMessage(null);
  };

  const startEditing = useCallback((message: ChatMessage) => {
    if (!message.text) return;
    setEditingMessage(message);
    setReplyingTo(null);
    requestAnimationFrame(() => {
      editorRef.current?.setContent(message.text!);
    });
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingMessage(null);
    editorRef.current?.clear();
  }, []);

  const handleArrowUpEmpty = useCallback(() => {
    if (!currentUserId) return;
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const msg = chatMessages[i];
      if (msg.sender_server_id === currentUserId && msg.text && !msg.pending && !msg.failed) {
        startEditing(msg);
        return;
      }
    }
  }, [chatMessages, currentUserId, startEditing]);

  const handleEditorSend = useCallback((markdown: string, files: File[]) => {
    if (editingMessage) {
      const trimmed = markdown.trim();
      if (trimmed && trimmed !== editingMessage.text?.trim() && editMessage) {
        editMessage(editingMessage.message_id, editingMessage.conversation_id, trimmed);
      }
      setEditingMessage(null);
      editorRef.current?.clear();
      return;
    }
    if (!canSend && !isRateLimited) return;
    sendChat(markdown, files, replyingTo?.message_id);
    setReplyingTo(null);
  }, [canSend, isRateLimited, sendChat, replyingTo, editingMessage, editMessage]);

  const groups = useMemo(() => {
    const result: Array<{ senderId: string; messages: ChatMessage[]; dayBreak?: Date }> = [];
    const GROUP_GAP_MS = 5 * 60 * 1000;
    let lastDay: string | null = null;

    for (const m of chatMessages) {
      const d = toDate(m.created_at);
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const needsDayBreak = dayKey !== lastDay;
      lastDay = dayKey;

      const last = result[result.length - 1];
      const lastMsg = last?.messages[last.messages.length - 1];
      const timeSinceLastMs = lastMsg ? d.getTime() - toDate(lastMsg.created_at).getTime() : Infinity;

      if (needsDayBreak || !last || last.senderId !== m.sender_server_id || timeSinceLastMs > GROUP_GAP_MS) {
        result.push({ senderId: m.sender_server_id, messages: [m], dayBreak: needsDayBreak ? d : undefined });
      } else {
        last.messages.push(m);
      }
    }
    return result;
  }, [chatMessages]);

  const editorPlaceholder =
    !canViewVoiceChannelText && isVoiceChannelTextChat
      ? "Text chat is not available in this voice channel"
      : isRateLimited && rateLimitCountdown
        ? `Please wait ${rateLimitCountdown} seconds...`
        : channelName
          ? `Message #${channelName}`
          : "Chat with your friends!";

  const editorDisabled = (!canViewVoiceChannelText && isVoiceChannelTextChat) || false;

  return (
    <>
      {contextMenu && (
        <MessageContextMenu
          position={contextMenu.position}
          onClose={closeContextMenu}
          onReply={() => handleReply()}
          onEdit={() => { if (contextMenu.message.text) startEditing(contextMenu.message); }}
          onReport={handleReport}
          onDelete={requestDelete}
          canEdit={!!currentUserId && contextMenu.message.sender_server_id === currentUserId && !!contextMenu.message.text}
          canDelete={!!canDeleteAny || (!!currentUserId && contextMenu.message.sender_server_id === currentUserId)}
        />
      )}

      <Box
        overflow="hidden"
        flexGrow="1"
        minWidth="0"
        style={{
          background: "var(--gray-3)",
          borderRadius: "var(--radius-5)",
          position: "relative",
        }}
        onDragEnter={handleViewDragEnter}
        onDragLeave={handleViewDragLeave}
        onDragOver={handleViewDragOver}
        onDrop={handleViewDrop}
      >
      {isDragOver && (
        <div className="chat-view-drop-overlay">
          <div className="chat-view-drop-overlay-content">
            <MdCloudUpload size={48} />
            <span>Drop files here</span>
          </div>
        </div>
      )}
      <Flex height="100%" width="100%" direction="column" p="3">
        {channelName && (
          <Flex align="center" style={{ marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid var(--gray-6)" }}>
            <Text size="4" weight="bold" style={{ color: "var(--gray-12)" }}>
              #<EmojiText text={channelName} />
            </Text>
          </Flex>
        )}

        {isVoiceChannelTextChat && !canViewVoiceChannelText && (
          <Flex align="center" justify="center" style={{ padding: "24px", textAlign: "center" }}>
            <Text size="3" color="gray" style={{ maxWidth: "300px" }}>
              Text chat is not available in this voice channel
            </Text>
          </Flex>
        )}

        <ScrollArea scrollbars="vertical">
        <Flex direction="column" justify="end" flexGrow="1" style={{ gap: 12, paddingBottom: "16px" }}>
          {!canViewVoiceChannelText && isVoiceChannelTextChat ? (
              <Text size="2" color="gray" style={{ textAlign: "center", padding: "16px" }}>
                Text chat is disabled in this voice channel
              </Text>
          ) : isLoadingMessages ? (
              <MessageSkeleton />
          ) : groups.length === 0 ? (
              <WelcomeMessage channelName={channelName} />
          ) : (<>
            <div ref={sentinelRef} style={{ height: 1, flexShrink: 0 }} />
            {isLoadingOlder && (
              <Flex justify="center" py="2">
                <Text size="1" color="gray">Loading older messages...</Text>
              </Flex>
            )}
            {groups.map((group, idx) => {
              const isSelf = !!currentUserId && group.senderId === currentUserId;
              const senderName = isSelf ? (currentUserNickname || "You") : getSenderName(group.messages[0]);
              const avatarUrl = getSenderAvatarUrl(group.messages[0]);
              const prevGroup = idx > 0 ? groups[idx - 1] : null;
              const prevGroupLastMsg = prevGroup?.messages[prevGroup.messages.length - 1];
              const showDividerBeforeGroup = !!newMessageMarkerId &&
                prevGroupLastMsg?.message_id === newMessageMarkerId;

              return (
                <Flex key={`${group.senderId}-${idx}`} direction="column" style={{ width: "100%" }}>
                  {showDividerBeforeGroup && <NewMessagesDivider />}
                  {group.dayBreak && <DateSeparator date={group.dayBreak} />}
                  <Flex gap="3" style={{ width: "100%" }} align="start">
                    <Avatar
                      radius="full"
                      fallback={senderName[0]}
                      src={avatarUrl}
                      style={{ flexShrink: 0, marginTop: 2, width: 51, height: 51 }}
                    />
                    <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
                      <Flex align="baseline" gap="2" style={{ marginBottom: 2 }}>
                        <Text size="2" weight="bold" style={{ color: isSelf ? "var(--accent-11)" : "var(--gray-12)" }}>
                          {senderName}
                        </Text>
                        <MessageTimestamp date={toDate(group.messages[0].created_at)} />
                        {group.messages[0].edited_at && (
                          <Tooltip content={`Edited ${new Date(group.messages[0].edited_at).toLocaleString()}`} delayDuration={200}>
                            <Text style={{ fontSize: 10, cursor: "default", whiteSpace: "nowrap", userSelect: "none", color: "var(--gray-8)" }}>
                              (edited)
                            </Text>
                          </Tooltip>
                        )}
                      </Flex>
                      {group.messages.map((m, mIdx) => {
                        const replyOriginal = m.reply_to_message_id ? findMessage(m.reply_to_message_id) : null;
                        const isMentioned = !!(currentUserNickname && m.text
                          && m.text.toLowerCase().includes(`@${currentUserNickname.toLowerCase()}`));
                        const mentionBg = isMentioned ? "var(--accent-a3)" : undefined;
                        const showDividerBeforeMsg = !!newMessageMarkerId && mIdx > 0 &&
                          group.messages[mIdx - 1].message_id === newMessageMarkerId;

                        return (
                        <Fragment key={m.message_id}>
                        {showDividerBeforeMsg && <NewMessagesDivider />}
                        <Flex
                          ref={(el) => {
                            if (el) messageRefs.current.set(m.message_id, el);
                            else messageRefs.current.delete(m.message_id);
                          }}
                          direction="column"
                          onContextMenu={(e) => handleMessageRightClick(e, m)}
                          style={{
                            borderRadius: "var(--radius-3)",
                            padding: "2px 6px",
                            margin: "0 -6px",
                            transition: "background 0.3s ease",
                            cursor: "context-menu",
                            position: "relative",
                            background: mentionBg,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "var(--gray-4)";
                            setHoveredMessageId(m.message_id);
                          }}
                          onMouseLeave={(e) => {
                            if (emojiPickerMessageId !== m.message_id) {
                              e.currentTarget.style.background = mentionBg || "transparent";
                            }
                            setHoveredMessageId((prev) => prev === m.message_id ? null : prev);
                          }}
                        >
                          {((hoveredMessageId === m.message_id && !emojiPickerMessageId) || emojiPickerMessageId === m.message_id) && !contextMenu && (
                            <MessageHoverToolbar
                              onReaction={(emoji) => handleReaction(emoji, m)}
                              onReply={() => handleReply(m)}
                              canDelete={!!canDeleteAny || (!!currentUserId && m.sender_server_id === currentUserId)}
                              onDelete={
                                canDeleteAny || (currentUserId && m.sender_server_id === currentUserId)
                                  ? () => requestDelete(m)
                                  : undefined
                              }
                              onPickerOpenChange={(open) => {
                                setEmojiPickerMessageId(open ? m.message_id : null);
                                if (!open) {
                                  const el = messageRefs.current.get(m.message_id);
                                  if (el && hoveredMessageId !== m.message_id) {
                                    el.style.background = "transparent";
                                  }
                                }
                              }}
                            />
                          )}
                          {m.reply_to_message_id && (
                            <div
                              onClick={() => scrollToMessage(m.reply_to_message_id!)}
                              style={{
                                borderLeft: "2px solid var(--accent-8)",
                                paddingLeft: "8px",
                                marginBottom: "2px",
                                opacity: 0.6,
                                fontStyle: "italic",
                                fontSize: "12px",
                                cursor: "pointer",
                                lineHeight: 1.4,
                                maxWidth: "100%",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <Text size="1">
                                {getReplyPreview(replyOriginal, 100)}
                              </Text>
                            </div>
                          )}
                          <div style={{ opacity: m.pending ? 0.6 : m.failed ? 0.5 : 1, wordBreak: "break-word" }}>
                            <MarkdownRenderer content={m.text} customEmojis={customEmojiList} memberNicknames={memberNicknames} profanityMatches={m.profanity_matches} blurProfanity={blurProfanity} />
                            {m.edited_at && m !== group.messages[0] && (
                              <Tooltip content={`Edited ${new Date(m.edited_at).toLocaleString()}`} delayDuration={200}>
                                <Text style={{ fontSize: 10, cursor: "default", whiteSpace: "nowrap", userSelect: "none", color: "var(--gray-8)" }}>
                                  (edited)
                                </Text>
                              </Tooltip>
                            )}
                            {serverHost && !m.pending && (
                              <MessageEmbeds messageId={m.message_id} text={m.text} serverHost={serverHost} />
                            )}
                            {m.attachments && m.attachments.length > 0 && serverHost && (
                              <Flex gap="2" wrap="wrap" direction="column" style={{ marginTop: "4px" }}>
                                {m.attachments.map((fileId, attIdx) => {
                                  const meta: AttachmentMeta | undefined = m.enriched_attachments?.[attIdx];
                                  const url = getUploadsFileUrl(serverHost, fileId);
                                  const thumbUrl = meta?.has_thumbnail ? getUploadsFileUrl(serverHost, fileId, { thumb: true }) : undefined;
                                  const mime = meta?.mime || "";

                                  if (mime.startsWith("image/")) {
                                    return (
                                      <MediaContextMenu key={fileId} src={url} fileName={meta?.original_name} isImage>
                                        <img
                                          src={url}
                                          alt={meta?.original_name || "Attachment"}
                                          className="chat-attachment-image"
                                          onClick={() => setLightboxImage({ src: url, alt: meta?.original_name || "Attachment" })}
                                        />
                                      </MediaContextMenu>
                                    );
                                  }
                                  if (mime.startsWith("audio/")) {
                                    return (
                                      <MediaContextMenu key={fileId} src={url} fileName={meta?.original_name}>
                                        <ChatMediaPlayer src={url} type="audio" fileName={meta?.original_name} volume={chatMediaVolume} onVolumeChange={setChatMediaVolume} />
                                      </MediaContextMenu>
                                    );
                                  }
                                  if (mime.startsWith("video/")) {
                                    return (
                                      <MediaContextMenu key={fileId} src={url} fileName={meta?.original_name}>
                                        <ChatMediaPlayer src={url} type="video" poster={thumbUrl} fileName={meta?.original_name} volume={chatMediaVolume} onVolumeChange={setChatMediaVolume} />
                                      </MediaContextMenu>
                                    );
                                  }
                                  return (
                                    <FileCard
                                      key={fileId}
                                      fileId={fileId}
                                      mime={meta?.mime ?? null}
                                      size={meta?.size ?? null}
                                      originalName={meta?.original_name ?? null}
                                      serverHost={serverHost}
                                    />
                                  );
                                })}
                              </Flex>
                            )}
                            {m.failed && (
                              <Text size="1" style={{ color: "var(--red-9)", marginTop: "2px" }}>
                                Failed to send
                              </Text>
                            )}
                          </div>
                          {m.reactions && m.reactions.length > 0 && (
                            <Flex wrap="wrap" style={{ marginTop: "4px", gap: "2px" }}>
                              {m.reactions.map((reaction, rIdx) => {
                                const isMine = !!(currentUserId && reaction.users.includes(currentUserId));
                                return (
                                <Tooltip
                                  key={`${reaction.src}-${rIdx}`}
                                  content={reaction.users.map((uid) => {
                                    if (currentUserId && uid === currentUserId) return currentUserNickname || "You";
                                    const member = memberList && Object.values(memberList).find((m) => m.serverUserId === uid);
                                    return member?.nickname || uid;
                                  }).join(", ")}
                                  delayDuration={200}
                                >
                                  <button
                                    onClick={() => handleReaction(reaction.src, m)}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "4px",
                                      padding: "2px 6px",
                                      minHeight: "24px",
                                      fontSize: "13px",
                                      lineHeight: 1,
                                      background: isMine ? "var(--accent-3)" : "var(--gray-3)",
                                      border: `1px solid ${isMine ? "var(--accent-7)" : "var(--gray-5)"}`,
                                      borderRadius: "var(--radius-3)",
                                      cursor: "pointer",
                                      transition: "background 0.15s, border-color 0.15s",
                                      whiteSpace: "nowrap",
                                      color: isMine ? "var(--accent-11)" : "var(--gray-12)",
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = isMine ? "var(--accent-4)" : "var(--gray-4)"; e.currentTarget.style.borderColor = isMine ? "var(--accent-8)" : "var(--gray-6)"; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = isMine ? "var(--accent-3)" : "var(--gray-3)"; e.currentTarget.style.borderColor = isMine ? "var(--accent-7)" : "var(--gray-5)"; }}
                                  >
                                    <EmojiText text={reaction.src} emojiSize={16} />
                                    <span style={{ fontWeight: 500, fontSize: "12px" }}>{reaction.amount}</span>
                                  </button>
                                </Tooltip>
                                );
                              })}
                            </Flex>
                          )}
                        </Flex>
                        </Fragment>
                        );
                      })}
                    </Flex>
                  </Flex>
                </Flex>
              );
            })}
          </>)}
          <div ref={messagesEndRef} />
        </Flex>
        </ScrollArea>

        {replyingTo && (
          <Flex
            align="center"
            gap="2"
            style={{
              padding: "6px 12px",
              marginBottom: "4px",
              borderLeft: "3px solid var(--accent-9)",
              background: "var(--gray-4)",
              borderRadius: "0 var(--radius-3) var(--radius-3) 0",
              fontSize: "13px",
            }}
          >
            <Flex align="center" gap="1" style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
              <Text size="2" color="gray">Replying to</Text>
              <Text size="2" weight="bold">{getSenderName(replyingTo)}</Text>
              <Text size="1" color="gray" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {getReplyPreview(replyingTo, 80)}
              </Text>
            </Flex>
            <Button
              variant="ghost"
              size="1"
              onClick={() => setReplyingTo(null)}
              style={{ padding: "2px 6px", minWidth: "auto", cursor: "pointer" }}
            >
              ✕
            </Button>
          </Flex>
        )}

        {editingMessage && (
          <Flex
            align="center"
            gap="2"
            style={{
              padding: "6px 12px",
              marginBottom: "4px",
              borderLeft: "3px solid var(--amber-9)",
              background: "var(--gray-4)",
              borderRadius: "0 var(--radius-3) var(--radius-3) 0",
              fontSize: "13px",
            }}
          >
            <Flex align="center" gap="1" style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
              <Text size="2" color="gray">Editing message</Text>
              <Text size="1" color="gray" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: 4 }}>
                press Escape to cancel
              </Text>
            </Flex>
            <Button
              variant="ghost"
              size="1"
              onClick={cancelEditing}
              style={{ padding: "2px 6px", minWidth: "auto", cursor: "pointer" }}
            >
              ✕
            </Button>
          </Flex>
        )}

        <ChatEditor
          ref={editorRef}
          placeholder={editorPlaceholder}
          disabled={editorDisabled}
          maxFileSize={maxFileSize}
          onSend={handleEditorSend}
          onArrowUpEmpty={handleArrowUpEmpty}
          onCancel={editingMessage ? cancelEditing : undefined}
          isEditing={!!editingMessage}
          memberList={mentionMembers}
        />
      </Flex>
    </Box>
    {lightboxImage && (
      <ImageLightbox
        src={lightboxImage.src}
        alt={lightboxImage.alt}
        onClose={() => setLightboxImage(null)}
      />
    )}
    <AlertDialog.Root open={!!pendingDeleteMessage} onOpenChange={(open) => { if (!open) setPendingDeleteMessage(null); }}>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>Delete message?</AlertDialog.Title>
        <AlertDialog.Description size="2">
          This will permanently delete this message. This action cannot be undone.
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">Cancel</Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button variant="solid" color="red" onClick={confirmDelete}>Delete</Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
    </>
  );
});

ChatView.displayName = "ChatView";
