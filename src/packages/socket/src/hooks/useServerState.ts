import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

import { isSpeaking, useMicrophone, useSpeakers } from "@/audio";
import { getServerAccessToken, markChannelRead } from "@/common";
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

type ConnectionStatus =
  | "connected"
  | "disconnected"
  | "connecting"
  | "reconnecting";

type ServerFailure = {
  error: string;
  message?: string;
};

type UseServerStateResult = {
  clientsSpeaking: Record<string, boolean>;
  voiceWidth: string;
  setVoiceWidth: Dispatch<SetStateAction<string>>;
  userVoiceWidth: number;
  setUserVoiceWidth: Dispatch<SetStateAction<number>>;
  selectedChannelId: string | null;
  setSelectedChannelId: Dispatch<SetStateAction<string | null>>;
  handleVoiceDisconnect: () => void;
  setPendingChannelId: Dispatch<SetStateAction<string | null>>;
  currentChannelId: string;
  currentConnection: Socket | null;
  accessToken: string | null;
  activeConversationId: string;
  serverFailure: ServerFailure | undefined;
  hasTimedOut: boolean;
  currentConnectionStatus: ConnectionStatus;
  reconnectServer: (host: string) => void;
};

export function useServerState(): UseServerStateResult {
  const {
    micID,
    isAFK,
    setIsAFK,
    afkTimeoutMinutes,
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

  const lastActivityTimeRef = useRef(Date.now());
  const isAFKRef = useRef(false);

  useEffect(() => {
    isAFKRef.current = isAFK;
  }, [isAFK]);

  const [clientsSpeaking, setClientsSpeaking] = useState<
    Record<string, boolean>
  >({});
  const serverLoadingTimerRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
  const [serverLoadingTimedOut, setServerLoadingTimedOut] = useState<
    Record<string, boolean>
  >({});
  const [voiceWidth, setVoiceWidth] = useState("0px");
  const [userVoiceWidth, setUserVoiceWidth] = useState(400);
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null
  );

  const shouldAccessMic = useMemo(
    () => isConnecting || isConnected,
    [isConnecting, isConnected]
  );

  const { microphoneBuffer, isPttActive } = useMicrophone(shouldAccessMic);

  const currentConnection = useMemo<Socket | null>(
    () =>
      currentlyViewingServer
        ? (sockets[currentlyViewingServer.host] as Socket | undefined) ?? null
        : null,
    [currentlyViewingServer, sockets]
  );

  const accessToken = useMemo(
    () =>
      currentlyViewingServer
        ? getServerAccessToken(currentlyViewingServer.host)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentlyViewingServer, tokenRevision]
  );

  const currentChannelId = extractChannelIdFromRoomId(
    currentChannelConnected,
    currentServerConnected
  );

  const activeConversationId = selectedChannelId || currentChannelId || "";

  useEffect(() => {
    const host = currentlyViewingServer?.host;
    if (!host) return;
    if (serverConnectionStatus?.[host] !== "connected") return;
    requestMemberList(host);
  }, [currentlyViewingServer?.host, serverConnectionStatus, requestMemberList]);

  useEffect(() => {
    if (currentChannelId) {
      setSelectedChannelId((prev) => prev ?? currentChannelId);
    }
  }, [currentChannelId]);

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
  }, [
    currentlyViewingServer,
    serverDetailsList,
    failedServerDetails,
    serverLoadingTimedOut,
  ]);

  useEffect(() => {
    return () => {
      Object.values(serverLoadingTimerRef.current).forEach((t) =>
        clearTimeout(t)
      );
      serverLoadingTimerRef.current = {};
    };
  }, []);

  useEffect(() => {
    setSelectedChannelId(null);
  }, [currentlyViewingServer?.host]);

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

  useEffect(() => {
    if (currentlyViewingServer && selectedChannelId) {
      markChannelRead(currentlyViewingServer.host, selectedChannelId);
    }
  }, [currentlyViewingServer, selectedChannelId]);

  useEffect(() => {
    if (!currentlyViewingServer || !selectedChannelId) return;
    const channels =
      serverDetailsList[currentlyViewingServer.host]?.channels || [];
    if (channels.some((c) => c.id === selectedChannelId)) return;
    const fallback = channels.find((c) => c.type === "text") || channels[0];
    setSelectedChannelId(fallback?.id ?? null);
  }, [currentlyViewingServer, serverDetailsList, selectedChannelId]);

  useEffect(() => {
    setVoiceWidth(
      currentServerConnected === currentlyViewingServer?.host
        ? `${userVoiceWidth}px`
        : "0px"
    );
  }, [currentServerConnected, currentlyViewingServer, userVoiceWidth]);

  const connectRef = useRef(connect);
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const currentlyViewingServerRef = useRef(currentlyViewingServer);
  useEffect(() => {
    currentlyViewingServerRef.current = currentlyViewingServer;
  }, [currentlyViewingServer]);

  const serverDetailsListRef = useRef(serverDetailsList);
  useEffect(() => {
    serverDetailsListRef.current = serverDetailsList;
  }, [serverDetailsList]);

  useEffect(() => {
    if (micID && pendingChannelId) {
      const server = currentlyViewingServerRef.current;
      const details = serverDetailsListRef.current;
      const pendingChannel = server
        ? details[server.host]?.channels?.find((c) => c.id === pendingChannelId)
        : undefined;

      connectRef
        .current(
          pendingChannelId,
          pendingChannel?.eSportsMode,
          pendingChannel?.maxBitrate
        )
        .then(() => setPendingChannelId(null))
        .catch((error) => {
          console.error("Failed to connect to pending channel:", error);
          setPendingChannelId(null);
        });
    }
  }, [micID, pendingChannelId]);

  const clientsSpeakingRef = useRef(clientsSpeaking);
  clientsSpeakingRef.current = clientsSpeaking;

  useEffect(() => {
    const pollRate = eSportsModeEnabled ? 50 : 100;
    const interval = setInterval(() => {
      if (
        !currentServerConnected ||
        !currentlyViewingServer ||
        !currentConnection
      ) {
        return;
      }

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
            speaking = isSpeaking(microphoneBuffer.finalAnalyser, 0.5);
          }
          if (speaking) {
            lastActivityTimeRef.current = Date.now();
            if (isAFKRef.current) setIsAFK(false);
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
    setIsAFK,
  ]);

  useEffect(() => {
    if (
      !currentServerConnected ||
      !currentlyViewingServer ||
      !currentConnection
    ) {
      return;
    }

    lastActivityTimeRef.current = Date.now();

    const markActivity = () => {
      lastActivityTimeRef.current = Date.now();
      if (isAFKRef.current) setIsAFK(false);
    };

    document.addEventListener("mousemove", markActivity);
    document.addEventListener("mousedown", markActivity);
    document.addEventListener("keydown", markActivity);
    document.addEventListener("scroll", markActivity, true);
    document.addEventListener("touchstart", markActivity);

    const onVisibilityChange = () => {
      if (!document.hidden) markActivity();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", markActivity);

    const cleanupElectronFocus = window.electronAPI?.onWindowFocusChange(
      (focused) => {
        if (focused) markActivity();
      }
    );

    const checkAFK = () => {
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
    setIsAFK,
    afkTimeoutMinutes,
  ]);

  useEffect(() => {
    if (!currentlyViewingServer || !audioContext) return;
    const hostClients = clients[currentlyViewingServer.host] || {};
    const baseGain = sliderToOutputGain(outputVolume);

    Object.values(hostClients).forEach((client) => {
      if (!client.streamID || !streamSources[client.streamID]) return;
      const userVol = client.serverUserId
        ? (userVolumes[client.serverUserId] ?? 100) / 100
        : 1;
      const finalGain = isDeafened ? 0 : baseGain * userVol;
      streamSources[client.streamID].gain.gain.setValueAtTime(
        finalGain,
        audioContext.currentTime || 0
      );
    });
  }, [
    userVolumes,
    outputVolume,
    isDeafened,
    clients,
    currentlyViewingServer,
    streamSources,
    audioContext,
  ]);

  const handleVoiceDisconnect = useCallback(() => {
    if (currentlyViewingServer) {
      const channels =
        serverDetailsList[currentlyViewingServer.host]?.channels || [];
      const firstText = channels.find((c) => c.type === "text");
      setSelectedChannelId(firstText ? firstText.id : null);
    }
  }, [currentlyViewingServer, serverDetailsList]);

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
      handler as EventListener
    );

    return () =>
      window.removeEventListener(
        "voice_disconnect_text_switch",
        handler as EventListener
      );
  }, [currentlyViewingServer, handleVoiceDisconnect]);

  const serverFailure: ServerFailure | undefined = currentlyViewingServer
    ? (failedServerDetails[currentlyViewingServer.host] as
        | ServerFailure
        | undefined)
    : undefined;

  const hasTimedOut = currentlyViewingServer
    ? !!serverLoadingTimedOut[currentlyViewingServer.host]
    : false;

  const currentConnectionStatus: ConnectionStatus = currentlyViewingServer
    ? ((serverConnectionStatus[currentlyViewingServer.host] ??
        "disconnected") as ConnectionStatus)
    : "disconnected";

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
