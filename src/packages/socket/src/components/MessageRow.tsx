import { Avatar, Popover, Tooltip } from "@gryt/ui";
import { AnimatePresence, motion } from "motion/react";
import { type CSSProperties, forwardRef, memo, useCallback, useLayoutEffect, useRef, useState } from "react";

import { type MessageStyle, useTheme } from "@/common";

import { PiChatsFill, PiLockOpen, PiPushPinFill, PiSignInBold, PiSignOutBold } from "../../../../lib/icons";
import { useServerPermissions } from "../hooks/usePermissions";
import type { ThreadSummary } from "../hooks/useThreads";
import { getFrequentReactions } from "../utils/recentReactions";
import type { CustomEmojiEntry } from "../utils/remarkEmoji";
import { sealedPlaceholder } from "../utils/sealedText";
import { drawsMessageText, isUnknownKind, unknownKindNotice } from "../utils/webhookCards";
import { AttachmentGrid } from "./AttachmentGrid";
import { isFileCard, isGridImage } from "./attachmentKinds";
import { BotTag } from "./BotTag";
import { MessageHoverToolbar } from "./ChatMessage";
import type { ChatMessage, Reaction } from "./chatUtils";
import { DateSeparator, MessageTimestamp, NewMessagesDivider, toDate } from "./chatUtils";
import { CollapsibleText } from "./CollapsibleText";
import { EmojiPicker } from "./EmojiPicker";
import { EmojiText } from "./EmojiText";
import { type LightboxGallery } from "./ImageLightbox";
import { galleryOf } from "./lightboxGallery";
import { MessageEmbeds } from "./LinkEmbed";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { type MessageActions, MessageContextMenu } from "./MediaContextMenu";
import { MEMBER_CARD_POPUP } from "./memberCard/memberCardContext";
import { MemberIdentityCard } from "./MemberIdentityCard";
import type { MemberInfo } from "./MemberSidebar";
import { MessageAttachment } from "./MessageAttachment";
import { MessageCards } from "./MessageCards";
import { NameTag } from "./NameTag";
import { PollCard } from "./PollCard";
import { ReplyPreviewText } from "./ReplyPreviewText";
import { UnreadIndicator } from "./UnreadIndicator";

export interface MessageMeta {
  isFirstInGroup: boolean;
  dayBreak: Date | null;
  showNewMessageDivider: boolean;
  senderName: string;
  avatarUrl: string | undefined;
  isSelf: boolean;
  isFirstEdited: boolean;
  isSystem: boolean;
  /** Which way the arrow points on a system event row. */
  systemEvent?: "joined" | "left";
  isWebhook: boolean;
  /** Whether a bot wrote it. Server-derived; see BotTag. */
  isBot?: boolean;
  /**
   * The member row behind the message, when the sender is still in the list.
   * Absent for system messages, webhooks, and anyone who has left (GRYT-203).
   */
  sender?: MemberInfo;
  /**
   * The colour this sender's role draws names in, already made readable against
   * the current theme. Undefined when the role sets no colour.
   */
  roleColor?: string;
  /**
   * Set when somebody else here uses the same name: the start of their fingerprint,
   * so two Golds read as two people (GRYT-1674).
   */
  nameTag?: string;
}

interface MessageRowProps {
  message: ChatMessage;
  meta: MessageMeta;
  replyPreviewText: string | null;
  isMentioned: boolean;
  customEmojiList: CustomEmojiEntry[];
  memberNicknames: string[];
  blurProfanity: boolean;
  smileyConversion: boolean;
  disabledSmileys: ReadonlySet<string>;
  serverHost: string | undefined;
  currentUserId: string | undefined;
  currentUserNickname: string | undefined;
  canDeleteAny: boolean;
  chatMediaVolume: number;
  memberList?: Record<string, MemberInfo>;
  setChatMediaVolume: (v: number) => void;
  onReaction: (src: string, msg: ChatMessage) => void;
  onReply: (msg: ChatMessage) => void;
  onEdit: (msg: ChatMessage) => void;
  onReport: (msg: ChatMessage) => void;
  onDelete: (msg: ChatMessage) => void;
  scrollToMessage: (messageId: string) => void;
  /** With a gallery when it came from this message's pictures, so the lightbox steps through them. */
  onLightboxOpen: (src: string, alt?: string, gallery?: LightboxGallery) => void;
  /** This message's thread, if it has one — draws the "N replies" line. GRYT-981. */
  threadSummary?: ThreadSummary;
  /** This message went out in the clear (GRYT-729). */
  unencrypted?: boolean;
  /** Start a thread from this message. Absent in DMs and on pending rows. */
  onStartThread?: (msg: ChatMessage) => void;
  /** Open an existing thread by its root message id. */
  onOpenThread?: (rootMessageId: string) => void;
  /**
   * Unread replies in this message's thread, and how many named you. Counted in
   * ChatView: a store hook here would re-render every row on any thread's change.
   */
  threadUnread?: number;
  threadMentions?: number;
  isNew?: boolean;
  /** The server takes the reporter's copy of an MLS message (decision 11). */
  mlsReports?: boolean;
  /** Pinned now, live pins included. GRYT-1619. */
  pinned?: boolean;
  /** Absent when this person may not pin here. */
  onTogglePin?: (msg: ChatMessage, pinned: boolean) => void;
}

