import { Dispatch, MutableRefObject, SetStateAction } from "react";
import { Socket } from "socket.io-client";

import { Streams, StreamSources } from "../types/SFU";
import { voiceLog } from "./voiceLogger";

export interface CleanupRefs {
  peerConnectionRef: MutableRefObject<RTCPeerConnection | null>;
  sfuWebSocketRef: MutableRefObject<WebSocket | null>;
  registeredTracksRef: MutableRefObject<RTCRtpSender[]>;
  reconnectAttemptRef: MutableRefObject<NodeJS.Timeout | null>;
  connectionTimeoutRef: MutableRefObject<NodeJS.Timeout | null>;
  isDisconnectingRef: MutableRefObject<boolean>;
  isConnectingRef: MutableRefObject<boolean>;
  previousRemoteStreamsRef: MutableRefObject<Set<string>>;
}

export interface CleanupDeps {
  serverId: string | null;
  sockets: Record<string, Socket>;
  setStreamSources: Dispatch<SetStateAction<StreamSources>>;
  setStreams: Dispatch<SetStateAction<Streams>>;
}

export async function performSfuCleanup(
  refs: CleanupRefs,
  deps: CleanupDeps,
  skipServerUpdate = false,
): Promise<void> {
  const {
    peerConnectionRef, sfuWebSocketRef, registeredTracksRef,
    reconnectAttemptRef, connectionTimeoutRef,
    isDisconnectingRef, isConnectingRef, previousRemoteStreamsRef,
  } = refs;
  const { serverId, sockets, setStreamSources, setStreams } = deps;

  if (isDisconnectingRef.current) {
    voiceLog.warn("DISCONNECT", "Cleanup already in progress — skipping");
    return;
  }

  voiceLog.divider("VOICE DISCONNECT START");
  isDisconnectingRef.current = true;

  if (isConnectingRef.current) {
    voiceLog.info("DISCONNECT", "Cancelling in-progress connect");
    isConnectingRef.current = false;
  }

  if (reconnectAttemptRef.current) {
    clearTimeout(reconnectAttemptRef.current);
    reconnectAttemptRef.current = null;
  }

  if (connectionTimeoutRef.current) {
    clearTimeout(connectionTimeoutRef.current);
    connectionTimeoutRef.current = null;
  }

  previousRemoteStreamsRef.current.clear();

  // Step 1: Remove tracks
  const tracksToRemove = [...registeredTracksRef.current];
  registeredTracksRef.current = [];

  voiceLog.step("DISCONNECT", 1, `Removing ${tracksToRemove.length} registered tracks`);
  for (const sender of tracksToRemove) {
    try {
      if (peerConnectionRef.current && sender.track) {
        peerConnectionRef.current.removeTrack(sender);
      }
    } catch (error) {
      voiceLog.fail("DISCONNECT", 1, "Error removing track", error);
    }
  }

  // Step 2: Close peer connection
  if (peerConnectionRef.current) {
    voiceLog.step("DISCONNECT", 2, "Closing RTCPeerConnection", { state: peerConnectionRef.current.connectionState });
    try {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.oniceconnectionstatechange = null;
      peerConnectionRef.current.onicegatheringstatechange = null;
      peerConnectionRef.current.onsignalingstatechange = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.ondatachannel = null;

      if (peerConnectionRef.current.connectionState !== 'closed') {
        peerConnectionRef.current.close();
      }
      peerConnectionRef.current = null;
      voiceLog.ok("DISCONNECT", 2, "Peer connection closed");
    } catch (error) {
      voiceLog.fail("DISCONNECT", 2, "Error closing peer connection", error);
      peerConnectionRef.current = null;
    }
  }

  // Step 3: Close SFU WebSocket
  if (sfuWebSocketRef.current) {
    voiceLog.step("DISCONNECT", 3, "Closing SFU WebSocket", { readyState: sfuWebSocketRef.current.readyState });
    try {
      const wsToClean = sfuWebSocketRef.current;
      sfuWebSocketRef.current = null;

      wsToClean.onopen = null;
      wsToClean.onmessage = null;
      wsToClean.onclose = null;
      wsToClean.onerror = null;

      if (wsToClean.readyState === WebSocket.OPEN ||
          wsToClean.readyState === WebSocket.CONNECTING) {
        wsToClean.close(1000, "Client disconnecting gracefully");
      }
      voiceLog.ok("DISCONNECT", 3, "SFU WebSocket closed");
    } catch (error) {
      voiceLog.fail("DISCONNECT", 3, "Error closing SFU WebSocket", error);
      sfuWebSocketRef.current = null;
    }
  }

  // Step 4: Notify signaling server
  if (!skipServerUpdate && serverId && sockets[serverId]) {
    voiceLog.step("DISCONNECT", 4, "Notifying signaling server of disconnect");
    try {
      const socket = sockets[serverId];
      socket.emit("voice:channel:joined", false);
      await new Promise(resolve => setTimeout(resolve, 10));
      socket.emit("voice:stream:set", "");
      socket.emit("voice:room:leave");
      voiceLog.ok("DISCONNECT", 4, "Signaling server notified");
    } catch (error) {
      voiceLog.fail("DISCONNECT", 4, "Error notifying signaling server", error);
    }
  }

  // Step 5: Cleanup audio nodes and streams
  voiceLog.step("DISCONNECT", 5, "Cleaning up audio stream sources and remote streams");
  setStreamSources(prev => {
    Object.values(prev).forEach((source) => {
      try {
        source.gain?.disconnect();
        source.analyser?.disconnect();
        source.stream?.disconnect();
        if (source.audioElement) {
          source.audioElement.pause();
          source.audioElement.srcObject = null;
          source.audioElement.remove();
        }
      } catch { /* already disconnected */ }
    });
    return {};
  });

  setStreams(prev => {
    const localStreams: Streams = {};
    Object.entries(prev).forEach(([id, stream]) => {
      if (stream.isLocal) {
        localStreams[id] = stream;
      } else {
        try {
          stream.stream.getTracks().forEach(track => {
            if (track.readyState !== 'ended') {
              track.stop();
            }
          });
        } catch (error) {
          voiceLog.fail("DISCONNECT", 5, "Error stopping remote stream tracks", error);
        }
      }
    });
    return localStreams;
  });

  await new Promise(resolve => setTimeout(resolve, 50));
  isDisconnectingRef.current = false;
  voiceLog.divider("VOICE DISCONNECTED");
}

