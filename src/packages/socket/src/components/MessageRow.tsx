import { Avatar, Flex, Text, Tooltip } from "@radix-ui/themes";
import { AnimatePresence, motion } from "motion/react";
import { memo, useCallback, useRef, useState } from "react";

import { getUploadsFileUrl } from "@/common";

import type { CustomEmojiEntry } from "../utils/remarkEmoji";
import { ChatMediaPlayer } from "./ChatMediaPlayer";
import { MessageHoverToolbar } from "./ChatMessage";
import type { AttachmentMeta, ChatMessage, Reaction } from "./chatUtils";
import { DateSeparator, MessageTimestamp, NewMessagesDivider, toDate } from "./chatUtils";
import { EmojiPicker } from "./EmojiPicker";
import { EmojiText } from "./EmojiText";
import { FileCard } from "./FileCard";
import { ImageAttachment } from "./ImageAttachment";
import { MessageEmbeds } from "./LinkEmbed";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { type MessageActions, MessageContextMenu } from "./MediaContextMenu";

export interface MessageMeta {
  isFirstInGroup: boolean;
  dayBreak: Date | null;
  showNewMessageDivider: boolean;
  senderName: string;
  avatarUrl: string | undefined;
  isSelf: boolean;
  isFirstEdited: boolean;
  isSystem: boolean;
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
  memberList?: Record<string, { nickname: string; serverUserId: string; avatarFileId?: string | null; [key: string]: unknown }>;
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

export const MessageRow = memo(({
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
}: MessageRowProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isCtxMenuOpen, setIsCtxMenuOpen] = useState(false);
  const [isReactionPickerOpen, setIsReactionPickerOpen] = useState(false);
  const [pickerPlacement, setPickerPlacement] = useState<"above" | "beside">("above");
  const rowRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pickerAnchorRef = useRef<HTMLElement | null>(null);

  const canDelete = !!canDeleteAny || (!!currentUserId && m.sender_server_id === currentUserId);
  const canEdit = !!currentUserId && m.sender_server_id === currentUserId && !!m.text;

  const bgColor = (isHovered || isReactionPickerOpen || isCtxMenuOpen)
    ? "var(--gray-4)"
    : isMentioned ? "var(--accent-a3)" : "transparent";

  const messageActions: MessageActions = {
    messageText: m.text,
    onReply: () => onReply(m),
    onEdit: canEdit ? () => onEdit(m) : undefined,
    onReport: () => onReport(m),
    onDelete: canDelete ? () => onDelete(m) : undefined,
    canEdit,
    canDelete,
  };

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

  const content = (
    <>
      {meta.showNewMessageDivider && <NewMessagesDivider />}
      {meta.dayBreak && <DateSeparator date={meta.dayBreak} />}

      {meta.isSystem ? (
        <MessageContextMenu messageActions={messageActions} onOpenChange={handleCtxMenuOpenChange} onReaction={(src) => onReaction(src, m)} serverHost={serverHost}>
        <motion.div
          animate={{ marginBottom: m.reactions?.length ? 30 : 0, background: bgColor }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          style={{
            borderRadius: "var(--radius-3)",
            margin: "12px -6px 0",
          }}
        >
            <Flex
              ref={rowRef}
              data-message-id={m.message_id}
              gap="3"
              align="start"
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              style={{
                width: "100%",
                padding: "2px 6px",
                cursor: "default",
                position: "relative",
              }}
            >
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
                      onReply={() => onReply(m)}
                      canDelete={canDelete}
                      onDelete={canDelete ? () => onDelete(m) : undefined}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              <div style={{ flexShrink: 0, width: 51 }} />
              <Flex direction="column" style={{ flex: 1, minWidth: 0, position: "relative" }}>
                <Flex align="baseline" gap="2" style={{ marginBottom: 2 }}>
                  <Text size="2" weight="bold" style={{ color: "var(--gray-9)" }}>
                    System
                  </Text>
                  <MessageTimestamp date={toDate(m.created_at)} />
                </Flex>
                <Text size="2" style={{ wordBreak: "break-word" }}>
                  <MarkdownRenderer
                    content={m.text}
                    memberNicknames={memberNicknames}
                    mentionMembersById={memberList}
                    serverHost={serverHost}
                  />
                </Text>
                <ReactionBadges
                  reactions={m.reactions}
                  currentUserId={currentUserId}
                  currentUserNickname={currentUserNickname}
                  memberList={memberList}
                  onReaction={(src) => onReaction(src, m)}
                  onOpenPicker={handleOpenReactionPicker}
                />
              </Flex>
            </Flex>
          </motion.div>
        </MessageContextMenu>
      ) : meta.isFirstInGroup ? (
        <MessageContextMenu messageActions={messageActions} onOpenChange={handleCtxMenuOpenChange} onReaction={(src) => onReaction(src, m)} serverHost={serverHost}>
          <Flex gap="3" style={{ width: "100%", marginTop: 12 }} align="start">
            <Avatar
              radius="full"
              fallback={meta.senderName[0]}
              src={meta.avatarUrl}
              style={{ flexShrink: 0, marginTop: 2, width: 51, height: 51 }}
            />
            <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
              <Flex align="baseline" gap="2" style={{ marginBottom: 2 }}>
                <Text size="2" weight="bold" style={{ color: meta.isSelf ? "var(--accent-11)" : "var(--gray-12)" }}>
                  {meta.senderName}
                </Text>
                <MessageTimestamp date={toDate(m.created_at)} />
                {meta.isFirstEdited && (
                  <Tooltip content={`Edited ${new Date(m.edited_at!).toLocaleString()}`} delayDuration={200}>
                    <Text style={{ fontSize: 10, cursor: "default", whiteSpace: "nowrap", userSelect: "none", color: "var(--gray-8)" }}>
                      (edited)
                    </Text>
                  </Tooltip>
                )}
              </Flex>
              <MessageContent
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
            </Flex>
          </Flex>
        </MessageContextMenu>
      ) : (
        <MessageContextMenu messageActions={messageActions} onOpenChange={handleCtxMenuOpenChange} onReaction={(src) => onReaction(src, m)} serverHost={serverHost}>
          <Flex style={{ width: "100%", paddingLeft: 63 }}>
            <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
              <MessageContent
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
            </Flex>
          </Flex>
        </MessageContextMenu>
      )}
    </>
  );

  return (
    <motion.div
      ref={wrapperRef}
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
});

MessageRow.displayName = "MessageRow";

function MessageContent({
  m,
  rowRef,
  bgColor,
  showToolbar,
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
  rowRef: React.RefObject<HTMLDivElement>;
  bgColor: string;
  showToolbar: boolean;
  canDelete: boolean;
  customEmojiList: CustomEmojiEntry[];
  memberNicknames: string[];
  blurProfanity: boolean;
  smileyConversion: boolean;
  disabledSmileys: ReadonlySet<string>;
  serverHost: string | undefined;
  currentUserId: string | undefined;
  currentUserNickname: string | undefined;
  memberList?: Record<string, { nickname: string; serverUserId: string; avatarFileId?: string | null; [key: string]: unknown }>;
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
  return (
    <motion.div
      animate={{ marginBottom: hasReactions ? 30 : 0, background: bgColor }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      style={{
        borderRadius: "var(--radius-3)",
        margin: "0 -6px",
      }}
    >
    <Flex
      ref={rowRef}
      data-message-id={m.message_id}
      direction="column"
      style={{
        padding: "2px 6px",
        cursor: "default",
        position: "relative",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
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
          <Text size="1">{replyPreviewText ?? "Original message"}</Text>
        </div>
      )}
      <motion.div
        animate={{ opacity: m.pending ? 0.6 : m.failed ? 0.5 : 1 }}
        transition={{ duration: 0.2 }}
        style={{ wordBreak: "break-word" }}
      >
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
        {m.edited_at && !isFirstInGroup && (
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
          </Flex>
        )}
        {m.failed && (
          <Text size="1" style={{ color: "var(--red-9)", marginTop: "2px" }}>
            Failed to send
          </Text>
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
    </Flex>
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
  memberList?: Record<string, { nickname: string; serverUserId: string; avatarFileId?: string | null; [key: string]: unknown }>;
  onReaction: (src: string) => void;
  onOpenPicker: (anchorEl?: HTMLElement) => void;
}) {
  const hasReactions = reactions && reactions.length > 0;
  if (!hasReactions) return null;

  return (
    <Flex wrap="wrap" align="center" style={{
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
                content={(
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontWeight: 600 }}>{emojiId}</div>
                    <div style={{ opacity: 0.9 }}>{usersLabel}</div>
                  </div>
                )}
                delayDuration={200}
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
          background: "var(--gray-3)",
          border: "1px solid var(--gray-5)",
          borderRadius: "var(--radius-3)",
          cursor: "pointer",
          transition: "background 0.15s, border-color 0.15s",
          color: "var(--gray-10)",
          fontSize: "16px",
          lineHeight: 1,
          padding: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-4)"; e.currentTarget.style.borderColor = "var(--gray-6)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "var(--gray-3)"; e.currentTarget.style.borderColor = "var(--gray-5)"; }}
      >
        +
      </button>
    </Flex>
  );
}
