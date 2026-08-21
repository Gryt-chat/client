import { SFUConnectionState, useSFU } from "@gryt/voice";
import { useEffect, useRef } from "react";
import toast from "react-hot-toast";

import { useServerManagement } from "@/socket";

import { useVoiceSounds } from "./useVoiceSounds";

/**
 * The parts of a voice call that are the app's business rather than the
 * engine's.
 *
 * All three of these used to live inside `useSFU`, and all three were left out
 * of the package deliberately: they need the server list, the DOM, or a decision
 * about what the person should hear, and the engine has no business with any of
 * them.
 *
 * Rendered inside `VoiceProvider`, below `VoiceConfigProvider`, because it
 * consumes `useSFU`.
 */
export function useVoiceLifecycle() {
  const {
    connectionError,
    connectionState,
    currentServerConnected,
    isConnected,
    disconnect,
  } = useSFU();
  const { servers, currentlyViewingServer } = useServerManagement();
  const { playConnect } = useVoiceSounds();

  // The connect sound. The engine used to play this itself, partway through the
  // flow — after the offer/answer exchange but before ICE and DTLS had
  // finished. It now plays when the call is actually up, which is slightly later
  // and arguably what it should always have meant.
  const wasConnected = useRef(false);
  useEffect(() => {
    const nowConnected = connectionState === SFUConnectionState.CONNECTED;
    if (nowConnected && !wasConnected.current) playConnect();
    wasConnected.current = nowConnected;
  }, [connectionState, playConnect]);

  // Telling somebody the call dropped, which the engine deliberately does not do
  // itself. It reports that it gave up; whether that is worth interrupting
  // anybody is the app's call, and the answer here is yes — a call ending on its
  // own with no explanation is worse than a toast.
  //
  // Three different failures, and they want different words. The engine already
  // tells them apart, and until GRYT-448 only the first was surfaced at all: a
  // call that never connected in the first place left the person watching a
  // spinner until they gave up on it themselves.
  useEffect(() => {
    if (!connectionError) return;

    if (connectionError === "reconnect-failed") {
      toast.error(
        "Voice connection failed after multiple attempts. Please try again.",
        { id: "voice-connection" },
      );
      return;
    }

    // Never connected. Gryt has no relay, on purpose, so a network that will
    // not carry a direct path cannot carry a call — carrier-grade NAT on mobile
    // data being the usual one. Naming that is the difference between a broken
    // app and a known limitation, and it is the only guess here worth making:
    // by this point ICE has tried every candidate it had.
    if (connectionError === "WebRTC connection failed") {
      toast.error(
        "Could not reach the voice server. This network may not allow voice " +
          "traffic through, which is common on mobile data.",
        { id: "voice-connection", duration: 8000 },
      );
      return;
    }

    // Was connected and dropped, and the engine is not retrying. Anything else
    // it reports lands here too rather than being swallowed.
    toast.error(connectionError, { id: "voice-connection" });
  }, [connectionError]);

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
