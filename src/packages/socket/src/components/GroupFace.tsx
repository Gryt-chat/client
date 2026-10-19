import type { DirectConversation } from "@gryt/core";

import { getUploadsFileUrl, resolveAvatarSrc } from "@/common";

type ConversationParticipant = DirectConversation["other"];

// Three faces: two on top and one across the bottom, so no cell sits empty.
const AREAS: Record<number, string> = { 1: '"a"', 2: '"a b"', 3: '"a b" "c c"' };

/**
 * A group's picture, or up to four of its faces when nobody has uploaded one.
 * Rounded rather than round, scaled off --gryt-radius-md, so a group never reads as a person.
 */
export function GroupFace({
  host, conversation, self, size = 40,
}: {
  host: string;
  conversation: Pick<DirectConversation, "icon_file_id" | "members" | "name">;
  /** You, to fill the grid when the group has fewer than four other people. */
  self?: ConversationParticipant;
  size?: number;
}) {
  // The radius-md a 32px server icon has, kept in proportion at this size.
  const radius = `calc(var(--gryt-radius-md) * ${size / 32})`;
  const box = { width: size, height: size, borderRadius: radius, flexShrink: 0, overflow: "hidden" } as const;

  if (conversation.icon_file_id) {
    return (
      <img
        data-gryt="group-face"
        alt=""
        src={getUploadsFileUrl(host, conversation.icon_file_id, { thumb: true })}
        style={{ ...box, display: "block", objectFit: "cover" }}
      />
    );
  }

  const people = [...conversation.members, ...(self ? [self] : [])].slice(0, 4);
  const face = (p: ConversationParticipant) =>
    resolveAvatarSrc(
      p.avatar_file_id ? getUploadsFileUrl(host, p.avatar_file_id, { thumb: true }) : undefined,
      p.nickname,
      p.avatar_worn,
    );
  const areas = AREAS[people.length] ?? '"a b" "c d"';

  return (
    <span
      data-gryt="group-face"
      role="img"
      aria-label={`Group: ${people.map((p) => p.nickname).join(", ")}`}
      style={{
        ...box,
        display: "grid",
        gridTemplateAreas: areas,
        gridAutoRows: "minmax(0, 1fr)",
        gridAutoColumns: "minmax(0, 1fr)",
        background: "var(--gryt-neutral-4)",
      }}
    >
      {people.map((p, i) => (
        <img
          key={p.server_user_id}
          alt=""
          src={face(p)}
          style={{ gridArea: "abcd"[i], width: "100%", height: "100%", objectFit: "cover", display: "block", minWidth: 0, minHeight: 0 }}
        />
      ))}
    </span>
  );
}
