import { MutableRefObject, useCallback, useEffect, useRef } from "react";
import toast from "react-hot-toast";

import { ServerErrorToast, serverIconSrc } from "@/common";
import type { Channel } from "@/settings/src/types/server";

import { useServerPermissions } from "./usePermissions";
import { useSockets } from "./useSockets";

interface UseChannelSettingsParams {
  inputMode: string;
  rnnoiseEnabled: boolean;
  eSportsModeEnabled: boolean;
  noiseGate: number;
  isConnected: boolean;
  setInputMode: (v: "voice_activity" | "push_to_talk") => void;
  setRnnoiseEnabled: (v: boolean) => void;
  setESportsModeEnabled: (v: boolean) => void;
  setNoiseGate: (v: number) => void;
}

function useChannelSettings({
  inputMode, rnnoiseEnabled, eSportsModeEnabled, noiseGate, isConnected,
  setInputMode, setRnnoiseEnabled, setESportsModeEnabled, setNoiseGate,
}: UseChannelSettingsParams) {
  const prevSettingsRef = useRef<{
    inputMode: string;
    rnnoiseEnabled: boolean;
    eSportsModeEnabled: boolean;
    noiseGate: number;
  } | null>(null);

  const applyChannelSettings = useCallback((channel: Channel) => {
    const needsPtt = channel.requirePushToTalk && inputMode !== "push_to_talk";
    const needsNoRnnoise = channel.disableRnnoise && rnnoiseEnabled;
    const needsEsports = channel.eSportsMode && !eSportsModeEnabled;
    if (!needsPtt && !needsNoRnnoise && !needsEsports) return;

    prevSettingsRef.current = { inputMode, rnnoiseEnabled, eSportsModeEnabled, noiseGate };
    const messages: string[] = [];
    if (needsEsports) {
      setESportsModeEnabled(true);
      messages.push("eSports mode activated");
    } else {
      if (needsPtt) {
        setInputMode("push_to_talk");
        messages.push("Push to Talk enabled");
      }
      if (needsNoRnnoise) {
        setRnnoiseEnabled(false);
        messages.push("RNNoise disabled");
      }
    }
    toast(`Channel rules applied: ${messages.join(", ")}`, { icon: "⚡" });
  }, [inputMode, rnnoiseEnabled, eSportsModeEnabled, noiseGate, setInputMode, setRnnoiseEnabled, setESportsModeEnabled]);

  const restoreChannelSettings = useCallback(() => {
    if (!prevSettingsRef.current) return;
    const prev = prevSettingsRef.current;
    setESportsModeEnabled(prev.eSportsModeEnabled);
    setInputMode(prev.inputMode as "voice_activity" | "push_to_talk");
    setRnnoiseEnabled(prev.rnnoiseEnabled);
    setNoiseGate(prev.noiseGate);
    prevSettingsRef.current = null;
    toast("Settings restored to your defaults", { icon: "↩" });
  }, [setInputMode, setRnnoiseEnabled, setESportsModeEnabled, setNoiseGate]);

  useEffect(() => {
    if (!isConnected) restoreChannelSettings();
  }, [isConnected, restoreChannelSettings]);

  return { applyChannelSettings };
}

interface UseHandleChannelClickParams {
  currentlyViewingServer: { host: string; name: string } | null;
  isConnected: boolean;
  currentServerConnected: string | null;
  currentChannelId: string;
  selectedChannelId: string | null;
  isConnecting: boolean;
  showVoiceView: boolean;
  mediaAutoShownRef: MutableRefObject<boolean>;
  setSelectedChannelId: (id: string) => void;
  setShowVoiceView: (v: boolean) => void;
  setPendingChannelId: (id: string | null) => void;
  setSettingsTab: (tab: string) => void;
  setShowSettings: (v: boolean) => void;
  setLastSelectedChannelForServer: (host: string, channelId: string) => void;
  connect: (channelId: string, eSportsMode?: boolean, maxBitrate?: number | null) => Promise<void>;
  applyChannelSettings: (channel: Channel) => void;
  setIsMuted: (v: boolean) => void;
  setIsDeafened: (v: boolean) => void;
}

