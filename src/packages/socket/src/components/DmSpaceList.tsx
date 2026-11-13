import { Avatar, ContextMenu, ConversationItem } from "@gryt/ui";
import { Reorder } from "motion/react";

import { getOwnServerUserId, getUploadsFileUrl, resolveAvatarSrc } from "@/common";

import type { DirectoryEntry } from "../hooks/dmDirectory";
import { isPinned, pinFor, setPinned } from "../hooks/dmPins";
import { type ConversationPreview, previewKey } from "../hooks/useConversationPreviews";
import { conversationTitle, type DirectConversation } from "../hooks/useDirectMessages";
import { useServerManagement } from "../hooks/useServerManagement";
import { useSockets } from "../hooks/useSockets";
import type { UserStatus } from "../types/clients";
import { EmojiText } from "./EmojiText";
import { GroupFace } from "./GroupFace";
import { MarkAsReadItem } from "./MarkAsReadItem";

type ConversationParticipant = DirectConversation["other"];

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
  entry, serverName, unread, selected, hidden, otherStatus, self, clash, pinned, preview, onOpen, onHide, onShow,
}: {
  entry: DirectoryEntry;
  serverName: string;
  unread: number;
  selected: boolean;
  /** Drawn back and named as hidden. It still opens and reads normally. */
  hidden?: boolean;
  /** The other party's presence, 1:1 conversations only. Undefined is "no data",
      never drawn as offline (GRYT-1467). */
  otherStatus?: UserStatus;
  /** You, so a small group's grid has a fourth face. */
  self?: ConversationParticipant;
  /** Another row carries the same name, so this one names its server. */
  clash: boolean;
  pinned: boolean;
  preview?: ConversationPreview;
  onOpen: () => void;
  onHide?: () => void;
  onShow?: () => void;
}) {
  const { host, conversation } = entry;
  const title = conversationTitle(conversation);
  const isGroup = conversation.kind === "group";
  const groupSize = isGroup ? `${conversation.members.length + 1} people` : undefined;
  const subtitle = preview ? <EmojiText text={preview.text} /> : groupSize;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <ConversationItem
          data-gryt="dm-row"
          data-selected={selected || undefined}
          /* Named rather than dimmed for a screen reader, which has no opacity. */
          aria-label={hidden ? `${title}, hidden` : undefined}
          onClick={onOpen}
          active={selected}
          hidden={hidden}
          pinned={pinned}
          unread={unread}
          presence={isGroup ? undefined : otherStatus}
          note={clash ? serverName : undefined}
          meta={when(conversation.last_message_at)}
          title={<EmojiText text={title} />}
          subtitle={subtitle}
          avatar={
            isGroup ? (
              <GroupFace host={host} conversation={conversation} self={self} size={40} />
            ) : (
              <Avatar
                size="medium"
                fallback={conversation.other.nickname[0]}
                src={resolveAvatarSrc(
                  conversation.other.avatar_file_id
                    ? getUploadsFileUrl(host, conversation.other.avatar_file_id, { thumb: true })
                    : undefined,
                  conversation.other.nickname,
                  conversation.other.avatar_worn,
                )}
              />
            )
          }
        />
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup className="min-w-55">
            <ContextMenu.Group>
              <ContextMenu.GroupLabel>{title}</ContextMenu.GroupLabel>
            </ContextMenu.Group>
            <ContextMenu.Item onClick={() => setPinned(pinFor(entry), !pinned)}>
              {pinned ? "Unpin" : "Pin to the top"}
            </ContextMenu.Item>
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
  entries, selected, unreadFor, onOpen, onHide, onShow, hidden = false, previews, clashes, reorder,
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
  previews: ReadonlyMap<string, ConversationPreview>;
  /** Names that appear on more than one row, across every list. */
  clashes: ReadonlySet<string>;
  /** Given for the pinned rows: drag one and this gets the new order. */
  reorder?: (order: DirectoryEntry[]) => void;
}) {
  const { servers } = useServerManagement();
  const { memberLists } = useSockets();

  const rowFor = (entry: DirectoryEntry) => {
    const own = memberLists[entry.host]?.find((m) => m.serverUserId === getOwnServerUserId(entry.host));
    const title = conversationTitle(entry.conversation);
    return (
      <ConversationRow
        entry={entry}
        serverName={servers[entry.host]?.name || entry.host}
        unread={unreadFor(entry.host, entry.conversation.conversation_id)}
        selected={
          selected?.host === entry.host &&
          selected?.conversationId === entry.conversation.conversation_id
        }
        hidden={hidden}
        /* Same member list the sidebar reads presence off; a member it hides
           from this viewer never has an entry to find (GRYT-1467). */
        otherStatus={
          entry.conversation.kind === "dm"
            ? memberLists[entry.host]?.find(
                (m) => m.serverUserId === entry.conversation.other.server_user_id,
              )?.status
            : undefined
        }
        self={own ? { server_user_id: own.serverUserId, nickname: own.nickname, avatar_file_id: own.avatarFileId ?? null, avatar_worn: own.avatarWorn ?? null } : undefined}
        clash={entry.conversation.kind === "dm" && clashes.has(title)}
        pinned={isPinned(pinFor(entry))}
        preview={previews.get(previewKey(entry.host, entry.conversation.conversation_id))}
        onOpen={() => onOpen(entry.host, entry.conversation)}
        onHide={onHide ? () => onHide(entry) : undefined}
        onShow={onShow ? () => onShow(entry) : undefined}
      />
    );
  };

  const id = (entry: DirectoryEntry) => `${entry.host}/${entry.conversation.conversation_id}`;

  if (reorder) {
    return (
      <Reorder.Group axis="y" values={entries} onReorder={reorder} className="flex flex-col gap-[2px]" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {entries.map((entry) => (
          <Reorder.Item key={id(entry)} value={entry} style={{ listStyle: "none" }}>
            {rowFor(entry)}
          </Reorder.Item>
        ))}
      </Reorder.Group>
    );
  }

  return (
    <div className="flex flex-col gap-[2px]">
      {entries.map((entry) => (
        <div key={id(entry)}>{rowFor(entry)}</div>
      ))}
    </div>
  );
}
