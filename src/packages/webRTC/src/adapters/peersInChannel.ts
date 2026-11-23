type Client = { hasJoinedChannel?: boolean; voiceChannelId?: string; serverUserId?: string };

/** Who else is in the voice channel you're in: one entry per person, however many tabs they have. */
export function peersInChannel(clients: Record<string, Client>, channelId: string, selfSocketId: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const [id, c] of Object.entries(clients)) {
    if (id === selfSocketId || !c.hasJoinedChannel || c.voiceChannelId !== channelId) continue;
    out.add(c.serverUserId ?? id);
  }
  return out;
}

/** Which sound a change in the channel's people calls for. An arrival wins when both happen at once. */
export function peerChange(before: Set<string>, after: Set<string>): "join" | "leave" | null {
  if ([...after].some((p) => !before.has(p))) return "join";
  if ([...before].some((p) => !after.has(p))) return "leave";
  return null;
}
