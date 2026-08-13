import { ContextMenu } from "@gryt/ui";
import React, { type ReactNode, useCallback, useMemo } from "react";
import { PiArrowBendUpLeftFill, PiArrowSquareOutFill, PiCloudArrowDownFill, PiCopyFill, PiFlagFill, PiImageFill, PiPencilSimpleFill, PiSmileyFill, PiTrashFill } from "react-icons/pi";

import { triggerDownload } from "../utils/downloadFile";
import { copyImageToClipboard } from "../utils/mediaClipboard";
import { getRecentReactions } from "../utils/recentReactions";
import { EmojiPickerContent } from "./EmojiPicker";
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
  serverHost?: string;
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
          <div className="flex items-center gap-1">
            <PiImageFill size={14} />
            Copy Image
          </div>
        </ContextMenu.Item>
      )}
      <ContextMenu.Item onClick={() => void triggerDownload(media.src, media.fileName)}>
        <div className="flex items-center gap-1">
          <PiCloudArrowDownFill size={14} />
          Save As
        </div>
      </ContextMenu.Item>
      <ContextMenu.Item onClick={() => copyToClipboard(media.src)}>
        <div className="flex items-center gap-1">
          <PiCopyFill size={14} />
          Copy Link
        </div>
      </ContextMenu.Item>
      <ContextMenu.Separator />
      <ContextMenu.Item onClick={() => window.open(media.src, "_blank", "noopener,noreferrer")}>
        <div className="flex items-center gap-1">
          <PiArrowSquareOutFill size={14} />
          Open in Browser
        </div>
      </ContextMenu.Item>
    </>
  );
}

function QuickReactions({
  onReaction,
  serverHost,
}: {
  onReaction: (src: string) => void;
  serverHost?: string;
}) {
  const recent = useMemo(() => getRecentReactions(4, serverHost), [serverHost]);

  const handleEmojiSelect = useCallback((src: string) => {
    onReaction(src);
    const dismiss = () => document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    dismiss();
    setTimeout(dismiss, 16);
  }, [onReaction]);

  return (
    <>
      <div className="flex gap-1 px-2 py-1 justify-center">
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
              borderRadius: "var(--gryt-radius-sm)",
              padding: 0,
              flex: "0 0 auto",
            }}
          >
            <EmojiText text={src} emojiSize={22} disableTooltip />
          </ContextMenu.Item>
        ))}
        <ContextMenu.SubmenuRoot>
          <ContextMenu.SubmenuTrigger
            className="emoji-picker-sub-trigger"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              minWidth: "unset",
              borderRadius: "var(--gryt-radius-sm)",
              padding: 0,
              flex: "0 0 auto",
              color: "var(--gryt-neutral-10)",
            }}
          >
            <PiSmileyFill size={20} />
          </ContextMenu.SubmenuTrigger>
          <ContextMenu.Portal>
            <ContextMenu.Positioner sideOffset={2} alignOffset={-6}>
              <ContextMenu.Popup
                className="flex w-85 max-h-100 flex-col overflow-hidden p-0"
              >
            <EmojiPickerContent
              onSelect={handleEmojiSelect}
              serverHost={serverHost}
              autoFocusSearch={false}
            />
          </ContextMenu.Popup>
            </ContextMenu.Positioner>
          </ContextMenu.Portal>
        </ContextMenu.SubmenuRoot>
      </div>
      <ContextMenu.Separator />
    </>
  );
}

function MessageActionItems({ actions }: { actions: MessageActions }) {
  return (
    <>
      {actions.messageText && (
        <ContextMenu.Item onClick={() => copyToClipboard(actions.messageText!)}>
          <div className="flex items-center gap-1">
            <PiCopyFill size={14} />
            Copy Message
          </div>
        </ContextMenu.Item>
      )}
      {actions.onReply && (
        <ContextMenu.Item onClick={actions.onReply}>
          <div className="flex items-center gap-1">
            <PiArrowBendUpLeftFill size={14} />
            Reply
          </div>
        </ContextMenu.Item>
      )}
      {actions.canEdit && actions.onEdit && (
        <ContextMenu.Item onClick={actions.onEdit}>
          <div className="flex items-center gap-1">
            <PiPencilSimpleFill size={14} />
            Edit Message
          </div>
        </ContextMenu.Item>
      )}
      {actions.onReport && (
        <ContextMenu.Item onClick={actions.onReport}>
          <div className="flex items-center gap-1">
            <PiFlagFill size={14} />
            Report
          </div>
        </ContextMenu.Item>
      )}
      {actions.canDelete && actions.onDelete && (
        <ContextMenu.Item onClick={actions.onDelete}>
          <div className="flex items-center gap-1">
            <PiTrashFill size={14} />
            Delete Message
          </div>
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
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup className="min-w-45">
        {onReaction && (
          <QuickReactions onReaction={onReaction} serverHost={serverHost} />
        )}
        {media && <MediaItems media={media} />}
        {media && hasMessageActions && <ContextMenu.Separator />}
        {hasMessageActions && <MessageActionItems actions={messageActions} />}
      </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
