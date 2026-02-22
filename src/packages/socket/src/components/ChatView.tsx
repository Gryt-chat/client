import { AlertDialog, Avatar, Box, Button, Flex, ScrollArea, Text, Tooltip } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getServerAccessToken, getUploadsFileUrl } from "@/common";

import { fetchCustomEmojis, getCustomEmojiUrl, setCustomEmojis } from "../utils/emojiData";
import { recordReaction } from "../utils/recentReactions";
import type { CustomEmojiEntry } from "../utils/remarkEmoji";
import { ChatEditor, type ChatEditorHandle } from "./ChatEditor";
import { ChatMediaPlayer } from "./ChatMediaPlayer";
import { MessageContextMenu, MessageHoverToolbar, MessageSkeleton, WelcomeMessage } from "./ChatMessage";
import { type AttachmentMeta, type ChatMessage, DateSeparator,MessageTimestamp, toDate } from "./chatUtils";
import { FileCard } from "./FileCard";
import { ImageLightbox } from "./ImageLightbox";
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

export const ChatView = ({
  chatMessages,
  canSend,
  sendChat,
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
}: {
  chatMessages: ChatMessage[];
  canSend: boolean;
  sendChat: (text: string, files: File[], replyToMessageId?: string) => void;
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
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<ChatEditorHandle>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevMessageCountRef = useRef(chatMessages.length);
  const prevLastMessageIdRef = useRef(chatMessages[chatMessages.length - 1]?.message_id);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt?: string } | null>(null);
  const dragCounterRef = useRef(0);

  const [customEmojiList, setCustomEmojiList] = useState<CustomEmojiEntry[]>([]);

  useEffect(() => {
    if (!serverHost) return;
    let cancelled = false;
    fetchCustomEmojis(serverHost).then((emojis) => {
      if (cancelled) return;
      setCustomEmojis(emojis, serverHost);
      setCustomEmojiList(
        emojis.map((e) => ({ name: e.name, url: getCustomEmojiUrl(serverHost, e.name) })),
      );
    });
    return () => { cancelled = true; };
  }, [serverHost]);

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

  useEffect(() => {
    const lastId = chatMessages[chatMessages.length - 1]?.message_id;
    const isNewMessage =
      chatMessages.length !== prevMessageCountRef.current ||
      lastId !== prevLastMessageIdRef.current;

    const wasBulkLoad = prevMessageCountRef.current === 0 && chatMessages.length > 1;

    prevMessageCountRef.current = chatMessages.length;
    prevLastMessageIdRef.current = lastId;

    if (isNewMessage) {
      if (wasBulkLoad) {
        requestAnimationFrame(() => {
          const viewport = messagesEndRef.current?.closest<HTMLElement>('[data-radix-scroll-area-viewport]');
          if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
          } else {
            messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
          }
        });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    }
  }, [chatMessages]);

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

  const getSenderName = (msg: ChatMessage): string => {
    if (msg.sender_nickname) return msg.sender_nickname;
    if (!memberList) return 'Unknown User';
    const member = Object.values(memberList).find(m => m.serverUserId === msg.sender_server_id);
    return member?.nickname || 'Unknown User';
  };

  const getSenderAvatarUrl = (msg: ChatMessage): string | undefined => {
    const fileId = msg.sender_avatar_file_id
      || (memberList && Object.values(memberList).find(m => m.serverUserId === msg.sender_server_id)?.avatarFileId);
    if (fileId && serverHost) return getUploadsFileUrl(serverHost, fileId);
    return undefined;
  };

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

  const handleEditorSend = useCallback((markdown: string, files: File[]) => {
    if (!canSend && !isRateLimited) return;
    sendChat(markdown, files, replyingTo?.message_id);
    setReplyingTo(null);
  }, [canSend, isRateLimited, sendChat, replyingTo]);

  const groups = useMemo(() => {
    const result: Array<{ senderId: string; messages: ChatMessage[]; dayBreak?: Date }> = [];
    let lastDay: string | null = null;

    for (const m of chatMessages) {
      const d = toDate(m.created_at);
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const needsDayBreak = dayKey !== lastDay;
      lastDay = dayKey;

      const last = result[result.length - 1];
      if (needsDayBreak || !last || last.senderId !== m.sender_server_id) {
        result.push({ senderId: m.sender_server_id, messages: [m], dayBreak: needsDayBreak ? d : undefined });
      } else {
        last.messages.push(m);
      }
    }
    return result;
  }, [chatMessages]);

  const editorPlaceholder =
    !canViewVoiceChannelText && isVoiceChannelTextChat
      ? "Connect to voice channel to send messages"
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
          onReport={handleReport}
          onDelete={requestDelete}
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
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>Drop files here</span>
          </div>
        </div>
      )}
      <Flex height="100%" width="100%" direction="column" p="3">
        {channelName && (
          <Flex align="center" style={{ marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid var(--gray-6)" }}>
            <Text size="4" weight="bold" style={{ color: "var(--gray-12)" }}>
              #{channelName}
            </Text>
          </Flex>
        )}

        {isVoiceChannelTextChat && !canViewVoiceChannelText && (
          <Flex align="center" justify="center" style={{ padding: "24px", textAlign: "center" }}>
            <Text size="3" color="gray" style={{ maxWidth: "300px" }}>
              🔒 You must be connected to this voice channel to view its messages
            </Text>
          </Flex>
        )}

        <ScrollArea scrollbars="vertical">
        <Flex direction="column" justify="end" flexGrow="1" style={{ gap: 12, paddingBottom: "16px" }}>
          {!canViewVoiceChannelText && isVoiceChannelTextChat ? (
              <Text size="2" color="gray" style={{ textAlign: "center", padding: "16px" }}>
                Voice channel messages are private to connected users
              </Text>
          ) : isLoadingMessages ? (
              <MessageSkeleton />
          ) : groups.length === 0 ? (
              <WelcomeMessage channelName={channelName} />
          ) : (
            groups.map((group, idx) => {
              const isSelf = !!currentUserId && group.senderId === currentUserId;
              const senderName = isSelf ? (currentUserNickname || "You") : getSenderName(group.messages[0]);
              const avatarUrl = getSenderAvatarUrl(group.messages[0]);

              return (
                <Flex key={`${group.senderId}-${idx}`} direction="column" style={{ width: "100%" }}>
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
                      </Flex>
                      {group.messages.map((m) => {
                        const replyOriginal = m.reply_to_message_id ? findMessage(m.reply_to_message_id) : null;

                        return (
                        <Flex
                          key={m.message_id}
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
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "var(--gray-4)";
                            setHoveredMessageId(m.message_id);
                          }}
                          onMouseLeave={(e) => {
                            if (emojiPickerMessageId !== m.message_id) {
                              e.currentTarget.style.background = "transparent";
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
                            <MarkdownRenderer content={m.text} customEmojis={customEmojiList} />
                            {m.attachments && m.attachments.length > 0 && serverHost && (
                              <Flex gap="2" wrap="wrap" direction="column" style={{ marginTop: "4px" }}>
                                {m.attachments.map((fileId, attIdx) => {
                                  const meta: AttachmentMeta | undefined = m.enriched_attachments?.[attIdx];
                                  const url = getUploadsFileUrl(serverHost, fileId);
                                  const thumbUrl = meta?.has_thumbnail ? getUploadsFileUrl(serverHost, fileId, { thumb: true }) : undefined;
                                  const mime = meta?.mime || "";

                                  if (mime.startsWith("image/")) {
                                    return (
                                      <MediaContextMenu key={fileId} src={url} fileName={meta?.original_name}>
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
                                        <ChatMediaPlayer src={url} type="audio" fileName={meta?.original_name} />
                                      </MediaContextMenu>
                                    );
                                  }
                                  if (mime.startsWith("video/")) {
                                    return (
                                      <MediaContextMenu key={fileId} src={url} fileName={meta?.original_name}>
                                        <ChatMediaPlayer src={url} type="video" poster={thumbUrl} fileName={meta?.original_name} />
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
                            <Flex gap="2" wrap="wrap" style={{ marginTop: "4px" }}>
                              {m.reactions.map((reaction, rIdx) => (
                                <Tooltip
                                  key={`${reaction.src}-${rIdx}`}
                                  content={reaction.users.map((uid) => {
                                    if (currentUserId && uid === currentUserId) return currentUserNickname || "You";
                                    const member = memberList && Object.values(memberList).find((m) => m.serverUserId === uid);
                                    return member?.nickname || uid;
                                  }).join(", ")}
                                  delayDuration={200}
                                >
                                  <Button
                                    variant="ghost"
                                    size="1"
                                    onClick={() => handleReaction(reaction.src, m)}
                                    style={{
                                      padding: "4px 8px",
                                      minWidth: "36px",
                                      minHeight: "26px",
                                      fontSize: "13px",
                                      lineHeight: 1,
                                      height: "auto",
                                      background: "var(--gray-3)",
                                      borderRadius: "var(--radius-5)",
                                      transition: "all 0.2s ease",
                                      whiteSpace: "nowrap",
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-4)"; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = "var(--gray-3)"; }}
                                  >
                                    {reaction.src} {reaction.amount}
                                  </Button>
                                </Tooltip>
                              ))}
                            </Flex>
                          )}
                        </Flex>
                        );
                      })}
                    </Flex>
                  </Flex>
                </Flex>
              );
            })
          )}
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

        <ChatEditor
          ref={editorRef}
          placeholder={editorPlaceholder}
          disabled={editorDisabled}
          maxFileSize={maxFileSize}
          onSend={handleEditorSend}
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
};
