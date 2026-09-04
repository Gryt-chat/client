import type { Clients } from "../types/clients";

/**
 * Putting the conversation id back onto the clients the server would not name.
 *
 * The server blanks it out of `members:list` and `server:clients` deliberately:
 * both go to every member of the server, and a one-to-one id is a hash of the
 * sorted pair, so anybody holding a member list could read back who is talking
 * to whom. Blanked, nothing downstream matches on `voiceChannelId` and a call
 * drew nobody in it, including yourself.
 *
 * `voice:call:members` closes that. The server sends it only into the call's
 * own socket.io room, so receiving it is itself the proof of being allowed to
 * know.
 *
 * The memberships are remembered so they survive the next `server:clients`
 * re-blanking them, and a member who has since left the room has their id taken
 * away again rather than left behind.
 */

/** Who is in each conversation call, as this client last heard. */
export type CallMemberships = Record<string, string[]>;

/**
 * The clients map with each known call's id written back on.
 *
 * Returns the same object when nothing changed, so this can sit in the
 * `server:clients` path without making every update a new reference.
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
    // they have joined one. Writing an id onto a client who has left would keep
    // them in the call view after they hung up.
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
 * The memberships after one `voice:call:members`.
 *
 * An empty list drops the conversation rather than storing nothing under it —
 * a call that ended should stop being remembered, or the ids would be written
 * back onto whoever next connects with those member ids.
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
