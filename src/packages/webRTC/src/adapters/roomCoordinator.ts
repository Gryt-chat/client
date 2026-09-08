import type { RoomAccess, RoomCoordinator } from "@gryt/voice";
import type { Socket } from "socket.io-client";

import { handleRateLimitError } from "@/socket/src/utils/rateLimitHandler";


/**
 * What the server sends back on `voice:room:granted`. Declared here rather than
 * imported: it is Gryt's socket payload, not anything `@gryt/voice` knows.
 */
interface RoomAccessData {
  room_id: string;
  join_token: unknown;
  sfu_url: string;
  sfu_urls?: string[];
  timestamp: number;
}

/** How long to wait for the server to answer a room request. */
const ACCESS_TIMEOUT_MS = 15_000;

/**
 * Gryt's half of joining a channel, over the socket the client already has. The
 * rate-limit toast is here because saying it out loud is the app's job.
 */
export function createRoomCoordinator(socket: Socket, host: string): RoomCoordinator {
  return {
    requestAccess(channelId: string): Promise<RoomAccess> {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          cleanup();
          resolve({ granted: false, reason: "Room access request timed out" });
        }, ACCESS_TIMEOUT_MS);

        const cleanup = () => {
          clearTimeout(timeout);
          socket.off("voice:room:granted", onGranted);
          socket.off("voice:room:error", onError);
        };

        const onGranted = (data: RoomAccessData) => {
          cleanup();
          resolve({
            granted: true,
            roomId: data.room_id,
            joinToken: data.join_token,
            sfuUrls: data.sfu_urls?.length ? data.sfu_urls : [data.sfu_url],
            // The engine caches its chosen SFU against this and never reads it.
            // The host is what the old code keyed the cache on.
            cacheKey: host,
          });
        };

        const onError = (
          error:
            | string
            | { error: string; message?: string; retryAfterMs?: number },
        ) => {
          cleanup();

          if (typeof error === "object" && error.error === "rate_limited" && error.message) {
            handleRateLimitError(error, "Voice connection");
            resolve({
              granted: false,
              reason: error.message,
              retryAfterMs: error.retryAfterMs,
            });
            return;
          }

          resolve({
            granted: false,
            reason: typeof error === "string" ? error : error.error || "Unknown error",
          });
        };

        socket.once("voice:room:granted", onGranted);
        socket.once("voice:room:error", onError);
        socket.emit("voice:room:request", channelId);
      });
    },

    leave: () => socket.emit("voice:room:leave"),
    announceJoined: (joined) => socket.emit("voice:channel:joined", joined),
    setLocalStream: (streamId) => socket.emit("voice:stream:set", streamId ?? ""),
    peerChanged: (streamId, present) =>
      socket.emit(present ? "voice:peer:connected" : "voice:peer:disconnected", streamId),

    get connected() {
      return socket.connected;
    },

    onReconnected(handler: () => void) {
      // The client raises a `server_socket_reconnected` window event with the host
      // in its detail. It stays a window event here, filtered to this server.
      const listener = (event: Event) => {
        const detail = (event as CustomEvent<{ host?: string }>).detail;
        if (detail?.host && detail.host !== host) return;
        handler();
      };
      window.addEventListener("server_socket_reconnected", listener);
      return () => window.removeEventListener("server_socket_reconnected", listener);
    },
  };
}
