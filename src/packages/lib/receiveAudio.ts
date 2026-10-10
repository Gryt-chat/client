import type { ReceiveAudioRole, StreamSources } from "@gryt/voice";

type RemoteAudioClient = { streamID?: string; screenShareAudioStreamID?: string };

export function receiveAudioRoles(clients: RemoteAudioClient[]): Map<string, ReceiveAudioRole> {
  const roles = new Map<string, ReceiveAudioRole>();
  for (const client of clients) {
    if (client.streamID) roles.set(client.streamID, "microphone");
  }
  for (const client of clients) {
    if (client.screenShareAudioStreamID) roles.set(client.screenShareAudioStreamID, "screen");
  }
  return roles;
}

export function applyReceiveAudioRoles(sources: StreamSources, clients: RemoteAudioClient[]): void {
  const roles = receiveAudioRoles(clients);
  for (const [id, source] of Object.entries(sources)) {
    source.receiveCleanup?.setRole(roles.get(id) || "unknown");
  }
}

export function setReceiveAudioGain(source: StreamSources[string] | undefined, value: number, time: number): void {
  if (!source) return;
  const gain = Number.isFinite(value) ? Math.max(0, value) : 0;
  source.receiveCleanup?.setMuted(gain === 0);
  source.gain.gain.setValueAtTime(gain, time);
}
