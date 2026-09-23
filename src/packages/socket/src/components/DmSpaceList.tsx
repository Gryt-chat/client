import { Avatar, Button, ContextMenu } from "@gryt/ui";

import { getUploadsFileUrl, resolveAvatarSrc, serverIconSrc } from "@/common";

import type { DirectoryEntry } from "../hooks/dmDirectory";
import { conversationTitle, type DirectConversation } from "../hooks/useDirectMessages";
import { useServerManagement } from "../hooks/useServerManagement";
import { useSockets } from "../hooks/useSockets";
import { EmojiText } from "./EmojiText";
import { MarkAsReadItem } from "./MarkAsReadItem";
import { ServerMark } from "./ServerChip";
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
  entry, serverName, serverIcon, unread, selected, hidden, onOpen, onHide, onShow,
}: {
  entry: DirectoryEntry;
  serverName: string;
  serverIcon: string;
  unread: number;
  selected: boolean;
  /** Drawn back and named as hidden. It still opens and reads normally. */
  hidden?: boolean;
  onOpen: () => void;
  onHide?: () => void;
  onShow?: () => void;
}) {
  const { host, conversation } = entry;
  const title = conversationTitle(conversation);
  const isGroup = conversation.kind === "group";

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <div className="w-full">
        <Button
          tone={selected ? "primary" : "ghost"}
          /* Named rather than dimmed for a screen reader, which has no opacity.
             Selected still reads as selected: the tone is untouched. */
          aria-label={hidden ? `${title}, hidden` : undefined}
          style={{
            width: "100%", justifyContent: "start", overflow: "hidden", gap: "10px",
            ...(hidden && !selected ? { opacity: 0.55 } : {}),
          }}
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
            {/* The icon tells two rows with one name apart; the header names the server.
                Labelled, so a screen reader can tell them apart too. */}
            <span
              className="flex shrink-0 items-center gap-1 text-xs"
              style={{ color: "var(--gryt-neutral-10)" }}
            >
              <span
                role="img"
                aria-label={serverName}
                title={serverName}
                style={{ width: 12, height: 12, borderRadius: 3, overflow: "hidden", display: "block" }}
              >
                <ServerMark src={serverIcon} seed={serverName} />
              </span>
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
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup className="min-w-55">
            <ContextMenu.Group>
              <ContextMenu.GroupLabel>{title}</ContextMenu.GroupLabel>
            </ContextMenu.Group>
            <MarkAsReadItem
              host={host}
              scope={{ kind: "conversation", id: conversation.conversation_id }}
            />
            {onShow && (
              <>
                <ContextMenu.Separator />
                <ContextMenu.Item onClick={onShow}>Show in list</ContextMenu.Item>
              </>
            )}
            {onHide && (
              <>
                <ContextMenu.Separator />
                <ContextMenu.Item onClick={onHide}>
                  <div className="flex flex-col">
                    <span>Hide this conversation</span>
                    {/* Two things people assume it does and it doesn't: leave,
                        and follow you to your other devices. */}
                    <span className="text-xs text-gryt-muted">
                      Only on this device. Comes back if they write.
                    </span>
                  </div>
                </ContextMenu.Item>
              </>
            )}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function DmSpaceList({
  entries, selected, unreadFor, onOpen, onHide, onShow, hidden = false,
}: {
  entries: DirectoryEntry[];
  selected: { host: string; conversationId: string } | null;
  unreadFor: (host: string, conversationId: string) => number;
  onOpen: (host: string, conversation: DirectConversation) => void;
  /** Take it out of this device's list. Absent on the hidden rows. */
  onHide?: (entry: DirectoryEntry) => void;
  /** Put it back. Only passed for the hidden rows. */
  onShow?: (entry: DirectoryEntry) => void;
  /** Whether these are the hidden ones, which are drawn back. */
  hidden?: boolean;
}) {
  const { servers } = useServerManagement();
  const { serverDetailsList } = useSockets();

  return (
    <div className="flex flex-col gap-[2px]">
      {entries.map((entry) => (
        <ConversationRow
          key={`${entry.host}/${entry.conversation.conversation_id}`}
          entry={entry}
          serverName={servers[entry.host]?.name || entry.host}
          serverIcon={serverIconSrc(entry.host, servers[entry.host]?.name || "", serverDetailsList)}
          unread={unreadFor(entry.host, entry.conversation.conversation_id)}
          selected={
            selected?.host === entry.host &&
            selected?.conversationId === entry.conversation.conversation_id
          }
          hidden={hidden}
          onOpen={() => onOpen(entry.host, entry.conversation)}
          onHide={onHide ? () => onHide(entry) : undefined}
          onShow={onShow ? () => onShow(entry) : undefined}
        />
      ))}
    </div>
  );
}
