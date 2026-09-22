import type { StreamSources } from "@gryt/voice";
import { useMemo, useRef } from "react";

import { type HeldPresence, holdVoicePresence, resolveSelfClientId } from "../lib/heldVoicePresence";
import type { Client, Clients } from "../types/clients";

type HostState = { held: HeldPresence; selfServerUserId?: string };

const hasLiveVideo = (stream: MediaStream | undefined) =>
  !!stream?.getVideoTracks().some((track) => track.readyState === "live");

/**
 * The host's roster with voice presence carried over a socket reconnect, and which
 * entry is you. A socket id changes on every reconnect; a serverUserId doesn't.
 */
export function useHeldVoicePresence({
  host,
  clients,
  socketId,
  selfInVoice,
  videoStreams,
  streamSources,
}: {
  host: string;
  clients: Clients;
  socketId: string | undefined;
  /** Still connected to this host's SFU, which outlives the server's socket. */
  selfInVoice: boolean;
  videoStreams?: Record<string, MediaStream>;
  streamSources?: StreamSources;
}): { clients: Clients; selfClientId: string | undefined } {
  const byHost = useRef<Record<string, HostState>>({});

  return useMemo(() => {
    const state = (byHost.current[host] ??= { held: {} });
    const liveSelf = socketId ? clients[socketId]?.serverUserId : undefined;
    if (liveSelf) state.selfServerUserId = liveSelf;
    const self = state.selfServerUserId;

    const mediaLive = (client: Client) =>
      self && client.serverUserId === self
        ? selfInVoice
        : Boolean(
            (client.streamID && streamSources?.[client.streamID]) ||
              (client.cameraStreamID && hasLiveVideo(videoStreams?.[client.cameraStreamID])),
          );

    const shown = holdVoicePresence(clients, state.held, mediaLive);
    state.held = shown.held;
    return {
      clients: shown.clients,
      selfClientId: resolveSelfClientId(shown.clients, socketId, self),
    };
  }, [host, clients, socketId, selfInVoice, videoStreams, streamSources]);
}
