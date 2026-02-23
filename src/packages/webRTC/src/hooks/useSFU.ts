import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { singletonHook } from "react-singleton-hook";

import { useMicrophone, useSpeakers } from "@/audio";
import connectMp3 from "@/audio/src/assets/connect.mp3";
import disconnectMp3 from "@/audio/src/assets/disconnect.mp3";
import { playNotificationSound } from "@/lib/notificationSound";
import { useSettings } from "@/settings";
import { useServerManagement,useSockets } from "@/socket";

import { SFUConnectionState, SFUInterface, Streams, StreamSources, VideoStreams } from "../types/SFU";
import { CleanupRefs,performSfuCleanup, performUnmountCleanup } from "./sfuCleanup";
import { sfuConnect } from "./sfuConnectFlow";
import { SFUConnectionStateInternal } from "./sfuTypes";
import { useSFUStreams } from "./useSFUStreams";

function useSfuHook(): SFUInterface {
  // Core WebRTC references
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const sfuWebSocketRef = useRef<WebSocket | null>(null);
  const registeredTracksRef = useRef<RTCRtpSender[]>([]);
  const reconnectAttemptRef = useRef<NodeJS.Timeout | null>(null);
  const previousRemoteStreamsRef = useRef<Set<string>>(new Set());
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isDisconnectingRef = useRef<boolean>(false);
  const isConnectingRef = useRef<boolean>(false);
  const connectSeqRef = useRef<number>(0);

  // State management
  const [connectionState, setConnectionState] = useState<SFUConnectionStateInternal>({
    state: SFUConnectionState.DISCONNECTED,
    roomId: null,
    serverId: null,
    error: null,
  });
  const activeSfuUrlRef = useRef<string | null>(null);

  const [streams, setStreams] = useState<Streams>({});
  const [streamSources, setStreamSources] = useState<StreamSources>({});
  const [videoStreams, setVideoStreams] = useState<VideoStreams>({});
  const videoSenderRef = useRef<RTCRtpSender | null>(null);
  const screenVideoSenderRef = useRef<RTCRtpSender | null>(null);
  const screenAudioSenderRef = useRef<RTCRtpSender | null>(null);

  // Dependencies
  const {
    outputVolume,
    connectSoundEnabled,
    disconnectSoundEnabled,
    connectSoundVolume,
    disconnectSoundVolume,
    customConnectSoundFile,
    customDisconnectSoundFile,
    isDeafened,
    isServerDeafened,
    eSportsModeEnabled,
  } = useSettings();
  const effectiveDeafened = isDeafened || isServerDeafened;

  const {
    currentlyViewingServer,
    servers,
  } = useServerManagement();

  const { sockets, serverDetailsList } = useSockets();

  const connectSoundFile = customConnectSoundFile || connectMp3;
  const disconnectSoundFile = customDisconnectSoundFile || disconnectMp3;

  // Computed values
  const sfuHost = useMemo(() => {
    return currentlyViewingServer?.host && serverDetailsList[currentlyViewingServer.host]?.sfu_host;
  }, [serverDetailsList, currentlyViewingServer]);

  const stunHosts = useMemo(() => {
    return currentlyViewingServer?.host && serverDetailsList[currentlyViewingServer.host]?.stun_hosts;
  }, [serverDetailsList, currentlyViewingServer]);

  const isConnected = useMemo(() => {
    return connectionState.state === SFUConnectionState.CONNECTED &&
           !!sfuWebSocketRef.current &&
           !!peerConnectionRef.current;
  }, [connectionState.state]);

  const isConnecting = useMemo(() => {
    return connectionState.state === SFUConnectionState.CONNECTING ||
           connectionState.state === SFUConnectionState.REQUESTING_ACCESS ||
           connectionState.state === SFUConnectionState.RECONNECTING;
  }, [connectionState.state]);

  // Access shared microphone buffer
  const { microphoneBuffer } = useMicrophone(isConnecting || isConnected);
  const microphoneBufferRef = useRef(microphoneBuffer);
  useEffect(() => { microphoneBufferRef.current = microphoneBuffer; }, [microphoneBuffer]);
  const { audioContext, remoteBusNode } = useSpeakers();

  // Stable refs bundle for cleanup helpers
  const cleanupRefs: CleanupRefs = useMemo(() => ({
    peerConnectionRef, sfuWebSocketRef, registeredTracksRef,
    reconnectAttemptRef, connectionTimeoutRef,
    isDisconnectingRef, isConnectingRef, previousRemoteStreamsRef,
  }), []);

  const performCleanup = useCallback(async (skipServerUpdate = false) => {
    await performSfuCleanup(cleanupRefs, {
      serverId: connectionState.serverId,
      sockets,
      setStreamSources,
      setStreams,
    }, skipServerUpdate);
  }, [connectionState.serverId, sockets, cleanupRefs]);

  useSFUStreams({
    streams,
    setStreams,
    streamSources,
    setStreamSources,
    setVideoStreams,
    audioContext,
    remoteBusNode,
    outputVolume,
    isDeafened: effectiveDeafened,
    isConnected,
    connectionServerId: connectionState.serverId,
    sockets,
    previousRemoteStreamsRef,
  });

  // Auto-disconnect when server is removed
  useEffect(() => {
    if (isConnected && connectionState.serverId && currentlyViewingServer?.host !== connectionState.serverId) {
      const serverStillExists = servers[connectionState.serverId];
      if (!serverStillExists) {
        disconnect().catch(console.error);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers, connectionState.serverId, isConnected, currentlyViewingServer?.host]);

  // Cleanup on unmount
  useEffect(() => {
    return () => performUnmountCleanup(cleanupRefs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sfuConnectionRefs = useMemo(() => ({
    isDisconnectingRef,
    sfuWebSocketRef,
    peerConnectionRef,
  }), []);

  // Track the last channel ID so we can reconnect after server restart
  const lastChannelIdRef = useRef<string>("");

  // Enhanced connect function — delegates to sfuConnectFlow
  const connect = useCallback(async (channelID: string, channelEsportsMode?: boolean, channelMaxBitrate?: number | null): Promise<void> => {
    if (!currentlyViewingServer) {
      throw new Error("No server selected");
    }
    if (!sfuHost || !stunHosts) {
      throw new Error("SFU configuration not available");
    }

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (channelID !== lastChannelIdRef.current) {
      reconnectAttemptsRef.current = 0;
    }

    lastChannelIdRef.current = channelID;
    const seq = ++connectSeqRef.current;

    await sfuConnect({
      channelID,
      eSportsModeEnabled: eSportsModeEnabled || channelEsportsMode === true,
      channelMaxBitrateBps: channelMaxBitrate ?? null,
      connectSeq: seq,
      connectSeqRef,
      refs: {
        isConnectingRef, isDisconnectingRef, peerConnectionRef,
        sfuWebSocketRef, registeredTracksRef, connectionTimeoutRef,
        microphoneBufferRef, activeSfuUrlRef,
      },
      connectionState,
      isConnected,
      currentlyViewingServer,
      stunHosts,
      sockets,
      sfuConnectionRefs,
      connectSoundFile,
      connectSoundVolume,
      connectSoundEnabled,
      setConnectionState,
      setStreams,
      performCleanup,
    });
  }, [
    currentlyViewingServer,
    sfuHost,
    stunHosts,
    connectionState,
    isConnected,
    sockets,
    sfuConnectionRefs,
    connectSoundFile,
    connectSoundVolume,
    connectSoundEnabled,
    performCleanup,
    eSportsModeEnabled,
  ]);

  // Enhanced disconnect — optimistic with background cleanup
  const disconnect = useCallback(async (playSound?: boolean, onDisconnect?: () => void): Promise<void> => {
    const shouldPlaySound = playSound !== false && disconnectSoundEnabled;

    reconnectAttemptsRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    setConnectionState({
      state: SFUConnectionState.DISCONNECTED,
      roomId: null,
      serverId: null,
      error: null,
    });

    if (shouldPlaySound) {
      playNotificationSound(disconnectSoundFile, disconnectSoundVolume);
    }

    if (onDisconnect) {
      onDisconnect();
    }

    performCleanup(false).catch((error) => {
      console.error("Background cleanup error:", error);
      setStreamSources({});
    });
  }, [disconnectSoundFile, disconnectSoundVolume, disconnectSoundEnabled, performCleanup]);

  const addVideoTrack = useCallback((track: MediaStreamTrack, stream: MediaStream) => {
    const pc = peerConnectionRef.current;
    if (!pc || pc.connectionState === "closed") return;
    if (videoSenderRef.current) {
      videoSenderRef.current.replaceTrack(track).catch(() => {});
      return;
    }
    const sender = pc.addTrack(track, stream);
    videoSenderRef.current = sender;
  }, []);

  const removeVideoTrack = useCallback(() => {
    const pc = peerConnectionRef.current;
    const sender = videoSenderRef.current;
    if (!pc || !sender || pc.connectionState === "closed") return;
    try {
      pc.removeTrack(sender);
    } catch { /* already removed */ }
    videoSenderRef.current = null;
  }, []);

  const addScreenVideoTrack = useCallback((track: MediaStreamTrack, stream: MediaStream) => {
    const pc = peerConnectionRef.current;
    if (!pc || pc.connectionState === "closed") return;
    if (screenVideoSenderRef.current) {
      screenVideoSenderRef.current.replaceTrack(track).catch(() => {});
      return;
    }
    const sender = pc.addTrack(track, stream);
    screenVideoSenderRef.current = sender;
  }, []);

  const removeScreenVideoTrack = useCallback(() => {
    const pc = peerConnectionRef.current;
    const sender = screenVideoSenderRef.current;
    if (!pc || !sender || pc.connectionState === "closed") return;
    try { pc.removeTrack(sender); } catch { /* already removed */ }
    screenVideoSenderRef.current = null;
  }, []);

  const addScreenAudioTrack = useCallback((track: MediaStreamTrack, stream: MediaStream) => {
    const pc = peerConnectionRef.current;
    if (!pc || pc.connectionState === "closed") return;
    if (screenAudioSenderRef.current) {
      screenAudioSenderRef.current.replaceTrack(track).catch(() => {});
      return;
    }
    const sender = pc.addTrack(track, stream);
    screenAudioSenderRef.current = sender;
  }, []);

  const removeScreenAudioTrack = useCallback(() => {
    const pc = peerConnectionRef.current;
    const sender = screenAudioSenderRef.current;
    if (!pc || !sender || pc.connectionState === "closed") return;
    try { pc.removeTrack(sender); } catch { /* already removed */ }
    screenAudioSenderRef.current = null;
  }, []);

  // Listen for server-initiated disconnects (device switching)
  useEffect(() => {
    const handleServerDisconnect = (event: CustomEvent) => {
      const { host, reason } = event.detail;

      disconnect(false).catch(error => {
        console.error('Error during server-initiated disconnect:', error);
      });

      window.dispatchEvent(new CustomEvent('voice_disconnect_text_switch', {
        detail: { host, reason }
      }));
    };

    window.addEventListener('server_voice_disconnect', handleServerDisconnect as EventListener);

    return () => {
      window.removeEventListener('server_voice_disconnect', handleServerDisconnect as EventListener);
    };
  }, [disconnect]);

  // Reconnect voice after the signaling server restarts.
  // The SFU/WebRTC connection may still be alive, but the server lost all
  // in-memory state, so a full disconnect + reconnect is the only way to
  // restore speaking indicators, stream mapping, and member-list voice status.
  const connectionStateRef = useRef(connectionState);
  useEffect(() => { connectionStateRef.current = connectionState; }, [connectionState]);
  const connectRef = useRef(connect);
  useEffect(() => { connectRef.current = connect; }, [connect]);
  const disconnectRef = useRef(disconnect);
  useEffect(() => { disconnectRef.current = disconnect; }, [disconnect]);

  useEffect(() => {
    const handleServerReconnected = (event: CustomEvent) => {
      const { host } = event.detail;
      const cs = connectionStateRef.current;

      if (
        (cs.state !== SFUConnectionState.CONNECTED && cs.state !== SFUConnectionState.CONNECTING) ||
        cs.serverId !== host
      ) {
        return;
      }

      const channelId = lastChannelIdRef.current;
      if (!channelId) return;

      console.info("[Voice Recovery] Server reconnected — will disconnect and rejoin voice channel:", channelId);

      disconnectRef.current(false).then(() => {
        setTimeout(() => {
          console.info("[Voice Recovery] Attempting voice reconnect to channel:", channelId);
          connectRef.current(channelId).catch((error) => {
            console.error("[Voice Recovery] Failed to reconnect voice:", error);
          });
        }, 2500);
      }).catch((error) => {
        console.error("[Voice Recovery] Error during disconnect:", error);
      });
    };

    window.addEventListener("server_socket_reconnected", handleServerReconnected as EventListener);
    return () => {
      window.removeEventListener("server_socket_reconnected", handleServerReconnected as EventListener);
    };
  }, [sockets]);

  const MAX_RECONNECT_ATTEMPTS = 5;
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (connectionState.state === SFUConnectionState.CONNECTED) {
      reconnectAttemptsRef.current = 0;
    }
  }, [connectionState.state]);

  useEffect(() => {
    if (connectionState.state !== SFUConnectionState.FAILED) return;

    const channelId = lastChannelIdRef.current;
    if (!channelId) return;

    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.warn("[Voice Recovery] Max reconnect attempts reached — giving up");
      toast.error("Voice connection failed after multiple attempts. Please try again.", { id: "voice-reconnect" });
      setConnectionState({
        state: SFUConnectionState.DISCONNECTED,
        roomId: null,
        serverId: null,
        error: null,
      });
      reconnectAttemptsRef.current = 0;
      return;
    }

    reconnectAttemptsRef.current++;
    const attempt = reconnectAttemptsRef.current;
    const delayMs = Math.min(1500 * Math.pow(2, attempt - 1), 10_000);

    console.info(`[Voice Recovery] Connection lost — auto-reconnecting (attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS}) in ${delayMs}ms`);

    setConnectionState(prev => ({
      ...prev,
      state: SFUConnectionState.RECONNECTING,
    }));

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connectRef.current(channelId).catch((error) => {
        console.error(`[Voice Recovery] Reconnect attempt ${attempt} failed:`, error);
      });
    }, delayMs);

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connectionState.state]);

  // Monitor processedStream changes and update WebRTC tracks
  useEffect(() => {
    if (!isConnected || !peerConnectionRef.current || !registeredTracksRef.current) {
      return;
    }

    const newStream = microphoneBuffer.processedStream || microphoneBuffer.mediaStream;
    if (!newStream) return;

    const currentLocalStreamEntry = Object.entries(streams).find(([, stream]) => stream.isLocal);
    const currentStreamId = currentLocalStreamEntry?.[1].stream.id;
    if (currentStreamId === newStream.id) return;

    const currentTracks = currentLocalStreamEntry?.[1].stream.getAudioTracks() || [];
    const newTracks = newStream.getAudioTracks();

    const tracksChanged = currentTracks.length !== newTracks.length ||
                          currentTracks.some((track, index) => track.id !== newTracks[index]?.id);
    if (!tracksChanged || newTracks.length === 0) return;

    const registeredTracks = registeredTracksRef.current;

    try {
      const updatePromises = registeredTracks.map(async (sender, index) => {
        const newTrack = newTracks[index];
        if (newTrack && sender.track) {
          await sender.replaceTrack(newTrack);
        }
      });

      Promise.all(updatePromises).then(() => {
        setStreams(prev => {
          const nonLocalEntries = Object.entries(prev).filter(([, s]) => !s.isLocal);
          const nonLocal = Object.fromEntries(nonLocalEntries);
          return {
            ...nonLocal,
            [newStream.id]: { stream: newStream, isLocal: true },
          };
        });
      }).catch(error => {
        console.error("Error updating WebRTC tracks:", error);
      });
    } catch (error) {
      console.error("Error replacing WebRTC tracks:", error);
    }
  }, [microphoneBuffer.processedStream, microphoneBuffer.mediaStream, isConnected, streams]);

  return {
    streams,
    error: connectionState.error,
    streamSources,
    videoStreams,
    connect,
    disconnect,
    addVideoTrack,
    removeVideoTrack,
    addScreenVideoTrack,
    removeScreenVideoTrack,
    addScreenAudioTrack,
    removeScreenAudioTrack,
    currentServerConnected: connectionState.serverId || "",
    isConnected,
    currentChannelConnected: connectionState.roomId || "",
    connectionState: connectionState.state,
    isConnecting,
    getPeerConnection: () => peerConnectionRef.current,
    activeSfuUrl: activeSfuUrlRef.current,
  };
}

const init: SFUInterface = {
  error: null,
  streams: {},
  streamSources: {},
  videoStreams: {},
  connect: () => Promise.resolve(),
  disconnect: () => Promise.resolve(),
  addVideoTrack: () => {},
  removeVideoTrack: () => {},
  addScreenVideoTrack: () => {},
  removeScreenVideoTrack: () => {},
  addScreenAudioTrack: () => {},
  removeScreenAudioTrack: () => {},
  currentChannelConnected: "",
  currentServerConnected: "",
  isConnected: false,
  connectionState: SFUConnectionState.DISCONNECTED,
  isConnecting: false,
  activeSfuUrl: null,
};

const SFUHook = singletonHook(init, useSfuHook);

export const useSFU = () => {
  return SFUHook();
};
