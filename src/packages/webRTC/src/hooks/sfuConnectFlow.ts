import { Dispatch, MutableRefObject, SetStateAction } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";

import { handleRateLimitError } from "@/socket/src/utils/rateLimitHandler";

import { SFUConnectionState, Streams } from "../types/SFU";
import { getCachedSfuUrl, selectBestSfuUrl } from "./selectBestSfuUrl";
import { connectToSfuWebSocket } from "./sfuConnection";
import { RoomAccessData,SFUConnectionStateInternal } from "./sfuTypes";
import { voiceLog } from "./voiceLogger";

export function requestRoomAccess(roomId: string, socket: Socket): Promise<RoomAccessData> {
  return new Promise((resolve, reject) => {
    voiceLog.step("CONNECT", 4, "Requesting room access from server", { roomId });

    const timeout = setTimeout(() => {
      voiceLog.fail("CONNECT", 4, "Room access request timed out (15s)");
      reject(new Error("Room access request timeout"));
    }, 15000);

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("voice:room:granted", onAccessGranted);
      socket.off("voice:room:error", onRoomError);
    };

    const onAccessGranted = (roomData: RoomAccessData) => {
      cleanup();
      voiceLog.ok("CONNECT", 4, "Room access granted", {
        room_id: roomData.room_id,
        sfu_url: roomData.sfu_url,
      });
      resolve(roomData);
    };

    const onRoomError = (error: string | { error: string; message?: string; retryAfterMs?: number; currentScore?: number; maxScore?: number }) => {
      cleanup();

      if (typeof error === 'object' && error.error === 'rate_limited' && error.message) {
        voiceLog.fail("CONNECT", 4, "Room access rate-limited", error);
        handleRateLimitError(error, "Voice connection");
        reject(new Error(error.message));
        return;
      }

      const errorMessage = typeof error === 'string' ? error : error.error || 'Unknown error';
      voiceLog.fail("CONNECT", 4, `Room access denied: ${errorMessage}`);
      reject(new Error(`Room access denied: ${errorMessage}`));
    };

    socket.once("voice:room:granted", onAccessGranted);
    socket.once("voice:room:error", onRoomError);
    socket.emit("voice:room:request", roomId);
  });
}

export interface SetupPeerConnectionDeps {
  sfuWebSocketRef: MutableRefObject<WebSocket | null>;
  connectionTimeoutRef: MutableRefObject<NodeJS.Timeout | null>;
  isDisconnectingRef: MutableRefObject<boolean>;
  setStreams: Dispatch<SetStateAction<Streams>>;
  setConnectionState: Dispatch<SetStateAction<SFUConnectionStateInternal>>;
}

