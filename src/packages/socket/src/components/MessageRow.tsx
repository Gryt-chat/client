import { Avatar, Flex, Text, Tooltip } from "@radix-ui/themes";
import { memo, useCallback, useRef, useState } from "react";

import { getUploadsFileUrl } from "@/common";

import type { CustomEmojiEntry } from "../utils/remarkEmoji";
import { ChatMediaPlayer } from "./ChatMediaPlayer";
import { MessageHoverToolbar } from "./ChatMessage";
import type { AttachmentMeta, ChatMessage } from "./chatUtils";
import { DateSeparator, MessageTimestamp, NewMessagesDivider, toDate } from "./chatUtils";
import { EmojiText } from "./EmojiText";
import { FileCard } from "./FileCard";
import { MessageEmbeds } from "./LinkEmbed";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { MediaContextMenu } from "./MediaContextMenu";

export interface MessageMeta {
  isFirstInGroup: boolean;
  dayBreak: Date | null;
  showNewMessageDivider: boolean;
  senderName: string;
  avatarUrl: string | undefined;
  isSelf: boolean;
  isFirstEdited: boolean;
}

interface MessageRowProps {
  message: ChatMessage;
  meta: MessageMeta;
  replyPreviewText: string | null;
  isMentioned: boolean;
  customEmojiList: CustomEmojiEntry[];
  memberNicknames: string[];
  blurProfanity: boolean;
  serverHost: string | undefined;
  currentUserId: string | undefined;
  currentUserNickname: string | undefined;
  canDeleteAny: boolean;
  chatMediaVolume: number;
  isContextMenuOpen: boolean;
  memberList?: Record<string, { nickname: string; serverUserId: string; avatarFileId?: string | null; [key: string]: unknown }>;
  setChatMediaVolume: (v: number) => void;
  onContextMenu: (e: React.MouseEvent, msg: ChatMessage) => void;
  onReaction: (src: string, msg: ChatMessage) => void;
  onReply: (msg: ChatMessage) => void;
  onDelete: (msg: ChatMessage) => void;
  scrollToMessage: (messageId: string) => void;
  onLightboxOpen: (src: string, alt?: string) => void;
}

export const MessageRow = memo(({
  message: m,
  meta,
  replyPreviewText,
  isMentioned,
  customEmojiList,
  memberNicknames,
  blurProfanity,
  serverHost,
  currentUserId,
  currentUserNickname,
  canDeleteAny,
  chatMediaVolume,
  isContextMenuOpen,
  memberList,
  setChatMediaVolume,
  onContextMenu,
  onReaction,
  onReply,
  onDelete,
  scrollToMessage,
  onLightboxOpen,
}: MessageRowProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  const mentionBg = isMentioned ? "var(--accent-a3)" : undefined;
  const canDelete = !!canDeleteAny || (!!currentUserId && m.sender_server_id === currentUserId);

  const handleMouseEnter = useCallback(() => {
    if (rowRef.current) rowRef.current.style.background = "var(--gray-4)";
    setIsHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!isEmojiPickerOpen && rowRef.current) {
      rowRef.current.style.background = isMentioned ? "var(--accent-a3)" : "transparent";
    }
    setIsHovered(false);
  }, [isEmojiPickerOpen, isMentioned]);

  const handlePickerOpenChange = useCallback((open: boolean) => {
    setIsEmojiPickerOpen(open);
    if (!open && rowRef.current) {
      rowRef.current.style.background = isMentioned ? "var(--accent-a3)" : "transparent";
    }
  }, [isMentioned]);

  const showToolbar = (isHovered || isEmojiPickerOpen) && !isContextMenuOpen;

  return (
    <div style={{ width: "100%" }}>
      {meta.showNewMessageDivider && <NewMessagesDivider />}
      {meta.dayBreak && <DateSeparator date={meta.dayBreak} />}

      {meta.isFirstInGroup ? (
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
              mentionBg={mentionBg}
              showToolbar={showToolbar}
              canDelete={canDelete}
              customEmojiList={customEmojiList}
              memberNicknames={memberNicknames}
              blurProfanity={blurProfanity}
              serverHost={serverHost}
              currentUserId={currentUserId}
              currentUserNickname={currentUserNickname}
              memberList={memberList}
              chatMediaVolume={chatMediaVolume}
              setChatMediaVolume={setChatMediaVolume}
              replyPreviewText={replyPreviewText}
              isFirstInGroup
              onContextMenu={onContextMenu}
              onReaction={onReaction}
              onReply={onReply}
              onDelete={onDelete}
              scrollToMessage={scrollToMessage}
              onLightboxOpen={onLightboxOpen}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onPickerOpenChange={handlePickerOpenChange}
            />
          </Flex>
        </Flex>
      ) : (
        <Flex style={{ width: "100%", paddingLeft: 63 }}>
          <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
            <MessageContent
              m={m}
              rowRef={rowRef}
              mentionBg={mentionBg}
              showToolbar={showToolbar}
              canDelete={canDelete}
              customEmojiList={customEmojiList}
              memberNicknames={memberNicknames}
              blurProfanity={blurProfanity}
              serverHost={serverHost}
              currentUserId={currentUserId}
              currentUserNickname={currentUserNickname}
              memberList={memberList}
              chatMediaVolume={chatMediaVolume}
              setChatMediaVolume={setChatMediaVolume}
              replyPreviewText={replyPreviewText}
              isFirstInGroup={false}
              onContextMenu={onContextMenu}
              onReaction={onReaction}
              onReply={onReply}
              onDelete={onDelete}
              scrollToMessage={scrollToMessage}
              onLightboxOpen={onLightboxOpen}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onPickerOpenChange={handlePickerOpenChange}
            />
          </Flex>
        </Flex>
      )}
    </div>
  );
});

