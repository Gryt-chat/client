import { useEffect, useRef } from "react";
import { Socket } from "socket.io-client";

import { type LatencyBreakdown,useVoiceLatency } from "@/audio";
import { useSFU } from "@/webRTC";

const REPORT_INTERVAL_MS = 2000;

/**
 * Bridges useVoiceLatency with the socket connection to periodically
 * report this client's latency stats to all peers in the voice channel.
 */
export function useLatencyReporting(socket: Socket | null) {
  const { isConnected } = useSFU();
  const { latency } = useVoiceLatency(isConnected);
  const latencyRef = useRef<LatencyBreakdown>(latency);
  latencyRef.current = latency;

  useEffect(() => {
    if (!socket?.connected || !isConnected) return;

    const report = () => {
      const l = latencyRef.current;
      socket.emit("voice:latency:report", {
        estimatedOneWayMs: l.estimatedOneWayMs,
        networkRttMs: l.networkRttMs,
        jitterMs: l.jitterMs,
        codec: l.codec,
        bitrateKbps: l.bitrateKbps,
      });
    };

    report();
    const id = setInterval(report, REPORT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [socket, isConnected]);
}
