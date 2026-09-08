import { SFUConnectionState, useSFU } from "@gryt/voice";
import { useEffect, useRef } from "react";
import toast from "react-hot-toast";

import { ServerErrorToast, serverIconSrc } from "@/common";
import { useServerManagement, useSockets } from "@/socket";

import { useVoiceSounds } from "./useVoiceSounds";

/**
 * The parts of a voice call that are the app's business rather than the engine's:
 * they need the server list, the DOM, or a decision about what to hear.
 */
export function useVoiceLifecycle() {
  const {
    connectionError,
    connectionState,
    currentServerConnected,
    currentChannelConnected,
    isConnected,
    disconnect,
  } = useSFU();
  const { servers, currentlyViewingServer } = useServerManagement();
  const { serverDetailsList } = useSockets();
  const { playConnect } = useVoiceSounds();

  // The connect sound. The engine used to play it partway through the flow; it
  // now plays when the call is actually up.
  const wasConnected = useRef(false);
  // Whether this call ever came up, which `wasConnected` cannot answer — it
  // tracks the current state. "It dropped" and "it never connected" differ.
  const everConnected = useRef(false);
  useEffect(() => {
    const nowConnected = connectionState === SFUConnectionState.CONNECTED;
    if (nowConnected && !wasConnected.current) playConnect();
    if (nowConnected) everConnected.current = true;
    wasConnected.current = nowConnected;
  }, [connectionState, playConnect]);

  // A fresh call is a fresh verdict. Without this, one dropped call makes every
  // later failure in the session read as "it dropped".
  useEffect(() => {
    if (connectionState === SFUConnectionState.CONNECTING) everConnected.current = false;
  }, [connectionState]);

  /*
   * Where the call was, kept because the engine forgets before the toast runs:
   * giving up clears `serverId` and `roomId` in the same update.
   */
  const lastHost = useRef("");
  const lastChannelId = useRef("");
  useEffect(() => {
    if (currentServerConnected) lastHost.current = currentServerConnected;
    if (currentChannelConnected) lastChannelId.current = currentChannelConnected;
  }, [currentServerConnected, currentChannelConnected]);

  /*
   * Telling somebody the call dropped. **Only once the engine has stopped
   * trying**: DISCONNECTED, not FAILED, which still has retries left (GRYT-668).
   */
  useEffect(() => {
    if (!connectionError) return;
    if (connectionState !== SFUConnectionState.DISCONNECTED) return;

    const host = currentServerConnected || lastHost.current;
    const name = host ? servers[host]?.name || host : "";
    const channelId = currentChannelConnected || lastChannelId.current;
    const channel = host
      ? serverDetailsList[host]?.channels?.find((c) => c.id === channelId)
      : undefined;

    /*
     * Which words. Gryt has no relay, so a network that will not carry a direct
     * path cannot carry a call — a guess that is only fair after every attempt.
     */
    const message =
      connectionError === "reconnect-failed"
        ? everConnected.current
          ? "The call dropped and could not be picked back up. Try joining again."
          : "Could not reach the voice server after several attempts. This network " +
            "may not allow voice traffic through, which is common on mobile data."
        : connectionError;

    if (!host) {
      toast.error(message, { id: "voice-connection", duration: 8000 });
      return;
    }

    toast.error(
      <ServerErrorToast
        iconSrc={serverIconSrc(host, name, serverDetailsList)}
        seed={name}
        serverName={name}
        channelName={channel?.name}
        message={message}
      />,
      { id: "voice-connection", duration: 8000 },
    );
  }, [
    connectionError,
    connectionState,
    currentServerConnected,
    currentChannelConnected,
    servers,
    serverDetailsList,
  ]);

  // Leaving a server while in one of its voice channels should end the call.
  // This reads the whole server map, which is what the engine is kept away from.
  useEffect(() => {
    if (!isConnected || !currentServerConnected) return;
    if (currentlyViewingServer?.host === currentServerConnected) return;
    if (servers[currentServerConnected]) return;
    disconnect().catch((error) => {
      console.error("[Voice] Error disconnecting from a removed server:", error);
    });
  }, [servers, currentServerConnected, isConnected, currentlyViewingServer?.host, disconnect]);

  // The server hanging up on us, which it does when the same account takes the
  // channel on another device. useSocketEvents raises this from three places.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ host?: string; reason?: string }>).detail;

      // Being kicked from one server should not drop a call on another. The
      // host has always been in the payload; the old code did this check too.
      if (detail?.host && currentServerConnected && detail.host !== currentServerConnected) {
        return;
      }

      disconnect().catch((error) => {
        console.error("[Voice] Error during server-initiated disconnect:", error);
      });

      // The UI moves the person to the text channel and says why.
      window.dispatchEvent(
        new CustomEvent("voice_disconnect_text_switch", { detail }),
      );
    };

    window.addEventListener("server_voice_disconnect", handler);
    return () => window.removeEventListener("server_voice_disconnect", handler);
  }, [currentServerConnected, disconnect]);
}
