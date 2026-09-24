import { senderStreamId as coreSenderStreamId } from "@gryt/core";

/** The engine keeps one sender per role on a connection, and each one keeps its stream id. */
export type SenderRole = "camera" | "screenVideo" | "screenAudio";

/** Typed wrapper: the id-keeping rule itself (GRYT-1251) now lives in @gryt/core. */
export function senderStreamId(
  pc: RTCPeerConnection | null | undefined,
  role: SenderRole,
  streamId: string,
): string {
  return coreSenderStreamId(pc, role, streamId);
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
