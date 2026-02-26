import { AlertDialog, Box, Button, Flex, Text } from "@radix-ui/themes";
import { AnimatePresence } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdChat, MdCloudUpload, MdVolumeUp } from "react-icons/md";

import { getUploadsFileUrl } from "@/common";
import { useSettings } from "@/settings";

import { useChatActions } from "../hooks/useChatActions";
import { useChatScroll } from "../hooks/useChatScroll";
import { fetchCustomEmojis, getCustomEmojis, onCustomEmojisChange, setCustomEmojis } from "../utils/emojiData";
import type { CustomEmojiEntry } from "../utils/remarkEmoji";
import type { ChatEditorHandle } from "./ChatEditor";
import { ChatEditorBar } from "./ChatEditorBar";
import { MessageSkeleton, WelcomeMessage } from "./ChatMessage";
import type { ChatMessage } from "./chatUtils";
import { buildMessageMap, buildMessageMetadata, getReplyPreview } from "./chatViewHelpers";
import { EmojiText } from "./EmojiText";
import { ImageLightbox } from "./ImageLightbox";
import { MessageRow } from "./MessageRow";

export type { AttachmentMeta, ChatMessage, Reaction } from "./chatUtils";

export const ChatView = memo(({
  chatMessages,
  conversationKey,
  canSend,
  sendChat,
  editMessage,
  currentUserId,
  currentUserNickname,
  socketConnection,
  serverHost,
  memberList,
  channelName,
  channelType,
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
  conversationKey?: string;
  canSend: boolean;
  sendChat: (text: string, files: File[], replyToMessageId?: string) => void;
  editMessage?: (messageId: string, conversationId: string, newText: string) => void;
  currentUserId?: string;
  currentUserNickname?: string;
  socketConnection?: unknown;
  serverHost?: string;
  memberList?: Record<string, { nickname: string; serverUserId: string; avatarFileId?: string | null; [key: string]: unknown }>;
  channelName?: string;
  channelType?: "text" | "voice";
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
  const { chatMediaVolume, setChatMediaVolume, blurProfanity, smileyConversion, disabledSmileys } = useSettings();
  const editorRef = useRef<ChatEditorHandle>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt?: string } | null>(null);
  const dragCounterRef = useRef(0);

  const {
    scrollRef,
    handleScroll,
    forceScrollToBottomRef,
    seenMessageIdsRef,
    newMessageMarkerId,
  } = useChatScroll(chatMessages, conversationKey, hasOlderMessages, isLoadingOlder, onLoadOlder);

  const {
    replyingTo,
    editingMessage,
    pendingDeleteMessage,
    setPendingDeleteMessage,
    cancelReply,
    handleReaction,
    handleReply,
    handleReport,
    requestDelete,
    confirmDelete,
    startEditing,
    cancelEditing,
    handleArrowUpEmpty,
    handleEditorSend,
    scrollToMessage,
  } = useChatActions({
    chatMessages,
    socketConnection,
    currentUserId,
    serverHost,
    canDeleteAny,
    canSend,
    isRateLimited,
    sendChat,
    editMessage,
    editorRef,
    forceScrollToBottomRef,
  });

  // ── Custom emoji ──────────────────────────────────────────────
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

  // ── Drag & drop ───────────────────────────────────────────────
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

  // ── Sender helpers ────────────────────────────────────────────
  const getSenderName = useCallback((msg: ChatMessage): string => {
    const fromList = memberList?.[msg.sender_server_id]?.nickname;
    if (fromList) return fromList;
    return msg.sender_nickname || "Unknown User";
  }, [memberList]);

  const getSenderAvatarUrl = useCallback((msg: ChatMessage): string | undefined => {
    const fileId = memberList?.[msg.sender_server_id]?.avatarFileId || msg.sender_avatar_file_id;
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

  // ── Message metadata ──────────────────────────────────────────
  const messageMetadata = useMemo(
    () => buildMessageMetadata(chatMessages, newMessageMarkerId, currentUserId, currentUserNickname, getSenderName, getSenderAvatarUrl),
    [chatMessages, newMessageMarkerId, currentUserId, currentUserNickname, getSenderName, getSenderAvatarUrl],
  );

  const messageMap = useMemo(() => buildMessageMap(chatMessages), [chatMessages]);

  const onLightboxOpen = useCallback((src: string, alt?: string) => {
    setLightboxImage({ src, alt });
  }, []);

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

  return (
    <>
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
            <Flex align="center" gap="2" style={{ marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid var(--gray-6)" }}>
              {channelType === "voice" ? <MdVolumeUp size={18} style={{ color: "var(--gray-11)", flexShrink: 0 }} /> : <MdChat size={18} style={{ color: "var(--gray-11)", flexShrink: 0 }} />}
              <Text size="4" weight="bold" style={{ color: "var(--gray-12)" }}>
                <EmojiText text={channelName} />
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
              <WelcomeMessage channelName={channelName} channelType={channelType} />
            </Flex>
          ) : showMessages ? (
            <div
              ref={scrollRef}
              className="chat-scroll-container"
              onScroll={handleScroll}
            >
              {isLoadingOlder && (
                <Flex justify="center" py="2">
                  <Text size="1" color="gray">Loading older messages...</Text>
                </Flex>
              )}
              <AnimatePresence mode="popLayout" initial={false}>
                {chatMessages.map((m, i) => {
                  const meta = messageMetadata[i];
                  if (!meta) return null;

                  const replyOriginal = m.reply_to_message_id ? messageMap.get(m.reply_to_message_id) : undefined;
                  const replyPreviewText = m.reply_to_message_id ? getReplyPreview(replyOriginal ?? null, 100) : null;
                  const isMentioned = !!(currentUserNickname && m.text && m.text.toLowerCase().includes(`@${currentUserNickname.toLowerCase()}`));

                  const isNew = !seenMessageIdsRef.current.has(m.message_id) && i >= chatMessages.length - 10;
                  seenMessageIdsRef.current.add(m.message_id);

                  return (
                    <MessageRow
                      key={m.message_id}
                      message={m}
                      meta={meta}
                      replyPreviewText={replyPreviewText}
                      isMentioned={isMentioned}
                      isNew={isNew}
                      customEmojiList={customEmojiList}
                      memberNicknames={memberNicknames}
                      blurProfanity={blurProfanity}
                      smileyConversion={smileyConversion}
                      disabledSmileys={disabledSmileys}
                      serverHost={serverHost}
                      currentUserId={currentUserId}
                      currentUserNickname={currentUserNickname}
                      canDeleteAny={!!canDeleteAny}
                      chatMediaVolume={chatMediaVolume}
                      memberList={memberList}
                      setChatMediaVolume={setChatMediaVolume}
                      onReaction={handleReaction}
                      onReply={handleReply}
                      onEdit={startEditing}
                      onReport={handleReport}
                      onDelete={requestDelete}
                      scrollToMessage={scrollToMessage}
                      onLightboxOpen={onLightboxOpen}
                    />
                  );
                })}
              </AnimatePresence>
            </div>
          ) : null}

          <ChatEditorBar
            replyingTo={replyingTo}
            editingMessage={editingMessage}
            editorRef={editorRef}
            placeholder={editorPlaceholder}
            disabled={editorDisabled}
            maxFileSize={maxFileSize}
            memberList={mentionMembers}
            getSenderName={getSenderName}
            onCancelReply={cancelReply}
            onCancelEditing={cancelEditing}
            onSend={handleEditorSend}
            onArrowUpEmpty={handleArrowUpEmpty}
            serverHost={serverHost}
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
