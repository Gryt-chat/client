import { Skeleton } from "@gryt/ui";
import type { CSSProperties, MouseEvent } from "react";

import type { SealDecision } from "@/common";

import { PiArrowBendUpLeftBold, PiChatCircleFill, PiDotsThreeBold, PiSmileyBold, PiSpeakerHighFill } from "../../../../lib/icons";
import { EmojiText } from "./EmojiText";

/* Sized to the GRYT-1722 drafts: 36px buttons, 21px emoji, 20px icons. */
const BAR_BUTTON: CSSProperties = {
  width: 36,
  height: 36,
  padding: 0,
  border: "none",
  borderRadius: 8,
  background: "none",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--gryt-neutral-11)",
  transition: "background 0.15s",
};
const hoverOn = (e: MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = "var(--gryt-neutral-5)"; };
const hoverOff = (e: MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = "none"; };

export const MessageHoverToolbar = ({
  onReply,
  onMore,
  quickReactions,
  onQuickReaction,
  onOpenEmojiPicker,
}: {
  onReply?: () => void;
  /** Opens the message's own menu at the button, where thread, pin, edit and delete live. */
  onMore?: (anchor: HTMLElement) => void;
  /**
   * The reactions this person uses most, already ordered and padded. Empty when
   * they may not react here, which is why this takes a list not a permission.
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
        gap: 2,
        background: "var(--gryt-neutral-3)",
        border: "1px solid var(--gryt-neutral-6)",
        borderRadius: 12,
        padding: "3px 5px",
        boxShadow: "0 6px 20px rgba(0, 0, 0, 0.5)",
        pointerEvents: "auto",
        /* Chrome, not content: the bar sits earlier in the DOM than the text
           it floats over, so a drag copied it too. */
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Reactions first, then reply and the menu, like Teams. Thread, pin, edit
          and delete moved into that menu, which is also the right-click menu (GRYT-1722). */}
      {showQuick && quickReactions.map((src) => (
        <button
          key={src}
          onClick={() => onQuickReaction(src)}
          title={`React with ${src}`}
          aria-label={`React with ${src}`}
          style={{ ...BAR_BUTTON, fontSize: 21, lineHeight: 1 }}
          onMouseEnter={hoverOn}
          onMouseLeave={hoverOff}
        >
          <EmojiText text={src} emojiSize={22} disableTooltip />
        </button>
      ))}
      {onOpenEmojiPicker && (
        <button
          onClick={onOpenEmojiPicker}
          title="React with another emoji"
          aria-label="React with another emoji"
          style={BAR_BUTTON}
          onMouseEnter={hoverOn}
          onMouseLeave={hoverOff}
        >
          <PiSmileyBold size={20} />
        </button>
      )}
      {(showQuick || onOpenEmojiPicker) && (onReply || onMore) && (
        <span
          aria-hidden="true"
          style={{ width: 1, height: 22, margin: "0 4px", background: "var(--gryt-neutral-6)" }}
        />
      )}
      {onReply && (
        <button
          onClick={onReply}
          title="Reply"
          style={BAR_BUTTON}
          onMouseEnter={hoverOn}
          onMouseLeave={hoverOff}
        >
          <PiArrowBendUpLeftBold size={20} />
        </button>
      )}
      {onMore && (
        <button
          onClick={(e) => onMore(e.currentTarget)}
          title="More"
          aria-label="More"
          style={BAR_BUTTON}
          onMouseEnter={hoverOn}
          onMouseLeave={hoverOff}
        >
          <PiDotsThreeBold size={20} />
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
 * interaction: the existing composer remains the single primary action */
export const WelcomeMessage = ({
  channelName,
  channelType = "text",
  conversationKind = "channel",
  serverName,
  automated = false,
  sealing,
}: {
  channelName?: string;
  channelType?: "text" | "voice";
  conversationKind?: "channel" | "dm";
  serverName?: string;
  /** An automated channel has no "say something" — nobody here can. GRYT-982. */
  automated?: boolean;
  /* Unknown reads as unencrypted, the same way the banner above this treats it:
     of the two ways to be wrong while the keys load, understating is free. */
  sealing?: SealDecision;
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
            ? sealing?.kind === "seal"
              ? "Nothing here yet. What you send is encrypted on this device, so the server stores something it can\u2019t open."
              : "Nothing here yet. This one isn\u2019t encrypted, so whoever runs the server can read it."
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