export function setupPeerConnection(
  stunServers: string[],
  deps: SetupPeerConnectionDeps,
  eSportsModeEnabled: boolean = false,
): RTCPeerConnection {
  const { sfuWebSocketRef, connectionTimeoutRef, isDisconnectingRef, setStreams, setConnectionState } = deps;

  const config: RTCConfiguration = {
    iceServers: [{ urls: stunServers }],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: 'all',
    bundlePolicy: eSportsModeEnabled ? 'max-bundle' : 'balanced',
    rtcpMuxPolicy: 'require',
    certificates: undefined,
  };

  const pc = new RTCPeerConnection(config);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      voiceLog.info("WEBRTC", `Local ICE candidate: type=${event.candidate.type} proto=${event.candidate.protocol} ${event.candidate.address}:${event.candidate.port}`);
      if (sfuWebSocketRef.current?.readyState === WebSocket.OPEN) {
        try {
          sfuWebSocketRef.current.send(JSON.stringify({
            event: "candidate",
            data: JSON.stringify(event.candidate),
          }));
        } catch (error) {
          voiceLog.fail("WEBRTC", "ICE", "Error sending local ICE candidate", error);
        }
      } else {
        voiceLog.warn("WEBRTC", `WebSocket not open (state=${sfuWebSocketRef.current?.readyState}), local ICE candidate dropped`);
      }
    } else {
      voiceLog.ok("WEBRTC", "ICE", "ICE gathering complete (null candidate)");
    }
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    if (state === 'connected' || state === 'completed') {
      voiceLog.ok("WEBRTC", "ICE", `ICE connection state → ${state}`);
    } else if (state === 'failed' || state === 'disconnected') {
      voiceLog.fail("WEBRTC", "ICE", `ICE connection state → ${state}`);
    } else {
      voiceLog.info("WEBRTC", `ICE connection state → ${state}`);
    }
  };
  pc.onicegatheringstatechange = () => {
    voiceLog.info("WEBRTC", `ICE gathering state → ${pc.iceGatheringState}`);
  };
  pc.onsignalingstatechange = () => {
    voiceLog.info("WEBRTC", `Signaling state → ${pc.signalingState}`);
  };

  pc.ontrack = (event) => {
    const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
    voiceLog.ok("WEBRTC", "TRACK", `Remote track received: kind=${event.track.kind} streamId=${remoteStream.id} trackId=${event.track.id}`);
    setStreams(prev => ({
      ...prev,
      [remoteStream.id]: { stream: remoteStream, isLocal: false },
    }));

    event.track.onended = () => {
      voiceLog.info("WEBRTC", `Remote track ended: streamId=${remoteStream.id} trackId=${event.track.id}`);
      setStreams(prev => {
        const next = { ...prev };
        delete next[remoteStream.id];
        return next;
      });
    };
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    const detail = { connectionState: state, iceState: pc.iceConnectionState, signalingState: pc.signalingState };

    switch (state) {
      case 'connected':
        voiceLog.ok("CONNECT", 9, "WebRTC CONNECTED — voice chat is live!", detail);
        voiceLog.divider("VOICE CONNECTED");
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        setConnectionState(prev => {
          if (prev.state === SFUConnectionState.CONNECTING) {
            return { ...prev, state: SFUConnectionState.CONNECTED };
          }
          return prev;
        });
        break;
      case 'connecting':
        voiceLog.info("WEBRTC", `Connection state → ${state}`, detail);
        break;
      case 'failed':
      case 'closed':
        voiceLog.fail("WEBRTC", "PC", `Connection state → ${state}`, detail);
        if (!isDisconnectingRef.current) {
          setConnectionState(prev => ({
            ...prev,
            state: SFUConnectionState.FAILED,
            error: "WebRTC connection failed",
          }));
        }
        break;
      default:
        voiceLog.info("WEBRTC", `Connection state → ${state}`, detail);
    }
  };

  try {
    const dataChannel = pc.createDataChannel("health", {
      ordered: true,
      maxRetransmits: 3,
    });
    dataChannel.onopen = null;
    dataChannel.onclose = null;
    dataChannel.onerror = (error) => {
      console.error("Data channel error:", error);
    };
  } catch {
    // Data channel creation is optional
  }

  return pc;
}

export interface ConnectParams {
  channelID: string;
  eSportsModeEnabled?: boolean;
  channelMaxBitrateBps?: number | null;
  connectSeq: number;
  connectSeqRef: MutableRefObject<number>;
  refs: {
    isConnectingRef: MutableRefObject<boolean>;
    isDisconnectingRef: MutableRefObject<boolean>;
    peerConnectionRef: MutableRefObject<RTCPeerConnection | null>;
    sfuWebSocketRef: MutableRefObject<WebSocket | null>;
    registeredTracksRef: MutableRefObject<RTCRtpSender[]>;
    connectionTimeoutRef: MutableRefObject<NodeJS.Timeout | null>;
    microphoneBufferRef: MutableRefObject<{ processedStream?: MediaStream; mediaStream?: MediaStream }>;
    activeSfuUrlRef: MutableRefObject<string | null>;
  };
  connectionState: SFUConnectionStateInternal;
  isConnected: boolean;
  currentlyViewingServer: { host: string; name: string };
  stunHosts: string[];
  sockets: Record<string, Socket>;
  sfuConnectionRefs: {
    isDisconnectingRef: MutableRefObject<boolean>;
    sfuWebSocketRef: MutableRefObject<WebSocket | null>;
    peerConnectionRef: MutableRefObject<RTCPeerConnection | null>;
  };
  connectSoundFile: string;
  connectSoundVolume: number;
  connectSoundEnabled: boolean;
  setConnectionState: Dispatch<SetStateAction<SFUConnectionStateInternal>>;
  setStreams: Dispatch<SetStateAction<Streams>>;
  performCleanup: (skipServerUpdate?: boolean) => Promise<void>;
}

