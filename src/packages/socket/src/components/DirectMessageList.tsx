import { Avatar, Button } from "@gryt/ui";

import { getUploadsFileUrl, resolveAvatarSrc } from "@/common";

import type { DirectConversation } from "../hooks/useDirectMessages";
import { EmojiText } from "./EmojiText";

/**
 * The direct messages open on this server, under the channel list.
 *
 * Under the channels rather than above the server rail, and that placement is
 * the whole point: these conversations belong to this server. The same person
 * on another server is a different conversation with different history, so a
 * list that sat outside the server would be claiming something untrue.
 */
export const DirectMessageList = ({
  conversations,
  serverHost,
  selectedConversationId,
  unreadConversationIds,
  onSelect,
}: {
  conversations: DirectConversation[];
  serverHost: string;
  selectedConversationId: string | null;
  unreadConversationIds?: Set<string>;
  onSelect: (conversation: DirectConversation) => void;
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
        Direct messages
      </span>

      {conversations.map((conversation) => {
        const isSelected = conversation.conversation_id === selectedConversationId;
        const isUnread = !isSelected && !!unreadConversationIds?.has(conversation.conversation_id);

        return (
          <div
            key={conversation.conversation_id}
            className="flex flex-col items-start w-full relative"
          >
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
              </div>
              <span
                className="truncate"
                style={{ flex: 1, minWidth: 0, textAlign: "left", display: "block" }}
              >
                <EmojiText text={conversation.other.nickname} />
              </span>
            </Button>
          </div>
        );
      })}
    </div>
  );
};
