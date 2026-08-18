import { setVoiceHost,VoiceConfigProvider, VoiceSingletonHooks } from "@gryt/voice";
import { type ReactNode,useMemo } from "react";

import { useServerManagement, useSockets } from "@/socket";

import { createRoomCoordinator } from "./roomCoordinator";
import { useVoiceConfigFromSettings } from "./voiceConfig";
import { electronVoiceHost } from "./voiceHost";

/**
 * Everything the engine cannot work out for itself, in one place.
 *
 * The host is set at module scope rather than in an effect: it answers questions
 * about the runtime, which cannot change while the app is running, and setting it
 * during a render would leave the first connection asking a host that is not
 * there yet.
 */
setVoiceHost(electronVoiceHost);

const NO_STUN: string[] = [];

export function VoiceProvider({ children }: { children?: ReactNode }) {
  const { currentlyViewingServer } = useServerManagement();
  const { sockets, serverDetailsList } = useSockets();

  const host = currentlyViewingServer?.host;
  const details = host ? serverDetailsList[host] : undefined;

  // Identity stays stable while the host does, so the engine is not handed a new
  // coordinator on every render of the app shell.
  const target = useMemo(() => {
    if (!host) return null;
    const socket = sockets[host];
    if (!socket) return null;
    return { id: host, room: createRoomCoordinator(socket, host) };
  }, [host, sockets]);

  const stunHosts = details?.stun_hosts ?? NO_STUN;
  const config = useVoiceConfigFromSettings(stunHosts);

  return (
    <VoiceConfigProvider config={config} target={target}>
      {/* Runs the body of every singleton hook inside @gryt/voice, once. The
          client's own <SingletonHooks /> only knows about the client's registry;
          these are a second one. Without this the hooks return their initial
          values forever and voice silently does nothing. */}
      <VoiceSingletonHooks />
      {children}
    </VoiceConfigProvider>
  );
}
