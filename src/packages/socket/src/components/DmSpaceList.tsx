import { conversationTitle, type DirectConversation } from "@gryt/core";
import { Avatar } from "@gryt/ui";

import { GeneratedServerIcon } from "@/common";

import type { DirectoryEntry } from "../hooks/dmDirectory";
import { useServerManagement } from "../hooks/useServerManagement";

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
  const { conversation } = entry;
  const isGroup = conversation.kind === "group";
  const title = conversationTitle(conversation);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-(--gryt-radius-sm) px-2 py-2 text-left"
      style={{
        background: selected ? "var(--gryt-neutral-4)" : "transparent",
        border: "none", cursor: "pointer",
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--gryt-neutral-3)"; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
    >
      <Avatar
        size="small"
        className={isGroup ? "rounded-(--gryt-radius-sm)" : ""}
        fallback={<GeneratedServerIcon seed={title} />}
      />

      <span className="flex min-w-0 flex-col" style={{ gap: "1px" }}>
        <span className="flex items-center gap-2" style={{ minWidth: 0 }}>
          <span
            className="truncate text-sm"
            style={{ fontWeight: 600, color: unread > 0 ? "#fff" : "var(--gryt-neutral-12)" }}
          >
            {title}
          </span>
          {/* The server is half the identity here, not a footnote: two rows can
              carry the same name and be different people. */}
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
      </span>

      <span className="ml-auto flex shrink-0 flex-col items-end" style={{ gap: "4px" }}>
        <span className="text-xs" style={{ color: "var(--gryt-neutral-10)", fontVariantNumeric: "tabular-nums" }}>
          {when(conversation.last_message_at)}
        </span>
        {unread > 0 && (
          <span
            className="grid place-items-center text-xs"
            style={{
              minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999,
              background: "var(--gryt-unread-9, var(--gryt-accent-9))",
              color: "var(--gryt-neutral-1)", fontWeight: 700, fontVariantNumeric: "tabular-nums",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </span>
    </button>
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
