import type { Client, Clients } from "../types/clients";

/** Each member's last `hasJoinedChannel` entry, by serverUserId, and the socket that sent it. */
export type HeldPresence = Record<string, { socketId: string; client: Client }>;

/** What a restarted server forgets until the member announces again. */
const HELD_FIELDS = [
  "hasJoinedChannel",
  "voiceChannelId",
  "isConnectedToVoice",
  "streamID",
  "isMuted",
  "isDeafened",
  "cameraEnabled",
  "cameraStreamID",
  "screenShareEnabled",
  "screenShareVideoStreamID",
  "screenShareAudioStreamID",
] as const satisfies readonly (keyof Client)[];

function heldFields(client: Client): Partial<Client> {
  const out: Partial<Client> = {};
  for (const key of HELD_FIELDS) {
    if (client[key] !== undefined) (out as Record<string, unknown>)[key] = client[key];
  }
  return out;
}

/**
 * The roster to draw. A member whose socket changed keeps their last voice state
 * until the new socket says where they are, or their media stops arriving.
 */
export function holdVoicePresence(
  fresh: Clients,
  held: HeldPresence,
  mediaLive: (client: Client) => boolean,
): { clients: Clients; held: HeldPresence } {
  const next: HeldPresence = {};
  const socketByUser = new Map<string, string>();

  for (const [socketId, client] of Object.entries(fresh)) {
    if (!client.serverUserId) continue;
    // A second socket for one user is a second device; the one in voice wins.
    if (!socketByUser.has(client.serverUserId) || client.hasJoinedChannel) {
      socketByUser.set(client.serverUserId, socketId);
    }
    if (client.hasJoinedChannel) next[client.serverUserId] = { socketId, client };
  }

  let clients = fresh;
  for (const [userId, last] of Object.entries(held)) {
    if (next[userId]) continue;

    const socketId = socketByUser.get(userId);
    // The same socket saying it isn't in voice is somebody who left.
    if (socketId === last.socketId) continue;
    if (!mediaLive(last.client)) continue;

    next[userId] = last;
    if (clients === fresh) clients = { ...fresh };
    const base = socketId ? fresh[socketId] : last.client;
    clients[socketId ?? last.socketId] = { ...base, ...heldFields(last.client) };
  }

  return { clients, held: next };
}

/** Your own entry: your socket's while the roster has it, otherwise the one with your serverUserId. */
export function resolveSelfClientId(
  clients: Clients,
  socketId: string | undefined,
  selfServerUserId: string | undefined,
): string | undefined {
  if (socketId && clients[socketId]) return socketId;
  if (!selfServerUserId) return socketId;

  const mine = Object.keys(clients).filter((id) => clients[id].serverUserId === selfServerUserId);
  return mine.find((id) => clients[id].hasJoinedChannel) ?? mine[0] ?? socketId;
}

/** Something reported per member, kept by serverUserId so it outlives the socket that sent it. */
export type ByServerUser<T> = Record<string, T>;

/** The key a member's reports are held under: their serverUserId, or the socket if they have none. */
export const heldKey = (clientId: string, client: Client): string => client.serverUserId ?? clientId;

/** Files a report sent from `clientId` under that member's key. A socket the roster doesn't know is dropped. */
export function recordByServerUser<T>(
  byUser: ByServerUser<T>,
  roster: Clients,
  clientId: string,
  value: T,
): ByServerUser<T> {
  const client = roster[clientId];
  return client ? { ...byUser, [heldKey(clientId, client)]: value } : byUser;
}

/** Drops members the roster no longer has in voice, so a rejoin starts with no stale figure. */
export function keepInVoice<T>(byUser: ByServerUser<T>, roster: Clients): ByServerUser<T> {
  const inVoice = new Set<string>();
  for (const [clientId, client] of Object.entries(roster)) {
    if (client.hasJoinedChannel) inVoice.add(heldKey(clientId, client));
  }
  const kept = Object.keys(byUser).filter((key) => inVoice.has(key));
  if (kept.length === Object.keys(byUser).length) return byUser;
  return Object.fromEntries(kept.map((key) => [key, byUser[key]]));
}

/** The same reports keyed by the roster's client ids, the way tiles look them up. */
export function byRosterClientId<T>(byUser: ByServerUser<T>, roster: Clients): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [clientId, client] of Object.entries(roster)) {
    const value = byUser[heldKey(clientId, client)];
    if (value !== undefined) out[clientId] = value;
  }
  return out;
}