export const MessageRow = memo(forwardRef<HTMLDivElement, MessageRowProps>(({
  message: m,
  meta,
  replyPreviewText,
  isMentioned,
  customEmojiList,
  memberNicknames,
  blurProfanity,
  smileyConversion,
  disabledSmileys,
  serverHost,
  currentUserId,
  currentUserNickname,
  canDeleteAny,
  chatMediaVolume,
  memberList,
  setChatMediaVolume,
  onReaction,
  onReply,
  onEdit,
  onReport,
  onDelete,
  scrollToMessage,
  onLightboxOpen,
  threadSummary,
  unencrypted,
  onStartThread,
  onOpenThread,
  threadUnread,
  threadMentions,
  isNew,
  mlsReports,
  pinned,
  onTogglePin,
}, forwardedRef) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isCtxMenuOpen, setIsCtxMenuOpen] = useState(false);
  const [isReactionPickerOpen, setIsReactionPickerOpen] = useState(false);
  const [pickerPlacement, setPickerPlacement] = useState<"above" | "beside">("above");
  const [cardOpen, setCardOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pickerAnchorRef = useRef<HTMLElement | null>(null);

  const { canIn } = useServerPermissions(serverHost || "");
  // Asked of the message's channel, which is where the server asks it too.
  const can = (permission: string) => canIn(m.conversation_id, permission);
  // Opened from one of this message's files, the lightbox gets all of its pictures and videos.
  const openLightbox = useCallback((src: string, alt?: string, fileId?: string) => {
    const items = galleryOf(m, serverHost);
    const index = fileId ? items.findIndex((it) => it.fileId === fileId) : -1;
    if (index < 0) { onLightboxOpen(src, alt); return; }
    const when = toDate(m.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    onLightboxOpen(src, alt, { items, index, title: { name: meta.senderName, detail: when } });
  }, [m, serverHost, onLightboxOpen, meta.senderName]);
  const isOwnMessage = !!currentUserId && m.sender_server_id === currentUserId;
  const { messageStyle: look, ownMessageSide } = useTheme();
  const alignRight = isOwnMessage && ownMessageSide === "right" && !meta.isSystem;

  // Editing and deleting your own message each have a permission, so a role can
  // post and not revise. `canDeleteAny` is worked out where the server is known.
  const mls = !!m.mls;
  // The server has no copy of an MLS message, so deletes and reactions go over MLS (GRYT-1524).
  const sentOverMls = mls && !m.pending && !m.failed;
  const canDelete = mls ? isOwnMessage && sentOverMls : !!canDeleteAny || (isOwnMessage && can("delete_own_messages"));
  const canEdit = isOwnMessage && !!m.text && can("edit_own_messages") && !(mls && (m.pending || m.failed));
  // Your own copy of somebody else's message, once the server takes one (GRYT-1557).
  const canReport = mls ? !!mlsReports && !isOwnMessage && sentOverMls && can("report_messages") : can("report_messages");
  const canReact = (!mls || sentOverMls) && can("add_reactions");
  // Off in encrypted conversations for now: fetching one tells the server the link (decision 13).
  const showsPreviews = !mls && can("use_link_previews");

  const bgColor = (isHovered || isReactionPickerOpen || isCtxMenuOpen)
    ? "var(--gryt-neutral-4)"
    : isMentioned ? "var(--gryt-accent-a3)" : "transparent";

  const messageActions: MessageActions = {
    messageText: m.text,
    onReply: () => onReply(m),
    onEdit: canEdit ? () => onEdit(m) : undefined,
    onReport: canReport ? () => onReport(m) : undefined,
    onDelete: canDelete ? () => onDelete(m) : undefined,
    canEdit,
    canDelete,
    onOpenThread: threadSummary && onOpenThread ? () => onOpenThread(m.message_id) : undefined,
    onStartThread: !threadSummary && onStartThread && !m.pending && !m.failed ? () => onStartThread(m) : undefined,
    replyCount: threadSummary?.reply_count,
    unreadCount: threadUnread,
    // The server has no copy of an MLS message to mark.
    onTogglePin: onTogglePin && !mls && !m.pending && !m.failed ? () => onTogglePin(m, !pinned) : undefined,
    pinned,
  };

  /**
   * A system row's menu: Delete, and nothing else. Not `messageActions` — a join
   * line has no author, and reacting to one is what GRYT-896 removed (GRYT-908).
   */
  const systemActions: MessageActions | undefined = canDeleteAny
    ? { onDelete: () => onDelete(m), canDelete: true }
    : undefined;

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  const handleCtxMenuOpenChange = useCallback((open: boolean) => {
    setIsCtxMenuOpen(open);
  }, []);

  const handleOpenReactionPicker = useCallback((anchorEl?: HTMLElement) => {
    if (anchorEl) {
      pickerAnchorRef.current = anchorEl;
      setPickerPlacement("beside");
    } else {
      pickerAnchorRef.current = rowRef.current;
      setPickerPlacement("above");
    }
    setIsReactionPickerOpen(true);
  }, []);

  const handleReactionPickerSelect = useCallback((src: string) => {
    onReaction(src, m);
    setIsReactionPickerOpen(false);
  }, [onReaction, m]);

  const handleReactionPickerClose = useCallback(() => {
    setIsReactionPickerOpen(false);
  }, []);

  const showToolbar = isHovered && !isCtxMenuOpen && !isReactionPickerOpen;

  // The ⋯ opens the same menu a right-click does, so there is one list of actions.
  const handleMore = useCallback((anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect();
    anchor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left, clientY: r.bottom }));
  }, []);

  /*
   * The four this person reaches for most, read while the toolbar is going up.
   * Read on hover rather than held in state, so it is current without being told.
   */
  const quickReactions = showToolbar && canReact
    ? getFrequentReactions(4, serverHost)
    : undefined;

  const highlighted = isHovered || isReactionPickerOpen || isCtxMenuOpen;
  const nameColor = meta.roleColor ?? (meta.isSelf ? "var(--gryt-accent-11)" : "var(--gryt-neutral-12)");
  // Bubbles hug their text, so the column lines them up on the side they belong to.
  const bubbleAlign = look === "bubbles" ? (alignRight ? "flex-end" : "flex-start") : undefined;

  const avatarNode = (
    <>
            {/* The same card the member sidebar shows, on the avatar in the
                flow. A message is where an impersonation is most convincing
                and least checkable, and where nobody is going to open the
                member list to compare fingerprints (GRYT-203). */}
            {meta.sender ? (
              <Popover.Root open={cardOpen} onOpenChange={(open) => setCardOpen(open)}>
                <Popover.Trigger
                  render={<button type="button" aria-label="Open card" className="mt-0.5 shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0" />}
                >
                  <Avatar
                    size="large"
                    className="h-[51px] w-[51px] shrink-0 text-lg"
                    fallback={meta.senderName[0]}
                    src={meta.avatarUrl}
                  />
                </Popover.Trigger>
                {cardOpen && (
                  <Popover.Portal>
                    <Popover.Positioner side="right" align="start">
                      <Popover.Popup className={MEMBER_CARD_POPUP}>
                        <MemberIdentityCard member={meta.sender} serverHost={serverHost} />
                      </Popover.Popup>
                    </Popover.Positioner>
                  </Popover.Portal>
                )}
              </Popover.Root>
            ) : (
              <Avatar
                size="large"
                className="mt-0.5 h-[51px] w-[51px] shrink-0 text-lg"
                fallback={meta.senderName[0]}
                src={meta.avatarUrl}
              />
            )}
    </>
  );

  const nameLineNode = (
              <div className="flex items-baseline gap-2" style={{ marginBottom: 2, justifyContent: alignRight ? "flex-end" : undefined }}>
                {/* Role colour first, so a name reads the same here as it does
                    in the member sidebar. It applies to your own messages too:
                    the sidebar colours you by role like everybody else, and
                    keeping the accent here would make your own name the one
                    that disagrees.

                    The old accent-for-self and neutral-for-everyone-else stay
                    as the fallback, for a role with no colour set — which is
                    every role until somebody picks one, so on most servers
                    nothing changes until they do. */}
                <span
                  className="text-sm font-bold"
                  style={{ color: meta.roleColor ?? (meta.isSelf ? "var(--gryt-accent-11)" : "var(--gryt-neutral-12)") }}
                >
                  {meta.senderName}
                </span>
                <NameTag tag={meta.nameTag} />
                {meta.isBot && <BotTag />}
                {meta.isWebhook && (
                  <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "0 5px",
                    height: 16,
                    fontSize: 10,
                    fontWeight: 600,
                    lineHeight: 1,
                    borderRadius: "var(--gryt-radius-sm)",
                    background: "var(--gryt-accent-9)",
                    color: "var(--gryt-neutral-1)",
                    letterSpacing: "0.02em",
                    userSelect: "none",
                    flexShrink: 0,
                  }}>
                    BOT
                  </span>
                )}
                <MessageTimestamp date={toDate(m.created_at)} />
                {meta.isFirstEdited && (
                  <Tooltip title={`Edited ${new Date(m.edited_at!).toLocaleString()}`}>
                    <span style={{ fontSize: 10, cursor: "default", whiteSpace: "nowrap", userSelect: "none", color: "var(--gryt-neutral-8)" }}>
                      (edited)
                    </span>
                  </Tooltip>
                )}
              </div>
  );

  const contentNode = (
              <MessageContent
                quickReactions={quickReactions}
                m={m}
                rowRef={rowRef}
                bgColor={bgColor}
                showToolbar={showToolbar}
                customEmojiList={customEmojiList}
                memberNicknames={memberNicknames}
                blurProfanity={blurProfanity}
                smileyConversion={smileyConversion}
                disabledSmileys={disabledSmileys}
                serverHost={serverHost}
                currentUserId={currentUserId}
                currentUserNickname={currentUserNickname}
                memberList={memberList}
                chatMediaVolume={chatMediaVolume}
                setChatMediaVolume={setChatMediaVolume}
                replyPreviewText={replyPreviewText}
                isFirstInGroup={meta.isFirstInGroup}
                look={look}
                alignRight={alignRight}
                own={isOwnMessage}
                highlighted={highlighted}
                onMore={handleMore}
                messageActions={messageActions}
                threadUnread={threadUnread}
                threadMentions={threadMentions}
                onReaction={onReaction}
                onReply={onReply}
                scrollToMessage={scrollToMessage}
                onLightboxOpen={openLightbox}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onOpenReactionPicker={handleOpenReactionPicker}
                unencrypted={unencrypted}
                canReact={canReact}
                showsPreviews={showsPreviews}
              />
  );

  const content = (
    <>
      {meta.showNewMessageDivider && <NewMessagesDivider />}
      {meta.dayBreak && <DateSeparator date={meta.dayBreak} />}

      {meta.isSystem ? (
        /* An event, not a message: one quiet row keeping the left edge every
           message shares, and a right-click carrying Delete only (GRYT-896, GRYT-908). */
        <MessageContextMenu messageActions={systemActions} onOpenChange={handleCtxMenuOpenChange}>
        <div
          className="flex gap-3 items-baseline"
          ref={rowRef}
          data-message-id={m.message_id}
          style={{ width: "100%", padding: "3px 6px", marginTop: 4 }}
        >
          <span
            className="flex shrink-0 justify-center"
            style={{ width: 51, color: "var(--gryt-neutral-9)", position: "relative", top: 2 }}
            aria-hidden="true"
          >
            {meta.systemEvent === "left" ? <PiSignOutBold size={13} /> : <PiSignInBold size={13} />}
          </span>

          {/* A row rather than a span, because MarkdownRenderer emits a block
              and the time would otherwise drop to a line of its own — which is
              a second line for four words, and the thing this treatment exists
              to stop. Baseline-aligned so the small time sits on the text's
              baseline rather than the box's. */}
          <span
            className="flex flex-wrap items-baseline gap-2 text-sm"
            style={{ flex: 1, minWidth: 0, color: "var(--gryt-neutral-11)", wordBreak: "break-word" }}
          >
            <span style={{ minWidth: 0 }}>
              <MarkdownRenderer
                content={m.text}
                memberNicknames={memberNicknames}
                mentionMembersById={memberList}
                serverHost={serverHost}
              />
            </span>
            <span className="text-xs" style={{ opacity: 0.75 }}>
              <MessageTimestamp date={toDate(m.created_at)} />
            </span>
          </span>
        </div>
        </MessageContextMenu>
      ) : look === "compact" ? (
        <MessageContextMenu messageActions={messageActions} onOpenChange={handleCtxMenuOpenChange} onReaction={canReact ? (src) => onReaction(src, m) : undefined} serverHost={serverHost}>
          {/* Lined up on the text, or on the top when there's no text, like pictures or a card. */}
          <div className="flex" style={{ width: "100%", gap: 8, marginTop: meta.isFirstInGroup ? 6 : 0, flexDirection: alignRight ? "row-reverse" : "row", alignItems: m.text && drawsMessageText(m) ? "baseline" : "flex-start" }}>
            {/* The clock time, on hover only: "4 days ago" ran into the name. The column keeps names lined up. */}
            <span title={toDate(m.created_at).toLocaleString()} style={{ width: 44, flex: "none", fontSize: 11, color: "var(--gryt-neutral-9)", textAlign: alignRight ? "left" : "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", visibility: highlighted ? "visible" : "hidden" }}>
              {toDate(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="text-sm font-bold" style={{ flex: "none", color: nameColor }}>{meta.senderName}</span>
            {meta.isBot && <BotTag />}
            <div className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
              {contentNode}
            </div>
          </div>
        </MessageContextMenu>
      ) : meta.isFirstInGroup ? (
        <MessageContextMenu messageActions={messageActions} onOpenChange={handleCtxMenuOpenChange} onReaction={canReact ? (src) => onReaction(src, m) : undefined} serverHost={serverHost}>
          <div className="flex gap-3 items-start" style={{ width: "100%", marginTop: look === "bubbles" ? 14 : 12, flexDirection: alignRight ? "row-reverse" : "row" }}>
            {!(look === "bubbles" && alignRight) && avatarNode}
            <div className="flex flex-col" style={{ flex: 1, minWidth: 0, alignItems: bubbleAlign }}>
              {nameLineNode}
              {contentNode}
            </div>
          </div>
        </MessageContextMenu>
      ) : (
        <MessageContextMenu messageActions={messageActions} onOpenChange={handleCtxMenuOpenChange} onReaction={canReact ? (src) => onReaction(src, m) : undefined} serverHost={serverHost}>
          <div className="flex" style={{ width: "100%", marginTop: look === "bubbles" ? 4 : 0, ...(alignRight ? { paddingRight: look === "bubbles" ? 0 : 63 } : { paddingLeft: 63 }) }}>
            <div className="flex flex-col" style={{ flex: 1, minWidth: 0, alignItems: bubbleAlign }}>
              {contentNode}
            </div>
          </div>
        </MessageContextMenu>
      )}
    </>
  );

  const mergedRef = useCallback((node: HTMLDivElement | null) => {
    (wrapperRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }, [forwardedRef]);

  return (
    /* Full height from the first frame, fading and sliding in on the compositor. Growing from 0
       left the bottom pin aiming short of a tall message, and layout springs re-measured every row. */
    <div ref={mergedRef} className={isNew ? "gryt-message-enter" : undefined} style={{ width: "100%", paddingRight: 14 }}>
      {content}
      {isReactionPickerOpen && (
        <EmojiPicker
          onSelect={handleReactionPickerSelect}
          onClose={handleReactionPickerClose}
          anchorEl={pickerAnchorRef.current}
          placement={pickerPlacement}
          serverHost={serverHost}
        />
      )}
    </div>
  );
}));

