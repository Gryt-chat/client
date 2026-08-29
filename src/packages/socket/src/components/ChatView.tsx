import { AlertDialog, Button } from "@gryt/ui";
import { AnimatePresence } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PiChatCircleFill, PiCloudArrowUpFill, PiSpeakerHighFill } from "react-icons/pi";
import { Socket } from "socket.io-client";

import { getUploadsFileUrl, resolveAvatarSrc } from "@/common";
import { useSettings } from "@/settings";

import { useChatActions } from "../hooks/useChatActions";
import { useChatScroll } from "../hooks/useChatScroll";
import { useServerPermissions } from "../hooks/usePermissions";
import { useTypingIndicator } from "../hooks/useTypingIndicator";
import { fetchCustomEmojis, getCustomEmojis, onCustomEmojisChange, setCustomEmojis } from "../utils/emojiData";
import type { CustomEmojiEntry } from "../utils/remarkEmoji";
import type { ChatEditorHandle } from "./ChatEditor";
import { ChatEditorBar } from "./ChatEditorBar";
import { MessageSkeleton, WelcomeMessage } from "./ChatMessage";
import type { ChatMessage } from "./chatUtils";
import { buildMessageMap, buildMessageMetadata, getReplyPreview } from "./chatViewHelpers";
import { DirectMessagePrivacyNotice } from "./DirectMessagePrivacyNotice";
import { EmojiText } from "./EmojiText";
import { ImageLightbox } from "./ImageLightbox";
import type { MemberInfo } from "./MemberSidebar";
import { MessageRow } from "./MessageRow";
import { TypingIndicator } from "./TypingIndicator";

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
  conversationKind = "channel",
  serverName,
  headerAction,
  flush,
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
  memberList?: Record<string, MemberInfo>;
  channelName?: string;
  channelType?: "text" | "voice";
  /** A direct message reads differently: no `#`, and its own empty state. */
  conversationKind?: "channel" | "dm";
  serverName?: string;
  /**
   * Put at the right-hand end of the header.
   *
   * A slot rather than a named button, because what belongs there depends on
   * what is open and this component does not need to know: the DM view puts
   * "start a group" here, and a channel puts nothing.
   */
  headerAction?: React.ReactNode;
  /**
   * Drawn flush to the window rather than as a card.
   *
   * The tiny window has no rail, no sidebars and no page padding, so the
   * conversation is the window — and a rounded corner against the window's own
   * corner reads as something clipped rather than as a panel.
   */
  flush?: boolean;
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

  const { typingUsers, emitTyping, emitStopTyping } = useTypingIndicator(
    (socketConnection as Socket) ?? null,
    conversationKey ?? "",
  );

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
    const uploaded = fileId && serverHost ? getUploadsFileUrl(serverHost, fileId) : undefined;
    // Only from the member list, never off the message. A message carries the
    // avatar its sender had when it was sent, which is right for somebody who
    // has since left; a look is drawn live, so an old string would redress
    // them in whatever they were wearing that afternoon.
    const worn = memberList?.[msg.sender_server_id]?.avatarWorn;
    // Seeded on the same id the member list uses, so the face beside a message
    // is the face in the sidebar. Webhooks are excluded for the same reason
    // server icons are: a generated face is wrong for something that is not a
    // person, and their sender id is "webhook:<id>" rather than a member's.
    if (msg.sender_server_id?.startsWith("webhook:")) return uploaded;
    return resolveAvatarSrc(uploaded, getSenderName(msg), worn);
  }, [memberList, serverHost, getSenderName]);

  const mentionMembers = useMemo(() => {
    if (!memberList) return [];
    return Object.values(memberList).map((m) => ({
      nickname: m.nickname,
      serverUserId: m.serverUserId,
      avatarUrl: resolveAvatarSrc(
        m.avatarFileId && serverHost ? getUploadsFileUrl(serverHost, m.avatarFileId, { thumb: true }) : undefined,
        m.nickname,
        m.avatarWorn,
      ) ?? null,
    }));
  }, [memberList, serverHost]);

  const memberNicknames = useMemo(
    () => mentionMembers.map((m) => m.nickname),
    [mentionMembers],
  );

  // ── Message metadata ──────────────────────────────────────────
  const messageMetadata = useMemo(
    () => buildMessageMetadata(chatMessages, newMessageMarkerId, currentUserId, getSenderName, getSenderAvatarUrl, memberList),
    [chatMessages, newMessageMarkerId, currentUserId, getSenderName, getSenderAvatarUrl, memberList],
  );

  const messageMap = useMemo(() => buildMessageMap(chatMessages), [chatMessages]);

  const onLightboxOpen = useCallback((src: string, alt?: string) => {
    setLightboxImage({ src, alt });
  }, []);

  // What this server lets us do here. A read-only role still sees every
  // message — the compose box is what goes away, with a line saying why rather
  // than a box that swallows what you type and then errors.
  const { can: mayHere } = useServerPermissions(serverHost || "");
  const maySend = mayHere("send_messages");
  const mayRead = mayHere("read_messages");

  const editorPlaceholder =
    !canViewVoiceChannelText && isVoiceChannelTextChat
      ? "Text chat is not available in this voice channel"
      : !mayRead
        ? "This channel is not readable with your role."
      : !maySend
        ? "You can read here, but not post."
        : isRateLimited && rateLimitCountdown
          ? `Please wait ${rateLimitCountdown} seconds...`
          : channelName
            ? conversationKind === "dm"
              ? `Message ${channelName}`
              : `Message #${channelName}`
            : "Chat with your friends!";

  const editorDisabled = (!canViewVoiceChannelText && isVoiceChannelTextChat) || !maySend || !mayRead;

  const showVoiceDisabled = !canViewVoiceChannelText && isVoiceChannelTextChat;
  const showMessages = mayRead && !showVoiceDisabled && !isLoadingMessages && chatMessages.length > 0;

  return (
    <>
      {/*
        The three panels carried no landmark roles, so the only roles in the
        whole document were status, textbox and tooltip — a screen-reader user
        had no way to move between channels, conversation and members. Radix's
        Box and Flex only render as div or span, so the roles go on the existing
        containers rather than restructuring into main/nav/aside.
      */}
      <div className="grow overflow-hidden" role="main" aria-label="Conversation" data-gryt="chat-view" style={{ minWidth: 0,
          background: "var(--gryt-neutral-3)",
          borderRadius: flush ? 0 : "var(--gryt-radius-lg)",
          position: "relative",
        }} onDragEnter={handleViewDragEnter} onDragLeave={handleViewDragLeave} onDragOver={handleViewDragOver} onDrop={handleViewDrop}>
        {isDragOver && (
          <div className="chat-view-drop-overlay">
            <div className="chat-view-drop-overlay-content">
              <PiCloudArrowUpFill size={48} />
              <span>Drop files here</span>
            </div>
          </div>
        )}
        <div className="flex h-full w-full flex-col p-3">
          {channelName && (
            <div className="flex items-center gap-2" style={{ marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid var(--gryt-neutral-6)" }}>
              {channelType === "voice" && conversationKind === "channel" ? <PiSpeakerHighFill size={18} style={{ color: "var(--gryt-neutral-11)", flexShrink: 0 }} /> : <PiChatCircleFill size={18} style={{ color: "var(--gryt-neutral-11)", flexShrink: 0 }} />}
              <span className="text-lg font-bold" style={{ color: "var(--gryt-neutral-12)" }}>
                <EmojiText text={channelName} />
              </span>
              {headerAction && <div style={{ marginLeft: "auto" }}>{headerAction}</div>}
            </div>
          )}

          {/* Above the messages rather than under the header, so it is the
              first thing read on the way down to the composer, and so it
              scrolls with a long conversation instead of sitting over it. */}
          {conversationKind === "dm" && <DirectMessagePrivacyNotice />}

          {isVoiceChannelTextChat && !canViewVoiceChannelText && (
            <div className="flex items-center justify-center" style={{ padding: "24px", textAlign: "center" }}>
              <span className="text-base text-gryt-muted" style={{ maxWidth: "300px" }}>
                Text chat is not available in this voice channel
              </span>
            </div>
          )}

          {showVoiceDisabled ? (
            <div className="flex grow items-center justify-center">
              <span className="text-sm text-gryt-muted" style={{ textAlign: "center", padding: "16px" }}>
                Text chat is disabled in this voice channel
              </span>
            </div>
          ) : isLoadingMessages ? (
            <div className="flex grow flex-col justify-end" style={{ paddingBottom: "16px" }}>
              <MessageSkeleton />
            </div>
          ) : chatMessages.length === 0 ? (
            <div className="flex grow items-center justify-center" style={{ paddingBottom: "16px" }}>
              <WelcomeMessage channelName={channelName} channelType={channelType} conversationKind={conversationKind} serverName={serverName} />
            </div>
          ) : showMessages ? (
            <div
              ref={scrollRef}
              className="chat-scroll-container"
              onScroll={handleScroll}
            >
              {isLoadingOlder && (
                <div className="flex justify-center py-2">
                  <span className="text-xs text-gryt-muted">Loading older messages...</span>
                </div>
              )}
              <AnimatePresence mode="popLayout" initial={false}>
                {chatMessages.map((m, i) => {
                  const meta = messageMetadata[i];
                  if (!meta) return null;

                  const replyOriginal = m.reply_to_message_id ? messageMap.get(m.reply_to_message_id) : undefined;
                  const replyPreviewText = m.reply_to_message_id ? getReplyPreview(replyOriginal ?? null, 100) : null;
                  const isMentioned = !!(currentUserId && m.text && m.text.includes(`mention:${currentUserId}`));

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

          <TypingIndicator typingUsers={typingUsers} serverHost={serverHost} />
          <ChatEditorBar
            replyingTo={replyingTo}
            editingMessage={editingMessage}
            editorRef={editorRef}
            placeholder={editorPlaceholder}
            disabled={editorDisabled}
            allowFiles={mayHere("attach_files")}
            maxFileSize={maxFileSize}
            memberList={mentionMembers}
            getSenderName={getSenderName}
            onCancelReply={cancelReply}
            onCancelEditing={cancelEditing}
            onSend={handleEditorSend}
            onArrowUpEmpty={handleArrowUpEmpty}
            onTyping={emitTyping}
            onStopTyping={emitStopTyping}
            serverHost={serverHost}
          />
        </div>
      </div>
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          onClose={() => setLightboxImage(null)}
        />
      )}
      <AlertDialog.Root open={!!pendingDeleteMessage} onOpenChange={(open) => { if (!open) setPendingDeleteMessage(null); }}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop />
          <AlertDialog.Popup>
          <AlertDialog.Title>Delete message?</AlertDialog.Title>
          <AlertDialog.Description>
            This will permanently delete this message. This action cannot be undone.
          </AlertDialog.Description>
          <div className="flex gap-3 mt-4 justify-end">
            <AlertDialog.Close
              render={
                <Button tone="neutral" size="small">Cancel</Button>
              }
            />
            <AlertDialog.Close
              render={
                <Button tone="danger" size="small" onClick={confirmDelete}>Delete</Button>
              }
            />
          </div>
        </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
});

ChatView.displayName = "ChatView";
