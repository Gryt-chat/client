import { useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";

/**
 * Subscribe to a single socket.io event with automatic cleanup. The handler goes
 * through a ref, so only `socket` or `event` changing re-subscribes.
 */
export function useSocketEvent<T = unknown>(
  socket: Socket | undefined,
  event: string,
  handler: (payload: T) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!socket) return;
    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}
