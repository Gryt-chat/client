import { MutableRefObject } from "react";

import { voiceLog } from "./voiceLogger";

/**
 * Reduce Opus packetization time from the default 20ms to 10ms.
 * Each shaved frame directly reduces one-way latency by ~10ms.
 */
function optimizeSdpForLowLatency(sdp: string): string {
  let result = sdp.replace(/a=ptime:\d+\r\n/g, '');
  result = result.replace(/a=maxptime:\d+\r\n/g, '');
  result = result.replace(
    /(m=audio[^\r\n]*\r\n)/,
    '$1a=ptime:10\r\na=maxptime:10\r\n',
  );
  return result;
}

interface SFUConnectionRefs {
  isDisconnectingRef: MutableRefObject<boolean>;
  sfuWebSocketRef: MutableRefObject<WebSocket | null>;
  peerConnectionRef: MutableRefObject<RTCPeerConnection | null>;
}

export async function connectToSfuWebSocket(
  sfuUrl: string,
  joinToken: unknown,
  refs: SFUConnectionRefs,
  eSportsModeEnabled: boolean = false,
): Promise<WebSocket> {
  const { isDisconnectingRef, sfuWebSocketRef, peerConnectionRef } = refs;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(sfuUrl);
    let isResolved = false;
    let offerProcessingInProgress = false;
    let pendingOffer: RTCSessionDescriptionInit | null = null;
    let connectionMonitor: NodeJS.Timeout | null = null;
    let reconnectAttempt = 0;
    const maxReconnectAttempts = 3;

    voiceLog.step("SFU-WS", "7a", "Opening WebSocket to SFU", { url: sfuUrl });

    const timeout = setTimeout(() => {
      if (!isResolved) {
        voiceLog.fail("SFU-WS", "7a", "WebSocket connection timed out (15s)");
        cleanup();
        ws.close();
        reject(new Error("SFU WebSocket connection timeout"));
      }
    }, 15000);

    const cleanup = () => {
      if (connectionMonitor) {
        clearInterval(connectionMonitor);
        connectionMonitor = null;
      }

      reconnectAttempt = maxReconnectAttempts;

      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
      } catch {
        // Event listeners already removed
      }
    };

    const startConnectionMonitor = () => {
      connectionMonitor = setInterval(() => {
        if (isDisconnectingRef.current) {
          cleanup();
          return;
        }

        if (isResolved && sfuWebSocketRef.current && sfuWebSocketRef.current !== ws) {
          cleanup();
          return;
        }

        if (ws.readyState !== WebSocket.OPEN) {
          cleanup();

          if ((!sfuWebSocketRef.current || sfuWebSocketRef.current === ws) &&
              peerConnectionRef.current &&
              peerConnectionRef.current.connectionState === 'connected' &&
              reconnectAttempt < maxReconnectAttempts &&
              !isDisconnectingRef.current) {
            attemptReconnection();
          }
        } else {
          try {
            ws.send(JSON.stringify({
              event: "keep_alive",
              data: JSON.stringify({ timestamp: Date.now() }),
            }));
          } catch {
            // Keep-alive send failed
          }
        }
      }, 15000);
    };

    const attemptReconnection = () => {
      if (isDisconnectingRef.current) {
        return;
      }

      if (sfuWebSocketRef.current && sfuWebSocketRef.current !== ws) {
        return;
      }

      reconnectAttempt++;

      setTimeout(() => {
        if ((!sfuWebSocketRef.current || sfuWebSocketRef.current === ws) &&
            peerConnectionRef.current &&
            peerConnectionRef.current.connectionState === 'connected' &&
            !isDisconnectingRef.current) {
          // Would require a more complex reconnection strategy;
          // let the existing reconnection logic handle it
        }
      }, 1000 * reconnectAttempt);
    };

    const processOffer = (offer: RTCSessionDescriptionInit) => {
      voiceLog.step("SFU-WS", "7d", "Processing SFU offer", {
        sdpLength: offer.sdp?.length || 0,
        signalingState: peerConnectionRef.current?.signalingState,
        connectionState: peerConnectionRef.current?.connectionState,
      });

      if (!peerConnectionRef.current || peerConnectionRef.current.connectionState === 'closed') {
        voiceLog.warn("SFU-WS", "Cannot process offer — peer connection closed or null");
        return;
      }

      if (peerConnectionRef.current.signalingState !== 'stable' &&
          peerConnectionRef.current.signalingState !== 'have-remote-offer') {
        voiceLog.warn("SFU-WS", `Cannot process offer — signaling state: ${peerConnectionRef.current.signalingState}, queuing`);
        pendingOffer = offer;
        return;
      }

      offerProcessingInProgress = true;

      peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(offer))
        .then(() => {
          voiceLog.ok("SFU-WS", "7d", "Remote description set, creating answer…");
          if (peerConnectionRef.current && peerConnectionRef.current.connectionState !== 'closed') {
            return peerConnectionRef.current.createAnswer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: false,
            });
          }
          throw new Error("Peer connection closed during offer processing");
        })
        .then((answer) => {
          if (eSportsModeEnabled && answer.sdp) {
            voiceLog.info("SFU-WS", "eSports mode — optimizing SDP for low latency (ptime=10)");
            answer = { ...answer, sdp: optimizeSdpForLowLatency(answer.sdp) };
          }
          voiceLog.ok("SFU-WS", "7e", `Answer created (${answer.sdp?.length || 0} bytes SDP)`);
          if (peerConnectionRef.current && peerConnectionRef.current.connectionState !== 'closed') {
            return peerConnectionRef.current.setLocalDescription(answer);
          }
          throw new Error("Peer connection closed during answer creation");
        })
        .then(() => {
          if (ws.readyState === WebSocket.OPEN &&
              peerConnectionRef.current &&
              !isDisconnectingRef.current) {
            const answer = peerConnectionRef.current.localDescription;
            if (answer) {
              voiceLog.ok("SFU-WS", "7f", "Sending answer to SFU");
              ws.send(JSON.stringify({
                event: "answer",
                data: JSON.stringify(answer),
              }));
            } else {
              throw new Error("No local description available");
            }
          }
        })
        .catch((error) => {
          voiceLog.fail("SFU-WS", "7d", "Error processing offer/answer exchange", error);
        })
        .finally(() => {
          offerProcessingInProgress = false;
          if (pendingOffer) {
            voiceLog.info("SFU-WS", "Processing queued offer…");
            const next = pendingOffer;
            pendingOffer = null;
            processOffer(next);
          }
        });
    };

    ws.onopen = () => {
      voiceLog.ok("SFU-WS", "7a", "WebSocket TCP connection open");
      if (isDisconnectingRef.current) {
        voiceLog.warn("SFU-WS", "Disconnecting — closing newly opened WebSocket");
        cleanup();
        ws.close();
        return;
      }

      reconnectAttempt = 0;

      const joinMessage = {
        event: "client_join",
        data: JSON.stringify(joinToken),
      };

      try {
        voiceLog.step("SFU-WS", "7b", "Sending client_join to SFU", { room_id: (joinToken as Record<string, unknown>).room_id });
        ws.send(JSON.stringify(joinMessage));
      } catch (error) {
        voiceLog.fail("SFU-WS", "7b", "Failed to send client_join message", error);
        if (!isResolved) {
          clearTimeout(timeout);
          isResolved = true;
          cleanup();
          reject(new Error("Failed to send join message"));
        }
      }
    };

    ws.onmessage = (event) => {
      if (isDisconnectingRef.current) {
        return;
      }

      try {
        const message = JSON.parse(event.data);

        switch (message.event) {
          case "room_joined":
            voiceLog.ok("SFU-WS", "7c", "SFU confirmed room_joined");
            if (!isResolved) {
              clearTimeout(timeout);
              isResolved = true;
              startConnectionMonitor();
              resolve(ws);
            }
            break;

          case "voice:room:error":
            voiceLog.fail("SFU-WS", "7c", "SFU returned room error", message.data);
            if (!isResolved) {
              clearTimeout(timeout);
              isResolved = true;
              cleanup();
              reject(new Error(`SFU room error: ${message.data}`));
            }
            break;

          case "offer": {
            voiceLog.step("SFU-WS", "7d", "Received SFU offer");
            const offer = JSON.parse(message.data);

            if (offerProcessingInProgress) {
              voiceLog.info("SFU-WS", "Offer queued (previous still processing)");
              pendingOffer = offer;
              break;
            }

            processOffer(offer);
            break;
          }

          case "candidate": {
            const candidate = JSON.parse(message.data);
            voiceLog.info("SFU-WS", `Remote ICE candidate: ${candidate.candidate?.substring(0, 60)}…`);
            if (peerConnectionRef.current &&
                peerConnectionRef.current.connectionState !== 'closed' &&
                peerConnectionRef.current.connectionState !== 'failed') {
              peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate))
                .catch((error) => {
                  if (error.name !== 'InvalidStateError') {
                    voiceLog.fail("SFU-WS", "ICE", "Error adding remote ICE candidate", error);
                  }
                });
            }
            break;
          }

          default:
            voiceLog.info("SFU-WS", `Unhandled SFU message: ${message.event}`);
        }
      } catch (error) {
        voiceLog.fail("SFU-WS", "MSG", "Error parsing SFU message", error);
      }
    };

    ws.onclose = (event) => {
      voiceLog.warn("SFU-WS", `WebSocket closed: code=${event.code} reason="${event.reason || '(none)'}" wasClean=${event.wasClean}`);
      cleanup();

      if (!isResolved) {
        voiceLog.fail("SFU-WS", "7a", "WebSocket closed before room_joined");
        clearTimeout(timeout);
        isResolved = true;
        reject(new Error(`SFU WebSocket closed: ${event.code}`));
      }
    };

    ws.onerror = (event) => {
      voiceLog.fail("SFU-WS", "7a", "WebSocket connection error", event);
      cleanup();
      if (!isResolved) {
        clearTimeout(timeout);
        isResolved = true;
        reject(new Error("SFU WebSocket connection failed"));
      }
    };
  });
}
