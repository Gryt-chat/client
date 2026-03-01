import { ContextMenu, Flex } from "@radix-ui/themes";
import React, { type ReactNode, useMemo } from "react";
import {
  MdCloudDownload,
  MdContentCopy,
  MdDelete,
  MdEdit,
  MdEmojiEmotions,
  MdFlag,
  MdImage,
  MdOpenInNew,
  MdReply,
} from "react-icons/md";

import { copyImageToClipboard } from "../utils/mediaClipboard";
import { getRecentReactions } from "../utils/recentReactions";
import { EmojiText } from "./EmojiText";

export interface MessageActions {
  messageText?: string | null;
  onReply?: () => void;
  onEdit?: () => void;
  onReport?: () => void;
  onDelete?: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
}

interface MediaProps {
  src: string;
  fileName?: string | null;
  isImage?: boolean;
}

interface MessageContextMenuProps {
  children: ReactNode;
  media?: MediaProps;
  messageActions?: MessageActions;
  onOpenChange?: (open: boolean) => void;
  onReaction?: (src: string) => void;
  onAddReaction?: () => void;
  serverHost?: string;
}

function triggerDownload(url: string, fileName?: string | null) {
  const a = document.createElement("a");
  a.href = url.includes("?") ? `${url}&download=1` : `${url}?download=1`;
  a.download = fileName || "";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

function MediaItems({ media }: { media: MediaProps }) {
  return (
    <>
      {media.isImage && (
        <ContextMenu.Item onClick={() => copyImageToClipboard(media.src)}>
          <Flex align="center" gap="1">
            <MdImage size={14} />
            Copy Image
          </Flex>
        </ContextMenu.Item>
      )}
      <ContextMenu.Item onClick={() => triggerDownload(media.src, media.fileName)}>
        <Flex align="center" gap="1">
          <MdCloudDownload size={14} />
          Save As
        </Flex>
      </ContextMenu.Item>
      <ContextMenu.Item onClick={() => copyToClipboard(media.src)}>
        <Flex align="center" gap="1">
          <MdContentCopy size={14} />
          Copy Link
        </Flex>
      </ContextMenu.Item>
      <ContextMenu.Separator />
      <ContextMenu.Item onClick={() => window.open(media.src, "_blank", "noopener,noreferrer")}>
        <Flex align="center" gap="1">
          <MdOpenInNew size={14} />
          Open in Browser
        </Flex>
      </ContextMenu.Item>
    </>
  );
}

function QuickReactions({
  onReaction,
  onAddReaction,
  serverHost,
}: {
  onReaction: (src: string) => void;
  onAddReaction: () => void;
  serverHost?: string;
}) {
  const recent = useMemo(() => getRecentReactions(4, serverHost), [serverHost]);

  return (
    <>
      <Flex gap="1" px="2" py="1" justify="center">
        {recent.map((src) => (
          <ContextMenu.Item
            key={src}
            onSelect={() => onReaction(src)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              minWidth: "unset",
              borderRadius: "var(--radius-2)",
              padding: 0,
              flex: "0 0 auto",
            }}
          >
            <EmojiText text={src} emojiSize={22} disableTooltip />
          </ContextMenu.Item>
        ))}
        <ContextMenu.Item
          onSelect={() => onAddReaction()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            minWidth: "unset",
            borderRadius: "var(--radius-2)",
            padding: 0,
            flex: "0 0 auto",
            color: "var(--gray-10)",
          }}
        >
          <MdEmojiEmotions size={20} />
        </ContextMenu.Item>
      </Flex>
      <ContextMenu.Separator />
    </>
  );
}

function MessageActionItems({ actions }: { actions: MessageActions }) {
  return (
    <>
      {actions.messageText && (
        <ContextMenu.Item onClick={() => copyToClipboard(actions.messageText!)}>
          <Flex align="center" gap="1">
            <MdContentCopy size={14} />
            Copy Message
          </Flex>
        </ContextMenu.Item>
      )}
      {actions.onReply && (
        <ContextMenu.Item onClick={actions.onReply}>
          <Flex align="center" gap="1">
            <MdReply size={14} />
            Reply
          </Flex>
        </ContextMenu.Item>
      )}
      {actions.canEdit && actions.onEdit && (
        <ContextMenu.Item onClick={actions.onEdit}>
          <Flex align="center" gap="1">
            <MdEdit size={14} />
            Edit Message
          </Flex>
        </ContextMenu.Item>
      )}
      {actions.onReport && (
        <ContextMenu.Item onClick={actions.onReport} color="red">
          <Flex align="center" gap="1">
            <MdFlag size={14} />
            Report
          </Flex>
        </ContextMenu.Item>
      )}
      {actions.canDelete && actions.onDelete && (
        <ContextMenu.Item onClick={actions.onDelete} color="red">
          <Flex align="center" gap="1">
            <MdDelete size={14} />
            Delete Message
          </Flex>
        </ContextMenu.Item>
      )}
    </>
  );
}

export function MessageContextMenu({
  children,
  media,
  messageActions,
  onOpenChange,
  onReaction,
  onAddReaction,
  serverHost,
}: MessageContextMenuProps) {
  const hasMessageActions = messageActions && (
    messageActions.onReply || messageActions.onEdit || messageActions.onReport || messageActions.onDelete
  );

  return (
    <ContextMenu.Root onOpenChange={onOpenChange}>
      <ContextMenu.Trigger onContextMenu={media ? ((e: React.MouseEvent) => e.stopPropagation()) : undefined}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Content style={{ minWidth: 180 }}>
        {onReaction && onAddReaction && (
          <QuickReactions onReaction={onReaction} onAddReaction={onAddReaction} serverHost={serverHost} />
        )}
        {media && <MediaItems media={media} />}
        {media && hasMessageActions && <ContextMenu.Separator />}
        {hasMessageActions && <MessageActionItems actions={messageActions} />}
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}
