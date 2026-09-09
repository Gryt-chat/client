import { Avatar, Button } from "@gryt/ui";

import { GeneratedServerIcon, getUploadsFileUrl, resolveAvatarSrc } from "@/common";

import type { DirectoryEntry } from "../hooks/dmDirectory";
import { conversationTitle, type DirectConversation } from "../hooks/useDirectMessages";
import { useServerManagement } from "../hooks/useServerManagement";
import { EmojiText } from "./EmojiText";
import { UnreadIndicator } from "./UnreadIndicator";

/**
 * One row per conversation. Never grouped by person: the client is not told
 * whether the same nickname on another server is the same person (GRYT-1134).
 */

/** Short enough to sit beside a name: a time today, a weekday, then a date. */
function when(iso: string | null): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
  if (days < 1) return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (days < 7) return at.toLocaleDateString(undefined, { weekday: "short" });
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function ConversationRow({
  entry, serverName, unread, selected, onOpen,
}: {
  entry: DirectoryEntry;
  serverName: string;
  unread: number;
  selected: boolean;
  onOpen: () => void;
}) {
  const { host, conversation } = entry;
  const title = conversationTitle(conversation);
  const isGroup = conversation.kind === "group";

  return (
    <Button
      tone={selected ? "primary" : "ghost"}
      style={{ width: "100%", justifyContent: "start", overflow: "hidden", gap: "10px" }}
      onClick={onOpen}
    >
      {isGroup ? (
        <Avatar
          size="small"
          className="rounded-(--gryt-radius-md)"
          eggSeed={title}
          src={
            conversation.icon_file_id
              ? getUploadsFileUrl(host, conversation.icon_file_id, { thumb: true })
              : undefined
          }
        />
      ) : (
        <Avatar
          size="small"
          fallback={conversation.other.nickname[0]}
          src={resolveAvatarSrc(
            conversation.other.avatar_file_id
              ? getUploadsFileUrl(host, conversation.other.avatar_file_id, { thumb: true })
              : undefined,
            conversation.other.nickname,
            conversation.other.avatar_worn,
          )}
        />
      )}

      <span className="flex min-w-0 flex-1 items-center" style={{ gap: "8px", textAlign: "left" }}>
        <span className={`truncate${unread > 0 ? " font-semibold text-gryt-text" : ""}`}>
          <EmojiText text={title} />
        </span>
        {/* The server is half the identity: two rows can carry one name and be
            two different people, and its own icon points back at the rail. */}
        <span
          className="flex shrink-0 items-center gap-1 text-xs"
          style={{ color: "var(--gryt-neutral-10)" }}
        >
          <span style={{ width: 12, height: 12, borderRadius: 3, overflow: "hidden", display: "block" }}>
            <GeneratedServerIcon seed={serverName} />
          </span>
          {serverName}
          {isGroup ? ` · ${conversation.members.length + 1}` : ""}
        </span>
      </span>

      <span className="ml-auto flex shrink-0 items-center" style={{ gap: "8px" }}>
        <span
          className="text-xs"
          style={{ color: "var(--gryt-neutral-10)", fontVariantNumeric: "tabular-nums" }}
        >
          {when(conversation.last_message_at)}
        </span>
        <UnreadIndicator unread={unread} />
      </span>
    </Button>
  );
}

export function DmSpaceList({
  entries, selected, unreadFor, onOpen,
}: {
  entries: DirectoryEntry[];
  selected: { host: string; conversationId: string } | null;
  unreadFor: (host: string, conversationId: string) => number;
  onOpen: (host: string, conversation: DirectConversation) => void;
}) {
  const { servers } = useServerManagement();

  return (
    <div className="flex flex-col gap-[2px] overflow-y-auto px-2 pb-2">
      {entries.map((entry) => (
        <ConversationRow
          key={`${entry.host}/${entry.conversation.conversation_id}`}
          entry={entry}
          serverName={servers[entry.host]?.name || entry.host}
          unread={unreadFor(entry.host, entry.conversation.conversation_id)}
          selected={
            selected?.host === entry.host &&
            selected?.conversationId === entry.conversation.conversation_id
          }
          onOpen={() => onOpen(entry.host, entry.conversation)}
        />
      ))}
    </div>
  );
}
