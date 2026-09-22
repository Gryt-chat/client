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
