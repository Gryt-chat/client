import { Avatar, Chip, PreviewCard, Tooltip } from "@gryt/ui";
import { AnimatePresence, motion } from "motion/react";
import { forwardRef, memo, useCallback, useRef, useState } from "react";

import { getUploadsFileUrl } from "@/common";

import { PiSignInBold, PiSignOutBold } from "../../../../lib/icons";
import { useServerPermissions } from "../hooks/usePermissions";
import { getFrequentReactions } from "../utils/recentReactions";
import type { CustomEmojiEntry } from "../utils/remarkEmoji";
import { sealedPlaceholder } from "../utils/sealedText";
import { BotTag } from "./BotTag";
import { ChatMediaPlayer } from "./ChatMediaPlayer";
import { MessageHoverToolbar } from "./ChatMessage";
import type { AttachmentMeta, ChatMessage, Reaction } from "./chatUtils";
import { DateSeparator, MessageTimestamp, NewMessagesDivider, toDate } from "./chatUtils";
import { CollapsibleText } from "./CollapsibleText";
import { EmojiPicker } from "./EmojiPicker";
import { EmojiText } from "./EmojiText";
import { FileCard } from "./FileCard";
import { ImageAttachment } from "./ImageAttachment";
import { MessageEmbeds } from "./LinkEmbed";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { type MessageActions, MessageContextMenu } from "./MediaContextMenu";
import { MemberIdentityCard } from "./MemberIdentityCard";
import type { MemberInfo } from "./MemberSidebar";

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
   *
   * Absent for system messages, webhooks, and anyone who has since left — the
   * message stays readable, it just has nothing to hover (GRYT-203).
   */
  sender?: MemberInfo;
  /**
   * Somebody else in this server is currently displaying the same name.
   *
   * The one case where a reader genuinely cannot tell who wrote a message from
   * looking at it, which is what makes it worth marking in the flow rather
   * than leaving to a hover.
   */
  nameIsAmbiguous?: boolean;
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
  onLightboxOpen: (src: string, alt?: string) => void;
  isNew?: boolean;
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
  isNew,
}, forwardedRef) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isCtxMenuOpen, setIsCtxMenuOpen] = useState(false);
  const [isReactionPickerOpen, setIsReactionPickerOpen] = useState(false);
  const [pickerPlacement, setPickerPlacement] = useState<"above" | "beside">("above");
  const rowRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pickerAnchorRef = useRef<HTMLElement | null>(null);

  const { can } = useServerPermissions(serverHost || "");
  const isOwnMessage = !!currentUserId && m.sender_server_id === currentUserId;

  // Editing and deleting your own message each have a permission now, so a role
  // can be allowed to post and not to revise. `canDeleteAny` is the moderator
  // side of the same question and is worked out where the server is known.
  const canDelete = !!canDeleteAny || (isOwnMessage && can("delete_own_messages"));
  const canEdit = isOwnMessage && !!m.text && can("edit_own_messages");
  const canReport = can("report_messages");

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
  };

  /**
   * A system row's menu: Delete, and nothing else (GRYT-908).
   *
   * Not `messageActions`. A join or leave line has no author, so Reply, Edit
   * and Report have nothing to act on, and Copy link and the quick reactions
   * are the things GRYT-896 took away on purpose — being able to react to
   * somebody joining is what the quiet row exists to stop.
   *
   * Deleting one is a different question, and the answer was already yes: the
   * server's `chat:delete` looks a message up by id and takes anybody holding
   * `manage_messages`, with no special case for these. There was simply no way
   * to ask for it.
   *
   * Undefined rather than an empty object when there is nothing to offer, so
   * `MessageContextMenu` renders no menu at all rather than an empty popup on
   * every right-click for people who cannot moderate.
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

  /*
   * The four this person reaches for most, read while the toolbar is going up.
   *
   * Read on hover rather than held in state: the list only changes when they
   * react, the row re-renders on hover anyway, and a store this small is
   * cheaper to read than to subscribe to. It also means the bar is current the
   * next time they hover, without anything having to tell it.
   *
   * Empty for somebody who may not react, which leaves the toolbar as it was.
   */
  const quickReactions = showToolbar && can("add_reactions")
    ? getFrequentReactions(4, serverHost)
    : undefined;

  const content = (
    <>
      {meta.showNewMessageDivider && <NewMessagesDivider />}
      {meta.dayBreak && <DateSeparator date={meta.dayBreak} />}

      {meta.isSystem ? (
        /* An event, not a message (GRYT-896). One quiet row: the avatar
           column carries a small arrow rather than standing empty, there is no
           name line because there is no author, and the time trails the text.

           The left edge every message shares stays where it is. A centred rule
           would break it, and a channel where people come and go is exactly
           where a run of rules chops the conversation into fragments.

           It does have a right-click, carrying Delete and nothing else, for
           somebody who may moderate (GRYT-908). Still no hover toolbar: the
           toolbar's job is reactions and a reply. */
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
      ) : meta.isFirstInGroup ? (
        <MessageContextMenu messageActions={messageActions} onOpenChange={handleCtxMenuOpenChange} onReaction={(src) => onReaction(src, m)} serverHost={serverHost}>
          <div className="flex gap-3 items-start" style={{ width: "100%", marginTop: 12 }}>
            {/* The same card the member sidebar shows, on the avatar in the
                flow. A message is where an impersonation is most convincing
                and least checkable, and where nobody is going to open the
                member list to compare fingerprints (GRYT-203). */}
            {meta.sender ? (
              <PreviewCard.Root>
                <PreviewCard.Trigger>
                  <Avatar
                    size="large"
                    className="mt-0.5 h-[51px] w-[51px] shrink-0 text-lg"
                    fallback={meta.senderName[0]}
                    src={meta.avatarUrl}
                  />
                </PreviewCard.Trigger>
                <PreviewCard.Portal>
                  <PreviewCard.Positioner side="right" align="start">
                    <PreviewCard.Popup>
                      <MemberIdentityCard member={meta.sender} serverHost={serverHost} />
                    </PreviewCard.Popup>
                  </PreviewCard.Positioner>
                </PreviewCard.Portal>
              </PreviewCard.Root>
            ) : (
              <Avatar
                size="large"
                className="mt-0.5 h-[51px] w-[51px] shrink-0 text-lg"
                fallback={meta.senderName[0]}
                src={meta.avatarUrl}
              />
            )}
            <div className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
              <div className="flex items-baseline gap-2" style={{ marginBottom: 2 }}>
                <span className="text-sm font-bold" style={{ color: meta.isSelf ? "var(--gryt-accent-11)" : "var(--gryt-neutral-12)" }}>
                  {meta.senderName}
                </span>
                {meta.nameIsAmbiguous && (
                  /* Only when the name is genuinely not enough to go on —
                     somebody else in this server is using it right now. Not a
                     mark on people without an account: Gryt's whole position is
                     that an account is optional, and badging every guest as
                     suspect would argue the opposite on every message they
                     write. The hover card says which they are. */
                  <Tooltip title="Someone else here is using this name too. Hover the avatar to check who this is.">
                    <Chip tone="warning">
                      shared name
                    </Chip>
                  </Tooltip>
                )}
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
              <MessageContent
                quickReactions={quickReactions}
                m={m}
                rowRef={rowRef}
                bgColor={bgColor}
                showToolbar={showToolbar}
                canDelete={canDelete}
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
                isFirstInGroup
                messageActions={messageActions}
                onReaction={onReaction}
                onReply={onReply}
                onDelete={onDelete}
                scrollToMessage={scrollToMessage}
                onLightboxOpen={onLightboxOpen}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onOpenReactionPicker={handleOpenReactionPicker}
              />
            </div>
          </div>
        </MessageContextMenu>
      ) : (
        <MessageContextMenu messageActions={messageActions} onOpenChange={handleCtxMenuOpenChange} onReaction={(src) => onReaction(src, m)} serverHost={serverHost}>
          <div className="flex" style={{ width: "100%", paddingLeft: 63 }}>
            <div className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
              <MessageContent
                quickReactions={quickReactions}
                m={m}
                rowRef={rowRef}
                bgColor={bgColor}
                showToolbar={showToolbar}
                canDelete={canDelete}
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
                isFirstInGroup={false}
                messageActions={messageActions}
                onReaction={onReaction}
                onReply={onReply}
                onDelete={onDelete}
                scrollToMessage={scrollToMessage}
                onLightboxOpen={onLightboxOpen}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onOpenReactionPicker={handleOpenReactionPicker}
              />
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
    <motion.div
      ref={mergedRef}
      layout="position"
      style={{ width: "100%", overflow: isNew ? "hidden" : undefined }}
      initial={isNew ? { opacity: 0, height: 0 } : false}
      animate={{ opacity: 1, height: "auto" }}
      transition={{
        layout: { type: "spring", stiffness: 170, damping: 26 },
        opacity: { duration: 0.2, ease: "easeOut" },
        height: { type: "spring", stiffness: 170, damping: 26 },
      }}
      onAnimationComplete={() => {
        if (wrapperRef.current) wrapperRef.current.style.overflow = "";
      }}
    >
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
    </motion.div>
  );
}));

