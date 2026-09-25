import { useEffect, useSyncExternalStore } from "react";
import type { Socket } from "socket.io-client";

import { getContactPrefsSnapshot, resolveContactPrefs, subscribeToContactPrefs } from "@/common";

/**
 * Tells one server who may message or ring you, on every connect and on every
 * change. A server from before GRYT-1470 ignores it, and the app still filters.
 */
export function useContactPrefsSync({
  host,
  socket,
  accessToken,
  isConnected,
}: {
  host: string;
  socket: Socket | null;
  accessToken: string | null;
  isConnected: boolean;
}): void {
  const stored = useSyncExternalStore(subscribeToContactPrefs, getContactPrefsSnapshot, getContactPrefsSnapshot);
  const { messages, calls } = resolveContactPrefs(stored, host);

  useEffect(() => {
    if (!socket || !accessToken || !isConnected) return;
    socket.emit("contact:prefs:set", { accessToken, messages, calls });
  }, [socket, accessToken, isConnected, messages, calls]);
}