export async function sfuConnect(params: ConnectParams): Promise<void> {
  const {
    channelID, refs, connectionState, isConnected,
    currentlyViewingServer, stunHosts, sockets,
    sfuConnectionRefs, connectSoundFile, connectSoundVolume, connectSoundEnabled,
    setConnectionState, setStreams, performCleanup,
    channelMaxBitrateBps, eSportsModeEnabled,
    connectSeq, connectSeqRef,
  } = params;
  const {
    isConnectingRef, isDisconnectingRef, peerConnectionRef,
    sfuWebSocketRef, registeredTracksRef, connectionTimeoutRef,
    microphoneBufferRef, activeSfuUrlRef,
  } = refs;

  const isStale = () => connectSeqRef.current !== connectSeq;

  try {
    voiceLog.divider("VOICE CONNECT START");
    voiceLog.step("CONNECT", 0, "Starting connection flow", {
      channelID,
      server: currentlyViewingServer.host,
      currentState: connectionState.state,
      isConnected,
      seq: connectSeq,
    });

    if (!channelID) {
      voiceLog.fail("CONNECT", 0, "Invalid channel ID (empty)");
      throw new Error("Invalid channel ID");
    }

    if (
      connectionState.state === SFUConnectionState.CONNECTED &&
      connectionState.roomId === channelID &&
      connectionState.serverId === currentlyViewingServer.host
    ) {
      voiceLog.info("CONNECT", "Already connected to this room — skipping");
      return;
    }

    // If another connection is in progress, tear it down first
    if (isConnectingRef.current) {
      voiceLog.info("CONNECT", "Superseding in-progress connection — cleaning up");
      await performCleanup(true);
    }

    if (isDisconnectingRef.current) {
      voiceLog.info("CONNECT", "Waiting for previous disconnect to finish…");
      for (let i = 0; i < 5; i++) {
        if (!isDisconnectingRef.current) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (isStale()) { voiceLog.info("CONNECT", "Superseded before start — aborting"); return; }
    isConnectingRef.current = true;

    // ---- Step 1: Room-switching cleanup ----
    if (isConnected && (connectionState.roomId !== channelID || connectionState.serverId !== currentlyViewingServer.host)) {
      voiceLog.step("CONNECT", 1, "Room switch detected — cleaning up previous connection", {
        oldRoom: connectionState.roomId,
        oldServer: connectionState.serverId,
      });

      if (connectionState.serverId && sockets[connectionState.serverId]) {
        try {
          const oldSocket = sockets[connectionState.serverId];
          oldSocket.emit("voice:channel:joined", false);
          await new Promise(resolve => setTimeout(resolve, 10));
          oldSocket.emit("voice:stream:set", "");
          oldSocket.emit("voice:room:leave");
          voiceLog.ok("CONNECT", 1, "Notified old server of disconnect");
        } catch (error) {
          voiceLog.fail("CONNECT", 1, "Error notifying old server", error);
        }
      }

      if (sfuWebSocketRef.current) {
        const oldWs = sfuWebSocketRef.current;
        sfuWebSocketRef.current = null;
        try {
          oldWs.onopen = null;
          oldWs.onmessage = null;
          oldWs.onclose = null;
          oldWs.onerror = null;
          if (oldWs.readyState === WebSocket.OPEN || oldWs.readyState === WebSocket.CONNECTING) {
            oldWs.close(1000, "Switching rooms");
          }
          voiceLog.ok("CONNECT", 1, "Old SFU WebSocket closed");
        } catch (error) {
          voiceLog.fail("CONNECT", 1, "Error cleaning up old WebSocket", error);
        }
      }

      if (peerConnectionRef.current) {
        const oldPc = peerConnectionRef.current;
        peerConnectionRef.current = null;
        try {
          oldPc.onicecandidate = null;
          oldPc.oniceconnectionstatechange = null;
          oldPc.onicegatheringstatechange = null;
          oldPc.onsignalingstatechange = null;
          oldPc.ontrack = null;
          oldPc.onconnectionstatechange = null;
          oldPc.ondatachannel = null;
          if (oldPc.connectionState !== 'closed') {
            oldPc.close();
          }
          voiceLog.ok("CONNECT", 1, "Old peer connection closed");
        } catch (error) {
          voiceLog.fail("CONNECT", 1, "Error cleaning up old peer connection", error);
        }
      }

      registeredTracksRef.current = [];
      await new Promise(resolve => setTimeout(resolve, 50));
      if (isStale()) { voiceLog.info("CONNECT", "Superseded during cleanup — aborting"); return; }
    }

    // ---- Step 2: Set CONNECTING state ----
    voiceLog.step("CONNECT", 2, "Setting state to CONNECTING");
    setConnectionState({
      state: SFUConnectionState.CONNECTING,
      roomId: channelID,
      serverId: currentlyViewingServer.host,
      error: null,
    });

    // ---- Step 3: Wait for microphone ----
    voiceLog.step("CONNECT", 3, "Waiting for microphone stream", {
      hasProcessedStream: !!microphoneBufferRef.current.processedStream,
      hasMediaStream: !!microphoneBufferRef.current.mediaStream,
    });

    let streamToUse = microphoneBufferRef.current.processedStream || microphoneBufferRef.current.mediaStream;

    if (streamToUse) {
      const audioTracks = streamToUse.getAudioTracks();
      const hasLiveTracks = audioTracks.length > 0 && audioTracks.some(track => track.readyState === 'live');
      voiceLog.info("CONNECT", `Initial stream check: ${audioTracks.length} tracks, live=${hasLiveTracks}`);
      if (!hasLiveTracks) streamToUse = undefined;
    }

    if (!streamToUse) {
      voiceLog.info("CONNECT", "No live stream yet — polling up to 6s…");
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (isStale()) { voiceLog.info("CONNECT", "Superseded during mic poll — aborting"); return; }
        streamToUse = microphoneBufferRef.current.processedStream || microphoneBufferRef.current.mediaStream;
        if (streamToUse) {
          const audioTracks = streamToUse.getAudioTracks();
          if (audioTracks.length > 0 && audioTracks.some(track => track.readyState === 'live')) {
            voiceLog.ok("CONNECT", 3, `Microphone ready after ${(attempt + 1) * 200}ms`, {
              trackCount: audioTracks.length,
              trackStates: audioTracks.map(t => ({ id: t.id, readyState: t.readyState, label: t.label })),
            });
            break;
          } else {
            streamToUse = undefined;
          }
        }
      }
      if (!streamToUse) {
        voiceLog.fail("CONNECT", 3, "Microphone not available after 6s polling");
        throw new Error("Microphone not available - please check microphone settings");
      }
    } else {
      const tracks = streamToUse.getAudioTracks();
      voiceLog.ok("CONNECT", 3, "Microphone stream available immediately", {
        trackCount: tracks.length,
        trackStates: tracks.map(t => ({ id: t.id, readyState: t.readyState, label: t.label })),
      });
    }

    const audioTracks = streamToUse.getAudioTracks();
    if (audioTracks.length === 0 || !audioTracks.some(track => track.readyState === 'live')) {
      voiceLog.info("CONNECT", "Tracks not live yet — waiting up to 1.5s…");
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 150));
        if (isStale()) { voiceLog.info("CONNECT", "Superseded during track wait — aborting"); return; }
        const currentTracks = streamToUse.getAudioTracks();
        if (currentTracks.length > 0 && currentTracks.some(track => track.readyState === 'live')) break;
      }
      const finalTracks = streamToUse.getAudioTracks();
      if (finalTracks.length === 0 || !finalTracks.some(track => track.readyState === 'live')) {
        voiceLog.fail("CONNECT", 3, "Microphone tracks never became live", {
          trackStates: finalTracks.map(t => ({ id: t.id, readyState: t.readyState })),
        });
        throw new Error("Microphone not ready - please wait a moment and try again");
      }
    }

    if (isStale()) { voiceLog.info("CONNECT", "Superseded before room access — aborting"); return; }

    const socket = sockets[currentlyViewingServer.host];
    if (!socket) {
      voiceLog.fail("CONNECT", 4, "Socket connection not available for server", { server: currentlyViewingServer.host });
      throw new Error("Socket connection not available");
    }

    // ---- Step 4: Request room access (inside requestRoomAccess) ----
    const roomData = await requestRoomAccess(channelID, socket);
    if (isStale()) { voiceLog.info("CONNECT", "Superseded after room access — aborting"); return; }

    // ---- Step 5: Setup WebRTC peer connection ----
    voiceLog.step("CONNECT", 5, "Creating RTCPeerConnection", { stunServers: stunHosts, eSportsModeEnabled });
    const peerConnection = setupPeerConnection(stunHosts, {
      sfuWebSocketRef, connectionTimeoutRef, isDisconnectingRef,
      setStreams, setConnectionState,
    }, eSportsModeEnabled);
    peerConnectionRef.current = peerConnection;
    voiceLog.ok("CONNECT", 5, "RTCPeerConnection created", {
      signalingState: peerConnection.signalingState,
      connectionState: peerConnection.connectionState,
    });

    connectionTimeoutRef.current = setTimeout(() => {
      if (peerConnectionRef.current && !isDisconnectingRef.current) {
        voiceLog.fail("CONNECT", "TIMEOUT", "Full connection timed out after 20s", {
          pcState: peerConnectionRef.current.connectionState,
          iceState: peerConnectionRef.current.iceConnectionState,
        });
        toast.error("Connection timed out. Please try again.");
        setConnectionState({
          state: SFUConnectionState.DISCONNECTED,
          roomId: null,
          serverId: null,
          error: null,
        });
        performCleanup(false).catch(console.error);
      }
    }, 20000);

    if (isStale()) {
      voiceLog.info("CONNECT", "Superseded after peer connection setup — aborting");
      peerConnection.close();
      peerConnectionRef.current = null;
      return;
    }

    // ---- Step 6: Add local tracks ----
    const localStream = streamToUse;
    const tracks: RTCRtpSender[] = [];
    localStream.getTracks().forEach((track) => {
      const sender = peerConnection.addTrack(track, localStream);
      tracks.push(sender);
    });
    registeredTracksRef.current = tracks;

    voiceLog.ok("CONNECT", 6, "Local audio tracks added to peer connection", {
      trackCount: tracks.length,
      tracks: localStream.getTracks().map(t => ({
        kind: t.kind, id: t.id, readyState: t.readyState, label: t.label,
      })),
    });

    const OPUS_MAX_BITRATE_BPS = 510_000;
    const ESPORTS_MAX_BITRATE_BPS = 128_000;
    const effectiveBitrate = eSportsModeEnabled
      ? ESPORTS_MAX_BITRATE_BPS
      : (typeof channelMaxBitrateBps === "number" && channelMaxBitrateBps > 0 ? channelMaxBitrateBps : OPUS_MAX_BITRATE_BPS);

    voiceLog.info("CONNECT", eSportsModeEnabled
      ? `eSports mode — capping bitrate at ${ESPORTS_MAX_BITRATE_BPS / 1000}kbps (Opus studio quality)`
      : `Applying max bitrate: ${effectiveBitrate / 1000}kbps${channelMaxBitrateBps ? " (channel)" : " (Opus ceiling)"}`);
    tracks.forEach((sender) => {
      try {
        if (sender.track?.kind !== "audio") return;
        const params = sender.getParameters();
        const enc = params.encodings && params.encodings.length > 0 ? params.encodings : [{} as RTCRtpEncodingParameters];
        enc[0] = { ...enc[0], maxBitrate: effectiveBitrate };
        sender.setParameters({ ...params, encodings: enc }).catch(() => undefined);
      } catch {
        // ignore
      }
    });

    setStreams(prev => {
      const nonLocalEntries = Object.entries(prev).filter(([, s]) => !s.isLocal);
      const nonLocal = Object.fromEntries(nonLocalEntries);
      return { ...nonLocal, [localStream.id]: { stream: localStream, isLocal: true } };
    });

    // ---- Step 7: Connect to SFU WebSocket ----
    const sfuCandidates = roomData.sfu_urls?.length ? roomData.sfu_urls : [roomData.sfu_url];
    const sfuUrl = getCachedSfuUrl(currentlyViewingServer.host) ?? await selectBestSfuUrl(sfuCandidates, currentlyViewingServer.host);
    if (isStale()) {
      voiceLog.info("CONNECT", "Superseded before SFU WebSocket — aborting");
      peerConnection.close();
      peerConnectionRef.current = null;
      return;
    }
    activeSfuUrlRef.current = sfuUrl;
    voiceLog.step("CONNECT", 7, "Connecting WebSocket to SFU", { sfu_url: sfuUrl, eSportsModeEnabled });
    let sfuWebSocket: WebSocket;
    try {
      sfuWebSocket = await connectToSfuWebSocket(sfuUrl, roomData.join_token, sfuConnectionRefs, eSportsModeEnabled);
      sfuWebSocketRef.current = sfuWebSocket;
      voiceLog.ok("CONNECT", 7, "SFU WebSocket connected & room joined");
    } catch (error) {
      voiceLog.fail("CONNECT", 7, "SFU WebSocket connection failed", error);
      throw new Error("Failed to connect to SFU server");
    }

    if (isStale()) {
      voiceLog.info("CONNECT", "Superseded after SFU WebSocket — aborting");
      sfuWebSocket.close(1000, "Superseded");
      sfuWebSocketRef.current = null;
      peerConnection.close();
      peerConnectionRef.current = null;
      return;
    }

    // ---- Step 8: Notify signaling server ----
    voiceLog.step("CONNECT", 8, "Notifying signaling server (stream:set + channel:joined)", {
      streamId: localStream.id,
    });
    socket.emit("voice:stream:set", localStream.id);
    await new Promise(resolve => setTimeout(resolve, 10));
    socket.emit("voice:channel:joined", true);
    voiceLog.ok("CONNECT", 8, "Signaling server notified");

    // Stay in CONNECTING state - the pc.onconnectionstatechange handler
    // will transition to CONNECTED once the WebRTC peer connection is
    // actually established (ICE + DTLS complete).
    // Keep roomId as the bare channelID (not roomData.room_id which has a
    // server-internal prefix) so it matches client.voiceChannelId for filtering.
    setConnectionState({
      state: SFUConnectionState.CONNECTING,
      roomId: channelID,
      serverId: currentlyViewingServer.host,
      error: null,
    });

    voiceLog.step("CONNECT", 9, "Waiting for WebRTC ICE + DTLS to complete (state → CONNECTED)…", {
      currentPcState: peerConnection.connectionState,
      currentIceState: peerConnection.iceConnectionState,
    });

    if (connectSoundEnabled) {
      try {
        const audio = new Audio(connectSoundFile);
        audio.volume = Math.max(0, Math.min(1, connectSoundVolume / 100));
        audio.play().catch(() => {});
      } catch (error) {
        voiceLog.warn("CONNECT", "Failed to play connect sound", error);
      }
    }

  } catch (error) {
    if (isStale()) {
      voiceLog.info("CONNECT", "Superseded connection threw — ignoring error");
      return;
    }
    voiceLog.fail("CONNECT", "X", "CONNECTION FAILED", error);

    const errorMessage = error instanceof Error ? error.message : "Connection failed";
    toast.error(errorMessage || "Failed to connect to voice server");

    performCleanup(false).catch(console.error);

    setConnectionState({
      state: SFUConnectionState.FAILED,
      roomId: null,
      serverId: null,
      error: errorMessage,
    });

    throw error;
  } finally {
    if (!isStale()) {
      isConnectingRef.current = false;
    }
  }
}