MessageRow.displayName = "MessageRow";

function MessageContent({
  m,
  rowRef,
  bgColor,
  showToolbar,
  quickReactions,
  canDelete,
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
  onDelete,
  scrollToMessage,
  onLightboxOpen,
  onMouseEnter,
  onMouseLeave,
  onOpenReactionPicker,
}: {
  m: ChatMessage;
  rowRef: React.RefObject<HTMLDivElement | null>;
  bgColor: string;
  showToolbar: boolean;
  /** The reactions this person uses most, for the hover bar. */
  quickReactions?: string[];
  canDelete: boolean;
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
  onDelete: (msg: ChatMessage) => void;
  scrollToMessage: (messageId: string) => void;
  onLightboxOpen: (src: string, alt?: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onOpenReactionPicker: (anchorEl?: HTMLElement) => void;
}) {
  const hasReactions = !!(m.reactions && m.reactions.length > 0);
  const sealedNote = sealedPlaceholder(m);
  return (
    <motion.div
      animate={{ marginBottom: hasReactions ? 30 : 0, background: bgColor }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      style={{
        borderRadius: "var(--gryt-radius-md)",
        margin: "0 -6px",
      }}
    >
    <div className="flex flex-col" ref={rowRef} data-message-id={m.message_id} style={{
        padding: "2px 6px",
        cursor: "default",
        position: "relative",
      }} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <AnimatePresence>
        {showToolbar && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 4 }}
            transition={{ type: "spring", stiffness: 500, damping: 25 }}
            style={{ position: "absolute", top: -16, right: 8, zIndex: 10 }}
          >
            <MessageHoverToolbar
              quickReactions={quickReactions}
              onQuickReaction={(src) => onReaction(src, m)}
              onReply={() => onReply(m)}
              canDelete={canDelete}
              onDelete={canDelete ? () => onDelete(m) : undefined}
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
          <span className="text-xs">{replyPreviewText ?? "Original message"}</span>
        </div>
      )}
      <motion.div
        animate={{ opacity: m.pending ? 0.6 : m.failed ? 0.5 : 1 }}
        transition={{ duration: 0.2 }}
        style={{ wordBreak: "break-word" }}
      >
        {/* Only the text folds. Attachments and embeds below carry their own
            sizing, and folding them too would hide an image behind a control
            that says "show full message". */}
        {sealedNote ? (
          /* An envelope this client has not opened has no words to draw, and
             three of the four states never will (GRYT-729). Plain rather than
             through the markdown renderer: this is the client talking, not
             something anybody wrote, so it must not be parsed, linkified or
             turned into an embed. */
          <span style={{ color: "var(--gryt-neutral-8)", fontStyle: "italic" }}>
            {sealedNote}
          </span>
        ) : (
          <CollapsibleText>
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
          </CollapsibleText>
        )}
        {m.edited_at && !isFirstInGroup && (
          <Tooltip title={`Edited ${new Date(m.edited_at).toLocaleString()}`}>
            <span style={{ fontSize: 10, cursor: "default", whiteSpace: "nowrap", userSelect: "none", color: "var(--gryt-neutral-8)" }}>
              (edited)
            </span>
          </Tooltip>
        )}
        {serverHost && !m.pending && (
          <MessageEmbeds messageId={m.message_id} text={m.text} serverHost={serverHost} />
        )}
        {m.attachments && m.attachments.length > 0 && serverHost && (
          <div className="flex gap-2 flex-wrap flex-col" style={{ marginTop: "4px" }}>
            {m.attachments.map((fileId, attIdx) => {
              const attachMeta: AttachmentMeta | undefined = m.enriched_attachments?.[attIdx];
              const url = getUploadsFileUrl(serverHost, fileId);
              const thumbUrl = attachMeta?.has_thumbnail ? getUploadsFileUrl(serverHost, fileId, { thumb: true }) : undefined;
              const mime = attachMeta?.mime || "";

              if (mime.startsWith("image/")) {
                const imgSrc = attachMeta?.local_url || url;
                return (
                  <MessageContextMenu key={fileId} media={{ src: url, fileName: attachMeta?.original_name, isImage: true }} messageActions={messageActions}>
                    <ImageAttachment
                      src={imgSrc}
                      alt={attachMeta?.original_name || "Attachment"}
                      width={attachMeta?.width}
                      height={attachMeta?.height}
                      onClick={() => onLightboxOpen(imgSrc, attachMeta?.original_name || "Attachment")}
                    />
                  </MessageContextMenu>
                );
              }
              if (mime.startsWith("audio/")) {
                return (
                  <MessageContextMenu key={fileId} media={{ src: url, fileName: attachMeta?.original_name }} messageActions={messageActions}>
                    <ChatMediaPlayer src={url} type="audio" fileName={attachMeta?.original_name} volume={chatMediaVolume} onVolumeChange={setChatMediaVolume} />
                  </MessageContextMenu>
                );
              }
              if (mime.startsWith("video/")) {
                return (
                  <MessageContextMenu key={fileId} media={{ src: url, fileName: attachMeta?.original_name }} messageActions={messageActions}>
                    <ChatMediaPlayer src={url} type="video" poster={thumbUrl} fileName={attachMeta?.original_name} volume={chatMediaVolume} onVolumeChange={setChatMediaVolume} />
                  </MessageContextMenu>
                );
              }
              return (
                <FileCard
                  key={fileId}
                  fileId={fileId}
                  mime={attachMeta?.mime ?? null}
                  size={attachMeta?.size ?? null}
                  originalName={attachMeta?.original_name ?? null}
                  serverHost={serverHost}
                />
              );
            })}
          </div>
        )}
        {m.failed && (
          <span className="text-xs" style={{ color: "var(--gryt-danger-9)", marginTop: "2px" }}>
            Failed to send
          </span>
        )}
      </motion.div>
      <ReactionBadges
        reactions={m.reactions}
        currentUserId={currentUserId}
        currentUserNickname={currentUserNickname}
        memberList={memberList}
        onReaction={(src) => onReaction(src, m)}
        onOpenPicker={onOpenReactionPicker}
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
}: {
  reactions: Reaction[] | null | undefined;
  currentUserId: string | undefined;
  currentUserNickname: string | undefined;
  memberList?: Record<string, MemberInfo>;
  onReaction: (src: string) => void;
  onOpenPicker: (anchorEl?: HTMLElement) => void;
}) {
  const hasReactions = reactions && reactions.length > 0;
  if (!hasReactions) return null;

  return (
    <div className="flex flex-wrap items-center" style={{
      position: "absolute",
      bottom: 0,
      left: "6px",
      transform: "translateY(100%)",
      gap: "4px",
      zIndex: 1,
    }}>
      <AnimatePresence mode="popLayout">
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
                  onClick={() => onReaction(reaction.src)}
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
                    cursor: "pointer",
                    transition: "background 0.15s, border-color 0.15s",
                    whiteSpace: "nowrap",
                    color: isMine ? "var(--gryt-accent-11)" : "var(--gryt-neutral-12)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = isMine ? "var(--gryt-accent-4)" : "var(--gryt-neutral-4)"; e.currentTarget.style.borderColor = isMine ? "var(--gryt-accent-8)" : "var(--gryt-neutral-6)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = isMine ? "var(--gryt-accent-3)" : "var(--gryt-neutral-3)"; e.currentTarget.style.borderColor = isMine ? "var(--gryt-accent-7)" : "var(--gryt-neutral-5)"; }}
                >
                  <EmojiText text={reaction.src} emojiSize={18} />
                  <span style={{ fontWeight: 500, fontSize: "13px" }}>{reaction.amount}</span>
                </button>
              </Tooltip>
            </motion.div>
          );
        })}
      </AnimatePresence>
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
    </div>
  );
}
