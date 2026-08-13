import { Skeleton } from "@gryt/ui";
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
    <div className="flex flex-col" style={{ gap: 16, paddingBottom: "16px" }}>
      {skeletonGroups.map((group, i) => (
        <div className="flex gap-3 items-start" key={i} style={{ width: "100%" }}>
          <Skeleton width="51px" height="51px" style={{ borderRadius: "50%", flexShrink: 0 }} />
          <div className="flex flex-col gap-1" style={{ flex: 1 }}>
            <div className="flex items-baseline gap-2" style={{ marginBottom: 2 }}>
              <Skeleton height="14px" width="80px" style={{ opacity: 0.7 }} />
              <Skeleton height="10px" width="40px" style={{ opacity: 0.4 }} />
            </div>
            {group.lines.map((w, j) => (
              <Skeleton key={j} height="16px" width={w} style={{ opacity: 0.5 }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

const ChannelIcon = ({ type, size }: { type: "text" | "voice"; size: number }) =>
  type === "voice" ? <PiSpeakerHighFill size={size} /> : <PiChatCircleFill size={size} />;

export const WelcomeMessage = ({ channelName, channelType = "text", onStart }: { channelName?: string; channelType?: "text" | "voice"; onStart?: () => void }) => (
  <div className="flex flex-col" style={{ padding: "48px 24px", alignItems: "center", textAlign: "center" }}>
    <div style={{
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
      }}>
      <ChannelIcon type={channelType} size={48} />
    </div>

    <div className="flex items-center gap-2" style={{ marginBottom: "12px" }}>
      <span className="text-3xl font-bold" style={{ color: "var(--gray-12)", display: "inline-flex", alignItems: "center", gap: "8px" }}>
        Welcome to <ChannelIcon type={channelType} size={24} /> <EmojiText text={channelName || "channel"} />!
      </span>
    </div>

    <span className="text-lg text-gryt-muted" style={{ marginBottom: "24px", maxWidth: "500px", lineHeight: 1.5 }}>
      This is the start of the{" "}
      <span className="font-medium text-gryt-muted" style={{ display: "inline-flex", alignItems: "center", gap: "4px", verticalAlign: "middle" }}>
        <ChannelIcon type={channelType} size={16} /> <EmojiText text={channelName || "channel"} />
      </span>{" "}
      channel. Start a conversation by typing a message below.
    </span>

    {/*
      This looks like a button — border, fill, accent text, icon — so it has to
      behave like one. It used to be an inert Flex: clicking did nothing and did
      not focus the composer, so anything typed straight afterwards went nowhere
      at all, with no focus to receive it.
    */}
    <button className="flex items-center gap-3" type="button" onClick={onStart} style={{
        color: "var(--accent-9)",
        background: "var(--accent-2)",
        padding: "12px 20px",
        borderRadius: "var(--radius-4)",
        border: "1px solid var(--accent-6)",
        cursor: onStart ? "pointer" : "default",
        font: "inherit",
      }}>
        <span className="text-base">💬</span>
        <span className="text-base text-gryt-secondary font-medium">
          Type a message to get started
        </span>
      </button>
  </div>
);