MessageRow.displayName = "MessageRow";

function MessageContent({
  m,
  rowRef,
  bgColor,
  showToolbar,
  quickReactions,
  customEmojiList,
  memberNicknames,
  blurProfanity,
  smileyConversion,
  disabledSmileys,
  serverHost,
  currentUserId,
  currentUserNickname,
  memberList,
  chatMediaVolume,
  setChatMediaVolume,
  replyPreviewText,
  isFirstInGroup,
  messageActions,
  onReaction,
  onReply,
  scrollToMessage,
  onLightboxOpen,
  onMouseEnter,
  onMouseLeave,
  onOpenReactionPicker,
  unencrypted,
  canReact,
  showsPreviews,
  threadUnread,
  threadMentions,
  look,
  alignRight,
  own,
  highlighted,
  onMore,
}: {
  m: ChatMessage;
  rowRef: React.RefObject<HTMLDivElement | null>;
  look: MessageStyle;
  /** Your own message, drawn on the right. */
  alignRight: boolean;
  own: boolean;
  /** Hovered, or its menu or picker open. Bubbles show it on the bubble rather than the row. */
  highlighted: boolean;
  onMore: (anchor: HTMLElement) => void;
  bgColor: string;
  showToolbar: boolean;
  /** The reactions this person uses most, for the hover bar. */
  quickReactions?: string[];
  customEmojiList: CustomEmojiEntry[];
  memberNicknames: string[];
  blurProfanity: boolean;
  smileyConversion: boolean;
  disabledSmileys: ReadonlySet<string>;
  serverHost: string | undefined;
  currentUserId: string | undefined;
  currentUserNickname: string | undefined;
  memberList?: Record<string, MemberInfo>;
  chatMediaVolume: number;
  setChatMediaVolume: (v: number) => void;
  replyPreviewText: string | null;
  isFirstInGroup: boolean;
  messageActions: MessageActions;
  onReaction: (src: string, msg: ChatMessage) => void;
  onReply: (msg: ChatMessage) => void;
  scrollToMessage: (messageId: string) => void;
  onLightboxOpen: (src: string, alt?: string, fileId?: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onOpenReactionPicker: (anchorEl?: HTMLElement) => void;
  /** Went out in the clear. */
  unencrypted?: boolean;
  /** Whether this member may react in this message's channel. */
  canReact: boolean;
  /** Off where the channel denies `use_link_previews`: the embeds are not fetched. */
  showsPreviews: boolean;
  /** Unread replies in this message's thread, and how many named you. */
  threadUnread?: number;
  threadMentions?: number;
}) {
  const hasReactions = !!(m.reactions && m.reactions.length > 0);
  const hasThreadNews = (threadUnread ?? 0) > 0 || (threadMentions ?? 0) > 0;
  const sealedNote = sealedPlaceholder(m);
  const drawsText = drawsMessageText(m);
  // For tests and tools: a row the server has not confirmed says why.
  const sendState = m.failed ? "failed" : m.waiting && m.pending ? "waiting" : m.pending ? "pending" : undefined;
  const bubble = look === "bubbles";
  const barRef = useRef<HTMLDivElement>(null);
  const [barStyle, setBarStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!showToolbar) return;
    const width = barRef.current?.offsetWidth || 200;
    setBarStyle(hoverBarPlacement(alignRight, rowRef.current, width));
  }, [showToolbar, alignRight, rowRef]);
  const bubbleBackground = own
    ? (highlighted ? "var(--gryt-accent-5)" : "var(--gryt-accent-4)")
    : (highlighted ? "var(--gryt-neutral-5)" : "var(--gryt-neutral-4)");
  return (
    <motion.div
      // Reactions already there on open are just there: growing in pushed the chat off the bottom.
      initial={false}
      animate={{ marginBottom: hasReactions ? 30 : 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      style={{
        margin: bubble ? "0 -6px" : "0 -8px",
        display: "flex", flexDirection: "column", alignItems: alignRight ? "flex-end" : "flex-start", alignSelf: "stretch",
      }}
    >
    {/* Hover is on the highlighted part only, so the bar doesn't open from the empty space beside a message. */}
    <div className="flex flex-col" ref={rowRef} data-message-id={m.message_id} data-send-state={sendState}
      onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={{
        /* Inset so the row does not shift by two pixels depending on it. */
        boxShadow: unencrypted ? "inset 2px 0 0 var(--gryt-danger-9)" : undefined,
        // Even padding, and a radius of a picture's plus that padding, so the edge round one reads as one stroke.
        padding: bubble ? 10 : 8,
        cursor: "default",
        position: "relative",
        textAlign: alignRight && !bubble ? "right" : undefined,
        width: "fit-content",
        transition: "background 0.15s",
        /* The highlight hugs the text, and so does the hover. */
        ...(bubble ? {
          maxWidth: "min(680px, 85%)",
          margin: "0 6px",
          borderRadius: "calc(var(--gryt-radius-md) + 10px)",
          background: bubbleBackground,
        } : {
          maxWidth: "100%",
          // The extra 2px of padding above and below doesn't spread the chat out.
          margin: "-2px 0",
          borderRadius: "calc(var(--gryt-radius-md) + 8px)",
          background: bgColor,
        }),
      }}>
      <AnimatePresence>
        {showToolbar && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 4 }}
            transition={{ type: "spring", stiffness: 500, damping: 25 }}
            ref={barRef}
            style={{ position: "absolute", zIndex: 10, ...barStyle }}
          >
            {/* onOpenEmojiPicker follows quickReactions rather than a
                permission of its own: that list is undefined for somebody who
                may not react, so the button goes with it. */}
            <MessageHoverToolbar
              quickReactions={quickReactions}
              onQuickReaction={(src) => onReaction(src, m)}
              onOpenEmojiPicker={quickReactions ? () => onOpenReactionPicker() : undefined}
              onReply={() => onReply(m)}
              onMore={onMore}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {m.reply_to_message_id && (
        <div
          onClick={() => scrollToMessage(m.reply_to_message_id!)}
          style={{
            borderLeft: "2px solid var(--gryt-accent-8)",
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
          <span className="text-xs">{replyPreviewText ? <ReplyPreviewText text={replyPreviewText} /> : "Original message"}</span>
        </div>
      )}
      <motion.div
        animate={{ opacity: m.pending ? 0.6 : m.failed ? 0.5 : 1 }}
        transition={{ duration: 0.2 }}
        className="message-body"
        style={{ wordBreak: "break-word" }}
      >
        {/* Only the text folds. Attachments and embeds below carry their own
            sizing, and folding them too would hide an image behind a control
            that says "show full message". */}
        {unencrypted && (
          <span
            title="Sent without encryption. Whoever runs this server can read it in the clear."
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              marginRight: 6,
              verticalAlign: "middle",
              color: "var(--gryt-danger-11)",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.03em",
            }}
          >
            <PiLockOpen aria-hidden="true" size={11} />
            Not encrypted
          </span>
        )}
        {sealedNote ? (
          /* An envelope this client has not opened has no words to draw. Plain
             rather than through markdown: it must not be parsed or linkified. */
          <span style={{ color: "var(--gryt-neutral-8)", fontStyle: "italic" }}>
            {sealedNote}
          </span>
        ) : (
          // No empty text box above a picture, or it pushes the picture off its corner.
          drawsText && !!m.text?.trim() && (
            <CollapsibleText>
              <div>
              <MarkdownRenderer
                content={m.text}
                customEmojis={customEmojiList}
                memberNicknames={memberNicknames}
                mentionMembersById={memberList}
                serverHost={serverHost}
                profanityMatches={m.profanity_matches}
                blurProfanity={blurProfanity}
                smileyConversion={smileyConversion}
                disabledSmileys={disabledSmileys}
              />
              </div>
            </CollapsibleText>
          )
        )}
        {messageActions.pinned && (
          <span className="flex items-center gap-1" style={{ fontSize: 10, userSelect: "none", color: "var(--gryt-neutral-9)" }}>
            <PiPushPinFill size={10} />
            pinned
          </span>
        )}
        {m.edited_at && !isFirstInGroup && (
          <Tooltip title={`Edited ${new Date(m.edited_at).toLocaleString()}`}>
            <span style={{ fontSize: 10, cursor: "default", whiteSpace: "nowrap", userSelect: "none", color: "var(--gryt-neutral-8)" }}>
              (edited)
            </span>
          </Tooltip>
        )}
        {serverHost && !m.pending && showsPreviews && drawsText && (
          <MessageEmbeds messageId={m.message_id} text={m.text} serverHost={serverHost} />
        )}
        {m.attachments && m.attachments.length > 0 && serverHost && (() => {
          /* Two or more pictures go in a grid, and plain files two to a row (GRYT-1722 draft).
             Media keeps its own player. The order is the order they were sent in. */
          const all = m.attachments.map((fileId, i) => ({ fileId, meta: m.enriched_attachments?.[i] }));
          const images = all.filter((a) => isGridImage(a.meta));
          const grid = images.length >= 2;
          const files = all.filter((a) => isFileCard(a.meta));
          const rest = all.filter((a) => !(grid && isGridImage(a.meta)) && !(files.length >= 2 && isFileCard(a.meta)));
          const one = (a: (typeof all)[number]) => (
            <MessageAttachment
              key={a.fileId}
              fileId={a.fileId}
              meta={a.meta}
              serverHost={serverHost}
              messageActions={messageActions}
              onLightboxOpen={onLightboxOpen}
              chatMediaVolume={chatMediaVolume}
              setChatMediaVolume={setChatMediaVolume}
            />
          );
          return (
            <div className="flex gap-2 flex-col" style={{ marginTop: "4px" }}>
              {grid && <AttachmentGrid images={images} serverHost={serverHost} messageActions={messageActions} onLightboxOpen={onLightboxOpen} />}
              {rest.map(one)}
              {files.length >= 2 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, width: 420, maxWidth: "100%" }}>
                  {files.map(one)}
                </div>
              )}
            </div>
          );
        })()}
        {isUnknownKind(m) && (
          <div className="text-sm" style={{ marginTop: 4, padding: "8px 12px", borderRadius: "var(--gryt-radius-md)", border: "1px dashed var(--gryt-neutral-6)", color: "var(--gryt-neutral-11)" }}>
            {unknownKindNotice(m.kind ?? "")}
          </div>
        )}
        {m.poll && !isUnknownKind(m) && (
          <PollCard
            poll={m.poll}
            conversationId={m.conversation_id}
            messageId={m.message_id}
            serverHost={serverHost}
            currentUserId={currentUserId}
            memberList={memberList}
          />
        )}
        {m.cards && m.cards.length > 0 && serverHost && (
          <MessageCards
            cards={m.cards}
            serverHost={serverHost}
            customEmojiList={customEmojiList}
            memberNicknames={memberNicknames}
            memberList={memberList}
            smileyConversion={smileyConversion}
            disabledSmileys={disabledSmileys}
            onLightboxOpen={onLightboxOpen}
          />
        )}
        {m.failed && (
          <span className="text-xs" style={{ color: "var(--gryt-danger-9)", marginTop: "2px" }}>
            {m.failure ?? "Failed to send"}
          </span>
        )}
        {m.pending && m.waiting && (
          <span className="text-xs" style={{ color: "var(--gryt-neutral-9)", marginTop: "2px" }}>
            Waiting for the server
          </span>
        )}
      </motion.div>
      {messageActions.onOpenThread && (
        <button
          onClick={messageActions.onOpenThread}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, marginTop: 4, alignSelf: alignRight ? "flex-end" : "flex-start",
            userSelect: "none",
            background: "none", border: "none", cursor: "pointer", padding: "3px 7px",
            borderRadius: "var(--gryt-radius-sm)",
            /* Accent only when there is something to read. Accent either way drew
               fifteen lines in a channel with fifteen threads (GRYT-1026). */
            color: hasThreadNews ? "var(--gryt-accent-11)" : "var(--gryt-neutral-11)",
            fontSize: 12.5, fontWeight: 700,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gryt-neutral-4)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        >
          <PiChatsFill size={14} />
          {messageActions.replyCount ?? 0} {(messageActions.replyCount ?? 0) === 1 ? "reply" : "replies"}
          {/* The same badge a forum topic row draws, for the same reason. A
              thread on a text channel had the counts and nowhere to put them:
              the reply count says how big the thread is, not whether any of it
              is new, so a reply naming you badged the channel and then left you
              opening threads to find it (GRYT-1019). */}
          <UnreadIndicator unread={threadUnread ?? 0} mentions={threadMentions ?? 0} />
        </button>
      )}
      <ReactionBadges
        reactions={m.reactions}
        currentUserId={currentUserId}
        currentUserNickname={currentUserNickname}
        memberList={memberList}
        onReaction={canReact ? (src) => onReaction(src, m) : undefined}
        onOpenPicker={onOpenReactionPicker}
        alignRight={alignRight}
      />
    </div>
    </motion.div>
  );
}

