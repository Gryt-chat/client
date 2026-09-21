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

const sendersByConnection = new WeakMap<RTCPeerConnection, Partial<Record<SenderRole, RTCRtpSender>>>();

/**
 * The role's sender, found by its track while that's on it. A resumed sender only gets its
 * track when replaceTrack resolves, so until then this is the one found before (GRYT-1329).
 */
export function roleSender(pc: RTCPeerConnection, role: SenderRole, track: MediaStreamTrack): RTCRtpSender | null {
  let senders = sendersByConnection.get(pc);
  if (!senders) {
    senders = {};
    sendersByConnection.set(pc, senders);
  }
  const found = pc.getSenders().find((sender) => sender.track === track);
  if (found) senders[role] = found;
  return senders[role] ?? null;
}
