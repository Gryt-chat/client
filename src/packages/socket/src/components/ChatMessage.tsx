import { Skeleton } from "@gryt/ui";

import type { SealDecision } from "@/common";

import { PiChatTeardropTextFill, PiSpeakerHighFill } from "../../../../lib/icons";
import { EmojiText } from "./EmojiText";


function emptyLine(kind: "channel" | "dm" | undefined, sealed: boolean, automated: boolean | undefined): string {
  if (kind === "dm" && sealed) {
    return "Nothing here yet. What you send is encrypted on this device, so the server stores something it can\u2019t open.";
  }
  if (kind === "dm") return "Nothing here yet. This one isn\u2019t encrypted, so whoever runs the server can read it.";
  if (automated) return "Nothing here yet. This one fills up when a bot or the system posts.";
  return "There\u2019s nothing to catch up on. Start wherever you like.";
}

function historyLine(kind: "channel" | "dm" | undefined, serverName: string | undefined, automated: boolean | undefined): string {
  if (kind === "dm") return `This conversation is on ${serverName || "this server"}. Messaging them on another server starts a separate one.`;
  return automated ? "Only bots and the system write here." : "The first message begins the history.";
}

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
  type === "voice" ? <PiSpeakerHighFill size={size} /> : <PiChatTeardropTextFill size={size} />;

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
        {conversationKind === "dm" ? <PiChatTeardropTextFill size={22} /> : <ChannelIcon type={channelType} size={22} />}
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
          {emptyLine(conversationKind, sealing?.kind === "seal", automated)}
        </p>
      </div>
    </div>

    <div className="mt-6 h-px w-full bg-gryt-neutral-6" aria-hidden="true" />
    <p
      className="mt-4 text-xs text-gryt-muted sm:ml-16"
      style={{ maxWidth: "45ch", fontFamily: "var(--code-font-family)" }}
    >
      {historyLine(conversationKind, serverName, automated)}
    </p>
  </div>
);