function ReactionBadges({
  reactions,
  currentUserId,
  currentUserNickname,
  memberList,
  onReaction,
  onOpenPicker,
  alignRight,
}: {
  reactions: Reaction[] | null | undefined;
  currentUserId: string | undefined;
  currentUserNickname: string | undefined;
  memberList?: Record<string, MemberInfo>;
  /** Absent where this member may not react: the counts show, and nothing is pressable. */
  onReaction?: (src: string) => void;
  onOpenPicker: (anchorEl?: HTMLElement) => void;
  alignRight?: boolean;
}) {
  const hasReactions = reactions && reactions.length > 0;
  if (!hasReactions) return null;

  return (
    /* Not part of the message, so not part of a copy of it. A drag across rows
       came out with the counts interleaved with what people said. */
    <div className="flex flex-wrap items-center" style={{
      userSelect: "none",
      position: "absolute",
      bottom: 0,
      ...(alignRight ? { right: "6px" } : { left: "6px" }),
      transform: "translateY(100%)",
      gap: "4px",
      zIndex: 1,
      width: "max-content",
    }}>
      <AnimatePresence mode="popLayout" initial={false}>
        {reactions.map((reaction, rIdx) => {
          const isMine = !!(currentUserId && reaction.users.includes(currentUserId));
          const emojiId = reaction.src;
          const usersLabel = reaction.users
            .map((uid) => {
              if (currentUserId && uid === currentUserId) return currentUserNickname || "You";
              const member = memberList && Object.values(memberList).find((mb) => mb.serverUserId === uid);
              return member?.nickname || uid;
            })
            .join(", ");
          return (
            <motion.div
              key={`${reaction.src}-${rIdx}`}
              layout
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ type: "spring", stiffness: 500, damping: 25 }}
            >
              <Tooltip
                title={(
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontWeight: 600 }}>{emojiId}</div>
                    <div style={{ opacity: 0.9 }}>{usersLabel}</div>
                  </div>
                )}
              >
                <button
                  onClick={onReaction ? () => onReaction(reaction.src) : undefined}
                  aria-disabled={!onReaction || undefined}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "3px 8px",
                    minHeight: "28px",
                    fontSize: "14px",
                    lineHeight: 1,
                    background: isMine ? "var(--gryt-accent-3)" : "var(--gryt-neutral-3)",
                    border: `1px solid ${isMine ? "var(--gryt-accent-7)" : "var(--gryt-neutral-5)"}`,
                    borderRadius: "var(--gryt-radius-md)",
                    cursor: onReaction ? "pointer" : "default",
                    transition: "background 0.15s, border-color 0.15s",
                    whiteSpace: "nowrap",
                    color: isMine ? "var(--gryt-accent-11)" : "var(--gryt-neutral-12)",
                  }}
                  onMouseEnter={onReaction ? (e) => { e.currentTarget.style.background = isMine ? "var(--gryt-accent-4)" : "var(--gryt-neutral-4)"; e.currentTarget.style.borderColor = isMine ? "var(--gryt-accent-8)" : "var(--gryt-neutral-6)"; } : undefined}
                  onMouseLeave={onReaction ? (e) => { e.currentTarget.style.background = isMine ? "var(--gryt-accent-3)" : "var(--gryt-neutral-3)"; e.currentTarget.style.borderColor = isMine ? "var(--gryt-accent-7)" : "var(--gryt-neutral-5)"; } : undefined}
                >
                  <EmojiText text={reaction.src} emojiSize={18} />
                  <span style={{ fontWeight: 500, fontSize: "13px" }}>{reaction.amount}</span>
                </button>
              </Tooltip>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {onReaction && (
      <button
        onClick={(e) => onOpenPicker(e.currentTarget)}
        title="Add reaction"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "28px",
          minHeight: "28px",
          background: "var(--gryt-neutral-3)",
          border: "1px solid var(--gryt-neutral-5)",
          borderRadius: "var(--gryt-radius-md)",
          cursor: "pointer",
          transition: "background 0.15s, border-color 0.15s",
          color: "var(--gryt-neutral-10)",
          fontSize: "16px",
          lineHeight: 1,
          padding: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gryt-neutral-4)"; e.currentTarget.style.borderColor = "var(--gryt-neutral-6)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "var(--gryt-neutral-3)"; e.currentTarget.style.borderColor = "var(--gryt-neutral-5)"; }}
      >
        +
      </button>
      )}
    </div>
  );
}

/** Always just above the highlighted part's far end, in every style, so it sits by the message
    it's for. A short message on the left takes it at its start instead (GRYT-1722). */
function hoverBarPlacement(
  alignRight: boolean,
  row: HTMLElement | null,
  barWidth: number,
): CSSProperties {
  const short = !alignRight && !!row && row.getBoundingClientRect().width < barWidth;
  // The 4px above the message is the bar's own padding, so the pointer never crosses a gap to reach it.
  const lift: CSSProperties = { bottom: "100%", paddingBottom: 4 };
  return short ? { ...lift, left: 0 } : { ...lift, right: 0 };
}
