/**
 * A share's tile id. The first window keeps `screen:<client>`, which everything already
 * reads; later ones add `#<index>` (GRYT-1905).
 */
export function screenItemId(clientId: string, index: number): string {
  return index === 0 ? `screen:${clientId}` : `screen:${clientId}#${index}`;
}

export function parseScreenItem(itemId: string): { clientId: string; index: number } {
  const rest = itemId.startsWith("screen:") ? itemId.slice(7) : itemId;
  const hash = rest.lastIndexOf("#");
  if (hash < 0) return { clientId: rest, index: 0 };
  const index = Number(rest.slice(hash + 1));
  return Number.isInteger(index) && index > 0 ? { clientId: rest.slice(0, hash), index } : { clientId: rest, index: 0 };
}

interface ShareFields {
  screenShareVideoStreamID?: string;
  screenShareAudioStreamID?: string;
  screenShares?: { videoStreamID: string; audioStreamID: string }[];
}

/** One window's stream ids. A server from before the list only knows the first. */
export function shareOf(client: ShareFields | undefined, index: number): { videoStreamID: string; audioStreamID: string } {
  if (index > 0) return client?.screenShares?.[index] ?? { videoStreamID: "", audioStreamID: "" };
  return { videoStreamID: client?.screenShareVideoStreamID ?? "", audioStreamID: client?.screenShareAudioStreamID ?? "" };
}

/** How many windows a client is sharing, from the list where the server sends one. */
export function shareCount(client: ShareFields & { screenShareEnabled?: boolean } | undefined): number {
  if (!client?.screenShareEnabled || !client.screenShareVideoStreamID) return 0;
  return Math.max(1, client.screenShares?.length ?? 1);
}

/** Members with `sharing` set from the voice clients. The same array back when nobody shares. */
export function withSharing<M extends { serverUserId: string }>(
  members: M[],
  clients: Record<string, ShareFields & { screenShareEnabled?: boolean; serverUserId?: string }> | undefined,
): (M & { sharing?: number })[] {
  const by = new Map<string, number>();
  for (const c of Object.values(clients ?? {})) {
    const n = shareCount(c);
    if (n && c.serverUserId) by.set(c.serverUserId, n);
  }
  if (!by.size) return members;
  return members.map((m) => (by.has(m.serverUserId) ? { ...m, sharing: by.get(m.serverUserId) } : m));
}
