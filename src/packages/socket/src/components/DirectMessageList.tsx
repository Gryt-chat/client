import { Avatar, Button, ContextMenu } from "@gryt/ui";

import { getUploadsFileUrl, resolveAvatarSrc } from "@/common";

import { conversationTitle, type DirectConversation } from "../hooks/useDirectMessages";
import { EmojiText } from "./EmojiText";

/**
 * Conversations on this server, under the channel list — one section per kind.
 *
 * Under the channels rather than above the server rail, and that placement is
 * the whole point: these conversations belong to this server. The same person
 * on another server is a different conversation with different history, so a
 * list that sat outside the server would be claiming something untrue.
 *
 * Direct messages and groups get a section each rather than sharing one. They
 * behave the same and are drawn the same; what differs is that a group has a
 * name and a picture of its own, and mixing the two would put a row you can
 * rename next to one you cannot.
 */
export const DirectMessageList = ({
  conversations,
  serverHost,
  title,
  selectedConversationId,
  unreadConversationIds,
  onHide,
  onManage,
  onSelect,
}: {
  conversations: DirectConversation[];
  /** The heading over the section. */
  title: string;
  serverHost: string;
  selectedConversationId: string | null;
  unreadConversationIds?: Set<string>;
  onSelect: (conversation: DirectConversation) => void;
  /** Take it out of this person's own list. Absent on a server without it. */
  onHide?: (conversation: DirectConversation) => void;
  /** Open a group's settings. Only passed for the groups section. */
  onManage?: (conversation: DirectConversation) => void;
}) => {
  // No heading over an empty list. Somebody who has never opened a DM does not
  // need a section telling them so.
  if (conversations.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 w-full">
      <span
        className="text-xs text-gryt-muted"
        style={{ padding: "0 4px", marginTop: 8 }}
      >
        {title}
      </span>

      {conversations.map((conversation) => {
        const isSelected = conversation.conversation_id === selectedConversationId;
        const isUnread = !isSelected && !!unreadConversationIds?.has(conversation.conversation_id);

        return (
          <ContextMenu.Root key={conversation.conversation_id}>
          <ContextMenu.Trigger>
          <div className="flex flex-col items-start w-full relative">
            {isUnread && (
              <div
                className="absolute"
                style={{
                  top: "-2px",
                  right: "-2px",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: "var(--gryt-accent-9)",
                  zIndex: 1,
                  pointerEvents: "none",
                }}
              />
            )}
            <Button
              size="small"
              tone={isSelected ? "primary" : "ghost"}
              style={{ width: "100%", justifyContent: "start", overflow: "hidden" }}
              onClick={() => onSelect(conversation)}
            >
              <div className="flex items-center" style={{ flexShrink: 0 }}>
                {conversation.kind === "group" ? (
                  <Avatar
                    size="small"
                    className="rounded-(--gryt-radius-md)"
                    /* Eggs, seeded on the name, so renaming a group redraws it.
                       A square corner rather than a circle because a circle is
                       a person everywhere else in this list. */
                    eggSeed={conversationTitle(conversation)}
                    src={
                      conversation.icon_file_id
                        ? getUploadsFileUrl(serverHost, conversation.icon_file_id, { thumb: true })
                        : undefined
                    }
                  />
                ) : (
                  <Avatar
                    size="small"
                    fallback={conversation.other.nickname[0]}
                    src={resolveAvatarSrc(
                      conversation.other.avatar_file_id
                        ? getUploadsFileUrl(serverHost, conversation.other.avatar_file_id, { thumb: true })
                        : undefined,
                      conversation.other.nickname,
                      conversation.other.avatar_worn,
                    )}
                  />
                )}
              </div>
              <span
                className="truncate"
                style={{ flex: 1, minWidth: 0, textAlign: "left", display: "block" }}
              >
                <EmojiText text={conversationTitle(conversation)} />
              </span>
            </Button>
          </div>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Positioner>
              <ContextMenu.Popup className="min-w-55">
                <ContextMenu.Group>
                  <ContextMenu.GroupLabel style={{ fontWeight: "bold" }}>
                    {conversationTitle(conversation)}
                  </ContextMenu.GroupLabel>
                </ContextMenu.Group>
                {onManage && (
                  <>
                    <ContextMenu.Separator />
                    <ContextMenu.Item onClick={() => onManage(conversation)}>
                      Group settings
                    </ContextMenu.Item>
                  </>
                )}
                {onHide && (
                  <>
                    <ContextMenu.Separator />
                    <ContextMenu.Item onClick={() => onHide(conversation)}>
                      <div className="flex flex-col">
                        <span>Hide this conversation</span>
                        {/* Says what it does not do. "Hide" on its own reads as
                            a soft delete to enough people that the second line
                            earns its space. */}
                        <span className="text-xs text-gryt-muted">
                          Keeps the messages. Comes back if they write.
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
      })}
    </div>
  );
};
