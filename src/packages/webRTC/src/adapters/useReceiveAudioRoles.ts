import { useSFU } from "@gryt/voice";
import { useEffect } from "react";

import { applyReceiveAudioRoles } from "@/lib/receiveAudio";
import { useSockets } from "@/socket";

export function useReceiveAudioRoles(): void {
  const { currentServerConnected, streamSources } = useSFU();
  const { clients } = useSockets();
  useEffect(() => {
    const members = currentServerConnected ? Object.values(clients[currentServerConnected] || {}) : [];
    applyReceiveAudioRoles(streamSources, members);
  }, [clients, currentServerConnected, streamSources]);
}
