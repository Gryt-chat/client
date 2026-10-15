/**
 * A call asked for from outside a conversation, such as Call in a friend's menu
 * on Messages home. The view rings it once that conversation is the open one.
 */

let pending: { host: string; serverUserId: string } | null = null;

export function requestCall(host: string, serverUserId: string): void {
  pending = { host, serverUserId };
}

/** True once, for the conversation that was asked for. */
export function takeCallRequest(host: string, serverUserId: string | undefined): boolean {
  if (!pending || pending.host !== host || pending.serverUserId !== serverUserId) return false;
  pending = null;
  return true;
}