/**
 * Synchronous cleanup for component unmount — does not wait for async operations
 * or notify the server.
 */
export function performUnmountCleanup(
  refs: Pick<CleanupRefs,
    'sfuWebSocketRef' | 'peerConnectionRef' | 'reconnectAttemptRef' |
    'connectionTimeoutRef' | 'registeredTracksRef' | 'previousRemoteStreamsRef'
  >,
): void {
  const {
    sfuWebSocketRef, peerConnectionRef, reconnectAttemptRef,
    connectionTimeoutRef, registeredTracksRef, previousRemoteStreamsRef,
  } = refs;

  if (sfuWebSocketRef.current) {
    const ws = sfuWebSocketRef.current;
    sfuWebSocketRef.current = null;

    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;

      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, "Component cleanup");
      }
    } catch (error) {
      console.error("Error cleaning up WebSocket on unmount:", error);
    }
  }

  if (peerConnectionRef.current) {
    const pc = peerConnectionRef.current;
    peerConnectionRef.current = null;

    try {
      pc.onicecandidate = null;
      pc.oniceconnectionstatechange = null;
      pc.onicegatheringstatechange = null;
      pc.onsignalingstatechange = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.ondatachannel = null;

      if (pc.connectionState !== 'closed') {
        pc.close();
      }
    } catch (error) {
      console.error("Error cleaning up peer connection on unmount:", error);
    }
  }

  if (reconnectAttemptRef.current) {
    clearTimeout(reconnectAttemptRef.current);
    reconnectAttemptRef.current = null;
  }

  if (connectionTimeoutRef.current) {
    clearTimeout(connectionTimeoutRef.current);
    connectionTimeoutRef.current = null;
  }

  registeredTracksRef.current = [];
  previousRemoteStreamsRef.current.clear();
}
