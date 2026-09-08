import {  } from "@gryt/ui";
import { AnimatePresence } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Socket } from "socket.io-client";

import type { SealDecision } from "@/common";
import { getUploadsFileUrl, resolveAvatarSrc, useTheme, useThreadMentions, useThreadUnread } from "@/common";
import { useSettings } from "@/settings";

import { PiChatCircleFill, PiChatsFill, PiCloudArrowUpFill, PiLockOpen, PiRobotFill, PiSpeakerHighFill } from "../../../../lib/icons";
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
import { ConfirmDialog } from "./ConfirmDialog";
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
  isBlocked,
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
  /** A channel scope can take `send_messages` from a role that holds it
      everywhere else, and only `manage_channels` can read the rules. */
  canSendHere?: boolean;
  sendChat: (text: string, files: File[], replyToMessageId?: string) => void;
  editMessage?: (messageId: string, conversationId: string, newText: string) => void;
  currentUserId?: string;
  currentUserNickname?: string;
  socketConnection?: unknown;
  serverHost?: string;
  memberList?: Record<string, MemberInfo>;
  /** `chatMessages` arrives filtered, but the thread panel's come from
      `useThreads` in here and never did. */
  isBlocked?: (serverUserId: string) => boolean;
  channelName?: string;
  channelType?: "text" | "voice";
  /** An automated channel: only bots and the system post, so the composer is locked. GRYT-982. */
  automated?: boolean;
  /** A forum channel shows a topic index instead of a chat stream. GRYT-981 Stage 2. */
  layout?: "chat" | "forum";
  forumTags?: import("@/settings/src/types/server").ForumTag[];
  /** A direct message reads differently: no `#`, and its own empty state. */
  conversationKind?: "channel" | "dm";
  /** Absent on a channel, which is never encrypted and needs no note. */
  sealing?: SealDecision;
  /** Member id to nickname, so a refusal can name the person rather than an id. */
  memberNames?: Record<string, string>;
  serverName?: string;
  /** A slot rather than a named button: the DM view puts "start a group" here
      and a channel puts nothing. */
  headerAction?: React.ReactNode;
  /** A slot rather than the panel, because this is the same component for a DM
      and knows nothing about servers. */
  underHeader?: React.ReactNode;
  /** In the tiny window the conversation is the window, and a rounded corner
      against the window's own reads as something clipped. */
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
  /* Its own handle: sharing the channel's would show a half-typed channel draft
     in the thread, and sending from either would clear both. */
  const threadEditorRef = useRef<ChatEditorHandle>(null);

  /* Its own, for the same reason: sharing would put "replying to…" above the box
     you are not typing in. */
  const [threadReplyingTo, setThreadReplyingTo] = useState<ChatMessage | null>(null);
  const [threadEditing, setThreadEditing] = useState<ChatMessage | null>(null);

  const handleThreadReply = useCallback((m: ChatMessage) => {
    setThreadEditing(null);
    setThreadReplyingTo(m);
    requestAnimationFrame(() => threadEditorRef.current?.focus());
  }, []);

  const startThreadEditing = useCallback((m: ChatMessage) => {
    if (!m.text) return;
    setThreadReplyingTo(null);
    setThreadEditing(m);
  }, []);

  /* After the render that opens editing: this composer's callback identity
     changes with `threadEditing`, so the editor remounts and loses a frame. */
  useEffect(() => {
    if (threadEditing?.text) threadEditorRef.current?.setContent(threadEditing.text);
  }, [threadEditing]);

  const cancelThreadEditing = useCallback(() => {
    setThreadEditing(null);
    threadEditorRef.current?.clear();
  }, []);
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

  /* The same filter `chatMessages` arrived with: a thread's messages are fetched
     here rather than upstream, so a blocked sender still turned up. */
  const visibleThreadMessages = useMemo(
    () =>
      isBlocked
        ? (threads.open?.messages ?? []).filter((m) => !isBlocked(m.sender_server_id))
        : threads.open?.messages ?? [],
    [threads.open?.messages, isBlocked],
  );

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

  /* Two instances rather than one that knows about both, so neither has to
     filter the other's list out. */
  const {
    typingUsers: threadTypingUsers,
    emitTyping: emitThreadTyping,
    emitStopTyping: emitThreadStopTyping,
  } = useTypingIndicator(
    (socketConnection as Socket) ?? null,
    conversationKey ?? "",
    threads.open?.thread.thread_id ?? null,
  );

  /* Subscribed here rather than in MessageRow, whose memoisation a hook down
     there would defeat every time any thread moved. */
  const { threadUnreadCount } = useThreadUnread();
  const { threadMentionCount } = useThreadMentions();
  const threadCountsFor = useCallback(
    (threadId: string | undefined) =>
      threadId
        ? {
          unread: threadUnreadCount(serverHost ?? "", threadId),
          mentions: threadMentionCount(serverHost ?? "", threadId),
        }
        : { unread: 0, mentions: 0 },
    [threadUnreadCount, threadMentionCount, serverHost],
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
    // From the member list, never the message: a message carries the avatar its
    // sender had, and a look is drawn live.
    const worn = memberList?.[msg.sender_server_id]?.avatarWorn;
    // The same id the member list uses, so the faces agree. Webhooks are excluded:
    // a generated face is wrong for something that is not a person.
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

  // A read-only role still sees every message; the compose box is what goes.
  // Read here, because the role list also feeds the name colours below.
  const { can: mayHere, roles } = useServerPermissions(serverHost || "");
  const { resolvedAppearance } = useTheme();

  /** The same map and `readableRoleColor` the member sidebar builds: a name in
      green there and white here reads as a bug in whichever you saw second. */
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
  /* `buildMessageMetadata` is a pure pass over an ordered array, since grouping
     needs neighbours, so the root goes in front and the result is keyed after. */
  const threadMessages = useMemo(
    () =>
      threads.open?.root
        ? [threads.open.root, ...visibleThreadMessages]
        : visibleThreadMessages,
    [threads.open?.root, visibleThreadMessages],
  );

  const threadMetaById = useMemo(() => {
    const metas = buildMessageMetadata(
      threadMessages,
      null,
      currentUserId,
      getSenderName,
      getSenderAvatarUrl,
      memberList,
      roleColors,
    );
    const byId = new Map<string, (typeof metas)[number]>();
    threadMessages.forEach((m, i) => {
      const meta = metas[i];
      if (meta) byId.set(m.message_id, meta);
    });
    return byId;
  }, [threadMessages, currentUserId, getSenderName, getSenderAvatarUrl, memberList, roleColors]);

  const renderThreadMessage = useCallback(
    (m: ChatMessage) => {
      const meta = threadMetaById.get(m.message_id);
      if (!meta) return null;
      /* A reply in a thread points at another thread message, which the channel's
         map does not hold. Thread first, then fall back for the root. */
      const replyOriginal = m.reply_to_message_id
        ? threadMessages.find((t) => t.message_id === m.reply_to_message_id) ??
          messageMap.get(m.reply_to_message_id)
        : undefined;
      return (
        <MessageRow
          message={m}
          meta={meta}
          replyPreviewText={
            m.reply_to_message_id ? getReplyPreview(replyOriginal ?? null, 100) : null
          }
          isMentioned={
            !!(currentUserId && m.text && m.text.includes(`mention:${currentUserId}`))
          }
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
          onReply={handleThreadReply}
          onEdit={startThreadEditing}
          onReport={handleReport}
          onDelete={requestDelete}
          scrollToMessage={scrollToMessage}
          onLightboxOpen={onLightboxOpen}
          /* No onStartThread: a thread cannot hang off a message already in one,
             and the server refuses it. */
        />
      );
    },
    [
      threadMetaById,
      threadMessages,
      messageMap,
      currentUserId,
      customEmojiList,
      memberNicknames,
      blurProfanity,
      smileyConversion,
      disabledSmileys,
      serverHost,
      currentUserNickname,
      canDeleteAny,
      chatMediaVolume,
      memberList,
      setChatMediaVolume,
      handleReaction,
      handleThreadReply,
      startThreadEditing,
      handleReport,
      requestDelete,
      scrollToMessage,
      onLightboxOpen,
    ],
  );

  // Both have to say yes: the role has to allow posting at all, and this
  // channel has to be one of the ones it allows it in.
  const maySend = mayHere("send_messages") && canSendHere !== false;
  const mayRead = mayHere("read_messages");

  const renderThreadComposer = useCallback(
    () => (
      <ChatEditorBar
        replyingTo={threadReplyingTo}
        editingMessage={threadEditing}
        editorRef={threadEditorRef}
        placeholder="Reply to thread…"
        disabled={!maySend}
        allowFiles={mayHere("attach_files")}
        maxFileSize={maxFileSize}
        memberList={mentionMembers}
        getSenderName={getSenderName}
        onCancelReply={() => setThreadReplyingTo(null)}
        onCancelEditing={cancelThreadEditing}
        onSend={(markdown, files) => {
          if (threadEditing) {
            // Optional on the props, and absent where editing is not offered.
            editMessage?.(threadEditing.message_id, threadEditing.conversation_id, markdown);
            cancelThreadEditing();
            return;
          }
          threads.sendReply(markdown, files, threadReplyingTo?.message_id);
          setThreadReplyingTo(null);
        }}
        /* Up-arrow-to-edit scans the channel's messages, so in here it opens the
           wrong one. */
        onArrowUpEmpty={() => {}}
        onTyping={emitThreadTyping}
        onStopTyping={emitThreadStopTyping}
        serverHost={serverHost}
      />
    ),
    [maySend, mayHere, maxFileSize, mentionMembers, getSenderName, threads, emitThreadTyping, emitThreadStopTyping, serverHost, threadReplyingTo, threadEditing, cancelThreadEditing, editMessage],
  );


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
                      threadUnread={threadCountsFor(threads.summaries[m.message_id]?.thread_id).unread}
                      threadMentions={threadCountsFor(threads.summaries[m.message_id]?.thread_id).mentions}
                      onStartThread={conversationKind === "dm" ? undefined : threads.startThread}
                      onOpenThread={threads.openThread}
                      /* Channels are never sealed, so the mark would be on every
                         message and mean nothing. */
                      unencrypted={conversationKind === "dm" && !m.sealed}
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
              className="mb-1.5 flex items-start gap-1.5 px-1 text-xs leading-snug"
              style={{ color: "var(--gryt-danger-11)" }}
            >
              <PiLockOpen aria-hidden="true" size={13} style={{ flexShrink: 0, marginTop: "1px" }} />
              <span>
                <strong style={{ fontWeight: 700 }}>Not encrypted.</strong> Whoever runs this
                server can read what you send here, in the clear.{" "}
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
              </span>
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
              messages={visibleThreadMessages}
              loading={threads.open.loading}
              renderMessage={renderThreadMessage}
              renderComposer={renderThreadComposer}
              hasOlder={threads.open.hasOlder}
              loadingOlder={threads.open.loadingOlder}
              onLoadOlder={threads.loadOlder}
              onClose={threads.closeThread}
              onSetStatus={threads.setStatus}
              typingIndicator={
                <TypingIndicator typingUsers={threadTypingUsers} serverHost={serverHost} />
              }
              forumTags={forumTags ?? []}
              onSetTags={threads.setTags}
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
      <ConfirmDialog
        open={!!pendingDeleteMessage}
        onOpenChange={(open) => { if (!open) setPendingDeleteMessage(null); }}
        title="Delete message?"
        description="This will permanently delete this message. This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={confirmDelete}
      />
    </>
  );
});

ChatView.displayName = "ChatView";
