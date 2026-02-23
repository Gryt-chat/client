import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isSpeaking, useMicrophone, useSpeakers } from "@/audio";
import { getServerAccessToken } from "@/common";
import { sliderToOutputGain } from "@/lib/audioVolume";
import { useSettings } from "@/settings";
import { useSFU } from "@/webRTC";

import { useServerManagement } from "./useServerManagement";
import { useSockets } from "./useSockets";

function extractChannelIdFromRoomId(roomId: string, serverId: string): string {
  if (!roomId || !serverId) return "";

  const serverName = serverId.split(".")[0];
  const possiblePrefixes = [
    `${serverName}_`,
    `${serverId}_`,
    `${serverName.toLowerCase()}_`,
    `${serverName.replace(/\s+/g, "_").toLowerCase()}_`,
  ];

  for (const prefix of possiblePrefixes) {
    if (roomId.startsWith(prefix)) return roomId.substring(prefix.length);
  }
  return roomId;
}

export function useServerState() {
  const {
    micID,
    isAFK,
    setIsAFK,
    afkTimeoutMinutes,
    noiseGate,
    eSportsModeEnabled,
    inputMode,
    userVolumes,
    outputVolume,
    isDeafened,
  } = useSettings();

  const { audioContext } = useSpeakers();

  const { currentlyViewingServer, getLastSelectedChannel } =
    useServerManagement();

  const {
    sockets,
    serverDetailsList,
    clients,
    failedServerDetails,
    serverConnectionStatus,
    reconnectServer,
    requestMemberList,
    tokenRevision,
  } = useSockets();

  const {
    connect,
    currentServerConnected,
    streamSources,
    currentChannelConnected,
    isConnected,
    isConnecting,
  } = useSFU();

  // ── AFK tracking refs (persist across effect re-runs) ─────────────────
  const lastActivityTimeRef = useRef(Date.now());
  const isAFKRef = useRef(false);
  useEffect(() => {
    isAFKRef.current = isAFK;
  }, [isAFK]);

  // ── State ──────────────────────────────────────────────────────────────
  const [clientsSpeaking, setClientsSpeaking] = useState<
    Record<string, boolean>
  >({});
  const serverLoadingTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [serverLoadingTimedOut, setServerLoadingTimedOut] = useState<Record<string, boolean>>({});
  const [voiceWidth, setVoiceWidth] = useState("0px");
  const [userVoiceWidth, setUserVoiceWidth] = useState(400);
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null,
  );

  // ── Derived / memoised values ──────────────────────────────────────────
  const shouldAccessMic = useMemo(
    () => isConnecting || isConnected,
    [isConnecting, isConnected],
  );

  const { microphoneBuffer, isPttActive } = useMicrophone(shouldAccessMic);

  const currentConnection = useMemo(
    () =>
      currentlyViewingServer ? sockets[currentlyViewingServer.host] : null,
    [currentlyViewingServer, sockets],
  );

  const accessToken = useMemo(
    () =>
      currentlyViewingServer
        ? getServerAccessToken(currentlyViewingServer.host)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentlyViewingServer, tokenRevision],
  );

  const currentChannelId = extractChannelIdFromRoomId(
    currentChannelConnected,
    currentServerConnected,
  );

  const activeConversationId = selectedChannelId || currentChannelId || "";

  // ── Effects ────────────────────────────────────────────────────────────

  // Request member list when the server socket connects
  useEffect(() => {
    const host = currentlyViewingServer?.host;
    if (!host) return;
    if (serverConnectionStatus?.[host] !== "connected") return;
    requestMemberList(host);
  }, [currentlyViewingServer?.host, serverConnectionStatus, requestMemberList]);

  // Keep selectedChannelId in sync with SFU connection
  useEffect(() => {
    if (currentChannelId) {
      setSelectedChannelId((prev) => prev ?? currentChannelId);
    }
  }, [currentChannelId]);

  // Server-details loading timeout (10 s)
  useEffect(() => {
    if (!currentlyViewingServer) return;

    const host = currentlyViewingServer.host;
    const hasDetails = !!serverDetailsList[host];
    const hasFailed = !!failedServerDetails[host];

    if (hasDetails || hasFailed) {
      const t = serverLoadingTimerRef.current[host];
      if (t) {
        clearTimeout(t);
        delete serverLoadingTimerRef.current[host];
      }
      if (serverLoadingTimedOut[host]) {
        setServerLoadingTimedOut((prev) => {
          if (!prev[host]) return prev;
          const updated = { ...prev };
          delete updated[host];
          return updated;
        });
      }
      return;
    }

    if (!serverLoadingTimedOut[host] && !serverLoadingTimerRef.current[host]) {
      serverLoadingTimerRef.current[host] = setTimeout(() => {
        delete serverLoadingTimerRef.current[host];
        setServerLoadingTimedOut((prev) => ({ ...prev, [host]: true }));
      }, 10_000);
    }
  }, [currentlyViewingServer, serverDetailsList, failedServerDetails, serverLoadingTimedOut]);

  // Clear any pending timers on unmount
  useEffect(() => {
    return () => {
      Object.values(serverLoadingTimerRef.current).forEach((t) => clearTimeout(t));
      serverLoadingTimerRef.current = {};
    };
  }, []);

  // Clear selected channel when switching servers
  useEffect(() => {
    setSelectedChannelId(null);
  }, [currentlyViewingServer?.host]);

  // Restore last-selected or first text channel
  useEffect(() => {
    if (!currentlyViewingServer) return;
    if (selectedChannelId) return;

    const channels =
      serverDetailsList[currentlyViewingServer.host]?.channels || [];

    const lastId = getLastSelectedChannel(currentlyViewingServer.host);
    if (lastId) {
      const lastChannel = channels.find((c) => c.id === lastId);
      if (lastChannel && lastChannel.type !== "voice") {
        setSelectedChannelId(lastId);
        return;
      }
    }

    const firstText = channels.find((c) => c.type === "text");
    if (firstText) setSelectedChannelId(firstText.id);
  }, [
    currentlyViewingServer,
    serverDetailsList,
    selectedChannelId,
    getLastSelectedChannel,
  ]);

  // Fallback when selected channel is deleted
  useEffect(() => {
    if (!currentlyViewingServer || !selectedChannelId) return;
    const channels =
      serverDetailsList[currentlyViewingServer.host]?.channels || [];
    if (channels.some((c) => c.id === selectedChannelId)) return;
    const fallback = channels.find((c) => c.type === "text") || channels[0];
    setSelectedChannelId(fallback?.id ?? null);
  }, [currentlyViewingServer, serverDetailsList, selectedChannelId]);

  // Voice panel width
  useEffect(() => {
    setVoiceWidth(
      currentServerConnected === currentlyViewingServer?.host
        ? `${userVoiceWidth}px`
        : "0px",
    );
  }, [currentServerConnected, currentlyViewingServer, userVoiceWidth]);

  // Connect to pending voice channel once mic is available
  useEffect(() => {
    if (micID && pendingChannelId) {
      const pendingChannel = currentlyViewingServer
        ? serverDetailsList[currentlyViewingServer.host]?.channels?.find((c) => c.id === pendingChannelId)
        : undefined;
      connect(pendingChannelId, pendingChannel?.eSportsMode, pendingChannel?.maxBitrate)
        .then(() => setPendingChannelId(null))
        .catch((error) => {
          console.error("Failed to connect to pending channel:", error);
          setPendingChannelId(null);
        });
    }
  }, [micID, pendingChannelId, connect, currentlyViewingServer, serverDetailsList]);

  // Speaking detection polling (50ms in eSports mode, 100ms normally)
  const clientsSpeakingRef = useRef(clientsSpeaking);
  clientsSpeakingRef.current = clientsSpeaking;

  useEffect(() => {
    const pollRate = eSportsModeEnabled ? 50 : 100;
    const interval = setInterval(() => {
      if (
        !currentServerConnected ||
        !currentlyViewingServer ||
        !currentConnection
      )
        return;

      const prev = clientsSpeakingRef.current;
      const next: Record<string, boolean> = {};
      let changed = false;

      Object.keys(clients[currentlyViewingServer.host]).forEach((clientID) => {
        const client = clients[currentlyViewingServer.host][clientID];
        let speaking = false;

        if (clientID === currentConnection.id) {
          if (inputMode === "push_to_talk") {
            speaking = isPttActive.current;
          } else if (microphoneBuffer.finalAnalyser) {
            speaking = isSpeaking(microphoneBuffer.finalAnalyser!, 0.5);
          }
        } else {
          if (!client.streamID || !streamSources[client.streamID]) return;
          speaking = isSpeaking(streamSources[client.streamID].analyser, 0.1);
        }

        next[clientID] = speaking;
        if (prev[clientID] !== speaking) changed = true;
      });

      if (changed) setClientsSpeaking(next);
    }, pollRate);

    return () => clearInterval(interval);
  }, [
    microphoneBuffer.finalAnalyser,
    streamSources,
    clients,
    currentlyViewingServer,
    currentConnection,
    currentServerConnected,
    eSportsModeEnabled,
    inputMode,
    isPttActive,
  ]);

  // AFK detection — combines audio, focus, visibility, and user interaction
  useEffect(() => {
    if (!currentServerConnected || !currentlyViewingServer || !currentConnection) {
      return;
    }

    lastActivityTimeRef.current = Date.now();

    const markActivity = () => {
      lastActivityTimeRef.current = Date.now();
      if (isAFKRef.current) setIsAFK(false);
    };

    // User interaction listeners
    document.addEventListener("mousemove", markActivity);
    document.addEventListener("mousedown", markActivity);
    document.addEventListener("keydown", markActivity);
    document.addEventListener("scroll", markActivity, true);
    document.addEventListener("touchstart", markActivity);

    // Window focus / visibility
    const onVisibilityChange = () => {
      if (!document.hidden) markActivity();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", markActivity);

    // Electron window focus
    const cleanupElectronFocus = window.electronAPI?.onWindowFocusChange(
      (focused) => { if (focused) markActivity(); },
    );

    const checkAFK = () => {
      // Audio activity: voice above the noise gate resets the timer
      if (microphoneBuffer.analyser) {
        const bufferLength = microphoneBuffer.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        microphoneBuffer.analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        const rawVolume = (rms / 255) * 100;

        if (rawVolume > noiseGate) {
          markActivity();
          return;
        }
      }

      // Window focused → user is present
      if (document.hasFocus()) {
        lastActivityTimeRef.current = Date.now();
        if (isAFKRef.current) setIsAFK(false);
        return;
      }

      // Timeout check
      const timeSinceActivity = Date.now() - lastActivityTimeRef.current;
      const timeoutMs = afkTimeoutMinutes * 60 * 1000;
      if (timeSinceActivity >= timeoutMs && !isAFKRef.current) {
        setIsAFK(true);
      }
    };

    const afkCheckInterval = setInterval(checkAFK, 5000);
    checkAFK();

    return () => {
      clearInterval(afkCheckInterval);
      document.removeEventListener("mousemove", markActivity);
      document.removeEventListener("mousedown", markActivity);
      document.removeEventListener("keydown", markActivity);
      document.removeEventListener("scroll", markActivity, true);
      document.removeEventListener("touchstart", markActivity);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", markActivity);
      cleanupElectronFocus?.();
    };
  }, [
    currentServerConnected,
    currentlyViewingServer,
    currentConnection,
    microphoneBuffer.analyser,
    setIsAFK,
    afkTimeoutMinutes,
    noiseGate,
  ]);

  // Per-user volume: override individual stream gain nodes
  useEffect(() => {
    if (!currentlyViewingServer || !audioContext) return;
    const hostClients = clients[currentlyViewingServer.host] || {};
    const baseGain = sliderToOutputGain(outputVolume);

    Object.values(hostClients).forEach((client) => {
      if (!client.streamID || !streamSources[client.streamID]) return;
      const userVol = (client.serverUserId ? (userVolumes[client.serverUserId] ?? 100) : 100) / 100;
      const finalGain = isDeafened ? 0 : baseGain * userVol;
      streamSources[client.streamID].gain.gain.setValueAtTime(
        finalGain, audioContext.currentTime || 0
      );
    });
  }, [userVolumes, outputVolume, isDeafened, clients, currentlyViewingServer, streamSources, audioContext]);

  // Voice disconnect: fall back to first text channel
  const handleVoiceDisconnect = useCallback(() => {
    if (currentlyViewingServer) {
      const channels =
        serverDetailsList[currentlyViewingServer.host]?.channels || [];
      const firstText = channels.find((c) => c.type === "text");
      setSelectedChannelId(firstText ? firstText.id : null);
    }
  }, [currentlyViewingServer, serverDetailsList]);

  // Server-initiated voice disconnect listener
  useEffect(() => {
    const handler = (event: CustomEvent) => {
      if (
        currentlyViewingServer &&
        currentlyViewingServer.host === event.detail.host
      ) {
        handleVoiceDisconnect();
      }
    };
    window.addEventListener(
      "voice_disconnect_text_switch",
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        "voice_disconnect_text_switch",
        handler as EventListener,
      );
  }, [currentlyViewingServer, handleVoiceDisconnect]);

  // ── Computed loading-state helpers for the caller ──────────────────────
  const serverFailure = currentlyViewingServer
    ? failedServerDetails[currentlyViewingServer.host]
    : undefined;
  const hasTimedOut = currentlyViewingServer
    ? !!serverLoadingTimedOut[currentlyViewingServer.host]
    : false;
  const currentConnectionStatus = currentlyViewingServer
    ? (serverConnectionStatus[currentlyViewingServer.host] || 'disconnected')
    : 'disconnected';

  return {
    clientsSpeaking,
    voiceWidth,
    setVoiceWidth,
    userVoiceWidth,
    setUserVoiceWidth,
    selectedChannelId,
    setSelectedChannelId,
    handleVoiceDisconnect,
    setPendingChannelId,
    currentChannelId,
    currentConnection,
    accessToken,
    activeConversationId,
    serverFailure,
    hasTimedOut,
    currentConnectionStatus,
    reconnectServer,
  };
}
