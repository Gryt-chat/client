import { Box, Button, Flex, Skeleton, Text } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";

import { getRecentReactions } from "../utils/recentReactions";
import { EmojiPicker } from "./EmojiPicker";
import { EmojiText } from "./EmojiText";

export const MessageContextMenu = ({
  position,
  onClose,
  onReply,
  onReport,
  onDelete,
  canDelete,
}: {
  position: { x: number; y: number };
  onClose: () => void;
  onReply: () => void;
  onReport: () => void;
  onDelete?: () => void;
  canDelete?: boolean;
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const [adjustedPosition, setAdjustedPosition] = useState(position);

  useEffect(() => {
    if (!menuRef.current) return;

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };

    let newX = position.x;
    let newY = position.y;

    if (position.x + rect.width > viewport.width) {
      newX = viewport.width - rect.width - 10;
    }
    if (newX < 10) newX = 10;

    if (position.y + rect.height > viewport.height) {
      newY = position.y - rect.height - 5;
    }
    if (newY < 10) newY = 10;

    setAdjustedPosition({ x: newX, y: newY });
  }, [position]);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        zIndex: 9999,
        background: 'var(--color-panel-solid)',
        border: '1px solid var(--gray-7)',
        borderRadius: 'var(--radius-5)',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.3), 0 4px 8px rgba(0, 0, 0, 0.1)',
        padding: '12px',
        minWidth: '220px',
        backdropFilter: 'blur(12px)',
        opacity: 1,
        transform: 'translateY(-2px)',
      }}
    >
      <Flex direction="column" gap="1">
        <Button
          variant="ghost"
          size="1"
          onClick={() => {
            onReply();
            onClose();
          }}
          style={{ justifyContent: 'flex-start' }}
        >
          Reply
        </Button>
        <Button
          variant="ghost"
          size="1"
          onClick={() => {
            onReport();
            onClose();
          }}
          style={{ justifyContent: 'flex-start', color: 'var(--red-11)' }}
        >
          Report
        </Button>
        {canDelete && onDelete && (
          <Button
            variant="ghost"
            size="1"
            onClick={() => {
              onDelete();
              onClose();
            }}
            style={{ justifyContent: 'flex-start', color: 'var(--red-11)' }}
          >
            Delete Message
          </Button>
        )}
      </Flex>
    </div>
  );
};

export const MessageHoverToolbar = ({
  onReaction,
  onReply,
  onDelete,
  canDelete,
  onPickerOpenChange,
}: {
  onReaction: (reactionSrc: string) => void;
  onReply?: () => void;
  onDelete?: () => void;
  canDelete?: boolean;
  onPickerOpenChange?: (open: boolean) => void;
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const recentReactions = getRecentReactions(3);

  return (
    <div
      style={{
        position: "absolute",
        top: "-16px",
        right: "8px",
        display: "inline-flex",
        alignItems: "center",
        gap: "1px",
        background: "var(--color-panel-solid)",
        border: "1px solid var(--gray-6)",
        borderRadius: "var(--radius-4)",
        padding: "2px 3px",
        boxShadow: "0 2px 10px rgba(0, 0, 0, 0.18)",
        zIndex: 10,
        pointerEvents: "auto",
        whiteSpace: "nowrap",
        width: "auto",
        overflow: "visible",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {recentReactions.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onReaction(emoji)}
          title={emoji}
          style={{
            background: "none",
            border: "none",
            padding: "4px 5px",
            fontSize: "16px",
            lineHeight: 1,
            borderRadius: "var(--radius-3)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-4)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        >
          {emoji}
        </button>
      ))}

      <div style={{ position: "relative", display: "inline-flex" }}>
        <button
          onClick={() => {
            const next = !pickerOpen;
            setPickerOpen(next);
            onPickerOpenChange?.(next);
          }}
          title="More reactions"
          style={{
            background: "none",
            border: "none",
            padding: "4px 5px",
            fontSize: "16px",
            lineHeight: 1,
            borderRadius: "var(--radius-3)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--gray-10)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-4)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        >
          +
        </button>
        {pickerOpen && (
          <EmojiPicker
            onSelect={(src) => onReaction(src)}
            onClose={() => {
              setPickerOpen(false);
              onPickerOpenChange?.(false);
            }}
          />
        )}
      </div>

      <div style={{ width: "1px", height: "18px", background: "var(--gray-5)", margin: "0 2px", flexShrink: 0 }} />

      {onReply && (
        <button
          onClick={onReply}
          title="Reply"
          style={{
            background: "none",
            border: "none",
            padding: "4px 6px",
            fontSize: "14px",
            lineHeight: 1,
            borderRadius: "var(--radius-3)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--gray-11)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-4)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        >
          ↩
        </button>
      )}
      {canDelete && onDelete && (
        <button
          onClick={onDelete}
          title="Delete"
          style={{
            background: "none",
            border: "none",
            padding: "4px 6px",
            fontSize: "13px",
            lineHeight: 1,
            borderRadius: "var(--radius-3)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--red-11)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--red-3)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        >
          🗑
        </button>
      )}
    </div>
  );
};

export const MessageSkeleton = () => {
  const skeletonGroups = [
    { lines: ["60%", "80%"] },
    { lines: ["45%"] },
    { lines: ["70%", "50%", "65%"] },
  ];

  return (
    <Flex direction="column" style={{ gap: 16, paddingBottom: "16px" }}>
      {skeletonGroups.map((group, i) => (
        <Flex key={i} gap="3" align="start" style={{ width: "100%" }}>
          <Skeleton width="51px" height="51px" style={{ borderRadius: "50%", flexShrink: 0 }} />
          <Flex direction="column" gap="1" style={{ flex: 1 }}>
            <Flex align="baseline" gap="2" style={{ marginBottom: 2 }}>
              <Skeleton height="14px" width="80px" style={{ opacity: 0.7 }} />
              <Skeleton height="10px" width="40px" style={{ opacity: 0.4 }} />
            </Flex>
            {group.lines.map((w, j) => (
              <Skeleton key={j} height="16px" width={w} style={{ opacity: 0.5 }} />
            ))}
          </Flex>
        </Flex>
      ))}
    </Flex>
  );
};

export const WelcomeMessage = ({ channelName }: { channelName?: string }) => (
  <Flex direction="column" style={{ padding: "48px 24px", alignItems: "center", textAlign: "center" }}>
    <Box
      style={{
        width: "120px",
        height: "120px",
        borderRadius: "50%",
        background: "var(--gray-4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: "24px",
        border: "3px solid var(--gray-6)",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)"
      }}
    >
      <Text size="8" weight="bold" color="gray">
        #
      </Text>
    </Box>

    <Text size="7" weight="bold" style={{ marginBottom: "12px", color: "var(--gray-12)" }}>
      Welcome to #<EmojiText text={channelName || "channel"} />!
    </Text>

    <Text size="4" color="gray" style={{ marginBottom: "24px", maxWidth: "500px", lineHeight: 1.5 }}>
      This is the start of the <Text weight="medium" color="gray">#<EmojiText text={channelName || "channel"} /></Text> channel.
      Start a conversation by typing a message below.
    </Text>

    <Flex
      align="center"
      gap="3"
      style={{
        color: "var(--accent-9)",
        background: "var(--accent-2)",
        padding: "12px 20px",
        borderRadius: "var(--radius-4)",
        border: "1px solid var(--accent-6)"
      }}
    >
      <Text size="3">💬</Text>
      <Text size="3" color="blue" weight="medium">
        Type a message to get started
      </Text>
    </Flex>
  </Flex>
);
