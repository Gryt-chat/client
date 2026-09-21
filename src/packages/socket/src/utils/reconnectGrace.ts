// Type-only, so scripts/check-reconnect-grace.mjs can run this against a real socket.
import type { Socket } from "socket.io-client";

/* socket.io's first retry is 0.5 to 1.5 seconds out, then a handshake. A drop that
   is back by then is never shown: no grey server, no banner, no toast. GRYT-1301. */
export const RECONNECT_GRACE_MS = 3_000;

export interface ReconnectWatch {
  /** Still gone after the grace, with socket.io still trying. */
  onReconnecting: () => void;
  /** Back. `wasShown` says whether onReconnecting ran for this drop. */
  onReconnected: (wasShown: boolean) => void;
  /** Closed for good: the server ended it, or this app did, and nothing retries. */
  onClosed: () => void;
}

/**
 * Wires a socket's drop and return so a drop shorter than `graceMs` shows nothing.
 * `onReconnected` runs for every `reconnect`, replayed ones included.
 */
export function watchReconnects(socket: Socket, graceMs: number, watch: ReconnectWatch): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let shown = false;

  const cancel = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  socket.on("disconnect", () => {
    // Not active: closed on purpose, by the server or by this app, so no retry is coming.
    if (!socket.active) {
      cancel();
      watch.onClosed();
      return;
    }
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      // Put down during the grace, by leaving the server or a refusal.
      if (!socket.active) return;
      shown = true;
      watch.onReconnecting();
    }, graceMs);
  });

  // Back, whether socket.io's own retry brought it or a fresh open did.
  socket.on("connect", cancel);

  socket.io.on("reconnect", () => {
    cancel();
    const wasShown = shown;
    shown = false;
    watch.onReconnected(wasShown);
  });
}
