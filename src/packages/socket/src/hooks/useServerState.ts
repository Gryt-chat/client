import { isSpeaking, useMicrophone, useSpeakers } from "@gryt/voice";
import { useSFU } from "@gryt/voice";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

import { getServerAccessToken } from "@/common";
import { sliderToOutputGain } from "@/lib/audioVolume";
import { useSettings } from "@/settings";

import { byRosterClientId, type ByServerUser, heldKey } from "../lib/heldVoicePresence";
import type { Clients } from "../types/clients";
import { type ChannelSelection, NO_CHANNEL, selectChannel } from "../utils/channelSelection";
import { useHeldVoicePresence } from "./useHeldVoicePresence";
import { useServerManagement } from "./useServerManagement";
import { VOICE_SIDEBAR_WIDTH } from "./useServerViewLayout";
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
  | "reconnecting"
  // Refused on identity grounds (GRYT-51), not a network failure.
  | "refused";

type ServerFailure = {
  error: string;
  message?: string;
};

const NO_CLIENTS: Clients = {};

type UseServerStateResult = {
  /** Keyed like `heldClients`, so a ring follows a member across a server restart. */
  clientsSpeaking: Record<string, boolean>;
  /** The viewed server's roster with voice presence held over a socket reconnect. */
  heldClients: Clients;
  /** Which entry in `heldClients` is you. */
  selfClientId: string | undefined;
  voiceWidth: string;
  setVoiceWidth: Dispatch<SetStateAction<string>>;
  selectedChannelId: string | null;
  setSelectedChannelId: Dispatch<SetStateAction<string | null>>;
  /**
   * The direct message being read, if one is. Kept apart from
   * `selectedChannelId`, which `selectChannel` bounces back to a real channel.
   */
  selectedDmId: string | null;
  setSelectedDmId: Dispatch<SetStateAction<string | null>>;
  handleVoiceDisconnect: () => void;
  setPendingChannelId: Dispatch<SetStateAction<string | null>>;
  currentChannelId: string;
  currentConnection: Socket | null;
  accessToken: string | null;
  activeConversationId: string;
  serverFailure: ServerFailure | undefined;
  hasTimedOut: boolean;
  currentConnectionStatus: ConnectionStatus;
  currentRefusalReason?: string;
  currentRefusalHelpUrl?: string;
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
    refusalReason,
    refusalHelpUrl,
    reconnectServer,
    requestMemberList,
    tokenRevision,
  } = useSockets();

  const {
    connect,
    currentServerConnected,
    streamSources,
    videoStreams,
    currentChannelConnected,
    isConnected,
    isConnecting,
  } = useSFU();

  const lastActivityTimeRef = useRef(Date.now());
  const isAFKRef = useRef(false);

  useEffect(() => {
    isAFKRef.current = isAFK;
  }, [isAFK]);

  const [speakingByMember, setSpeakingByMember] = useState<
    ByServerUser<boolean>
  >({});
  const serverLoadingTimerRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
  const [serverLoadingTimedOut, setServerLoadingTimedOut] = useState<
    Record<string, boolean>
  >({});
  const [voiceWidth, setVoiceWidth] = useState("0px");
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);
  const [selectedDmId, setSelectedDmId] = useState<string | null>(null);

  const viewingHost = currentlyViewingServer?.host ?? null;
  const [selection, setSelection] = useState<ChannelSelection>(NO_CHANNEL);
  const shownSelection = selectChannel(
    selection,
    viewingHost,
    viewingHost ? serverDetailsList[viewingHost]?.channels : undefined,
    viewingHost ? getLastSelectedChannel(viewingHost) : null,
  );
  // In render, not an effect: effects ran a commit late, still holding the last server's channel.
  if (shownSelection !== selection) setSelection(shownSelection);
  const selectedChannelId = shownSelection.channelId;

  const viewingHostRef = useRef(viewingHost);
  viewingHostRef.current = viewingHost;
  /** A pick belongs to the server on screen when it was made. */
  const setSelectedChannelId = useCallback<Dispatch<SetStateAction<string | null>>>((next) => {
    setSelection((prev) => {
      const host = viewingHostRef.current;
      const current = prev.host === host ? prev.channelId : null;
      const channelId = typeof next === "function" ? next(current) : next;
      return prev.host === host && prev.channelId === channelId ? prev : { host, channelId };
    });
  }, []);

  const shouldAccessMic = useMemo(
    () => isConnecting || isConnected,
    [isConnecting, isConnected]
  );

  const { microphoneBuffer, isPttActive, isTransmitting } =
    useMicrophone(shouldAccessMic);

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

  // A DM wins while one is open. The channel selection is left underneath, so
  // closing the DM returns to the channel you were reading.
  const activeConversationId = selectedDmId || selectedChannelId || currentChannelId || "";

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
  }, [currentChannelId, setSelectedChannelId]);

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

  // Conversations belong to the server they were opened on. Without this the id
  // survives the switch and is asked for on a server that never heard of it.
  useEffect(() => {
    setSelectedDmId(null);
  }, [currentlyViewingServer?.host]);

  useEffect(() => {
    // Only ever the fixed sidebar width or closed — the panel is no longer
    // resizable, and maximizing is applied where the layout is composed.
    setVoiceWidth(
      currentServerConnected === currentlyViewingServer?.host
        ? `${VOICE_SIDEBAR_WIDTH}px`
        : "0px"
    );
  }, [currentServerConnected, currentlyViewingServer]);

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

  const heldHost = currentlyViewingServer?.host ?? "";
  const { clients: heldClients, selfClientId } = useHeldVoicePresence({
    host: heldHost,
    clients: clients[heldHost] ?? NO_CLIENTS,
    socketId: currentConnection?.id,
    selfInVoice: isConnected && currentServerConnected === heldHost,
    videoStreams,
    streamSources,
  });

  const speakingByMemberRef = useRef(speakingByMember);
  speakingByMemberRef.current = speakingByMember;
  // Looked up through the roster on every render, so a socket id change can't miss a poll.
  const clientsSpeaking = useMemo(
    () => byRosterClientId(speakingByMember, heldClients),
    [speakingByMember, heldClients],
  );

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

      const prev = speakingByMemberRef.current;
      const next: Record<string, boolean> = {};
      let changed = false;

      // The held roster still has a member's streamID while the restarted server doesn't.
      Object.entries(heldClients).forEach(([clientID, client]) => {
        let speaking = false;

        if (clientID === selfClientId) {
          if (inputMode === "push_to_talk") {
            speaking = isPttActive.current;
          } else if (isTransmitting !== null) {
            // Ask the gate directly. Deriving this from an analyser with its
            // own threshold made the indicator disagree with the noise gate.
            speaking = isTransmitting;
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

        const key = heldKey(clientID, client);
        next[key] = speaking;
        if (prev[key] !== speaking) changed = true;
      });

      if (changed) setSpeakingByMember(next);
    }, pollRate);

    return () => clearInterval(interval);
  }, [
    microphoneBuffer.finalAnalyser,
    isTransmitting,
    streamSources,
    heldClients,
    selfClientId,
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
  }, [currentlyViewingServer, serverDetailsList, setSelectedChannelId]);

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
    heldClients,
    selfClientId,
    voiceWidth,
    setVoiceWidth,
    selectedChannelId,
    setSelectedChannelId,
    selectedDmId,
    setSelectedDmId,
    handleVoiceDisconnect,
    setPendingChannelId,
    currentChannelId,
    currentConnection,
    accessToken,
    activeConversationId,
    serverFailure,
    hasTimedOut,
    currentConnectionStatus,
    currentRefusalReason: currentlyViewingServer ? refusalReason?.[currentlyViewingServer.host] : undefined,
    currentRefusalHelpUrl: currentlyViewingServer ? refusalHelpUrl?.[currentlyViewingServer.host] : undefined,
    reconnectServer,
  };
}
