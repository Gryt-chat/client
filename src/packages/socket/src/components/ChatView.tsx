import { AlertDialog, Button } from "@gryt/ui";
import { AnimatePresence } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Socket } from "socket.io-client";

import type { SealDecision } from "@/common";
import { getUploadsFileUrl, resolveAvatarSrc, useTheme } from "@/common";
import { useSettings } from "@/settings";

import { PiChatCircleFill, PiChatsFill, PiCloudArrowUpFill, PiRobotFill, PiSpeakerHighFill } from "../../../../lib/icons";
import { useChatActions } from "../hooks/useChatActions";
import { useChatScroll } from "../hooks/useChatScroll";
import { useServerPermissions } from "../hooks/usePermissions";
import { useThreads } from "../hooks/useThreads";
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
import { ForumView } from "./ForumView";
import { ImageLightbox } from "./ImageLightbox";
import { readableRoleColor } from "./memberGroups";
import type { MemberInfo } from "./MemberSidebar";
import { MessageKeyPrompt } from "./MessageKeyPrompt";
import { MessageRow } from "./MessageRow";
import { ThreadPanel } from "./ThreadPanel";
import { TypingIndicator } from "./TypingIndicator";

export type { AttachmentMeta, ChatMessage, Reaction } from "./chatUtils";

