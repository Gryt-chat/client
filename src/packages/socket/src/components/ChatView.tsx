import { AlertDialog, Box, Button, Flex, Text } from "@radix-ui/themes";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdCloudUpload } from "react-icons/md";
import { Virtuoso,type VirtuosoHandle } from "react-virtuoso";

import { getServerAccessToken, getUploadsFileUrl } from "@/common";
import { useSettings } from "@/settings";

import { fetchCustomEmojis, getCustomEmojis, onCustomEmojisChange, setCustomEmojis } from "../utils/emojiData";
import { recordReaction } from "../utils/recentReactions";
import type { CustomEmojiEntry } from "../utils/remarkEmoji";
import { ChatEditor, type ChatEditorHandle } from "./ChatEditor";
import { MessageContextMenu, MessageSkeleton, WelcomeMessage } from "./ChatMessage";
import { type ChatMessage, toDate } from "./chatUtils";
import { EmojiText } from "./EmojiText";
import { ImageLightbox } from "./ImageLightbox";
import { type MessageMeta, MessageRow } from "./MessageRow";

export type { AttachmentMeta, ChatMessage, Reaction } from "./chatUtils";

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

const GROUP_GAP_MS = 5 * 60 * 1000;

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
  firstItemIndex,
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
  firstItemIndex?: number;
}) => {
  const { chatMediaVolume, setChatMediaVolume, blurProfanity } = useSettings();
  const editorRef = useRef<ChatEditorHandle>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt?: string } | null>(null);
  const dragCounterRef = useRef(0);

  const windowFocusedRef = useRef(document.hasFocus());
  const [newMessageMarkerId, setNewMessageMarkerId] = useState<string | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevConversationIdRef = useRef<string | undefined>(undefined);
  const prevLastIdRef = useRef<string | undefined>(undefined);

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

  // Track new-message marker for "new since last visit" divider
  useEffect(() => {
    const currentConvId = chatMessages[chatMessages.length - 1]?.conversation_id;
    const lastId = chatMessages[chatMessages.length - 1]?.message_id;
    const conversationSwitched =
      currentConvId !== prevConversationIdRef.current && prevConversationIdRef.current !== undefined;

    if (conversationSwitched) {
      setNewMessageMarkerId(null);
    } else if (lastId !== prevLastIdRef.current && prevLastIdRef.current && !windowFocusedRef.current) {
      setNewMessageMarkerId((prev) => prev ?? prevLastIdRef.current!);
    }

    prevConversationIdRef.current = currentConvId;
    prevLastIdRef.current = lastId;
  }, [chatMessages]);

  const handleViewDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
  }, []);

  const handleViewDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }, []);

  const handleViewDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);

  const handleViewDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    editorRef.current?.addFiles(files);
  }, []);

  useEffect(() => {
    if (restoreText && editorRef.current) {
      editorRef.current.focus();
      clearRestoreText?.();
    }
  }, [restoreText, clearRestoreText]);

  const getSenderName = useCallback((msg: ChatMessage): string => {
    if (msg.sender_nickname) return msg.sender_nickname;
    if (!memberList) return "Unknown User";
    return memberList[msg.sender_server_id]?.nickname || "Unknown User";
  }, [memberList]);

  const getSenderAvatarUrl = useCallback((msg: ChatMessage): string | undefined => {
    const fileId = msg.sender_avatar_file_id || memberList?.[msg.sender_server_id]?.avatarFileId;
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

  // Per-message metadata: group boundaries, day breaks, dividers
  const messageMetadata = useMemo(() => {
    let lastDay: string | null = null;
    return chatMessages.map((m, i): MessageMeta => {
      const prev = i > 0 ? chatMessages[i - 1] : null;
      const d = toDate(m.created_at);
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const needsDayBreak = dayKey !== lastDay;
      lastDay = dayKey;

      const timeSincePrev = prev ? d.getTime() - toDate(prev.created_at).getTime() : Infinity;
      const isFirstInGroup = !prev || prev.sender_server_id !== m.sender_server_id || timeSincePrev > GROUP_GAP_MS || needsDayBreak;

      const showNewMessageDivider = !!(newMessageMarkerId && prev && prev.message_id === newMessageMarkerId);

      const isSelf = !!currentUserId && m.sender_server_id === currentUserId;
      const senderName = isSelf ? (currentUserNickname || "You") : getSenderName(m);
      const avatarUrl = getSenderAvatarUrl(m);
      const isFirstEdited = isFirstInGroup && !!m.edited_at;

      return { isFirstInGroup, dayBreak: needsDayBreak ? d : null, showNewMessageDivider, senderName, avatarUrl, isSelf, isFirstEdited };
    });
  }, [chatMessages, newMessageMarkerId, currentUserId, currentUserNickname, getSenderName, getSenderAvatarUrl]);

  // Build a map for quick reply-preview lookups
  const messageMap = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of chatMessages) map.set(m.message_id, m);
    return map;
  }, [chatMessages]);

  const [contextMenu, setContextMenu] = useState<{
    message: ChatMessage;
    position: { x: number; y: number };
  } | null>(null);

  const handleMessageRightClick = useCallback((event: React.MouseEvent, message: ChatMessage) => {
    event.preventDefault();
    setContextMenu({ message, position: { x: event.clientX, y: event.clientY } });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleReaction = useCallback((reactionSrc: string, message: ChatMessage) => {
    if (!socketConnection || !currentUserId) return;
    const accessToken = getServerAccessToken(serverHost || "");
    if (!accessToken) return;
    recordReaction(reactionSrc);
    (socketConnection as { emit: (event: string, data: unknown) => void }).emit("chat:react", {
      conversationId: message.conversation_id,
      messageId: message.message_id,
      reactionSrc,
      accessToken,
    });
  }, [socketConnection, currentUserId, serverHost]);

  const handleReply = useCallback((message: ChatMessage) => {
    setReplyingTo(message);
    editorRef.current?.focus();
  }, []);

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

  const requestDelete = useCallback((message: ChatMessage) => {
    if (!socketConnection || !currentUserId) return;
    if (message.sender_server_id !== currentUserId && !canDeleteAny) return;
    setPendingDeleteMessage(message);
  }, [socketConnection, currentUserId, canDeleteAny]);

  const confirmDelete = useCallback(() => {
    if (!pendingDeleteMessage || !socketConnection) return;
    const accessToken = getServerAccessToken(serverHost || "");
    if (!accessToken) return;
    (socketConnection as { emit: (event: string, data: unknown) => void }).emit("chat:delete", {
      conversationId: pendingDeleteMessage.conversation_id,
      messageId: pendingDeleteMessage.message_id,
      accessToken,
    });
    setPendingDeleteMessage(null);
  }, [pendingDeleteMessage, socketConnection, serverHost]);

  const startEditing = useCallback((message: ChatMessage) => {
    if (!message.text) return;
    setEditingMessage(message);
    setReplyingTo(null);
    requestAnimationFrame(() => { editorRef.current?.setContent(message.text!); });
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

  const scrollToMessage = useCallback((messageId: string) => {
    const idx = chatMessages.findIndex((m) => m.message_id === messageId);
    if (idx === -1) return;
    virtuosoRef.current?.scrollToIndex({ index: idx, align: "center", behavior: "smooth" });
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
      if (el) {
        el.style.background = "var(--accent-4)";
        setTimeout(() => { el.style.background = "transparent"; }, 1500);
      }
    }, 300);
  }, [chatMessages]);

  const onLightboxOpen = useCallback((src: string, alt?: string) => {
    setLightboxImage({ src, alt });
  }, []);

  const isContextMenuOpen = !!contextMenu;

  const editorPlaceholder =
    !canViewVoiceChannelText && isVoiceChannelTextChat
      ? "Text chat is not available in this voice channel"
      : isRateLimited && rateLimitCountdown
        ? `Please wait ${rateLimitCountdown} seconds...`
        : channelName
          ? `Message #${channelName}`
          : "Chat with your friends!";

  const editorDisabled = (!canViewVoiceChannelText && isVoiceChannelTextChat) || false;

  const showVoiceDisabled = !canViewVoiceChannelText && isVoiceChannelTextChat;
  const showMessages = !showVoiceDisabled && !isLoadingMessages && chatMessages.length > 0;

  const handleStartReached = useCallback(() => {
    if (hasOlderMessages && !isLoadingOlder && onLoadOlder) onLoadOlder();
  }, [hasOlderMessages, isLoadingOlder, onLoadOlder]);

  const followOutput = useCallback((isAtBottom: boolean) => {
    return isAtBottom ? "smooth" as const : false as const;
  }, []);

  const itemContent = useCallback((index: number) => {
    const localIdx = index - (firstItemIndex ?? 100_000);
    const m = chatMessages[localIdx];
    if (!m) return null;
    const meta = messageMetadata[localIdx];
    if (!meta) return null;

    const replyOriginal = m.reply_to_message_id ? messageMap.get(m.reply_to_message_id) : undefined;
    const replyPreviewText = m.reply_to_message_id ? getReplyPreview(replyOriginal ?? null, 100) : null;
    const isMentioned = !!(currentUserNickname && m.text && m.text.toLowerCase().includes(`@${currentUserNickname.toLowerCase()}`));

    return (
      <MessageRow
        message={m}
        meta={meta}
        replyPreviewText={replyPreviewText}
        isMentioned={isMentioned}
        customEmojiList={customEmojiList}
        memberNicknames={memberNicknames}
        blurProfanity={blurProfanity}
        serverHost={serverHost}
        currentUserId={currentUserId}
        currentUserNickname={currentUserNickname}
        canDeleteAny={!!canDeleteAny}
        chatMediaVolume={chatMediaVolume}
        isContextMenuOpen={isContextMenuOpen}
        memberList={memberList}
        setChatMediaVolume={setChatMediaVolume}
        onContextMenu={handleMessageRightClick}
        onReaction={handleReaction}
        onReply={handleReply}
        onDelete={requestDelete}
        scrollToMessage={scrollToMessage}
        onLightboxOpen={onLightboxOpen}
      />
    );
  }, [
    firstItemIndex, chatMessages, messageMetadata, messageMap, currentUserNickname,
    customEmojiList, memberNicknames, blurProfanity, serverHost, currentUserId,
    canDeleteAny, chatMediaVolume, isContextMenuOpen, memberList, setChatMediaVolume,
    handleMessageRightClick, handleReaction, handleReply, requestDelete,
    scrollToMessage, onLightboxOpen,
  ]);

  const headerContent = useCallback(() => {
    if (!isLoadingOlder) return null;
    return (
      <Flex justify="center" py="2">
        <Text size="1" color="gray">Loading older messages...</Text>
      </Flex>
    );
  }, [isLoadingOlder]);

  return (
    <>
      {contextMenu && (
        <MessageContextMenu
          position={contextMenu.position}
          onClose={closeContextMenu}
          onReply={() => handleReply(contextMenu.message)}
          onEdit={() => { if (contextMenu.message.text) startEditing(contextMenu.message); }}
          onReport={handleReport}
          onDelete={() => requestDelete(contextMenu.message)}
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

          {showVoiceDisabled ? (
            <Flex flexGrow="1" align="center" justify="center">
              <Text size="2" color="gray" style={{ textAlign: "center", padding: "16px" }}>
                Text chat is disabled in this voice channel
              </Text>
            </Flex>
          ) : isLoadingMessages ? (
            <Flex flexGrow="1" direction="column" justify="end" style={{ paddingBottom: "16px" }}>
              <MessageSkeleton />
            </Flex>
          ) : chatMessages.length === 0 ? (
            <Flex flexGrow="1" direction="column" justify="end" style={{ paddingBottom: "16px" }}>
              <WelcomeMessage channelName={channelName} />
            </Flex>
          ) : showMessages ? (
            <Virtuoso
              ref={virtuosoRef}
              style={{ flex: 1 }}
              data={chatMessages}
              firstItemIndex={firstItemIndex}
              initialTopMostItemIndex={chatMessages.length - 1}
              followOutput={followOutput}
              alignToBottom
              startReached={handleStartReached}
              overscan={400}
              increaseViewportBy={{ top: 200, bottom: 200 }}
              itemContent={itemContent}
              components={{ Header: headerContent }}
            />
          ) : null}

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
