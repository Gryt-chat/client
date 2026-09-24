import {  } from "@gryt/ui";
import { AnimatePresence } from "motion/react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Socket } from "socket.io-client";

import type { SealDecision } from "@/common";
import { getSuppressEveryone, getUploadsFileUrl, resolveAvatarSrc, subscribeToPrefs, useTheme, useThreadMentions, useThreadUnread } from "@/common";
import { useSettings } from "@/settings";

import { PiChatCircleFill, PiChatsFill, PiCloudArrowUpFill, PiLockOpen, PiProhibitFill, PiRobotFill, PiSpeakerHighFill } from "../../../../lib/icons";
import { draftKey, returnDraft, takeReturnedDraft, useReturnedDraft } from "../hooks/returnedDrafts";
import { muteLiftsAt, useTextMute } from "../hooks/textMute";
import { useChatActions } from "../hooks/useChatActions";
import { useChatScroll } from "../hooks/useChatScroll";
import { useServerPermissions } from "../hooks/usePermissions";
import { useSockets } from "../hooks/useSockets";
import { useThreads } from "../hooks/useThreads";
import { useTypingIndicator } from "../hooks/useTypingIndicator";
import { fetchCustomEmojis, getCustomEmojis, onCustomEmojisChange, setCustomEmojis } from "../utils/emojiData";
import type { CustomEmojiEntry } from "../utils/remarkEmoji";
import { mentionsViewer } from "../utils/webhookCards";
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
import type { MentionMember } from "./MentionAutocomplete";
import { MentionViewerContext } from "./mentionViewerContext";
import { MessageKeyPrompt } from "./MessageKeyPrompt";
import { MessageRow } from "./MessageRow";
import { ThreadPanel } from "./ThreadPanel";
import { TypingIndicator } from "./TypingIndicator";

export type { AttachmentMeta, ChatMessage, Reaction } from "./chatUtils";

