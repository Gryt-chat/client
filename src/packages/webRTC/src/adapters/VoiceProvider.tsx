import type { VoiceConfigCallbacks } from "@gryt/voice";
import { setVoiceHost,VoiceConfigProvider, VoiceSingletonHooks } from "@gryt/voice";
import { type ReactNode,useMemo, useRef } from "react";

import { useSettings } from "@/settings";
import { useServerManagement, useSockets } from "@/socket";

import { createRoomCoordinator } from "./roomCoordinator";
import { useVoiceLifecycle } from "./useVoiceLifecycle";
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

function VoiceLifecycle() {
  useVoiceLifecycle();
  return null;
}

/**
 * What the engine noticed, written down.
 *
 * The engine reports the device it actually opened when that is not the one it
 * was asked for — either because nothing had been chosen, or because the chosen
 * one is not there any more. Only the first of those is worth recording.
 *
 * Recording the second would mean unplugging a headset quietly replaces the
 * stored choice with the built-in microphone, so plugging it back in does not
 * return to it. The camera is the same question with the same answer.
 */
function useDeviceCallbacks(): VoiceConfigCallbacks {
  const settings = useSettings();

  // Through a ref so the callbacks keep one identity for the life of the app.
  // They are dependencies of the engine's device effects, and a new object on
  // every settings change would reopen the microphone and the camera.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  return useMemo(
    () => ({
      onAudioDeviceChanged: (deviceId: string) => {
        if (settingsRef.current.micID) return;
        settingsRef.current.setMicID(deviceId);
      },
      onCameraDeviceChanged: (deviceId: string) => {
        if (settingsRef.current.cameraID) return;
        settingsRef.current.setCameraID(deviceId);
      },
    }),
    [],
  );
}

export function VoiceProvider({ children }: { children?: ReactNode }) {
  const { currentlyViewingServer } = useServerManagement();
  const { sockets, serverDetailsList } = useSockets();
  const callbacks = useDeviceCallbacks();

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
    <VoiceConfigProvider config={config} callbacks={callbacks} target={target}>
      {/* Runs the body of every singleton hook inside @gryt/voice, once. The
          client's own <SingletonHooks /> only knows about the client's registry;
          these are a second one. Without this the hooks return their initial
          values forever and voice silently does nothing. */}
      <VoiceSingletonHooks />
      {/* Inside the provider, because it consumes useSFU. Runs the three
          behaviours that were deliberately left out of the package: the connect
          sound, ending a call when its server is removed, and the server hanging
          up on us. */}
      <VoiceLifecycle />
      {children}
    </VoiceConfigProvider>
  );
}
