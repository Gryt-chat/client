import { Skeleton } from "@gryt/ui";

import { PiChatCircleFill, PiChatsFill, PiSmileyFill, PiSpeakerHighFill } from "../../../../lib/icons";
import { EmojiText } from "./EmojiText";

export const MessageHoverToolbar = ({
  onReply,
  onThread,
  hasThread,
  onDelete,
  canDelete,
  quickReactions,
  onQuickReaction,
  onOpenEmojiPicker,
}: {
  onReply?: () => void;
  onThread?: () => void;
  hasThread?: boolean;
  onDelete?: () => void;
  canDelete?: boolean;
  /**
   * The reactions this person uses most, already ordered and padded.
   *
   * Empty when they may not react here, which is why the toolbar takes a list
   * rather than a permission — the caller knows about permissions and this
   * does not.
   */
  quickReactions?: string[];
  onQuickReaction?: (src: string) => void;
  /** Open the full picker. Passed only when this person may react. */
  onOpenEmojiPicker?: () => void;
}) => {
  const showQuick = !!onQuickReaction && !!quickReactions && quickReactions.length > 0;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "1px",
        background: "var(--gryt-neutral-2)",
        border: "1px solid var(--gryt-neutral-6)",
        borderRadius: "var(--gryt-radius-md)",
        padding: "2px 3px",
        boxShadow: "0 2px 10px rgba(0, 0, 0, 0.18)",
        pointerEvents: "auto",
        /* Chrome, not content: the bar sits earlier in the DOM than the text
           it floats over, so a drag copied it too. */
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Reactions first, then a rule, then reply and delete.
          Reacting is the thing people do most and the thing this bar exists
          for, and putting it left of the divider keeps Delete at the far end,
          away from the pointer's path to everything else. */}
      {showQuick && quickReactions.map((src) => (
        <button
          key={src}
          onClick={() => onQuickReaction(src)}
          title={`React with ${src}`}
          aria-label={`React with ${src}`}
          style={{
            background: "none",
            border: "none",
            padding: "3px 5px",
            fontSize: "15px",
            lineHeight: 1,
            borderRadius: "var(--gryt-radius-md)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gryt-neutral-4)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        >
          <EmojiText text={src} emojiSize={16} disableTooltip />
        </button>
      ))}
      {onOpenEmojiPicker && (
        <button
          onClick={onOpenEmojiPicker}
          title="React with another emoji"
          aria-label="React with another emoji"
          style={{
            background: "none",
            border: "none",
            padding: "4px 6px",
            fontSize: "14px",
            lineHeight: 1,
            borderRadius: "var(--gryt-radius-md)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--gryt-neutral-11)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gryt-neutral-4)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        >
          <PiSmileyFill size={15} />
        </button>
      )}
      {(showQuick || onOpenEmojiPicker) && (onReply || (canDelete && onDelete)) && (
        <span
          aria-hidden="true"
          style={{
            width: "1px",
            alignSelf: "stretch",
            margin: "2px 3px",
            background: "var(--gryt-neutral-6)",
          }}
        />
      )}
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
            borderRadius: "var(--gryt-radius-md)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--gryt-neutral-11)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gryt-neutral-4)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        >
          ↩
        </button>
      )}
      {onThread && (
        <button
          onClick={onThread}
          title={hasThread ? "Open thread" : "Start thread"}
          aria-label={hasThread ? "Open thread" : "Start thread"}
          style={{
            background: "none",
            border: "none",
            padding: "4px 6px",
            fontSize: "14px",
            lineHeight: 1,
            borderRadius: "var(--gryt-radius-md)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: hasThread ? "var(--gryt-accent-11)" : "var(--gryt-neutral-11)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gryt-neutral-4)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
        >
          <PiChatsFill size={14} />
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
            borderRadius: "var(--gryt-radius-md)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--gryt-danger-11)",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gryt-danger-3)"; }}
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

/* Hallmark · component: empty-chat-state · genre: playful · theme: Gryt UI
 * interaction: the existing composer remains the single primary action
 * pre-emit critique: P5 H5 E5 S5 R5 V5
 */
export const WelcomeMessage = ({
  channelName,
  channelType = "text",
  conversationKind = "channel",
  serverName,
  automated = false,
}: {
  channelName?: string;
  channelType?: "text" | "voice";
  conversationKind?: "channel" | "dm";
  serverName?: string;
  /** An automated channel has no "say something" — nobody here can. GRYT-982. */
  automated?: boolean;
}) => (
  <div className="flex w-full max-w-xl flex-col px-6 py-12 sm:px-8">
    <div className="flex items-start gap-4 sm:items-center sm:gap-6">
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center border"
        style={{
          color: "var(--gryt-accent-9)",
          background: "var(--gryt-accent-3)",
          borderColor: "var(--gryt-neutral-7)",
          borderRadius: "var(--gryt-radius-md)",
        }}
        aria-hidden="true"
      >
        {conversationKind === "dm" ? <PiChatCircleFill size={22} /> : <ChannelIcon type={channelType} size={22} />}
      </div>

      <div className="min-w-0">
        <h2
          className="text-3xl font-bold leading-none tracking-tight"
          style={{ color: "var(--gryt-neutral-12)", overflowWrap: "anywhere" }}
        >
          {conversationKind === "dm" ? (
            <>
              You and <EmojiText text={channelName || "them"} />.
            </>
          ) : (
            <>
              {channelType === "text" && "#"}
              <EmojiText text={channelName || "channel"} /> is open.
            </>
          )}
        </h2>
        <p className="mt-2 text-lg text-gryt-muted" style={{ maxWidth: "45ch", lineHeight: 1.5 }}>
          {conversationKind === "dm"
            ? "Only the two of you can read this. Whoever runs the server can too."
            : automated
              ? "Nothing here yet. This one fills up when a bot or the system posts."
              : "There\u2019s nothing to catch up on. Start wherever you like."}
        </p>
      </div>
    </div>

    <div className="mt-6 h-px w-full bg-gryt-neutral-6" aria-hidden="true" />
    <p
      className="mt-4 text-xs text-gryt-muted sm:ml-16"
      style={{ maxWidth: "45ch", fontFamily: "var(--code-font-family)" }}
    >
      {conversationKind === "dm"
        ? `This conversation is on ${serverName || "this server"}. Messaging them on another server starts a separate one.`
        : automated
          ? "Only bots and the system write here."
          : "The first message begins the history."}
    </p>
  </div>
);
