/* The conversation the chat pane is drawing right now. Kept apart from React state so a socket
   handler can ask it, to catch a message marked unread that should have been drawn (GRYT-1671). */

let shown: { host: string; conversationId: string } | null = null;

export function setOnScreenConversation(host: string | null, conversationId: string | null): void {
  shown = host && conversationId ? { host, conversationId } : null;
}

export function isOnScreen(host: string, conversationId: string | undefined): boolean {
  return !!conversationId && shown?.host === host && shown.conversationId === conversationId;
}

/* A new message marked unread in the conversation on screen means the handler that should
   have drawn it had different state from the screen. One line a message, so a report says which. */
export function warnUnreadOnScreen(path: string, detail: Record<string, unknown>): void {
  console.warn(`[Chat] ${path} marked the conversation on screen unread (GRYT-1671)`, {
    shown,
    ...detail,
  });
}