export const ChatView = memo(({
  chatMessages,
  conversationKey,
  canSend,
  canSendHere,
  sendChat,
  editMessage,
  currentUserId,
  currentUserNickname,
  socketConnection,
  serverHost,
  memberList,
  channelName,
  automated,
  layout,
  forumTags,
  channelType,
  conversationKind = "channel",
  sealing,
  memberNames,
  serverName,
  headerAction,
  underHeader,
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
  /**
   * Whether the open channel allows posting, as the server resolved it.
   *
   * Separate from the server-wide permission below, because a channel scope can
   * take `send_messages` away from a role that holds it everywhere else — and
   * the rules that say so are only readable with `manage_channels`, so the
   * client cannot work it out. Absent means the server is too old to say.
   */
  canSendHere?: boolean;
  sendChat: (text: string, files: File[], replyToMessageId?: string) => void;
  editMessage?: (messageId: string, conversationId: string, newText: string) => void;
  currentUserId?: string;
  currentUserNickname?: string;
  socketConnection?: unknown;
  serverHost?: string;
  memberList?: Record<string, MemberInfo>;
  channelName?: string;
  channelType?: "text" | "voice";
  /** An automated channel: only bots and the system post, so the composer is locked. GRYT-982. */
  automated?: boolean;
  /** A forum channel shows a topic index instead of a chat stream. GRYT-981 Stage 2. */
  layout?: "chat" | "forum";
  forumTags?: import("@/settings/src/types/server").ForumTag[];
  /** A direct message reads differently: no `#`, and its own empty state. */
  conversationKind?: "channel" | "dm";
  /**
   * Whether the next message will be encrypted (GRYT-729). Absent on a channel,
   * which is never encrypted and needs no note saying so.
   */
  sealing?: SealDecision;
  /** Member id to nickname, so a refusal can name the person rather than an id. */
  memberNames?: Record<string, string>;
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
   * Rendered directly under the channel header.
   *
   * A slot rather than the panel itself, because ChatView does not know about
   * servers — it is the same component for a DM.
   */
  underHeader?: React.ReactNode;
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

  // Threads live here so both the desktop and mobile chat views get them for
  // free — the socket, conversation and member list are all already in hand.
  const threads = useThreads(socketConnection, conversationKey ?? "", serverHost, currentUserId, currentUserNickname);
  const isForum = layout === "forum" && conversationKind !== "dm";

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
      // Null is a refused read. Leave whatever is already stored rather than
      // blanking the emoji in messages on screen.
      if (emojis) setCustomEmojis(emojis, serverHost);
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

  // What this server lets us do here. A read-only role still sees every
  // message — the compose box is what goes away, with a line saying why rather
  // than a box that swallows what you type and then errors.
  //
  // Read up here rather than beside `maySend` below, because the role list it
  // also returns feeds the name colours in the metadata pass underneath.
  const { can: mayHere, roles } = useServerPermissions(serverHost || "");
  const { resolvedAppearance } = useTheme();

  /**
   * Role id to the colour its members' names take, the same map and the same
   * `readableRoleColor` the member sidebar builds.
   *
   * Names have to agree between the two: seeing somebody in green in the
   * sidebar and in plain white two inches to the left is the sort of mismatch
   * that reads as a bug in whichever one you looked at second.
   */
  const roleColors = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const role of roles) {
      map.set(role.id, readableRoleColor(role.color, resolvedAppearance));
    }
    return map;
  }, [roles, resolvedAppearance]);

  // ── Message metadata ──────────────────────────────────────────
  const messageMetadata = useMemo(
    () => buildMessageMetadata(chatMessages, newMessageMarkerId, currentUserId, getSenderName, getSenderAvatarUrl, memberList, roleColors),
    [chatMessages, newMessageMarkerId, currentUserId, getSenderName, getSenderAvatarUrl, memberList, roleColors],
  );

  const messageMap = useMemo(() => buildMessageMap(chatMessages), [chatMessages]);

  const onLightboxOpen = useCallback((src: string, alt?: string) => {
    setLightboxImage({ src, alt });
  }, []);

  // Both have to say yes: the role has to allow posting at all, and this
  // channel has to be one of the ones it allows it in.
  const maySend = mayHere("send_messages") && canSendHere !== false;
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
        <div className="flex h-full w-full flex-col p-3" style={{ position: "relative" }}>
          {channelName && (
            <div className="flex items-center gap-2" style={{ marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid var(--gryt-neutral-6)" }}>
              {isForum ? <PiChatsFill size={18} style={{ color: "var(--gryt-neutral-11)", flexShrink: 0 }} /> : automated ? <PiRobotFill size={18} style={{ color: "var(--gryt-neutral-11)", flexShrink: 0 }} /> : channelType === "voice" && conversationKind === "channel" ? <PiSpeakerHighFill size={18} style={{ color: "var(--gryt-neutral-11)", flexShrink: 0 }} /> : <PiChatCircleFill size={18} style={{ color: "var(--gryt-neutral-11)", flexShrink: 0 }} />}
              <span className="text-lg font-bold" style={{ color: "var(--gryt-neutral-12)" }}>
                <EmojiText text={channelName} />
              </span>
              {headerAction && <div style={{ marginLeft: "auto" }}>{headerAction}</div>}
            </div>
          )}

          {underHeader}

          {isForum ? (
            <ForumView
              socketConnection={socketConnection}
              conversationId={conversationKey ?? ""}
              serverHost={serverHost}
              currentUserId={currentUserId}
              forumTags={forumTags ?? []}
              onOpenTopic={threads.openSummary}
            />
          ) : (
          <>
          {/* Above the messages rather than under the header, so it is the
              first thing read on the way down to the composer, and so it
              scrolls with a long conversation instead of sitting over it. */}
          {conversationKind === "dm" && <DirectMessagePrivacyNotice decision={sealing} />}
          {conversationKind === "dm" && <MessageKeyPrompt />}

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
              <WelcomeMessage channelName={channelName} channelType={channelType} conversationKind={conversationKind} serverName={serverName} automated={automated} />
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
                      threadSummary={threads.summaries[m.message_id]}
                      onStartThread={conversationKind === "dm" ? undefined : threads.startThread}
                      onOpenThread={threads.openThread}
                    />
                  );
                })}
              </AnimatePresence>
            </div>
          ) : null}

          {/*
            Whether the next message goes out encrypted, and who is stopping it
            (GRYT-729). Above the composer rather than in the header, so it is
            in the same glance as the box being typed into.

            Drawn only when it is *not* encrypted. A conversation that seals is
            the ordinary case once everybody has updated, and a permanent badge
            saying so becomes furniture nobody reads — which is the state where
            it going missing means nothing to anybody.
          */}
          {sealing?.kind === "plaintext" && sealing.blockedBy.length > 0 && (
            <div
              aria-live="polite"
              className="mb-1.5 px-1 text-xs leading-snug text-gryt-muted"
            >
              Not encrypted:{" "}
              {sealing.blockedBy
                .map((blocked) => {
                  const who =
                    memberNames?.[blocked.memberId] ?? "somebody in this conversation";
                  if (blocked.reason === "changed") return `${who}'s key changed`;
                  if (blocked.reason === "unusable") return `${who}'s key did not check out`;
                  return `${who} has not published a key`;
                })
                .join(", ")}
              .
            </div>
          )}

          {automated ? (
            <div
              className="mt-1 flex items-center gap-3 px-4 py-3 text-sm"
              style={{ borderRadius: "var(--gryt-radius-md)", border: "1px dashed var(--gryt-neutral-6)", background: "var(--gryt-neutral-3)", color: "var(--gryt-neutral-11)" }}
            >
              <PiRobotFill size={22} style={{ color: "var(--gryt-neutral-9)", flexShrink: 0 }} />
              <span>This is an automated channel &mdash; messages come from bots and the system. You can read here, but not post.</span>
            </div>
          ) : (
          <>
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
          </>
          )}
          </>
          )}
          {threads.open && (
            <ThreadPanel
              thread={threads.open.thread}
              root={threads.open.root}
              messages={threads.open.messages}
              loading={threads.open.loading}
              memberList={memberList}
              onClose={threads.closeThread}
              onSend={threads.sendReply}
              onSetStatus={threads.setStatus}
            />
          )}
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