/** Where the composer would be, for somebody who may read a channel and not post. */
const READ_ONLY_LINE = "You can read here, but not post.";

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
  headerLead,
  headerDetail,
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
  threadBeside = false,
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
  /** Before the icon. The tiny window's direct messages put the way back to the list here. */
  headerLead?: React.ReactNode;
  /** Beside the name. A direct message puts the server it's on here. */
  headerDetail?: React.ReactNode;
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
  /** Whether an open thread shares the pane with the conversation, or takes it. */
  threadBeside?: boolean;
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

  /* thread:status:set is the author's or a moderator's. Everyone else got the
     button and a refusal, so they do not get the button (GRYT-1389). */
  const maySetThreadStatus =
    (!!currentUserId && threads.open?.thread.created_by === currentUserId) || !!canDeleteAny;

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

  /* The server deletes a root's whole thread with it, so the confirm has to
     count the replies going too rather than say "this message" (GRYT-1389). */
  const deleteReplyCount =
    pendingDeleteMessage && !pendingDeleteMessage.thread_id
      ? threads.summaries[pendingDeleteMessage.message_id]?.reply_count ?? 0
      : 0;
  const deleteDescription =
    deleteReplyCount > 0
      ? `This deletes the message and the ${deleteReplyCount} ${deleteReplyCount === 1 ? "reply" : "replies"} in its thread. You can't undo it.`
      : "This deletes the message for everyone. You can't undo it.";

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
      editorRef.current.setContent(restoreText);
      editorRef.current.focus();
      clearRestoreText?.();
    }
  }, [restoreText, clearRestoreText]);

  // A send that failed, or was called off, comes back to the box it was typed in.
  const channelDraftKey = serverHost && conversationKey ? draftKey(serverHost, conversationKey) : "";
  const channelDraft = useReturnedDraft(channelDraftKey);
  useEffect(() => {
    if (!channelDraft || !editorRef.current) return;
    const draft = takeReturnedDraft(channelDraftKey);
    if (draft) editorRef.current.restore(draft);
  }, [channelDraft, channelDraftKey]);

  const openThreadId = threads.open?.thread.thread_id;
  const threadDraftKey = serverHost && conversationKey && openThreadId ? draftKey(serverHost, conversationKey, openThreadId) : "";
  const threadDraft = useReturnedDraft(threadDraftKey);
  useEffect(() => {
    if (!threadDraft || !threadEditorRef.current) return;
    const draft = takeReturnedDraft(threadDraftKey);
    if (draft) threadEditorRef.current.restore(draft);
  }, [threadDraft, threadDraftKey]);

  /* A resize swaps this whole view out for the other layout's, and both editors
     go with it. Hand what is in them back the way a cancelled send does. */
  const stashDraftsRef = useRef<() => void>(() => {});
  stashDraftsRef.current = () => {
    const stash = (key: string, editor: ChatEditorHandle | null) => {
      const text = editor?.getMarkdown().trim() ?? "";
      const files = editor?.getFiles() ?? [];
      if (key && (text || files.length > 0)) returnDraft(key, { text, files });
    };
    stash(threadDraftKey, threadEditorRef.current);
    stash(channelDraftKey, editorRef.current);
  };
  /* A layout effect, not a passive one: React has already detached the editor's
     ref by the time a passive cleanup for a deleted tree runs. */
  useLayoutEffect(() => () => stashDraftsRef.current(), []);

  /* Escape and the × both come through here. A half-written reply waits for
     this thread instead of going with the panel (GRYT-1387). */
  const closeThread = useCallback(() => {
    const editor = threadEditorRef.current;
    const text = editor?.getMarkdown().trim() ?? "";
    const files = editor?.getFiles() ?? [];
    if (threadDraftKey && (text || files.length > 0)) {
      returnDraft(threadDraftKey, { text, files });
      editor?.clear();
    }
    threads.closeThread();
  }, [threadDraftKey, threads]);

  // ── Sender helpers ────────────────────────────────────────────
  const getSenderName = useCallback((msg: ChatMessage): string => {
    const fromList = memberList?.[msg.sender_server_id]?.nickname;
    if (fromList) return fromList;
    return msg.sender_nickname || "Unknown User";
  }, [memberList]);

  /* Their app deciding it cannot encrypt to us. We only see our own half of the
     decision, so the newest message they sent is the only evidence (GRYT-1124). */
  const peerInClear = useMemo(() => {
    if (conversationKind !== "dm" || sealing?.kind !== "seal") return null;
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const message = chatMessages[i];
      if (message.sender_server_id === currentUserId) continue;
      return message.sealed ? null : getSenderName(message);
    }
    return null;
  }, [chatMessages, conversationKind, currentUserId, getSenderName, sealing?.kind]);

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
  const { canIn, knows, roles, roleIds: myRoleIds } = useServerPermissions(serverHost || "");
  const { serverDetailsList } = useSockets();
  const suppressEveryone = useSyncExternalStore(
    subscribeToPrefs,
    () => getSuppressEveryone(serverHost || ""),
    () => getSuppressEveryone(serverHost || ""),
  );
  const mentionViewer = useMemo(() => {
    const names = new Map(
      Object.entries(serverDetailsList).map(([h, d]) => [h, new Map((d?.channels ?? []).map((c) => [c.id, c.name]))]),
    );
    return {
      host: serverHost ?? null,
      meId: currentUserId,
      roleIds: myRoleIds,
      suppressEveryone,
      massAllowed: conversationKind !== "dm",
      roles: new Map(roles.map((r) => [r.id, { name: r.name, color: r.color }])),
      channelName: (id: string, host: string | null) => names.get(host ?? serverHost ?? "")?.get(id) ?? null,
    };
  }, [serverDetailsList, serverHost, currentUserId, myRoleIds, suppressEveryone, conversationKind, roles]);

  const massViewer = mentionViewer.massAllowed ? mentionViewer : undefined;

  /* What @ and # offer. An older server has no Mention everyone, so it offers
     neither @everyone nor roles, and the server has the final say anyway. */
  const mayMentionEveryone =
    conversationKind !== "dm" && knows("mention_everyone") && canIn(conversationKey, "mention_everyone");
  const composerMentions = useMemo<MentionMember[]>(() => {
    if (conversationKind === "dm" || !knows("mention_everyone")) return mentionMembers;
    const extras: MentionMember[] = [];
    if (mayMentionEveryone) {
      extras.push(
        { kind: "everyone", nickname: "everyone", serverUserId: "@everyone", hint: "Everyone who can read this channel" },
        { kind: "here", nickname: "here", serverUserId: "@here", hint: "Everyone online right now" },
      );
    }
    for (const r of roles) {
      if (!mayMentionEveryone && !r.mentionable) continue;
      extras.push({ kind: "role", nickname: r.name, serverUserId: `role:${r.id}`, roleId: r.id, color: r.color, hint: "Role" });
    }
    return [...mentionMembers, ...extras];
  }, [conversationKind, knows, mayMentionEveryone, mentionMembers, roles]);
  const composerChannels = useMemo<MentionMember[]>(
    () =>
      (serverDetailsList[serverHost ?? ""]?.channels ?? []).map((c) => ({
        kind: "channel",
        nickname: c.name,
        serverUserId: `channel:${c.id}`,
        channelId: c.id,
      })),
    [serverDetailsList, serverHost],
  );
  // This channel's answer, or the server-wide one where the server sent none.
  const mayHere = useCallback(
    (permission: string) => canIn(conversationKey, permission),
    [canIn, conversationKey],
  );
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
          isMentioned={mentionsViewer(m, currentUserId, massViewer)}
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
      massViewer,
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

  /* A mute is the server's, not the channel's, so it covers the thread panel
     and every other conversation on the same host (GRYT-1400). */
  const textMute = useTextMute(serverHost);
  const muteLine = textMute
    ? textMute.until
      ? `You’re muted on this server until ${muteLiftsAt(textMute.until)}.`
      : "You’re muted on this server."
    : null;

  // The channel's answer alone, so an allow here works for a role that cannot
  // post elsewhere (GRYT-1418). A mute is on top, and server-wide.
  const mayPost = mayHere("send_messages");
  const maySend = mayPost && !textMute;
  const mayRead = mayHere("read_messages");

  const renderThreadComposer = useCallback(
    () => (
      <ChatEditorBar
        replyingTo={threadReplyingTo}
        editingMessage={threadEditing}
        editorRef={threadEditorRef}
        placeholder={mayPost ? "Reply to thread…" : READ_ONLY_LINE}
        disabled={!maySend}
        allowFiles={mayHere("attach_files")}
        maxFileSize={maxFileSize}
        memberList={composerMentions}
        channelList={composerChannels}
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
    [maySend, mayPost, mayHere, maxFileSize, composerMentions, composerChannels, getSenderName, threads, emitThreadTyping, emitThreadStopTyping, serverHost, threadReplyingTo, threadEditing, cancelThreadEditing, editMessage],
  );


  const editorPlaceholder =
    !canViewVoiceChannelText && isVoiceChannelTextChat
      ? "Text chat is not available in this voice channel"
      : !mayRead
        ? "This channel is not readable with your role."
      : !maySend
        ? READ_ONLY_LINE
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
    <MentionViewerContext.Provider value={mentionViewer}>
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
        {/* The conversation and the thread share this row. Beside it the panel is
            a column of its own; below the breakpoint it covers the row instead. */}
        <div className="flex h-full w-full" style={{ position: "relative" }}>
        <div className="flex min-w-0 grow flex-col p-3" style={{ position: "relative" }}>
          {channelName && (
            <div className="flex min-w-0 items-center gap-2" data-gryt="chat-header" style={{ marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid var(--gryt-neutral-6)" }}>
              {headerLead}
              {isForum ? <PiChatsFill size={18} style={{ color: "var(--gryt-neutral-11)", flexShrink: 0 }} /> : automated ? <PiRobotFill size={18} style={{ color: "var(--gryt-neutral-11)", flexShrink: 0 }} /> : channelType === "voice" && conversationKind === "channel" ? <PiSpeakerHighFill size={18} style={{ color: "var(--gryt-neutral-11)", flexShrink: 0 }} /> : <PiChatCircleFill size={18} style={{ color: "var(--gryt-neutral-11)", flexShrink: 0 }} />}
              {/* One line that gives way, or a long name pushes the buttons out of a narrow window. */}
              <span className="min-w-0 truncate text-lg font-bold" title={channelName} style={{ color: "var(--gryt-neutral-12)" }}>
                <EmojiText text={channelName} />
              </span>
              {headerDetail}
              {headerAction && <div className="shrink-0" style={{ marginLeft: "auto" }}>{headerAction}</div>}
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
              readOnlyLine={mayPost ? undefined : READ_ONLY_LINE}
            />
          ) : (
          <>
          {/* Above the messages rather than under the header, so it is the
              first thing read on the way down to the composer, and so it
              scrolls with a long conversation instead of sitting over it. */}
          {conversationKind === "dm" && <DirectMessagePrivacyNotice decision={sealing} peerInClear={peerInClear} />}
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
              <WelcomeMessage channelName={channelName} channelType={channelType} conversationKind={conversationKind} serverName={serverName} automated={automated} sealing={sealing} />
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
                  const isMentioned = mentionsViewer(m, currentUserId, massViewer);

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
                      onStartThread={conversationKind === "dm" || !mayPost ? undefined : threads.startThread}
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

          {/* Above the composer rather than a toast: it has to still be on screen
              when somebody comes back to a box that stopped taking input. */}
          {muteLine && (
            <div
              aria-live="polite"
              className="mb-1.5 flex items-start gap-1.5 px-1 text-xs leading-snug"
              style={{ color: "var(--gryt-neutral-11)" }}
            >
              <PiProhibitFill aria-hidden="true" size={13} style={{ flexShrink: 0, marginTop: "1px" }} />
              <span>{muteLine}</span>
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
            memberList={composerMentions}
            channelList={composerChannels}
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
          </div>
          {threads.open && (
            <ThreadPanel
              beside={threadBeside}
              thread={threads.open.thread}
              root={threads.open.root}
              messages={visibleThreadMessages}
              loading={threads.open.loading}
              renderMessage={renderThreadMessage}
              renderComposer={renderThreadComposer}
              hasOlder={threads.open.hasOlder}
              loadingOlder={threads.open.loadingOlder}
              onLoadOlder={threads.loadOlder}
              error={threads.open.error}
              onRetry={threads.retryFetch}
              onClose={closeThread}
              onSetStatus={maySetThreadStatus ? threads.setStatus : undefined}
              typingIndicator={
                <TypingIndicator typingUsers={threadTypingUsers} serverHost={serverHost} />
              }
              forumTags={forumTags ?? []}
              onSetTags={maySetThreadStatus ? threads.setTags : undefined}
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
        description={deleteDescription}
        confirmLabel="Delete"
        onConfirm={confirmDelete}
      />
    </MentionViewerContext.Provider>
  );
});

ChatView.displayName = "ChatView";
