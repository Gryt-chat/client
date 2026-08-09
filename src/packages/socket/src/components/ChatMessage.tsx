import { Box, Flex, Skeleton, Text } from "@radix-ui/themes";
import { PiChatCircleFill, PiSpeakerHighFill } from "react-icons/pi";

import { EmojiText } from "./EmojiText";

export const MessageHoverToolbar = ({
  onReply,
  onDelete,
  canDelete,
}: {
  onReply?: () => void;
  onDelete?: () => void;
  canDelete?: boolean;
}) => {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "1px",
        background: "var(--color-panel-solid)",
        border: "1px solid var(--gray-6)",
        borderRadius: "var(--radius-4)",
        padding: "2px 3px",
        boxShadow: "0 2px 10px rgba(0, 0, 0, 0.18)",
        pointerEvents: "auto",
        whiteSpace: "nowrap",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
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

const ChannelIcon = ({ type, size }: { type: "text" | "voice"; size: number }) =>
  type === "voice" ? <PiSpeakerHighFill size={size} /> : <PiChatCircleFill size={size} />;

export const WelcomeMessage = ({ channelName, channelType = "text", onStart }: { channelName?: string; channelType?: "text" | "voice"; onStart?: () => void }) => (
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
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
        color: "var(--gray-9)",
      }}
    >
      <ChannelIcon type={channelType} size={48} />
    </Box>

    <Flex align="center" gap="2" style={{ marginBottom: "12px" }}>
      <Text size="7" weight="bold" style={{ color: "var(--gray-12)", display: "inline-flex", alignItems: "center", gap: "8px" }}>
        Welcome to <ChannelIcon type={channelType} size={24} /> <EmojiText text={channelName || "channel"} />!
      </Text>
    </Flex>

    <Text size="4" color="gray" style={{ marginBottom: "24px", maxWidth: "500px", lineHeight: 1.5 }}>
      This is the start of the{" "}
      <Text weight="medium" color="gray" style={{ display: "inline-flex", alignItems: "center", gap: "4px", verticalAlign: "middle" }}>
        <ChannelIcon type={channelType} size={16} /> <EmojiText text={channelName || "channel"} />
      </Text>{" "}
      channel. Start a conversation by typing a message below.
    </Text>

    {/*
      This looks like a button — border, fill, accent text, icon — so it has to
      behave like one. It used to be an inert Flex: clicking did nothing and did
      not focus the composer, so anything typed straight afterwards went nowhere
      at all, with no focus to receive it.
    */}
    <Flex
      asChild
      align="center"
      gap="3"
      style={{
        color: "var(--accent-9)",
        background: "var(--accent-2)",
        padding: "12px 20px",
        borderRadius: "var(--radius-4)",
        border: "1px solid var(--accent-6)",
        cursor: onStart ? "pointer" : "default",
        font: "inherit",
      }}
    >
      <button type="button" onClick={onStart}>
        <Text size="3">💬</Text>
        <Text size="3" color="blue" weight="medium">
          Type a message to get started
        </Text>
      </button>
    </Flex>
  </Flex>
);