MessageRow.displayName = "MessageRow";

function MessageContent({
  m,
  rowRef,
  mentionBg,
  showToolbar,
  canDelete,
  customEmojiList,
  memberNicknames,
  blurProfanity,
  serverHost,
  currentUserId,
  currentUserNickname,
  memberList,
  chatMediaVolume,
  setChatMediaVolume,
  replyPreviewText,
  isFirstInGroup,
  onContextMenu,
  onReaction,
  onReply,
  onDelete,
  scrollToMessage,
  onLightboxOpen,
  onMouseEnter,
  onMouseLeave,
  onPickerOpenChange,
}: {
  m: ChatMessage;
  rowRef: React.RefObject<HTMLDivElement>;
  mentionBg: string | undefined;
  showToolbar: boolean;
  canDelete: boolean;
  customEmojiList: CustomEmojiEntry[];
  memberNicknames: string[];
  blurProfanity: boolean;
  serverHost: string | undefined;
  currentUserId: string | undefined;
  currentUserNickname: string | undefined;
  memberList?: Record<string, { nickname: string; serverUserId: string; avatarFileId?: string | null; [key: string]: unknown }>;
  chatMediaVolume: number;
  setChatMediaVolume: (v: number) => void;
  replyPreviewText: string | null;
  isFirstInGroup: boolean;
  onContextMenu: (e: React.MouseEvent, msg: ChatMessage) => void;
  onReaction: (src: string, msg: ChatMessage) => void;
  onReply: (msg: ChatMessage) => void;
  onDelete: (msg: ChatMessage) => void;
  scrollToMessage: (messageId: string) => void;
  onLightboxOpen: (src: string, alt?: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onPickerOpenChange: (open: boolean) => void;
}) {
  return (
    <Flex
      ref={rowRef}
      data-message-id={m.message_id}
      direction="column"
      onContextMenu={(e) => onContextMenu(e, m)}
      style={{
        borderRadius: "var(--radius-3)",
        padding: "2px 6px",
        margin: "0 -6px",
        transition: "background 0.3s ease",
        cursor: "context-menu",
        position: "relative",
        background: mentionBg,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {showToolbar && (
        <MessageHoverToolbar
          onReaction={(emoji) => onReaction(emoji, m)}
          onReply={() => onReply(m)}
          canDelete={canDelete}
          onDelete={canDelete ? () => onDelete(m) : undefined}
          onPickerOpenChange={onPickerOpenChange}
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
          <Text size="1">{replyPreviewText ?? "Original message"}</Text>
        </div>
      )}
      <div style={{ opacity: m.pending ? 0.6 : m.failed ? 0.5 : 1, wordBreak: "break-word" }}>
        <MarkdownRenderer
          content={m.text}
          customEmojis={customEmojiList}
          memberNicknames={memberNicknames}
          profanityMatches={m.profanity_matches}
          blurProfanity={blurProfanity}
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
                return (
                  <MediaContextMenu key={fileId} src={url} fileName={attachMeta?.original_name} isImage>
                    <img
                      src={url}
                      alt={attachMeta?.original_name || "Attachment"}
                      className="chat-attachment-image"
                      onClick={() => onLightboxOpen(url, attachMeta?.original_name || "Attachment")}
                    />
                  </MediaContextMenu>
                );
              }
              if (mime.startsWith("audio/")) {
                return (
                  <MediaContextMenu key={fileId} src={url} fileName={attachMeta?.original_name}>
                    <ChatMediaPlayer src={url} type="audio" fileName={attachMeta?.original_name} volume={chatMediaVolume} onVolumeChange={setChatMediaVolume} />
                  </MediaContextMenu>
                );
              }
              if (mime.startsWith("video/")) {
                return (
                  <MediaContextMenu key={fileId} src={url} fileName={attachMeta?.original_name}>
                    <ChatMediaPlayer src={url} type="video" poster={thumbUrl} fileName={attachMeta?.original_name} volume={chatMediaVolume} onVolumeChange={setChatMediaVolume} />
                  </MediaContextMenu>
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
      </div>
      {m.reactions && m.reactions.length > 0 && (
        <Flex wrap="wrap" style={{ marginTop: "4px", gap: "2px" }}>
          {m.reactions.map((reaction, rIdx) => {
            const isMine = !!(currentUserId && reaction.users.includes(currentUserId));
            return (
              <Tooltip
                key={`${reaction.src}-${rIdx}`}
                content={reaction.users.map((uid) => {
                  if (currentUserId && uid === currentUserId) return currentUserNickname || "You";
                  const member = memberList && Object.values(memberList).find((mb) => mb.serverUserId === uid);
                  return member?.nickname || uid;
                }).join(", ")}
                delayDuration={200}
              >
                <button
                  onClick={() => onReaction(reaction.src, m)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "2px 6px",
                    minHeight: "24px",
                    fontSize: "13px",
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
                  <EmojiText text={reaction.src} emojiSize={16} />
                  <span style={{ fontWeight: 500, fontSize: "12px" }}>{reaction.amount}</span>
                </button>
              </Tooltip>
            );
          })}
        </Flex>
      )}
    </Flex>
  );
}
