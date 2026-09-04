import { SFUConnectionState, useSFU } from "@gryt/voice";
import { useEffect, useRef } from "react";
import toast from "react-hot-toast";

import { ServerErrorToast, serverIconSrc } from "@/common";
import { useServerManagement, useSockets } from "@/socket";

import { useVoiceSounds } from "./useVoiceSounds";

/**
 * The parts of a voice call that are the app's business rather than the
 * engine's.
 *
 * All three of these used to live inside `useSFU`, and all three were left out
 * of the package deliberately: they need the server list, the DOM, or a
 * decision about what the person should hear.
 *
 * Rendered inside `VoiceProvider`, below `VoiceConfigProvider`, because it
 * consumes `useSFU`.
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

  // The connect sound. The engine used to play this itself, partway through the
  // flow — after the offer/answer exchange but before ICE and DTLS had
  // finished. It now plays when the call is actually up, which is slightly later
  // and arguably what it should always have meant.
  const wasConnected = useRef(false);
  // Whether this call ever came up at all, which `wasConnected` cannot answer
  // because it tracks the current state rather than the high-water mark. The
  // give-up toast needs the high-water mark: "it dropped" and "it never
  // connected" are different problems and want different words.
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
   * Where the call was, kept because the engine forgets before the toast runs.
   *
   * Giving up clears the whole connection state — `serverId: null`,
   * `roomId: null` — in the same update that sets "reconnect-failed", so by the
   * time the effect below reads `currentServerConnected` it is "". These latch
   * the last non-empty values instead.
   */
  const lastHost = useRef("");
  const lastChannelId = useRef("");
  useEffect(() => {
    if (currentServerConnected) lastHost.current = currentServerConnected;
    if (currentChannelConnected) lastChannelId.current = currentChannelConnected;
  }, [currentServerConnected, currentChannelConnected]);

  /*
   * Telling somebody the call dropped, which the engine deliberately leaves to
   * the app — it reports that it gave up.
   *
   * **Only once the engine has actually stopped trying** (GRYT-668).
   * `connectionError` is set the moment the peer connection fails and the
   * engine then retries five times, so a blip that healed 1.5 seconds later
   * still blamed somebody's network for a late STUN response.
   *
   * DISCONNECTED is the engine saying it is done: FAILED moves on to
   * RECONNECTING while a retry is possible, which is `useSFU`'s contract.
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
     * Which words. Whether the call ever came up is the difference between a
     * network that cannot carry voice at all and one that dropped it, and the
     * engine cannot say — "reconnect-failed" covers both.
     *
     * Gryt has no relay, on purpose, so a network that will not carry a direct
     * path cannot carry a call — carrier-grade NAT on mobile data being the
     * usual one. That guess is only fair after every attempt has failed.
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
  // This reads the whole server map to notice the one we are on has gone, which
  // is exactly what the engine is kept away from.
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
