import type { Clients } from "../types/clients";

/**
 * Putting the conversation id back onto the clients the server would not name.
 * `voice:call:members` goes only into the call's room, so receiving it is proof.
 */

/** Who is in each conversation call, as this client last heard. */
export type CallMemberships = Record<string, string[]>;

/**
 * The clients map with each known call's id written back on. Returns the same
 * object when nothing changed, so `server:clients` does not churn references.
 */
export function applyCallMemberships(
  clients: Clients,
  memberships: CallMemberships,
): Clients {
  const conversationByMember = new Map<string, string>();
  for (const [conversationId, serverUserIds] of Object.entries(memberships)) {
    for (const serverUserId of serverUserIds) {
      conversationByMember.set(serverUserId, conversationId);
    }
  }
  if (conversationByMember.size === 0) return clients;

  let changed = false;
  const next: Clients = {};

  for (const [clientId, client] of Object.entries(clients)) {
    const conversationId = client.serverUserId
      ? conversationByMember.get(client.serverUserId)
      : undefined;

    // Only somebody the server says is in a call, and only while it still says
    // so. Writing an id onto a client who left keeps them in the call view.
    if (conversationId && client.hasJoinedChannel && client.voiceChannelId !== conversationId) {
      next[clientId] = { ...client, voiceChannelId: conversationId };
      changed = true;
    } else {
      next[clientId] = client;
    }
  }

  return changed ? next : clients;
}

/**
 * The memberships after one `voice:call:members`. An empty list drops the
 * conversation, so ids are not written back onto whoever next connects.
 */
export function rememberCallMembers(
  memberships: CallMemberships,
  conversationId: string,
  serverUserIds: string[],
): CallMemberships {
  const next = { ...memberships };
  if (serverUserIds.length === 0) delete next[conversationId];
  else next[conversationId] = [...serverUserIds];
  return next;
}
