import { useEffect, useMemo, useRef, useState } from "react";
import { Socket } from "socket.io-client";

import {
  byRosterClientId,
  type ByServerUser,
  keepInVoice,
  recordByServerUser,
} from "../lib/heldVoicePresence";
import type { Clients } from "../types/clients";

export interface PeerLatencyStats {
  estimatedOneWayMs: number | null;
  networkRttMs: number | null;
  jitterMs: number | null;
  codec: string | null;
  bitrateKbps: number | null;
}

/**
 * Latency for each peer in the call, keyed by client id in `roster`. Held by
 * serverUserId, so a figure outlives a server restart the way the tile does.
 */
export function usePeerLatency(
  socket: Socket | null,
  roster: Clients,
): Record<string, PeerLatencyStats> {
  const [byUser, setByUser] = useState<ByServerUser<PeerLatencyStats>>({});
  const rosterRef = useRef(roster);
  rosterRef.current = roster;

  useEffect(() => {
    if (!socket) return;
    setByUser({});

    const onUpdate = (data: { clientId: string; latency: PeerLatencyStats }) => {
      if (!data?.clientId || !data?.latency) return;
      setByUser((prev) => recordByServerUser(prev, rosterRef.current, data.clientId, data.latency));
    };

    socket.on("voice:latency:update", onUpdate);
    return () => {
      socket.off("voice:latency:update", onUpdate);
    };
  }, [socket]);

  useEffect(() => {
    setByUser((prev) => keepInVoice(prev, roster));
  }, [roster]);

  return useMemo(() => byRosterClientId(byUser, roster), [byUser, roster]);
}
