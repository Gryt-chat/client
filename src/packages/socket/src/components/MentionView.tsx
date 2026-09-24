import { type ReactNode, useContext } from "react";

import { channelNamesFor, openChannelLink } from "@/lib/channelDirectory";
import { PRIVATE_CHANNEL } from "@/lib/mentionTokens";

import { MentionViewerContext } from "./mentionViewerContext";


const PILL = {
  fontWeight: 600,
  borderRadius: "var(--gryt-radius-sm)",
  padding: "0 2px",
} as const;

function pillStyle(hitsMe: boolean) {
  return {
    ...PILL,
    color: "var(--gryt-accent-11)",
    background: hitsMe ? "var(--gryt-accent-a5)" : "var(--gryt-accent-a3)",
    cursor: "default",
  };
}

/** A user, @everyone, @here or role mention. */
export function MentionPill({
  userId,
  roleId,
  children,
}: {
  userId?: string;
  roleId?: string;
  children: ReactNode;
}) {
  const viewer = useContext(MentionViewerContext);
  let hitsMe = false;
  let label = children;
  let color: string | null = null;

  if (roleId) {
    const role = viewer?.roles.get(roleId);
    if (role) label = `@${role.name}`;
    color = role?.color ?? null;
    hitsMe = !!viewer?.massAllowed && viewer.roleIds.includes(roleId);
  } else if (userId === "everyone" || userId === "here") {
    hitsMe = !!viewer?.massAllowed && !viewer.suppressEveryone;
  } else if (userId) {
    hitsMe = !!viewer?.meId && viewer.meId === userId;
  }

  return (
    <span
      className="chat-mention"
      data-mention-hit={hitsMe ? "true" : undefined}
      style={{ ...pillStyle(hitsMe), ...(color ? { color } : null) }}
    >
      {label}
    </span>
  );
}

/** A #channel link, or a grey #private-channel for one this reader can't see. */
export function ChannelMention({ channelId, host }: { channelId: string; host: string | null }) {
  const viewer = useContext(MentionViewerContext);
  const home = viewer?.host ?? null;
  const lookup = viewer?.channelName ?? (home ? channelNamesFor(home) : null);
  const name = lookup ? lookup(channelId, host) : null;
  const target = host ?? home;

  if (!name || !target) {
    return (
      <span
        className="chat-channel-mention"
        data-private="true"
        style={{ ...PILL, color: "var(--gryt-neutral-9)", background: "var(--gryt-neutral-a3)" }}
      >
        {PRIVATE_CHANNEL}
      </span>
    );
  }

  return (
    <span
      role="link"
      tabIndex={0}
      className="chat-channel-mention"
      data-channel-id={channelId}
      onClick={() => openChannelLink(target, channelId)}
      onKeyDown={(e) => {
        if (e.key === "Enter") openChannelLink(target, channelId);
      }}
      style={{ ...pillStyle(false), cursor: "pointer" }}
    >
      #{name}
    </span>
  );
}