function useHandleChannelClick({
  currentlyViewingServer, isConnected, currentServerConnected,
  currentChannelId, selectedChannelId, isConnecting,
  showVoiceView, mediaAutoShownRef,
  setSelectedChannelId, setShowVoiceView, setPendingChannelId,
  setSettingsTab, setShowSettings, setLastSelectedChannelForServer,
  connect, applyChannelSettings, setIsMuted, setIsDeafened,
}: UseHandleChannelClickParams) {
  const { can } = useServerPermissions(currentlyViewingServer?.host || "");
  const { serverDetailsList } = useSockets();

  return useCallback((channel: Channel) => {
    if (!currentlyViewingServer) return;
    switch (channel.type) {
      case "voice": {
        // The server refuses this too. Stopping here as well is so the answer
        // reads as "you are not allowed in" rather than as whatever the media
        // stack says when the room grant never arrives.
        //
        // Both answers, because they can differ: `can` is the role's
        // server-wide permission and `canJoin` is this room's, and a scope that
        // shuts one door is invisible to the first. Absent means the server is
        // too old to say, which reads as allowed.
        if (!can("join_voice") || channel.canJoin === false) {
          const host = currentlyViewingServer.host;
          const name = currentlyViewingServer.name || host;
          toast.error(
            <ServerErrorToast
                iconSrc={serverIconSrc(host, name, serverDetailsList)}
                seed={name}
                serverName={name}
                channelName={channel.name}
                message="You do not have permission to join voice here."
              />,
          );
          return;
        }

        const isAlreadyConnectedToThis =
          isConnected && currentServerConnected === currentlyViewingServer.host && currentChannelId === channel.id;

        if (isAlreadyConnectedToThis) {
          mediaAutoShownRef.current = false;
          if (selectedChannelId !== channel.id && channel.textInVoice) {
            setSelectedChannelId(channel.id);
          }
          setShowVoiceView(!showVoiceView);
          return;
        }

        if (isConnecting && currentChannelId === channel.id) {
          mediaAutoShownRef.current = false;
          if (channel.textInVoice) {
            setSelectedChannelId(channel.id);
          }
          setShowVoiceView(!showVoiceView);
          return;
        }

        setPendingChannelId(null);
        applyChannelSettings(channel);
        mediaAutoShownRef.current = false;
        setShowVoiceView(false);
        setIsMuted(false);
        setIsDeafened(false);
        connect(channel.id, channel.eSportsMode, channel.maxBitrate).catch((error) => {
          console.error("SFU connection failed:", error);

          // The microphone one is about this device rather than about the
          // server, so it stays a plain string and sends you where the fix is.
          if (error instanceof Error && error.message.includes("Microphone not available")) {
            setPendingChannelId(channel.id);
            setSettingsTab("audio");
            setShowSettings(true);
            toast.error("No microphone selected. Please choose a device in Settings → Audio.");
            return;
          }

          // Everything else is about a channel on a server, and saying which is
          // the difference between a report somebody can act on and "voice
          // broke". See ServerErrorToast.
          const host = currentlyViewingServer.host;
          const name = currentlyViewingServer.name || host;
          toast.error(
            <ServerErrorToast
                iconSrc={serverIconSrc(host, name, serverDetailsList)}
                seed={name}
                serverName={name}
                channelName={channel.name}
                message={
                  error instanceof Error ? error.message : "Could not join this voice channel."
                }
              />,
          );
        });
        break;
      }
      case "text":
        setSelectedChannelId(channel.id);
        if (currentlyViewingServer) {
          setLastSelectedChannelForServer(currentlyViewingServer.host, channel.id);
        }
        break;
    }
  }, [
    currentlyViewingServer, isConnected, currentServerConnected,
    currentChannelId, selectedChannelId, isConnecting,
    showVoiceView, mediaAutoShownRef,
    setSelectedChannelId, setShowVoiceView, setPendingChannelId,
    setSettingsTab, setShowSettings, setLastSelectedChannelForServer,
    connect, applyChannelSettings, setIsMuted, setIsDeafened, can, serverDetailsList,
  ]);
}

export { useChannelSettings, useHandleChannelClick };
