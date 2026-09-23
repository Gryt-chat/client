import { Button } from "@gryt/ui";
import toast from "react-hot-toast";

import { markChannelRead } from "@/common";

import { hideConversation, showConversation } from "../hooks/hiddenConversations";

/**
 * Hiding, with the way back attached. No confirm: the row is one click from
 * being back, and the Hidden group holds it in the meantime.
 */

/* Long enough to notice what happened and reach for Undo, short enough that it
   is gone before the next thing you do. */
const UNDO_MS = 5_000;

export function hideConversationWithUndo(
  host: string,
  serverUserId: string,
  conversationId: string,
  title: string,
): void {
  hideConversation(host, serverUserId, conversationId);

  /* Otherwise a badge counted for a row nobody can see, and the server's own dot
     kept pointing at a conversation that is not in the list. */
  markChannelRead(host, conversationId);

  const id = `hidden:${host}:${conversationId}`;
  toast(
    () => (
      <span className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate">Hid {title}</span>
        <Button
          size="xsmall"
          tone="ghost"
          onClick={() => {
            showConversation(host, serverUserId, conversationId);
            toast.dismiss(id);
          }}
        >
          Undo
        </Button>
      </span>
    ),
    { id, duration: UNDO_MS },
  );
}
