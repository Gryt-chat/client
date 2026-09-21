/** The engine keeps one sender per role on a connection, and each one keeps its stream id. */
export type SenderRole = "camera" | "screenVideo" | "screenAudio";

// Keyed by connection rather than held in a component, so a remounted Controls still knows them.
const byConnection = new WeakMap<RTCPeerConnection, Partial<Record<SenderRole, string>>>();

/**
 * The stream id a role's sender was created with, which replaceTrack leaves in place (GRYT-1251).
 * The first stream given for a role on a connection names it; with no connection, `streamId` is returned.
 */
export function senderStreamId(
  pc: RTCPeerConnection | null | undefined,
  role: SenderRole,
  streamId: string,
): string {
  if (!pc) return streamId;
  let ids = byConnection.get(pc);
  if (!ids) {
    ids = {};
    byConnection.set(pc, ids);
  }
  return (ids[role] ??= streamId);
}

/** For after removeTrack, since the next track gets a new sender named after its own stream. */
export function forgetSenderStreamId(pc: RTCPeerConnection | null | undefined, role: SenderRole): void {
  if (pc) delete byConnection.get(pc)?.[role];
}
