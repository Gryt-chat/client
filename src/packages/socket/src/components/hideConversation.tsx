import { Button } from "@gryt/ui";
import { type ReactNode, useState } from "react";
import toast from "react-hot-toast";

import { markChannelRead } from "@/common";

import { hideConversation, showConversation } from "../hooks/hiddenConversations";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Hiding, with the way back attached: an Undo toast, and the Hidden group holds it.
 * It asks first anyway (GRYT-1759), since the button sits where a click lands by accident.
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

/** Asks before hiding. `ask` takes the conversation's name and what to do on Hide. */
export function useConfirmHide(): [(title: string, hide: () => void) => void, ReactNode] {
  const [pending, setPending] = useState<{ title: string; hide: () => void } | null>(null);
  const dialog = (
    <ConfirmDialog
      open={!!pending}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
      title={`Hide ${pending?.title ?? "this conversation"}?`}
      description="It moves to Hidden at the bottom of your list, on this device only. Nothing is deleted, and a new message brings it back."
      confirmLabel="Hide"
      confirmTone="primary"
      onConfirm={() => {
        pending?.hide();
        setPending(null);
      }}
    />
  );
  return [(title, hide) => setPending({ title, hide }), dialog];
}
