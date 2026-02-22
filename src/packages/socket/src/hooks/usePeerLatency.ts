import { useEffect, useState } from "react";
import { Socket } from "socket.io-client";

export interface PeerLatencyStats {
  estimatedOneWayMs: number | null;
  networkRttMs: number | null;
  jitterMs: number | null;
  codec: string | null;
  bitrateKbps: number | null;
}

/**
 * Listens for voice:latency:update events on the given socket and maintains
 * a map of clientId -> latency stats for all peers in the voice channel.
 */
export function usePeerLatency(socket: Socket | null): Record<string, PeerLatencyStats> {
  const [peerLatency, setPeerLatency] = useState<Record<string, PeerLatencyStats>>({});

  useEffect(() => {
    if (!socket) return;

    const onUpdate = (data: { clientId: string; latency: PeerLatencyStats }) => {
      if (!data?.clientId || !data?.latency) return;
      setPeerLatency((prev) => ({
        ...prev,
        [data.clientId]: data.latency,
      }));
    };

    const onDisconnect = () => setPeerLatency({});

    socket.on("voice:latency:update", onUpdate);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("voice:latency:update", onUpdate);
      socket.off("disconnect", onDisconnect);
    };
  }, [socket]);

  return peerLatency;
}
