import { SFUConnectionState, useSFU } from "@gryt/voice";
import { useEffect, useRef } from "react";

import { useSockets } from "@/socket";

import { peerChange, peersInChannel } from "./peersInChannel";
import { useVoiceSounds } from "./useVoiceSounds";

/** The "someone joined" and "someone left" sounds, for the channel you're connected to. */
export function usePeerVoiceSounds() {
  const { connectionState, currentServerConnected: host, currentChannelConnected: channel } = useSFU();
  const { clients, sockets } = useSockets();
  const { playPeerJoin, playPeerLeave } = useVoiceSounds();
  const last = useRef<{ call: string; peers: Set<string> } | null>(null);

  const hostClients = host ? clients[host] : undefined;
  const selfId = host ? sockets[host]?.id : undefined;
  useEffect(() => {
    if (connectionState !== SFUConnectionState.CONNECTED || !host || !channel) {
      last.current = null;
      return;
    }
    const call = `${host}/${channel}`;
    const peers = peersInChannel(hostClients ?? {}, channel, selfId);
    const before = last.current;
    last.current = { call, peers };
    // The people already there when you join are the baseline, not arrivals.
    if (!before || before.call !== call) return;
    const change = peerChange(before.peers, peers);
    if (change === "join") playPeerJoin();
    if (change === "leave") playPeerLeave();
    // Sound settings changing must not replay a join or leave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionState, host, channel, hostClients, selfId]);
}
