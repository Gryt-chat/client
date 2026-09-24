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
